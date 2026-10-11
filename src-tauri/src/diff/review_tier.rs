//! Review tier of a diff from its file paths (AGENTS.md rule 5).
//!
//! Mirror of `src/lib/reviewClass.ts`: both read the same fixture
//! (`src/lib/review-tier-fixture.json`), so the two classifiers cannot drift.
//! Pure functions, no I/O. This is a review class, not a safety rating.

/// Review tier. `Unknown` ranks just below `A` and is treated like it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(test), allow(dead_code))] // V2-B9a: no runtime caller yet
pub enum Tier {
    A,
    B,
    C,
    Unknown,
}

const CODE_DIRS: [&str; 6] = [
    "src/",
    "src-tauri/",
    "scripts/",
    ".github/",
    ".claude/",
    ".githooks/",
];
const SEAM_FILES: [&str; 5] = [
    "src-tauri/src/api.rs",
    "src-tauri/src/main.rs",
    "src-tauri/src/store.rs",
    "src-tauri/src/pty.rs",
    "src-tauri/src/bin/pa.rs",
];
const A_PREFIXES: [&str; 4] = [
    "src-tauri/src/store/",
    "src-tauri/src/pty/",
    "src-tauri/src/process_capture/",
    "src-tauri/capabilities/",
];
/// Whole name tokens of the file stem, joined with `_` (see `name_tokens`); an entry with
/// `_` is a token sequence. `clock`, `blockingQueue` and `deadlock` do not contain the
/// token `lock`, so they stay B. Inflections the old substring matcher caught (`locked`,
/// `redactions`, `secrecy`, ...) are listed one by one.
const A_NAMES: [&str; 40] = [
    "capability",
    "capabilities",
    "credential",
    "credentials",
    "agent_access",
    "security",
    "secret",
    "secrets",
    "redact",
    "redacted",
    "redaction",
    "redactor",
    "setupgate",
    "setup_gate",
    "estop",
    "emergency_stop",
    "db_restore",
    "supervisor",
    "concurrency",
    "concurrent",
    "mutex",
    "lock",
    "locks",
    "locked",
    "locking",
    "locker",
    "lockers",
    "redacts",
    "redacting",
    "redactions",
    "redactors",
    "secrecy",
    "credentialed",
    "concurrently",
    "concurrencies",
    "supervisors",
    "mutexes",
    "estops",
    "setup_gates",
    "setupgates",
];

/// True when `path` starts with, or contains after a `/`, the directory `dir/`.
fn in_dir(path: &str, dirs: &[&str]) -> bool {
    path.split('/').rev().skip(1).any(|seg| dirs.contains(&seg))
}

/// Lower-case tokens of a file stem, split on `.`, `_`, `-` and camelCase boundaries
/// (`DBRestore` -> `db`, `restore`), joined by `_`. Mirror of `nameTokens` in the TS side.
fn name_tokens(file_name: &str) -> String {
    let stem = file_name
        .rsplit_once('.')
        .map_or(file_name, |(stem, _)| stem);
    let chars: Vec<char> = stem.chars().collect();
    let mut out = String::new();
    for (i, &c) in chars.iter().enumerate() {
        if !c.is_ascii_alphanumeric() {
            if !out.ends_with('_') {
                out.push('_');
            }
            continue;
        }
        let prev = i.checked_sub(1).map(|j| chars[j]);
        let next = chars.get(i + 1).copied();
        let lower_to_upper = c.is_ascii_uppercase()
            && prev.is_some_and(|p| p.is_ascii_lowercase() || p.is_ascii_digit());
        let acronym_end = c.is_ascii_uppercase()
            && prev.is_some_and(|p| p.is_ascii_uppercase())
            && next.is_some_and(|n| n.is_ascii_lowercase());
        if (lower_to_upper || acronym_end) && !out.ends_with('_') {
            out.push('_');
        }
        out.push(c.to_ascii_lowercase());
    }
    out
}

/// True when a whole name token (sequence) of `file_name` is in `A_NAMES`.
fn has_a_name(file_name: &str) -> bool {
    let tokens = format!("_{}_", name_tokens(file_name));
    A_NAMES.iter().any(|n| tokens.contains(&format!("_{n}_")))
}

/// Non-empty stem before `ext` (the TS regexes use `.+`).
fn has_stem(s: &str, ext: &str) -> bool {
    s.strip_suffix(ext).is_some_and(|stem| !stem.is_empty())
}

/// Tier of one path.
#[cfg_attr(not(test), allow(dead_code))] // V2-B9a: no runtime caller yet
pub fn classify_path(raw: &str) -> Tier {
    let norm = raw.replace('\\', "/");
    let path = norm.strip_prefix("./").unwrap_or(&norm);
    let name = path.rsplit('/').next().unwrap_or(path);
    let is_test_name = [".snap", "_test.rs", "_tests.rs"]
        .iter()
        .any(|e| path.ends_with(e))
        || [".js", ".jsx", ".ts", ".tsx"]
            .iter()
            .any(|e| path.ends_with(&format!(".test{e}")));
    if is_test_name || in_dir(path, &["tests", "__snapshots__", "snapshots"]) {
        return Tier::C;
    }
    let code_ext = [".rs", ".ts", ".tsx", ".sql"]
        .iter()
        .any(|e| path.ends_with(e));
    if SEAM_FILES.contains(&path)
        || A_PREFIXES.iter().any(|p| path.starts_with(p))
        || in_dir(path, &["migrations"])
        || (code_ext && has_a_name(name))
    {
        return Tier::A;
    }
    if path.ends_with(".md") {
        return if CODE_DIRS.iter().any(|d| path.starts_with(d)) {
            Tier::Unknown
        } else {
            Tier::C
        };
    }
    let rs = path
        .strip_prefix("src-tauri/src/")
        .is_some_and(|r| has_stem(r, ".rs"));
    let ts = path
        .strip_prefix("src/")
        .is_some_and(|r| has_stem(r, ".ts") || has_stem(r, ".tsx"));
    if rs || ts {
        Tier::B
    } else {
        Tier::Unknown
    }
}

fn rank(t: Tier) -> u8 {
    match t {
        Tier::C => 0,
        Tier::B => 1,
        Tier::Unknown => 2,
        Tier::A => 3,
    }
}

/// Highest single tier of a diff; `None` for an empty diff.
#[cfg_attr(not(test), allow(dead_code))] // V2-B9a: no runtime caller yet
pub fn review_tier(paths: &[&str]) -> Option<Tier> {
    paths
        .iter()
        .map(|p| classify_path(p))
        .max_by_key(|t| rank(*t))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Row {
        paths: Vec<String>,
        tier: Option<String>,
    }

    fn name(tier: Option<Tier>) -> Option<&'static str> {
        tier.map(|t| match t {
            Tier::A => "A",
            Tier::B => "B",
            Tier::C => "C",
            Tier::Unknown => "unknown",
        })
    }

    #[test]
    fn review_tier_matches_shared_fixture() {
        // Deliberate cross-tree include: the fixture lives in the frontend tree so
        // both classifiers read one file. Monorepo, test cfg only: the crate is
        // never packaged or built standalone.
        let rows: Vec<Row> =
            serde_json::from_str(include_str!("../../../src/lib/review-tier-fixture.json"))
                .unwrap();
        assert_eq!(
            rows.len(),
            73,
            "fixture row count changed: update both tests"
        );
        for row in rows {
            let paths: Vec<&str> = row.paths.iter().map(String::as_str).collect();
            assert_eq!(
                name(review_tier(&paths)),
                row.tier.as_deref(),
                "paths {:?}",
                row.paths
            );
        }
    }

    #[test]
    fn review_tier_name_match_is_whole_token() {
        for p in [
            "src-tauri/src/clock.rs",
            "src/lib/blockingQueue.ts",
            "src/lib/deadlock.ts",
            "src/lib/unlock.ts",
            "src-tauri/src/pty_reader.rs",
        ] {
            assert_eq!(review_tier(&[p]), Some(Tier::B), "{p}");
        }
        for p in [
            "src-tauri/src/lock.rs",
            "src-tauri/src/file_lock.rs",
            "src/lib/secretStore.ts",
            "src/lib/SecretStore.ts",
            "src/lib/file-lock.ts",
            "src-tauri/src/concurrency.rs",
            "src/lib/Concurrent.ts",
            "src/lib/SetupGate.ts",
            "src-tauri/src/DBRestore.rs",
        ] {
            assert_eq!(review_tier(&[p]), Some(Tier::A), "{p}");
        }
    }

    #[test]
    fn review_tier_name_inflections_are_a() {
        for p in [
            "src-tauri/src/locked.rs",
            "src/lib/locking.ts",
            "src/lib/FileLocked.ts",
            "src-tauri/src/lock_.rs",
            "src-tauri/src/_lock.rs",
            "src-tauri/src/redactions.rs",
            "src/lib/secrecy.ts",
            "src-tauri/src/mutexes.rs",
            "src-tauri/src/concurrently.rs",
            "src-tauri/src/supervisors.rs",
        ] {
            assert_eq!(review_tier(&[p]), Some(Tier::A), "{p}");
        }
        for p in [
            "src-tauri/src/clocked.rs",
            "src-tauri/src/blocked.rs",
            "src-tauri/src/unlocked.rs",
        ] {
            assert_eq!(review_tier(&[p]), Some(Tier::B), "{p}");
        }
    }

    #[test]
    fn review_tier_seam_paths_are_a() {
        for p in [
            "src-tauri/src/api.rs",
            "src-tauri/src/main.rs",
            "src-tauri/src/store.rs",
            "src-tauri/src/store/x.rs",
            "src-tauri/src/bin/pa.rs",
        ] {
            assert_eq!(review_tier(&[p]), Some(Tier::A), "{p}");
        }
    }

    #[test]
    fn review_tier_docs_only_is_c_and_ordinary_code_is_b() {
        assert_eq!(review_tier(&["docs/PLAN.md", "STAND.md"]), Some(Tier::C));
        assert_eq!(
            review_tier(&["docs/PLAN.md", "src/lib/diff.ts"]),
            Some(Tier::B)
        );
        assert_eq!(
            review_tier(&["src/lib/diff.ts", "Cargo.lock"]),
            Some(Tier::Unknown)
        );
        assert_eq!(review_tier(&[]), None);
    }
}
