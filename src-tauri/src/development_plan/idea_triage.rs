//! Deterministic idea triage: duplicate hint, size, milestone and review tier
//! fixed before a ticket exists. Pure: no model call, no persistence. A model
//! suggestion is only recorded (`suggested`), it never changes a field.
//! The tier rules mirror `src/lib/reviewClass.ts`; change both together.

/// Titles whose token sets overlap at least this much (Jaccard) are duplicates.
const DUPLICATE_JACCARD_MIN: f64 = 0.6;
/// Size bands in diff lines (`docs/plan/v2.0/plan.md` rule 7: M is at most 300).
const SMALL_MAX: u32 = 100;
const MEDIUM_MAX: u32 = 300;

#[derive(Debug, Clone, Default)]
pub struct Idea {
    pub id: String,
    pub title: String,
    #[allow(dead_code)] // carried for the V2-S04b summary; triage compares titles only
    pub body: String,
    pub touched_paths: Vec<String>,
    pub est_lines: Option<u32>,
    pub milestone_hint: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Known {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Size {
    S,
    M,
    /// No line estimate yet: treated as larger than M, never as a guess.
    L,
    Split,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    A,
    B,
    C,
}

#[derive(Debug, Clone, Default)]
pub struct ModelSuggestion {
    pub tier: Option<Tier>,
    pub size: Option<Size>,
    pub milestone: Option<String>,
    pub duplicate_of: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Triage {
    pub duplicate_of: Option<String>,
    pub size: Size,
    pub milestone: Option<String>,
    pub tier: Tier,
    pub suggested: bool,
    pub reasons: Vec<String>,
}

pub fn triage(idea: &Idea, known: &[Known], suggestion: Option<&ModelSuggestion>) -> Triage {
    let mut reasons = Vec::new();
    let duplicate_of = find_duplicate(idea, known, &mut reasons);
    let size = size_of(idea.est_lines, &mut reasons);
    let tier = tier_of(&idea.touched_paths, &mut reasons);
    let milestone = idea
        .milestone_hint
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(str::to_owned);
    if let Some(s) = suggestion {
        let said = (s.tier, s.size, &s.milestone, &s.duplicate_of);
        reasons.push(format!(
            "Modellvorschlag nur vermerkt, ändert kein Feld: {said:?}"
        ));
    }
    Triage {
        duplicate_of,
        size,
        milestone,
        tier,
        suggested: suggestion.is_some(),
        reasons,
    }
}

fn tokens(title: &str) -> std::collections::BTreeSet<String> {
    title
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.chars().count() >= 2)
        .map(str::to_owned)
        .collect()
}

fn find_duplicate(idea: &Idea, known: &[Known], reasons: &mut Vec<String>) -> Option<String> {
    let mine = tokens(&idea.title);
    let mut best: Option<(&Known, f64)> = None;
    for k in known.iter().filter(|k| k.id != idea.id) {
        let theirs = tokens(&k.title);
        let union = mine.union(&theirs).count();
        if union == 0 {
            continue;
        }
        let score = mine.intersection(&theirs).count() as f64 / union as f64;
        // Strictly greater: on a tie the earlier entry of `known` wins.
        if score >= DUPLICATE_JACCARD_MIN && best.is_none_or(|(_, b)| score > b) {
            best = Some((k, score));
        }
    }
    best.map(|(k, score)| {
        let pct = (score * 100.0).round();
        reasons.push(format!("Dublette von {}: {pct} % Titelüberlappung", k.id));
        k.id.clone()
    })
}

fn size_of(est_lines: Option<u32>, reasons: &mut Vec<String>) -> Size {
    let (size, why) = match est_lines {
        None => (Size::L, "Größe L: keine Zeilenschätzung".to_owned()),
        Some(n) if n <= SMALL_MAX => (Size::S, format!("Größe S: {n} Zeilen")),
        Some(n) if n <= MEDIUM_MAX => (Size::M, format!("Größe M: {n} Zeilen")),
        Some(_) => (
            Size::Split,
            "größer als M: vor dem Ticket teilen".to_owned(),
        ),
    };
    reasons.push(why);
    size
}

/// Review class of one path; `Unknown` (no rule matches) ranks just below `A` and counts as `A`.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Class {
    C,
    B,
    Unknown,
    A,
}

// Space-separated lists keep rustfmt from exploding them; same content as reviewClass.ts.
const SEAM_FILES: &str = "src-tauri/src/api.rs src-tauri/src/main.rs src-tauri/src/store.rs src-tauri/src/pty.rs src-tauri/src/bin/pa.rs";
const A_PREFIXES: &str = "src-tauri/src/store/ src-tauri/src/pty/ src-tauri/src/process_capture/ src-tauri/capabilities/";
const A_NAMES: &str = "capabilit credential agent_access security secret redact setupgate estop emergency_stop db_restore supervisor concurren mutex lock";
const CODE_DIRS: &str = "src/ src-tauri/ scripts/ .github/ .claude/ .githooks/";
const TEST_SUFFIXES: &str = ".test.js .test.jsx .test.ts .test.tsx _test.rs _tests.rs .snap";

fn any_of(list: &str, f: impl Fn(&str) -> bool) -> bool {
    list.split(' ').any(f)
}

fn has_dir(path: &str, dirs: &str) -> bool {
    any_of(dirs, |d| {
        path.starts_with(&format!("{d}/")) || path.contains(&format!("/{d}/"))
    })
}

fn classify(raw: &str) -> Class {
    let path = raw.replace('\\', "/");
    let path = path.strip_prefix("./").unwrap_or(&path);
    let name = path.rsplit('/').next().unwrap_or(path);
    if any_of(TEST_SUFFIXES, |s| path.ends_with(s))
        || has_dir(path, "tests __snapshots__ snapshots")
    {
        return Class::C;
    }
    let code = any_of(".rs .ts .tsx .sql", |e| name.ends_with(e));
    if any_of(SEAM_FILES, |f| f == path)
        || any_of(A_PREFIXES, |p| path.starts_with(p))
        || has_dir(path, "migrations")
        || (code && any_of(A_NAMES, |n| name.contains(n)))
    {
        return Class::A;
    }
    if path.ends_with(".md") {
        return if any_of(CODE_DIRS, |d| path.starts_with(d)) {
            Class::Unknown
        } else {
            Class::C
        };
    }
    let rs = path.starts_with("src-tauri/src/") && path.ends_with(".rs");
    let ts = path.starts_with("src/") && any_of(".ts .tsx", |e| path.ends_with(e));
    if rs || ts {
        Class::B
    } else {
        Class::Unknown
    }
}

fn tier_of(paths: &[String], reasons: &mut Vec<String>) -> Tier {
    let top = paths
        .iter()
        .map(|p| (classify(p), p))
        .reduce(|a, b| if b.0 > a.0 { b } else { a });
    let Some((class, path)) = top else {
        reasons.push("Stufe A: keine Pfade angegeben, wie A behandelt".to_owned());
        return Tier::A;
    };
    let tier = match class {
        Class::A | Class::Unknown => Tier::A,
        Class::B => Tier::B,
        Class::C => Tier::C,
    };
    reasons.push(format!("Stufe {tier:?} wegen {path}"));
    tier
}

#[cfg(test)]
mod tests {
    use super::*;

    #[rustfmt::skip]
    fn idea(title: &str, paths: &[&str], est: Option<u32>) -> Idea {
        Idea { id: "I-30".into(), title: title.into(), touched_paths: paths.iter().map(|p| p.to_string()).collect(), est_lines: est, ..Default::default() }
    }
    #[rustfmt::skip]
    fn known(id: &str, title: &str) -> Known { Known { id: id.into(), title: title.into() } }
    fn run(paths: &[&str], est: Option<u32>) -> Triage {
        triage(&idea("x", paths, est), &[], None)
    }
    fn has(t: &Triage, part: &str) -> bool {
        t.reasons.iter().any(|r| r.contains(part))
    }

    #[test]
    fn a_near_duplicate_title_sets_duplicate_of() {
        let list = [
            known("I-04", "Export logs as zip"),
            known("I-21", "Dark mode for settings page"),
        ];
        let title = "Dark mode for the settings page";
        let t = triage(&idea(title, &[], None), &list, None);
        assert_eq!(t.duplicate_of.as_deref(), Some("I-21"));
        assert!(has(&t, "I-21") && has(&t, "83 %"));
        // The idea itself and unrelated titles never match.
        let own = [known("I-30", title), known("I-04", "Export logs")];
        assert_eq!(
            triage(&idea(title, &[], None), &own, None).duplicate_of,
            None
        );
    }

    #[test]
    fn four_hundred_fifty_lines_is_split_and_the_size_bands_follow_the_m_rule() {
        let t = run(&["docs/x.md"], Some(450));
        assert_eq!(t.size, Size::Split);
        assert!(has(&t, "größer als M: vor dem Ticket teilen"));
        let got = [100, 101, 300, 301].map(|n| run(&[], Some(n)).size);
        assert_eq!(got, [Size::S, Size::M, Size::M, Size::Split]);
        assert_eq!(run(&[], None).size, Size::L);
    }

    #[test]
    fn a_path_under_the_store_dir_is_tier_a() {
        let t = run(&["docs/x.md", "src-tauri/src/store/ideas.rs"], Some(50));
        assert_eq!(t.tier, Tier::A);
        assert!(has(&t, "store/ideas.rs"));
    }

    #[test]
    fn docs_only_is_tier_c() {
        assert_eq!(run(&["docs/a.md", "src/a.test.ts"], None).tier, Tier::C);
    }

    #[test]
    fn other_code_is_b_and_unmatched_or_missing_paths_count_as_a() {
        let tier = |p: &[&str]| run(p, None).tier;
        assert_eq!(tier(&["src-tauri/src/digest.rs", "docs/x.md"]), Tier::B);
        assert_eq!(tier(&["src-tauri/src/digest.rs", "package.json"]), Tier::A);
        assert_eq!(tier(&["src-tauri/src/redact_helper.rs"]), Tier::A);
        assert_eq!(tier(&[]), Tier::A);
    }

    #[test]
    fn a_model_suggestion_cannot_lower_a_seam_tier_or_change_any_field() {
        let mut i = idea("Seam work", &["src-tauri/src/api.rs"], Some(450));
        i.milestone_hint = Some(" M5 ".into());
        let sug = ModelSuggestion {
            tier: Some(Tier::C),
            size: Some(Size::S),
            ..Default::default()
        };
        let (plain, with) = (triage(&i, &[], None), triage(&i, &[], Some(&sug)));
        assert_eq!((with.tier, with.size), (Tier::A, Size::Split));
        assert_eq!(with.milestone.as_deref(), Some("M5"));
        assert!(with.suggested && !plain.suggested && has(&with, "Modellvorschlag"));
    }
}
