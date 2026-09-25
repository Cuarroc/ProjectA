//! GitHub facts, read through the `gh` CLI.
//!
//! Once a worker has pushed its branch, the pull request describes the work
//! better than anything happening in the terminal: open means someone should
//! look at it, approved-with-green-checks means it can go in, merged means the
//! worker is finished.
//!
//! A poller asks `gh pr list --head <branch>` for every live worker once a
//! minute and feeds the answer to the [`StatusEngine`]. Every step of that is
//! optional: no `gh` on the PATH, no GitHub remote, no pull request, or a `gh`
//! that fails for any reason at all, and the worker is simply skipped. Nothing
//! here may ever turn into an error the user sees.

use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::status::{
    ReasonCode, StatusEngine, Verdict, COL_DONE, COL_IN_REVIEW, COL_NEEDS_YOU, COL_READY_TO_MERGE,
};
use crate::store::{Store, STATUS_ARCHIVED};

/// How often the poller sweeps every project.
pub const POLL_INTERVAL: Duration = Duration::from_secs(60);

/// The `--json` fields the board reads.
const GH_FIELDS: &str = "url,state,isDraft,reviewDecision,statusCheckRollup";

/// What GitHub says about one branch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrFacts {
    pub url: String,
    /// `OPEN`, `MERGED` or `CLOSED`.
    pub state: String,
    pub is_draft: bool,
    /// `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`, or none at all.
    pub review_decision: Option<String>,
    /// Every check has finished and none of them failed.
    pub checks_green: bool,
}

/// A single check counts as green when it succeeded, or when it deliberately
/// did not run. Anything still pending is not green *yet*.
fn check_is_green(check: &Value) -> bool {
    let verdict = check
        .get("conclusion")
        .and_then(Value::as_str)
        .or_else(|| check.get("state").and_then(Value::as_str))
        .unwrap_or_default()
        .to_ascii_uppercase();
    matches!(verdict.as_str(), "SUCCESS" | "NEUTRAL" | "SKIPPED")
}

/// Read the first pull request out of a `gh pr list --json ...` array.
///
/// `gh` is generous with nulls and omitted fields, so every field is optional
/// and only `url` is actually required.
pub fn parse_pr_list(json: &str) -> Option<PrFacts> {
    let parsed: Value = serde_json::from_str(json).ok()?;
    let pr = parsed.as_array()?.first()?;

    let checks = pr.get("statusCheckRollup").and_then(Value::as_array);
    Some(PrFacts {
        url: pr.get("url")?.as_str()?.to_string(),
        state: pr
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or("OPEN")
            .to_ascii_uppercase(),
        is_draft: pr
            .get("isDraft")
            .and_then(Value::as_bool)
            .unwrap_or_default(),
        review_decision: pr
            .get("reviewDecision")
            .and_then(Value::as_str)
            .map(|d| d.to_ascii_uppercase())
            .filter(|d| !d.is_empty()),
        // No checks configured is not a reason to hold a pull request back.
        checks_green: checks.is_none_or(|checks| checks.iter().all(check_is_green)),
    })
}

/// Which column the pull request argues for, if any.
pub fn verdict_for(facts: &PrFacts) -> Option<Verdict> {
    match facts.state.as_str() {
        "MERGED" => Some(Verdict::coded(COL_DONE, ReasonCode::PullRequestMerged)),
        // Closed without merging says nothing about what to do next.
        "CLOSED" => None,
        "OPEN" => Some(match facts.review_decision.as_deref() {
            Some("CHANGES_REQUESTED") => {
                Verdict::coded(COL_NEEDS_YOU, ReasonCode::ChangesRequested)
            }
            Some("APPROVED") if !facts.is_draft && facts.checks_green => {
                Verdict::coded(COL_READY_TO_MERGE, ReasonCode::ReviewApproved)
            }
            Some("APPROVED") if facts.is_draft => {
                Verdict::coded(COL_IN_REVIEW, ReasonCode::ApprovedButDraft)
            }
            Some("APPROVED") => Verdict::coded(COL_IN_REVIEW, ReasonCode::ChecksPending),
            _ if facts.is_draft => Verdict::coded(COL_IN_REVIEW, ReasonCode::ReviewDraft),
            _ => Verdict::coded(COL_IN_REVIEW, ReasonCode::ReviewPending),
        }),
        _ => None,
    }
}

// -- talking to the tools --------------------------------------------------

/// Is `gh` on the PATH and runnable?
pub fn gh_available() -> bool {
    let (exe, prefix) = crate::providers::program_invocation("gh");
    crate::proc::command(exe)
        .args(prefix)
        .arg("--version")
        .output()
        .is_ok_and(|out| out.status.success())
}

/// Does this repository have a remote that points at GitHub?
///
/// Local-only repositories - which is every repository in the test suite - are
/// skipped here rather than a few seconds later inside a failing `gh` call.
pub fn has_github_remote(repo_path: &str) -> bool {
    if !Path::new(repo_path).is_dir() {
        return false;
    }
    crate::proc::command("git")
        .arg("-C")
        .arg(repo_path)
        .args(["remote", "-v"])
        .output()
        .is_ok_and(|out| {
            out.status.success()
                && String::from_utf8_lossy(&out.stdout)
                    .to_ascii_lowercase()
                    .contains("github.com")
        })
}

/// Ask GitHub about `branch`. `None` covers "no pull request" and every kind of
/// failure alike - from here they mean the same thing: nothing to report.
pub fn pr_for_branch(repo_path: &str, branch: &str) -> Option<PrFacts> {
    let (exe, prefix) = crate::providers::program_invocation("gh");
    let output = crate::proc::command(exe)
        .args(prefix)
        .current_dir(repo_path)
        .args([
            "pr", "list", "--head", branch, "--state", "all", "--limit", "1",
        ])
        .args(["--json", GH_FIELDS])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_pr_list(&String::from_utf8_lossy(&output.stdout))
}

/// One sweep: every worker of every project with a GitHub remote.
///
/// Returns how many workers were looked at, which is what the tests assert on -
/// zero means everything was skipped.
pub fn poll_once(store: &Store, engine: &StatusEngine) -> usize {
    if !gh_available() {
        return 0;
    }
    let Ok(projects) = tauri::async_runtime::block_on(store.list_projects()) else {
        return 0;
    };

    let mut checked = 0;
    for project in projects {
        if !has_github_remote(&project.repo_path) {
            continue;
        }
        let Ok(workers) = tauri::async_runtime::block_on(store.list_workers(Some(&project.id)))
        else {
            continue;
        };
        for worker in workers {
            if worker.status == STATUS_ARCHIVED || worker.branch.is_empty() {
                continue;
            }
            checked += 1;
            let facts = pr_for_branch(&project.repo_path, &worker.branch);
            let url = facts.as_ref().map(|f| f.url.clone());
            let _ =
                tauri::async_runtime::block_on(store.set_worker_pr_url(&worker.id, url.as_deref()));
            engine.note_gh(&worker.id, facts.as_ref().and_then(verdict_for), url);
        }
    }
    checked
}

/// Start the background poller. A plain OS thread, because the work it does is
/// blocking anyway: two child processes per worker.
pub fn start(store: Store, engine: Arc<StatusEngine>) {
    std::thread::spawn(move || loop {
        poll_once(&store, &engine);
        std::thread::sleep(POLL_INTERVAL);
    });
}

// -- creating and linking repositories --------------------------------------

/// How long `gh repo create` may run before it is killed.
///
/// Generous on purpose: `--push` uploads the project's commits, so the runtime
/// scales with repository size and uplink, not with GitHub's API. Killing the
/// child too early is the worst outcome - the repository and the `origin`
/// remote may already exist by then, which turns every retry into
/// "remote 'origin' already exists".
const CREATE_TIMEOUT: Duration = Duration::from_secs(180);

/// How often the bounded wait looks at the child process.
const CREATE_POLL_INTERVAL: Duration = Duration::from_millis(50);

/// A GitHub repository name the way GitHub itself wants it.
pub fn validate_repo_name(name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("repository name is required".to_string());
    }
    // A letter or digit up front also rules out leading hyphens and dots;
    // anything but the classic characters is refused rather than escaped.
    let valid = name.starts_with(|c: char| c.is_ascii_alphanumeric())
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !name.ends_with(".git");
    if valid {
        Ok(())
    } else {
        Err(format!("invalid repository name: {name}"))
    }
}

/// The argument vector for `gh repo create`, so tests can read what would be
/// spawned without ever spawning it.
pub fn build_gh_create_args(name: &str, private: bool, repo_path: &str) -> Vec<String> {
    vec![
        "repo".to_string(),
        "create".to_string(),
        name.to_string(),
        (if private { "--private" } else { "--public" }).to_string(),
        "--source".to_string(),
        repo_path.to_string(),
        "--remote".to_string(),
        "origin".to_string(),
        "--push".to_string(),
    ]
}

/// Does this url point at GitHub the way remotes are written?
pub fn valid_github_url(url: &str) -> Result<(), String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("url is required".to_string());
    }
    if url.starts_with("https://github.com/") || url.starts_with("git@github.com:") {
        Ok(())
    } else {
        Err(format!("unsupported github url: {url}"))
    }
}

/// Keep an error text readable; `gh` can be generous on a bad day.
fn truncate(text: &str, cap: usize) -> String {
    if text.chars().count() <= cap {
        return text.to_string();
    }
    text.chars().take(cap).collect()
}

/// Whether git already knows an origin in this repository.
///
/// An existing remote is checked *before* anything is spawned: refusing early
/// must not depend on whether `gh` happens to be installed.
fn remote_origin_exists(repo_path: &str) -> bool {
    crate::proc::command("git")
        .arg("-C")
        .arg(repo_path)
        .args(["remote", "get-url", "origin"])
        .output()
        .is_ok_and(|out| out.status.success())
}

/// Create the repository on GitHub and push this project into it.
///
/// Runs `gh repo create <name> --private|--public --source <repo_path>
/// --remote origin --push` with a bounded wait, then reads the url back out of
/// git - which is more robust than parsing gh's stdout for it.
pub fn create_github_repo(repo_path: &str, name: &str, private: bool) -> Result<String, String> {
    validate_repo_name(name)?;
    if !Path::new(repo_path).is_dir() {
        return Err(format!("not a repository directory: {repo_path}"));
    }
    if remote_origin_exists(repo_path) {
        return Err(format!(
            "{}remote 'origin' already exists",
            crate::workers::ERR_REFUSED
        ));
    }
    if !gh_available() {
        return Err("github cli (gh) is not available".to_string());
    }

    let args = build_gh_create_args(name.trim(), private, repo_path);
    let (exe, prefix) = crate::providers::program_invocation("gh");
    let mut child = crate::proc::command(exe)
        .args(prefix)
        .args(&args)
        // No terminal on the other end: a prompt would hang until the timeout.
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(repo_path)
        .spawn()
        .map_err(|e| format!("failed to start gh: {e}"))?;

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(e) => return Err(format!("failed to wait for gh: {e}")),
        }
        if started.elapsed() >= CREATE_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            // gh may have created the repository and added `origin` before the
            // push ran out of time. Say so, and say what finishes the job -
            // otherwise the user retries into "remote 'origin' already exists"
            // with no idea why.
            if remote_origin_exists(repo_path) {
                return Err(format!(
                    "gh did not finish within {}s, but the repository and the                      'origin' remote were created; the push may be incomplete -                      run `git push -u origin HEAD` in the project to finish it",
                    CREATE_TIMEOUT.as_secs()
                ));
            }
            return Err(format!(
                "gh did not finish within {}s",
                CREATE_TIMEOUT.as_secs()
            ));
        }
        std::thread::sleep(CREATE_POLL_INTERVAL);
    };

    let output = child
        .wait_with_output()
        .map_err(|e| format!("failed to collect gh's output: {e}"))?;
    if !status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let detail = if detail.is_empty() {
            format!("exited with {}", status.code().unwrap_or(-1))
        } else {
            truncate(&detail, 500)
        };
        return Err(format!("gh repo create failed: {detail}"));
    }

    let url_out = crate::proc::command("git")
        .arg("-C")
        .arg(repo_path)
        .args(["remote", "get-url", "origin"])
        .output()
        .map_err(|e| format!("failed to read the remote url: {e}"))?;
    let url = String::from_utf8_lossy(&url_out.stdout).trim().to_string();
    if !url_out.status.success() || url.is_empty() {
        return Err(
            "the repository was created on github, but reading the origin url failed".to_string(),
        );
    }
    Ok(url)
}

/// Add `url` as the project's `origin`.
pub fn link_github_remote(repo_path: &str, url: &str) -> Result<(), String> {
    valid_github_url(url)?;
    let url = url.trim();
    if !Path::new(repo_path).is_dir() {
        return Err(format!("not a repository directory: {repo_path}"));
    }
    if remote_origin_exists(repo_path) {
        return Err(format!(
            "{}remote 'origin' already exists",
            crate::workers::ERR_REFUSED
        ));
    }

    let output = crate::proc::command("git")
        .arg("-C")
        .arg(repo_path)
        .args(["remote", "add", "origin", url])
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if !output.status.success() {
        let detail = truncate(String::from_utf8_lossy(&output.stderr).trim(), 500);
        return Err(format!("git remote add origin failed: {detail}"));
    }
    Ok(())
}

// -- merging (Phase 13) -----------------------------------------------------

/// The argument vector for the branch push, built as a pure function so tests
/// can read exactly what would be spawned without spawning it - the same idea
/// as [`build_gh_create_args`].
///
/// `-u` makes the local branch track `origin`, which is what
/// `gh pr create --head` expects to find.
pub fn build_push_args(repo_path: &str, branch: &str) -> Vec<String> {
    vec![
        "-C".to_string(),
        repo_path.to_string(),
        "push".to_string(),
        "-u".to_string(),
        "origin".to_string(),
        branch.to_string(),
    ]
}

/// `gh pr create` for one branch. No `--base`: gh takes the repository's own
/// default branch, which is the branch a local merge would target too.
pub fn build_pr_create_args(branch: &str, title: &str, body: &str) -> Vec<String> {
    vec![
        "pr".to_string(),
        "create".to_string(),
        "--head".to_string(),
        branch.to_string(),
        "--title".to_string(),
        title.to_string(),
        "--body".to_string(),
        body.to_string(),
    ]
}

/// `gh pr merge <branch> --merge`: a merge commit, never a squash or a rebase,
/// so the branch a worker produced stays readable in the history.
pub fn build_pr_merge_args(branch: &str) -> Vec<String> {
    vec![
        "pr".to_string(),
        "merge".to_string(),
        branch.to_string(),
        "--merge".to_string(),
    ]
}

/// `git merge --no-ff <branch>`, for the same reason as `--merge` above: even a
/// branch that could fast-forward gets a commit saying it was merged.
pub fn build_merge_args(repo_path: &str, branch: &str) -> Vec<String> {
    vec![
        "-C".to_string(),
        repo_path.to_string(),
        "merge".to_string(),
        "--no-ff".to_string(),
        branch.to_string(),
    ]
}

/// `git checkout <branch>`, used only to put the base branch under HEAD before
/// a local merge.
pub fn build_checkout_args(repo_path: &str, branch: &str) -> Vec<String> {
    vec![
        "-C".to_string(),
        repo_path.to_string(),
        "checkout".to_string(),
        branch.to_string(),
    ]
}

/// Run `git` or `gh` and return its stdout, or an error carrying everything the
/// tool said.
///
/// Merging is the one place where the failure text matters more than the exit
/// code: a conflict, a rejected push, a protected branch. Git writes some of
/// that to stdout and some to stderr, so both go into the message and the human
/// reads git's own words in the dialog. Nothing here is ever swallowed.
fn run_tool(
    program: &str,
    args: &[String],
    repo_path: &str,
    label: &str,
) -> Result<String, String> {
    let (exe, prefix) = crate::providers::program_invocation(program);
    let output = crate::proc::command(exe)
        .args(prefix)
        .args(args)
        // No terminal on the other end: a credential or confirmation prompt
        // would block forever instead of asking anyone.
        .stdin(Stdio::null())
        .env("GIT_TERMINAL_PROMPT", "0")
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("failed to start {program}: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() {
        return Ok(stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let detail: String = [stderr, stdout]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    let detail = if detail.is_empty() {
        format!("exited with {}", output.status.code().unwrap_or(-1))
    } else {
        truncate(&detail, 2000)
    };
    Err(format!("{label} failed: {detail}"))
}

/// The pull request url out of what `gh pr create` printed.
///
/// gh puts the url on a line of its own, sometimes after a line of prose about
/// the remote it picked. The last line that looks like a pull request url is
/// the answer; nothing else in that output does.
pub fn extract_pr_url(output: &str) -> Option<String> {
    output
        .lines()
        .map(str::trim)
        .rfind(|line| line.starts_with("https://") && line.contains("/pull/"))
        .map(str::to_string)
}

/// Which branch the repository currently has checked out.
fn current_branch(repo_path: &str) -> Option<String> {
    let output = crate::proc::command("git")
        .arg("-C")
        .arg(repo_path)
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!branch.is_empty()).then_some(branch)
}

/// Does this repository have a local branch by that name?
fn branch_exists(repo_path: &str, branch: &str) -> bool {
    crate::proc::command("git")
        .arg("-C")
        .arg(repo_path)
        .args(["rev-parse", "--verify", "--quiet"])
        .arg(format!("refs/heads/{branch}"))
        .output()
        .is_ok_and(|out| out.status.success())
}

/// The branch a local merge should go into.
///
/// In this order, and deliberately so:
///
/// 1. `refs/remotes/origin/HEAD` - what the remote itself calls its default
///    branch. Where a remote has an opinion, it beats any guess of ours.
/// 2. a local `main`, then a local `master` - the two conventions, newest
///    first, and only when the branch actually exists.
/// 3. `main` as the last resort, so the caller always gets a name and the
///    error that follows names the branch that was missing.
pub fn default_base_branch(repo_path: &str) -> String {
    let head = crate::proc::command("git")
        .arg("-C")
        .arg(repo_path)
        .args([
            "symbolic-ref",
            "--short",
            "--quiet",
            "refs/remotes/origin/HEAD",
        ])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .filter(|head| !head.is_empty());
    if let Some(head) = head {
        // `origin/main` -> `main`; a remote HEAD is always qualified that way.
        return head.strip_prefix("origin/").unwrap_or(&head).to_string();
    }
    for candidate in ["main", "master"] {
        if branch_exists(repo_path, candidate) {
            return candidate.to_string();
        }
    }
    "main".to_string()
}

/// Push `branch` and open a pull request for it. Returns the pull request url.
///
/// The push comes first and non-interactively: `gh pr create --head` needs the
/// branch to exist on the remote, and a push that stopped to ask for a password
/// would hang the worker thread this runs on.
pub fn create_pr(repo_path: &str, branch: &str, title: &str, body: &str) -> Result<String, String> {
    if branch.trim().is_empty() {
        return Err("this worker has no branch to open a pull request for".to_string());
    }
    if !Path::new(repo_path).is_dir() {
        return Err(format!("not a repository directory: {repo_path}"));
    }
    if !gh_available() {
        return Err("github cli (gh) is not available".to_string());
    }

    run_tool(
        "git",
        &build_push_args(repo_path, branch),
        repo_path,
        "git push",
    )?;
    let printed = run_tool(
        "gh",
        &build_pr_create_args(branch, title, body),
        repo_path,
        "gh pr create",
    )?;
    extract_pr_url(&printed).ok_or_else(|| {
        format!(
            "gh pr create printed no pull request url: {}",
            truncate(&printed, 500)
        )
    })
}

/// Merge the pull request that belongs to `branch`.
pub fn merge_pr(repo_path: &str, branch: &str) -> Result<(), String> {
    if branch.trim().is_empty() {
        return Err("this worker has no branch to merge".to_string());
    }
    if !Path::new(repo_path).is_dir() {
        return Err(format!("not a repository directory: {repo_path}"));
    }
    if !gh_available() {
        return Err("github cli (gh) is not available".to_string());
    }
    run_tool("gh", &build_pr_merge_args(branch), repo_path, "gh pr merge")?;
    Ok(())
}

/// Is `branch` already merged into `base` - an ancestor of it, in git terms?
///
/// This is how a crashed merge asks git whether the merge step still needs
/// doing: the repository itself is the record. Anything that is not a clean
/// "yes" - not an ancestor, a missing ref, a broken repository - reads as
/// "no", so the merge attempt that follows surfaces the real error instead
/// of this check inventing one.
pub fn branch_merged_into(repo_path: &str, base_branch: &str, branch: &str) -> bool {
    crate::proc::command("git")
        .arg("-C")
        .arg(repo_path)
        .args(["merge-base", "--is-ancestor", branch, base_branch])
        .output()
        .is_ok_and(|out| out.status.success())
}

/// Merge `branch` into `base_branch` inside the repository itself.
///
/// Pushing whatever this produces is the caller's business, not this
/// function's: a repository with no remote is exactly the case it exists for.
pub fn merge_local(repo_path: &str, base_branch: &str, branch: &str) -> Result<(), String> {
    if branch.trim().is_empty() {
        return Err("this worker has no branch to merge".to_string());
    }
    if !Path::new(repo_path).is_dir() {
        return Err(format!("not a repository directory: {repo_path}"));
    }
    // `git merge` merges into whatever HEAD points at, so the base branch has
    // to be the checked-out one. Usually it already is; switching only when it
    // is not keeps a merge from disturbing a working copy for no reason.
    if current_branch(repo_path).as_deref() != Some(base_branch) {
        run_tool(
            "git",
            &build_checkout_args(repo_path, base_branch),
            repo_path,
            "git checkout",
        )?;
    }
    run_tool(
        "git",
        &build_merge_args(repo_path, branch),
        repo_path,
        "git merge",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    // Tests bauen Commands direkt: ein Fenster waehrend `cargo test`
    // stoert niemanden, und proc::command waere hier nur Umweg.
    use super::*;
    use crate::status::COL_WORKING;
    use crate::testutil::{init_repo, TempDir};
    use std::process::Command;

    /// A `gh pr list --json url,state,isDraft,reviewDecision,statusCheckRollup`
    /// response, with the fields the poller reads.
    fn pr_json(state: &str, draft: bool, review: &str, checks: &str) -> String {
        let review = if review.is_empty() {
            "null".to_string()
        } else {
            format!("\"{review}\"")
        };
        format!(
            r#"[{{"url":"https://github.com/o/r/pull/7","state":"{state}",
                 "isDraft":{draft},"reviewDecision":{review},
                 "statusCheckRollup":{checks}}}]"#
        )
    }

    const GREEN: &str = r#"[{"name":"build","conclusion":"SUCCESS"},
                            {"name":"lint","conclusion":"SKIPPED"}]"#;
    const PENDING: &str = r#"[{"name":"build","conclusion":""},
                             {"name":"lint","conclusion":"SUCCESS"}]"#;
    const FAILING: &str = r#"[{"name":"build","conclusion":"FAILURE"}]"#;

    #[test]
    fn every_gh_spawn_uses_the_windows_shim_resolver() {
        let source = include_str!("gh.rs");
        for function in ["gh_available", "pr_for_branch"] {
            let body = source
                .split(&format!("fn {function}"))
                .nth(1)
                .and_then(|rest| rest.split("\n}").next())
                .unwrap_or_else(|| panic!("{function} source"));
            assert!(
                body.contains("providers::program_invocation"),
                "{function} starts gh without the Windows PATH/PATHEXT shim resolver:\n{body}"
            );
        }
    }

    #[test]
    fn an_empty_result_means_no_pull_request() {
        assert_eq!(parse_pr_list("[]"), None);
        assert_eq!(parse_pr_list("not json"), None);
        // `gh` prints an object when it errors out; that is not a PR either.
        assert_eq!(parse_pr_list(r#"{"message":"no repository"}"#), None);
    }

    #[test]
    fn parses_the_fields_the_board_cares_about() {
        let facts = parse_pr_list(&pr_json("OPEN", true, "APPROVED", GREEN)).expect("facts");
        assert_eq!(facts.url, "https://github.com/o/r/pull/7");
        assert_eq!(facts.state, "OPEN");
        assert!(facts.is_draft);
        assert_eq!(facts.review_decision.as_deref(), Some("APPROVED"));
        assert!(facts.checks_green);
    }

    #[test]
    fn missing_fields_fall_back_to_the_open_undecided_case() {
        let facts = parse_pr_list(r#"[{"url":"https://github.com/o/r/pull/7"}]"#).expect("facts");
        assert_eq!(facts.state, "OPEN");
        assert!(!facts.is_draft);
        assert_eq!(facts.review_decision, None);
        // A repository with no CI configured must not look permanently red.
        assert!(facts.checks_green);
        assert_eq!(verdict_for(&facts).unwrap().column, COL_IN_REVIEW);
    }

    #[test]
    fn checks_are_green_only_when_nothing_is_pending_or_failing() {
        let green = parse_pr_list(&pr_json("OPEN", false, "APPROVED", GREEN)).unwrap();
        let pending = parse_pr_list(&pr_json("OPEN", false, "APPROVED", PENDING)).unwrap();
        let failing = parse_pr_list(&pr_json("OPEN", false, "APPROVED", FAILING)).unwrap();
        assert!(green.checks_green);
        assert!(!pending.checks_green);
        assert!(!failing.checks_green);

        assert_eq!(verdict_for(&green).unwrap().column, COL_READY_TO_MERGE);
        assert_eq!(verdict_for(&pending).unwrap().column, COL_IN_REVIEW);
        assert_eq!(verdict_for(&failing).unwrap().column, COL_IN_REVIEW);
    }

    #[test]
    fn an_open_pull_request_is_in_review() {
        let open = parse_pr_list(&pr_json("OPEN", false, "", GREEN)).unwrap();
        let verdict = verdict_for(&open).expect("verdict");
        assert_eq!(verdict.column, COL_IN_REVIEW);
        // Der Text folgt aus dem Code, nicht umgekehrt - hier steht er als
        // Beleg, dass die Ableitung ankommt.
        assert_eq!(
            verdict.signal.map(|s| s.code),
            Some(ReasonCode::ReviewPending)
        );
        assert_eq!(
            verdict.reason.as_deref(),
            Some(
                "Der Pull Request wartet auf ein Review — sieh ihn dir an oder hol ein Review ein"
            )
        );

        let draft = parse_pr_list(&pr_json("OPEN", true, "", GREEN)).unwrap();
        assert_eq!(
            verdict_for(&draft).unwrap().signal.map(|s| s.code),
            Some(ReasonCode::ReviewDraft)
        );
    }

    #[test]
    fn approved_and_green_is_ready_to_merge_unless_it_is_a_draft() {
        let ready = parse_pr_list(&pr_json("OPEN", false, "APPROVED", GREEN)).unwrap();
        let verdict = verdict_for(&ready).expect("verdict");
        assert_eq!(verdict.column, COL_READY_TO_MERGE);
        assert_eq!(
            verdict.signal.map(|s| s.code),
            Some(ReasonCode::ReviewApproved)
        );

        let draft = parse_pr_list(&pr_json("OPEN", true, "APPROVED", GREEN)).unwrap();
        assert_eq!(verdict_for(&draft).unwrap().column, COL_IN_REVIEW);
    }

    #[test]
    fn changes_requested_comes_back_to_you() {
        let facts = parse_pr_list(&pr_json("OPEN", false, "CHANGES_REQUESTED", GREEN)).unwrap();
        assert_eq!(verdict_for(&facts).unwrap().column, COL_NEEDS_YOU);
    }

    #[test]
    fn a_merged_pull_request_is_done_and_a_closed_one_says_nothing() {
        let merged = parse_pr_list(&pr_json("MERGED", false, "APPROVED", GREEN)).unwrap();
        assert_eq!(verdict_for(&merged).unwrap().column, COL_DONE);

        let closed = parse_pr_list(&pr_json("CLOSED", false, "", GREEN)).unwrap();
        assert_eq!(verdict_for(&closed), None);
    }

    #[test]
    fn a_repository_without_a_github_remote_is_skipped() {
        let dir = TempDir::new("gh-remote");
        let repo = init_repo(&dir.path().join("repo"));
        let repo_path = repo.to_string_lossy().into_owned();

        // A freshly initialised repository has no remotes at all.
        assert!(!has_github_remote(&repo_path));
        // Neither does one pointing somewhere else.
        Command::new("git")
            .arg("-C")
            .arg(&repo_path)
            .args(["remote", "add", "origin", "https://gitlab.com/o/r.git"])
            .output()
            .expect("git remote add");
        assert!(!has_github_remote(&repo_path));

        Command::new("git")
            .arg("-C")
            .arg(&repo_path)
            .args(["remote", "set-url", "origin", "https://github.com/o/r.git"])
            .output()
            .expect("git remote set-url");
        assert!(has_github_remote(&repo_path));

        assert!(!has_github_remote(
            &dir.path().join("nope").to_string_lossy()
        ));
    }

    /// A plain `#[test]`: [`poll_once`] blocks on the store the way the poller
    /// thread does, and blocking inside a `#[tokio::test]` runtime would panic.
    #[test]
    fn a_sweep_over_local_only_repositories_checks_nothing() {
        let dir = TempDir::new("gh-poll");
        let repo = init_repo(&dir.path().join("repo"));
        let db = dir.path().join("projecta.db");

        let store = tauri::async_runtime::block_on(Store::open(&db)).expect("open store");
        let project = tauri::async_runtime::block_on(
            store.create_project("ProjectA", &repo.to_string_lossy()),
        )
        .expect("create project");
        tauri::async_runtime::block_on(store.insert_worker(&crate::store::WorkerRow {
            id: "wk-1".to_string(),
            project_id: project.id.clone(),
            task: "task".to_string(),
            profile_id: "claude".to_string(),
            branch: "pa/wk-1".to_string(),
            worktree_path: "C:/tmp/wk-1".to_string(),
            status: crate::store::STATUS_RUNNING.to_string(),
            kind: crate::store::KIND_WORKER.to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: None,
            tested_at: None,
            role_variant_id: None,
            paused_reason: None,
            created_at: 0,
        }))
        .expect("insert worker");

        // The repository is local-only, so the sweep must skip it - whether or
        // not `gh` happens to be installed on this machine.
        let engine = StatusEngine::default();
        assert_eq!(poll_once(&store, &engine), 0);
        assert_eq!(engine.verdict_for("wk-1").column, COL_WORKING);

        let worker = tauri::async_runtime::block_on(store.get_worker("wk-1"))
            .unwrap()
            .unwrap();
        assert!(worker.pr_url.is_none());
    }

    #[test]
    fn the_create_arguments_carry_everything_gh_needs() {
        assert_eq!(
            build_gh_create_args("my-repo", true, "C:/repos/a"),
            vec![
                "repo",
                "create",
                "my-repo",
                "--private",
                "--source",
                "C:/repos/a",
                "--remote",
                "origin",
                "--push",
            ]
        );
        assert_eq!(build_gh_create_args("b", false, ".")[3], "--public");
    }

    #[test]
    fn repository_names_are_validated_without_touching_the_disk() {
        assert_eq!(
            validate_repo_name("   "),
            Err("repository name is required".to_string())
        );
        assert_eq!(
            validate_repo_name(""),
            Err("repository name is required".to_string())
        );
        for bad in ["a b", "-lead", ".dot", "weird/", "spa ce", "ends.git"] {
            assert!(validate_repo_name(bad).is_err(), "{bad}");
        }
        for good in ["projecta", "My.Repo_2", "x-9.y_z"] {
            assert!(validate_repo_name(good).is_ok(), "{good}");
        }
    }

    #[test]
    fn remote_urls_must_point_at_github() {
        for bad in [
            "",
            "  ",
            "https://gitlab.com/o/r.git",
            "ssh://git@github.com/o/r",
            "nope",
        ] {
            assert!(valid_github_url(bad).is_err(), "{bad}");
        }
        assert_eq!(valid_github_url("https://github.com/o/r.git"), Ok(()));
        assert_eq!(valid_github_url("git@github.com:o/r.git"), Ok(()));
    }

    #[test]
    fn error_texts_are_kept_readable() {
        assert_eq!(truncate("short", 500), "short");
        let long = "ab".repeat(300);
        let cut = truncate(&long, 500);
        assert_eq!(cut.chars().count(), 500);
        assert!(!cut.contains('\u{fffd}'));
    }

    /// Both actions refuse a repository path that does not exist before any
    /// child process is involved, so the error is deterministic everywhere.
    #[test]
    fn create_and_link_refuse_a_missing_repository() {
        let dir = TempDir::new("gh-missing");
        let ghost = dir.path().join("nope").to_string_lossy().into_owned();

        let err = create_github_repo(&ghost, "fresh", true).expect_err("refused");
        assert!(err.contains("not a repository directory"), "{err}");

        let err = link_github_remote(&ghost, "https://github.com/o/r.git").expect_err("refused");
        assert!(err.contains("not a repository directory"), "{err}");
    }

    /// An existing origin blocks both actions - and that check runs before
    /// `gh` availability matters, so this test holds with or without it.
    #[test]
    fn an_existing_origin_blocks_create_and_link() {
        let dir = TempDir::new("gh-existing-origin");
        let repo = init_repo(&dir.path().join("repo"));
        let repo_path = repo.to_string_lossy().into_owned();

        Command::new("git")
            .arg("-C")
            .arg(&repo_path)
            .args(["remote", "add", "origin", "https://github.com/o/r.git"])
            .output()
            .expect("git remote add");

        let err = create_github_repo(&repo_path, "fresh", true).expect_err("refused");
        assert!(err.contains("remote 'origin' already exists"), "{err}");
        // A repository that already has an origin exists and is simply not
        // linkable a second time, so the refusal is worded as one: the API
        // reads this opening and answers 409 rather than 500.
        assert!(err.starts_with(crate::workers::ERR_REFUSED), "{err}");
        let err =
            link_github_remote(&repo_path, "https://github.com/o/r2.git").expect_err("refused");
        assert!(err.contains("remote 'origin' already exists"), "{err}");
        assert!(err.starts_with(crate::workers::ERR_REFUSED), "{err}");
    }

    #[test]
    fn linking_adds_a_real_origin_and_rejects_other_hosts() {
        let dir = TempDir::new("gh-link");
        let repo = init_repo(&dir.path().join("repo"));
        let repo_path = repo.to_string_lossy().into_owned();
        assert!(!has_github_remote(&repo_path));

        let err =
            link_github_remote(&repo_path, "https://gitlab.com/o/r.git").expect_err("refused");
        assert!(err.contains("unsupported github url"), "{err}");
        assert!(!has_github_remote(&repo_path));

        link_github_remote(&repo_path, " git@github.com:o/r.git ").expect("linked");
        assert!(has_github_remote(&repo_path));
    }

    #[test]
    fn the_merge_arguments_are_what_git_and_gh_are_actually_handed() {
        assert_eq!(
            build_push_args("C:/repos/a", "pa/wk-1"),
            vec!["-C", "C:/repos/a", "push", "-u", "origin", "pa/wk-1"]
        );
        assert_eq!(
            build_pr_create_args("pa/wk-1", "fix the flake", "body text"),
            vec![
                "pr",
                "create",
                "--head",
                "pa/wk-1",
                "--title",
                "fix the flake",
                "--body",
                "body text",
            ]
        );
        assert_eq!(
            build_pr_merge_args("pa/wk-1"),
            vec!["pr", "merge", "pa/wk-1", "--merge"]
        );
        assert_eq!(
            build_merge_args("C:/repos/a", "pa/wk-1"),
            vec!["-C", "C:/repos/a", "merge", "--no-ff", "pa/wk-1"]
        );
        assert_eq!(
            build_checkout_args("C:/repos/a", "main"),
            vec!["-C", "C:/repos/a", "checkout", "main"]
        );
    }

    #[test]
    fn the_pull_request_url_is_read_off_the_last_line_that_is_one() {
        assert_eq!(
            extract_pr_url("https://github.com/o/r/pull/7\n"),
            Some("https://github.com/o/r/pull/7".to_string())
        );
        // gh likes to explain itself first, and the url is what matters.
        assert_eq!(
            extract_pr_url(
                "Warning: 3 uncommitted changes\n\
                 Creating pull request for pa/wk-1 into main in o/r\n\n\
                 https://github.com/o/r/pull/12\n"
            ),
            Some("https://github.com/o/r/pull/12".to_string())
        );
        assert_eq!(extract_pr_url("https://github.com/o/r\nnope"), None);
        assert_eq!(extract_pr_url(""), None);
    }

    /// The three actions refuse a missing repository, an empty branch and -
    /// where gh is involved - a repository path that is not one, all before any
    /// child process is spawned. Deterministic with or without `gh` installed.
    #[test]
    fn merging_refuses_a_missing_repository_and_a_branchless_worker() {
        let dir = TempDir::new("gh-merge-guards");
        let ghost = dir.path().join("nope").to_string_lossy().into_owned();

        for err in [
            create_pr(&ghost, "", "t", "b").expect_err("no branch"),
            merge_pr(&ghost, "  ").expect_err("no branch"),
            merge_local(&ghost, "main", "").expect_err("no branch"),
        ] {
            assert!(err.contains("no branch"), "{err}");
        }

        for err in [
            create_pr(&ghost, "pa/wk-1", "t", "b").expect_err("missing repo"),
            merge_pr(&ghost, "pa/wk-1").expect_err("missing repo"),
            merge_local(&ghost, "main", "pa/wk-1").expect_err("missing repo"),
        ] {
            assert!(err.contains("not a repository directory"), "{err}");
        }
    }

    #[test]
    fn the_base_branch_falls_back_from_the_remote_head_to_main_then_master() {
        let dir = TempDir::new("gh-base-branch");
        let repo = init_repo(&dir.path().join("repo"));
        let repo_path = repo.to_string_lossy().into_owned();

        // `init_repo` checks out `main`, and there is no remote to ask.
        assert_eq!(default_base_branch(&repo_path), "main");

        // With `main` renamed away, `master` is the second convention.
        Command::new("git")
            .arg("-C")
            .arg(&repo_path)
            .args(["branch", "-m", "main", "master"])
            .output()
            .expect("git branch -m");
        assert_eq!(default_base_branch(&repo_path), "master");

        // A repository that is not one at all still yields a name.
        assert_eq!(
            default_base_branch(&dir.path().join("nope").to_string_lossy()),
            "main"
        );
    }

    /// The local merge against a real repository, the way `worktree.rs` tests
    /// its own git calls: a temp repo, a real branch, real commits.
    #[test]
    fn a_local_merge_brings_the_branch_into_the_base_branch() {
        let dir = TempDir::new("gh-merge-local");
        let repo = init_repo(&dir.path().join("repo"));
        let repo_path = repo.to_string_lossy().into_owned();
        let git = |args: &[&str]| {
            let out = Command::new("git")
                .arg("-C")
                .arg(&repo_path)
                .args(args)
                .output()
                .expect("run git");
            (
                out.status.success(),
                String::from_utf8_lossy(&out.stdout).trim().to_string(),
            )
        };

        // A worker branch with one commit on it, then back to the base branch.
        git(&["checkout", "-b", "pa/wk-1"]);
        std::fs::write(repo.join("worker.txt"), "from the worker\n").expect("write");
        git(&["add", "worker.txt"]);
        git(&["commit", "--no-gpg-sign", "-m", "worker work"]);
        git(&["checkout", "main"]);
        assert!(!repo.join("worker.txt").exists());

        merge_local(&repo_path, "main", "pa/wk-1").expect("merge");

        assert!(
            repo.join("worker.txt").is_file(),
            "the merge brought nothing"
        );
        assert_eq!(git(&["rev-parse", "--abbrev-ref", "HEAD"]).1, "main");
        // `--no-ff`, so the merge is a commit of its own with two parents.
        let (ok, parents) = git(&["rev-list", "--parents", "-n", "1", "HEAD"]);
        assert!(ok);
        assert_eq!(parents.split_whitespace().count(), 3, "{parents}");

        // Merging a branch that does not exist fails with git's own words.
        let err = merge_local(&repo_path, "main", "pa/wk-nope").expect_err("no such branch");
        assert!(err.contains("git merge failed"), "{err}");
        assert!(err.contains("pa/wk-nope"), "{err}");
    }

    /// A conflicting merge must come back as text, not as silence: the human
    /// reads git's own conflict report in the dialog.
    #[test]
    fn a_conflicting_merge_reports_what_git_said() {
        let dir = TempDir::new("gh-merge-conflict");
        let repo = init_repo(&dir.path().join("repo"));
        let repo_path = repo.to_string_lossy().into_owned();
        let git = |args: &[&str]| {
            Command::new("git")
                .arg("-C")
                .arg(&repo_path)
                .args(args)
                .output()
                .expect("run git");
        };

        std::fs::write(repo.join("shared.txt"), "base\n").expect("write");
        git(&["add", "shared.txt"]);
        git(&["commit", "--no-gpg-sign", "-m", "base"]);

        git(&["checkout", "-b", "pa/wk-1"]);
        std::fs::write(repo.join("shared.txt"), "worker\n").expect("write");
        git(&["commit", "--no-gpg-sign", "-am", "worker"]);

        git(&["checkout", "main"]);
        std::fs::write(repo.join("shared.txt"), "human\n").expect("write");
        git(&["commit", "--no-gpg-sign", "-am", "human"]);

        let err = merge_local(&repo_path, "main", "pa/wk-1").expect_err("conflict");
        assert!(err.contains("git merge failed"), "{err}");
        // git writes the conflict itself to stdout; it has to survive.
        assert!(err.to_lowercase().contains("conflict"), "{err}");

        // Leave the repository in a state the next test would not trip over.
        git(&["merge", "--abort"]);
    }
}
