//! Rewind planner (V2-B8a): plans a rewind to a checkpoint, never executes it.
//!
//! The planner is pure: ancestry comes in as a closure, nothing touches git.
//! By construction a plan never loses work: whenever a commit that is not yet
//! pushed or a dirty tree would become unreachable, the first real step pins
//! the current state under `refs/projecta/sicherung/<run>/<n>`, and the reset
//! is always the last step. The shared stash is never planned (AGENTS.md).
#![allow(dead_code)] // V2-B8a: pure core, wired by a later package

/// One step of a rewind, as data for a later executor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Schritt {
    /// `git update-ref <name> <sha>`. `sha` is `HEAD` when it follows a
    /// `WipCommit`, whose sha does not exist yet at planning time.
    SicherungsrefAnlegen { name: String, sha: String },
    /// Commit the dirty working tree as a WIP commit.
    WipCommit,
    /// `git reset --hard <sha>`.
    ZuruecksetzenAuf { sha: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ergebnis {
    Plan { schritte: Vec<Schritt> },
    Abgelehnt { grund: String },
}

pub struct Eingabe<'a> {
    pub head: &'a str,
    pub ziel: &'a str,
    /// Commits reachable from HEAD but not from the upstream.
    pub ungepusht: &'a [String],
    pub schmutzig: bool,
    pub lauf: &'a str,
    /// Backup number within the run; the caller picks one that is still free,
    /// because `update-ref` would silently overwrite an earlier backup.
    pub sicherung_nr: u32,
}

fn abgelehnt(grund: &str) -> Ergebnis {
    Ergebnis::Abgelehnt {
        grund: grund.to_string(),
    }
}

fn sha_gueltig(sha: &str) -> bool {
    (7..=64).contains(&sha.len()) && sha.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The subset of `git check-ref-format` that matters for names built here.
pub fn ref_name_gueltig(name: &str) -> bool {
    !name.is_empty()
        && !name.contains("..")
        && !name.contains("@{")
        && !name.contains("//")
        && !name.starts_with('/')
        && !name.ends_with(['/', '.'])
        && !name
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || "~^:?*[\\".contains(c))
        && name
            .split('/')
            .all(|teil| !teil.starts_with('.') && !teil.ends_with(".lock"))
}

/// Plans a rewind of `eingabe.head` to `eingabe.ziel`.
///
/// `ist_vorfahre(a, b)` answers whether `a` is reachable from `b` (a commit
/// counts as its own ancestor).
pub fn plane(eingabe: &Eingabe, ist_vorfahre: impl Fn(&str, &str) -> bool) -> Ergebnis {
    if !sha_gueltig(eingabe.head) || !sha_gueltig(eingabe.ziel) {
        return abgelehnt("Ungültige Commit-Kennung (erwartet: 7 bis 64 Hex-Zeichen)");
    }
    let name = format!(
        "refs/projecta/sicherung/{}/{}",
        eingabe.lauf, eingabe.sicherung_nr
    );
    if eingabe.lauf.is_empty() || eingabe.lauf.contains('/') || !ref_name_gueltig(&name) {
        return abgelehnt("Ungültige Lauf-Kennung für die Sicherungsreferenz");
    }
    if eingabe.ziel == eingabe.head && !eingabe.schmutzig {
        return Ergebnis::Plan {
            schritte: Vec::new(),
        };
    }
    if !ist_vorfahre(eingabe.ziel, eingabe.head) {
        return abgelehnt("Ziel liegt nicht in der Geschichte dieses Zweigs");
    }
    // Unpushed commits that the target still contains survive the reset.
    let verliert_commits = eingabe
        .ungepusht
        .iter()
        .any(|c| !ist_vorfahre(c, eingabe.ziel));
    let mut schritte = Vec::new();
    if eingabe.schmutzig {
        schritte.push(Schritt::WipCommit);
    }
    if eingabe.schmutzig || verliert_commits {
        let sha = if eingabe.schmutzig {
            "HEAD"
        } else {
            eingabe.head
        };
        schritte.push(Schritt::SicherungsrefAnlegen {
            name,
            sha: sha.to_string(),
        });
    }
    schritte.push(Schritt::ZuruecksetzenAuf {
        sha: eingabe.ziel.to_string(),
    });
    Ergebnis::Plan { schritte }
}

#[cfg(test)]
mod tests {
    use super::*;

    const C1: &str = "1111111";
    const C2: &str = "2222222";
    const C3: &str = "3333333";
    const OTHER: &str = "9999999";

    /// History `C1 <- C2 <- C3`; `OTHER` is on no branch.
    fn linear(a: &str, b: &str) -> bool {
        let rang = |s: &str| [C1, C2, C3].iter().position(|c| *c == s);
        matches!((rang(a), rang(b)), (Some(x), Some(y)) if x <= y)
    }

    fn eingabe<'a>(ziel: &'a str, ungepusht: &'a [String], schmutzig: bool) -> Eingabe<'a> {
        Eingabe {
            head: C3,
            ziel,
            ungepusht,
            schmutzig,
            lauf: "run-1",
            sicherung_nr: 1,
        }
    }

    fn ref_name() -> String {
        "refs/projecta/sicherung/run-1/1".to_string()
    }

    fn reset(sha: &str) -> Schritt {
        Schritt::ZuruecksetzenAuf {
            sha: sha.to_string(),
        }
    }

    fn schritte(e: Ergebnis) -> Vec<Schritt> {
        match e {
            Ergebnis::Plan { schritte } => schritte,
            Ergebnis::Abgelehnt { grund } => panic!("unexpected rejection: {grund}"),
        }
    }

    #[test]
    fn unpushed_commits_get_a_backup_ref_first() {
        let ungepusht = vec![C3.to_string(), C2.to_string()];
        let plan = schritte(plane(&eingabe(C1, &ungepusht, false), linear));
        let backup = Schritt::SicherungsrefAnlegen {
            name: ref_name(),
            sha: C3.to_string(),
        };
        assert_eq!(plan, vec![backup, reset(C1)]);
    }

    #[test]
    fn dirty_tree_is_committed_then_backed_up_then_reset() {
        let plan = schritte(plane(&eingabe(C2, &[], true), linear));
        let backup = Schritt::SicherungsrefAnlegen {
            name: ref_name(),
            sha: "HEAD".to_string(),
        };
        assert_eq!(plan, vec![Schritt::WipCommit, backup, reset(C2)]);
    }

    #[test]
    fn dirty_tree_at_the_target_is_still_saved() {
        let plan = schritte(plane(&eingabe(C3, &[], true), linear));
        assert_eq!(plan.first(), Some(&Schritt::WipCommit));
        assert_eq!(plan.last(), Some(&reset(C3)));
        assert_eq!(plan.len(), 3);
    }

    #[test]
    fn clean_and_fully_pushed_only_resets() {
        let plan = schritte(plane(&eingabe(C2, &[], false), linear));
        assert_eq!(plan, vec![reset(C2)]);
    }

    #[test]
    fn unpushed_commits_below_the_target_need_no_backup() {
        let ungepusht = vec![C2.to_string()];
        let plan = schritte(plane(&eingabe(C2, &ungepusht, false), linear));
        assert_eq!(plan, vec![reset(C2)]);
    }

    #[test]
    fn target_outside_the_history_is_rejected() {
        let ergebnis = plane(&eingabe(OTHER, &[], false), linear);
        let grund = "Ziel liegt nicht in der Geschichte dieses Zweigs".to_string();
        assert_eq!(ergebnis, Ergebnis::Abgelehnt { grund });
    }

    #[test]
    fn target_equal_to_head_and_clean_is_an_empty_plan() {
        assert_eq!(schritte(plane(&eingabe(C3, &[], false), linear)), vec![]);
    }

    #[test]
    fn invalid_run_ids_are_rejected() {
        for lauf in [
            "", "a b", "a..b", "a/b", "a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b", "a@{b",
            "x.lock",
        ] {
            let e = Eingabe {
                lauf,
                ..eingabe(C1, &[], false)
            };
            assert!(
                matches!(plane(&e, linear), Ergebnis::Abgelehnt { .. }),
                "{lauf:?}"
            );
        }
    }

    #[test]
    fn invalid_commit_ids_are_rejected() {
        for sha in ["", "--hard", "zzzzzzz", "abc"] {
            let e = Eingabe {
                ziel: sha,
                ..eingabe(C1, &[], false)
            };
            assert!(
                matches!(plane(&e, |_, _| true), Ergebnis::Abgelehnt { .. }),
                "{sha:?}"
            );
        }
    }

    #[test]
    fn plans_never_contain_a_stash_and_always_end_with_the_reset() {
        let ungepusht = [C3.to_string()];
        for (ziel, liste, schmutzig) in [
            (C1, &ungepusht[..], false),
            (C2, &[][..], true),
            (C3, &[][..], true),
        ] {
            let plan = schritte(plane(&eingabe(ziel, liste, schmutzig), linear));
            assert!(!format!("{plan:?}").to_lowercase().contains("stash"));
            assert_eq!(plan.last(), Some(&reset(ziel)));
            let backup = plan
                .iter()
                .position(|s| matches!(s, Schritt::SicherungsrefAnlegen { .. }));
            let wip = plan.iter().position(|s| *s == Schritt::WipCommit);
            assert!(backup.is_some_and(|b| b < plan.len() - 1));
            assert!(wip.is_none_or(|w| backup.is_some_and(|b| w < b)));
        }
    }

    #[test]
    fn ref_names_follow_git_rules() {
        assert!(ref_name_gueltig("refs/projecta/sicherung/run-1/1"));
        for name in [
            "", "a..b", "a b", "a~", "a^", "a:b", "a?", "a*", "a[", "a\\b", "/a", "a/", "a//b",
            "a.", "a/.b", "a.lock", "a\tb",
        ] {
            assert!(!ref_name_gueltig(name), "{name:?}");
        }
    }
}
