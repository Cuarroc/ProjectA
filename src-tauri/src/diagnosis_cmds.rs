use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::app_data_dir;
use crate::diagnosis;
use crate::logging;
use crate::providers::KeyVault;
use crate::status::StatusEngine;
use crate::store::Store;
use crate::stuck;
use crate::PanicNotice;

#[tauri::command]
pub fn get_log_path(app: AppHandle) -> Result<String, String> {
    let dir = app_data_dir(&app)?;
    Ok(logging::log_file(&dir).display().to_string())
}

#[tauri::command]
pub fn get_panic_notice(notice: State<'_, PanicNotice>) -> PanicNotice {
    notice.inner().clone()
}

#[tauri::command]
pub fn get_reason_catalog() -> Vec<diagnosis::ReasonExplanation> {
    diagnosis::reason_catalog()
}

#[tauri::command]
pub async fn export_diagnosis(
    app: AppHandle,
    store: State<'_, Store>,
    engine: State<'_, Arc<StatusEngine>>,
    vault: State<'_, Arc<KeyVault>>,
    notice: State<'_, PanicNotice>,
) -> Result<String, String> {
    let dir = app_data_dir(&app)?;
    let panic = notice.inner().clone();
    let (pack, secrets) = diagnosis::collect(
        &dir,
        store.inner(),
        engine.inner().as_ref(),
        vault.inner().as_ref(),
        &panic,
    )
    .await?;
    Ok(diagnosis::export_json(&pack, &secrets))
}

/// Open the log file in the OS file manager so the user does not have to
/// know `%APPDATA%`. Explorer's `/select,` highlights the file; elsewhere
/// the parent directory opens.
#[tauri::command]
pub fn reveal_log_path(app: AppHandle) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    let path = logging::log_file(&dir);
    #[cfg(windows)]
    {
        crate::proc::command("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn()
            .map_err(|e| format!("failed to open Explorer: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        crate::proc::command("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("failed to reveal the log file: {e}"))?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = path.parent().unwrap_or(path.as_path());
        crate::proc::command("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("failed to open the log directory: {e}"))?;
        Ok(())
    }
}

/// After how many quiet minutes a running worker is called stuck, or `null`
/// when the built-in default applies.
#[tauri::command]
pub async fn get_stuck_after_minutes(store: State<'_, Store>) -> Result<Option<u64>, String> {
    Ok(stuck::threshold_minutes(&store).await)
}

/// Set (or with `null`, clear) that threshold.
#[tauri::command]
pub async fn set_stuck_after_minutes(
    store: State<'_, Store>,
    minutes: Option<u64>,
) -> Result<(), String> {
    stuck::set_threshold_minutes(&store, minutes).await
}
