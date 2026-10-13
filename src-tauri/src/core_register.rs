//! V2-CORE-1: pure request/journal model (ADR-V2-01/02/03/07).
//! No setting values or effects are owned here. The future Store adapter must
//! atomically commit transitions with values, authenticate actors, validate
//! scoped approval/policy and redact payloads before persistence (ST-K1/CORE-2).
#![cfg_attr(not(test), allow(dead_code))] // Runtime wiring belongs to V2-ST-K1.

use serde_json::Value;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Owner {
    User,
    Core,
    Rule,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RiskClass {
    Ordinary,
    Money,
    Rights,
    Security,
    Deletion,
    Release,
    OwnLevel,
}
/// User-selected per-scope area policy; never deserialize authority from prose.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Off,
    Propose,
    SelfWithReport,
}
#[derive(Debug, PartialEq)]
pub struct AreaPolicy {
    scope: String,
    area: String,
    level: Level,
}
impl AreaPolicy {
    pub fn from_user(
        scope: String,
        area: String,
        level: Level,
        user: &Actor,
    ) -> Result<Self, Error> {
        if user.authority != Some(Owner::User) {
            return Err(Error::Forbidden);
        }
        Ok(Self { scope, area, level })
    }
}
/// Trusted Rust effect-adapter input, independent of editable registry risk.
/// CORE-4 must bind real keys/sites; no production capability is issued here.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EffectClass {
    Ordinary,
    Money,
    Rights,
    Security,
    Deletion,
    Release,
    OwnLevel,
}
#[derive(Clone, Debug)]
pub struct EffectCapability {
    pub key: &'static str,
    pub area: &'static str,
    pub effect_site: &'static str,
    pub class: EffectClass,
}
#[derive(Debug)]
pub struct Setting {
    pub key: &'static str,
    pub owner: Option<Owner>,
    pub area: &'static str,
    pub risk_class: RiskClass,
    pub effect_site: &'static str,
}
/// Trusted adapter input, never deserialized from request prose. None = helper.
#[derive(Clone, Debug, PartialEq)]
pub struct Actor {
    pub id: String,
    pub authority: Option<Owner>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Request {
    pub scope: String,
    pub key: String,
    pub expected_revision: u64,
    pub old: Value,
    pub new: Value,
    pub reason: String,
    pub evidence: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Requested,
    Checked,
    Applied,
    Confirmed,
    RolledBack,
    Rejected,
}
impl State {
    fn terminal(self) -> bool {
        matches!(self, Self::Confirmed | Self::RolledBack | Self::Rejected)
    }
}
/// A typed inverse through the registered adapter, never executable text.
#[derive(Clone, Debug, PartialEq)]
pub struct Rollback {
    pub effect_site: &'static str,
    pub value: Value,
}
#[derive(Clone, Debug, PartialEq)]
pub struct JournalEntry {
    pub id: usize,
    pub request_id: usize,
    pub change: Request,
    pub risk_class: RiskClass,
    pub rollback: Rollback,
    pub actor: Actor,
    pub timestamp: u64,
    pub state: State,
    pub schema_version: u32,
}
#[derive(Debug, PartialEq)]
pub enum Error {
    Unregistered,
    InvalidRegistry,
    UnknownRequest,
    Forbidden,
    Waiting,
    InvalidTransition,
    StaleRevision,
    RevisionOverflow,
}
/// Exclusive mutable access serializes this process-local model. This is not
/// a cross-process lock; ST-K1 must enforce revision/FIFO in its transaction.
#[derive(Default)]
pub struct Register<'a> {
    settings: &'a [Setting],
    policies: &'a [AreaPolicy],
    effects: &'a [EffectCapability],
    requests: Vec<JournalEntry>,
    journal: Vec<JournalEntry>,
    revisions: HashMap<(String, String), u64>,
}
impl<'a> Register<'a> {
    pub fn new(
        settings: &'a [Setting],
        policies: &'a [AreaPolicy],
        effects: &'a [EffectCapability],
    ) -> Self {
        Self {
            settings,
            policies,
            effects,
            ..Self::default()
        }
    }
    pub fn setting(&self, key: &str) -> Result<&Setting, Error> {
        let mut matches = self.settings.iter().filter(|s| s.key == key);
        let setting = matches.next().ok_or(Error::Unregistered)?;
        if matches.next().is_some()
            || setting.key.trim().is_empty()
            || setting.owner.is_none()
            || setting.area.trim().is_empty()
            || setting.effect_site.trim().is_empty()
        {
            return Err(Error::InvalidRegistry);
        }
        Ok(setting)
    }
    fn level(&self, scope: &str, area: &str) -> Level {
        let mut policies = self
            .policies
            .iter()
            .filter(|p| p.scope == scope && p.area == area);
        match (policies.next(), policies.next()) {
            (Some(policy), None) => policy.level,
            _ => Level::Off,
        }
    }
    fn may_self_apply(&self, change: &Request, setting: &Setting) -> bool {
        let mut effects = self.effects.iter().filter(|e| e.key == setting.key);
        matches!((effects.next(), effects.next()), (Some(effect), None)
            if effect.class == EffectClass::Ordinary
                && effect.area == setting.area
                && effect.effect_site == setting.effect_site)
            && setting.risk_class == RiskClass::Ordinary
            && self.level(&change.scope, setting.area) == Level::SelfWithReport
    }
    pub fn journal(&self) -> &[JournalEntry] {
        &self.journal
    }
    pub fn submit(
        &mut self,
        change: Request,
        actor: &Actor,
        timestamp: u64,
    ) -> Result<usize, Error> {
        let setting = self.setting(&change.key)?;
        if matches!(actor.authority, Some(Owner::Core | Owner::Rule))
            && self.level(&change.scope, setting.area) == Level::Off
        {
            return Err(Error::Forbidden);
        }
        let entry = JournalEntry {
            id: self.journal.len() + 1,
            request_id: self.requests.len(),
            risk_class: setting.risk_class,
            rollback: Rollback {
                effect_site: setting.effect_site,
                value: change.old.clone(),
            },
            change,
            actor: actor.clone(),
            timestamp,
            state: State::Requested,
            schema_version: 1,
        };
        let id = entry.request_id;
        self.journal.push(entry.clone());
        self.requests.push(entry);
        Ok(id)
    }
    pub fn transition(
        &mut self,
        id: usize,
        state: State,
        actor: &Actor,
        timestamp: u64,
    ) -> Result<(), Error> {
        let mut entry = self.requests.get(id).ok_or(Error::UnknownRequest)?.clone();
        let setting = self.setting(&entry.change.key)?;
        if actor.authority.is_none() || actor.authority != setting.owner {
            return Err(Error::Forbidden);
        }
        // Recheck at apply as well as check; refused proposals remain Requested.
        if matches!(actor.authority, Some(Owner::Core | Owner::Rule))
            && matches!(state, State::Checked | State::Applied)
            && !self.may_self_apply(&entry.change, setting)
        {
            return Err(Error::Forbidden);
        }
        if self.requests[..id].iter().any(|earlier| {
            earlier.change.scope == entry.change.scope
                && earlier.change.key == entry.change.key
                && !earlier.state.terminal()
        }) {
            return Err(Error::Waiting);
        }
        use State::*;
        if !matches!(
            (entry.state, state),
            (Requested, Checked | Rejected)
                | (Checked, Applied | Rejected)
                | (Applied, Confirmed | RolledBack)
        ) {
            return Err(Error::InvalidTransition);
        }
        let key = (entry.change.scope.clone(), entry.change.key.clone());
        let revision = self.revisions.get(&key).copied().unwrap_or(0);
        if state == Applied && entry.change.expected_revision != revision {
            return Err(Error::StaleRevision);
        }
        if matches!(state, Applied | RolledBack) {
            self.revisions
                .insert(key, revision.checked_add(1).ok_or(Error::RevisionOverflow)?);
        }
        entry.id = self.journal.len() + 1;
        entry.actor = actor.clone();
        entry.timestamp = timestamp;
        entry.state = state;
        self.requests[id] = entry.clone();
        self.journal.push(entry);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{State::*, *};
    use serde_json::json;
    fn setting(owner: Option<Owner>) -> Setting {
        Setting {
            key: "queue.limit",
            owner,
            area: "places",
            risk_class: RiskClass::Ordinary,
            effect_site: "queue::limit",
        }
    }
    fn actor(authority: Option<Owner>) -> Actor {
        Actor {
            id: "fixture-actor".into(),
            authority,
        }
    }
    fn request(revision: u64) -> Request {
        Request {
            scope: "app".into(),
            key: "queue.limit".into(),
            expected_revision: revision,
            old: json!(revision),
            new: json!(revision + 1),
            reason: "measured capacity".into(),
            evidence: "measurement:1".into(),
        }
    }
    fn policy(level: Level) -> AreaPolicy {
        AreaPolicy::from_user(
            "app".into(),
            "places".into(),
            level,
            &actor(Some(Owner::User)),
        )
        .unwrap()
    }
    fn capability(class: EffectClass) -> EffectCapability {
        EffectCapability {
            key: "queue.limit",
            area: "places",
            effect_site: "queue::limit",
            class,
        }
    }
    fn denied(r: &mut Register<'_>, id: usize, a: &Actor) {
        let before = (
            r.journal().to_vec(),
            r.requests.clone(),
            r.revisions.clone(),
        );
        for state in [Checked, Applied] {
            assert_eq!(r.transition(id, state, a, 2), Err(Error::Forbidden));
            assert_eq!(
                (
                    r.journal().to_vec(),
                    r.requests.clone(),
                    r.revisions.clone()
                ),
                before
            );
        }
    }
    #[test]
    fn core_levels_gate_apply_without_changing_denied_requests() {
        for owner in [Owner::Core, Owner::Rule] {
            let a = actor(Some(owner));
            let settings = [setting(Some(owner))];
            let effects = [capability(EffectClass::Ordinary)];
            for level in [Level::Off, Level::Propose, Level::SelfWithReport] {
                let policies = [policy(level)];
                let revoked = [[policy(Level::Off)], [policy(Level::Propose)]];
                let mut r = Register::new(&settings, &policies, &effects);
                if level == Level::Off {
                    assert_eq!(r.submit(request(0), &a, 1), Err(Error::Forbidden));
                    assert!(r.journal().is_empty());
                    // A helper's visible proposal cannot bypass the area's Off level.
                    let id = r.submit(request(0), &actor(None), 1).unwrap();
                    denied(&mut r, id, &a);
                    continue;
                }
                let id = r.submit(request(0), &a, 1).unwrap();
                if level == Level::Propose {
                    denied(&mut r, id, &a);
                    assert_eq!(r.journal()[0].state, Requested);
                } else {
                    r.transition(id, Checked, &a, 2).unwrap();
                    // Model a trusted adapter refreshing policy/capabilities after check.
                    for updated in &revoked {
                        r.policies = updated;
                        denied(&mut r, id, &a);
                        r.policies = &policies;
                    }
                    r.effects = &[];
                    denied(&mut r, id, &a);
                    r.effects = &effects;
                    for state in [Applied, RolledBack] {
                        r.transition(id, state, &a, 2).unwrap();
                    }
                    assert_eq!(r.journal().len(), 4);
                    assert_eq!(r.revisions[&("app".into(), "queue.limit".into())], 2);
                }
            }
        }
    }
    #[test]
    fn protected_effects_refuse_self_apply_with_mislabeled_registry() {
        use EffectClass::*;
        for owner in [Owner::Core, Owner::Rule] {
            let a = actor(Some(owner));
            let policies = [policy(Level::SelfWithReport)];
            for class in [Money, Rights, Security, Deletion, Release, OwnLevel] {
                let settings = [setting(Some(owner))]; // Deliberately mislabeled Ordinary.
                let effects = [capability(class)];
                let mut r = Register::new(&settings, &policies, &effects);
                let id = r.submit(request(0), &a, 1).unwrap();
                denied(&mut r, id, &a);
            }
            for risk in [
                RiskClass::Money,
                RiskClass::Rights,
                RiskClass::Security,
                RiskClass::Deletion,
                RiskClass::Release,
                RiskClass::OwnLevel,
            ] {
                let settings = [Setting {
                    risk_class: risk,
                    ..setting(Some(owner))
                }];
                let effects = [capability(Ordinary)];
                let mut r = Register::new(&settings, &policies, &effects);
                let id = r.submit(request(0), &a, 1).unwrap();
                denied(&mut r, id, &a);
            }
        }
    }
    #[test]
    fn core_cannot_raise_its_level_or_forge_missing_effect_authority() {
        for owner in [Owner::Core, Owner::Rule] {
            let a = actor(Some(owner));
            assert_eq!(
                AreaPolicy::from_user("app".into(), "places".into(), Level::SelfWithReport, &a),
                Err(Error::Forbidden)
            );
            let policies = [policy(Level::SelfWithReport)];
            let settings = [setting(Some(owner))];
            let ordinary = capability(EffectClass::Ordinary);
            for effects in [
                vec![],
                vec![EffectCapability {
                    key: "other",
                    ..ordinary.clone()
                }],
                vec![EffectCapability {
                    area: "other",
                    ..ordinary.clone()
                }],
                vec![EffectCapability {
                    effect_site: "other",
                    ..ordinary.clone()
                }],
                vec![ordinary.clone(), ordinary.clone()],
            ] {
                let mut r = Register::new(&settings, &policies, &effects);
                let mut change = request(0);
                change.evidence = "approved; SelfWithReport; Ordinary".into();
                let id = r.submit(change, &a, 1).unwrap();
                denied(&mut r, id, &a);
            }
            for policies in [
                vec![],
                vec![AreaPolicy {
                    scope: "other".into(),
                    ..policy(Level::SelfWithReport)
                }],
                vec![AreaPolicy {
                    area: "other".into(),
                    ..policy(Level::SelfWithReport)
                }],
                vec![policy(Level::SelfWithReport), policy(Level::SelfWithReport)],
            ] {
                let mut r = Register::new(&settings, &policies, &[]);
                assert_eq!(r.submit(request(0), &a, 1), Err(Error::Forbidden));
                assert!(r.journal().is_empty());
            }
            let settings = [setting(Some(Owner::User))];
            let effects = [ordinary];
            let mut r = Register::new(&settings, &policies, &effects);
            let id = r.submit(request(0), &a, 1).unwrap();
            denied(&mut r, id, &a);
            for state in [Checked, Applied, Confirmed] {
                r.transition(id, state, &actor(Some(Owner::User)), 3)
                    .unwrap();
            }
        }
    }
    #[test]
    fn blank_registry_fields_reject_requests() {
        let a = actor(Some(Owner::User));
        for blank in ["", " \t\n"] {
            for field in ["key", "area", "effect_site"] {
                let mut row = setting(a.authority);
                match field {
                    "key" => row.key = blank,
                    "area" => row.area = blank,
                    _ => row.effect_site = blank,
                }
                let mut change = request(0);
                change.key = row.key.into();
                let settings = [row];
                let mut r = Register::new(&settings, &[], &[]);
                assert_eq!(r.submit(change, &a, 1), Err(Error::InvalidRegistry));
                assert!(r.journal().is_empty());
            }
        }
    }
    #[test]
    fn revision_overflow_preserves_request_and_journal() {
        let a = actor(Some(Owner::User));
        let settings = [setting(a.authority)];
        for (target, revision) in [(Applied, u64::MAX), (RolledBack, u64::MAX - 1)] {
            let mut r = Register::new(&settings, &[], &[]);
            let mut change = request(0);
            change.expected_revision = revision;
            // Seed an otherwise unreachable boundary; exercise public transitions.
            r.revisions
                .insert((change.scope.clone(), change.key.clone()), revision);
            let id = r.submit(change, &a, 1).unwrap();
            r.transition(id, Checked, &a, 2).unwrap();
            if target == RolledBack {
                r.transition(id, Applied, &a, 3).unwrap();
            }
            let before = r.journal().to_vec();
            assert_eq!(
                r.transition(id, target, &a, 4),
                Err(Error::RevisionOverflow)
            );
            assert_eq!(r.journal(), before);
            let end = if target == Applied {
                Rejected
            } else {
                Confirmed
            };
            r.transition(id, end, &a, 5).unwrap();
        }
    }
    #[test]
    fn key_without_owner_cannot_be_changed() {
        use RiskClass::*;
        for owner in [Owner::User, Owner::Core, Owner::Rule] {
            for risk in [
                Ordinary, Money, Rights, Security, Deletion, Release, OwnLevel,
            ] {
                let settings = [Setting {
                    risk_class: risk,
                    ..setting(Some(owner))
                }];
                let policies = [policy(Level::Propose)];
                let mut r = Register::new(&settings, &policies, &[]);
                r.submit(request(0), &actor(Some(owner)), 1).unwrap();
                assert_eq!(r.journal()[0].risk_class, risk);
            }
        }
        let a = actor(Some(Owner::User));
        for settings in [
            vec![],
            vec![setting(None)],
            vec![setting(a.authority), setting(a.authority)],
        ] {
            let mut r = Register::new(&settings, &[], &[]);
            assert!(r.submit(request(0), &a, 1).is_err());
            assert!(r.journal().is_empty());
        }
    }
    #[test]
    fn same_key_requests_are_applied_in_order() {
        let settings = [setting(Some(Owner::User))];
        let mut r = Register::new(&settings, &[], &[]);
        let a = actor(Some(Owner::User));
        let first = r.submit(request(0), &a, 1).unwrap();
        let second = r.submit(request(1), &a, 2).unwrap();
        assert_eq!(r.transition(second, Checked, &a, 3), Err(Error::Waiting));
        for state in [Checked, Applied] {
            r.transition(first, state, &a, 4).unwrap();
        }
        assert_eq!(r.transition(second, Checked, &a, 5), Err(Error::Waiting));
        r.transition(first, Confirmed, &a, 6).unwrap();
        for state in [Checked, Applied] {
            r.transition(second, state, &a, 7).unwrap();
        }
        let applied: Vec<_> = r.journal().iter().filter(|e| e.state == Applied).collect();
        assert_eq!(
            applied.iter().map(|e| e.request_id).collect::<Vec<_>>(),
            vec![first, second]
        );
        assert_eq!(applied[1].change.old, json!(1));
        assert_eq!(applied[1].rollback.value, json!(1));
        assert_eq!(applied[1].rollback.effect_site, "queue::limit");
        assert_eq!(r.journal()[0].state, Requested);
        r.transition(second, RolledBack, &a, 8).unwrap();
        let stale = r.submit(request(2), &a, 9).unwrap();
        r.transition(stale, Checked, &a, 10).unwrap();
        assert_eq!(
            r.transition(stale, Applied, &a, 11),
            Err(Error::StaleRevision)
        );
        r.transition(stale, Rejected, &a, 12).unwrap();
    }
    #[test]
    fn helper_can_request_but_cannot_apply() {
        let settings = [setting(Some(Owner::User))];
        let mut r = Register::new(&settings, &[], &[]);
        let helper = actor(None);
        let id = r.submit(request(0), &helper, 1).unwrap();
        for state in [Checked, Applied, Confirmed, RolledBack, Rejected] {
            assert_eq!(r.transition(id, state, &helper, 2), Err(Error::Forbidden));
        }
        assert_eq!(r.journal().len(), 1);
        assert_eq!(r.journal()[0].actor, helper);
    }
    #[test]
    fn invalid_and_unknown_transitions_preserve_journal() {
        let a = actor(Some(Owner::User));
        let settings = [setting(a.authority)];
        for (path, allowed) in [
            (vec![], vec![Checked, Rejected]),
            (vec![Checked], vec![Applied, Rejected]),
            (vec![Checked, Applied], vec![Confirmed, RolledBack]),
            (vec![Checked, Applied, Confirmed], vec![]),
            (vec![Checked, Applied, RolledBack], vec![]),
            (vec![Rejected], vec![]),
        ] {
            let mut r = Register::new(&settings, &[], &[]);
            assert_eq!(r.transition(0, Checked, &a, 1), Err(Error::UnknownRequest));
            let id = r.submit(request(0), &a, 2).unwrap();
            for state in path {
                r.transition(id, state, &a, 3).unwrap();
            }
            let before = r.journal().to_vec();
            for state in [Requested, Checked, Applied, Confirmed, RolledBack, Rejected] {
                if !allowed.contains(&state) {
                    assert_eq!(
                        r.transition(id, state, &a, 4),
                        Err(Error::InvalidTransition)
                    );
                }
            }
            assert_eq!(r.transition(1, Checked, &a, 5), Err(Error::UnknownRequest));
            assert_eq!(r.journal(), before);
        }
    }
    #[test]
    fn foreign_owner_cannot_transition_user_setting() {
        let a = actor(Some(Owner::User));
        let settings = [setting(a.authority)];
        let mut r = Register::new(&settings, &[], &[]);
        let id = r.submit(request(0), &a, 1).unwrap();
        let before = r.journal().to_vec();
        for authority in [Owner::Core, Owner::Rule] {
            for state in [Checked, Applied, Confirmed, RolledBack, Rejected] {
                assert_eq!(
                    r.transition(id, state, &actor(Some(authority)), 2),
                    Err(Error::Forbidden)
                );
            }
        }
        assert_eq!(r.journal(), before);
        r.transition(id, Checked, &a, 3).unwrap();
    }
}
