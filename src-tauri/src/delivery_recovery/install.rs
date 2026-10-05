//! The production install gate: the direct `update.install` call may only run
//! inside the journal driver, after drain, write-block and backup evidence.
//!
//! The journal phase carries the persisted drain proof and verified backup
//! (`begin_install` itself refuses without them); the live facts (freeze,
//! write block, empty registry) are re-observed here, because a persisted proof
//! says nothing about the process that is about to install.

use super::driver::{RecoveryDriver, RecoveryEffects};
use super::{
    DurableJournal, FileIdentity, InstanceHandshake, PromotionReceipt, RecoveryAction,
    RuntimeIdentity, StagedManifestIdentity, VerifiedBackup, WriteResumption,
};
use crate::pty::PtyManager;

type Fx<T> = std::result::Result<T, String>;

/// Refuses unless every precondition of the installer is observed now.
#[allow(dead_code)] // wired by `install_update_when_idle`
pub fn require_install_evidence(
    pty: &PtyManager,
    store_write_block: bool,
    journal: &DurableJournal,
) -> Fx<()> {
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
    match journal.next_action() {
        RecoveryAction::InstallCandidate { .. } => Ok(()),
        _ => Err(format!(
            "update journal is in phase {:?}, without drain and backup evidence; refusing to install",
            journal.journal().phase()
        )),
    }
}

/// Persists `Installing`, then runs `install` exactly once under the PTY
/// install latch. Never reaches `install` unless the evidence holds.
#[allow(dead_code)] // wired by `install_update_when_idle`
pub fn install_through_journal(
    pty: &PtyManager,
    store_write_block: bool,
    journal: DurableJournal,
    install: impl FnOnce() -> Fx<()>,
) -> Fx<()> {
    require_install_evidence(pty, store_write_block, &journal)?;
    let mut driver = RecoveryDriver::new(journal, InstallOnly(Some(install)));
    pty.install_in_maintenance(|| driver.step().map(|_| ()).map_err(|error| error.to_string()))
}

/// Only `install` is driven here; every later step belongs to the restart
/// validation, so the other effects refuse.
struct InstallOnly<F>(Option<F>);

fn not_here<T>() -> Fx<T> {
    Err("not part of the install step".into())
}

impl<F: FnOnce() -> Fx<()>> RecoveryEffects for InstallOnly<F> {
    fn verify_backup(&mut self) -> Fx<VerifiedBackup> {
        not_here()
    }
    fn install(&mut self, _: &FileIdentity, _: &StagedManifestIdentity) -> Fx<()> {
        (self.0.take().ok_or("installer already consumed")?)()
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

    /// Journal at `BackupVerified` unless a step is left out.
    fn journal(dir: &TempDir, with_drain: bool, with_backup: bool) -> DurableJournal {
        let mut journal =
            DurableJournal::create(store(dir), UpdateJournal::new(offer()).unwrap()).unwrap();
        journal.record_downloaded(&offer().staged_manifest).unwrap();
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
        let error = install_through_journal(pty, write_block, journal, || {
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
    fn production_install_persists_installing_then_runs_the_installer_once() {
        let dir = TempDir::new("install-gate-ok");
        let pty = frozen();
        let calls = Cell::new(0);
        install_through_journal(&pty, true, journal(&dir, true, true), || {
            calls.set(calls.get() + 1);
            Ok(())
        })
        .unwrap();
        assert_eq!(calls.get(), 1);
        let reopened = DurableJournal::open(store(&dir)).unwrap();
        assert_eq!(reopened.journal().phase(), UpdatePhase::Installing);
        // The latch stays: a second install in this process is refused.
        assert!(pty.install_in_maintenance(|| Ok(())).is_err());
    }
}
