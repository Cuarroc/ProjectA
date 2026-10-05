//! The production install gate: the direct `update.install` call may only run
//! inside the journal driver, after drain, write-block and backup evidence.
//!
//! The journal phase carries the persisted drain proof and verified backup
//! (`begin_install` itself refuses without them); the live facts (freeze,
//! write block, empty registry) are re-observed here, because a persisted proof
//! says nothing about the process that is about to install.

use super::driver::{RecoveryDriver, RecoveryEffects};
use super::{
    DrainProof, DurableJournal, FileIdentity, ImmutableRecords, InstanceHandshake, JournalStore,
    MaintenanceMode, PromotionReceipt, PtyDrain, QueueDrain, RecoveryAction, RuntimeIdentity,
    StagedManifestIdentity, UpdateJournal, UpdateOffer, UpdatePhase, VerifiedBackup, WriteBlock,
    WriteResumption,
};
use crate::pty::PtyManager;
use crate::store::Store;
use sha2::{Digest, Sha256};
use std::path::Path;

type Fx<T> = std::result::Result<T, String>;

/// What the updater announces and the exact bytes `update.install` will
/// receive: the journal's artifact digest is the digest of `bytes`.
pub struct Announced<'a> {
    pub exe: &'a Path,
    pub database: &'a Path,
    pub version: &'a str,
    pub bytes: &'a [u8],
    pub manifest: &'a str,
}

fn sha_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn identity(path: &Path, version: &str, sha256: String) -> FileIdentity {
    FileIdentity {
        path: path.to_path_buf(),
        version: version.into(),
        sha256,
    }
}

/// Snapshot of the quiesced database; its digest is the journal's database
/// identity.
async fn snapshot_database(store: &Store, target: &Path) -> Fx<FileIdentity> {
    let _ = std::fs::remove_file(target);
    store.snapshot_into(target).await?;
    let bytes = std::fs::read(target).map_err(|e| format!("read backup: {e}"))?;
    Ok(identity(target, "snapshot", sha_hex(&bytes)))
}

/// True while no installer can have run, so leaving maintenance is safe.
pub fn installer_not_started(phase: UpdatePhase) -> bool {
    matches!(
        phase,
        UpdatePhase::Available
            | UpdatePhase::Downloaded
            | UpdatePhase::WaitingIdle
            | UpdatePhase::Maintenance
            | UpdatePhase::BackupVerified
    )
}

/// Creates the journal at `BackupVerified` before the download. Needs the
/// live drain facts (`require_live_evidence`); a stale journal that never
/// reached `Installing` is replaced, a later one is left to startup recovery.
pub async fn produce_journal(
    pty: &PtyManager,
    store: &Store,
    journal_store: JournalStore,
    announced: &Announced<'_>,
) -> Fx<DurableJournal> {
    require_live_evidence(pty, store.is_maintenance_active())?;
    if journal_store.path().exists() {
        let stale = journal_store.load().map_err(|e| e.to_string())?;
        if !installer_not_started(stale.phase()) {
            return Err(format!(
                "update journal is in phase {:?}; refusing to start another update",
                stale.phase()
            ));
        }
        std::fs::remove_file(journal_store.path()).map_err(|e| e.to_string())?;
    }
    let backup_path = announced.database.with_extension("update-backup");
    let snapshot = snapshot_database(store, &backup_path).await?;
    let database = identity(announced.database, "sqlite", snapshot.sha256.clone());
    let exe = std::fs::read(announced.exe).map_err(|e| format!("read installed binary: {e}"))?;
    let signed = sha_hex(announced.bytes);
    let staged = StagedManifestIdentity {
        manifest_sha256: sha_hex(announced.manifest.as_bytes()),
        signed_artifact_sha256: signed.clone(),
        candidate_version: announced.version.into(),
    };
    let offer = UpdateOffer {
        records: ImmutableRecords {
            policy_id: "in-app-update".into(),
            candidate_id: format!("{}-{}", announced.version, &signed[..12]),
            evidence_id: "app-update-producer".into(),
        },
        nonce: crate::oneshot::random_hex(),
        previous: RuntimeIdentity {
            binary: identity(announced.exe, env!("CARGO_PKG_VERSION"), sha_hex(&exe)),
            database: database.clone(),
        },
        candidate: RuntimeIdentity {
            // `sha256` is the signed payload digest, not the installed exe's;
            // the post-restart handshake records the latter (see
            // `UpdateJournal::accept_handshake`).
            binary: identity(announced.exe, announced.version, signed),
            database: database.clone(),
        },
        staged_manifest: staged.clone(),
    };
    let drain = DrainProof {
        queue_drain: QueueDrain::Confirmed,
        pty_drain: PtyDrain::Confirmed,
        maintenance_mode: MaintenanceMode::Active,
        write_block: WriteBlock::Active,
        evidence_id: "install-drain".into(),
        quiesced_database: database,
    };
    let backup = VerifiedBackup {
        source_database_sha256: snapshot.sha256.clone(),
        snapshot,
        checkpoint_evidence_id: "vacuum-into-under-write-lock".into(),
        verification_evidence_id: "quick-check-ok".into(),
    };
    let first = UpdateJournal::new(offer).map_err(|e| e.to_string())?;
    let mut journal = DurableJournal::create(journal_store, first).map_err(|e| e.to_string())?;
    (|| {
        journal.record_downloaded(&staged)?;
        journal.wait_for_idle()?;
        journal.enter_maintenance(drain)?;
        journal.verify_backup(backup)
    })()
    .map_err(|e| e.to_string())?;
    Ok(journal)
}

/// The live facts: write block, session freeze and an empty registry.
fn require_live_evidence(pty: &PtyManager, store_write_block: bool) -> Fx<()> {
    if !store_write_block {
        return Err("write block is not active; refusing to install".into());
    }
    if !pty.is_maintenance_active() {
        return Err("session starts are not frozen; refusing to install".into());
    }
    let live = pty.live_session_ids()?;
    if !live.is_empty() {
        return Err(format!(
            "{} session(s) not drained; refusing to install",
            live.len()
        ));
    }
    Ok(())
}

/// The updater object about to be installed: its bytes and announced version.
#[derive(Clone, Copy)]
pub struct Staged<'a> {
    pub bytes: &'a [u8],
    pub version: &'a str,
}

/// Refuses unless these bytes and this version are the journal's candidate.
fn require_staged_matches(staged: Staged<'_>, manifest: &StagedManifestIdentity) -> Fx<()> {
    if staged.version != manifest.candidate_version {
        return Err(format!(
            "updater version {} differs from the journal's candidate {}; refusing to install",
            staged.version, manifest.candidate_version
        ));
    }
    if sha_hex(staged.bytes) != manifest.signed_artifact_sha256 {
        return Err(
            "updater bytes differ from the journal's artifact digest; refusing to install".into(),
        );
    }
    Ok(())
}

/// Refuses unless every precondition of the installer is observed now.
pub fn require_install_evidence(
    pty: &PtyManager,
    store_write_block: bool,
    journal: &DurableJournal,
    staged: Staged<'_>,
) -> Fx<()> {
    require_live_evidence(pty, store_write_block)?;
    match journal.next_action() {
        RecoveryAction::InstallCandidate {
            staged_manifest, ..
        } => require_staged_matches(staged, &staged_manifest),
        _ => Err(format!(
            "update journal is in phase {:?}, without drain and backup evidence; refusing to install",
            journal.journal().phase()
        )),
    }
}

/// Persists `Installing`, then runs `install` exactly once under the PTY
/// install latch. Never reaches `install` unless the evidence holds.
pub fn install_through_journal(
    pty: &PtyManager,
    store_write_block: bool,
    journal: DurableJournal,
    staged: Staged<'_>,
    install: impl FnOnce(&[u8]) -> Fx<()>,
) -> Fx<()> {
    require_install_evidence(pty, store_write_block, &journal, staged)?;
    let mut driver = RecoveryDriver::new(journal, InstallOnly(Some(install), staged));
    pty.install_in_maintenance(|| driver.step().map(|_| ()).map_err(|error| error.to_string()))
}

/// Only `install` is driven here; every later step belongs to the restart
/// validation, so the other effects refuse.
struct InstallOnly<'a, F>(Option<F>, Staged<'a>);

fn not_here<T>() -> Fx<T> {
    Err("not part of the install step".into())
}

impl<F: FnOnce(&[u8]) -> Fx<()>> RecoveryEffects for InstallOnly<'_, F> {
    fn verify_backup(&mut self) -> Fx<VerifiedBackup> {
        not_here()
    }
    fn install(&mut self, _: &FileIdentity, manifest: &StagedManifestIdentity) -> Fx<()> {
        require_staged_matches(self.1, manifest)?;
        (self.0.take().ok_or("installer already consumed")?)(self.1.bytes)
    }
    fn validate(&mut self, _: &RuntimeIdentity, _: &str) -> Fx<InstanceHandshake> {
        not_here()
    }
    fn resume_writes(&mut self) -> Fx<WriteResumption> {
        not_here()
    }
    fn promote(&mut self, _: &str) -> Fx<PromotionReceipt> {
        not_here()
    }
    fn restore(&mut self, _: &RuntimeIdentity, _: &FileIdentity) -> Fx<()> {
        not_here()
    }
    fn quarantine(&mut self, _: &str) -> Fx<()> {
        not_here()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delivery_recovery::tests::{backup, offer, proof, store};
    use crate::delivery_recovery::{UpdateJournal, UpdatePhase};
    use crate::testutil::TempDir;
    use std::cell::Cell;

    async fn live_db(dir: &TempDir) -> (Store, std::path::PathBuf) {
        let path = dir.path().join("projecta.db");
        (Store::open(&path).await.unwrap(), path)
    }

    const BYTES: &[u8] = b"updater-bytes";

    fn staged(bytes: &[u8]) -> Staged<'_> {
        Staged {
            bytes,
            version: "1.4.0",
        }
    }

    /// The test offer, bound to `BYTES`.
    fn bound_offer() -> crate::delivery_recovery::UpdateOffer {
        let mut offer = offer();
        offer.staged_manifest.signed_artifact_sha256 = sha_hex(BYTES);
        offer
    }

    fn announced<'a>(exe: &'a Path, database: &'a Path) -> Announced<'a> {
        Announced {
            exe,
            database,
            version: "1.5.0",
            bytes: BYTES,
            manifest: "{}",
        }
    }

    #[tokio::test]
    async fn install_command_produces_journal_at_backup_verified_before_download() {
        let dir = TempDir::new("install-producer");
        let (live, database) = live_db(&dir).await;
        live.enter_maintenance().await.unwrap();
        let exe = dir.path().join("app");
        std::fs::write(&exe, b"binary").unwrap();
        let journal = produce_journal(&frozen(), &live, store(&dir), &announced(&exe, &database))
            .await
            .unwrap();
        assert_eq!(journal.journal().phase(), UpdatePhase::BackupVerified);
        let reopened = DurableJournal::open(store(&dir)).unwrap();
        assert_eq!(reopened.journal().phase(), UpdatePhase::BackupVerified);
        let RecoveryAction::InstallCandidate {
            staged_manifest, ..
        } = reopened.next_action()
        else {
            panic!("journal must be ready to install");
        };
        assert_eq!(staged_manifest.signed_artifact_sha256, sha_hex(BYTES));
        let bound = Staged {
            bytes: BYTES,
            version: "1.5.0",
        };
        require_install_evidence(&frozen(), true, &reopened, bound).unwrap();
        assert!(database.with_extension("update-backup").exists());
        // A leftover pre-install journal is replaced, not a permanent refusal.
        produce_journal(&frozen(), &live, store(&dir), &announced(&exe, &database))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn journal_carries_the_digest_of_the_exact_updater_bytes() {
        let dir = TempDir::new("install-producer-digest");
        let (live, database) = live_db(&dir).await;
        live.enter_maintenance().await.unwrap();
        let exe = dir.path().join("app");
        std::fs::write(&exe, b"binary").unwrap();
        let mut offer = announced(&exe, &database);
        offer.manifest = "manifest-not-the-bytes";
        let journal = produce_journal(&frozen(), &live, store(&dir), &offer)
            .await
            .unwrap();
        let RecoveryAction::InstallCandidate {
            candidate,
            staged_manifest,
        } = journal.next_action()
        else {
            panic!("journal must be ready to install");
        };
        assert_eq!(candidate.sha256, sha_hex(BYTES));
        assert_eq!(staged_manifest.signed_artifact_sha256, sha_hex(BYTES));
        assert_ne!(staged_manifest.manifest_sha256, sha_hex(BYTES));
    }

    #[tokio::test]
    async fn producer_refuses_without_live_evidence_and_leaves_no_journal() {
        let dir = TempDir::new("install-producer-refused");
        let (live, database) = live_db(&dir).await;
        let exe = dir.path().join("app");
        std::fs::write(&exe, b"binary").unwrap();
        // No write block yet, then no session freeze.
        let (frozen_pty, offer) = (frozen(), announced(&exe, &database));
        let no_block = produce_journal(&frozen_pty, &live, store(&dir), &offer).await;
        assert!(no_block.unwrap_err().contains("write block"));
        live.enter_maintenance().await.unwrap();
        let thawed = PtyManager::default();
        let no_freeze = produce_journal(&thawed, &live, store(&dir), &offer).await;
        assert!(no_freeze.unwrap_err().contains("frozen"));
        assert!(!store(&dir).path().exists());
        // Past `BackupVerified` the journal belongs to startup recovery.
        let mut later = journal(&dir, true, true);
        later.begin_install().unwrap();
        let error = produce_journal(&frozen(), &live, store(&dir), &announced(&exe, &database))
            .await
            .unwrap_err();
        assert!(error.contains("Installing"), "{error}");
    }

    #[test]
    fn leaving_maintenance_is_allowed_only_before_the_installer() {
        use UpdatePhase::*;
        for phase in [
            Available,
            Downloaded,
            WaitingIdle,
            Maintenance,
            BackupVerified,
        ] {
            assert!(installer_not_started(phase), "{phase:?}");
        }
        for phase in [Installing, Validating, Installed, Promoted, RecoveryNeeded] {
            assert!(!installer_not_started(phase), "{phase:?}");
        }
    }

    /// Journal at `BackupVerified` unless a step is left out.
    fn journal(dir: &TempDir, with_drain: bool, with_backup: bool) -> DurableJournal {
        let mut journal =
            DurableJournal::create(store(dir), UpdateJournal::new(bound_offer()).unwrap()).unwrap();
        journal
            .record_downloaded(&bound_offer().staged_manifest)
            .unwrap();
        journal.wait_for_idle().unwrap();
        if with_drain {
            journal.enter_maintenance(proof()).unwrap();
            if with_backup {
                journal.verify_backup(backup()).unwrap();
            }
        }
        journal
    }

    fn frozen() -> PtyManager {
        let pty = PtyManager::default();
        pty.begin_maintenance().unwrap();
        pty
    }

    fn refused(pty: &PtyManager, write_block: bool, journal: DurableJournal) -> String {
        let calls = Cell::new(0);
        let error = install_through_journal(pty, write_block, journal, staged(BYTES), |_| {
            calls.set(calls.get() + 1);
            Ok(())
        })
        .unwrap_err();
        assert_eq!(calls.get(), 0, "the installer must not be reached: {error}");
        error
    }

    #[test]
    fn production_install_never_reaches_the_installer_without_evidence() {
        let dir = TempDir::new("install-gate-missing");
        assert!(refused(&frozen(), false, journal(&dir, true, true)).contains("write block"));
        let dir = TempDir::new("install-gate-nofreeze");
        let thawed = PtyManager::default();
        assert!(refused(&thawed, true, journal(&dir, true, true)).contains("frozen"));
        let dir = TempDir::new("install-gate-sessions");
        let busy = PtyManager::default();
        let id = busy.reserve_session().unwrap();
        busy.begin_maintenance().unwrap();
        assert!(refused(&busy, true, journal(&dir, true, true)).contains("drained"));
        busy.cancel_reservation(&id);
        let dir = TempDir::new("install-gate-nodrain");
        assert!(refused(&frozen(), true, journal(&dir, false, false)).contains("WaitingIdle"));
        let dir = TempDir::new("install-gate-nobackup");
        let error = refused(&frozen(), true, journal(&dir, true, false));
        assert!(error.contains("Maintenance"), "{error}");
    }

    #[test]
    fn install_refuses_updater_bytes_whose_digest_or_version_differ_from_the_journal() {
        for (i, other) in [
            staged(b"candidate-b-bytes"),
            Staged {
                bytes: BYTES,
                version: "1.9.9",
            },
        ]
        .into_iter()
        .enumerate()
        {
            let dir = TempDir::new(&format!("install-gate-bind-{i}"));
            let error = {
                let calls = Cell::new(0);
                let journal = journal(&dir, true, true);
                let error = install_through_journal(&frozen(), true, journal, other, |_| {
                    calls.set(calls.get() + 1);
                    Ok(())
                })
                .unwrap_err();
                assert_eq!(calls.get(), 0, "{error}");
                error
            };
            assert!(error.contains("differ"), "{error}");
            // Refused before `begin_install`: the journal still waits to install.
            let reopened = DurableJournal::open(store(&dir)).unwrap();
            assert_eq!(reopened.journal().phase(), UpdatePhase::BackupVerified);
        }
    }

    #[test]
    fn production_install_persists_installing_then_runs_the_installer_once() {
        let dir = TempDir::new("install-gate-ok");
        let pty = frozen();
        let calls = Cell::new(0);
        install_through_journal(
            &pty,
            true,
            journal(&dir, true, true),
            staged(BYTES),
            |bytes| {
                assert_eq!(bytes, BYTES);
                calls.set(calls.get() + 1);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(calls.get(), 1);
        let reopened = DurableJournal::open(store(&dir)).unwrap();
        assert_eq!(reopened.journal().phase(), UpdatePhase::Installing);
        // The latch stays: a second install in this process is refused.
        assert!(pty.install_in_maintenance(|| Ok(())).is_err());
    }
}
