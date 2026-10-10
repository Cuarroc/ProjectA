//! Failover stage "lokal" (V2-B2b, core only, not wired yet): whether the
//! local Ollama can take over, and what the chain of V2-B2a does with that.
//! The probe itself (HTTP to the local server) is not part of this module.
//!
//! The local stage cannot be switched off, and when it is reached without
//! being ready the answer is "Pause statt Rechnung", never an API-key path.

use std::collections::HashMap;

use super::failover_rules::{ProviderState, RuleSet};

/// Registry id of the local stage's provider.
const LOCAL_ID: &str = "ollama";

/// What a probe of the local Ollama found.
#[derive(Debug, Clone, Default)]
pub struct LocalProbe {
    pub reachable: bool,
    pub models: Vec<String>,
    pub chosen_model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Readiness {
    Bereit { model: String },
    NichtBereit { reason: String },
}

/// What to do next with the chain.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step<'a> {
    /// Work on this provider (never the local one, never billed per call).
    Provider(&'a str),
    Local {
        model: String,
    },
    Pause {
        reason: String,
    },
}

pub struct LocalReadiness;

impl LocalReadiness {
    pub fn from_probe(probe: LocalProbe) -> Readiness {
        let not_ready = |reason: String| Readiness::NichtBereit { reason };
        if !probe.reachable {
            return not_ready("Ollama ist nicht erreichbar.".into());
        }
        let Some(chosen) = probe.chosen_model.filter(|m| !m.trim().is_empty()) else {
            return not_ready("Es ist kein lokales Modell gewählt.".into());
        };
        // Ollama reads a name without a tag as ":latest".
        let latest = format!("{chosen}:latest");
        let present = probe
            .models
            .iter()
            .any(|m| *m == chosen || (!chosen.contains(':') && *m == latest));
        if present {
            Readiness::Bereit { model: chosen }
        } else {
            not_ready(format!(
                "Das gewählte Modell „{chosen}“ ist in Ollama nicht vorhanden."
            ))
        }
    }
}

/// The local stage as a switch: always on.
pub struct LocalStage;

impl LocalStage {
    pub fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        if enabled {
            Ok(())
        } else {
            Err("Die lokale Stufe bleibt immer an".into())
        }
    }

    /// Walk `chain` with `rules` (see [`RuleSet::resolve`]); reaching the local
    /// provider uses it when `readiness` is `Bereit` and pauses otherwise.
    pub fn resolve<'a>(
        rules: &RuleSet,
        chain: &[&'a str],
        states: &HashMap<String, ProviderState>,
        readiness: &Readiness,
    ) -> Step<'a> {
        match (rules.resolve(chain, states), readiness) {
            (None, _) => Step::Pause {
                reason: "Pause statt Rechnung: Kein Anbieter ist frei.".into(),
            },
            (Some(LOCAL_ID), Readiness::Bereit { model }) => Step::Local {
                model: model.clone(),
            },
            (Some(LOCAL_ID), Readiness::NichtBereit { reason }) => Step::Pause {
                reason: format!("Pause statt Rechnung: {reason}"),
            },
            (Some(id), _) => Step::Provider(id),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::budget::failover_rules::Rule;

    const CHAIN: [&str; 3] = ["claude", "codex", "ollama"];

    fn probe(reachable: bool, models: &[&str], chosen: Option<&str>) -> LocalProbe {
        LocalProbe {
            reachable,
            models: models.iter().map(|m| m.to_string()).collect(),
            chosen_model: chosen.map(String::from),
        }
    }

    fn blocked(ids: &[&str]) -> HashMap<String, ProviderState> {
        let state = ProviderState {
            blocked: true,
            ..Default::default()
        };
        ids.iter()
            .map(|id| (id.to_string(), state.clone()))
            .collect()
    }

    fn ready() -> Readiness {
        LocalReadiness::from_probe(probe(true, &["qwen3:8b"], Some("qwen3:8b")))
    }

    fn not_ready(probe: LocalProbe) -> String {
        match LocalReadiness::from_probe(probe) {
            Readiness::NichtBereit { reason } => reason,
            other => panic!("expected NichtBereit, got {other:?}"),
        }
    }

    #[test]
    fn claude_and_codex_blocked_with_a_ready_local_model_use_local() {
        let step = LocalStage::resolve(
            &RuleSet::new(),
            &CHAIN,
            &blocked(&["claude", "codex"]),
            &ready(),
        );
        assert_eq!(
            step,
            Step::Local {
                model: "qwen3:8b".into()
            }
        );
        let step = LocalStage::resolve(&RuleSet::new(), &CHAIN, &blocked(&["claude"]), &ready());
        assert_eq!(step, Step::Provider("codex"));
    }

    #[test]
    fn local_not_ready_is_a_pause_never_an_api_key_provider() {
        let down = LocalReadiness::from_probe(probe(false, &[], None));
        let all = blocked(&["claude", "codex"]);
        for chain in [
            CHAIN.as_slice(),
            &["claude", "codex", "ollama", "openrouter"],
        ] {
            match LocalStage::resolve(&RuleSet::new(), chain, &all, &down) {
                Step::Pause { reason } => {
                    assert!(reason.starts_with("Pause statt Rechnung: Ollama"))
                }
                other => panic!("expected a pause, got {other:?}"),
            }
        }
        let mut rules = RuleSet::new();
        let to_local = "Wenn Claude blockiert ist, dann weiter mit dem lokalen Modell.";
        rules.add(Rule::parse(to_local).unwrap()).unwrap();
        let step = LocalStage::resolve(&rules, &CHAIN, &blocked(&["claude"]), &down);
        assert!(matches!(step, Step::Pause { .. }), "{step:?}");
    }

    #[test]
    fn a_missing_chosen_model_names_the_model_in_the_reason() {
        let reason = not_ready(probe(true, &["llama3:8b"], Some("qwen3:8b")));
        assert_eq!(
            reason,
            "Das gewählte Modell „qwen3:8b“ ist in Ollama nicht vorhanden."
        );
        assert!(not_ready(probe(true, &["llama3:8b"], None)).contains("kein lokales Modell"));
        assert!(not_ready(probe(true, &["a"], Some("  "))).contains("kein lokales Modell"));
        assert!(not_ready(probe(false, &["a"], Some("a"))).contains("nicht erreichbar"));
    }

    #[test]
    fn an_untagged_model_name_matches_latest() {
        let found = LocalReadiness::from_probe(probe(true, &["llama3:latest"], Some("llama3")));
        assert_eq!(
            found,
            Readiness::Bereit {
                model: "llama3".into()
            }
        );
        assert!(not_ready(probe(true, &["llama3:8b"], Some("llama3"))).contains("llama3"));
    }

    #[test]
    fn the_local_stage_cannot_be_disabled() {
        assert!(LocalStage
            .set_enabled(false)
            .unwrap_err()
            .contains("bleibt immer an"));
        assert!(LocalStage.set_enabled(true).is_ok());
    }

    #[test]
    fn no_free_provider_is_a_pause() {
        let all = blocked(&CHAIN);
        let step = LocalStage::resolve(&RuleSet::new(), &CHAIN, &all, &ready());
        assert!(matches!(step, Step::Pause { .. }), "{step:?}");
    }
}
