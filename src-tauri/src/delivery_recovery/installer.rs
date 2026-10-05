//! Installer adapter: runs exactly the staged installer bytes once and
//! classifies what happened.
//!
//! The adapter never retries.  Anything but a proven clean exit is an error
//! for the driver, which has already persisted `Installing`, so a restart only
//! validates (and restores on failure) and never launches the installer again.
//! The launcher is a trait so the contract runs on Linux with a fake process.

use super::staging::{RejectionReason, VerifiedStaging};

/// `ERROR_SHARING_VIOLATION` and `ERROR_LOCK_VIOLATION`.
const SHARING_VIOLATION: [i32; 2] = [32, 33];
/// `ERROR_CANCELLED`: the UAC prompt was declined.
const UAC_REFUSED: [i32; 1] = [1223];
/// `ERROR_ELEVATION_REQUIRED`: the direct launch needs elevation.  This path
/// does not use `ShellExecute`, so no prompt was shown and nobody refused.
const ELEVATION_REQUIRED: i32 = 740;
/// Passive NSIS install, as `tauri-plugin-updater` 2.13 builds it for
/// `installMode: "passive"` (`/P`, then `/UPDATE`; `src/updater.rs`
/// `updater_parameters`, `src/config.rs` `nsis_args`; `tauri.conf.json`
/// `plugins.updater.windows.installMode`).  No `/R`/`/ARGS` relaunch: recovery
/// validates the candidate itself.
pub const NSIS_PASSIVE_ARGS: [&str; 2] = ["/P", "/UPDATE"];

/// What the launcher observed; it carries no judgement.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[allow(dead_code)] // W3-02
pub enum LaunchResult {
    /// The process ran and ended with this exit code.
    Exited(i32),
    /// The process ended without an exit code (killed, signal).
    NoExitCode,
    /// The process did not start; the OS error code if there was one.
    StartFailed(Option<i32>),
}

/// Starts the installer from the given bytes and waits for it.  Called at
/// most once per `run_installer`.
#[allow(dead_code)] // W3-02
pub trait InstallerLauncher {
    fn launch(&mut self, installer: &[u8], args: &[&str]) -> LaunchResult;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[allow(dead_code)] // W3-02
pub enum InstallerOutcome {
    Succeeded,
    UacRefused,
    /// Windows error 740: elevation is required but was not requested.
    ElevationRequired,
    SharingViolation,
    /// Started, but ended with a code that is not proven success.
    Failed(i32),
    /// No exit code or an unknown start failure: the effect is unproven.
    Unclear,
}

#[allow(dead_code)] // W3-02
pub fn classify(result: LaunchResult) -> InstallerOutcome {
    match result {
        LaunchResult::Exited(0) => InstallerOutcome::Succeeded,
        LaunchResult::Exited(code) => InstallerOutcome::Failed(code),
        LaunchResult::NoExitCode | LaunchResult::StartFailed(None) => InstallerOutcome::Unclear,
        LaunchResult::StartFailed(Some(code)) if UAC_REFUSED.contains(&code) => {
            InstallerOutcome::UacRefused
        }
        LaunchResult::StartFailed(Some(ELEVATION_REQUIRED)) => InstallerOutcome::ElevationRequired,
        LaunchResult::StartFailed(Some(code)) if SHARING_VIOLATION.contains(&code) => {
            InstallerOutcome::SharingViolation
        }
        LaunchResult::StartFailed(Some(_)) => InstallerOutcome::Unclear,
    }
}

/// Re-reads the staged files against their identity and launches the
/// installer bytes that passed, once.  `Ok(())` only for a proven clean exit;
/// the error text is the reason for the journal and the user.
#[allow(dead_code)] // W3-02
pub fn run_installer(
    staging: VerifiedStaging,
    launcher: &mut impl InstallerLauncher,
) -> Result<(), String> {
    let outcome = staging
        .install(|payload| classify(launcher.launch(&payload.installer, &NSIS_PASSIVE_ARGS)))
        .map_err(|reason: RejectionReason| format!("staged files changed: {reason:?}"))?;
    match outcome {
        InstallerOutcome::Succeeded => Ok(()),
        InstallerOutcome::UacRefused => Err("installer elevation was refused".into()),
        InstallerOutcome::ElevationRequired => {
            Err("installer needs elevation (error 740); not requested".into())
        }
        InstallerOutcome::SharingViolation => Err("installer file is in use".into()),
        InstallerOutcome::Failed(code) => Err(format!("installer exited with code {code}")),
        InstallerOutcome::Unclear => Err("installer outcome is unclear".into()),
    }
}

/// Windows glue: writes the verified bytes to a new private file, holds that
/// file against writes and deletion, and runs it.
#[cfg(windows)]
#[allow(dead_code)] // W3-02
pub struct ProcessLauncher {
    pub target: std::path::PathBuf,
}

#[cfg(windows)]
impl InstallerLauncher for ProcessLauncher {
    fn launch(&mut self, installer: &[u8], args: &[&str]) -> LaunchResult {
        use std::io::Write;
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_SHARE_READ: u32 = 1;
        let written = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .share_mode(FILE_SHARE_READ)
            .open(&self.target)
            .and_then(|mut file| file.write_all(installer).and_then(|()| file.sync_all()));
        if let Err(error) = written {
            return LaunchResult::StartFailed(error.raw_os_error());
        }
        // Held until `status()` returns, i.e. until the installer process has
        // exited (the `drop` below): the bytes cannot be swapped between this
        // digest check and the launch, nor while the installer runs.
        let held = match projecta_capture::windows_image::VerifiedImage::open(
            &self.target,
            &super::staging::digest(installer),
        ) {
            Ok(held) => held,
            Err(_) => return LaunchResult::StartFailed(None),
        };
        let result = match crate::proc::command(&self.target).args(args).status() {
            Ok(status) => status
                .code()
                .map_or(LaunchResult::NoExitCode, LaunchResult::Exited),
            Err(error) => LaunchResult::StartFailed(error.raw_os_error()),
        };
        drop(held);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delivery_recovery::driver::{RecoveryDriver, RecoveryEffects};
    use crate::delivery_recovery::staging::{digest, ExpectedFile, StagingIdentity, UpdateChannel};
    use crate::delivery_recovery::tests::{backup, offer, proof, store};
    use crate::delivery_recovery::*;
    use crate::testutil::TempDir;
    use std::cell::Cell;
    use std::fs;
    use std::path::Path;
    use std::rc::Rc;

    struct FakeProcess {
        result: LaunchResult,
        launched: Vec<Vec<u8>>,
        args: Vec<Vec<String>>,
        launches: Rc<Cell<u32>>,
    }

    impl InstallerLauncher for FakeProcess {
        fn launch(&mut self, installer: &[u8], args: &[&str]) -> LaunchResult {
            self.launched.push(installer.to_vec());
            self.args.push(args.iter().map(|a| a.to_string()).collect());
            self.launches.set(self.launches.get() + 1);
            self.result
        }
    }

    fn fake(result: LaunchResult) -> FakeProcess {
        FakeProcess {
            result,
            launched: Vec::new(),
            args: Vec::new(),
            launches: Rc::default(),
        }
    }

    fn write_file(dir: &Path, name: &str, bytes: &[u8]) -> ExpectedFile {
        let path = dir.join(name);
        fs::write(&path, bytes).unwrap();
        ExpectedFile {
            path,
            byte_len: bytes.len() as u64,
            sha256: digest(bytes),
        }
    }

    fn staged(dir: &TempDir) -> VerifiedStaging {
        StagingIdentity {
            channel: UpdateChannel::CandidateChannel,
            manifest: write_file(dir.path(), "manifest.json", b"manifest-1"),
            installer: write_file(dir.path(), "installer.bin", b"installer-1"),
            binary: write_file(dir.path(), "projecta.bin", b"binary-1"),
            database: write_file(dir.path(), "projecta.db", b"database-1"),
        }
        .verify()
        .unwrap()
    }

    #[test]
    fn exit_uac_and_sharing_codes_are_classified() {
        use InstallerOutcome::*;
        use LaunchResult::*;
        assert_eq!(classify(Exited(0)), Succeeded);
        assert_eq!(classify(Exited(1602)), Failed(1602));
        assert_eq!(classify(StartFailed(Some(1223))), UacRefused);
        assert_eq!(classify(StartFailed(Some(740))), ElevationRequired);
        assert_eq!(classify(StartFailed(Some(32))), SharingViolation);
        assert_eq!(classify(StartFailed(Some(5))), Unclear);
        assert_eq!(classify(StartFailed(None)), Unclear);
        assert_eq!(classify(NoExitCode), Unclear);
    }

    #[test]
    fn swapped_installer_error_names_expected_and_actual_digest() {
        let dir = TempDir::new("installer-digest-detail");
        let staging = staged(&dir);
        fs::write(dir.path().join("installer.bin"), b"attacker-11").unwrap();
        let mut process = fake(LaunchResult::Exited(0));
        let error = run_installer(staging, &mut process).unwrap_err();
        assert!(error.contains(&digest(b"installer-1")), "{error}");
        assert!(error.contains(&digest(b"attacker-11")), "{error}");
    }

    #[test]
    fn launcher_receives_the_updater_passive_nsis_arguments() {
        let dir = TempDir::new("installer-args");
        let mut process = fake(LaunchResult::Exited(0));
        run_installer(staged(&dir), &mut process).unwrap();
        assert_eq!(
            process.args,
            vec![vec!["/P".to_string(), "/UPDATE".to_string()]]
        );
    }

    #[test]
    fn elevation_required_is_named_and_not_reported_as_a_refusal() {
        let dir = TempDir::new("installer-740");
        let mut process = fake(LaunchResult::StartFailed(Some(740)));
        let error = run_installer(staged(&dir), &mut process).unwrap_err();
        assert!(error.contains("740"), "{error}");
        assert!(!error.contains("refused"), "{error}");
        assert_eq!(process.args.len(), 1);
    }

    #[test]
    fn launcher_receives_exactly_the_verified_installer_bytes() {
        let dir = TempDir::new("installer-bytes");
        let mut process = fake(LaunchResult::Exited(0));
        run_installer(staged(&dir), &mut process).unwrap();
        assert_eq!(process.launched, vec![b"installer-1".to_vec()]);
    }

    #[test]
    fn installer_swapped_after_verification_is_never_launched() {
        let dir = TempDir::new("installer-swap");
        let staging = staged(&dir);
        fs::write(dir.path().join("installer.bin"), b"attacker-1").unwrap();
        let mut process = fake(LaunchResult::Exited(0));
        assert!(run_installer(staging, &mut process).is_err());
        assert!(process.launched.is_empty());
    }

    struct Effects {
        staging: Option<VerifiedStaging>,
        process: FakeProcess,
    }

    impl RecoveryEffects for Effects {
        fn verify_backup(&mut self) -> std::result::Result<VerifiedBackup, String> {
            Ok(backup())
        }
        fn install(
            &mut self,
            _: &FileIdentity,
            _: &StagedManifestIdentity,
        ) -> std::result::Result<(), String> {
            let staging = self.staging.take().ok_or("already consumed")?;
            run_installer(staging, &mut self.process)
        }
        fn validate(
            &mut self,
            _: &RuntimeIdentity,
            _: &str,
        ) -> std::result::Result<InstanceHandshake, String> {
            Err("candidate not running".into())
        }
        fn resume_writes(&mut self) -> std::result::Result<WriteResumption, String> {
            Err("unused".into())
        }
        fn promote(&mut self, _: &str) -> std::result::Result<PromotionReceipt, String> {
            Err("unused".into())
        }
        fn restore(
            &mut self,
            _: &RuntimeIdentity,
            _: &FileIdentity,
        ) -> std::result::Result<(), String> {
            Ok(())
        }
        fn quarantine(&mut self, _: &str) -> std::result::Result<(), String> {
            Ok(())
        }
    }

    fn effects(dir: &TempDir, result: LaunchResult) -> Effects {
        Effects {
            staging: Some(staged(dir)),
            process: fake(result),
        }
    }

    #[test]
    fn failed_or_unclear_start_keeps_installing_and_never_launches_twice() {
        for result in [
            LaunchResult::StartFailed(Some(1223)),
            LaunchResult::StartFailed(None),
            LaunchResult::NoExitCode,
        ] {
            let dir = TempDir::new("installer-no-retry");
            let mut journal =
                DurableJournal::create(store(&dir), UpdateJournal::new(offer()).unwrap()).unwrap();
            journal.record_downloaded(&offer().staged_manifest).unwrap();
            journal.wait_for_idle().unwrap();
            journal.enter_maintenance(proof()).unwrap();
            journal.verify_backup(backup()).unwrap();
            let first = effects(&dir, result);
            let first_launches = first.process.launches.clone();
            let mut driver = RecoveryDriver::new(journal, first);
            assert!(driver.step().is_err());
            // Restart: a fresh driver over the persisted journal.
            let reopened = DurableJournal::open(store(&dir)).unwrap();
            assert_eq!(reopened.journal().phase(), UpdatePhase::Installing);
            assert!(matches!(
                reopened.next_action(),
                RecoveryAction::ValidateCandidate { .. }
            ));
            let second = effects(&dir, result);
            let second_launches = second.process.launches.clone();
            let mut restart = RecoveryDriver::new(reopened, second);
            restart.step().unwrap();
            assert!(restart.step().is_ok());
            assert!(restart.journal().journal().phase() != UpdatePhase::Installing);
            assert_eq!(first_launches.get(), 1);
            assert_eq!(second_launches.get(), 0);
        }
    }
}
