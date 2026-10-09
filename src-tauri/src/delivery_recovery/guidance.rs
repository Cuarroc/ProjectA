//! Visible German guidance when startup recovery refuses to open the database.
//!
//! Keeps the fail-closed contract: a refused recovery never opens the store.
//! The exact English reason stays in the log and in the setup `Err`; this
//! module only builds and presents the user-facing text (paths, safe steps).

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

/// Persist and surface the guidance; never opens the database.
///
/// Write/open failures are logged only and never replace the recovery `Err`.
/// The ANLEITUNG file is opened only after a successful atomic write.
pub fn present_refused_guidance(guidance: &StartupGuidance) {
    match crate::fsutil::write_atomic(&guidance.file_path, guidance.text.as_bytes()) {
        Ok(()) => {
            crate::logf!(
                "update",
                "update recovery guidance written to {}",
                guidance.file_path.display()
            );
            reveal_guidance_file(&guidance.file_path);
        }
        Err(error) => crate::logf!(
            "update",
            "update recovery guidance could not be written to {}: {error}",
            guidance.file_path.display()
        ),
    }
}

fn reveal_guidance_file(path: &Path) {
    #[cfg(windows)]
    {
        let _ = crate::proc::command("notepad.exe").arg(path).spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = crate::proc::command("xdg-open").arg(path).spawn();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    #[test]
    fn refused_recovery_yields_guidance_and_keeps_the_database_closed() {
        let dir = TempDir::new("guidance-refused");
        let db = dir.path().join("projecta.db");
        std::fs::write(&db, b"keep-me").unwrap();
        std::fs::write(dir.path().join("update-recovery.json"), b"{not-json").unwrap();
        let before = std::fs::read(&db).unwrap();
        match recover_startup(dir.path()) {
            StartupRecovery::Refused { guidance, reason } => {
                assert!(!guidance.text.is_empty());
                assert!(reason.contains("unreadable") || reason.contains("blocked"));
            }
            StartupRecovery::Open => panic!("refused recovery must not open"),
        }
        assert_eq!(std::fs::read(&db).unwrap(), before);
        // A second start still refuses: presenting guidance must not unblock.
        assert!(matches!(
            recover_startup(dir.path()),
            StartupRecovery::Refused { .. }
        ));
    }

    #[test]
    fn guidance_names_journal_and_backup_paths_and_safe_steps() {
        let dir = TempDir::new("guidance-text");
        let guidance = guidance_for_refused_recovery(dir.path());
        let journal = guidance.journal_path.display().to_string();
        let backup = guidance.backup_path.display().to_string();
        assert!(guidance.text.contains(&journal));
        assert!(guidance.text.contains(&backup));
        assert!(guidance
            .text
            .contains("Durch diese Anleitung wurde nichts geändert und nichts gelöscht"));
        assert!(guidance.text.contains("Erwarteter Ort der Datensicherung"));
        assert!(guidance.text.contains("behalten"));
        assert!(guidance.text.contains("neu installieren"));
        assert!(!guidance.text.to_lowercase().contains("panic"));
        assert!(!guidance.text.to_lowercase().contains("secret"));
    }

    #[test]
    fn ordinary_start_without_journal_shows_no_guidance() {
        let dir = TempDir::new("guidance-no-journal");
        assert!(matches!(recover_startup(dir.path()), StartupRecovery::Open));
        assert!(!dir.path().join("update-recovery-ANLEITUNG.txt").exists());
    }
}
