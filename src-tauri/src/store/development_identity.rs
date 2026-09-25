//! Immutable run identity and append-only observations. Only the trusted route
//! binding writes production rows; an agent evidence payload has no path here.
use super::{new_id, now_unix_secs};
use crate::development_policy::{
    assess_identity_observation, ExecutionIdentity, FamilyRegistry, IdentityObservation,
    IdentityStatus, IdentityTuple, Provider,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Sqlite, Transaction};

#[derive(FromRow)]
struct IdentityHeaderRow {
    id: String,
    requested_json: String,
    configured_json: String,
    adapter_json: Option<String>,
    ui_profile_id: Option<String>,
}

pub(super) async fn apply_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    for statement in [
        "CREATE TABLE development_execution_identities (id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES development_runs(id), requested_json TEXT NOT NULL CHECK(json_valid(requested_json)), configured_json TEXT NOT NULL CHECK(json_valid(configured_json)), adapter_json TEXT CHECK(adapter_json IS NULL OR json_valid(adapter_json)), ui_profile_id TEXT, created_at INTEGER NOT NULL)",
        "CREATE TABLE development_identity_observations (id TEXT PRIMARY KEY, identity_id TEXT NOT NULL REFERENCES development_execution_identities(id), sequence INTEGER NOT NULL CHECK(sequence > 0), idempotency_key TEXT NOT NULL UNIQUE, observation_json TEXT NOT NULL CHECK(json_valid(observation_json)), recorded_at INTEGER NOT NULL, UNIQUE(identity_id, sequence))",
        "CREATE INDEX development_identity_observations_identity ON development_identity_observations(identity_id, sequence)",
        "CREATE TRIGGER development_identity_no_update BEFORE UPDATE ON development_execution_identities BEGIN SELECT RAISE(ABORT, 'execution identity is immutable'); END",
        "CREATE TRIGGER development_identity_no_delete BEFORE DELETE ON development_execution_identities BEGIN SELECT RAISE(ABORT, 'execution identity is immutable'); END",
        "CREATE TRIGGER development_identity_observation_no_update BEFORE UPDATE ON development_identity_observations BEGIN SELECT RAISE(ABORT, 'identity observation is immutable'); END",
        "CREATE TRIGGER development_identity_observation_no_delete BEFORE DELETE ON development_identity_observations BEGIN SELECT RAISE(ABORT, 'identity observation is immutable'); END",
    ] {
        sqlx::query(statement).execute(&mut **tx).await.map_err(db)?;
    }
    // Existing runs deliberately have no header. A route from an older build
    // cannot be reconstructed as an observation of the executing model.
    Ok(())
}

fn optional_string(value: &Value, label: &str) -> Result<Option<String>, String> {
    match value {
        Value::Null => Ok(None),
        Value::String(s) if !s.trim().is_empty() => Ok(Some(s.clone())),
        _ => Err(format!("route {label} must be a nonempty string or null")),
    }
}

/// Called only after the fenced route UPDATE succeeds in its transaction.
/// The receipt is configuration evidence, never execution attestation.
pub(super) async fn bind_unknown(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
    receipt: &Value,
    receipt_body: &str,
) -> Result<(), String> {
    let requested_model = optional_string(
        &receipt["selection"]["requested"]["requestedModel"],
        "requested model",
    )?;
    let configured_model = optional_string(&receipt["invocationModel"], "invocation model")?;
    let configured_provider: Option<Provider> =
        if receipt["selection"]["resolved"]["provider"].is_null() {
            None
        } else {
            Some(
                serde_json::from_value(receipt["selection"]["resolved"]["provider"].clone())
                    .map_err(|e| format!("invalid selected provider in route: {e}"))?,
            )
        };
    let now = now_unix_secs();
    let id = new_id("identity");
    let requested = IdentityTuple {
        provider: None,
        model: requested_model,
        family: None,
    };
    let configured = IdentityTuple {
        provider: configured_provider,
        model: configured_model,
        family: None,
    };
    sqlx::query("INSERT INTO development_execution_identities(id, run_id, requested_json, configured_json, created_at) VALUES(?, ?, ?, ?, ?)")
        .bind(&id).bind(run_id)
        .bind(serde_json::to_string(&requested).map_err(|e| e.to_string())?)
        .bind(serde_json::to_string(&configured).map_err(|e| e.to_string())?)
        .bind(now).execute(&mut **tx).await.map_err(db)?;
    let unknown = IdentityObservation {
        identity: IdentityTuple {
            provider: None,
            model: None,
            family: None,
        },
        status: IdentityStatus::Unknown,
        source: Some("backend/route-binding".into()),
        evidence_id: Some(format!(
            "route-receipt-sha256:{:x}",
            Sha256::digest(receipt_body.as_bytes())
        )),
        observed_at: Some(now as u64),
        expires_at: None,
        registry: None,
    };
    sqlx::query("INSERT INTO development_identity_observations(id, identity_id, sequence, idempotency_key, observation_json, recorded_at) VALUES(?, ?, 1, ?, ?, ?)")
        .bind(new_id("identity-observation")).bind(&id)
        .bind(format!("route-binding:{run_id}"))
        .bind(serde_json::to_string(&unknown).map_err(|e| e.to_string())?)
        .bind(now).execute(&mut **tx).await.map_err(db)?;
    Ok(())
}

/// The native completion transaction has already authenticated the opaque
/// capture, receipt, launch and fence. This writer binds an UNKNOWN observation
/// to the durable capture result; provider output cannot supply identity here.
pub(super) async fn append_native_unknown(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
    result_body: &str,
    observed_at: i64,
) -> Result<(), String> {
    if observed_at <= 0 {
        return Err("native identity observation time is invalid".into());
    }
    let capture: Option<(String, i64)> = sqlx::query_as(
        "SELECT result_json, observed_at FROM development_capture_results WHERE run_id=?",
    )
    .bind(run_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?;
    if capture
        .as_ref()
        .is_none_or(|(body, at)| body != result_body || *at != observed_at)
    {
        return Err("native identity capture result changed".into());
    }
    let identity_id: Option<String> =
        sqlx::query_scalar("SELECT id FROM development_execution_identities WHERE run_id=?")
            .bind(run_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(db)?;
    // Old runs without a route-bound header remain explicitly unavailable.
    let Some(identity_id) = identity_id else {
        return Ok(());
    };
    let baseline_key = format!("route-binding:{run_id}");
    let baseline: Option<String> = sqlx::query_scalar(
        "SELECT idempotency_key FROM development_identity_observations WHERE identity_id=? AND sequence=1",
    )
    .bind(&identity_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?;
    if baseline.as_deref() != Some(&baseline_key) {
        return Err("native identity route baseline missing or changed".into());
    }
    let evidence_id = format!("native-capture-result-v1:{run_id}");
    let key = format!("native-capture:{run_id}");
    let unknown = IdentityObservation {
        identity: IdentityTuple {
            provider: None,
            model: None,
            family: None,
        },
        status: IdentityStatus::Unknown,
        source: Some("projecta-native-capture-v1".into()),
        evidence_id: Some(evidence_id.clone()),
        observed_at: Some(observed_at as u64),
        expires_at: None,
        registry: None,
    };
    let (evidence_count, source_count): (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(json_extract(observation_json,'$.evidenceId')=?),0), COALESCE(SUM(json_extract(observation_json,'$.source')='projecta-native-capture-v1'),0) FROM development_identity_observations WHERE identity_id=?",
    )
    .bind(&evidence_id)
    .bind(&identity_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(db)?;
    let prior: Option<(String, String)> = sqlx::query_as(
        "SELECT identity_id, observation_json FROM development_identity_observations WHERE idempotency_key=?",
    )
    .bind(&key)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?;
    if let Some((prior_identity, body)) = prior {
        let prior_observation: IdentityObservation =
            serde_json::from_str(&body).map_err(|_| "native identity observation is corrupt")?;
        return if prior_identity == identity_id
            && prior_observation == unknown
            && evidence_count == 1
            && source_count == 1
        {
            Ok(())
        } else {
            Err("native identity observation conflicts with prior evidence".into())
        };
    }
    if evidence_count != 0 || source_count != 0 {
        return Err("native identity evidence already bound".into());
    }
    let sequence: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(sequence), 0)+1 FROM development_identity_observations WHERE identity_id=?",
    )
    .bind(&identity_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(db)?;
    sqlx::query("INSERT INTO development_identity_observations(id, identity_id, sequence, idempotency_key, observation_json, recorded_at) VALUES(?, ?, ?, ?, ?, ?)")
        .bind(new_id("identity-observation"))
        .bind(&identity_id)
        .bind(sequence)
        .bind(key)
        .bind(serde_json::to_string(&unknown).map_err(|e| e.to_string())?)
        .bind(now_unix_secs())
        .execute(&mut **tx)
        .await
        .map_err(db)?;
    Ok(())
}

/// Read with the caller's transaction to keep the header and history aligned
/// with the run, route and candidate in a single SQLite snapshot.
pub(super) async fn for_run(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
) -> Result<Value, String> {
    let row: Option<IdentityHeaderRow> =
        sqlx::query_as("SELECT id, requested_json, configured_json, adapter_json, ui_profile_id FROM development_execution_identities WHERE run_id = ?")
            .bind(run_id).fetch_optional(&mut **tx).await.map_err(db)?;
    let Some(row) = row else {
        return Ok(
            json!({"state":"unavailable","reason":"legacy or unbound run has no execution identity"}),
        );
    };
    let rows: Vec<(String, i64, String, String, i64)> = sqlx::query_as(
        "SELECT id, sequence, idempotency_key, observation_json, recorded_at FROM development_identity_observations WHERE identity_id = ? ORDER BY sequence",
    ).bind(&row.id).fetch_all(&mut **tx).await.map_err(db)?;
    let mut history = Vec::with_capacity(rows.len());
    let mut latest = None;
    for (id, sequence, idempotency_key, body, recorded_at) in rows {
        let observation: IdentityObservation = serde_json::from_str(&body)
            .map_err(|e| format!("stored identity observation is corrupt: {e}"))?;
        latest = Some(observation.clone());
        history.push(
            json!({"id":id,"sequence":sequence,"idempotencyKey":idempotency_key,
            "observation":observation,"recordedAt":recorded_at}),
        );
    }
    let identity = ExecutionIdentity {
        id: row.id,
        run_id: run_id.into(),
        requested: serde_json::from_str(&row.requested_json)
            .map_err(|e| format!("stored requested identity is corrupt: {e}"))?,
        configured: serde_json::from_str(&row.configured_json)
            .map_err(|e| format!("stored configured identity is corrupt: {e}"))?,
        observed: latest.clone(),
        adapter: row
            .adapter_json
            .map(|value| {
                serde_json::from_str(&value)
                    .map_err(|e| format!("stored adapter identity is corrupt: {e}"))
            })
            .transpose()?,
        ui_profile_id: row.ui_profile_id,
    };
    let assessment = latest.map_or(IdentityStatus::Unknown, |observation| {
        assess_identity_observation(
            &observation,
            &FamilyRegistry::production(),
            now_unix_secs() as u64,
        )
    });
    Ok(json!({"state":"recorded","identity":identity,"history":history,"assessment":assessment}))
}

fn db(error: sqlx::Error) -> String {
    format!("development identity storage: {error}")
}
