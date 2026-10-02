//! Global dispatch barrier. Process termination/its deadline belong to W5-04b;
//! never fabricate exit evidence or release live workers' scope/budget locks.
use super::{now_unix_secs, Store};
use sqlx::{Sqlite, Transaction};

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
    pub async fn set_emergency_stop(&self, active: bool, actor: &str) -> Result<(), String> {
        if actor.trim().is_empty() {
            return Err("emergency stop actor is required".into());
        }
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await.map_err(db)?;
        let changed = sqlx::query("UPDATE emergency_stop SET active=? WHERE id=1")
            .bind(active)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        if changed.rows_affected() != 1 {
            return Err("global emergency stop state missing".into());
        }
        if active {
            sqlx::query("UPDATE task_queue SET status='failed', error='global emergency stop: dispatch revoked' WHERE status='dispatching'")
                .execute(&mut *tx).await.map_err(db)?;
            sqlx::query("UPDATE continuous_projects SET status='paused', updated_at=?")
                .bind(now_unix_secs())
                .execute(&mut *tx)
                .await
                .map_err(db)?;
            sqlx::query("UPDATE development_runs SET status='reconciling', terminal_detail='global emergency stop: process exit must be observed', updated_at=? WHERE status IN ('intent','launched')")
                .bind(now_unix_secs()).execute(&mut *tx).await.map_err(db)?;
        }
        // Same transaction: audit failure must not produce an unaudited clear.
        sqlx::query("INSERT INTO audit_log(ts,actor,action,subject,detail_json) VALUES(?,?,'kill_switch','global',?)")
            .bind(now_unix_secs()).bind(actor).bind(serde_json::json!({"on":active}).to_string())
            .execute(&mut *tx).await.map_err(db)?;
        tx.commit().await.map_err(db)
    }

    /// Conservative global stop targets for W5-04b, recoverable after restart.
    /// The app must also fence its in-flight spawns and verify process exits.
    pub async fn emergency_stop_workers(&self) -> Result<Vec<String>, String> {
        sqlx::query_scalar("SELECT id FROM workers WHERE status='running' UNION SELECT worker_id FROM sessions WHERE ended_at IS NULL UNION SELECT worker_id FROM development_launches WHERE state='spawning'")
            .fetch_all(&self.pool).await.map_err(db)
    }
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
        execute(&store, "INSERT INTO task_queue(id,project_id,raw_text,profile_id,status,priority,created_at) VALUES('q','p','task','codex','dispatching',0,1)").await;
        execute(
            &store,
            "INSERT INTO sessions(id,worker_id,started_at) VALUES('s','w',1)",
        )
        .await;
        execute(
            &store,
            "INSERT INTO continuous_projects VALUES('p','enabled',1)",
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
        assert_eq!(
            rows,
            vec![
                ("human".into(), "global".into(), "{\"on\":true}".into()),
                ("human".into(), "global".into(), "{\"on\":false}".into())
            ]
        );
        let status: String =
            sqlx::query_scalar("SELECT status FROM continuous_projects WHERE project_id='p'")
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(status, "paused");
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
    }
}
