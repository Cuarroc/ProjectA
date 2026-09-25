//! Durable policy supervision. It cannot launch, reclaim, merge or release work.
//!
//! W2-06 producer audit. The writers of supervisor state are exactly:
//! - `Store::supervise_project`: cursor, observation, root block checkpoints,
//!   `supervisor_blocked`, `supervisor_health` and `supervisor_audit` events;
//! - `Store::supervisor_error`: last error and `supervisor_health`.
//!
//! Both require a [`SupervisorAuthority`], which only [`start`] issues. Goal
//! blocks by other producers (token settlement in `development_budget`) are
//! recorded as `unattested` in the checkpoint's `blockedBy`, never invented.
use super::{now_unix_secs, Store};
use crate::development_policy::DevelopmentPolicy;
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{Sqlite, Transaction};
use std::sync::Arc;
use std::time::Duration;

type ObservationRow = (i64, Option<i64>, Option<String>, Option<i64>, i64);
type TaskCheckpointRow = (
    String,
    String,
    Option<String>,
    i64,
    i64,
    Option<i64>,
    String,
);
type RunCheckpointRow = (String, String, String, Option<String>, Option<i64>);

/// The only producer identity allowed to write supervisor state. It has no
/// constructor outside this module, so no other code can write that state.
pub(crate) struct SupervisorAuthority {
    _private: (),
}

/// A user-facing change of supervisor state. It carries identifiers and fixed
/// reason codes only, never error text, so it cannot leak secrets or paths.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum SupervisorNotice {
    Blocked {
        project_id: String,
        root_goal_id: String,
        reason: BlockReason,
        observed_at: i64,
    },
    Degraded {
        project_id: String,
        observed_at: i64,
    },
    Recovered {
        project_id: String,
        observed_at: i64,
    },
    Audit {
        project_id: String,
        finding: AuditFinding,
        event_cursor: i64,
        observed_at: i64,
    },
}

/// Why a root is blocked. A closed set (W2-06 review K5): notices, journal
/// details and checkpoints carry only these codes, never composed text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum BlockReason {
    /// Another producer blocked the root; its cause is not recorded here.
    AlreadyBlocked,
    DeadlineExhausted,
    TokenAllowanceUnavailable,
    TokenBudgetExhausted,
    TaskAttemptsExhausted,
}

impl BlockReason {
    /// Every reason. The order after `AlreadyBlocked` is the decision priority
    /// in `supervise_project`, and `src/lib/ipc.ts` lists the codes in it.
    const ALL: [Self; 5] = [
        Self::AlreadyBlocked,
        Self::DeadlineExhausted,
        Self::TokenAllowanceUnavailable,
        Self::TokenBudgetExhausted,
        Self::TaskAttemptsExhausted,
    ];

    /// The stored and serialized code; `code_matches_serde` pins the two.
    fn code(self) -> &'static str {
        match self {
            Self::AlreadyBlocked => "already_blocked",
            Self::DeadlineExhausted => "deadline_exhausted",
            Self::TokenAllowanceUnavailable => "token_allowance_unavailable",
            Self::TokenBudgetExhausted => "token_budget_exhausted",
            Self::TaskAttemptsExhausted => "task_attempts_exhausted",
        }
    }

    fn from_code(code: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|reason| reason.code() == code)
    }

    /// Who the checkpoint names as the blocker: this supervisor under the
    /// frozen policy, or another producer whose cause is not recorded here.
    fn blocked_by(self) -> Value {
        match self {
            Self::AlreadyBlocked => json!({"producer":"unattested","authority":null}),
            _ => json!({"producer":PRODUCER,"authority":"frozen_root_policy"}),
        }
    }
}

/// What the journal attestation found. A closed set (W2-06 review K5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AuditFinding {
    UnattestedSupervisorEvent,
}

impl AuditFinding {
    fn code(self) -> &'static str {
        match self {
            Self::UnattestedSupervisorEvent => "unattested_supervisor_event",
        }
    }
}

/// Receives notices after their transaction has committed.
pub(crate) type Notifier = Arc<dyn Fn(&SupervisorNotice) + Send + Sync>;

/// One committed reconciliation and the notices it produced.
pub(crate) struct Supervision {
    pub result: Value,
    pub notices: Vec<SupervisorNotice>,
}

fn notify(notifier: &Option<Notifier>, notices: &[SupervisorNotice]) {
    if let Some(notifier) = notifier {
        for notice in notices {
            notifier(notice);
        }
    }
}

pub(crate) struct PolicySupervisor {
    task: tokio::task::JoinHandle<()>,
}
impl Drop for PolicySupervisor {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Installed once by the app. Existing activation gates still own control state;
/// this task only enforces limits in enabled/draining projects, never enables one.
pub(crate) async fn start(store: Store, notifier: Option<Notifier>) -> PolicySupervisor {
    let authority = SupervisorAuthority { _private: () };
    let task = tokio::spawn(async move {
        while !store.pool.is_closed() {
            match store.supervisor_projects().await {
                Ok(projects) if !projects.is_empty() => match store.journal_subscription().await {
                    Ok(mut notices) => loop {
                        let health = notices.borrow_and_update().clone();
                        let projects = match store.supervisor_projects().await {
                            Ok(projects) => projects,
                            Err(error) => {
                                crate::logf!("supervisor", "project read failed: {error}");
                                break;
                            }
                        };
                        if projects.is_empty() || store.pool.is_closed() {
                            break;
                        }
                        let mut more = false;
                        for project in projects {
                            more |=
                                supervise_once(&store, &authority, &project, &health, &notifier)
                                    .await;
                        }
                        if more {
                            tokio::task::yield_now().await;
                            continue;
                        }
                        if matches!(
                            tokio::time::timeout(Duration::from_secs(30), notices.changed()).await,
                            Ok(Err(_))
                        ) {
                            break;
                        }
                    },
                    Err(error) => {
                        let health = Err(error);
                        for project in projects {
                            supervise_once(&store, &authority, &project, &health, &notifier).await;
                        }
                    }
                },
                Ok(_) => {}
                Err(error) => crate::logf!("supervisor", "project scan failed: {error}"),
            }
            if tokio::time::timeout(Duration::from_secs(5), store.pool.close_event())
                .await
                .is_ok()
            {
                break;
            }
        }
    });
    PolicySupervisor { task }
}

/// One project's pass: reconcile and deliver its notices, or record the
/// failure. Returns whether the journal page had more events. A failed
/// reconciliation is recorded whatever the observer health, so a persisting
/// failure is never only a log line (W2-06 review G4).
async fn supervise_once(
    store: &Store,
    authority: &SupervisorAuthority,
    project: &str,
    health: &Result<i64, String>,
    notifier: &Option<Notifier>,
) -> bool {
    match reconcile(store, authority, project, health).await {
        Ok(done) => {
            notify(notifier, &done.notices);
            done.result["hasMore"] == true
        }
        Err(error) => {
            match store.supervisor_error(authority, project, &error).await {
                Ok(notice) => notify(notifier, notice.as_slice()),
                Err(record_error) => {
                    crate::logf!("supervisor", "cannot record failure: {record_error}")
                }
            }
            false
        }
    }
}

async fn reconcile(
    store: &Store,
    authority: &SupervisorAuthority,
    project: &str,
    health: &Result<i64, String>,
) -> Result<Supervision, String> {
    // Notifications are wake hints, never authority to suppress policy checks.
    // A disabled project is untouched, so its observer error is not recorded.
    let observer_error = health.as_ref().err().map(String::as_str);
    store
        .supervise_project(authority, project, observer_error)
        .await
}

pub(super) async fn apply_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    for sql in [
        "CREATE TABLE continuous_supervisor(project_id TEXT PRIMARY KEY,cursor INTEGER NOT NULL DEFAULT 0 CHECK(cursor>=0),observed_at INTEGER,last_error TEXT,error_at INTEGER,policy_version INTEGER NOT NULL DEFAULT 1)",
        "CREATE TABLE continuous_supervisor_blocks(root_goal_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,reason TEXT NOT NULL,checkpoint_json TEXT NOT NULL,policy_json TEXT NOT NULL,cursor INTEGER NOT NULL,observed_at INTEGER NOT NULL,policy_version INTEGER NOT NULL)",
        "CREATE INDEX continuous_supervisor_blocks_project ON continuous_supervisor_blocks(project_id,observed_at,root_goal_id)",
    ] {sqlx::query(sql).execute(&mut **tx).await.map_err(db)?;}
    Ok(())
}

pub(super) async fn context(
    tx: &mut Transaction<'_, Sqlite>,
    project: &str,
) -> Result<Value, String> {
    let row:Option<ObservationRow>=sqlx::query_as("SELECT cursor,observed_at,last_error,error_at,policy_version FROM continuous_supervisor WHERE project_id=?")
        .bind(project).fetch_optional(&mut **tx).await.map_err(db)?;
    let Some((cursor, observed_at, error, error_at, policy_version)) = row else {
        return Ok(json!({"state":"unavailable","reason":"no supervisor observation recorded"}));
    };
    let records:Vec<(String,)>=sqlx::query_as("SELECT checkpoint_json FROM continuous_supervisor_blocks WHERE project_id=? ORDER BY observed_at DESC,root_goal_id LIMIT 32")
        .bind(project).fetch_all(&mut **tx).await.map_err(db)?;
    let blocks = records
        .into_iter()
        .map(|(raw,)| serde_json::from_str::<Value>(&raw).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    let (total,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM continuous_supervisor_blocks WHERE project_id=?")
            .bind(project)
            .fetch_one(&mut **tx)
            .await
            .map_err(db)?;
    Ok(
        json!({"state":if error.is_some(){"error"}else{"recorded"},"source":"rust/sqlite","cursor":cursor,"observedAt":observed_at,"lastError":error,"errorAt":error_at,"policyVersion":policy_version,"blocks":blocks,"totalBlocks":total,"truncated":total>32,"executionAuthority":false}),
    )
}

fn db(error: sqlx::Error) -> String {
    format!("continuous supervisor storage: {error}")
}

impl Store {
    pub(crate) async fn supervisor_projects(&self) -> Result<Vec<String>, String> {
        let rows:Vec<(String,)>=sqlx::query_as("SELECT c.project_id FROM continuous_projects c JOIN projects p ON p.id=c.project_id WHERE c.status IN ('enabled','draining') ORDER BY c.project_id")
            .fetch_all(&self.pool).await.map_err(db)?;
        Ok(rows.into_iter().map(|(id,)| id).collect())
    }

    pub(crate) async fn supervisor_error(
        &self,
        _authority: &SupervisorAuthority,
        project: &str,
        error: &str,
    ) -> Result<Option<SupervisorNotice>, String> {
        let error: String = error.chars().take(1000).collect();
        let now = now_unix_secs();
        let mut tx = self.pool.begin().await.map_err(db)?;
        // The upsert takes the writer lock before the previous state is read.
        // Invariant (W2-06 review K2): RETURNING yields the row after the
        // update, so it reports the previous `last_error` only because DO
        // UPDATE is a no-op for that column. DO UPDATE must never set
        // `last_error`; the error is written by the UPDATE below.
        let (was_degraded,): (bool,) = sqlx::query_as("INSERT INTO continuous_supervisor(project_id,last_error,error_at) VALUES(?,NULL,NULL) ON CONFLICT(project_id) DO UPDATE SET cursor=cursor RETURNING last_error IS NOT NULL")
            .bind(project).fetch_one(&mut *tx).await.map_err(db)?;
        sqlx::query("UPDATE continuous_supervisor SET last_error=?,error_at=? WHERE project_id=?")
            .bind(error)
            .bind(now)
            .bind(project)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        let notice = health_transition(&mut tx, project, was_degraded, true, now).await?;
        tx.commit().await.map_err(db)?;
        Ok(notice)
    }

    /// Current state is evaluated under the same writer transaction that advances
    /// the cursor. Replaying notices can neither repeat effects nor release claims.
    pub(crate) async fn supervise_project(
        &self,
        _authority: &SupervisorAuthority,
        project: &str,
        observer_error: Option<&str>,
    ) -> Result<Supervision, String> {
        self.require_project(project).await?;
        let now = now_unix_secs();
        let mut tx = self.pool.begin().await.map_err(db)?;
        // Obtain SQLite writer ownership before reading control/cursor/state.
        sqlx::query("INSERT OR IGNORE INTO continuous_supervisor(project_id) VALUES(?)")
            .bind(project)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        let (enabled,):(bool,)=sqlx::query_as("SELECT EXISTS(SELECT 1 FROM continuous_projects WHERE project_id=? AND status IN ('enabled','draining'))")
            .bind(project).fetch_one(&mut *tx).await.map_err(db)?;
        if !enabled {
            tx.rollback().await.map_err(db)?;
            return Ok(Supervision {
                result: json!({"state":"disabled","hasMore":false,"blockedRoots":[]}),
                notices: Vec::new(),
            });
        }
        let (old_cursor, was_degraded): (i64, bool) = sqlx::query_as(
            "SELECT cursor,last_error IS NOT NULL FROM continuous_supervisor WHERE project_id=?",
        )
        .bind(project)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
        let (events, has_more) =
            super::continuous::read_event_page(&mut tx, project, old_cursor).await?;
        let cursor = events.last().map_or(old_cursor, |event| event.cursor);
        let mut notices = Vec::new();
        // W2-06: supervisor kinds in the journal must come from this module.
        for event in &events {
            if attested(&mut tx, project, event).await? {
                continue;
            }
            sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'supervisor_audit',?,?)")
                .bind(project).bind(json!({"version":1,"producer":PRODUCER,"authority":"journal_attestation","finding":AuditFinding::UnattestedSupervisorEvent,"eventCursor":event.cursor}).to_string()).bind(now).execute(&mut *tx).await.map_err(db)?;
            notices.push(SupervisorNotice::Audit {
                project_id: project.to_string(),
                finding: AuditFinding::UnattestedSupervisorEvent,
                event_cursor: event.cursor,
                observed_at: now,
            });
        }
        let roots:Vec<(String,i64,String,i64,Option<String>)>=sqlx::query_as("SELECT g.id,g.deadline_at,g.status,g.updated_at,p.policy_json FROM continuous_goals g LEFT JOIN continuous_root_policies p ON p.root_goal_id=g.id WHERE g.project_id=? AND g.id=g.root_goal_id AND g.admitted=1 AND g.status IN ('open','awaiting_review','blocked') ORDER BY g.id")
            .bind(project).fetch_all(&mut *tx).await.map_err(db)?;
        let mut blocked = Vec::new();
        for (root, deadline, status, updated_at, encoded) in roots {
            let encoded = encoded.ok_or("supervisor root policy unavailable")?;
            let policy = DevelopmentPolicy::parse(&encoded)?;
            let tokens = super::development_budget::balance(&mut tx, &root).await?;
            let (failed,):(bool,)=sqlx::query_as("SELECT EXISTS(SELECT 1 FROM continuous_tasks t JOIN continuous_goals g ON g.id=t.goal_id WHERE g.root_goal_id=? AND t.status IN ('open','failed') AND t.attempts>=?)")
                .bind(&root).bind(i64::from(policy.continuous.max_attempts_per_task)).fetch_one(&mut *tx).await.map_err(db)?;
            // Whether a policy reason holds now, independent of the goal status.
            let holds = |reason: BlockReason| match reason {
                BlockReason::AlreadyBlocked => true,
                BlockReason::DeadlineExhausted => deadline <= 0 || now >= deadline,
                BlockReason::TokenAllowanceUnavailable => tokens.allowance.is_none(),
                BlockReason::TokenBudgetExhausted => tokens.exceeded || tokens.exhausted,
                BlockReason::TaskAttemptsExhausted => failed,
            };
            let reason = if status == "blocked" {
                Some(BlockReason::AlreadyBlocked)
            } else {
                BlockReason::ALL[1..]
                    .iter()
                    .copied()
                    .find(|reason| holds(*reason))
            };
            let Some(reason) = reason else {
                continue;
            };
            let (exists,): (bool,) = sqlx::query_as(
                "SELECT EXISTS(SELECT 1 FROM continuous_supervisor_blocks WHERE root_goal_id=?)",
            )
            .bind(&root)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
            if exists {
                continue;
            }
            // W2-06 review K1: a blocked root without checkpoint may be this
            // supervisor's own block whose checkpoint was lost. Restore it
            // from the attested journal event, without a second event,
            // notice or audit. PR 152 review: only if that event still
            // explains this block, i.e. its reason holds now and the root
            // goal has not changed since. Anything else is announced below.
            if reason == BlockReason::AlreadyBlocked {
                let evidence = attested_block_event(&mut tx, project, &root, old_cursor)
                    .await?
                    .filter(|(_, own, observed_at)| holds(*own) && updated_at <= *observed_at);
                if let Some((event_cursor, own, observed_at)) = evidence {
                    let mut checkpoint =
                        checkpoint(&mut tx, &root, project, own, cursor, observed_at, &tokens)
                            .await?;
                    checkpoint["restoredFromEventCursor"] = json!(event_cursor);
                    sqlx::query("INSERT INTO continuous_supervisor_blocks(root_goal_id,project_id,reason,checkpoint_json,policy_json,cursor,observed_at,policy_version) VALUES(?,?,?,?,?,?,?,1)")
                        .bind(&root).bind(project).bind(own.code()).bind(checkpoint.to_string()).bind(&encoded).bind(cursor).bind(observed_at).execute(&mut *tx).await.map_err(db)?;
                    continue;
                }
            }
            let checkpoint =
                checkpoint(&mut tx, &root, project, reason, cursor, now, &tokens).await?;
            sqlx::query("INSERT INTO continuous_supervisor_blocks(root_goal_id,project_id,reason,checkpoint_json,policy_json,cursor,observed_at,policy_version) VALUES(?,?,?,?,?,?,?,1)")
                .bind(&root).bind(project).bind(reason.code()).bind(checkpoint.to_string()).bind(&encoded).bind(cursor).bind(now).execute(&mut *tx).await.map_err(db)?;
            // Never change task claims, scope locks, launches, runs or sessions.
            sqlx::query("UPDATE continuous_goals SET status='blocked',updated_at=? WHERE project_id=? AND root_goal_id=? AND status IN ('open','awaiting_review')")
                .bind(now).bind(project).bind(&root).execute(&mut *tx).await.map_err(db)?;
            sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'supervisor_blocked',?,?)")
                .bind(project).bind(json!({"version":1,"producer":PRODUCER,"authority":"frozen_root_policy","rootGoalId":root,"reason":reason,"checkpointSource":"continuous_supervisor_blocks"}).to_string()).bind(now).execute(&mut *tx).await.map_err(db)?;
            notices.push(SupervisorNotice::Blocked {
                project_id: project.to_string(),
                root_goal_id: root.clone(),
                reason,
                observed_at: now,
            });
            blocked.push(root);
        }
        // An observer failure is recorded here, in the same transaction, so a
        // persisting failure does not flap between recovered and degraded.
        let error: Option<String> = observer_error.map(|e| e.chars().take(1000).collect());
        let degraded = error.is_some();
        sqlx::query("UPDATE continuous_supervisor SET cursor=?,observed_at=?,last_error=?,error_at=?,policy_version=1 WHERE project_id=?")
            .bind(cursor).bind(now).bind(error).bind(degraded.then_some(now)).bind(project).execute(&mut *tx).await.map_err(db)?;
        notices.extend(health_transition(&mut tx, project, was_degraded, degraded, now).await?);
        tx.commit().await.map_err(db)?;
        Ok(Supervision {
            result: json!({"state":"recorded","cursor":cursor,"hasMore":has_more,"blockedRoots":blocked,"observedAt":now}),
            notices,
        })
    }
}

const PRODUCER: &str = "policy_supervisor";

/// W2-06 review K1: the latest `supervisor_blocked` event for `root`, if it is
/// evidence of this supervisor's own block. Fail-closed: the event must lie
/// behind the acknowledged cursor (so an earlier pass attested it), carry the
/// producer stamp and a known reason, and no `supervisor_audit` may name it.
/// Only the latest event naming the root counts: an older one cannot explain
/// the current block. A block event that is not yet attested, or was
/// audited, is no evidence, and an unreadable audit row poisons the lookup
/// (PR 152 review) because it may have named the event.
/// Returns the event cursor, its reason and its timestamp.
async fn attested_block_event(
    tx: &mut Transaction<'_, Sqlite>,
    project: &str,
    root: &str,
    acknowledged: i64,
) -> Result<Option<(i64, BlockReason, i64)>, String> {
    let events: Vec<(i64, String, i64)> = sqlx::query_as("SELECT cursor,detail,created_at FROM continuous_events WHERE project_id=? AND kind='supervisor_blocked' AND cursor<=? ORDER BY cursor DESC")
        .bind(project).bind(acknowledged).fetch_all(&mut **tx).await.map_err(db)?;
    let audited: Vec<(String,)> = sqlx::query_as(
        "SELECT detail FROM continuous_events WHERE project_id=? AND kind='supervisor_audit'",
    )
    .bind(project)
    .fetch_all(&mut **tx)
    .await
    .map_err(db)?;
    let Some(audited) = audited
        .iter()
        .map(|(raw,)| serde_json::from_str::<Value>(raw).ok()?["eventCursor"].as_i64())
        .collect::<Option<Vec<i64>>>()
    else {
        return Ok(None);
    };
    let latest = events.into_iter().find_map(|(cursor, raw, created_at)| {
        let detail: Value = serde_json::from_str(&raw).ok()?;
        (detail["rootGoalId"] == root).then_some((cursor, detail, created_at))
    });
    let Some((cursor, detail, created_at)) = latest else {
        return Ok(None);
    };
    let reason = detail["reason"].as_str().and_then(BlockReason::from_code);
    Ok(match (detail["producer"] == PRODUCER, reason) {
        (true, Some(reason)) if !audited.contains(&cursor) => Some((cursor, reason, created_at)),
        _ => None,
    })
}

/// One journal entry and one notice per health change; none for a repeat.
/// The entry carries no error text: that stays in the authorized context read.
async fn health_transition(
    tx: &mut Transaction<'_, Sqlite>,
    project: &str,
    was_degraded: bool,
    degraded: bool,
    now: i64,
) -> Result<Option<SupervisorNotice>, String> {
    let (action, notice) = match (was_degraded, degraded) {
        (false, true) => (
            "degraded",
            SupervisorNotice::Degraded {
                project_id: project.to_string(),
                observed_at: now,
            },
        ),
        (true, false) => (
            "recovered",
            SupervisorNotice::Recovered {
                project_id: project.to_string(),
                observed_at: now,
            },
        ),
        _ => return Ok(None),
    };
    sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'supervisor_health',?,?)")
        .bind(project).bind(json!({"version":1,"producer":PRODUCER,"authority":"supervisor_observation","action":action}).to_string()).bind(now).execute(&mut **tx).await.map_err(db)?;
    Ok(Some(notice))
}

/// Whether a journal event of a supervisor kind was produced by this module.
/// A block event needs its stored checkpoint (same project, root, reason and
/// time); health and audit events need the producer stamp and a known value.
/// This is a shape check, not a signature: SQLite has no writer identity.
async fn attested(
    tx: &mut Transaction<'_, Sqlite>,
    project: &str,
    event: &super::continuous::ContinuousEvent,
) -> Result<bool, String> {
    if !event.kind.starts_with("supervisor_") {
        return Ok(true);
    }
    let detail: Value = serde_json::from_str(&event.detail).unwrap_or(Value::Null);
    let stamped = detail["producer"] == PRODUCER;
    Ok(match event.kind.as_str() {
        "supervisor_blocked" => {
            let (Some(root), Some(reason)) =
                (detail["rootGoalId"].as_str(), detail["reason"].as_str())
            else {
                return Ok(false);
            };
            let (found,): (bool,) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM continuous_supervisor_blocks WHERE root_goal_id=? AND project_id=? AND reason=? AND observed_at=?)")
                .bind(root).bind(project).bind(reason).bind(event.created_at).fetch_one(&mut **tx).await.map_err(db)?;
            found
        }
        "supervisor_health" => {
            stamped && matches!(detail["action"].as_str(), Some("degraded" | "recovered"))
        }
        "supervisor_audit" => {
            stamped && detail["finding"] == AuditFinding::UnattestedSupervisorEvent.code()
        }
        _ => false,
    })
}

async fn checkpoint(
    tx: &mut Transaction<'_, Sqlite>,
    root: &str,
    project: &str,
    reason: BlockReason,
    cursor: i64,
    now: i64,
    tokens: &super::development_budget::TokenBalance,
) -> Result<Value, String> {
    // W2-06: who blocked the root. This supervisor under the frozen policy, or
    // another producer (token settlement) whose cause is not recorded here.
    let blocked_by = reason.blocked_by();
    let tasks:Vec<TaskCheckpointRow>=sqlx::query_as("SELECT t.id,t.status,t.claim_owner,t.claim_fence,t.attempts,(SELECT MAX(revision) FROM development_checkpoints c WHERE c.task_id=t.id),COALESCE((SELECT a.role FROM continuous_team_assignments a WHERE a.task_id=t.id),'implementer') FROM continuous_tasks t JOIN continuous_goals g ON g.id=t.goal_id WHERE g.project_id=? AND g.root_goal_id=? ORDER BY t.created_at,t.id LIMIT 64")
        .bind(project).bind(root).fetch_all(&mut **tx).await.map_err(db)?;
    let (total_tasks,):(i64,)=sqlx::query_as("SELECT COUNT(*) FROM continuous_tasks t JOIN continuous_goals g ON g.id=t.goal_id WHERE g.project_id=? AND g.root_goal_id=?")
        .bind(project).bind(root).fetch_one(&mut **tx).await.map_err(db)?;
    // W2-04: the role the task is assigned to dispatch in (unassigned tasks
    // default to implementer). This is intent, not authority: the launch
    // boundary (`development_launches::run_role`) re-validates owner and policy.
    let tasks:Vec<Value>=tasks.into_iter().map(|(id,status,owner,fence,attempts,revision,role)| {
        let (owner, truncated) = bounded_reference(owner);
        json!({"taskId":id,"status":status,"claimOwner":owner,"claimOwnerTruncated":truncated,"claimFence":fence,"attempts":attempts,"checkpointRevision":revision,"dispatchRole":role})
    }).collect();
    let runs:Vec<RunCheckpointRow>=sqlx::query_as("SELECT r.id,r.task_id,r.status,r.worker_id,r.process_id FROM development_runs r JOIN continuous_tasks t ON t.id=r.task_id JOIN continuous_goals g ON g.id=t.goal_id WHERE g.project_id=? AND g.root_goal_id=? ORDER BY r.created_at,r.id LIMIT 128")
        .bind(project).bind(root).fetch_all(&mut **tx).await.map_err(db)?;
    let (total_runs,):(i64,)=sqlx::query_as("SELECT COUNT(*) FROM development_runs r JOIN continuous_tasks t ON t.id=r.task_id JOIN continuous_goals g ON g.id=t.goal_id WHERE g.project_id=? AND g.root_goal_id=?")
        .bind(project).bind(root).fetch_one(&mut **tx).await.map_err(db)?;
    let runs:Vec<Value>=runs.into_iter().map(|(id,task,status,worker,process)| {
        let (worker, truncated) = bounded_reference(worker);
        json!({"runId":id,"taskId":task,"status":status,"workerId":worker,"workerIdTruncated":truncated,"processId":process})
    }).collect();
    Ok(
        json!({"schemaVersion":1,"policyVersion":1,"source":"rust/sqlite","rootGoalId":root,"projectId":project,"reason":reason,"blockedBy":blocked_by,"observedAt":now,"eventCursor":cursor,"tasks":tasks,"taskCount":total_tasks,"tasksTruncated":total_tasks>64,"runs":runs,"runCount":total_runs,"runsTruncated":total_runs>128,"tokens":tokens,"ownershipRetained":true,"nextAction":"reconcile runs and read referenced task checkpoints before any retry"}),
    )
}

// These caller-supplied labels are display evidence, never retry authority.
// Read the referenced task/run for the exact value when truncation is reported.
fn bounded_reference(value: Option<String>) -> (Option<String>, bool) {
    match value {
        Some(value) => {
            let truncated = value.chars().count() > 256;
            (Some(value.chars().take(256).collect()), truncated)
        }
        None => (None, false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{development_policy::DevelopmentPolicy, testutil::TempDir};
    use serde_json::json;
    use std::sync::Mutex;

    const AUTHORITY: SupervisorAuthority = SupervisorAuthority { _private: () };

    async fn supervise(store: &Store, project: &str) -> Result<Value, String> {
        Ok(store
            .supervise_project(&AUTHORITY, project, None)
            .await?
            .result)
    }

    async fn journal(store: &Store, project: &str, kind: &str) -> Vec<(i64, Value)> {
        let rows: Vec<(i64, String)> = sqlx::query_as(
            "SELECT cursor,detail FROM continuous_events WHERE project_id=? AND kind=? ORDER BY cursor",
        )
        .bind(project)
        .bind(kind)
        .fetch_all(&store.pool)
        .await
        .unwrap();
        rows.into_iter()
            .map(|(cursor, detail)| (cursor, serde_json::from_str(&detail).unwrap()))
            .collect()
    }

    async fn expire(store: &Store, root: &str) {
        sqlx::query("UPDATE continuous_goals SET deadline_at=1 WHERE id=?")
            .bind(root)
            .execute(&store.pool)
            .await
            .unwrap();
    }

    async fn fixture() -> (TempDir, Store, String, String) {
        let dir = TempDir::new("policy-supervisor");
        std::fs::write(
            dir.path().join("projecta.dev.json"),
            serde_json::to_string(&DevelopmentPolicy::defaults()).unwrap(),
        )
        .unwrap();
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let project = store
            .create_project("supervisor", &dir.path().to_string_lossy())
            .await
            .unwrap();
        let goal = store
            .create_continuous_goal(&project.id, "goal", None, None, true)
            .await
            .unwrap();
        sqlx::query("INSERT INTO continuous_projects VALUES(?,'enabled',1)")
            .bind(&project.id)
            .execute(&store.pool)
            .await
            .unwrap();
        (dir, store, project.id, goal.id)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn observer_failure_cannot_suppress_authoritative_policy_checks() {
        let (_dir, store, project, root) = fixture().await;
        sqlx::query("UPDATE continuous_goals SET deadline_at=1 WHERE id=?")
            .bind(&root)
            .execute(&store.pool)
            .await
            .unwrap();
        let health = Err("injected observer failure".into());
        assert_eq!(
            reconcile(&store, &AUTHORITY, &project, &health)
                .await
                .unwrap()
                .result["blockedRoots"],
            json!([root])
        );
        assert_eq!(
            reconcile(&store, &AUTHORITY, &project, &health)
                .await
                .unwrap()
                .result["blockedRoots"],
            json!([])
        );
        let mut tx = store.pool.begin().await.unwrap();
        let snapshot = context(&mut tx, &project).await.unwrap();
        assert_eq!(snapshot["state"], "error");
        assert_eq!(snapshot["lastError"], "injected observer failure");
        assert!(snapshot["observedAt"].is_number());
        assert_eq!(snapshot["totalBlocks"], 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn oversized_ownership_labels_do_not_expand_durable_context() {
        let (_dir, store, project, root) = fixture().await;
        let task = store
            .create_continuous_task(&root, "work", None, vec!["src/a.rs".into()], vec![])
            .await
            .unwrap();
        let owner = "界".repeat(50_000);
        let claim = store
            .claim_continuous_task(&task.id, &owner, false)
            .await
            .unwrap();
        let run = store
            .record_development_run_intent(&task.id, &owner, claim.fence)
            .await
            .unwrap();
        sqlx::query("UPDATE development_runs SET worker_id=? WHERE id=?")
            .bind(&owner)
            .bind(&run.id)
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("UPDATE continuous_goals SET deadline_at=1 WHERE id=?")
            .bind(&root)
            .execute(&store.pool)
            .await
            .unwrap();
        supervise(&store, &project).await.unwrap();
        let mut tx = store.pool.begin().await.unwrap();
        let snapshot = context(&mut tx, &project).await.unwrap();
        let block = &snapshot["blocks"][0];
        assert_eq!(
            block["tasks"][0]["claimOwner"]
                .as_str()
                .unwrap()
                .chars()
                .count(),
            256
        );
        assert_eq!(block["tasks"][0]["claimOwnerTruncated"], true);
        assert_eq!(block["runs"][0]["workerIdTruncated"], true);
        assert!(snapshot.to_string().len() < 5000);
        let (stored,): (String,) =
            sqlx::query_as("SELECT claim_owner FROM continuous_tasks WHERE id=?")
                .bind(&task.id)
                .fetch_one(&mut *tx)
                .await
                .unwrap();
        assert_eq!(stored, owner);
    }

    /// W2-04: a blocked root's checkpoint names the assigned dispatch role of
    /// every task, so whoever reconciles it sees which tasks are review or
    /// integration work. Unassigned tasks default to implementer, like the
    /// launch boundary. (Nothing consumes the field automatically yet.)
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn checkpoint_records_the_dispatch_role_of_each_task() {
        let (_dir, store, project, root) = fixture().await;
        let reviewed = store
            .create_continuous_task(&root, "review", None, vec!["src/a.rs".into()], vec![])
            .await
            .unwrap();
        store
            .create_continuous_task(&root, "implement", None, vec!["src/b.rs".into()], vec![])
            .await
            .unwrap();
        store
            .assign_continuous_task(
                &reviewed.id,
                crate::store::team_assignments::AssignmentRequest {
                    team_id: "development".into(),
                    role: "reviewer".into(),
                    assignee: "carol".into(),
                    expected_revision: 0,
                },
            )
            .await
            .unwrap();
        sqlx::query("UPDATE continuous_goals SET deadline_at=1 WHERE id=?")
            .bind(&root)
            .execute(&store.pool)
            .await
            .unwrap();
        supervise(&store, &project).await.unwrap();
        let mut tx = store.pool.begin().await.unwrap();
        let snapshot = context(&mut tx, &project).await.unwrap();
        let tasks = snapshot["blocks"][0]["tasks"].as_array().unwrap();
        let role = |objective_task: &str| {
            tasks
                .iter()
                .find(|task| task["taskId"] == objective_task)
                .map(|task| task["dispatchRole"].clone())
        };
        assert_eq!(role(&reviewed.id), Some(json!("reviewer")));
        assert_eq!(
            tasks
                .iter()
                .filter(|task| task["dispatchRole"] == "implementer")
                .count(),
            1
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn racing_supervisors_commit_one_checkpoint() {
        let (_dir, store, project, root) = fixture().await;
        sqlx::query("UPDATE continuous_goals SET deadline_at=1 WHERE id=?")
            .bind(&root)
            .execute(&store.pool)
            .await
            .unwrap();
        let other = store.clone();
        let other_project = project.clone();
        let first = tokio::spawn(async move { supervise(&other, &other_project).await });
        let second = supervise(&store, &project).await.unwrap();
        let first = first.await.unwrap().unwrap();
        assert_eq!(
            first["blockedRoots"].as_array().unwrap().len()
                + second["blockedRoots"].as_array().unwrap().len(),
            1
        );
        let (events,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM continuous_events WHERE project_id=? AND kind='supervisor_blocked'")
            .bind(&project).fetch_one(&store.pool).await.unwrap();
        assert_eq!(events, 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn failed_journal_write_rolls_back_checkpoint_goal_and_cursor() {
        let (_dir, store, project, root) = fixture().await;
        // Establish an acknowledged cursor before the failed transaction.
        supervise(&store, &project).await.unwrap();
        let before: (i64, Option<i64>) = sqlx::query_as(
            "SELECT cursor,observed_at FROM continuous_supervisor WHERE project_id=?",
        )
        .bind(&project)
        .fetch_one(&store.pool)
        .await
        .unwrap();
        sqlx::query("UPDATE continuous_goals SET deadline_at=1,status='open' WHERE id=?")
            .bind(&root)
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("CREATE TRIGGER fail_supervisor BEFORE INSERT ON continuous_events WHEN NEW.kind='supervisor_blocked' BEGIN SELECT RAISE(ABORT,'injected journal failure'); END")
            .execute(&store.pool).await.unwrap();
        let error = supervise(&store, &project).await.unwrap_err();
        assert!(error.contains("injected journal failure"));
        store
            .supervisor_error(&AUTHORITY, &project, &error)
            .await
            .unwrap();
        let after: (i64, Option<i64>, Option<String>) = sqlx::query_as(
            "SELECT cursor,observed_at,last_error FROM continuous_supervisor WHERE project_id=?",
        )
        .bind(&project)
        .fetch_one(&store.pool)
        .await
        .unwrap();
        assert_eq!((after.0, after.1), before);
        assert!(after.2.is_some());
        let (status,): (String,) = sqlx::query_as("SELECT status FROM continuous_goals WHERE id=?")
            .bind(&root)
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(status, "open");
        let (blocks,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM continuous_supervisor_blocks")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(blocks, 0);
        sqlx::query("DROP TRIGGER fail_supervisor")
            .execute(&store.pool)
            .await
            .unwrap();
        assert_eq!(
            supervise(&store, &project).await.unwrap()["blockedRoots"],
            json!([root])
        );
        let mut tx = store.pool.begin().await.unwrap();
        let snapshot = context(&mut tx, &project).await.unwrap();
        assert_eq!(snapshot["state"], "recorded");
        assert!(snapshot["lastError"].is_null());
        assert_eq!(snapshot["blocks"][0]["reason"], "deadline_exhausted");
        assert_eq!(snapshot["executionAuthority"], false);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn paused_project_is_untouched_and_background_guard_enforces_draining() {
        let (_dir, store, project, root) = fixture().await;
        sqlx::query("UPDATE continuous_projects SET status='paused'")
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("UPDATE continuous_goals SET deadline_at=1 WHERE id=?")
            .bind(&root)
            .execute(&store.pool)
            .await
            .unwrap();
        assert_eq!(
            supervise(&store, &project).await.unwrap()["state"],
            "disabled"
        );
        let (observations,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM continuous_supervisor")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(observations, 0);
        sqlx::query("UPDATE continuous_projects SET status='draining'")
            .execute(&store.pool)
            .await
            .unwrap();
        let guard = start(store.clone(), None).await;
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let (status,): (String,) =
                    sqlx::query_as("SELECT status FROM continuous_goals WHERE id=?")
                        .bind(&root)
                        .fetch_one(&store.pool)
                        .await
                        .unwrap();
                if status == "blocked" {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        drop(guard);
        store.pool.close().await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn pages_resume_and_only_failed_final_attempt_blocks() {
        let (dir, store, project, root) = fixture().await;
        let task = store
            .create_continuous_task(&root, "last attempt", None, vec!["src/a.rs".into()], vec![])
            .await
            .unwrap();
        let claim = store
            .claim_continuous_task(&task.id, "owner", false)
            .await
            .unwrap();
        sqlx::query("UPDATE continuous_tasks SET attempts=3 WHERE id=?")
            .bind(&task.id)
            .execute(&store.pool)
            .await
            .unwrap();
        let other = store
            .create_project("other", &dir.path().join("other").to_string_lossy())
            .await
            .unwrap();
        let mut tx = store.pool.begin().await.unwrap();
        for i in 0..405 {
            sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'test',?,1)")
                .bind(&project).bind(i.to_string()).execute(&mut *tx).await.unwrap();
        }
        sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'foreign','hidden',1)")
            .bind(&other.id).execute(&mut *tx).await.unwrap();
        tx.commit().await.unwrap();
        let first = supervise(&store, &project).await.unwrap();
        assert_eq!(first["hasMore"], true);
        assert_eq!(first["blockedRoots"], json!([]));
        store.pool.close().await;
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let second = supervise(&store, &project).await.unwrap();
        assert!(second["cursor"].as_i64().unwrap() > first["cursor"].as_i64().unwrap());
        assert_eq!(second["hasMore"], true);
        let third = supervise(&store, &project).await.unwrap();
        assert_eq!(third["hasMore"], false);
        let (last,): (i64,) =
            sqlx::query_as("SELECT MAX(cursor) FROM continuous_events WHERE project_id=?")
                .bind(&project)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(third["cursor"], last);
        sqlx::query("UPDATE continuous_tasks SET status='failed' WHERE id=? AND claim_fence=?")
            .bind(&task.id)
            .bind(claim.fence)
            .execute(&store.pool)
            .await
            .unwrap();
        assert_eq!(
            supervise(&store, &project).await.unwrap()["blockedRoots"],
            json!([root])
        );
        let (reason,): (String,) =
            sqlx::query_as("SELECT reason FROM continuous_supervisor_blocks WHERE root_goal_id=?")
                .bind(&root)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(reason, "task_attempts_exhausted");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn supervisor_deadline_checkpoints_once_without_releasing_live_ownership() {
        let (dir, store, project, root) = fixture().await;
        let child = store
            .create_continuous_goal(&project, "replan", None, Some(root.clone()), true)
            .await
            .unwrap();
        let task = store
            .create_continuous_task(&child.id, "work", None, vec!["src/owned.rs".into()], vec![])
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
        sqlx::query("UPDATE continuous_goals SET deadline_at=1 WHERE root_goal_id=?")
            .bind(&root)
            .execute(&store.pool)
            .await
            .unwrap();
        let result = supervise(&store, &project).await.unwrap();
        assert_eq!(result["blockedRoots"], json!([root]));
        let goals = store.list_continuous_goals(&project).await.unwrap();
        assert!(goals.iter().all(|goal| goal.status == "blocked"));
        assert_eq!(
            store
                .get_development_run(&run.id)
                .await
                .unwrap()
                .unwrap()
                .status,
            "intent"
        );
        let ownership: (String, i64) =
            sqlx::query_as("SELECT claim_owner,claim_fence FROM continuous_tasks WHERE id=?")
                .bind(&task.id)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(ownership, ("owner".into(), claim.fence));
        let (locks,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM continuous_scope_locks WHERE task_id=?")
                .bind(&task.id)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(locks, 1);
        assert!(store
            .create_continuous_goal(&project, "replacement", None, None, true)
            .await
            .is_err());
        let again = supervise(&store, &project).await.unwrap();
        assert_eq!(again["blockedRoots"], json!([]));
        store.pool.close().await;
        let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let resumed = supervise(&reopened, &project).await.unwrap();
        assert_eq!(resumed["blockedRoots"], json!([]));
        assert_eq!(resumed["cursor"], again["cursor"]);
    }

    /// W2-06: a block is one user-facing state change, so exactly one notice;
    /// a reconciliation that changes nothing produces none.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn block_notifies_exactly_once_and_noop_is_silent() {
        let (_dir, store, project, root) = fixture().await;
        let quiet = store
            .supervise_project(&AUTHORITY, &project, None)
            .await
            .unwrap();
        assert_eq!(quiet.notices, vec![]);
        expire(&store, &root).await;
        let blocked = store
            .supervise_project(&AUTHORITY, &project, None)
            .await
            .unwrap();
        assert_eq!(blocked.notices.len(), 1, "{:?}", blocked.notices);
        assert!(matches!(
            &blocked.notices[0],
            SupervisorNotice::Blocked { project_id, root_goal_id, reason, .. }
                if project_id == &project && root_goal_id == &root && *reason == BlockReason::DeadlineExhausted
        ));
        let again = store
            .supervise_project(&AUTHORITY, &project, None)
            .await
            .unwrap();
        assert_eq!(again.notices, vec![]);
    }

    /// W2-06: the error write was silent. Health transitions now leave one
    /// journal audit entry and one notice each; repeats are no-ops. Neither the
    /// notice nor the journal entry carries the error text.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn health_transitions_are_audited_and_notified_once_without_error_text() {
        let (_dir, store, project, _root) = fixture().await;
        let secret = "db failed at C:\\Users\\me\\vault sk-abcdefghijklmnop";
        let first = store
            .supervisor_error(&AUTHORITY, &project, secret)
            .await
            .unwrap();
        assert!(
            matches!(first, Some(SupervisorNotice::Degraded { .. })),
            "{first:?}"
        );
        let repeat = store
            .supervisor_error(&AUTHORITY, &project, "another failure")
            .await
            .unwrap();
        assert_eq!(repeat, None);
        let health = journal(&store, &project, "supervisor_health").await;
        assert_eq!(health.len(), 1);
        assert_eq!(health[0].1["action"], "degraded");
        assert_eq!(health[0].1["producer"], "policy_supervisor");
        assert!(health[0].1["authority"].is_string());
        let serialized = serde_json::to_string(&first).unwrap();
        for leaked in [&serialized, &health[0].1.to_string()] {
            assert!(!leaked.contains("sk-"), "{leaked}");
            assert!(!leaked.contains("vault"), "{leaked}");
        }
        let recovered = store
            .supervise_project(&AUTHORITY, &project, None)
            .await
            .unwrap();
        assert_eq!(recovered.notices.len(), 1, "{:?}", recovered.notices);
        assert!(matches!(
            recovered.notices[0],
            SupervisorNotice::Recovered { .. }
        ));
        let steady = store
            .supervise_project(&AUTHORITY, &project, None)
            .await
            .unwrap();
        assert_eq!(steady.notices, vec![]);
        let health = journal(&store, &project, "supervisor_health").await;
        assert_eq!(
            health
                .iter()
                .map(|(_, d)| d["action"].clone())
                .collect::<Vec<_>>(),
            vec![json!("degraded"), json!("recovered")]
        );
    }

    /// W2-06: a persisting observer failure must not flap between recovered
    /// and degraded on every pass (each flap would write journal events and
    /// wake the supervisor again).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn persisting_observer_failure_degrades_once() {
        let (_dir, store, project, _root) = fixture().await;
        let failing = Err("observer down".to_string());
        let mut notices = Vec::new();
        for _ in 0..3 {
            notices.extend(
                reconcile(&store, &AUTHORITY, &project, &failing)
                    .await
                    .unwrap()
                    .notices,
            );
        }
        assert_eq!(notices.len(), 1, "{notices:?}");
        assert!(matches!(notices[0], SupervisorNotice::Degraded { .. }));
        assert_eq!(
            journal(&store, &project, "supervisor_health").await.len(),
            1
        );
        let healed = reconcile(&store, &AUTHORITY, &project, &Ok(1))
            .await
            .unwrap();
        assert!(matches!(
            healed.notices[..],
            [SupervisorNotice::Recovered { .. }]
        ));
    }

    /// W2-06: a `supervisor_*` journal event that no supervisor transaction
    /// produced is audited exactly once and changes no goal state.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn unattested_supervisor_event_is_audited_once_and_changes_nothing() {
        let (_dir, store, project, root) = fixture().await;
        supervise(&store, &project).await.unwrap();
        let forged = json!({"version":1,"rootGoalId":root,"reason":"deadline_exhausted","checkpointSource":"continuous_supervisor_blocks"});
        let (cursor,): (i64,) = sqlx::query_as("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'supervisor_blocked',?,1) RETURNING cursor")
            .bind(&project).bind(forged.to_string()).fetch_one(&store.pool).await.unwrap();
        let done = store
            .supervise_project(&AUTHORITY, &project, None)
            .await
            .unwrap();
        assert_eq!(done.result["blockedRoots"], json!([]));
        assert_eq!(done.notices.len(), 1, "{:?}", done.notices);
        assert!(matches!(
            &done.notices[0],
            SupervisorNotice::Audit { finding, event_cursor, .. }
                if *finding == AuditFinding::UnattestedSupervisorEvent && *event_cursor == cursor
        ));
        let audits = journal(&store, &project, "supervisor_audit").await;
        assert_eq!(audits.len(), 1);
        assert_eq!(audits[0].1["eventCursor"], cursor);
        assert_eq!(audits[0].1["producer"], "policy_supervisor");
        let (status,): (String,) = sqlx::query_as("SELECT status FROM continuous_goals WHERE id=?")
            .bind(&root)
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(status, "open");
        let again = store
            .supervise_project(&AUTHORITY, &project, None)
            .await
            .unwrap();
        assert_eq!(again.notices, vec![]);
        assert_eq!(journal(&store, &project, "supervisor_audit").await.len(), 1);
    }

    /// W2-06: the supervisor's own events are attested on the next pass.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn own_supervisor_events_are_attested() {
        let (_dir, store, project, root) = fixture().await;
        store
            .supervisor_error(&AUTHORITY, &project, "transient")
            .await
            .unwrap();
        expire(&store, &root).await;
        supervise(&store, &project).await.unwrap();
        let next = store
            .supervise_project(&AUTHORITY, &project, None)
            .await
            .unwrap();
        assert_eq!(next.notices, vec![]);
        assert_eq!(journal(&store, &project, "supervisor_audit").await, vec![]);
    }

    /// W2-06: every block names who blocked the root and with what authority.
    /// A goal blocked by another producer (token settlement) is recorded as
    /// unattested rather than credited to the supervisor.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn blocks_record_producer_and_authority() {
        // One unresolved root per project, so each case gets its own fixture.
        async fn blocked_by(external: bool) -> (Value, Vec<(i64, Value)>) {
            let (_dir, store, project, root) = fixture().await;
            let change = if external {
                "UPDATE continuous_goals SET status='blocked' WHERE id=?"
            } else {
                "UPDATE continuous_goals SET deadline_at=1 WHERE id=?"
            };
            sqlx::query(change)
                .bind(&root)
                .execute(&store.pool)
                .await
                .unwrap();
            supervise(&store, &project).await.unwrap();
            let mut tx = store.pool.begin().await.unwrap();
            let snapshot = context(&mut tx, &project).await.unwrap();
            tx.rollback().await.unwrap();
            let events = journal(&store, &project, "supervisor_blocked").await;
            (snapshot["blocks"][0]["blockedBy"].clone(), events)
        }
        let (own, own_events) = blocked_by(false).await;
        assert_eq!(
            own,
            json!({"producer":"policy_supervisor","authority":"frozen_root_policy"})
        );
        let (external, external_events) = blocked_by(true).await;
        assert_eq!(external, json!({"producer":"unattested","authority":null}));
        for events in [own_events, external_events] {
            assert_eq!(events.len(), 1);
            assert_eq!(events[0].1["producer"], "policy_supervisor");
            assert!(events[0].1["authority"].is_string());
        }
    }

    /// W2-06: the background task hands committed notices to its notifier.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn background_supervisor_delivers_one_notice_per_block() {
        let (_dir, store, project, root) = fixture().await;
        expire(&store, &root).await;
        let seen = Arc::new(Mutex::new(Vec::<SupervisorNotice>::new()));
        let sink = seen.clone();
        let guard = start(
            store.clone(),
            Some(Arc::new(move |notice: &SupervisorNotice| {
                sink.lock().unwrap().push(notice.clone())
            })),
        )
        .await;
        tokio::time::timeout(Duration::from_secs(10), async {
            while seen.lock().unwrap().is_empty() {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        drop(guard);
        let seen = seen.lock().unwrap().clone();
        assert_eq!(seen.len(), 1, "{seen:?}");
        assert!(matches!(
            &seen[0],
            SupervisorNotice::Blocked { project_id, .. } if project_id == &project
        ));
        store.pool.close().await;
    }

    /// W2-06 review K5: the stored code and the serialized notice code are the
    /// same closed set, and nothing outside it parses as a reason.
    #[test]
    fn code_matches_serde() {
        for reason in BlockReason::ALL {
            assert_eq!(serde_json::to_value(reason).unwrap(), reason.code());
            assert_eq!(BlockReason::from_code(reason.code()), Some(reason));
        }
        assert_eq!(BlockReason::from_code("manual_hold: goal title"), None);
        let finding = AuditFinding::UnattestedSupervisorEvent;
        assert_eq!(serde_json::to_value(finding).unwrap(), finding.code());
    }

    /// PR 152 review (GLM 3, Kimi 5): the TypeScript code lists in
    /// `src/lib/ipc.ts` are read from the source and must equal the Rust
    /// enums, so a code added or renamed on one side fails here instead of
    /// being dropped silently by `onSupervisorNotification`.
    #[test]
    fn typescript_code_lists_match_the_rust_enums() {
        fn listed(source: &str, name: &str) -> Vec<String> {
            let start = source
                .find(&format!("export const {name} = ["))
                .unwrap_or_else(|| panic!("{name} not found in src/lib/ipc.ts"));
            let body = &source[start..];
            let body = &body[body.find('[').unwrap() + 1..body.find(']').unwrap()];
            body.split(',')
                .map(|item| item.trim().trim_matches('"').to_string())
                .filter(|item| !item.is_empty())
                .collect()
        }
        let source = include_str!("../../../src/lib/ipc.ts");
        let reasons: Vec<String> = BlockReason::ALL
            .iter()
            .map(|reason| reason.code().to_string())
            .collect();
        assert_eq!(listed(source, "SUPERVISOR_BLOCK_REASONS"), reasons);
        assert_eq!(
            listed(source, "SUPERVISOR_AUDIT_FINDINGS"),
            vec![AuditFinding::UnattestedSupervisorEvent.code().to_string()]
        );
    }

    async fn drop_checkpoint(store: &Store, root: &str) {
        sqlx::query("DELETE FROM continuous_supervisor_blocks WHERE root_goal_id=?")
            .bind(root)
            .execute(&store.pool)
            .await
            .unwrap();
    }

    async fn blocked_by_of(store: &Store, project: &str) -> Value {
        let mut tx = store.pool.begin().await.unwrap();
        let snapshot = context(&mut tx, project).await.unwrap();
        tx.rollback().await.unwrap();
        assert_eq!(snapshot["totalBlocks"], 1, "{snapshot}");
        snapshot["blocks"][0].clone()
    }

    /// W2-06 review K1: losing the checkpoint of the supervisor's own block
    /// (raw SQL, a second process, a migration bug) must not turn that block
    /// into a foreign `already_blocked` one. The attested journal event is the
    /// evidence: the checkpoint is restored from it without a second
    /// `supervisor_blocked` event, notice or audit.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn lost_checkpoint_of_own_block_is_restored_silently() {
        let (_dir, store, project, root) = fixture().await;
        expire(&store, &root).await;
        supervise(&store, &project).await.unwrap();
        // The next pass attests the block event and moves the cursor past it.
        let attested = store
            .supervise_project(&AUTHORITY, &project, None)
            .await
            .unwrap();
        assert_eq!(attested.notices, vec![]);
        drop_checkpoint(&store, &root).await;
        let restored = store
            .supervise_project(&AUTHORITY, &project, None)
            .await
            .unwrap();
        assert_eq!(restored.notices, vec![]);
        assert_eq!(restored.result["blockedRoots"], json!([]));
        assert_eq!(
            journal(&store, &project, "supervisor_blocked").await.len(),
            1
        );
        assert_eq!(journal(&store, &project, "supervisor_audit").await, vec![]);
        let block = blocked_by_of(&store, &project).await;
        assert_eq!(block["reason"], "deadline_exhausted");
        assert_eq!(
            block["blockedBy"],
            json!({"producer":"policy_supervisor","authority":"frozen_root_policy"})
        );
        // PR 152 review (Kimi 5 iii): the restored checkpoint keeps the
        // original block time and names the event it was restored from.
        let (event_cursor, event_at): (i64, i64) = sqlx::query_as("SELECT cursor,created_at FROM continuous_events WHERE project_id=? AND kind='supervisor_blocked'")
            .bind(&project).fetch_one(&store.pool).await.unwrap();
        let (observed_at,): (i64,) = sqlx::query_as(
            "SELECT observed_at FROM continuous_supervisor_blocks WHERE root_goal_id=?",
        )
        .bind(&root)
        .fetch_one(&store.pool)
        .await
        .unwrap();
        assert_eq!(observed_at, event_at);
        assert_eq!(block["observedAt"], event_at);
        assert_eq!(block["restoredFromEventCursor"], event_cursor);
        let steady = store
            .supervise_project(&AUTHORITY, &project, None)
            .await
            .unwrap();
        assert_eq!(steady.notices, vec![]);
        assert_eq!(journal(&store, &project, "supervisor_audit").await, vec![]);
    }

    /// W2-06 review K1, fail-closed half: a block event the supervisor has not
    /// attested yet, or has audited, is no evidence. Its checkpoint loss is
    /// audited and the root is announced again as unattested, exactly as a
    /// block by another producer.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn unattested_block_events_never_restore_a_checkpoint() {
        // The checkpoint vanishes before the block event was attested.
        let (_dir, store, project, root) = fixture().await;
        expire(&store, &root).await;
        supervise(&store, &project).await.unwrap();
        drop_checkpoint(&store, &root).await;
        let done = store
            .supervise_project(&AUTHORITY, &project, None)
            .await
            .unwrap();
        assert_eq!(done.notices.len(), 2, "{:?}", done.notices);
        assert!(matches!(done.notices[0], SupervisorNotice::Audit { .. }));
        assert!(matches!(done.notices[1], SupervisorNotice::Blocked { .. }));
        assert_eq!(
            blocked_by_of(&store, &project).await["blockedBy"],
            json!({"producer":"unattested","authority":null})
        );

        // A stamped but forged block event, audited in an earlier pass, cannot
        // vouch for a later block by another producer.
        let (_dir, store, project, root) = fixture().await;
        supervise(&store, &project).await.unwrap();
        let forged = json!({"version":1,"producer":"policy_supervisor","authority":"frozen_root_policy","rootGoalId":root,"reason":"deadline_exhausted","checkpointSource":"continuous_supervisor_blocks"});
        sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'supervisor_blocked',?,1)")
            .bind(&project).bind(forged.to_string()).execute(&store.pool).await.unwrap();
        supervise(&store, &project).await.unwrap();
        assert_eq!(journal(&store, &project, "supervisor_audit").await.len(), 1);
        sqlx::query("UPDATE continuous_goals SET status='blocked' WHERE id=?")
            .bind(&root)
            .execute(&store.pool)
            .await
            .unwrap();
        let done = store
            .supervise_project(&AUTHORITY, &project, None)
            .await
            .unwrap();
        assert_eq!(done.result["blockedRoots"], json!([root]));
        assert_eq!(
            blocked_by_of(&store, &project).await["blockedBy"],
            json!({"producer":"unattested","authority":null})
        );
    }

    async fn block_then_attest(store: &Store, project: &str, root: &str) {
        expire(store, root).await;
        supervise(store, project).await.unwrap();
        let attested = store
            .supervise_project(&AUTHORITY, project, None)
            .await
            .unwrap();
        assert_eq!(attested.notices, vec![]);
    }

    fn announced_unattested(done: &Supervision, root: &str) -> bool {
        matches!(
            &done.notices[..],
            [SupervisorNotice::Blocked { root_goal_id, reason: BlockReason::AlreadyBlocked, .. }]
                if root_goal_id == root
        )
    }

    /// PR 152 review (GLM 1, Kimi 1): an attested block event only explains
    /// the block it recorded. After the root was reopened and its deadline
    /// extended, a later block by another producer is not the supervisor's:
    /// it is announced as unattested, never restored from the stale event.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn stale_block_event_does_not_explain_a_later_foreign_block() {
        let (_dir, store, project, root) = fixture().await;
        block_then_attest(&store, &project, &root).await;
        drop_checkpoint(&store, &root).await;
        sqlx::query("UPDATE continuous_goals SET status='open',deadline_at=? WHERE root_goal_id=?")
            .bind(now_unix_secs() + 86_400)
            .bind(&root)
            .execute(&store.pool)
            .await
            .unwrap();
        let reopened = store
            .supervise_project(&AUTHORITY, &project, None)
            .await
            .unwrap();
        assert_eq!(reopened.notices, vec![]);
        sqlx::query("UPDATE continuous_goals SET status='blocked' WHERE id=?")
            .bind(&root)
            .execute(&store.pool)
            .await
            .unwrap();
        let done = store
            .supervise_project(&AUTHORITY, &project, None)
            .await
            .unwrap();
        assert!(announced_unattested(&done, &root), "{:?}", done.notices);
        assert_eq!(
            blocked_by_of(&store, &project).await["blockedBy"],
            json!({"producer":"unattested","authority":null})
        );
    }

    /// PR 152 review (Kimi 1b): even while the recorded reason still holds, a
    /// root goal changed after the block event is not the block that event
    /// recorded, so the event cannot vouch for it.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn restore_requires_the_goal_untouched_since_the_event() {
        let (_dir, store, project, root) = fixture().await;
        block_then_attest(&store, &project, &root).await;
        drop_checkpoint(&store, &root).await;
        sqlx::query("UPDATE continuous_goals SET updated_at=updated_at+60 WHERE id=?")
            .bind(&root)
            .execute(&store.pool)
            .await
            .unwrap();
        let done = store
            .supervise_project(&AUTHORITY, &project, None)
            .await
            .unwrap();
        assert!(announced_unattested(&done, &root), "{:?}", done.notices);
    }

    /// PR 152 review (GLM 2, Kimi 2): an audit row whose detail cannot be read
    /// might have named the block event, so it poisons the restore instead of
    /// being skipped.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn unreadable_audit_row_poisons_checkpoint_restore() {
        let (_dir, store, project, root) = fixture().await;
        block_then_attest(&store, &project, &root).await;
        sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'supervisor_audit','not json',1)")
            .bind(&project).execute(&store.pool).await.unwrap();
        // The corrupt row is itself audited; the cursor moves past it.
        supervise(&store, &project).await.unwrap();
        drop_checkpoint(&store, &root).await;
        let done = store
            .supervise_project(&AUTHORITY, &project, None)
            .await
            .unwrap();
        assert!(announced_unattested(&done, &root), "{:?}", done.notices);
    }

    /// PR 152 review (Kimi 5 ii), positive control: an audit that names an
    /// unrelated event does not exclude the block event; the exclusion is
    /// cursor-exact.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn unrelated_audit_does_not_prevent_restore() {
        let (_dir, store, project, root) = fixture().await;
        block_then_attest(&store, &project, &root).await;
        sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'supervisor_health','{}',1)")
            .bind(&project).execute(&store.pool).await.unwrap();
        supervise(&store, &project).await.unwrap();
        assert_eq!(journal(&store, &project, "supervisor_audit").await.len(), 1);
        drop_checkpoint(&store, &root).await;
        let done = store
            .supervise_project(&AUTHORITY, &project, None)
            .await
            .unwrap();
        assert_eq!(done.notices, vec![]);
        assert_eq!(
            blocked_by_of(&store, &project).await["blockedBy"],
            json!({"producer":"policy_supervisor","authority":"frozen_root_policy"})
        );
    }

    /// W2-06 review G4: when the observer failed and the reconciliation then
    /// fails too, the failure is recorded (last error, degraded health and its
    /// notice) instead of only being logged.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn reconcile_failure_during_observer_failure_is_recorded() {
        let (_dir, store, project, root) = fixture().await;
        expire(&store, &root).await;
        sqlx::query("CREATE TRIGGER fail_supervisor BEFORE INSERT ON continuous_events WHEN NEW.kind='supervisor_blocked' BEGIN SELECT RAISE(ABORT,'injected journal failure'); END")
            .execute(&store.pool).await.unwrap();
        let seen = Arc::new(Mutex::new(Vec::<SupervisorNotice>::new()));
        let sink = seen.clone();
        let notifier: Option<Notifier> = Some(Arc::new(move |notice: &SupervisorNotice| {
            sink.lock().unwrap().push(notice.clone())
        }));
        let health = Err("observer down".to_string());
        assert!(!supervise_once(&store, &AUTHORITY, &project, &health, &notifier).await);
        let row: Option<(Option<String>,)> =
            sqlx::query_as("SELECT last_error FROM continuous_supervisor WHERE project_id=?")
                .bind(&project)
                .fetch_optional(&store.pool)
                .await
                .unwrap();
        let last_error = row.and_then(|(error,)| error).unwrap_or_default();
        assert!(
            last_error.contains("injected journal failure"),
            "{last_error:?}"
        );
        let seen = seen.lock().unwrap().clone();
        assert!(
            matches!(seen[..], [SupervisorNotice::Degraded { .. }]),
            "{seen:?}"
        );
    }
}
