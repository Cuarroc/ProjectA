//! Git worktree management, driven through the `git` CLI.
//!
//! Every worker gets its own checkout so parallel agents never fight over one
//! working tree. The layout is fixed by convention:
//!
//! * branch:   `pa/<worker_id>`
//! * worktree: `<repo-parent>/.projecta-worktrees/<worker_id>`
//!
//! Git failures are surfaced verbatim: whatever `git` wrote to stderr becomes
//! the error string, because git already explains these failures better than a
//! wrapper could.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

mod rewind_plan;
use rewind_plan::ref_name_gueltig as is_valid_ref_name;

/// Directory holding all worktrees, created next to the repository.
pub const WORKTREES_DIR: &str = ".projecta-worktrees";

/// Branch created for a worker.
pub fn branch_for(worker_id: &str) -> String {
    format!("pa/{worker_id}")
}

/// Where a worker's worktree lives: `<repo-parent>/.projecta-worktrees/<id>`.
///
/// Both separators are honoured on every platform: the path is handed back to
/// the machine it came from, so a Windows spelling has to resolve to the
/// right parent even when this process runs somewhere else.
pub fn worktree_path(repo_path: &str, worker_id: &str) -> Result<PathBuf, String> {
    let trimmed = repo_path.trim_end_matches(['/', '\\']);
    let repo = Path::new(if trimmed.is_empty() {
        repo_path
    } else {
        trimmed
    });
    let parent = repo
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(PathBuf::from)
        // A Windows spelling (`C:\repos\projecta`) is a single component to a
        // platform whose separator is `/`, so `parent()` comes back empty and
        // the string itself is split. Only a fallback: where `Path` reads
        // both separators it has already answered.
        .or_else(|| {
            let sep = trimmed.rfind(['/', '\\']).filter(|&i| i > 0)?;
            Some(PathBuf::from(&trimmed[..sep]))
        })
        .ok_or_else(|| format!("repository has no parent directory: {repo_path}"))?;
    Ok(parent.join(WORKTREES_DIR).join(worker_id))
}

/// Fail unless `repo_path` is a directory inside a git work tree.
pub fn ensure_git_repo(repo_path: &str) -> Result<(), String> {
    let repo = Path::new(repo_path);
    if !repo.is_dir() {
        return Err(format!("not a directory: {repo_path}"));
    }
    let out = git([
        OsStr::new("-C"),
        repo.as_os_str(),
        OsStr::new("rev-parse"),
        OsStr::new("--is-inside-work-tree"),
    ])?;
    if out.trim() == "true" {
        Ok(())
    } else {
        Err(format!("not a git work tree: {repo_path}"))
    }
}

/// Create `pa/<worker_id>` and check it out at the conventional worktree path.
///
/// Returns the worktree path. Fails verbatim if the branch or path already
/// exists, which is the intended behaviour: worker ids are unique, so a clash
/// means something outside ProjectA is using the name.
pub fn add_worktree(repo_path: &str, worker_id: &str) -> Result<PathBuf, String> {
    let path = worktree_path(repo_path, worker_id)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }
    git([
        OsString::from("-C"),
        OsString::from(repo_path),
        OsString::from("worktree"),
        OsString::from("add"),
        path.clone().into_os_string(),
        OsString::from("-b"),
        OsString::from(branch_for(worker_id)),
    ])?;
    Ok(path)
}

/// Pin `HEAD^{commit}` at `refs/projecta/checkpoints/<run>/<step>`.
///
/// Requires Git 2.29+ for `rev-parse --show-object-format` (SHA-1 and SHA-256).
/// Identifiers are single ref components using the rewind planner's validation.
/// The reference must be absent, even when an existing checkpoint has the same
/// commit. HEAD, index and working files are untouched; dirty work is not saved.
#[cfg_attr(
    not(test),
    expect(dead_code, reason = "V2-B8b: step integration follows")
)]
pub fn checkpoint(worktree: &str, run: &str, step: &str) -> Result<String, String> {
    for (label, id) in [("run", run), ("step", step)] {
        if id.contains('/') || !is_valid_ref_name(id) {
            return Err(format!("invalid checkpoint {label} identifier: {id:?}"));
        }
    }
    let reference = format!("refs/projecta/checkpoints/{run}/{step}");
    ensure_git_repo(worktree)?;
    let format = git(["-C", worktree, "rev-parse", "--show-object-format"])?;
    let oid_len = match format.trim() {
        "sha1" => 40,
        "sha256" => 64,
        other => return Err(format!("unsupported repository object format: {other}")),
    };
    let head = git(["-C", worktree, "rev-parse", "--verify", "HEAD^{commit}"])?;
    let oid = head.trim();
    if oid.len() != oid_len || !oid.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("git returned an invalid HEAD commit ID".to_owned());
    }
    // Compare-and-create under git's ref lock; never follow a symbolic ref.
    // Reflogs may be enabled for all refs; never require a user's identity.
    git_output(
        crate::proc::command("git")
            .env("GIT_COMMITTER_NAME", "ProjectA")
            .env("GIT_COMMITTER_EMAIL", "noreply@projecta.local")
            .args([
                "-C",
                worktree,
                "update-ref",
                "--no-deref",
                &reference,
                oid,
                &"0".repeat(oid_len),
            ]),
    )?;
    Ok(oid.to_owned())
}

/// Remove a worktree and its checkout directory. The branch is left alone.
pub fn remove_worktree(repo_path: &str, worktree_path: &Path) -> Result<(), String> {
    git([
        OsString::from("-C"),
        OsString::from(repo_path),
        OsString::from("worktree"),
        OsString::from("remove"),
        OsString::from("--force"),
        worktree_path.to_path_buf().into_os_string(),
    ])?;
    Ok(())
}

/// Undo a failed [`add_worktree`], including the branch it created.
pub fn rollback_worktree(
    repo_path: &str,
    worktree_path: &Path,
    checkout_id: &str,
) -> Result<(), String> {
    remove_worktree(repo_path, worktree_path)?;
    git([
        OsStr::new("-C"),
        OsStr::new(repo_path),
        OsStr::new("branch"),
        OsStr::new("-D"),
        OsStr::new(&branch_for(checkout_id)),
    ])?;
    Ok(())
}

/// Run `git` and return its stdout, or its stderr verbatim as the error.
fn git<I, S>(args: I) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    // Worktree creation and rollback must not depend on user reflog identity.
    git_output(
        crate::proc::command("git")
            .env("GIT_COMMITTER_NAME", "ProjectA")
            .env("GIT_COMMITTER_EMAIL", "noreply@projecta.local")
            .args(args),
    )
}

fn git_output(command: &mut std::process::Command) -> Result<String, String> {
    let output = command
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return Err(stderr);
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        return Err(stdout);
    }
    Err(format!("git exited with {}", output.status))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{init_repo, TempDir};

    // Independent git observations; do not use the production runner as the oracle.
    fn checkpoint_git(repo: &Path, args: &[&str]) -> Vec<u8> {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
            .expect("run fixture git");
        assert!(output.status.success(), "{:?}", output);
        output.stdout
    }

    fn checkpoint_oid(repo: &Path, revision: &str) -> String {
        String::from_utf8(checkpoint_git(repo, &["rev-parse", "--verify", revision]))
            .unwrap()
            .trim()
            .to_owned()
    }

    #[test]
    fn worktree_refs_without_committer_identity() {
        const CHILD_REPO: &str = "PROJECTA_WORKTREE_IDENTITY_TEST_REPO";
        if let Some(repo) = std::env::var_os(CHILD_REPO) {
            let repo = Path::new(&repo);
            let tree = add_worktree(&repo.to_string_lossy(), "identity-worker").unwrap();
            for (path, reference) in [(repo, "refs/heads/pa/identity-worker"), (&*tree, "HEAD")] {
                let reflog =
                    checkpoint_git(path, &["reflog", "show", "--format=%gn <%ge>", reference]);
                let reflog = String::from_utf8(reflog).unwrap();
                assert!(!reflog.is_empty());
                assert!(
                    reflog
                        .lines()
                        .all(|line| line == "ProjectA <noreply@projecta.local>"),
                    "{reflog}"
                );
            }
            rollback_worktree(&repo.to_string_lossy(), &tree, "identity-worker").unwrap();
            assert!(!tree.exists());
            assert!(
                checkpoint_git(repo, &["for-each-ref", "refs/heads/pa/identity-worker"]).is_empty()
            );
            return;
        }
        let dir = TempDir::new("worktree-identity");
        let repo = init_repo(&dir.path().join("repo"));
        for key in ["user.name", "user.email"] {
            checkpoint_git(&repo, &["config", key, ""]);
        }
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "worktree::tests::worktree_refs_without_committer_identity",
                "--nocapture",
            ])
            .env(CHILD_REPO, &repo)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", dir.path().join("missing-config"))
            .env("GIT_AUTHOR_NAME", "")
            .env("GIT_AUTHOR_EMAIL", "")
            .env("GIT_COMMITTER_NAME", "")
            .env("GIT_COMMITTER_EMAIL", "")
            .env("EMAIL", "")
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("1 passed"),
            "{output:?}"
        );
    }

    #[test]
    fn checkpoint_writes_reflog_without_committer_identity() {
        let version = String::from_utf8(checkpoint_git(Path::new("."), &["--version"])).unwrap();
        let mut parts = version.trim_start_matches("git version ").split('.');
        let major: u32 = parts.next().unwrap().parse().unwrap();
        let minor: u32 = parts.next().unwrap().parse().unwrap();
        if (major, minor) < (2, 32) {
            eprintln!("Skipping checkpoint identity test: Git 2.32+ required for GIT_CONFIG_GLOBAL isolation; found {version}");
            return;
        }
        const CHILD_REPO: &str = "PROJECTA_CHECKPOINT_IDENTITY_TEST_REPO";
        if let Some(repo) = std::env::var_os(CHILD_REPO) {
            checkpoint(&repo.to_string_lossy(), "run-1", "step-1").unwrap();
            return;
        }
        let dir = TempDir::new("checkpoint-identity");
        let repo = init_repo(&dir.path().join("repo"));
        checkpoint_git(&repo, &["config", "core.logAllRefUpdates", "always"]);
        for key in ["user.name", "user.email"] {
            checkpoint_git(&repo, &["config", key, ""]);
        }
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "worktree::tests::checkpoint_writes_reflog_without_committer_identity",
                "--nocapture",
            ])
            .env(CHILD_REPO, &repo)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", dir.path().join("missing-config"))
            .env("GIT_AUTHOR_NAME", "")
            .env("GIT_AUTHOR_EMAIL", "")
            .env("GIT_COMMITTER_NAME", "")
            .env("GIT_COMMITTER_EMAIL", "")
            .env("EMAIL", "")
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        let reference = "refs/projecta/checkpoints/run-1/step-1";
        assert_eq!(
            checkpoint_oid(&repo, reference),
            checkpoint_oid(&repo, "HEAD")
        );
        assert_eq!(
            checkpoint_git(&repo, &["reflog", "show", "--format=%gn <%ge>", reference]),
            b"ProjectA <noreply@projecta.local>\n"
        );
    }

    #[test]
    fn checkpoint_validation_error_names_rejected_value() {
        let dir = TempDir::new("checkpoint-invalid-values");
        let repo = init_repo(&dir.path().join("repo"));
        for invalid in [
            "", "a/b", "..", "a..b", ".hidden", "x.lock", "a.", "a b", "a\tb", "a\nb", "a\0b",
            "a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b", "a@{b",
        ] {
            for (label, run, step) in [("run", invalid, "1"), ("step", "run-1", invalid)] {
                assert_eq!(
                    checkpoint(&repo.to_string_lossy(), run, step).unwrap_err(),
                    format!("invalid checkpoint {label} identifier: {invalid:?}")
                );
            }
        }
        assert!(checkpoint_git(&repo, &["for-each-ref", "refs/projecta/checkpoints/"]).is_empty());
    }

    fn checkpoint_snapshot(tree: &Path) -> Vec<Vec<u8>> {
        let mut snapshot = vec![checkpoint_git(tree, &["status", "--porcelain=v1", "-z"])];
        for name in ["index", "HEAD"] {
            let path = String::from_utf8(checkpoint_git(tree, &["rev-parse", "--git-path", name]))
                .unwrap();
            snapshot.push(std::fs::read(tree.join(path.trim())).unwrap());
        }
        for name in ["tracked", "untracked"] {
            snapshot.push(std::fs::read(tree.join(name)).unwrap());
        }
        snapshot
    }

    #[test]
    fn checkpoint_records_head_without_changing_worktree() {
        let version = String::from_utf8(checkpoint_git(Path::new("."), &["--version"])).unwrap();
        let mut parts = version.trim_start_matches("git version ").split('.');
        let major: u32 = parts.next().unwrap().parse().unwrap();
        let minor: u32 = parts.next().unwrap().parse().unwrap();
        if (major, minor) < (2, 29) {
            eprintln!(
                "Skipping SHA-1/SHA-256 checkpoint test: Git 2.29+ required; found {version}"
            );
            return;
        }
        for format in ["sha1", "sha256"] {
            let dir = TempDir::new("checkpoint-preserve");
            let repo = dir.path().join("repo");
            std::fs::create_dir_all(&repo).unwrap();
            checkpoint_git(&repo, &["init", &format!("--object-format={format}")]);
            init_repo(&repo);
            std::fs::write(repo.join("tracked"), b"committed\n").unwrap();
            checkpoint_git(&repo, &["add", "tracked"]);
            checkpoint_git(&repo, &["commit", "--no-gpg-sign", "-m", "tracked"]);
            let tree = add_worktree(&repo.to_string_lossy(), "checkpoint-worker").unwrap();
            std::fs::write(tree.join("tracked"), b"staged\n").unwrap();
            checkpoint_git(&tree, &["add", "tracked"]);
            std::fs::write(tree.join("tracked"), b"unstaged\0bytes\n").unwrap();
            std::fs::write(tree.join("untracked"), b"untracked\0bytes\n").unwrap();
            let head = checkpoint_oid(&tree, "HEAD^{commit}");
            let before = checkpoint_snapshot(&tree);

            let oid = checkpoint(&tree.to_string_lossy(), "run-1", "step-1").unwrap();

            assert_eq!(oid, head);
            assert_eq!(head.len(), if format == "sha1" { 40 } else { 64 });
            assert_eq!(
                checkpoint_oid(&repo, "refs/projecta/checkpoints/run-1/step-1"),
                head
            );
            assert_eq!(checkpoint_oid(&tree, "HEAD^{commit}"), head);
            assert_eq!(checkpoint_snapshot(&tree), before);
        }
    }

    #[test]
    fn checkpoint_ref_collision_preserves_the_first_commit() {
        let dir = TempDir::new("checkpoint-collision");
        let repo = init_repo(&dir.path().join("repo"));
        let path = repo.to_string_lossy();
        let first = checkpoint_oid(&repo, "HEAD^{commit}");
        checkpoint(&path, "run-1", "1").unwrap();
        checkpoint_git(
            &repo,
            &["commit", "--allow-empty", "--no-gpg-sign", "-m", "advance"],
        );
        let second = checkpoint_oid(&repo, "HEAD^{commit}");
        assert_ne!(first, second);

        assert!(
            checkpoint(&path, "run-1", "1").is_err(),
            "occupied ref must fail"
        );
        assert_eq!(
            checkpoint_oid(&repo, "refs/projecta/checkpoints/run-1/1"),
            first
        );
        assert_eq!(checkpoint_oid(&repo, "HEAD^{commit}"), second);
        assert_eq!(checkpoint(&path, "run-1", "2").unwrap(), second);
        assert_eq!(
            checkpoint_oid(&repo, "refs/projecta/checkpoints/run-1/2"),
            second
        );
        assert!(
            checkpoint(&path, "run-1", "2").is_err(),
            "same OID is still a collision"
        );
        checkpoint_git(&repo, &["pack-refs", "--all"]);
        assert!(
            checkpoint(&path, "run-1", "1").is_err(),
            "packed ref must fail"
        );
        assert_eq!(
            checkpoint_oid(&repo, "refs/projecta/checkpoints/run-1/1"),
            first
        );
        for target in ["refs/heads/missing", "HEAD"] {
            let reference = "refs/projecta/checkpoints/run-1/symbolic";
            checkpoint_git(&repo, &["symbolic-ref", reference, target]);
            assert!(checkpoint(&path, "run-1", "symbolic").is_err());
            assert_eq!(
                checkpoint_git(&repo, &["symbolic-ref", "--no-recurse", reference]),
                format!("{target}\n").as_bytes()
            );
            assert_eq!(checkpoint_oid(&repo, "HEAD^{commit}"), second);
        }
    }

    #[test]
    fn checkpoint_rejects_invalid_identity_and_unborn_head() {
        let dir = TempDir::new("checkpoint-invalid");
        let repo = init_repo(&dir.path().join("repo"));
        let path = repo.to_string_lossy();
        // Option-looking components are names below the fixed namespace, never git flags.
        let head = checkpoint_oid(&repo, "HEAD^{commit}");
        assert_eq!(checkpoint(&path, "--help", "--delete").unwrap(), head);
        assert_eq!(
            checkpoint_oid(&repo, "refs/projecta/checkpoints/--help/--delete"),
            head
        );
        let unborn = dir.path().join("unborn");
        std::fs::create_dir_all(&unborn).unwrap();
        checkpoint_git(&unborn, &["init"]);
        assert!(checkpoint(&unborn.to_string_lossy(), "run-1", "1").is_err());
        assert!(checkpoint_git(&unborn, &["for-each-ref"]).is_empty());
        assert!(checkpoint(&dir.path().to_string_lossy(), "run-1", "1").is_err());
        // A real update-ref failure (namespace conflict) must propagate.
        checkpoint_git(
            &repo,
            &["update-ref", "refs/projecta/checkpoints/blocked", &head],
        );
        assert!(checkpoint(&path, "blocked", "1").is_err());
        assert_eq!(
            checkpoint_oid(&repo, "refs/projecta/checkpoints/blocked"),
            head
        );
    }

    #[test]
    fn paths_and_branches_follow_the_convention() {
        assert_eq!(branch_for("wk-1"), "pa/wk-1");

        let path = worktree_path("C:/repos/projecta", "wk-1").unwrap();
        assert!(path.ends_with(Path::new(WORKTREES_DIR).join("wk-1")));
        assert_eq!(
            path.parent().unwrap().parent().unwrap(),
            Path::new("C:/repos")
        );

        // A trailing separator must not shift the parent directory.
        assert_eq!(worktree_path("C:/repos/projecta/", "wk-1").unwrap(), path);
    }

    #[test]
    #[cfg(not(windows))]
    fn a_linux_path_test_does_not_validate_windows_backslashes() {
        let path = worktree_path(r"C:\repos\projecta", "wk-1")
            .expect("a genuine Windows spelling should have a parent");
        assert_eq!(
            path,
            Path::new(r"C:\repos").join(WORKTREES_DIR).join("wk-1")
        );
    }

    #[test]
    fn adds_and_removes_a_worktree() {
        let dir = TempDir::new("worktree");
        let repo = init_repo(&dir.path().join("repo"));
        let repo_path = repo.to_string_lossy().into_owned();

        let path = add_worktree(&repo_path, "wk-1").expect("worktree add");
        assert!(path.is_dir(), "{} should exist", path.display());
        assert_eq!(path, dir.path().join(WORKTREES_DIR).join("wk-1"));

        let branches = git([
            OsStr::new("-C"),
            repo.as_os_str(),
            OsStr::new("branch"),
            OsStr::new("--list"),
            OsStr::new("pa/wk-1"),
        ])
        .expect("branch list");
        assert!(
            branches.contains("pa/wk-1"),
            "unexpected branches: {branches}"
        );

        remove_worktree(&repo_path, &path).expect("worktree remove");
        assert!(!path.exists(), "{} should be gone", path.display());
    }

    #[test]
    fn a_second_worktree_for_the_same_id_fails_with_the_git_error() {
        let dir = TempDir::new("worktree-dup");
        let repo = init_repo(&dir.path().join("repo"));
        let repo_path = repo.to_string_lossy().into_owned();

        add_worktree(&repo_path, "wk-1").expect("first worktree");
        let err = add_worktree(&repo_path, "wk-1").expect_err("duplicate must fail");
        assert!(!err.is_empty(), "git error was swallowed");
    }

    #[test]
    fn ensure_git_repo_rejects_a_plain_directory() {
        let dir = TempDir::new("not-a-repo");
        let plain = dir.path().join("plain");
        std::fs::create_dir_all(&plain).expect("mkdir");
        assert!(ensure_git_repo(&plain.to_string_lossy()).is_err());
        assert!(ensure_git_repo(&dir.path().join("missing").to_string_lossy()).is_err());
    }

    #[test]
    fn ensure_git_repo_accepts_a_real_repo() {
        let dir = TempDir::new("real-repo");
        let repo = init_repo(&dir.path().join("repo"));
        ensure_git_repo(&repo.to_string_lossy()).expect("repo should validate");
    }
}
