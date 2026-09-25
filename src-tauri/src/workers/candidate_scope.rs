//! Git observations for scoped candidate submission. A scope check is not a
//! test/review verdict, sandbox, or authority to merge the observed commit.
use crate::store::development_launches::DevelopmentLaunch;
use std::path::Path;

fn git(path: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let output = crate::proc::command("git")
        .arg("--no-replace-objects")
        .arg("-C")
        .arg(path)
        .args(args)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_COMMON_DIR")
        .output()
        .map_err(|e| format!("candidate Git observation failed: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "candidate Git observation failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(output.stdout)
}

fn text(path: &Path, args: &[&str]) -> Result<String, String> {
    String::from_utf8(git(path, args)?)
        .map(|s| s.trim_end_matches(['\r', '\n']).to_string())
        .map_err(|_| "candidate Git observation is not UTF-8".into())
}

fn canonical(path: &Path) -> Result<std::path::PathBuf, String> {
    path.canonicalize()
        .map_err(|e| format!("candidate worktree identity unavailable: {e}"))
}

pub(super) fn head(launch: &DevelopmentLaunch) -> Result<String, String> {
    let path = Path::new(&launch.worktree_path);
    let root = text(path, &["rev-parse", "--show-toplevel"])?;
    if canonical(path)? != canonical(Path::new(&root))? {
        return Err("candidate is not in its reserved worktree root".into());
    }
    let common_args = ["rev-parse", "--path-format=absolute", "--git-common-dir"];
    let common = text(path, &common_args)?;
    let expected = text(Path::new(&launch.repo_path), &common_args)?;
    if canonical(Path::new(&common))? != canonical(Path::new(&expected))? {
        return Err("candidate worktree belongs to another repository".into());
    }
    if text(path, &["symbolic-ref", "HEAD"])? != format!("refs/heads/{}", launch.branch) {
        return Err("candidate worktree is not on its reserved branch".into());
    }
    text(path, &["rev-parse", "--verify", "HEAD^{commit}"])
}

pub(super) fn verify(
    launch: &DevelopmentLaunch,
    commit: &str,
    scopes: &[String],
) -> Result<(), String> {
    let baseline = launch
        .baseline_commit
        .as_deref()
        .ok_or("candidate has no backend-observed worktree baseline")?;
    if !matches!(launch.state.as_str(), "spawning" | "exited") {
        return Err("candidate launch has not crossed the spawn boundary".into());
    }
    if !matches!(commit.len(), 40 | 64) || !commit.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("candidate must be a full Git commit ID".into());
    }
    if head(launch)? != commit {
        return Err("candidate must equal the reserved worktree HEAD".into());
    }
    let path = Path::new(&launch.worktree_path);
    git(path, &["merge-base", "--is-ancestor", baseline, commit])?;
    // Disable renames so BOTH removed and added names need ownership. NUL
    // delimiters preserve filenames containing whitespace or newlines.
    let changed = git(
        path,
        &[
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "--ignore-submodules=none",
            "--name-only",
            "-z",
            baseline,
            commit,
            "--",
        ],
    )?;
    if scopes.is_empty() {
        return Err("candidate ownership is empty".into());
    }
    for name in changed.split(|b| *b == 0).filter(|s| !s.is_empty()) {
        let name = std::str::from_utf8(name).map_err(|_| "candidate path is not UTF-8")?;
        // Git path names are case-sensitive, even when ownership reservations
        // conservatively lock case aliases on every platform.
        if !scopes.iter().any(|scope| {
            name == scope
                || name
                    .strip_prefix(scope)
                    .is_some_and(|suffix| suffix.starts_with('/'))
        }) {
            return Err(format!(
                "candidate changes a path outside task ownership: {name:?}"
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{init_repo, TempDir};

    fn fixture() -> (TempDir, DevelopmentLaunch) {
        let dir = TempDir::new("candidate-scope");
        let repo = init_repo(&dir.path().join("repo"));
        std::fs::create_dir(repo.join("src")).unwrap();
        std::fs::write(repo.join("src/owned.rs"), "owned\n").unwrap();
        std::fs::write(repo.join("outside.txt"), "outside\n").unwrap();
        commit(&repo);
        let path = crate::worktree::add_worktree(repo.to_str().unwrap(), "scope-worker").unwrap();
        let mut launch = DevelopmentLaunch {
            run_id: "run".into(),
            worker_id: "scope-worker".into(),
            project_id: "project".into(),
            profile_id: "codex".into(),
            repo_path: repo.to_str().unwrap().into(),
            worktree_path: path.to_str().unwrap().into(),
            branch: "pa/scope-worker".into(),
            session_id: Some("session".into()),
            state: "spawning".into(),
            reserved_at: 1,
            spawning_at: Some(2),
            exited_at: None,
            exit_code: None,
            route_json: None,
            route_expires_at: None,
            baseline_commit: None,
            process_instance: None,
            exit_reason: None,
        };
        launch.baseline_commit = Some(head(&launch).unwrap());
        (dir, launch)
    }

    fn commit(path: &Path) -> String {
        git(path, &["add", "-A"]).unwrap();
        git(
            path,
            &[
                "-c",
                "core.hooksPath=",
                "commit",
                "--no-gpg-sign",
                "-m",
                "scope test",
            ],
        )
        .unwrap();
        text(path, &["rev-parse", "HEAD"]).unwrap()
    }

    #[test]
    fn owned_edit_and_deletion_pass_but_sibling_prefix_does_not() {
        let (_dir, launch) = fixture();
        let path = Path::new(&launch.worktree_path);
        std::fs::remove_file(path.join("src/owned.rs")).unwrap();
        std::fs::write(path.join("src/new file.rs"), "new\n").unwrap();
        let oid = commit(path);
        verify(&launch, &oid, &["src".into()]).unwrap();
        std::fs::create_dir(path.join("src-other")).unwrap();
        std::fs::write(path.join("src-other/escape.rs"), "escape\n").unwrap();
        assert!(verify(&launch, &commit(path), &["src".into()])
            .unwrap_err()
            .contains("outside task ownership"));
    }

    #[test]
    fn rename_requires_ownership_of_both_old_and_new_paths() {
        let (_dir, launch) = fixture();
        let path = Path::new(&launch.worktree_path);
        std::fs::rename(path.join("outside.txt"), path.join("src/moved.rs")).unwrap();
        let oid = commit(path);
        assert!(verify(&launch, &oid, &["src".into()])
            .unwrap_err()
            .contains("outside.txt"));
        verify(&launch, &oid, &["src".into(), "outside.txt".into()]).unwrap();
        assert!(verify(&launch, &oid, &["outside.txt".into()])
            .unwrap_err()
            .contains("src/moved.rs"));
    }

    #[test]
    fn rejects_refs_old_heads_rewritten_history_and_unknown_baselines() {
        let (_dir, mut launch) = fixture();
        let path = std::path::PathBuf::from(&launch.worktree_path);
        let baseline = launch.baseline_commit.clone().unwrap();
        std::fs::write(path.join("src/owned.rs"), "changed\n").unwrap();
        let oid = commit(&path);
        assert!(verify(&launch, "HEAD", &["src".into()]).is_err());
        assert!(verify(&launch, &baseline, &["src".into()]).is_err());
        assert!(verify(&launch, &oid, &[]).is_err());
        assert!(verify(&launch, &oid, &["SRC".into()]).is_err());
        launch.baseline_commit = None;
        assert!(verify(&launch, &oid, &["src".into()]).is_err());
        launch.baseline_commit = Some(baseline);
        git(&path, &["checkout", "--orphan", "rewritten"]).unwrap();
        let unrelated = commit(&path);
        git(&path, &["branch", "-f", &launch.branch, &unrelated]).unwrap();
        git(&path, &["checkout", &launch.branch]).unwrap();
        assert!(verify(&launch, &unrelated, &["src".into(), "outside.txt".into()]).is_err());
    }

    #[test]
    fn upstream_advancing_cannot_hide_worker_edits_or_change_the_baseline() {
        let (_dir, launch) = fixture();
        let path = Path::new(&launch.worktree_path);
        std::fs::write(path.join("outside.txt"), "outside worker edit\n").unwrap();
        let oid = commit(path);
        let repo = Path::new(&launch.repo_path);
        git(repo, &["merge", "--ff-only", &launch.branch]).unwrap();
        std::fs::write(repo.join("other.txt"), "upstream\n").unwrap();
        commit(repo);
        assert!(verify(&launch, &oid, &["src".into()])
            .unwrap_err()
            .contains("outside.txt"));
    }

    #[test]
    fn submodule_ignore_configuration_cannot_hide_out_of_scope_gitlinks() {
        let (_dir, launch) = fixture();
        let path = Path::new(&launch.worktree_path);
        let first = launch.baseline_commit.as_deref().unwrap();
        git(
            path,
            &[
                "update-index",
                "--add",
                "--cacheinfo",
                &format!("160000,{first},outside-module"),
            ],
        )
        .unwrap();
        git(
            path,
            &[
                "-c",
                "core.hooksPath=",
                "commit",
                "--no-gpg-sign",
                "-m",
                "gitlink",
            ],
        )
        .unwrap();
        let oid = head(&launch).unwrap();
        git(path, &["config", "diff.ignoreSubmodules", "all"]).unwrap();
        assert!(verify(&launch, &oid, &["src".into()])
            .unwrap_err()
            .contains("outside-module"));
    }

    #[test]
    fn reserved_branch_and_repository_identity_must_match() {
        let (_dir, mut launch) = fixture();
        let oid = head(&launch).unwrap();
        launch.branch = "main".into();
        assert!(verify(&launch, &oid, &["src".into()])
            .unwrap_err()
            .contains("reserved branch"));
        launch.branch = "pa/scope-worker".into();
        let foreign = TempDir::new("candidate-foreign");
        launch.repo_path = init_repo(&foreign.path().join("repo"))
            .to_str()
            .unwrap()
            .into();
        assert!(verify(&launch, &oid, &["src".into()])
            .unwrap_err()
            .contains("another repository"));
    }
}
