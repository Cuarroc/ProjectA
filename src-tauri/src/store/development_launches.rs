//! Durable identity and single-use authorization before worktree/process creation.
//! Existing reservations are never returned as permission to start again.
use super::{new_id, now_unix_secs, Store};
use crate::development_policy::DevelopmentPolicy;
use serde::Serialize;
use sqlx::{FromRow, Sqlite, SqliteConnection, Transaction};

/// The team role a run is dispatched in (W2-04). It is derived from the
/// migration-14 assignment, which `team_assignments` locks at the first claim,
/// so the role of a run cannot change after it exists and needs no second copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DispatchRole {
    Coordinator,
    Implementer,
    Reviewer,
    Integrator,
}

impl DispatchRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Coordinator => "coordinator",
            Self::Implementer => "implementer",
            Self::Reviewer => "reviewer",
            Self::Integrator => "integrator",
        }
    }

    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "coordinator" => Ok(Self::Coordinator),
            "implementer" => Ok(Self::Implementer),
            "reviewer" => Ok(Self::Reviewer),
            "integrator" => Ok(Self::Integrator),
            other => Err(format!("unknown dispatch role: {other}")),
        }
    }

    /// Only roles that change the tree submit an integration candidate.
    pub fn submits_candidate(self) -> bool {
        matches!(self, Self::Implementer | Self::Integrator)
    }
}

type RunRoleRow = (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

/// Resolves and re-validates the dispatch role of a run. Unassigned tasks keep
/// their pre-W2-04 meaning and dispatch as implementers, but only while some
/// team of the frozen root policy permits that role. An assignment whose
/// assignee is not the run owner, or whose team/role the frozen root policy
/// does not permit, authorizes nothing; a partial assignment row fails closed.
///
/// Invariant this relies on instead of a persisted copy: the only writer of
/// `continuous_team_assignments` is `Store::assign_continuous_task`, which
/// refuses once a task was claimed (`attempts != 0`; nothing resets attempts),
/// see `team_assignments::tests::
/// assignment_enforces_owner_and_survives_restart_without_reassigning_live_work`.
/// The policy is read live from `continuous_root_policies` at each dispatch
/// boundary, not from a per-run snapshot; it is "frozen" because that table is
/// keyed by root and written once at admission. Tests that rewrite it simulate
/// out-of-band drift to prove the boundary fails closed.
pub(super) async fn run_role(
    conn: &mut SqliteConnection,
    run_id: &str,
) -> Result<DispatchRole, String> {
    let row: Option<RunRoleRow> = sqlx::query_as("SELECT r.claim_owner, a.team_id, a.role, a.assignee, p.policy_json FROM development_runs r JOIN continuous_tasks t ON t.id = r.task_id JOIN continuous_goals g ON g.id = t.goal_id LEFT JOIN continuous_root_policies p ON p.root_goal_id = g.root_goal_id LEFT JOIN continuous_team_assignments a ON a.task_id = t.id WHERE r.id = ?")
        .bind(run_id).fetch_optional(&mut *conn).await.map_err(db)?;
    let Some((owner, team, role, assignee, policy)) = row else {
        return Err("unknown development run".into());
    };
    resolve_role(Some(&owner), team, role, assignee, policy)
}

/// The W2-04 decision on already-read rows. `owner` is the run's claim owner;
/// discovery dispatch (W2-05) passes `None` because no run exists yet and the
/// dispatch target is the assignee itself — the claim re-checks the owner.
pub(super) fn resolve_role(
    owner: Option<&str>,
    team: Option<String>,
    role: Option<String>,
    assignee: Option<String>,
    policy: Option<String>,
) -> Result<DispatchRole, String> {
    let policy = DevelopmentPolicy::parse(&policy.ok_or("dispatch root policy unavailable")?)?;
    let permitted = |team: Option<&str>, role: &str| {
        policy.teams.iter().any(|entry| {
            team.is_none_or(|team| entry.id == team) && entry.roles.iter().any(|r| r == role)
        })
    };
    let (team, role, assignee) = match (team, role, assignee) {
        (None, None, None) => {
            if !permitted(None, DispatchRole::Implementer.as_str()) {
                return Err("unassigned task dispatches as implementer, which the frozen root policy does not permit".into());
            }
            return Ok(DispatchRole::Implementer);
        }
        (Some(team), Some(role), Some(assignee)) => (team, role, assignee),
        _ => return Err("malformed team assignment row".into()),
    };
    let dispatch = DispatchRole::parse(&role)?;
    if owner.is_some_and(|owner| owner != assignee) {
        return Err(format!(
            "development run owner is not the assigned {}",
            dispatch.as_str()
        ));
    }
    if !permitted(Some(&team), &role) {
        return Err("team assignment conflicts with frozen root policy".into());
    }
    Ok(dispatch)
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DevelopmentLaunch {
    pub run_id: String,
    pub worker_id: String,
    pub project_id: String,
    pub profile_id: String,
    pub repo_path: String,
    pub worktree_path: String,
    pub branch: String,
    pub session_id: Option<String>,
    pub state: String,
    pub reserved_at: i64,
    pub spawning_at: Option<i64>,
    pub exited_at: Option<i64>,
    pub exit_code: Option<i32>,
    pub route_json: Option<String>,
    pub route_expires_at: Option<i64>,
    pub baseline_commit: Option<String>,
    pub process_instance: Option<String>,
    /// Set only together with `state = 'exited_undelivered'`.
    pub exit_reason: Option<String>,
}

// `exited_undelivered` is the terminal launch state of a provider that
// demonstrably exited before its task input was delivered. It is deliberately
// distinct from `exited`: every reader of `exited` assumes a confirmed
// delivery and stays fail-closed for this one.
const LAUNCH_STATE_CHECK: &str = "CHECK(state IN ('reserved','spawning','exited'))";
const LAUNCH_STATE_CHECK_UNDELIVERED: &str =
    "CHECK(state IN ('reserved','spawning','exited','exited_undelivered'))";

/// Adds the `exited_undelivered` terminal state and its `exit_reason`. SQLite
/// cannot alter a CHECK, so the table is rebuilt from its own stored definition
/// with exactly that constraint widened, then its indexes and triggers are
/// restored verbatim. No row changes state here.
pub(super) async fn apply_undelivered_exit_migration(
    tx: &mut Transaction<'_, Sqlite>,
) -> Result<(), String> {
    let table: String = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='development_launches'",
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(db)?;
    match (
        table.matches(LAUNCH_STATE_CHECK).count(),
        table.matches(LAUNCH_STATE_CHECK_UNDELIVERED).count(),
    ) {
        (1, 0) => {
            let dependents: Vec<String> = sqlx::query_scalar("SELECT sql FROM sqlite_master WHERE tbl_name='development_launches' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type, name")
                .fetch_all(&mut **tx).await.map_err(db)?;
            let widened = table.replace(LAUNCH_STATE_CHECK, LAUNCH_STATE_CHECK_UNDELIVERED);
            // Recreating under the same name (instead of RENAME) leaves triggers
            // of other tables that name this table untouched and valid.
            for statement in [
                "CREATE TABLE development_launches_undelivered_copy AS SELECT * FROM development_launches",
                "DROP TABLE development_launches",
                widened.as_str(),
                "INSERT INTO development_launches SELECT * FROM development_launches_undelivered_copy",
                "DROP TABLE development_launches_undelivered_copy",
            ] {
                sqlx::query(statement).execute(&mut **tx).await.map_err(db)?;
            }
            for statement in &dependents {
                sqlx::query(statement)
                    .execute(&mut **tx)
                    .await
                    .map_err(db)?;
            }
        }
        // Only a fixture that restamps user_version below this step re-enters
        // with the widened table; the constraint is already what this step makes.
        (0, 1) => {}
        _ => return Err("unexpected development launch state constraint".into()),
    }
    let has_reason: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('development_launches') WHERE name='exit_reason')",
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(db)?;
    if !has_reason {
        // IS/IS NOT, never =: a CHECK that evaluates to NULL passes in SQLite.
        sqlx::query("ALTER TABLE development_launches ADD COLUMN exit_reason TEXT CHECK(coalesce((exit_reason IS NULL AND state IS NOT 'exited_undelivered') OR (exit_reason IS 'provider_exited_before_input_delivery' AND state IS 'exited_undelivered' AND exit_code IS NOT NULL),0))")
            .execute(&mut **tx).await.map_err(db)?;
    }
    Ok(())
}

pub(super) async fn apply_baseline_migration(
    tx: &mut Transaction<'_, Sqlite>,
) -> Result<(), String> {
    // Existing launches deliberately stay NULL: observing their HEAD now would
    // mistake worker changes for the original checkout.
    sqlx::query("ALTER TABLE development_launches ADD COLUMN baseline_commit TEXT")
        .execute(&mut **tx)
        .await
        .map_err(db)?;
    sqlx::query("CREATE TRIGGER development_launch_baseline_journal AFTER UPDATE OF baseline_commit ON development_launches WHEN OLD.baseline_commit IS NOT NEW.baseline_commit BEGIN INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(NEW.project_id,'development_launch',json_object('version',1,'action','update','runId',NEW.run_id,'recordId',NEW.run_id),unixepoch()); END")
        .execute(&mut **tx).await.map_err(db)?;
    Ok(())
}

pub(super) async fn apply_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    sqlx::query("CREATE TABLE development_launches (run_id TEXT PRIMARY KEY REFERENCES development_runs(id), worker_id TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL, profile_id TEXT NOT NULL, repo_path TEXT NOT NULL, worktree_path TEXT NOT NULL UNIQUE, branch TEXT NOT NULL, session_id TEXT UNIQUE, state TEXT NOT NULL CHECK(state IN ('reserved','spawning','exited')), reserved_at INTEGER NOT NULL, spawning_at INTEGER, exited_at INTEGER, exit_code INTEGER)")
        .execute(&mut **tx).await.map_err(|e| format!("create development launch storage: {e}"))?;
    Ok(())
}

pub(super) async fn apply_route_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    sqlx::query("ALTER TABLE development_launches ADD COLUMN route_json TEXT")
        .execute(&mut **tx)
        .await
        .map_err(db)?;
    sqlx::query("ALTER TABLE development_launches ADD COLUMN route_expires_at INTEGER")
        .execute(&mut **tx)
        .await
        .map_err(db)?;
    Ok(())
}

impl Store {
    /// Trusted pre-spawn observation only. Not exposed through the agent API.
    pub async fn bind_development_launch_baseline(
        &self,
        run: &str,
        owner: &str,
        fence: i64,
        commit: &str,
    ) -> Result<(), String> {
        if !matches!(commit.len(), 40 | 64) || !commit.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("baseline must be a full Git commit ID".into());
        }
        let changed = sqlx::query("UPDATE development_launches SET baseline_commit = ? WHERE run_id = ? AND state = 'reserved' AND baseline_commit IS NULL AND EXISTS (SELECT 1 FROM development_runs r JOIN continuous_tasks t ON t.id = r.task_id WHERE r.id = development_launches.run_id AND r.status = 'intent' AND r.claim_owner = ? AND r.claim_fence = ? AND t.status = 'running' AND t.claim_owner = ? AND t.claim_fence = ?)")
            .bind(commit).bind(run).bind(owner).bind(fence).bind(owner).bind(fence)
            .execute(&self.pool).await.map_err(db)?;
        if changed.rows_affected() != 1 {
            return Err("baseline already recorded, stale or unauthorized".into());
        }
        Ok(())
    }

    /// Trusted launch service only; no worker or broad HTTP writer exposes this.
    pub async fn bind_development_launch_route(
        &self,
        run_id: &str,
        owner: &str,
        fence: i64,
        receipt: &serde_json::Value,
    ) -> Result<(), String> {
        let expires = receipt["expiresAt"]
            .as_i64()
            .filter(|value| *value > now_unix_secs())
            .ok_or("route evidence already expired")?;
        let profile = receipt["selection"]["resolved"]["profileId"]
            .as_str()
            .ok_or("route has no selected profile")?;
        let body = serde_json::to_string(receipt).map_err(|e| e.to_string())?;
        if body.len() > 32768 {
            return Err("route receipt too large".into());
        }
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await.map_err(db)?;
        let changed = sqlx::query("UPDATE development_launches SET route_json = ?, route_expires_at = ? WHERE run_id = ? AND profile_id = ? AND state = 'reserved' AND route_json IS NULL AND EXISTS (SELECT 1 FROM development_runs r JOIN continuous_tasks t ON t.id = r.task_id WHERE r.id = development_launches.run_id AND r.status = 'intent' AND r.claim_owner = ? AND r.claim_fence = ? AND t.claim_owner = ? AND t.claim_fence = ? AND t.status = 'running')")
            .bind(&body).bind(expires).bind(run_id).bind(profile).bind(owner).bind(fence).bind(owner).bind(fence).execute(&mut *tx).await.map_err(db)?;
        if changed.rows_affected() != 1 {
            return Err("route binding is stale, conflicting or already recorded".into());
        }
        super::development_identity::bind_unknown(&mut tx, run_id, receipt, &body).await?;
        tx.commit().await.map_err(db)?;
        Ok(())
    }
    /// Exactly one caller wins. Even a crash before process creation leaves a
    /// consumed reservation requiring reconciliation, never a retry permit.
    pub async fn reserve_development_launch(
        &self,
        run_id: &str,
        owner: &str,
        fence: i64,
        profile_id: &str,
    ) -> Result<DevelopmentLaunch, String> {
        if profile_id.trim().is_empty() {
            return Err("profileId is required".into());
        }
        let mut tx = self.pool.begin().await.map_err(db)?;
        // Acquire the writer before reading. Two coordinators cannot both
        // observe absence and upgrade competing deferred read transactions.
        let changed = sqlx::query("UPDATE development_runs SET updated_at = updated_at WHERE id = ? AND status = 'intent' AND claim_owner = ? AND claim_fence = ? AND EXISTS (SELECT 1 FROM continuous_tasks t WHERE t.id = development_runs.task_id AND t.status = 'running' AND t.claim_owner = ? AND t.claim_fence = ?)")
            .bind(run_id).bind(owner).bind(fence).bind(owner).bind(fence).execute(&mut *tx).await.map_err(db)?;
        if changed.rows_affected() != 1 {
            return Err("stale or unauthorized development launch claim".into());
        }
        require_admission(&mut tx, run_id).await?;
        run_role(&mut tx, run_id).await?;
        let (project_id, repo_path): (String, String) = sqlx::query_as("SELECT p.id, p.repo_path FROM development_runs r JOIN continuous_tasks t ON t.id = r.task_id JOIN continuous_goals g ON g.id = t.goal_id JOIN projects p ON p.id = g.project_id WHERE r.id = ?")
            .bind(run_id).fetch_one(&mut *tx).await.map_err(db)?;
        let worker_id = new_id("wk");
        let worktree_path = crate::worktree::worktree_path(&repo_path, &worker_id)?
            .to_string_lossy()
            .into_owned();
        let branch = crate::worktree::branch_for(&worker_id);
        let inserted = sqlx::query("INSERT INTO development_launches(run_id, worker_id, project_id, profile_id, repo_path, worktree_path, branch, state, reserved_at) VALUES(?, ?, ?, ?, ?, ?, ?, 'reserved', ?) ON CONFLICT(run_id) DO NOTHING")
            .bind(run_id).bind(&worker_id).bind(project_id).bind(profile_id).bind(repo_path).bind(worktree_path).bind(branch).bind(now_unix_secs())
            .execute(&mut *tx).await.map_err(db)?;
        if inserted.rows_affected() != 1 {
            return Err("development launch already reserved; reconcile before retry".into());
        }
        sqlx::query("UPDATE development_runs SET worker_id = ? WHERE id = ?")
            .bind(worker_id)
            .bind(run_id)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        let launch = sqlx::query_as("SELECT * FROM development_launches WHERE run_id = ?")
            .bind(run_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(launch)
    }

    /// Fallible pre-spawn boundary. The reserved session identity is committed
    /// before a child can exist, and this transition is deliberately not idempotent.
    pub async fn consume_development_launch(
        &self,
        run_id: &str,
        owner: &str,
        fence: i64,
        worker_id: &str,
        session_id: &str,
    ) -> Result<(), String> {
        if session_id.trim().is_empty() {
            return Err("sessionId is required".into());
        }
        let mut tx = self.pool.begin().await.map_err(db)?;
        sqlx::query("UPDATE development_runs SET updated_at = updated_at WHERE id = ?")
            .bind(run_id)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        require_admission(&mut tx, run_id).await?;
        run_role(&mut tx, run_id).await?;
        let receipt: Option<(Option<String>, Option<i64>)> = sqlx::query_as(
            "SELECT route_json, route_expires_at FROM development_launches WHERE run_id = ?",
        )
        .bind(run_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?;
        if !matches!(receipt, Some((Some(_), Some(expiry))) if expiry > now_unix_secs()) {
            return Err("development route missing or expired before process creation".into());
        }
        let baseline: Option<String> =
            sqlx::query_scalar("SELECT baseline_commit FROM development_launches WHERE run_id = ?")
                .bind(run_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(db)?;
        if baseline.is_none() {
            return Err("development worktree baseline missing before process creation".into());
        }
        super::development_budget::consume_worker(&mut tx, run_id).await?;
        let changed = sqlx::query("UPDATE development_launches SET state = 'spawning', session_id = ?, spawning_at = ?, process_instance = ? WHERE run_id = ? AND worker_id = ? AND state = 'reserved' AND route_json IS NOT NULL AND route_expires_at > ? AND EXISTS (SELECT 1 FROM development_runs r JOIN continuous_tasks t ON t.id = r.task_id WHERE r.id = development_launches.run_id AND r.status = 'intent' AND r.claim_owner = ? AND r.claim_fence = ? AND t.status = 'running' AND t.claim_owner = ? AND t.claim_fence = ?)")
            .bind(session_id).bind(now_unix_secs()).bind(new_id("process")).bind(run_id).bind(worker_id).bind(now_unix_secs()).bind(owner).bind(fence).bind(owner).bind(fence).execute(&mut *tx).await.map_err(db)?;
        if changed.rows_affected() != 1 {
            return Err(
                "development launch consumed, stale or unauthorized; reconcile before retry".into(),
            );
        }
        tx.commit().await.map_err(db)?;
        Ok(())
    }

    /// Trusted services ask this before acting on a run's behalf; the role is
    /// never taken from worker input.
    pub async fn development_run_role(&self, run_id: &str) -> Result<DispatchRole, String> {
        let mut conn = self.pool.acquire().await.map_err(db)?;
        run_role(&mut conn, run_id).await
    }

    pub async fn development_launch(
        &self,
        run_id: &str,
    ) -> Result<Option<DevelopmentLaunch>, String> {
        sqlx::query_as("SELECT * FROM development_launches WHERE run_id = ?")
            .bind(run_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(db)
    }
}

impl Store {
    pub async fn development_launch_for_worker(
        &self,
        worker_id: &str,
    ) -> Result<Option<DevelopmentLaunch>, String> {
        sqlx::query_as("SELECT * FROM development_launches WHERE worker_id = ?")
            .bind(worker_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(db)
    }

    /// Startup observes an unknown old process, not evidence that it is dead.
    pub async fn reconcile_development_worker(&self, worker_id: &str) -> Result<(), String> {
        sqlx::query("UPDATE development_runs SET status = 'reconciling', updated_at = ? WHERE worker_id = ? AND status IN ('intent', 'launched') AND EXISTS (SELECT 1 FROM development_launches l WHERE l.run_id = development_runs.id AND l.worker_id = ?)")
            .bind(now_unix_secs()).bind(worker_id).bind(worker_id).execute(&self.pool).await.map_err(db)?;
        Ok(())
    }

    /// Run once during startup before continuous admission. Includes launches
    /// interrupted before any worker row or worktree existed.
    pub async fn reconcile_interrupted_development_launches(&self) -> Result<u64, String> {
        let changed = sqlx::query("UPDATE development_runs SET status = 'reconciling', updated_at = ? WHERE status IN ('intent','launched') AND EXISTS (SELECT 1 FROM development_launches l WHERE l.run_id = development_runs.id)")
            .bind(now_unix_secs()).execute(&self.pool).await.map_err(db)?;
        Ok(changed.rows_affected())
    }

    /// Only the native exit hook submits this observation. A process exit is
    /// evidence for reconciliation, not proof that the task was accepted.
    pub async fn record_development_process_exit(
        &self,
        worker_id: &str,
        session_id: &str,
        code: Option<i32>,
    ) -> Result<Option<String>, String> {
        let mut tx = self.pool.begin().await.map_err(db)?;
        let row: Option<(String,)> = sqlx::query_as("UPDATE development_launches SET state = 'exited', exited_at = ?, exit_code = ? WHERE worker_id = ? AND session_id = ? AND state = 'spawning' RETURNING run_id")
            .bind(now_unix_secs()).bind(code).bind(worker_id).bind(session_id).fetch_optional(&mut *tx).await.map_err(db)?;
        if let Some((run_id,)) = &row {
            sqlx::query("UPDATE development_runs SET status = 'reconciling', terminal_detail = ?, updated_at = ? WHERE id = ? AND status IN ('intent','launched','reconciling')")
                .bind(format!("native PTY exit observed; exit code {code:?}; task acceptance pending"))
                .bind(now_unix_secs()).bind(run_id).execute(&mut *tx).await.map_err(db)?;
        }
        tx.commit().await.map_err(db)?;
        Ok(row.map(|(run_id,)| run_id))
    }
}

async fn require_admission(tx: &mut Transaction<'_, Sqlite>, run_id: &str) -> Result<(), String> {
    let (eligible,): (bool,) = sqlx::query_as("SELECT EXISTS (SELECT 1 FROM development_runs r JOIN continuous_tasks t ON t.id = r.task_id JOIN continuous_goals g ON g.id = t.goal_id JOIN continuous_goals root ON root.id = g.root_goal_id JOIN continuous_projects p ON p.project_id = g.project_id WHERE r.id = ? AND g.status = 'open' AND root.status = 'open' AND g.admitted = 1 AND root.admitted = 1 AND g.deadline_at > ? AND root.deadline_at > ? AND p.status = 'enabled')")
        .bind(run_id).bind(now_unix_secs()).bind(now_unix_secs()).fetch_one(&mut **tx).await.map_err(db)?;
    if !eligible {
        return Err("development launch admission paused, cancelled or expired".into());
    }
    Ok(())
}

fn db(error: sqlx::Error) -> String {
    format!("development launch storage: {error}")
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use crate::{development_policy::DevelopmentPolicy, testutil::TempDir};
    pub(crate) async fn bind_test_route(store: &Store, run: &str) {
        store
            .bind_development_launch_baseline(run, "owner", 1, &"a".repeat(40))
            .await
            .unwrap();
        store.bind_development_launch_route(run, "owner", 1, &serde_json::json!({"selection":{"resolved":{"profileId":"codex"}},"expiresAt":now_unix_secs()+600})).await.unwrap();
        store
            .reserve_development_tokens(
                "goal",
                "worker-budget",
                super::super::development_budget::BudgetPurpose::Implementation,
                1000,
                Some(run),
            )
            .await
            .unwrap();
    }

    pub(crate) async fn fixture() -> (TempDir, Store, String) {
        let dir = TempDir::new("launch-reservation");
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let project = store
            .create_project("launch", &dir.path().join("repo").to_string_lossy())
            .await
            .unwrap();
        sqlx::query("INSERT INTO continuous_projects(project_id, status, updated_at) VALUES(?, 'enabled', 1)").bind(&project.id).execute(&store.pool).await.unwrap();
        sqlx::query("INSERT INTO continuous_goals(id, project_id, root_goal_id, objective, status, deadline_at, admitted, created_at, updated_at) VALUES('goal', ?, 'goal', 'goal', 'open', 9999999999, 1, 1, 1)").bind(&project.id).execute(&store.pool).await.unwrap();
        sqlx::query("INSERT INTO continuous_root_policies(root_goal_id, policy_json, source, observed_at) VALUES('goal', ?, 'test', 1)").bind(serde_json::to_string(&DevelopmentPolicy::defaults()).unwrap()).execute(&store.pool).await.unwrap();
        sqlx::query("INSERT INTO continuous_tasks(id, goal_id, objective, owned_paths_json, dependencies_json, status, claim_owner, claim_fence, created_at, updated_at) VALUES('task', 'goal', 'task', '[]', '[]', 'running', 'owner', 1, 1, 1)").execute(&store.pool).await.unwrap();
        let run = store
            .record_development_run_intent("task", "owner", 1)
            .await
            .unwrap();
        (dir, store, run.id)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_checkpoint_ledger_starts_empty_without_invented_capture() {
        let (_dir, store, run) = fixture().await;
        let tables: i64 = sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('development_capture_owners','development_capture_checkpoints')")
            .fetch_one(&store.pool).await.unwrap();
        assert_eq!(
            tables, 2,
            "native checkpoints need durable authoritative tables"
        );
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM development_capture_owners WHERE run_id=?")
                .bind(&run)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(count, 0, "migration cannot invent capture ownership");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn delivery_intent_is_single_use_fenced_durable_and_never_implies_input_completion() {
        use sha2::{Digest, Sha256};
        let (dir, store, run) = fixture().await;
        let launch = store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .unwrap();
        bind_test_route(&store, &run).await;
        assert!(store
            .begin_development_delivery(&run, "owner", 1, "session", b"task")
            .await
            .is_err());
        store
            .consume_development_launch(&run, "owner", 1, &launch.worker_id, "session")
            .await
            .unwrap();
        let instance = store
            .development_launch(&run)
            .await
            .unwrap()
            .unwrap()
            .process_instance
            .unwrap();
        for (owner, fence, session) in [
            ("wrong", 1, "session"),
            ("owner", 2, "session"),
            ("owner", 1, "wrong"),
        ] {
            assert!(store
                .begin_development_delivery(&run, owner, fence, session, b"task")
                .await
                .is_err());
        }
        let (a, b) = tokio::join!(
            store.begin_development_delivery(&run, "owner", 1, "session", b"task"),
            store.begin_development_delivery(&run, "owner", 1, "session", b"task")
        );
        assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
        let receipt = a.or(b).unwrap();
        assert_eq!(receipt.process_instance, instance);
        assert_eq!(
            receipt.input_sha256,
            format!("{:x}", Sha256::digest(b"task"))
        );
        assert_eq!(receipt.input_bytes, 4);
        assert_eq!(receipt.state, "started");
        assert!(receipt.enqueued_at.is_none());
        store.pool.close().await;
        let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        assert_eq!(
            reopened
                .development_delivery(&run)
                .await
                .unwrap()
                .unwrap()
                .state,
            "started"
        );
        for input in [b"task".as_slice(), b"replacement".as_slice()] {
            assert!(reopened
                .begin_development_delivery(&run, "owner", 1, "session", input)
                .await
                .is_err());
        }
        reopened
            .record_development_delivery_enqueued(&receipt)
            .await
            .unwrap();
        assert!(reopened
            .record_development_delivery_enqueued(&receipt)
            .await
            .is_err());
        let context = reopened.agent_run_context(&run, "owner", 1).await.unwrap();
        assert_eq!(context["delivery"]["state"], "enqueued");
        assert!(context["delivery"]["completedAt"].is_null());
        assert_eq!(
            reopened
                .reconcile_interrupted_development_launches()
                .await
                .unwrap(),
            1
        );
        assert!(reopened
            .begin_development_delivery(&run, "owner", 1, "session", b"task")
            .await
            .is_err());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn schema16_spawning_launch_does_not_acquire_invented_process_evidence() {
        let (dir, store, run) = fixture().await;
        let launch = store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .unwrap();
        bind_test_route(&store, &run).await;
        store
            .consume_development_launch(&run, "owner", 1, &launch.worker_id, "old-session")
            .await
            .unwrap();
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
            "PRAGMA user_version=16",
        ] {
            sqlx::query(statement).execute(&store.pool).await.unwrap();
        }
        store.pool.close().await;
        let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let observed = reopened.development_launch(&run).await.unwrap().unwrap();
        assert_eq!(observed.state, "spawning");
        assert_eq!(observed.session_id.as_deref(), Some("old-session"));
        assert!(observed.process_instance.is_none());
        assert!(reopened.development_delivery(&run).await.unwrap().is_none());
        assert!(reopened
            .begin_development_delivery(&run, "owner", 1, "old-session", b"task")
            .await
            .is_err());
        assert!(reopened
            .consume_development_launch(&run, "owner", 1, &launch.worker_id, "new-session")
            .await
            .is_err());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn schema15_upgrade_keeps_old_launch_identity_without_inventing_baseline() {
        let (dir, store, run) = fixture().await;
        let launch = store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .unwrap();
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
        ] {
            sqlx::query(statement).execute(&store.pool).await.unwrap();
        }
        sqlx::query("DROP TRIGGER development_launch_baseline_journal")
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("ALTER TABLE development_launches DROP COLUMN baseline_commit")
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("PRAGMA user_version = 15")
            .execute(&store.pool)
            .await
            .unwrap();
        drop(store);
        let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let preserved = reopened.development_launch(&run).await.unwrap().unwrap();
        assert_eq!(preserved.worker_id, launch.worker_id);
        assert_eq!(preserved.worktree_path, launch.worktree_path);
        assert_eq!(preserved.baseline_commit, None);
        assert_eq!(
            reopened.user_version().await.unwrap(),
            super::super::target_schema_version()
        );
        reopened.bind_development_launch_route(&run, "owner", 1, &serde_json::json!({"selection":{"resolved":{"profileId":"codex"}},"expiresAt":now_unix_secs()+600})).await.unwrap();
        assert!(reopened
            .consume_development_launch(&run, "owner", 1, &launch.worker_id, "session")
            .await
            .unwrap_err()
            .contains("baseline missing"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn baseline_is_required_immutable_fenced_and_durable() {
        let (dir, store, run) = fixture().await;
        let launch = store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .unwrap();
        store.bind_development_launch_route(&run, "owner", 1, &serde_json::json!({"selection":{"resolved":{"profileId":"codex"}},"expiresAt":now_unix_secs()+600})).await.unwrap();
        assert!(store
            .consume_development_launch(&run, "owner", 1, &launch.worker_id, "session")
            .await
            .unwrap_err()
            .contains("baseline missing"));
        assert!(store
            .bind_development_launch_baseline(&run, "owner", 2, &"a".repeat(40))
            .await
            .is_err());
        assert!(store
            .bind_development_launch_baseline(&run, "owner", 1, "HEAD")
            .await
            .is_err());
        store
            .bind_development_launch_baseline(&run, "owner", 1, &"a".repeat(40))
            .await
            .unwrap();
        assert!(store
            .bind_development_launch_baseline(&run, "owner", 1, &"b".repeat(40))
            .await
            .is_err());
        drop(store);
        let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        assert_eq!(
            reopened
                .development_launch(&run)
                .await
                .unwrap()
                .unwrap()
                .baseline_commit,
            Some("a".repeat(40))
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn reservation_identity_cannot_be_replaced_and_pre_worker_crashes_are_reconciled() {
        let (_dir, store, run) = fixture().await;
        let launch = store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .unwrap();
        bind_test_route(&store, &run).await;
        assert!(store
            .mark_development_run_launched(&run, "owner", 1, Some(&launch.worker_id), None)
            .await
            .is_err());
        store
            .consume_development_launch(&run, "owner", 1, &launch.worker_id, "session")
            .await
            .unwrap();
        let consumed = store.development_launch(&run).await.unwrap().unwrap();
        assert!(
            serde_json::to_value(&consumed).unwrap()["processInstance"]
                .as_str()
                .is_some(),
            "consuming a launch must durably bind a unique process attempt before spawn"
        );
        assert!(store
            .mark_development_run_launched(&run, "owner", 1, Some("different-worker"), None)
            .await
            .is_err());
        assert_eq!(
            store
                .reconcile_interrupted_development_launches()
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            store
                .reconcile_interrupted_development_launches()
                .await
                .unwrap(),
            0
        );
        assert_eq!(
            store.agent_run_context(&run, "owner", 1).await.unwrap()["run"]["status"],
            "reconciling"
        );
        assert!(store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .is_err());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn route_receipt_is_bound_once_and_expiry_blocks_consumption() {
        let (_dir, store, run) = fixture().await;
        let launch = store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .unwrap();
        let receipt = serde_json::json!({"selection":{"resolved":{"profileId":"codex"}},"expiresAt":now_unix_secs()+60});
        assert!(store
            .consume_development_launch(&run, "owner", 1, &launch.worker_id, "without-route")
            .await
            .is_err());
        assert!(store
            .bind_development_launch_route(&run, "owner", 2, &receipt)
            .await
            .is_err());
        store
            .bind_development_launch_route(&run, "owner", 1, &receipt)
            .await
            .unwrap();
        assert!(store
            .bind_development_launch_route(&run, "owner", 1, &receipt)
            .await
            .is_err());
        let stored = store.development_launch(&run).await.unwrap().unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&stored.route_json.unwrap()).unwrap(),
            receipt
        );
        sqlx::query("UPDATE development_launches SET route_expires_at = 1 WHERE run_id = ?")
            .bind(&run)
            .execute(&store.pool)
            .await
            .unwrap();
        assert!(store
            .consume_development_launch(&run, "owner", 1, &launch.worker_id, "session")
            .await
            .unwrap_err()
            .contains("expired"));
        assert_eq!(
            store.development_launch(&run).await.unwrap().unwrap().state,
            "reserved"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn route_binding_persists_distinct_configured_identity_and_unknown_history() {
        let (dir, store, run) = fixture().await;
        store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .unwrap();
        let receipt = serde_json::json!({
            "selection": {
                "requested": {"requestedModel": "requested-alias"},
                "resolved": {"profileId": "codex", "provider": "codex",
                    "candidateFamily": {"status": "observed", "family": "prior-family"}}
            },
            "invocationModel": "configured-for-run",
            "expiresAt": now_unix_secs() + 600
        });
        store
            .bind_development_launch_route(&run, "owner", 1, &receipt)
            .await
            .unwrap();
        let project_id: String =
            sqlx::query_scalar("SELECT project_id FROM development_launches WHERE run_id = ?")
                .bind(&run)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        let snapshot = store
            .development_records_snapshot(&project_id)
            .await
            .unwrap();
        let identity = &snapshot["runs"][0]["executionIdentity"];
        assert_eq!(identity["state"], "recorded");
        assert_eq!(identity["identity"]["runId"], run);
        assert_eq!(
            identity["identity"]["requested"]["model"],
            "requested-alias"
        );
        assert!(identity["identity"]["requested"]["provider"].is_null());
        assert_eq!(identity["identity"]["configured"]["provider"], "codex");
        assert_eq!(
            identity["identity"]["configured"]["model"],
            "configured-for-run"
        );
        assert!(identity["identity"]["configured"]["family"].is_null());
        assert!(identity["identity"]["adapter"].is_null());
        assert!(identity["identity"]["uiProfileId"].is_null());
        assert_eq!(identity["history"][0]["observation"]["status"], "unknown");
        assert_eq!(identity["assessment"], "unknown");
        let context = store.agent_run_context(&run, "owner", 1).await.unwrap();
        assert_eq!(context["executionIdentity"], *identity);
        let stable_id = identity["identity"]["id"].as_str().unwrap().to_owned();
        store.pool.close().await;
        let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let again = reopened
            .development_records_snapshot(&project_id)
            .await
            .unwrap();
        assert_eq!(
            again["runs"][0]["executionIdentity"]["identity"]["id"],
            stable_id
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn identity_snapshots_are_project_isolated() {
        let (dir, store, first_run) = fixture().await;
        let first_project: String =
            sqlx::query_scalar("SELECT project_id FROM continuous_goals WHERE id='goal'")
                .fetch_one(&store.pool)
                .await
                .unwrap();
        let second_project = store
            .create_project("second", &dir.path().join("other-repo").to_string_lossy())
            .await
            .unwrap();
        sqlx::query("INSERT INTO continuous_projects(project_id, status, updated_at) VALUES(?, 'enabled', 1)")
            .bind(&second_project.id).execute(&store.pool).await.unwrap();
        sqlx::query("INSERT INTO continuous_goals(id, project_id, root_goal_id, objective, status, deadline_at, admitted, created_at, updated_at) VALUES('other-goal', ?, 'other-goal', 'private goal', 'open', 9999999999, 1, 1, 1)")
            .bind(&second_project.id).execute(&store.pool).await.unwrap();
        sqlx::query("INSERT INTO continuous_root_policies(root_goal_id, policy_json, source, observed_at) VALUES('other-goal', ?, 'test', 1)")
            .bind(serde_json::to_string(&DevelopmentPolicy::defaults()).unwrap()).execute(&store.pool).await.unwrap();
        sqlx::query("INSERT INTO continuous_tasks(id, goal_id, objective, owned_paths_json, dependencies_json, status, claim_owner, claim_fence, created_at, updated_at) VALUES('other-task', 'other-goal', 'private task', '[]', '[]', 'running', 'other-owner', 1, 1, 1)")
            .execute(&store.pool).await.unwrap();
        let second_run = store
            .record_development_run_intent("other-task", "other-owner", 1)
            .await
            .unwrap()
            .id;
        let receipt = |profile: &str| serde_json::json!({"selection":{"resolved":{"profileId":profile}},"expiresAt":now_unix_secs()+600});
        store
            .reserve_development_launch(&first_run, "owner", 1, "codex")
            .await
            .unwrap();
        store
            .bind_development_launch_route(&first_run, "owner", 1, &receipt("codex"))
            .await
            .unwrap();
        store
            .reserve_development_launch(&second_run, "other-owner", 1, "kimi")
            .await
            .unwrap();
        store
            .bind_development_launch_route(&second_run, "other-owner", 1, &receipt("kimi"))
            .await
            .unwrap();
        let first = store
            .development_records_snapshot(&first_project)
            .await
            .unwrap();
        let second = store
            .development_records_snapshot(&second_project.id)
            .await
            .unwrap();
        assert_eq!(first["runs"].as_array().unwrap().len(), 1);
        assert_eq!(second["runs"].as_array().unwrap().len(), 1);
        assert_eq!(
            first["runs"][0]["executionIdentity"]["identity"]["runId"],
            first_run
        );
        assert_eq!(
            second["runs"][0]["executionIdentity"]["identity"]["runId"],
            second_run
        );
        assert!(!first.to_string().contains(&second_run));
        assert!(!second.to_string().contains(&first_run));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn identity_insert_failure_rolls_back_route_and_rejects_stale_bindings() {
        let (_dir, store, run) = fixture().await;
        store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .unwrap();
        let receipt = serde_json::json!({"selection":{"resolved":{"profileId":"codex"}},"expiresAt":now_unix_secs()+600});
        for (owner, fence, profile) in [
            ("wrong", 1, "codex"),
            ("owner", 2, "codex"),
            ("owner", 1, "other"),
        ] {
            let mut candidate = receipt.clone();
            candidate["selection"]["resolved"]["profileId"] = profile.into();
            assert!(store
                .bind_development_launch_route(&run, owner, fence, &candidate)
                .await
                .is_err());
        }
        sqlx::query("UPDATE development_launches SET state='spawning' WHERE run_id=?")
            .bind(&run)
            .execute(&store.pool)
            .await
            .unwrap();
        assert!(store
            .bind_development_launch_route(&run, "owner", 1, &receipt)
            .await
            .is_err());
        sqlx::query("UPDATE development_launches SET state='reserved' WHERE run_id=?")
            .bind(&run)
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("CREATE TRIGGER test_reject_identity BEFORE INSERT ON development_execution_identities BEGIN SELECT RAISE(ABORT, 'test identity insert failure'); END")
            .execute(&store.pool).await.unwrap();
        assert!(store
            .bind_development_launch_route(&run, "owner", 1, &receipt)
            .await
            .is_err());
        assert!(store
            .development_launch(&run)
            .await
            .unwrap()
            .unwrap()
            .route_json
            .is_none());
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM development_execution_identities WHERE run_id = ?",
        )
        .bind(&run)
        .fetch_one(&store.pool)
        .await
        .unwrap();
        assert_eq!(count, 0);
        sqlx::query("DROP TRIGGER test_reject_identity")
            .execute(&store.pool)
            .await
            .unwrap();
        store
            .bind_development_launch_route(&run, "owner", 1, &receipt)
            .await
            .unwrap();
        let identity_id: String =
            sqlx::query_scalar("SELECT id FROM development_execution_identities WHERE run_id = ?")
                .bind(&run)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        for statement in [
            "UPDATE development_execution_identities SET configured_json = '{}' WHERE id = ?",
            "DELETE FROM development_execution_identities WHERE id = ?",
            "UPDATE development_identity_observations SET observation_json = '{}' WHERE identity_id = ?",
            "DELETE FROM development_identity_observations WHERE identity_id = ?",
        ] {
            assert!(sqlx::query(statement).bind(&identity_id).execute(&store.pool).await.is_err());
        }
        assert!(store
            .bind_development_launch_route(&run, "owner", 1, &receipt)
            .await
            .is_err());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn identity_history_is_append_only_and_agent_evidence_cannot_attest_it() {
        use super::super::development_runs::{EvidenceInput, EvidenceMeasurement};
        let (_dir, store, run) = fixture().await;
        store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .unwrap();
        let receipt = serde_json::json!({"selection":{"resolved":{"profileId":"codex","provider":"codex"}},"invocationModel":"configured","expiresAt":now_unix_secs()+600});
        store
            .bind_development_launch_route(&run, "owner", 1, &receipt)
            .await
            .unwrap();
        let project_id: String =
            sqlx::query_scalar("SELECT project_id FROM development_launches WHERE run_id = ?")
                .bind(&run)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        let before = store
            .development_records_snapshot(&project_id)
            .await
            .unwrap();
        let stable_id = before["runs"][0]["executionIdentity"]["identity"]["id"]
            .as_str()
            .unwrap();
        store
            .bind_development_run_candidate(&run, "owner", 1, &"c".repeat(40), "git", 1)
            .await
            .unwrap();
        store.record_development_evidence(&run, "owner", 1, EvidenceInput {
            idempotency_key: "identity-claim".into(), source: "agent".into(), observed_at: 1,
            candidate_commit: "c".repeat(40), measurement: EvidenceMeasurement::Measured { value: serde_json::json!({"observedModel":"fake"}) },
            payload: serde_json::json!({"executionIdentity":{"status":"observed","family":"fake"}}),
        }).await.unwrap();
        let after = store
            .development_records_snapshot(&project_id)
            .await
            .unwrap();
        assert_eq!(
            after["runs"][0]["executionIdentity"]["identity"]["id"],
            stable_id
        );
        assert_eq!(
            after["runs"][0]["executionIdentity"]["history"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            after["runs"][0]["executionIdentity"]["assessment"],
            "unknown"
        );
        let second = serde_json::json!({"identity":{"provider":"codex","model":"candidate","family":"unverified"},
            "status":"observed","source":"test-only","evidenceId":"test-evidence","observedAt":1,
            "expiresAt":9999999999_u64,"registry":{"source":"unknown","revision":"historical","digest":"test"}});
        sqlx::query("INSERT INTO development_identity_observations(id, identity_id, sequence, idempotency_key, observation_json, recorded_at) VALUES('test-second', ?, 2, 'test-second-key', ?, 2)")
            .bind(stable_id).bind(second.to_string()).execute(&store.pool).await.unwrap();
        let history = store
            .development_records_snapshot(&project_id)
            .await
            .unwrap();
        assert_eq!(
            history["runs"][0]["executionIdentity"]["history"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            history["runs"][0]["executionIdentity"]["history"][0]["observation"]["status"],
            "unknown"
        );
        assert_eq!(
            history["runs"][0]["executionIdentity"]["history"][1]["observation"]["registry"]
                ["revision"],
            "historical"
        );
        assert_eq!(
            history["runs"][0]["executionIdentity"]["assessment"],
            "unknown"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn schema20_upgrade_preserves_old_route_without_inventing_execution_identity() {
        let (dir, store, run) = fixture().await;
        store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .unwrap();
        let receipt = serde_json::json!({"selection":{"resolved":{"profileId":"codex"}},"expiresAt":now_unix_secs()+600});
        store
            .bind_development_launch_route(&run, "owner", 1, &receipt)
            .await
            .unwrap();
        let project_id: String =
            sqlx::query_scalar("SELECT project_id FROM development_launches WHERE run_id = ?")
                .bind(&run)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        for statement in [
            "DROP TRIGGER development_identity_observation_no_delete",
            "DROP TRIGGER development_identity_observation_no_update",
            "DROP TRIGGER development_identity_no_delete",
            "DROP TRIGGER development_identity_no_update",
            "DROP TABLE development_identity_observations",
            "DROP TABLE development_execution_identities",
            "PRAGMA user_version=20",
        ] {
            sqlx::query(statement).execute(&store.pool).await.unwrap();
        }
        store.pool.close().await;
        let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let launch = reopened.development_launch(&run).await.unwrap().unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(launch.route_json.as_deref().unwrap())
                .unwrap(),
            receipt
        );
        assert_eq!(
            reopened.user_version().await.unwrap(),
            super::super::target_schema_version()
        );
        let snapshot = reopened
            .development_records_snapshot(&project_id)
            .await
            .unwrap();
        assert_eq!(
            snapshot["runs"][0]["executionIdentity"]["state"],
            "unavailable"
        );
        assert!(snapshot["runs"][0]["executionIdentity"]["identity"].is_null());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_exit_is_identity_bound_idempotent_and_not_task_completion() {
        let (_dir, store, run) = fixture().await;
        let launch = store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .unwrap();
        bind_test_route(&store, &run).await;
        store
            .consume_development_launch(&run, "owner", 1, &launch.worker_id, "session")
            .await
            .unwrap();
        assert!(store
            .record_development_process_exit("foreign", "session", Some(0))
            .await
            .unwrap()
            .is_none());
        assert_eq!(
            store
                .record_development_process_exit(&launch.worker_id, "session", Some(0))
                .await
                .unwrap(),
            Some(run.clone())
        );
        assert!(store
            .record_development_process_exit(&launch.worker_id, "session", Some(1))
            .await
            .unwrap()
            .is_none());
        let observed = store.development_launch(&run).await.unwrap().unwrap();
        assert_eq!(observed.state, "exited");
        assert_eq!(observed.exit_code, Some(0));
        assert!(observed.exited_at.is_some());
        assert_eq!(
            store.agent_run_context(&run, "owner", 1).await.unwrap()["run"]["status"],
            "reconciling"
        );
        assert!(store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .is_err());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn pause_and_deadline_changes_close_the_pre_spawn_window() {
        let (_dir, store, run) = fixture().await;
        let saved = store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .unwrap();
        bind_test_route(&store, &run).await;
        sqlx::query("UPDATE continuous_projects SET status = 'paused'")
            .execute(&store.pool)
            .await
            .unwrap();
        assert!(store
            .consume_development_launch(&run, "owner", 1, &saved.worker_id, "session-a")
            .await
            .unwrap_err()
            .contains("admission"));
        sqlx::query("UPDATE continuous_projects SET status = 'enabled'")
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("UPDATE continuous_goals SET deadline_at = 1")
            .execute(&store.pool)
            .await
            .unwrap();
        assert!(store
            .consume_development_launch(&run, "owner", 1, &saved.worker_id, "session-a")
            .await
            .unwrap_err()
            .contains("admission"));
        assert_eq!(
            store.development_launch(&run).await.unwrap().unwrap().state,
            "reserved"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn racing_launches_have_exactly_one_durable_worker_identity() {
        let (_dir, store, run) = fixture().await;
        let (a, b) = tokio::join!(
            store.reserve_development_launch(&run, "owner", 1, "codex"),
            store.reserve_development_launch(&run, "owner", 1, "codex")
        );
        assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
        let winner = a.or(b).unwrap();
        let saved = store.development_launch(&run).await.unwrap().unwrap();
        assert_eq!(winner.worker_id, saved.worker_id);
        assert_eq!(saved.state, "reserved");
        assert!(!std::path::Path::new(&saved.worktree_path).exists());
        let (worker,): (String,) =
            sqlx::query_as("SELECT worker_id FROM development_runs WHERE id = ?")
                .bind(run)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(worker, winner.worker_id);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn reopen_and_expired_lease_never_reauthorize_a_launch() {
        let (dir, store, run) = fixture().await;
        let saved = store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .unwrap();
        bind_test_route(&store, &run).await;
        sqlx::query("UPDATE continuous_tasks SET lease_expires_at = 0")
            .execute(&store.pool)
            .await
            .unwrap();
        let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        assert!(reopened
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .is_err());
        reopened
            .consume_development_launch(&run, "owner", 1, &saved.worker_id, "session-a")
            .await
            .unwrap();
        assert!(store
            .consume_development_launch(&run, "owner", 1, &saved.worker_id, "session-b")
            .await
            .is_err());
        let after = store.development_launch(&run).await.unwrap().unwrap();
        assert_eq!(after.session_id.as_deref(), Some("session-a"));
        assert_eq!(after.state, "spawning");
    }

    /// W2-04: the team assignment decides who may be dispatched. A run whose
    /// owner is not the assignee, or whose role the frozen root policy does
    /// not permit, gets no launch reservation, whatever the claim table says.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn role_dispatch_refuses_launches_the_assignment_does_not_authorize() {
        let (_dir, store, run) = fixture().await;
        sqlx::query("INSERT INTO continuous_team_assignments(task_id,team_id,role,assignee,revision,policy_version,observed_at) VALUES('task','development','implementer','someone-else',1,1,1)")
            .execute(&store.pool).await.unwrap();
        let foreign = store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await;
        assert!(
            foreign
                .as_ref()
                .is_err_and(|error| error.contains("assigned")),
            "owner outside the assignment must not be dispatched: {foreign:?}"
        );
        let mut narrow = DevelopmentPolicy::defaults();
        narrow.teams[0].roles = vec!["implementer".into()];
        sqlx::query("UPDATE continuous_root_policies SET policy_json=? WHERE root_goal_id='goal'")
            .bind(serde_json::to_string(&narrow).unwrap())
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("UPDATE continuous_team_assignments SET role='reviewer',assignee='owner' WHERE task_id='task'")
            .execute(&store.pool).await.unwrap();
        let unpermitted = store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await;
        assert!(
            unpermitted
                .as_ref()
                .is_err_and(|error| error.contains("frozen root policy")),
            "a role outside the frozen policy must not be dispatched: {unpermitted:?}"
        );
        assert!(store.development_launch(&run).await.unwrap().is_none());
        sqlx::query(
            "UPDATE continuous_team_assignments SET role='implementer' WHERE task_id='task'",
        )
        .execute(&store.pool)
        .await
        .unwrap();
        store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .unwrap();
    }

    /// W2-04 review delta: the implicit implementer role of an unassigned task
    /// is still a role the frozen root policy must permit, and the pre-spawn
    /// consumption re-checks it like the reservation does.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn unassigned_dispatch_needs_an_implementer_role_up_to_the_spawn() {
        let (_dir, store, run) = fixture().await;
        let launch = store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .unwrap();
        bind_test_route(&store, &run).await;
        let mut review_only = DevelopmentPolicy::defaults();
        review_only.teams[0].roles = vec!["reviewer".into()];
        sqlx::query("UPDATE continuous_root_policies SET policy_json=? WHERE root_goal_id='goal'")
            .bind(serde_json::to_string(&review_only).unwrap())
            .execute(&store.pool)
            .await
            .unwrap();
        let consumed = store
            .consume_development_launch(&run, "owner", 1, &launch.worker_id, "session")
            .await;
        assert!(
            consumed
                .as_ref()
                .is_err_and(|error| error.contains("does not permit")),
            "an implementer the policy does not permit must not spawn: {consumed:?}"
        );
        let reserved = store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await;
        assert!(
            reserved
                .as_ref()
                .is_err_and(|error| error.contains("does not permit")),
            "the reservation applies the same role check first: {reserved:?}"
        );
        assert_eq!(
            store.development_launch(&run).await.unwrap().unwrap().state,
            "reserved"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn stale_fences_and_foreign_workers_cannot_consume_reservations() {
        let (_dir, store, run) = fixture().await;
        assert!(store
            .reserve_development_launch(&run, "other", 1, "codex")
            .await
            .is_err());
        let saved = store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .unwrap();
        bind_test_route(&store, &run).await;
        assert!(store
            .consume_development_launch(&run, "owner", 1, "foreign", "session-a")
            .await
            .is_err());
        sqlx::query("UPDATE continuous_tasks SET claim_fence = 2")
            .execute(&store.pool)
            .await
            .unwrap();
        assert!(store
            .consume_development_launch(&run, "owner", 1, &saved.worker_id, "session-a")
            .await
            .is_err());
        assert_eq!(
            store.development_launch(&run).await.unwrap().unwrap().state,
            "reserved"
        );
    }

    async fn launch_dependents(store: &Store) -> Vec<(String, String)> {
        sqlx::query_as("SELECT name,sql FROM sqlite_master WHERE tbl_name='development_launches' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name")
            .fetch_all(&store.pool).await.unwrap()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn exited_undelivered_requires_its_reason_and_exit_code_and_never_widens_exited() {
        let (_dir, store, run) = fixture().await;
        store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .unwrap();
        for (state, code, reason) in [
            ("exited_undelivered", Some(2), None),
            (
                "exited_undelivered",
                None,
                Some("provider_exited_before_input_delivery"),
            ),
            ("exited_undelivered", Some(2), Some("unknown")),
            (
                "exited",
                Some(2),
                Some("provider_exited_before_input_delivery"),
            ),
            (
                "spawning",
                None,
                Some("provider_exited_before_input_delivery"),
            ),
            ("delivered", Some(2), None),
        ] {
            assert!(
                sqlx::query("UPDATE development_launches SET state=?,exit_code=?,exit_reason=? WHERE run_id=?")
                    .bind(state).bind(code).bind(reason).bind(&run)
                    .execute(&store.pool).await.is_err(),
                "{state} {code:?} {reason:?}"
            );
        }
        sqlx::query("UPDATE development_launches SET state='exited_undelivered',exit_code=2,exit_reason='provider_exited_before_input_delivery' WHERE run_id=?")
            .bind(&run).execute(&store.pool).await.unwrap();
        let launch = store.development_launch(&run).await.unwrap().unwrap();
        assert_eq!(launch.state, "exited_undelivered");
        assert_eq!(
            launch.exit_reason.as_deref(),
            Some("provider_exited_before_input_delivery")
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn schema21_upgrade_widens_launch_state_and_keeps_rows_indexes_and_journal() {
        let (dir, store, run) = fixture().await;
        let launch = store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .unwrap();
        bind_test_route(&store, &run).await;
        store
            .consume_development_launch(&run, "owner", 1, &launch.worker_id, "session")
            .await
            .unwrap();
        let before = store.development_launch(&run).await.unwrap().unwrap();
        let dependents = launch_dependents(&store).await;
        assert!(dependents
            .iter()
            .any(|(name, _)| name == "development_process_instance_unique"));
        assert!(dependents
            .iter()
            .any(|(name, _)| name == "development_launches_journal_update"));
        // Rebuild the exact schema-21 table: old CHECK, no exit_reason column.
        let table: String = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='development_launches'",
        )
        .fetch_one(&store.pool)
        .await
        .unwrap();
        let reason = table.rfind("exit_reason TEXT").unwrap();
        let comma = table[..reason].rfind(',').unwrap();
        let old = format!("{})", &table[..comma])
            .replace(LAUNCH_STATE_CHECK_UNDELIVERED, LAUNCH_STATE_CHECK);
        assert_eq!(old.matches(LAUNCH_STATE_CHECK).count(), 1);
        assert!(!old.contains("exit_reason"));
        let columns: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_info('development_launches') WHERE name!='exit_reason' ORDER BY cid")
            .fetch_all(&store.pool).await.unwrap();
        let columns = columns.join(",");
        let mut tx = store.pool.begin().await.unwrap();
        for statement in [
            format!("CREATE TABLE schema21_copy AS SELECT {columns} FROM development_launches"),
            "DROP TABLE development_launches".into(),
            old,
            format!(
                "INSERT INTO development_launches({columns}) SELECT {columns} FROM schema21_copy"
            ),
            "DROP TABLE schema21_copy".into(),
        ] {
            sqlx::query(&statement).execute(&mut *tx).await.unwrap();
        }
        for (_, statement) in &dependents {
            sqlx::query(statement).execute(&mut *tx).await.unwrap();
        }
        sqlx::query("PRAGMA user_version=21")
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        store.pool.close().await;

        let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        assert_eq!(
            reopened.user_version().await.unwrap(),
            super::super::target_schema_version()
        );
        let after = reopened.development_launch(&run).await.unwrap().unwrap();
        assert_eq!(
            after.state, "spawning",
            "migration must not move any launch"
        );
        assert_eq!(after.worker_id, before.worker_id);
        assert_eq!(after.process_instance, before.process_instance);
        assert_eq!(after.exit_reason, None);
        assert_eq!(launch_dependents(&reopened).await, dependents);
        let journal = || async {
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM continuous_events WHERE kind='development_launch'",
            )
            .fetch_one(&reopened.pool)
            .await
            .unwrap()
        };
        let events = journal().await;
        sqlx::query("UPDATE development_launches SET state='exited_undelivered',exit_code=2,exit_reason='provider_exited_before_input_delivery' WHERE run_id=?")
            .bind(&run).execute(&reopened.pool).await.unwrap();
        assert!(
            journal().await > events,
            "journal trigger survived the rebuild"
        );
    }
}
