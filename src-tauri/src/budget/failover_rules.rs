//! Failover rules as German sentences (V2-B2a, core only, not wired yet):
//! "Wenn Claude Woche ≥ 95 %, dann weiter mit Codex." is a condition on one
//! provider (window ≥ X %, blocked, probe failed) and an action (switch to
//! another provider, pause, local model), parsed and formatted both ways.
//!
//! "Pause statt Rechnung." is mandatory and cannot be disabled, removed or
//! duplicated. A [`Provider`] exists only for a non-API-key provider, so no
//! rule can name a paid path, and the chain walk skips one regardless.

use std::collections::HashMap;

use super::Window;
use crate::providers::{self, KIND_API_KEY, KIND_LOCAL};

const MANDATORY: &str = "Pause statt Rechnung.";
const LOCAL: &str = "weiter mit dem lokalen Modell";
const NAMES: [(&str, &str); 5] = [
    ("claude", "Claude"),
    ("codex", "Codex"),
    ("opencode", "OpenCode"),
    ("kimi", "Kimi"),
    ("ollama", "Ollama"),
];
const WINDOWS: [(Window, &str); 3] = [
    (Window::FiveHour, "5 Stunden"),
    (Window::SevenDay, "Woche"),
    (Window::Month, "Monat"),
];

/// A registered provider that is not billed per call.
fn usable(id: &str) -> bool {
    providers::find(id).is_some_and(|spec| spec.kind != KIND_API_KEY)
}

/// Registry id and German name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Provider(&'static str, &'static str);

impl Provider {
    fn from_name(name: &str) -> Result<Self, String> {
        match NAMES.iter().find(|(_, known)| *known == name) {
            Some(&(id, name)) if usable(id) => Ok(Self(id, name)),
            Some(_) => Err(format!(
                "{name} ist kein erlaubter Anbieter (Pause statt Rechnung)"
            )),
            None => Err(format!("Unbekannter Anbieter: {name}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Condition {
    WindowAtLeast(Provider, Window, u8),
    Blocked(Provider),
    ProbeFailed(Provider),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Switch(Provider),
    Pause,
    Local,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rule {
    Failover(Condition, Action),
    /// Never fall back to a paid API key. Always present.
    PauseInsteadOfBill,
}

/// What is known about one provider right now.
#[derive(Debug, Clone, Default)]
pub struct ProviderState {
    pub blocked: bool,
    pub probe_failed: bool,
    pub used_pct: Vec<(Window, u8)>,
}

impl Condition {
    fn holds(self, id: &str, state: &ProviderState) -> bool {
        match self {
            Condition::WindowAtLeast(p, window, pct) => {
                p.0 == id
                    && state
                        .used_pct
                        .iter()
                        .any(|&(w, used)| w == window && used >= pct)
            }
            Condition::Blocked(p) => p.0 == id && state.blocked,
            Condition::ProbeFailed(p) => p.0 == id && state.probe_failed,
        }
    }

    fn parse(text: &str) -> Result<Self, String> {
        if let Some(name) = text.strip_suffix(" blockiert ist") {
            return Provider::from_name(name).map(Condition::Blocked);
        }
        let probe = text
            .strip_prefix("die Prüfung von ")
            .and_then(|r| r.strip_suffix(" fehlschlägt"));
        if let Some(name) = probe {
            return Provider::from_name(name).map(Condition::ProbeFailed);
        }
        let bad = || format!("Bedingung nicht verstanden: {text}");
        let (left, right) = text.split_once(" ≥ ").ok_or_else(bad)?;
        let pct = right.strip_suffix(" %").and_then(|n| n.parse().ok());
        let pct = pct.filter(|n| (1..=100).contains(n)).ok_or_else(bad)?;
        let (window, label) = WINDOWS
            .iter()
            .find(|(_, l)| left.ends_with(&format!(" {l}")))
            .ok_or_else(bad)?;
        let name = &left[..left.len() - label.len() - 1];
        Ok(Condition::WindowAtLeast(
            Provider::from_name(name)?,
            *window,
            pct,
        ))
    }

    fn sentence(self) -> String {
        match self {
            Condition::WindowAtLeast(p, window, pct) => {
                let label = WINDOWS
                    .iter()
                    .find(|(w, _)| *w == window)
                    .map_or("?", |(_, l)| l);
                format!("{} {label} ≥ {pct} %", p.1)
            }
            Condition::Blocked(p) => format!("{} blockiert ist", p.1),
            Condition::ProbeFailed(p) => format!("die Prüfung von {} fehlschlägt", p.1),
        }
    }
}

impl Action {
    fn parse(text: &str) -> Result<Self, String> {
        match (text, text.strip_prefix("weiter mit ")) {
            ("Pause", _) => Ok(Action::Pause),
            (LOCAL, _) => Ok(Action::Local),
            (_, Some(name)) => Provider::from_name(name).map(Action::Switch),
            _ => Err(format!("Aktion nicht verstanden: {text}")),
        }
    }

    fn sentence(self) -> String {
        match self {
            Action::Switch(p) => format!("weiter mit {}", p.1),
            Action::Pause => "Pause".into(),
            Action::Local => LOCAL.into(),
        }
    }
}

impl Rule {
    pub fn parse(sentence: &str) -> Result<Self, String> {
        let sentence = sentence.trim();
        if sentence == MANDATORY {
            return Ok(Rule::PauseInsteadOfBill);
        }
        let split = sentence
            .strip_prefix("Wenn ")
            .and_then(|s| s.strip_suffix('.'));
        let (cond, action) = split
            .and_then(|body| body.split_once(", dann "))
            .ok_or_else(|| format!("Regel nicht verstanden: {sentence}"))?;
        Ok(Rule::Failover(
            Condition::parse(cond)?,
            Action::parse(action)?,
        ))
    }

    pub fn sentence(&self) -> String {
        match self {
            Rule::PauseInsteadOfBill => MANDATORY.into(),
            Rule::Failover(when, then) => {
                format!("Wenn {}, dann {}.", when.sentence(), then.sentence())
            }
        }
    }
}

/// The rules in force, each with an on/off flag. Entry 0 is always
/// [`Rule::PauseInsteadOfBill`], on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleSet(Vec<(Rule, bool)>);

impl RuleSet {
    pub fn new() -> Self {
        Self(vec![(Rule::PauseInsteadOfBill, true)])
    }

    pub fn add(&mut self, rule: Rule) -> Result<(), String> {
        if rule == Rule::PauseInsteadOfBill {
            return Err("Die Regel „Pause statt Rechnung“ gibt es schon".into());
        }
        self.0.push((rule, true));
        Ok(())
    }

    /// Fails for a missing index and for the mandatory rule.
    fn changeable(&self, index: usize) -> Result<(), String> {
        match self.0.get(index) {
            Some((Rule::PauseInsteadOfBill, _)) => {
                Err("Die Regel „Pause statt Rechnung“ bleibt immer an".into())
            }
            Some(_) => Ok(()),
            None => Err("Keine solche Regel".into()),
        }
    }

    pub fn remove(&mut self, index: usize) -> Result<(), String> {
        self.changeable(index)?;
        self.0.remove(index);
        Ok(())
    }

    pub fn set_enabled(&mut self, index: usize, enabled: bool) -> Result<(), String> {
        self.changeable(index)?;
        self.0[index].1 = enabled;
        Ok(())
    }

    /// Walk `chain` (provider ids in preference order) from the front and
    /// name the provider to work on; `None` means pause. One is passed over
    /// when it is blocked or when an enabled rule about it holds and sends
    /// the walk elsewhere. Providers billed per call (and unknown ids) are
    /// never chosen; running out of chain, or a loop, is a pause.
    pub fn resolve<'a>(
        &self,
        chain: &[&'a str],
        states: &HashMap<String, ProviderState>,
    ) -> Option<&'a str> {
        let mut at = 0;
        for _ in 0..chain.len() * 2 {
            let Some(&id) = chain.get(at) else { break };
            if !usable(id) {
                at += 1;
                continue;
            }
            let state = states.get(id).cloned().unwrap_or_default();
            let fired = self
                .0
                .iter()
                .filter(|(_, on)| *on)
                .find_map(|(rule, _)| match rule {
                    Rule::Failover(when, then) if when.holds(id, &state) => Some(*then),
                    _ => None,
                });
            at = match fired {
                None if !state.blocked => return Some(id),
                None => at + 1,
                Some(Action::Pause) => return None,
                Some(Action::Local) => chain
                    .iter()
                    .position(|c| providers::find(c).is_some_and(|s| s.kind == KIND_LOCAL))?,
                Some(Action::Switch(to)) => chain.iter().position(|c| *c == to.0)?,
            };
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHAIN: [&str; 3] = ["claude", "codex", "ollama"];

    fn states(flagged: &[&str], probe_failed: bool) -> HashMap<String, ProviderState> {
        let state = ProviderState {
            blocked: !probe_failed,
            probe_failed,
            ..Default::default()
        };
        flagged
            .iter()
            .map(|id| (id.to_string(), state.clone()))
            .collect()
    }

    fn set(sentences: &[&str]) -> RuleSet {
        let mut set = RuleSet::new();
        sentences
            .iter()
            .for_each(|s| set.add(Rule::parse(s).unwrap()).unwrap());
        set
    }

    #[test]
    fn sentences_round_trip_for_every_rule_kind() {
        for sentence in [
            "Wenn Claude Woche ≥ 95 %, dann weiter mit Codex.",
            "Wenn OpenCode 5 Stunden ≥ 80 %, dann Pause.",
            "Wenn Kimi Monat ≥ 100 %, dann weiter mit dem lokalen Modell.",
            "Wenn Codex blockiert ist, dann weiter mit Ollama.",
            "Wenn die Prüfung von Claude fehlschlägt, dann Pause.",
            "Pause statt Rechnung.",
        ] {
            assert_eq!(Rule::parse(sentence).unwrap().sentence(), sentence);
        }
        for bad in [
            "Claude Woche ≥ 95 %, dann Pause.",
            "Wenn Claude Woche ≥ 0 %, dann Pause.",
            "Wenn Claude Woche ≥ 101 %, dann Pause.",
            "Wenn Claude Jahr ≥ 5 %, dann Pause.",
            "Wenn Claude Woche ≥ 95 %, dann weiter mit OpenRouter.",
        ] {
            assert!(Rule::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn mandatory_rule_cannot_be_disabled_removed_or_duplicated() {
        let mut rules = set(&["Wenn Claude blockiert ist, dann Pause."]);
        assert_eq!(rules.0[0], (Rule::PauseInsteadOfBill, true));
        assert!(rules.set_enabled(0, false).is_err());
        assert!(rules.remove(0).is_err());
        assert!(rules.add(Rule::PauseInsteadOfBill).is_err());
        rules.set_enabled(1, false).unwrap();
        rules.remove(1).unwrap();
        assert!(rules.remove(7).is_err());
        assert_eq!(rules, RuleSet::new());
    }

    #[test]
    fn chain_skips_a_blocked_provider_and_ends_at_local_or_pause() {
        let rules = RuleSet::new();
        assert_eq!(rules.resolve(&CHAIN, &HashMap::new()), Some("claude"));
        assert_eq!(
            rules.resolve(&CHAIN, &states(&["claude"], false)),
            Some("codex")
        );
        assert_eq!(
            rules.resolve(&CHAIN, &states(&["claude", "codex"], false)),
            Some("ollama")
        );
        assert_eq!(rules.resolve(&CHAIN, &states(&CHAIN, false)), None);
    }

    #[test]
    fn chain_never_ends_on_an_api_key_path() {
        let rules = RuleSet::new();
        let chain = ["claude", "openrouter", "omniroute-management"];
        assert_eq!(rules.resolve(&chain, &states(&["claude"], false)), None);
        assert_eq!(rules.resolve(&["openrouter"], &HashMap::new()), None);
    }

    #[test]
    fn rules_fire_at_the_threshold_and_pause_wins() {
        let rules = set(&[
            "Wenn Claude Woche ≥ 95 %, dann weiter mit dem lokalen Modell.",
            "Wenn Ollama blockiert ist, dann Pause.",
        ]);
        let at = |pct| {
            let state = ProviderState {
                used_pct: vec![(Window::SevenDay, pct)],
                ..Default::default()
            };
            HashMap::from([("claude".to_string(), state)])
        };
        assert_eq!(rules.resolve(&CHAIN, &at(94)), Some("claude"));
        assert_eq!(rules.resolve(&CHAIN, &at(95)), Some("ollama"));
        let mut both = at(95);
        both.extend(states(&["ollama"], false));
        assert_eq!(rules.resolve(&CHAIN, &both), None);
    }

    #[test]
    fn disabled_rules_do_not_fire_and_loops_end_in_a_pause() {
        let mut rules = set(&["Wenn die Prüfung von Claude fehlschlägt, dann Pause."]);
        assert_eq!(rules.resolve(&CHAIN, &states(&["claude"], true)), None);
        rules.set_enabled(1, false).unwrap();
        assert_eq!(
            rules.resolve(&CHAIN, &states(&["claude"], true)),
            Some("claude")
        );
        let looping = set(&["Wenn Claude blockiert ist, dann weiter mit Claude."]);
        assert_eq!(looping.resolve(&CHAIN, &states(&["claude"], false)), None);
    }
}
