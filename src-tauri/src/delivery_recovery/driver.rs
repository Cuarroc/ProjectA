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
    Executed(Box<RecoveryAction>),
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

    /// Reads the one next action from the durable journal and executes it.
    /// A failed effect leaves the journal as persisted, so the next step
    /// derives the same (or the safer) action again.
    #[allow(dead_code)] // W3-02
    pub fn step(&mut self) -> Result<StepOutcome> {
        let action = self.journal.next_action();
        match &action {
            RecoveryAction::NoAction | RecoveryAction::WaitForIdle => return Ok(StepOutcome::Idle),
            RecoveryAction::VerifyCoherentBackup => {
                let backup = self.effects.verify_backup().map_err(effect_error)?;
                self.journal.verify_backup(backup)?;
            }
            RecoveryAction::InstallCandidate {
                candidate,
                staged_manifest,
            } => {
                // Persist first: from here on a restart only validates.
                self.journal.begin_install()?;
                self.effects
                    .install(candidate, staged_manifest)
                    .map_err(effect_error)?;
            }
            RecoveryAction::ValidateCandidate { candidate, nonce } => {
                if self.journal.journal().phase() == UpdatePhase::Installing {
                    self.journal.begin_validation()?;
                }
                // A rejected handshake (e.g. the old binary after a failed
                // install) is a health failure: left in `Validating`, every
                // restart would fail the same way.
                match self.effects.validate(candidate, nonce) {
                    Ok(handshake) => {
                        let accepted = self.journal.accept_handshake(&handshake);
                        self.health_failure_if_rejected(accepted)?
                    }
                    Err(reason) => self.journal.record_health_failure(reason)?,
                }
            }
            RecoveryAction::ResumeWrites => {
                // An effect error (e.g. I/O) stays a hard error: it is
                // transient and the next start retries. A proof the journal
                // rejects would be rejected again, so it is a health failure.
                let proof = self.effects.resume_writes().map_err(effect_error)?;
                let resumed = self.journal.resume_writes(proof);
                self.health_failure_if_rejected(resumed)?
            }
            RecoveryAction::PromoteSameSignedBytes { candidate_id, .. } => {
                // Writes have resumed here, so a rejected receipt must not
                // restore the backup; startup never promotes, so it does not
                // block the database either.
                let receipt = self.effects.promote(candidate_id).map_err(effect_error)?;
                self.journal.promote(&receipt)?;
            }
            RecoveryAction::RestorePreviousRuntime {
                previous, snapshot, ..
            } => self
                .effects
                .restore(previous, snapshot)
                .map_err(effect_error)?,
            RecoveryAction::QuarantineCurrentState { reason } => {
                self.effects.quarantine(reason).map_err(effect_error)?
            }
        }
        Ok(StepOutcome::Executed(Box::new(action)))
    }
}

impl<E: RecoveryEffects> RecoveryDriver<E> {
    /// Turns a semantic rejection by the journal into a durable health
    /// failure; any other error stays a driver error.
    fn health_failure_if_rejected(&mut self, outcome: Result<()>) -> Result<()> {
        match outcome {
            Err(
                rejected @ (RecoveryError::IdentityMismatch(_) | RecoveryError::InvalidFact(_)),
            ) => self.journal.record_health_failure(rejected.to_string()),
            other => other,
        }
    }
}

fn effect_error(reason: String) -> RecoveryError {
    RecoveryError::Effect(reason)
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
        /// The running binary is not the candidate (e.g. a failed install).
        wrong_version: bool,
        /// The write-resumption proof is one the journal rejects.
        empty_resume_proof: bool,
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
            } else if self.wrong_version {
                let mut old = handshake();
                old.binary.version = "1.3.0".into();
                Ok(old)
            } else {
                Ok(handshake())
            }
        }
        fn resume_writes(&mut self) -> std::result::Result<WriteResumption, String> {
            self.calls.push("resume_writes");
            let evidence_id = if self.empty_resume_proof {
                ""
            } else {
                "resume"
            };
            Ok(WriteResumption {
                evidence_id: evidence_id.into(),
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
            StepOutcome::Executed(ref a) if matches!(**a, RecoveryAction::ValidateCandidate { .. })
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

    /// P3-1: a handshake the journal rejects is a health failure, not a
    /// driver error that leaves the journal in `Validating` forever.
    #[test]
    fn rejected_handshake_is_recorded_as_health_failure() {
        let dir = TempDir::new("driver-rejected-handshake");
        let mut driver = driver_at_backup_verified(&dir);
        driver.effects.wrong_version = true;
        driver.step().unwrap(); // install
        driver.step().unwrap(); // validate -> rejected handshake persisted
        let reopened = DurableJournal::open(store(&dir)).unwrap();
        assert_eq!(reopened.journal().phase(), UpdatePhase::RecoveryNeeded);
        assert!(matches!(
            reopened.next_action(),
            RecoveryAction::RestorePreviousRuntime { .. }
        ));
    }

    /// A resume proof the journal rejects is a health failure too: before
    /// writes resume the backup is still the safe state.
    #[test]
    fn rejected_resume_proof_is_recorded_as_health_failure() {
        let dir = TempDir::new("driver-rejected-resume");
        let mut driver = driver_at_backup_verified(&dir);
        driver.effects.empty_resume_proof = true;
        driver.step().unwrap(); // install
        driver.step().unwrap(); // validate
        driver.step().unwrap(); // resume -> rejected proof persisted
        let reopened = DurableJournal::open(store(&dir)).unwrap();
        assert_eq!(reopened.journal().phase(), UpdatePhase::RecoveryNeeded);
        assert!(!reopened.journal().can_accept_writes());
        assert!(matches!(
            reopened.next_action(),
            RecoveryAction::RestorePreviousRuntime { .. }
        ));
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
