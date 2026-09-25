//! Trusted native parent checkpoint consumer, never an agent/API ingestion route.
//! Commit precedes acknowledgement. Stored receipts are provisional metadata:
//! no output, capability, executable arguments or environment is persisted here.
use super::Store;
use crate::process_capture::{
    checkpoints::{Request, Stage},
    host_reply::{self, Identity},
    protocol::{Binding, Launch},
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Sqlite, Transaction};

#[path = "native_completion.rs"]
pub(super) mod completion;

/// Unserializable, uncloneable live owner. A recovered row never recreates this
/// authority; after restart the attempt requires reconciliation, not redelivery.
pub struct CaptureOwner {
    binding: Binding,
    launch: Launch,
    owner: String,
    fence: i64,
    capability_sha256: String,
    launch_sha256: String,
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn db(error: sqlx::Error) -> String {
    format!("native checkpoint storage: {error}")
}

pub(super) async fn apply_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    for statement in [
        "CREATE TABLE development_capture_owners (run_id TEXT PRIMARY KEY REFERENCES development_deliveries(run_id), capability_sha256 TEXT NOT NULL UNIQUE, launch_sha256 TEXT NOT NULL, claim_owner TEXT NOT NULL, claim_fence INTEGER NOT NULL, deadline_ms INTEGER NOT NULL, next_stage INTEGER NOT NULL DEFAULT 0 CHECK(next_stage BETWEEN 0 AND 4), state TEXT NOT NULL CHECK(state IN ('open','closed')), created_at INTEGER NOT NULL)",
        "CREATE TABLE development_capture_checkpoints (run_id TEXT NOT NULL REFERENCES development_capture_owners(run_id), stage INTEGER NOT NULL CHECK(stage BETWEEN 0 AND 3), evidence_json TEXT NOT NULL, observed_at INTEGER NOT NULL, PRIMARY KEY(run_id,stage))",
        "CREATE TRIGGER development_capture_checkpoint_journal AFTER INSERT ON development_capture_checkpoints BEGIN INSERT INTO continuous_events(project_id,kind,detail,created_at) SELECT project_id,'development_capture_checkpoint',json_object('version',1,'runId',NEW.run_id,'stage',NEW.stage,'provisional',json('true')),unixepoch() FROM development_launches WHERE run_id=NEW.run_id; END",
    ] {
        sqlx::query(statement).execute(&mut **tx).await.map_err(db)?;
    }
    Ok(())
}

impl Store {
    /// Called by the trusted owner before host launch, after delivery intent.
    /// Timeout is bounded independently of task/claim leases. This does not
    /// prove native provenance; only the owned verified host pipe may submit.
    pub async fn reserve_native_capture_owner(
        &self,
        binding: Binding,
        launch: Launch,
        owner: &str,
        fence: i64,
    ) -> Result<CaptureOwner, String> {
        let launch_sha256 = launch.digest()?;
        binding.validate()?;
        let capability_sha256 = digest(binding.capability.as_bytes());
        let mut tx = self.pool.begin().await.map_err(db)?;
        ensure_full(&mut tx).await?;
        let changed = sqlx::query("INSERT INTO development_capture_owners(run_id,capability_sha256,launch_sha256,claim_owner,claim_fence,deadline_ms,state,created_at) SELECT d.run_id,?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER)+?,'open',unixepoch() FROM development_deliveries d JOIN development_launches l ON l.run_id=d.run_id JOIN development_runs r ON r.id=l.run_id JOIN continuous_tasks t ON t.id=r.task_id WHERE d.run_id=? AND d.session_id=? AND d.process_instance=? AND d.route_sha256=? AND d.input_sha256=? AND d.input_bytes=? AND d.state='started' AND l.session_id=d.session_id AND l.process_instance=d.process_instance AND l.state='spawning' AND r.status IN ('intent','launched') AND r.claim_owner=? AND r.claim_fence=? AND t.status='running' AND t.claim_owner=? AND t.claim_fence=? ON CONFLICT(run_id) DO NOTHING")
            .bind(&capability_sha256).bind(&launch_sha256).bind(owner).bind(fence)
            .bind((launch.timeout_ms + 10_000) as i64)
            .bind(&binding.run_id).bind(&binding.session_id).bind(&binding.process_instance).bind(&binding.route_sha256)
            .bind(&launch.input_sha256).bind(launch.input_bytes as i64).bind(owner).bind(fence).bind(owner).bind(fence)
            .execute(&mut *tx).await.map_err(db)?;
        if changed.rows_affected() != 1 {
            return Err("native capture owner consumed, stale or unauthorized".into());
        }
        check_route(&mut tx, &binding).await?;
        tx.commit().await.map_err(db)?;
        Ok(CaptureOwner {
            binding,
            launch,
            owner: owner.into(),
            fence,
            capability_sha256,
            launch_sha256,
        })
    }

    /// Caller owns and drains the actor/task until this future finishes. Dropping
    /// the response receiver is NOT cancellation of a pending database write.
    pub async fn acknowledge_native_checkpoint(
        &self,
        owner: &CaptureOwner,
        request: Request,
    ) -> Result<(), String> {
        let result = self.persist_native_checkpoint(owner, &request).await;
        request.acknowledge(result)
    }

    async fn persist_native_checkpoint(
        &self,
        owner: &CaptureOwner,
        request: &Request,
    ) -> Result<(), String> {
        if request.binding != owner.binding {
            return Err("native checkpoint binding mismatch".into());
        }
        let stage = match request.stage {
            Stage::Launch => 0,
            Stage::Process => 1,
            Stage::Input => 2,
            Stage::Receipt => 3,
        };
        let evidence = owner.evidence(request)?;
        let mut tx = self.pool.begin().await.map_err(db)?;
        ensure_full(&mut tx).await?;
        // One writer transition fences duplicates, out-of-order requests, closed
        // owners, expired actors and reassigned tasks, including after lock wait.
        let changed = sqlx::query("UPDATE development_capture_owners SET next_stage=next_stage+1 WHERE run_id=? AND capability_sha256=? AND launch_sha256=? AND claim_owner=? AND claim_fence=? AND next_stage=? AND state='open' AND deadline_ms>CAST(unixepoch('subsec')*1000 AS INTEGER) AND EXISTS (SELECT 1 FROM development_deliveries d JOIN development_launches l ON l.run_id=d.run_id JOIN development_runs r ON r.id=l.run_id JOIN continuous_tasks t ON t.id=r.task_id WHERE d.run_id=development_capture_owners.run_id AND d.session_id=? AND d.process_instance=? AND d.route_sha256=? AND d.input_sha256=? AND d.input_bytes=? AND l.session_id=d.session_id AND l.process_instance=d.process_instance AND r.status IN ('intent','launched') AND r.claim_owner=? AND r.claim_fence=? AND t.status='running' AND t.claim_owner=? AND t.claim_fence=?)")
            .bind(&owner.binding.run_id).bind(&owner.capability_sha256).bind(&owner.launch_sha256).bind(&owner.owner).bind(owner.fence).bind(stage)
            .bind(&owner.binding.session_id).bind(&owner.binding.process_instance).bind(&owner.binding.route_sha256)
            .bind(&owner.launch.input_sha256).bind(owner.launch.input_bytes as i64).bind(&owner.owner).bind(owner.fence).bind(&owner.owner).bind(owner.fence)
            .execute(&mut *tx).await.map_err(db)?;
        if changed.rows_affected() != 1 {
            return Err("native checkpoint stale, closed, expired or out of order".into());
        }
        check_route(&mut tx, &owner.binding).await?;
        if stage == 3 {
            let previous: String = sqlx::query_scalar("SELECT evidence_json FROM development_capture_checkpoints WHERE run_id=? AND stage=1")
                .bind(&owner.binding.run_id).fetch_one(&mut *tx).await.map_err(db)?;
            let previous: Identity =
                serde_json::from_str(&previous).map_err(|_| "invalid stored process identity")?;
            let current: Identity = serde_json::from_value(evidence["identity"].clone())
                .map_err(|_| "invalid receipt identity")?;
            if !previous.same_process(&current) {
                return Err("native receipt process changed".into());
            }
        }
        sqlx::query("INSERT INTO development_capture_checkpoints(run_id,stage,evidence_json,observed_at) VALUES(?,?,?,unixepoch())")
            .bind(&owner.binding.run_id).bind(stage).bind(evidence.to_string()).execute(&mut *tx).await.map_err(db)?;
        tx.commit().await.map_err(db)
    }

    /// Serialized barrier: on successful return no later checkpoint can commit.
    /// The registry must still wait for actor and native cleanup before idle.
    pub async fn close_native_capture_owner(&self, owner: &CaptureOwner) -> Result<(), String> {
        let changed = sqlx::query("UPDATE development_capture_owners SET state='closed' WHERE run_id=? AND capability_sha256=?")
            .bind(&owner.binding.run_id).bind(&owner.capability_sha256).execute(&self.pool).await.map_err(db)?;
        if changed.rows_affected() != 1 {
            return Err("native capture owner unavailable".into());
        }
        Ok(())
    }
}

async fn check_route(tx: &mut Transaction<'_, Sqlite>, binding: &Binding) -> Result<(), String> {
    let route: String = sqlx::query_scalar(
        "SELECT route_json FROM development_launches WHERE run_id=? AND state='spawning'",
    )
    .bind(&binding.run_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(db)?;
    if digest(route.as_bytes()) != binding.route_sha256 {
        return Err("native capture durable route changed".into());
    }
    Ok(())
}

/// Reads a connection setting, not a table: it opens no read transaction, so
/// the caller's following write still acquires the writer lock with SQLite's
/// busy handler (`store/write_lock_tests.rs`). Read a table here and every
/// caller would fail busy at once under a foreign writer.
async fn ensure_full(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    let synchronous: i64 = sqlx::query_scalar("PRAGMA synchronous")
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?;
    if synchronous < 2 {
        return Err("durable checkpoints require SQLite FULL synchronization".into());
    }
    Ok(())
}

impl CaptureOwner {
    pub(crate) fn claim_identity(&self) -> (&str, &str, i64) {
        (&self.binding.run_id, &self.owner, self.fence)
    }
    pub(crate) fn validate_prepared(
        &self,
        prepared: &crate::process_capture::protocol::Prepared,
    ) -> Result<(), String> {
        if prepared.binding() != &self.binding || prepared.launch().digest()? != self.launch_sha256
        {
            return Err("native prepared invocation differs from capture owner".into());
        }
        Ok(())
    }

    fn evidence(&self, request: &Request) -> Result<Value, String> {
        let input =
            json!({"inputBytes":self.launch.input_bytes,"inputSha256":self.launch.input_sha256});
        match request.stage {
            Stage::Launch => {
                let expected = json!({"launchSha256":self.launch_sha256,"inputBytes":self.launch.input_bytes,"inputSha256":self.launch.input_sha256});
                if request.payload != expected {
                    return Err("native launch checkpoint mismatch".into());
                }
                Ok(expected)
            }
            Stage::Input => {
                if request.payload != input {
                    return Err("native input checkpoint mismatch".into());
                }
                Ok(input)
            }
            Stage::Process => {
                let identity: Identity = serde_json::from_value(request.payload.clone())
                    .map_err(|_| "invalid native checkpoint identity")?;
                identity.validate(
                    &self.launch,
                    "native_image_verified_suspended_before_execution",
                )?;
                serde_json::to_value(identity)
                    .map_err(|_| "invalid native identity serialization".into())
            }
            Stage::Receipt => {
                let bytes = serde_json::to_vec(&request.payload)
                    .map_err(|_| "invalid native receipt serialization")?;
                let reply = host_reply::decode(&bytes, &self.binding, &self.launch)?;
                Ok(self.receipt_metadata(&reply))
            }
        }
    }

    fn receipt_metadata(&self, reply: &host_reply::Reply) -> Value {
        json!({"state":"receipt_observed_provisional","identity":reply.capture.identity,
            "exitCode":reply.capture.exit_code,"stdoutBytes":reply.capture.stdout.len(),"stdoutSha256":digest(&reply.capture.stdout),
            "stderrBytes":reply.capture.stderr.len(),"stderrSha256":digest(&reply.capture.stderr)})
    }
}

#[cfg(test)]
#[path = "development_capture_tests.rs"]
mod tests;

#[cfg(all(test, windows))]
#[path = "native_managed_tests.rs"]
mod managed_tests;
