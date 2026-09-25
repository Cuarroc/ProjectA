//! Usage receipts with provenance for one development run: the value, the
//! collector and source it came from, when it was observed and whether it is
//! a live provider report. A run without a trusted collector carries a named
//! `not_reported` provenance, never a silent gap. Only `measured` receipts
//! settle the ledger; every other state keeps the whole reservation - except
//! the proven `exited_undelivered` exit (DF-15b / KI-27), whose reservation
//! is released unused because no token ever reached the provider.
use super::TokenReservation;
use crate::store::development_launches::DevelopmentLaunch;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Sqlite, Transaction};

/// Versioned name of the only trusted per-run collector (native Codex JSON).
pub(in crate::store) const CODEX_COLLECTOR: &str = "codex-exec-json-v1";
pub(in crate::store) const CODEX_TRANSPORT: &str = "native_codex_exec_json";

/// Collector outcome for one exited provider process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::store) enum UsageReceipt {
    /// Final provider-reported usage, read live from process-owned stdout.
    Measured { tokens: i64, source_sha256: String },
    /// The collector refused the capture; the reservation is retained.
    Rejected {
        reason: &'static str,
        source_sha256: String,
    },
    /// No trusted collector exists for this adapter and transport.
    NotReported { provider: String, transport: String },
}

impl UsageReceipt {
    /// Classify one exited provider process from its stored route and its
    /// process-owned stdout. Only native Codex JSON has a trusted collector.
    pub(in crate::store) fn collect(route: &Value, stdout: &[u8], exit_code: Option<i32>) -> Self {
        let (provider, transport) = route_adapter(route);
        if !has_collector(provider, transport) {
            return Self::NotReported {
                provider: provider.into(),
                transport: transport.into(),
            };
        }
        let source_sha256 = format!("{:x}", Sha256::digest(stdout));
        match super::codex_usage::complete_usage(stdout, exit_code) {
            Ok(tokens) => Self::Measured {
                tokens,
                source_sha256,
            },
            Err(reason) => Self::Rejected {
                reason,
                source_sha256,
            },
        }
    }

    pub(in crate::store) fn tokens(&self) -> Option<i64> {
        match self {
            Self::Measured { tokens, .. } => Some(*tokens),
            _ => None,
        }
    }

    pub(in crate::store) fn state(&self) -> &'static str {
        match self {
            Self::Measured { .. } => "measured",
            Self::Rejected { .. } => "rejected",
            Self::NotReported { .. } => "not_reported",
        }
    }

    /// Ledger `source` for a measured receipt: collector plus capture digest.
    pub(in crate::store) fn ledger_source(&self) -> Option<String> {
        match self {
            Self::Measured { source_sha256, .. } => {
                Some(format!("{CODEX_COLLECTOR}:sha256:{source_sha256}"))
            }
            _ => None,
        }
    }

    pub(in crate::store) fn to_json(&self, observed_at: Option<i64>) -> Value {
        match self {
            Self::Measured {
                tokens,
                source_sha256,
            } => json!({"state":"measured","tokens":tokens,"reservation":"settled",
                "provenance":{"collector":CODEX_COLLECTOR,"measurement":"live",
                    "source":"process-owned stdout","sourceSha256":source_sha256,
                    "observedAt":observed_at}}),
            Self::Rejected {
                reason,
                source_sha256,
            } => json!({"state":"rejected","reason":reason,"reservation":"retained",
                "provenance":{"collector":CODEX_COLLECTOR,"measurement":"none",
                    "source":"process-owned stdout","sourceSha256":source_sha256,
                    "observedAt":observed_at}}),
            Self::NotReported {
                provider,
                transport,
            } => json!({"state":"not_reported",
                "reason":not_reported_reason(provider, transport),"reservation":"retained",
                "provenance":{"collector":null,"measurement":"none","provider":provider,
                    "transport":transport,"observedAt":observed_at}}),
        }
    }
}

/// Only native Codex JSON has a trusted per-run collector.
fn has_collector(provider: &str, transport: &str) -> bool {
    provider == "codex" && transport == CODEX_TRANSPORT
}

fn route_adapter(route: &Value) -> (&str, &str) {
    (
        route["selection"]["resolved"]["provider"]
            .as_str()
            .unwrap_or("unknown"),
        route["preparedInvocation"]["transport"]
            .as_str()
            .unwrap_or("unknown"),
    )
}

/// Why an adapter has no trusted collector, as observed so far. Each text
/// names the missing source instead of claiming usage is unknowable.
fn not_reported_reason(provider: &str, transport: &str) -> String {
    let detail = match provider {
        // Defensive: unreachable while every caller checks has_collector first.
        "codex" if transport == CODEX_TRANSPORT => {
            "native Codex JSON has a collector; this receipt is a classification error".into()
        }
        "codex" => format!(
            "Codex reports usage only through native `codex exec --json`; this run used {transport}"
        ),
        "kimi" => "Kimi's PTY status line shows context-window occupancy \
            (`context: N% (X/1M)`), not billed usage"
            .into(),
        "opencode" => "no recorded OpenCode status-line bytes exist to parse; \
            a PTY trace probe is missing"
            .into(),
        "claude" => "Claude's statusLine hook reports account-wide rate windows \
            (live quota), not per-run tokens"
            .into(),
        "ollama" => "no per-run usage collector exists for local Ollama".into(),
        _ => format!("no trusted usage collector for provider {provider} over {transport}"),
    };
    format!("not reported by adapter: {detail}")
}

/// The per-run cost receipt of the run read model. Pure, so every state is
/// testable without a database.
pub(in crate::store) fn run_receipt(
    reservation: Option<&TokenReservation>,
    launch: Option<&DevelopmentLaunch>,
    capture_usage: Option<Value>,
) -> Value {
    let Some(reservation) = reservation else {
        return json!({"state":"not_reserved",
            "reason":"run holds no implementation token reservation",
            "ledgerState":null,"reservedTokens":0});
    };
    let mut receipt = match reservation.state.as_str() {
        "settled" => settled_receipt(reservation),
        "cancelled" => match launch {
            // DF-15b / KI-27: released because the provider exited before its
            // input was delivered - known-zero usage, not a pre-work cancel.
            Some(launch) if launch.state == "exited_undelivered" => {
                json!({"state":"cancelled",
                    "reason":"provider exited before its input was delivered; reservation released unused"})
            }
            _ => json!({"state":"cancelled",
                "reason":"reservation cancelled before work started"}),
        },
        "reserved" => json!({"state":"pending",
            "reason":"run has not launched; reservation held"}),
        _ => started_receipt(launch, capture_usage),
    };
    receipt["ledgerState"] = reservation.state.clone().into();
    receipt["reservedTokens"] = reservation.reserved_tokens.into();
    receipt
}

/// A settled row is a trusted receipt, but only the Codex collector's own
/// source is a live stdout measurement; a row missing its tokens or source
/// is not presented as a measurement at all.
fn settled_receipt(reservation: &TokenReservation) -> Value {
    let (Some(tokens), Some(source)) = (reservation.actual_tokens, &reservation.source) else {
        return json!({"state":"unclassified",
            "reason":"settled ledger row lacks its tokens or source"});
    };
    let live = source.starts_with(&format!("{CODEX_COLLECTOR}:sha256:"));
    json!({"state":"measured","tokens":tokens,
        "provenance":{"collector": if live { Some(CODEX_COLLECTOR) } else { None },
            "measurement": if live { "live" } else { "trusted_receipt" },
            "source":source,"observedAt":reservation.observed_at}})
}

fn started_receipt(launch: Option<&DevelopmentLaunch>, capture_usage: Option<Value>) -> Value {
    if let Some(usage) = capture_usage {
        return match usage["state"].as_str() {
            Some("rejected" | "not_reported") => usage,
            Some("measured") => json!({"state":"unclassified",
                "reason":"capture reported usage but the ledger has not settled it"}),
            Some("unreadable") => json!({"state":"unclassified",
                "reason":"stored capture receipt is unreadable"}),
            _ => json!({"state":"unclassified",
                "reason":"capture recorded before usage provenance; collector outcome was not retained"}),
        };
    }
    let route: Value = launch
        .and_then(|launch| launch.route_json.as_deref())
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or(Value::Null);
    let (provider, transport) = route_adapter(&route);
    match launch {
        // Reached only while the DF-15b release has not happened yet (a
        // DF-15a-era row before startup reconciliation, or a reservation that
        // was never `started`); afterwards the reservation is `cancelled`.
        Some(launch) if launch.state == "exited_undelivered" => json!({"state":"not_reported",
            "reason":"not reported by adapter: provider exited before its input was delivered",
            "reservation":"retained",
            "provenance":{"collector":null,"measurement":"none","provider":provider,
                "transport":transport,"observedAt":launch.exited_at}}),
        // The one adapter with a collector is waiting for its capture, not
        // lacking a collector.
        Some(launch) if launch.state == "exited" && has_collector(provider, transport) => {
            json!({"state":"pending",
                "reason":"native Codex capture has not been committed to its collector; reservation retained"})
        }
        Some(launch) if launch.state == "exited" => UsageReceipt::NotReported {
            provider: provider.into(),
            transport: transport.into(),
        }
        .to_json(launch.exited_at),
        _ => json!({"state":"pending",
            "reason":"run is still executing; final usage not yet observable"}),
    }
}

/// Reads the run's implementation reservation and stored capture receipt.
pub(in crate::store) async fn for_run(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
    launch: Option<&DevelopmentLaunch>,
) -> Result<Value, String> {
    let reservation: Option<TokenReservation> = sqlx::query_as("SELECT * FROM development_token_reservations WHERE run_id=? AND purpose='implementation' ORDER BY state='cancelled', created_at DESC, id DESC LIMIT 1")
        .bind(run_id).fetch_optional(&mut **tx).await.map_err(super::db)?;
    let usage: Option<Option<String>> = sqlx::query_scalar(
        "SELECT json_extract(result_json,'$.usage') FROM development_capture_results WHERE run_id=?",
    )
    .bind(run_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(super::db)?;
    // An unreadable stored receipt is shown as unclassified, never dropped.
    let usage = usage
        .flatten()
        .map(|raw| serde_json::from_str(&raw).unwrap_or_else(|_| json!({"state":"unreadable"})));
    Ok(run_receipt(reservation.as_ref(), launch, usage))
}

#[cfg(test)]
#[path = "development_usage_receipt_tests.rs"]
mod tests;
