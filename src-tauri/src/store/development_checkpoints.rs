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
