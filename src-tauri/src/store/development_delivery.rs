//! Single-use delivery intent in the authoritative SQLite ledger.
//! PTY enqueue is deliberately weaker than native input-write/EOF evidence.
use super::{now_unix_secs, Store};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Sqlite, Transaction};

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DevelopmentDelivery {
    pub run_id: String,
    pub session_id: String,
    pub process_instance: String,
    pub route_sha256: String,
    pub input_sha256: String,
    pub input_bytes: i64,
    pub state: String,
    pub started_at: i64,
    pub enqueued_at: Option<i64>,
}

pub(super) async fn apply_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    for statement in [
        "ALTER TABLE development_launches ADD COLUMN process_instance TEXT",
        "CREATE UNIQUE INDEX development_process_instance_unique ON development_launches(process_instance) WHERE process_instance IS NOT NULL",
        "CREATE TABLE development_deliveries (run_id TEXT PRIMARY KEY REFERENCES development_runs(id), session_id TEXT NOT NULL UNIQUE, process_instance TEXT NOT NULL UNIQUE, route_sha256 TEXT NOT NULL, input_sha256 TEXT NOT NULL, input_bytes INTEGER NOT NULL CHECK(input_bytes >= 0 AND input_bytes <= 1048576), state TEXT NOT NULL CHECK(state IN ('started','enqueued')), started_at INTEGER NOT NULL, enqueued_at INTEGER)",
        "CREATE TRIGGER development_delivery_insert_journal AFTER INSERT ON development_deliveries BEGIN INSERT INTO continuous_events(project_id,kind,detail,created_at) SELECT project_id,'development_delivery',json_object('version',1,'action','insert','runId',NEW.run_id,'recordId',NEW.run_id),unixepoch() FROM development_launches WHERE run_id=NEW.run_id; END",
        "CREATE TRIGGER development_delivery_update_journal AFTER UPDATE ON development_deliveries BEGIN INSERT INTO continuous_events(project_id,kind,detail,created_at) SELECT project_id,'development_delivery',json_object('version',1,'action','update','runId',NEW.run_id,'recordId',NEW.run_id),unixepoch() FROM development_launches WHERE run_id=NEW.run_id; END",
    ] {
        sqlx::query(statement).execute(&mut **tx).await.map_err(db)?;
    }
    Ok(())
}

impl Store {
    /// Trusted launch lane only. Commit before calling a transport. A failed or
    /// interrupted call retains this row; even identical input cannot be retried.
    pub async fn begin_development_delivery(
        &self,
        run: &str,
        owner: &str,
        fence: i64,
        session: &str,
        input: &[u8],
    ) -> Result<DevelopmentDelivery, String> {
        if input.len() > 1_048_576 {
            return Err("development input exceeds capture limit".into());
        }
        let mut tx = self.pool.begin().await.map_err(db)?;
        // A connection setting, not a table read: no read transaction opens
        // before the writer below (see `ensure_full` in development_capture).
        let synchronous: i64 = sqlx::query_scalar("PRAGMA synchronous")
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
        if synchronous < 2 {
            return Err("durable delivery requires SQLite FULL synchronization".into());
        }
        // Obtain the writer before observing the immutable route and identity.
        sqlx::query("UPDATE development_runs SET updated_at=updated_at WHERE id=?")
            .bind(run)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        let route: String = sqlx::query_scalar(
            "SELECT route_json FROM development_launches WHERE run_id=? AND route_json IS NOT NULL",
        )
        .bind(run)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?
        .ok_or("delivery route unavailable")?;
        let inserted = sqlx::query("INSERT INTO development_deliveries(run_id,session_id,process_instance,route_sha256,input_sha256,input_bytes,state,started_at) SELECT l.run_id,l.session_id,l.process_instance,?,?,?,'started',? FROM development_launches l JOIN development_runs r ON r.id=l.run_id JOIN continuous_tasks t ON t.id=r.task_id WHERE l.run_id=? AND l.session_id=? AND l.state='spawning' AND l.process_instance IS NOT NULL AND r.status IN ('intent','launched') AND r.claim_owner=? AND r.claim_fence=? AND t.status='running' AND t.claim_owner=? AND t.claim_fence=? ON CONFLICT(run_id) DO NOTHING")
            .bind(format!("{:x}",Sha256::digest(route.as_bytes())))
            .bind(format!("{:x}",Sha256::digest(input))).bind(input.len() as i64).bind(now_unix_secs())
            .bind(run).bind(session).bind(owner).bind(fence).bind(owner).bind(fence)
            .execute(&mut *tx).await.map_err(db)?;
        if inserted.rows_affected() != 1 {
            return Err(
                "delivery consumed, stale or unauthorized; reconcile without redelivery".into(),
            );
        }
        let receipt = sqlx::query_as("SELECT * FROM development_deliveries WHERE run_id=?")
            .bind(run)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(receipt)
    }

    /// Transport accepted an enqueue request, not provider delivery or task
    /// acceptance. Late evidence may be recorded after claim expiry/exit, but
    /// must still match the exact previously committed process attempt. It is
    /// refused after a proven `exited_undelivered` exit: that state asserts
    /// the input never reached the provider, and the reservation was released
    /// on that basis (DF-15b).
    pub async fn record_development_delivery_enqueued(
        &self,
        receipt: &DevelopmentDelivery,
    ) -> Result<(), String> {
        let changed=sqlx::query("UPDATE development_deliveries SET state='enqueued',enqueued_at=? WHERE run_id=? AND session_id=? AND process_instance=? AND input_sha256=? AND input_bytes=? AND route_sha256=? AND state='started' AND NOT EXISTS(SELECT 1 FROM development_launches l WHERE l.run_id=development_deliveries.run_id AND l.state='exited_undelivered')")
            .bind(now_unix_secs()).bind(&receipt.run_id).bind(&receipt.session_id).bind(&receipt.process_instance)
            .bind(&receipt.input_sha256).bind(receipt.input_bytes).bind(&receipt.route_sha256)
            .execute(&self.pool).await.map_err(db)?;
        if changed.rows_affected() != 1 {
            return Err("delivery enqueue observation stale or duplicate".into());
        }
        Ok(())
    }

    #[cfg(test)]
    pub async fn development_delivery(
        &self,
        run: &str,
    ) -> Result<Option<DevelopmentDelivery>, String> {
        sqlx::query_as("SELECT * FROM development_deliveries WHERE run_id=?")
            .bind(run)
            .fetch_optional(&self.pool)
            .await
            .map_err(db)
    }
}

fn db(error: sqlx::Error) -> String {
    format!("development delivery storage: {error}")
}
