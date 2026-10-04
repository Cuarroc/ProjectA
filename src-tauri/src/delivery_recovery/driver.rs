//! Executes exactly one `RecoveryAction` per step.
//!
//! The driver is pure orchestration: every external effect (installer, file
//! swap, process start) goes through `RecoveryEffects`, so tests use a fake.
//! Destructive effects are preceded by a durable phase transition; effects
//! that merely observe the world are followed by recording their evidence.

use super::{
    DurableJournal, FileIdentity, InstanceHandshake, PromotionReceipt, RecoveryAction,
    RecoveryError, Result, RuntimeIdentity, StagedManifestIdentity, UpdatePhase, VerifiedBackup,
    WriteResumption,
};

/// The side-effecting half of the helper.  Errors are human-readable reasons.
#[allow(dead_code)] // W3-02
pub trait RecoveryEffects {
    fn verify_backup(&mut self) -> std::result::Result<VerifiedBackup, String>;
    fn install(
        &mut self,
        candidate: &FileIdentity,
        manifest: &StagedManifestIdentity,
    ) -> std::result::Result<(), String>;
    fn validate(
        &mut self,
        candidate: &RuntimeIdentity,
        nonce: &str,
    ) -> std::result::Result<InstanceHandshake, String>;
    fn resume_writes(&mut self) -> std::result::Result<WriteResumption, String>;
    fn promote(&mut self, candidate_id: &str) -> std::result::Result<PromotionReceipt, String>;
    fn restore(
        &mut self,
        previous: &RuntimeIdentity,
        snapshot: &FileIdentity,
    ) -> std::result::Result<(), String>;
    fn quarantine(&mut self, reason: &str) -> std::result::Result<(), String>;
}

/// What one step did.
#[derive(Clone, Debug, Eq, PartialEq)]
#[allow(dead_code)] // W3-02
pub enum StepOutcome {
    /// Nothing to execute (`NoAction` / `WaitForIdle`).
    Idle,
    /// The one action that was executed.
    Executed(RecoveryAction),
}

#[allow(dead_code)] // W3-02
pub struct RecoveryDriver<E: RecoveryEffects> {
    journal: DurableJournal,
    effects: E,
}

impl<E: RecoveryEffects> RecoveryDriver<E> {
    #[allow(dead_code)] // W3-02
    pub fn new(journal: DurableJournal, effects: E) -> Self {
        Self { journal, effects }
    }

    #[allow(dead_code)] // W3-02
    pub fn journal(&self) -> &DurableJournal {
        &self.journal
    }

    #[allow(dead_code)] // W3-02
    pub fn step(&mut self) -> Result<StepOutcome> {
        let _ = (
            &mut self.journal,
            &mut self.effects,
            RecoveryError::Effect(String::new()),
        );
        let _ = UpdatePhase::Installing;
        todo!("journal driver")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delivery_recovery::tests::{backup, handshake, offer, proof, receipt, store};
    use crate::delivery_recovery::{JournalStore, UpdateJournal};
    use crate::testutil::TempDir;

    #[derive(Default)]
    struct Fake {
        calls: Vec<&'static str>,
        /// Journal location, to observe what was durable when an effect ran.
        journal: Option<JournalStore>,
        phase_seen_by_install: Option<UpdatePhase>,
        validation_fails: bool,
    }

    impl RecoveryEffects for Fake {
        fn verify_backup(&mut self) -> std::result::Result<VerifiedBackup, String> {
            self.calls.push("verify_backup");
            Ok(backup())
        }
        fn install(
            &mut self,
            _: &FileIdentity,
            _: &StagedManifestIdentity,
        ) -> std::result::Result<(), String> {
            self.calls.push("install");
            self.phase_seen_by_install = self
                .journal
                .as_ref()
                .map(|store| store.load().unwrap().phase());
            Ok(())
        }
        fn validate(
            &mut self,
            _: &RuntimeIdentity,
            _: &str,
        ) -> std::result::Result<InstanceHandshake, String> {
            self.calls.push("validate");
            if self.validation_fails {
                Err("candidate unhealthy".into())
            } else {
                Ok(handshake())
            }
        }
        fn resume_writes(&mut self) -> std::result::Result<WriteResumption, String> {
            self.calls.push("resume_writes");
            Ok(WriteResumption {
                evidence_id: "resume".into(),
            })
        }
        fn promote(&mut self, _: &str) -> std::result::Result<PromotionReceipt, String> {
            self.calls.push("promote");
            Ok(receipt())
        }
        fn restore(
            &mut self,
            _: &RuntimeIdentity,
            _: &FileIdentity,
        ) -> std::result::Result<(), String> {
            self.calls.push("restore");
            Ok(())
        }
        fn quarantine(&mut self, _: &str) -> std::result::Result<(), String> {
            self.calls.push("quarantine");
            Ok(())
        }
    }

    fn driver_at_backup_verified(dir: &TempDir) -> RecoveryDriver<Fake> {
        let location = store(dir);
        let mut journal =
            DurableJournal::create(location.clone(), UpdateJournal::new(offer()).unwrap()).unwrap();
        let manifest = offer().staged_manifest;
        journal.record_downloaded(&manifest).unwrap();
        journal.wait_for_idle().unwrap();
        journal.enter_maintenance(proof()).unwrap();
        journal.verify_backup(backup()).unwrap();
        RecoveryDriver::new(
            journal,
            Fake {
                journal: Some(location),
                ..Fake::default()
            },
        )
    }

    #[test]
    fn interrupted_after_persisted_installing_only_validates_never_installs_again() {
        let dir = TempDir::new("driver-no-second-install");
        let mut first = driver_at_backup_verified(&dir);
        first.step().unwrap();
        assert_eq!(
            first.effects.phase_seen_by_install,
            Some(UpdatePhase::Installing)
        );
        // Power loss right after the install effect: the process is gone, the
        // journal on disk says Installing.  Restart with a fresh adapter.
        let reopened = DurableJournal::open(store(&dir)).unwrap();
        assert_eq!(reopened.journal().phase(), UpdatePhase::Installing);
        let mut second = RecoveryDriver::new(reopened, Fake::default());
        let outcome = second.step().unwrap();
        assert!(matches!(
            outcome,
            StepOutcome::Executed(RecoveryAction::ValidateCandidate { .. })
        ));
        assert_eq!(second.effects.calls, vec!["validate"]);
        assert_eq!(second.journal.journal().phase(), UpdatePhase::Installed);
    }

    #[test]
    fn failed_validation_is_recorded_then_restores_the_backup_once() {
        let dir = TempDir::new("driver-restore");
        let mut driver = driver_at_backup_verified(&dir);
        driver.effects.validation_fails = true;
        driver.step().unwrap(); // install
        driver.step().unwrap(); // validate -> health failure persisted
        let reopened = DurableJournal::open(store(&dir)).unwrap();
        assert_eq!(reopened.journal().phase(), UpdatePhase::RecoveryNeeded);
        let mut restart = RecoveryDriver::new(reopened, Fake::default());
        restart.step().unwrap();
        assert_eq!(restart.effects.calls, vec!["restore"]);
    }

    #[test]
    fn happy_path_runs_one_action_per_step_to_promotion() {
        let dir = TempDir::new("driver-happy");
        let mut driver = driver_at_backup_verified(&dir);
        for _ in 0..4 {
            driver.step().unwrap();
        }
        assert_eq!(
            driver.effects.calls,
            vec!["install", "validate", "resume_writes", "promote"]
        );
        assert_eq!(driver.journal.journal().phase(), UpdatePhase::Promoted);
        assert_eq!(driver.step().unwrap(), StepOutcome::Idle);
        assert_eq!(driver.effects.calls.len(), 4);
    }
}
