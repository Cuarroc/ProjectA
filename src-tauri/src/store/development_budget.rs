//! Root-wide token accounting. Only trusted services call the writers; agents
//! cannot settle their own usage or manufacture an allowance through HTTP.
//! Unknown usage retains the entire reservation across exits and restarts; the
//! one known-zero case, a proven `exited_undelivered` exit before input
//! delivery (DF-15b / KI-27), releases the reservation unused instead.
use super::{new_id, now_unix_secs, Store};
use crate::development_policy::{DevelopmentPolicy, TokenPolicy};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Sqlite, Transaction};

#[path = "development_codex_usage.rs"]
pub(super) mod codex_usage;
#[path = "development_usage_receipt.rs"]
pub(super) mod usage_receipt;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BudgetPurpose {
    Planning,
    Context,
    Discovery,
    Implementation,
    Review,
    Verification,
}
impl BudgetPurpose {
    fn name(self) -> &'static str {
        match self {
            Self::Planning => "planning",
            Self::Context => "context",
            Self::Discovery => "discovery",
            Self::Implementation => "implementation",
            Self::Review => "review",
            Self::Verification => "verification",
        }
    }
    fn protected(self) -> bool {
        matches!(self, Self::Review | Self::Verification)
    }
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TokenReservation {
    pub id: String,
    pub root_goal_id: String,
    pub goal_id: String,
    pub idempotency_key: String,
    pub purpose: String,
    pub run_id: Option<String>,
    pub reserved_tokens: i64,
    pub state: String,
    pub actual_tokens: Option<i64>,
    pub source: Option<String>,
    pub observed_at: Option<i64>,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub settled_at: Option<i64>,
}

/// Supplied by the trusted collector's process handle, never worker HTTP input.
pub struct RunUsageBinding<'a> {
    pub run_id: &'a str,
    pub session_id: &'a str,
}

/// Snapshot checked again under the settlement writer lock, including replay.
pub(super) struct CaptureLaunchIdentity<'a> {
    pub(super) route_json: &'a str,
    pub(super) exit_code: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenBalance {
    pub root_goal_id: String,
    pub allowance: Option<TokenPolicy>,
    pub measured_tokens: i64,
    pub reserved_tokens: i64,
    pub verification_remaining: i64,
    pub available_tokens: i64,
    pub implementation_available: i64,
    pub unresolved_operations: i64,
    /// Describes receipt coverage, not the numerical sum of recorded receipts.
    pub usage_state: &'static str,
    pub exceeded: bool,
    pub exhausted: bool,
}

pub(super) async fn apply_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    sqlx::query("CREATE TABLE development_token_reservations(id TEXT PRIMARY KEY, root_goal_id TEXT NOT NULL, goal_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('planning','context','discovery','implementation','review','verification')), run_id TEXT, reserved_tokens INTEGER NOT NULL CHECK(reserved_tokens > 0), state TEXT NOT NULL CHECK(state IN ('reserved','started','settled','cancelled')), actual_tokens INTEGER CHECK(actual_tokens >= 0), source TEXT, observed_at INTEGER, created_at INTEGER NOT NULL, started_at INTEGER, settled_at INTEGER, UNIQUE(root_goal_id,idempotency_key))")
        .execute(&mut **tx).await.map_err(db)?;
    // DF-15b: a reservation cancelled by the undelivered-exit release frees
    // this index slot for the same run_id. That is safe: a new reservation
    // needs `development_runs.status='intent'` (`reserve_development_tokens`),
    // and a run whose launch reached `exited_undelivered` is `reconciling`,
    // so no second live reservation can appear for it.
    sqlx::query("CREATE UNIQUE INDEX development_implementation_budget ON development_token_reservations(run_id) WHERE purpose = 'implementation' AND state != 'cancelled'")
        .execute(&mut **tx).await.map_err(db)?;
    Ok(())
}

fn db(e: sqlx::Error) -> String {
    format!("development token ledger: {e}")
}

pub(super) async fn balance(
    tx: &mut Transaction<'_, Sqlite>,
    root: &str,
) -> Result<TokenBalance, String> {
    let (encoded,): (String,) =
        sqlx::query_as("SELECT policy_json FROM continuous_root_policies WHERE root_goal_id = ?")
            .bind(root)
            .fetch_one(&mut **tx)
            .await
            .map_err(db)?;
    let policy = DevelopmentPolicy::parse(&encoded)?;
    let (measured, reserved, protected, unresolved): (i64,i64,i64,i64) = sqlx::query_as("SELECT COALESCE(SUM(CASE WHEN state='settled' THEN actual_tokens ELSE 0 END),0), COALESCE(SUM(CASE WHEN state IN ('reserved','started') THEN reserved_tokens ELSE 0 END),0), COALESCE(SUM(CASE WHEN purpose IN ('review','verification') THEN CASE WHEN state='settled' THEN actual_tokens WHEN state IN ('reserved','started') THEN reserved_tokens ELSE 0 END ELSE 0 END),0), COUNT(CASE WHEN state='started' THEN 1 END) FROM development_token_reservations WHERE root_goal_id = ?")
        .bind(root).fetch_one(&mut **tx).await.map_err(db)?;
    let maximum = policy.tokens.as_ref().map_or(0, |p| p.max_per_goal);
    let (receipts,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM development_token_reservations WHERE root_goal_id=? AND state='settled'")
        .bind(root).fetch_one(&mut **tx).await.map_err(db)?;
    let verification_remaining = policy
        .tokens
        .as_ref()
        .map_or(0, |p| (p.verification_reserve - protected).max(0));
    let available = (maximum - measured - reserved).max(0);
    Ok(TokenBalance {
        root_goal_id: root.into(),
        exhausted: policy.tokens.is_some() && measured >= maximum,
        // Each state names why coverage is incomplete; never a bare gap.
        usage_state: if policy.tokens.is_none() {
            "no_allowance"
        } else if receipts == 0 {
            "no_receipts"
        } else if reserved > 0 {
            "partial"
        } else {
            "measured"
        },
        allowance: policy.tokens,
        measured_tokens: measured,
        reserved_tokens: reserved,
        verification_remaining,
        available_tokens: available,
        implementation_available: (available - verification_remaining).max(0),
        unresolved_operations: unresolved,
        exceeded: measured + reserved > maximum,
    })
}

async fn event(tx: &mut Transaction<'_, Sqlite>, root: &str, detail: &str) -> Result<(), String> {
    sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) SELECT project_id,'token_budget',?,? FROM continuous_goals WHERE id = ?")
        .bind(detail).bind(now_unix_secs()).bind(root).execute(&mut **tx).await.map_err(db)?;
    Ok(())
}

impl Store {
    /// An allocation estimate is held, never reported as measured consumption.
    pub async fn reserve_development_tokens(
        &self,
        goal: &str,
        key: &str,
        purpose: BudgetPurpose,
        tokens: i64,
        run: Option<&str>,
    ) -> Result<TokenReservation, String> {
        if key.trim().is_empty() || key.len() > 128 || !(1..=200_000).contains(&tokens) {
            return Err("invalid token reservation key or amount".into());
        }
        if (purpose == BudgetPurpose::Implementation) != run.is_some() {
            return Err("implementation token reservations require exactly one run binding".into());
        }
        let mut tx = self.pool.begin().await.map_err(db)?;
        // Serialize before any reads, including idempotency and root totals.
        sqlx::query("UPDATE continuous_goals SET updated_at=updated_at WHERE id=?")
            .bind(goal)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        let (root,): (String,) =
            sqlx::query_as("SELECT root_goal_id FROM continuous_goals WHERE id=?")
                .bind(goal)
                .fetch_one(&mut *tx)
                .await
                .map_err(db)?;
        let previous: Option<TokenReservation> = sqlx::query_as("SELECT * FROM development_token_reservations WHERE root_goal_id=? AND idempotency_key=?")
            .bind(&root).bind(key).fetch_optional(&mut *tx).await.map_err(db)?;
        if let Some(previous) = previous {
            if previous.goal_id != goal
                || previous.purpose != purpose.name()
                || previous.run_id.as_deref() != run
                || previous.reserved_tokens != tokens
            {
                return Err("token reservation idempotency conflict".into());
            }
            tx.commit().await.map_err(db)?;
            return Ok(previous);
        }
        let (eligible,): (bool,) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM continuous_goals g JOIN continuous_goals root ON root.id=g.root_goal_id WHERE g.id=? AND g.status='open' AND root.status='open' AND g.admitted=1 AND root.admitted=1 AND g.deadline_at>? AND root.deadline_at>?)")
            .bind(goal).bind(now_unix_secs()).bind(now_unix_secs()).fetch_one(&mut *tx).await.map_err(db)?;
        if !eligible {
            return Err("token budget root is unadmitted, closed or expired".into());
        }
        if let Some(run) = run {
            let (valid,): (bool,) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM development_runs r JOIN continuous_tasks t ON t.id=r.task_id WHERE r.id=? AND t.goal_id=? AND r.status='intent' AND t.status='running' AND r.claim_owner=t.claim_owner AND r.claim_fence=t.claim_fence)")
                .bind(run).bind(goal).fetch_one(&mut *tx).await.map_err(db)?;
            if !valid {
                return Err("token reservation run is stale or belongs to another goal".into());
            }
        }
        let totals = balance(&mut tx, &root).await?;
        if totals.allowance.is_none() {
            return Err("root has no token allowance; legacy usage is unavailable".into());
        }
        let available = if purpose.protected() {
            totals.available_tokens
        } else {
            totals.implementation_available
        };
        if tokens > available {
            return Err("root token budget exhausted or reserved for verification".into());
        }
        let id = new_id("tr");
        sqlx::query("INSERT INTO development_token_reservations(id,root_goal_id,goal_id,idempotency_key,purpose,run_id,reserved_tokens,state,created_at) VALUES(?,?,?,?,?,?,?,'reserved',?)")
            .bind(&id).bind(&root).bind(goal).bind(key).bind(purpose.name()).bind(run).bind(tokens).bind(now_unix_secs()).execute(&mut *tx).await.map_err(db)?;
        event(&mut tx, &root, &id).await?;
        let row = sqlx::query_as("SELECT * FROM development_token_reservations WHERE id=?")
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(row)
    }

    /// Starts trusted non-worker work (planning/context/discovery/review/tests).
    /// Worker allocations are consumed atomically with the launch reservation.
    pub async fn start_development_tokens(&self, id: &str) -> Result<(), String> {
        let mut tx = self.pool.begin().await.map_err(db)?;
        lock(&mut tx, id).await?;
        let row: TokenReservation =
            sqlx::query_as("SELECT * FROM development_token_reservations WHERE id=?")
                .bind(id)
                .fetch_one(&mut *tx)
                .await
                .map_err(db)?;
        if row.run_id.is_some() {
            return Err("worker budget must start with its launch".into());
        }
        start(&mut tx, id).await?;
        tx.commit().await.map_err(db)
    }

    /// Only positive knowledge that work never started allows cancellation.
    pub async fn cancel_development_tokens(&self, id: &str) -> Result<(), String> {
        let mut tx = self.pool.begin().await.map_err(db)?;
        let root: Option<(String,)> = sqlx::query_as("UPDATE development_token_reservations SET state='cancelled',settled_at=? WHERE id=? AND state='reserved' RETURNING root_goal_id")
            .bind(now_unix_secs()).bind(id).fetch_optional(&mut *tx).await.map_err(db)?;
        let Some((root,)) = root else {
            return Err("token reservation already started or resolved".into());
        };
        event(&mut tx, &root, id).await?;
        tx.commit().await.map_err(db)
    }

    /// Trusted provider receipt only, after final usage is observed. Process
    /// exit or an agent assertion is not a receipt. No worker-facing endpoint.
    pub async fn settle_development_tokens(
        &self,
        id: &str,
        actual: i64,
        source: &str,
        observed_at: i64,
    ) -> Result<(), String> {
        self.settle_tokens_bound(id, actual, source, observed_at, None, None)
            .await
    }

    /// Worker receipts must match the reserved run and its exact exited session.
    pub async fn settle_development_run_tokens(
        &self,
        id: &str,
        binding: RunUsageBinding<'_>,
        actual: i64,
        source: &str,
        observed_at: i64,
    ) -> Result<(), String> {
        self.settle_tokens_bound(id, actual, source, observed_at, Some(binding), None)
            .await
    }

    async fn settle_tokens_bound(
        &self,
        id: &str,
        actual: i64,
        source: &str,
        observed_at: i64,
        binding: Option<RunUsageBinding<'_>>,
        capture: Option<CaptureLaunchIdentity<'_>>,
    ) -> Result<(), String> {
        let mut tx = self.pool.begin().await.map_err(db)?;
        settle_bound(&mut tx, id, actual, source, observed_at, binding, capture).await?;
        tx.commit().await.map_err(db)
    }
}

pub(super) async fn settle_bound(
    tx: &mut Transaction<'_, Sqlite>,
    id: &str,
    actual: i64,
    source: &str,
    observed_at: i64,
    binding: Option<RunUsageBinding<'_>>,
    capture: Option<CaptureLaunchIdentity<'_>>,
) -> Result<(), String> {
    if !(0..=1_000_000_000).contains(&actual)
        || source.trim().is_empty()
        || source.len() > 1024
        || observed_at < 1
        || observed_at > now_unix_secs() + 5
    {
        return Err("invalid measured token receipt".into());
    }
    lock(tx, id).await?;
    let row: TokenReservation =
        sqlx::query_as("SELECT * FROM development_token_reservations WHERE id=?")
            .bind(id)
            .fetch_one(&mut **tx)
            .await
            .map_err(db)?;
    // Check identity even for idempotent replay, under the same writer lock
    // as settlement. Matching numbers alone cannot authorize another run.
    match (row.run_id.as_deref(), binding) {
        (Some(run), Some(binding)) if run == binding.run_id => {
            let (ended,): (bool,) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM development_launches WHERE run_id=? AND session_id=? AND state='exited')")
                    .bind(run).bind(binding.session_id).fetch_one(&mut **tx).await.map_err(db)?;
            if !ended {
                return Err("worker usage requires its exact verified exited session".into());
            }
            if let Some(capture) = capture {
                let (matches,): (bool,) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM development_launches WHERE run_id=? AND session_id=? AND state='exited' AND route_json=? AND exit_code IS ?)")
                        .bind(run).bind(binding.session_id).bind(capture.route_json)
                        .bind(capture.exit_code).fetch_one(&mut **tx).await.map_err(db)?;
                if !matches {
                    return Err("capture launch identity changed before settlement".into());
                }
            }
        }
        (None, None) if capture.is_none() => {}
        _ => return Err("token receipt run/session binding mismatch or missing".into()),
    }
    if row.state == "settled"
        && row.actual_tokens == Some(actual)
        && row.source.as_deref() == Some(source)
        && row.observed_at == Some(observed_at)
    {
        return Ok(());
    }
    if row.state != "started" || observed_at < row.started_at.unwrap_or(i64::MAX) {
        return Err("token settlement conflicts or work has not started".into());
    }
    sqlx::query("UPDATE development_token_reservations SET state='settled',actual_tokens=?,source=?,observed_at=?,settled_at=? WHERE id=?")
            .bind(actual).bind(source).bind(observed_at).bind(now_unix_secs()).bind(id).execute(&mut **tx).await.map_err(db)?;
    let totals = balance(tx, &row.root_goal_id).await?;
    if totals.exceeded || totals.exhausted {
        // Retain claims/processes: blocking admission is not proof of death.
        sqlx::query("UPDATE continuous_goals SET status='blocked',updated_at=? WHERE root_goal_id=? AND status='open'")
                .bind(now_unix_secs()).bind(&row.root_goal_id).execute(&mut **tx).await.map_err(db)?;
    }
    event(tx, &row.root_goal_id, id).await?;
    Ok(())
}

async fn lock(tx: &mut Transaction<'_, Sqlite>, id: &str) -> Result<(), String> {
    sqlx::query("UPDATE development_token_reservations SET created_at=created_at WHERE id=?")
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(db)?;
    Ok(())
}
async fn start(tx: &mut Transaction<'_, Sqlite>, id: &str) -> Result<(), String> {
    let row: TokenReservation =
        sqlx::query_as("SELECT * FROM development_token_reservations WHERE id=?")
            .bind(id)
            .fetch_one(&mut **tx)
            .await
            .map_err(db)?;
    let (eligible,): (bool,) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM continuous_goals g JOIN continuous_goals root ON root.id=g.root_goal_id JOIN continuous_projects p ON p.project_id=g.project_id WHERE g.id=? AND g.status='open' AND root.status='open' AND g.admitted=1 AND root.admitted=1 AND g.deadline_at>? AND root.deadline_at>? AND p.status='enabled')")
        .bind(&row.goal_id).bind(now_unix_secs()).bind(now_unix_secs()).fetch_one(&mut **tx).await.map_err(db)?;
    if !eligible || balance(tx, &row.root_goal_id).await?.exceeded {
        return Err("token work admission paused, closed, expired or exhausted".into());
    }
    let changed=sqlx::query("UPDATE development_token_reservations SET state='started',started_at=? WHERE id=? AND state='reserved'")
        .bind(now_unix_secs()).bind(id).execute(&mut **tx).await.map_err(db)?;
    if changed.rows_affected() != 1 {
        return Err("token reservation already consumed; reconcile before retry".into());
    }
    event(tx, &row.root_goal_id, id).await
}

pub(super) async fn consume_worker(
    tx: &mut Transaction<'_, Sqlite>,
    run: &str,
) -> Result<(), String> {
    let (id,): (String,) = sqlx::query_as("SELECT id FROM development_token_reservations WHERE run_id=? AND purpose='implementation' AND state='reserved'")
        .bind(run).fetch_optional(&mut **tx).await.map_err(db)?.ok_or("development launch has no reserved token budget")?;
    start(tx, &id).await
}

/// DF-15b / KI-27: releases the implementation reservation of a run whose
/// provider demonstrably exited before its input was delivered. The
/// reservation was consumed with the launch, but no token ever reached the
/// provider, so it is cancelled unused and the budget is freed. The guard
/// repeats the proof inside the writer transaction: only an
/// `exited_undelivered` launch with a recorded exit code whose delivery
/// intent never left `started` qualifies; anything else changes nothing and
/// keeps the reservation retained. The release is journaled here
/// (`development_delivery_released`), so every caller writes it exactly once.
/// Returns true when this call released.
pub(super) async fn release_undelivered_run_tokens(
    tx: &mut Transaction<'_, Sqlite>,
    run: &str,
) -> Result<bool, String> {
    let row: Option<(String, String)> = sqlx::query_as("SELECT id,root_goal_id FROM development_token_reservations WHERE run_id=? AND purpose='implementation' AND state='started'")
        .bind(run).fetch_optional(&mut **tx).await.map_err(db)?;
    let Some((id, root)) = row else {
        return Ok(false);
    };
    let changed = sqlx::query("UPDATE development_token_reservations SET state='cancelled',settled_at=? WHERE id=? AND state='started' AND EXISTS(SELECT 1 FROM development_launches l JOIN development_deliveries d ON d.run_id=l.run_id WHERE l.run_id=? AND l.state='exited_undelivered' AND l.exit_code IS NOT NULL AND d.state='started')")
        .bind(now_unix_secs()).bind(&id).bind(run).execute(&mut **tx).await.map_err(db)?;
    if changed.rows_affected() != 1 {
        return Ok(false);
    }
    event(tx, &root, &id).await?;
    sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) SELECT project_id,'development_delivery_released',json_object('version',1,'runId',run_id,'exitCode',exit_code,'reason',exit_reason),unixepoch() FROM development_launches WHERE run_id=?")
        .bind(run).execute(&mut **tx).await.map_err(db)?;
    Ok(true)
}

/// Startup counterpart of the writer above for rows committed before it
/// existed (DF-15a era: exit committed, reservation still held). The same
/// guard applies to every candidate, so it frees exactly the proven rows and
/// is idempotent. Returns the number of released reservations.
pub(super) async fn release_undelivered_runs(
    tx: &mut Transaction<'_, Sqlite>,
) -> Result<u64, String> {
    let runs: Vec<(String,)> = sqlx::query_as("SELECT l.run_id FROM development_launches l JOIN development_token_reservations t ON t.run_id=l.run_id WHERE l.state='exited_undelivered' AND t.purpose='implementation' AND t.state='started'")
        .fetch_all(&mut **tx).await.map_err(db)?;
    let mut released = 0;
    for (run,) in runs {
        if release_undelivered_run_tokens(tx, &run).await? {
            released += 1;
        }
    }
    Ok(released)
}

#[cfg(test)]
#[path = "development_usage_binding_tests.rs"]
mod usage_binding_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    pub(super) async fn fixture() -> (TempDir, Store, String, String) {
        let dir = TempDir::new("token-ledger");
        std::fs::write(
            dir.path().join("projecta.dev.json"),
            serde_json::to_string(&DevelopmentPolicy::defaults()).unwrap(),
        )
        .unwrap();
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let project = store
            .create_project("budget", &dir.path().to_string_lossy())
            .await
            .unwrap();
        let goal = store
            .create_continuous_goal(&project.id, "bounded goal", None, None, true)
            .await
            .unwrap();
        sqlx::query("INSERT INTO continuous_projects(project_id,status,updated_at) VALUES(?,'enabled',1) ON CONFLICT(project_id) DO UPDATE SET status='enabled'")
            .bind(&project.id)
            .execute(&store.pool)
            .await
            .unwrap();
        (dir, store, project.id, goal.id)
    }
    async fn totals(store: &Store, root: &str) -> TokenBalance {
        let mut tx = store.pool.begin().await.unwrap();
        let result = balance(&mut tx, root).await.unwrap();
        tx.commit().await.unwrap();
        result
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn root_token_race_preserves_verification_and_replans_share_capacity() {
        let (_dir, store, project, root) = fixture().await;
        let child = store
            .create_continuous_goal(&project, "replan", None, Some(root.clone()), true)
            .await
            .unwrap();
        let (a, b) = tokio::join!(
            store.reserve_development_tokens(&root, "a", BudgetPurpose::Planning, 150_000, None),
            store.reserve_development_tokens(&child.id, "b", BudgetPurpose::Context, 150_000, None)
        );
        assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
        let balance = totals(&store, &root).await;
        assert_eq!(balance.reserved_tokens, 150_000);
        assert_eq!(balance.verification_remaining, 40_000);
        assert_eq!(balance.implementation_available, 10_000);
        assert!(store
            .reserve_development_tokens(
                &child.id,
                "too-large",
                BudgetPurpose::Discovery,
                10_001,
                None
            )
            .await
            .is_err());
        store
            .reserve_development_tokens(&root, "review", BudgetPurpose::Review, 40_000, None)
            .await
            .unwrap();
        let context = store.continuous_context(&project, 0).await.unwrap();
        assert_eq!(
            context.effective_limits["rootPolicies"][0]["tokens"]["reservedTokens"],
            190_000
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn token_retries_and_unknown_usage_survive_restart_without_freeing_capacity() {
        let (dir, store, _project, root) = fixture().await;
        let r = store
            .reserve_development_tokens(&root, "planning", BudgetPurpose::Planning, 50_000, None)
            .await
            .unwrap();
        assert_eq!(
            r.id,
            store
                .reserve_development_tokens(
                    &root,
                    "planning",
                    BudgetPurpose::Planning,
                    50_000,
                    None
                )
                .await
                .unwrap()
                .id
        );
        assert!(store
            .reserve_development_tokens(&root, "planning", BudgetPurpose::Planning, 1, None)
            .await
            .is_err());
        store.start_development_tokens(&r.id).await.unwrap();
        assert!(store.start_development_tokens(&r.id).await.is_err());
        assert!(store.cancel_development_tokens(&r.id).await.is_err());
        let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let balance = totals(&reopened, &root).await;
        assert_eq!(balance.measured_tokens, 0);
        assert_eq!(balance.reserved_tokens, 50_000);
        assert_eq!(balance.unresolved_operations, 1);
        let observed = now_unix_secs();
        reopened
            .settle_development_tokens(&r.id, 45_000, "trusted-provider-receipt", observed)
            .await
            .unwrap();
        reopened
            .settle_development_tokens(&r.id, 45_000, "trusted-provider-receipt", observed)
            .await
            .unwrap();
        assert!(reopened
            .settle_development_tokens(&r.id, 0, "trusted-provider-receipt", observed)
            .await
            .is_err());
        let balance = totals(&reopened, &root).await;
        assert_eq!(balance.measured_tokens, 45_000);
        assert_eq!(balance.reserved_tokens, 0);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn measured_overrun_blocks_root_and_replacement_without_releasing_running_claims() {
        let (_dir, store, project, root) = fixture().await;
        let r = store
            .reserve_development_tokens(&root, "review", BudgetPurpose::Review, 200_000, None)
            .await
            .unwrap();
        store.start_development_tokens(&r.id).await.unwrap();
        store
            .settle_development_tokens(&r.id, 200_001, "receipt-overrun", now_unix_secs())
            .await
            .unwrap();
        assert!(totals(&store, &root).await.exceeded);
        assert!(store
            .create_continuous_goal(&project, "replacement", None, None, true)
            .await
            .is_err());
        assert!(store
            .create_continuous_goal(&project, "replan", None, Some(root.clone()), true)
            .await
            .is_err());
        assert!(store
            .reserve_development_tokens(&root, "more", BudgetPurpose::Review, 1, None)
            .await
            .is_err());
        assert_eq!(
            store.continuous_context(&project, 0).await.unwrap().goals[0].status,
            "blocked"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn legacy_missing_allowance_never_becomes_free_or_inherited_from_current_config() {
        let (_dir, store, _project, root) = fixture().await;
        let mut policy = serde_json::to_value(DevelopmentPolicy::defaults()).unwrap();
        policy.as_object_mut().unwrap().remove("tokens");
        sqlx::query("UPDATE continuous_root_policies SET policy_json=? WHERE root_goal_id=?")
            .bind(policy.to_string())
            .bind(&root)
            .execute(&store.pool)
            .await
            .unwrap();
        assert!(totals(&store, &root).await.allowance.is_none());
        assert!(store
            .reserve_development_tokens(&root, "legacy", BudgetPurpose::Planning, 1, None)
            .await
            .unwrap_err()
            .contains("no token allowance"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancelled_unstarted_work_frees_capacity_but_does_not_reuse_its_key() {
        let (_dir, store, project, root) = fixture().await;
        let r = store
            .reserve_development_tokens(&root, "context", BudgetPurpose::Context, 160_000, None)
            .await
            .unwrap();
        sqlx::query("UPDATE continuous_projects SET status='paused' WHERE project_id=?")
            .bind(project)
            .execute(&store.pool)
            .await
            .unwrap();
        assert!(store.start_development_tokens(&r.id).await.is_err());
        store.cancel_development_tokens(&r.id).await.unwrap();
        assert_eq!(
            totals(&store, &root).await.implementation_available,
            160_000
        );
        let replay = store
            .reserve_development_tokens(&root, "context", BudgetPurpose::Context, 160_000, None)
            .await
            .unwrap();
        assert_eq!(replay.state, "cancelled");
        assert!(store
            .settle_development_tokens(&r.id, 0, "receipt", now_unix_secs())
            .await
            .is_err());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn worker_token_reservation_is_bound_and_consumed_with_launch_or_rolled_back() {
        let (_dir, store, _project, root) = fixture().await;
        let task = store
            .create_continuous_task(
                &root,
                "implementation",
                None,
                vec!["src/budget.rs".into()],
                vec![],
            )
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
        let launch = store
            .reserve_development_launch(&run.id, "owner", claim.fence, "codex")
            .await
            .unwrap();
        store.bind_development_launch_route(&run.id,"owner",claim.fence,&serde_json::json!({"selection":{"resolved":{"profileId":"codex"}},"expiresAt":now_unix_secs()+600})).await.unwrap();
        store
            .bind_development_launch_baseline(&run.id, "owner", claim.fence, &"a".repeat(40))
            .await
            .unwrap();
        assert!(store
            .consume_development_launch(
                &run.id,
                "owner",
                claim.fence,
                &launch.worker_id,
                "no-budget"
            )
            .await
            .unwrap_err()
            .contains("no reserved token"));
        let r = store
            .reserve_development_tokens(
                &root,
                "implementation",
                BudgetPurpose::Implementation,
                10_000,
                Some(&run.id),
            )
            .await
            .unwrap();
        assert!(store.start_development_tokens(&r.id).await.is_err());
        assert!(store
            .consume_development_launch(&run.id, "wrong", claim.fence, &launch.worker_id, "wrong")
            .await
            .is_err());
        // Failed authorization rolls back the budget transition in the same tx.
        store
            .consume_development_launch(&run.id, "owner", claim.fence, &launch.worker_id, "session")
            .await
            .unwrap();
        assert_eq!(totals(&store, &root).await.unresolved_operations, 1);
        assert!(store
            .settle_development_run_tokens(
                &r.id,
                RunUsageBinding {
                    run_id: &run.id,
                    session_id: "session"
                },
                500,
                "final-receipt",
                now_unix_secs()
            )
            .await
            .is_err());
        assert!(store.cancel_development_tokens(&r.id).await.is_err());
        assert!(store
            .consume_development_launch(
                &run.id,
                "owner",
                claim.fence,
                &launch.worker_id,
                "duplicate"
            )
            .await
            .is_err());
        store
            .record_development_process_exit(&launch.worker_id, "session", Some(0))
            .await
            .unwrap();
        store
            .settle_development_run_tokens(
                &r.id,
                RunUsageBinding {
                    run_id: &run.id,
                    session_id: "session",
                },
                500,
                "final-receipt",
                now_unix_secs(),
            )
            .await
            .unwrap();
        assert_eq!(totals(&store, &root).await.measured_tokens, 500);
    }

    /// DF-15b / KI-27: the release guard itself. Without the proven
    /// `exited_undelivered` constellation nothing is freed; with it, exactly
    /// once.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn undelivered_release_requires_the_proven_terminal_exit() {
        let (_dir, store, _project, root) = fixture().await;
        let task = store
            .create_continuous_task(
                &root,
                "implementation",
                None,
                vec!["src/budget.rs".into()],
                vec![],
            )
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
        let launch = store
            .reserve_development_launch(&run.id, "owner", claim.fence, "codex")
            .await
            .unwrap();
        store.bind_development_launch_route(&run.id,"owner",claim.fence,&serde_json::json!({"selection":{"resolved":{"profileId":"codex"}},"expiresAt":now_unix_secs()+600})).await.unwrap();
        store
            .bind_development_launch_baseline(&run.id, "owner", claim.fence, &"a".repeat(40))
            .await
            .unwrap();
        store
            .reserve_development_tokens(
                &root,
                "implementation",
                BudgetPurpose::Implementation,
                10_000,
                Some(&run.id),
            )
            .await
            .unwrap();
        store
            .consume_development_launch(&run.id, "owner", claim.fence, &launch.worker_id, "session")
            .await
            .unwrap();
        // Started reservation, but the launch is still `spawning` and no
        // delivery intent exists: nothing qualifies, nothing changes.
        let mut tx = store.pool.begin().await.unwrap();
        assert!(!release_undelivered_run_tokens(&mut tx, &run.id)
            .await
            .unwrap());
        assert!(!release_undelivered_run_tokens(&mut tx, "no-such-run")
            .await
            .unwrap());
        tx.commit().await.unwrap();
        assert_eq!(totals(&store, &root).await.unresolved_operations, 1);
        // A plain `exited` launch (delivered path) does not qualify either.
        sqlx::query(
            "UPDATE development_launches SET state='exited',exit_code=0,exited_at=1 WHERE run_id=?",
        )
        .bind(&run.id)
        .execute(&store.pool)
        .await
        .unwrap();
        let mut tx = store.pool.begin().await.unwrap();
        assert!(!release_undelivered_run_tokens(&mut tx, &run.id)
            .await
            .unwrap());
        tx.commit().await.unwrap();
        assert_eq!(totals(&store, &root).await.unresolved_operations, 1);
        // The proven constellation: terminal undelivered exit with an exit
        // code and a delivery intent that never left `started`.
        sqlx::query("INSERT INTO development_deliveries(run_id,session_id,process_instance,route_sha256,input_sha256,input_bytes,state,started_at) SELECT run_id,session_id,process_instance,'r','i',4,'started',1 FROM development_launches WHERE run_id=?")
            .bind(&run.id)
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("UPDATE development_launches SET state='exited_undelivered',exit_code=2,exit_reason='provider_exited_before_input_delivery' WHERE run_id=?")
            .bind(&run.id)
            .execute(&store.pool)
            .await
            .unwrap();
        let mut tx = store.pool.begin().await.unwrap();
        assert!(release_undelivered_run_tokens(&mut tx, &run.id)
            .await
            .unwrap());
        // Replay inside the same or a later transaction releases nothing twice.
        assert!(!release_undelivered_run_tokens(&mut tx, &run.id)
            .await
            .unwrap());
        tx.commit().await.unwrap();
        let balance = totals(&store, &root).await;
        assert_eq!(balance.reserved_tokens, 0);
        assert_eq!(balance.unresolved_operations, 0);
        let state: String =
            sqlx::query_scalar("SELECT state FROM development_token_reservations WHERE run_id=?")
                .bind(&run.id)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(state, "cancelled");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn budget_boundary_exact_exhaustion_is_blocked_not_left_open() {
        let (_dir, store, project, root) = fixture().await;
        let r = store
            .reserve_development_tokens(&root, "exact", BudgetPurpose::Review, 200_000, None)
            .await
            .unwrap();
        store.start_development_tokens(&r.id).await.unwrap();
        store
            .settle_development_tokens(&r.id, 200_000, "exact-receipt", now_unix_secs())
            .await
            .unwrap();
        assert_eq!(
            store.continuous_context(&project, 0).await.unwrap().goals[0].status,
            "blocked"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn budget_boundary_v4_policy_backfill_does_not_grant_new_token_allowance() {
        let (_dir, store, _project, root) = fixture().await;
        let mut tx = store.pool.begin().await.unwrap();
        sqlx::query("DROP TABLE continuous_root_policies")
            .execute(&mut *tx)
            .await
            .unwrap();
        crate::store::continuous::apply_policy_migration(&mut tx)
            .await
            .unwrap();
        assert!(balance(&mut tx, &root).await.unwrap().allowance.is_none());
    }
}
