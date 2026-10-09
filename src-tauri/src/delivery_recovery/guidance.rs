//! German guidance when startup recovery refuses to open the database.
//! Order: write ANLEITUNG → OS opener (non-blocking) → in-process presenter
//! (blocking MessageBox on Windows; log + stderr elsewhere). Failures never unblock.

use super::startup::recover_at_startup;
use std::path::{Path, PathBuf};

/// User-facing guidance written beside the journal when recovery refuses.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StartupGuidance {
    pub text: String,
    pub journal_path: PathBuf,
    pub backup_path: PathBuf,
    pub file_path: PathBuf,
}

/// Outcome of startup recovery before the database may open.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StartupRecovery {
    /// Journal absent or recovery finished; the database may open.
    Open,
    /// Recovery refused; guidance is present and the database must stay closed.
    Refused {
        reason: String,
        guidance: StartupGuidance,
    },
}

/// Run journal recovery and attach guidance on every `Err` path.
pub fn recover_startup(dir: &Path) -> StartupRecovery {
    match recover_at_startup(dir) {
        Ok(()) => StartupRecovery::Open,
        Err(reason) => StartupRecovery::Refused {
            guidance: guidance_for_refused_recovery(dir),
            reason,
        },
    }
}

/// Build the German guidance for a refused recovery under `dir`.
pub fn guidance_for_refused_recovery(dir: &Path) -> StartupGuidance {
    let journal_path = dir.join("update-recovery.json");
    let backup_path = crate::db_restore::update_backup_path(&dir.join("projecta.db"));
    let file_path = dir.join("update-recovery-ANLEITUNG.txt");
    let text = format!(
        "ProjectA konnte ein Update nicht verifizieren und hat den Start gesperrt.\n\n\
         Durch diese Anleitung wurde nichts geändert und nichts gelöscht.\n\
         (Eine frühere Wiederherstellung aus dem Update-Journal kann trotzdem schon erfolgt sein.)\n\n\
         Journal: {}\n\
         Erwarteter Ort der Datensicherung (Existenz und Inhalt sind hier nicht geprüft): {}\n\n\
         Nächste sichere Schritte:\n\
         1. Diesen Ordner und die genannten Dateien behalten.\n\
         2. Die zuletzt funktionierende Version neu installieren und dabei diesen Datenordner behalten; keine alte Datenbank manuell zurückspielen. Oder den Support kontaktieren.\n\
         3. Die Journal-Datei nur nach einer Kopie der Datensicherung und nur auf Anweisung entfernen.\n\n\
         Die Anleitung liegt auch hier: {}\n",
        journal_path.display(),
        backup_path.display(),
        file_path.display(),
    );
    StartupGuidance {
        text,
        journal_path,
        backup_path,
        file_path,
    }
}

/// Persist the guidance file. Failures never panic; callers keep the recovery `Err`.
pub fn write_guidance(guidance: &StartupGuidance) -> Result<(), String> {
    crate::fsutil::write_atomic(&guidance.file_path, guidance.text.as_bytes())
}

/// Default in-process surface: always log; MessageBox on Windows, stderr elsewhere.
fn present_guidance_in_process(text: &str) {
    crate::logf!("update", "update recovery guidance (in-process):\n{text}");
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            MessageBoxW, MB_ICONERROR, MB_OK, MB_SETFOREGROUND,
        };
        let wide = |s: &str| -> Vec<u16> {
            std::ffi::OsStr::new(s)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect()
        };
        let body = wide(text);
        let title = wide("ProjectA – Start angehalten");
        // SAFETY: null HWND is valid for process-modal MessageBoxW; body/title
        // are NUL-terminated UTF-16 and outlive the call.
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                body.as_ptr(),
                title.as_ptr(),
                MB_OK | MB_ICONERROR | MB_SETFOREGROUND,
            );
        }
    }
    #[cfg(not(windows))]
    {
        use std::io::Write;
        let _ = writeln!(std::io::stderr(), "{text}");
    }
}

/// Persist and surface the guidance; never opens the database.
pub fn present_refused_guidance(guidance: &StartupGuidance) {
    present_refused_guidance_with(guidance, present_guidance_in_process, reveal_guidance_file);
}

/// Testable path: write → opener → injectable presenter (always last).
pub fn present_refused_guidance_with(
    guidance: &StartupGuidance,
    mut present: impl FnMut(&str),
    mut open: impl FnMut(&Path) -> Result<(), String>,
) {
    match write_guidance(guidance) {
        Ok(()) => {
            crate::logf!(
                "update",
                "update recovery guidance written to {}",
                guidance.file_path.display()
            );
            if let Err(error) = open(&guidance.file_path) {
                crate::logf!(
                    "update",
                    "update recovery guidance could not be opened at {}: {error}",
                    guidance.file_path.display()
                );
            }
        }
        Err(error) => crate::logf!(
            "update",
            "update recovery guidance could not be written to {}: {error}",
            guidance.file_path.display()
        ),
    }
    present(&guidance.text);
}

fn reveal_guidance_file(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        crate::proc::command("notepad.exe")
            .arg(path)
            .spawn()
            .map_err(|error| format!("failed to start notepad.exe: {error}"))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        crate::proc::command("open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("failed to start open: {error}"))?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        crate::proc::command("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("failed to start xdg-open: {error}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;
    use std::sync::{Arc, Mutex};

    #[test]
    fn refused_recovery_yields_guidance_and_keeps_the_database_closed() {
        let dir = TempDir::new("guidance-refused");
        let db = dir.path().join("projecta.db");
        let journal = dir.path().join("update-recovery.json");
        std::fs::write(&db, b"keep-me").unwrap();
        std::fs::write(&journal, b"{not-json").unwrap();
        let before_db = std::fs::read(&db).unwrap();
        let before_journal = std::fs::read(&journal).unwrap();
        match recover_startup(dir.path()) {
            StartupRecovery::Refused { guidance, .. } => {
                assert!(!guidance.text.is_empty());
            }
            StartupRecovery::Open => panic!("refused recovery must not open"),
        }
        assert_eq!(std::fs::read(&db).unwrap(), before_db);
        assert_eq!(std::fs::read(&journal).unwrap(), before_journal);
        assert!(matches!(
            recover_startup(dir.path()),
            StartupRecovery::Refused { .. }
        ));
    }

    #[test]
    fn guidance_names_journal_and_backup_paths_and_safe_steps() {
        let dir = TempDir::new("guidance-text");
        let g = guidance_for_refused_recovery(dir.path());
        assert!(g.text.contains(&g.journal_path.display().to_string()));
        assert!(g.text.contains(&g.backup_path.display().to_string()));
        assert!(g
            .text
            .contains("Durch diese Anleitung wurde nichts geändert und nichts gelöscht"));
        assert!(g.text.contains("Erwarteter Ort der Datensicherung"));
        assert!(g.text.contains("behalten") && g.text.contains("neu installieren"));
        assert!(g.text.contains(&g.file_path.display().to_string()));
    }

    #[test]
    fn ordinary_start_without_journal_shows_no_guidance() {
        let dir = TempDir::new("guidance-no-journal");
        assert!(matches!(recover_startup(dir.path()), StartupRecovery::Open));
        assert!(!dir.path().join("update-recovery-ANLEITUNG.txt").exists());
    }

    #[test]
    fn successful_write_failing_opener_then_presenter_in_order() {
        let dir = TempDir::new("guidance-order");
        let guidance = guidance_for_refused_recovery(dir.path());
        let order = Arc::new(Mutex::new(Vec::<&'static str>::new()));
        let order_open = Arc::clone(&order);
        let order_present = Arc::clone(&order);
        let presented = Arc::new(Mutex::new(None::<String>));
        let presented_cb = Arc::clone(&presented);
        present_refused_guidance_with(
            &guidance,
            move |text| {
                order_present.lock().unwrap().push("presenter");
                *presented_cb.lock().unwrap() = Some(text.to_string());
            },
            move |path| {
                assert!(path.is_file(), "write must finish before opener");
                order_open.lock().unwrap().push("write");
                order_open.lock().unwrap().push("opener");
                Err("opener forced failure".into())
            },
        );
        assert_eq!(*order.lock().unwrap(), ["write", "opener", "presenter"]);
        assert_eq!(
            presented.lock().unwrap().as_deref(),
            Some(guidance.text.as_str())
        );
        assert_eq!(
            std::fs::read_to_string(&guidance.file_path).unwrap(),
            guidance.text
        );
    }

    #[test]
    fn guidance_reaches_in_process_presenter_when_write_and_opener_fail() {
        let dir = TempDir::new("guidance-presenter");
        let blocker = dir.path().join("not-a-dir");
        std::fs::write(&blocker, b"x").unwrap();
        let guidance = StartupGuidance {
            text: "SICHTBAR-TEST-ANLEITUNG".to_string(),
            journal_path: blocker.join("update-recovery.json"),
            backup_path: blocker.join("projecta.db.bak-update"),
            file_path: blocker.join("update-recovery-ANLEITUNG.txt"),
        };
        let presented = Arc::new(Mutex::new(None::<String>));
        let presented_cb = Arc::clone(&presented);
        present_refused_guidance_with(
            &guidance,
            move |text| {
                *presented_cb.lock().unwrap() = Some(text.to_string());
            },
            |_path| Err("opener forced failure".to_string()),
        );
        assert_eq!(
            presented.lock().unwrap().as_deref(),
            Some(guidance.text.as_str()),
            "guidance must reach the in-process presenter when write and opener fail"
        );
        assert!(!guidance.file_path.exists());
    }

    #[test]
    fn write_guidance_creates_file_with_the_text() {
        let dir = TempDir::new("guidance-write-ok");
        let guidance = guidance_for_refused_recovery(dir.path());
        write_guidance(&guidance).expect("write must succeed in a writable temp dir");
        assert_eq!(
            std::fs::read_to_string(&guidance.file_path).unwrap(),
            guidance.text
        );
    }

    #[test]
    fn write_guidance_returns_err_when_parent_is_a_file() {
        let dir = TempDir::new("guidance-write-err");
        let blocker = dir.path().join("not-a-dir");
        std::fs::write(&blocker, b"x").unwrap();
        let guidance = StartupGuidance {
            text: "should-not-land".to_string(),
            journal_path: blocker.join("update-recovery.json"),
            backup_path: blocker.join("projecta.db.bak-update"),
            file_path: blocker.join("update-recovery-ANLEITUNG.txt"),
        };
        assert!(!write_guidance(&guidance)
            .expect_err("parent file")
            .is_empty());
        assert!(!guidance.file_path.exists());
    }
}
