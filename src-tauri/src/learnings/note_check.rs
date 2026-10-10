//! Memory core: a note with its source, check date and confirmation, and a
//! re-check of that evidence against a tree.
//!
//! Pure logic. A note is only "Bestätigt" while every piece of evidence still
//! holds in the tree it is checked against; a note with no evidence is never
//! confirmed. No persistence, no git, no UI: [`TreeView`] is the seam a later
//! package backs with a real revision.
//!
//! Rules of [`recheck`]:
//! 1. No evidence: [`NoteState::NoEvidence`], whatever else the note says.
//! 2. A file line holds when the file exists and the snippet (trimmed) is part
//!    of the line at `line` or of a line within [`LINE_TOLERANCE`] lines of it.
//!    The nearest match wins and its line is reported. A blank snippet or one
//!    that spans several lines never matches.
//! 3. A commit holds when the tree still knows the sha.
//! 4. Any piece that does not hold makes the note [`NoteState::Stale`].

// Consumed by the Glass UI "Gedächtnis" screen; the first caller removes the
// allow below.
#![cfg_attr(not(test), allow(dead_code))]

use serde::{Deserialize, Serialize};

/// How many lines a snippet may have moved (up or down) and still count.
pub(crate) const LINE_TOLERANCE: u32 = 3;

/// One reason to believe a note. Lines are 1-based.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum Evidence {
    FileLine {
        path: String,
        line: u32,
        snippet: String,
    },
    Commit {
        sha: String,
    },
}

/// A remembered statement and what backs it. `checked_at` is unix seconds of
/// the last re-check; `confirmed_by` is who vouched for it, if anyone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Note {
    pub id: String,
    pub text: String,
    pub evidence: Vec<Evidence>,
    pub checked_at: i64,
    pub confirmed_by: Option<String>,
}

/// Read access to one revision of a tree.
pub(crate) trait TreeView {
    /// The file's text, or `None` if it does not exist (or is not text).
    fn read_file(&self, path: &str) -> Option<String>;
    /// Whether the revision knows this commit.
    fn has_commit(&self, sha: &str) -> bool;
}

/// Outcome of [`recheck`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum NoteState {
    /// "Bestätigt": all evidence holds. Carries the evidence with every file
    /// line moved to where its snippet was found now.
    Confirmed(Vec<Evidence>),
    /// "Veraltet": carries the evidence that no longer holds.
    Stale(Vec<Evidence>),
    /// "Ohne Beleg": nothing to check, so nothing to confirm.
    NoEvidence,
}

impl NoteState {
    /// The label the UI shows.
    pub(crate) fn label(&self) -> &'static str {
        match self {
            NoteState::Confirmed(_) => "Bestätigt",
            NoteState::Stale(_) => "Veraltet",
            NoteState::NoEvidence => "Ohne Beleg",
        }
    }
}

/// Re-check every piece of the note's evidence against `tree`.
pub(crate) fn recheck(note: &Note, tree: &dyn TreeView) -> NoteState {
    if note.evidence.is_empty() {
        return NoteState::NoEvidence;
    }
    let mut held = Vec::with_capacity(note.evidence.len());
    let mut broken = Vec::new();
    for ev in &note.evidence {
        match recheck_one(ev, tree) {
            Some(now) => held.push(now),
            None => broken.push(ev.clone()),
        }
    }
    if broken.is_empty() {
        NoteState::Confirmed(held)
    } else {
        NoteState::Stale(broken)
    }
}

/// The evidence as it reads in `tree` now, or `None` if it no longer holds.
fn recheck_one(ev: &Evidence, tree: &dyn TreeView) -> Option<Evidence> {
    match ev {
        Evidence::Commit { sha } => tree.has_commit(sha).then(|| ev.clone()),
        Evidence::FileLine {
            path,
            line,
            snippet,
        } => {
            let text = tree.read_file(path)?;
            let line = find_line(&text, *line, snippet)?;
            Some(Evidence::FileLine {
                path: path.clone(),
                line,
                snippet: snippet.clone(),
            })
        }
    }
}

/// The line nearest to `wanted` (within [`LINE_TOLERANCE`]) that holds the
/// snippet; on a tie the earlier line wins.
fn find_line(text: &str, wanted: u32, snippet: &str) -> Option<u32> {
    let snippet = snippet.trim();
    if snippet.is_empty() || snippet.contains('\n') {
        return None;
    }
    let lines: Vec<&str> = text.lines().collect();
    (0..=LINE_TOLERANCE)
        .flat_map(|d| [wanted.checked_sub(d), wanted.checked_add(d)])
        .flatten()
        .filter(|n| *n >= 1)
        .find(|n| {
            lines
                .get(*n as usize - 1)
                .is_some_and(|l| l.contains(snippet))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[derive(Default)]
    struct MemTree {
        files: BTreeMap<String, String>,
        commits: Vec<String>,
    }

    impl MemTree {
        fn with_file(mut self, path: &str, text: &str) -> Self {
            self.files.insert(path.into(), text.into());
            self
        }
    }

    impl TreeView for MemTree {
        fn read_file(&self, path: &str) -> Option<String> {
            self.files.get(path).cloned()
        }
        fn has_commit(&self, sha: &str) -> bool {
            self.commits.iter().any(|c| c == sha)
        }
    }

    fn file_line(path: &str, line: u32, snippet: &str) -> Evidence {
        Evidence::FileLine {
            path: path.into(),
            line,
            snippet: snippet.into(),
        }
    }

    fn note(evidence: Vec<Evidence>) -> Note {
        Note {
            id: "n1".into(),
            text: "the gate runs serially".into(),
            evidence,
            checked_at: 1_000,
            confirmed_by: None,
        }
    }

    const SRC: &str = "a\nb\nlet gate = serial();\nd\n";

    #[test]
    fn an_unmoved_line_is_confirmed_as_is() {
        let ev = file_line("src/x.rs", 3, "let gate = serial();");
        let tree = MemTree::default().with_file("src/x.rs", SRC);
        assert_eq!(
            recheck(&note(vec![ev.clone()]), &tree),
            NoteState::Confirmed(vec![ev])
        );
    }

    #[test]
    fn a_line_moved_two_lower_is_confirmed_with_the_new_line() {
        let ev = file_line("src/x.rs", 3, "let gate = serial();");
        let tree = MemTree::default().with_file("src/x.rs", &format!("new1\nnew2\n{SRC}"));
        let state = recheck(&note(vec![ev]), &tree);
        assert_eq!(
            state,
            NoteState::Confirmed(vec![file_line("src/x.rs", 5, "let gate = serial();")])
        );
        assert_eq!(state.label(), "Bestätigt");
    }

    #[test]
    fn a_line_moved_beyond_the_tolerance_is_stale() {
        let ev = file_line("src/x.rs", 3, "let gate = serial();");
        let tree = MemTree::default().with_file("src/x.rs", &format!("1\n2\n3\n4\n{SRC}"));
        assert_eq!(
            recheck(&note(vec![ev.clone()]), &tree),
            NoteState::Stale(vec![ev])
        );
    }

    #[test]
    fn a_gone_snippet_is_stale() {
        let ev = file_line("src/x.rs", 3, "let gate = serial();");
        let tree = MemTree::default().with_file("src/x.rs", "a\nb\nlet gate = parallel();\nd\n");
        let state = recheck(&note(vec![ev.clone()]), &tree);
        assert_eq!(state, NoteState::Stale(vec![ev]));
        assert_eq!(state.label(), "Veraltet");
    }

    #[test]
    fn a_deleted_file_is_stale() {
        let ev = file_line("src/gone.rs", 1, "x");
        assert_eq!(
            recheck(&note(vec![ev.clone()]), &MemTree::default()),
            NoteState::Stale(vec![ev])
        );
    }

    #[test]
    fn a_note_without_evidence_is_never_confirmed() {
        let mut n = note(vec![]);
        n.confirmed_by = Some("someone".into());
        let tree = MemTree::default();
        assert_eq!(recheck(&n, &tree), NoteState::NoEvidence);
        assert_eq!(recheck(&n, &tree).label(), "Ohne Beleg");
    }

    #[test]
    fn one_stale_piece_makes_the_whole_note_stale() {
        let good = file_line("src/x.rs", 3, "let gate = serial();");
        let bad = file_line("src/x.rs", 1, "not there");
        let tree = MemTree::default().with_file("src/x.rs", SRC);
        assert_eq!(
            recheck(&note(vec![good, bad.clone()]), &tree),
            NoteState::Stale(vec![bad])
        );
    }

    #[test]
    fn a_blank_snippet_never_matches() {
        let ev = file_line("src/x.rs", 1, "   ");
        let tree = MemTree::default().with_file("src/x.rs", SRC);
        assert_eq!(
            recheck(&note(vec![ev.clone()]), &tree),
            NoteState::Stale(vec![ev])
        );
    }

    #[test]
    fn a_commit_holds_only_while_the_tree_knows_it() {
        let ev = Evidence::Commit {
            sha: "abc123".into(),
        };
        let known = MemTree {
            commits: vec!["abc123".into()],
            ..MemTree::default()
        };
        assert_eq!(
            recheck(&note(vec![ev.clone()]), &known),
            NoteState::Confirmed(vec![ev.clone()])
        );
        assert_eq!(
            recheck(&note(vec![ev.clone()]), &MemTree::default()),
            NoteState::Stale(vec![ev])
        );
    }
}
