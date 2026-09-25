//! SQLite persistence for projects and workers.
//!
//! The database lives in the Tauri app data directory as `projecta.db`. Its
//! schema is versioned through `PRAGMA user_version` (the migration contract,
//! docs/archive/plaene-2026-09/SANIERUNGSPLAN.md §2.2): version 1 is the frozen baseline every
//! pre-contract database already carries, later changes are numbered steps
//! that each run in their own transaction, and the database file is copied
//! aside before any migration run that applies actual steps.
//!
//! One piece of worker state is deliberately *not* persisted: the PTY
//! `session_id`. Sessions die with the process, so the mapping is kept in
//! memory and rebuilt by `respawn_worker` after a restart.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{FromRow, Sqlite, SqlitePool, Transaction};

#[path = "store/continuous.rs"]
mod continuous;
#[allow(dead_code)]
// Trusted accounting writers await provider/supervisor activation; reads and launch checks are wired.
pub mod development_budget;
#[allow(dead_code)] // Trusted native checkpoint consumer; batch session activation remains gated.
pub mod development_capture;
#[path = "store/development_delivery.rs"]
pub mod development_delivery;
#[path = "store/development_events.rs"]
mod development_events;
#[path = "store/development_identity.rs"]
mod development_identity;
#[path = "store/development_launches.rs"]
#[allow(dead_code)] // Launch activation waits for provider and scheduler acceptance.
pub mod development_launches;
#[path = "store/development_plan.rs"]
pub mod development_plan;
#[path = "store/development_runs.rs"]
#[allow(dead_code)] // Persistence transitions are gated until the scoped launcher is wired.
pub mod development_runs;
#[path = "store/discovery.rs"]
pub mod discovery;
#[path = "store/journal_watch.rs"]
mod journal_watch;
#[path = "store/queue_cancel.rs"]
mod queue_cancel;
#[path = "store/supervisor.rs"]
pub(crate) mod supervisor;
#[path = "store/team_assignments.rs"]
pub mod team_assignments;
#[cfg(test)]
#[path = "store/write_lock_tests.rs"]
mod write_lock_tests;
pub use continuous::{
    ContinuousClaim, ContinuousContext, ContinuousControl, ContinuousGoal, ContinuousTask,
};

/// A worker whose agent is currently attached to a live PTY session.
pub const STATUS_RUNNING: &str = "running";
/// A worker the user put away; its worktree stays on disk.
pub const STATUS_ARCHIVED: &str = "archived";
/// A worker whose agent process ended on its own.
pub const STATUS_EXITED: &str = "exited";

/// An ordinary worker: one agent, one task, one git worktree.
pub const KIND_WORKER: &str = "worker";
/// The project's orchestrator: one agent in the repository root, with no
/// worktree of its own, that plans work and drives the others through `pa`.
pub const KIND_ORCHESTRATOR: &str = "orchestrator";
/// A research scout: like an orchestrator it runs in the repository root with
/// no worktree, but it writes recommendations instead of steering workers.
pub const KIND_SCOUT: &str = "scout";
/// A queen: a coordinator like the orchestrator - repository root, no
/// worktree, never writes code - but scoped to one domain of the project and
/// itself answerable to the orchestrator. The workers she steers keep
/// [`KIND_WORKER`]; the hierarchy is recorded through `spawned_by`.
pub const KIND_QUEEN: &str = "queen";

/// The project's test command last ran green for this worker.
pub const TEST_PASS: &str = "pass";
/// The test command came back red - or was killed for running too long, which
/// is reported the same way: a gate that did not go green does not pass.
pub const TEST_FAIL: &str = "fail";
/// A test run is in flight right now. `NULL` instead of any of these three
/// values means the gate has never been asked.
pub const TEST_RUNNING: &str = "running";

/// Review comment still open. Legacy rows migrate here, never to done.
pub const COMMENT_OPEN: &str = "open";
/// Review comment marked done by a human.
#[allow(dead_code)] // written by F4-UI; persist tests already round-trip it
pub const COMMENT_DONE: &str = "done";

/// Approval came from the desktop window.
pub const APPROVAL_DESKTOP: &str = "desktop";
/// Approval carried a verdict token.
pub const APPROVAL_VERDICT: &str = "verdict_token";
/// Recorded without a human proof — never counts as ready.
pub const APPROVAL_UNVERIFIED: &str = "unverified";

pub const DECISION_APPROVED: &str = "approved";
pub const DECISION_CHANGES: &str = "changes_requested";

/// The one persisted merge step: [`merge_worker`](crate::workers::merge_worker)
/// writes it once the branch is provably in the base (merged pull request or
/// local merge), and a later call trusts it over anything git or GitHub says
/// now - the resume after a crash skips exactly the steps this marks done.
/// The pull-request step needs no marker of its own: `workers.pr_url` is its
/// record.
pub const MERGE_MERGED: &str = "merged";

/// The profile's provider answered normally the last time we looked.
pub const QUOTA_OK: &str = "ok";
/// The provider refused: out of credit, over the limit, rate limited.
pub const QUOTA_BLOCKED: &str = "blocked";
/// Nothing has been observed for this profile yet.
pub const QUOTA_UNKNOWN: &str = "unknown";

/// Monotonic counter behind [`new_id`].
static ID_SEQ: AtomicU64 = AtomicU64::new(1);

/// Ids follow the Phase 1 pty scheme: a prefix, the wall clock and a counter.
/// Unique without pulling in a uuid dependency, and safe to use both as a git
/// branch suffix and as a path component.
pub fn new_id(prefix: &str) -> String {
    let seq = ID_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{:x}-{seq}", now_unix_millis())
}

fn now_unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

pub fn now_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// The command that decides whether a worktree of this repository is green.
///
/// Detection is by manifest, because that is the one thing a repository states
/// about itself without being run: `package.json` means npm, `Cargo.toml`
/// means cargo, and a repository carrying both is gated on both. Anything else
/// gets no gate at all rather than a guess that would fail on every worker.
pub fn detect_test_command(repo_path: &Path) -> Option<String> {
    let node = repo_path.join("package.json").is_file();
    let cargo = repo_path.join("Cargo.toml").is_file();
    match (node, cargo) {
        (true, true) => Some("npm test && cargo test --quiet".to_string()),
        (true, false) => Some("npm test".to_string()),
        (false, true) => Some("cargo test --quiet".to_string()),
        (false, false) => None,
    }
}

/// A git repository the user registered with ProjectA.
///
/// Serialized as `{ "id", "name", "repoPath", "landingPageMarkdown",
/// "maxWorkers", "testCommand", "createdAt" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub repo_path: String,
    /// Editable Markdown content for the project's landing page. `None` until
    /// someone writes one; see [`Store::get_landing_page`].
    pub landing_page_markdown: Option<String>,
    /// Cap on concurrently running employees of this project. `None` takes the
    /// dispatcher's default; see [`crate::queue`]. Coordinators never count.
    pub max_workers: Option<i64>,
    /// Shell command that decides whether this project's work is green, filled
    /// in by [`detect_test_command`] when the project is registered. `None`
    /// means no gate: nothing here ever guesses a command at run time.
    pub test_command: Option<String>,
    pub created_at: i64,
}

/// One agent working on a task in its own git worktree.
///
/// Serialized as `{ "id", "projectId", "task", "profileId", "branch",
/// "worktreePath", "sessionId", "status", "kind", "prUrl", "spawnedBy",
/// "testStatus", "testedAt", "pausedReason", "createdAt" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worker {
    pub id: String,
    pub project_id: String,
    pub task: String,
    pub profile_id: String,
    pub branch: String,
    pub worktree_path: String,
    /// Live PTY session, if the agent is currently attached. Not persisted.
    pub session_id: Option<String>,
    pub status: String,
    /// [`KIND_WORKER`], [`KIND_ORCHESTRATOR`], [`KIND_SCOUT`] or [`KIND_QUEEN`].
    pub kind: String,
    /// Pull request for `branch`, as last seen by the GitHub poller.
    pub pr_url: Option<String>,
    /// The worker id of the coordinator that started this one, as the caller
    /// declared it. `None` means the human or the UI started it. This is
    /// bookkeeping for the hierarchy tree, not a security boundary.
    pub spawned_by: Option<String>,
    /// [`TEST_PASS`], [`TEST_FAIL`], [`TEST_RUNNING`] or `None` for a gate that
    /// has never run. See [`crate::testgate`].
    pub test_status: Option<String>,
    /// Unix seconds at which `test_status` was last written.
    pub tested_at: Option<i64>,
    /// Why this worker's agent was stopped without archiving it - today only
    /// [`crate::budget`] writes it. `None` is the ordinary case: nobody paused
    /// this worker. A respawn clears it; see [`crate::workers::respawn_worker`].
    pub paused_reason: Option<String>,
    pub created_at: i64,
}

/// The persisted half of a [`Worker`]: exactly the `workers` table columns.
#[derive(Debug, Clone, FromRow)]
pub struct WorkerRow {
    pub id: String,
    pub project_id: String,
    pub task: String,
    pub profile_id: String,
    pub branch: String,
    pub worktree_path: String,
    pub status: String,
    pub kind: String,
    pub pr_url: Option<String>,
    pub spawned_by: Option<String>,
    pub test_status: Option<String>,
    pub tested_at: Option<i64>,
    /// The approved role variant this agent was spawned as, or `None` for a
    /// plain profile. Persisted so a respawn can put the same specialization
    /// back on: without it a revived worker is quietly a different agent.
    pub role_variant_id: Option<String>,
    /// See [`Worker::paused_reason`].
    pub paused_reason: Option<String>,
    pub created_at: i64,
}

impl WorkerRow {
    pub fn into_worker(self, session_id: Option<String>) -> Worker {
        Worker {
            id: self.id,
            project_id: self.project_id,
            task: self.task,
            profile_id: self.profile_id,
            branch: self.branch,
            worktree_path: self.worktree_path,
            session_id,
            status: self.status,
            kind: self.kind,
            pr_url: self.pr_url,
            spawned_by: self.spawned_by,
            test_status: self.test_status,
            tested_at: self.tested_at,
            paused_reason: self.paused_reason,
            created_at: self.created_at,
        }
    }
}

const WORKER_COLUMNS: &str = "id, project_id, task, profile_id, branch, worktree_path, status, kind, pr_url, spawned_by, test_status, tested_at, role_variant_id, paused_reason, created_at";

/// Whether an agent profile may be spawned right now.
///
/// One row per profile - not per worker: a credit balance belongs to the
/// account behind the CLI, so every worker running `claude` shares it.
///
/// Serialized as `{ "profileId", "state", "blockedUntil", "reason",
/// "updatedAt" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AgentQuota {
    pub profile_id: String,
    /// [`QUOTA_OK`], [`QUOTA_BLOCKED`] or [`QUOTA_UNKNOWN`].
    pub state: String,
    /// Unix seconds at which the block lifts. `None` whenever the provider did
    /// not say - which, with the wording the agents print, is most of the time.
    pub blocked_until: Option<i64>,
    /// The line that gave it away, kept verbatim so the user can read it.
    pub reason: Option<String>,
    pub updated_at: i64,
}

impl AgentQuota {
    /// A profile nothing has been observed about yet.
    pub fn unknown(profile_id: &str) -> Self {
        Self {
            profile_id: profile_id.to_string(),
            state: QUOTA_UNKNOWN.to_string(),
            blocked_until: None,
            reason: None,
            updated_at: now_unix_secs(),
        }
    }

    #[cfg(test)]
    pub fn is_blocked(&self) -> bool {
        self.state == QUOTA_BLOCKED
    }
}

const QUOTA_COLUMNS: &str = "profile_id, state, blocked_until, reason, updated_at";

/// One review comment on one line of a worker's diff.
///
/// `sent_to_agent` records whether the comment made it into the agent's
/// terminal. It is false whenever the agent was not running at the time, which
/// is why the comment is kept either way: the review survives the session.
///
/// Serialized as `{ "id", "workerId", "file", "line", "body", "sentToAgent",
/// "createdAt", "disposition" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DiffComment {
    pub id: String,
    pub worker_id: String,
    /// Repository-relative path, as it appears in the diff.
    pub file: String,
    /// Line number on the new side of the diff.
    pub line: i64,
    pub body: String,
    pub sent_to_agent: bool,
    pub created_at: i64,
    /// [`COMMENT_OPEN`] until the reviewer marks it [`COMMENT_DONE`].
    pub disposition: String,
}

const DIFF_COMMENT_COLUMNS: &str =
    "id, worker_id, file, line, body, sent_to_agent, created_at, disposition";

/// Code/test/approval evidence bound to one worker. Absence means unknown,
/// never ready. A legacy `workers.test_status = pass` is not this row.
#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct ReviewEvidence {
    pub worker_id: String,
    pub worker_head_sha: String,
    pub base_tip_sha: String,
    pub merge_tree_oid: String,
    pub verification_policy_hash: Option<String>,
    pub test_passed: Option<i64>,
    pub tested_at: Option<i64>,
    pub acceptance_hash: Option<String>,
    pub reviewed_by: Option<String>,
    pub approval_source: Option<String>,
    pub approval_decision: Option<String>,
    pub approved_at: Option<i64>,
    pub worktree_prune_offered: i64,
}

impl ReviewEvidence {
    pub fn code(&self) -> crate::readiness::CodeTuple {
        crate::readiness::CodeTuple {
            worker_head_sha: self.worker_head_sha.clone(),
            base_tip_sha: self.base_tip_sha.clone(),
            merge_tree_oid: self.merge_tree_oid.clone(),
        }
    }

    pub fn test_record(&self) -> Option<crate::readiness::TestRecord> {
        let hash = self.verification_policy_hash.as_ref()?;
        let passed = self.test_passed?;
        Some(crate::readiness::TestRecord {
            code: self.code(),
            verification_policy_hash: hash.clone(),
            passed: passed != 0,
        })
    }

    pub fn approval_record(&self) -> Option<crate::readiness::ApprovalRecord> {
        let decision = match self.approval_decision.as_deref() {
            Some(DECISION_APPROVED) => crate::readiness::ApprovalDecision::Approved,
            Some(DECISION_CHANGES) => crate::readiness::ApprovalDecision::ChangesRequested,
            _ => return None,
        };
        let source = match self.approval_source.as_deref() {
            Some(APPROVAL_DESKTOP) => crate::readiness::ApprovalSource::Desktop,
            Some(APPROVAL_VERDICT) => crate::readiness::ApprovalSource::VerdictToken,
            Some(APPROVAL_UNVERIFIED) => crate::readiness::ApprovalSource::Unverified,
            _ => crate::readiness::ApprovalSource::Unverified,
        };
        Some(crate::readiness::ApprovalRecord {
            code: self.code(),
            acceptance_hash: self.acceptance_hash.clone().unwrap_or_default(),
            reviewed_by: self.reviewed_by.clone().unwrap_or_default(),
            approval_source: source,
            decision,
        })
    }
}

/// Evidence-bound trust grant for a project's setup command.
#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct SetupTrust {
    pub project_id: String,
    pub repo_identity: String,
    pub command_normalized: String,
    pub base_sha: String,
    pub inputs_hash: String,
    pub granted_at: i64,
}

impl SetupTrust {
    pub fn grant(&self) -> crate::readiness::TrustGrant {
        crate::readiness::TrustGrant {
            repo_identity: self.repo_identity.clone(),
            command_normalized: self.command_normalized.clone(),
            base_sha: self.base_sha.clone(),
            inputs_hash: self.inputs_hash.clone(),
        }
    }
}

/// A durable lifecycle observation about a worker.
///
/// These events intentionally complement rather than replace the current
/// board state: a guard retry is useful audit information even after the
/// terminal starts producing output again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StatusEvent {
    pub id: String,
    pub worker_id: String,
    pub kind: String,
    pub detail: String,
    pub source: String,
    pub created_at: i64,
}

/// A durable message in a worker's interaction log.
///
/// This table stores what the app *safely* knows about the conversation:
/// user input sent to a worker, lifecycle milestones, and the agent's own hook
/// announcements. It deliberately does **not** store raw PTY output: TUI
/// agents emit a redraw stream full of ANSI escape sequences, not a message
/// stream, so saving that as "messages" would produce unreadable garbage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub worker_id: String,
    /// [`MSG_USER`], [`MSG_AGENT`] or [`MSG_SYSTEM`].
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

/// Text typed by the user or sent on their behalf, e.g. a diff comment
/// delivered to the agent's terminal.
pub const MSG_USER: &str = "user";
/// A message reported by the agent through its hooks.
pub const MSG_AGENT: &str = "agent";
/// A lifecycle milestone reported by the app: worker created, archived,
/// respawned, session ended.
pub const MSG_SYSTEM: &str = "system";

const MESSAGE_COLUMNS: &str = "id, worker_id, role, content, created_at";

/// One task waiting to become a worker.
///
/// Serialized as `{ id, projectId, rawText, sharpenedText, profileId, status,
/// priority, workerId, error, spawnedBy, createdAt }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntry {
    pub id: String,
    pub project_id: String,
    pub raw_text: String,
    pub sharpened_text: Option<String>,
    pub profile_id: String,
    pub status: String,
    pub priority: i32,
    pub worker_id: Option<String>,
    pub error: Option<String>,
    /// The coordinator that booked this task, carried through dispatch so the
    /// worker it becomes is filed under the same coordinator. `None` means a
    /// human or the UI queued it.
    pub spawned_by: Option<String>,
    pub created_at: i64,
}

/// One thing a scout found worth doing, waiting for a human verdict.
///
/// Serialized as `{ id, projectId, title, url, rationale, effort, status,
/// createdAt }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub id: String,
    pub project_id: String,
    pub title: String,
    /// Where the library, repository or tool lives, when the scout named one.
    pub url: Option<String>,
    pub rationale: String,
    /// The scout's own guess at the size of the work: free text, because that
    /// is what an agent produces and nothing here depends on parsing it.
    pub effort: Option<String>,
    /// [`REC_NEW`], [`REC_ACCEPTED`] or [`REC_DISMISSED`].
    pub status: String,
    pub created_at: i64,
}

/// Nobody has looked at this recommendation yet.
pub const REC_NEW: &str = "new";
/// The user wants it; [`crate::scout::accept_recommendation`] has queued the work.
pub const REC_ACCEPTED: &str = "accepted";
/// The user does not want it. Kept, so the same idea is not proposed twice.
pub const REC_DISMISSED: &str = "dismissed";

/// One durable lesson a critic distilled out of a finished worker's run,
/// waiting for a human verdict before it reaches the project's playbook.
///
/// Serialized as `{ id, projectId, workerId, profileId, patternLabel, content,
/// status, createdAt }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Learning {
    pub id: String,
    pub project_id: String,
    /// The run this was learned from, kept so a reviewer can go back and read
    /// what actually happened.
    pub worker_id: String,
    /// The agent profile that run used. A lesson about one CLI's habits is
    /// rarely a lesson about another's, so the playbook files it per profile.
    pub profile_id: String,
    /// The critic's own short name for the pattern, when it named one: free
    /// text, because that is what an agent produces and nothing here parses it.
    pub pattern_label: Option<String>,
    pub content: String,
    /// [`LEARNING_PENDING`], [`LEARNING_APPROVED`] or [`LEARNING_REJECTED`].
    pub status: String,
    pub created_at: i64,
}

/// Distilled, but nobody has reviewed it yet. Nothing is injected from here.
pub const LEARNING_PENDING: &str = "pending";
/// A human said yes; the text is in the project's `PLAYBOOK.md`.
pub const LEARNING_APPROVED: &str = "approved";
/// A human said no. Kept, so the same lesson is not proposed twice.
pub const LEARNING_REJECTED: &str = "rejected";

/// One blocking decision an agent handed back to the human (Phase 21).
///
/// Serialized as `{ id, projectId, workerId, scope, question, optionsJson,
/// status, answer, createdAt, answeredAt, expiresAt }`.
///
/// The row is the whole record of a decision, which is why an answer never
/// overwrites the question and why [`Question::status`] distinguishes *who*
/// answered: a person, the clock, or the budget rule. See [`crate::questions`]
/// for the rules that write those three.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub id: String,
    pub project_id: String,
    /// `None` for a [`QUESTION_PREFLIGHT`] question: it is asked before there
    /// is a worker to ask it.
    pub worker_id: Option<String>,
    /// [`QUESTION_WORKER`] or [`QUESTION_PREFLIGHT`].
    pub scope: String,
    pub question: String,
    /// A JSON array of the answers offered, when the asker offered any. Stored
    /// as text rather than parsed: nothing in the core reads it, and the view
    /// that renders the buttons wants it as it was written.
    pub options_json: Option<String>,
    /// [`QUESTION_OPEN`], [`QUESTION_ANSWERED`], [`QUESTION_EXPIRED`] or
    /// [`QUESTION_REFUSED`].
    pub status: String,
    pub answer: Option<String>,
    pub created_at: i64,
    pub answered_at: Option<i64>,
    /// Who closed this row, when a caller closed it: [`ANSWERED_BY_HUMAN`]
    /// or [`ANSWERED_BY_UNVERIFIED`]. `None` on a row nobody answered - one
    /// still open, or one the clock or the budget rule closed, which
    /// `status` already names.
    pub answered_by: Option<String>,
    /// When the clock takes over and answers for the human. `None` on a row
    /// that was never open - the budget rule answers before there is anything
    /// to wait for.
    pub expires_at: Option<i64>,
}

/// A worker asked this, and the answer goes back into its terminal.
pub const QUESTION_WORKER: &str = "worker";
/// Asked before a worker exists, while a prompt is being sharpened. There is
/// no terminal to answer into; the answer feeds the next enhance round.
pub const QUESTION_PREFLIGHT: &str = "preflight";

/// Waiting for a human. The only status the decision tab has to act on.
pub const QUESTION_OPEN: &str = "open";
/// Somebody decided, as opposed to the clock or the budget rule. *Which*
/// somebody is [`Question::answered_by`]'s job: this status says a caller
/// answered, not that a person did. It used to say "a human decided", which
/// the API cannot prove - `pa answer` needs no verdict token, so an agent can
/// answer its own question. Rather than lock the agent out of a decision that
/// only reaches its own terminal, the row records what is actually known.
pub const QUESTION_ANSWERED: &str = "answered";
/// Nobody decided within the time limit, so the agent was told to decide for
/// itself. Kept apart from [`QUESTION_ANSWERED`] on purpose: "the human chose
/// this" and "the clock ran out" are different facts about a decision, and a
/// log that conflates them cannot be read back.
pub const QUESTION_EXPIRED: &str = "expired";
/// The worker already had its maximum of open questions, so this one was
/// answered the moment it was asked. It never waited for anybody.
pub const QUESTION_REFUSED: &str = "refused";

/// The answer carried the verdict token, which lives in the window and in the
/// hand of whoever the window showed it to. Nothing an agent can read.
///
/// This is the only value that is *evidence*. Everything else is an absence of
/// it, which is why the other one is not called "agent": a person answering
/// from a terminal without the token looks exactly the same from here, and
/// guessing which it was would be the same overclaim this field exists to fix.
pub const ANSWERED_BY_HUMAN: &str = "human";

/// The answer came without the verdict token. Could be the agent answering its
/// own question, could be a person who did not carry the token. Unknown, and
/// recorded as unknown.
pub const ANSWERED_BY_UNVERIFIED: &str = "unverified";

/// A specialised agent role distilled out of the approved learnings of one
/// `(pattern_label, base profile)` key, waiting for a human verdict.
///
/// A variant is never a replacement for a profile: it carries an *addition* to
/// that profile's system prompt, and it only ever runs when somebody picks it.
/// See [`crate::roles`] for why nothing here activates itself.
///
/// Serialized as `{ id, projectId, name, baseProfileId, patternLabel,
/// systemPromptAddition, version, status, createdAt }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RoleVariant {
    pub id: String,
    pub project_id: String,
    /// What the variant is *for*, without the profile prefix: "Test-Fixer",
    /// not "Enhanced Claude". The prefix comes from the base profile at
    /// display time (see [`crate::roles::display_name`]).
    pub name: String,
    /// The profile this variant refines. Its system prompt stays in charge;
    /// [`RoleVariant::system_prompt_addition`] is appended under it.
    pub base_profile_id: String,
    /// The learning pattern that earned this variant. Together with the base
    /// profile it is the key a variant is proposed and versioned per.
    pub pattern_label: String,
    pub system_prompt_addition: String,
    /// Starts at 1 and counts up per key: a later proposal on the same key
    /// supersedes the approved one before it.
    pub version: i64,
    /// [`ROLE_PENDING`], [`ROLE_APPROVED`] or [`ROLE_REJECTED`].
    pub status: String,
    pub created_at: i64,
}

/// Proposed, but nobody has reviewed it yet. Nothing spawns from here.
pub const ROLE_PENDING: &str = "pending";
/// A human said yes; this is the variant that key currently offers.
pub const ROLE_APPROVED: &str = "approved";
/// A human said no, or a newer version replaced it.
pub const ROLE_REJECTED: &str = "rejected";

/// One line of the fleet-wide activity feed (Phase 16).
///
/// The feed is a read-only union over the tables that already record what the
/// fleet did: worker creation, status events, messages, queued tasks,
/// recommendations, learnings and role variants. Nothing here is written on
/// its own - the feed is a view, not a log of its own, so it can never
/// disagree with the tables it reads.
///
/// Serialized as `{ "id", "createdAt", "category", "projectId", "workerId",
/// "workerLabel", "summary" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEntry {
    /// Id of the underlying row, prefixed by its table (`wk-…`, `ev-…`, …).
    pub id: String,
    pub created_at: i64,
    /// Short stable tag: `worker`, `status`, `message`, `queue`,
    /// `recommendation`, `learning` or `role`.
    pub category: String,
    pub project_id: String,
    /// The worker the entry is about, when there is one.
    pub worker_id: Option<String>,
    /// The worker's task, shortened, so a list can name the actor without a
    /// second lookup. `None` for entries with no worker.
    pub worker_label: Option<String>,
    /// One factual line about what happened, already truncated.
    pub summary: String,
}

/// One request OmniRoute logged, mirrored into ProjectA's own ledger.
///
/// The source is the router's `/api/usage/logs`, a ring buffer of the last few
/// hundred requests. Polling it every five minutes and keeping what is new is
/// how a rolling window becomes a history; [`Store::insert_usage_event`] does
/// the deduplication, keyed on [`UsageEvent::id`].
///
/// Two fields are honestly incomplete, and neither is padded with a made-up
/// number (see [`crate::omniroute`] for the verification behind both):
///
/// - **`profile_id`** is `None` unless the row's model is one a routed profile
///   pins. OmniRoute's log carries no session and no client identity, so a
///   request cannot be traced back to the worker that made it.
/// - **`cost_usd`** is `None` when the feed did not price the row, which the
///   current line format never does. The authoritative totals come from
///   `/api/usage/history` instead, and the ledger does not pretend otherwise.
///
/// Serialized as `{ id, ts, profileId, model, provider, tokensIn, tokensOut,
/// costUsd, rawJson }`.
#[derive(Debug, Clone, PartialEq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct UsageEvent {
    /// Stable hash of the source line: the same request read twice produces
    /// the same id, which is what makes the poll idempotent.
    pub id: String,
    /// Unix seconds, from the router's own timestamp - not the poll time.
    pub ts: i64,
    /// The ProjectA profile this row could be attributed to, or `None`.
    pub profile_id: Option<String>,
    /// The model as OmniRoute recorded it - usually the one it resolved to
    /// (`gpt-5.6-sol`), sometimes the virtual alias that was asked for.
    pub model: String,
    /// OmniRoute's provider name for the row, lowercased.
    pub provider: String,
    pub tokens_in: i64,
    pub tokens_out: i64,
    /// `None` when the feed did not price the row.
    pub cost_usd: Option<f64>,
    /// The source line or object, verbatim. Kept so a later reading of the
    /// feed can recover a field this schema does not have a column for.
    pub raw_json: String,
}

/// Tokens, requests and dollars over a set of [`UsageEvent`] rows.
///
/// `cost_usd` sums only the rows that carried a price; `priced` says how many
/// those were, so a caller can tell "zero dollars" from "nothing was priced".
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct UsageTotals {
    pub requests: i64,
    pub tokens_in: i64,
    pub tokens_out: i64,
    pub cost_usd: f64,
    /// How many of the counted rows actually carried a cost.
    pub priced: i64,
}

/// One PTY session of one worker, as it is written down (Phase 20).
///
/// The row is opened by [`Store::bind_session`] and closed by
/// [`Store::mark_session_exited`]. `ended_at` and `exit_code` are `None` while
/// the session is still attached - and stay `None` for a session the app never
/// saw end, which is what a crash or a kill -9 leaves behind. That is a third
/// state, not a zero: "still running" and "ended, we do not know how" are both
/// honest answers and neither is an exit code of 0.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// The PTY session id, which is what the exit hook has in its hand.
    pub id: String,
    pub worker_id: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub exit_code: Option<i64>,
}

/// [`UsageTotals`] for one profile, as `usage_events` groups them.
#[derive(Debug, Clone, PartialEq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProfileUsageTotals {
    /// `None` is a real group: the rows nothing could be attributed to.
    pub profile_id: Option<String>,
    pub requests: i64,
    pub tokens_in: i64,
    pub tokens_out: i64,
    pub cost_usd: f64,
    pub priced: i64,
}

/// How many of something happened on one UTC day. `day` is the day's first
/// second, so it is both the key and a timestamp the frontend can format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DayCount {
    pub day: i64,
    pub count: i64,
}

/// The agent reported this event through its hooks.
#[allow(dead_code)]
pub const SRC_HOOK: &str = "hook";
/// The event was inferred from terminal output by the status engine.
#[allow(dead_code)]
pub const SRC_HEURISTIC: &str = "heuristic";
/// The event came from a `gh` or `git` poll.
#[allow(dead_code)]
pub const SRC_GIT: &str = "git";
/// The submit guard or another lifecycle guard produced the event.
pub const SRC_GUARD: &str = "guard";
/// A generic application lifecycle step: worker created, archived, respawned,
/// session ended.
#[allow(dead_code)]
pub const SRC_LIFECYCLE: &str = "lifecycle";
/// The budget watcher stopped or released a profile; see [`crate::budget`].
pub const SRC_BUDGET: &str = "budget";
/// A blocking decision was asked for or made; see [`crate::questions`].
pub const SRC_QUESTION: &str = "question";

const RECOMMENDATION_COLUMNS: &str =
    "id, project_id, title, url, rationale, effort, status, created_at";

const LEARNING_COLUMNS: &str =
    "id, project_id, worker_id, profile_id, pattern_label, content, status, created_at";

const USAGE_EVENT_COLUMNS: &str = "id, ts, profile_id, model, provider, tokens_in, \
     tokens_out, cost_usd, raw_json";

const ROLE_VARIANT_COLUMNS: &str = "id, project_id, name, base_profile_id, pattern_label, \
     system_prompt_addition, version, status, created_at";

const QUESTION_COLUMNS: &str = "id, project_id, worker_id, scope, question, options_json, \
     status, answer, created_at, answered_at, answered_by, expires_at";

pub const QUEUE_QUEUED: &str = "queued";
pub const QUEUE_SHARPENING: &str = "sharpening";
pub const QUEUE_READY: &str = "ready";
/// Claimed by a dispatcher and not yet a worker.
///
/// The transient state between "this entry is the one" and "here is its
/// worker". It exists so the two cannot be decided twice: claiming is a single
/// conditional UPDATE, so a second dispatcher - another window, the CLI,
/// another sweep that overlapped - finds the entry already taken instead of
/// starting a second agent on the same task. A claim that never becomes a
/// worker is released again, and one that outlives the process is freed at the
/// next startup by [`Store::release_claimed_queue_entries`].
pub const QUEUE_DISPATCHING: &str = "dispatching";
pub const QUEUE_DISPATCHED: &str = "dispatched";
pub const QUEUE_FAILED: &str = "failed";

const QUEUE_COLUMNS: &str = "id, project_id, raw_text, sharpened_text, profile_id, status, priority, worker_id, error, spawned_by, created_at";

/// Version 1 of the schema: the baseline in [`Store::apply_baseline`], frozen
/// as it shipped. Databases written before the migration contract already
/// carry it - every build up to now created or repaired it on every startup -
/// so they are *adopted* as version 1 without re-running anything.
const BASELINE_VERSION: i64 = 1;

/// How many `<db>.pre-migration-<unix-ts>.bak` snapshots are kept next to the
/// database file; older ones are pruned after each backup.
const MAX_PRE_MIGRATION_BACKUPS: usize = 5;

/// Numbered schema changes applied after the baseline, in ascending order.
/// Each step runs in exactly one transaction together with its
/// `user_version` bump, so a crash mid-step leaves the database at the
/// previous version, ready to re-enter from it. Additive and forward-only:
/// there is no downgrade path, and a database newer than this build is
/// refused (the updater cannot downgrade the app either).
///
/// A new step is one entry here plus one arm in
/// [`Store::apply_migration_step`].
const MIGRATIONS: &[(i64, &str)] = &[
    (2, "workers.merge_state"),
    (3, "review evidence, setup trust, comment disposition"),
    (4, "durable continuous development goals, tasks and claims"),
    (5, "immutable continuous root policies"),
    (6, "durable development runs and evidence"),
    (7, "single-use development launch reservations"),
    (8, "bound development launch route receipts"),
    (9, "structured task checkpoints across development runs"),
    (10, "root token reservations and trusted usage settlement"),
    (11, "stable scoped evidence and review traversal"),
    (12, "transactional runtime journal notifications"),
    (13, "durable policy supervisor cursors and root checkpoints"),
    (14, "versioned task team assignments"),
    (15, "durable discovery admission limits"),
    (16, "backend-observed development worktree baselines"),
    (
        17,
        "process attempt identity and durable development delivery intent",
    ),
    (
        18,
        "fenced native capture owners and provisional checkpoints",
    ),
    (19, "atomic native capture completion and measured usage"),
    (20, "durable versioned development plan projections"),
    (21, "append-only development execution identities"),
    (
        22,
        "exited_undelivered launch state for providers that exit before input delivery",
    ),
];

/// The schema version [`Store::migrate`] brings a database to: the highest
/// numbered step, or the baseline while no steps exist.
fn target_schema_version() -> i64 {
    MIGRATIONS
        .iter()
        .map(|(version, _)| *version)
        .fold(BASELINE_VERSION, Ord::max)
}

/// Both directions of the worker <-> session binding under one lock, so they
/// cannot drift apart. `by_worker` is what the app runs on - which terminal
/// belongs to which card. `by_session` is what the exit hook and the status
/// engine ask *per PTY chunk*: a linear scan there would tax every chunk of
/// output of every agent.
#[derive(Default)]
struct SessionBindings {
    by_worker: HashMap<String, String>,
    by_session: HashMap<String, String>,
    native_closing: HashMap<String, String>,
}

impl SessionBindings {
    fn bind(&mut self, worker_id: &str, session_id: &str) {
        // A worker rebinding (respawn) or a session id coming round twice:
        // retire the stale half-pairs before the new one goes in, or the
        // reverse direction would keep finding ghosts.
        if let Some(old_session) = self
            .by_worker
            .insert(worker_id.to_string(), session_id.to_string())
        {
            self.by_session.remove(&old_session);
        }
        if let Some(old_worker) = self
            .by_session
            .insert(session_id.to_string(), worker_id.to_string())
        {
            if old_worker != worker_id {
                self.by_worker.remove(&old_worker);
            }
        }
    }

    fn unbind_worker(&mut self, worker_id: &str) -> Option<String> {
        let session = self.by_worker.remove(worker_id)?;
        self.by_session.remove(&session);
        Some(session)
    }
}

/// Exits that fired before their `sessions` row existed: session id ->
/// (ended_at, exit_code). [`Store::record_session_start`] folds them into
/// the row it inserts, so the spawn→bind race cannot leave an open row
/// behind. In-memory only: a session cannot outlive the process, so its
/// pending exit cannot need to.
type PendingExits = Arc<Mutex<HashMap<String, (i64, Option<i32>)>>>;

/// The database plus the in-memory worker to PTY session mapping.
///
/// Cheap to clone: the pool and the session map are both reference counted, so
/// background threads (the PTY exit hook) can hold their own handle.
#[derive(Clone)]
pub struct Store {
    pool: SqlitePool,
    /// The live worker <-> session binding, in both directions.
    sessions: Arc<Mutex<SessionBindings>>,
    /// See [`PendingExits`].
    pending_exits: PendingExits,
    /// Serializes read-modify-write on `review_evidence` across the writers in
    /// this process (test gate and desktop verdict write the same row from
    /// different tasks). The app is single-instance, so an in-process lock is
    /// the whole boundary; without it the last writer would silently drop the
    /// other's test or approval fields.
    review_evidence_lock: Arc<tokio::sync::Mutex<()>>,
    journal_watch: Arc<tokio::sync::OnceCell<journal_watch::JournalWatch>>,
}

impl Store {
    /// Open (creating if needed) the database at `path` and migrate its
    /// schema to this build's version; see [`Store::migrate`].
    pub async fn open(path: &Path) -> Result<Self, String> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Full)
            .busy_timeout(Duration::from_secs(5))
            // SQLite's own default, which sqlx otherwise overrides. `workers`
            // declares the reference to `projects` for documentation, but
            // `remove_project` intentionally outlives its workers: it drops the
            // project row and *archives* the worker rows, so their branches and
            // worktrees stay findable on disk. Enforcement would make that
            // combination impossible with a NOT NULL `project_id`. The relation
            // is upheld in code - `create_worker` refuses an unknown project.
            .foreign_keys(false);

        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options.clone())
            .await
            .map_err(|e| format!("failed to open {}: {e}", path.display()))?;

        let mut store = Self {
            pool,
            sessions: Arc::new(Mutex::new(SessionBindings::default())),
            pending_exits: Arc::new(Mutex::new(HashMap::new())),
            review_evidence_lock: Arc::new(tokio::sync::Mutex::new(())),
            journal_watch: Arc::new(tokio::sync::OnceCell::new()),
        };
        let schema_changed = store.user_version().await? != target_schema_version();
        store.migrate(path).await?;
        if schema_changed {
            // Connections opened before multi-step ALTER TABLE migrations can
            // retain old SQLite/SQLx column metadata. Retire the entire startup
            // pool before publishing Store; no running caller owns it yet.
            store.pool.close().await;
            store.pool = SqlitePoolOptions::new()
                .max_connections(4)
                .connect_with(options)
                .await
                .map_err(|e| format!("failed to reopen migrated database: {e}"))?;
        }
        Ok(store)
    }

    /// Bring the database at `path` to [`target_schema_version`]. The
    /// contract (docs/archive/plaene-2026-09/SANIERUNGSPLAN.md §2.2):
    ///
    /// - A database that predates this machinery (`user_version = 0`, tables
    ///   present) already carries the baseline - every build up to now ran
    ///   the full idempotent schema setup on every startup - so it is
    ///   *adopted* as [`BASELINE_VERSION`] without re-running anything.
    /// - A fresh database gets the baseline, in one transaction.
    /// - Every later change is a numbered [`MIGRATIONS`] step, each in its
    ///   own transaction together with the `user_version` bump, so a crash
    ///   mid-step leaves a clean previous version to re-enter from.
    /// - Before a run that applies actual steps, the database file is copied
    ///   aside ([`Store::backup_database`]).
    /// - Forward only: a database newer than this build is refused, because
    ///   downgrading is not a supported state.
    async fn migrate(&self, path: &Path) -> Result<(), String> {
        let target = target_schema_version();
        let mut version = self.user_version().await?;
        if version > target {
            return Err(format!(
                "database schema version {version} is newer than this build supports \
                 ({target}); refusing to open - update the app, downgrading is not supported"
            ));
        }
        if version == 0 {
            version = if self.has_user_tables().await? {
                sqlx::query(&format!("PRAGMA user_version = {BASELINE_VERSION}"))
                    .execute(&self.pool)
                    .await
                    .map_err(|e| format!("failed to adopt the baseline schema version: {e}"))?;
                BASELINE_VERSION
            } else {
                let mut tx = self
                    .pool
                    .begin()
                    .await
                    .map_err(|e| format!("failed to begin the baseline transaction: {e}"))?;
                Self::apply_baseline(&mut tx).await?;
                sqlx::query(&format!("PRAGMA user_version = {BASELINE_VERSION}"))
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| format!("failed to record the schema version: {e}"))?;
                tx.commit()
                    .await
                    .map_err(|e| format!("failed to commit the baseline schema: {e}"))?;
                BASELINE_VERSION
            };
        }
        let pending: Vec<(i64, &str)> = MIGRATIONS
            .iter()
            .copied()
            .filter(|(step, _)| *step > version)
            .collect();
        if pending.is_empty() {
            return Ok(());
        }
        self.backup_database(path).await?;
        for (step, name) in pending {
            let mut tx = self
                .pool
                .begin()
                .await
                .map_err(|e| format!("failed to begin migration {step} ({name}): {e}"))?;
            Self::apply_migration_step(&mut tx, step)
                .await
                .map_err(|e| format!("migration {step} ({name}) failed: {e}"))?;
            sqlx::query(&format!("PRAGMA user_version = {step}"))
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("failed to record schema version {step}: {e}"))?;
            tx.commit()
                .await
                .map_err(|e| format!("failed to commit migration {step} ({name}): {e}"))?;
        }
        Ok(())
    }

    /// The `PRAGMA user_version` this database is stamped with: 0 for a
    /// pre-contract database, [`BASELINE_VERSION`] and up for adopted and
    /// migrated ones.
    async fn user_version(&self) -> Result<i64, String> {
        let (version,): (i64,) = sqlx::query_as("PRAGMA user_version")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| format!("failed to read user_version: {e}"))?;
        Ok(version)
    }

    /// Whether the database file carries any user tables at all - the
    /// difference between "fresh file, needs the baseline" and "pre-contract
    /// database, gets adopted".
    async fn has_user_tables(&self) -> Result<bool, String> {
        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|e| format!("failed to inspect sqlite_master: {e}"))?;
        Ok(count > 0)
    }

    /// Copy the database file next to itself before a migration run that
    /// applies actual steps: `<db>.pre-migration-<unix-ts>.bak`, keeping at
    /// most [`MAX_PRE_MIGRATION_BACKUPS`].
    async fn backup_database(&self, path: &Path) -> Result<PathBuf, String> {
        self.backup_database_at(path, now_unix_millis()).await
    }

    /// [`Store::backup_database`] with an explicit timestamp, so tests can
    /// take several distinguishable snapshots within one millisecond.
    async fn backup_database_at(&self, path: &Path, ts: u128) -> Result<PathBuf, String> {
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .ok_or_else(|| format!("{} has no file name", path.display()))?;
        let backup = path.with_file_name(format!("{name}.pre-migration-{ts}.bak"));
        // SQLite takes a coherent snapshot including committed WAL frames.
        // A busy checkpoint must never silently produce an older main-file copy.
        sqlx::query("VACUUM main INTO ?")
            .bind(backup.to_string_lossy().as_ref())
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to snapshot {}: {e}", path.display()))?;
        let verification = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&backup)
                    .read_only(true),
            )
            .await
            .map_err(|e| format!("failed to open backup for verification: {e}"))?;
        let integrity: Result<(String,), _> = sqlx::query_as("PRAGMA quick_check")
            .fetch_one(&verification)
            .await;
        verification.close().await;
        let (integrity,) = integrity.map_err(|e| format!("failed to verify backup: {e}"))?;
        if integrity != "ok" {
            return Err(format!("backup integrity check failed: {integrity}"));
        }
        std::fs::OpenOptions::new()
            .write(true)
            .open(&backup)
            .and_then(|file| file.sync_all())
            .map_err(|e| format!("failed to flush verified backup: {e}"))?;
        Self::prune_pre_migration_backups(path, &name)?;
        Ok(backup)
    }

    /// Keep the [`MAX_PRE_MIGRATION_BACKUPS`] newest
    /// `<db>.pre-migration-*.bak` files next to `path`, deleting the rest.
    /// The timestamp sorts lexicographically (same width until the year
    /// 2286), so sorting by name is sorting by age.
    fn prune_pre_migration_backups(path: &Path, name: &str) -> Result<(), String> {
        let prefix = format!("{name}.pre-migration-");
        let Some(dir) = path.parent() else {
            return Ok(());
        };
        let mut backups: Vec<PathBuf> = std::fs::read_dir(dir)
            .map_err(|e| format!("failed to list {}: {e}", dir.display()))?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|p| {
                p.file_name().is_some_and(|n| {
                    let n = n.to_string_lossy();
                    n.starts_with(&prefix) && n.ends_with(".bak")
                })
            })
            .collect();
        backups.sort();
        let excess = backups.len().saturating_sub(MAX_PRE_MIGRATION_BACKUPS);
        for old in backups.into_iter().take(excess) {
            std::fs::remove_file(&old)
                .map_err(|e| format!("failed to remove old backup {}: {e}", old.display()))?;
        }
        Ok(())
    }

    /// Newest last. Never opens SQLite; see [`crate::db_restore`].
    #[allow(dead_code)] // production restore is `pa db restore`; tests use this wrapper
    pub fn list_pre_migration_backups(db_path: &Path) -> Result<Vec<PathBuf>, String> {
        crate::db_restore::list_pre_migration_backups(db_path)
    }

    /// Replace `dest` with a copy of a `<db>.pre-migration-*.bak`. The bak
    /// file is not migrated and its bytes stay put.
    #[allow(dead_code)] // production restore is `pa db restore`; tests use this wrapper
    pub fn restore_from_pre_migration_backup(
        backup: &Path,
        dest: &Path,
    ) -> Result<PathBuf, String> {
        crate::db_restore::restore_from_pre_migration_backup(backup, dest)
    }

    /// The body of one numbered migration step, running inside that step's
    /// transaction; the caller bumps `user_version` in the same transaction.
    /// A new step is one [`MIGRATIONS`] entry plus one arm here.
    async fn apply_migration_step(
        tx: &mut Transaction<'_, Sqlite>,
        version: i64,
    ) -> Result<(), String> {
        match version {
            // The merge state machine's persisted step; NULL reads as "not
            // merging". See [`crate::workers::merge_worker`].
            2 => sqlx::query("ALTER TABLE workers ADD COLUMN merge_state TEXT")
                .execute(&mut **tx)
                .await
                .map_err(|e| format!("failed to add workers.merge_state: {e}"))
                .map(|_| ()),
            3 => Self::apply_review_evidence_migration(tx).await,
            4 => continuous::apply_migration(tx).await,
            5 => continuous::apply_policy_migration(tx).await,
            6 => development_runs::apply_migration(tx).await,
            7 => development_launches::apply_migration(tx).await,
            8 => development_launches::apply_route_migration(tx).await,
            9 => development_runs::apply_checkpoint_migration(tx).await,
            10 => development_budget::apply_migration(tx).await,
            11 => development_runs::apply_page_migration(tx).await,
            12 => development_events::apply_migration(tx).await,
            13 => supervisor::apply_migration(tx).await,
            14 => team_assignments::apply_migration(tx).await,
            15 => discovery::apply_migration(tx).await,
            16 => development_launches::apply_baseline_migration(tx).await,
            17 => development_delivery::apply_migration(tx).await,
            18 => development_capture::apply_migration(tx).await,
            19 => development_capture::completion::apply_migration(tx).await,
            20 => development_plan::apply_migration(tx).await,
            21 => development_identity::apply_migration(tx).await,
            22 => development_launches::apply_undelivered_exit_migration(tx).await,
            // A MIGRATIONS entry without its arm - a build error, not data.
            _ => Err(format!("no migration defined for version {version}")),
        }
    }

    /// F4 evidence tables and comment disposition. Additive: a `test_status`
    /// of `pass` is not copied here, so it cannot become ready by migrating.
    async fn apply_review_evidence_migration(
        tx: &mut Transaction<'_, Sqlite>,
    ) -> Result<(), String> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS review_evidence (
                worker_id TEXT PRIMARY KEY,
                worker_head_sha TEXT NOT NULL,
                base_tip_sha TEXT NOT NULL,
                merge_tree_oid TEXT NOT NULL,
                verification_policy_hash TEXT,
                test_passed INTEGER,
                tested_at INTEGER,
                acceptance_hash TEXT,
                reviewed_by TEXT,
                approval_source TEXT,
                approval_decision TEXT,
                approved_at INTEGER,
                worktree_prune_offered INTEGER NOT NULL DEFAULT 0
            )",
        )
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("failed to create review_evidence: {e}"))?;
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS setup_trust (
                project_id TEXT PRIMARY KEY,
                repo_identity TEXT NOT NULL,
                command_normalized TEXT NOT NULL,
                base_sha TEXT NOT NULL,
                inputs_hash TEXT NOT NULL,
                granted_at INTEGER NOT NULL
            )",
        )
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("failed to create setup_trust: {e}"))?;
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS setup_policy (
                project_id TEXT PRIMARY KEY,
                command TEXT NOT NULL
            )",
        )
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("failed to create setup_policy: {e}"))?;
        sqlx::query(
            "ALTER TABLE diff_comments ADD COLUMN disposition TEXT NOT NULL DEFAULT 'open'",
        )
        .execute(&mut **tx)
        .await
        .map(|_| ())
        .or_else(|e| {
            let msg = e.to_string();
            // Pre-contract stubs never ran the baseline, so they have no
            // `diff_comments`. Duplicate column means the step already landed.
            if msg.contains("no such table") || msg.contains("duplicate column name") {
                Ok(())
            } else {
                Err(format!("failed to add diff_comments.disposition: {e}"))
            }
        })?;
        Ok(())
    }

    /// The version-1 baseline: the schema exactly as it shipped before the
    /// migration contract. It runs only for a freshly created database, in a
    /// single transaction; databases that already carry it are adopted as
    /// version 1 without a re-run (see [`Store::migrate`]). The baseline is
    /// frozen from here on - every later schema change is a numbered step in
    /// [`MIGRATIONS`], never an edit of this list.
    async fn apply_baseline(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
        const STATEMENTS: [&str; 26] = [
            "CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                repo_path TEXT NOT NULL,
                skill_packs TEXT,
                landing_page_markdown TEXT,
                max_workers INTEGER,
                test_command TEXT,
                created_at INTEGER NOT NULL
            )",
            "CREATE TABLE IF NOT EXISTS workers (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id),
                task TEXT NOT NULL,
                profile_id TEXT NOT NULL,
                branch TEXT NOT NULL,
                worktree_path TEXT NOT NULL,
                status TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'worker',
                pr_url TEXT,
                spawned_by TEXT,
                test_status TEXT,
                tested_at INTEGER,
                role_variant_id TEXT,
                paused_reason TEXT,
                created_at INTEGER NOT NULL
            )",
            "CREATE INDEX IF NOT EXISTS workers_project_id ON workers (project_id)",
            "CREATE TABLE IF NOT EXISTS agent_quota (
                profile_id TEXT PRIMARY KEY,
                state TEXT NOT NULL DEFAULT 'unknown',
                blocked_until INTEGER,
                reason TEXT,
                updated_at INTEGER NOT NULL
            )",
            "CREATE TABLE IF NOT EXISTS diff_comments (
                id TEXT PRIMARY KEY,
                worker_id TEXT NOT NULL,
                file TEXT NOT NULL,
                line INTEGER NOT NULL,
                body TEXT NOT NULL,
                sent_to_agent INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            )",
            "CREATE INDEX IF NOT EXISTS diff_comments_worker_id ON diff_comments (worker_id)",
            "CREATE TABLE IF NOT EXISTS status_events (
                id TEXT PRIMARY KEY,
                worker_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                detail TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'app',
                created_at INTEGER NOT NULL
            )",
            "CREATE INDEX IF NOT EXISTS status_events_worker_id ON status_events (worker_id, created_at)",
            "CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                worker_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )",
            "CREATE INDEX IF NOT EXISTS messages_worker_created ON messages (worker_id, created_at, id)",
            "CREATE TABLE IF NOT EXISTS task_queue (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                raw_text TEXT NOT NULL,
                sharpened_text TEXT,
                profile_id TEXT NOT NULL DEFAULT 'claude',
                status TEXT NOT NULL DEFAULT 'queued',
                priority INTEGER NOT NULL DEFAULT 0,
                worker_id TEXT,
                error TEXT,
                spawned_by TEXT,
                created_at INTEGER NOT NULL
            )",
            "CREATE INDEX IF NOT EXISTS task_queue_ready ON task_queue (project_id, status, priority DESC, created_at, id)",
            "CREATE TABLE IF NOT EXISTS recommendations (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                title TEXT NOT NULL,
                url TEXT,
                rationale TEXT NOT NULL,
                effort TEXT,
                status TEXT NOT NULL DEFAULT 'new',
                created_at INTEGER NOT NULL
            )",
            "CREATE INDEX IF NOT EXISTS recommendations_project_id ON recommendations (project_id, created_at, id)",
            "CREATE TABLE IF NOT EXISTS learnings (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                worker_id TEXT NOT NULL,
                profile_id TEXT NOT NULL,
                pattern_label TEXT,
                content TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at INTEGER NOT NULL
            )",
            "CREATE INDEX IF NOT EXISTS learnings_project_id ON learnings (project_id, created_at, id)",
            "CREATE TABLE IF NOT EXISTS role_variants (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                base_profile_id TEXT NOT NULL,
                pattern_label TEXT NOT NULL,
                system_prompt_addition TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at INTEGER NOT NULL
            )",
            "CREATE INDEX IF NOT EXISTS role_variants_project_id
                 ON role_variants (project_id, created_at, id)",
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            // The OmniRoute usage ledger (Phase 19 T3). `id` is a hash of the
            // source line, and it is the PRIMARY KEY - which in SQLite *is*
            // the dedup index. The poller re-reads a ring buffer that hands
            // out the same lines every five minutes, so every insert is an
            // `INSERT OR IGNORE` against this key.
            "CREATE TABLE IF NOT EXISTS usage_events (
                id TEXT PRIMARY KEY,
                ts INTEGER NOT NULL,
                profile_id TEXT,
                model TEXT NOT NULL,
                provider TEXT NOT NULL,
                tokens_in INTEGER NOT NULL DEFAULT 0,
                tokens_out INTEGER NOT NULL DEFAULT 0,
                cost_usd REAL,
                raw_json TEXT NOT NULL
            )",
            "CREATE INDEX IF NOT EXISTS usage_events_ts ON usage_events (ts DESC, id)",
            // Sessions, so the statistics tab can count them (Phase 20). The
            // worker <-> session map itself stays in memory - it is only ever
            // about the process that is running right now - but the *fact*
            // that a session happened, how long it lasted and how it ended
            // outlives the process, and until this table there was nowhere for
            // it to be written down.
            "CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                worker_id TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                exit_code INTEGER
            )",
            "CREATE INDEX IF NOT EXISTS sessions_worker_id ON sessions (worker_id, started_at)",
            // Blocking decisions an agent handed back to the human (Phase
            // 21). `worker_id` is nullable because a preflight question is
            // asked before there is a worker to ask it - see
            // [`crate::questions`] for the two scopes and the guardrails.
            "CREATE TABLE IF NOT EXISTS questions (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                worker_id TEXT,
                scope TEXT NOT NULL DEFAULT 'worker',
                question TEXT NOT NULL,
                options_json TEXT,
                status TEXT NOT NULL DEFAULT 'open',
                answer TEXT,
                created_at INTEGER NOT NULL,
                answered_at INTEGER,
                answered_by TEXT,
                expires_at INTEGER
            )",
            "CREATE INDEX IF NOT EXISTS questions_project_id ON questions (project_id, created_at, id)",
            // The budget rule counts one worker's open questions on every ask,
            // so that count gets its own index rather than a table scan.
            "CREATE INDEX IF NOT EXISTS questions_worker_open ON questions (worker_id, status)",
        ];
        for statement in STATEMENTS {
            sqlx::query(statement)
                .execute(&mut **tx)
                .await
                .map_err(|e| format!("failed to apply schema: {e}"))?;
        }
        // Columns added after a table shipped. Each is nullable or carries a
        // default, which is what SQLite's `ADD COLUMN` will accept.
        Self::add_missing_column(&mut *tx, "projects", "skill_packs", "TEXT").await?;
        Self::add_missing_column(&mut *tx, "projects", "landing_page_markdown", "TEXT").await?;
        Self::add_missing_column(&mut *tx, "projects", "max_workers", "INTEGER").await?;
        Self::add_missing_column(&mut *tx, "projects", "test_command", "TEXT").await?;
        Self::add_missing_column(&mut *tx, "questions", "answered_by", "TEXT").await?;
        Self::add_missing_column(&mut *tx, "workers", "pr_url", "TEXT").await?;
        Self::add_missing_column(
            &mut *tx,
            "workers",
            "kind",
            "TEXT NOT NULL DEFAULT 'worker'",
        )
        .await?;
        Self::add_missing_column(&mut *tx, "workers", "spawned_by", "TEXT").await?;
        Self::add_missing_column(&mut *tx, "workers", "test_status", "TEXT").await?;
        Self::add_missing_column(&mut *tx, "workers", "tested_at", "INTEGER").await?;
        Self::add_missing_column(&mut *tx, "workers", "role_variant_id", "TEXT").await?;
        Self::add_missing_column(&mut *tx, "workers", "paused_reason", "TEXT").await?;
        Self::add_missing_column(
            &mut *tx,
            "agent_quota",
            "state",
            "TEXT NOT NULL DEFAULT 'unknown'",
        )
        .await?;
        Self::add_missing_column(&mut *tx, "agent_quota", "blocked_until", "INTEGER").await?;
        Self::add_missing_column(&mut *tx, "agent_quota", "reason", "TEXT").await?;
        Self::add_missing_column(
            &mut *tx,
            "diff_comments",
            "sent_to_agent",
            "INTEGER NOT NULL DEFAULT 0",
        )
        .await?;
        Self::add_missing_column(
            &mut *tx,
            "status_events",
            "source",
            "TEXT NOT NULL DEFAULT 'app'",
        )
        .await?;
        // `messages.content` deliberately has no entry here. It has been in the
        // `CREATE TABLE` since the table was introduced, so this could only
        // ever be a no-op - and `ADD COLUMN ... NOT NULL` without a default is
        // rejected by SQLite on a non-empty table, so the one case where it
        // did something would be a failure to open the database at all.
        Self::add_missing_column(&mut *tx, "task_queue", "error", "TEXT").await?;
        Self::add_missing_column(&mut *tx, "task_queue", "spawned_by", "TEXT").await?;
        // A `recommendations` table left behind by an earlier build is kept and
        // repaired rather than replaced; the nullable columns and the defaulted
        // `status` are exactly what SQLite's `ADD COLUMN` accepts.
        Self::add_missing_column(&mut *tx, "recommendations", "url", "TEXT").await?;
        Self::add_missing_column(&mut *tx, "recommendations", "effort", "TEXT").await?;
        Self::add_missing_column(
            &mut *tx,
            "recommendations",
            "status",
            "TEXT NOT NULL DEFAULT 'new'",
        )
        .await?;
        // `questions` deliberately has no entry here: the table shipped whole
        // in Phase 21, so `CREATE TABLE IF NOT EXISTS` above is the only step
        // it has ever needed. A column added to it *later* is a numbered
        // migration step, not an entry in this frozen list.
        Ok(())
    }

    /// `CREATE TABLE IF NOT EXISTS` does nothing for a table that already
    /// exists, so a column added after the fact needs its own step. SQLite has
    /// no `ADD COLUMN IF NOT EXISTS`, hence the `table_info` lookup.
    async fn add_missing_column(
        tx: &mut Transaction<'_, Sqlite>,
        table: &str,
        column: &str,
        declaration: &str,
    ) -> Result<(), String> {
        let existing: Vec<(i64, String)> = sqlx::query_as(&format!("PRAGMA table_info({table})"))
            .fetch_all(&mut **tx)
            .await
            .map_err(|e| format!("failed to inspect {table}: {e}"))?;
        if existing.iter().any(|(_, name)| name == column) {
            return Ok(());
        }
        sqlx::query(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {declaration}"
        ))
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("failed to add {table}.{column}: {e}"))?;
        Ok(())
    }

    /// Persist a worker lifecycle observation for later diagnosis.
    pub async fn record_status_event(
        &self,
        worker_id: &str,
        kind: &str,
        detail: &str,
        source: &str,
    ) -> Result<StatusEvent, String> {
        let event = StatusEvent {
            id: new_id("ev"),
            worker_id: worker_id.to_string(),
            kind: kind.to_string(),
            detail: detail.to_string(),
            source: source.to_string(),
            created_at: now_unix_secs(),
        };
        sqlx::query(
            "INSERT INTO status_events (id, worker_id, kind, detail, source, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(&event.id)
        .bind(&event.worker_id)
        .bind(&event.kind)
        .bind(&event.detail)
        .bind(&event.source)
        .bind(event.created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to record status event: {e}"))?;
        Ok(event)
    }

    /// Append one message to the durable interaction log of a worker.
    ///
    /// A failed write is logged and ignored: losing the log is never a reason
    /// to fail the action the user (or the agent) was actually performing.
    pub async fn insert_message(
        &self,
        worker_id: &str,
        role: &str,
        content: &str,
    ) -> Result<Message, String> {
        let message = Message {
            id: new_id("msg"),
            worker_id: worker_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            created_at: now_unix_secs(),
        };
        sqlx::query(
            "INSERT INTO messages (id, worker_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&message.id)
        .bind(&message.worker_id)
        .bind(&message.role)
        .bind(&message.content)
        .bind(message.created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to insert message: {e}"))?;
        Ok(message)
    }

    /// A worker's interaction log, oldest first.
    ///
    /// Returns the *most recent* `limit` entries (default 200) in ascending
    /// chronological order, so the frontend can append and a chat view can read
    /// from top to bottom.
    pub async fn list_messages(
        &self,
        worker_id: &str,
        limit: Option<usize>,
    ) -> Result<Vec<Message>, String> {
        // Bound, not interpolated. The type alone made this safe - a `usize`
        // can only render as digits - but this was the one request-derived
        // value in the module that reached SQL as text, and the caller can ask
        // for a number SQLite cannot represent. Only the ceiling is capped:
        // an explicit zero still means zero, which callers rely on.
        let limit = limit.unwrap_or(200).min(1000) as i64;
        sqlx::query_as::<_, Message>(&format!(
            "SELECT {MESSAGE_COLUMNS} FROM (
                SELECT * FROM messages WHERE worker_id = ?1
                ORDER BY created_at DESC, id DESC LIMIT ?2
            ) ORDER BY created_at ASC, id ASC"
        ))
        .bind(worker_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("failed to list messages: {e}"))
    }

    // -- retention (Phase 1.5) ---------------------------------------------
    //
    // The queries behind [`crate::retention`]. All deletions are chunked so a
    // sweep never holds the write lock for longer than one small batch - the
    // board, the hooks and the dispatcher keep writing while it runs. Note
    // that deleting rows does not shrink the database file on its own: SQLite
    // only hands freed pages back to the filesystem on `VACUUM`, which is
    // deliberately *not* run here (it would rewrite the whole file under a
    // full lock). Until somebody schedules one, the file reuses the space
    // internally.

    /// Delete up to `chunk` status events strictly older than `cutoff`;
    /// returns how many rows went away, so the caller can loop until 0.
    ///
    /// `DELETE ... WHERE id IN (SELECT ... LIMIT)` instead of `DELETE LIMIT`:
    /// the latter needs a SQLite compile option this build does not set.
    pub async fn delete_status_events_before(
        &self,
        cutoff: i64,
        chunk: i64,
    ) -> Result<u64, String> {
        let result = sqlx::query(
            "DELETE FROM status_events WHERE id IN (
                 SELECT id FROM status_events WHERE created_at < ?1
                 ORDER BY created_at, id LIMIT ?2
             )",
        )
        .bind(cutoff)
        .bind(chunk)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to delete old status events: {e}"))?;
        Ok(result.rows_affected())
    }

    /// [`delete_status_events_before`](Self::delete_status_events_before) for
    /// the OmniRoute usage ledger, whose timestamp column is called `ts`.
    pub async fn delete_usage_events_before(&self, cutoff: i64, chunk: i64) -> Result<u64, String> {
        let result = sqlx::query(
            "DELETE FROM usage_events WHERE id IN (
                 SELECT id FROM usage_events WHERE ts < ?1
                 ORDER BY ts, id LIMIT ?2
             )",
        )
        .bind(cutoff)
        .bind(chunk)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to delete old usage events: {e}"))?;
        Ok(result.rows_affected())
    }

    /// Every worker that still carries messages strictly older than `cutoff`,
    /// paired with its project when the worker row is still around.
    ///
    /// Messages are keyed by worker and the project is a fact about the
    /// worker, so the archive path is resolved through a join. `LEFT` on
    /// purpose: a message whose worker row is gone still deserves its export,
    /// under a fallback project directory rather than silently kept forever.
    pub async fn workers_with_messages_before(
        &self,
        cutoff: i64,
    ) -> Result<Vec<(String, Option<String>)>, String> {
        sqlx::query_as(
            "SELECT DISTINCT m.worker_id, w.project_id
             FROM messages m LEFT JOIN workers w ON w.id = m.worker_id
             WHERE m.created_at < ?1
             ORDER BY m.worker_id",
        )
        .bind(cutoff)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("failed to find workers with old messages: {e}"))
    }

    /// Every message of one worker strictly older than `cutoff`, oldest
    /// first.
    ///
    /// Unbounded on purpose: this is the export set, and a half-exported
    /// archive would be worse than a large one. Interaction logs are text the
    /// user actually typed plus lifecycle notes (see [`Message`]), so even a
    /// busy worker stays in the low thousands of rows per retention window.
    pub async fn list_messages_before(
        &self,
        worker_id: &str,
        cutoff: i64,
    ) -> Result<Vec<Message>, String> {
        sqlx::query_as::<_, Message>(&format!(
            "SELECT {MESSAGE_COLUMNS} FROM messages
             WHERE worker_id = ?1 AND created_at < ?2
             ORDER BY created_at, id"
        ))
        .bind(worker_id)
        .bind(cutoff)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("failed to list old messages: {e}"))
    }

    /// Delete up to `chunk` of one worker's messages strictly older than
    /// `cutoff`. Only ever called *after* the export for exactly this set was
    /// written and verified - see [`crate::retention`].
    pub async fn delete_messages_before(
        &self,
        worker_id: &str,
        cutoff: i64,
        chunk: i64,
    ) -> Result<u64, String> {
        let result = sqlx::query(
            "DELETE FROM messages WHERE id IN (
                 SELECT id FROM messages WHERE worker_id = ?1 AND created_at < ?2
                 ORDER BY created_at, id LIMIT ?3
             )",
        )
        .bind(worker_id)
        .bind(cutoff)
        .bind(chunk)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to delete exported messages: {e}"))?;
        Ok(result.rows_affected())
    }

    /// A worker's interaction log inside one time window, oldest first.
    ///
    /// Unlike [`list_messages`] this is not answered newest-first-capped: the
    /// digest needs *the day's* rows, and a cap counted from the wrong end
    /// drops exactly them once later activity outnumbers it. The window is
    /// half-open: `from` inclusive, `until` exclusive.
    pub async fn list_messages_between(
        &self,
        worker_id: &str,
        from: i64,
        until: i64,
    ) -> Result<Vec<Message>, String> {
        sqlx::query_as::<_, Message>(&format!(
            "SELECT {MESSAGE_COLUMNS} FROM messages
             WHERE worker_id = ?1 AND created_at >= ?2 AND created_at < ?3
             ORDER BY created_at ASC, id ASC"
        ))
        .bind(worker_id)
        .bind(from)
        .bind(until)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("failed to list messages: {e}"))
    }

    // -- projects ----------------------------------------------------------

    pub async fn create_project(&self, name: &str, repo_path: &str) -> Result<Project, String> {
        let project = Project {
            id: new_id("pj"),
            name: name.to_string(),
            repo_path: repo_path.to_string(),
            landing_page_markdown: None,
            max_workers: None,
            // Detected once, when the project is registered: the gate is a
            // setting the user can correct, not something re-guessed behind
            // their back every time a worker reaches review.
            test_command: detect_test_command(Path::new(repo_path)),
            created_at: now_unix_secs(),
        };
        sqlx::query(
            "INSERT INTO projects (id, name, repo_path, test_command, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
            .bind(&project.id)
            .bind(&project.name)
            .bind(&project.repo_path)
            .bind(&project.test_command)
            .bind(project.created_at)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to create project: {e}"))?;
        Ok(project)
    }

    pub async fn list_projects(&self) -> Result<Vec<Project>, String> {
        sqlx::query_as::<_, Project>(
            "SELECT id, name, repo_path, landing_page_markdown, max_workers, test_command, \
             created_at FROM projects ORDER BY created_at, id",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("failed to list projects: {e}"))
    }

    pub async fn get_project(&self, id: &str) -> Result<Option<Project>, String> {
        sqlx::query_as::<_, Project>(
            "SELECT id, name, repo_path, landing_page_markdown, max_workers, test_command, \
             created_at FROM projects WHERE id = ?1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("failed to read project: {e}"))
    }

    /// Drop the project row and archive its workers. Worktrees stay on disk.
    pub async fn remove_project(&self, id: &str) -> Result<(), String> {
        sqlx::query("UPDATE workers SET status = ?1 WHERE project_id = ?2")
            .bind(STATUS_ARCHIVED)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to archive workers: {e}"))?;
        sqlx::query("DELETE FROM projects WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to remove project: {e}"))?;
        Ok(())
    }

    /// The skill packs this project has enabled, as stored.
    ///
    /// `None` means the project has never been configured and takes whatever
    /// ProjectA bundles; see [`crate::skills::resolve_enabled`], which is the
    /// only place that decision is made. Stored content that is not a JSON
    /// array of strings is treated the same way - a hand-edited database
    /// should cost the project its selection, not its workers.
    pub async fn get_project_skill_packs(
        &self,
        project_id: &str,
    ) -> Result<Option<Vec<String>>, String> {
        let row: Option<(Option<String>,)> =
            sqlx::query_as("SELECT skill_packs FROM projects WHERE id = ?1")
                .bind(project_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| format!("failed to read skill packs: {e}"))?;
        let Some((stored,)) = row else {
            return Err(format!("unknown project: {project_id}"));
        };
        Ok(stored.and_then(|json| serde_json::from_str::<Vec<String>>(&json).ok()))
    }

    /// Record which packs a project wants. An empty list is stored as `NULL`,
    /// which reads back as "everything" - the two are the same thing.
    pub async fn set_project_skill_packs(
        &self,
        project_id: &str,
        packs: &[String],
    ) -> Result<(), String> {
        let stored = if packs.is_empty() {
            None
        } else {
            Some(
                serde_json::to_string(packs)
                    .map_err(|e| format!("failed to encode skill packs: {e}"))?,
            )
        };
        let done = sqlx::query("UPDATE projects SET skill_packs = ?1 WHERE id = ?2")
            .bind(&stored)
            .bind(project_id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to store skill packs: {e}"))?;
        if done.rows_affected() == 0 {
            return Err(format!("unknown project: {project_id}"));
        }
        Ok(())
    }

    /// The Markdown content of the project's landing page, as stored.
    ///
    /// `None` means nobody has written one yet. An unknown project is an
    /// error: the caller asked about something that is not there.
    pub async fn get_landing_page(&self, project_id: &str) -> Result<Option<String>, String> {
        let row: Option<(Option<String>,)> =
            sqlx::query_as("SELECT landing_page_markdown FROM projects WHERE id = ?1")
                .bind(project_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| format!("failed to read landing page: {e}"))?;
        match row {
            Some((markdown,)) => Ok(markdown),
            None => Err(format!("unknown project: {project_id}")),
        }
    }

    /// Store (or with `None`, clear) the project's landing page content.
    pub async fn set_landing_page(
        &self,
        project_id: &str,
        markdown: Option<&str>,
    ) -> Result<(), String> {
        let done = sqlx::query("UPDATE projects SET landing_page_markdown = ?1 WHERE id = ?2")
            .bind(markdown)
            .bind(project_id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to store landing page: {e}"))?;
        if done.rows_affected() == 0 {
            return Err(format!("unknown project: {project_id}"));
        }
        Ok(())
    }

    /// Store (or with `None`, clear) the project's cap on concurrently running
    /// employees. The dispatcher reads it on every sweep, so a change takes
    /// effect without a restart. An unknown project is an error.
    ///
    /// `None` and `Some(0)` are different answers: `None` means "no cap of its
    /// own, use the default", while `Some(0)` means "start nothing at all".
    pub async fn set_project_max_workers(
        &self,
        project_id: &str,
        max_workers: Option<i64>,
    ) -> Result<(), String> {
        let done = sqlx::query("UPDATE projects SET max_workers = ?1 WHERE id = ?2")
            .bind(max_workers)
            .bind(project_id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to store max workers: {e}"))?;
        if done.rows_affected() == 0 {
            return Err(format!("unknown project: {project_id}"));
        }
        Ok(())
    }

    /// Store (or with `None`, clear) the command the test gate runs for this
    /// project. Clearing it turns the gate off; see [`crate::testgate`].
    pub async fn set_project_test_command(
        &self,
        project_id: &str,
        command: Option<&str>,
    ) -> Result<(), String> {
        let done = sqlx::query("UPDATE projects SET test_command = ?1 WHERE id = ?2")
            .bind(command)
            .bind(project_id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to store test command: {e}"))?;
        if done.rows_affected() == 0 {
            return Err(format!("unknown project: {project_id}"));
        }
        Ok(())
    }

    // -- workers -----------------------------------------------------------

    pub async fn insert_worker(&self, row: &WorkerRow) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO workers
                 (id, project_id, task, profile_id, branch, worktree_path, status, kind, pr_url,
                  spawned_by, test_status, tested_at, role_variant_id, paused_reason, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        )
        .bind(&row.id)
        .bind(&row.project_id)
        .bind(&row.task)
        .bind(&row.profile_id)
        .bind(&row.branch)
        .bind(&row.worktree_path)
        .bind(&row.status)
        .bind(&row.kind)
        .bind(&row.pr_url)
        .bind(&row.spawned_by)
        .bind(&row.test_status)
        .bind(row.tested_at)
        .bind(&row.role_variant_id)
        .bind(&row.paused_reason)
        .bind(row.created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to create worker: {e}"))?;
        Ok(())
    }

    pub async fn list_workers(&self, project_id: Option<&str>) -> Result<Vec<Worker>, String> {
        let rows = match project_id {
            Some(project_id) => {
                sqlx::query_as::<_, WorkerRow>(&format!(
                    "SELECT {WORKER_COLUMNS} FROM workers WHERE project_id = ?1 \
                     ORDER BY created_at, id"
                ))
                .bind(project_id)
                .fetch_all(&self.pool)
                .await
            }
            None => {
                sqlx::query_as::<_, WorkerRow>(&format!(
                    "SELECT {WORKER_COLUMNS} FROM workers ORDER BY created_at, id"
                ))
                .fetch_all(&self.pool)
                .await
            }
        }
        .map_err(|e| format!("failed to list workers: {e}"))?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let session_id = self.session_for_worker(&row.id);
                row.into_worker(session_id)
            })
            .collect())
    }

    pub async fn get_worker(&self, id: &str) -> Result<Option<Worker>, String> {
        let row = sqlx::query_as::<_, WorkerRow>(&format!(
            "SELECT {WORKER_COLUMNS} FROM workers WHERE id = ?1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("failed to read worker: {e}"))?;
        Ok(row.map(|row| {
            let session_id = self.session_for_worker(&row.id);
            row.into_worker(session_id)
        }))
    }

    /// The persisted row behind a worker, columns only.
    ///
    /// [`Worker`] deliberately does not carry every column - the board and the
    /// frontend have no use for `role_variant_id` - so the one caller that
    /// needs the stored spawn parameters (`respawn_worker`) reads the row.
    pub async fn get_worker_row(&self, id: &str) -> Result<Option<WorkerRow>, String> {
        sqlx::query_as::<_, WorkerRow>(&format!(
            "SELECT {WORKER_COLUMNS} FROM workers WHERE id = ?1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("failed to read worker: {e}"))
    }

    pub async fn set_worker_status(&self, id: &str, status: &str) -> Result<(), String> {
        sqlx::query("UPDATE workers SET status = ?1 WHERE id = ?2")
            .bind(status)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to update worker status: {e}"))?;
        Ok(())
    }

    /// Note (or with `None`, clear) why this worker's agent was stopped
    /// without archiving it.
    ///
    /// The status column is deliberately left alone: a paused worker is still
    /// the `running` worker it was, only without a session, and rewriting its
    /// status would throw away the fact that somebody meant to bring it back.
    /// [`crate::workers::respawn_worker`] is that way back, and it clears this.
    pub async fn set_worker_paused_reason(
        &self,
        id: &str,
        reason: Option<&str>,
    ) -> Result<(), String> {
        sqlx::query("UPDATE workers SET paused_reason = ?1 WHERE id = ?2")
            .bind(reason)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to update worker pause note: {e}"))?;
        Ok(())
    }

    /// Record the pull request the GitHub poller found for this worker's
    /// branch, or `None` when there is no longer one.
    pub async fn set_worker_pr_url(&self, id: &str, pr_url: Option<&str>) -> Result<(), String> {
        sqlx::query("UPDATE workers SET pr_url = ?1 WHERE id = ?2")
            .bind(pr_url)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to update worker pull request: {e}"))?;
        Ok(())
    }

    /// The persisted merge step, `None` while no merge ever got that far.
    /// See [`MERGE_MERGED`].
    pub async fn merge_state_for_worker(&self, id: &str) -> Result<Option<String>, String> {
        sqlx::query_as::<_, (Option<String>,)>("SELECT merge_state FROM workers WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| format!("failed to read merge state: {e}"))?
            .map(|(state,)| state)
            .ok_or_else(|| format!("unknown worker: {id}"))
    }

    /// Record the merge step [`merge_worker`](crate::workers::merge_worker)
    /// just finished. Written step by step, never in a transaction with the
    /// merge itself: git and GitHub are outside SQLite's reach, so the
    /// record follows the effect instead of pretending to roll it back.
    pub async fn set_worker_merge_state(
        &self,
        id: &str,
        state: Option<&str>,
    ) -> Result<(), String> {
        sqlx::query("UPDATE workers SET merge_state = ?1 WHERE id = ?2")
            .bind(state)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to record merge state: {e}"))?;
        Ok(())
    }

    const REVIEW_EVIDENCE_COLUMNS: &'static str =
        "worker_id, worker_head_sha, base_tip_sha, merge_tree_oid, \
         verification_policy_hash, test_passed, tested_at, acceptance_hash, \
         reviewed_by, approval_source, approval_decision, approved_at, \
         worktree_prune_offered";

    pub async fn get_review_evidence(
        &self,
        worker_id: &str,
    ) -> Result<Option<ReviewEvidence>, String> {
        sqlx::query_as::<_, ReviewEvidence>(&format!(
            "SELECT {} FROM review_evidence WHERE worker_id = ?1",
            Self::REVIEW_EVIDENCE_COLUMNS
        ))
        .bind(worker_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("failed to read review evidence: {e}"))
    }

    /// Read-modify-write the evidence row of one worker, atomically across
    /// the writers in this process: the closure sees the current row (or
    /// `None`) and returns the row to store — or `None` for "nothing to
    /// write" — and no other writer can slip between that read and the
    /// write. Without the lock the last writer would silently drop the
    /// other's test or approval fields.
    pub async fn update_review_evidence(
        &self,
        worker_id: &str,
        update: impl FnOnce(Option<ReviewEvidence>) -> Option<ReviewEvidence>,
    ) -> Result<(), String> {
        let _guard = self.review_evidence_lock.lock().await;
        let current = self.get_review_evidence(worker_id).await?;
        if let Some(row) = update(current) {
            self.put_review_evidence(&row).await?;
        }
        Ok(())
    }

    pub async fn put_review_evidence(&self, row: &ReviewEvidence) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO review_evidence (
                 worker_id, worker_head_sha, base_tip_sha, merge_tree_oid,
                 verification_policy_hash, test_passed, tested_at, acceptance_hash,
                 reviewed_by, approval_source, approval_decision, approved_at,
                 worktree_prune_offered
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(worker_id) DO UPDATE SET
                 worker_head_sha = excluded.worker_head_sha,
                 base_tip_sha = excluded.base_tip_sha,
                 merge_tree_oid = excluded.merge_tree_oid,
                 verification_policy_hash = excluded.verification_policy_hash,
                 test_passed = excluded.test_passed,
                 tested_at = excluded.tested_at,
                 acceptance_hash = excluded.acceptance_hash,
                 reviewed_by = excluded.reviewed_by,
                 approval_source = excluded.approval_source,
                 approval_decision = excluded.approval_decision,
                 approved_at = excluded.approved_at,
                 worktree_prune_offered = excluded.worktree_prune_offered",
        )
        .bind(&row.worker_id)
        .bind(&row.worker_head_sha)
        .bind(&row.base_tip_sha)
        .bind(&row.merge_tree_oid)
        .bind(&row.verification_policy_hash)
        .bind(row.test_passed)
        .bind(row.tested_at)
        .bind(&row.acceptance_hash)
        .bind(&row.reviewed_by)
        .bind(&row.approval_source)
        .bind(&row.approval_decision)
        .bind(row.approved_at)
        .bind(row.worktree_prune_offered)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to store review evidence: {e}"))?;
        Ok(())
    }

    #[allow(dead_code)] // offered after merge, never automatic
    pub async fn set_worktree_prune_offered(
        &self,
        worker_id: &str,
        offered: bool,
    ) -> Result<(), String> {
        let done = sqlx::query(
            "UPDATE review_evidence SET worktree_prune_offered = ?1 WHERE worker_id = ?2",
        )
        .bind(i64::from(offered))
        .bind(worker_id)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to record prune offer: {e}"))?;
        if done.rows_affected() == 0 {
            return Err(format!("no review evidence for {worker_id}"));
        }
        Ok(())
    }

    pub async fn get_setup_trust(&self, project_id: &str) -> Result<Option<SetupTrust>, String> {
        sqlx::query_as::<_, SetupTrust>(
            "SELECT project_id, repo_identity, command_normalized, base_sha, inputs_hash, granted_at
             FROM setup_trust WHERE project_id = ?1",
        )
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("failed to read setup trust: {e}"))
    }

    #[allow(dead_code)] // settings UI writes this
    pub async fn put_setup_trust(&self, row: &SetupTrust) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO setup_trust (
                 project_id, repo_identity, command_normalized, base_sha, inputs_hash, granted_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(project_id) DO UPDATE SET
                 repo_identity = excluded.repo_identity,
                 command_normalized = excluded.command_normalized,
                 base_sha = excluded.base_sha,
                 inputs_hash = excluded.inputs_hash,
                 granted_at = excluded.granted_at",
        )
        .bind(&row.project_id)
        .bind(&row.repo_identity)
        .bind(&row.command_normalized)
        .bind(&row.base_sha)
        .bind(&row.inputs_hash)
        .bind(row.granted_at)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to store setup trust: {e}"))?;
        Ok(())
    }

    pub async fn get_setup_command(&self, project_id: &str) -> Result<Option<String>, String> {
        sqlx::query_as::<_, (String,)>("SELECT command FROM setup_policy WHERE project_id = ?1")
            .bind(project_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| format!("failed to read setup command: {e}"))
            .map(|row| row.map(|(c,)| c))
    }

    #[allow(dead_code)] // settings UI writes this
    pub async fn set_setup_command(
        &self,
        project_id: &str,
        command: Option<&str>,
    ) -> Result<(), String> {
        // A whitespace-only command normalises to "" and would deadlock the
        // trust path (the ipc guard drops the view, the gate keeps refusing)
        // — treat it as clearing, at the choke point every caller shares
        // (review-F4-r15, k3 Fund 1).
        let command = command.map(str::trim).filter(|c| !c.is_empty());
        // An idempotent re-save (settings blur) must not void the grant…
        let current = self.get_setup_command(project_id).await?;
        if current.as_deref() == command {
            return Ok(());
        }
        // …but any real change does: the grant covers the normalised command,
        // so a deleted or edited command must not keep its approval
        // (review-F4-r16, Opus Fix-6-Nachweis).
        sqlx::query("DELETE FROM setup_trust WHERE project_id = ?1")
            .bind(project_id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to void setup trust: {e}"))?;
        match command {
            None => {
                sqlx::query("DELETE FROM setup_policy WHERE project_id = ?1")
                    .bind(project_id)
                    .execute(&self.pool)
                    .await
                    .map_err(|e| format!("failed to clear setup command: {e}"))?;
            }
            Some(command) => {
                sqlx::query(
                    "INSERT INTO setup_policy (project_id, command) VALUES (?1, ?2)
                     ON CONFLICT(project_id) DO UPDATE SET command = excluded.command",
                )
                .bind(project_id)
                .bind(command)
                .execute(&self.pool)
                .await
                .map_err(|e| format!("failed to store setup command: {e}"))?;
            }
        }
        Ok(())
    }

    pub async fn count_open_diff_comments(&self, worker_id: &str) -> Result<i64, String> {
        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM diff_comments
             WHERE worker_id = ?1 AND disposition = ?2",
        )
        .bind(worker_id)
        .bind(COMMENT_OPEN)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| format!("failed to count open review comments: {e}"))?;
        Ok(count)
    }

    pub async fn set_diff_comment_disposition(
        &self,
        id: &str,
        disposition: &str,
    ) -> Result<(), String> {
        if disposition != COMMENT_OPEN && disposition != COMMENT_DONE {
            return Err(format!("unknown comment disposition: {disposition}"));
        }
        let done = sqlx::query("UPDATE diff_comments SET disposition = ?1 WHERE id = ?2")
            .bind(disposition)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to update comment disposition: {e}"))?;
        if done.rows_affected() == 0 {
            return Err(format!("unknown review comment: {id}"));
        }
        Ok(())
    }

    /// Record the outcome of a test-gate run: [`TEST_RUNNING`] with no
    /// timestamp when one starts, [`TEST_PASS`] or [`TEST_FAIL`] with the
    /// timestamp when it ends, `None` to forget the whole thing.
    pub async fn set_worker_test_status(
        &self,
        worker_id: &str,
        test_status: Option<&str>,
        tested_at: Option<i64>,
    ) -> Result<(), String> {
        let done = sqlx::query("UPDATE workers SET test_status = ?1, tested_at = ?2 WHERE id = ?3")
            .bind(test_status)
            .bind(tested_at)
            .bind(worker_id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to update worker test status: {e}"))?;
        if done.rows_affected() == 0 {
            return Err(format!("unknown worker: {worker_id}"));
        }
        Ok(())
    }

    /// Claim the test gate of one worker: move it to [`TEST_RUNNING`] and
    /// report whether this caller is the one that moved it.
    ///
    /// The same shape as [`Store::claim_recommendation`], and it exists for
    /// the same reason. Reading a worker and then writing `running` is two
    /// statements, and two automatic triggers
    /// ([`crate::testgate::run_test_gate_if_due`]) can both finish the read
    /// before either starts the write - so both see a worker that is due and
    /// both run the project's suite in the same worktree. One conditional
    /// `UPDATE` closes that window: SQLite applies it as a single statement,
    /// and only the caller whose `rows_affected` is 1 owns the run.
    ///
    /// The condition names both statuses that make a worker not due, which is
    /// the whole debounce: [`TEST_RUNNING`] because a run is already in
    /// flight, [`TEST_PASS`] because re-running a green gate costs a suite per
    /// poll and can only confirm what is already recorded. `IS NULL` is
    /// spelled out beside them because a comparison against `NULL` is `NULL`
    /// in SQL, and a never-tested worker is exactly the one that must be
    /// claimable.
    ///
    /// `tested_at` is cleared with it: it belonged to the verdict this claim
    /// has just replaced.
    pub async fn claim_test_gate(&self, worker_id: &str) -> Result<bool, String> {
        let done = sqlx::query(
            "UPDATE workers SET test_status = ?1, tested_at = NULL
             WHERE id = ?2 AND (test_status IS NULL OR test_status NOT IN (?1, ?3))",
        )
        .bind(TEST_RUNNING)
        .bind(worker_id)
        .bind(TEST_PASS)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to claim the test gate: {e}"))?;
        Ok(done.rows_affected() == 1)
    }

    pub async fn delete_worker(&self, id: &str) -> Result<(), String> {
        self.take_session(id);
        sqlx::query("DELETE FROM workers WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to delete worker: {e}"))?;
        Ok(())
    }

    // -- task queue (Phase 7) ---------------------------------------------

    pub async fn insert_queue_entry(&self, entry: &QueueEntry) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO task_queue (id, project_id, raw_text, sharpened_text, profile_id, status, priority, worker_id, error, spawned_by, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )
        .bind(&entry.id)
        .bind(&entry.project_id)
        .bind(&entry.raw_text)
        .bind(&entry.sharpened_text)
        .bind(&entry.profile_id)
        .bind(&entry.status)
        .bind(entry.priority)
        .bind(&entry.worker_id)
        .bind(&entry.error)
        .bind(&entry.spawned_by)
        .bind(entry.created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to enqueue task: {e}"))?;
        Ok(())
    }

    pub async fn list_queue(&self, project_id: Option<&str>) -> Result<Vec<QueueEntry>, String> {
        let rows = match project_id {
            Some(project_id) => sqlx::query_as::<_, QueueEntry>(&format!(
                "SELECT {QUEUE_COLUMNS} FROM task_queue WHERE project_id = ?1 ORDER BY priority DESC, created_at, id"
            ))
            .bind(project_id)
            .fetch_all(&self.pool)
            .await,
            None => sqlx::query_as::<_, QueueEntry>(&format!(
                "SELECT {QUEUE_COLUMNS} FROM task_queue ORDER BY priority DESC, created_at, id"
            ))
            .fetch_all(&self.pool)
            .await,
        }
        .map_err(|e| format!("failed to list queue: {e}"))?;
        Ok(rows)
    }

    pub async fn set_queue_ready_result(
        &self,
        id: &str,
        sharpened_text: Option<&str>,
    ) -> Result<QueueEntry, String> {
        sqlx::query("UPDATE task_queue SET sharpened_text = ?1, status = ?2 WHERE id = ?3")
            .bind(sharpened_text)
            .bind(QUEUE_READY)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to finish task sharpening: {e}"))?;
        self.get_queue_entry(id)
            .await?
            .ok_or_else(|| format!("unknown queued task: {id}"))
    }

    /// Claim a ready entry for a worker that has just been started.
    ///
    /// The `status` guard makes this a claim rather than a blind write, so it
    /// has to report when the claim came back empty: launching takes seconds
    /// (a worktree and a PTY), and the user can cancel the entry in that
    /// window. Reporting success there would leave a worker running under a
    /// queue row that no longer exists, and every sibling method in this module
    /// checks `rows_affected` for the same reason.
    /// Take a ready entry off the ready list, atomically.
    ///
    /// `Ok(false)` means somebody else got there first - another dispatcher,
    /// or the user cancelling it in the moment between the read and this
    /// write. The conditional UPDATE is the whole mechanism: SQLite decides
    /// which of two callers wins, and the loser simply does nothing.
    pub async fn claim_queue_entry(&self, id: &str) -> Result<bool, String> {
        let result = sqlx::query("UPDATE task_queue SET status = ?1 WHERE id = ?2 AND status = ?3")
            .bind(QUEUE_DISPATCHING)
            .bind(id)
            .bind(QUEUE_READY)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to claim queued task: {e}"))?;
        Ok(result.rows_affected() == 1)
    }

    /// Put a claimed entry back on the ready list.
    ///
    /// Used when the claim turns out not to be usable after all - the profile
    /// was blocked in the meantime, a preflight check refused it. The entry
    /// keeps its place and its priority; nothing about it has been spent.
    pub async fn release_queue_entry(&self, id: &str) -> Result<(), String> {
        sqlx::query("UPDATE task_queue SET status = ?1 WHERE id = ?2 AND status = ?3")
            .bind(QUEUE_READY)
            .bind(id)
            .bind(QUEUE_DISPATCHING)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to release queued task: {e}"))?;
        Ok(())
    }

    /// Resolve every claim left behind by a process that is no longer running.
    ///
    /// Called once at startup, for the same reason
    /// [`crate::testgate::clear_stale_test_runs`] is: nothing is dispatching
    /// yet at that moment, so every `dispatching` row is a claim whose owner
    /// died somewhere between taking it and marking it dispatched. What
    /// happens to it depends on what the work left behind:
    ///
    /// - A running employee no dispatched entry accounts for is the proof the
    ///   claim bore fruit: the worker was started, only the bookkeeping never
    ///   landed. The entry is marked `dispatched` under that worker rather
    ///   than handed out a second time.
    /// - Without one the claim is an orphan and goes back to `ready`, so the
    ///   next sweep starts the task for real.
    ///
    /// Returns how many claims were resolved. Each attribution consumes its
    /// worker, so two leftover claims can never point at the same one.
    ///
    /// Only `running` workers count, so the caller decides the outcome by
    /// what it has retired beforehand. At startup that is
    /// `main.rs::reattach_workers_and_resolve_claims` (KI-23): it retires the
    /// workers whose worktree is gone first (their claims go back to
    /// `ready`), calls this while the workers that wait for a respawn are
    /// still `running` (their claims stay with them), and marks those
    /// `exited` afterwards. Workers the reattach pass skips (profile switched
    /// off, budget pause) stay `running` and keep their claim as well.
    pub async fn release_claimed_queue_entries(&self) -> Result<usize, String> {
        // Take the writer lock first: a deferred BEGIN would read, and SQLite
        // skips the busy handler on the later read-to-write upgrade, failing
        // `database is locked` at once instead of waiting busy_timeout.
        // Errors here are database failures only; unlike the continuous
        // writers there is no early rejection that would need `settle`.
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(|e| format!("failed to begin claim release: {e}"))?;
        let claimed: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
            "SELECT id, project_id, raw_text, sharpened_text FROM task_queue WHERE status = ?1 ORDER BY created_at, id",
        )
        .bind(QUEUE_DISPATCHING)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| format!("failed to read claimed tasks: {e}"))?;
        let mut resolved = 0;
        for (id, project_id, raw_text, sharpened_text) in claimed {
            // Attribution needs evidence beyond "some worker is running": the
            // candidate must carry *this* task. A hand-started or respawned
            // worker with an unrelated task would otherwise swallow the claim
            // (marked dispatched, never run) — silent work loss, the same
            // failure class as the double spawn this function prevents. The
            // text a queue-spawned worker carries is the sharpened one when
            // sharpening ran, else the raw one.
            let task_text = sharpened_text.as_deref().unwrap_or(&raw_text);
            let worker: Option<(String,)> = sqlx::query_as(
                "SELECT id FROM workers w \
                 WHERE w.project_id = ?1 AND w.status = ?2 AND w.kind = ?3 \
                 AND w.task = ?4 \
                 AND NOT EXISTS (SELECT 1 FROM task_queue d WHERE d.worker_id = w.id) \
                 ORDER BY w.created_at, w.id LIMIT 1",
            )
            .bind(&project_id)
            .bind(STATUS_RUNNING)
            .bind(KIND_WORKER)
            .bind(task_text)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| format!("failed to look for the claim's worker: {e}"))?;
            match worker {
                Some((worker_id,)) => {
                    sqlx::query(
                        "UPDATE task_queue SET status = ?1, worker_id = ?2, error = NULL \
                         WHERE id = ?3 AND status = ?4",
                    )
                    .bind(QUEUE_DISPATCHED)
                    .bind(&worker_id)
                    .bind(&id)
                    .bind(QUEUE_DISPATCHING)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| format!("failed to attribute claimed task: {e}"))?;
                }
                None => {
                    sqlx::query("UPDATE task_queue SET status = ?1 WHERE id = ?2 AND status = ?3")
                        .bind(QUEUE_READY)
                        .bind(&id)
                        .bind(QUEUE_DISPATCHING)
                        .execute(&mut *tx)
                        .await
                        .map_err(|e| format!("failed to release claimed task: {e}"))?;
                }
            }
            resolved += 1;
        }
        tx.commit()
            .await
            .map_err(|e| format!("failed to finish claim release: {e}"))?;
        Ok(resolved)
    }

    /// Mark a claimed entry dispatched under the worker that was started for
    /// it, provided the project still has a free queue-dispatched slot.
    ///
    /// Both conditions ride in the one UPDATE, because either can be lost
    /// while the worker starts: a cancel takes the claim away, and an
    /// overlapping dispatcher takes the slot. The capacity side counts only
    /// *committed* occupancy - entries already dispatched whose worker is
    /// still running - so the first mark to land wins permanently, and the
    /// overlapping one loses here rather than overbooking the project.
    /// Workers started by hand are not counted: that occupancy is the
    /// capacity check at the top of the sweep, and duplicating it here would
    /// make two in-flight launches fail each other. `limit` is the project's
    /// effective cap as the caller computed it (its own `max_workers`, or the
    /// queue default).
    ///
    /// Failing either condition is the same `Err` to the caller, which then
    /// reads the entry to tell "claim is gone" from "slot is gone".
    pub async fn mark_queue_dispatched(
        &self,
        id: &str,
        worker_id: &str,
        limit: usize,
    ) -> Result<(), String> {
        let result = sqlx::query(
            "UPDATE task_queue SET status = ?1, worker_id = ?2, error = NULL \
             WHERE id = ?3 AND status = ?4 \
             AND (SELECT COUNT(*) FROM task_queue d \
                  JOIN workers w ON w.id = d.worker_id \
                  WHERE d.project_id = task_queue.project_id AND d.status = ?1 \
                  AND w.status = ?5 AND w.kind = ?6) < ?7",
        )
        .bind(QUEUE_DISPATCHED)
        .bind(worker_id)
        .bind(id)
        .bind(QUEUE_DISPATCHING)
        .bind(STATUS_RUNNING)
        .bind(KIND_WORKER)
        .bind(i64::try_from(limit).unwrap_or(i64::MAX))
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to dispatch queued task: {e}"))?;
        if result.rows_affected() == 0 {
            return Err(format!(
                "queued task {id} is no longer claimed for dispatch"
            ));
        }
        Ok(())
    }

    pub async fn mark_queue_failed(&self, id: &str, error: &str) -> Result<(), String> {
        sqlx::query("UPDATE task_queue SET status = ?1, error = ?2 WHERE id = ?3")
            .bind(QUEUE_FAILED)
            .bind(error)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to record queue failure: {e}"))?;
        Ok(())
    }

    /// Delete an entry that is still queued or ready, or one that is
    /// dispatched and whose worker's process end is proven (W1-05b; the rule
    /// and what counts as proof live in `store/queue_cancel.rs`).
    ///
    /// Three outcomes: `Ok(())` once the row is gone, an error opening with
    /// [`crate::workers::ERR_UNKNOWN`] when no such entry exists, and one
    /// opening with [`crate::workers::ERR_REFUSED`] when it exists but cannot
    /// go - claimed, failed, or dispatched without that proof, the refusal
    /// then naming what is missing. A store failure keeps its `failed to`
    /// opening and reaches the caller as is.
    ///
    /// The delete and the look that explains a refusal share one transaction.
    /// The delete takes SQLite's write lock even when it matches nothing, so
    /// no claim or release can move the row in between: the status named in a
    /// refusal is the one that refused, never a `ready` it reached a moment
    /// later. The transaction is committed on every path that reaches an
    /// outcome, so a failing commit is reported rather than swallowed by a
    /// drop; the early store-error returns roll back by dropping it.
    pub async fn cancel_queue_entry(&self, id: &str) -> Result<(), String> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| format!("failed to begin queue cancel: {e}"))?;
        let result = sqlx::query("DELETE FROM task_queue WHERE id = ?1 AND status IN (?2, ?3)")
            .bind(id)
            .bind(QUEUE_QUEUED)
            .bind(QUEUE_READY)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("failed to cancel queued task: {e}"))?;
        let outcome = if result.rows_affected() == 0 {
            let status: Option<(String, Option<String>)> =
                sqlx::query_as("SELECT status, worker_id FROM task_queue WHERE id = ?1")
                    .bind(id)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(|e| format!("failed to read queued task: {e}"))?;
            match status {
                None => Err(format!("{}queued task: {id}", crate::workers::ERR_UNKNOWN)),
                Some((status, worker_id)) if status == QUEUE_DISPATCHED => {
                    self.cancel_dispatched_in(&mut tx, id, worker_id).await?
                }
                Some((status, _)) => Err(format!(
                    "{}task {id} is {status}, not queued or ready",
                    crate::workers::ERR_REFUSED
                )),
            }
        } else {
            Ok(())
        };
        tx.commit()
            .await
            .map_err(|e| format!("failed to finish queue cancel: {e}"))?;
        outcome
    }

    async fn get_queue_entry(&self, id: &str) -> Result<Option<QueueEntry>, String> {
        sqlx::query_as::<_, QueueEntry>(&format!(
            "SELECT {QUEUE_COLUMNS} FROM task_queue WHERE id = ?1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("failed to read queued task: {e}"))
    }

    // -- recommendations (Phase 7.1) ---------------------------------------

    /// Store a recommendation, keeping whatever is already under that id.
    ///
    /// Ingest re-reads `.pa-scout.jsonl` from the top every time (see
    /// [`crate::scout`]), so the same line arrives again and again. Ids are
    /// derived from the line's content, which turns that repetition into an
    /// insert that does nothing - and, importantly, never resurrects a
    /// recommendation the user has already dismissed.
    ///
    /// Returns whether the row is new.
    pub async fn insert_recommendation(&self, rec: &Recommendation) -> Result<bool, String> {
        let done = sqlx::query(
            "INSERT OR IGNORE INTO recommendations
                 (id, project_id, title, url, rationale, effort, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(&rec.id)
        .bind(&rec.project_id)
        .bind(&rec.title)
        .bind(&rec.url)
        .bind(&rec.rationale)
        .bind(&rec.effort)
        .bind(&rec.status)
        .bind(rec.created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to store recommendation: {e}"))?;
        Ok(done.rows_affected() > 0)
    }

    /// Oldest first, and within one second in the order they were stored:
    /// ids are content hashes (see [`crate::scout`]), so they would sort a
    /// scout file's findings into an order nobody wrote them in.
    pub async fn list_recommendations(
        &self,
        project_id: Option<&str>,
    ) -> Result<Vec<Recommendation>, String> {
        match project_id {
            Some(project_id) => {
                sqlx::query_as::<_, Recommendation>(&format!(
                    "SELECT {RECOMMENDATION_COLUMNS} FROM recommendations WHERE project_id = ?1 \
                 ORDER BY created_at, rowid"
                ))
                .bind(project_id)
                .fetch_all(&self.pool)
                .await
            }
            None => {
                sqlx::query_as::<_, Recommendation>(&format!(
                "SELECT {RECOMMENDATION_COLUMNS} FROM recommendations ORDER BY created_at, rowid"
            ))
                .fetch_all(&self.pool)
                .await
            }
        }
        .map_err(|e| format!("failed to list recommendations: {e}"))
    }

    pub async fn get_recommendation(&self, id: &str) -> Result<Option<Recommendation>, String> {
        sqlx::query_as::<_, Recommendation>(&format!(
            "SELECT {RECOMMENDATION_COLUMNS} FROM recommendations WHERE id = ?1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("failed to read recommendation: {e}"))
    }

    /// Atomically claim a recommendation for acceptance: the update succeeds
    /// for exactly one of any number of concurrent callers. Returns whether
    /// this caller won the claim; `Err` is reserved for the database itself.
    pub async fn claim_recommendation(&self, id: &str) -> Result<bool, String> {
        let done =
            sqlx::query("UPDATE recommendations SET status = ?1 WHERE id = ?2 AND status != ?1")
                .bind(REC_ACCEPTED)
                .bind(id)
                .execute(&self.pool)
                .await
                .map_err(|e| format!("failed to claim the recommendation: {e}"))?;
        Ok(done.rows_affected() == 1)
    }

    /// Move a recommendation to `status`. An unknown id is an error: the
    /// caller asked about something that is not there.
    pub async fn set_recommendation_status(&self, id: &str, status: &str) -> Result<(), String> {
        let done = sqlx::query("UPDATE recommendations SET status = ?1 WHERE id = ?2")
            .bind(status)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to update recommendation: {e}"))?;
        if done.rows_affected() == 0 {
            return Err(format!("unknown recommendation: {id}"));
        }
        Ok(())
    }

    // -- the OmniRoute usage ledger (Phase 19 T3) --------------------------

    /// Record one OmniRoute usage row, ignoring one that is already stored.
    ///
    /// Returns whether the row was new. The poller reads a ring buffer, so on
    /// a quiet machine every row it hands over is a duplicate and this answers
    /// `false` every time - that is the ordinary case, not a failure.
    pub async fn insert_usage_event(&self, event: &UsageEvent) -> Result<bool, String> {
        let result = sqlx::query(
            "INSERT OR IGNORE INTO usage_events
                 (id, ts, profile_id, model, provider, tokens_in, tokens_out, cost_usd, raw_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .bind(&event.id)
        .bind(event.ts)
        .bind(&event.profile_id)
        .bind(&event.model)
        .bind(&event.provider)
        .bind(event.tokens_in)
        .bind(event.tokens_out)
        .bind(event.cost_usd)
        .bind(&event.raw_json)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to store usage event: {e}"))?;
        Ok(result.rows_affected() == 1)
    }

    /// The ledger, newest first. `since` keeps rows at or after that Unix
    /// second; `limit` caps how many come back.
    pub async fn list_usage_events(
        &self,
        since: Option<i64>,
        limit: Option<u32>,
    ) -> Result<Vec<UsageEvent>, String> {
        // `-1` is SQLite's own "no limit", which keeps this to one query shape
        // instead of one per combination of the two optional arguments.
        let limit = limit.map_or(-1_i64, i64::from);
        sqlx::query_as::<_, UsageEvent>(&format!(
            "SELECT {USAGE_EVENT_COLUMNS} FROM usage_events
             WHERE ts >= ?1 ORDER BY ts DESC, id LIMIT ?2"
        ))
        .bind(since.unwrap_or(i64::MIN))
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("failed to list usage events: {e}"))
    }

    /// Requests, tokens and dollars over the ledger, optionally from `since`.
    ///
    /// Summed in SQLite rather than over a fetched list: "everything ever" is
    /// a legitimate window here, and it is not worth carrying through memory.
    pub async fn usage_totals(&self, since: Option<i64>) -> Result<UsageTotals, String> {
        sqlx::query_as::<_, UsageTotals>(
            "SELECT COUNT(*) AS requests,
                    COALESCE(SUM(tokens_in), 0) AS tokens_in,
                    COALESCE(SUM(tokens_out), 0) AS tokens_out,
                    COALESCE(SUM(cost_usd), 0.0) AS cost_usd,
                    COUNT(cost_usd) AS priced
             FROM usage_events WHERE ts >= ?1",
        )
        .bind(since.unwrap_or(i64::MIN))
        .fetch_one(&self.pool)
        .await
        .map_err(|e| format!("failed to total usage events: {e}"))
    }

    /// The same totals, split by the profile the row could be attributed to.
    /// `profile_id` is `None` for the rows OmniRoute's log does not pin to a
    /// profile, which is most of them - see [`UsageEvent::profile_id`].
    pub async fn usage_totals_by_profile(
        &self,
        since: Option<i64>,
    ) -> Result<Vec<ProfileUsageTotals>, String> {
        sqlx::query_as::<_, ProfileUsageTotals>(
            "SELECT profile_id,
                    COUNT(*) AS requests,
                    COALESCE(SUM(tokens_in), 0) AS tokens_in,
                    COALESCE(SUM(tokens_out), 0) AS tokens_out,
                    COALESCE(SUM(cost_usd), 0.0) AS cost_usd,
                    COUNT(cost_usd) AS priced
             FROM usage_events WHERE ts >= ?1
             GROUP BY profile_id ORDER BY profile_id",
        )
        .bind(since.unwrap_or(i64::MIN))
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("failed to total usage events per profile: {e}"))
    }

    // -- statistics (Phase 20) ---------------------------------------------

    /// Is there a table of this name in the schema?
    ///
    /// Load-bearing for exactly one caller: [`crate::stats::token_usage`] has
    /// to answer "not measured" rather than fail when `usage_events` is not
    /// there. Every database this build opens gets the table from the frozen
    /// baseline ([`Store::apply_baseline`]), so this is about a store handed
    /// in from somewhere else - a copied file, a test fixture, an older
    /// build's database opened read-only by a tool.
    pub async fn table_exists(&self, name: &str) -> Result<bool, String> {
        let found: Option<(String,)> =
            sqlx::query_as("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1")
                .bind(name)
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| format!("failed to inspect the schema: {e}"))?;
        Ok(found.is_some())
    }

    /// One project's messages per UTC day, oldest day first.
    ///
    /// Counted in SQLite rather than by fetching the rows: the timeline needs
    /// a number per day, and "everything ever" is a window the user can pick.
    pub async fn count_messages_per_day(
        &self,
        project_id: &str,
        since: Option<i64>,
    ) -> Result<Vec<DayCount>, String> {
        sqlx::query_as::<_, DayCount>(
            "SELECT (m.created_at / 86400) * 86400 AS day, COUNT(*) AS count
             FROM messages m JOIN workers w ON w.id = m.worker_id
             WHERE w.project_id = ?1 AND m.created_at >= ?2
             GROUP BY day ORDER BY day",
        )
        .bind(project_id)
        .bind(since.unwrap_or(0))
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("failed to count messages per day: {e}"))
    }

    /// One project's status events per UTC day, oldest day first.
    pub async fn count_status_events_per_day(
        &self,
        project_id: &str,
        since: Option<i64>,
    ) -> Result<Vec<DayCount>, String> {
        sqlx::query_as::<_, DayCount>(
            "SELECT (e.created_at / 86400) * 86400 AS day, COUNT(*) AS count
             FROM status_events e JOIN workers w ON w.id = e.worker_id
             WHERE w.project_id = ?1 AND e.created_at >= ?2
             GROUP BY day ORDER BY day",
        )
        .bind(project_id)
        .bind(since.unwrap_or(0))
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("failed to count status events per day: {e}"))
    }

    /// How many review comments this project's workers collected.
    pub async fn count_diff_comments(
        &self,
        project_id: &str,
        since: Option<i64>,
    ) -> Result<i64, String> {
        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM diff_comments c JOIN workers w ON w.id = c.worker_id
             WHERE w.project_id = ?1 AND c.created_at >= ?2",
        )
        .bind(project_id)
        .bind(since.unwrap_or(0))
        .fetch_one(&self.pool)
        .await
        .map_err(|e| format!("failed to count review comments: {e}"))?;
        Ok(count)
    }

    // -- learnings and settings (Phase 14) ---------------------------------

    /// Store a distilled learning. Ids come from [`new_id`] with the `lr`
    /// prefix, so unlike a recommendation there is nothing to collide with.
    pub async fn insert_learning(&self, learning: &Learning) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO learnings
                 (id, project_id, worker_id, profile_id, pattern_label, content, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(&learning.id)
        .bind(&learning.project_id)
        .bind(&learning.worker_id)
        .bind(&learning.profile_id)
        .bind(&learning.pattern_label)
        .bind(&learning.content)
        .bind(&learning.status)
        .bind(learning.created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to store learning: {e}"))?;
        Ok(())
    }

    /// Oldest first. Both filters are optional and independent: the review
    /// screen wants one project's pending cards, the CLI sometimes wants all
    /// of them.
    pub async fn list_learnings(
        &self,
        project_id: Option<&str>,
        status: Option<&str>,
    ) -> Result<Vec<Learning>, String> {
        // Four query shapes rather than a string built from the arguments:
        // the bindings stay bindings, which is the point.
        match (project_id, status) {
            (Some(project_id), Some(status)) => {
                sqlx::query_as::<_, Learning>(&format!(
                    "SELECT {LEARNING_COLUMNS} FROM learnings WHERE project_id = ?1 AND status = ?2
                 ORDER BY created_at, rowid"
                ))
                .bind(project_id)
                .bind(status)
                .fetch_all(&self.pool)
                .await
            }
            (Some(project_id), None) => {
                sqlx::query_as::<_, Learning>(&format!(
                    "SELECT {LEARNING_COLUMNS} FROM learnings WHERE project_id = ?1
                 ORDER BY created_at, rowid"
                ))
                .bind(project_id)
                .fetch_all(&self.pool)
                .await
            }
            (None, Some(status)) => {
                sqlx::query_as::<_, Learning>(&format!(
                    "SELECT {LEARNING_COLUMNS} FROM learnings WHERE status = ?1
                 ORDER BY created_at, rowid"
                ))
                .bind(status)
                .fetch_all(&self.pool)
                .await
            }
            (None, None) => {
                sqlx::query_as::<_, Learning>(&format!(
                    "SELECT {LEARNING_COLUMNS} FROM learnings ORDER BY created_at, rowid"
                ))
                .fetch_all(&self.pool)
                .await
            }
        }
        .map_err(|e| format!("failed to list learnings: {e}"))
    }

    pub async fn get_learning(&self, id: &str) -> Result<Option<Learning>, String> {
        sqlx::query_as::<_, Learning>(&format!(
            "SELECT {LEARNING_COLUMNS} FROM learnings WHERE id = ?1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("failed to read learning: {e}"))
    }

    /// Move a learning to `status`. An unknown id is an error, exactly as on
    /// [`Store::set_recommendation_status`]: the caller asked about something
    /// that is not there.
    pub async fn set_learning_status(&self, id: &str, status: &str) -> Result<(), String> {
        let done = sqlx::query("UPDATE learnings SET status = ?1 WHERE id = ?2")
            .bind(status)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to update learning: {e}"))?;
        if done.rows_affected() == 0 {
            return Err(format!("unknown learning: {id}"));
        }
        Ok(())
    }

    /// Replace a learning's text. The review screen lets a human rewrite what
    /// the critic wrote before it goes into the playbook, and that edit is
    /// what gets stored.
    pub async fn set_learning_content(&self, id: &str, content: &str) -> Result<(), String> {
        let done = sqlx::query("UPDATE learnings SET content = ?1 WHERE id = ?2")
            .bind(content)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to update learning: {e}"))?;
        if done.rows_affected() == 0 {
            return Err(format!("unknown learning: {id}"));
        }
        Ok(())
    }

    // -- role variants (Phase 15) ------------------------------------------

    /// Store a proposed role variant. Ids come from [`new_id`] with the `rv`
    /// prefix.
    pub async fn insert_role_variant(&self, variant: &RoleVariant) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO role_variants
                 (id, project_id, name, base_profile_id, pattern_label,
                  system_prompt_addition, version, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .bind(&variant.id)
        .bind(&variant.project_id)
        .bind(&variant.name)
        .bind(&variant.base_profile_id)
        .bind(&variant.pattern_label)
        .bind(&variant.system_prompt_addition)
        .bind(variant.version)
        .bind(&variant.status)
        .bind(variant.created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to store role variant: {e}"))?;
        Ok(())
    }

    /// Oldest first. Both filters are optional and independent, exactly as on
    /// [`Store::list_learnings`]: the review screen wants one project's
    /// pending proposals, the CLI sometimes wants all of them.
    pub async fn list_role_variants(
        &self,
        project_id: Option<&str>,
        status: Option<&str>,
    ) -> Result<Vec<RoleVariant>, String> {
        match (project_id, status) {
            (Some(project_id), Some(status)) => {
                sqlx::query_as::<_, RoleVariant>(&format!(
                    "SELECT {ROLE_VARIANT_COLUMNS} FROM role_variants
                 WHERE project_id = ?1 AND status = ?2
                 ORDER BY created_at, rowid"
                ))
                .bind(project_id)
                .bind(status)
                .fetch_all(&self.pool)
                .await
            }
            (Some(project_id), None) => {
                sqlx::query_as::<_, RoleVariant>(&format!(
                    "SELECT {ROLE_VARIANT_COLUMNS} FROM role_variants WHERE project_id = ?1
                 ORDER BY created_at, rowid"
                ))
                .bind(project_id)
                .fetch_all(&self.pool)
                .await
            }
            (None, Some(status)) => {
                sqlx::query_as::<_, RoleVariant>(&format!(
                    "SELECT {ROLE_VARIANT_COLUMNS} FROM role_variants WHERE status = ?1
                 ORDER BY created_at, rowid"
                ))
                .bind(status)
                .fetch_all(&self.pool)
                .await
            }
            (None, None) => {
                sqlx::query_as::<_, RoleVariant>(&format!(
                    "SELECT {ROLE_VARIANT_COLUMNS} FROM role_variants ORDER BY created_at, rowid"
                ))
                .fetch_all(&self.pool)
                .await
            }
        }
        .map_err(|e| format!("failed to list role variants: {e}"))
    }

    pub async fn get_role_variant(&self, id: &str) -> Result<Option<RoleVariant>, String> {
        sqlx::query_as::<_, RoleVariant>(&format!(
            "SELECT {ROLE_VARIANT_COLUMNS} FROM role_variants WHERE id = ?1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("failed to read role variant: {e}"))
    }

    /// Move a variant to `status`. An unknown id is an error: the caller asked
    /// about something that is not there.
    pub async fn set_role_variant_status(&self, id: &str, status: &str) -> Result<(), String> {
        let done = sqlx::query("UPDATE role_variants SET status = ?1 WHERE id = ?2")
            .bind(status)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to update role variant: {e}"))?;
        if done.rows_affected() == 0 {
            return Err(format!("unknown role variant: {id}"));
        }
        Ok(())
    }

    /// How many approved learnings one `(pattern, profile)` key has collected
    /// in a project. This is the number [`crate::roles`] weighs against its
    /// threshold before it proposes anything.
    pub async fn count_approved_learnings(
        &self,
        project_id: &str,
        pattern_label: &str,
        profile_id: &str,
    ) -> Result<i64, String> {
        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM learnings
             WHERE project_id = ?1 AND pattern_label = ?2 AND profile_id = ?3
               AND status = ?4",
        )
        .bind(project_id)
        .bind(pattern_label)
        .bind(profile_id)
        .bind(LEARNING_APPROVED)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| format!("failed to count approved learnings: {e}"))?;
        Ok(count.0)
    }

    /// The variant one key currently offers: its highest approved version.
    ///
    /// There is only ever one, because [`crate::roles::approve_variant`]
    /// retires the older ones - but the query orders by version anyway, so a
    /// database somebody edited by hand still answers sensibly.
    ///
    /// Nothing calls it inside the crate yet: spawning picks a variant by
    /// id, and this is the lookup a caller that only knows the key needs.
    #[allow(dead_code)]
    pub async fn approved_variant_for(
        &self,
        project_id: &str,
        pattern_label: &str,
        profile_id: &str,
    ) -> Result<Option<RoleVariant>, String> {
        sqlx::query_as::<_, RoleVariant>(&format!(
            "SELECT {ROLE_VARIANT_COLUMNS} FROM role_variants
             WHERE project_id = ?1 AND pattern_label = ?2 AND base_profile_id = ?3
               AND status = ?4
             ORDER BY version DESC LIMIT 1"
        ))
        .bind(project_id)
        .bind(pattern_label)
        .bind(profile_id)
        .bind(ROLE_APPROVED)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("failed to read role variant: {e}"))
    }

    /// The highest version on one key, whatever its status.
    ///
    /// Two questions at once: whether a proposal is already waiting or was
    /// refused, and what number the next one would carry.
    pub async fn latest_variant_for(
        &self,
        project_id: &str,
        pattern_label: &str,
        profile_id: &str,
    ) -> Result<Option<RoleVariant>, String> {
        sqlx::query_as::<_, RoleVariant>(&format!(
            "SELECT {ROLE_VARIANT_COLUMNS} FROM role_variants
             WHERE project_id = ?1 AND pattern_label = ?2 AND base_profile_id = ?3
             ORDER BY version DESC LIMIT 1"
        ))
        .bind(project_id)
        .bind(pattern_label)
        .bind(profile_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("failed to read role variant: {e}"))
    }

    // -- activity feed (Phase 16) ------------------------------------------

    /// The fleet-wide activity feed, newest first.
    ///
    /// One UNION ALL over everything the store already records (see
    /// [`ActivityEntry`]); `project_id` narrows it to one project. The
    /// worker-bound tables (`status_events`, `messages`) reach their project
    /// through the `workers` join; the rest carry their own `project_id`.
    /// Long texts are cut in SQL, so the feed stays a list of lines, never a
    /// page of prose.
    pub async fn get_activity(
        &self,
        project_id: Option<&str>,
        limit: i64,
    ) -> Result<Vec<ActivityEntry>, String> {
        // SQLite reads a negative LIMIT as unlimited, so zero and below are
        // not a valid way to ask for less.
        let limit = limit.clamp(1, 500);
        // A label longer than this would push the summary off the screen.
        const LABEL_CHARS: i64 = 60;
        const SUMMARY_CHARS: i64 = 140;
        let select = format!(
            "SELECT id, created_at, category, project_id, worker_id, worker_label, summary
             FROM (
                 SELECT w.id AS id, w.created_at AS created_at, 'worker' AS category,
                        w.project_id AS project_id, w.id AS worker_id,
                        substr(w.task, 1, {LABEL_CHARS}) AS worker_label,
                        'worker created (' || w.kind || ', profile ' || w.profile_id || ')' AS summary
                 FROM workers w
                 UNION ALL
                 SELECT e.id, e.created_at, 'status', w.project_id, e.worker_id,
                        substr(w.task, 1, {LABEL_CHARS}),
                        e.kind || ': ' || substr(e.detail, 1, {SUMMARY_CHARS})
                 FROM status_events e JOIN workers w ON w.id = e.worker_id
                 UNION ALL
                 SELECT m.id, m.created_at, 'message', w.project_id, m.worker_id,
                        substr(w.task, 1, {LABEL_CHARS}),
                        m.role || ': ' || substr(m.content, 1, {SUMMARY_CHARS})
                 FROM messages m JOIN workers w ON w.id = m.worker_id
                 UNION ALL
                 SELECT q.id, q.created_at, 'queue', q.project_id, q.worker_id,
                        substr(wq.task, 1, {LABEL_CHARS}),
                        'queued: ' || substr(q.raw_text, 1, {SUMMARY_CHARS})
                 FROM task_queue q LEFT JOIN workers wq ON wq.id = q.worker_id
                 UNION ALL
                 SELECT r.id, r.created_at, 'recommendation', r.project_id, NULL, NULL,
                        substr(r.title, 1, {SUMMARY_CHARS})
                 FROM recommendations r
                 UNION ALL
                 SELECT l.id, l.created_at, 'learning', l.project_id, l.worker_id,
                        substr(wl.task, 1, {LABEL_CHARS}),
                        coalesce(l.pattern_label || ': ', '') || substr(l.content, 1, {SUMMARY_CHARS})
                 FROM learnings l LEFT JOIN workers wl ON wl.id = l.worker_id
                 UNION ALL
                 SELECT v.id, v.created_at, 'role', v.project_id, NULL, NULL,
                        'role variant: ' || v.name || ' v' || v.version
                 FROM role_variants v
             )"
        );
        // One outer WHERE rather than seven inner ones: the binding stays a
        // binding either way, and the branches stay readable.
        let result = match project_id {
            Some(project_id) => {
                sqlx::query_as::<_, ActivityEntry>(&format!(
                "{select} WHERE project_id = ?1 ORDER BY created_at DESC, id DESC LIMIT {limit}"
            ))
                .bind(project_id)
                .fetch_all(&self.pool)
                .await
            }
            None => {
                sqlx::query_as::<_, ActivityEntry>(&format!(
                    "{select} ORDER BY created_at DESC, id DESC LIMIT {limit}"
                ))
                .fetch_all(&self.pool)
                .await
            }
        };
        result.map_err(|e| format!("failed to list activity: {e}"))
    }

    /// One application setting, or `None` when nobody has written it. The
    /// callers in [`crate::learnings`] decide what a missing key means; the
    /// store only reports its absence.
    pub async fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?1")
            .bind(key)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| format!("failed to read setting: {e}"))?;
        Ok(row.map(|(value,)| value))
    }

    /// Write a setting, replacing whatever was there. Toggles are flipped far
    /// more often than they are created, so upsert is the only useful shape.
    pub async fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(key)
        .bind(value)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to store setting: {e}"))?;
        Ok(())
    }

    /// Every setting whose key starts with `prefix`, sorted by key.
    ///
    /// The settings table is a flat key-value store, so a family of keys -
    /// `budget.<profile>.five_hour_pct` and its siblings - can only be listed
    /// by prefix. `LIKE` is not used: the prefix is caller-supplied and `%`
    /// and `_` are wildcards in it, so a key containing an underscore would
    /// otherwise match prefixes nobody asked for.
    pub async fn list_settings(&self, prefix: &str) -> Result<Vec<(String, String)>, String> {
        let rows: Vec<(String, String)> =
            sqlx::query_as("SELECT key, value FROM settings ORDER BY key")
                .fetch_all(&self.pool)
                .await
                .map_err(|e| format!("failed to list settings: {e}"))?;
        Ok(rows
            .into_iter()
            .filter(|(key, _)| key.starts_with(prefix))
            .collect())
    }

    /// Remove a setting. Writing an empty value would be a value of its own -
    /// "no limit" has to be the absence of the key, or every reader would have
    /// to know which empty string means what.
    pub async fn delete_setting(&self, key: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM settings WHERE key = ?1")
            .bind(key)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to delete setting: {e}"))?;
        Ok(())
    }

    /// Status events of one project inside a half-open time window
    /// `[from, until)`, oldest first.
    ///
    /// Joined against `workers` because `status_events` is keyed by worker:
    /// the project is a fact about the worker, not about the event. Used by
    /// the daily digest, which reads one project and one day at a time.
    pub async fn list_status_events(
        &self,
        project_id: &str,
        from: i64,
        until: i64,
    ) -> Result<Vec<StatusEvent>, String> {
        sqlx::query_as::<_, StatusEvent>(
            "SELECT e.id, e.worker_id, e.kind, e.detail, e.source, e.created_at
             FROM status_events e JOIN workers w ON w.id = e.worker_id
             WHERE w.project_id = ?1 AND e.created_at >= ?2 AND e.created_at < ?3
             ORDER BY e.created_at, e.id",
        )
        .bind(project_id)
        .bind(from)
        .bind(until)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("failed to list status events: {e}"))
    }

    /// Record that a PTY session ended. Only a `running` worker flips to
    /// `exited`, so an archive that killed its own session is never overwritten.
    ///
    /// `exit_code` is what the child reported, or `None` when the platform did
    /// not say - it is written to the session row and nowhere else.
    ///
    /// The session row is closed before the worker is looked up, because it is
    /// keyed by session id and stays interesting even for a session whose
    /// worker has since been unbound: a second exit for the same id would
    /// otherwise be the one that got recorded.
    pub async fn mark_session_exited(
        &self,
        session_id: &str,
        exit_code: Option<i32>,
    ) -> Result<(), String> {
        // `ended_at IS NULL` so a row is closed once. The exit hook can fire
        // after the session was already torn down by an archive, and the
        // second report must not move a duration that is already final.
        let closed = sqlx::query(
            "UPDATE sessions SET ended_at = ?1, exit_code = ?2
             WHERE id = ?3 AND ended_at IS NULL",
        )
        .bind(now_unix_secs())
        .bind(exit_code.map(i64::from))
        .bind(session_id)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to record session exit: {e}"))?;
        let Some(worker_id) = self.worker_for_session(session_id) else {
            return Ok(());
        };
        self.take_session(&worker_id);
        if closed.rows_affected() == 0 {
            // The spawn→bind race, lost by the row: the binding already
            // existed (we just removed it), but `record_session_start` has
            // not written the row yet - this is the first exit report for
            // the session, or the update would have matched. Leave the exit
            // behind for the insert to pick up; otherwise the late row
            // would stay open forever.
            match self.pending_exits.lock() {
                Ok(mut pending) => {
                    pending.insert(session_id.to_string(), (now_unix_secs(), exit_code));
                }
                Err(_) => eprintln!(
                    "projecta: pending-exit map is poisoned; session {session_id} may stay open"
                ),
            }
        }
        sqlx::query("UPDATE workers SET status = ?1 WHERE id = ?2 AND status = ?3")
            .bind(STATUS_EXITED)
            .bind(&worker_id)
            .bind(STATUS_RUNNING)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to record worker exit: {e}"))?;
        Ok(())
    }

    // -- agent quota (Phase 3.6) -------------------------------------------

    /// Write a profile's quota row, replacing whatever was there.
    pub async fn set_agent_quota(&self, quota: &AgentQuota) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO agent_quota (profile_id, state, blocked_until, reason, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(profile_id) DO UPDATE SET
                 state = excluded.state,
                 blocked_until = excluded.blocked_until,
                 reason = excluded.reason,
                 updated_at = excluded.updated_at",
        )
        .bind(&quota.profile_id)
        .bind(&quota.state)
        .bind(quota.blocked_until)
        .bind(&quota.reason)
        .bind(quota.updated_at)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to record agent quota: {e}"))?;
        Ok(())
    }

    /// One profile's row. The app reads the whole table at startup and keeps it
    /// in memory afterwards (see [`crate::quota::QuotaTracker`]), so this is a
    /// single-row read for tests and for Phase 4.
    #[cfg(test)]
    pub async fn get_agent_quota(&self, profile_id: &str) -> Result<Option<AgentQuota>, String> {
        sqlx::query_as::<_, AgentQuota>(&format!(
            "SELECT {QUOTA_COLUMNS} FROM agent_quota WHERE profile_id = ?1"
        ))
        .bind(profile_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("failed to read agent quota: {e}"))
    }

    pub async fn list_agent_quota(&self) -> Result<Vec<AgentQuota>, String> {
        sqlx::query_as::<_, AgentQuota>(&format!(
            "SELECT {QUOTA_COLUMNS} FROM agent_quota ORDER BY profile_id"
        ))
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("failed to list agent quota: {e}"))
    }

    /// Forget a profile's quota row entirely, so it reads as unknown again.
    ///
    /// The tracker never deletes - a profile that recovers is written back as
    /// `ok`, which is a fact worth keeping - so this is the escape hatch for
    /// tests and for a user who wants the state wiped.
    #[cfg(test)]
    pub async fn clear_agent_quota(&self, profile_id: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM agent_quota WHERE profile_id = ?1")
            .bind(profile_id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to clear agent quota: {e}"))?;
        Ok(())
    }

    // -- diff comments (Phase 5) -------------------------------------------

    pub async fn insert_diff_comment(&self, comment: &DiffComment) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO diff_comments
                 (id, worker_id, file, line, body, sent_to_agent, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(&comment.id)
        .bind(&comment.worker_id)
        .bind(&comment.file)
        .bind(comment.line)
        .bind(&comment.body)
        .bind(comment.sent_to_agent)
        .bind(comment.created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to store review comment: {e}"))?;
        Ok(())
    }

    /// A worker's comments, oldest first - the order they were written in is
    /// the order the agent heard them in.
    pub async fn list_diff_comments(&self, worker_id: &str) -> Result<Vec<DiffComment>, String> {
        sqlx::query_as::<_, DiffComment>(&format!(
            "SELECT {DIFF_COMMENT_COLUMNS} FROM diff_comments WHERE worker_id = ?1 \
             ORDER BY created_at, id"
        ))
        .bind(worker_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("failed to list review comments: {e}"))
    }

    pub async fn get_diff_comment(&self, id: &str) -> Result<Option<DiffComment>, String> {
        sqlx::query_as::<_, DiffComment>(&format!(
            "SELECT {DIFF_COMMENT_COLUMNS} FROM diff_comments WHERE id = ?1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("failed to read review comment: {e}"))
    }

    /// Record that a comment reached the agent's terminal.
    pub async fn set_diff_comment_sent(&self, id: &str) -> Result<(), String> {
        sqlx::query("UPDATE diff_comments SET sent_to_agent = 1 WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to update review comment: {e}"))?;
        Ok(())
    }

    pub async fn delete_diff_comment(&self, id: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM diff_comments WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to delete review comment: {e}"))?;
        Ok(())
    }

    // -- worker <-> session mapping ----------------------------------------

    /// Attach `session_id` to `worker_id` and open its row in `sessions`,
    /// in one call.
    ///
    /// The production spawn paths call the halves separately - the map
    /// *before* the child process starts ([`Store::bind_session_in_memory`]),
    /// the row once it is up ([`Store::record_session_start`]) - because an
    /// agent that exits milliseconds into its life must still be found by
    /// the exit hook. This combined form remains for the tests that bind
    /// without a process in between.
    #[cfg(test)]
    pub async fn bind_session(&self, worker_id: &str, session_id: &str) {
        self.bind_session_in_memory(worker_id, session_id).unwrap();
        self.record_session_start(worker_id, session_id).await;
    }

    /// The in-memory half of [`Store::bind_session`], synchronous on purpose:
    /// the spawn path binds *before* the child process starts (see
    /// [`crate::workers::AgentControl::spawn_bound`]), which is the whole
    /// point - a bind that has to wait for an await point would re-open the
    /// spawn→bind race it exists to close.
    pub fn bind_session_in_memory(&self, worker_id: &str, session_id: &str) -> Result<(), String> {
        let mut bindings = self
            .sessions
            .lock()
            .map_err(|_| "session map unavailable")?;
        if bindings.native_closing.contains_key(worker_id)
            || bindings
                .native_closing
                .values()
                .any(|session| session == session_id)
        {
            return Err("native session finalization in progress".into());
        }
        bindings.bind(worker_id, session_id);
        Ok(())
    }

    /// The persistent half of [`Store::bind_session`]: the `sessions` row
    /// that outlives the process, written *after* the spawn returned.
    ///
    /// An exit that already fired while the row did not exist yet left its
    /// note in the pending-exit map (see [`Store::mark_session_exited`]); the
    /// row is then born closed, carrying that exit, instead of staying open
    /// forever.
    pub async fn record_session_start(&self, worker_id: &str, session_id: &str) {
        let pending = match self.pending_exits.lock() {
            Ok(mut pending) => pending.remove(session_id),
            Err(_) => {
                eprintln!(
                    "projecta: pending-exit map is poisoned; session {session_id} may stay open"
                );
                None
            }
        };
        let (ended_at, exit_code) = match pending {
            Some((ended_at, exit_code)) => (Some(ended_at), exit_code),
            None => (None, None),
        };
        // `OR REPLACE`, not `OR IGNORE`: a session id that comes round twice
        // is a new session, and the row that describes it is the new one.
        let written = sqlx::query(
            "INSERT OR REPLACE INTO sessions (id, worker_id, started_at, ended_at, exit_code)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(session_id)
        .bind(worker_id)
        .bind(now_unix_secs())
        .bind(ended_at)
        .bind(exit_code.map(i64::from))
        .execute(&self.pool)
        .await;
        if let Err(err) = written {
            eprintln!("projecta: failed to record session start: {err}");
        }
    }

    /// One project's sessions, oldest first, from `since` onwards.
    ///
    /// Scoped through `workers`, which is also why a session whose worker was
    /// deleted disappears from the statistics: there is no project to file it
    /// under any more.
    pub async fn list_sessions(
        &self,
        project_id: &str,
        since: Option<i64>,
    ) -> Result<Vec<Session>, String> {
        sqlx::query_as::<_, Session>(
            "SELECT s.id, s.worker_id, s.started_at, s.ended_at, s.exit_code
             FROM sessions s JOIN workers w ON w.id = s.worker_id
             WHERE w.project_id = ?1 AND s.started_at >= ?2
             ORDER BY s.started_at, s.id",
        )
        .bind(project_id)
        .bind(since.unwrap_or(i64::MIN))
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("failed to list sessions: {e}"))
    }

    /// Remove and return the session bound to `worker_id`.
    ///
    /// Callers unbind *before* killing a session on purpose: the PTY exit hook
    /// looks the worker up by session id, so an unbound session cannot race the
    /// status the caller is about to write.
    pub fn take_session(&self, worker_id: &str) -> Option<String> {
        match self.sessions.lock() {
            Ok(mut bindings) => bindings.unbind_worker(worker_id),
            Err(_) => {
                eprintln!(
                    "projecta: session map is poisoned; worker {worker_id} keeps its binding"
                );
                None
            }
        }
    }

    pub fn session_for_worker(&self, worker_id: &str) -> Option<String> {
        match self.sessions.lock() {
            Ok(bindings) => bindings.by_worker.get(worker_id).cloned(),
            Err(_) => {
                eprintln!(
                    "projecta: session map is poisoned; worker {worker_id} reads as sessionless"
                );
                None
            }
        }
    }

    pub fn worker_for_session(&self, session_id: &str) -> Option<String> {
        match self.sessions.lock() {
            Ok(bindings) => bindings.by_session.get(session_id).cloned(),
            Err(_) => {
                eprintln!(
                    "projecta: session map is poisoned; session {session_id} finds no worker"
                );
                None
            }
        }
    }

    // -- questions (Phase 21) ----------------------------------------------

    /// Write one question down, exactly as [`crate::questions`] built it.
    ///
    /// The row arrives complete rather than being assembled here, because a
    /// question is not always born open: the budget rule mints one that is
    /// already answered, and it is the same row either way.
    pub async fn insert_question(&self, question: &Question) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO questions (id, project_id, worker_id, scope, question, options_json, \
             status, answer, created_at, answered_at, answered_by, expires_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        )
        .bind(&question.id)
        .bind(&question.project_id)
        .bind(&question.worker_id)
        .bind(&question.scope)
        .bind(&question.question)
        .bind(&question.options_json)
        .bind(&question.status)
        .bind(&question.answer)
        .bind(question.created_at)
        .bind(question.answered_at)
        .bind(&question.answered_by)
        .bind(question.expires_at)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to insert question: {e}"))?;
        Ok(())
    }

    pub async fn get_question(&self, id: &str) -> Result<Option<Question>, String> {
        sqlx::query_as::<_, Question>(&format!(
            "SELECT {QUESTION_COLUMNS} FROM questions WHERE id = ?1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("failed to read question: {e}"))
    }

    /// Questions, oldest first, optionally narrowed to one project and one
    /// status. Four query shapes rather than a string built from the
    /// arguments, exactly as [`Store::list_learnings`] does it.
    pub async fn list_questions(
        &self,
        project_id: Option<&str>,
        status: Option<&str>,
    ) -> Result<Vec<Question>, String> {
        match (project_id, status) {
            (Some(project_id), Some(status)) => {
                sqlx::query_as::<_, Question>(&format!(
                    "SELECT {QUESTION_COLUMNS} FROM questions WHERE project_id = ?1 AND status = ?2
                 ORDER BY created_at, id"
                ))
                .bind(project_id)
                .bind(status)
                .fetch_all(&self.pool)
                .await
            }
            (Some(project_id), None) => {
                sqlx::query_as::<_, Question>(&format!(
                    "SELECT {QUESTION_COLUMNS} FROM questions WHERE project_id = ?1
                 ORDER BY created_at, id"
                ))
                .bind(project_id)
                .fetch_all(&self.pool)
                .await
            }
            (None, Some(status)) => {
                sqlx::query_as::<_, Question>(&format!(
                    "SELECT {QUESTION_COLUMNS} FROM questions WHERE status = ?1
                 ORDER BY created_at, id"
                ))
                .bind(status)
                .fetch_all(&self.pool)
                .await
            }
            (None, None) => {
                sqlx::query_as::<_, Question>(&format!(
                    "SELECT {QUESTION_COLUMNS} FROM questions ORDER BY created_at, id"
                ))
                .fetch_all(&self.pool)
                .await
            }
        }
        .map_err(|e| format!("failed to list questions: {e}"))
    }

    /// How many questions this worker still has waiting for an answer.
    ///
    /// The whole budget rule reads this one number, so it is counted in SQLite
    /// rather than by fetching rows nobody looks at.
    pub async fn count_open_questions(&self, worker_id: &str) -> Result<i64, String> {
        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM questions WHERE worker_id = ?1 AND status = ?2")
                .bind(worker_id)
                .bind(QUESTION_OPEN)
                .fetch_one(&self.pool)
                .await
                .map_err(|e| format!("failed to count open questions: {e}"))?;
        Ok(count)
    }

    /// Every question that is still open and whose deadline has passed.
    pub async fn list_expired_questions(&self, now: i64) -> Result<Vec<Question>, String> {
        sqlx::query_as::<_, Question>(&format!(
            "SELECT {QUESTION_COLUMNS} FROM questions
             WHERE status = ?1 AND expires_at IS NOT NULL AND expires_at <= ?2
             ORDER BY created_at, id"
        ))
        .bind(QUESTION_OPEN)
        .bind(now)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("failed to list expired questions: {e}"))
    }

    /// Close an open question with an answer, and say whether this call is the
    /// one that closed it.
    ///
    /// A single conditional UPDATE, the same shape as claiming a queue entry
    /// and for the same reason: the human in the window, the CLI and the
    /// expiry sweep can all arrive at the same row, and only one of them may
    /// win. `false` means somebody else got there first - the row is answered,
    /// just not by this caller.
    pub async fn close_question(
        &self,
        id: &str,
        status: &str,
        answer: &str,
        answered_at: i64,
        answered_by: Option<&str>,
    ) -> Result<bool, String> {
        let result = sqlx::query(
            "UPDATE questions SET status = ?1, answer = ?2, answered_at = ?3, answered_by = ?4
             WHERE id = ?5 AND status = ?6",
        )
        .bind(status)
        .bind(answer)
        .bind(answered_at)
        .bind(answered_by)
        .bind(id)
        .bind(QUESTION_OPEN)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to answer question: {e}"))?;
        Ok(result.rows_affected() > 0)
    }
}

/// Writes with a timestamp of the caller's choosing, and one schema edit.
///
/// The ordinary writers stamp [`now_unix_secs`], which is exactly right in
/// production and useless in a test that has to assert "three days ago". These
/// exist so [`crate::stats`] can build a fixture whose windows are known, and
/// they are `cfg(test)` so nothing else can reach for them.
#[cfg(test)]
impl Store {
    /// The pool itself, for tests that must control connection checkout.
    pub(crate) fn pool_for_test(&self) -> &SqlitePool {
        &self.pool
    }

    pub(crate) async fn insert_message_at(
        &self,
        worker_id: &str,
        id: &str,
        role: &str,
        created_at: i64,
    ) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO messages (id, worker_id, role, content, created_at)
             VALUES (?1, ?2, ?3, 'test', ?4)",
        )
        .bind(id)
        .bind(worker_id)
        .bind(role)
        .bind(created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to insert message: {e}"))?;
        Ok(())
    }

    pub(crate) async fn insert_status_event_at(
        &self,
        worker_id: &str,
        id: &str,
        created_at: i64,
    ) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO status_events (id, worker_id, kind, detail, source, created_at)
             VALUES (?1, ?2, 'column', 'working', 'app', ?3)",
        )
        .bind(id)
        .bind(worker_id)
        .bind(created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to insert status event: {e}"))?;
        Ok(())
    }

    pub(crate) async fn insert_session_at(
        &self,
        worker_id: &str,
        id: &str,
        started_at: i64,
        ended_at: Option<i64>,
        exit_code: Option<i64>,
    ) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO sessions (id, worker_id, started_at, ended_at, exit_code)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(id)
        .bind(worker_id)
        .bind(started_at)
        .bind(ended_at)
        .bind(exit_code)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("failed to insert session: {e}"))?;
        Ok(())
    }

    /// Takes a table back out of the schema, which is the only way to produce
    /// the "database from before this table shipped" case that
    /// [`Store::table_exists`] exists for.
    pub(crate) async fn drop_table(&self, name: &str) -> Result<(), String> {
        sqlx::query(&format!("DROP TABLE IF EXISTS {name}"))
            .execute(&self.pool)
            .await
            .map_err(|e| format!("failed to drop {name}: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::testutil::TempDir;
    use std::path::Path;

    async fn store() -> (TempDir, Store) {
        let dir = TempDir::new("store");
        let store = Store::open(&dir.path().join("projecta.db"))
            .await
            .expect("open store");
        (dir, store)
    }

    // -- schema versioning & the migration contract (Phase A) ---------------

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_fresh_database_is_created_at_the_current_schema_version() {
        let dir = TempDir::new("store-fresh-version");
        let store = Store::open(&dir.path().join("projecta.db"))
            .await
            .expect("open store");
        assert_eq!(store.user_version().await.unwrap(), target_schema_version());
        // The baseline really ran, and the database is usable.
        assert!(store.table_exists("projects").await.unwrap());
        assert!(store.table_exists("questions").await.unwrap());
        store.create_project("one", "C:/repos/one").await.unwrap();
        assert_eq!(store.list_projects().await.unwrap().len(), 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_pre_contract_database_is_adopted_without_a_schema_re_run() {
        let dir = TempDir::new("store-adopt-pre-contract");
        let path = dir.path().join("projecta.db");
        {
            // What every database in the field looks like: tables written by
            // `CREATE TABLE IF NOT EXISTS` runs and no `user_version`. The
            // stub deliberately lacks every column the baseline would add, so
            // a re-run would be visible. `workers` is there too - a field
            // database has one - so the numbered steps have their table.
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(
                    SqliteConnectOptions::new()
                        .filename(&path)
                        .create_if_missing(true),
                )
                .await
                .expect("connect stub");
            sqlx::query("CREATE TABLE projects (id TEXT PRIMARY KEY, payload TEXT)")
                .execute(&pool)
                .await
                .expect("create stub table");
            sqlx::query("CREATE TABLE workers (id TEXT PRIMARY KEY, payload TEXT)")
                .execute(&pool)
                .await
                .expect("create stub workers table");
            sqlx::query("INSERT INTO projects (id, payload) VALUES ('pj-1', 'keep me')")
                .execute(&pool)
                .await
                .expect("insert stub row");
            pool.close().await;
        }

        let store = Store::open(&path).await.expect("open store");
        assert_eq!(store.user_version().await.unwrap(), target_schema_version());

        // Adopted, not rebuilt: the version moved and the row stayed, but the
        // baseline did NOT run - the stub table is exactly as it was.
        let columns: Vec<(i64, String)> = sqlx::query_as("PRAGMA table_info(projects)")
            .fetch_all(&store.pool)
            .await
            .unwrap();
        assert_eq!(
            columns
                .iter()
                .map(|(_, name)| name.as_str())
                .collect::<Vec<_>>(),
            vec!["id", "payload"],
            "adoption must not re-run the baseline"
        );
        // ... while the numbered steps after the baseline did run, on their
        // own table: the stub's `workers` grew exactly the migrated column.
        let columns: Vec<(i64, String)> = sqlx::query_as("PRAGMA table_info(workers)")
            .fetch_all(&store.pool)
            .await
            .unwrap();
        assert_eq!(
            columns
                .iter()
                .map(|(_, name)| name.as_str())
                .collect::<Vec<_>>(),
            vec!["id", "payload", "merge_state"],
            "the pending migration steps must run on an adopted database"
        );
        let (payload,): (String,) =
            sqlx::query_as("SELECT payload FROM projects WHERE id = 'pj-1'")
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(payload, "keep me");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn reopening_a_migrated_database_changes_nothing() {
        let dir = TempDir::new("store-reopen-idempotent");
        let path = dir.path().join("projecta.db");
        let backup_count = || {
            std::fs::read_dir(dir.path())
                .unwrap()
                .filter_map(|entry| entry.ok())
                .filter(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .contains(".pre-migration-")
                })
                .count()
        };
        let backups_after_first_open;
        {
            let store = Store::open(&path).await.expect("open store");
            store.create_project("one", "C:/repos/one").await.unwrap();
            assert_eq!(store.user_version().await.unwrap(), target_schema_version());
            // The first open may migrate and back up; that is its job.
            backups_after_first_open = backup_count();
        }

        let store = Store::open(&path).await.expect("reopen store");
        assert_eq!(store.user_version().await.unwrap(), target_schema_version());
        assert_eq!(store.list_projects().await.unwrap().len(), 1);
        // Nothing migrated on the second open, so nothing was backed up either.
        assert_eq!(backup_count(), backups_after_first_open);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_database_from_a_newer_build_is_refused() {
        let dir = TempDir::new("store-too-new");
        let path = dir.path().join("projecta.db");
        {
            let store = Store::open(&path).await.expect("open store");
            sqlx::query(&format!(
                "PRAGMA user_version = {}",
                target_schema_version() + 1
            ))
            .execute(&store.pool)
            .await
            .expect("bump version");
        }

        let err = match Store::open(&path).await {
            Ok(_) => panic!("a newer database must be refused"),
            Err(err) => err,
        };
        assert!(err.contains("newer than this build"), "{err}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn backup_includes_committed_wal_while_an_old_reader_prevents_checkpoint() {
        let dir = TempDir::new("store-backup-wal-contention");
        let path = dir.path().join("projecta.db");
        let store = Store::open(&path).await.unwrap();
        store.create_project("before", "C:/before").await.unwrap();
        let mut reader = store.pool.begin().await.unwrap();
        let _: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM projects")
            .fetch_one(&mut *reader)
            .await
            .unwrap();
        store.create_project("after", "C:/after").await.unwrap();
        let (_, frames, checkpointed): (i64, i64, i64) =
            sqlx::query_as("PRAGMA wal_checkpoint(PASSIVE)")
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert!(
            frames > checkpointed,
            "the reader must pin committed WAL frames"
        );
        let backup = store.backup_database_at(&path, 42).await.unwrap();
        let copy = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&backup)
                    .read_only(true),
            )
            .await
            .unwrap();
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM projects")
            .fetch_one(&copy)
            .await
            .unwrap();
        assert_eq!(count, 2, "backup must include the commit still in WAL");
        copy.close().await;
        reader.rollback().await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn pre_migration_backups_are_complete_copies_and_kept_to_five() {
        let dir = TempDir::new("store-backup-prune");
        let path = dir.path().join("projecta.db");
        let store = Store::open(&path).await.expect("open store");
        let project = store.create_project("one", "C:/repos/one").await.unwrap();

        for ts in 1..=7u128 {
            store.backup_database_at(&path, ts).await.expect("backup");
        }

        let mut names: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains(".pre-migration-"))
            .collect();
        names.sort();
        assert_eq!(names.len(), 5, "only the five newest survive: {names:?}");
        assert!(names[0].ends_with("-3.bak"), "{names:?}");
        assert!(names[4].ends_with("-7.bak"), "{names:?}");

        // Restore probe: copy the newest bak onto a fresh dest with the same
        // file name in another directory. Opening the bak path itself would
        // migrate it in place (F0-7).
        let bak = dir.path().join(&names[4]);
        let bak_before = std::fs::read(&bak).expect("bak before restore");
        let restored_dir = dir.path().join("restored");
        std::fs::create_dir_all(&restored_dir).unwrap();
        let restored = restored_dir.join("projecta.db");
        Store::restore_from_pre_migration_backup(&bak, &restored).expect("restore bak");
        let copy = Store::open(&restored).await.expect("open restored copy");
        let projects = copy.list_projects().await.unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].id, project.id);
        assert_eq!(std::fs::read(&bak).expect("bak still readable"), bak_before);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn restore_leaves_bak_bytes_unchanged() {
        let dir = TempDir::new("store-restore-bak");
        let live = dir.path().join("projecta.db");
        crate::testutil::copy_db_fixture(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("testdata/db/v1.1.1-projecta.db")
                .as_path(),
            &live,
        );
        let bak_hash_before;
        let bak_path;
        {
            let _store = Store::open(&live).await.expect("migrate fixture");
            let backups = Store::list_pre_migration_backups(&live).expect("list");
            assert_eq!(backups.len(), 1, "{backups:?}");
            bak_path = backups[0].clone();
            bak_hash_before = std::fs::read(&bak_path).expect("read bak");
        }
        let dest_dir = dir.path().join("recovered");
        std::fs::create_dir_all(&dest_dir).unwrap();
        let dest = dest_dir.join("projecta.db");
        Store::restore_from_pre_migration_backup(&bak_path, &dest).expect("restore");
        let bak_hash_after = std::fs::read(&bak_path).expect("read bak after");
        assert_eq!(bak_hash_before, bak_hash_after);
        assert_eq!(std::fs::read(&dest).expect("dest"), bak_hash_before);

        let extras: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains(".bak.pre-migration-"))
            .collect();
        assert!(extras.is_empty(), "bak was migrated in place: {extras:?}");

        let recovered = Store::open(&dest).await.expect("open recovered");
        assert_eq!(
            recovered.user_version().await.unwrap(),
            target_schema_version()
        );
        assert_eq!(
            std::fs::read(&bak_path).expect("bak after open dest"),
            bak_hash_before
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_version_bump_inside_a_transaction_rolls_back_with_it() {
        let (_dir, store) = store().await;
        let before = store.user_version().await.unwrap();

        let mut tx = store.pool.begin().await.expect("begin");
        sqlx::query("CREATE TABLE rollback_probe (id INTEGER)")
            .execute(&mut *tx)
            .await
            .expect("create probe table");
        sqlx::query(&format!("PRAGMA user_version = {}", before + 10))
            .execute(&mut *tx)
            .await
            .expect("bump version");
        tx.rollback().await.expect("rollback");

        // The property every migration step relies on: if a step fails, its
        // schema change and its version bump vanish together, and the next
        // start re-enters from the last good version.
        assert_eq!(store.user_version().await.unwrap(), before);
        assert!(!store.table_exists("rollback_probe").await.unwrap());
    }

    // -- F0-Abnahme: three generation fixtures (`.pa/task_f0_db_fixtures.md`)

    const GENERATION_TABLES: [&str; 10] = [
        "projects",
        "workers",
        "task_queue",
        "sessions",
        "questions",
        "messages",
        "usage_events",
        "recommendations",
        "diff_comments",
        "status_events",
    ];

    /// Umlaute, Em-Dash and newlines — the deprecation path in F0 §4 hangs
    /// on these surviving a migration byte-for-byte.
    const GENERATION_LANDING_PAGE: &str =
        "# Übersicht — nächster Schritt\n\nÄgypten, Österreich und eine Straße.\n";

    fn generation_fixture_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("testdata")
            .join("db")
    }

    fn generation_fixture_path(tag: &str) -> PathBuf {
        generation_fixture_dir().join(format!("{tag}-projecta.db"))
    }

    fn generation_sidecar_path(tag: &str) -> PathBuf {
        generation_fixture_dir().join(format!("{tag}-projecta.json"))
    }

    fn load_generation_sidecar(tag: &str) -> serde_json::Value {
        let path = generation_sidecar_path(tag);
        let text = std::fs::read_to_string(&path).unwrap_or_else(|err| {
            panic!(
                "missing generation sidecar {}: {err} — run \
                 `cargo test generate_three_generation_fixtures -- --ignored`",
                path.display()
            )
        });
        serde_json::from_str(&text).expect("sidecar is JSON")
    }

    async fn table_count(store: &Store, table: &str) -> i64 {
        let (count,): (i64,) = sqlx::query_as(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(&store.pool)
            .await
            .unwrap_or_else(|err| panic!("count {table}: {err}"));
        count
    }

    fn pre_migration_backup_count(dir: &Path) -> usize {
        std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".pre-migration-")
            })
            .count()
    }

    async fn seed_generation_inventory(store: &Store) -> serde_json::Value {
        let alpha = store
            .create_project("Alpha", "C:/fixtures/alpha")
            .await
            .unwrap();
        let beta = store
            .create_project("Beta", "C:/fixtures/beta")
            .await
            .unwrap();
        store
            .set_landing_page(&alpha.id, Some(GENERATION_LANDING_PAGE))
            .await
            .unwrap();
        store
            .set_project_test_command(&alpha.id, Some("cargo test --quiet"))
            .await
            .unwrap();

        let worker_pr = WorkerRow {
            id: "wk-pr".to_string(),
            project_id: alpha.id.clone(),
            task: "Öffne den Pull Request".to_string(),
            profile_id: "claude".to_string(),
            branch: "pa/wk-pr".to_string(),
            worktree_path: "C:/fixtures/alpha/.projecta-worktrees/wk-pr".to_string(),
            status: STATUS_EXITED.to_string(),
            kind: KIND_WORKER.to_string(),
            pr_url: Some("https://github.com/example/alpha/pull/7".to_string()),
            spawned_by: None,
            test_status: None,
            tested_at: None,
            role_variant_id: None,
            paused_reason: None,
            created_at: 1_704_067_200,
        };
        let worker_tested = WorkerRow {
            id: "wk-tested".to_string(),
            project_id: alpha.id.clone(),
            task: "Tests grün halten".to_string(),
            profile_id: "codex".to_string(),
            branch: "pa/wk-tested".to_string(),
            worktree_path: "C:/fixtures/alpha/.projecta-worktrees/wk-tested".to_string(),
            status: STATUS_ARCHIVED.to_string(),
            kind: KIND_WORKER.to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: Some(TEST_PASS.to_string()),
            tested_at: Some(1_704_067_260),
            role_variant_id: None,
            paused_reason: None,
            created_at: 1_704_067_210,
        };
        let worker_paused = WorkerRow {
            id: "wk-paused".to_string(),
            project_id: beta.id.clone(),
            task: "Warten auf Kontingent".to_string(),
            profile_id: "claude".to_string(),
            branch: "pa/wk-paused".to_string(),
            worktree_path: "C:/fixtures/beta/.projecta-worktrees/wk-paused".to_string(),
            status: STATUS_RUNNING.to_string(),
            kind: KIND_WORKER.to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: None,
            tested_at: None,
            role_variant_id: None,
            paused_reason: Some("budget_reached".to_string()),
            created_at: 1_704_067_220,
        };
        store.insert_worker(&worker_pr).await.unwrap();
        store.insert_worker(&worker_tested).await.unwrap();
        store.insert_worker(&worker_paused).await.unwrap();

        store
            .insert_queue_entry(&QueueEntry {
                id: "tq-one".to_string(),
                project_id: alpha.id.clone(),
                raw_text: "Erste Queue-Aufgabe".to_string(),
                sharpened_text: Some("Erste geschärfte Aufgabe".to_string()),
                profile_id: "claude".to_string(),
                status: "queued".to_string(),
                priority: 0,
                worker_id: None,
                error: None,
                spawned_by: None,
                created_at: 1_704_067_230,
            })
            .await
            .unwrap();
        store
            .insert_queue_entry(&QueueEntry {
                id: "tq-two".to_string(),
                project_id: beta.id.clone(),
                raw_text: "Zweite Queue-Aufgabe".to_string(),
                sharpened_text: None,
                profile_id: "codex".to_string(),
                status: "queued".to_string(),
                priority: 1,
                worker_id: None,
                error: None,
                spawned_by: None,
                created_at: 1_704_067_240,
            })
            .await
            .unwrap();

        store.bind_session("wk-pr", "sess-one").await;

        store
            .insert_question(&Question {
                id: "q-one".to_string(),
                project_id: alpha.id.clone(),
                worker_id: Some("wk-pr".to_string()),
                scope: QUESTION_WORKER.to_string(),
                question: "Welche Farbe?".to_string(),
                options_json: Some(r#"["rot","blau"]"#.to_string()),
                status: QUESTION_OPEN.to_string(),
                answer: None,
                created_at: 1_704_067_250,
                answered_at: None,
                answered_by: None,
                expires_at: None,
            })
            .await
            .unwrap();

        store
            .insert_recommendation(&Recommendation {
                id: "rec-one".to_string(),
                project_id: alpha.id.clone(),
                title: "README kürzen".to_string(),
                url: Some("https://example.org/readme".to_string()),
                rationale: "Zu lang — der Einstieg verschwindet.".to_string(),
                effort: Some("S".to_string()),
                status: REC_NEW.to_string(),
                created_at: 1_704_067_270,
            })
            .await
            .unwrap();

        let mut counts = serde_json::Map::new();
        for table in GENERATION_TABLES {
            counts.insert(
                table.to_string(),
                serde_json::json!(table_count(store, table).await),
            );
        }

        let row = store.get_worker_row("wk-pr").await.unwrap().unwrap();
        serde_json::json!({
            "counts": counts,
            "landing_page_project_id": alpha.id,
            "landing_page_markdown": GENERATION_LANDING_PAGE,
            "worker": {
                "id": row.id,
                "project_id": row.project_id,
                "task": row.task,
                "profile_id": row.profile_id,
                "branch": row.branch,
                "worktree_path": row.worktree_path,
                "status": row.status,
                "kind": row.kind,
                "pr_url": row.pr_url,
                "spawned_by": row.spawned_by,
                "test_status": row.test_status,
                "tested_at": row.tested_at,
                "role_variant_id": row.role_variant_id,
                "paused_reason": row.paused_reason,
                "created_at": row.created_at,
            }
        })
    }

    async fn checkpoint_and_close(store: Store, path: &Path) {
        sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&store.pool)
            .await
            .expect("checkpoint");
        store.pool.close().await;
        let _ = path;
    }

    /// Stamp a copy as an older generation without going through
    /// [`Store::open`] — that would migrate it.
    async fn stamp_as_older_generation(path: &Path, user_version: i64) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::new().filename(path))
            .await
            .expect("connect fixture copy");
        let columns: Vec<(i64, String)> = sqlx::query_as("PRAGMA table_info(workers)")
            .fetch_all(&pool)
            .await
            .expect("table_info");
        if columns.iter().any(|(_, name)| name == "merge_state") {
            sqlx::query("ALTER TABLE workers DROP COLUMN merge_state")
                .execute(&pool)
                .await
                .expect("drop merge_state so the fixture predates step 2");
        }
        sqlx::query(&format!("PRAGMA user_version = {user_version}"))
            .execute(&pool)
            .await
            .expect("stamp user_version");
        sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&pool)
            .await
            .expect("checkpoint stamped fixture");
        pool.close().await;
    }

    fn write_generation_sidecar(
        tag: &str,
        user_version_on_disk: i64,
        expect_backup: bool,
        inventory: &serde_json::Value,
    ) {
        let mut sidecar = inventory.clone();
        sidecar["tag"] = serde_json::json!(tag);
        sidecar["user_version_on_disk"] = serde_json::json!(user_version_on_disk);
        sidecar["expect_backup"] = serde_json::json!(expect_backup);
        std::fs::create_dir_all(generation_fixture_dir()).expect("testdata/db");
        std::fs::write(
            generation_sidecar_path(tag),
            serde_json::to_string_pretty(&sidecar).expect("sidecar json") + "\n",
        )
        .expect("write sidecar");
    }

    /// Run on a checkout of the named tag (or on current, then stamp older
    /// copies). Writes `src-tauri/testdata/db/<tag>-projecta.db` plus sidecar.
    ///
    /// ```text
    /// cargo test generate_three_generation_fixtures -- --ignored --nocapture
    /// ```
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "writes testdata/db fixtures; run by hand when regenerating"]
    async fn generate_three_generation_fixtures() {
        let dir = TempDir::new("store-generation-seed");
        let path = dir.path().join("projecta.db");
        let store = Store::open(&path).await.expect("open seed store");
        let inventory = seed_generation_inventory(&store).await;
        checkpoint_and_close(store, &path).await;

        std::fs::create_dir_all(generation_fixture_dir()).expect("testdata/db");
        std::fs::copy(&path, generation_fixture_path("v1.2.4")).expect("copy v1.2.4");
        write_generation_sidecar("v1.2.4", 2, false, &inventory);

        for (tag, version, expect_backup) in [("v1.1.1", 1_i64, true), ("v1.0.0", 0, true)] {
            let dest = generation_fixture_path(tag);
            std::fs::copy(&path, &dest).expect("copy older generation");
            stamp_as_older_generation(&dest, version).await;
            write_generation_sidecar(tag, version, expect_backup, &inventory);
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn three_generation_fixtures_open_without_data_loss() {
        for tag in ["v1.0.0", "v1.1.1", "v1.2.4"] {
            let sidecar = load_generation_sidecar(tag);
            let source = generation_fixture_path(tag);
            assert!(
                source.is_file(),
                "missing fixture {} — run `cargo test generate_three_generation_fixtures -- --ignored`",
                source.display()
            );

            let dir = TempDir::new(&format!("store-generation-{tag}"));
            let path = dir.path().join("projecta.db");
            crate::testutil::copy_db_fixture(&source, &path);

            let on_disk: i64 = sidecar["user_version_on_disk"].as_i64().unwrap();
            let before_open = {
                let pool = SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect_with(SqliteConnectOptions::new().filename(&path))
                    .await
                    .expect("peek fixture");
                let (version,): (i64,) = sqlx::query_as("PRAGMA user_version")
                    .fetch_one(&pool)
                    .await
                    .expect("read on-disk version");
                pool.close().await;
                version
            };
            assert_eq!(before_open, on_disk, "{tag}: fixture user_version");

            let store = Store::open(&path).await.expect("open generation fixture");
            assert_eq!(
                store.user_version().await.unwrap(),
                target_schema_version(),
                "{tag}: migrated to target"
            );

            for table in GENERATION_TABLES {
                let expected = sidecar["counts"][table].as_i64().unwrap();
                assert_eq!(
                    table_count(&store, table).await,
                    expected,
                    "{tag}: {table} row count"
                );
            }

            let landing_id = sidecar["landing_page_project_id"].as_str().unwrap();
            assert_eq!(
                store.get_landing_page(landing_id).await.unwrap().as_deref(),
                Some(sidecar["landing_page_markdown"].as_str().unwrap()),
                "{tag}: landing_page_markdown"
            );

            let expected = &sidecar["worker"];
            let row = store
                .get_worker_row(expected["id"].as_str().unwrap())
                .await
                .unwrap()
                .expect("canonical worker");
            assert_eq!(row.project_id, expected["project_id"].as_str().unwrap());
            assert_eq!(row.task, expected["task"].as_str().unwrap());
            assert_eq!(row.profile_id, expected["profile_id"].as_str().unwrap());
            assert_eq!(row.branch, expected["branch"].as_str().unwrap());
            assert_eq!(
                row.worktree_path,
                expected["worktree_path"].as_str().unwrap()
            );
            assert_eq!(row.status, expected["status"].as_str().unwrap());
            assert_eq!(row.kind, expected["kind"].as_str().unwrap());
            assert_eq!(row.pr_url.as_deref(), expected["pr_url"].as_str());
            assert_eq!(
                row.paused_reason.as_deref(),
                expected["paused_reason"].as_str()
            );
            assert_eq!(row.created_at, expected["created_at"].as_i64().unwrap());

            let columns: Vec<(i64, String, String, i64, Option<String>, i64)> =
                sqlx::query_as("PRAGMA table_info(workers)")
                    .fetch_all(&store.pool)
                    .await
                    .unwrap();
            assert!(
                columns
                    .iter()
                    .any(|(_, name, _, _, _, _)| name == "merge_state"),
                "{tag}: merge_state column present after open"
            );
            assert_eq!(
                store.merge_state_for_worker(&row.id).await.unwrap(),
                None,
                "{tag}: merge_state stays NULL"
            );

            let (integrity,): (String,) = sqlx::query_as("PRAGMA integrity_check")
                .fetch_one(&store.pool)
                .await
                .unwrap();
            assert_eq!(integrity, "ok", "{tag}: integrity_check");

            let expect_backup = sidecar["expect_backup"].as_bool().unwrap();
            let backups = pre_migration_backup_count(dir.path());
            if expect_backup {
                assert_eq!(backups, 1, "{tag}: exactly one pre-migration backup");
                let bak = std::fs::read_dir(dir.path())
                    .unwrap()
                    .filter_map(|entry| entry.ok())
                    .map(|entry| entry.path())
                    .find(|path| {
                        path.file_name()
                            .is_some_and(|name| name.to_string_lossy().contains(".pre-migration-"))
                    })
                    .expect("backup path");
                // Open the copy in a fresh directory: Store::open would
                // otherwise migrate the .bak in place and write another
                // pre-migration file next to the fixture under test.
                let bak_dir = TempDir::new(&format!("store-generation-{tag}-bak"));
                let bak_copy = bak_dir.path().join("projecta.db");
                crate::testutil::copy_db_fixture(&bak, &bak_copy);
                let bak_store = Store::open(&bak_copy).await.expect("open backup");
                for table in GENERATION_TABLES {
                    assert_eq!(
                        table_count(&bak_store, table).await,
                        sidecar["counts"][table].as_i64().unwrap(),
                        "{tag}: backup {table}"
                    );
                }
            } else {
                assert_eq!(backups, 0, "{tag}: 2→2 takes the early exit, no backup");
            }

            let backups_after_first = backups;
            drop(store);
            let store = Store::open(&path).await.expect("reopen fixture");
            assert_eq!(store.user_version().await.unwrap(), target_schema_version());
            assert_eq!(
                pre_migration_backup_count(dir.path()),
                backups_after_first,
                "{tag}: second open is a no-op"
            );
            for table in GENERATION_TABLES {
                assert_eq!(
                    table_count(&store, table).await,
                    sidecar["counts"][table].as_i64().unwrap(),
                    "{tag}: idempotent {table}"
                );
            }
        }
    }

    /// Manual migration probe against a copy of the real database
    /// (docs/archive/plaene-2026-09/SANIERUNGSPLAN.md §2.2.4): copies the file named in
    /// `PA_PROD_DB_COPY` (plus its WAL files, if present) into a temp dir and
    /// runs the full migration contract on that copy. The env path is only
    /// ever *read* - never opened by SQLite. Run with:
    /// `PA_PROD_DB_COPY=<path> cargo test production_database -- --ignored --nocapture`
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "needs PA_PROD_DB_COPY pointing at a copy of the real projecta.db"]
    async fn a_copy_of_the_production_database_migrates_cleanly() {
        let source = std::env::var("PA_PROD_DB_COPY")
            .expect("PA_PROD_DB_COPY must name a copy of the real projecta.db");
        let dir = TempDir::new("store-prod-copy");
        let path = dir.path().join("projecta.db");
        std::fs::copy(&source, &path).expect("copy the database");
        for suffix in ["-wal", "-shm"] {
            if Path::new(&format!("{source}{suffix}")).is_file() {
                std::fs::copy(
                    format!("{source}{suffix}"),
                    dir.path().join(format!("projecta.db{suffix}")),
                )
                .expect("copy the WAL sidecar");
            }
        }

        let before: (i64,) = {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(SqliteConnectOptions::new().filename(&path))
                .await
                .expect("connect copy");
            let version = sqlx::query_as("PRAGMA user_version")
                .fetch_one(&pool)
                .await
                .expect("read version");
            pool.close().await;
            version
        };

        let store = Store::open(&path).await.expect("open production copy");
        let after = store.user_version().await.unwrap();
        assert_eq!(after, target_schema_version());
        for table in [
            "projects",
            "workers",
            "task_queue",
            "usage_events",
            "sessions",
            "questions",
        ] {
            assert!(store.table_exists(table).await.unwrap(), "{table} missing");
        }
        let projects = store.list_projects().await.unwrap().len();
        let workers = store.list_workers(None).await.unwrap().len();
        eprintln!(
            "production copy: user_version {} -> {after}, {projects} projects, {workers} workers",
            before.0
        );
        assert!(projects > 0, "the real database has projects");
    }

    fn worker_row(project_id: &str, id: &str) -> WorkerRow {
        WorkerRow {
            id: id.to_string(),
            project_id: project_id.to_string(),
            task: "do the thing".to_string(),
            profile_id: "claude".to_string(),
            branch: format!("pa/{id}"),
            worktree_path: format!("C:/tmp/.projecta-worktrees/{id}"),
            status: STATUS_RUNNING.to_string(),
            kind: KIND_WORKER.to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: None,
            tested_at: None,
            role_variant_id: None,
            paused_reason: None,
            created_at: 42,
        }
    }

    /// Phase 16: `workers.role_variant_id` round-trips both ways. (It used to
    /// also prove repair-on-open for pre-Phase-16 databases; that behavior
    /// ended with the migration contract - adoption is covered above.)
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_role_variant_column_round_trips() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();

        store
            .insert_worker(&WorkerRow {
                role_variant_id: Some("rv-1".to_string()),
                ..worker_row(&project.id, "wk-1")
            })
            .await
            .unwrap();
        store
            .insert_worker(&worker_row(&project.id, "wk-2"))
            .await
            .unwrap();

        let with = store.get_worker_row("wk-1").await.unwrap().unwrap();
        assert_eq!(with.role_variant_id.as_deref(), Some("rv-1"));
        let without = store.get_worker_row("wk-2").await.unwrap().unwrap();
        assert_eq!(without.role_variant_id, None);
        assert!(store.get_worker_row("wk-nope").await.unwrap().is_none());

        // The board rows still come back whole; the column is simply not part
        // of what a `Worker` shows.
        assert_eq!(
            store.list_workers(Some(&project.id)).await.unwrap().len(),
            2
        );
    }

    /// All four shapes a repository can have, because the pair of manifests is
    /// exactly what the detection decides on.
    #[test]
    fn the_test_command_follows_the_manifests_in_the_repository() {
        let dir = TempDir::new("store-detect-test-command");
        let empty = dir.path().join("empty");
        let node = dir.path().join("node");
        let rust = dir.path().join("rust");
        let both = dir.path().join("both");
        for path in [&empty, &node, &rust, &both] {
            std::fs::create_dir_all(path).expect("create repo dir");
        }
        for path in [&node, &both] {
            std::fs::write(path.join("package.json"), "{}").expect("write package.json");
        }
        for path in [&rust, &both] {
            std::fs::write(path.join("Cargo.toml"), "[package]").expect("write Cargo.toml");
        }

        assert_eq!(detect_test_command(&empty), None);
        assert_eq!(detect_test_command(&node).as_deref(), Some("npm test"));
        assert_eq!(
            detect_test_command(&rust).as_deref(),
            Some("cargo test --quiet")
        );
        assert_eq!(
            detect_test_command(&both).as_deref(),
            Some("npm test && cargo test --quiet")
        );
    }

    /// Phase 12: the test-gate columns (`projects.test_command`,
    /// `workers.test_status`, `workers.tested_at`) and the queue's own
    /// `spawned_by` round-trip. (Repair-on-open for pre-Phase-12 databases
    /// ended with the migration contract.)
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_test_gate_columns_round_trip() {
        let (_dir, store) = store().await;
        // A repository path that does not exist carries no manifest, so a
        // project registered against it gets no gate.
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        assert_eq!(project.test_command, None);

        store
            .set_project_test_command(&project.id, Some("npm test"))
            .await
            .unwrap();
        assert_eq!(
            store
                .get_project(&project.id)
                .await
                .unwrap()
                .unwrap()
                .test_command
                .as_deref(),
            Some("npm test")
        );
        assert_eq!(
            store.list_projects().await.unwrap()[0]
                .test_command
                .as_deref(),
            Some("npm test")
        );
        store
            .set_project_test_command(&project.id, None)
            .await
            .unwrap();
        assert_eq!(
            store
                .get_project(&project.id)
                .await
                .unwrap()
                .unwrap()
                .test_command,
            None
        );
        assert!(store
            .set_project_test_command("pj-nope", Some("npm test"))
            .await
            .is_err());

        store
            .insert_worker(&worker_row(&project.id, "wk-1"))
            .await
            .unwrap();
        let fresh = store.get_worker("wk-1").await.unwrap().unwrap();
        assert_eq!(fresh.test_status, None);
        assert_eq!(fresh.tested_at, None);

        store
            .set_worker_test_status("wk-1", Some(TEST_RUNNING), None)
            .await
            .unwrap();
        let running = store.get_worker("wk-1").await.unwrap().unwrap();
        assert_eq!(running.test_status.as_deref(), Some(TEST_RUNNING));
        assert_eq!(running.tested_at, None);

        store
            .set_worker_test_status("wk-1", Some(TEST_PASS), Some(1_700_000_000))
            .await
            .unwrap();
        let passed = store
            .list_workers(Some(&project.id))
            .await
            .unwrap()
            .remove(0);
        assert_eq!(passed.test_status.as_deref(), Some(TEST_PASS));
        assert_eq!(passed.tested_at, Some(1_700_000_000));
        assert!(store
            .set_worker_test_status("wk-nope", Some(TEST_FAIL), None)
            .await
            .is_err());

        let entry = QueueEntry {
            id: "tq-1".to_string(),
            project_id: project.id.clone(),
            raw_text: "do it".to_string(),
            sharpened_text: None,
            profile_id: "claude".to_string(),
            status: QUEUE_READY.to_string(),
            priority: 0,
            worker_id: None,
            error: None,
            spawned_by: Some("wk-queen".to_string()),
            created_at: 42,
        };
        store.insert_queue_entry(&entry).await.unwrap();
        assert_eq!(
            store.list_queue(Some(&project.id)).await.unwrap()[0]
                .spawned_by
                .as_deref(),
            Some("wk-queen")
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn projects_round_trip() {
        let (_dir, store) = store().await;
        assert!(store.list_projects().await.unwrap().is_empty());

        let project = store
            .create_project("ProjectA", "C:/repos/a")
            .await
            .unwrap();
        assert_eq!(store.list_projects().await.unwrap(), vec![project.clone()]);
        assert_eq!(
            store.get_project(&project.id).await.unwrap(),
            Some(project.clone())
        );
        assert_eq!(store.get_project("nope").await.unwrap(), None);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn skill_packs_round_trip_and_default_to_all_when_unset() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        let unset = store.get_project_skill_packs(&project.id).await.unwrap();
        assert_eq!(unset, None);
        assert_eq!(
            crate::skills::resolve_enabled(
                &["taste-skill".to_string(), "minimalist-skill".to_string()],
                unset.as_deref(),
            ),
            vec!["taste-skill".to_string(), "minimalist-skill".to_string()]
        );

        let selected = vec!["taste-skill".to_string()];
        store
            .set_project_skill_packs(&project.id, &selected)
            .await
            .unwrap();
        assert_eq!(
            store.get_project_skill_packs(&project.id).await.unwrap(),
            Some(selected)
        );
        store
            .set_project_skill_packs(&project.id, &[])
            .await
            .unwrap();
        assert_eq!(
            store.get_project_skill_packs(&project.id).await.unwrap(),
            None
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn landing_pages_round_trip() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        assert_eq!(store.get_landing_page(&project.id).await.unwrap(), None);
        assert_eq!(
            store
                .get_project(&project.id)
                .await
                .unwrap()
                .unwrap()
                .landing_page_markdown,
            None
        );

        let markdown = "# One\n\nSome *content*.\n";
        store
            .set_landing_page(&project.id, Some(markdown))
            .await
            .unwrap();
        assert_eq!(
            store.get_landing_page(&project.id).await.unwrap(),
            Some(markdown.to_string())
        );
        assert_eq!(
            store
                .get_project(&project.id)
                .await
                .unwrap()
                .unwrap()
                .landing_page_markdown
                .as_deref(),
            Some(markdown)
        );

        store.set_landing_page(&project.id, None).await.unwrap();
        assert_eq!(store.get_landing_page(&project.id).await.unwrap(), None);

        for err in [
            store
                .get_landing_page("pj-nope")
                .await
                .expect_err("unknown project"),
            store
                .set_landing_page("pj-nope", Some("x"))
                .await
                .expect_err("unknown project"),
        ] {
            assert!(err.contains("unknown project"), "{err}");
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn workers_round_trip_and_filter_by_project() {
        let (_dir, store) = store().await;
        let one = store.create_project("one", "C:/repos/one").await.unwrap();
        let two = store.create_project("two", "C:/repos/two").await.unwrap();

        store
            .insert_worker(&worker_row(&one.id, "wk-1"))
            .await
            .unwrap();
        store
            .insert_worker(&worker_row(&one.id, "wk-2"))
            .await
            .unwrap();
        store
            .insert_worker(&worker_row(&two.id, "wk-3"))
            .await
            .unwrap();

        assert_eq!(store.list_workers(None).await.unwrap().len(), 3);
        let first = store.list_workers(Some(&one.id)).await.unwrap();
        assert_eq!(
            first.iter().map(|w| w.id.as_str()).collect::<Vec<_>>(),
            vec!["wk-1", "wk-2"]
        );
        assert!(first.iter().all(|w| w.session_id.is_none()));

        let worker = store.get_worker("wk-1").await.unwrap().unwrap();
        assert_eq!(worker.branch, "pa/wk-1");
        assert_eq!(worker.status, STATUS_RUNNING);

        store
            .set_worker_status("wk-1", STATUS_ARCHIVED)
            .await
            .unwrap();
        assert_eq!(
            store.get_worker("wk-1").await.unwrap().unwrap().status,
            STATUS_ARCHIVED
        );

        store.delete_worker("wk-1").await.unwrap();
        assert!(store.get_worker("wk-1").await.unwrap().is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn removing_a_project_archives_its_workers() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        store
            .insert_worker(&worker_row(&project.id, "wk-1"))
            .await
            .unwrap();

        store.remove_project(&project.id).await.unwrap();

        assert!(store.get_project(&project.id).await.unwrap().is_none());
        assert_eq!(
            store.get_worker("wk-1").await.unwrap().unwrap().status,
            STATUS_ARCHIVED
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn session_mapping_is_reported_on_workers() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        store
            .insert_worker(&worker_row(&project.id, "wk-1"))
            .await
            .unwrap();

        store.bind_session("wk-1", "pty-1").await;
        assert_eq!(
            store.get_worker("wk-1").await.unwrap().unwrap().session_id,
            Some("pty-1".to_string())
        );

        assert_eq!(store.take_session("wk-1"), Some("pty-1".to_string()));
        assert!(store
            .get_worker("wk-1")
            .await
            .unwrap()
            .unwrap()
            .session_id
            .is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_pull_request_url_round_trips_and_can_be_cleared() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        store
            .insert_worker(&worker_row(&project.id, "wk-1"))
            .await
            .unwrap();
        assert!(store
            .get_worker("wk-1")
            .await
            .unwrap()
            .unwrap()
            .pr_url
            .is_none());

        let url = "https://github.com/o/r/pull/7";
        store.set_worker_pr_url("wk-1", Some(url)).await.unwrap();
        assert_eq!(
            store
                .get_worker("wk-1")
                .await
                .unwrap()
                .unwrap()
                .pr_url
                .as_deref(),
            Some(url)
        );

        store.set_worker_pr_url("wk-1", None).await.unwrap();
        assert!(store
            .get_worker("wk-1")
            .await
            .unwrap()
            .unwrap()
            .pr_url
            .is_none());
    }

    /// Phase 9: the hierarchy bookkeeping (`workers.spawned_by`) and the
    /// per-project employee cap (`projects.max_workers`) round-trip.
    /// (Repair-on-open for pre-Phase-9 databases ended with the migration
    /// contract.)
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_hierarchy_columns_round_trip() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        assert_eq!(project.max_workers, None);

        // NULL means "started by the human or the UI".
        store
            .insert_worker(&worker_row(&project.id, "wk-1"))
            .await
            .unwrap();
        assert!(store
            .get_worker("wk-1")
            .await
            .unwrap()
            .unwrap()
            .spawned_by
            .is_none());

        let mut child = worker_row(&project.id, "wk-2");
        child.spawned_by = Some("wk-queen".to_string());
        store.insert_worker(&child).await.unwrap();
        let stored = store.get_worker("wk-2").await.unwrap().unwrap();
        assert_eq!(stored.spawned_by.as_deref(), Some("wk-queen"));
        assert_eq!(
            store
                .list_workers(Some(&project.id))
                .await
                .unwrap()
                .iter()
                .map(|w| w.spawned_by.as_deref())
                .collect::<Vec<_>>(),
            vec![None, Some("wk-queen")]
        );

        store
            .set_project_max_workers(&project.id, Some(2))
            .await
            .unwrap();
        assert_eq!(
            store
                .get_project(&project.id)
                .await
                .unwrap()
                .unwrap()
                .max_workers,
            Some(2)
        );
        store
            .set_project_max_workers(&project.id, None)
            .await
            .unwrap();
        assert_eq!(
            store
                .get_project(&project.id)
                .await
                .unwrap()
                .unwrap()
                .max_workers,
            None
        );
        let err = store
            .set_project_max_workers("pj-nope", Some(2))
            .await
            .expect_err("unknown project");
        assert!(err.contains("unknown project"), "{err}");
    }

    /// `workers.pr_url`, the status-event `source` and the `messages` table
    /// are all part of the frozen baseline and round-trip on it. (The
    /// repair-on-open simulation for pre-contract databases ended with the
    /// migration contract.)
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn pull_request_column_event_source_and_messages_round_trip() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        store
            .insert_worker(&worker_row(&project.id, "wk-1"))
            .await
            .unwrap();
        assert!(store
            .get_worker("wk-1")
            .await
            .unwrap()
            .unwrap()
            .pr_url
            .is_none());

        store
            .record_status_event("wk-1", "x", "y", SRC_LIFECYCLE)
            .await
            .unwrap();
        let events: Vec<StatusEvent> = sqlx::query_as(
            "SELECT id, worker_id, kind, detail, source, created_at FROM status_events",
        )
        .fetch_all(&store.pool)
        .await
        .unwrap();
        assert_eq!(events[0].source, SRC_LIFECYCLE);

        store
            .insert_message("wk-1", MSG_USER, "hello")
            .await
            .unwrap();
        assert_eq!(store.list_messages("wk-1", None).await.unwrap().len(), 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn pty_exit_marks_only_running_workers() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        store
            .insert_worker(&worker_row(&project.id, "wk-1"))
            .await
            .unwrap();
        store.bind_session("wk-1", "pty-1").await;

        store.mark_session_exited("pty-1", None).await.unwrap();
        let worker = store.get_worker("wk-1").await.unwrap().unwrap();
        assert_eq!(worker.status, STATUS_EXITED);
        assert!(worker.session_id.is_none());

        // An unknown session, and an already archived worker, are both no-ops.
        store
            .mark_session_exited("pty-unknown", None)
            .await
            .unwrap();
        store
            .set_worker_status("wk-1", STATUS_ARCHIVED)
            .await
            .unwrap();
        store.bind_session("wk-1", "pty-2").await;
        store.mark_session_exited("pty-2", None).await.unwrap();
        assert_eq!(
            store.get_worker("wk-1").await.unwrap().unwrap().status,
            STATUS_ARCHIVED
        );
    }

    /// The binding is kept in both directions, so an unbind or a rebind must
    /// forget both halves - a lingering reverse entry is a worker the exit
    /// hook would still find and flip.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn unbinding_and_rebinding_forgets_the_session_in_both_directions() {
        let (_dir, store) = store().await;

        store.bind_session("wk-1", "pty-1").await;
        assert_eq!(store.worker_for_session("pty-1").as_deref(), Some("wk-1"));
        assert_eq!(store.session_for_worker("wk-1").as_deref(), Some("pty-1"));

        assert_eq!(store.take_session("wk-1").as_deref(), Some("pty-1"));
        assert_eq!(
            store.worker_for_session("pty-1"),
            None,
            "a taken session must not find its worker any more"
        );
        assert_eq!(store.session_for_worker("wk-1"), None);

        // A respawn rebinds the same worker: the stale reverse half goes too.
        store.bind_session_in_memory("wk-1", "pty-2").unwrap();
        store.bind_session_in_memory("wk-1", "pty-3").unwrap();
        assert_eq!(
            store.worker_for_session("pty-2"),
            None,
            "the replaced binding must not linger"
        );
        assert_eq!(store.worker_for_session("pty-3").as_deref(), Some("wk-1"));
        assert_eq!(store.session_for_worker("wk-1").as_deref(), Some("pty-3"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_session_is_written_down_once_and_closed_once() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        store
            .insert_worker(&worker_row(&project.id, "wk-1"))
            .await
            .unwrap();

        store.bind_session("wk-1", "pty-1").await;
        let open = store.list_sessions(&project.id, None).await.unwrap();
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].worker_id, "wk-1");
        assert_eq!(open[0].ended_at, None, "a live session has no end yet");
        assert_eq!(open[0].exit_code, None);

        store.mark_session_exited("pty-1", Some(3)).await.unwrap();
        let closed = store.list_sessions(&project.id, None).await.unwrap();
        assert_eq!(closed[0].exit_code, Some(3));
        let ended_at = closed[0].ended_at.expect("an end");

        // The exit hook can fire twice for one session - an archive that
        // killed the terminal and then the child's own exit. The second report
        // must not move a duration that is already final.
        store.mark_session_exited("pty-1", Some(0)).await.unwrap();
        let again = store.list_sessions(&project.id, None).await.unwrap();
        assert_eq!(again[0].exit_code, Some(3));
        assert_eq!(again[0].ended_at, Some(ended_at));

        // Another project's sessions are not this project's.
        let two = store.create_project("two", "C:/repos/two").await.unwrap();
        assert!(store.list_sessions(&two.id, None).await.unwrap().is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn submit_guard_events_are_durable_and_scoped_to_the_worker() {
        let (_dir, store) = store().await;
        store
            .record_status_event("wk-1", "submit_guard", "initial task submitted", SRC_GUARD)
            .await
            .unwrap();
        store
            .record_status_event("wk-2", "submit_guard", "retry 1", SRC_GUARD)
            .await
            .unwrap();

        let events: Vec<StatusEvent> = sqlx::query_as(
            "SELECT id, worker_id, kind, detail, source, created_at FROM status_events WHERE worker_id = ?1 ORDER BY created_at, id",
        )
        .bind("wk-1")
        .fetch_all(&store.pool)
        .await
        .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].worker_id, "wk-1");
        assert_eq!(events[0].kind, "submit_guard");
        assert_eq!(events[0].detail, "initial task submitted");
        assert_eq!(events[0].source, SRC_GUARD);
    }

    pub(crate) async fn break_queue_inserts_for_test(store: &Store) {
        sqlx::query(
            "CREATE TRIGGER fail_queue_insert BEFORE INSERT ON task_queue \
             BEGIN SELECT RAISE(FAIL, 'forced queue failure'); END",
        )
        .execute(&store.pool)
        .await
        .expect("create failing queue trigger");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn messages_round_trip_and_limit_returns_the_youngest_ascending() {
        let (_dir, store) = store().await;
        store
            .insert_message("wk-1", MSG_USER, "first")
            .await
            .unwrap();
        let second = store
            .insert_message("wk-1", MSG_USER, "second")
            .await
            .unwrap();
        let third = store
            .insert_message("wk-1", MSG_AGENT, "third")
            .await
            .unwrap();
        store
            .insert_message("wk-2", MSG_SYSTEM, "other")
            .await
            .unwrap();

        let all = store.list_messages("wk-1", None).await.unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].content, "first");
        assert_eq!(all[1].content, "second");
        assert_eq!(all[2].content, "third");

        let limited = store.list_messages("wk-1", Some(2)).await.unwrap();
        assert_eq!(limited.len(), 2);
        assert_eq!(limited[0], second);
        assert_eq!(limited[1], third);
        assert_eq!(limited[0].created_at, second.created_at);

        let empty = store.list_messages("wk-1", Some(0)).await.unwrap();
        assert!(empty.is_empty());

        // The limit is bound rather than interpolated, so a caller asking for
        // more than SQLite can represent gets a page instead of an error.
        let huge = store.list_messages("wk-1", Some(usize::MAX)).await.unwrap();
        assert_eq!(huge.len(), 3);

        let other = store.list_messages("wk-2", None).await.unwrap();
        assert_eq!(other.len(), 1);
        assert_eq!(other[0].role, MSG_SYSTEM);
    }

    // -- agent quota (Phase 3.6) -------------------------------------------

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn agent_quota_rows_round_trip_and_upsert() {
        let (_dir, store) = store().await;
        assert!(store.list_agent_quota().await.unwrap().is_empty());
        assert_eq!(store.get_agent_quota("claude").await.unwrap(), None);

        let blocked = AgentQuota {
            profile_id: "claude".to_string(),
            state: QUOTA_BLOCKED.to_string(),
            blocked_until: None,
            reason: Some("Claude usage limit reached.".to_string()),
            updated_at: 100,
        };
        store.set_agent_quota(&blocked).await.unwrap();
        assert_eq!(
            store.get_agent_quota("claude").await.unwrap(),
            Some(blocked.clone())
        );

        // The primary key means a second write updates rather than duplicates.
        let recovered = AgentQuota {
            state: QUOTA_OK.to_string(),
            reason: None,
            blocked_until: Some(1_800_000_000),
            updated_at: 200,
            ..blocked.clone()
        };
        store.set_agent_quota(&recovered).await.unwrap();
        let rows = store.list_agent_quota().await.unwrap();
        assert_eq!(rows, vec![recovered.clone()]);
        assert!(!rows[0].is_blocked());
        assert_eq!(rows[0].blocked_until, Some(1_800_000_000));

        store
            .set_agent_quota(&AgentQuota::unknown("kimi"))
            .await
            .unwrap();
        let rows = store.list_agent_quota().await.unwrap();
        assert_eq!(
            rows.iter()
                .map(|r| r.profile_id.as_str())
                .collect::<Vec<_>>(),
            vec!["claude", "kimi"]
        );
        assert_eq!(rows[1].state, QUOTA_UNKNOWN);

        store.clear_agent_quota("claude").await.unwrap();
        assert_eq!(store.get_agent_quota("claude").await.unwrap(), None);
    }

    /// The quota row is reset by the status engine, but "blocked, then working
    /// again" has to survive as a plain sequence of writes too.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_profile_can_be_blocked_and_reset_to_ok() {
        let (_dir, store) = store().await;
        let mut row = AgentQuota::unknown("claude");
        row.state = QUOTA_BLOCKED.to_string();
        row.reason = Some("credit balance is too low".to_string());
        store.set_agent_quota(&row).await.unwrap();
        assert!(store
            .get_agent_quota("claude")
            .await
            .unwrap()
            .unwrap()
            .is_blocked());

        row.state = QUOTA_OK.to_string();
        row.reason = None;
        row.blocked_until = None;
        store.set_agent_quota(&row).await.unwrap();
        let back = store.get_agent_quota("claude").await.unwrap().unwrap();
        assert_eq!(back.state, QUOTA_OK);
        assert!(back.reason.is_none());
        assert!(back.blocked_until.is_none());
    }

    /// The `agent_quota` table is part of the frozen baseline.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_quota_table_round_trips() {
        let (_dir, store) = store().await;
        assert!(store.list_agent_quota().await.unwrap().is_empty());
        store
            .set_agent_quota(&AgentQuota::unknown("claude"))
            .await
            .unwrap();
        assert!(store.get_agent_quota("claude").await.unwrap().is_some());
    }

    /// `sent_to_agent` is `false` on a fresh comment and round-trips as such.
    /// (The "migrated rather than replaced" repair-on-open half ended with
    /// the migration contract.)
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_diff_comment_round_trips_as_not_sent() {
        let (_dir, store) = store().await;
        let existing = DiffComment {
            id: "dc-1".to_string(),
            worker_id: "wk-1".to_string(),
            file: "src/main.rs".to_string(),
            line: 12,
            body: "tidy this".to_string(),
            sent_to_agent: false,
            created_at: 1,
            disposition: COMMENT_OPEN.to_string(),
        };
        store.insert_diff_comment(&existing).await.unwrap();
        assert_eq!(
            store.list_diff_comments("wk-1").await.unwrap(),
            vec![existing]
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn comment_disposition_defaults_to_open_and_round_trips() {
        let (_dir, store) = store().await;
        let comment = DiffComment {
            id: "dc-1".to_string(),
            worker_id: "wk-1".to_string(),
            file: "src/main.rs".to_string(),
            line: 12,
            body: "tidy this".to_string(),
            sent_to_agent: false,
            created_at: 1,
            disposition: COMMENT_OPEN.to_string(),
        };
        store.insert_diff_comment(&comment).await.unwrap();
        assert_eq!(store.count_open_diff_comments("wk-1").await.unwrap(), 1);
        assert_eq!(
            store
                .get_diff_comment("dc-1")
                .await
                .unwrap()
                .unwrap()
                .disposition,
            COMMENT_OPEN
        );
        store
            .set_diff_comment_disposition("dc-1", COMMENT_DONE)
            .await
            .unwrap();
        assert_eq!(store.count_open_diff_comments("wk-1").await.unwrap(), 0);
        assert_eq!(
            store
                .get_diff_comment("dc-1")
                .await
                .unwrap()
                .unwrap()
                .disposition,
            COMMENT_DONE
        );
        store
            .set_diff_comment_disposition("dc-1", COMMENT_OPEN)
            .await
            .unwrap();
        assert_eq!(store.count_open_diff_comments("wk-1").await.unwrap(), 1);
        let err = store
            .set_diff_comment_disposition("dc-1", "ready")
            .await
            .unwrap_err();
        assert!(err.contains("unknown comment disposition"), "{err}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn review_evidence_round_trips_and_legacy_pass_is_not_copied() {
        let (_dir, store) = store().await;
        let project = store.create_project("P", "C:/tmp/p").await.unwrap();
        let row = WorkerRow {
            id: "wk-1".to_string(),
            project_id: project.id.clone(),
            task: "task".to_string(),
            profile_id: "claude".to_string(),
            branch: "pa/wk-1".to_string(),
            worktree_path: "C:/tmp/p/wk-1".to_string(),
            status: STATUS_EXITED.to_string(),
            kind: KIND_WORKER.to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: Some(TEST_PASS.to_string()),
            tested_at: Some(1_700_000_000),
            role_variant_id: None,
            paused_reason: None,
            created_at: 1,
        };
        store.insert_worker(&row).await.unwrap();
        assert!(
            store.get_review_evidence("wk-1").await.unwrap().is_none(),
            "a pass without SHA must not become evidence"
        );

        let evidence = ReviewEvidence {
            worker_id: "wk-1".to_string(),
            worker_head_sha: "aaa".into(),
            base_tip_sha: "bbb".into(),
            merge_tree_oid: "ccc".into(),
            verification_policy_hash: Some("policy".into()),
            test_passed: Some(1),
            tested_at: Some(2),
            acceptance_hash: Some("acc".into()),
            reviewed_by: Some("human".into()),
            approval_source: Some(APPROVAL_DESKTOP.into()),
            approval_decision: Some(DECISION_APPROVED.into()),
            approved_at: Some(3),
            worktree_prune_offered: 0,
        };
        store.put_review_evidence(&evidence).await.unwrap();
        let got = store.get_review_evidence("wk-1").await.unwrap().unwrap();
        assert_eq!(got, evidence);
        store
            .set_worktree_prune_offered("wk-1", true)
            .await
            .unwrap();
        let got = store.get_review_evidence("wk-1").await.unwrap().unwrap();
        assert_eq!(got.worktree_prune_offered, 1);
        assert_eq!(
            got.approval_record().unwrap().approval_source,
            crate::readiness::ApprovalSource::Desktop
        );
    }

    /// Review-F4-r16 (Opus, Fix-6-Nachweis): Löschen oder Ändern des
    /// Setup-Kommandos muss den gespeicherten Grant verfallen lassen — sonst
    /// gilt nach Löschen + erneutem Setzen desselben Kommandos die alte
    /// Freigabe ohne erneuten Blick. Ein unverändertes erneutes Speichern
    /// (Settings-Blur) darf den Grant dagegen NICHT wegräumen.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn changing_or_clearing_the_setup_command_voids_the_stored_trust() {
        let (_dir, store) = store().await;
        let project = store.create_project("P", "C:/tmp/p").await.unwrap();
        store
            .set_setup_command(&project.id, Some("npm ci"))
            .await
            .unwrap();
        let grant = SetupTrust {
            project_id: project.id.clone(),
            repo_identity: "r".into(),
            command_normalized: "npm ci".into(),
            base_sha: "b".into(),
            inputs_hash: "i".into(),
            granted_at: 10,
        };
        store.put_setup_trust(&grant).await.unwrap();

        // Idempotent re-save keeps the grant.
        store
            .set_setup_command(&project.id, Some("npm ci"))
            .await
            .unwrap();
        assert!(store.get_setup_trust(&project.id).await.unwrap().is_some());

        // Clearing voids it.
        store.set_setup_command(&project.id, None).await.unwrap();
        assert!(store.get_setup_trust(&project.id).await.unwrap().is_none());

        // Re-setting the same command does not resurrect it.
        store
            .set_setup_command(&project.id, Some("npm ci"))
            .await
            .unwrap();
        assert!(store.get_setup_trust(&project.id).await.unwrap().is_none());
    }

    /// Review-F4-r15 (k3 Fund 1): ein Whitespace-only Setup-Kommando
    /// normalisiert zu `""` und würde die Trust-Strecke in eine Sackgasse
    /// führen (die ipc-Guard verwirft den View, das Gate verweigert
    /// permanent). Der Kern behandelt es wie Löschen — ohne sich auf
    /// Caller-Disziplin zu verlassen (SettingsView trimmed bereits UI-seitig).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_whitespace_only_setup_command_is_cleared_not_stored() {
        let (_dir, store) = store().await;
        let project = store.create_project("P", "C:/tmp/p").await.unwrap();
        store
            .set_setup_command(&project.id, Some("npm ci"))
            .await
            .unwrap();
        store
            .set_setup_command(&project.id, Some("   "))
            .await
            .unwrap();
        assert_eq!(store.get_setup_command(&project.id).await.unwrap(), None);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn setup_trust_is_replaced_when_the_script_hash_changes() {
        let (_dir, store) = store().await;
        let project = store.create_project("P", "C:/tmp/p").await.unwrap();
        store
            .set_setup_command(&project.id, Some("npm run setup"))
            .await
            .unwrap();
        assert_eq!(
            store
                .get_setup_command(&project.id)
                .await
                .unwrap()
                .as_deref(),
            Some("npm run setup")
        );
        let first = SetupTrust {
            project_id: project.id.clone(),
            repo_identity: "example.git".into(),
            command_normalized: crate::readiness::normalize_command("npm run setup"),
            base_sha: "base1".into(),
            inputs_hash: crate::readiness::inputs_hash(&[("scripts/lifecycle.sh", b"old")]),
            granted_at: 10,
        };
        store.put_setup_trust(&first).await.unwrap();
        let stored = store.get_setup_trust(&project.id).await.unwrap().unwrap();
        assert_eq!(stored, first);

        let second = SetupTrust {
            inputs_hash: crate::readiness::inputs_hash(&[("scripts/lifecycle.sh", b"new")]),
            granted_at: 11,
            ..first.clone()
        };
        store.put_setup_trust(&second).await.unwrap();
        let stored = store.get_setup_trust(&project.id).await.unwrap().unwrap();
        assert_eq!(stored.inputs_hash, second.inputs_hash);
        assert_ne!(
            crate::readiness::trust_status(Some(&first.grant()), &second.grant()),
            crate::readiness::TrustStatus::Granted
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn diff_comments_round_trip_and_are_scoped_to_one_worker() {
        let (_dir, store) = store().await;
        assert!(store.list_diff_comments("wk-1").await.unwrap().is_empty());

        let mut one = DiffComment {
            id: "dc-1".to_string(),
            worker_id: "wk-1".to_string(),
            file: "src/main.rs".to_string(),
            line: 12,
            body: "tidy this".to_string(),
            sent_to_agent: false,
            created_at: 1,
            disposition: COMMENT_OPEN.to_string(),
        };
        let two = DiffComment {
            id: "dc-2".to_string(),
            worker_id: "wk-2".to_string(),
            line: 3,
            created_at: 2,
            ..one.clone()
        };
        store.insert_diff_comment(&one).await.unwrap();
        store.insert_diff_comment(&two).await.unwrap();

        assert_eq!(
            store.list_diff_comments("wk-1").await.unwrap(),
            vec![one.clone()]
        );
        assert_eq!(store.get_diff_comment("dc-2").await.unwrap(), Some(two));
        assert_eq!(store.get_diff_comment("dc-nope").await.unwrap(), None);

        store.set_diff_comment_sent(&one.id).await.unwrap();
        one.sent_to_agent = true;
        assert_eq!(store.get_diff_comment("dc-1").await.unwrap(), Some(one));

        store.delete_diff_comment("dc-1").await.unwrap();
        assert!(store.list_diff_comments("wk-1").await.unwrap().is_empty());
        // Deleting what is not there is not an error; the row is gone either way.
        store.delete_diff_comment("dc-1").await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_blocked_quota_row_round_trips_its_reason_and_deadline() {
        let (_dir, store) = store().await;
        store
            .set_agent_quota(&AgentQuota {
                profile_id: "claude".to_string(),
                state: QUOTA_BLOCKED.to_string(),
                blocked_until: Some(7),
                reason: Some("rate limit".to_string()),
                updated_at: 1,
            })
            .await
            .unwrap();
        let back = store.get_agent_quota("claude").await.unwrap().unwrap();
        assert_eq!(back.reason.as_deref(), Some("rate limit"));
        assert_eq!(back.blocked_until, Some(7));
    }

    // -- learnings and settings (Phase 14) ---------------------------------

    fn learning(id: &str, project_id: &str, content: &str) -> Learning {
        Learning {
            id: id.to_string(),
            project_id: project_id.to_string(),
            worker_id: "wk-1".to_string(),
            profile_id: "claude".to_string(),
            pattern_label: Some("Gates".to_string()),
            content: content.to_string(),
            status: LEARNING_PENDING.to_string(),
            created_at: 1,
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn learnings_round_trip_and_are_scoped_by_project_and_status() {
        let (_dir, store) = store().await;
        assert!(store.list_learnings(None, None).await.unwrap().is_empty());

        let one = learning("lr-1", "pj-1", "Immer erst cargo test, dann clippy");
        let two = Learning {
            pattern_label: None,
            ..learning("lr-2", "pj-1", "Keine CARGO_PROFILE_-Variablen setzen")
        };
        let other = learning("lr-3", "pj-2", "Frontend-Strings bleiben deutsch");
        for entry in [&one, &two, &other] {
            store.insert_learning(entry).await.unwrap();
        }

        assert_eq!(
            store.list_learnings(Some("pj-1"), None).await.unwrap(),
            vec![one.clone(), two.clone()]
        );
        assert_eq!(store.list_learnings(None, None).await.unwrap().len(), 3);
        assert_eq!(
            store.list_learnings(Some("pj-nope"), None).await.unwrap(),
            Vec::new()
        );

        assert_eq!(store.get_learning("lr-1").await.unwrap(), Some(one.clone()));
        assert_eq!(store.get_learning("lr-nope").await.unwrap(), None);
        // An absent pattern label survives the round trip as absent.
        assert_eq!(
            store
                .get_learning("lr-2")
                .await
                .unwrap()
                .unwrap()
                .pattern_label,
            None
        );

        store
            .set_learning_status("lr-1", LEARNING_APPROVED)
            .await
            .unwrap();
        store
            .set_learning_status("lr-3", LEARNING_REJECTED)
            .await
            .unwrap();
        assert_eq!(
            store
                .list_learnings(None, Some(LEARNING_PENDING))
                .await
                .unwrap()
                .iter()
                .map(|entry| entry.id.clone())
                .collect::<Vec<_>>(),
            vec!["lr-2".to_string()]
        );
        assert_eq!(
            store
                .list_learnings(Some("pj-1"), Some(LEARNING_APPROVED))
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(store
            .list_learnings(Some("pj-2"), Some(LEARNING_APPROVED))
            .await
            .unwrap()
            .is_empty());

        store
            .set_learning_content("lr-2", "Umformuliert vom Menschen")
            .await
            .unwrap();
        assert_eq!(
            store.get_learning("lr-2").await.unwrap().unwrap().content,
            "Umformuliert vom Menschen"
        );

        let err = store
            .set_learning_status("lr-nope", LEARNING_REJECTED)
            .await
            .unwrap_err();
        assert!(err.contains("unknown learning"), "{err}");
        let err = store
            .set_learning_content("lr-nope", "x")
            .await
            .unwrap_err();
        assert!(err.contains("unknown learning"), "{err}");
    }

    // -- role variants (Phase 15) ------------------------------------------

    fn variant(id: &str, project_id: &str, version: i64, status: &str) -> RoleVariant {
        RoleVariant {
            id: id.to_string(),
            project_id: project_id.to_string(),
            name: "Test-Fixer".to_string(),
            base_profile_id: "claude".to_string(),
            pattern_label: "tests-fixen".to_string(),
            system_prompt_addition: "Lauf die Gates seriell.".to_string(),
            version,
            status: status.to_string(),
            created_at: 1,
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn role_variants_round_trip_and_are_scoped_by_project_and_status() {
        let (_dir, store) = store().await;
        assert!(store
            .list_role_variants(None, None)
            .await
            .unwrap()
            .is_empty());

        let one = variant("rv-1", "pj-1", 1, ROLE_PENDING);
        let two = RoleVariant {
            created_at: 2,
            ..variant("rv-2", "pj-1", 2, ROLE_APPROVED)
        };
        let other = variant("rv-3", "pj-2", 1, ROLE_PENDING);
        for entry in [&one, &two, &other] {
            store.insert_role_variant(entry).await.unwrap();
        }

        assert_eq!(
            store.list_role_variants(Some("pj-1"), None).await.unwrap(),
            vec![one.clone(), two.clone()]
        );
        assert_eq!(store.list_role_variants(None, None).await.unwrap().len(), 3);
        assert_eq!(
            store
                .list_role_variants(Some("pj-nope"), None)
                .await
                .unwrap(),
            Vec::new()
        );
        assert_eq!(
            store
                .list_role_variants(None, Some(ROLE_PENDING))
                .await
                .unwrap()
                .iter()
                .map(|entry| entry.id.clone())
                .collect::<Vec<_>>(),
            vec!["rv-1".to_string(), "rv-3".to_string()]
        );
        assert_eq!(
            store
                .list_role_variants(Some("pj-1"), Some(ROLE_APPROVED))
                .await
                .unwrap(),
            vec![two.clone()]
        );

        assert_eq!(store.get_role_variant("rv-1").await.unwrap(), Some(one));
        assert_eq!(store.get_role_variant("rv-nope").await.unwrap(), None);

        store
            .set_role_variant_status("rv-1", ROLE_REJECTED)
            .await
            .unwrap();
        assert_eq!(
            store
                .get_role_variant("rv-1")
                .await
                .unwrap()
                .unwrap()
                .status,
            ROLE_REJECTED
        );
        let err = store
            .set_role_variant_status("rv-nope", ROLE_REJECTED)
            .await
            .unwrap_err();
        assert!(err.contains("unknown role variant"), "{err}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn approved_learnings_are_counted_per_project_pattern_and_profile() {
        let (_dir, store) = store().await;
        let approved =
            |id: &str, project_id: &str, pattern: Option<&str>, profile: &str| Learning {
                pattern_label: pattern.map(str::to_string),
                profile_id: profile.to_string(),
                status: LEARNING_APPROVED.to_string(),
                ..learning(id, project_id, "egal")
            };
        for entry in [
            approved("lr-1", "pj-1", Some("gates"), "claude"),
            approved("lr-2", "pj-1", Some("gates"), "claude"),
            // Pending does not count.
            Learning {
                status: LEARNING_PENDING.to_string(),
                ..approved("lr-3", "pj-1", Some("gates"), "claude")
            },
            // Another profile, another pattern, another project, no pattern.
            approved("lr-4", "pj-1", Some("gates"), "codex"),
            approved("lr-5", "pj-1", Some("frontend"), "claude"),
            approved("lr-6", "pj-2", Some("gates"), "claude"),
            approved("lr-7", "pj-1", None, "claude"),
        ] {
            store.insert_learning(&entry).await.unwrap();
        }

        assert_eq!(
            store
                .count_approved_learnings("pj-1", "gates", "claude")
                .await
                .unwrap(),
            2
        );
        assert_eq!(
            store
                .count_approved_learnings("pj-1", "nichts", "claude")
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_approved_variant_for_a_key_is_the_highest_version() {
        let (_dir, store) = store().await;
        for entry in [
            variant("rv-1", "pj-1", 1, ROLE_APPROVED),
            variant("rv-2", "pj-1", 2, ROLE_APPROVED),
            variant("rv-3", "pj-1", 3, ROLE_PENDING),
            // Same pattern, other profile: a different key entirely.
            RoleVariant {
                base_profile_id: "codex".to_string(),
                ..variant("rv-4", "pj-1", 9, ROLE_APPROVED)
            },
        ] {
            store.insert_role_variant(&entry).await.unwrap();
        }

        let approved = store
            .approved_variant_for("pj-1", "tests-fixen", "claude")
            .await
            .unwrap()
            .expect("an approved variant");
        assert_eq!(approved.id, "rv-2");

        // The latest ignores the status, which is what the duplicate guard and
        // the version counter both need.
        let latest = store
            .latest_variant_for("pj-1", "tests-fixen", "claude")
            .await
            .unwrap()
            .expect("a variant");
        assert_eq!(latest.id, "rv-3");
        assert_eq!(latest.version, 3);

        assert_eq!(
            store
                .approved_variant_for("pj-1", "nichts", "claude")
                .await
                .unwrap(),
            None
        );
        assert_eq!(
            store
                .latest_variant_for("pj-2", "tests-fixen", "claude")
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn settings_insert_overwrite_and_miss() {
        let (_dir, store) = store().await;
        assert_eq!(store.get_setting("learning.worker").await.unwrap(), None);

        store.set_setting("learning.worker", "0").await.unwrap();
        assert_eq!(
            store
                .get_setting("learning.worker")
                .await
                .unwrap()
                .as_deref(),
            Some("0")
        );

        store.set_setting("learning.worker", "1").await.unwrap();
        assert_eq!(
            store
                .get_setting("learning.worker")
                .await
                .unwrap()
                .as_deref(),
            Some("1")
        );
        // Keys are independent: writing one never invents another.
        assert_eq!(store.get_setting("learning.queen").await.unwrap(), None);
    }

    // -- recommendations (Phase 7.1) ---------------------------------------

    fn recommendation(id: &str, project_id: &str, title: &str) -> Recommendation {
        Recommendation {
            id: id.to_string(),
            project_id: project_id.to_string(),
            title: title.to_string(),
            url: Some("https://github.com/ratatui/ratatui".to_string()),
            rationale: "Board im Terminal".to_string(),
            effort: Some("M".to_string()),
            status: REC_NEW.to_string(),
            created_at: 1,
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn recommendations_round_trip_and_are_scoped_to_a_project() {
        let (_dir, store) = store().await;
        assert!(store.list_recommendations(None).await.unwrap().is_empty());

        let one = recommendation("rc-1", "pj-1", "ratatui");
        let two = Recommendation {
            id: "rc-2".to_string(),
            url: None,
            effort: None,
            created_at: 2,
            ..recommendation("rc-2", "pj-1", "notify")
        };
        let other = recommendation("rc-3", "pj-2", "sqlx");
        for rec in [&one, &two, &other] {
            assert!(store.insert_recommendation(rec).await.unwrap());
        }

        assert_eq!(
            store.list_recommendations(Some("pj-1")).await.unwrap(),
            vec![one.clone(), two.clone()]
        );
        assert_eq!(store.list_recommendations(None).await.unwrap().len(), 3);
        assert_eq!(
            store.list_recommendations(Some("pj-nope")).await.unwrap(),
            Vec::new()
        );
        assert_eq!(
            store.get_recommendation("rc-1").await.unwrap(),
            Some(one.clone())
        );
        assert_eq!(store.get_recommendation("rc-nope").await.unwrap(), None);
        // The optional columns really are optional.
        assert_eq!(
            store.get_recommendation("rc-2").await.unwrap().unwrap().url,
            None
        );

        store
            .set_recommendation_status("rc-1", REC_ACCEPTED)
            .await
            .unwrap();
        assert_eq!(
            store
                .get_recommendation("rc-1")
                .await
                .unwrap()
                .unwrap()
                .status,
            REC_ACCEPTED
        );
        store
            .set_recommendation_status("rc-1", REC_DISMISSED)
            .await
            .unwrap();
        assert_eq!(
            store
                .get_recommendation("rc-1")
                .await
                .unwrap()
                .unwrap()
                .status,
            REC_DISMISSED
        );

        let err = store
            .set_recommendation_status("rc-nope", REC_DISMISSED)
            .await
            .expect_err("unknown id");
        assert!(err.contains("unknown recommendation"), "{err}");
    }

    /// Ingest re-reads the whole scout file every pass, so the same row is
    /// offered over and over. It must never overwrite what is already there.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn inserting_a_known_recommendation_changes_nothing() {
        let (_dir, store) = store().await;
        let rec = recommendation("rc-1", "pj-1", "ratatui");
        assert!(store.insert_recommendation(&rec).await.unwrap());
        store
            .set_recommendation_status("rc-1", REC_DISMISSED)
            .await
            .unwrap();

        // The same id again, as `new`, with a different title.
        let again = Recommendation {
            title: "something else".to_string(),
            ..rec.clone()
        };
        assert!(!store.insert_recommendation(&again).await.unwrap());

        let stored = store.get_recommendation("rc-1").await.unwrap().unwrap();
        assert_eq!(stored.status, REC_DISMISSED);
        assert_eq!(stored.title, "ratatui");
        assert_eq!(store.list_recommendations(None).await.unwrap().len(), 1);
    }

    /// A recommendation round-trips with every column intact. (The "gains
    /// the table and columns" repair-on-open simulation ended with the
    /// migration contract.)
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_recommendation_round_trips_with_defaults() {
        let (_dir, store) = store().await;
        assert!(store.list_recommendations(None).await.unwrap().is_empty());
        let rec = recommendation("rc-1", "pj-1", "ratatui");
        store.insert_recommendation(&rec).await.unwrap();
        let stored = store.get_recommendation("rc-1").await.unwrap().unwrap();
        assert_eq!(stored, rec);
        assert_eq!(stored.status, REC_NEW);
    }

    #[test]
    fn ids_are_unique_and_prefixed() {
        let a = new_id("wk");
        let b = new_id("wk");
        assert!(a.starts_with("wk-"));
        assert_ne!(a, b);
    }

    // -- activity feed (Phase 16) ------------------------------------------

    /// One row per source table across two projects; the feed must union all
    /// of them, newest first, with the project filter following the workers
    /// join for the worker-bound tables.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_activity_feed_unions_every_source_newest_first() {
        let (_dir, store) = store().await;
        assert!(store.get_activity(None, 50).await.unwrap().is_empty());

        let one = store.create_project("one", "C:/repos/one").await.unwrap();
        let two = store.create_project("two", "C:/repos/two").await.unwrap();

        let mut w1 = worker_row(&one.id, "wk-1");
        w1.task = "fix the flaky test".to_string();
        w1.created_at = 100;
        store.insert_worker(&w1).await.unwrap();
        // The other project's only footprint: it must survive the unfiltered
        // feed and vanish from the filtered one.
        let mut w2 = worker_row(&two.id, "wk-2");
        w2.created_at = 900;
        store.insert_worker(&w2).await.unwrap();

        // Timestamps are pinned by hand so the ordering assertions do not
        // depend on the wall clock.
        sqlx::query(
            "INSERT INTO status_events (id, worker_id, kind, detail, source, created_at)
             VALUES ('ev-1', 'wk-1', 'stalled', 'no output for a while', 'guard', 200)",
        )
        .execute(&store.pool)
        .await
        .expect("insert status event");
        let long_message = "x".repeat(300);
        sqlx::query(
            "INSERT INTO messages (id, worker_id, role, content, created_at)
             VALUES ('msg-1', 'wk-1', 'user', ?1, 300)",
        )
        .bind(&long_message)
        .execute(&store.pool)
        .await
        .expect("insert message");
        store
            .insert_queue_entry(&QueueEntry {
                id: "tq-1".to_string(),
                project_id: one.id.clone(),
                raw_text: "do the next thing".to_string(),
                sharpened_text: None,
                profile_id: "claude".to_string(),
                status: QUEUE_QUEUED.to_string(),
                priority: 0,
                worker_id: None,
                error: None,
                spawned_by: None,
                created_at: 400,
            })
            .await
            .unwrap();
        store
            .insert_recommendation(&Recommendation {
                created_at: 500,
                ..recommendation("rc-1", &one.id, "ratatui")
            })
            .await
            .unwrap();
        store
            .insert_learning(&Learning {
                created_at: 600,
                ..learning("lr-1", &one.id, "Gates seriell laufen lassen")
            })
            .await
            .unwrap();
        store
            .insert_role_variant(&RoleVariant {
                created_at: 700,
                ..variant("rv-1", &one.id, 1, ROLE_PENDING)
            })
            .await
            .unwrap();

        let feed = store.get_activity(None, 50).await.unwrap();
        let ids: Vec<&str> = feed.iter().map(|entry| entry.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["wk-2", "rv-1", "lr-1", "rc-1", "tq-1", "msg-1", "ev-1", "wk-1"],
            "{ids:?}"
        );
        let categories: Vec<&str> = feed.iter().map(|entry| entry.category.as_str()).collect();
        assert_eq!(
            categories,
            vec![
                "worker",
                "role",
                "learning",
                "recommendation",
                "queue",
                "message",
                "status",
                "worker"
            ]
        );

        // Worker-bound rows name their worker and carry its task as label;
        // project-level rows carry neither.
        let event = feed.iter().find(|entry| entry.id == "ev-1").unwrap();
        assert_eq!(event.worker_id.as_deref(), Some("wk-1"));
        assert_eq!(event.worker_label.as_deref(), Some("fix the flaky test"));
        assert_eq!(event.summary, "stalled: no output for a while");
        let rec = feed.iter().find(|entry| entry.id == "rc-1").unwrap();
        assert_eq!(rec.worker_id, None);
        assert_eq!(rec.worker_label, None);
        assert_eq!(rec.summary, "ratatui");

        // The project filter must follow the workers join for status events
        // and messages, which carry no project column of their own.
        let scoped = store.get_activity(Some(&one.id), 50).await.unwrap();
        assert_eq!(scoped.len(), 7);
        assert!(scoped.iter().all(|entry| entry.project_id == one.id));
        assert!(store.get_activity(Some(&two.id), 50).await.unwrap().len() == 1);
        assert!(store
            .get_activity(Some("pj-nope"), 50)
            .await
            .unwrap()
            .is_empty());

        // The limit cuts from the newest end.
        let top = store.get_activity(None, 2).await.unwrap();
        assert_eq!(top[0].id, "wk-2");
        assert_eq!(top[1].id, "rv-1");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_activity_feed_shortens_message_content() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        store
            .insert_worker(&worker_row(&project.id, "wk-1"))
            .await
            .unwrap();

        let long_message = format!("start {}", "x".repeat(300));
        sqlx::query(
            "INSERT INTO messages (id, worker_id, role, content, created_at)
             VALUES ('msg-1', 'wk-1', 'agent', ?1, 300)",
        )
        .bind(&long_message)
        .execute(&store.pool)
        .await
        .expect("insert message");

        let feed = store.get_activity(None, 50).await.unwrap();
        let entry = feed.iter().find(|entry| entry.id == "msg-1").unwrap();
        // "agent: " plus exactly 140 characters of content - the feed is a
        // list of lines, not a transcript.
        assert_eq!(
            entry.summary,
            format!("agent: start {}", "x".repeat(134)),
            "{}",
            entry.summary
        );
        // A short message comes through untouched.
        store
            .insert_message("wk-1", MSG_USER, "ja, weiter")
            .await
            .unwrap();
        let feed = store.get_activity(None, 50).await.unwrap();
        let entry = feed
            .iter()
            .find(|entry| entry.summary.starts_with("user:"))
            .unwrap();
        assert_eq!(entry.summary, "user: ja, weiter");
    }

    // -- the OmniRoute usage ledger (Phase 19 T3) --------------------------

    fn usage_event(id: &str, ts: i64) -> UsageEvent {
        UsageEvent {
            id: id.to_string(),
            ts,
            profile_id: None,
            model: "gpt-5.6-sol".to_string(),
            provider: "codex".to_string(),
            tokens_in: 100,
            tokens_out: 10,
            cost_usd: None,
            raw_json: format!("{{\"id\":\"{id}\"}}"),
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_usage_event_survives_a_round_trip() {
        let (_dir, store) = store().await;
        let mut event = usage_event("ue-1", 1_700_000_000);
        event.profile_id = Some("claude-omni".to_string());
        event.cost_usd = Some(0.25);
        assert!(store.insert_usage_event(&event).await.unwrap());

        let rows = store.list_usage_events(None, None).await.unwrap();
        assert_eq!(rows, vec![event]);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_same_usage_row_is_only_stored_once() {
        let (_dir, store) = store().await;
        let event = usage_event("ue-1", 1_700_000_000);
        assert!(
            store.insert_usage_event(&event).await.unwrap(),
            "first write"
        );
        // The poller re-reads a ring buffer, so this is the ordinary case.
        assert!(
            !store.insert_usage_event(&event).await.unwrap(),
            "the second write is a duplicate, not an error"
        );
        assert_eq!(store.list_usage_events(None, None).await.unwrap().len(), 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_ledger_lists_newest_first_and_honours_since_and_limit() {
        let (_dir, store) = store().await;
        for (id, ts) in [("a", 100), ("b", 200), ("c", 300)] {
            store
                .insert_usage_event(&usage_event(id, ts))
                .await
                .unwrap();
        }

        let ids: Vec<String> = store
            .list_usage_events(None, None)
            .await
            .unwrap()
            .into_iter()
            .map(|event| event.id)
            .collect();
        assert_eq!(ids, ["c", "b", "a"]);

        let ids: Vec<String> = store
            .list_usage_events(Some(200), None)
            .await
            .unwrap()
            .into_iter()
            .map(|event| event.id)
            .collect();
        assert_eq!(ids, ["c", "b"], "since is inclusive");

        let ids: Vec<String> = store
            .list_usage_events(None, Some(1))
            .await
            .unwrap()
            .into_iter()
            .map(|event| event.id)
            .collect();
        assert_eq!(ids, ["c"]);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn usage_totals_count_only_the_rows_that_carried_a_price() {
        let (_dir, store) = store().await;
        let empty = store.usage_totals(None).await.unwrap();
        assert_eq!(empty, UsageTotals::default(), "an empty ledger totals zero");

        let mut priced = usage_event("a", 100);
        priced.cost_usd = Some(1.5);
        store.insert_usage_event(&priced).await.unwrap();
        store
            .insert_usage_event(&usage_event("b", 200))
            .await
            .unwrap();

        let all = store.usage_totals(None).await.unwrap();
        assert_eq!(all.requests, 2);
        assert_eq!(all.tokens_in, 200);
        assert_eq!(all.tokens_out, 20);
        assert!((all.cost_usd - 1.5).abs() < f64::EPSILON);
        assert_eq!(all.priced, 1, "only one of the two rows was priced");

        let today = store.usage_totals(Some(200)).await.unwrap();
        assert_eq!(today.requests, 1);
        assert_eq!(
            today.priced, 0,
            "the unpriced row is counted, its cost is not"
        );
        assert_eq!(today.cost_usd, 0.0);
    }

    // -- questions (Phase 21) ----------------------------------------------

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_questions_table_ships_with_the_schema() {
        let (_dir, store) = store().await;
        assert!(store.table_exists("questions").await.unwrap());
    }

    /// An open worker question, with every column filled the way
    /// [`crate::questions::ask`] fills it.
    fn open_question(id: &str, worker_id: Option<&str>) -> Question {
        Question {
            id: id.to_string(),
            answered_by: None,
            project_id: "pj-1".to_string(),
            worker_id: worker_id.map(str::to_string),
            scope: match worker_id {
                Some(_) => QUESTION_WORKER.to_string(),
                None => QUESTION_PREFLIGHT.to_string(),
            },
            question: "Postgres oder SQLite?".to_string(),
            options_json: Some("[\"Postgres\",\"SQLite\"]".to_string()),
            status: QUESTION_OPEN.to_string(),
            answer: None,
            created_at: 1000,
            answered_at: None,
            expires_at: Some(1000 + 4 * 60 * 60),
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_question_survives_the_round_trip() {
        let (_dir, store) = store().await;
        let question = open_question("qs-1", Some("wk-1"));
        store.insert_question(&question).await.unwrap();

        let read = store.get_question("qs-1").await.unwrap().expect("stored");
        assert_eq!(read, question, "every column comes back as it went in");
        assert_eq!(store.get_question("qs-nope").await.unwrap(), None);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_preflight_question_keeps_a_null_worker() {
        let (_dir, store) = store().await;
        store
            .insert_question(&open_question("qs-1", None))
            .await
            .unwrap();

        let read = store.get_question("qs-1").await.unwrap().expect("stored");
        assert_eq!(read.worker_id, None);
        assert_eq!(read.scope, QUESTION_PREFLIGHT);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn listing_narrows_by_project_and_status() {
        let (_dir, store) = store().await;
        store
            .insert_question(&open_question("qs-1", Some("wk-1")))
            .await
            .unwrap();
        let mut other = open_question("qs-2", Some("wk-2"));
        other.project_id = "pj-2".to_string();
        store.insert_question(&other).await.unwrap();
        let mut done = open_question("qs-3", Some("wk-1"));
        done.status = QUESTION_ANSWERED.to_string();
        store.insert_question(&done).await.unwrap();

        let all = store.list_questions(None, None).await.unwrap();
        assert_eq!(all.len(), 3);
        let mine = store.list_questions(Some("pj-1"), None).await.unwrap();
        assert_eq!(ids(&mine), vec!["qs-1", "qs-3"]);
        let open = store
            .list_questions(Some("pj-1"), Some(QUESTION_OPEN))
            .await
            .unwrap();
        assert_eq!(ids(&open), vec!["qs-1"]);
        let open_anywhere = store
            .list_questions(None, Some(QUESTION_OPEN))
            .await
            .unwrap();
        assert_eq!(ids(&open_anywhere), vec!["qs-1", "qs-2"]);
    }

    fn ids(questions: &[Question]) -> Vec<&str> {
        questions.iter().map(|q| q.id.as_str()).collect()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn only_open_questions_count_against_a_worker() {
        let (_dir, store) = store().await;
        store
            .insert_question(&open_question("qs-1", Some("wk-1")))
            .await
            .unwrap();
        store
            .insert_question(&open_question("qs-2", Some("wk-1")))
            .await
            .unwrap();
        let mut answered = open_question("qs-3", Some("wk-1"));
        answered.status = QUESTION_ANSWERED.to_string();
        store.insert_question(&answered).await.unwrap();
        store
            .insert_question(&open_question("qs-4", Some("wk-2")))
            .await
            .unwrap();

        assert_eq!(store.count_open_questions("wk-1").await.unwrap(), 2);
        assert_eq!(store.count_open_questions("wk-2").await.unwrap(), 1);
        assert_eq!(store.count_open_questions("wk-nope").await.unwrap(), 0);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_question_can_only_be_closed_once() {
        let (_dir, store) = store().await;
        store
            .insert_question(&open_question("qs-1", Some("wk-1")))
            .await
            .unwrap();

        assert!(store
            .close_question(
                "qs-1",
                QUESTION_ANSWERED,
                "SQLite",
                2000,
                Some(ANSWERED_BY_HUMAN)
            )
            .await
            .unwrap());
        // The second caller lost the race and is told so rather than
        // overwriting the answer that is already on record.
        assert!(!store
            .close_question("qs-1", QUESTION_EXPIRED, "abgelaufen", 3000, None)
            .await
            .unwrap());

        let read = store.get_question("qs-1").await.unwrap().expect("stored");
        assert_eq!(read.status, QUESTION_ANSWERED);
        assert_eq!(read.answer.as_deref(), Some("SQLite"));
        assert_eq!(read.answered_at, Some(2000));
        assert_eq!(read.question, "Postgres oder SQLite?", "the question stays");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn expired_lists_only_open_rows_past_their_deadline() {
        let (_dir, store) = store().await;
        store
            .insert_question(&open_question("qs-due", Some("wk-1")))
            .await
            .unwrap();
        let mut later = open_question("qs-later", Some("wk-1"));
        later.expires_at = Some(999_999);
        store.insert_question(&later).await.unwrap();
        let mut answered = open_question("qs-answered", Some("wk-1"));
        answered.status = QUESTION_ANSWERED.to_string();
        store.insert_question(&answered).await.unwrap();
        let mut endless = open_question("qs-endless", Some("wk-1"));
        endless.expires_at = None;
        store.insert_question(&endless).await.unwrap();

        let due = store.list_expired_questions(50_000).await.unwrap();
        assert_eq!(ids(&due), vec!["qs-due"]);
        // On the second, not after it: a deadline that has arrived has passed.
        let exact = store
            .list_expired_questions(1000 + 4 * 60 * 60)
            .await
            .unwrap();
        assert_eq!(ids(&exact), vec!["qs-due"]);
        assert!(store.list_expired_questions(999).await.unwrap().is_empty());
    }

    // -- task queue (Phase 7) ---------------------------------------------

    #[tokio::test]
    async fn cancelling_says_whether_the_task_is_unknown_or_past_cancelling() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        let entry = QueueEntry {
            id: "tq-1".to_string(),
            project_id: project.id.clone(),
            raw_text: "do it".to_string(),
            sharpened_text: None,
            profile_id: "claude".to_string(),
            status: QUEUE_READY.to_string(),
            priority: 0,
            worker_id: None,
            error: None,
            spawned_by: None,
            created_at: 42,
        };
        store.insert_queue_entry(&entry).await.unwrap();

        // A claim has the entry, so the cancel is refused and the row stays.
        assert!(store.claim_queue_entry("tq-1").await.unwrap());
        let err = store.cancel_queue_entry("tq-1").await.unwrap_err();
        assert!(err.starts_with(crate::workers::ERR_REFUSED), "{err}");
        assert_eq!(
            store.list_queue(Some(&project.id)).await.unwrap()[0].status,
            QUEUE_DISPATCHING
        );

        let err = store.cancel_queue_entry("tq-nope").await.unwrap_err();
        assert!(err.starts_with(crate::workers::ERR_UNKNOWN), "{err}");

        // A ready entry goes; a second cancel finds no row left to name.
        store
            .insert_queue_entry(&QueueEntry {
                id: "tq-2".to_string(),
                ..entry
            })
            .await
            .unwrap();
        store.cancel_queue_entry("tq-2").await.unwrap();
        let err = store.cancel_queue_entry("tq-2").await.unwrap_err();
        assert!(err.starts_with(crate::workers::ERR_UNKNOWN), "{err}");
    }
}
