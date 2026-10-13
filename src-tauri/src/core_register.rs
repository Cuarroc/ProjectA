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
}
/// Exclusive mutable access serializes this process-local model. This is not
/// a cross-process lock; ST-K1 must enforce revision/FIFO in its transaction.
#[derive(Default)]
pub struct Register<'a> {
    settings: &'a [Setting],
    requests: Vec<JournalEntry>,
    journal: Vec<JournalEntry>,
    revisions: HashMap<(String, String), u64>,
}
impl<'a> Register<'a> {
    pub fn new(settings: &'a [Setting]) -> Self {
        Self {
            settings,
            ..Self::default()
        }
    }
    pub fn setting(&self, key: &str) -> Result<&Setting, Error> {
        self.settings
            .iter()
            .find(|s| s.key == key)
            .ok_or(Error::Unregistered)
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
        let _ = (id, state, actor, timestamp);
        Err(Error::InvalidTransition)
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
    #[test]
    fn key_without_owner_cannot_be_changed() {
        let a = actor(Some(Owner::User));
        for settings in [
            vec![],
            vec![setting(None)],
            vec![setting(a.authority), setting(a.authority)],
        ] {
            let mut r = Register::new(&settings);
            assert!(r.submit(request(0), &a, 1).is_err());
            assert!(r.journal().is_empty());
        }
    }
    #[test]
    fn same_key_requests_are_applied_in_order() {
        let settings = [setting(Some(Owner::User))];
        let mut r = Register::new(&settings);
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
    }
    #[test]
    fn helper_can_request_but_cannot_apply() {
        let settings = [setting(Some(Owner::User))];
        let mut r = Register::new(&settings);
        let helper = actor(None);
        let id = r.submit(request(0), &helper, 1).unwrap();
        for state in [Checked, Applied, Confirmed, RolledBack, Rejected] {
            assert_eq!(r.transition(id, state, &helper, 2), Err(Error::Forbidden));
        }
        assert_eq!(r.journal().len(), 1);
        assert_eq!(r.journal()[0].actor, helper);
    }
}
