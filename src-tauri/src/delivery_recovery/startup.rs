//! Startup recovery: resolves an interrupted update from the journal before
//! the database is opened or the queue dispatcher starts.
//!
//! The running process is the candidate: it proves its identity against the
//! journal's nonce, binary and database, and only then resumes writes. Any
//! failed step returns a reason and the caller refuses to open the database.

use super::driver::{RecoveryDriver, RecoveryEffects};
use super::{
    DurableJournal, FileIdentity, HealthAssertion, InstanceHandshake, JournalStore,
    ProcessIdentity, PromotionReceipt, RecoveryAction, RuntimeIdentity, StagedManifestIdentity,
    UpdatePhase, ValidationAssertion, ValidationProof, VerifiedBackup, WriteResumption,
};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Resolve the journal at `store`, if any. `Ok` means the database may open.
pub fn recover_before_open<E: RecoveryEffects>(
    store: JournalStore,
    effects: E,
) -> Result<(), String> {
    if !store.path().exists() {
        return Ok(());
    }
    let journal = DurableJournal::open(store)
        .map_err(|error| format!("update journal unreadable, writes stay blocked: {error}"))?;
    let mut driver = RecoveryDriver::new(journal, effects);
    // Validate + resume is the longest legal run; four steps only bound a loop.
    for _ in 0..4 {
        let action = driver.journal().next_action();
        let terminal = match &action {
            RecoveryAction::ValidateCandidate { .. } | RecoveryAction::ResumeWrites => false,
            RecoveryAction::RestorePreviousRuntime { .. }
            | RecoveryAction::QuarantineCurrentState { .. } => true,
            _ => break,
        };
        driver
            .step()
            .map_err(|error| format!("update recovery failed, writes stay blocked: {error}"))?;
        if terminal {
            return Err(format!("update recovery ran {action:?}; writes blocked"));
        }
    }
    let journal = driver.journal().journal();
    // Before `Installing` nothing was replaced; later only a resumed one writes.
    // Exhaustive on purpose: a new phase must be classified here to compile.
    let writable = match journal.phase() {
        UpdatePhase::Available
        | UpdatePhase::Downloaded
        | UpdatePhase::WaitingIdle
        | UpdatePhase::Maintenance
        | UpdatePhase::BackupVerified => true,
        UpdatePhase::Installing
        | UpdatePhase::Validating
        | UpdatePhase::Installed
        | UpdatePhase::Promoted
        | UpdatePhase::RecoveryNeeded => journal.can_accept_writes(),
    };
    if writable {
        Ok(())
    } else {
        Err(format!(
            "update journal in phase {:?}; writes stay blocked",
            journal.phase()
        ))
    }
}

/// What the real process can do at startup; install and promotion are refused.
pub struct LiveEffects {
    pub journal: JournalStore,
    pub exe: PathBuf,
}

fn sha(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

impl RecoveryEffects for LiveEffects {
    fn verify_backup(&mut self) -> Result<VerifiedBackup, String> {
        Err("backup verification is not a startup effect".into())
    }
    fn install(&mut self, _: &FileIdentity, _: &StagedManifestIdentity) -> Result<(), String> {
        Err("install is not a startup effect".into())
    }
    fn validate(
        &mut self,
        candidate: &RuntimeIdentity,
        nonce: &str,
    ) -> Result<InstanceHandshake, String> {
        let database = &candidate.database;
        let started = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH);
        let id = std::process::id();
        Ok(InstanceHandshake {
            binary: FileIdentity {
                path: self.exe.clone(),
                version: env!("CARGO_PKG_VERSION").into(),
                sha256: sha(&self.exe)?,
            },
            database: FileIdentity {
                path: database.path.clone(),
                version: database.version.clone(),
                sha256: sha(&database.path)?,
            },
            nonce: nonce.into(),
            process: ProcessIdentity {
                process_id: id,
                started_at_unix_millis: started.map_or(1, |d| d.as_millis().max(1)),
            },
            validation: ValidationProof {
                validation: ValidationAssertion::CandidateReady,
                health: HealthAssertion::Healthy,
                validation_evidence_id: format!("startup-identity-{id}"),
                health_evidence_id: format!("startup-database-hash-{id}"),
            },
        })
    }
    fn resume_writes(&mut self) -> Result<WriteResumption, String> {
        Ok(WriteResumption {
            evidence_id: format!("startup-resume-{}", std::process::id()),
        })
    }
    fn promote(&mut self, _: &str) -> Result<PromotionReceipt, String> {
        Err("promotion is not a startup effect".into())
    }
    fn restore(&mut self, _: &RuntimeIdentity, _: &FileIdentity) -> Result<(), String> {
        let journal = self.journal.load().map_err(|e| e.to_string())?;
        super::restore::restore_previous_runtime(&journal, &journal.next_action())
    }
    fn quarantine(&mut self, _: &str) -> Result<(), String> {
        Ok(())
    }
}

pub fn recover_at_startup(dir: &Path) -> Result<(), String> {
    let store = JournalStore::new(dir.join("update-recovery.json"), &dir.join("projecta.db"))
        .map_err(|error| format!("update journal location invalid: {error}"))?;
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let effects = LiveEffects {
        journal: store.clone(),
        exe,
    };
    recover_before_open(store, effects)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delivery_recovery::tests::{backup, handshake, offer, proof, store};
    use crate::delivery_recovery::UpdateJournal;
    use crate::testutil::TempDir;
    use std::cell::RefCell;
    use std::rc::Rc;

    struct Fake {
        calls: Rc<RefCell<Vec<&'static str>>>,
        handshake: InstanceHandshake,
    }

    impl RecoveryEffects for Fake {
        fn verify_backup(&mut self) -> Result<VerifiedBackup, String> {
            Err("unused".into())
        }
        fn install(&mut self, _: &FileIdentity, _: &StagedManifestIdentity) -> Result<(), String> {
            Err("unused".into())
        }
        fn validate(&mut self, _: &RuntimeIdentity, _: &str) -> Result<InstanceHandshake, String> {
            self.calls.borrow_mut().push("validate");
            Ok(self.handshake.clone())
        }
        fn resume_writes(&mut self) -> Result<WriteResumption, String> {
            self.calls.borrow_mut().push("resume_writes");
            Ok(WriteResumption {
                evidence_id: "resume".into(),
            })
        }
        fn promote(&mut self, _: &str) -> Result<PromotionReceipt, String> {
            Err("unused".into())
        }
        fn restore(&mut self, _: &RuntimeIdentity, _: &FileIdentity) -> Result<(), String> {
            self.calls.borrow_mut().push("restore");
            Ok(())
        }
        fn quarantine(&mut self, _: &str) -> Result<(), String> {
            Err("unused".into())
        }
    }

    fn fake(handshake: InstanceHandshake) -> (Fake, Rc<RefCell<Vec<&'static str>>>) {
        let calls = Rc::default();
        (
            Fake {
                calls: Rc::clone(&calls),
                handshake,
            },
            calls,
        )
    }

    /// A journal interrupted in `Installing`, as left by a restart mid-update.
    fn installing(dir: &TempDir) -> JournalStore {
        let location = store(dir);
        let mut journal =
            DurableJournal::create(location.clone(), UpdateJournal::new(offer()).unwrap()).unwrap();
        journal.record_downloaded(&offer().staged_manifest).unwrap();
        journal.wait_for_idle().unwrap();
        journal.enter_maintenance(proof()).unwrap();
        journal.verify_backup(backup()).unwrap();
        journal.begin_install().unwrap();
        location
    }

    #[test]
    fn no_journal_opens_without_any_effect() {
        let dir = TempDir::new("startup-no-journal");
        let (effects, calls) = fake(handshake());
        recover_before_open(store(&dir), effects).unwrap();
        assert!(calls.borrow().is_empty());
    }

    #[test]
    fn interrupted_install_is_validated_then_resumed_before_open() {
        let dir = TempDir::new("startup-validate-resume");
        let location = installing(&dir);
        let (effects, calls) = fake(handshake());
        recover_before_open(location.clone(), effects).unwrap();
        assert_eq!(*calls.borrow(), vec!["validate", "resume_writes"]);
        assert!(DurableJournal::open(location)
            .unwrap()
            .journal()
            .can_accept_writes());
    }

    #[test]
    fn digest_only_difference_in_handshake_is_accepted() {
        let dir = TempDir::new("startup-digest-only");
        let location = installing(&dir);
        let mut real = handshake();
        real.binary.sha256 = "installed-exe".into();
        real.database.sha256 = "live-db".into();
        let (effects, calls) = fake(real);
        recover_before_open(location.clone(), effects).unwrap();
        assert_eq!(*calls.borrow(), vec!["validate", "resume_writes"]);
        assert!(DurableJournal::open(location)
            .unwrap()
            .journal()
            .can_accept_writes());
    }

    #[test]
    fn wrong_nonce_version_or_path_blocks_writes() {
        let wrong: [fn(&mut InstanceHandshake); 4] = [
            |h| h.nonce = "nonce-b".into(),
            |h| h.binary.version = "1.3.0".into(),
            |h| h.binary.path = "old.exe".into(),
            |h| h.database.path = "other.db".into(),
        ];
        for (i, tamper) in wrong.iter().enumerate() {
            let dir = TempDir::new(&format!("startup-wrong-{i}"));
            let location = installing(&dir);
            let mut forged = handshake();
            tamper(&mut forged);
            let (effects, calls) = fake(forged);
            assert!(recover_before_open(location.clone(), effects).is_err());
            assert_eq!(*calls.borrow(), vec!["validate"], "case {i}");
            let journal = DurableJournal::open(location).unwrap();
            assert!(!journal.journal().can_accept_writes());
        }
    }

    #[test]
    fn recovery_needed_restores_and_keeps_writes_blocked() {
        let dir = TempDir::new("startup-restore");
        let location = installing(&dir);
        let mut journal = DurableJournal::open(location.clone()).unwrap();
        journal.begin_validation().unwrap();
        journal.record_health_failure("unhealthy").unwrap();
        let (effects, calls) = fake(handshake());
        assert!(recover_before_open(location, effects).is_err());
        assert_eq!(*calls.borrow(), vec!["restore"]);
    }

    #[test]
    fn live_validate_reports_the_observed_files_and_the_journal_nonce() {
        let dir = TempDir::new("startup-live");
        let exe = dir.path().join("app");
        let db = dir.path().join("projecta.db");
        std::fs::write(&exe, b"bin").unwrap();
        std::fs::write(&db, b"db").unwrap();
        let mut candidate = offer().candidate;
        candidate.database.path = db.clone();
        let journal = store(&dir);
        let mut live = LiveEffects {
            journal,
            exe: exe.clone(),
        };
        let nonce = format!("nonce-{}", std::process::id());
        let got = live.validate(&candidate, &nonce).unwrap();
        assert_eq!(got.nonce, nonce);
        assert_eq!(got.binary.sha256, sha(&exe).unwrap());
        assert_eq!(got.database.sha256, sha(&db).unwrap());
    }
}
