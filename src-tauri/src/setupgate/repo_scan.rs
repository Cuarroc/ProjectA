//! First-run repository scan: the facts the first-run screen shows about a
//! repository path. Read-only file reads: this module starts no process and
//! uses no network (the `api.rs` command checks the git work tree first).
//!
//! Every file the scan reads is resolved first and must stay inside its base
//! folder; a link that leads out counts as "not present", so the answer does
//! not reveal whether the target exists. This is by design: a monorepo whose
//! gate files are links to a shared folder outside the repository is
//! under-detected (follow-up V2-FU-S11C: tell the user in the screen copy).

use std::fs;
use std::path::{Path, PathBuf};

use crate::preflight;

/// What the scan found. Every field is a plain observation; absent means "not
/// found", never "guessed".
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoScan {
    pub main_branch: Option<String>,
    pub has_gates_sh: bool,
    pub has_mergify: bool,
    pub has_agents_md: bool,
    /// Backticked paths of the serial-seam paragraph in `AGENTS.md`.
    pub seam_files: Vec<String>,
    pub free_ram_bytes: Option<u64>,
}

/// Scan the repository at `path`. Errors only when `path` is not a directory.
pub fn scan_repo(path: &Path) -> Result<RepoScan, String> {
    if !path.is_dir() {
        return Err(format!("not a directory: {}", path.display()));
    }
    let agents = read_inside(path, "AGENTS.md");
    Ok(RepoScan {
        main_branch: main_branch(path),
        has_gates_sh: resolve_inside(path, "scripts/ci/gates.sh").is_some_and(|p| p.is_file()),
        has_mergify: resolve_inside(path, ".mergify.yml").is_some_and(|p| p.is_file()),
        has_agents_md: agents.is_some(),
        seam_files: agents.as_deref().map(parse_seam_files).unwrap_or_default(),
        free_ram_bytes: preflight::free_ram_bytes(),
    })
}

/// Windows `canonicalize` yields `\\?\C:\x` / `\\?\UNC\srv\x`, which git and
/// string comparisons against user-typed paths do not accept; other paths stay.
pub(crate) fn strip_verbatim_prefix(path: &str) -> String {
    if let Some(unc) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else if let Some(drive) = path.strip_prefix(r"\\?\") {
        let is_drive = drive.as_bytes().get(1) == Some(&b':');
        if is_drive {
            drive.to_string()
        } else {
            path.to_string()
        }
    } else {
        path.to_string()
    }
}

pub(crate) fn simplified(path: &Path) -> PathBuf {
    path.to_str().map_or_else(
        || path.to_path_buf(),
        |p| PathBuf::from(strip_verbatim_prefix(p)),
    )
}

/// `base/rel` with every link resolved, only when it stays inside `base`.
pub(crate) fn resolve_inside(base: &Path, rel: &str) -> Option<PathBuf> {
    let base = simplified(&fs::canonicalize(base).ok()?);
    let real = simplified(&fs::canonicalize(base.join(rel)).ok()?);
    real.starts_with(&base).then_some(real)
}

/// Reads the resolved path, not `base/rel`, so a link swapped in after the
/// check is not followed (only a swap inside the check-to-open gap remains).
fn read_inside(base: &Path, rel: &str) -> Option<String> {
    fs::read_to_string(resolve_inside(base, rel)?).ok()
}

/// The git directory: `.git`, or the target of a worktree's `.git` file. A
/// linked worktree's gitdir lives outside the folder by design (git follows it
/// too); `.git` itself must not be a link that leaves the folder.
fn git_dir(repo: &Path) -> Option<PathBuf> {
    let dot_git = resolve_inside(repo, ".git")?;
    if dot_git.is_dir() {
        return Some(dot_git);
    }
    let text = fs::read_to_string(&dot_git).ok()?;
    let target = text.trim().strip_prefix("gitdir:")?.trim();
    let dir = simplified(&fs::canonicalize(repo.join(target)).ok()?);
    dir.is_dir().then_some(dir)
}

fn main_branch(repo: &Path) -> Option<String> {
    let dir = git_dir(repo)?;
    // Refs live in the common dir when `dir` is a linked worktree's git dir.
    let common = read_inside(&dir, "commondir")
        .and_then(|rel| fs::canonicalize(dir.join(rel.trim())).ok())
        .map_or_else(|| dir.clone(), |c| simplified(&c));
    if let Some(head) = read_inside(&common, "refs/remotes/origin/HEAD") {
        if let Some(name) = head.trim().strip_prefix("ref: refs/remotes/origin/") {
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    let packed = read_inside(&common, "packed-refs").unwrap_or_default();
    ["main", "master"].into_iter().find_map(|name| {
        let loose =
            resolve_inside(&common, &format!("refs/heads/{name}")).is_some_and(|p| p.is_file());
        let branch_ref = format!("refs/heads/{name}");
        let in_packed = packed
            .lines()
            .filter(|line| !line.starts_with('#'))
            .any(|line| {
                line.split_once(' ')
                    .is_some_and(|(_, r)| r.trim_end() == branch_ref)
            });
        (loose || in_packed).then(|| name.to_string())
    })
}

/// Backticked paths of the first `AGENTS.md` block that mentions "seam" and
/// contains any. Blocks are separated by blank lines, headings or a new list
/// item (`1.`, `-`, `*`, `+`). Heuristic: a backticked token counts as a path
/// when it contains `/` or ends in an alphabetic file extension.
fn parse_seam_files(agents_md: &str) -> Vec<String> {
    let mut blocks: Vec<String> = Vec::new();
    let mut current = String::new();
    for line in agents_md.lines() {
        let starts_item = line
            .trim_start()
            .split_once(". ")
            .is_some_and(|(n, _)| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
            || ["- ", "* ", "+ "]
                .iter()
                .any(|bullet| line.starts_with(bullet))
            || line.starts_with('#');
        if line.trim().is_empty() || starts_item {
            blocks.push(std::mem::take(&mut current));
        }
        current.push_str(line);
        current.push('\n');
    }
    blocks.push(current);
    blocks
        .iter()
        .filter(|block| block.to_lowercase().contains("seam"))
        .map(|block| backticked_paths(block))
        .find(|paths| !paths.is_empty())
        .unwrap_or_default()
}

/// Path-like: contains a `/`, or ends in a file extension that starts with a
/// letter (`build.rs`, not `v1.2` or `e.g.`).
fn is_path_like(token: &str) -> bool {
    if token.contains(char::is_whitespace) {
        return false;
    }
    token.contains('/')
        || token.rsplit_once('.').is_some_and(|(stem, ext)| {
            !stem.is_empty()
                && ext.starts_with(|c: char| c.is_ascii_alphabetic())
                && ext.chars().all(|c| c.is_ascii_alphanumeric())
        })
}

fn backticked_paths(text: &str) -> Vec<String> {
    text.split('`')
        .skip(1)
        .step_by(2)
        .filter(|token| is_path_like(token))
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    fn write(root: &Path, rel: &str, body: &str) {
        let file = root.join(rel);
        fs::create_dir_all(file.parent().expect("parent")).expect("mkdir");
        fs::write(file, body).expect("write");
    }

    #[test]
    fn a_full_fixture_repo_reports_every_fact() {
        let dir = TempDir::new("repo-scan-full");
        let root = dir.path();
        write(root, "scripts/ci/gates.sh", "#!/bin/sh\n");
        write(root, ".mergify.yml", "queue_rules: []\n");
        write(
            root,
            "AGENTS.md",
            "# Rules\n\n5. **Reviews** (seam, security).\n6. **Seams only serially:** `src/api.rs`,\n   `src/main.rs`.\n\n7. Other `x.rs`.\n",
        );
        write(root, ".git/HEAD", "ref: refs/heads/trunk\n");
        write(
            root,
            ".git/refs/remotes/origin/HEAD",
            "ref: refs/remotes/origin/main\n",
        );
        let scan = scan_repo(root).expect("scan");
        assert_eq!(scan.main_branch.as_deref(), Some("main"));
        assert!(scan.has_gates_sh && scan.has_mergify && scan.has_agents_md);
        assert_eq!(scan.seam_files, ["src/api.rs", "src/main.rs"]);
        #[cfg(target_os = "linux")]
        assert!(scan.free_ram_bytes.is_some_and(|bytes| bytes > 0));
    }

    #[test]
    fn an_empty_directory_reports_nothing_without_panicking() {
        let dir = TempDir::new("repo-scan-empty");
        let scan = scan_repo(dir.path()).expect("scan");
        assert_eq!(scan.main_branch, None);
        assert!(!scan.has_gates_sh && !scan.has_mergify && !scan.has_agents_md);
        assert!(scan.seam_files.is_empty());
        assert!(scan_repo(&dir.path().join("missing")).is_err());
    }

    #[test]
    fn agents_md_without_a_seam_line_gives_an_empty_list() {
        let dir = TempDir::new("repo-scan-noseam");
        write(
            dir.path(),
            "AGENTS.md",
            "# Rules\n\nUse `src/lib.rs` freely.\n",
        );
        let scan = scan_repo(dir.path()).expect("scan");
        assert!(scan.has_agents_md);
        assert!(scan.seam_files.is_empty());
    }

    #[test]
    fn the_main_branch_falls_back_to_heads_then_packed_refs() {
        let loose = TempDir::new("repo-scan-loose");
        write(loose.path(), ".git/refs/heads/master", "abc\n");
        assert_eq!(
            scan_repo(loose.path()).unwrap().main_branch.as_deref(),
            Some("master")
        );
        let packed = TempDir::new("repo-scan-packed");
        write(
            packed.path(),
            ".git/packed-refs",
            "# pack-refs\nabc refs/heads/main\n",
        );
        assert_eq!(
            scan_repo(packed.path()).unwrap().main_branch.as_deref(),
            Some("main")
        );
        let none = TempDir::new("repo-scan-nobranch");
        write(none.path(), ".git/refs/heads/feature", "abc\n");
        assert_eq!(scan_repo(none.path()).unwrap().main_branch, None);
    }

    #[test]
    fn packed_refs_comment_lines_never_name_a_branch() {
        let dir = TempDir::new("repo-scan-packed-comment");
        write(
            dir.path(),
            ".git/packed-refs",
            "# note refs/heads/main\nabc refs/heads/feature\n^def\n",
        );
        assert_eq!(scan_repo(dir.path()).unwrap().main_branch, None);
    }

    /// A linked worktree: `wt/.git` is a file, refs live in `main/.git`.
    fn worktree_fixture(root: &Path, gitdir: &str, commondir: &str) {
        write(
            root,
            "main/.git/refs/remotes/origin/HEAD",
            "ref: refs/remotes/origin/trunk\n",
        );
        write(root, "main/.git/worktrees/wt/HEAD", "ref: refs/heads/x\n");
        write(root, "main/.git/worktrees/wt/commondir", commondir);
        write(root, "wt/.git", &format!("gitdir: {gitdir}\n"));
    }

    #[test]
    fn a_worktree_with_a_relative_gitdir_resolves_main_through_commondir() {
        let dir = TempDir::new("repo-scan-wt-rel");
        worktree_fixture(dir.path(), "../main/.git/worktrees/wt", "../..\n");
        let scan = scan_repo(&dir.path().join("wt")).expect("scan");
        assert_eq!(scan.main_branch.as_deref(), Some("trunk"));
    }

    #[test]
    fn a_worktree_with_an_absolute_gitdir_and_commondir_resolves_main() {
        let dir = TempDir::new("repo-scan-wt-abs");
        let common = dir.path().join("main/.git");
        let gitdir = common.join("worktrees/wt");
        worktree_fixture(
            dir.path(),
            &gitdir.display().to_string(),
            &common.display().to_string(),
        );
        let scan = scan_repo(&dir.path().join("wt")).expect("scan");
        assert_eq!(scan.main_branch.as_deref(), Some("trunk"));
    }

    #[test]
    fn star_and_plus_bullets_end_the_seam_paragraph() {
        let dir = TempDir::new("repo-scan-bullets");
        write(
            dir.path(),
            "AGENTS.md",
            "* **Seams only serially:** `src/api.rs`\n* Other `src/main.rs`\n+ More `src/store.rs`\n",
        );
        let scan = scan_repo(dir.path()).unwrap();
        assert_eq!(scan.seam_files, ["src/api.rs"]);
    }

    #[test]
    fn backticked_words_that_are_not_paths_are_not_seam_files() {
        let dir = TempDir::new("repo-scan-shape");
        write(
            dir.path(),
            "AGENTS.md",
            "6. **Seams** since `v1.2` (`e.g.`): `src/api.rs`, `build.rs`.\n",
        );
        let scan = scan_repo(dir.path()).unwrap();
        assert_eq!(scan.seam_files, ["src/api.rs", "build.rs"]);
    }

    #[test]
    fn verbatim_prefixes_are_stripped_for_git_and_other_paths_stay() {
        for (given, want) in [
            (r"\\?\C:\x", r"C:\x"),
            (r"\\?\UNC\srv\x", r"\\srv\x"),
            (r"C:\x", r"C:\x"),
            (r"\\srv\x", r"\\srv\x"),
            ("/home/x", "/home/x"),
            (r"\\?\Volume{1}\x", r"\\?\Volume{1}\x"),
        ] {
            assert_eq!(strip_verbatim_prefix(given), want, "{given}");
        }
    }
}
