//! Append-only audit trail (W5-05). Rows are written once and never changed:
//! triggers abort ordinary attempts to rewrite existing ids, UPDATE, or DELETE.
//! Schema and database-file access are outside this protection boundary.
use super::{now_unix_secs, Store};
use crate::errors::ERR_REFUSED;
use serde::Serialize;
use serde_json::Value;
use sqlx::{Sqlite, Transaction};

const TABLE: &str = "CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, actor TEXT NOT NULL CHECK(actor <> ''), action TEXT NOT NULL CHECK(action <> ''), subject TEXT NOT NULL, detail_json TEXT NOT NULL CHECK(json_valid(detail_json)))";
const NO_ID_REUSE: &str = "CREATE TRIGGER IF NOT EXISTS audit_log_no_id_reuse BEFORE INSERT ON audit_log WHEN NEW.id > 0 AND EXISTS(SELECT 1 FROM audit_log WHERE id = NEW.id) BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END";
const NO_UPDATE: &str = "CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END";
const NO_DELETE: &str = "CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEnvelope<'a> {
    pub project: &'a str,
    pub run: &'a str,
    pub result: &'a str,
    pub source_ref: &'a str,
}

/// Creates the trail. Triggers make every row write-once: the only way to
/// change the trail is to add to it. `IF NOT EXISTS` lets a fixture that
/// restamps `user_version` below 23 re-enter without losing the trail.
pub(super) async fn apply_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    for statement in [TABLE, NO_ID_REUSE, NO_UPDATE, NO_DELETE] {
        sqlx::query(statement)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("failed to create the audit trail: {e}"))?;
    }
    for (name, expected) in [
        ("audit_log", TABLE),
        ("audit_log_no_id_reuse", NO_ID_REUSE),
        ("audit_log_no_update", NO_UPDATE),
        ("audit_log_no_delete", NO_DELETE),
    ] {
        let (actual,): (String,) = sqlx::query_as("SELECT sql FROM sqlite_schema WHERE name = ?")
            .bind(name)
            .fetch_one(&mut **tx)
            .await
            .map_err(|e| format!("failed to verify audit object {name}: {e}"))?;
        let unguarded = expected.replacen(" IF NOT EXISTS", "", 1);
        if actual != expected && actual != unguarded {
            return Err(format!("audit object {name} has an unexpected definition"));
        }
    }
    Ok(())
}

impl Store {
    /// Appends a domain event only when project, run, result and source reference
    /// are all non-blank. It checks presence, not that the references resolve.
    pub async fn append_domain_audit(
        &self,
        actor: &str,
        action: &str,
        subject: &str,
        envelope: &AuditEnvelope<'_>,
    ) -> Result<i64, String> {
        for (field, value) in [
            ("project", envelope.project),
            ("run", envelope.run),
            ("result", envelope.result),
            ("sourceRef", envelope.source_ref),
        ] {
            if value.trim().is_empty() {
                return Err(format!("{ERR_REFUSED}audit envelope missing {field}"));
            }
        }
        let detail = serde_json::to_value(envelope)
            .map_err(|error| format!("failed to serialize audit envelope: {error}"))?;
        self.append_audit(actor, action, subject, &detail).await
    }

    /// Appends one audit row and returns its monotonically increasing id.
    pub async fn append_audit(
        &self,
        actor: &str,
        action: &str,
        subject: &str,
        detail: &Value,
    ) -> Result<i64, String> {
        let result = sqlx::query(
            "INSERT INTO audit_log(ts, actor, action, subject, detail_json) VALUES(?,?,?,?,?)",
        )
        .bind(now_unix_secs())
        .bind(actor)
        .bind(action)
        .bind(subject)
        .bind(detail.to_string())
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to append to the audit trail: {e}"))?;
        Ok(result.last_insert_rowid())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;
    use serde_json::json;

    async fn fixture() -> (TempDir, Store) {
        let dir = TempDir::new("audit-trail");
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        (dir, store)
    }

    fn envelope<'a>(
        project: &'a str,
        run: &'a str,
        result: &'a str,
        source_ref: &'a str,
    ) -> AuditEnvelope<'a> {
        AuditEnvelope {
            project,
            run,
            result,
            source_ref,
        }
    }

    async fn assert_incomplete_is_rejected(
        store: &Store,
        field: &str,
        envelope: AuditEnvelope<'_>,
    ) {
        let error = store
            .append_domain_audit("worker", "delivery", "candidate", &envelope)
            .await
            .unwrap_err();
        assert_eq!(
            error,
            format!("{ERR_REFUSED}audit envelope missing {field}")
        );
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn domain_audit_without_project_is_rejected_without_row() {
        let (_dir, store) = fixture().await;
        assert_incomplete_is_rejected(
            &store,
            "project",
            envelope("", "run-1", "accepted", "queue:1"),
        )
        .await;
    }

    #[tokio::test]
    async fn domain_audit_without_source_ref_is_rejected_without_row() {
        let (_dir, store) = fixture().await;
        assert_incomplete_is_rejected(
            &store,
            "sourceRef",
            envelope("project-1", "run-1", "accepted", ""),
        )
        .await;
    }

    #[tokio::test]
    async fn domain_audit_without_run_is_rejected_without_row() {
        let (_dir, store) = fixture().await;
        assert_incomplete_is_rejected(
            &store,
            "run",
            envelope("project-1", "", "accepted", "queue:1"),
        )
        .await;
    }

    #[tokio::test]
    async fn domain_audit_without_result_is_rejected_without_row() {
        let (_dir, store) = fixture().await;
        assert_incomplete_is_rejected(
            &store,
            "result",
            envelope("project-1", "run-1", "", "queue:1"),
        )
        .await;
    }

    #[tokio::test]
    async fn complete_domain_audit_appends_one_immutable_row() {
        let (_dir, store) = fixture().await;
        let id = store
            .append_domain_audit(
                "worker",
                "delivery",
                "candidate",
                &envelope("project-1", "run-1", "accepted", "queue:1"),
            )
            .await
            .unwrap();
        let rows: Vec<(i64, String)> = sqlx::query_as("SELECT id,detail_json FROM audit_log")
            .fetch_all(&store.pool)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, id);
        assert_eq!(
            serde_json::from_str::<Value>(&rows[0].1).unwrap(),
            json!({
                "project": "project-1", "run": "run-1", "result": "accepted", "sourceRef": "queue:1"
            })
        );
        assert!(
            sqlx::query("UPDATE audit_log SET actor='changed' WHERE id=?")
                .bind(id)
                .execute(&store.pool)
                .await
                .is_err()
        );
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn append_assigns_increasing_ids_and_keeps_the_row() {
        let (_dir, store) = fixture().await;
        let first = store
            .append_audit("coordinator", "kill_switch", "global", &json!({"on": true}))
            .await
            .unwrap();
        let second = store
            .append_audit(
                "coordinator",
                "kill_switch",
                "global",
                &json!({"on": false}),
            )
            .await
            .unwrap();
        assert!(second > first);
        let (actor, action, subject, detail): (String, String, String, String) = sqlx::query_as(
            "SELECT actor, action, subject, detail_json FROM audit_log WHERE id = ?",
        )
        .bind(first)
        .fetch_one(&store.pool)
        .await
        .unwrap();
        assert_eq!(
            (actor.as_str(), action.as_str(), subject.as_str()),
            ("coordinator", "kill_switch", "global")
        );
        assert_eq!(detail, r#"{"on":true}"#);
    }

    #[tokio::test]
    async fn update_of_an_audit_row_is_rejected() {
        let (_dir, store) = fixture().await;
        let id = store
            .append_audit("a", "act", "s", &json!({}))
            .await
            .unwrap();
        let err = sqlx::query("UPDATE audit_log SET actor = 'mallory' WHERE id = ?")
            .bind(id)
            .execute(&store.pool)
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("append-only"), "unexpected error: {err}");
    }

    #[tokio::test]
    async fn delete_of_an_audit_row_is_rejected() {
        let (_dir, store) = fixture().await;
        let id = store
            .append_audit("a", "act", "s", &json!({}))
            .await
            .unwrap();
        let err = sqlx::query("DELETE FROM audit_log WHERE id = ?")
            .bind(id)
            .execute(&store.pool)
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("append-only"), "unexpected error: {err}");
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM audit_log")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn invalid_detail_json_cannot_be_stored_by_hand() {
        let (_dir, store) = fixture().await;
        let err = sqlx::query(
            "INSERT INTO audit_log(ts, actor, action, subject, detail_json) VALUES(1,'a','b','c','not json')",
        )
        .execute(&store.pool)
        .await
        .unwrap_err()
        .to_string();
        assert!(err.contains("CHECK") || err.contains("constraint"), "{err}");
    }

    #[tokio::test]
    async fn replace_cannot_rewrite_an_existing_audit_id() {
        let (_dir, store) = fixture().await;
        let id = store
            .append_audit("a", "act", "s", &json!({}))
            .await
            .unwrap();
        let before: (i64, String, String, String, String) =
            sqlx::query_as("SELECT ts,actor,action,subject,detail_json FROM audit_log WHERE id=?")
                .bind(id)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        let result = sqlx::query(
            "INSERT OR REPLACE INTO audit_log(id,ts,actor,action,subject,detail_json) VALUES(?,1,'mallory','rewrite','s','{}')",
        )
        .bind(id)
        .execute(&store.pool)
        .await;
        assert!(result.is_err(), "REPLACE rewrote an append-only row");
        let after =
            sqlx::query_as("SELECT ts,actor,action,subject,detail_json FROM audit_log WHERE id=?")
                .bind(id)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(before, after);
    }

    #[tokio::test]
    async fn migration_rejects_preexisting_objects_with_the_wrong_shape() {
        let (dir, store) = fixture().await;
        sqlx::query("DROP TABLE audit_log")
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE audit_log (id INTEGER PRIMARY KEY, actor TEXT)")
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO audit_log VALUES(7,'sentinel')")
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("PRAGMA user_version = 22")
            .execute(&store.pool)
            .await
            .unwrap();
        assert!(Store::open(&dir.path().join("projecta.db")).await.is_err());
        let row: (i64, String) = sqlx::query_as("SELECT id,actor FROM audit_log")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        let (version,): (i64,) = sqlx::query_as("PRAGMA user_version")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(row, (7, "sentinel".into()));
        assert_eq!(version, 22);
    }
}
