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

fn local_position(chain: &[&str]) -> Option<usize> {
    chain
        .iter()
        .position(|c| providers::find(c).is_some_and(|s| s.kind == KIND_LOCAL))
}

/// Where in `chain` a switch or local action leads; `None` if nowhere.
fn target(chain: &[&str], action: Action) -> Option<usize> {
    match action {
        Action::Switch(to) => chain.iter().position(|c| *c == to.0),
        Action::Local => local_position(chain),
        Action::Pause => None,
    }
}

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
    fn provider(self) -> Provider {
        match self {
            Condition::WindowAtLeast(p, ..) | Condition::Blocked(p) | Condition::ProbeFailed(p) => {
                p
            }
        }
    }

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
        let canonical = |n: &&str| n.bytes().all(|b| b.is_ascii_digit()) && !n.starts_with('0');
        let pct = right.strip_suffix(" %").filter(canonical);
        let pct = pct.and_then(|n| n.parse().ok());
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

impl Default for RuleSet {
    fn default() -> Self {
        Self::new()
    }
}

impl RuleSet {
    pub fn new() -> Self {
        Self(vec![(Rule::PauseInsteadOfBill, true)])
    }

    /// One German error per rule that cannot work with `chain`: it sends to
    /// a provider that is not in the chain, to its own condition's provider,
    /// or to a local model when the chain has none.
    pub fn validate(&self, chain: &[&str]) -> Result<(), Vec<String>> {
        let errors: Vec<String> = self
            .0
            .iter()
            .filter_map(|(rule, _)| {
                let Rule::Failover(when, action) = rule else {
                    return None;
                };
                let problem = match action {
                    Action::Switch(to) if to.0 == when.provider().0 => {
                        format!("{} kann nicht auf sich selbst verweisen", to.1)
                    }
                    Action::Switch(to) if !chain.contains(&to.0) => {
                        format!("{} ist nicht in der Kette", to.1)
                    }
                    Action::Local if local_position(chain).is_none() => {
                        "In der Kette ist kein lokales Modell".to_string()
                    }
                    _ => return None,
                };
                Some(format!("„{}“: {problem}", rule.sentence()))
            })
            .collect();
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    pub fn add(&mut self, rule: Rule) -> Result<(), String> {
        if rule == Rule::PauseInsteadOfBill {
            return Err("Die Regel „Pause statt Rechnung“ gibt es schon".into());
        }
        if self.0.iter().any(|(have, _)| *have == rule) {
            return Err(format!("Die Regel „{}“ gibt es schon", rule.sentence()));
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
    /// the walk elsewhere. A rule whose target is not in the chain is
    /// skipped (the walk goes on with the next member), and one that names
    /// its own healthy provider changes nothing. Providers billed per call
    /// (and unknown ids) are never chosen; a pause rule, running out of
    /// chain, or a loop is a pause.
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
                Some(action) => match target(chain, action) {
                    Some(to) if to == at && !state.blocked => return Some(id),
                    Some(to) => to,
                    None => at + 1,
                },
            };
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHAIN: [&str; 3] = ["claude", "codex", "ollama"];

    fn states(
        flagged: &[&str],
        blocked: bool,
        probe_failed: bool,
    ) -> HashMap<String, ProviderState> {
        let state = ProviderState {
            blocked,
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
            rules.resolve(&CHAIN, &states(&["claude"], true, false)),
            Some("codex")
        );
        assert_eq!(
            rules.resolve(&CHAIN, &states(&["claude", "codex"], true, false)),
            Some("ollama")
        );
        assert_eq!(rules.resolve(&CHAIN, &states(&CHAIN, true, false)), None);
    }

    #[test]
    fn chain_never_ends_on_an_api_key_path() {
        let rules = RuleSet::new();
        let chain = ["claude", "openrouter", "omniroute-management"];
        assert_eq!(
            rules.resolve(&chain, &states(&["claude"], true, false)),
            None
        );
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
        both.extend(states(&["ollama"], true, false));
        assert_eq!(rules.resolve(&CHAIN, &both), None);
    }

    #[test]
    fn disabled_rules_do_not_fire_and_loops_end_in_a_pause() {
        let mut rules = set(&["Wenn die Prüfung von Claude fehlschlägt, dann Pause."]);
        assert_eq!(
            rules.resolve(&CHAIN, &states(&["claude"], false, true)),
            None
        );
        rules.set_enabled(1, false).unwrap();
        assert_eq!(
            rules.resolve(&CHAIN, &states(&["claude"], false, true)),
            Some("claude")
        );
        let looping = set(&["Wenn Claude blockiert ist, dann weiter mit Claude."]);
        assert_eq!(
            looping.resolve(&CHAIN, &states(&["claude"], true, false)),
            None
        );
    }

    #[test]
    fn a_rule_with_an_unresolvable_target_is_skipped_not_a_pause() {
        let not_in_chain = set(&["Wenn Claude Woche ≥ 95 %, dann weiter mit Kimi."]);
        let at_95 = HashMap::from([(
            "claude".to_string(),
            ProviderState {
                used_pct: vec![(Window::SevenDay, 95)],
                ..Default::default()
            },
        )]);
        assert_eq!(not_in_chain.resolve(&CHAIN, &at_95), Some("codex"));
        let local = set(&["Wenn Claude blockiert ist, dann weiter mit dem lokalen Modell."]);
        let blocked = states(&["claude"], true, false);
        assert_eq!(local.resolve(&CHAIN, &blocked), Some("ollama"));
        assert_eq!(local.resolve(&["claude", "codex"], &blocked), Some("codex"));
        assert_eq!(local.resolve(&["claude"], &blocked), None);
    }

    #[test]
    fn a_self_target_keeps_a_healthy_provider() {
        let rules = set(&["Wenn Claude Woche ≥ 95 %, dann weiter mit Claude."]);
        let state = ProviderState {
            used_pct: vec![(Window::SevenDay, 95)],
            ..Default::default()
        };
        let states = HashMap::from([("claude".to_string(), state)]);
        assert_eq!(rules.resolve(&CHAIN, &states), Some("claude"));
    }

    #[test]
    fn probe_failed_and_blocked_are_independent_conditions() {
        let rules = set(&["Wenn die Prüfung von Claude fehlschlägt, dann weiter mit Codex."]);
        let probe = states(&["claude"], false, true);
        assert_eq!(rules.resolve(&CHAIN, &probe), Some("codex"));
        let both = states(&["claude"], true, true);
        assert_eq!(rules.resolve(&CHAIN, &both), Some("codex"));
        let blocked = states(&["claude"], true, false);
        assert_eq!(rules.resolve(&CHAIN, &blocked), Some("codex"));
        let pause = set(&["Wenn die Prüfung von Claude fehlschlägt, dann Pause."]);
        assert_eq!(pause.resolve(&CHAIN, &blocked), Some("codex"));
        assert_eq!(pause.resolve(&CHAIN, &probe), None);
        assert_eq!(rules.resolve(&CHAIN, &HashMap::new()), Some("claude"));
    }

    #[test]
    fn validate_names_each_rule_that_cannot_work_with_the_chain() {
        let rules = set(&[
            "Wenn Codex blockiert ist, dann weiter mit Ollama.",
            "Wenn Claude Woche ≥ 95 %, dann weiter mit Kimi.",
            "Wenn Claude blockiert ist, dann weiter mit Claude.",
            "Wenn Codex Monat ≥ 90 %, dann weiter mit dem lokalen Modell.",
        ]);
        let errors = rules.validate(&CHAIN).unwrap_err();
        assert_eq!(errors.len(), 2, "{errors:?}");
        assert!(errors[0].contains("Kimi") && errors[0].contains("nicht in der Kette"));
        assert!(errors[1].contains("Claude") && errors[1].contains("sich selbst"));
        let errors = rules.validate(&["claude", "codex"]).unwrap_err();
        assert_eq!(errors.len(), 4, "{errors:?}");
        assert!(RuleSet::new().validate(&[]).is_ok());
    }

    #[test]
    fn percent_numerals_must_be_canonical() {
        for bad in ["+95", "095", "00", "9 5", "-5"] {
            let sentence = format!("Wenn Claude Woche ≥ {bad} %, dann Pause.");
            assert!(Rule::parse(&sentence).is_err(), "{sentence}");
        }
        assert!(Rule::parse("Wenn Claude Woche ≥ 100 %, dann Pause.").is_ok());
    }

    #[test]
    fn an_identical_rule_is_rejected_and_default_is_new() {
        let mut rules = set(&["Wenn Claude blockiert ist, dann Pause."]);
        let same = Rule::parse("Wenn Claude blockiert ist, dann Pause.").unwrap();
        assert!(rules.add(same).is_err());
        assert_eq!(rules.0.len(), 2);
        let other = Rule::parse("Wenn Claude blockiert ist, dann weiter mit Codex.").unwrap();
        assert!(rules.add(other).is_ok());
        assert_eq!(RuleSet::default(), RuleSet::new());
    }
}
