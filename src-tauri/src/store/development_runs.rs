//! Durable launch-intent, execution-run, and candidate-evidence records.
//!
//! This is storage only. In particular, writing an intent does not spawn a
//! process, and a stale lease is never accepted as an authority to create a
//! second run. The existing continuous-task owner/fence is the authority.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, Sqlite, Transaction};

use super::development_launches::{run_role, DispatchRole};
use super::{new_id, now_unix_secs, Store};

#[path = "development_checkpoints.rs"]
mod checkpoints;
pub(super) use checkpoints::apply_checkpoint_migration;
pub use checkpoints::CheckpointInput;

#[path = "development_guidance.rs"]
pub(in crate::store) mod guidance;

#[path = "development_pages.rs"]
mod pages;
pub(super) use pages::apply_page_migration;

pub const RUN_INTENT: &str = "intent";
pub const RUN_LAUNCHED: &str = "launched";
pub const RUN_RECONCILING: &str = "reconciling";
pub const RUN_COMPLETED: &str = "completed";
pub const RUN_FAILED: &str = "failed";

const VALID_REVIEW: &str = "valid";
const INVALIDATED_REVIEW: &str = "invalidated";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DevelopmentRun {
    pub id: String,
    pub task_id: String,
    pub root_goal_id: String,
    pub claim_owner: String,
    pub claim_fence: i64,
    /// The exact immutable root policy copied at intent time.
    pub policy_json: String,
    pub status: String,
    pub worker_id: Option<String>,
    pub process_id: Option<i64>,
    pub intent_at: i64,
    pub launched_at: Option<i64>,
    pub reconciled_at: Option<i64>,
    pub terminal_at: Option<i64>,
    pub terminal_detail: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum EvidenceMeasurement {
    Measured { value: Value },
    Unavailable { reason: String },
}

/// Caller-supplied observations. The store never turns a missing observation
/// into `Measured`, and keeps both this payload and the structured result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceInput {
    pub idempotency_key: String,
    pub source: String,
    pub observed_at: i64,
    pub candidate_commit: String,
    pub measurement: EvidenceMeasurement,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevelopmentEvidence {
    pub id: String,
    pub run_id: String,
    pub idempotency_key: String,
    pub source: String,
    pub observed_at: i64,
    pub candidate_commit: String,
    pub measurement: EvidenceMeasurement,
    pub payload: Value,
    pub invalidated_at: Option<i64>,
    pub invalidated_by_commit: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CandidateBinding {
    pub run_id: String,
    pub candidate_commit: String,
    pub source: String,
    pub observed_at: i64,
    pub invalidated_records: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewDisposition {
    Approved,
    ChangesRequested,
}

impl ReviewDisposition {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Approved => "approved",
            Self::ChangesRequested => "changes_requested",
        }
    }
}

/// A review names the evidence that attests the candidate it reviewed. It
/// carries no reviewer or implementer identity: a caller could claim any label,
/// so both principals are derived from the store (see `RunPrincipal`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewInput {
    pub idempotency_key: String,
    pub evidence_id: String,
    pub candidate_commit: String,
    pub disposition: ReviewDisposition,
    pub source: String,
    pub observed_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DevelopmentReview {
    pub id: String,
    pub run_id: String,
    pub evidence_id: String,
    pub idempotency_key: String,
    pub candidate_commit: String,
    pub disposition: String,
    pub reviewer_identity: String,
    pub implementer_identity: String,
    pub source: String,
    pub observed_at: i64,
    /// `verified: ...` only when launch route receipts prove different
    /// single-vendor providers; otherwise `unverified: <reason>`. Rows written
    /// before W2-01 keep their `unavailable: ...` text.
    pub reviewer_attestation: String,
    /// Kept false until verdicts are signed with a key no agent can read
    /// (W5-02d); a verified principal alone does not grant approval.
    pub approval_eligible: bool,
    pub status: String,
    pub invalidated_at: Option<i64>,
    pub invalidated_by_commit: Option<String>,
}

#[derive(Debug, FromRow)]
struct EvidenceRow {
    id: String,
    run_id: String,
    idempotency_key: String,
    source: String,
    observed_at: i64,
    candidate_commit: String,
    measurement_json: String,
    payload_json: String,
    invalidated_at: Option<i64>,
    invalidated_by_commit: Option<String>,
}

impl EvidenceRow {
    fn into_evidence(self) -> Result<DevelopmentEvidence, String> {
        let measurement = serde_json::from_str(&self.measurement_json).map_err(|error| {
            format!("stored development evidence measurement is corrupt: {error}")
        })?;
        let payload = serde_json::from_str(&self.payload_json)
            .map_err(|error| format!("stored development evidence payload is corrupt: {error}"))?;
        Ok(DevelopmentEvidence {
            id: self.id,
            run_id: self.run_id,
            idempotency_key: self.idempotency_key,
            source: self.source,
            observed_at: self.observed_at,
            candidate_commit: self.candidate_commit,
            measurement,
            payload,
            invalidated_at: self.invalidated_at,
            invalidated_by_commit: self.invalidated_by_commit,
        })
    }
}

/// Migration 6. `store.rs` owns numbering and calls this helper inside its
/// migration transaction.
pub(super) async fn apply_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    for statement in [
        "CREATE TABLE development_runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, root_goal_id TEXT NOT NULL, claim_owner TEXT NOT NULL, claim_fence INTEGER NOT NULL, policy_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('intent', 'launched', 'reconciling', 'completed', 'failed')), worker_id TEXT, process_id INTEGER, intent_at INTEGER NOT NULL, launched_at INTEGER, reconciled_at INTEGER, terminal_at INTEGER, terminal_detail TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(task_id, claim_fence))",
        "CREATE INDEX development_runs_task_status ON development_runs(task_id, status, created_at)",
        "CREATE UNIQUE INDEX development_runs_one_active_task ON development_runs(task_id) WHERE status IN ('intent', 'launched', 'reconciling')",
        "CREATE TABLE development_run_candidates (run_id TEXT PRIMARY KEY, candidate_commit TEXT NOT NULL, source TEXT NOT NULL, observed_at INTEGER NOT NULL)",
        "CREATE TABLE development_run_evidence (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, source TEXT NOT NULL, observed_at INTEGER NOT NULL, candidate_commit TEXT NOT NULL, measurement_json TEXT NOT NULL, payload_json TEXT NOT NULL, invalidated_at INTEGER, invalidated_by_commit TEXT)",
        "CREATE INDEX development_run_evidence_candidate ON development_run_evidence(run_id, candidate_commit, invalidated_at)",
        "CREATE TABLE development_run_reviews (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, evidence_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, candidate_commit TEXT NOT NULL, disposition TEXT NOT NULL CHECK(disposition IN ('approved', 'changes_requested')), reviewer_identity TEXT NOT NULL, implementer_identity TEXT NOT NULL, source TEXT NOT NULL, observed_at INTEGER NOT NULL, reviewer_attestation TEXT NOT NULL, approval_eligible INTEGER NOT NULL DEFAULT 0 CHECK(approval_eligible = 0), status TEXT NOT NULL CHECK(status IN ('valid', 'invalidated')), invalidated_at INTEGER, invalidated_by_commit TEXT)",
        "CREATE INDEX development_run_reviews_candidate ON development_run_reviews(run_id, candidate_commit, status)",
    ] {
        sqlx::query(statement)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("failed to create development run storage: {error}"))?;
    }
    Ok(())
}

impl Store {
    pub async fn agent_evidence(
        &self,
        run_id: &str,
        owner: &str,
        fence: i64,
        id: &str,
    ) -> Result<Value, String> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(db("begin agent evidence read"))?;
        require_run_authority(&mut tx, run_id, owner, fence).await?;
        let row: Option<EvidenceRow> = sqlx::query_as("SELECT id, run_id, idempotency_key, source, observed_at, candidate_commit, measurement_json, payload_json, invalidated_at, invalidated_by_commit FROM development_run_evidence WHERE id = ? AND run_id = ?")
            .bind(id).bind(run_id).fetch_optional(&mut *tx).await.map_err(db("read scoped evidence"))?;
        let evidence = row.ok_or("unknown evidence in this run")?.into_evidence()?;
        tx.commit()
            .await
            .map_err(db("commit scoped evidence read"))?;
        serde_json::to_value(evidence).map_err(|e| e.to_string())
    }
    /// Task-sized context under the same owner/fence check as evidence writes.
    /// No project-wide listing is exposed to a single-run credential.
    /// `dispatch.role` is the run's W2-04 dispatch role, resolved in the same
    /// snapshot from the assignment locked at the first claim; it cannot
    /// change after the run exists. A role that no longer resolves (out-of-band
    /// drift against the frozen root policy) is reported honestly as
    /// `{"role": null, "unresolved": <reason>}` — the briefing itself stays
    /// available, fail-closed remains the job of each authorization boundary.
    pub async fn agent_run_context(
        &self,
        run_id: &str,
        owner: &str,
        fence: i64,
    ) -> Result<Value, String> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(db("begin agent briefing"))?;
        require_run_authority(&mut tx, run_id, owner, fence).await?;
        let run = run_by_id(&mut tx, run_id)
            .await?
            .ok_or("unknown development run")?;
        let (objective, paths, dependencies, acceptance, goal_objective): (String, String, String, Option<String>, String) = sqlx::query_as("SELECT t.objective, t.owned_paths_json, t.dependencies_json, g.acceptance_criteria, g.objective FROM continuous_tasks t JOIN continuous_goals g ON g.id = t.goal_id WHERE t.id = ?")
            .bind(&run.task_id).fetch_one(&mut *tx).await.map_err(db("read agent briefing"))?;
        let paths: Value =
            serde_json::from_str(&paths).map_err(|e| format!("invalid owned paths: {e}"))?;
        let dependencies: Vec<String> = serde_json::from_str(&dependencies)
            .map_err(|e| format!("invalid dependencies: {e}"))?;
        // A single-run credential may observe only declared prerequisites in its
        // own project. Stored completion is dependency state, not review proof.
        // Read in this transaction so the briefing cannot mix database snapshots.
        let dependency_rows: Vec<(String, Option<String>, Option<i64>)> = sqlx::query_as(
            "SELECT requested.value, dependency.status, dependency.updated_at
             FROM json_each(?) requested
             LEFT JOIN (SELECT t.id, t.status, t.updated_at FROM continuous_tasks t
               JOIN continuous_goals g ON g.id = t.goal_id
               WHERE g.project_id = (SELECT own_goal.project_id FROM continuous_tasks own_task
                 JOIN continuous_goals own_goal ON own_goal.id = own_task.goal_id WHERE own_task.id = ?)) dependency
             ON dependency.id = requested.value ORDER BY CAST(requested.key AS INTEGER) LIMIT 64",
        )
        .bind(serde_json::to_string(&dependencies).map_err(|e| e.to_string())?)
        .bind(&run.task_id).fetch_all(&mut *tx).await.map_err(db("read briefing dependency state"))?;
        let satisfied = dependency_rows.len() == dependencies.len()
            && dependency_rows
                .iter()
                .all(|(_, status, _)| status.as_deref() == Some("completed"));
        let dependency_items: Vec<Value> = dependency_rows.into_iter().map(|(id, status, updated_at)| {
            match status {
                Some(status) => serde_json::json!({"id":id,"state":"recorded","status":status,"updatedAt":updated_at}),
                None => serde_json::json!({"id":id,"state":"unavailable","reason":"dependency unavailable in this project"}),
            }
        }).collect();
        let dependency_state = serde_json::json!({"source":"rust/sqlite","satisfied":satisfied,
            "total":dependencies.len(),"limit":64,"truncated":dependencies.len()>64,"items":dependency_items});
        let evidence: Vec<(String, String, i64, String, Option<i64>)> = sqlx::query_as("SELECT id, source, observed_at, candidate_commit, invalidated_at FROM development_run_evidence WHERE run_id = ? ORDER BY observed_at DESC, id DESC LIMIT 32")
            .bind(run_id).fetch_all(&mut *tx).await.map_err(db("read briefing evidence references"))?;
        let evidence: Vec<Value> = evidence.into_iter().map(|(id, source, observed_at, candidate_commit, invalidated_at)| serde_json::json!({"id":id,"source":source,"observedAt":observed_at,"candidateCommit":candidate_commit,"invalidatedAt":invalidated_at})).collect();
        let (evidence_count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM development_run_evidence WHERE run_id = ?")
                .bind(run_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(db("count briefing evidence"))?;
        let reviews: Vec<DevelopmentReview> = sqlx::query_as("SELECT id, run_id, evidence_id, idempotency_key, candidate_commit, disposition, reviewer_identity, implementer_identity, source, observed_at, reviewer_attestation, approval_eligible, status, invalidated_at, invalidated_by_commit FROM development_run_reviews WHERE run_id = ? ORDER BY observed_at DESC, id DESC LIMIT 16")
            .bind(run_id).fetch_all(&mut *tx).await.map_err(db("read briefing review references"))?;
        let (review_count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM development_run_reviews WHERE run_id = ?")
                .bind(run_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(db("count briefing reviews"))?;
        let candidate: Option<(String, String, i64)> = sqlx::query_as("SELECT candidate_commit, source, observed_at FROM development_run_candidates WHERE run_id = ?")
            .bind(run_id).fetch_optional(&mut *tx).await.map_err(db("read agent candidate"))?;
        let candidate = candidate.map(|(commit, source, observed_at)| serde_json::json!({"candidateCommit": commit, "source": source, "observedAt": observed_at}));
        let launch: Option<super::development_launches::DevelopmentLaunch> =
            sqlx::query_as("SELECT * FROM development_launches WHERE run_id = ?")
                .bind(run_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db("read agent launch identity"))?;
        let execution_identity = super::development_identity::for_run(&mut tx, run_id).await?;
        let delivery: Option<super::development_delivery::DevelopmentDelivery> =
            sqlx::query_as("SELECT * FROM development_deliveries WHERE run_id=?")
                .bind(run_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db("read delivery intent"))?;
        // DF-15b / KI-27: the raw row stays as recorded (the intent began,
        // the transport never confirmed an enqueue); the release after a
        // proven undelivered exit is derived here, not rewritten.
        let delivery = delivery
            .map(|delivery| {
                let mut value = serde_json::to_value(&delivery)
                    .map_err(|error| format!("project delivery intent: {error}"))?;
                if launch
                    .as_ref()
                    .is_some_and(|launch| launch.state == "exited_undelivered")
                {
                    value["effectiveState"] = "released_undelivered".into();
                }
                Ok::<serde_json::Value, String>(value)
            })
            .transpose()?;
        let checkpoint = checkpoints::latest(&mut tx, &run.task_id).await?;
        let assignment = super::team_assignments::read(&mut tx, &run.task_id).await?;
        let dispatch = match super::development_launches::run_role(&mut tx, run_id).await {
            Ok(role) => serde_json::json!({"role": role}),
            Err(error) => serde_json::json!({"role": null, "unresolved": error}),
        };
        let tokens = super::development_budget::balance(&mut tx, &run.root_goal_id).await?;
        let repo: Option<(String,)> = sqlx::query_as("SELECT p.repo_path FROM projects p JOIN continuous_goals g ON g.project_id=p.id JOIN continuous_tasks t ON t.goal_id=g.id WHERE t.id=?")
            .bind(&run.task_id).fetch_optional(&mut *tx).await.map_err(db("read guidance project"))?;
        tx.commit().await.map_err(db("commit agent briefing"))?;
        let query = objective.clone();
        let owned_paths = paths.clone();
        let guidance = tokio::task::spawn_blocking(move || {
            guidance::collect(repo.map(|(path,)| path), query, owned_paths)
        })
        .await
        .map_err(|error| format!("read project guidance: {error}"))?;
        let mut authority = self
            .pool
            .begin()
            .await
            .map_err(db("recheck briefing authority"))?;
        require_run_authority(&mut authority, run_id, owner, fence).await?;
        authority
            .commit()
            .await
            .map_err(db("finish briefing authority check"))?;
        Ok(
            serde_json::json!({"apiVersion":1,"source":"rust/sqlite","sourceTimestamp":now_unix_secs(),"run":run,"launch":launch,"dispatch":dispatch,"executionIdentity":execution_identity,"delivery":delivery,"checkpoint":checkpoint,"tokens":tokens,"guidance":guidance,"task":{"assignment":assignment,"objective":objective,"ownedPaths":paths,"dependencies":dependencies,"dependencyState":dependency_state,"acceptanceCriteria":acceptance,"goalObjective":goal_objective},"candidate":candidate,"evidence":evidence,"evidenceTotal":evidence_count,"evidenceLimit":32,"reviews":reviews,"reviewTotal":review_count,"reviewLimit":16,"approvalAuthority":approval_authority(),"executionEnabled":false}),
        )
    }
    /// Atomically preserve the currently claimed task's owner/fence and its
    /// immutable root policy. The returned existing row makes a retry of the
    /// same launch intent idempotent; it never creates another run for this
    /// attempt, even after a stale lease.
    pub async fn record_development_run_intent(
        &self,
        task_id: &str,
        owner: &str,
        fence: i64,
    ) -> Result<DevelopmentRun, String> {
        let task_id = required(task_id, "taskId")?;
        let owner = required(owner, "owner")?;
        if fence < 1 {
            return Err("fence must be positive".to_string());
        }
        let now = now_unix_secs();
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(db("begin development run intent"))?;
        let current: Option<(String,)> = sqlx::query_as(
            "SELECT g.root_goal_id FROM continuous_tasks t JOIN continuous_goals g ON g.id = t.goal_id WHERE t.id = ?1 AND t.status = 'running' AND t.claim_owner = ?2 AND t.claim_fence = ?3",
        )
        .bind(&task_id)
        .bind(&owner)
        .bind(fence)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db("read live task claim for run intent"))?;
        let Some((root_goal_id,)) = current else {
            return Err(format!(
                "stale or unauthorized continuous claim fence for task: {task_id}"
            ));
        };

        if let Some(row) = run_for_task_fence(&mut tx, &task_id, fence).await? {
            tx.commit()
                .await
                .map_err(db("commit existing development run intent"))?;
            return Ok(row);
        }
        let (policy_json,): (String,) = sqlx::query_as(
            "SELECT policy_json FROM continuous_root_policies WHERE root_goal_id = ?1",
        )
        .bind(&root_goal_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db("read root policy for run intent"))?
        .ok_or_else(|| format!("continuous root has no immutable policy: {root_goal_id}"))?;
        crate::development_policy::parse(&policy_json)
            .map_err(|error| format!("immutable root policy is corrupt: {error}"))?;
        let id = new_id("dr");
        sqlx::query("INSERT INTO development_runs(id, task_id, root_goal_id, claim_owner, claim_fence, policy_json, status, intent_at, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?8)")
            .bind(&id).bind(&task_id).bind(&root_goal_id).bind(&owner).bind(fence).bind(&policy_json).bind(RUN_INTENT).bind(now)
            .execute(&mut *tx).await.map_err(db("write development run intent"))?;
        let row = run_by_id(&mut tx, &id)
            .await?
            .ok_or_else(|| "created development run disappeared".to_string())?;
        tx.commit()
            .await
            .map_err(db("commit development run intent"))?;
        Ok(row)
    }

    /// Store launch facts only after an already-recorded intent. The current
    /// owner/fence condition is part of the write, so a stale run cannot turn
    /// into a new process launch authorization.
    pub async fn mark_development_run_launched(
        &self,
        run_id: &str,
        owner: &str,
        fence: i64,
        worker_id: Option<&str>,
        process_id: Option<i64>,
    ) -> Result<DevelopmentRun, String> {
        let run_id = required(run_id, "runId")?;
        let owner = required(owner, "owner")?;
        if fence < 1 || process_id.is_some_and(|pid| pid < 1) {
            return Err("fence and processId must be positive".to_string());
        }
        let worker_id = worker_id
            .map(|value| required(value, "workerId"))
            .transpose()?;
        if worker_id.is_none() && process_id.is_none() {
            return Err("launch must record a workerId or processId".to_string());
        }
        let now = now_unix_secs();
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(db("begin mark run launched"))?;
        let reserved: Option<(String, String)> =
            sqlx::query_as("SELECT worker_id, state FROM development_launches WHERE run_id = ?")
                .bind(&run_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db("check reserved launch identity"))?;
        if let Some((reserved_worker, state)) = reserved {
            if worker_id.as_deref() != Some(reserved_worker.as_str()) || state != "spawning" {
                return Err("development run launch does not match consumed reservation".into());
            }
        }
        let changed = sqlx::query("UPDATE development_runs SET status = ?1, worker_id = ?2, process_id = ?3, launched_at = ?4, updated_at = ?4 WHERE id = ?5 AND claim_owner = ?6 AND claim_fence = ?7 AND status = ?8 AND EXISTS (SELECT 1 FROM continuous_tasks t WHERE t.id = development_runs.task_id AND t.status = 'running' AND t.claim_owner = ?6 AND t.claim_fence = ?7)")
            .bind(RUN_LAUNCHED).bind(worker_id).bind(process_id).bind(now).bind(&run_id).bind(&owner).bind(fence).bind(RUN_INTENT)
            .execute(&mut *tx).await.map_err(db("mark development run launched"))?;
        if changed.rows_affected() != 1 {
            return Err(format!(
                "development run launch is stale, unauthorized, or not intent: {run_id}"
            ));
        }
        let row = run_by_id(&mut tx, &run_id)
            .await?
            .ok_or_else(|| "launched development run disappeared".to_string())?;
        tx.commit()
            .await
            .map_err(db("commit launched development run"))?;
        Ok(row)
    }

    /// Reconciliation records uncertainty after a crash; it cannot launch or
    /// duplicate a process and therefore intentionally does not trust a lease.
    pub async fn mark_development_run_reconciling(
        &self,
        run_id: &str,
        owner: &str,
        fence: i64,
    ) -> Result<DevelopmentRun, String> {
        transition_run(
            self,
            run_id,
            owner,
            fence,
            &[RUN_INTENT, RUN_LAUNCHED],
            RUN_RECONCILING,
            None,
        )
        .await
    }

    pub async fn complete_development_run(
        &self,
        run_id: &str,
        owner: &str,
        fence: i64,
        detail: Option<&str>,
    ) -> Result<DevelopmentRun, String> {
        transition_run(
            self,
            run_id,
            owner,
            fence,
            &[RUN_LAUNCHED, RUN_RECONCILING],
            RUN_COMPLETED,
            detail,
        )
        .await
    }

    pub async fn fail_development_run(
        &self,
        run_id: &str,
        owner: &str,
        fence: i64,
        detail: &str,
    ) -> Result<DevelopmentRun, String> {
        let detail = required(detail, "failure detail")?;
        transition_run(
            self,
            run_id,
            owner,
            fence,
            &[RUN_INTENT, RUN_LAUNCHED, RUN_RECONCILING],
            RUN_FAILED,
            Some(&detail),
        )
        .await
    }

    pub async fn get_development_run(
        &self,
        run_id: &str,
    ) -> Result<Option<DevelopmentRun>, String> {
        sqlx::query_as("SELECT id, task_id, root_goal_id, claim_owner, claim_fence, policy_json, status, worker_id, process_id, intent_at, launched_at, reconciled_at, terminal_at, terminal_detail, created_at, updated_at FROM development_runs WHERE id = ?1")
            .bind(run_id).fetch_optional(&self.pool).await.map_err(db("read development run"))
    }

    pub async fn list_development_runs(
        &self,
        project_id: &str,
    ) -> Result<Vec<DevelopmentRun>, String> {
        sqlx::query_as("SELECT r.id, r.task_id, r.root_goal_id, r.claim_owner, r.claim_fence, r.policy_json, r.status, r.worker_id, r.process_id, r.intent_at, r.launched_at, r.reconciled_at, r.terminal_at, r.terminal_detail, r.created_at, r.updated_at FROM development_runs r JOIN continuous_tasks t ON t.id = r.task_id JOIN continuous_goals g ON g.id = t.goal_id WHERE g.project_id = ?1 ORDER BY r.created_at, r.id")
            .bind(project_id).fetch_all(&self.pool).await.map_err(db("list development runs"))
    }

    pub async fn list_development_evidence(
        &self,
        run_id: &str,
    ) -> Result<Vec<DevelopmentEvidence>, String> {
        let rows: Vec<EvidenceRow> = sqlx::query_as("SELECT id, run_id, idempotency_key, source, observed_at, candidate_commit, measurement_json, payload_json, invalidated_at, invalidated_by_commit FROM development_run_evidence WHERE run_id = ?1 ORDER BY observed_at, id")
            .bind(run_id).fetch_all(&self.pool).await.map_err(db("list development evidence"))?;
        rows.into_iter().map(EvidenceRow::into_evidence).collect()
    }

    pub async fn list_development_reviews(
        &self,
        run_id: &str,
    ) -> Result<Vec<DevelopmentReview>, String> {
        sqlx::query_as("SELECT id, run_id, evidence_id, idempotency_key, candidate_commit, disposition, reviewer_identity, implementer_identity, source, observed_at, reviewer_attestation, approval_eligible, status, invalidated_at, invalidated_by_commit FROM development_run_reviews WHERE run_id = ?1 ORDER BY observed_at, id")
            .bind(run_id).fetch_all(&self.pool).await.map_err(db("list development reviews"))
    }

    /// A coherent read model for HQ and `pa`. Every table is read from one
    /// SQLite transaction so a candidate rebind cannot expose a run after its
    /// old evidence but before the matching invalidation record.
    pub async fn development_records_snapshot(&self, project_id: &str) -> Result<Value, String> {
        let source_timestamp = now_unix_secs();
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(db("begin development records snapshot"))?;
        let runs: Vec<DevelopmentRun> = sqlx::query_as("SELECT r.id, r.task_id, r.root_goal_id, r.claim_owner, r.claim_fence, r.policy_json, r.status, r.worker_id, r.process_id, r.intent_at, r.launched_at, r.reconciled_at, r.terminal_at, r.terminal_detail, r.created_at, r.updated_at FROM development_runs r JOIN continuous_tasks t ON t.id = r.task_id JOIN continuous_goals g ON g.id = t.goal_id WHERE g.project_id = ?1 ORDER BY r.created_at, r.id")
            .bind(project_id).fetch_all(&mut *tx).await.map_err(db("snapshot development runs"))?;
        let mut records = Vec::with_capacity(runs.len());
        for run in runs {
            let candidate: Option<(String, String, String, i64)> = sqlx::query_as("SELECT run_id, candidate_commit, source, observed_at FROM development_run_candidates WHERE run_id = ?")
                .bind(&run.id).fetch_optional(&mut *tx).await.map_err(db("snapshot candidate binding"))?;
            let candidate = candidate.map(|(run_id, candidate_commit, source, observed_at)| serde_json::json!({"runId": run_id, "candidateCommit": candidate_commit, "source": source, "observedAt": observed_at}));
            let evidence = evidence_for_run(&mut tx, &run.id).await?;
            let reviews = reviews_for_run(&mut tx, &run.id).await?;
            let launch: Option<super::development_launches::DevelopmentLaunch> =
                sqlx::query_as("SELECT * FROM development_launches WHERE run_id = ?")
                    .bind(&run.id)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(db("snapshot launch identity"))?;
            let execution_identity = super::development_identity::for_run(&mut tx, &run.id).await?;
            let checkpoint = checkpoints::latest(&mut tx, &run.task_id).await?;
            // Keep the run read model honest about the root-wide token
            // budget. This is a ledger balance, not inferred provider usage;
            // unknown receipts remain represented by `usageState`.
            let tokens = super::development_budget::balance(&mut tx, &run.root_goal_id).await?;
            // The run's own cost receipt: a value with provenance, or a
            // named reason why none exists (W2-03).
            let usage = super::development_budget::usage_receipt::for_run(
                &mut tx,
                &run.id,
                launch.as_ref(),
            )
            .await?;
            records.push(serde_json::json!({
                "run": run,
                "taskCheckpoint": checkpoint,
                "launch": launch,
                "executionIdentity": execution_identity,
                "tokens": tokens,
                "usage": usage,
                "candidate": candidate,
                "evidence": evidence,
                "reviews": reviews,
            }));
        }
        tx.commit()
            .await
            .map_err(db("commit development records snapshot"))?;
        Ok(serde_json::json!({
            "apiVersion": 1,
            "approvalAuthority": approval_authority(),
            "executionEnabled": false,
            "sourceTimestamp": source_timestamp,
            "runs": records,
        }))
    }

    /// Bind the candidate before accepting evidence. Rebinding a different
    /// commit invalidates every older candidate-bound record in the same
    /// transaction; callers cannot defer invalidation to a best-effort step.
    /// The candidate is named by its full commit ID, and an observation older
    /// than the bound one cannot rebind (see `bind_candidate`).
    pub async fn bind_development_run_candidate(
        &self,
        run_id: &str,
        owner: &str,
        fence: i64,
        candidate_commit: &str,
        source: &str,
        observed_at: i64,
    ) -> Result<CandidateBinding, String> {
        let run_id = required(run_id, "runId")?;
        let owner = required(owner, "owner")?;
        let candidate_commit = required(candidate_commit, "candidateCommit")?;
        let source = required(source, "source")?;
        if fence < 1 {
            return Err("fence must be positive".to_string());
        }
        validate_observed_at(observed_at)?;
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(db("begin candidate binding"))?;
        require_active_run_authority(&mut tx, &run_id, &owner, fence).await?;
        let invalidated_records =
            bind_candidate(&mut tx, &run_id, &candidate_commit, &source, observed_at).await?;
        let (candidate_commit, source, observed_at): (String, String, i64) =
            sqlx::query_as("SELECT candidate_commit, source, observed_at FROM development_run_candidates WHERE run_id = ?")
                .bind(&run_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(db("read persisted candidate binding"))?;
        tx.commit().await.map_err(db("commit candidate binding"))?;
        Ok(CandidateBinding {
            run_id,
            candidate_commit,
            source,
            observed_at,
            invalidated_records,
        })
    }

    pub async fn record_development_evidence(
        &self,
        run_id: &str,
        owner: &str,
        fence: i64,
        input: EvidenceInput,
    ) -> Result<DevelopmentEvidence, String> {
        let run_id = required(run_id, "runId")?;
        let owner = required(owner, "owner")?;
        if fence < 1 {
            return Err("fence must be positive".to_string());
        }
        validate_evidence(&input)?;
        let payload_json = serde_json::to_string(&input.payload)
            .map_err(|error| format!("encode evidence payload: {error}"))?;
        let measurement_json = serde_json::to_string(&input.measurement)
            .map_err(|error| format!("encode evidence measurement: {error}"))?;
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(db("begin development evidence"))?;
        require_active_run_authority(&mut tx, &run_id, &owner, fence).await?;
        require_bound_candidate(&mut tx, &run_id, &input.candidate_commit).await?;
        let id = new_id("dre");
        sqlx::query("INSERT OR IGNORE INTO development_run_evidence(id, run_id, idempotency_key, source, observed_at, candidate_commit, measurement_json, payload_json) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
            .bind(&id).bind(&run_id).bind(&input.idempotency_key).bind(&input.source).bind(input.observed_at).bind(&input.candidate_commit).bind(&measurement_json).bind(&payload_json)
            .execute(&mut *tx).await.map_err(db("write development evidence"))?;
        let stored = evidence_by_key(&mut tx, &input.idempotency_key)
            .await?
            .ok_or_else(|| "development evidence idempotency row disappeared".to_string())?;
        if stored.run_id != run_id
            || stored.source != input.source
            || stored.observed_at != input.observed_at
            || stored.candidate_commit != input.candidate_commit
            || stored.measurement_json != measurement_json
            || stored.payload_json != payload_json
        {
            return Err(
                "development evidence idempotency key was reused with a different payload"
                    .to_string(),
            );
        }
        let evidence = stored.into_evidence()?;
        tx.commit()
            .await
            .map_err(db("commit development evidence"))?;
        Ok(evidence)
    }

    /// `reviewer_run`, `owner` and `fence` authenticate the reviewer's own run;
    /// the reviewed run is the one owning `input.evidence_id`. Both principals
    /// are read from the store, never from the caller (see `RunPrincipal`).
    /// A replay with the same idempotency key re-derives principal, role and
    /// attestation first, so it fails closed like a new review when the store
    /// no longer authorizes the reviewer; a retry is not a lookup.
    pub async fn record_development_review(
        &self,
        reviewer_run: &str,
        owner: &str,
        fence: i64,
        input: ReviewInput,
    ) -> Result<DevelopmentReview, String> {
        let reviewer_run = required(reviewer_run, "reviewerRunId")?;
        let owner = required(owner, "owner")?;
        if fence < 1 {
            return Err("fence must be positive".to_string());
        }
        validate_review(&input)?;
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(db("begin development review"))?;
        require_run_authority(&mut tx, &reviewer_run, &owner, fence).await?;
        let evidence: EvidenceRow = sqlx::query_as("SELECT id, run_id, idempotency_key, source, observed_at, candidate_commit, measurement_json, payload_json, invalidated_at, invalidated_by_commit FROM development_run_evidence WHERE id = ?1")
            .bind(&input.evidence_id).fetch_optional(&mut *tx).await.map_err(db("read review evidence"))?
            .ok_or_else(|| "review evidence does not exist".to_string())?;
        let run_id = evidence.run_id.clone();
        if run_id == reviewer_run {
            return Err(
                "reviewer must be independent from the implementer: a run cannot review its own candidate"
                    .to_string(),
            );
        }
        require_bound_candidate(&mut tx, &run_id, &input.candidate_commit).await?;
        if evidence.candidate_commit != input.candidate_commit || evidence.invalidated_at.is_some()
        {
            return Err(
                "review evidence is not valid for the reviewed run and candidate".to_string(),
            );
        }
        let reviewer = RunPrincipal::read(&mut tx, &reviewer_run).await?;
        let implementer = RunPrincipal::read(&mut tx, &run_id).await?;
        if reviewer.project_id != implementer.project_id {
            return Err("reviewer run belongs to another project".to_string());
        }
        // W2-04b: a role the store cannot resolve (unknown, malformed, not
        // the run owner's, not permitted by the frozen root policy)
        // authorizes no review at all.
        let reviewer_role = run_role(&mut tx, &reviewer_run).await?;
        let attestation = attest_reviewer(&reviewer, &implementer, reviewer_role)?;
        let id = new_id("drr");
        sqlx::query("INSERT OR IGNORE INTO development_run_reviews(id, run_id, evidence_id, idempotency_key, candidate_commit, disposition, reviewer_identity, implementer_identity, source, observed_at, reviewer_attestation, approval_eligible, status) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, ?12)")
            .bind(&id).bind(&run_id).bind(&input.evidence_id).bind(&input.idempotency_key).bind(&input.candidate_commit).bind(input.disposition.as_str()).bind(reviewer.label()).bind(implementer.label()).bind(&input.source).bind(input.observed_at).bind(&attestation).bind(VALID_REVIEW)
            .execute(&mut *tx).await.map_err(db("write development review"))?;
        let review: DevelopmentReview = sqlx::query_as("SELECT id, run_id, evidence_id, idempotency_key, candidate_commit, disposition, reviewer_identity, implementer_identity, source, observed_at, reviewer_attestation, approval_eligible, status, invalidated_at, invalidated_by_commit FROM development_run_reviews WHERE idempotency_key = ?1")
            .bind(&input.idempotency_key).fetch_one(&mut *tx).await.map_err(db("read stored development review"))?;
        if review.run_id != run_id
            || review.evidence_id != input.evidence_id
            || review.candidate_commit != input.candidate_commit
            || review.disposition != input.disposition.as_str()
            || review.reviewer_identity != reviewer.label()
            || review.implementer_identity != implementer.label()
            || review.source != input.source
            || review.observed_at != input.observed_at
        {
            return Err(
                "development review idempotency key was reused with a different payload"
                    .to_string(),
            );
        }
        // A replay returns the stored verdict only while the store still
        // derives the same attestation; a row written under an older rule is
        // not handed back as if it were current.
        if review.reviewer_attestation != attestation {
            return Err(format!(
                "stored review attestation is stale: recorded \"{}\", the store now derives \"{attestation}\"",
                review.reviewer_attestation
            ));
        }
        tx.commit().await.map_err(db("commit development review"))?;
        Ok(review)
    }

    /// Invalidate all candidate-bound evidence and review dispositions that
    /// belong to an older candidate. The caller supplies the newly observed
    /// candidate commit; this method does not claim to observe Git itself.
    /// The same rules as for binding apply: a full commit ID, and `observed_at`
    /// is the caller's own observation time (not the time of an upstream
    /// event). A "stale candidate observation" error means a newer candidate
    /// is already bound; a caller catching up on old events treats it as
    /// superseded, not as a failure to retry.
    pub async fn invalidate_development_run_evidence_for_candidate(
        &self,
        run_id: &str,
        owner: &str,
        fence: i64,
        current_candidate_commit: &str,
        source: &str,
        observed_at: i64,
    ) -> Result<u64, String> {
        let run_id = required(run_id, "runId")?;
        let owner = required(owner, "owner")?;
        let source = required(source, "source")?;
        if fence < 1 {
            return Err("fence must be positive".to_string());
        }
        let current_candidate_commit = required(current_candidate_commit, "candidateCommit")?;
        validate_observed_at(observed_at)?;
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(db("begin candidate invalidation"))?;
        require_run_authority(&mut tx, &run_id, &owner, fence).await?;
        let invalidated = bind_candidate(
            &mut tx,
            &run_id,
            &current_candidate_commit,
            &source,
            observed_at,
        )
        .await?;
        tx.commit()
            .await
            .map_err(db("commit candidate invalidation"))?;
        Ok(invalidated)
    }
}

async fn transition_run(
    store: &Store,
    run_id: &str,
    owner: &str,
    fence: i64,
    from: &[&str],
    to: &str,
    detail: Option<&str>,
) -> Result<DevelopmentRun, String> {
    let run_id = required(run_id, "runId")?;
    let owner = required(owner, "owner")?;
    if fence < 1 {
        return Err("fence must be positive".to_string());
    }
    let detail = detail.map(|value| required(value, "detail")).transpose()?;
    let now = now_unix_secs();
    let mut tx = store
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(db("begin development run transition"))?;
    let status = run_by_id(&mut tx, &run_id)
        .await?
        .ok_or_else(|| format!("unknown development run: {run_id}"))?
        .status;
    require_run_authority(&mut tx, &run_id, &owner, fence).await?;
    if !from.contains(&status.as_str()) {
        return Err(format!(
            "development run cannot transition from {status} to {to}"
        ));
    }
    let changed = if to == RUN_RECONCILING {
        sqlx::query("UPDATE development_runs SET status = ?1, reconciled_at = ?2, updated_at = ?2 WHERE id = ?3 AND claim_owner = ?4 AND claim_fence = ?5 AND status = ?6")
            .bind(to).bind(now).bind(&run_id).bind(&owner).bind(fence).bind(&status).execute(&mut *tx).await.map_err(db("mark development run reconciling"))?
    } else {
        sqlx::query("UPDATE development_runs SET status = ?1, terminal_at = ?2, terminal_detail = ?3, updated_at = ?2 WHERE id = ?4 AND claim_owner = ?5 AND claim_fence = ?6 AND status = ?7")
            .bind(to).bind(now).bind(detail).bind(&run_id).bind(&owner).bind(fence).bind(&status).execute(&mut *tx).await.map_err(db("finish development run"))?
    };
    if changed.rows_affected() != 1 {
        return Err(format!(
            "development run transition lost ownership race: {run_id}"
        ));
    }
    let row = run_by_id(&mut tx, &run_id)
        .await?
        .ok_or_else(|| "transitioned development run disappeared".to_string())?;
    tx.commit()
        .await
        .map_err(db("commit development run transition"))?;
    Ok(row)
}

async fn run_by_id(
    tx: &mut Transaction<'_, Sqlite>,
    id: &str,
) -> Result<Option<DevelopmentRun>, String> {
    sqlx::query_as("SELECT id, task_id, root_goal_id, claim_owner, claim_fence, policy_json, status, worker_id, process_id, intent_at, launched_at, reconciled_at, terminal_at, terminal_detail, created_at, updated_at FROM development_runs WHERE id = ?1")
        .bind(id).fetch_optional(&mut **tx).await.map_err(db("read development run"))
}

async fn run_for_task_fence(
    tx: &mut Transaction<'_, Sqlite>,
    task_id: &str,
    fence: i64,
) -> Result<Option<DevelopmentRun>, String> {
    sqlx::query_as("SELECT id, task_id, root_goal_id, claim_owner, claim_fence, policy_json, status, worker_id, process_id, intent_at, launched_at, reconciled_at, terminal_at, terminal_detail, created_at, updated_at FROM development_runs WHERE task_id = ?1 AND claim_fence = ?2")
        .bind(task_id).bind(fence).fetch_optional(&mut **tx).await.map_err(db("read task development run"))
}

async fn require_run_authority(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
    owner: &str,
    fence: i64,
) -> Result<(), String> {
    let exists: Option<(String,)> = sqlx::query_as(
        "SELECT r.id FROM development_runs r JOIN continuous_tasks t ON t.id = r.task_id WHERE r.id = ?1 AND r.claim_owner = ?2 AND r.claim_fence = ?3 AND t.claim_owner = ?2 AND t.claim_fence = ?3",
    )
    .bind(run_id)
    .bind(owner)
    .bind(fence)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db("read development run authority"))?;
    exists
        .map(|_| ())
        .ok_or_else(|| format!("unknown or unauthorized development run: {run_id}"))
}

async fn require_active_run_authority(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
    owner: &str,
    fence: i64,
) -> Result<(), String> {
    require_run_authority(tx, run_id, owner, fence).await?;
    let (active,): (bool,) = sqlx::query_as(
        "SELECT status IN ('intent', 'launched', 'reconciling') FROM development_runs WHERE id = ?",
    )
    .bind(run_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(db("check active run write authority"))?;
    if !active {
        return Err(
            "development run is not active; candidate and evidence writes are closed".into(),
        );
    }
    Ok(())
}

async fn evidence_by_key(
    tx: &mut Transaction<'_, Sqlite>,
    key: &str,
) -> Result<Option<EvidenceRow>, String> {
    sqlx::query_as("SELECT id, run_id, idempotency_key, source, observed_at, candidate_commit, measurement_json, payload_json, invalidated_at, invalidated_by_commit FROM development_run_evidence WHERE idempotency_key = ?1")
        .bind(key).fetch_optional(&mut **tx).await.map_err(db("read development evidence"))
}

async fn evidence_for_run(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
) -> Result<Vec<DevelopmentEvidence>, String> {
    let rows: Vec<EvidenceRow> = sqlx::query_as("SELECT id, run_id, idempotency_key, source, observed_at, candidate_commit, measurement_json, payload_json, invalidated_at, invalidated_by_commit FROM development_run_evidence WHERE run_id = ?1 ORDER BY observed_at, id")
        .bind(run_id).fetch_all(&mut **tx).await.map_err(db("snapshot development evidence"))?;
    rows.into_iter().map(EvidenceRow::into_evidence).collect()
}

async fn reviews_for_run(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
) -> Result<Vec<DevelopmentReview>, String> {
    sqlx::query_as("SELECT id, run_id, evidence_id, idempotency_key, candidate_commit, disposition, reviewer_identity, implementer_identity, source, observed_at, reviewer_attestation, approval_eligible, status, invalidated_at, invalidated_by_commit FROM development_run_reviews WHERE run_id = ?1 ORDER BY observed_at, id")
        .bind(run_id).fetch_all(&mut **tx).await.map_err(db("snapshot development reviews"))
}

async fn require_bound_candidate(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
    candidate_commit: &str,
) -> Result<(), String> {
    let bound: Option<(String,)> =
        sqlx::query_as("SELECT candidate_commit FROM development_run_candidates WHERE run_id = ?1")
            .bind(run_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(db("read bound candidate"))?;
    match bound {
        Some((bound,)) if bound == candidate_commit => Ok(()),
        Some(_) => Err("evidence candidate does not match the bound current candidate".to_string()),
        None => Err("candidate must be bound before accepting evidence".to_string()),
    }
}

async fn bind_candidate(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
    candidate_commit: &str,
    source: &str,
    observed_at: i64,
) -> Result<u64, String> {
    // W2-04b: the dispatch role decides inside the write transaction, for
    // both entry points (worker and integration path). Reviewers and
    // coordinators never own a candidate; an unresolvable role fails closed.
    let role = run_role(tx, run_id).await?;
    if !role.submits_candidate() {
        return Err(format!(
            "candidate refused: a {} run does not submit integration candidates",
            role.as_str()
        ));
    }
    require_full_commit_id(candidate_commit)?;
    let bound: Option<(String, i64)> = sqlx::query_as(
        "SELECT candidate_commit, observed_at FROM development_run_candidates WHERE run_id = ?1",
    )
    .bind(run_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db("read candidate binding"))?;
    match bound {
        None => {
            sqlx::query("INSERT INTO development_run_candidates(run_id, candidate_commit, source, observed_at) VALUES(?1, ?2, ?3, ?4)")
                .bind(run_id).bind(candidate_commit).bind(source).bind(observed_at).execute(&mut **tx).await.map_err(db("write candidate binding"))?;
            Ok(0)
        }
        // A replay keeps the first observation's provenance, including its
        // time; the staleness bound below is that first observation.
        Some((bound, _)) if bound == candidate_commit => Ok(0),
        // An older observation of another commit must not move the binding
        // back to a candidate that was already replaced. Times are seconds:
        // within the same second the order is unknown and the later writer
        // wins, so a fast amend is not refused.
        Some((_, bound_at)) if observed_at < bound_at => Err(format!(
            "stale candidate observation: observedAt {observed_at} is older than the bound candidate ({bound_at})"
        )),
        Some(_) => {
            sqlx::query("UPDATE development_run_candidates SET candidate_commit = ?1, source = ?2, observed_at = ?3 WHERE run_id = ?4")
                .bind(candidate_commit).bind(source).bind(observed_at).bind(run_id).execute(&mut **tx).await.map_err(db("update candidate binding"))?;
            let evidence = sqlx::query("UPDATE development_run_evidence SET invalidated_at = ?1, invalidated_by_commit = ?2 WHERE run_id = ?3 AND invalidated_at IS NULL AND candidate_commit <> ?2")
                .bind(observed_at).bind(candidate_commit).bind(run_id).execute(&mut **tx).await.map_err(db("invalidate candidate evidence"))?;
            let reviews = sqlx::query("UPDATE development_run_reviews SET status = ?1, invalidated_at = ?2, invalidated_by_commit = ?3 WHERE run_id = ?4 AND status = ?5 AND candidate_commit <> ?3")
                .bind(INVALIDATED_REVIEW).bind(observed_at).bind(candidate_commit).bind(run_id).bind(VALID_REVIEW).execute(&mut **tx).await.map_err(db("invalidate candidate reviews"))?;
            Ok(evidence.rows_affected() + reviews.rows_affected())
        }
    }
}

/// The one statement of approval authority (W2-01) for every view: the
/// project snapshot, a run's briefing and its release view. Fail-closed:
/// reviewer principals come from launch route receipts, but no review can
/// approve until W5-02d signs verdicts, so the state is always "unavailable".
pub(crate) fn approval_authority() -> Value {
    serde_json::json!({
        "state": "unavailable",
        "detail": "reviewer principals come from launch route receipts; approval needs signed verdicts, which are not implemented",
        "reviewerPrincipal": "launch-route-receipt",
    })
}

fn required(value: &str, field: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        Err(format!("{field} is required"))
    } else {
        Ok(value.to_string())
    }
}

/// Evidence and reviews are bound to the candidate by string equality, so the
/// candidate must be named by its immutable object ID. A ref (`HEAD`), an
/// abbreviation or another spelling could name changed code without a
/// rebind, which would keep old dispositions valid. Git prints object IDs in
/// lower case: SHA-1 has 40 digits, SHA-256 has 64.
fn require_full_commit_id(commit: &str) -> Result<(), String> {
    if matches!(commit.len(), 40 | 64)
        && commit
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Ok(())
    } else {
        Err("candidateCommit must be a full Git commit ID in lower case".to_string())
    }
}

fn validate_evidence(input: &EvidenceInput) -> Result<(), String> {
    required(&input.idempotency_key, "idempotencyKey")?;
    required(&input.source, "source")?;
    required(&input.candidate_commit, "candidateCommit")?;
    validate_observed_at(input.observed_at)?;
    match &input.measurement {
        EvidenceMeasurement::Measured { value } if value.is_null() => Err(
            "measured evidence cannot use a null value; record unavailable explicitly".to_string(),
        ),
        EvidenceMeasurement::Measured { .. } => Ok(()),
        EvidenceMeasurement::Unavailable { reason } => {
            required(reason, "measurement reason").map(|_| ())
        }
    }
}

fn validate_review(input: &ReviewInput) -> Result<(), String> {
    required(&input.idempotency_key, "idempotencyKey")?;
    required(&input.evidence_id, "evidenceId")?;
    required(&input.candidate_commit, "candidateCommit")?;
    required(&input.source, "source")?;
    validate_observed_at(input.observed_at)?;
    Ok(())
}

/// Providers bound to exactly one model vendor. `opencode` and `ollama` route
/// to several vendors, so their name proves neither sameness nor difference.
const SINGLE_VENDOR_PROVIDERS: [&str; 3] = ["claude", "codex", "kimi"];

/// Who acted in a run, as the store observed it. The provider is read from
/// the route receipt that only the trusted launch service writes
/// (`bind_development_launch_route`); an agent holding a run credential
/// cannot set it. A later signed verdict (W5-02d) signs this label.
struct RunPrincipal {
    run_id: String,
    project_id: String,
    worker_id: Option<String>,
    provider: Option<String>,
}

impl RunPrincipal {
    async fn read(tx: &mut Transaction<'_, Sqlite>, run_id: &str) -> Result<Self, String> {
        let (project_id, worker_id, provider): (String, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT g.project_id, l.worker_id, CASE WHEN json_valid(l.route_json) THEN (CASE WHEN json_type(l.route_json, '$.selection.resolved.provider') = 'text' THEN json_extract(l.route_json, '$.selection.resolved.provider') END) END
             FROM development_runs r JOIN continuous_tasks t ON t.id = r.task_id JOIN continuous_goals g ON g.id = t.goal_id
             LEFT JOIN development_launches l ON l.run_id = r.id WHERE r.id = ?",
        )
        .bind(run_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(db("read review principal"))?;
        Ok(Self {
            run_id: run_id.to_string(),
            project_id,
            worker_id,
            provider,
        })
    }

    fn label(&self) -> String {
        format!(
            "run={} worker={} provider={}",
            self.run_id,
            self.worker_id.as_deref().unwrap_or("unlaunched"),
            self.provider.as_deref().unwrap_or("unavailable")
        )
    }
}

/// Refuse a provably dependent reviewer; label an unprovable one honestly.
/// `verified` means different model vendors, not different operators: one
/// launch service starts every run. A same-vendor reviewer is refused for
/// `changes_requested` too, so no same-vendor verdict enters the record.
/// `verified` also requires the reviewer run to be dispatched in the
/// `reviewer` role (W2-04b); another role is recorded, but unverified.
fn attest_reviewer(
    reviewer: &RunPrincipal,
    implementer: &RunPrincipal,
    reviewer_role: DispatchRole,
) -> Result<String, String> {
    let (Some(r), Some(i)) = (
        reviewer.provider.as_deref(),
        implementer.provider.as_deref(),
    ) else {
        return Ok(
            "unverified: provider unavailable without a launch route receipt for both runs"
                .to_string(),
        );
    };
    let single = |p: &str| SINGLE_VENDOR_PROVIDERS.contains(&p);
    if !single(r) || !single(i) {
        let router = if single(r) { i } else { r };
        return Ok(format!(
            "unverified: provider {router} does not identify one model vendor"
        ));
    }
    if r == i {
        return Err(format!("reviewer must be independent: reviewer and implementer resolve to the same provider {r}"));
    }
    if reviewer_role != DispatchRole::Reviewer {
        return Ok(format!(
            "unverified: reviewer run dispatches as {}, not as reviewer",
            reviewer_role.as_str()
        ));
    }
    Ok(format!(
        "verified: launch route receipts bind reviewer provider {r} and implementer provider {i}"
    ))
}

fn validate_observed_at(observed_at: i64) -> Result<(), String> {
    if observed_at < 1 {
        return Err("observedAt must be positive".to_string());
    }
    if observed_at > now_unix_secs() {
        return Err("observedAt cannot be in the future".to_string());
    }
    Ok(())
}

fn db(label: &'static str) -> impl FnOnce(sqlx::Error) -> String {
    move |error| format!("{label}: {error}")
}

#[cfg(test)]
#[path = "development_run_contention_tests.rs"]
mod contention_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::development_policy::DevelopmentPolicy;
    use crate::testutil::TempDir;

    /// Full commit IDs: a candidate is bound by its exact Git object name.
    pub(super) const COMMIT_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    pub(super) const COMMIT_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    pub(super) async fn fixture() -> (TempDir, Store, String, String) {
        let dir = TempDir::new("development-runs");
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let root = "goal-root".to_string();
        let task = "task-1".to_string();
        let policy = serde_json::to_string(&DevelopmentPolicy::defaults()).unwrap();
        sqlx::query("INSERT INTO continuous_goals(id, project_id, root_goal_id, objective, status, deadline_at, admitted, created_at, updated_at) VALUES(?1, 'project', ?1, 'goal', 'open', 9999999999, 1, 1, 1)")
            .bind(&root).execute(&store.pool).await.unwrap();
        sqlx::query("INSERT INTO continuous_root_policies(root_goal_id, policy_json, source, observed_at) VALUES(?1, ?2, 'test', 1)")
            .bind(&root).bind(policy).execute(&store.pool).await.unwrap();
        sqlx::query("INSERT INTO continuous_tasks(id, goal_id, objective, owned_paths_json, dependencies_json, status, claim_owner, claim_fence, created_at, updated_at) VALUES(?1, ?2, 'task', '[]', '[]', 'running', 'worker-a', 7, 1, 1)")
            .bind(&task).bind(&root).execute(&store.pool).await.unwrap();
        (dir, store, root, task)
    }

    fn evidence(commit: &str) -> EvidenceInput {
        EvidenceInput {
            idempotency_key: "evidence-key".into(),
            source: "test-gate".into(),
            observed_at: 7,
            candidate_commit: commit.into(),
            measurement: EvidenceMeasurement::Measured {
                value: serde_json::json!({"passed": true}),
            },
            payload: serde_json::json!({"command": "cargo test"}),
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn scoped_briefing_reads_only_its_project_guidance() {
        let (dir, store, _root, task) = fixture().await;
        let project = store
            .create_project("guidance", &dir.path().to_string_lossy())
            .await
            .unwrap();
        sqlx::query("UPDATE continuous_goals SET project_id=?")
            .bind(&project.id)
            .execute(&store.pool)
            .await
            .unwrap();
        std::fs::write(dir.path().join("AGENTS.md"), "owned project rules").unwrap();
        let run = store
            .record_development_run_intent(&task, "worker-a", 7)
            .await
            .unwrap();
        let context = store
            .agent_run_context(&run.id, "worker-a", 7)
            .await
            .unwrap();
        assert_eq!(
            context["guidance"]["rules"]["items"][0]["text"],
            "owned project rules"
        );
        assert_eq!(context["guidance"]["source"], "project-working-tree");
        assert!(store
            .agent_run_context(&run.id, "foreign", 7)
            .await
            .is_err());
    }

    /// W2-01c: a run's own briefing states the same approval rule as the
    /// project snapshot; a shorter object there hid the W2-01 principal rule.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn run_briefing_states_the_same_approval_rule_as_the_snapshot() {
        let (_dir, store, _root, task) = fixture().await;
        let run = store
            .record_development_run_intent(&task, "worker-a", 7)
            .await
            .unwrap();
        let context = store
            .agent_run_context(&run.id, "worker-a", 7)
            .await
            .unwrap();
        let snapshot = store.development_records_snapshot("project").await.unwrap();
        assert_eq!(context["approvalAuthority"], snapshot["approvalAuthority"]);
        assert_eq!(snapshot["approvalAuthority"], approval_authority());
        assert_eq!(context["approvalAuthority"]["state"], "unavailable");
        assert_eq!(
            context["approvalAuthority"]["reviewerPrincipal"],
            "launch-route-receipt"
        );
    }

    /// W2-04e: the briefing states the dispatch role of the run explicitly.
    /// An unassigned task dispatches as implementer (W2-04 default); an
    /// assignment locked at the first claim decides reviewer/coordinator/
    /// integrator (PR #176 review, glm-5.2 F-1: cover all four roles).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn briefing_states_the_dispatch_role_of_the_run() {
        let (_dir, store, _root, task) = fixture().await;
        let run = store
            .record_development_run_intent(&task, "worker-a", 7)
            .await
            .unwrap();
        let context = store
            .agent_run_context(&run.id, "worker-a", 7)
            .await
            .unwrap();
        assert_eq!(context["dispatch"]["role"], "implementer");

        let reviewer = launched_run(&store, "task-r", "worker-r", 3, None).await;
        assign(&store, "task-r", "reviewer", "worker-r").await;
        let context = store
            .agent_run_context(&reviewer, "worker-r", 3)
            .await
            .unwrap();
        assert_eq!(context["dispatch"]["role"], "reviewer");

        let coordinator = launched_run(&store, "task-c", "worker-c", 4, None).await;
        assign(&store, "task-c", "coordinator", "worker-c").await;
        let context = store
            .agent_run_context(&coordinator, "worker-c", 4)
            .await
            .unwrap();
        assert_eq!(context["dispatch"]["role"], "coordinator");

        let integrator = launched_run(&store, "task-i", "worker-i", 6, None).await;
        assign(&store, "task-i", "integrator", "worker-i").await;
        let context = store
            .agent_run_context(&integrator, "worker-i", 6)
            .await
            .unwrap();
        assert_eq!(context["dispatch"]["role"], "integrator");
    }

    /// W2-04e: out-of-band drift against the frozen root policy must not
    /// silence the briefing — the role is reported as unresolved, fail-closed
    /// stays with each authorization boundary (W2-04f planning access).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn briefing_reports_an_unresolvable_dispatch_role_honestly() {
        let (_dir, store, _root, _task) = fixture().await;
        let ghost = launched_run(&store, "task-g", "worker-g", 5, None).await;
        sqlx::query("INSERT INTO continuous_team_assignments(task_id,team_id,role,assignee,revision,policy_version,observed_at) VALUES(?1,'nosuchteam','coordinator',?2,1,1,1)")
            .bind("task-g").bind("worker-g").execute(&store.pool).await.unwrap();
        let context = store
            .agent_run_context(&ghost, "worker-g", 5)
            .await
            .unwrap();
        assert_eq!(context["dispatch"]["role"], serde_json::Value::Null);
        assert!(context["dispatch"]["unresolved"]
            .as_str()
            .unwrap()
            .contains("frozen root policy"));
    }

    /// W2-01c review (kimi-k3 K3, glm-5.2 G3): the W2-01 divergence arose
    /// because a view wrote its own `approvalAuthority` literal. Production
    /// code may give the key only `approval_authority()` or the unrelated
    /// boolean `false` (team assignments, capabilities); anything else fails.
    #[test]
    fn approval_authority_has_no_second_literal_in_production_code() {
        fn visit(dir: &std::path::Path, files: &mut Vec<std::path::PathBuf>) {
            for entry in std::fs::read_dir(dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    visit(&path, files);
                } else if path.extension().is_some_and(|ext| ext == "rs")
                    && !path.to_string_lossy().ends_with("tests.rs")
                {
                    files.push(path);
                }
            }
        }
        let mut files = Vec::new();
        visit(
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
            &mut files,
        );
        let (mut shared, mut divergent) = (0, Vec::new());
        for file in files {
            let source = std::fs::read_to_string(&file).unwrap();
            let production = source.split("\nmod tests").next().unwrap();
            for (at, _) in production.match_indices("\"approvalAuthority\"") {
                let Some(value) = production[at + 19..].trim_start().strip_prefix(':') else {
                    continue; // an index such as `value["approvalAuthority"]`
                };
                let value = value.trim_start();
                let token = value[..value.find([',', '}', '\n']).unwrap_or(value.len())].trim();
                if token.ends_with("approval_authority()") {
                    shared += 1;
                } else if token != "false" {
                    divergent.push(format!("{}: {token}", file.display()));
                }
            }
        }
        assert!(
            divergent.is_empty(),
            "divergent approvalAuthority: {divergent:?}"
        );
        // Snapshot, run briefing and release view; fewer means the scan broke.
        assert!(shared >= 3, "only {shared} approval_authority() uses found");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn briefing_observes_dependency_states_without_exposing_other_projects() {
        let (_dir, store, root, task) = fixture().await;
        sqlx::query("INSERT INTO continuous_goals(id, project_id, root_goal_id, objective, status, deadline_at, admitted, created_at, updated_at) VALUES('foreign', 'other-project', 'foreign', 'private goal', 'open', 9999999999, 1, 1, 1)")
            .execute(&store.pool).await.unwrap();
        for (id, goal, status) in [
            ("done", root.as_str(), "completed"),
            ("pending", root.as_str(), "open"),
            ("private", "foreign", "completed"),
        ] {
            sqlx::query("INSERT INTO continuous_tasks(id, goal_id, objective, owned_paths_json, dependencies_json, status, created_at, updated_at) VALUES(?, ?, 'private task text', '[]', '[]', ?, 1, 12)")
                .bind(id).bind(goal).bind(status).execute(&store.pool).await.unwrap();
        }
        sqlx::query("UPDATE continuous_tasks SET dependencies_json = '[\"done\",\"pending\",\"missing\",\"private\"]' WHERE id = ?")
            .bind(&task).execute(&store.pool).await.unwrap();
        let run = store
            .record_development_run_intent(&task, "worker-a", 7)
            .await
            .unwrap();
        let context = store
            .agent_run_context(&run.id, "worker-a", 7)
            .await
            .unwrap();
        let dependencies = &context["task"]["dependencyState"];
        assert_eq!(dependencies["satisfied"], false);
        assert_eq!(dependencies["items"][0]["status"], "completed");
        assert_eq!(dependencies["items"][0]["updatedAt"], 12);
        assert_eq!(dependencies["items"][1]["status"], "open");
        assert_eq!(dependencies["items"][2]["state"], "unavailable");
        assert_eq!(dependencies["items"][3]["state"], "unavailable");
        assert!(dependencies["items"][3].get("status").is_none());
        assert!(!dependencies.to_string().contains("private task text"));
        assert_eq!(context["task"]["dependencies"].as_array().unwrap().len(), 4);
        assert!(store
            .agent_run_context(&run.id, "wrong-owner", 7)
            .await
            .is_err());
        sqlx::query("UPDATE continuous_tasks SET dependencies_json = '[\"done\"]' WHERE id = ?")
            .bind(&task)
            .execute(&store.pool)
            .await
            .unwrap();
        let refreshed = store
            .agent_run_context(&run.id, "worker-a", 7)
            .await
            .unwrap();
        assert_eq!(refreshed["task"]["dependencyState"]["satisfied"], true);
        for status in ["running", "failed", "cancelled", "unknown"] {
            sqlx::query("UPDATE continuous_tasks SET status = ? WHERE id = 'done'")
                .bind(status)
                .execute(&store.pool)
                .await
                .unwrap();
            let refreshed = store
                .agent_run_context(&run.id, "worker-a", 7)
                .await
                .unwrap();
            assert_eq!(refreshed["task"]["dependencyState"]["satisfied"], false);
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn briefing_does_not_claim_truncated_dependency_list_is_satisfied() {
        let (_dir, store, root, task) = fixture().await;
        let run = store
            .record_development_run_intent(&task, "worker-a", 7)
            .await
            .unwrap();
        let empty = store
            .agent_run_context(&run.id, "worker-a", 7)
            .await
            .unwrap();
        assert_eq!(empty["task"]["dependencyState"]["satisfied"], true);
        let ids: Vec<String> = (0..65).map(|n| format!("dependency-{n}")).collect();
        for id in &ids {
            sqlx::query("INSERT INTO continuous_tasks(id, goal_id, objective, owned_paths_json, dependencies_json, status, created_at, updated_at) VALUES(?, ?, 'dependency', '[]', '[]', 'completed', 1, 12)")
                .bind(id).bind(&root).execute(&store.pool).await.unwrap();
        }
        sqlx::query("UPDATE continuous_tasks SET dependencies_json = ? WHERE id = ?")
            .bind(serde_json::to_string(&ids).unwrap())
            .bind(&task)
            .execute(&store.pool)
            .await
            .unwrap();
        let context = store
            .agent_run_context(&run.id, "worker-a", 7)
            .await
            .unwrap();
        let state = &context["task"]["dependencyState"];
        assert_eq!(state["items"].as_array().unwrap().len(), 64);
        assert_eq!(state["total"], 65);
        assert_eq!(state["truncated"], true);
        assert_eq!(state["satisfied"], false);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn structured_checkpoint_is_durable_fenced_and_idempotent() {
        let (dir, store, _root, task) = fixture().await;
        let run = store
            .record_development_run_intent(&task, "worker-a", 7)
            .await
            .unwrap();
        let input = CheckpointInput {
            idempotency_key: "save-1".into(),
            expected_revision: 0,
            completed: vec!["Read task".into()],
            remaining: vec!["Implement".into()],
            failed_approaches: vec!["Old approach lacked evidence".into()],
            evidence_ids: vec![],
        };
        let saved = store
            .record_agent_checkpoint(&run.id, "worker-a", 7, input.clone())
            .await
            .unwrap();
        assert_eq!(saved["revision"], 1);
        assert_eq!(
            store
                .record_agent_checkpoint(&run.id, "worker-a", 7, input.clone())
                .await
                .unwrap(),
            saved
        );
        assert!(store
            .record_agent_checkpoint(&run.id, "worker-a", 8, input.clone())
            .await
            .is_err());
        let mut changed = input.clone();
        changed.remaining.push("Conflict".into());
        assert!(store
            .record_agent_checkpoint(&run.id, "worker-a", 7, changed)
            .await
            .is_err());
        let mut next = input.clone();
        next.idempotency_key = "save-2".into();
        next.expected_revision = 1;
        next.evidence_ids = vec!["foreign-or-missing".into()];
        assert!(store
            .record_agent_checkpoint(&run.id, "worker-a", 7, next.clone())
            .await
            .is_err());
        next.evidence_ids.clear();
        let mut competitor = next.clone();
        competitor.idempotency_key = "save-race".into();
        let (a, b) = tokio::join!(
            store.record_agent_checkpoint(&run.id, "worker-a", 7, next),
            store.record_agent_checkpoint(&run.id, "worker-a", 7, competitor)
        );
        assert_ne!(a.is_ok(), b.is_ok());
        store.pool.close().await;
        let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let briefing = reopened
            .agent_run_context(&run.id, "worker-a", 7)
            .await
            .unwrap();
        assert_eq!(briefing["checkpoint"]["revision"], 2);
        assert_eq!(briefing["checkpoint"]["trust"], "unverified-data");
        assert_eq!(
            briefing["checkpoint"]["content"]["remaining"][0],
            "Implement"
        );
        sqlx::query("UPDATE development_runs SET status = 'completed' WHERE id = ?")
            .bind(&run.id)
            .execute(&reopened.pool)
            .await
            .unwrap();
        assert!(reopened
            .record_agent_checkpoint(&run.id, "worker-a", 7, input)
            .await
            .is_err());
        assert_eq!(
            reopened
                .agent_checkpoint_at(&run.id, "worker-a", 7, 1)
                .await
                .unwrap(),
            saved
        );
        sqlx::query(
            "UPDATE continuous_tasks SET claim_owner = 'worker-b', claim_fence = 8 WHERE id = ?",
        )
        .bind(&task)
        .execute(&reopened.pool)
        .await
        .unwrap();
        let resumed = reopened
            .record_development_run_intent(&task, "worker-b", 8)
            .await
            .unwrap();
        assert!(reopened
            .agent_checkpoint_at(&run.id, "worker-a", 7, 1)
            .await
            .is_err());
        assert_eq!(
            reopened
                .agent_checkpoint_at(&resumed.id, "worker-b", 8, 1)
                .await
                .unwrap(),
            saved
        );
        assert_eq!(
            reopened
                .agent_run_context(&resumed.id, "worker-b", 8)
                .await
                .unwrap()["checkpoint"]["revision"],
            2
        );
        assert!(reopened
            .agent_checkpoint_at(&resumed.id, "worker-b", 8, 3)
            .await
            .is_err());
        let snapshot = reopened
            .development_records_snapshot("project")
            .await
            .unwrap();
        assert_eq!(snapshot["runs"][0]["taskCheckpoint"]["revision"], 2);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn intent_is_fence_bound_idempotent_and_does_not_use_lease_expiry() {
        let (_dir, store, _root, task) = fixture().await;
        let first = store
            .record_development_run_intent(&task, "worker-a", 7)
            .await
            .unwrap();
        let retry = store
            .record_development_run_intent(&task, "worker-a", 7)
            .await
            .unwrap();
        assert_eq!(first.id, retry.id);
        sqlx::query("UPDATE continuous_tasks SET lease_expires_at = 0 WHERE id = ?1")
            .bind(&task)
            .execute(&store.pool)
            .await
            .unwrap();
        let still_same = store
            .record_development_run_intent(&task, "worker-a", 7)
            .await
            .unwrap();
        assert_eq!(first.id, still_same.id);
        assert!(store
            .record_development_run_intent(&task, "worker-b", 7)
            .await
            .is_err());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn evidence_idempotency_and_candidate_change_invalidate_review() {
        let (_dir, store, _root, task) = fixture().await;
        let run = store
            .record_development_run_intent(&task, "worker-a", 7)
            .await
            .unwrap();
        store
            .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_A, "git", 6)
            .await
            .unwrap();
        let saved = store
            .record_development_evidence(&run.id, "worker-a", 7, evidence(COMMIT_A))
            .await
            .unwrap();
        assert_eq!(saved.candidate_commit, COMMIT_A);
        assert!(store
            .record_development_evidence(&run.id, "worker-a", 7, evidence(COMMIT_A))
            .await
            .is_ok());
        let mut mismatch = evidence(COMMIT_A);
        mismatch.payload = serde_json::json!({"command": "other"});
        assert!(store
            .record_development_evidence(&run.id, "worker-a", 7, mismatch)
            .await
            .is_err());
        let review = ReviewInput {
            idempotency_key: "review-key".into(),
            evidence_id: saved.id,
            candidate_commit: COMMIT_A.into(),
            disposition: ReviewDisposition::Approved,
            source: "review-service".into(),
            observed_at: 8,
        };
        let reviewer = launched_run(&store, "task-r", "worker-r", 3, None).await;
        let saved_review = store
            .record_development_review(&reviewer, "worker-r", 3, review)
            .await
            .unwrap();
        assert_eq!(saved_review.status, VALID_REVIEW);
        assert!(!saved_review.approval_eligible);
        assert!(saved_review.reviewer_attestation.contains("unavailable"));
        assert_eq!(
            store
                .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_B, "git", 9)
                .await
                .unwrap()
                .invalidated_records,
            2
        );
        let snapshot = store.development_records_snapshot("project").await.unwrap();
        assert_eq!(snapshot["apiVersion"], 1);
        assert_eq!(snapshot["approvalAuthority"]["state"], "unavailable");
        assert_eq!(snapshot["executionEnabled"], false);
        // The implementer run plus the reviewer's own run.
        let runs = snapshot["runs"].as_array().unwrap();
        assert_eq!(runs.len(), 2);
        let implementer = runs
            .iter()
            .find(|record| record["run"]["id"] == run.id.as_str())
            .unwrap();
        assert_eq!(implementer["candidate"]["candidateCommit"], COMMIT_B);
        assert_eq!(implementer["candidate"]["source"], "git");
        assert_eq!(implementer["candidate"]["observedAt"], 9);
        let briefing = store
            .agent_run_context(&run.id, "worker-a", 7)
            .await
            .unwrap();
        assert_eq!(briefing["reviews"][0]["status"], "invalidated");
        assert_eq!(briefing["reviews"][0]["invalidatedByCommit"], COMMIT_B);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn snapshot_distinguishes_bound_candidate_without_evidence() {
        let (_dir, store, _root, task) = fixture().await;
        let run = store
            .record_development_run_intent(&task, "worker-a", 7)
            .await
            .unwrap();
        let before = store.development_records_snapshot("project").await.unwrap();
        assert!(before["runs"][0]["candidate"].is_null());
        store
            .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_A, "git", 6)
            .await
            .unwrap();
        let after = store.development_records_snapshot("project").await.unwrap();
        assert_eq!(after["runs"][0]["candidate"]["candidateCommit"], COMMIT_A);
        assert!(after["runs"][0]["evidence"].as_array().unwrap().is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn agent_context_matches_run_evidence_and_rechecks_current_task_fence() {
        let (_dir, store, _root, task) = fixture().await;
        let run = store
            .record_development_run_intent(&task, "worker-a", 7)
            .await
            .unwrap();
        store
            .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_A, "git", 6)
            .await
            .unwrap();
        store
            .record_development_evidence(&run.id, "worker-a", 7, evidence(COMMIT_A))
            .await
            .unwrap();
        let context = store
            .agent_run_context(&run.id, "worker-a", 7)
            .await
            .unwrap();
        assert_eq!(context["task"]["objective"], "task");
        assert_eq!(context["candidate"]["candidateCommit"], COMMIT_A);
        assert_eq!(context["evidence"][0]["candidateCommit"], COMMIT_A);
        assert!(context["evidence"][0].get("payload").is_none());
        let id = context["evidence"][0]["id"].as_str().unwrap();
        assert_eq!(
            store
                .agent_evidence(&run.id, "worker-a", 7, id)
                .await
                .unwrap()["payload"]["command"],
            "cargo test"
        );
        assert!(store
            .agent_evidence(&run.id, "worker-a", 7, "foreign-evidence")
            .await
            .is_err());
        assert!(store.agent_run_context(&run.id, "other", 7).await.is_err());
        sqlx::query("UPDATE continuous_tasks SET claim_fence = 8 WHERE id = ?")
            .bind(task)
            .execute(&store.pool)
            .await
            .unwrap();
        assert!(store
            .agent_run_context(&run.id, "worker-a", 7)
            .await
            .is_err());
        assert!(store
            .record_development_evidence(&run.id, "worker-a", 7, evidence(COMMIT_A))
            .await
            .is_err());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn candidate_replay_returns_persisted_provenance() {
        let (_dir, store, _root, task) = fixture().await;
        let run = store
            .record_development_run_intent(&task, "worker-a", 7)
            .await
            .unwrap();
        store
            .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_A, "original-git", 6)
            .await
            .unwrap();
        let replay = store
            .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_A, "replayed-git", 8)
            .await
            .unwrap();
        let context = store
            .agent_run_context(&run.id, "worker-a", 7)
            .await
            .unwrap();
        assert_eq!(replay.source, context["candidate"]["source"]);
        assert_eq!(replay.observed_at, context["candidate"]["observedAt"]);
        assert_eq!(replay.source, "original-git");
        assert_eq!(replay.observed_at, 6);
        assert_eq!(replay.invalidated_records, 0);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn terminal_run_keeps_postmortem_reads_but_closes_candidate_and_evidence_writes() {
        for completed in [false, true] {
            let (_dir, store, _root, task) = fixture().await;
            let run = store
                .record_development_run_intent(&task, "worker-a", 7)
                .await
                .unwrap();
            store
                .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_A, "git", 6)
                .await
                .unwrap();
            let saved = store
                .record_development_evidence(&run.id, "worker-a", 7, evidence(COMMIT_A))
                .await
                .unwrap();
            if completed {
                store
                    .mark_development_run_launched(
                        &run.id,
                        "worker-a",
                        7,
                        Some("worker-a"),
                        Some(42),
                    )
                    .await
                    .unwrap();
                store
                    .complete_development_run(&run.id, "worker-a", 7, Some("process exited"))
                    .await
                    .unwrap();
            } else {
                store
                    .fail_development_run(&run.id, "worker-a", 7, "process exited")
                    .await
                    .unwrap();
            }
            assert!(store
                .agent_run_context(&run.id, "worker-a", 7)
                .await
                .is_ok());
            assert!(store
                .agent_evidence(&run.id, "worker-a", 7, &saved.id)
                .await
                .is_ok());
            let mut input = evidence(COMMIT_A);
            input.idempotency_key = "after-terminal".into();
            let write = store
                .record_development_evidence(&run.id, "worker-a", 7, input)
                .await;
            let rebind = store
                .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_B, "git", 8)
                .await;
            assert!(
                rebind.is_err(),
                "terminal run accepted a candidate mutation"
            );
            assert!(write.is_err(), "terminal run accepted evidence mutation");
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn agent_briefing_bounds_evidence_without_losing_fetchable_records() {
        let (_dir, store, _root, task) = fixture().await;
        let run = store
            .record_development_run_intent(&task, "worker-a", 7)
            .await
            .unwrap();
        store
            .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_A, "git", 6)
            .await
            .unwrap();
        let mut first_id = String::new();
        for n in 0..40 {
            let mut input = evidence(COMMIT_A);
            input.idempotency_key = format!("bounded-{n}");
            input.observed_at = 7 + n;
            let saved = store
                .record_development_evidence(&run.id, "worker-a", 7, input)
                .await
                .unwrap();
            if n == 0 {
                first_id = saved.id;
            }
        }
        let context = store
            .agent_run_context(&run.id, "worker-a", 7)
            .await
            .unwrap();
        assert_eq!(context["evidence"].as_array().unwrap().len(), 32);
        assert_eq!(context["evidenceTotal"], 40);
        assert!(store
            .agent_evidence(&run.id, "worker-a", 7, &first_id)
            .await
            .is_ok());
        let page = store
            .agent_record_page(&run.id, "worker-a", 7, "evidence", None)
            .await
            .unwrap();
        assert_eq!(page["items"].as_array().unwrap().len(), 32);
        assert_eq!(page["total"], 40);
        let cursor = page["nextCursor"].as_str().unwrap();
        // A backdated arrival must not shift an already-started traversal.
        let mut late = evidence(COMMIT_A);
        late.idempotency_key = "late".into();
        late.observed_at = 1;
        store
            .record_development_evidence(&run.id, "worker-a", 7, late)
            .await
            .unwrap();
        let tail = store
            .agent_record_page(&run.id, "worker-a", 7, "evidence", Some(cursor))
            .await
            .unwrap();
        assert_eq!(tail["items"].as_array().unwrap().len(), 8);
        assert_eq!(tail["total"], 40);
        assert!(tail["nextCursor"].is_null());
        let ids: std::collections::BTreeSet<_> = page["items"]
            .as_array()
            .unwrap()
            .iter()
            .chain(tail["items"].as_array().unwrap())
            .map(|item| item["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids.len(), 40);
        assert!(ids.contains(first_id.as_str()));
        assert!(page["items"][0].get("payload").is_none());
        assert!(store
            .agent_record_page(&run.id, "wrong", 7, "evidence", Some(cursor))
            .await
            .is_err());
        assert!(store
            .agent_record_page(&run.id, "worker-a", 8, "evidence", Some(cursor))
            .await
            .is_err());
        assert!(store
            .agent_record_page(&run.id, "worker-a", 7, "reviews", Some(cursor))
            .await
            .is_err());
        assert!(store
            .agent_record_page(&run.id, "worker-a", 7, "evidence", Some("garbage"))
            .await
            .is_err());
        assert_eq!(
            store
                .agent_record_page(&run.id, "worker-a", 7, "evidence", None)
                .await
                .unwrap()["total"],
            41
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn record_pages_backfill_v10_and_survive_vacuum_restart_and_invalidation() {
        let (dir, store, _root, task) = fixture().await;
        let run = store
            .record_development_run_intent(&task, "worker-a", 7)
            .await
            .unwrap();
        store
            .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_A, "git", 6)
            .await
            .unwrap();
        let saved = store
            .record_development_evidence(&run.id, "worker-a", 7, evidence(COMMIT_A))
            .await
            .unwrap();
        let reviewer = launched_run(&store, "task-r", "worker-r", 3, None).await;
        for n in 0..40 {
            let review = ReviewInput {
                idempotency_key: format!("page-review-{n}"),
                evidence_id: saved.id.clone(),
                candidate_commit: COMMIT_A.into(),
                disposition: ReviewDisposition::Approved,
                source: "review-service".into(),
                observed_at: 8,
            };
            store
                .record_development_review(&reviewer, "worker-r", 3, review)
                .await
                .unwrap();
        }
        // Simulate a v10 database with actual evidence/review rows. Only the new
        // migration's schema is removed, and only in this isolated fixture.
        for statement in [
            "DROP TABLE development_identity_observations",
            "DROP TABLE development_execution_identities",
            "DROP TABLE development_plan_revisions",
            "DROP TABLE development_plans",
            "DROP TABLE development_capture_results",
            "DROP TABLE development_capture_checkpoints",
            "DROP TABLE development_capture_owners",
            "DROP TABLE development_deliveries",
            "DROP INDEX development_process_instance_unique",
            "ALTER TABLE development_launches DROP COLUMN process_instance",
            "DROP TRIGGER development_evidence_order",
            "DROP TRIGGER development_launch_baseline_journal",
            "ALTER TABLE development_launches DROP COLUMN baseline_commit",
            "DROP TRIGGER development_reviews_order",
            "DROP TABLE development_record_order",
            "DROP TABLE continuous_supervisor_blocks",
            "DROP TABLE continuous_supervisor",
            "DROP TABLE continuous_team_assignments",
            "DROP TABLE continuous_discovery",
            "PRAGMA user_version=10",
        ] {
            sqlx::query(statement).execute(&store.pool).await.unwrap();
        }
        store.pool.close().await;
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let page = store
            .agent_record_page(&run.id, "worker-a", 7, "reviews", None)
            .await
            .unwrap();
        assert_eq!(page["total"], 40);
        assert_eq!(page["items"][0]["approvalEligible"], false);
        assert_eq!(page["items"][0]["status"], "valid");
        let cursor = page["nextCursor"].as_str().unwrap().to_string();
        sqlx::query("VACUUM").execute(&store.pool).await.unwrap();
        store.pool.close().await;
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        store
            .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_B, "git", 9)
            .await
            .unwrap();
        let tail = store
            .agent_record_page(&run.id, "worker-a", 7, "reviews", Some(&cursor))
            .await
            .unwrap();
        assert_eq!(tail["items"].as_array().unwrap().len(), 8);
        assert!(tail["nextCursor"].is_null());
        assert!(
            tail["items"]
                .as_array()
                .unwrap()
                .iter()
                .all(|item| item["status"] == "invalidated"
                    && item["invalidatedByCommit"] == COMMIT_B)
        );
        let ids: std::collections::BTreeSet<_> = page["items"]
            .as_array()
            .unwrap()
            .iter()
            .chain(tail["items"].as_array().unwrap())
            .map(|item| item["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids.len(), 40);
        assert_eq!(
            store
                .agent_record_page(&run.id, "worker-a", 7, "evidence", None)
                .await
                .unwrap()["total"],
            1
        );
        let mut next = evidence(COMMIT_B);
        next.idempotency_key = "after-migration".into();
        next.observed_at = 10;
        store
            .record_development_evidence(&run.id, "worker-a", 7, next.clone())
            .await
            .unwrap();
        store
            .record_development_evidence(&run.id, "worker-a", 7, next)
            .await
            .unwrap();
        assert_eq!(
            store
                .agent_record_page(&run.id, "worker-a", 7, "evidence", None)
                .await
                .unwrap()["total"],
            2
        );
        use base64::Engine as _;
        let codec = base64::engine::general_purpose::URL_SAFE_NO_PAD;
        let original: Value = serde_json::from_slice(&codec.decode(&cursor).unwrap()).unwrap();
        for (field, value) in [
            ("run", serde_json::json!("other-run")),
            ("version", serde_json::json!(2)),
            ("after", serde_json::json!(-1)),
            ("through", serde_json::json!(i64::MAX)),
        ] {
            let mut modified = original.clone();
            modified[field] = value;
            let encoded = codec.encode(serde_json::to_vec(&modified).unwrap());
            assert!(store
                .agent_record_page(&run.id, "worker-a", 7, "reviews", Some(&encoded))
                .await
                .is_err());
        }
        assert!(store
            .agent_record_page(&run.id, "worker-a", 7, "reviews", Some(&"x".repeat(1025)))
            .await
            .is_err());
        assert!(store
            .agent_record_page(&run.id, "worker-a", 7, "credentials", None)
            .await
            .is_err());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn review_identity_and_unavailable_measurement_are_explicit() {
        let (_dir, store, _root, task) = fixture().await;
        let run = store
            .record_development_run_intent(&task, "worker-a", 7)
            .await
            .unwrap();
        store
            .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_A, "git", 6)
            .await
            .unwrap();
        let mut unavailable = evidence(COMMIT_A);
        unavailable.measurement = EvidenceMeasurement::Unavailable {
            reason: "provider returned no token telemetry".into(),
        };
        let saved = store
            .record_development_evidence(&run.id, "worker-a", 7, unavailable)
            .await
            .unwrap();
        let same_identity = ReviewInput {
            idempotency_key: "review-key".into(),
            evidence_id: saved.id,
            candidate_commit: COMMIT_A.into(),
            disposition: ReviewDisposition::Approved,
            source: "review-service".into(),
            observed_at: 8,
        };
        assert!(store
            .record_development_review(&run.id, "worker-a", 7, same_identity)
            .await
            .unwrap_err()
            .contains("independent"));
    }

    /// Stands in for the trusted launch service: the provider comes from the
    /// route receipt it bound, never from the review caller.
    async fn launched_run(
        store: &Store,
        task: &str,
        owner: &str,
        fence: i64,
        provider: Option<&str>,
    ) -> String {
        if task != "task-1" {
            sqlx::query("INSERT INTO continuous_tasks(id, goal_id, objective, owned_paths_json, dependencies_json, status, claim_owner, claim_fence, created_at, updated_at) VALUES(?1, 'goal-root', 'review', '[]', '[]', 'running', ?2, ?3, 1, 1)")
                .bind(task).bind(owner).bind(fence).execute(&store.pool).await.unwrap();
        }
        let run = store
            .record_development_run_intent(task, owner, fence)
            .await
            .unwrap();
        if let Some(provider) = provider {
            // Serialize the real route types, as `DevelopmentRoute::receipt`
            // does (`"selection": decision`), so a renamed field breaks here.
            use crate::development_policy::{
                FamilyResolution, IdentityStatus, Observation, ResolvedRoute, RouteDecision,
                RouteRequest,
            };
            let gone = || Observation::Unavailable {
                reason: "test".into(),
            };
            let decision = RouteDecision {
                requested: RouteRequest {
                    requested_model: None,
                    required_capabilities: Default::default(),
                    effort: None,
                    minimum_context_tokens: 0,
                    requires_verified_tool_adapter: false,
                },
                resolved: Some(ResolvedRoute {
                    profile_id: provider.into(),
                    provider: serde_json::from_value(serde_json::json!(provider)).unwrap(),
                    configured_model: gone(),
                    resolved_model: gone(),
                    effort: gone(),
                    context_tokens: Observation::Unavailable {
                        reason: "test".into(),
                    },
                    quota_remaining_percent: Observation::Unavailable {
                        reason: "test".into(),
                    },
                    estimated_task_tokens: Observation::Unavailable {
                        reason: "test".into(),
                    },
                    evidence_id: "test".into(),
                    observed_at: 1,
                    candidate_family: FamilyResolution {
                        status: IdentityStatus::Unknown,
                        family: None,
                        registry: None,
                    },
                }),
                failure: None,
            };
            let route = serde_json::json!({"schemaVersion": 1, "selection": decision});
            sqlx::query("INSERT INTO development_launches(run_id, worker_id, project_id, profile_id, repo_path, worktree_path, branch, state, reserved_at, route_json, route_expires_at) VALUES(?1, ?2, 'project', ?3, 'repo', ?4, 'branch', 'reserved', 1, ?5, 9999999999)")
                .bind(&run.id).bind(format!("worker-{}", run.id)).bind(provider).bind(format!("wt-{}", run.id)).bind(route.to_string())
                .execute(&store.pool).await.unwrap();
        }
        run.id
    }

    /// Stands in for `assign_continuous_task` (migration 14): the dispatch
    /// role of a run comes from its task's team assignment (W2-04).
    async fn assign(store: &Store, task: &str, role: &str, assignee: &str) {
        sqlx::query("INSERT INTO continuous_team_assignments(task_id,team_id,role,assignee,revision,policy_version,observed_at) VALUES(?1,'development',?2,?3,1,1,1)")
            .bind(task).bind(role).bind(assignee).execute(&store.pool).await.unwrap();
    }

    fn review_input(key: &str, evidence_id: &str) -> ReviewInput {
        ReviewInput {
            idempotency_key: key.into(),
            evidence_id: evidence_id.into(),
            candidate_commit: COMMIT_A.into(),
            disposition: ReviewDisposition::Approved,
            source: "review-service".into(),
            observed_at: 8,
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn reviewer_principal_comes_from_launch_records_not_caller_labels() {
        let (_dir, store, _root, task) = fixture().await;
        let implementer = launched_run(&store, &task, "worker-a", 7, Some("claude")).await;
        store
            .bind_development_run_candidate(&implementer, "worker-a", 7, COMMIT_A, "git", 6)
            .await
            .unwrap();
        let saved = store
            .record_development_evidence(&implementer, "worker-a", 7, evidence(COMMIT_A))
            .await
            .unwrap();
        // The implementer's own credential cannot record a review of itself,
        // whatever reviewer label it claims.
        assert!(store
            .record_development_review(&implementer, "worker-a", 7, review_input("self", &saved.id))
            .await
            .is_err());
        // A different provider, bound by the launch service, is verified.
        let reviewer = launched_run(&store, "task-r", "worker-r", 3, Some("codex")).await;
        assign(&store, "task-r", "reviewer", "worker-r").await;
        let review = store
            .record_development_review(&reviewer, "worker-r", 3, review_input("codex", &saved.id))
            .await
            .unwrap();
        assert_eq!(review.run_id, implementer);
        assert!(
            review.reviewer_attestation.starts_with("verified:"),
            "{}",
            review.reviewer_attestation
        );
        assert!(
            review.reviewer_identity.contains(&reviewer)
                && review.reviewer_identity.contains("provider=codex")
        );
        assert!(
            review.implementer_identity.contains(&implementer)
                && review.implementer_identity.contains("provider=claude")
        );
        // Approval still requires a signed verdict, which does not exist yet.
        assert!(!review.approval_eligible);
        // The same provider under another run is not an independent reviewer.
        let same = launched_run(&store, "task-s", "worker-s", 4, Some("claude")).await;
        assert!(store
            .record_development_review(&same, "worker-s", 4, review_input("same", &saved.id))
            .await
            .unwrap_err()
            .contains("same provider"));
        // Without a route receipt, or behind a multi-vendor router, the
        // principal is recorded but honestly labelled unverified.
        let unrouted = launched_run(&store, "task-u", "worker-u", 5, None).await;
        let review = store
            .record_development_review(
                &unrouted,
                "worker-u",
                5,
                review_input("unrouted", &saved.id),
            )
            .await
            .unwrap();
        assert!(
            review.reviewer_attestation.starts_with("unverified:"),
            "{}",
            review.reviewer_attestation
        );
        let routed = launched_run(&store, "task-o", "worker-o", 6, Some("ollama")).await;
        let review = store
            .record_development_review(&routed, "worker-o", 6, review_input("ollama", &saved.id))
            .await
            .unwrap();
        assert!(
            review.reviewer_attestation.starts_with("unverified:"),
            "{}",
            review.reviewer_attestation
        );
        // A reviewer credential that does not match its run is refused.
        assert!(store
            .record_development_review(&reviewer, "worker-a", 3, review_input("forged", &saved.id))
            .await
            .is_err());
        let snapshot = store.development_records_snapshot("project").await.unwrap();
        assert_eq!(snapshot["approvalAuthority"]["state"], "unavailable");
        assert_eq!(
            snapshot["approvalAuthority"]["reviewerPrincipal"],
            "launch-route-receipt"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn reviewer_principal_edge_cases_fail_closed() {
        let (_dir, store, _root, task) = fixture().await;
        // The implementer has no route receipt; a routed reviewer alone
        // proves nothing about independence.
        let implementer = launched_run(&store, &task, "worker-a", 7, None).await;
        store
            .bind_development_run_candidate(&implementer, "worker-a", 7, COMMIT_A, "git", 6)
            .await
            .unwrap();
        let saved = store
            .record_development_evidence(&implementer, "worker-a", 7, evidence(COMMIT_A))
            .await
            .unwrap();
        let reviewer = launched_run(&store, "task-r", "worker-r", 3, Some("codex")).await;
        let review = store
            .record_development_review(&reviewer, "worker-r", 3, review_input("mixed", &saved.id))
            .await
            .unwrap();
        assert!(
            review.reviewer_attestation.starts_with("unverified:"),
            "{}",
            review.reviewer_attestation
        );
        // A run of another project cannot review this candidate.
        sqlx::query("INSERT INTO continuous_goals(id, project_id, root_goal_id, objective, status, deadline_at, admitted, created_at, updated_at) VALUES('goal-x', 'other-project', 'goal-root', 'goal', 'open', 9999999999, 1, 1, 1)")
            .execute(&store.pool).await.unwrap();
        let foreign = launched_run(&store, "task-x", "worker-x", 2, Some("kimi")).await;
        sqlx::query("UPDATE continuous_tasks SET goal_id = 'goal-x' WHERE id = 'task-x'")
            .execute(&store.pool)
            .await
            .unwrap();
        assert!(store
            .record_development_review(&foreign, "worker-x", 2, review_input("foreign", &saved.id))
            .await
            .unwrap_err()
            .contains("another project"));
        // A retry by the same reviewer returns its review; another reviewer
        // reusing the idempotency key does not inherit it.
        assert!(store
            .record_development_review(&reviewer, "worker-r", 3, review_input("mixed", &saved.id))
            .await
            .is_ok());
        let other = launched_run(&store, "task-k", "worker-k", 4, Some("kimi")).await;
        assert!(store
            .record_development_review(&other, "worker-k", 4, review_input("mixed", &saved.id))
            .await
            .unwrap_err()
            .contains("idempotency"));
    }

    /// W2-02: review and test dispositions count only for the exact candidate
    /// they name. A name that can move without a rebind (a ref, an
    /// abbreviation) would keep them valid for changed code, and a stale
    /// observation must not rebind an older candidate.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn dispositions_bind_to_the_exact_current_candidate() {
        let (_dir, store, _root, task) = fixture().await;
        let run = launched_run(&store, &task, "worker-a", 7, Some("claude")).await;
        for moving in [
            "HEAD",
            "refs/heads/main",
            "aaaaaaa",
            &COMMIT_A.to_uppercase(),
        ] {
            assert!(
                store
                    .bind_development_run_candidate(&run, "worker-a", 7, moving, "git", 5)
                    .await
                    .unwrap_err()
                    .contains("full Git commit ID"),
                "bound a candidate by a movable or ambiguous name: {moving}"
            );
        }
        store
            .bind_development_run_candidate(&run, "worker-a", 7, COMMIT_A, "git", 6)
            .await
            .unwrap();
        let test = store
            .record_development_evidence(&run, "worker-a", 7, evidence(COMMIT_A))
            .await
            .unwrap();
        let reviewer = launched_run(&store, "task-r", "worker-r", 3, Some("codex")).await;
        assign(&store, "task-r", "reviewer", "worker-r").await;
        let review = store
            .record_development_review(&reviewer, "worker-r", 3, review_input("exact", &test.id))
            .await
            .unwrap();
        assert!(review.reviewer_attestation.starts_with("verified:"));
        // The integration path reports a change by name, too.
        assert!(store
            .invalidate_development_run_evidence_for_candidate(
                &run,
                "worker-a",
                7,
                "HEAD",
                "integrator",
                8
            )
            .await
            .unwrap_err()
            .contains("full Git commit ID"));
        assert_eq!(
            store
                .bind_development_run_candidate(&run, "worker-a", 7, COMMIT_B, "git", 9)
                .await
                .unwrap()
                .invalidated_records,
            2
        );
        // An observation older than the bound one cannot move the binding
        // back, neither through the worker nor through the integration path.
        assert!(store
            .bind_development_run_candidate(&run, "worker-a", 7, COMMIT_A, "git", 7)
            .await
            .unwrap_err()
            .contains("stale"));
        assert!(store
            .invalidate_development_run_evidence_for_candidate(
                &run,
                "worker-a",
                7,
                COMMIT_A,
                "integrator",
                8
            )
            .await
            .unwrap_err()
            .contains("stale"));
        let context = store.agent_run_context(&run, "worker-a", 7).await.unwrap();
        assert_eq!(context["candidate"]["candidateCommit"], COMMIT_B);
        assert_eq!(context["candidate"]["observedAt"], 9);
        // Returning to the old commit later does not revive its dispositions.
        store
            .bind_development_run_candidate(&run, "worker-a", 7, COMMIT_A, "git", 10)
            .await
            .unwrap();
        let reviews = store.list_development_reviews(&run).await.unwrap();
        assert_eq!(reviews[0].status, INVALIDATED_REVIEW);
        assert_eq!(reviews[0].invalidated_by_commit.as_deref(), Some(COMMIT_B));
        let tests = store.list_development_evidence(&run).await.unwrap();
        assert_eq!(tests[0].invalidated_by_commit.as_deref(), Some(COMMIT_B));
        assert!(store
            .record_development_review(&reviewer, "worker-r", 3, review_input("revived", &test.id))
            .await
            .unwrap_err()
            .contains("not valid"));
        // New evidence for the returned candidate is accepted.
        let mut fresh = evidence(COMMIT_A);
        fresh.idempotency_key = "fresh".into();
        fresh.observed_at = 10;
        let fresh = store
            .record_development_evidence(&run, "worker-a", 7, fresh)
            .await
            .unwrap();
        assert_eq!(fresh.invalidated_at, None);
        // A replay of the bound commit stays idempotent even when older.
        let replay = store
            .bind_development_run_candidate(&run, "worker-a", 7, COMMIT_A, "git", 5)
            .await
            .unwrap();
        assert_eq!((replay.observed_at, replay.invalidated_records), (10, 0));
        // Within the same second the later writer wins (a fast amend).
        assert_eq!(
            store
                .bind_development_run_candidate(&run, "worker-a", 7, COMMIT_B, "git", 10)
                .await
                .unwrap()
                .invalidated_records,
            1
        );
        // SHA-256 repositories name commits with 64 digits.
        store
            .bind_development_run_candidate(&run, "worker-a", 7, &"c".repeat(64), "git", 11)
            .await
            .unwrap();
    }

    /// W2-04b: a different vendor alone does not make a verified reviewer; the
    /// reviewer run must also be dispatched in the `reviewer` role. A role the
    /// store cannot resolve authorizes no review at all.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn verified_review_requires_the_reviewer_dispatch_role() {
        let (_dir, store, _root, task) = fixture().await;
        let implementer = launched_run(&store, &task, "worker-a", 7, Some("claude")).await;
        store
            .bind_development_run_candidate(&implementer, "worker-a", 7, COMMIT_A, "git", 6)
            .await
            .unwrap();
        let saved = store
            .record_development_evidence(&implementer, "worker-a", 7, evidence(COMMIT_A))
            .await
            .unwrap();
        // Unassigned runs dispatch as implementers; a coordinator is no
        // reviewer either. Both are recorded, but never as verified.
        let unassigned = launched_run(&store, "task-u", "worker-u", 3, Some("codex")).await;
        let coordinator = launched_run(&store, "task-c", "worker-c", 3, Some("codex")).await;
        assign(&store, "task-c", "coordinator", "worker-c").await;
        for (run, owner, role) in [
            (&unassigned, "worker-u", "implementer"),
            (&coordinator, "worker-c", "coordinator"),
        ] {
            let review = store
                .record_development_review(run, owner, 3, review_input(role, &saved.id))
                .await
                .unwrap();
            assert!(
                review.reviewer_attestation.starts_with("unverified:")
                    && review.reviewer_attestation.contains(role),
                "a {role} run was attested as reviewer: {}",
                review.reviewer_attestation
            );
        }
        // The assigned reviewer of another vendor is verified.
        let reviewer = launched_run(&store, "task-r", "worker-r", 3, Some("codex")).await;
        assign(&store, "task-r", "reviewer", "worker-r").await;
        let review = store
            .record_development_review(
                &reviewer,
                "worker-r",
                3,
                review_input("reviewer", &saved.id),
            )
            .await
            .unwrap();
        assert!(
            review.reviewer_attestation.starts_with("verified:"),
            "{}",
            review.reviewer_attestation
        );
        // Fail closed: a reviewer assignment for someone else, and a role the
        // store does not know, authorize no review.
        let foreign = launched_run(&store, "task-f", "worker-f", 3, Some("kimi")).await;
        assign(&store, "task-f", "reviewer", "someone-else").await;
        let refused = store
            .record_development_review(&foreign, "worker-f", 3, review_input("foreign", &saved.id))
            .await;
        assert!(
            refused
                .as_ref()
                .is_err_and(|e| e.contains("not the assigned reviewer")),
            "{refused:?}"
        );
        let unknown = launched_run(&store, "task-q", "worker-q", 3, Some("kimi")).await;
        // Only a corrupted row can carry an unknown role: the schema refuses
        // one on a plain write ...
        assert!(sqlx::query("INSERT INTO continuous_team_assignments(task_id,team_id,role,assignee,revision,policy_version,observed_at) VALUES('task-q','development','auditor','worker-q',1,1,1)")
            .execute(&store.pool).await.unwrap_err().to_string().contains("CHECK"));
        {
            // ... so bypass the CHECK on one connection to simulate it.
            let mut conn = store.pool.acquire().await.unwrap();
            sqlx::query("PRAGMA ignore_check_constraints = ON")
                .execute(&mut *conn)
                .await
                .unwrap();
            sqlx::query("INSERT INTO continuous_team_assignments(task_id,team_id,role,assignee,revision,policy_version,observed_at) VALUES('task-q','development','auditor','worker-q',1,1,1)")
                .execute(&mut *conn).await.unwrap();
            sqlx::query("PRAGMA ignore_check_constraints = OFF")
                .execute(&mut *conn)
                .await
                .unwrap();
        }
        let refused = store
            .record_development_review(&unknown, "worker-q", 3, review_input("unknown", &saved.id))
            .await;
        assert!(
            refused
                .as_ref()
                .is_err_and(|e| e.contains("unknown dispatch role")),
            "{refused:?}"
        );
        let keys: Vec<String> = store
            .list_development_reviews(&implementer)
            .await
            .unwrap()
            .into_iter()
            .map(|review| review.idempotency_key)
            .collect();
        assert_eq!(keys.len(), 3, "{keys:?}");
        assert!(!keys.iter().any(|key| key == "foreign" || key == "unknown"));
    }

    /// W2-04b review K1/G1: a replay returns the stored review only while its
    /// attestation is still what the store derives now. A row written under an
    /// older rule (here: `verified` for a non-reviewer run) is not handed back
    /// as verified.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn replayed_review_cannot_keep_a_stale_verified_attestation() {
        let (_dir, store, _root, task) = fixture().await;
        let implementer = launched_run(&store, &task, "worker-a", 7, Some("claude")).await;
        store
            .bind_development_run_candidate(&implementer, "worker-a", 7, COMMIT_A, "git", 6)
            .await
            .unwrap();
        let saved = store
            .record_development_evidence(&implementer, "worker-a", 7, evidence(COMMIT_A))
            .await
            .unwrap();
        let unassigned = launched_run(&store, "task-u", "worker-u", 3, Some("codex")).await;
        let first = store
            .record_development_review(&unassigned, "worker-u", 3, review_input("old", &saved.id))
            .await
            .unwrap();
        assert!(first.reviewer_attestation.starts_with("unverified:"));
        // Simulate the row a pre-W2-04b store wrote for the same request.
        sqlx::query("UPDATE development_run_reviews SET reviewer_attestation = 'verified: launch route receipts bind reviewer provider codex and implementer provider claude' WHERE id = ?")
            .bind(&first.id).execute(&store.pool).await.unwrap();
        let replay = store
            .record_development_review(&unassigned, "worker-u", 3, review_input("old", &saved.id))
            .await;
        assert!(
            replay.as_ref().is_err_and(|e| e.contains("attestation")),
            "a stale verified attestation was replayed: {replay:?}"
        );
        // An unchanged row still replays idempotently.
        let reviewer = launched_run(&store, "task-r", "worker-r", 3, Some("codex")).await;
        assign(&store, "task-r", "reviewer", "worker-r").await;
        let recorded = store
            .record_development_review(&reviewer, "worker-r", 3, review_input("new", &saved.id))
            .await
            .unwrap();
        let replayed = store
            .record_development_review(&reviewer, "worker-r", 3, review_input("new", &saved.id))
            .await
            .unwrap();
        assert_eq!(recorded.id, replayed.id);
        assert!(replayed.reviewer_attestation.starts_with("verified:"));
    }

    /// W2-04b: the store, not only the worker lane, refuses a candidate from a
    /// run whose dispatch role does not submit candidates. Both writers of the
    /// binding (worker and integration path) go through this boundary.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn candidate_role_is_enforced_at_the_store_boundary() {
        let (_dir, store, _root, _task) = fixture().await;
        for role in ["reviewer", "coordinator"] {
            let task = format!("task-{role}");
            let owner = format!("worker-{role}");
            let run = launched_run(&store, &task, &owner, 3, None).await;
            assign(&store, &task, role, &owner).await;
            let bound = store
                .bind_development_run_candidate(&run, &owner, 3, COMMIT_A, "git", 6)
                .await;
            assert!(
                bound.as_ref().is_err_and(|e| e.contains(role)),
                "a {role} run bound a candidate: {bound:?}"
            );
            let integrated = store
                .invalidate_development_run_evidence_for_candidate(
                    &run,
                    &owner,
                    3,
                    COMMIT_A,
                    "integrator",
                    6,
                )
                .await;
            assert!(
                integrated.as_ref().is_err_and(|e| e.contains(role)),
                "a {role} run was bound through the integration path: {integrated:?}"
            );
            let context = store.agent_run_context(&run, &owner, 3).await.unwrap();
            assert!(context["candidate"].is_null(), "{role}");
        }
        // A foreign assignment fails closed even for a submitting role.
        let foreign = launched_run(&store, "task-f", "worker-f", 3, None).await;
        assign(&store, "task-f", "implementer", "someone-else").await;
        assert!(store
            .bind_development_run_candidate(&foreign, "worker-f", 3, COMMIT_A, "git", 6)
            .await
            .unwrap_err()
            .contains("not the assigned implementer"));
        // Integrators and (unassigned) implementers submit candidates.
        let integrator = launched_run(&store, "task-i", "worker-i", 3, None).await;
        assign(&store, "task-i", "integrator", "worker-i").await;
        store
            .bind_development_run_candidate(&integrator, "worker-i", 3, COMMIT_A, "git", 6)
            .await
            .unwrap();
        let implementer = launched_run(&store, "task-1", "worker-a", 7, None).await;
        store
            .bind_development_run_candidate(&implementer, "worker-a", 7, COMMIT_A, "git", 6)
            .await
            .unwrap();
    }
}
