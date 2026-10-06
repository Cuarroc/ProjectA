//! Plain-text rendering of the small operator readouts: emergency stop, quota
//! and diagnosis.

use serde_json::Value;

use super::text;

/// The reply must carry a boolean `active`; anything else is an error, so an
/// odd reply can never read as "not stopped".
pub(super) fn render_emergency_stop(body: &Value) -> Result<String, String> {
    match body.get("active").and_then(Value::as_bool) {
        Some(true) => Ok("emergency stop: ACTIVE (no new dispatch)\n".to_string()),
        Some(false) => Ok("emergency stop: off\n".to_string()),
        None => Err("emergency stop: reply has no boolean `active`".to_string()),
    }
}

pub(super) fn render_quota(quota: &Value) -> String {
    let Some(rows) = quota.as_array() else {
        return "no quota information\n".to_string();
    };
    if rows.is_empty() {
        return "no quota information\n".to_string();
    }

    let mut out = String::new();
    for row in rows {
        let reason = row
            .get("reason")
            .and_then(Value::as_str)
            .map(|reason| format!("  {reason}"))
            .unwrap_or_default();
        out.push_str(&format!(
            "{:<10}  {}{reason}\n",
            text(row, "profileId"),
            text(row, "state")
        ));
    }
    if rows
        .first()
        .and_then(|row| row.get("omniRouteOnline"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        out.push_str("omniroute  online\n");
    }
    out
}

/// Log path and panic flags only. The pack stays in the window so an agent
/// that can read `pa` cannot walk away with log excerpts.
pub(super) fn render_diagnosis(body: &Value) -> String {
    let log_path = text(body, "logPath");
    let panic_current = body
        .get("panicCurrent")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let panic_previous = body
        .get("panicPrevious")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let panic = if panic_current || panic_previous {
        "panic marker present — open Diagnose in the window"
    } else {
        "no panic marker"
    };
    format!("{log_path}\n{panic}\n")
}
