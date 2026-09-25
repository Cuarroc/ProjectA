//! Worker diffs and line comments (Phase 5).
//!
//! What a worker actually produced is the diff between the project's default
//! branch and the tip of the worker's own branch, read out of the worker's
//! worktree through the `git` CLI - the same approach [`crate::worktree`] takes,
//! and for the same reason: git already knows this better than a library would,
//! and its errors are already better than a wrapper's.
//!
//! The unified diff `git` prints is parsed here into a typed structure the
//! frontend can render line by line, because a review needs to attach a comment
//! to *one* line. [`parse_unified_diff`] is deliberately a pure function over a
//! string: it is the piece with all the edge cases (renames, new and deleted
//! files, binary blobs, mode-only changes) and none of the I/O.
//!
//! A comment is stored and then written straight into the agent's terminal, so
//! reviewing a worker and telling it what to fix are the same gesture. If the
//! agent is gone the comment is still kept, marked as not yet delivered.

use std::ffi::OsStr;
use std::path::Path;

use serde::Serialize;

use crate::store::{self, DiffComment, Store, Worker, KIND_ORCHESTRATOR, MSG_USER};
use crate::workers;

/// A line that exists only on the new side.
pub const LINE_ADD: &str = "add";
/// A line that exists only on the old side.
pub const LINE_DEL: &str = "del";
/// A line both sides share.
pub const LINE_CONTEXT: &str = "context";

/// What `get_worker_diff` returns.
///
/// Serialized as `{ "baseBranch", "files", "stat", "code" }`, where `stat` is
/// `git diff --stat` verbatim - a summary worth showing above the files rather
/// than recomputing from them. `code` is the merge-tree tuple of the same
/// snapshot the diff lines come from: the review verdict binds to it, so the
/// panel can never approve code it is not showing. `None` when git cannot
/// measure (conflict, missing git) - then there is nothing to bind to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerDiff {
    pub base_branch: String,
    pub files: Vec<DiffFile>,
    pub stat: String,
    pub code: Option<crate::readiness::CodeTuple>,
}

/// One file in a diff.
///
/// Serialized as `{ "path", "oldPath", "additions", "deletions", "binary",
/// "hunks" }`. `oldPath` is set only when the file moved; `binary` files carry
/// no hunks, because git does not print any for them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFile {
    pub path: String,
    pub old_path: Option<String>,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
    pub hunks: Vec<DiffHunk>,
}

/// One `@@ ... @@` block.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    /// The `@@` line verbatim, section heading and all.
    pub header: String,
    pub lines: Vec<DiffLine>,
}

/// One line inside a hunk.
///
/// `oldLine` and `newLine` are the 1-based numbers the line has on each side;
/// an added line has no old number and a deleted line has no new one. A review
/// comment is anchored on `newLine` where there is one, which is why both are
/// carried rather than a single number.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    /// [`LINE_ADD`], [`LINE_DEL`] or [`LINE_CONTEXT`].
    pub kind: String,
    /// The line without its leading `+`, `-` or space.
    pub content: String,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
}

/// Anything that can put text in front of a running agent. In the app this is
/// the Phase 1 `PtyManager`; in tests it is a fake that records the writes.
pub trait AgentInput: Sync {
    /// Write `text` to the agent attached to `session_id`.
    fn send(&self, session_id: &str, text: &str) -> Result<(), String>;
}

/// The error a worker without a checkout of its own comes back with.
///
/// Orchestrators run in the repository root and never branch, so there is no
/// "their work" to diff - and that is a normal state, not a failure worth a
/// stack of detail.
pub const NO_WORKTREE: &str = "no worktree";

// -- reading the diff ------------------------------------------------------

/// The worktree to diff, or [`NO_WORKTREE`].
pub fn worktree_of(worker: &Worker) -> Result<&str, String> {
    if worker.kind == KIND_ORCHESTRATOR
        || worker.branch.trim().is_empty()
        || worker.worktree_path.trim().is_empty()
    {
        return Err(NO_WORKTREE.to_string());
    }
    Ok(&worker.worktree_path)
}

/// Everything `get_worker_diff` needs, given a worker's repository and checkout.
///
/// `<base>...HEAD` - three dots - is the diff against the point the branch was
/// cut from, so work that landed on the base branch afterwards does not show up
/// as the worker's doing. Only committed work is included, which is what makes
/// the answer stable enough to comment on.
///
/// The base is the merge path's base (`gh::default_base_branch`), and both it
/// and `HEAD` are pinned to SHAs before anything is read: every git call below
/// works on exactly these object ids, so the diff lines and the merge-tree
/// tuple always come from one and the same snapshot (review r5, TOCTOU).
pub fn worker_diff(repo_path: &str, worktree_path: &str) -> Result<WorkerDiff, String> {
    let base_branch = crate::gh::default_base_branch(repo_path);
    let base_sha = git(worktree_path, ["rev-parse", &base_branch])?;
    let base_sha = base_sha.trim().to_string();
    let worker_sha = git(worktree_path, ["rev-parse", "HEAD"])?;
    let worker_sha = worker_sha.trim().to_string();
    let range = format!("{base_sha}...{worker_sha}");
    let stat = git(worktree_path, ["diff", "--stat", &range])?;
    let raw = git(worktree_path, ["diff", &range])?;
    // The tuple of this exact snapshot: the review verdict binds to it, so
    // what the panel shows and what it approves can never drift apart.
    // Unmeasurable code (conflict, missing git) stays None — the panel then
    // has nothing to bind a verdict to, which is the honest answer too.
    let code =
        crate::readiness::measure_code(std::path::Path::new(worktree_path), &base_sha, &worker_sha)
            .ok();
    Ok(WorkerDiff {
        base_branch,
        files: parse_unified_diff(&raw),
        stat: stat.trim_end().to_string(),
        code,
    })
}

// -- parsing ---------------------------------------------------------------

/// Turn `git diff` output into files, hunks and numbered lines.
///
/// Lenient by design: anything that is not recognised is skipped rather than
/// rejected, because the alternative - a review view that shows nothing because
/// one exotic header was unexpected - is worse than a slightly incomplete one.
/// An empty diff parses to an empty list.
pub fn parse_unified_diff(raw: &str) -> Vec<DiffFile> {
    let mut files: Vec<DiffFile> = Vec::new();
    // Line numbers of the hunk currently being read.
    let mut old_no = 0u32;
    let mut new_no = 0u32;
    let mut in_hunk = false;

    for line in raw.lines() {
        if let Some(header) = line.strip_prefix("diff --git ") {
            let (old, new) = split_diff_git_paths(header);
            files.push(DiffFile {
                path: new.or_else(|| old.clone()).unwrap_or_default(),
                old_path: None,
                additions: 0,
                deletions: 0,
                binary: false,
                hunks: Vec::new(),
            });
            in_hunk = false;
            continue;
        }

        // Anything before the first `diff --git` (a `git log -p` preamble, say)
        // belongs to no file and is dropped.
        let Some(file) = files.last_mut() else {
            continue;
        };

        if line.starts_with("@@") {
            let (old_start, new_start) = parse_hunk_header(line).unwrap_or((1, 1));
            old_no = old_start;
            new_no = new_start;
            in_hunk = true;
            file.hunks.push(DiffHunk {
                header: line.to_string(),
                lines: Vec::new(),
            });
            continue;
        }

        if !in_hunk {
            read_file_header(file, line);
            continue;
        }

        // Inside a hunk. The next `diff --git` ended it above.
        let Some(hunk) = file.hunks.last_mut() else {
            continue;
        };
        match line.chars().next() {
            Some('+') => {
                hunk.lines.push(DiffLine {
                    kind: LINE_ADD.to_string(),
                    content: line[1..].to_string(),
                    old_line: None,
                    new_line: Some(new_no),
                });
                file.additions += 1;
                new_no += 1;
            }
            Some('-') => {
                hunk.lines.push(DiffLine {
                    kind: LINE_DEL.to_string(),
                    content: line[1..].to_string(),
                    old_line: Some(old_no),
                    new_line: None,
                });
                file.deletions += 1;
                old_no += 1;
            }
            // "\ No newline at end of file" annotates the line before it and is
            // not a line of either side.
            Some('\\') => {}
            // A context line, including the empty one git writes for a blank
            // line whose leading space some tools strip.
            first => {
                let content = match first {
                    Some(' ') => line[1..].to_string(),
                    _ => line.to_string(),
                };
                hunk.lines.push(DiffLine {
                    kind: LINE_CONTEXT.to_string(),
                    content,
                    old_line: Some(old_no),
                    new_line: Some(new_no),
                });
                old_no += 1;
                new_no += 1;
            }
        }
    }

    files
}

/// The header lines between `diff --git` and the first hunk: they carry the
/// rename, the real paths, and whether the file is binary at all.
fn read_file_header(file: &mut DiffFile, line: &str) {
    if let Some(from) = line.strip_prefix("rename from ") {
        file.old_path = Some(from.to_string());
    } else if let Some(to) = line.strip_prefix("rename to ") {
        file.path = to.to_string();
    } else if let Some(from) = line.strip_prefix("copy from ") {
        file.old_path = Some(from.to_string());
    } else if let Some(to) = line.strip_prefix("copy to ") {
        file.path = to.to_string();
    } else if let Some(path) = line.strip_prefix("--- ") {
        if let Some(path) = strip_side_prefix(path, 'a') {
            // `--- a/x` is authoritative for the old side, but a rename has
            // already said it more precisely.
            if file.old_path.is_none() {
                file.old_path = Some(path);
            }
        }
    } else if let Some(path) = line.strip_prefix("+++ ") {
        if let Some(path) = strip_side_prefix(path, 'b') {
            file.path = path;
        }
    } else if line.starts_with("Binary files ") || line.starts_with("GIT binary patch") {
        file.binary = true;
    }

    // `--- a/x` on an unchanged path is not a rename; only keep `oldPath` when
    // the file actually moved.
    if file.old_path.as_deref() == Some(file.path.as_str()) {
        file.old_path = None;
    }
}

/// `a/src/main.rs` -> `src/main.rs`; `/dev/null` and anything else -> `None`.
///
/// git quotes paths that contain control characters or non-ASCII bytes; the
/// quotes are dropped so the frontend gets something it can match against a
/// repository path, and the escapes inside are left as git wrote them.
fn strip_side_prefix(path: &str, side: char) -> Option<String> {
    let path = path.trim_end();
    if path == "/dev/null" {
        return None;
    }
    let unquoted = path
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .unwrap_or(path);
    unquoted
        .strip_prefix(side)
        .and_then(|rest| rest.strip_prefix('/'))
        .map(str::to_string)
}

/// Split `a/old b/new` out of a `diff --git` header.
///
/// Paths may contain spaces, which makes this genuinely ambiguous, so the
/// common case - both sides naming the same file - is matched first and the
/// first plausible split is the fallback. The `---` / `+++` lines correct
/// whatever this got wrong; only a binary file, which has none, relies on it.
fn split_diff_git_paths(header: &str) -> (Option<String>, Option<String>) {
    let header = header.trim_end();
    let mut fallback = None;
    for (index, _) in header.match_indices(" b/") {
        let old = strip_side_prefix(&header[..index], 'a');
        let new = strip_side_prefix(&header[index + 1..], 'b');
        if old.is_some() && old == new {
            return (old, new);
        }
        if fallback.is_none() && (old.is_some() || new.is_some()) {
            fallback = Some((old, new));
        }
    }
    fallback.unwrap_or((None, None))
}

/// `@@ -12,7 +12,9 @@ fn thing()` -> `(12, 12)`.
fn parse_hunk_header(line: &str) -> Option<(u32, u32)> {
    let inner = line.strip_prefix("@@ ")?;
    let inner = inner.split(" @@").next()?;
    let mut sides = inner.split_whitespace();
    let old = parse_hunk_side(sides.next()?, '-')?;
    let new = parse_hunk_side(sides.next()?, '+')?;
    Some((old, new))
}

/// `-12,7` -> `12`. An empty side (`-0,0`) starts at 1, which is where git puts
/// the first line it would write.
fn parse_hunk_side(side: &str, sign: char) -> Option<u32> {
    let digits = side.strip_prefix(sign)?;
    let start: u32 = digits.split(',').next()?.parse().ok()?;
    Some(start.max(1))
}

// -- comments --------------------------------------------------------------

/// How a review comment reaches the agent.
pub fn comment_message(file: &str, line: i64, body: &str) -> String {
    format!("\n[Review-Kommentar zu {file}:{line}] {body}\n")
}

/// Store a comment and hand it to the worker's agent.
///
/// The comment is written to the database *before* the terminal, and stays
/// there whatever the terminal does: an agent that has exited is a normal end
/// state, and the comment is simply marked as undelivered so the user can see
/// that it never arrived.
pub async fn add_comment(
    store: &Store,
    input: &dyn AgentInput,
    worker_id: &str,
    file: &str,
    line: i64,
    body: &str,
) -> Result<DiffComment, String> {
    let body = body.trim();
    if body.is_empty() {
        return Err("a review comment needs a body".to_string());
    }
    store
        .get_worker(worker_id)
        .await?
        .ok_or_else(|| format!("unknown worker: {worker_id}"))?;

    let mut comment = DiffComment {
        id: store::new_id("dc"),
        worker_id: worker_id.to_string(),
        file: file.to_string(),
        line,
        body: body.to_string(),
        sent_to_agent: false,
        created_at: store::now_unix_secs(),
        disposition: store::COMMENT_OPEN.to_string(),
    };
    store.insert_diff_comment(&comment).await?;

    if let Some(session_id) = store.session_for_worker(worker_id) {
        if input
            .send(&session_id, &comment_message(file, line, body))
            .is_ok()
        {
            store.set_diff_comment_sent(&comment.id).await?;
            comment.sent_to_agent = true;
            workers::log_message(
                store,
                worker_id,
                MSG_USER,
                &comment_message(file, line, body),
            );
        }
    }
    Ok(comment)
}

/// Drop a comment the agent has not seen yet.
///
/// A delivered comment is part of the conversation the agent is having, so
/// removing it would only make the record disagree with the terminal.
pub async fn delete_comment(store: &Store, id: &str) -> Result<(), String> {
    let comment = store
        .get_diff_comment(id)
        .await?
        .ok_or_else(|| format!("unknown comment: {id}"))?;
    if comment.sent_to_agent {
        return Err(format!("comment {id} was already sent to the agent"));
    }
    store.delete_diff_comment(id).await
}

// -- talking to git --------------------------------------------------------

/// Run `git -C <cwd> <args>` and return its stdout, or its stderr verbatim.
fn git<I, S>(cwd: &str, args: I) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    if !Path::new(cwd).is_dir() {
        return Err(format!("not a directory: {cwd}"));
    }
    let output = crate::proc::command("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        // The reviewed diff reads the real objects — never a planted
        // refs/replace/* substitution: proc::command pins
        // GIT_NO_REPLACE_OBJECTS centrally (review-F4-r24/r25, Opus Fund 1).
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return Err(stderr);
    }
    Err(format!("git exited with {}", output.status))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{WorkerRow, KIND_WORKER, STATUS_RUNNING};
    use crate::testutil::{init_repo, TempDir};
    use crate::worktree;
    use std::sync::Mutex;

    // -- parser ------------------------------------------------------------

    #[test]
    fn an_empty_diff_parses_to_nothing() {
        assert!(parse_unified_diff("").is_empty());
        assert!(parse_unified_diff("\n").is_empty());
    }

    #[test]
    fn parses_a_multi_file_diff_with_line_numbers() {
        let raw = "\
diff --git a/src/one.rs b/src/one.rs
index 1111111..2222222 100644
--- a/src/one.rs
+++ b/src/one.rs
@@ -10,4 +10,5 @@ fn thing() {
 keep me
-drop me
+add me
+add me too
 tail
diff --git a/src/two.rs b/src/two.rs
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/two.rs
@@ -0,0 +1,2 @@
+first
+second
";
        let files = parse_unified_diff(raw);
        assert_eq!(files.len(), 2);

        let one = &files[0];
        assert_eq!(one.path, "src/one.rs");
        assert_eq!(one.old_path, None, "an unchanged path is not a rename");
        assert_eq!((one.additions, one.deletions), (2, 1));
        assert_eq!(one.hunks.len(), 1);
        assert_eq!(one.hunks[0].header, "@@ -10,4 +10,5 @@ fn thing() {");

        let lines = &one.hunks[0].lines;
        assert_eq!(lines.len(), 5);
        assert_eq!(
            (lines[0].kind.as_str(), lines[0].old_line, lines[0].new_line),
            (LINE_CONTEXT, Some(10), Some(10))
        );
        assert_eq!(lines[0].content, "keep me");
        assert_eq!(
            (lines[1].kind.as_str(), lines[1].old_line, lines[1].new_line),
            (LINE_DEL, Some(11), None)
        );
        assert_eq!(
            (lines[2].kind.as_str(), lines[2].old_line, lines[2].new_line),
            (LINE_ADD, None, Some(11))
        );
        assert_eq!(
            (lines[3].kind.as_str(), lines[3].old_line, lines[3].new_line),
            (LINE_ADD, None, Some(12))
        );
        // The context line after two additions and one deletion is line 12 on
        // the old side and 13 on the new one.
        assert_eq!(
            (lines[4].kind.as_str(), lines[4].old_line, lines[4].new_line),
            (LINE_CONTEXT, Some(12), Some(13))
        );

        let two = &files[1];
        assert_eq!(two.path, "src/two.rs");
        assert_eq!(two.old_path, None, "/dev/null is not an old path");
        assert_eq!((two.additions, two.deletions), (2, 0));
        assert_eq!(two.hunks[0].lines[0].new_line, Some(1));
    }

    #[test]
    fn parses_a_rename_with_and_without_content_changes() {
        let raw = "\
diff --git a/old/name.rs b/new/name.rs
similarity index 87%
rename from old/name.rs
rename to new/name.rs
index 4444444..5555555 100644
--- a/old/name.rs
+++ b/new/name.rs
@@ -1,2 +1,2 @@
 kept
-old line
+new line
diff --git a/moved.txt b/away.txt
similarity index 100%
rename from moved.txt
rename to away.txt
";
        let files = parse_unified_diff(raw);
        assert_eq!(files.len(), 2);

        assert_eq!(files[0].path, "new/name.rs");
        assert_eq!(files[0].old_path.as_deref(), Some("old/name.rs"));
        assert_eq!((files[0].additions, files[0].deletions), (1, 1));

        // A pure rename has no hunks at all.
        assert_eq!(files[1].path, "away.txt");
        assert_eq!(files[1].old_path.as_deref(), Some("moved.txt"));
        assert!(files[1].hunks.is_empty());
    }

    #[test]
    fn handles_binary_files() {
        let raw = "\
diff --git a/assets/logo.png b/assets/logo.png
index 6666666..7777777 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
diff --git a/notes.txt b/notes.txt
index 8888888..9999999 100644
--- a/notes.txt
+++ b/notes.txt
@@ -1 +1 @@
-before
+after
";
        let files = parse_unified_diff(raw);
        assert_eq!(files.len(), 2);

        let binary = &files[0];
        assert!(binary.binary, "the binary marker must be picked up");
        assert_eq!(binary.path, "assets/logo.png");
        assert!(binary.hunks.is_empty());
        assert_eq!((binary.additions, binary.deletions), (0, 0));

        // The text file after it is parsed normally.
        assert!(!files[1].binary);
        assert_eq!(files[1].path, "notes.txt");
        assert_eq!((files[1].additions, files[1].deletions), (1, 1));
    }

    #[test]
    fn handles_deletions_no_newline_markers_and_blank_context() {
        let raw = "\
diff --git a/gone.rs b/gone.rs
deleted file mode 100644
index aaaaaaa..0000000
--- a/gone.rs
+++ /dev/null
@@ -1,3 +0,0 @@
-one
-
-three
\\ No newline at end of file
";
        let files = parse_unified_diff(raw);
        assert_eq!(files.len(), 1);
        let gone = &files[0];
        // `+++ /dev/null` leaves the `diff --git` name standing.
        assert_eq!(gone.path, "gone.rs");
        assert_eq!(gone.old_path, None);
        assert_eq!((gone.additions, gone.deletions), (0, 3));
        assert_eq!(gone.hunks[0].lines.len(), 3, "the marker is not a line");
        assert_eq!(gone.hunks[0].lines[1].content, "");
    }

    #[test]
    fn paths_with_spaces_survive_the_git_header() {
        let (old, new) = split_diff_git_paths("a/my notes.txt b/my notes.txt");
        assert_eq!(old.as_deref(), Some("my notes.txt"));
        assert_eq!(new.as_deref(), Some("my notes.txt"));

        let raw = "\
diff --git a/my notes.txt b/my notes.txt
index 1111111..2222222 100644
Binary files a/my notes.txt and b/my notes.txt differ
";
        let files = parse_unified_diff(raw);
        assert_eq!(files[0].path, "my notes.txt");
        assert!(files[0].binary);
    }

    #[test]
    fn a_hunk_header_without_counts_still_numbers_its_lines() {
        let raw = "\
diff --git a/x b/x
--- a/x
+++ b/x
@@ -3 +3 @@
-old
+new
";
        let files = parse_unified_diff(raw);
        let lines = &files[0].hunks[0].lines;
        assert_eq!(lines[0].old_line, Some(3));
        assert_eq!(lines[1].new_line, Some(3));
    }

    // -- git ---------------------------------------------------------------

    /// A repository, plus a worktree on `pa/<id>` with a commit of its own.
    struct Repo {
        _dir: TempDir,
        repo: String,
        worktree: String,
    }

    fn repo_with_worker(label: &str) -> Repo {
        let dir = TempDir::new(label);
        let repo = init_repo(&dir.path().join("repo"))
            .to_string_lossy()
            .into_owned();
        let worktree = worktree::add_worktree(&repo, "wk-diff")
            .expect("worktree add")
            .to_string_lossy()
            .into_owned();
        Repo {
            _dir: dir,
            repo,
            worktree,
        }
    }

    fn commit(cwd: &str, name: &str, contents: &str) {
        std::fs::write(Path::new(cwd).join(name), contents).expect("write file");
        git(cwd, ["add", name]).expect("git add");
        git(cwd, ["commit", "--no-gpg-sign", "-m", "work"]).expect("git commit");
    }

    /// Review-r5 (Codex): the diff lines and the tuple must come from one
    /// pinned snapshot. `HEAD` and the base ref resolved anew per git call
    /// would let an agent commit slip between the diff and the measurement —
    /// the panel would show A and approve B.
    #[test]
    fn the_diff_and_its_tuple_use_pinned_shas() {
        let source = include_str!("diff.rs");
        let body = source
            .split("pub fn worker_diff(")
            .nth(1)
            .and_then(|rest| rest.split("\n}\n").next())
            .expect("worker_diff body");
        let revparse = body.find("rev-parse").expect("the snapshot is pinned");
        let stat = body.find(r#""diff", "--stat""#).expect("stat call");
        let measure = body.find("measure_code").expect("tuple measurement");
        assert!(
            revparse < stat && revparse < measure,
            "the SHAs must be pinned before the diff and the measurement"
        );
        assert!(
            !body.contains("format!(\"{base_branch}..."),
            "the diff range must be built from pinned SHAs, not a branch name"
        );
    }

    #[test]
    fn a_worker_that_changed_nothing_has_an_empty_diff() {
        let fx = repo_with_worker("empty-diff");
        let diff = worker_diff(&fx.repo, &fx.worktree).expect("diff");
        assert_eq!(diff.base_branch, "main");
        assert!(diff.files.is_empty());
        assert!(diff.stat.is_empty());
    }

    #[test]
    fn reads_the_diff_of_a_real_worktree() {
        let fx = repo_with_worker("real-diff");
        commit(&fx.worktree, "hello.txt", "one\ntwo\n");

        let diff = worker_diff(&fx.repo, &fx.worktree).expect("diff");
        assert_eq!(diff.base_branch, "main");
        assert!(
            diff.stat.contains("hello.txt"),
            "unexpected stat: {}",
            diff.stat
        );
        assert_eq!(diff.files.len(), 1);
        let file = &diff.files[0];
        assert_eq!(file.path, "hello.txt");
        assert_eq!((file.additions, file.deletions), (2, 0));
        assert_eq!(file.hunks[0].lines[0].content, "one");
        assert_eq!(file.hunks[0].lines[0].new_line, Some(1));
    }

    /// Review-r4 (Codex): the diff answer carries the merge-tree tuple of the
    /// same snapshot, so the review verdict can bind to exactly what the
    /// panel renders instead of to a separately polled state.
    #[test]
    fn the_diff_carries_the_tuple_of_its_own_snapshot() {
        let fx = repo_with_worker("diff-tuple");
        commit(&fx.worktree, "hello.txt", "one\ntwo\n");
        let head = git(&fx.worktree, ["rev-parse", "HEAD"]).expect("rev-parse");
        let head = head.trim();

        let diff = worker_diff(&fx.repo, &fx.worktree).expect("diff");
        let code = diff.code.expect("a measurable snapshot carries its tuple");
        assert_eq!(code.worker_head_sha, head);
        assert!(
            code
                .matches(
                    &crate::readiness::measure_code(
                        std::path::Path::new(&fx.worktree),
                        "main",
                        "HEAD",
                    )
                    .expect("measure"),
                ),
            "the diff tuple must equal what the merge path measures: {code:?}"
        );
    }

    #[test]
    fn git_errors_are_surfaced_verbatim() {
        let fx = repo_with_worker("git-error");
        let err = git(&fx.worktree, ["diff", "nope-no-such-ref...HEAD"])
            .expect_err("unknown ref must fail");
        assert!(
            err.contains("nope-no-such-ref"),
            "git's own words were lost: {err}"
        );
    }

    // -- comments ----------------------------------------------------------

    /// Accepts or refuses every write, and remembers what it was given.
    #[derive(Default)]
    struct FakeInput {
        sent: Mutex<Vec<(String, String)>>,
        fail: bool,
    }

    impl FakeInput {
        fn failing() -> Self {
            Self {
                fail: true,
                ..Self::default()
            }
        }

        fn sent(&self) -> Vec<(String, String)> {
            self.sent.lock().unwrap().clone()
        }
    }

    impl AgentInput for FakeInput {
        fn send(&self, session_id: &str, text: &str) -> Result<(), String> {
            if self.fail {
                return Err(format!("unknown pty session: {session_id}"));
            }
            self.sent
                .lock()
                .unwrap()
                .push((session_id.to_string(), text.to_string()));
            Ok(())
        }
    }

    async fn store_with_worker(label: &str) -> (TempDir, Store, String) {
        let dir = TempDir::new(label);
        let store = Store::open(&dir.path().join("projecta.db"))
            .await
            .expect("open store");
        let project = store
            .create_project("ProjectA", "C:/repos/a")
            .await
            .expect("create project");
        let row = WorkerRow {
            id: store::new_id("wk"),
            project_id: project.id,
            task: "do the thing".to_string(),
            profile_id: "claude".to_string(),
            branch: "pa/wk".to_string(),
            worktree_path: "C:/tmp/wk".to_string(),
            status: STATUS_RUNNING.to_string(),
            kind: KIND_WORKER.to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: None,
            tested_at: None,
            role_variant_id: None,
            paused_reason: None,
            created_at: store::now_unix_secs(),
        };
        store.insert_worker(&row).await.expect("insert worker");
        (dir, store, row.id)
    }

    #[tokio::test]
    async fn a_comment_is_stored_and_delivered() {
        let (_dir, store, worker_id) = store_with_worker("comment-live").await;
        store.bind_session(&worker_id, "pty-1").await;
        let input = FakeInput::default();

        let comment = add_comment(&store, &input, &worker_id, "src/main.rs", 42, " tidy this ")
            .await
            .expect("add comment");
        assert!(comment.sent_to_agent);
        assert_eq!(comment.body, "tidy this", "the body is trimmed");
        assert_eq!(
            input.sent(),
            vec![(
                "pty-1".to_string(),
                "\n[Review-Kommentar zu src/main.rs:42] tidy this\n".to_string()
            )]
        );

        let stored = store.list_diff_comments(&worker_id).await.expect("list");
        assert_eq!(stored, vec![comment]);
    }

    #[tokio::test]
    async fn a_comment_for_a_dead_session_is_kept_unsent() {
        let (_dir, store, worker_id) = store_with_worker("comment-dead").await;

        // No session bound at all: the agent exited and nothing replaced it.
        let comment = add_comment(&store, &FakeInput::default(), &worker_id, "a.rs", 1, "look")
            .await
            .expect("add comment");
        assert!(!comment.sent_to_agent);

        // A session that is bound but no longer writable is the same story.
        store.bind_session(&worker_id, "pty-gone").await;
        let failed = add_comment(&store, &FakeInput::failing(), &worker_id, "a.rs", 2, "here")
            .await
            .expect("a dead terminal must not lose the comment");
        assert!(!failed.sent_to_agent);

        let stored = store.list_diff_comments(&worker_id).await.expect("list");
        assert_eq!(stored.len(), 2);
        assert!(stored.iter().all(|c| !c.sent_to_agent));
    }

    #[tokio::test]
    async fn comments_are_listed_per_worker_and_deleted_while_unsent() {
        let (_dir, store, worker_id) = store_with_worker("comment-crud").await;
        let unsent = add_comment(&store, &FakeInput::default(), &worker_id, "a.rs", 1, "one")
            .await
            .expect("unsent comment");

        store.bind_session(&worker_id, "pty-1").await;
        let sent = add_comment(&store, &FakeInput::default(), &worker_id, "b.rs", 2, "two")
            .await
            .expect("sent comment");
        assert!(sent.sent_to_agent);

        // A sent comment is part of the agent's conversation and stays put.
        let err = delete_comment(&store, &sent.id)
            .await
            .expect_err("a delivered comment must not be deletable");
        assert!(err.contains("already sent"), "unexpected error: {err}");

        delete_comment(&store, &unsent.id)
            .await
            .expect("an undelivered comment can go");
        let left = store.list_diff_comments(&worker_id).await.expect("list");
        assert_eq!(left, vec![sent]);

        assert!(delete_comment(&store, "dc-nope").await.is_err());
    }

    #[tokio::test]
    async fn a_comment_needs_a_worker_and_a_body() {
        let (_dir, store, worker_id) = store_with_worker("comment-guards").await;
        assert!(
            add_comment(&store, &FakeInput::default(), "wk-nope", "a.rs", 1, "hi")
                .await
                .is_err()
        );
        assert!(
            add_comment(&store, &FakeInput::default(), &worker_id, "a.rs", 1, "  ")
                .await
                .is_err()
        );
        assert!(store
            .list_diff_comments(&worker_id)
            .await
            .expect("list")
            .is_empty());
    }

    #[test]
    fn an_orchestrator_has_no_worktree_to_diff() {
        let worker = |kind: &str, branch: &str, path: &str| Worker {
            id: "wk-1".to_string(),
            project_id: "pj-1".to_string(),
            task: "t".to_string(),
            profile_id: "claude".to_string(),
            branch: branch.to_string(),
            worktree_path: path.to_string(),
            session_id: None,
            status: STATUS_RUNNING.to_string(),
            kind: kind.to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: None,
            tested_at: None,
            paused_reason: None,
            created_at: 0,
        };

        let orchestrator = worker(KIND_ORCHESTRATOR, "", "C:/repos/a");
        assert_eq!(worktree_of(&orchestrator).unwrap_err(), NO_WORKTREE);

        let stripped = worker(KIND_WORKER, "pa/wk-1", "");
        assert_eq!(worktree_of(&stripped).unwrap_err(), NO_WORKTREE);

        let ordinary = worker(KIND_WORKER, "pa/wk-1", "C:/tmp/wk-1");
        assert_eq!(worktree_of(&ordinary).unwrap(), "C:/tmp/wk-1");
    }
}
