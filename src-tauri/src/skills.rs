//! Bundled skill packs, installed into every worker's worktree.
//!
//! A Claude Code skill is only discoverable through a `.claude/skills/<name>/`
//! directory next to the code the agent is working on. ProjectA ships a few of
//! them (`resources/skills/*`, each a directory with a `SKILL.md`) and copies
//! the ones a project has enabled into the fresh worktree before the agent is
//! started - so a worker begins its life already knowing how the house wants
//! frontends built.
//!
//! The layout mirrors [`crate::enhance`], which does the same thing for the
//! single `prompt-master` skill in a throwaway workspace:
//!
//! ```text
//! <worktree>/.claude/skills/<pack>/SKILL.md
//!                                  ...
//! ```
//!
//! Unlike the enhancer this is *ambient* enrichment: nobody asked for it, so a
//! missing resource directory or an unreadable pack costs the worker its extra
//! skills, never its existence. The caller decides how loud to be; the
//! functions here report what went wrong and let it choose.

use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::capabilities::SkillsDiscovery;

/// Where the packs live inside `resources/`, both in a checkout and in a bundle.
pub const SKILLS_DIR: &str = "skills";

/// The file that makes a directory a skill.
const SKILL_FILE: &str = "SKILL.md";

/// One bundled skill pack, as offered to the frontend.
///
/// Serialized as `{ "id", "name", "description" }`, where `id` is the pack's
/// directory name - the only part of it that is stable enough to store in the
/// database.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPack {
    pub id: String,
    pub name: String,
    pub description: String,
}

// -- finding the packs -----------------------------------------------------

/// Where the packs live in a source checkout.
pub fn dev_skills_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(SKILLS_DIR)
}

/// A directory is a pack if it has the `SKILL.md` the CLI reads.
fn is_pack_dir(path: &Path) -> bool {
    path.join(SKILL_FILE).is_file()
}

/// Locate the bundled packs: the installed copy first, the checkout second.
///
/// `tauri.conf.json` bundles `resources/skills/**/*`, and Tauri keeps that
/// relative layout under the resource directory, so the installed copy is
/// `<resources>/resources/skills`.
pub fn bundled_skills_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;

    if let Ok(dir) = app.path().resource_dir() {
        let bundled = dir.join("resources").join(SKILLS_DIR);
        if bundled.is_dir() {
            return Ok(bundled);
        }
    }

    let dev = dev_skills_dir();
    if dev.is_dir() {
        return Ok(dev);
    }

    Err("the bundled skill packs are missing from this installation".to_string())
}

/// Every pack under `src`, by directory name, sorted so the UI is stable.
///
/// A directory without a `SKILL.md` is not a pack and is skipped silently: the
/// resource directory may well pick up a `.gitkeep` or an editor's leftovers.
pub fn list_packs(src: &Path) -> Result<Vec<SkillPack>, String> {
    let entries =
        std::fs::read_dir(src).map_err(|e| format!("failed to read {}: {e}", src.display()))?;

    let mut packs = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read {}: {e}", src.display()))?;
        let path = entry.path();
        if !path.is_dir() || !is_pack_dir(&path) {
            continue;
        }
        let Some(id) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        packs.push(read_pack(id, &path));
    }
    packs.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(packs)
}

/// Just the ids, which is what the database stores and what "all of them"
/// resolves to.
pub fn pack_ids(src: &Path) -> Result<Vec<String>, String> {
    Ok(list_packs(src)?.into_iter().map(|pack| pack.id).collect())
}

/// Describe one pack from its `SKILL.md` front matter.
///
/// An unreadable or field-less file is not an error: the directory name is a
/// perfectly usable label, and a pack with no description still installs.
fn read_pack(id: &str, path: &Path) -> SkillPack {
    let text = std::fs::read_to_string(path.join(SKILL_FILE)).unwrap_or_default();
    let (name, description) = parse_front_matter(&text);
    SkillPack {
        id: id.to_string(),
        name: name.unwrap_or_else(|| id.to_string()),
        description: description.unwrap_or_default(),
    }
}

/// Pull `name` and `description` out of a `SKILL.md` YAML front matter block.
///
/// Deliberately not a YAML parser: only top-level `key: value` lines inside the
/// leading `---` fences are read, so the nested keys under a `metadata:` block
/// cannot shadow the two fields that matter. Values may be quoted.
pub fn parse_front_matter(text: &str) -> (Option<String>, Option<String>) {
    let mut lines = text.lines();
    // The block has to be the very first thing in the file.
    if lines.next().map(str::trim) != Some("---") {
        return (None, None);
    }

    let mut name = None;
    let mut description = None;
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        // Indented lines belong to the key above them, not to the document.
        if line.starts_with(' ') || line.starts_with('\t') {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = unquote(value.trim());
        if value.is_empty() {
            continue;
        }
        match key.trim() {
            "name" if name.is_none() => name = Some(value),
            "description" if description.is_none() => description = Some(value),
            _ => {}
        }
    }
    (name, description)
}

/// Strip one layer of matching quotes from a front matter value.
fn unquote(value: &str) -> String {
    for quote in ['"', '\''] {
        if value.len() >= 2 && value.starts_with(quote) && value.ends_with(quote) {
            return value[1..value.len() - 1].to_string();
        }
    }
    value.to_string()
}

// -- installing them -------------------------------------------------------

/// Which packs a project wants, given what it has stored.
///
/// `None` - the column was never set - and an empty list both mean "all of
/// them": a project that has never been configured should get everything
/// ProjectA ships. Names that no longer exist are dropped, so removing a pack
/// from the bundle cannot break an old project.
pub fn resolve_enabled(available: &[String], enabled: Option<&[String]>) -> Vec<String> {
    match enabled {
        None => available.to_vec(),
        Some([]) => available.to_vec(),
        Some(wanted) => available
            .iter()
            .filter(|id| wanted.iter().any(|w| w == *id))
            .cloned()
            .collect(),
    }
}

/// Where a pack ends up inside a worktree, for the CLIs that use the default
/// `.claude/skills` convention.
pub fn skills_path(worktree: &Path) -> PathBuf {
    worktree.join(".claude").join(SKILLS_DIR)
}

/// The directory the packs are installed into.
///
/// A newtype rather than a bare `PathBuf` because the spawn path holds a
/// worktree and a destination at the same time, both of them paths: reviewer B
/// showed that swapping the two arguments of [`install`] compiles and that no
/// test notices. It cannot be built except through [`skills_path_for`], so a
/// destination that reached `install` has been through the containment check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillsDest(PathBuf);

impl SkillsDest {
    /// The directory itself, for callers that only need to look at it.
    pub fn path(&self) -> &Path {
        &self.0
    }
}

/// Where a pack ends up for `discovery`. `Ok(None)` means the CLI reads no
/// skills at all, so nothing is copied.
///
/// This is the only place that decides a destination, so a CLI that reads its
/// skills somewhere else than `.claude/skills` is described by its profile
/// rather than by an exception somewhere in the spawn path.
///
/// `Err` means the profile named a place we refuse to write to. It is a
/// separate answer from `Ok(None)` on purpose: a typo in `agents.json` must
/// not be indistinguishable from an agent that reads no skills - the caller
/// decides how loud to be, but it has something to be loud about.
pub fn skills_path_for(
    worktree: &Path,
    discovery: &SkillsDiscovery,
) -> Result<Option<SkillsDest>, String> {
    let candidate = match discovery {
        SkillsDiscovery::Unsupported => return Ok(None),
        // `Flag` still lands in the conventional directory; the flag only
        // tells the CLI where to look, it does not choose the place.
        SkillsDiscovery::Convention | SkillsDiscovery::Flag { .. } => skills_path(worktree),
        SkillsDiscovery::ConventionAt { dir } => contained_subdir(worktree, dir)
            .ok_or_else(|| format!("skill directory {dir:?} is not a place inside the worktree"))?,
    };
    if leaves_through_a_link(worktree, &candidate) {
        return Err(format!(
            "{} resolves outside the worktree - a symlink on the way there",
            candidate.display()
        ));
    }
    Ok(Some(SkillsDest(candidate)))
}

/// Whether `candidate` really lands outside `worktree` once the filesystem
/// has its say.
///
/// [`contained_subdir`] only reads the path as text, and text is not the whole
/// story: a checkout may itself contain `\.agents -> /somewhere/else`, and
/// `remove_dir_all` follows a link in a parent component. Reviewer A
/// reproduced exactly that with the *documented* `.agents/skills` value.
///
/// The destination usually does not exist yet, and `canonicalize` needs a real
/// path, so this resolves the deepest ancestor that does exist and asks about
/// that one. Both sides are canonicalized, so a worktree that itself lives
/// under a link (`/tmp` on macOS) is not mistaken for an escape.
fn leaves_through_a_link(worktree: &Path, candidate: &Path) -> bool {
    let Ok(root) = worktree.canonicalize() else {
        // Nothing exists to escape from yet; the caller is about to fail on
        // this worktree for its own reasons.
        return false;
    };
    let mut probe = candidate;
    loop {
        if let Ok(resolved) = probe.canonicalize() {
            return !resolved.starts_with(&root);
        }
        match probe.parent() {
            Some(parent) => probe = parent,
            // Walked past the root without finding anything real.
            None => return false,
        }
    }
}

/// `worktree.join(dir)`, but only as long as `dir` stays inside the worktree.
///
/// `dir` reaches us from `agents.json`, which is a file a user writes by hand.
/// [`install`] calls `remove_dir_all` on every pack directory before copying,
/// so an absolute path or one climbing out with `..` would aim that deletion
/// at somebody else's files. Such a directory is **refused**, not clamped: a
/// profile naming a place we will not write to gets no packs, which the caller
/// can report, rather than silently getting a different place than it asked
/// for.
fn contained_subdir(worktree: &Path, dir: &str) -> Option<PathBuf> {
    let mut out = worktree.to_path_buf();
    let mut depth = 0usize;
    for part in Path::new(dir).components() {
        match part {
            Component::Normal(name) => {
                out.push(name);
                depth += 1;
            }
            // `./x` is just `x`.
            Component::CurDir => {}
            // `..`, `/` and a Windows prefix all leave the worktree behind.
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    // An empty or `.`-only directory would put the packs in the worktree root,
    // scattering pack directories among the checked-out sources.
    (depth > 0).then_some(out)
}

/// Copy the project's enabled packs from `src` into `dest`, the destination
/// [`skills_path_for`] resolved for the worker's profile.
///
/// Each pack is replaced wholesale rather than merged into, so a worktree that
/// somehow already has one cannot end up with a half-updated copy. Returns the
/// ids that were installed.
pub fn install(
    src: &Path,
    dest: &SkillsDest,
    enabled: Option<&[String]>,
) -> Result<Vec<String>, String> {
    let available = pack_ids(src)?;
    let wanted = resolve_enabled(&available, enabled);
    if wanted.is_empty() {
        return Ok(Vec::new());
    }

    let dest_root = dest.path();
    std::fs::create_dir_all(dest_root)
        .map_err(|e| format!("failed to create {}: {e}", dest_root.display()))?;

    for id in &wanted {
        let dest = dest_root.join(id);
        // A leftover from an older bundle must not survive underneath the new
        // one; `remove_dir_all` on a missing path is exactly what we want.
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::create_dir_all(&dest)
            .map_err(|e| format!("failed to create {}: {e}", dest.display()))?;
        copy_dir_all(&src.join(id), &dest)?;
    }
    Ok(wanted)
}

/// Copy `src` into `dest` recursively, creating directories as needed.
pub fn copy_dir_all(src: &Path, dest: &Path) -> Result<(), String> {
    let entries =
        std::fs::read_dir(src).map_err(|e| format!("failed to read {}: {e}", src.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read {}: {e}", src.display()))?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if from.is_dir() {
            std::fs::create_dir_all(&to)
                .map_err(|e| format!("failed to create {}: {e}", to.display()))?;
            copy_dir_all(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)
                .map_err(|e| format!("failed to copy {}: {e}", from.display()))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    /// Build a resource directory with `packs` in it, each carrying a
    /// `SKILL.md` and one extra file in a subdirectory.
    fn fake_bundle(root: &Path, packs: &[&str]) -> PathBuf {
        let src = root.join("resources-skills");
        for pack in packs {
            let dir = src.join(pack);
            std::fs::create_dir_all(dir.join("references")).expect("mkdir");
            std::fs::write(
                dir.join(SKILL_FILE),
                format!("---\nname: {pack}-name\ndescription: about {pack}\n---\n\n# {pack}\n"),
            )
            .expect("write");
            std::fs::write(dir.join("references").join("more.md"), *pack).expect("write");
        }
        src
    }

    /// The destination a conventional CLI gets, for the tests that only care
    /// that installing works at all.
    fn conventional(worktree: &Path) -> SkillsDest {
        skills_path_for(worktree, &SkillsDiscovery::Convention)
            .expect("accepted")
            .expect("a destination")
    }

    #[test]
    fn the_repository_ships_the_packs_it_bundles() {
        // The dev lookup and `tauri.conf.json` both point here, so an empty or
        // renamed resource directory has to fail loudly.
        let dev = dev_skills_dir();
        assert!(dev.is_dir(), "{} is missing", dev.display());
        let ids = pack_ids(&dev).expect("list packs");
        for expected in ["taste-skill", "minimalist-skill", "web-design-guidelines"] {
            assert!(
                ids.iter().any(|id| id == expected),
                "{expected} missing from {ids:?}"
            );
        }
    }

    #[test]
    fn the_ui_ux_pro_max_pack_placeholder_is_listed() {
        // The public repository ships only a placeholder SKILL.md for this
        // third-party pack (no license file upstream); it must still parse.
        let dev = dev_skills_dir();
        let ids = pack_ids(&dev).expect("list packs");
        assert!(
            ids.iter().any(|id| id == "ui-ux-pro-max"),
            "ui-ux-pro-max missing from {ids:?}"
        );
        let pack = dev.join("ui-ux-pro-max");
        assert!(pack.join("SKILL.md").is_file(), "SKILL.md missing from ui-ux-pro-max");
        let skill = std::fs::read_to_string(pack.join("SKILL.md")).expect("read SKILL.md");
        let (name, description) = parse_front_matter(&skill);
        assert_eq!(name.as_deref(), Some("ui-ux-pro-max"));
        assert!(
            description.is_some(),
            "the pack needs a description for the picker"
        );
    }

    #[test]
    fn front_matter_supplies_the_name_and_the_description() {
        let (name, description) = parse_front_matter(
            "---\nname: minimalist-ui\ndescription: Clean editorial-style interfaces.\n---\n\n# doc",
        );
        assert_eq!(name.as_deref(), Some("minimalist-ui"));
        assert_eq!(
            description.as_deref(),
            Some("Clean editorial-style interfaces.")
        );

        // Quoted values, and nested keys under `metadata:` that must not win.
        let (name, description) = parse_front_matter(
            "---\nname: \"web-design-guidelines\"\ndescription: 'Review UI code.'\nmetadata:\n  author: vercel\n  name: not-this\n  description: not-this-either\n---\n",
        );
        assert_eq!(name.as_deref(), Some("web-design-guidelines"));
        assert_eq!(description.as_deref(), Some("Review UI code."));
    }

    #[test]
    fn a_pack_without_front_matter_falls_back_to_its_directory_name() {
        assert_eq!(parse_front_matter("# just a heading\n"), (None, None));
        // A block that only sets one of the two fields.
        let (name, description) = parse_front_matter("---\ndescription: only this\n---\n");
        assert!(name.is_none());
        assert_eq!(description.as_deref(), Some("only this"));

        let dir = TempDir::new("skills-bare");
        let pack = dir.path().join("bare-skill");
        std::fs::create_dir_all(&pack).expect("mkdir");
        std::fs::write(pack.join(SKILL_FILE), "# no front matter here\n").expect("write");

        let packs = list_packs(dir.path()).expect("list packs");
        assert_eq!(
            packs,
            vec![SkillPack {
                id: "bare-skill".to_string(),
                name: "bare-skill".to_string(),
                description: String::new(),
            }]
        );
    }

    #[test]
    fn only_directories_with_a_skill_file_are_packs() {
        let dir = TempDir::new("skills-list");
        let src = fake_bundle(dir.path(), &["b-skill", "a-skill"]);
        std::fs::create_dir_all(src.join("not-a-skill")).expect("mkdir");
        std::fs::write(src.join("README.md"), "loose file").expect("write");

        let packs = list_packs(&src).expect("list packs");
        assert_eq!(
            packs,
            vec![
                SkillPack {
                    id: "a-skill".to_string(),
                    name: "a-skill-name".to_string(),
                    description: "about a-skill".to_string(),
                },
                SkillPack {
                    id: "b-skill".to_string(),
                    name: "b-skill-name".to_string(),
                    description: "about b-skill".to_string(),
                },
            ]
        );
    }

    #[test]
    fn installing_puts_every_enabled_pack_where_the_cli_looks_for_it() {
        let dir = TempDir::new("skills-install");
        let src = fake_bundle(dir.path(), &["taste", "minimal"]);
        let worktree = dir.path().join("worktree");
        std::fs::create_dir_all(&worktree).expect("mkdir");

        let installed = install(&src, &conventional(&worktree), None).expect("install");
        assert_eq!(installed, vec!["minimal".to_string(), "taste".to_string()]);

        for pack in ["taste", "minimal"] {
            let dest = worktree.join(".claude").join("skills").join(pack);
            assert!(
                dest.join(SKILL_FILE).is_file(),
                "{pack}/SKILL.md did not land"
            );
            // Subdirectories come along, or half the pack is missing.
            assert_eq!(
                std::fs::read_to_string(dest.join("references").join("more.md")).unwrap(),
                pack
            );
        }
    }

    #[test]
    fn a_missing_claude_directory_is_created() {
        let dir = TempDir::new("skills-mkdir");
        let src = fake_bundle(dir.path(), &["taste"]);
        let worktree = dir.path().join("worktree");
        std::fs::create_dir_all(&worktree).expect("mkdir");
        assert!(!worktree.join(".claude").exists());

        install(&src, &conventional(&worktree), None).expect("install");
        assert!(worktree
            .join(".claude")
            .join("skills")
            .join("taste")
            .is_dir());
    }

    #[test]
    fn only_the_enabled_packs_are_copied_and_unknown_names_are_ignored() {
        let dir = TempDir::new("skills-subset");
        let src = fake_bundle(dir.path(), &["taste", "minimal"]);
        let worktree = dir.path().join("worktree");
        std::fs::create_dir_all(&worktree).expect("mkdir");

        let enabled = ["taste".to_string(), "long-gone".to_string()];
        let installed = install(&src, &conventional(&worktree), Some(&enabled)).expect("install");

        assert_eq!(installed, vec!["taste".to_string()]);
        let root = worktree.join(".claude").join("skills");
        assert!(root.join("taste").is_dir());
        assert!(!root.join("minimal").exists(), "minimal was not enabled");
        assert!(!root.join("long-gone").exists(), "long-gone does not exist");
    }

    #[test]
    fn no_enabled_pack_still_leaves_a_usable_worktree() {
        let dir = TempDir::new("skills-none");
        let src = fake_bundle(dir.path(), &["taste"]);
        let worktree = dir.path().join("worktree");
        std::fs::create_dir_all(&worktree).expect("mkdir");

        let enabled = ["nothing-matches".to_string()];
        assert!(install(&src, &conventional(&worktree), Some(&enabled))
            .unwrap()
            .is_empty());
        // Nothing to install means nothing to create.
        assert!(!worktree.join(".claude").exists());
    }

    #[test]
    fn an_existing_pack_is_replaced_rather_than_merged_into() {
        let dir = TempDir::new("skills-overwrite");
        let src = fake_bundle(dir.path(), &["taste"]);
        let worktree = dir.path().join("worktree");
        let dest = skills_path(&worktree).join("taste");
        std::fs::create_dir_all(&dest).expect("mkdir");
        std::fs::write(dest.join(SKILL_FILE), "an older version").expect("write");
        std::fs::write(dest.join("stale.md"), "from a bundle ago").expect("write");

        install(&src, &conventional(&worktree), None).expect("install");

        assert!(std::fs::read_to_string(dest.join(SKILL_FILE))
            .unwrap()
            .contains("name: taste-name"));
        assert!(!dest.join("stale.md").exists(), "the old file survived");
    }

    #[test]
    fn nothing_stored_and_nothing_enabled_both_mean_everything() {
        let available = vec!["a".to_string(), "b".to_string()];
        assert_eq!(resolve_enabled(&available, None), available);
        assert_eq!(resolve_enabled(&available, Some(&[])), available);
        assert_eq!(
            resolve_enabled(&available, Some(&["b".to_string()])),
            vec!["b".to_string()]
        );
        // The bundle decides the order, not the stored list.
        assert_eq!(
            resolve_enabled(&available, Some(&["b".to_string(), "a".to_string()])),
            available
        );
    }

    #[test]
    fn a_profile_reading_agents_skills_gets_its_packs_there() {
        // openinterpreter and the Codex family read `<project>/.agents/skills`
        // (`AGENTS_DIR_NAME`/`SKILLS_DIR_NAME` in
        // `codex-rs/ext/skills/src/host_roots.rs`), never `.claude/skills`.
        // Before `skills_path_for` such an agent could only be described as
        // `Unsupported` - it got no packs at all, although it reads them.
        let dir = TempDir::new("skills-agents-dir");
        let src = fake_bundle(dir.path(), &["taste"]);
        let worktree = dir.path().join("worktree");
        let discovery = SkillsDiscovery::ConventionAt {
            dir: ".agents/skills".into(),
        };

        let dest = skills_path_for(&worktree, &discovery)
            .expect("accepted")
            .expect("a destination");
        assert_eq!(dest.path(), worktree.join(".agents").join("skills"));

        let installed = install(&src, &dest, None).expect("install");
        assert_eq!(installed, vec!["taste".to_string()]);
        assert!(dest.path().join("taste").join(SKILL_FILE).is_file());
        // The conventional directory stays empty: the packs went where the
        // profile said, not to both places.
        assert!(!worktree.join(".claude").exists());
    }

    #[test]
    fn a_skills_directory_that_leaves_the_worktree_is_refused() {
        // `dir` comes from a hand-written `agents.json`, and `install`
        // starts every pack with `remove_dir_all`. Escaping the worktree must
        // not be possible, and must not be silently rewritten either.
        let worktree = Path::new("/tmp/wt");
        for escape in ["../outside", ".agents/../../outside", "/etc", "", "."] {
            let discovery = SkillsDiscovery::ConventionAt { dir: escape.into() };
            assert!(
                skills_path_for(worktree, &discovery).is_err(),
                "{escape} was accepted"
            );
        }
        // A `./` prefix is not an escape, only noise.
        assert_eq!(
            skills_path_for(
                worktree,
                &SkillsDiscovery::ConventionAt {
                    dir: "./.agents/skills".into()
                }
            ),
            Ok(Some(SkillsDest(worktree.join(".agents").join("skills"))))
        );
    }

    /// Reviewer A's finding: `contained_subdir` reads the path as text, but a
    /// checkout can carry `.agents -> /somewhere/else`, and `remove_dir_all`
    /// follows a link in a parent component. The *documented* value
    /// `.agents/skills` was enough to aim it outside.
    #[test]
    #[cfg(unix)]
    fn a_linked_skill_directory_is_refused_even_with_the_documented_value() {
        let dir = TempDir::new("skills-symlink");
        let outside = dir.path().join("outside");
        std::fs::create_dir_all(outside.join("skills")).expect("mkdir");
        std::fs::write(outside.join("skills").join("keep.txt"), "not ours").expect("write");
        let worktree = dir.path().join("worktree");
        std::fs::create_dir_all(&worktree).expect("mkdir");
        std::os::unix::fs::symlink(&outside, worktree.join(".agents")).expect("symlink");

        let discovery = SkillsDiscovery::ConventionAt {
            dir: ".agents/skills".into(),
        };
        let refused = skills_path_for(&worktree, &discovery).expect_err("must be refused");
        assert!(refused.contains("outside the worktree"), "{refused}");
        // And the file that `remove_dir_all` would have reached is untouched.
        assert!(outside.join("skills").join("keep.txt").is_file());
    }

    /// The same link, reached through the plain `.claude` convention. This
    /// hole predates `ConventionAt`; one authority closes both.
    #[test]
    #[cfg(unix)]
    fn the_conventional_directory_is_held_to_the_same_boundary() {
        let dir = TempDir::new("skills-symlink-claude");
        let outside = dir.path().join("outside");
        std::fs::create_dir_all(&outside).expect("mkdir");
        let worktree = dir.path().join("worktree");
        std::fs::create_dir_all(&worktree).expect("mkdir");
        std::os::unix::fs::symlink(&outside, worktree.join(".claude")).expect("symlink");

        assert!(skills_path_for(&worktree, &SkillsDiscovery::Convention).is_err());
    }

    #[test]
    #[cfg(windows)]
    fn windows_junctions_cannot_redirect_skill_destinations_outside_the_worktree() {
        let dir = TempDir::new("skills-junction");
        let outside = dir.path().join("outside");
        let worktree = dir.path().join("worktree");
        std::fs::create_dir_all(outside.join("skills")).expect("outside");
        std::fs::create_dir_all(&worktree).expect("worktree");
        let sentinel = outside.join("skills").join("keep.txt");
        std::fs::write(&sentinel, "not ours").expect("sentinel");
        for (name, capability) in [
            (
                ".agents",
                SkillsDiscovery::ConventionAt {
                    dir: ".agents/skills".into(),
                },
            ),
            (".claude", SkillsDiscovery::Convention),
        ] {
            let result = std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command",
                    "$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path $env:PROJECTA_TEST_LINK -Target $env:PROJECTA_TEST_TARGET | Out-Null"])
                .env("PROJECTA_TEST_LINK", worktree.join(name))
                .env("PROJECTA_TEST_TARGET", &outside)
                .output().expect("create Windows junction");
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
            let error =
                skills_path_for(&worktree, &capability).expect_err("junction must be refused");
            assert!(error.contains("outside the worktree"), "{error}");
            assert_eq!(
                std::fs::read_to_string(&sentinel).expect("sentinel remains"),
                "not ours"
            );
        }
    }

    #[test]
    fn the_other_capabilities_keep_the_destination_they_had() {
        let worktree = Path::new("/tmp/wt");
        assert_eq!(
            skills_path_for(worktree, &SkillsDiscovery::Convention),
            Ok(Some(SkillsDest(skills_path(worktree))))
        );
        // A flag says where to look, not where to put them.
        assert_eq!(
            skills_path_for(
                worktree,
                &SkillsDiscovery::Flag {
                    flag: "--skills-dir".into()
                }
            ),
            Ok(Some(SkillsDest(skills_path(worktree))))
        );
        // Nothing to read means nothing to copy - the caller skips the work,
        // and this is `Ok`, not an error: it is the normal case for codex.
        assert_eq!(
            skills_path_for(worktree, &SkillsDiscovery::Unsupported),
            Ok(None)
        );
    }

    #[test]
    fn a_missing_resource_directory_is_a_clean_error() {
        let dir = TempDir::new("skills-missing");
        let err = install(&dir.path().join("nope"), &conventional(dir.path()), None)
            .expect_err("must fail");
        assert!(err.contains("failed to read"), "{err}");
    }
}
