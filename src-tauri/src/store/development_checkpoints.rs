//! Append-only, agent-reported task memory. A checkpoint never completes work,
//! releases ownership, changes a budget, or attests its narrative as fact.
use super::*;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckpointInput {
    pub idempotency_key: String,
    pub expected_revision: i64,
    pub completed: Vec<String>,
    pub remaining: Vec<String>,
    pub failed_approaches: Vec<String>,
    pub evidence_ids: Vec<String>,
}

pub(in crate::store) async fn apply_checkpoint_migration(
    tx: &mut Transaction<'_, Sqlite>,
) -> Result<(), String> {
    sqlx::query("CREATE TABLE development_checkpoints (task_id TEXT NOT NULL, revision INTEGER NOT NULL, run_id TEXT NOT NULL, input_json TEXT NOT NULL, idempotency_key TEXT NOT NULL, recorded_at INTEGER NOT NULL, PRIMARY KEY(task_id, revision), UNIQUE(run_id, idempotency_key))")
        .execute(&mut **tx).await.map_err(db("create structured checkpoints"))?;
    Ok(())
}

fn record(
    task: &str,
    revision: i64,
    run: &str,
    raw: &str,
    recorded_at: i64,
) -> Result<Value, String> {
    let input: CheckpointInput = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    Ok(
        serde_json::json!({"schemaVersion":1,"taskId":task,"revision":revision,"runId":run,"recordedAt":recorded_at,"source":"agent-reported","trust":"unverified-data","content":input}),
    )
}

pub(super) async fn latest(
    tx: &mut Transaction<'_, Sqlite>,
    task: &str,
) -> Result<Option<Value>, String> {
    let row: Option<(i64, String, String, i64)> = sqlx::query_as("SELECT revision, run_id, input_json, recorded_at FROM development_checkpoints WHERE task_id = ? ORDER BY revision DESC LIMIT 1")
        .bind(task).fetch_optional(&mut **tx).await.map_err(db("read task checkpoint"))?;
    row.map(|(rev, run, raw, time)| record(task, rev, &run, &raw, time))
        .transpose()
}

impl Store {
    pub async fn agent_checkpoint_at(
        &self,
        run: &str,
        owner: &str,
        fence: i64,
        revision: i64,
    ) -> Result<Value, String> {
        if revision < 1 {
            return Err("checkpoint revision must be positive".into());
        }
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(db("begin checkpoint retrieval"))?;
        require_run_authority(&mut tx, run, owner, fence).await?;
        let task = run_by_id(&mut tx, run)
            .await?
            .ok_or("unknown development run")?
            .task_id;
        let row: Option<(String, String, i64)> = sqlx::query_as("SELECT run_id, input_json, recorded_at FROM development_checkpoints WHERE task_id = ? AND revision = ?")
            .bind(&task).bind(revision).fetch_optional(&mut *tx).await.map_err(db("read checkpoint revision"))?;
        let (source_run, raw, time) = row.ok_or("unknown checkpoint revision for this task")?;
        let result = record(&task, revision, &source_run, &raw, time)?;
        tx.commit()
            .await
            .map_err(db("commit checkpoint retrieval"))?;
        Ok(result)
    }

    pub async fn record_agent_checkpoint(
        &self,
        run: &str,
        owner: &str,
        fence: i64,
        input: CheckpointInput,
    ) -> Result<Value, String> {
        required(&input.idempotency_key, "idempotencyKey")?;
        let raw = serde_json::to_string(&input).map_err(|e| e.to_string())?;
        if input.expected_revision < 0
            || input.expected_revision == i64::MAX
            || raw.len() > 16_384
            || [
                &input.completed,
                &input.remaining,
                &input.failed_approaches,
                &input.evidence_ids,
            ]
            .into_iter()
            .any(|list| {
                list.len() > 32
                    || list
                        .iter()
                        .any(|text| text.trim().is_empty() || text.len() > 2048)
            })
        {
            return Err("checkpoint exceeds revision, list or 16KiB content limits".into());
        }
        let mut tx = self.pool.begin().await.map_err(db("begin checkpoint"))?;
        // Acquire SQLite's writer lock before checking the expected revision.
        sqlx::query("UPDATE development_runs SET updated_at = updated_at WHERE id = ?")
            .bind(run)
            .execute(&mut *tx)
            .await
            .map_err(db("serialize checkpoint"))?;
        require_active_run_authority(&mut tx, run, owner, fence).await?;
        let run_record = run_by_id(&mut tx, run)
            .await?
            .ok_or("unknown development run")?;
        let existing: Option<(i64, String, i64)> = sqlx::query_as("SELECT revision, input_json, recorded_at FROM development_checkpoints WHERE run_id = ? AND idempotency_key = ?")
            .bind(run).bind(&input.idempotency_key).fetch_optional(&mut *tx).await.map_err(db("read checkpoint replay"))?;
        if let Some((revision, old, time)) = existing {
            if old != raw {
                return Err("checkpoint idempotency key reused with different content".into());
            }
            return record(&run_record.task_id, revision, run, &old, time);
        }
        let (revision,): (i64,) = sqlx::query_as(
            "SELECT COALESCE(MAX(revision), 0) FROM development_checkpoints WHERE task_id = ?",
        )
        .bind(&run_record.task_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db("read checkpoint revision"))?;
        if revision != input.expected_revision {
            return Err("checkpoint revision changed; refresh task context".into());
        }
        for id in &input.evidence_ids {
            let (valid,): (bool,) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM development_run_evidence WHERE id = ? AND run_id = ? AND invalidated_at IS NULL)")
                .bind(id).bind(run).fetch_one(&mut *tx).await.map_err(db("validate checkpoint evidence"))?;
            if !valid {
                return Err(
                    "checkpoint evidence is missing, stale or belongs to another run".into(),
                );
            }
        }
        let now = now_unix_secs();
        sqlx::query("INSERT INTO development_checkpoints(task_id, revision, run_id, input_json, idempotency_key, recorded_at) VALUES(?, ?, ?, ?, ?, ?)")
            .bind(&run_record.task_id).bind(revision + 1).bind(run).bind(&raw).bind(&input.idempotency_key).bind(now)
            .execute(&mut *tx).await.map_err(db("save checkpoint"))?;
        let (project,): (String,) =
            sqlx::query_as("SELECT project_id FROM continuous_goals WHERE id = ?")
                .bind(&run_record.root_goal_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(db("read checkpoint project"))?;
        let result = record(&run_record.task_id, revision + 1, run, &raw, now)?;
        let detail =
            serde_json::json!({"taskId":run_record.task_id,"runId":run,"revision":revision+1})
                .to_string();
        sqlx::query("INSERT INTO continuous_events(project_id, kind, detail, created_at) VALUES(?, 'run_checkpoint', ?, ?)")
            .bind(project).bind(detail).bind(now).execute(&mut *tx).await.map_err(db("publish checkpoint cursor"))?;
        tx.commit().await.map_err(db("commit checkpoint"))?;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> CheckpointInput {
        CheckpointInput {
            idempotency_key: "checkpoint-1".into(),
            expected_revision: 0,
            completed: vec!["private narrative".into()],
            remaining: vec![],
            failed_approaches: vec![],
            evidence_ids: vec![],
        }
    }

    async fn fixture() -> (crate::testutil::TempDir, Store, String) {
        let (dir, store, _, task) = super::super::tests::fixture().await;
        let run = store
            .record_development_run_intent(&task, "worker-a", 7)
            .await
            .unwrap();
        (dir, store, run.id)
    }

    async fn envelopes(store: &Store) -> Vec<Value> {
        sqlx::query_scalar::<_, String>(
            "SELECT detail_json FROM audit_log WHERE action='run_checkpoint' ORDER BY id",
        )
        .fetch_all(&store.pool)
        .await
        .unwrap()
        .iter()
        .map(|raw| serde_json::from_str(raw).unwrap())
        .collect()
    }

    fn envelope(run: &str, result: &str) -> Value {
        serde_json::json!({"project":"project", "run":run, "result":result,
            "sourceRef":format!("development:checkpoint:{run}")})
    }

    async fn counts(store: &Store) -> (i64, i64) {
        sqlx::query_as("SELECT (SELECT COUNT(*) FROM development_checkpoints), (SELECT COUNT(*) FROM continuous_events WHERE kind='run_checkpoint')")
            .fetch_one(&store.pool).await.unwrap()
    }

    #[tokio::test]
    async fn r19_03b_agent_checkpoint_writes_full_envelope_on_success() {
        let (dir, store, run) = fixture().await;
        let saved = store
            .record_agent_checkpoint(&run, "worker-a", 7, input())
            .await
            .unwrap();
        assert_eq!(saved["revision"], 1);
        assert_eq!(
            store
                .record_agent_checkpoint(&run, "worker-a", 7, input())
                .await
                .unwrap(),
            saved
        );
        let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        assert_eq!(counts(&reopened).await, (1, 1));
        assert_eq!(
            envelopes(&reopened).await,
            vec![envelope(&run, "accepted"); 2]
        );
    }

    #[tokio::test]
    async fn r19_03b_agent_checkpoint_writes_full_envelope_on_rejection() {
        let (_dir, store, run) = fixture().await;
        store
            .record_agent_checkpoint(&run, "worker-a", 7, input())
            .await
            .unwrap();
        for case in 0..8 {
            let mut request = input();
            let mut owner = "worker-a";
            let mut fence = 7;
            match case {
                0 => owner = "foreign",
                1 => fence = 8,
                2 => request.idempotency_key.clear(),
                3 => request.expected_revision = -1,
                4 => request.idempotency_key = "stale-revision".into(),
                5 => {
                    request.idempotency_key = "bad-evidence".into();
                    request.expected_revision = 1;
                    request.evidence_ids.push("missing".into());
                }
                6 => request.completed = vec!["changed content".into()],
                _ => request.remaining = vec!["x".repeat(2049)],
            }
            assert!(store
                .record_agent_checkpoint(&run, owner, fence, request)
                .await
                .is_err());
            assert_eq!(counts(&store).await, (1, 1));
            let audits = envelopes(&store).await;
            assert_eq!(audits.len(), case + 2);
            assert_eq!(audits.last().unwrap(), &envelope(&run, "rejected"));
        }
        for unknown in ["missing-run", " "] {
            assert!(store
                .record_agent_checkpoint(unknown, "worker-a", 7, input())
                .await
                .is_err());
            assert_eq!(
                envelopes(&store).await.last().unwrap(),
                &serde_json::json!({
                    "project":"unresolved", "run":"unresolved", "result":"rejected",
                    "sourceRef":"development:checkpoint:unresolved"
                })
            );
        }
    }

    #[tokio::test]
    async fn r19_03b_agent_checkpoint_audit_failure_rolls_back() {
        let (_dir, store, run) = fixture().await;
        sqlx::query("CREATE TRIGGER reject_checkpoint_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END")
            .execute(&store.pool).await.unwrap();
        let error = store
            .record_agent_checkpoint(&run, "worker-a", 7, input())
            .await
            .unwrap_err();
        assert!(error.contains("audit unavailable"), "{error}");
        assert_eq!(counts(&store).await, (0, 0));
        assert!(envelopes(&store).await.is_empty());
    }

    #[tokio::test]
    async fn r19_03b_agent_checkpoint_journal_failure_audits_without_partial_state() {
        let (_dir, store, run) = fixture().await;
        sqlx::query("CREATE TRIGGER reject_checkpoint_event BEFORE INSERT ON continuous_events WHEN NEW.kind='run_checkpoint' BEGIN SELECT RAISE(ABORT, 'journal unavailable'); END")
            .execute(&store.pool).await.unwrap();
        let error = store
            .record_agent_checkpoint(&run, "worker-a", 7, input())
            .await
            .unwrap_err();
        assert!(error.contains("journal unavailable"), "{error}");
        assert_eq!(counts(&store).await, (0, 0));
        assert_eq!(envelopes(&store).await, vec![envelope(&run, "rejected")]);
    }
}
