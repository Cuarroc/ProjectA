//! Database restore bound to one journal recovery decision.

use super::{RecoveryAction, UpdateJournal};

/// Restore the database named by a recovery action.
///
/// W3-02c adds the identity checks around this filesystem effect.  Keeping the
/// adapter here makes the journal, rather than a free-form path, its authority.
#[allow(dead_code)] // W3-02
pub fn restore_previous_runtime(
    _journal: &UpdateJournal,
    action: &RecoveryAction,
) -> Result<(), String> {
    let RecoveryAction::RestorePreviousRuntime {
        previous, snapshot, ..
    } = action
    else {
        return Err("refused: journal did not request restore".into());
    };
    crate::db_restore::restore_from_pre_migration_backup(&snapshot.path, &previous.database.path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delivery_recovery::{
        DrainProof, FileIdentity, ImmutableRecords, MaintenanceMode, PtyDrain, QueueDrain,
        RuntimeIdentity, StagedManifestIdentity, UpdateOffer, VerifiedBackup, WriteBlock,
    };
    use crate::testutil::TempDir;
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::{Path, PathBuf};

    fn digest(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn identity(path: PathBuf, version: &str, bytes: &[u8]) -> FileIdentity {
        FileIdentity {
            path,
            version: version.into(),
            sha256: digest(bytes),
        }
    }

    fn recovery_journal(dir: &Path) -> (UpdateJournal, PathBuf, PathBuf) {
        let database = dir.join("projecta.db");
        let snapshot = dir.join("projecta.db.pre-migration-1.bak");
        let binary = dir.join("projecta-old.bin");
        fs::write(&database, b"candidate-db").unwrap();
        fs::write(&snapshot, b"original-db").unwrap();
        fs::write(&binary, b"original-binary").unwrap();

        let previous = RuntimeIdentity {
            binary: identity(binary, "1.4.1", b"original-binary"),
            database: identity(database.clone(), "4", b"original-db"),
        };
        let mut journal = UpdateJournal::new(UpdateOffer {
            records: ImmutableRecords {
                policy_id: "policy".into(),
                candidate_id: "candidate".into(),
                evidence_id: "evidence".into(),
            },
            nonce: "nonce".into(),
            previous: previous.clone(),
            candidate: RuntimeIdentity {
                binary: identity(dir.join("projecta-new.bin"), "1.5.0", b"candidate-binary"),
                database: identity(database.clone(), "5", b"candidate-db"),
            },
            staged_manifest: StagedManifestIdentity {
                manifest_sha256: digest(b"manifest"),
                signed_artifact_sha256: digest(b"installer"),
                candidate_version: "1.5.0".into(),
            },
        })
        .unwrap();
        journal
            .record_downloaded(&StagedManifestIdentity {
                manifest_sha256: digest(b"manifest"),
                signed_artifact_sha256: digest(b"installer"),
                candidate_version: "1.5.0".into(),
            })
            .unwrap();
        journal.wait_for_idle().unwrap();
        journal
            .enter_maintenance(DrainProof {
                queue_drain: QueueDrain::Confirmed,
                pty_drain: PtyDrain::Confirmed,
                maintenance_mode: MaintenanceMode::Active,
                write_block: WriteBlock::Active,
                evidence_id: "drain".into(),
                quiesced_database: previous.database,
            })
            .unwrap();
        journal
            .verify_backup(VerifiedBackup {
                snapshot: identity(snapshot.clone(), "4", b"original-db"),
                source_database_sha256: digest(b"original-db"),
                checkpoint_evidence_id: "checkpoint".into(),
                verification_evidence_id: "verification".into(),
            })
            .unwrap();
        journal.begin_install().unwrap();
        journal.begin_validation().unwrap();
        journal
            .record_health_failure("candidate unhealthy")
            .unwrap();
        (journal, database, snapshot)
    }

    #[test]
    fn foreign_backup_never_replaces_the_journal_database() {
        let dir = TempDir::new("restore-foreign");
        let (journal, database, _) = recovery_journal(dir.path());
        let foreign = dir.path().join("projecta.db.pre-migration-2.bak");
        fs::write(&foreign, b"original-db").unwrap();
        let mut action = journal.next_action();
        let RecoveryAction::RestorePreviousRuntime { snapshot, .. } = &mut action else {
            panic!("restore action expected")
        };
        snapshot.path = foreign;

        assert!(restore_previous_runtime(&journal, &action).is_err());
        assert_eq!(fs::read(database).unwrap(), b"candidate-db");
    }

    #[test]
    fn modified_backup_never_replaces_the_journal_database() {
        let dir = TempDir::new("restore-modified");
        let (journal, database, snapshot) = recovery_journal(dir.path());
        fs::write(snapshot, b"modified-db").unwrap();

        assert!(restore_previous_runtime(&journal, &journal.next_action()).is_err());
        assert_eq!(fs::read(database).unwrap(), b"candidate-db");
    }
}
