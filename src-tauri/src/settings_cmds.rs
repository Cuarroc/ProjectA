use std::collections::BTreeMap;

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::digest;
use crate::learnings;
use crate::profiles;
use crate::routing;
use crate::store::Store;
use crate::workers;

/// The permit of an enabled switch; nothing else holds one.
#[derive(Default)]
pub(crate) struct HeldSchedulerPermit(
    pub(crate) std::sync::Mutex<Option<workers::scheduler::SchedulerPermit>>,
);

/// The global environment stage for ordinary agents (`strict` without a row).
#[tauri::command]
pub async fn get_agent_env_isolation(store: State<'_, Store>) -> Result<String, String> {
    Ok(store.agent_env_isolation().await?.as_str().to_string())
}

/// Set the global stage; it applies to the next spawn or respawn only. The
/// window is the human; the Control API demands the verdict token instead.
#[tauri::command]
pub async fn set_agent_env_isolation(store: State<'_, Store>, stage: String) -> Result<(), String> {
    let stage = stage
        .parse::<profiles::EnvIsolation>()
        .map_err(|e| e.to_string())?;
    store.set_agent_env_isolation(stage).await
}

/// Read-only state of the continuous activation switch (locked by default).
#[tauri::command]
pub async fn get_continuous_activation(store: State<'_, Store>) -> Result<Value, String> {
    workers::activation::Activation::status(&store, &workers::activation::NoMachineReadableEvidence)
        .await
}

/// W4-03: turn the continuous switch on, fail-closed. Refused unless the
/// verdict token matches, no emergency stop is active, rows 1-26 of the
/// acceptance matrix are evidenced for `policy_revision` and it was not enabled
/// before. The permit is only parked here: no dispatch loop is started yet.
#[tauri::command]
pub async fn enable_continuous_activation(
    app: AppHandle,
    store: State<'_, Store>,
    activation: State<'_, workers::activation::Activation>,
    held: State<'_, HeldSchedulerPermit>,
    verdict_token: String,
    policy_revision: u64,
) -> Result<(), String> {
    let expected = crate::verdict_token_from_app(&app)?;
    let permit = activation
        .enable(
            &store,
            &workers::activation::NoMachineReadableEvidence,
            &expected,
            &verdict_token,
            policy_revision,
        )
        .await
        .map_err(|refusal| format!("continuous activation refused: {refusal:?}"))?;
    *held.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(permit);
    Ok(())
}

/// Whether the hourly digest writer runs at all. On unless switched off.
#[tauri::command]
pub async fn get_digest_enabled(store: State<'_, Store>) -> Result<bool, String> {
    Ok(digest::enabled(&store).await)
}

#[tauri::command]
pub async fn set_digest_enabled(store: State<'_, Store>, enabled: bool) -> Result<(), String> {
    digest::set_enabled(&store, enabled).await
}

#[tauri::command]
pub async fn get_routing_status(store: State<'_, Store>) -> Result<routing::RoutingStatus, String> {
    Ok(routing::routing_status(&store).await)
}

#[tauri::command]
pub async fn set_product_mode(store: State<'_, Store>, mode: String) -> Result<(), String> {
    let parsed = routing::ProductMode::parse(&mode)
        .ok_or_else(|| format!("unknown product mode: {mode}"))?;
    routing::set_product_mode(&store, parsed).await
}

/// Turn learning on or off for one agent profile.
#[tauri::command]
pub async fn set_profile_enabled(
    store: State<'_, Store>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    learnings::set_profile_enabled(&store, &id, enabled).await
}

/// Turn learning on or off for one agent category: worker, queen, orchestrator
/// or scout.
#[tauri::command]
pub async fn set_category_learning(
    store: State<'_, Store>,
    category: String,
    enabled: bool,
) -> Result<(), String> {
    learnings::set_learning_enabled(&store, &category, enabled).await
}

/// The per-category learning switches, one entry per known category.
#[tauri::command]
pub async fn get_learning_settings(
    store: State<'_, Store>,
) -> Result<BTreeMap<String, bool>, String> {
    Ok(learnings::learning_settings(&store).await)
}
