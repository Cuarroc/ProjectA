//! Durable, deliberately non-executing state for the DevHQ continuous-work
//! contract.  This module owns claims and planning limits; it never starts a
//! process.  A lease expiry is diagnostic information only, never permission
//! to start a duplicate agent.

use super::{new_id, now_unix_secs, Sqlite, Store, Transaction};
use crate::development_policy::{self, DevelopmentPolicy};
use serde::Serialize;
use sqlx::{FromRow, SqliteConnection, SqlitePool};

#[path = "continuous_capacity.rs"]
mod capacity;

pub const CONTINUOUS_PAUSED: &str = "paused";
pub const CONTINUOUS_DRAINING: &str = "draining";
pub const CONTINUOUS_ENABLED: &str = "enabled";
const TASK_OPEN: &str = "open";
const TASK_RUNNING: &str = "running";
const TASK_COMPLETED: &str = "completed";
const TASK_CANCELLED: &str = "cancelled";
const TASK_FAILED: &str = "failed";
const CLAIM_LEASE_SECONDS: i64 = 15 * 60;
const FOUR_SEAM_LOCK: &str = "__projecta_four_seams__";
type ClaimAdmissionRow = (String, String, i64, bool, i64, i64, Option<String>, i64);
const FOUR_SEAMS: [&str; 4] = [
    "src-tauri/src/api.rs",
    "src-tauri/src/main.rs",
    "src-tauri/src/store.rs",
    "src-tauri/src/bin/pa.rs",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ContinuousGoal {
    pub id: String,
    pub project_id: String,
    pub source_goal_id: Option<String>,
    pub root_goal_id: String,
    pub objective: String,
    pub acceptance_criteria: Option<String>,
    pub status: String,
    pub deadline_at: i64,
    pub admitted: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ContinuousTask {
    pub assignment: Option<super::team_assignments::TeamAssignment>,
    pub id: String,
    pub goal_id: String,
    pub objective: String,
    pub profile_id: Option<String>,
    pub owned_paths: Vec<String>,
    pub dependencies: Vec<String>,
    pub status: String,
    pub attempts: i64,
    pub escalations: i64,
    pub claim: Option<ContinuousClaim>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ContinuousClaim {
    pub task_id: String,
    pub owner: String,
    pub fence: i64,
    pub claimed_at: i64,
    pub lease_expires_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinuousControl {
    pub project_id: String,
    pub status: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinuousSnapshot {
    pub source_timestamp: i64,
    pub commit: Option<String>,
    pub run: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ContinuousEvent {
    pub cursor: i64,
    pub kind: String,
    pub detail: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinuousContext {
    pub discovery: serde_json::Value,
    pub supervisor: serde_json::Value,
    pub cursor: i64,
    pub has_more: bool,
    pub events: Vec<ContinuousEvent>,
    pub goals: Vec<ContinuousGoal>,
    pub tasks: Vec<ContinuousTask>,
    pub control: ContinuousControl,
    pub effective_limits: serde_json::Value,
    pub snapshot: ContinuousSnapshot,
}

#[derive(FromRow)]
struct TaskRow {
    id: String,
    goal_id: String,
    objective: String,
    profile_id: Option<String>,
    owned_paths_json: String,
    dependencies_json: String,
    status: String,
    attempts: i64,
    escalations: i64,
    created_at: i64,
    updated_at: i64,
}

impl TaskRow {
    fn into_task(
        self,
        claim: Option<ContinuousClaim>,
        assignment: Option<super::team_assignments::TeamAssignment>,
    ) -> Result<ContinuousTask, String> {
        let owned_paths = serde_json::from_str(&self.owned_paths_json)
            .map_err(|e| format!("continuous task has invalid owned paths: {e}"))?;
        let dependencies = serde_json::from_str(&self.dependencies_json)
            .map_err(|e| format!("continuous task has invalid dependencies: {e}"))?;
        Ok(ContinuousTask {
            assignment,
            id: self.id,
            goal_id: self.goal_id,
            objective: self.objective,
            profile_id: self.profile_id,
            owned_paths,
            dependencies,
            status: self.status,
            attempts: self.attempts,
            escalations: self.escalations,
            claim,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

pub(super) async fn apply_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    // No foreign-key enforcement is assumed by Store, so every public writer
    // verifies the project/goal relationship before it changes a row.
    for statement in [
        "CREATE TABLE IF NOT EXISTS continuous_projects (project_id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS continuous_goals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_goal_id TEXT, root_goal_id TEXT NOT NULL, objective TEXT NOT NULL, acceptance_criteria TEXT, status TEXT NOT NULL, deadline_at INTEGER NOT NULL, admitted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
        "CREATE INDEX IF NOT EXISTS continuous_goals_project_created ON continuous_goals(project_id, created_at, id)",
        "CREATE TABLE IF NOT EXISTS continuous_goal_budget (project_id TEXT NOT NULL, root_goal_id TEXT NOT NULL, tasks_created INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, escalations INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(project_id, root_goal_id))",
        "CREATE TABLE IF NOT EXISTS continuous_tasks (id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, objective TEXT NOT NULL, profile_id TEXT, owned_paths_json TEXT NOT NULL, dependencies_json TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, escalations INTEGER NOT NULL DEFAULT 0, claim_owner TEXT, claim_fence INTEGER NOT NULL DEFAULT 0, claimed_at INTEGER, lease_expires_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
        "CREATE INDEX IF NOT EXISTS continuous_tasks_goal_created ON continuous_tasks(goal_id, created_at, id)",
        "CREATE TABLE IF NOT EXISTS continuous_scope_locks (project_id TEXT NOT NULL, scope TEXT NOT NULL, task_id TEXT NOT NULL, PRIMARY KEY(project_id, scope), UNIQUE(task_id, scope))",
        "CREATE TABLE IF NOT EXISTS continuous_events (cursor INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL)",
        "CREATE INDEX IF NOT EXISTS continuous_events_project_cursor ON continuous_events(project_id, cursor)",
        "CREATE TABLE IF NOT EXISTS continuous_context_snapshots (project_id TEXT PRIMARY KEY, source_timestamp INTEGER NOT NULL, commit_sha TEXT, run_id TEXT)",
    ] {
        sqlx::query(statement)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("failed to create continuous development schema: {e}"))?;
    }
    Ok(())
}

pub(super) async fn apply_policy_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    sqlx::query("CREATE TABLE continuous_root_policies (root_goal_id TEXT PRIMARY KEY, policy_json TEXT NOT NULL, source TEXT NOT NULL, observed_at INTEGER NOT NULL)")
        .execute(&mut **tx).await.map_err(db("create root policies"))?;
    // Preserve consumed v4 budgets and deadlines. The new worker capacity cap
    // applies prospectively to claims; migration never revokes existing owners.
    // migration must never read today's config and rewrite an existing budget.
    let mut legacy_policy = DevelopmentPolicy::defaults();
    // No token telemetry existed in v4. New defaults cannot grant these roots
    // an allowance or pretend their historical consumption is known.
    legacy_policy.tokens = None;
    let policy =
        serde_json::to_string(&legacy_policy).map_err(|e| format!("encode legacy policy: {e}"))?;
    sqlx::query("INSERT INTO continuous_root_policies SELECT DISTINCT root_goal_id, ?1, 'legacy-v4-defaults', ?2 FROM continuous_goals")
        .bind(policy).bind(now_unix_secs()).execute(&mut **tx).await.map_err(db("preserve legacy root policies"))?;
    Ok(())
}

async fn root_policy(tx: &mut SqliteConnection, root: &str) -> Result<DevelopmentPolicy, String> {
    let row: (String,) =
        sqlx::query_as("SELECT policy_json FROM continuous_root_policies WHERE root_goal_id = ?")
            .bind(root)
            .fetch_one(&mut *tx)
            .await
            .map_err(db("read immutable root policy"))?;
    development_policy::parse(&row.0)
}

impl Store {
    pub async fn create_continuous_goal(
        &self,
        project_id: &str,
        objective: &str,
        acceptance_criteria: Option<String>,
        source_goal_id: Option<String>,
        admit: bool,
    ) -> Result<ContinuousGoal, String> {
        let objective = required_text(objective, "objective")?;
        self.require_project(project_id).await?;
        let loaded = if source_goal_id.is_none() {
            let project = self
                .get_project(project_id)
                .await?
                .ok_or("unknown project")?;
            Some(development_policy::load(std::path::Path::new(
                &project.repo_path,
            ))?)
        } else {
            None
        };
        let mut tx = begin_write(&self.pool, "begin continuous goal").await?;
        let outcome = Self::create_continuous_goal_body(
            &mut tx,
            project_id,
            objective,
            acceptance_criteria,
            source_goal_id,
            admit,
            loaded,
        )
        .await;
        settle(tx, outcome, "commit continuous goal").await
    }

    async fn create_continuous_goal_body(
        tx: &mut SqliteConnection,
        project_id: &str,
        objective: String,
        acceptance_criteria: Option<String>,
        source_goal_id: Option<String>,
        admit: bool,
        loaded: Option<development_policy::LoadedPolicy>,
    ) -> Result<ContinuousGoal, String> {
        let now = now_unix_secs();
        let id = new_id("cg");
        let (root_goal_id, deadline_at) = match source_goal_id.as_deref() {
            Some(source_goal_id) => {
                let source: Option<(String, String, i64)> = sqlx::query_as("SELECT project_id, root_goal_id, deadline_at FROM continuous_goals WHERE id = ?1 AND status = 'open' AND root_goal_id IN (SELECT id FROM continuous_goals WHERE status = 'open')")
                    .bind(source_goal_id).fetch_optional(&mut *tx).await.map_err(db("read continuous source goal"))?;
                match source {
                    Some((source_project, root, deadline)) if source_project == project_id => {
                        (root, deadline)
                    }
                    _ => {
                        return Err(format!(
                            "unknown or cross-project sourceGoalId: {source_goal_id}"
                        ))
                    }
                }
            }
            None => (
                id.clone(),
                if admit {
                    now + i64::from(
                        loaded
                            .as_ref()
                            .ok_or("missing root policy")?
                            .policy
                            .continuous
                            .goal_minutes,
                    ) * 60
                } else {
                    0
                },
            ),
        };
        let policy = match &loaded {
            Some(loaded) => loaded.policy.clone(),
            None => root_policy(tx, &root_goal_id).await?,
        };
        if admit && policy.continuous.max_autonomous_goals == 0 {
            return Err("continuous goal admission is disabled by its root policy".into());
        }
        if admit && source_goal_id.is_none() {
            let active: Option<(String,)> = sqlx::query_as("SELECT root_goal_id FROM continuous_goals WHERE project_id = ?1 AND admitted = 1 AND status NOT IN ('completed', 'cancelled', 'failed') LIMIT 1")
                .bind(project_id).fetch_optional(&mut *tx).await.map_err(db("read admitted continuous root"))?;
            if active.is_some() {
                return Err("an autonomous continuous root is already unresolved; use sourceGoalId for its replan".to_string());
            }
        }
        if admit && deadline_at > 0 && now >= deadline_at {
            return Err(
                "continuous goal deadline has elapsed; a replan cannot reset its time budget"
                    .to_string(),
            );
        }
        if admit && deadline_at == 0 {
            return Err(
                "a draft root has not been admitted; its descendants cannot be admitted".into(),
            );
        }
        let goal = ContinuousGoal {
            id,
            project_id: project_id.to_string(),
            source_goal_id,
            root_goal_id: root_goal_id.clone(),
            objective: objective.clone(),
            acceptance_criteria: acceptance_criteria.filter(|v| !v.trim().is_empty()),
            status: TASK_OPEN.to_string(),
            deadline_at,
            admitted: admit,
            created_at: now,
            updated_at: now,
        };
        if let Some(loaded) = loaded {
            let encoded = serde_json::to_string(&loaded.policy)
                .map_err(|e| format!("encode root policy: {e}"))?;
            sqlx::query("INSERT INTO continuous_root_policies(root_goal_id, policy_json, source, observed_at) VALUES(?, ?, ?, ?)")
                .bind(&root_goal_id).bind(encoded).bind(&loaded.source).bind(now).execute(&mut *tx).await.map_err(db("freeze root policy"))?;
        }
        sqlx::query("INSERT INTO continuous_goal_budget(project_id, root_goal_id) VALUES(?1, ?2) ON CONFLICT(project_id, root_goal_id) DO NOTHING")
            .bind(project_id).bind(&root_goal_id).execute(&mut *tx).await.map_err(db("reserve continuous root ledger"))?;
        sqlx::query("INSERT INTO continuous_goals(id, project_id, source_goal_id, root_goal_id, objective, acceptance_criteria, status, deadline_at, admitted, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)")
            .bind(&goal.id).bind(project_id).bind(&goal.source_goal_id).bind(&goal.root_goal_id).bind(&goal.objective).bind(&goal.acceptance_criteria).bind(&goal.status).bind(goal.deadline_at).bind(goal.admitted).bind(now).bind(now)
            .execute(&mut *tx).await.map_err(db("create continuous goal"))?;
        event(tx, project_id, "goal_created", &goal.id, now).await?;
        Ok(goal)
    }

    pub async fn list_continuous_goals(
        &self,
        project_id: &str,
    ) -> Result<Vec<ContinuousGoal>, String> {
        self.require_project(project_id).await?;
        sqlx::query_as("SELECT id, project_id, source_goal_id, root_goal_id, objective, acceptance_criteria, status, deadline_at, admitted, created_at, updated_at FROM continuous_goals WHERE project_id = ?1 ORDER BY created_at, id")
            .bind(project_id).fetch_all(&self.pool).await.map_err(db("list continuous goals"))
    }

    pub async fn create_continuous_task(
        &self,
        goal_id: &str,
        objective: &str,
        profile_id: Option<String>,
        owned_paths: Vec<String>,
        dependencies: Vec<String>,
    ) -> Result<ContinuousTask, String> {
        let objective = required_text(objective, "objective")?;
        let owned_paths = normalize_scopes(owned_paths)?;
        let dependencies = normalize_ids(dependencies, "dependencies")?;
        let mut tx = begin_write(&self.pool, "begin continuous task").await?;
        let outcome = Self::create_continuous_task_body(
            &mut tx,
            goal_id,
            objective,
            profile_id,
            owned_paths,
            dependencies,
        )
        .await;
        let id = settle(tx, outcome, "commit continuous task").await?;
        self.get_continuous_task(&id)
            .await?
            .ok_or_else(|| "created continuous task disappeared".to_string())
    }

    async fn create_continuous_task_body(
        tx: &mut SqliteConnection,
        goal_id: &str,
        objective: String,
        profile_id: Option<String>,
        owned_paths: Vec<String>,
        dependencies: Vec<String>,
    ) -> Result<String, String> {
        let goal: Option<(String, String, i64, bool)> =
            sqlx::query_as("SELECT project_id, root_goal_id, deadline_at, admitted FROM continuous_goals WHERE id = ?1 AND status = 'open'")
                .bind(goal_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db("read continuous goal"))?;
        let Some((project_id, root_goal_id, deadline_at, _admitted)) = goal else {
            return Err(format!("unknown continuous goal: {goal_id}"));
        };
        if deadline_at > 0 && now_unix_secs() >= deadline_at {
            return Err(
                "continuous goal deadline has elapsed; task admission is closed".to_string(),
            );
        }
        let (count,): (i64,) = sqlx::query_as("SELECT tasks_created FROM continuous_goal_budget WHERE project_id = ?1 AND root_goal_id = ?2")
            .bind(&project_id).bind(&root_goal_id).fetch_one(&mut *tx).await.map_err(db("read continuous root ledger"))?;
        let policy = root_policy(tx, &root_goal_id).await?;
        if count >= i64::from(policy.continuous.max_tasks_per_goal) {
            return Err(
                "continuous goal task budget exhausted (including recreated goals)".to_string(),
            );
        }
        for dependency in &dependencies {
            let found: Option<(String,)> = sqlx::query_as("SELECT g.project_id FROM continuous_tasks t JOIN continuous_goals g ON g.id = t.goal_id WHERE t.id = ?1")
                .bind(dependency).fetch_optional(&mut *tx).await.map_err(db("read task dependency"))?;
            if found.as_ref().map(|row| row.0.as_str()) != Some(project_id.as_str()) {
                return Err(format!("unknown or cross-project dependency: {dependency}"));
            }
        }
        let existing: Vec<(String,)> =
            sqlx::query_as("SELECT scope FROM continuous_scope_locks WHERE project_id = ?1")
                .bind(&project_id)
                .fetch_all(&mut *tx)
                .await
                .map_err(db("read continuous scope locks"))?;
        for (scope,) in existing {
            if owned_paths
                .iter()
                .any(|new_scope| scopes_conflict(new_scope, &scope))
            {
                return Err(format!(
                    "owned path conflicts with active continuous task scope: {scope}"
                ));
            }
        }
        let now = now_unix_secs();
        let id = new_id("ct");
        let owned_paths_json =
            serde_json::to_string(&owned_paths).map_err(|e| format!("encode owned paths: {e}"))?;
        let dependencies_json = serde_json::to_string(&dependencies)
            .map_err(|e| format!("encode dependencies: {e}"))?;
        sqlx::query("INSERT INTO continuous_tasks(id, goal_id, objective, profile_id, owned_paths_json, dependencies_json, status, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)")
            .bind(&id).bind(goal_id).bind(&objective).bind(&profile_id).bind(&owned_paths_json).bind(&dependencies_json).bind(TASK_OPEN).bind(now)
            .execute(&mut *tx).await.map_err(db("create continuous task"))?;
        for scope in &owned_paths {
            sqlx::query(
                "INSERT INTO continuous_scope_locks(project_id, scope, task_id) VALUES(?1, ?2, ?3)",
            )
            .bind(&project_id)
            .bind(scope)
            .bind(&id)
            .execute(&mut *tx)
            .await
            .map_err(db("claim continuous scope"))?;
        }
        sqlx::query("UPDATE continuous_goal_budget SET tasks_created = tasks_created + 1 WHERE project_id = ?1 AND root_goal_id = ?2")
            .bind(&project_id).bind(&root_goal_id).execute(&mut *tx).await.map_err(db("consume continuous task budget"))?;
        event(tx, &project_id, "task_created", &id, now).await?;
        Ok(id)
    }

    pub async fn claim_continuous_task(
        &self,
        task_id: &str,
        owner: &str,
        escalation: bool,
    ) -> Result<ContinuousClaim, String> {
        self.claim_with_capacity(task_id, owner, escalation, capacity::sample)
            .await
    }

    async fn claim_with_capacity(
        &self,
        task_id: &str,
        owner: &str,
        escalation: bool,
        observe_capacity: impl FnOnce() -> capacity::Capacity,
    ) -> Result<ContinuousClaim, String> {
        let owner = required_text(owner, "owner")?;
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(db("begin continuous claim"))?;
        let outcome =
            Self::claim_with_capacity_body(&mut tx, task_id, &owner, escalation, observe_capacity)
                .await;
        settle(tx, outcome, "commit continuous claim").await
    }

    async fn claim_with_capacity_body(
        tx: &mut SqliteConnection,
        task_id: &str,
        owner: &str,
        escalation: bool,
        observe_capacity: impl FnOnce() -> capacity::Capacity,
    ) -> Result<ContinuousClaim, String> {
        sqlx::query("UPDATE continuous_tasks SET updated_at=updated_at WHERE id=?")
            .bind(task_id)
            .execute(&mut *tx)
            .await
            .map_err(db("serialize continuous claim"))?;
        let row: Option<ClaimAdmissionRow> = sqlx::query_as("SELECT g.project_id, g.root_goal_id, g.deadline_at, g.admitted, t.attempts, t.escalations, t.claim_owner, t.claim_fence FROM continuous_tasks t JOIN continuous_goals g ON g.id = t.goal_id WHERE t.id = ?1 AND t.status = ?2 AND g.status = 'open'")
            .bind(task_id).bind(TASK_OPEN).fetch_optional(&mut *tx).await.map_err(db("read continuous claim"))?;
        let Some((
            project_id,
            root_goal_id,
            deadline_at,
            admitted,
            attempts,
            escalations,
            prior_owner,
            prior_fence,
        )) = row
        else {
            return Err(format!("continuous task is not open: {task_id}"));
        };
        if prior_owner.is_some() {
            return Err(format!("continuous task is already claimed: {task_id}"));
        }
        if !admitted {
            return Err("continuous goal is a draft and is not admitted for execution".to_string());
        }
        if deadline_at == 0 || now_unix_secs() >= deadline_at {
            return Err("continuous goal has no active deadline or its deadline has elapsed; claim is refused".to_string());
        }
        let policy = root_policy(tx, &root_goal_id).await?;
        super::team_assignments::check_claim(tx, task_id, owner, &policy).await?;
        if attempts >= i64::from(policy.continuous.max_attempts_per_task) {
            return Err("continuous task attempt budget exhausted".to_string());
        }
        if escalation && escalations >= i64::from(policy.continuous.max_escalations) {
            return Err("continuous task escalation budget exhausted".to_string());
        }
        let (state,): (String,) =
            sqlx::query_as("SELECT status FROM continuous_projects WHERE project_id = ?1")
                .bind(&project_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db("read continuous control"))?
                .unwrap_or((CONTINUOUS_PAUSED.to_string(),));
        if state != CONTINUOUS_ENABLED {
            return Err(format!(
                "continuous project is {state}; claims are not admitted"
            ));
        }
        let (running,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM continuous_tasks t JOIN continuous_goals g ON g.id = t.goal_id WHERE g.project_id = ? AND t.status = 'running'")
            .bind(&project_id).fetch_one(&mut *tx).await.map_err(db("count active continuous claims"))?;
        if running >= i64::from(policy.continuous.max_workers) {
            return Err("continuous worker capacity exhausted".into());
        }
        // The application shares one execution host across projects. Count all
        // unresolved claims under the writer lock already acquired above;
        // pausing a project or expiring a lease does not stop its workers.
        let (host_running,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM continuous_tasks WHERE status = 'running'")
                .fetch_one(&mut *tx)
                .await
                .map_err(db("count host continuous claims"))?;
        // Sample after acquiring the writer lock, not before waiting for it.
        let capacity = observe_capacity();
        if host_running >= i64::from(capacity.limit) {
            return Err(format!(
                "continuous host worker capacity exhausted: {} (limit {})",
                capacity.reason, capacity.limit
            ));
        }
        let deps_json: (String,) =
            sqlx::query_as("SELECT dependencies_json FROM continuous_tasks WHERE id = ?1")
                .bind(task_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(db("read continuous dependencies"))?;
        let deps: Vec<String> = serde_json::from_str(&deps_json.0)
            .map_err(|e| format!("continuous dependencies are corrupt: {e}"))?;
        for dependency in deps {
            let status: Option<(String,)> =
                sqlx::query_as("SELECT status FROM continuous_tasks WHERE id = ?1")
                    .bind(&dependency)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(db("check continuous dependency"))?;
            if status.as_ref().map(|row| row.0.as_str()) != Some(TASK_COMPLETED) {
                return Err(format!("dependency is not completed: {dependency}"));
            }
        }
        let now = now_unix_secs();
        let fence = prior_fence + 1;
        let lease_expires_at = now + CLAIM_LEASE_SECONDS;
        sqlx::query("UPDATE continuous_tasks SET status = ?, claim_owner = ?, claim_fence = ?, claimed_at = ?, lease_expires_at = ?, attempts = attempts + 1, escalations = escalations + ?, updated_at = ? WHERE id = ? AND status = ? AND claim_owner IS NULL")
            .bind(TASK_RUNNING).bind(owner).bind(fence).bind(now).bind(lease_expires_at).bind(usize::from(escalation) as i64).bind(now).bind(task_id).bind(TASK_OPEN).execute(&mut *tx).await.map_err(db("write continuous claim"))?;
        // Read the conditional write back. Only this owner/fence pair proves
        // that the transaction won the claim.
        let won: Option<(String, i64)> = sqlx::query_as("SELECT claim_owner, claim_fence FROM continuous_tasks WHERE id = ?1 AND claim_owner = ?2 AND claim_fence = ?3")
            .bind(task_id).bind(owner).bind(fence).fetch_optional(&mut *tx).await.map_err(db("verify continuous claim fence"))?;
        if won.is_none() {
            return Err(format!("continuous task claim lost race: {task_id}"));
        }
        sqlx::query("UPDATE continuous_goal_budget SET attempts = attempts + 1, escalations = escalations + ?1 WHERE project_id = ?2 AND root_goal_id = ?3")
            .bind(usize::from(escalation) as i64).bind(&project_id).bind(&root_goal_id).execute(&mut *tx).await.map_err(db("consume continuous attempt budget"))?;
        event(tx, &project_id, "task_claimed", task_id, now).await?;
        Ok(ContinuousClaim {
            task_id: task_id.to_string(),
            owner: owner.to_string(),
            fence,
            claimed_at: now,
            lease_expires_at,
        })
    }

    pub async fn checkpoint_continuous_task(
        &self,
        task_id: &str,
        owner: &str,
        fence: i64,
        status: Option<&str>,
        detail: Option<&str>,
    ) -> Result<ContinuousTask, String> {
        let owner = required_text(owner, "owner")?;
        let requested = status.unwrap_or(TASK_RUNNING);
        let retry = requested == "retry";
        let next = if retry { TASK_OPEN } else { requested };
        if requested == TASK_OPEN
            || !matches!(
                next,
                TASK_RUNNING | TASK_COMPLETED | TASK_CANCELLED | TASK_FAILED | TASK_OPEN
            )
        {
            return Err(
                "continuous checkpoint status must be running, completed, cancelled, failed or retry"
                    .to_string(),
            );
        }
        let mut tx = begin_write(&self.pool, "begin continuous checkpoint").await?;
        let outcome = Self::checkpoint_continuous_task_body(
            &mut tx, task_id, &owner, fence, next, retry, detail,
        )
        .await;
        settle(tx, outcome, "commit continuous checkpoint").await?;
        self.get_continuous_task(task_id)
            .await?
            .ok_or_else(|| "checkpointed continuous task disappeared".to_string())
    }

    async fn checkpoint_continuous_task_body(
        tx: &mut SqliteConnection,
        task_id: &str,
        owner: &str,
        fence: i64,
        mut next: &str,
        retry: bool,
        detail: Option<&str>,
    ) -> Result<(), String> {
        let project: Option<(String,)> = sqlx::query_as("SELECT g.project_id FROM continuous_tasks t JOIN continuous_goals g ON g.id = t.goal_id WHERE t.id = ?1").bind(task_id).fetch_optional(&mut *tx).await.map_err(db("read continuous checkpoint"))?;
        let Some((project_id,)) = project else {
            return Err(format!("unknown continuous task: {task_id}"));
        };
        let now = now_unix_secs();
        if retry {
            let (root, attempts, deadline): (String, i64, i64) = sqlx::query_as("SELECT g.root_goal_id, t.attempts, g.deadline_at FROM continuous_tasks t JOIN continuous_goals g ON g.id = t.goal_id WHERE t.id = ?")
                .bind(task_id).fetch_one(&mut *tx).await.map_err(db("read retry budget"))?;
            let policy = root_policy(tx, &root).await?;
            let (failed,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM development_runs WHERE task_id = ? AND claim_owner = ? AND claim_fence = ? AND status = 'failed'")
                .bind(task_id).bind(owner).bind(fence).fetch_one(&mut *tx).await.map_err(db("verify failed attempt"))?;
            if failed != 1 {
                return Err("retry requires a resolved failed run for the current claim".into());
            }
            if attempts >= i64::from(policy.continuous.max_attempts_per_task) || now >= deadline {
                next = TASK_FAILED;
            }
        }
        let release_claim = is_terminal(next) || retry;
        if release_claim {
            let (active,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM development_runs WHERE task_id = ? AND status IN ('intent', 'launched', 'reconciling')")
                .bind(task_id).fetch_one(&mut *tx).await.map_err(db("check unresolved task run"))?;
            if active > 0 {
                return Err(
                    "continuous task has an unresolved run; reconcile before releasing ownership"
                        .into(),
                );
            }
        }
        let changed = sqlx::query("UPDATE continuous_tasks SET status = ?1, updated_at = ?2, claim_owner = CASE WHEN ?3 THEN NULL ELSE claim_owner END, claimed_at = CASE WHEN ?3 THEN NULL ELSE claimed_at END, lease_expires_at = CASE WHEN ?3 THEN NULL ELSE lease_expires_at END WHERE id = ?4 AND status = ?5 AND claim_owner = ?6 AND claim_fence = ?7")
            .bind(next).bind(now).bind(release_claim).bind(task_id).bind(TASK_RUNNING).bind(owner).bind(fence).execute(&mut *tx).await.map_err(db("write continuous checkpoint"))?;
        if changed.rows_affected() != 1 {
            return Err(format!(
                "stale or unauthorized continuous claim fence for task: {task_id}"
            ));
        }
        let verified: Option<(String,)> = if release_claim {
            sqlx::query_as("SELECT status FROM continuous_tasks WHERE id = ?1 AND status = ?2 AND claim_owner IS NULL").bind(task_id).bind(next).fetch_optional(&mut *tx).await.map_err(db("verify terminal checkpoint"))?
        } else {
            sqlx::query_as("SELECT status FROM continuous_tasks WHERE id = ?1 AND status = ?2 AND claim_owner = ?3 AND claim_fence = ?4").bind(task_id).bind(next).bind(owner).bind(fence).fetch_optional(&mut *tx).await.map_err(db("verify continuous checkpoint"))?
        };
        if verified.is_none() {
            return Err(format!(
                "stale or unauthorized continuous claim fence for task: {task_id}"
            ));
        }
        if is_terminal(next) {
            sqlx::query("DELETE FROM continuous_scope_locks WHERE task_id = ?1")
                .bind(task_id)
                .execute(&mut *tx)
                .await
                .map_err(db("release continuous scopes"))?;
        }
        if next == TASK_COMPLETED {
            sqlx::query("UPDATE continuous_goals SET status = 'awaiting_review', updated_at = ?1 WHERE root_goal_id = (SELECT g.root_goal_id FROM continuous_tasks t JOIN continuous_goals g ON g.id = t.goal_id WHERE t.id = ?2) AND status = 'open' AND NOT EXISTS (SELECT 1 FROM continuous_tasks t JOIN continuous_goals g ON g.id = t.goal_id WHERE g.root_goal_id = continuous_goals.root_goal_id AND t.status != 'completed')")
                .bind(now).bind(task_id).execute(&mut *tx).await.map_err(db("advance continuous goal to review"))?;
        }
        let checkpoint_detail = serde_json::json!({"taskId": task_id, "owner": owner, "fence": fence, "status": next, "detail": detail}).to_string();
        event(tx, &project_id, "task_checkpoint", &checkpoint_detail, now).await?;
        Ok(())
    }

    pub async fn control_continuous(
        &self,
        project_id: &str,
        action: &str,
    ) -> Result<ContinuousControl, String> {
        self.require_project(project_id).await?;
        let status = match action {
            "pause" => CONTINUOUS_PAUSED,
            "drain" => CONTINUOUS_DRAINING,
            "cancel" => CONTINUOUS_PAUSED,
            "resume" => {
                return Err(
                    "continuous runtime adapters are unattested; resume is fail-closed".to_string(),
                )
            }
            _ => return Err("continuous action must be pause, drain, resume or cancel".to_string()),
        };
        let now = now_unix_secs();
        let mut tx = begin_write(&self.pool, "begin continuous control").await?;
        let outcome = Self::control_continuous_body(&mut tx, project_id, action, status, now).await;
        settle(tx, outcome, "commit continuous control").await?;
        Ok(ContinuousControl {
            project_id: project_id.to_string(),
            status: status.to_string(),
            updated_at: now,
        })
    }

    async fn control_continuous_body(
        tx: &mut SqliteConnection,
        project_id: &str,
        action: &str,
        status: &str,
        now: i64,
    ) -> Result<(), String> {
        sqlx::query("INSERT INTO continuous_projects(project_id, status, updated_at) VALUES(?1, ?2, ?3) ON CONFLICT(project_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at").bind(project_id).bind(status).bind(now).execute(&mut *tx).await.map_err(db("write continuous control"))?;
        if action == "cancel" {
            let (active,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM development_runs r JOIN continuous_tasks t ON t.id = r.task_id JOIN continuous_goals g ON g.id = t.goal_id WHERE g.project_id = ? AND r.status IN ('intent', 'launched', 'reconciling')")
                .bind(project_id).fetch_one(&mut *tx).await.map_err(db("check unresolved project runs"))?;
            if active > 0 {
                return Err(
                    "continuous project has unresolved runs; drain and reconcile before cancelling"
                        .into(),
                );
            }
            sqlx::query("UPDATE continuous_goals SET status = 'cancelled', updated_at = ?1 WHERE project_id = ?2 AND status NOT IN ('completed', 'cancelled', 'failed')").bind(now).bind(project_id).execute(&mut *tx).await.map_err(db("cancel continuous goals"))?;
            sqlx::query("UPDATE continuous_tasks SET status = ?1, claim_owner = NULL, claimed_at = NULL, lease_expires_at = NULL, updated_at = ?2 WHERE id IN (SELECT t.id FROM continuous_tasks t JOIN continuous_goals g ON g.id = t.goal_id WHERE g.project_id = ?3 AND t.status IN (?4, ?5))").bind(TASK_CANCELLED).bind(now).bind(project_id).bind(TASK_OPEN).bind(TASK_RUNNING).execute(&mut *tx).await.map_err(db("cancel continuous tasks"))?;
            sqlx::query("DELETE FROM continuous_scope_locks WHERE project_id = ?1")
                .bind(project_id)
                .execute(&mut *tx)
                .await
                .map_err(db("release cancelled scopes"))?;
        }
        event(tx, project_id, "control", action, now).await?;
        Ok(())
    }

    pub async fn continuous_changes(
        &self,
        project_id: &str,
        after_cursor: i64,
    ) -> Result<serde_json::Value, String> {
        if after_cursor < 0 {
            return Err("cursor must be non-negative".into());
        }
        self.require_project(project_id).await?;
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(db("begin continuous changes"))?;
        let (events, has_more) = read_event_page(&mut tx, project_id, after_cursor).await?;
        let cursor = events.last().map_or(after_cursor, |event| event.cursor);
        tx.commit().await.map_err(db("finish continuous changes"))?;
        Ok(
            serde_json::json!({"apiVersion":1,"source":"rust/sqlite","sourceTimestamp":now_unix_secs(),
            "projectId":project_id,"cursor":cursor,"hasMore":has_more,"limit":200,"events":events}),
        )
    }

    pub async fn continuous_context(
        &self,
        project_id: &str,
        after_cursor: i64,
    ) -> Result<ContinuousContext, String> {
        if after_cursor < 0 {
            return Err("cursor must be non-negative".into());
        }
        self.require_project(project_id).await?;
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(db("begin continuous snapshot"))?;
        let goals: Vec<ContinuousGoal> = sqlx::query_as("SELECT id, project_id, source_goal_id, root_goal_id, objective, acceptance_criteria, status, deadline_at, admitted, created_at, updated_at FROM continuous_goals WHERE project_id = ?1 ORDER BY created_at, id").bind(project_id).fetch_all(&mut *tx).await.map_err(db("snapshot goals"))?;
        let mut tasks = Vec::new();
        for goal in &goals {
            tasks.extend(self.list_continuous_tasks(&mut tx, &goal.id).await?);
        }
        let (events, has_more) = read_event_page(&mut tx, project_id, after_cursor).await?;
        let cursor = events
            .last()
            .map(|event| event.cursor)
            .unwrap_or(after_cursor);
        let snapshot = sqlx::query_as::<_, (i64, Option<String>, Option<String>)>("SELECT source_timestamp, commit_sha, run_id FROM continuous_context_snapshots WHERE project_id = ?1").bind(project_id).fetch_optional(&mut *tx).await.map_err(db("read continuous snapshot"))?.map(|(source_timestamp, commit, run)| ContinuousSnapshot { source_timestamp, commit, run }).unwrap_or(ContinuousSnapshot { source_timestamp: now_unix_secs(), commit: None, run: None });
        let control = sqlx::query_as::<_, (String, i64)>(
            "SELECT status, updated_at FROM continuous_projects WHERE project_id = ?1",
        )
        .bind(project_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db("read continuous context control"))?
        .map(|(status, updated_at)| ContinuousControl {
            project_id: project_id.to_string(),
            status,
            updated_at,
        })
        .unwrap_or(ContinuousControl {
            project_id: project_id.to_string(),
            status: CONTINUOUS_PAUSED.to_string(),
            updated_at: snapshot.source_timestamp,
        });
        let rows: Vec<(String, String, String, i64)> = sqlx::query_as("SELECT p.root_goal_id, p.policy_json, p.source, p.observed_at FROM continuous_root_policies p WHERE p.root_goal_id IN (SELECT root_goal_id FROM continuous_goals WHERE project_id = ?) ORDER BY p.root_goal_id")
            .bind(project_id).fetch_all(&mut *tx).await.map_err(db("snapshot root policies"))?;
        let mut policies = Vec::new();
        for (root, encoded, source, observed_at) in rows {
            let policy = development_policy::parse(&encoded)?;
            let tokens = super::development_budget::balance(&mut tx, &root).await?;
            policies.push(serde_json::json!({"rootGoalId": root, "policy": policy, "source": source, "observedAt": observed_at, "tokens": tokens}));
        }
        let (active_claims,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM continuous_tasks WHERE status='running'")
                .fetch_one(&mut *tx)
                .await
                .map_err(db("snapshot host claims"))?;
        let effective_limits = serde_json::json!({ "rootPolicies": policies, "continuousScheduler": false, "launchIntent": false,
            "hostAdmission": {"activeClaims": active_claims, "memory": capacity::sample()} });
        let supervisor = super::supervisor::context(&mut tx, project_id).await?;
        let discovery = super::discovery::context(&mut tx, project_id).await?;
        tx.commit()
            .await
            .map_err(db("finish continuous snapshot"))?;
        Ok(ContinuousContext {
            discovery,
            supervisor,
            cursor,
            has_more,
            events,
            goals,
            tasks,
            control,
            effective_limits,
            snapshot,
        })
    }

    async fn get_continuous_task(&self, id: &str) -> Result<Option<ContinuousTask>, String> {
        self.read_task("WHERE t.id = ?1", id).await
    }
    async fn list_continuous_tasks(
        &self,
        tx: &mut Transaction<'_, Sqlite>,
        goal_id: &str,
    ) -> Result<Vec<ContinuousTask>, String> {
        let rows: Vec<TaskRow> = sqlx::query_as("SELECT id, goal_id, objective, profile_id, owned_paths_json, dependencies_json, status, attempts, escalations, created_at, updated_at FROM continuous_tasks WHERE goal_id = ?1 ORDER BY created_at, id").bind(goal_id).fetch_all(&mut **tx).await.map_err(db("list continuous tasks"))?;
        let mut tasks = Vec::with_capacity(rows.len());
        for row in rows {
            let claim = sqlx::query_as("SELECT id AS task_id, claim_owner AS owner, claim_fence AS fence, claimed_at, lease_expires_at FROM continuous_tasks WHERE id = ?1 AND claim_owner IS NOT NULL").bind(&row.id).fetch_optional(&mut **tx).await.map_err(db("snapshot claim"))?;
            let assignment = super::team_assignments::read(tx, &row.id).await?;
            tasks.push(row.into_task(claim, assignment)?);
        }
        Ok(tasks)
    }
    async fn read_task(&self, clause: &str, id: &str) -> Result<Option<ContinuousTask>, String> {
        let mut tx = self.pool.begin().await.map_err(db("begin task snapshot"))?;
        let sql = format!("SELECT t.id, t.goal_id, t.objective, t.profile_id, t.owned_paths_json, t.dependencies_json, t.status, t.attempts, t.escalations, t.created_at, t.updated_at FROM continuous_tasks t {clause}");
        let row: Option<TaskRow> = sqlx::query_as(&sql)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db("read continuous task"))?;
        match row {
            Some(row) => {
                let id = row.id.clone();
                let claim = sqlx::query_as("SELECT id AS task_id, claim_owner AS owner, claim_fence AS fence, claimed_at, lease_expires_at FROM continuous_tasks WHERE id=? AND claim_owner IS NOT NULL")
                    .bind(&id).fetch_optional(&mut *tx).await.map_err(db("read task claim"))?;
                let assignment = super::team_assignments::read(&mut tx, &id).await?;
                Ok(Some(row.into_task(claim, assignment)?))
            }
            None => Ok(None),
        }
    }
    pub(super) async fn require_project(&self, project_id: &str) -> Result<(), String> {
        if self.get_project(project_id).await?.is_some() {
            Ok(())
        } else {
            Err(format!("unknown project: {project_id}"))
        }
    }
}

async fn event(
    tx: &mut SqliteConnection,
    project_id: &str,
    kind: &str,
    detail: &str,
    now: i64,
) -> Result<(), String> {
    sqlx::query("INSERT INTO continuous_events(project_id, kind, detail, created_at) VALUES(?1, ?2, ?3, ?4)").bind(project_id).bind(kind).bind(detail).bind(now).execute(&mut *tx).await.map_err(db("write continuous event"))?;
    sqlx::query("INSERT INTO continuous_context_snapshots(project_id, source_timestamp, commit_sha, run_id) VALUES(?1, ?2, NULL, NULL) ON CONFLICT(project_id) DO UPDATE SET source_timestamp = excluded.source_timestamp")
        .bind(project_id).bind(now).execute(&mut *tx).await.map_err(db("stamp continuous snapshot"))?;
    Ok(())
}
fn db(label: &'static str) -> impl FnOnce(sqlx::Error) -> String {
    move |e| format!("{label}: {e}")
}
/// Opens a transaction that holds SQLite's writer lock from its first
/// statement (`BEGIN IMMEDIATE`). Every writer here reads before it writes;
/// under a deferred `BEGIN` the first `SELECT` opens a read transaction, and
/// SQLite runs the busy handler only while *no* transaction is open
/// (`btreeBeginTrans` in sqlite3.c: the retry loop requires
/// `inTransaction == TRANS_NONE`). The later read-to-write upgrade then
/// fails at once with `(code: 5) database is locked` whenever another
/// connection holds the lock, and `busy_timeout` never engages. Taking the
/// lock at `BEGIN` puts the wait where the busy handler does run.
async fn begin_write(
    pool: &SqlitePool,
    label: &'static str,
) -> Result<Transaction<'static, Sqlite>, String> {
    pool.begin_with("BEGIN IMMEDIATE").await.map_err(db(label))
}
/// Commits `tx` on `Ok`, explicitly rolls it back on `Err`; `label` names
/// the commit in its error.
///
/// Dropping an open [`Transaction`] instead only *queues* the ROLLBACK on
/// the connection's worker thread (`sqlx-core` 0.8.6 `Transaction::drop` ->
/// `start_rollback`). The connection itself does not re-enter the pool
/// before that ROLLBACK: `PoolConnection::drop` spawns `return_to_pool`,
/// which pings the worker first, and the ping queues behind it. But the
/// caller has already returned, and its next transaction takes a
/// *different* pooled connection while the old worker thread - under load
/// not yet scheduled - still holds the writer lock. Settling here releases
/// the lock before the caller continues, not whenever that thread runs.
async fn settle<T>(
    tx: Transaction<'_, Sqlite>,
    result: Result<T, String>,
    label: &'static str,
) -> Result<T, String> {
    match result {
        Ok(value) => {
            tx.commit().await.map_err(db(label))?;
            Ok(value)
        }
        Err(err) => {
            // If ROLLBACK itself fails, the sqlx worker for this connection
            // is left with transaction_depth == 1 (worker.rs never sees the
            // matching decrement). A later BEGIN IMMEDIATE on that same
            // connection would then fail with InvalidSavePointStatement, so
            // surface the rollback error instead of swallowing it.
            if let Err(rollback_err) = tx.rollback().await {
                return Err(format!("{err}; rollback failed: {rollback_err}"));
            }
            Err(err)
        }
    }
}
fn required_text(value: &str, field: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        Err(format!("{field} is required"))
    } else {
        Ok(value.to_string())
    }
}
pub(super) async fn read_event_page(
    tx: &mut Transaction<'_, Sqlite>,
    project_id: &str,
    after_cursor: i64,
) -> Result<(Vec<ContinuousEvent>, bool), String> {
    let mut events: Vec<ContinuousEvent> = sqlx::query_as("SELECT cursor, kind, detail, created_at FROM continuous_events WHERE project_id = ? AND cursor > ? ORDER BY cursor LIMIT 201")
        .bind(project_id).bind(after_cursor).fetch_all(&mut **tx).await.map_err(db("list continuous events"))?;
    let has_more = events.len() > 200;
    events.truncate(200);
    Ok((events, has_more))
}

fn normalize_ids(values: Vec<String>, field: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for value in values {
        let value = required_text(&value, field)?;
        if !out.contains(&value) {
            out.push(value);
        }
    }
    Ok(out)
}
fn normalize_scopes(values: Vec<String>) -> Result<Vec<String>, String> {
    if values.is_empty() {
        return Err("ownedPaths is required to make task ownership explicit".to_string());
    }
    let mut out = Vec::new();
    for raw in values {
        let mut value = required_text(&raw, "ownedPaths")?.replace('\\', "/");
        while value.ends_with('/') {
            value.pop();
        }
        if value.is_empty()
            || value.starts_with('/')
            || value.contains(':')
            || value
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
        {
            return Err(format!(
                "ownedPaths must be a relative normalized workspace path: {value}"
            ));
        }
        if FOUR_SEAMS.iter().any(|seam| {
            value
                .to_ascii_lowercase()
                .starts_with(&(seam.to_string() + "/"))
        }) {
            return Err("ownedPaths cannot name descendants of a protected source file".into());
        }
        if !out
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(&value))
        {
            out.push(value);
        }
    }
    Ok(out)
}
fn scopes_conflict(left: &str, right: &str) -> bool {
    // v4 stored a sentinel and lost the original declaration. Conservatively
    // retain the entire backend scope for those old locks until completion.
    let left = if left == FOUR_SEAM_LOCK {
        "src-tauri/src"
    } else {
        left
    };
    let right = if right == FOUR_SEAM_LOCK {
        "src-tauri/src"
    } else {
        right
    };
    let left = left.to_ascii_lowercase();
    let right = right.to_ascii_lowercase();
    let owns_seam = |path: &str| {
        FOUR_SEAMS.iter().any(|seam| {
            *seam == path
                || seam
                    .strip_prefix(path)
                    .is_some_and(|rest| rest.starts_with('/'))
        })
    };
    (owns_seam(&left) && owns_seam(&right))
        || left == right
        || left
            .strip_prefix(&right)
            .is_some_and(|rest| rest.starts_with('/'))
        || right
            .strip_prefix(&left)
            .is_some_and(|rest| rest.starts_with('/'))
}
fn is_terminal(status: &str) -> bool {
    matches!(status, TASK_COMPLETED | TASK_CANCELLED | TASK_FAILED)
}

#[cfg(test)]
#[path = "continuous_capacity_tests.rs"]
mod capacity_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;
    use crate::testutil::TempDir;

    pub(super) async fn store() -> (TempDir, Store, String) {
        let dir = TempDir::new("continuous-store");
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        std::fs::write(
            dir.path().join(development_policy::POLICY_FILE),
            serde_json::to_vec(&DevelopmentPolicy::defaults()).unwrap(),
        )
        .unwrap();
        let project = store
            .create_project("P", dir.path().to_str().unwrap())
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO continuous_projects(project_id, status, updated_at) VALUES(?1, ?2, 0)",
        )
        .bind(&project.id)
        .bind(CONTINUOUS_ENABLED)
        .execute(&store.pool)
        .await
        .unwrap();
        (dir, store, project.id)
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn event_pages_report_overflow_without_skipping_project_events() {
        let (dir, store, project) = store().await;
        for n in 0..201 {
            sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'test',?,1)")
                .bind(&project).bind(n.to_string()).execute(&store.pool).await.unwrap();
            sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES('foreign','private','not visible',1)")
                .execute(&store.pool).await.unwrap();
        }
        let first = store.continuous_context(&project, 0).await.unwrap();
        assert_eq!(first.events.len(), 200);
        assert_eq!(serde_json::to_value(&first).unwrap()["hasMore"], true);
        let last = store
            .continuous_context(&project, first.cursor)
            .await
            .unwrap();
        assert_eq!(last.events.len(), 1);
        assert_eq!(last.events[0].detail, "200");
        assert_eq!(serde_json::to_value(&last).unwrap()["hasMore"], false);
        assert!(last.cursor > first.cursor);
        assert!(first.events.iter().all(|event| event.kind == "test"));
        let delta = store.continuous_changes(&project, 0).await.unwrap();
        assert_eq!(
            delta["events"],
            serde_json::to_value(&first.events).unwrap()
        );
        assert_eq!(delta["cursor"], first.cursor);
        assert_eq!(delta["hasMore"], true);
        for omitted in ["goals", "tasks", "effectiveLimits", "snapshot"] {
            assert!(delta.get(omitted).is_none());
        }
        let tail = store
            .continuous_changes(&project, first.cursor)
            .await
            .unwrap();
        assert_eq!(tail["events"].as_array().unwrap().len(), 1);
        assert_eq!(tail["cursor"], last.cursor);
        let empty = store
            .continuous_changes(&project, last.cursor)
            .await
            .unwrap();
        assert_eq!(empty["cursor"], last.cursor);
        assert_eq!(empty["hasMore"], false);
        assert!(empty["events"].as_array().unwrap().is_empty());
        assert!(store.continuous_changes(&project, -1).await.is_err());
        assert!(store
            .continuous_changes("unknown-project", 0)
            .await
            .is_err());
        store.pool.close().await;
        let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        assert_eq!(
            reopened
                .continuous_changes(&project, first.cursor)
                .await
                .unwrap()["events"],
            tail["events"]
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn root_policy_survives_config_changes_and_replanning() {
        let (dir, store, _) = store().await;
        let project = store
            .create_project("bounded", dir.path().to_str().unwrap())
            .await
            .unwrap();
        let mut policy = DevelopmentPolicy::defaults();
        policy.continuous.max_tasks_per_goal = 1;
        policy.continuous.goal_minutes = 2;
        let path = dir.path().join(development_policy::POLICY_FILE);
        std::fs::write(&path, serde_json::to_vec(&policy).unwrap()).unwrap();
        let before = now_unix_secs();
        let goal = store
            .create_continuous_goal(&project.id, "bounded", None, None, true)
            .await
            .unwrap();
        assert!(goal.deadline_at >= before + 120 && goal.deadline_at <= now_unix_secs() + 120);
        store
            .create_continuous_task(&goal.id, "one", None, vec!["one.rs".into()], vec![])
            .await
            .unwrap();
        std::fs::write(
            &path,
            serde_json::to_vec(&DevelopmentPolicy::defaults()).unwrap(),
        )
        .unwrap();
        let child = store
            .create_continuous_goal(&project.id, "replan", None, Some(goal.id.clone()), true)
            .await
            .unwrap();
        assert_eq!(child.deadline_at, goal.deadline_at);
        assert!(store
            .create_continuous_task(&child.id, "two", None, vec!["two.rs".into()], vec![])
            .await
            .unwrap_err()
            .contains("budget exhausted"));
        let context = store.continuous_context(&project.id, 0).await.unwrap();
        assert_eq!(
            context.effective_limits["rootPolicies"][0]["policy"]["continuous"]["maxTasksPerGoal"],
            1
        );
        std::fs::write(&path, "invalid").unwrap();
        assert!(store
            .create_continuous_goal(&project.id, "new draft", None, None, false)
            .await
            .is_err());
        // Existing roots retain the valid immutable policy even when the file breaks.
        assert!(store.continuous_context(&project.id, 0).await.is_ok());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn retry_keeps_scopes_and_counters_and_rejects_stale_fences() {
        let (_dir, store, project) = store().await;
        let goal = store
            .create_continuous_goal(&project, "retry", None, None, true)
            .await
            .unwrap();
        let task = store
            .create_continuous_task(&goal.id, "task", None, vec!["src/retry.rs".into()], vec![])
            .await
            .unwrap();
        let mut last_fence = 0;
        for attempt in 1..=3 {
            let claim = store
                .claim_continuous_task(&task.id, "owner", attempt == 2)
                .await
                .unwrap();
            assert!(claim.fence > last_fence);
            assert!(store
                .checkpoint_continuous_task(&task.id, "owner", last_fence, Some("retry"), None)
                .await
                .is_err());
            let run = store
                .record_development_run_intent(&task.id, "owner", claim.fence)
                .await
                .unwrap();
            assert!(store
                .checkpoint_continuous_task(&task.id, "owner", claim.fence, Some("retry"), None)
                .await
                .is_err());
            store
                .fail_development_run(&run.id, "owner", claim.fence, "verified attempt failure")
                .await
                .unwrap();
            let next = store
                .checkpoint_continuous_task(&task.id, "owner", claim.fence, Some("retry"), None)
                .await
                .unwrap();
            assert_eq!(next.attempts, attempt);
            assert_eq!(
                next.status,
                if attempt == 3 { TASK_FAILED } else { TASK_OPEN }
            );
            let (locks,): (i64,) =
                sqlx::query_as("SELECT COUNT(*) FROM continuous_scope_locks WHERE task_id = ?")
                    .bind(&task.id)
                    .fetch_one(&store.pool)
                    .await
                    .unwrap();
            assert_eq!(locks, if attempt == 3 { 0 } else { 1 });
            last_fence = claim.fence;
        }
        assert!(store
            .claim_continuous_task(&task.id, "owner", false)
            .await
            .is_err());
        let task = store.get_continuous_task(&task.id).await.unwrap().unwrap();
        assert_eq!(task.attempts, 3);
        assert_eq!(task.escalations, 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn claims_respect_frozen_worker_and_escalation_limits() {
        let (dir, store, _) = store().await;
        let project = store
            .create_project("limited", dir.path().to_str().unwrap())
            .await
            .unwrap();
        let mut policy = DevelopmentPolicy::defaults();
        policy.continuous.max_workers = 1;
        policy.continuous.max_escalations = 0;
        std::fs::write(
            dir.path().join(development_policy::POLICY_FILE),
            serde_json::to_vec(&policy).unwrap(),
        )
        .unwrap();
        sqlx::query("INSERT INTO continuous_projects VALUES(?, 'enabled', 0)")
            .bind(&project.id)
            .execute(&store.pool)
            .await
            .unwrap();
        let goal = store
            .create_continuous_goal(&project.id, "work", None, None, true)
            .await
            .unwrap();
        let a = store
            .create_continuous_task(&goal.id, "a", None, vec!["a.rs".into()], vec![])
            .await
            .unwrap();
        let b = store
            .create_continuous_task(&goal.id, "b", None, vec!["b.rs".into()], vec![])
            .await
            .unwrap();
        assert!(store
            .claim_continuous_task(&a.id, "worker", true)
            .await
            .unwrap_err()
            .contains("escalation budget"));
        store
            .claim_continuous_task(&a.id, "worker", false)
            .await
            .unwrap();
        assert!(store
            .claim_continuous_task(&b.id, "other", false)
            .await
            .unwrap_err()
            .contains("capacity"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn unresolved_run_keeps_ownership_until_reconciled() {
        let (_dir, store, project) = store().await;
        let goal = store
            .create_continuous_goal(&project, "goal", None, None, true)
            .await
            .unwrap();
        let task = store
            .create_continuous_task(&goal.id, "task", None, vec!["src/a.rs".into()], vec![])
            .await
            .unwrap();
        let claim = store
            .claim_continuous_task(&task.id, "owner", false)
            .await
            .unwrap();
        let run = store
            .record_development_run_intent(&task.id, "owner", claim.fence)
            .await
            .unwrap();
        assert!(store
            .checkpoint_continuous_task(&task.id, "owner", claim.fence, Some("completed"), None)
            .await
            .unwrap_err()
            .contains("unresolved"));
        assert!(store
            .control_continuous(&project, "cancel")
            .await
            .unwrap_err()
            .contains("unresolved"));
        store
            .fail_development_run(&run.id, "owner", claim.fence, "launch never occurred")
            .await
            .unwrap();
        store
            .checkpoint_continuous_task(&task.id, "owner", claim.fence, Some("failed"), None)
            .await
            .unwrap();
        store.control_continuous(&project, "cancel").await.unwrap();
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn concurrent_claims_have_one_winner_and_a_fence() {
        let (_dir, store, project) = store().await;
        let goal = store
            .create_continuous_goal(&project, "ship", None, None, true)
            .await
            .unwrap();
        let task = store
            .create_continuous_task(&goal.id, "implement", None, vec!["src/x.rs".into()], vec![])
            .await
            .unwrap();
        let a = store.clone();
        let b = store.clone();
        let id_a = task.id.clone();
        let id_b = task.id.clone();
        let (first, second) = tokio::join!(
            a.claim_continuous_task(&id_a, "a", false),
            b.claim_continuous_task(&id_b, "b", false)
        );
        assert!(first.is_ok() ^ second.is_ok());
        assert_eq!(first.or(second).unwrap().fence, 1);
    }
    #[test]
    fn protected_scopes_are_normalized_without_file_descendants() {
        assert!(normalize_scopes(vec!["SRC-TAURI/src/API.rs/fake".into()]).is_err());
        assert!(normalize_scopes(vec!["C:relative".into()]).is_err());
        let ancestor = normalize_scopes(vec!["src-tauri/src".into()]).unwrap();
        let seam = normalize_scopes(vec!["src-tauri/src/main.rs".into()]).unwrap();
        assert!(scopes_conflict(&ancestor[0], &seam[0]));
        assert!(scopes_conflict(&seam[0], &ancestor[0]));
        assert!(scopes_conflict(&ancestor[0], "src-tauri/src/queue.rs"));
        assert_eq!(seam[0], "src-tauri/src/main.rs");
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn draft_admission_is_refused_and_cancel_releases_root_admission() {
        let (_dir, store, project) = store().await;
        let draft = store
            .create_continuous_goal(&project, "draft", None, None, false)
            .await
            .unwrap();
        assert!(store
            .create_continuous_goal(&project, "child", None, Some(draft.id), true)
            .await
            .is_err());
        store
            .create_continuous_goal(&project, "active", None, None, true)
            .await
            .unwrap();
        store.control_continuous(&project, "cancel").await.unwrap();
        assert!(store
            .list_continuous_goals(&project)
            .await
            .unwrap()
            .iter()
            .all(|goal| goal.status == "cancelled"));
        assert!(store
            .create_continuous_goal(&project, "fresh", None, None, true)
            .await
            .is_ok());
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn stale_fence_cannot_complete_claim_and_expiry_does_not_reclaim() {
        let (_dir, store, project) = store().await;
        let goal = store
            .create_continuous_goal(&project, "ship", None, None, true)
            .await
            .unwrap();
        let task = store
            .create_continuous_task(&goal.id, "implement", None, vec!["src/x.rs".into()], vec![])
            .await
            .unwrap();
        let claim = store
            .claim_continuous_task(&task.id, "a", false)
            .await
            .unwrap();
        sqlx::query("UPDATE continuous_tasks SET lease_expires_at = 0 WHERE id = ?1")
            .bind(&task.id)
            .execute(&store.pool)
            .await
            .unwrap();
        assert!(store
            .claim_continuous_task(&task.id, "b", false)
            .await
            .is_err());
        assert!(store
            .checkpoint_continuous_task(&task.id, "a", claim.fence + 1, Some(TASK_COMPLETED), None)
            .await
            .is_err());
        assert_eq!(
            store
                .checkpoint_continuous_task(&task.id, "a", claim.fence, Some(TASK_COMPLETED), None)
                .await
                .unwrap()
                .status,
            TASK_COMPLETED
        );
        let before = store.continuous_context(&project, 0).await.unwrap();
        assert!(store
            .checkpoint_continuous_task(&task.id, "a", claim.fence, Some(TASK_COMPLETED), None)
            .await
            .is_err());
        assert!(store
            .checkpoint_continuous_task(
                &task.id,
                "intruder",
                claim.fence + 1,
                Some(TASK_COMPLETED),
                None
            )
            .await
            .is_err());
        let after = store
            .continuous_context(&project, before.cursor)
            .await
            .unwrap();
        assert!(after.events.is_empty());
        assert_eq!(after.tasks[0].status, TASK_COMPLETED);
        assert_eq!(after.goals[0].status, "awaiting_review");
        assert!(store
            .create_continuous_task(&goal.id, "late", None, vec!["late".into()], vec![])
            .await
            .is_err());
        assert!(store
            .create_continuous_goal(&project, "late replan", None, Some(goal.id), true)
            .await
            .is_err());
    }
    /// The CI symptom of `.pa/report_w1-25.md`, Fall 1, made deterministic.
    /// Another connection holds SQLite's writer lock - here on purpose, in
    /// CI a dropped transaction whose queued ROLLBACK had not run yet - and
    /// releases it after ~200 ms. A checkpoint with a valid fence must wait
    /// for that through `busy_timeout` (5 s) instead of failing at once
    /// with `(code: 5) database is locked`. It used to fail at once: a
    /// deferred `BEGIN` followed by a `SELECT` holds a read transaction, and
    /// SQLite runs the busy handler only while no transaction is open
    /// (`btreeBeginTrans`: the retry loop requires
    /// `inTransaction == TRANS_NONE`), so the later read-to-write upgrade
    /// returned SQLITE_BUSY without waiting.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_checkpoint_waits_for_a_foreign_writer_instead_of_failing_busy() {
        use sqlx::Connection as _;
        let (dir, store, project) = store().await;
        let goal = store
            .create_continuous_goal(&project, "ship", None, None, true)
            .await
            .unwrap();
        let task = store
            .create_continuous_task(&goal.id, "implement", None, vec!["src/x.rs".into()], vec![])
            .await
            .unwrap();
        let claim = store
            .claim_continuous_task(&task.id, "a", false)
            .await
            .unwrap();
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(dir.path().join("projecta.db"))
            .busy_timeout(std::time::Duration::from_secs(5));
        let (locked_tx, locked_rx) = tokio::sync::oneshot::channel();
        let task_id = task.id.clone();
        let holder = tokio::spawn(async move {
            let mut conn = sqlx::sqlite::SqliteConnection::connect_with(&options)
                .await
                .expect("open foreign connection");
            let mut tx = conn.begin().await.expect("begin foreign transaction");
            sqlx::query("UPDATE continuous_tasks SET updated_at = updated_at WHERE id = ?1")
                .bind(&task_id)
                .execute(&mut *tx)
                .await
                .expect("take the writer lock");
            locked_tx.send(()).expect("signal lock held");
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            tx.rollback().await.expect("release the writer lock");
        });
        locked_rx.await.expect("foreign writer holds the lock");
        let started = std::time::Instant::now();
        let result = store
            .checkpoint_continuous_task(&task.id, "a", claim.fence, Some(TASK_COMPLETED), None)
            .await;
        let elapsed = started.elapsed();
        holder.await.expect("foreign writer task");
        assert!(
            result.is_ok(),
            "checkpoint must wait for the foreign writer, not fail after {elapsed:?}: {result:?}"
        );
        assert_eq!(result.unwrap().status, TASK_COMPLETED);
        assert!(
            elapsed >= std::time::Duration::from_millis(150),
            "the checkpoint must have waited for the lock, took {elapsed:?}"
        );
    }
    /// A mechanism pin, not a regression test (see `.pa/report_w1-25.md`):
    /// a transaction that has written keeps SQLite's writer lock until it is
    /// settled, so a second connection cannot write meanwhile. That is the
    /// window `settle()` closes - a dropped transaction's queued ROLLBACK
    /// runs only when its worker thread is scheduled. The regression test
    /// for the CI failure is
    /// `a_checkpoint_waits_for_a_foreign_writer_instead_of_failing_busy`.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_unsettled_write_transaction_blocks_a_second_connections_write() {
        use sqlx::Connection as _;
        let dir = TempDir::new("continuous-unsettled-tx");
        let path = dir.path().join("lock.db");
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            // A short busy_timeout: the point is that a second connection
            // cannot make progress at all while the first's write is
            // unsettled, not how long it is willing to wait.
            .busy_timeout(std::time::Duration::from_millis(50));
        let mut holder = sqlx::sqlite::SqliteConnection::connect_with(&options)
            .await
            .expect("open holder connection");
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER NOT NULL)")
            .execute(&mut holder)
            .await
            .expect("create table");
        sqlx::query("INSERT INTO t (id, v) VALUES (1, 0)")
            .execute(&mut holder)
            .await
            .expect("seed row");
        // Begin a write transaction and leave it open - the same state a
        // dropped-but-not-yet-rolled-back `Transaction` leaves behind for
        // however long its queued rollback takes to actually run.
        let mut tx = sqlx::Connection::begin(&mut holder)
            .await
            .expect("begin holder transaction");
        sqlx::query("UPDATE t SET v = v WHERE id = 1")
            .execute(&mut *tx)
            .await
            .expect("write inside the held transaction");
        let mut second = sqlx::sqlite::SqliteConnection::connect_with(&options)
            .await
            .expect("open second connection");
        let result = sqlx::query("UPDATE t SET v = 1 WHERE id = 1")
            .execute(&mut second)
            .await;
        assert!(
            result.is_err(),
            "a second connection must not be able to write while the first's \
             transaction is still unsettled, committed or not: {result:?}"
        );
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn dependency_and_recreated_goal_budgets_are_refused() {
        let (_dir, store, project) = store().await;
        let goal = store
            .create_continuous_goal(&project, "ship", None, None, true)
            .await
            .unwrap();
        let first = store
            .create_continuous_task(&goal.id, "first", None, vec!["a".into()], vec![])
            .await
            .unwrap();
        assert!(store
            .create_continuous_task(
                &goal.id,
                "later",
                None,
                vec!["b".into()],
                vec![first.id.clone()]
            )
            .await
            .unwrap()
            .id
            .starts_with("ct-"));
        let second_goal = store
            .create_continuous_goal(
                &project,
                "reworded plan",
                None,
                Some(goal.id.clone()),
                false,
            )
            .await
            .unwrap();
        for index in 0..6 {
            store
                .create_continuous_task(
                    &second_goal.id,
                    &format!("task {index}"),
                    None,
                    vec![format!("other/{index}")],
                    vec![],
                )
                .await
                .unwrap();
        }
        assert!(store
            .create_continuous_task(
                &second_goal.id,
                "ninth",
                None,
                vec!["other/ninth".into()],
                vec![]
            )
            .await
            .is_err());
        assert!(store
            .create_continuous_goal(&project, "unlinked autonomous root", None, None, true)
            .await
            .is_err());
        assert!(store
            .create_continuous_goal(
                &project,
                "reworded admitted replan",
                None,
                Some(goal.id.clone()),
                true,
            )
            .await
            .is_ok());
    }
}
