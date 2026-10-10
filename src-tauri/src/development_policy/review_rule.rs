//! Foreign-review rule core: model name -> vendor family, and "no model
//! reviews its own family". Pure: no persistence, no provider lookup, no UI.
//! `store/development_runs.rs` (`attest_reviewer`) compares launch-route
//! providers of recorded runs; this module judges plain model names before a
//! run exists, so it cannot reuse that function.

use std::borrow::Cow;

/// Review tier of a package (`AGENTS.md` rule 5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    A,
    B,
    C,
}

/// Vendor family of a model. Meta also covers local Llama/Ollama models.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Family {
    Anthropic,
    OpenAi,
    Moonshot,
    Zhipu,
    Google,
    Xai,
    Meta,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuleError {
    /// The author's family is unknown, so no reviewer can be called foreign.
    UnknownAuthor,
    /// Fewer foreign families than the tier needs.
    TooFewForeign { needed: usize, found: usize },
}

/// User-facing error texts (German), the single place to change them.
pub mod texts {
    pub const UNKNOWN_AUTHOR: &str = "Die Modellfamilie des Autors ist unbekannt. Ohne sie kann keine unabhängige Prüfung nachgewiesen werden.";
    pub const NEED_ONE: &str = "Es fehlt ein Prüfer aus einer anderen Modellfamilie als der des Autors. Unbekannte Modelle und gleiche Familien zählen nicht.";
    pub const NEED_TWO: &str = "Stufe A braucht zwei Prüfer aus zwei verschiedenen Modellfamilien, die beide nicht die des Autors sind. Unbekannte Modelle und gleiche Familien zählen nicht.";
}

impl RuleError {
    pub fn user_text(&self) -> Cow<'static, str> {
        match self {
            Self::UnknownAuthor => Cow::Borrowed(texts::UNKNOWN_AUTHOR),
            Self::TooFewForeign { needed: 1, .. } => Cow::Borrowed(texts::NEED_ONE),
            Self::TooFewForeign { needed: 2, .. } => Cow::Borrowed(texts::NEED_TWO),
            Self::TooFewForeign { needed, found } => Cow::Owned(format!(
                "Es fehlen Prüfer aus anderen Modellfamilien: benötigt {needed}, nachgewiesen {found}."
            )),
        }
    }
}

/// First-word prefixes per family. Prefixes of different families must never
/// overlap (`prefixes_of_different_families_never_overlap`), so the lookup
/// order cannot change which family a name belongs to.
const PREFIXES: &[(&str, Family)] = &[
    ("claude", Family::Anthropic),
    ("opus", Family::Anthropic),
    ("sonnet", Family::Anthropic),
    ("haiku", Family::Anthropic),
    ("fable", Family::Anthropic),
    ("gpt", Family::OpenAi),
    ("codex", Family::OpenAi),
    ("kimi", Family::Moonshot),
    ("glm", Family::Zhipu),
    ("gemini", Family::Google),
    ("grok", Family::Xai),
    ("llama", Family::Meta),
    ("ollama", Family::Meta),
];

/// Vendor family of a model name; `None` when the name is not recognised.
/// Matches the first word of the last path segment (`ollama/llama3` -> `llama3`)
/// case-insensitively, so tags like `:cloud` or `-20251001` do not matter.
pub fn family_of(model: &str) -> Option<Family> {
    let lower = model.trim().to_ascii_lowercase();
    let name = lower.rsplit('/').next().unwrap_or_default();
    let word = name
        .split(['-', ':', '.', '_', ' '])
        .next()
        .unwrap_or_default();
    // o-series: `o` plus digits only (o1, o3, o4), never `orca` or `ocean`.
    let o_series =
        word.len() > 1 && word.starts_with('o') && word[1..].bytes().all(|b| b.is_ascii_digit());
    if o_series {
        return Some(Family::OpenAi);
    }
    PREFIXES
        .iter()
        .find(|(prefix, _)| word.starts_with(prefix))
        .map(|(_, family)| *family)
}

/// Tier A needs two reviewers from two different families other than the
/// author's, Tier B one, Tier C none. Unknown families never count as other;
/// for Tier A/B an unknown author family fails closed.
pub fn check_reviewers(
    author_model: &str,
    reviewer_models: &[&str],
    tier: Tier,
) -> Result<(), RuleError> {
    let needed = match tier {
        Tier::A => 2,
        Tier::B => 1,
        Tier::C => return Ok(()),
    };
    let author = family_of(author_model).ok_or(RuleError::UnknownAuthor)?;
    let foreign: std::collections::BTreeSet<Family> = reviewer_models
        .iter()
        .filter_map(|m| family_of(m))
        .filter(|f| *f != author)
        .collect();
    if foreign.len() < needed {
        return Err(RuleError::TooFewForeign {
            needed,
            found: foreign.len(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLAUDE_AUTHOR: &str = "claude-sonnet-5-5";

    #[test]
    fn family_of_maps_known_vendors() {
        let cases = [
            ("claude-opus-5-5", Family::Anthropic),
            ("Sonnet-5.5", Family::Anthropic),
            ("claude-haiku-4-5-20251001", Family::Anthropic),
            ("fable-5.1", Family::Anthropic),
            ("gpt-6-astra", Family::OpenAi),
            ("codex-mini", Family::OpenAi),
            ("o3-mini", Family::OpenAi),
            ("kimi-k3:cloud", Family::Moonshot),
            ("glm-5.2:cloud", Family::Zhipu),
            ("gemini-3-pro", Family::Google),
            ("grok-4", Family::Xai),
            ("llama3.1:8b", Family::Meta),
            ("ollama/llama3", Family::Meta),
        ];
        for (model, family) in cases {
            assert_eq!(family_of(model), Some(family), "{model}");
        }
    }

    #[test]
    fn family_of_unknown_is_none() {
        for model in ["", "  ", "mystery-1", "ocean-2", "o", "orca"] {
            assert_eq!(family_of(model), None, "{model:?}");
        }
    }

    #[test]
    fn same_family_reviewer_is_rejected() {
        let err = check_reviewers(CLAUDE_AUTHOR, &["claude-opus-5-5"], Tier::B).unwrap_err();
        assert_eq!(
            err,
            RuleError::TooFewForeign {
                needed: 1,
                found: 0
            }
        );
    }

    #[test]
    fn tier_a_with_one_foreign_reviewer_is_rejected() {
        let err = check_reviewers(
            CLAUDE_AUTHOR,
            &["glm-5.2:cloud", "claude-opus-5-5"],
            Tier::A,
        )
        .unwrap_err();
        assert_eq!(
            err,
            RuleError::TooFewForeign {
                needed: 2,
                found: 1
            }
        );
    }

    #[test]
    fn tier_a_with_two_reviewers_of_one_foreign_family_is_rejected() {
        let err =
            check_reviewers(CLAUDE_AUTHOR, &["gpt-6-astra", "codex-mini"], Tier::A).unwrap_err();
        assert_eq!(
            err,
            RuleError::TooFewForeign {
                needed: 2,
                found: 1
            }
        );
    }

    #[test]
    fn tier_a_glm_and_kimi_are_accepted_for_a_claude_author() {
        let reviewers = ["glm-5.2:cloud", "kimi-k3:cloud"];
        assert_eq!(check_reviewers(CLAUDE_AUTHOR, &reviewers, Tier::A), Ok(()));
    }

    #[test]
    fn unknown_model_does_not_count_as_other() {
        let err = check_reviewers(CLAUDE_AUTHOR, &["mystery-1"], Tier::B).unwrap_err();
        assert_eq!(
            err,
            RuleError::TooFewForeign {
                needed: 1,
                found: 0
            }
        );
        let err =
            check_reviewers(CLAUDE_AUTHOR, &["glm-5.2:cloud", "mystery-1"], Tier::A).unwrap_err();
        assert_eq!(
            err,
            RuleError::TooFewForeign {
                needed: 2,
                found: 1
            }
        );
    }

    #[test]
    fn tier_b_accepts_one_foreign_reviewer() {
        assert_eq!(
            check_reviewers(CLAUDE_AUTHOR, &["kimi-k3:cloud"], Tier::B),
            Ok(())
        );
    }

    #[test]
    fn tier_c_needs_no_reviewer() {
        assert_eq!(check_reviewers(CLAUDE_AUTHOR, &[], Tier::C), Ok(()));
        assert_eq!(check_reviewers("mystery-1", &[], Tier::C), Ok(()));
    }

    #[test]
    fn unknown_author_is_rejected_for_tier_a_and_b() {
        for tier in [Tier::A, Tier::B] {
            let err = check_reviewers("mystery-1", &["glm-5.2:cloud", "kimi-k3:cloud"], tier)
                .unwrap_err();
            assert_eq!(err, RuleError::UnknownAuthor);
        }
    }

    #[test]
    fn error_texts_are_german_and_distinct() {
        let errors = [
            RuleError::UnknownAuthor,
            RuleError::TooFewForeign {
                needed: 1,
                found: 0,
            },
            RuleError::TooFewForeign {
                needed: 2,
                found: 0,
            },
        ];
        let texts: Vec<_> = errors.iter().map(RuleError::user_text).collect();
        assert!(texts.iter().all(|t| t.contains("Modell")));
        assert!(texts[0] != texts[1] && texts[1] != texts[2]);
    }

    #[test]
    fn error_texts_are_pinned_per_variant() {
        let too_few = |needed, found| RuleError::TooFewForeign { needed, found };
        assert_eq!(RuleError::UnknownAuthor.user_text(), texts::UNKNOWN_AUTHOR);
        assert_eq!(too_few(1, 0).user_text(), texts::NEED_ONE);
        assert_eq!(too_few(2, 1).user_text(), texts::NEED_TWO);
        assert_eq!(
            too_few(3, 1).user_text(),
            "Es fehlen Prüfer aus anderen Modellfamilien: benötigt 3, nachgewiesen 1."
        );
    }

    #[test]
    fn prefixes_of_different_families_never_overlap() {
        for (a, family_a) in PREFIXES {
            for (b, family_b) in PREFIXES {
                assert!(
                    family_a == family_b || !a.starts_with(b),
                    "{a} ({family_a:?}) overlaps {b} ({family_b:?})"
                );
            }
        }
    }
}
