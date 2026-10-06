//! Global dispatch barrier. Process termination/its deadline belong to W5-04b;
//! never fabricate exit evidence or release live workers' scope/budget locks.
//! Direct database/schema access is outside the trusted control API boundary.
use super::audit::{append_domain_audit_tx, AuditEnvelope};
use super::continuous::begin_write;
use super::{now_unix_secs, Store};
use sqlx::{Sqlite, Transaction};

/// Scope marker for rows that belong to the whole app, not one project or run:
/// it fills the envelope's `project` and `run` and is the audit `subject`.
const GLOBAL_SCOPE: &str = "global";
const BARRIER_FAILED: &str = "barrier-failed";
const STORE_FAILED: &str = "store-failed";

pub(super) async fn apply_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    sqlx::query("CREATE TABLE IF NOT EXISTS emergency_stop (id INTEGER PRIMARY KEY CHECK(id=1), active INTEGER NOT NULL CHECK(active IN (0,1)))")
        .execute(&mut **tx).await.map_err(db)?;
    sqlx::query("INSERT OR IGNORE INTO emergency_stop VALUES(1,0)")
        .execute(&mut **tx)
        .await
        .map_err(db)?;
    // The guard and transition share SQLite's writer lock, including callers
    // on other Store instances. Missing/corrupt state never grants admission.
    for (table, column, predicate) in [
        (
            "task_queue",
            "status",
            "NEW.status IN ('dispatching','dispatched')",
        ),
        ("continuous_tasks", "status", "NEW.status = 'running'"),
        (
            "development_runs",
            "status",
            "NEW.status IN ('intent','launched')",
        ),
        (
            "development_launches",
            "state",
            "NEW.state IN ('reserved','spawning')",
        ),
        ("development_deliveries", "state", "NEW.state = 'started'"),
    ] {
        for (suffix, operation) in [
            ("insert", "INSERT".to_string()),
            ("update", format!("UPDATE OF {column}")),
        ] {
            sqlx::query(&format!("CREATE TRIGGER IF NOT EXISTS emergency_stop_{table}_{suffix} BEFORE {operation} ON {table} WHEN ({predicate}) AND COALESCE((SELECT active FROM emergency_stop WHERE id=1),1) <> 0 BEGIN SELECT RAISE(ABORT,'global emergency stop active or unavailable'); END"))
                .execute(&mut **tx).await.map_err(db)?;
        }
    }
    Ok(())
}

impl Store {
    /// Errors mean stopped, never permission to dispatch.
    pub async fn emergency_stop_active(&self) -> Result<bool, String> {
        let active: i64 = sqlx::query_scalar("SELECT active FROM emergency_stop WHERE id=1")
            .fetch_one(&self.pool)
            .await
            .map_err(db)?;
        match active {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err("invalid global emergency stop state".into()),
        }
    }

    /// Trusted human control only; caller authentication belongs to W5-04b.
    /// Clearing permits new queue claims but never revives revoked claims.
    /// Continuous projects stay paused until explicitly resumed/reconciled.
    /// Every outcome appends one `kill_switch` audit envelope in the global
    /// scope (`GLOBAL_SCOPE` as project and run): `raised`/`released` inside
    /// the transition, `barrier-failed`/`store-failed` after rollback. The
    /// failure rows are best effort: if the trail is down too, only the
    /// original error is returned. After a failed commit the rollback is only
    /// queued (the consumed transaction cannot be awaited), so that row can
    /// also be lost or, if the commit proved durable, duplicate.
    pub async fn set_emergency_stop(&self, active: bool, actor: &str) -> Result<(), String> {
        if actor.trim().is_empty() {
            return Err("emergency stop actor is required".into());
        }
        let source_ref = if active { "raise" } else { "release" };
        let mut tx = match begin_write(&self.pool, "global emergency stop").await {
            Ok(tx) => tx,
            Err(error) => {
                return self
                    .audit_failure(actor, source_ref, STORE_FAILED, error)
                    .await
            }
        };
        let (result, error) = match transition(&mut tx, active, actor, source_ref).await {
            Ok(()) => match tx.commit().await {
                Ok(()) => return Ok(()),
                Err(error) => (STORE_FAILED, db(error)),
            },
            Err(failure) => {
                // Dropping a write transaction only queues the ROLLBACK and
                // keeps the writer lock; settle it before the failure row.
                let _ = tx.rollback().await;
                failure
            }
        };
        self.audit_failure(actor, source_ref, result, error).await
    }

    /// Best effort: the original error wins when the trail itself is down.
    async fn audit_failure(
        &self,
        actor: &str,
        source_ref: &str,
        result: &str,
        error: String,
    ) -> Result<(), String> {
        let source_ref = format!("emergency_stop:{source_ref}");
        let _ = self
            .append_domain_audit(
                actor.trim(),
                "kill_switch",
                GLOBAL_SCOPE,
                &AuditEnvelope {
                    project: GLOBAL_SCOPE,
                    run: GLOBAL_SCOPE,
                    result,
                    source_ref: &source_ref,
                },
            )
            .await;
        Err(error)
    }

    /// Conservative global stop targets for W5-04b, recoverable after restart.
    /// The app must also fence its in-flight spawns and verify process exits.
    pub async fn emergency_stop_workers(&self) -> Result<Vec<String>, String> {
        sqlx::query_scalar("SELECT id FROM workers WHERE status='running' UNION SELECT worker_id FROM sessions WHERE ended_at IS NULL UNION SELECT worker_id FROM development_launches WHERE state='spawning'")
            .fetch_all(&self.pool).await.map_err(db)
    }
}

/// The state change plus its audit row in one transaction: an audit failure
/// must not produce an unaudited clear. Errors carry the envelope result.
async fn transition(
    tx: &mut Transaction<'_, Sqlite>,
    active: bool,
    actor: &str,
    source_ref: &str,
) -> Result<(), (&'static str, String)> {
    let store_failed = |error| (STORE_FAILED, db(error));
    let statement = if active {
        "INSERT INTO emergency_stop(id,active) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET active=1"
    } else {
        "UPDATE emergency_stop SET active=? WHERE id=1"
    };
    let changed = sqlx::query(statement)
        .bind(active)
        .execute(&mut **tx)
        .await
        .map_err(store_failed)?;
    if changed.rows_affected() != 1 {
        return Err((BARRIER_FAILED, "global emergency stop state missing".into()));
    }
    if active {
        sqlx::query("UPDATE task_queue SET status='failed', error='global emergency stop: dispatch revoked' WHERE status='dispatching'")
            .execute(&mut **tx).await.map_err(store_failed)?;
        sqlx::query("UPDATE continuous_projects SET status='paused', updated_at=? WHERE status IN ('enabled','draining')")
            .bind(now_unix_secs())
            .execute(&mut **tx)
            .await
            .map_err(store_failed)?;
        sqlx::query("UPDATE development_runs SET status='reconciling', terminal_detail='global emergency stop: process exit must be observed', updated_at=? WHERE status IN ('intent','launched')")
            .bind(now_unix_secs()).execute(&mut **tx).await.map_err(store_failed)?;
    }
    let source_ref = format!("emergency_stop:{source_ref}");
    append_domain_audit_tx(
        tx,
        actor.trim(),
        "kill_switch",
        GLOBAL_SCOPE,
        &AuditEnvelope {
            project: GLOBAL_SCOPE,
            run: GLOBAL_SCOPE,
            result: if active { "raised" } else { "released" },
            source_ref: &source_ref,
        },
    )
    .await
    .map_err(|error| (STORE_FAILED, error))
}

fn db(error: sqlx::Error) -> String {
    format!("global emergency stop: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    async fn execute(store: &Store, sql: &str) {
        sqlx::query(sql).execute(&store.pool).await.unwrap();
    }

    #[tokio::test]
    async fn emergency_stop_persists_revokes_and_audits_without_inventing_exits() {
        let dir = TempDir::new("emergency-stop-persistence");
        let path = dir.path().join("projecta.db");
        let store = Store::open(&path).await.unwrap();
        assert!(!store.emergency_stop_active().await.unwrap());
        let triggers: i64 = sqlx::query_scalar("SELECT count(*) FROM sqlite_schema WHERE type='trigger' AND name LIKE 'emergency_stop_%'")
            .fetch_one(&store.pool).await.unwrap();
        assert_eq!(triggers, 10);
        execute(&store, "INSERT INTO task_queue(id,project_id,raw_text,profile_id,status,priority,created_at) VALUES('q','p','task','codex','dispatching',0,1)").await;
        execute(
            &store,
            "INSERT INTO sessions(id,worker_id,started_at) VALUES('s','w',1)",
        )
        .await;
        execute(
            &store,
            "INSERT INTO continuous_projects VALUES('p','enabled',1),('off','disabled',1)",
        )
        .await;
        store.set_emergency_stop(true, "human").await.unwrap();
        let reopened = Store::open(&path).await.unwrap();
        assert!(reopened.emergency_stop_active().await.unwrap());
        assert_eq!(reopened.emergency_stop_workers().await.unwrap(), vec!["w"]);
        assert!(reopened.mark_queue_dispatched("q", "w", 4).await.is_err());
        reopened.set_emergency_stop(false, "human").await.unwrap();
        assert!(!store.emergency_stop_active().await.unwrap());
        assert!(!store.claim_queue_entry("q").await.unwrap());
        assert!(store.mark_queue_dispatched("q", "w", 4).await.is_err());
        let rows: Vec<(String, String, String)> = sqlx::query_as("SELECT actor,subject,detail_json FROM audit_log WHERE action='kill_switch' ORDER BY id")
            .fetch_all(&store.pool).await.unwrap();
        let envelope = |result: &str, source_ref: &str| {
            format!("{{\"project\":\"global\",\"result\":\"{result}\",\"run\":\"global\",\"sourceRef\":\"emergency_stop:{source_ref}\"}}")
        };
        assert_eq!(
            rows,
            vec![
                ("human".into(), "global".into(), envelope("raised", "raise")),
                (
                    "human".into(),
                    "global".into(),
                    envelope("released", "release")
                )
            ]
        );
        let status: String =
            sqlx::query_scalar("SELECT status FROM continuous_projects WHERE project_id='p'")
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(status, "paused");
        let status: String =
            sqlx::query_scalar("SELECT status FROM continuous_projects WHERE project_id='off'")
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(status, "disabled");
        execute(&store, "UPDATE task_queue SET status='ready' WHERE id='q'").await;
        let (stop, _claim) = tokio::join!(
            store.set_emergency_stop(true, "human"),
            reopened.claim_queue_entry("q")
        );
        stop.unwrap();
        let status: String = sqlx::query_scalar("SELECT status FROM task_queue WHERE id='q'")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_ne!(status, "dispatching");
    }

    #[tokio::test]
    async fn emergency_stop_blocks_continuous_boundaries_and_failed_clear() {
        let dir = TempDir::new("emergency-stop-boundaries");
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        store.set_emergency_stop(true, "human").await.unwrap();
        // BEFORE triggers run before unrelated NOT NULL/foreign-key checks.
        for sql in [
            "INSERT INTO continuous_tasks(id,status) VALUES('t','running')",
            "INSERT INTO development_runs(id,status) VALUES('r','intent')",
            "INSERT INTO development_launches(run_id,state) VALUES('r','reserved')",
            "INSERT INTO development_deliveries(run_id,state) VALUES('r','started')",
        ] {
            let err = sqlx::query(sql).execute(&store.pool).await.unwrap_err();
            assert!(err.to_string().contains("global emergency stop"), "{err}");
        }
        execute(&store, "CREATE TRIGGER reject_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'audit unavailable'); END").await;
        assert!(store.set_emergency_stop(false, "human").await.is_err());
        assert!(store.emergency_stop_active().await.unwrap());
        execute(&store, "DELETE FROM emergency_stop").await;
        assert!(store.emergency_stop_active().await.is_err());
        assert!(store.set_emergency_stop(false, "human").await.is_err());
        execute(&store, "DROP TRIGGER reject_audit").await;
        store.set_emergency_stop(true, "human").await.unwrap();
        assert!(store.emergency_stop_active().await.unwrap());
    }
}
