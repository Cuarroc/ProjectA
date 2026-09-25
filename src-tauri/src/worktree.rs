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

/// Run `git` and return its stdout, or its stderr verbatim as the error.
fn git<I, S>(args: I) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = crate::proc::command("git")
        .args(args)
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
