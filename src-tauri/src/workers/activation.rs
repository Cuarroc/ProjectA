//! W4-03: the fail-closed continuous activation switch.
//!
//! The only production route to a [`SchedulerPermit`]. It refuses unless the
//! caller holds the verdict token, no emergency stop is active, the acceptance
//! evidence for matrix rows 1-26 says "evidenced" for exactly the policy
//! revision the caller names, and the switch was not turned on for that
//! revision before. The production evidence source is closed: no
//! machine-readable evidence exists yet (the matrix is prose and the readiness
//! audit hard-codes every evidence flag to false), so the switch stays locked.
use super::scheduler::{self, SchedulerPermit};
use crate::store::Store;

/// Setting holding the policy revision the switch was enabled for.
const ENABLED_REVISION_KEY: &str = "continuous.activation.revision";

/// Proof that every gate of [`Activation::enable`] passed. Only this module
/// can build one, so only this module can reach the permit constructor.
pub struct ActivationGrant(());

#[derive(Debug, PartialEq, Eq, Clone)]
pub enum Evidence {
    /// No machine-readable source, or rows 1-26 are not all evidenced.
    Locked(String),
    /// Rows 1-26 are evidenced for this policy revision.
    Accepted { revision: u64 },
}

pub trait EvidenceSource: Sync {
    fn rows_1_to_26(&self) -> Evidence;
}

/// Production source: stays locked until a trusted machine-readable record of
/// the acceptance matrix exists and is wired in here.
pub struct NoMachineReadableEvidence;

impl EvidenceSource for NoMachineReadableEvidence {
    fn rows_1_to_26(&self) -> Evidence {
        Evidence::Locked("no machine-readable acceptance evidence for rows 1-26".into())
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum ActivationRefusal {
    BadVerdictToken,
    EmergencyStop,
    Locked(String),
    StaleRevision { accepted: u64, requested: u64 },
    AlreadyEnabled,
    Store(String),
}

#[derive(Default)]
pub struct Activation {
    gate: tokio::sync::Mutex<()>,
}

fn tokens_match(expected: &str, given: &str) -> bool {
    expected.len() == given.len()
        && !expected.is_empty()
        && expected
            .bytes()
            .zip(given.bytes())
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            == 0
}

impl Activation {
    /// Read-only state for the Control API capabilities and the window.
    pub async fn status(
        store: &Store,
        evidence: &dyn EvidenceSource,
    ) -> Result<serde_json::Value, String> {
        let enabled = store.get_setting(ENABLED_REVISION_KEY).await?;
        let locked = match evidence.rows_1_to_26() {
            Evidence::Locked(reason) => serde_json::json!(reason),
            Evidence::Accepted { .. } => serde_json::Value::Null,
        };
        Ok(serde_json::json!({
            "locked": !locked.is_null(), "lockReason": locked, "enabled": enabled.is_some(),
        }))
    }

    /// Turn the switch on once for `requested` and hand out the permit.
    pub async fn enable(
        &self,
        store: &Store,
        evidence: &dyn EvidenceSource,
        expected_token: &str,
        given_token: &str,
        requested: u64,
    ) -> Result<SchedulerPermit, ActivationRefusal> {
        if !tokens_match(expected_token, given_token) {
            return Err(ActivationRefusal::BadVerdictToken);
        }
        let _guard = self.gate.lock().await;
        let stopped = store
            .emergency_stop_active()
            .await
            .map_err(ActivationRefusal::Store)?;
        if stopped {
            return Err(ActivationRefusal::EmergencyStop);
        }
        let accepted = match evidence.rows_1_to_26() {
            Evidence::Locked(reason) => return Err(ActivationRefusal::Locked(reason)),
            Evidence::Accepted { revision } => revision,
        };
        if accepted != requested {
            return Err(ActivationRefusal::StaleRevision {
                accepted,
                requested,
            });
        }
        let prior = store
            .get_setting(ENABLED_REVISION_KEY)
            .await
            .map_err(ActivationRefusal::Store)?;
        if prior.is_some() {
            return Err(ActivationRefusal::AlreadyEnabled);
        }
        // The stop is not re-checked after this write: dispatch writes are guarded
        // by the emergency-stop triggers in the store, so a stop that latches now
        // still blocks every use of the permit.
        store
            .set_setting(ENABLED_REVISION_KEY, &requested.to_string())
            .await
            .map_err(ActivationRefusal::Store)?;
        Ok(scheduler::permit_from_grant(ActivationGrant(())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    struct Unlocked(u64);
    impl EvidenceSource for Unlocked {
        fn rows_1_to_26(&self) -> Evidence {
            Evidence::Accepted { revision: self.0 }
        }
    }

    async fn store(label: &str) -> (TempDir, Store) {
        let dir = TempDir::new(label);
        let store = Store::open(&dir.path().join("projecta.db"))
            .await
            .expect("open store");
        (dir, store)
    }

    #[tokio::test]
    async fn activation_stays_locked_without_machine_readable_evidence() {
        let (_dir, store) = store("activation-locked").await;
        let refusal = Activation::default()
            .enable(&store, &NoMachineReadableEvidence, "tok", "tok", 1)
            .await
            .err()
            .expect("a locked switch must refuse");
        assert!(matches!(refusal, ActivationRefusal::Locked(_)));
        assert_eq!(store.get_setting(ENABLED_REVISION_KEY).await.unwrap(), None);
        let status = Activation::status(&store, &NoMachineReadableEvidence)
            .await
            .unwrap();
        assert_eq!(status["locked"], true);
        assert_eq!(status["enabled"], false);
    }

    #[tokio::test]
    async fn activation_refuses_missing_or_wrong_verdict_token() {
        let (_dir, store) = store("activation-token").await;
        let activation = Activation::default();
        for given in ["", "wrong", "tok-and-more", "t0k", "toK"] {
            let refusal = activation
                .enable(&store, &Unlocked(1), "tok", given, 1)
                .await
                .err()
                .expect("a bad token must refuse");
            assert_eq!(refusal, ActivationRefusal::BadVerdictToken);
        }
        assert_eq!(store.get_setting(ENABLED_REVISION_KEY).await.unwrap(), None);
    }

    #[tokio::test]
    async fn activation_refuses_a_stale_policy_revision() {
        let (_dir, store) = store("activation-stale").await;
        let refusal = Activation::default()
            .enable(&store, &Unlocked(5), "tok", "tok", 4)
            .await
            .err()
            .expect("a stale revision must refuse");
        assert_eq!(
            refusal,
            ActivationRefusal::StaleRevision {
                accepted: 5,
                requested: 4
            }
        );
        assert_eq!(store.get_setting(ENABLED_REVISION_KEY).await.unwrap(), None);
    }

    #[tokio::test]
    async fn activation_refuses_while_the_emergency_stop_is_active() {
        let (_dir, store) = store("activation-estop").await;
        store.set_emergency_stop(true, "test").await.unwrap();
        let refusal = Activation::default()
            .enable(&store, &Unlocked(1), "tok", "tok", 1)
            .await
            .err()
            .expect("the emergency stop overrides everything");
        assert_eq!(refusal, ActivationRefusal::EmergencyStop);
        assert_eq!(store.get_setting(ENABLED_REVISION_KEY).await.unwrap(), None);
    }

    #[tokio::test]
    async fn unlocked_activation_enables_exactly_once_for_the_accepted_revision() {
        let (_dir, store) = store("activation-once").await;
        let activation = Activation::default();
        let _permit = activation
            .enable(&store, &Unlocked(7), "tok", "tok", 7)
            .await
            .expect("the accepted revision enables");
        assert_eq!(
            store.get_setting(ENABLED_REVISION_KEY).await.unwrap(),
            Some("7".to_string())
        );
        let again = activation
            .enable(&store, &Unlocked(7), "tok", "tok", 7)
            .await
            .err()
            .expect("a second enable must refuse");
        assert_eq!(again, ActivationRefusal::AlreadyEnabled);
    }

    #[test]
    fn only_the_activation_module_builds_a_production_permit() {
        let scheduler = include_str!("scheduler.rs").replace("\r\n", "\n");
        assert_eq!(scheduler.matches("SchedulerPermit(())").count(), 3);
        assert!(scheduler.contains("pub(super) fn permit_from_grant(_grant: ActivationGrant)"));
    }
}
