use tauri::{AppHandle, State};

use crate::skills::{self, SkillPack};
use crate::store::Store;

/// The skill packs bundled with this build, including their display metadata.
#[tauri::command]
pub(super) fn list_skill_packs(app: AppHandle) -> Result<Vec<SkillPack>, String> {
    skills::list_packs(&skills::bundled_skills_dir(&app)?)
}

/// Persist a project's skill-pack selection. An empty selection deliberately
/// means the default: all packs currently bundled with ProjectA.
#[tauri::command]
pub(super) async fn set_project_skill_packs(
    store: State<'_, Store>,
    project_id: String,
    packs: Vec<String>,
) -> Result<(), String> {
    store.set_project_skill_packs(&project_id, &packs).await
}

/// Resolve the project's selection against this build's bundled packs. This
/// makes a NULL/empty database value useful to the frontend: it receives the
/// concrete default-all list rather than having to reproduce that policy.
#[tauri::command]
pub(super) async fn get_project_skill_packs(
    app: AppHandle,
    store: State<'_, Store>,
    project_id: String,
) -> Result<Vec<String>, String> {
    let available = skills::pack_ids(&skills::bundled_skills_dir(&app)?)?;
    let selected = store.get_project_skill_packs(&project_id).await?;
    Ok(skills::resolve_enabled(&available, selected.as_deref()))
}

/// The Markdown content of the project's landing page, or `None` when nobody
/// has written one yet.
#[tauri::command]
pub(super) async fn get_landing_page(
    store: State<'_, Store>,
    project_id: String,
) -> Result<Option<String>, String> {
    store.get_landing_page(&project_id).await
}

/// Store (or with `markdown: null`, clear) the project's landing page content.
#[tauri::command]
pub(super) async fn set_landing_page(
    store: State<'_, Store>,
    project_id: String,
    markdown: Option<String>,
) -> Result<(), String> {
    store
        .set_landing_page(&project_id, markdown.as_deref())
        .await
}

// -- dispatcher (Phase 9) --------------------------------------------------

/// Store (or with `None`, clear) the cap on this project's concurrently
/// running employees. Clearing it hands the project back to the dispatcher's
/// own default; the change takes effect on the next sweep, without a restart.
#[tauri::command]
pub(super) async fn set_project_max_workers(
    store: State<'_, Store>,
    project_id: String,
    max_workers: Option<i64>,
) -> Result<(), String> {
    store
        .set_project_max_workers(&project_id, max_workers)
        .await
}

// -- test gate (Phase 12) --------------------------------------------------

/// Store (or with `None`, clear) the shell command the test gate runs for this
/// project. Clearing it switches the gate off for every worker at once.
#[tauri::command]
pub(super) async fn set_project_test_command(
    store: State<'_, Store>,
    project_id: String,
    command: Option<String>,
) -> Result<(), String> {
    store
        .set_project_test_command(&project_id, command.as_deref())
        .await
}
