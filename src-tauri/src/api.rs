//! Local control API: ProjectA, driven from outside the window.
//!
//! Phase 4 gives the app a second face. Everything the board does - create a
//! worker, look at one, type into one - is also reachable over HTTP on an
//! ephemeral loopback port, so an orchestrating agent can run the project
//! through the `pa` bridge CLI instead of through the mouse.
//!
//! The server is the same shape as the Phase 3 hook receiver (see
//! [`crate::hooks`]): a `TcpListener`, one thread per connection, and just
//! enough HTTP to find a method, a path and a body. It listens on 127.0.0.1
//! only, and every request must carry the shared token:
//!
//! ```text
//! GET /api/board?projectId=pj-1 HTTP/1.1
//! x-projecta-token: <token>
//! ```
//!
//! The token is minted at startup and written, with the port, to
//! `<app data dir>/projecta-api.json`. Any process that can read that file can
//! drive the app - which is the point, and also the whole security model: the
//! file is as private as the user's profile directory, and the port answers
//! nobody else.
//!
//! The four verdict routes are the exception, and they are the reason for the
//! second token. Approving a learning appends it to the project's PLAYBOOK.md,
//! which is read back into every later agent's prompt - so an agent that can
//! approve its own proposal can write its own instructions. Every agent can
//! read the descriptor file, so the API token cannot tell the two apart. The
//! verdict token can: it is minted beside the API token and never written
//! anywhere. The window reads it out of this process through the
//! `get_verdict_token` command and shows it to the person in front of it; from
//! there it reaches a terminal only because a human carried it.
//!
//! Registering a project is the same class of write: `POST /api/projects`
//! accepts any git path and the next `POST /api/workers` can spawn there, so
//! production demands the verdict token too. Isolated F8 (`PROJECTA_APP_DATA`
//! set on this process) is the exception, because that AppData is a scratch
//! directory the golden-path script already owns.
//!
//! Routes:
//!
//! | Method | Path                      | Body / query          | Reply             |
//! |--------|---------------------------|-----------------------|-------------------|
//! | POST   | `/api/workers`            | `{projectId, task, profileId?, spawnedBy?}` | `Worker` |
//! | POST   | `/api/queens`             | any                    | **410 Gone** (Rev 9: no new queens) |
//! | GET    | `/api/workers`            | `?projectId=`         | `[Worker]`        |
//! | GET    | `/api/workers/<id>`       |                       | board state       |
//! | GET    | `/api/workers/<id>/messages` | `?limit=`          | `[Message]`       |
//! | POST   | `/api/workers/<id>/send`  | `{text}`              | `{ok: true}`      |
//! | POST   | `/api/workers/<id>/merge` | `{removeWorktree?}`   | `Worker`          |
//! | GET    | `/api/board`              | `?projectId=`         | `[board state]`   |
//! | GET    | `/api/quota`              |                       | `[quota row]`     |
//! | GET    | `/api/budgets`            |                       | `[budget row]`    |
//! | PUT    | `/api/budgets`            | `{profileId, fiveHourPct?, sevenDayPct?}` | `budget row` |
//! | GET    | `/api/providers`          |                       | `[provider row]`  |
//! | POST   | `/api/queue`              | `{projectId, rawText, profileId?, sharpen?, priority?, spawnedBy?}` | `QueueEntry` |
//! | GET    | `/api/queue`              | `?projectId=`         | `[QueueEntry]`    |
//! | POST   | `/api/queue/<id>/cancel`  |                       | `{ok: true}`      |
//! | POST   | `/api/scout`              | `{projectId}`         | `Worker`          |
//! | POST   | `/api/scout/triage`       | `{projectId, urls}`   | `Worker`          |
//! | GET    | `/api/recommendations`    | `?projectId=`         | `[Recommendation]`|
//! | POST   | `/api/recommendations`    | `{projectId, title, rationale, url?, effort?}` | `Recommendation` |
//! | POST   | `/api/recommendations/<id>/accept` |              | `QueueEntry`      |
//! | POST   | `/api/recommendations/<id>/status` | `{status}`   | `{ok: true}`      |
//! | GET    | `/api/learnings`          | `?projectId=`, `?status=` | `[Learning]` |
//! | POST   | `/api/learnings/<id>/approve` | `{text}` + verdict header | `{ok: true}` |
//! | POST   | `/api/learnings/<id>/reject`  | verdict header    | `{ok: true}`      |
//! | POST   | `/api/questions`          | `{projectId, workerId?, question, options?}` | `Question` |
//! | GET    | `/api/questions`          | `?projectId=`, `?status=` | `[Question]` |
//! | POST   | `/api/questions/<id>/answer` | `{answer}`         | `Question`        |
//! | GET    | `/api/roles`              | `?projectId=`, `?status=` | `[RoleVariant]` |
//! | POST   | `/api/roles/<id>/approve` | verdict header        | `{ok: true}`      |
//! | POST   | `/api/roles/<id>/reject`  | verdict header        | `{ok: true}`      |
//! | GET    | `/api/activity`           | `?projectId=`, `?limit=` | `[ActivityEntry]` |
//! | GET    | `/api/usage`              | `?limit=`             | `UsageReport` |
//! | GET    | `/api/projects`           |                       | `[ProjectOverview]`|
//! | POST   | `/api/projects`           | `{name, repoPath}` + verdict (or `PROJECTA_APP_DATA`) | `ProjectOverview` |
//! | GET    | `/api/projects/<id>/tree` |                       | agent hierarchy   |
//! | GET    | `/api/projects/<id>/learnings` | `?status=`       | `[Learning]`      |
//! | GET    | `/api/projects/<id>/roles` | `?status=`          | `[RoleVariant]`   |
//! | GET    | `/api/projects/<id>/digests` |                   | `[date]`          |
//! | GET    | `/api/projects/<id>/digests/<date>` |            | `{date, markdown}`|
//! | GET    | `/api/projects/<id>/stats` | `?range=`            | `ProjectStats`    |
//! | POST   | `/api/projects/<id>/orchestrator/send` | `{text}`      | `Worker`          |
//! | POST   | `/api/projects/<id>/github/create` | `{name, private}` | repo url  |
//! | POST   | `/api/projects/<id>/github/link`   | `{url}`      | `{ok: true}`      |
//! | GET    | `/api/projects/<id>/landing-page`  |              | `{markdown: string|null}` |
//! | POST   | `/api/projects/<id>/landing-page`  | `{markdown: string|null}` | `{ok: true}` |
//! | GET    | `/api/health`             |                       | `{ok: true}`      |
//! | GET    | `/api/diagnosis`          |                       | `{logPath, panicCurrent, panicPrevious}` |
//!
//! Failures answer `{ "error": "..." }` and the error string is whatever the
//! core said - the CLI prints it verbatim. The status is the part a script can
//! act on, so it says whose fault the failure was: 400 for a request this file
//! could not make sense of, 401 without the API token, 403 for a verdict route
//! reached without the verdict token, 404 for an id that names nothing, 405 for
//! a known collection reached with the wrong verb, 409 for a request that is
//! well formed but arrives at the wrong moment - merging a card that is not
//! ready, typing at a worker whose agent has exited, a verdict on a row that
//! already has one - and 500 for everything the app itself got wrong.
//!
//! The eight routes that create something - a worker, a queen, a queued task, a
//! scout, a triage, a recommendation, a word to the orchestrator, a GitHub
//! repository - used to answer 500 for all three, because the core
//! hands them
//! one untyped `String` that mixed a mistyped project id in with a worktree
//! that would not check out. [`crate::workers`] now opens those messages with
//! `unknown ` and `refused: `, and [`core_status`] reads that opening. Where a
//! route still cannot tell the two apart it answers 500, which is the
//! conservative reading: 500 invites a retry or a bug report, a 4xx wrongly
//! blames the caller.
//!
//! Linking a GitHub repository and accepting a recommendation carried the same
//! confusion the other way round: both answered 400 for every failure, so a
//! `git` that would not run, a missing `gh` and a queue insert that failed all
//! came back as the caller's mistake. Both read [`core_status`] now, and the
//! two messages behind them that describe a wrong moment - an `origin` that
//! already exists, a recommendation that was accepted before - say so in the
//! core's own words. What a route can judge on its own it still judges before
//! the core is asked: the shape of a GitHub url and of a repository name are
//! 400 from here, as the digest date and the stats range already were.
//!
//! `/api/recommendations/<id>/status` was left behind by that round, one line
//! below `accept`: a recommendation id that names nothing and a store that fell
//! over both answered 400. It reads [`core_status`] too now, and its own
//! judgement - whether the status is one of the two words the store knows - is
//! made here, before the core is asked, so a misspelled status never reaches
//! the store and stays the 400 it always was. It answers no 409, and that is
//! not an omission: the store writes this one with a plain `UPDATE` and no
//! claim, so there is no wrong moment for it to arrive at - unlike `accept`,
//! which does claim and does answer 409.
//!
//! `POST /api/queue/<id>/cancel` was the last member of that class still
//! open: it answered 400 for every failure, including a store that fell over.
//! It reads [`core_status`] now - 404 for an id that names nothing, 409 for
//! an entry that is no longer queued or ready, 500 for the store - because
//! `store::cancel_queue_entry` opens those two cases with `unknown ` and
//! `refused: ` like the rest of the core. The audit card that found this
//! class named both routes in one breath
//! (`docs/audits/2026-09-03-analyse-claude-web/karten/services.md`).
//!
//! The routes that *list* something for one project - `/api/workers`,
//! `/api/queue`, `/api/projects/<id>/tree` and their neighbours - answered an
//! empty collection for a project id that names nothing, because the store
//! filters by that id instead of refusing it and an empty collection is an
//! ordinary answer: a typo read like a project with no work in it. Each of
//! them now asks whether the project exists before it filters by it, which
//! costs one lookup per listing call - see [`unknown_project`], which also
//! says which routes do not ask and why.
//!
//! Requests share the limits all three hand-rolled servers enforce (see
//! [`crate::http_util`]): a 16 KiB head, a 64 KiB body - a larger `send`
//! payload is refused rather than truncated - and 64 live connections per
//! server, past which the accept loop itself answers 503 instead of spending
//! another thread.

use std::collections::HashMap;
use std::io::Write;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::budget::BudgetLimits;
use crate::http_util::{
    answer_overloaded, connection_limiter, percent_decode, token_eq, try_acquire_connection,
    ConnectionLimiter,
};
use crate::omniroute::UsageReport;
use crate::providers::ProviderOverview;
use crate::quota::QuotaStateRow;
use crate::status::WorkerBoardState;
use crate::store::{
    ActivityEntry, ContinuousClaim, ContinuousContext, ContinuousControl, ContinuousGoal,
    ContinuousTask, Learning, Message, Project, Question, QueueEntry, Recommendation, RoleVariant,
    Worker, KIND_ORCHESTRATOR, KIND_QUEEN, KIND_SCOUT,
};

/// Name of the descriptor file written into the app data directory.
pub const DESCRIPTOR_FILE: &str = "projecta-api.json";

#[path = "api/agent_access.rs"]
mod agent_access;
pub use agent_access::{CandidateInput, RunCredentialIssuer};
#[cfg(windows)]
#[path = "api/credential_acl.rs"]
mod credential_acl;
#[cfg(all(test, windows))]
#[path = "api/credential_acl_tests.rs"]
mod credential_acl_tests;
#[path = "api/planning_access.rs"]
mod planning_access;

/// Header carrying the shared token. Lower case: header names are compared
/// case-insensitively, and this is the form the CLI sends.
pub const TOKEN_HEADER: &str = "x-projecta-token";

/// Header carrying the verdict token, required on top of [`TOKEN_HEADER`] by
/// the four routes that give a human verdict on a learning or a role.
pub const VERDICT_TOKEN_HEADER: &str = "x-verdict-token";

/// Profile used when a caller does not name one.
const DEFAULT_PROFILE: &str = "claude";

/// How many ledger rows `GET /api/usage` returns when nobody says, and the
/// most it will return however loudly they do. The route is a list on a
/// screen, not a bulk export.
const USAGE_LIMIT_DEFAULT: u32 = 50;
const USAGE_LIMIT_MAX: u32 = 500;

/// A slow or wedged client must not tie up a thread forever.
const IO_TIMEOUT: Duration = Duration::from_secs(5);

/// Everything the API can ask the app to do.
///
/// Behind this trait the app reaches into Tauri state - the store, the PTY
/// manager, the status engine - none of which exists in a test. The tests hand
/// the server a fake instead and are done in milliseconds.
pub trait ControlBackend: Send + Sync {
    fn agent_record_page(
        &self,
        _run: &str,
        _owner: &str,
        _fence: i64,
        _collection: &str,
        _cursor: Option<&str>,
    ) -> Result<Value, String> {
        Err("agent record traversal unavailable".into())
    }
    fn agent_evidence(
        &self,
        _run: &str,
        _owner: &str,
        _fence: i64,
        _id: &str,
    ) -> Result<Value, String> {
        Err("agent evidence retrieval unavailable".into())
    }
    fn agent_run_context(&self, _run: &str, _owner: &str, _fence: i64) -> Result<Value, String> {
        Err("agent run context unavailable".into())
    }
    fn agent_checkpoint_at(
        &self,
        _run: &str,
        _owner: &str,
        _fence: i64,
        _revision: i64,
    ) -> Result<Value, String> {
        Err("agent checkpoint retrieval unavailable".into())
    }
    fn agent_checkpoint(
        &self,
        _run: &str,
        _owner: &str,
        _fence: i64,
        _input: crate::store::development_runs::CheckpointInput,
    ) -> Result<Value, String> {
        Err("agent checkpoint service unavailable".into())
    }
    fn agent_bind_candidate(
        &self,
        _run: &str,
        _owner: &str,
        _fence: i64,
        _input: CandidateInput,
    ) -> Result<Value, String> {
        Err("agent candidate service unavailable".into())
    }
    fn agent_submit_evidence(
        &self,
        _run: &str,
        _owner: &str,
        _fence: i64,
        _input: crate::store::development_runs::EvidenceInput,
    ) -> Result<Value, String> {
        Err("agent evidence service unavailable".into())
    }
    /// Record a review disposition. `reviewer_run`, `owner` and `fence` come
    /// from the scoped run credential, never from the request body: the
    /// credential *is* the reviewer principal (W2-01b).
    fn agent_submit_review(
        &self,
        _reviewer_run: &str,
        _owner: &str,
        _fence: i64,
        _input: crate::store::development_runs::ReviewInput,
    ) -> Result<Value, String> {
        Err("agent review service unavailable".into())
    }
    /// Whether `project_id` names a project.
    ///
    /// Asked by every route that *lists* something for one project, before the
    /// id is handed to the store as a filter - see [`unknown_project`]. The
    /// creating routes need nothing like it: they reach a core that looks the
    /// project up itself and says `unknown project: ...` when it is not there.
    fn project_exists(&self, project_id: &str) -> Result<bool, String>;

    // -- DevHQ continuous contract (v1, storage only) --------------------
    // These methods deliberately do not start workers. Runtime adapters have
    // to attest separately before a future scheduler can call them.
    fn continuous_runtime(&self) -> Result<Value, String> {
        Err("continuous backend unavailable".to_string())
    }
    fn development_records(&self, _project_id: &str) -> Result<Value, String> {
        Err("development records unavailable".into())
    }
    fn development_plan(
        &self,
        _project_id: &str,
        _plan_id: &str,
        _revision: Option<i64>,
    ) -> Result<Value, String> {
        Err("development plan unavailable".into())
    }
    fn import_development_plan(
        &self,
        _project_id: &str,
        _plan_id: &str,
        _expected_projection_revision: i64,
        _rollback_reason: Option<&str>,
    ) -> Result<Value, String> {
        Err("development plan unavailable".into())
    }
    fn continuous_context(
        &self,
        _project_id: &str,
        _cursor: i64,
    ) -> Result<ContinuousContext, String> {
        Err("continuous backend unavailable".to_string())
    }
    fn continuous_changes(&self, _project_id: &str, _cursor: i64) -> Result<Value, String> {
        Err("continuous changes unavailable".into())
    }
    fn wait_continuous_changes(
        &self,
        _project_id: &str,
        _cursor: i64,
        _wait_ms: u64,
    ) -> Result<Value, String> {
        Err("continuous journal waiting unavailable".into())
    }
    fn list_continuous_goals(&self, _project_id: &str) -> Result<Vec<ContinuousGoal>, String> {
        Err("continuous backend unavailable".to_string())
    }
    fn create_continuous_goal(
        &self,
        _project_id: &str,
        _objective: &str,
        _acceptance_criteria: Option<String>,
        _source_goal_id: Option<String>,
        _admit: bool,
    ) -> Result<ContinuousGoal, String> {
        Err("continuous backend unavailable".to_string())
    }
    fn create_continuous_task(
        &self,
        _goal_id: &str,
        _objective: &str,
        _profile_id: Option<String>,
        _owned_paths: Vec<String>,
        _dependencies: Vec<String>,
    ) -> Result<ContinuousTask, String> {
        Err("continuous backend unavailable".to_string())
    }
    fn claim_continuous_task(
        &self,
        _task_id: &str,
        _owner: &str,
        _escalation: bool,
    ) -> Result<ContinuousClaim, String> {
        Err("continuous backend unavailable".to_string())
    }
    fn assign_continuous_task(
        &self,
        _task_id: &str,
        _request: crate::store::team_assignments::AssignmentRequest,
    ) -> Result<crate::store::team_assignments::TeamAssignment, String> {
        Err("team assignment backend unavailable".into())
    }
    fn continuous_task_assignment(
        &self,
        _task_id: &str,
    ) -> Result<Option<crate::store::team_assignments::TeamAssignment>, String> {
        Err("team assignment backend unavailable".into())
    }
    /// The dispatch role of the run a scoped credential speaks for, under the
    /// same owner/fence authority as the agent routes (W2-04f). Never taken
    /// from the request. The default resolves nothing, so a backend that does
    /// not answer refuses every planning write (fail closed).
    fn agent_dispatch_role(
        &self,
        _run: &str,
        _owner: &str,
        _fence: i64,
    ) -> Result<crate::store::development_launches::DispatchRole, String> {
        Err("dispatch role service unavailable".into())
    }
    fn checkpoint_continuous_task(
        &self,
        _task_id: &str,
        _owner: &str,
        _fence: i64,
        _status: Option<String>,
        _detail: Option<String>,
    ) -> Result<ContinuousTask, String> {
        Err("continuous backend unavailable".to_string())
    }
    fn control_continuous(
        &self,
        _project_id: &str,
        _action: &str,
    ) -> Result<ContinuousControl, String> {
        Err("continuous backend unavailable".to_string())
    }

    /// `spawned_by` is the caller's own declaration of which coordinator
    /// ordered the spawn. It is bookkeeping for the hierarchy tree, not a
    /// security boundary - the API token already is that.
    fn create_worker(
        &self,
        project_id: &str,
        task: &str,
        profile_id: &str,
        spawned_by: Option<String>,
    ) -> Result<Worker, String>;

    /// Start a queen: a domain coordinator without a worktree. Same
    /// `spawned_by` bookkeeping as [`ControlBackend::create_worker`].
    ///
    /// Retired as a public write: HTTP answers 410 and must not call this.
    /// The method stays so a direct trait caller still hits a typed refusal
    /// on the app backend.
    #[allow(dead_code)]
    fn create_queen(
        &self,
        project_id: &str,
        task: &str,
        profile_id: Option<String>,
        spawned_by: Option<String>,
    ) -> Result<Worker, String>;

    fn list_workers(&self, project_id: Option<&str>) -> Result<Vec<Worker>, String>;

    /// One worker with the column the status engine puts it in, or `None` when
    /// there is no such worker.
    fn worker_state(&self, worker_id: &str) -> Result<Option<WorkerBoardState>, String>;

    /// Type `text` into the worker's terminal, as if the user had.
    fn send_to_worker(&self, worker_id: &str, text: &str) -> Result<(), String>;

    /// Merge a worker's branch: a pull request where the project has a GitHub
    /// remote, a local merge where it has none. `remove_worktree` also drops
    /// the checkout once the merge is in.
    ///
    /// The route exists for the person at a terminal. The orchestrator and
    /// queen prompts do not list `pa worker merge`, and nothing here changes
    /// that: merging stays a human decision.
    fn merge_worker(&self, worker_id: &str, remove_worktree: bool) -> Result<Worker, String>;

    /// Say something to the project's orchestrator, starting one if the
    /// project has none running. Returns the orchestrator that heard it, so a
    /// caller can name it or follow its log.
    fn send_to_orchestrator(&self, project_id: &str, text: &str) -> Result<Worker, String>;

    fn list_worker_messages(
        &self,
        worker_id: &str,
        limit: Option<usize>,
    ) -> Result<Vec<Message>, String>;

    fn board(&self, project_id: Option<&str>) -> Result<Vec<WorkerBoardState>, String>;

    fn quota(&self) -> Result<Vec<QuotaStateRow>, String>;

    /// Which providers this machine can reach, and what the quota tracker
    /// knows about each - the read-only half of the Phase 7.2 vault.
    fn providers(&self) -> Result<Vec<ProviderOverview>, String>;

    // -- the OmniRoute usage ledger (Phase 19 T3) ---------------------------

    /// What OmniRoute has actually routed: the newest ledger rows, the totals
    /// for today and for everything stored, and whether the management API is
    /// open at all.
    ///
    /// Fleet-wide, with no project filter, because the source has no project
    /// dimension - see [`crate::omniroute::UsageReport`]. `limit` arrives
    /// already resolved: the route applies the default and the cap.
    fn usage(&self, limit: u32) -> Result<UsageReport, String>;

    // -- budgets (Phase 18) -------------------------------------------------

    /// Every profile that has a percentage ceiling on one of its rate-limit
    /// windows. A profile with no ceiling is simply absent.
    fn list_budgets(&self) -> Result<Vec<BudgetLimits>, String>;

    /// Set one profile's ceilings and answer with what is stored afterwards.
    ///
    /// Each window is three-valued on purpose, and the route keeps the three
    /// apart: `None` leaves the window as it was, `Some(None)` removes its
    /// ceiling, `Some(Some(pct))` sets one.
    fn set_budget(
        &self,
        profile_id: &str,
        five_hour_pct: Option<Option<u8>>,
        seven_day_pct: Option<Option<u8>>,
    ) -> Result<BudgetLimits, String>;

    /// `spawned_by` is the same booking as on [`ControlBackend::create_worker`],
    /// only made before there is a worker to book: a coordinator that hit the
    /// employee cap queues the task instead, and the worker it eventually
    /// becomes is filed under her all the same.
    fn enqueue_task(
        &self,
        project_id: &str,
        raw_text: &str,
        profile_id: Option<String>,
        sharpen: bool,
        priority: Option<i32>,
        spawned_by: Option<String>,
    ) -> Result<QueueEntry, String>;

    fn list_queue(&self, project_id: Option<&str>) -> Result<Vec<QueueEntry>, String>;

    fn cancel_queued_task(&self, id: &str) -> Result<(), String>;

    // -- scout and recommendations (Phase 7.1) -----------------------------

    /// Start a project's research scout.
    fn create_scout(&self, project_id: &str) -> Result<Worker, String>;

    /// Start a scout whose assignment is judging the given repositories.
    fn triage_repos(&self, project_id: &str, urls: &[String]) -> Result<Worker, String>;

    fn list_recommendations(&self, project_id: Option<&str>)
        -> Result<Vec<Recommendation>, String>;

    /// Record a recommendation that did not come from a scout file - which is
    /// what the POST route is for: anything that is not an agent in a terminal.
    fn add_recommendation(
        &self,
        project_id: &str,
        title: &str,
        rationale: &str,
        url: Option<String>,
        effort: Option<String>,
    ) -> Result<Recommendation, String>;

    fn set_recommendation_status(&self, id: &str, status: &str) -> Result<(), String>;

    /// Queue the integration work for a recommendation and accept it.
    fn accept_recommendation(&self, id: &str) -> Result<QueueEntry, String>;

    // -- learnings (Phase 14) ----------------------------------------------

    /// Distilled learnings, filtered by project and status independently.
    fn list_learnings(
        &self,
        project_id: Option<&str>,
        status: Option<&str>,
    ) -> Result<Vec<Learning>, String>;

    /// Accept a learning with the wording it should carry into the playbook.
    ///
    /// Reachable over the port, but nothing on the agent side is told it
    /// exists: reviewing a learning is a human decision, and `pa` only lists
    /// them (see [`crate::workers::orchestrator_system_prompt`]).
    fn approve_learning(&self, id: &str, text: &str) -> Result<(), String>;

    fn reject_learning(&self, id: &str) -> Result<(), String>;

    // -- questions (Phase 21) ----------------------------------------------

    /// Ask a blocking question. `worker_id` present makes it a worker
    /// question whose answer goes back into that agent's terminal; absent
    /// makes it a preflight question, asked while a prompt is being sharpened.
    ///
    /// The answer can already be *in* the result: a worker with too many open
    /// questions is refused by the budget rule, and the row it gets back
    /// carries that refusal as its answer. See [`crate::questions`].
    fn ask_question(
        &self,
        project_id: &str,
        worker_id: Option<&str>,
        question: &str,
        options: Option<&str>,
    ) -> Result<Question, String>;

    /// Answer one open question. Unlike the learning and role verdicts this
    /// needs no second token: an agent that answers its own question has only
    /// done what it would have done by not asking at all.
    fn answer_question(
        &self,
        id: &str,
        answer: &str,
        answered_by: &str,
    ) -> Result<Question, String>;

    /// Questions, filtered by project and status independently.
    fn list_questions(
        &self,
        project_id: Option<&str>,
        status: Option<&str>,
    ) -> Result<Vec<Question>, String>;

    // -- role variants (Phase 15) ------------------------------------------

    /// Proposed roles, filtered by project and status independently.
    fn list_role_variants(
        &self,
        project_id: Option<&str>,
        status: Option<&str>,
    ) -> Result<Vec<RoleVariant>, String>;

    /// Accept a proposed role, retiring the version it replaces.
    ///
    /// Reachable over the port, but no agent is told it exists, and nothing
    /// here spawns a variant: `create_worker` is unchanged on purpose.
    /// Reviewing a role is a human decision.
    fn approve_role_variant(&self, id: &str) -> Result<(), String>;

    fn reject_role_variant(&self, id: &str) -> Result<(), String>;

    // -- activity feed (Phase 16) ------------------------------------------

    /// The fleet-wide activity feed, newest first. `limit` arrives already
    /// resolved: the route applies the default and the cap.
    fn get_activity(
        &self,
        project_id: Option<&str>,
        limit: u32,
    ) -> Result<Vec<ActivityEntry>, String>;

    // -- github (Phase 8) ---------------------------------------------------

    fn list_projects(&self) -> Result<Vec<ProjectOverview>, String>;

    /// Register a git repository. Same work as the UI's New Project dialog:
    /// the path has to already be a work tree, then it is one row in the store.
    fn create_project(&self, name: &str, repo_path: &str) -> Result<ProjectOverview, String>;

    /// Create a GitHub repository for the project and push it.
    fn create_github_repo(
        &self,
        project_id: &str,
        name: &str,
        private: bool,
    ) -> Result<String, String>;

    /// Point an existing GitHub repository at the project as `origin`.
    fn link_github_remote(&self, project_id: &str, url: &str) -> Result<(), String>;

    /// The project's landing page Markdown, or `None` when nobody has written
    /// one yet.
    fn get_landing_page(&self, project_id: &str) -> Result<Option<String>, String>;

    /// Store (or with `None`, clear) the project's landing page content.
    fn set_landing_page(&self, project_id: &str, markdown: Option<&str>) -> Result<(), String>;

    // -- daily digests (Phase 18) -------------------------------------------

    /// The dates this project has a digest for, newest first. An empty list is
    /// an ordinary answer: nothing has been written yet.
    fn list_digests(&self, project_id: &str) -> Result<Vec<String>, String>;

    /// One day's digest as Markdown, or `None` when that day has no page.
    /// The date is already known to be well formed; the route checks it before
    /// this is reached, because it becomes a file name.
    fn read_digest(&self, project_id: &str, date: &str) -> Result<Option<String>, String>;

    // -- project statistics (Phase 20) --------------------------------------

    /// One project's statistics over `range`. The range is already parsed; an
    /// unknown name is refused in the route, with the 400 it deserves.
    fn project_stats(
        &self,
        project_id: &str,
        range: crate::stats::StatsRange,
    ) -> Result<crate::stats::ProjectStats, String>;
}

/// A project with its GitHub fact attached: everything [`Project`] says plus
/// `githubRemote`, an additive field that costs nothing to read alongside it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOverview {
    #[serde(flatten)]
    pub project: Project,
    pub github_remote: bool,
}

/// One node of a project's agent hierarchy: the worker itself, with everyone
/// who named it as their controller nested underneath.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    #[serde(flatten)]
    pub worker: Worker,
    pub children: Vec<TreeNode>,
}

/// The hierarchy of one project: every coordinator - orchestrator, queen,
/// scout - with its subtree, plus the employees nobody claimed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTree {
    pub coordinators: Vec<TreeNode>,
    pub workers: Vec<TreeNode>,
}

/// Fold a flat worker list into the hierarchy its `spawned_by` fields declare.
///
/// Every worker whose `spawned_by` names another worker of the same project
/// becomes that worker's child; anyone else is a root - coordinators under
/// `coordinators`, plain employees under `workers`. A `spawned_by` pointing at
/// an id that is not in the list (archived away, mistyped) lands at the root
/// too: the tree shows every worker exactly once and never drops one because
/// its controller is gone.
///
/// A `spawned_by` cycle - `A` naming `B` while `B` names `A`, or any longer
/// ring, including a worker naming itself - leaves nobody in the ring without
/// a controller, so none of them would be a root. Such a ring is a caller
/// mistake (`spawned_by` is the caller's own declaration, not a fact the store
/// checks), and losing the ring and everything below it from the board is the
/// worst possible answer to one: the work exists, so it stays visible. One
/// member of each ring is therefore promoted to a root and the rest of the
/// ring hangs underneath it, the link that closes the ring simply left out.
///
/// The promoted member is the ring's earliest `created_at`, ties broken by the
/// smallest id - a property of the workers themselves, not of the order the
/// rows arrive in, so two calls on the same set produce the same tree. Only
/// members of the ring are promoted; a worker that merely hangs below one
/// stays nested where its `spawned_by` puts it.
pub fn build_tree(workers: &[Worker]) -> ProjectTree {
    fn is_coordinator(worker: &Worker) -> bool {
        matches!(
            worker.kind.as_str(),
            KIND_ORCHESTRATOR | KIND_QUEEN | KIND_SCOUT
        )
    }

    let known: std::collections::HashSet<&str> =
        workers.iter().map(|worker| worker.id.as_str()).collect();
    let mut children_of: HashMap<&str, Vec<&Worker>> = HashMap::new();
    let mut roots: Vec<&Worker> = Vec::new();
    for worker in workers {
        match worker.spawned_by.as_deref() {
            Some(parent) if parent != worker.id && known.contains(parent) => {
                children_of.entry(parent).or_default().push(worker);
            }
            _ => roots.push(worker),
        }
    }

    // Emit a worker with its subtree, skipping anyone already emitted.
    // `visited` is what makes a cycle terminate: the ring is walked once and
    // the edge that would close it finds its target already in the tree.
    fn node_of<'a>(
        worker: &'a Worker,
        children_of: &HashMap<&'a str, Vec<&'a Worker>>,
        visited: &mut std::collections::HashSet<&'a str>,
    ) -> TreeNode {
        visited.insert(worker.id.as_str());
        let mut children = Vec::new();
        if let Some(declared) = children_of.get(worker.id.as_str()) {
            for &child in declared {
                if visited.contains(child.id.as_str()) {
                    continue;
                }
                children.push(node_of(child, children_of, visited));
            }
        }
        TreeNode {
            worker: worker.clone(),
            children,
        }
    }

    // Does following a worker's `spawned_by` chain lead back to itself?
    // Each worker has at most one controller, so the chain is a single path
    // that either ends or runs into a ring. A worker on that ring is reached
    // again within one pass over the whole set; anything longer means the
    // chain ran into a ring the worker is not part of.
    fn on_cycle(worker: &Worker, by_id: &HashMap<&str, &Worker>) -> bool {
        let start = worker.id.as_str();
        let mut current = worker;
        for _ in 0..by_id.len() {
            let Some(declared) = current.spawned_by.as_deref() else {
                return false;
            };
            if declared == start {
                return true;
            }
            let Some(parent) = by_id.get(declared).copied() else {
                return false;
            };
            current = parent;
        }
        false
    }

    let mut visited: std::collections::HashSet<&str> = std::collections::HashSet::new();
    let mut tree = ProjectTree {
        coordinators: Vec::new(),
        workers: Vec::new(),
    };
    fn attach(tree: &mut ProjectTree, worker: &Worker, node: TreeNode) {
        if is_coordinator(worker) {
            tree.coordinators.push(node);
        } else {
            tree.workers.push(node);
        }
    }
    for worker in roots {
        let node = node_of(worker, &children_of, &mut visited);
        attach(&mut tree, worker, node);
    }

    // Whoever the roots did not reach sits on a `spawned_by` ring or below
    // one. Promote the ring members - in the documented order, so the choice
    // does not depend on the input order - and every straggler below them
    // comes along as a child of the ring it belongs to.
    let by_id: HashMap<&str, &Worker> = workers
        .iter()
        .map(|worker| (worker.id.as_str(), worker))
        .collect();
    let mut ring_members: Vec<&Worker> = workers
        .iter()
        .filter(|worker| !visited.contains(worker.id.as_str()) && on_cycle(worker, &by_id))
        .collect();
    ring_members.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    for worker in ring_members {
        if visited.contains(worker.id.as_str()) {
            continue;
        }
        let node = node_of(worker, &children_of, &mut visited);
        attach(&mut tree, worker, node);
    }
    tree
}

/// What `projecta-api.json` holds. Serialized as `{ "port", "token" }`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Descriptor {
    pub port: u16,
    pub token: String,
}

/// A running control API.
///
/// The API token is not published from here. It lives in the descriptor file,
/// which is the one place anything - the `pa` CLI, a test - is meant to get
/// it from. The field on this handle exists only so teardown can tell *our*
/// descriptor from a successor's at the same path (F1-SI-1).
///
/// The verdict token is the other way round: readable here and written
/// nowhere. This handle lives in Tauri state, so the window can ask for it
/// through `get_verdict_token` - and nothing outside this process can, because
/// there is no file to read it out of.
pub struct ApiServer {
    inner: Arc<Inner>,
    port: u16,
    descriptor: PathBuf,
    token: String,
    verdict_token: String,
}

impl ApiServer {
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Where the port and token were written.
    pub fn descriptor_path(&self) -> &Path {
        &self.descriptor
    }

    /// The token the four verdict routes ask for on top of the API token.
    pub fn verdict_token(&self) -> &str {
        &self.verdict_token
    }

    /// Delete `projecta-api.json` only when it still names this process.
    /// Missing is fine; a successor's or a malformed file is left alone.
    pub fn forget_descriptor_if_ours(&self) {
        remove_descriptor_if_ours(&self.descriptor, self.port, &self.token);
    }
}

impl Drop for ApiServer {
    fn drop(&mut self) {
        self.inner.run_credentials.revoke_all();
        // A descriptor pointing at a dead port only produces confusing errors.
        // A descriptor pointing at a *new* process must not be taken with us.
        self.forget_descriptor_if_ours();
    }
}

/// Delete the descriptor only when `port` and `token` still match the file.
///
/// Missing is success: we already left, or never wrote. Malformed JSON and a
/// mismatch (successor instance, or a hand-edited file) leave the path alone.
pub fn remove_descriptor_if_ours(path: &Path, port: u16, token: &str) {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return,
        Err(_) => return,
    };
    let Ok(descriptor) = serde_json::from_str::<Descriptor>(&raw) else {
        return;
    };
    if descriptor.port == port && token_eq(&descriptor.token, token) {
        let _ = std::fs::remove_file(path);
    }
}

/// Shared by every connection thread for the lifetime of the process.
struct Inner {
    journal_waits: ConnectionLimiter,
    run_credentials: agent_access::RunCredentials,
    backend: Arc<dyn ControlBackend>,
    token: String,
    /// Minted like `token`, published nowhere. See [`VERDICT_TOKEN_HEADER`].
    verdict_token: String,
    /// App data directory: log path and panic markers live here. The
    /// diagnosis route reports their existence, never their contents.
    app_data: PathBuf,
    /// Isolated F8 / scratch: `PROJECTA_APP_DATA` is set on this process, so
    /// `POST /api/projects` may omit the verdict token. Production leaves
    /// this false: the API token lives in a file every agent can read.
    allow_unproven_project_create: bool,
}

/// Same name as `main.rs` / `pa.rs`. Non-empty means this process is not
/// using the production AppData directory.
const ENV_APP_DATA: &str = "PROJECTA_APP_DATA";

fn isolated_app_data_override() -> bool {
    std::env::var_os(ENV_APP_DATA).is_some_and(|path| !path.is_empty())
}

/// Bind an ephemeral loopback port, publish the descriptor in `dir`, and serve.
pub fn start(backend: Arc<dyn ControlBackend>, dir: &Path) -> Result<ApiServer, String> {
    boot(backend, dir, isolated_app_data_override())
}

fn boot(
    backend: Arc<dyn ControlBackend>,
    dir: &Path,
    allow_unproven_project_create: bool,
) -> Result<ApiServer, String> {
    let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0));
    let listener =
        TcpListener::bind(addr).map_err(|e| format!("failed to bind the control api: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("failed to read the control api port: {e}"))?
        .port();

    let token = new_token()?;
    // Drawn separately rather than derived from the API token: a verdict token
    // that can be computed out of a file every agent may read would be the
    // same token twice.
    let verdict_token = new_token()?;
    let descriptor = write_descriptor(dir, port, &token)?;
    // Restart revoked every scoped grant; their files must not outlive it.
    // Safe only because the single-instance guard (main.rs) is held before
    // `api::start`: every scoped file here belongs to a dead process, or to
    // one in its exit handler whose agents are being killed (F1-SI-1).
    agent_access::sweep_orphaned_descriptor_files(dir);

    let inner = Arc::new(Inner {
        journal_waits: crate::http_util::connection_limiter_with(8),
        run_credentials: agent_access::RunCredentials::default(),
        backend,
        token: token.clone(),
        verdict_token: verdict_token.clone(),
        app_data: dir.to_path_buf(),
        allow_unproven_project_create,
    });
    let accept_inner = Arc::clone(&inner);
    std::thread::spawn(move || accept_loop(listener, accept_inner, connection_limiter()));

    Ok(ApiServer {
        inner,
        port,
        descriptor,
        token,
        verdict_token,
    })
}

/// The accept loop: one thread per connection, but no more than
/// [`crate::http_util::MAX_CONNECTIONS`] live ones - a connection past the
/// limit gets a fast 503 from this loop itself, because every thread a wedged
/// local process can conjure is memory the app no longer has.
fn accept_loop(listener: TcpListener, inner: Arc<Inner>, limiter: ConnectionLimiter) {
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let Some(permit) = try_acquire_connection(&limiter) else {
            answer_overloaded(stream);
            continue;
        };
        let inner = Arc::clone(&inner);
        std::thread::spawn(move || {
            // The permit releases itself when this connection is done.
            let _permit = permit;
            serve(stream, &inner);
        });
    }
}

/// Write `{ port, token }` where the CLI will look for it.
fn write_descriptor(dir: &Path, port: u16, token: &str) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("failed to create {}: {e}", dir.display()))?;
    let path = dir.join(DESCRIPTOR_FILE);
    let body = serde_json::to_string_pretty(&Descriptor {
        port,
        token: token.to_string(),
    })
    .map_err(|e| format!("failed to render the api descriptor: {e}"))?;
    write_descriptor_body(&path, body.as_bytes())?;

    // The token is a key to this app; on unix the file says so. On Windows
    // `write_descriptor_body` already narrowed the DACL fail-closed.
    crate::oneshot::make_private(&path);

    Ok(path)
}

/// Windows: the broad descriptor holds the same key to the app as a scoped
/// one, so it gets the same treatment (W2-07b). The file is opened with share
/// mode 0 (with a bounded retry on sharing violations), planted links and a
/// foreign owner are refused before a byte changes, and its DACL is narrowed
/// to the current user before the token touches the disk; a file that cannot
/// be narrowed fails startup closed instead of being trusted.
#[cfg(windows)]
fn write_descriptor_body(path: &Path, body: &[u8]) -> Result<(), String> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Foundation::GENERIC_WRITE;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_OPEN_REPARSE_POINT, READ_CONTROL, WRITE_DAC,
    };
    let mut file = credential_acl::open_with_sharing_retry(
        &format!("failed to open {}", path.display()),
        || {
            std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .access_mode(GENERIC_WRITE | WRITE_DAC | READ_CONTROL)
                .share_mode(0)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
                .open(path)
        },
    )?;
    // No truncate at open: a refused file keeps its previous content (the
    // running instance's descriptor), and only a verified file is emptied.
    credential_acl::refuse_links(&file, &path.display().to_string())?;
    credential_acl::verify_owned(&file)?;
    credential_acl::restrict_to_current_user(&file)?;
    file.set_len(0)
        .and_then(|()| file.write_all(body))
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("failed to write {}: {e}", path.display()))
}

#[cfg(not(windows))]
fn write_descriptor_body(path: &Path, body: &[u8]) -> Result<(), String> {
    std::fs::write(path, body).map_err(|e| format!("failed to write {}: {e}", path.display()))
}

/// A 128 bit hex token, drawn from the operating system's random source.
///
/// This token is the only thing between another process on this machine and an
/// API that starts agents and creates repositories, so it comes out of a CSPRNG
/// rather than out of hashing what is already public. The version this replaced
/// mixed the clock and the process id through two `RandomState` hashers: both
/// inputs are guessable, so all of its real entropy was the one OS seed std
/// hands the process, spent twice through related keys.
///
/// `getrandom` is not new weight in the dependency tree - `tauri` already
/// depends on it, so this is a crate the app compiles either way.
///
/// A failing random source aborts startup instead of falling back. A weaker
/// token that nobody notices is worse than an app that says why it did not
/// start.
fn new_token() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| format!("failed to draw an api token: {e}"))?;
    Ok(format!("{:032x}", u128::from_be_bytes(bytes)))
}

// -- request handling ------------------------------------------------------

/// One decoded request: the parts a route needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub method: String,
    /// Path with the query string removed, still percent-encoded.
    pub path: String,
    pub query: HashMap<String, String>,
    /// Header names lower-cased.
    pub headers: HashMap<String, String>,
    pub body: String,
}

impl Request {
    fn segments(&self) -> Vec<String> {
        self.path
            .split('/')
            .filter(|segment| !segment.is_empty())
            .map(percent_decode)
            .collect()
    }
}

/// What a route answers with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub body: String,
}

impl Response {
    fn json(status: u16, body: Value) -> Self {
        Self {
            status,
            body: body.to_string(),
        }
    }

    fn ok(body: Value) -> Self {
        Self::json(200, body)
    }

    fn error(status: u16, message: impl Into<String>) -> Self {
        Self::json(status, json!({ "error": message.into() }))
    }

    fn reason(&self) -> &'static str {
        match self.status {
            200 => "OK",
            400 => "Bad Request",
            401 => "Unauthorized",
            403 => "Forbidden",
            404 => "Not Found",
            405 => "Method Not Allowed",
            409 => "Conflict",
            410 => "Gone",
            503 => "Service Unavailable",
            _ => "Internal Server Error",
        }
    }
}

/// Handle one connection: read, authenticate, route, answer.
fn serve(mut stream: TcpStream, inner: &Inner) {
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));

    let response = match crate::hooks::read_request(&mut stream) {
        Some((head, body)) => match parse_request(&head, body) {
            Some(request) => handle(inner, &request),
            None => Response::error(400, "malformed request"),
        },
        None => Response::error(400, "malformed request"),
    };

    let _ = stream.write_all(
        format!(
            "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\
             Connection: close\r\n\r\n{}",
            response.status,
            response.reason(),
            response.body.len(),
            response.body
        )
        .as_bytes(),
    );
    let _ = stream.flush();
}

/// Check the tokens, then route.
///
/// Two gates, in the order of what they say: the API token decides whether the
/// caller may talk to this app at all (401), the verdict token whether this
/// particular caller may speak for the human (403). A request that fails the
/// first never reaches the second, so a wrong API token still reads as a wrong
/// API token on a verdict route.
///
/// A scoped run credential never reaches this router directly: it gets its
/// own routes, and the planning writes only through the coordinator gate in
/// `planning_access` (W2-04f).
fn handle(inner: &Inner, request: &Request) -> Response {
    match request.headers.get(TOKEN_HEADER) {
        Some(token) if token_eq(token, &inner.token) => {}
        Some(token) => match inner.run_credentials.lookup(token) {
            Some(grant) if planning_access::is_planning(request) => {
                let (run, owner, fence) = grant.principal();
                return planning_access::handle(inner, request, run, owner, fence);
            }
            Some(grant) => return agent_access::handle_run(inner, request, grant),
            None => return Response::error(401, "invalid api token"),
        },
        None => return Response::error(401, format!("missing {TOKEN_HEADER} header")),
    }

    let proof = match request.headers.get(VERDICT_TOKEN_HEADER) {
        None => VerdictProof::Absent,
        Some(token) if token_eq(token, &inner.verdict_token) => VerdictProof::Proven,
        Some(_) => VerdictProof::Wrong,
    };

    if is_verdict(request) {
        match proof {
            VerdictProof::Proven => {}
            VerdictProof::Wrong => return Response::error(403, "invalid verdict token"),
            VerdictProof::Absent => {
                return Response::error(
                    403,
                    format!(
                        "missing {VERDICT_TOKEN_HEADER} header: approving or rejecting is a \
                         human decision, and the token for it is held by the window and by \
                         `pa --verdict-token` alone"
                    ),
                )
            }
        }
    }

    route(inner, request, proof)
}

/// Whether a request carried the verdict token, and whether it was the right
/// one.
///
/// Two routes care, for two different reasons. The four verdict routes *need*
/// it and are refused without it. `POST /api/questions/<id>/answer` only
/// *records* it: answering is not a privilege - the answer reaches one agent's
/// own terminal and nothing else - but "a person decided this" is a claim, and
/// this header is the only thing that can back it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum VerdictProof {
    /// The header was there and matched.
    Proven,
    /// No header at all.
    Absent,
    /// A header that did not match. Never quietly folded into `Absent`: a
    /// caller who sent a token meant to prove something, and filing that
    /// answer as unverified would swallow a typo in the one place it matters.
    Wrong,
}

/// Whether this request is one of the four human verdicts.
///
/// Only the POSTs. A GET on the same path is a caller who used the wrong verb,
/// and [`route`] tells them that - answering 403 there would send them looking
/// for a token they do not need.
fn is_verdict(request: &Request) -> bool {
    if request.method != "POST" {
        return false;
    }
    let segments = request.segments();
    let path: Vec<&str> = segments.iter().map(String::as_str).collect();
    matches!(
        path.as_slice(),
        ["api", "learnings", _, "approve" | "reject"]
            | ["api", "roles", _, "approve" | "reject"]
            | ["api", "workers", _, "merge"]
    )
}

/// `POST /api/projects` is a human write, but isolated F8 must be able to
/// register a scratch repo without the window. Production therefore demands
/// the verdict token; a process started with `PROJECTA_APP_DATA` does not.
fn refuse_unproven_project_create(inner: &Inner, proof: VerdictProof) -> Option<Response> {
    if inner.allow_unproven_project_create {
        return None;
    }
    match proof {
        VerdictProof::Proven => None,
        VerdictProof::Wrong => Some(Response::error(403, "invalid verdict token")),
        VerdictProof::Absent => Some(Response::error(
            403,
            format!(
                "missing {VERDICT_TOKEN_HEADER} header: registering a project is a \
                 human decision, and the token for it is held by the window and by \
                 `pa --verdict-token` alone"
            ),
        )),
    }
}

fn route(inner: &Inner, request: &Request, proof: VerdictProof) -> Response {
    let backend = inner.backend.as_ref();
    let segments = request.segments();
    let path: Vec<&str> = segments.iter().map(String::as_str).collect();
    let method = request.method.as_str();
    let project_id = request.query.get("projectId").map(String::as_str);
    let status = request.query.get("status").map(String::as_str);

    match (method, path.as_slice()) {
        (_, ["api", "hq", "v1", "agent", ..]) => {
            Response::error(403, "this route requires a scoped run credential")
        }
        ("GET", ["api", "hq", "v1", "runtime"]) => {
            continuous_response(backend.continuous_runtime())
        }
        ("GET", ["api", "hq", "v1", "plan"]) => {
            if request
                .query
                .keys()
                .any(|key| !matches!(key.as_str(), "projectId" | "planId" | "revision"))
            {
                return Response::error(400, "unknown plan query field");
            }
            let project_id = match project_id.map(str::trim).filter(|value| !value.is_empty()) {
                Some(value) => value,
                None => return Response::error(400, "projectId is required"),
            };
            let plan_id = match request
                .query
                .get("planId")
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                Some(value) => value,
                None => return Response::error(400, "planId is required"),
            };
            let revision = match request.query.get("revision") {
                Some(raw) => match raw.parse::<i64>() {
                    Ok(value) if value > 0 => Some(value),
                    _ => return Response::error(400, "revision must be a positive integer"),
                },
                None => None,
            };
            plan_response(backend.development_plan(project_id, plan_id, revision))
        }
        ("POST", ["api", "hq", "v1", "plan", "import"]) => {
            if !request.query.is_empty() {
                return Response::error(400, "plan import does not accept query fields");
            }
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(error) => return Response::error(400, error),
            };
            if let Err(error) = only_keys(
                &body,
                &[
                    "projectId",
                    "planId",
                    "expectedProjectionRevision",
                    "rollbackReason",
                ],
            ) {
                return Response::error(400, error);
            }
            let project_id = match required_str(&body, "projectId") {
                Ok(value) => value,
                Err(error) => return Response::error(400, error),
            };
            let plan_id = match required_str(&body, "planId") {
                Ok(value) => value,
                Err(error) => return Response::error(400, error),
            };
            let expected = match body
                .get("expectedProjectionRevision")
                .and_then(Value::as_i64)
            {
                Some(value) if (0..i64::MAX).contains(&value) => value,
                _ => return Response::error(
                    400,
                    "expectedProjectionRevision must be non-negative and below the maximum integer",
                ),
            };
            let rollback_reason = match body.get("rollbackReason") {
                None => None,
                Some(Value::String(value)) => Some(value.as_str()),
                Some(_) => return Response::error(400, "rollbackReason must be a string"),
            };
            plan_response(backend.import_development_plan(
                &project_id,
                &plan_id,
                expected,
                rollback_reason,
            ))
        }
        ("GET", ["api", "hq", "v1", "runs"]) => {
            let project_id = match project_id {
                Some(value) if !value.is_empty() => value,
                _ => return Response::error(400, "projectId is required"),
            };
            if let Some(reply) = unknown_project(backend, Some(project_id)) {
                return reply;
            }
            continuous_response(backend.development_records(project_id))
        }
        ("GET", ["api", "hq", "v1", resource]) if matches!(*resource, "context" | "changes") => {
            let project_id = match project_id {
                Some(value) if !value.is_empty() => value,
                _ => return Response::error(400, "projectId is required"),
            };
            let cursor = match request.query.get("cursor") {
                Some(value) => match value.parse::<i64>() {
                    Ok(value) if value >= 0 => value,
                    _ => return Response::error(400, "cursor must be a non-negative integer"),
                },
                None => 0,
            };
            if *resource == "changes" {
                let wait_ms = match request.query.get("waitMs") {
                    Some(value) => match value.parse::<u64>() {
                        Ok(value) if value <= 25_000 => value,
                        _ => return Response::error(400, "waitMs must be between 0 and 25000"),
                    },
                    None => 0,
                };
                if let Some(reply) = unknown_project(backend, Some(project_id)) {
                    return reply;
                }
                if wait_ms == 0 {
                    continuous_response(backend.continuous_changes(project_id, cursor))
                } else {
                    let Some(_permit) = try_acquire_connection(&inner.journal_waits) else {
                        return Response::error(
                            503,
                            "continuous journal waiting capacity exhausted",
                        );
                    };
                    continuous_response(
                        backend.wait_continuous_changes(project_id, cursor, wait_ms),
                    )
                }
            } else {
                if request.query.contains_key("waitMs") {
                    return Response::error(400, "waitMs is supported only by changes");
                }
                continuous_response(backend.continuous_context(project_id, cursor))
            }
        }
        ("GET", ["api", "hq", "v1", "goals"]) => {
            let project_id = match project_id {
                Some(value) if !value.is_empty() => value,
                _ => return Response::error(400, "projectId is required"),
            };
            match backend.list_continuous_goals(project_id) {
                Ok(goals) => Response::ok(json!({ "goals": goals })),
                Err(err) => continuous_error(err),
            }
        }
        ("POST", ["api", "hq", "v1", "goals"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            if let Err(err) = only_keys(
                &body,
                &[
                    "projectId",
                    "objective",
                    "acceptanceCriteria",
                    "sourceGoalId",
                    "admit",
                ],
            ) {
                return Response::error(400, err);
            }
            let project_id = match required_str(&body, "projectId") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let objective = match required_str(&body, "objective") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let admit = match optional_bool(&body, "admit") {
                Ok(value) => value.unwrap_or(false),
                Err(err) => return Response::error(400, err),
            };
            match backend.create_continuous_goal(
                &project_id,
                &objective,
                optional_str(&body, "acceptanceCriteria"),
                optional_str(&body, "sourceGoalId"),
                admit,
            ) {
                Ok(goal) => Response::ok(json!({ "goal": goal })),
                Err(err) => continuous_error(err),
            }
        }
        ("POST", ["api", "hq", "v1", "goals", goal_id, "tasks"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let objective = match required_str(&body, "objective") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let owned_paths = match string_array(&body, "ownedPaths") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let dependencies = match string_array(&body, "dependencies") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            match backend.create_continuous_task(
                goal_id,
                &objective,
                optional_str(&body, "profileId"),
                owned_paths,
                dependencies,
            ) {
                Ok(task) => Response::ok(json!({ "task": task })),
                Err(err) => continuous_error(err),
            }
        }
        ("GET", ["api", "hq", "v1", "tasks", task_id, "assignment"]) => {
            match backend.continuous_task_assignment(task_id) {
                Ok(assignment) => Response::ok(
                    json!({"apiVersion":1,"source":"rust/sqlite","assignment":assignment,"approvalAuthority":false}),
                ),
                Err(error) => continuous_error(error),
            }
        }
        ("POST", ["api", "hq", "v1", "tasks", task_id, "assignment"]) => {
            let body = match serde_json::from_str::<crate::store::team_assignments::AssignmentRequest>(
                &request.body,
            ) {
                Ok(body) => body,
                Err(error) => {
                    return Response::error(400, format!("invalid team assignment: {error}"))
                }
            };
            match backend.assign_continuous_task(task_id, body) {
                Ok(assignment) => Response::ok(
                    json!({"apiVersion":1,"source":"rust/sqlite","assignment":assignment,"approvalAuthority":false}),
                ),
                Err(error) => continuous_error(error),
            }
        }
        ("POST", ["api", "hq", "v1", "tasks", task_id, "claim"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let owner = match required_str(&body, "owner") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let escalation = body
                .get("escalation")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            match backend.claim_continuous_task(task_id, &owner, escalation) {
                Ok(claim) => Response::ok(json!({ "claim": claim })),
                Err(err) => continuous_error(err),
            }
        }
        ("POST", ["api", "hq", "v1", "tasks", task_id, "checkpoint"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let owner = match required_str(&body, "owner") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let fence = match body.get("fence").and_then(Value::as_i64) {
                Some(value) if value > 0 => value,
                _ => return Response::error(400, "fence must be a positive integer"),
            };
            let status = body
                .get("status")
                .and_then(Value::as_str)
                .map(str::to_string);
            let detail = body
                .get("detail")
                .and_then(Value::as_str)
                .map(str::to_string);
            match backend.checkpoint_continuous_task(task_id, &owner, fence, status, detail) {
                Ok(task) => Response::ok(json!({ "task": task })),
                Err(err) => continuous_error(err),
            }
        }
        ("POST", ["api", "hq", "v1", "control"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let project_id = match required_str(&body, "projectId") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let action = match required_str(&body, "action") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            continuous_response(backend.control_continuous(&project_id, &action))
        }
        ("GET", ["api", "health"]) => Response::ok(json!({ "ok": true })),

        ("GET", ["api", "diagnosis"]) => {
            let log_path = crate::logging::log_file(&inner.app_data);
            let (current, previous) = crate::logging::read_panic_markers(&inner.app_data);
            Response::ok(json!({
                "logPath": log_path.to_string_lossy(),
                "panicCurrent": current.is_some(),
                "panicPrevious": previous.is_some(),
            }))
        }

        ("POST", ["api", "workers"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let project_id = match required_str(&body, "projectId") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let task = match required_str(&body, "task") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let profile_id = body
                .get("profileId")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(DEFAULT_PROFILE);
            core_response(backend.create_worker(
                &project_id,
                &task,
                profile_id,
                optional_str(&body, "spawnedBy"),
            ))
        }

        ("POST", ["api", "queens"]) => {
            // Rev 9: queens remain readable. A 410 is the write-route refusal,
            // not a missing handler — GET is already 405.
            Response::error(410, crate::workers::ERR_QUEEN_RETIRED)
        }

        ("GET", ["api", "workers"]) => {
            if let Some(reply) = unknown_project(backend, project_id) {
                return reply;
            }
            into_response(backend.list_workers(project_id))
        }

        ("GET", ["api", "workers", worker_id]) => match backend.worker_state(worker_id) {
            Ok(Some(state)) => into_response(Ok(state)),
            Ok(None) => Response::error(404, format!("unknown worker: {worker_id}")),
            Err(err) => Response::error(500, err),
        },

        ("GET", ["api", "workers", worker_id, "messages"]) => {
            // `list_messages` answers an unknown id with an empty set, which
            // reads exactly like a worker that has not said anything yet. Ask
            // first, so a typo in the id is a 404 here as it is one segment up.
            match backend.worker_state(worker_id) {
                Ok(Some(_)) => {}
                Ok(None) => return Response::error(404, format!("unknown worker: {worker_id}")),
                Err(err) => return Response::error(500, err),
            }
            let limit = request
                .query
                .get("limit")
                .and_then(|value| value.parse().ok());
            into_response(backend.list_worker_messages(worker_id, limit))
        }

        ("POST", ["api", "workers", worker_id, "send"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            // An empty line is a legitimate thing to send - it is how you say
            // "yes, go on" to an agent waiting at a prompt - so `text` only has
            // to be present, not filled in.
            let Some(text) = body.get("text").and_then(Value::as_str) else {
                return Response::error(400, "text is required");
            };
            match backend.send_to_worker(worker_id, text) {
                Ok(()) => Response::ok(json!({ "ok": true })),
                // No session for this id: either the worker never existed or
                // its agent has exited. The backend cannot tell those apart, so
                // neither can this - and 409 is true of both, where 404 would
                // claim a worker that is merely finished does not exist.
                Err(err) if err.contains("has no running agent") => Response::error(409, err),
                Err(err) => Response::error(500, err),
            }
        }

        ("POST", ["api", "workers", worker_id, "merge"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            // An empty body is the ordinary call. The flag is read under both
            // spellings: `removeWorktree` is the house style everywhere else on
            // this port, `remove_worktree` is what the CLI flag is called.
            let remove_worktree = body
                .get("removeWorktree")
                .or_else(|| body.get("remove_worktree"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            match backend.merge_worker(worker_id, remove_worktree) {
                Ok(worker) => into_response(Ok(worker)),
                Err(err) => Response::error(merge_status(&err), err),
            }
        }

        ("GET", ["api", "board"]) => {
            if let Some(reply) = unknown_project(backend, project_id) {
                return reply;
            }
            into_response(backend.board(project_id))
        }

        ("GET", ["api", "quota"]) => into_response(backend.quota()),

        // Not `/api/projects/<id>/usage`: OmniRoute's log is keyed by provider
        // account and carries nothing that could be narrowed to one project,
        // so a per-project route would answer every project identically.
        ("GET", ["api", "usage"]) => {
            let limit = request
                .query
                .get("limit")
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or(USAGE_LIMIT_DEFAULT)
                .clamp(1, USAGE_LIMIT_MAX);
            into_response(backend.usage(limit))
        }

        // Read only on purpose: a key is typed into the app, never posted to a
        // port other processes on this machine can reach.
        ("GET", ["api", "providers"]) => into_response(backend.providers()),

        // -- budgets (Phase 18) ----------------------------------------------
        ("GET", ["api", "budgets"]) => into_response(backend.list_budgets()),

        // PUT, not POST: this replaces one profile's ceilings rather than
        // adding to a collection, and sending the same body twice has to mean
        // the same thing both times.
        ("PUT", ["api", "budgets"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let profile_id = match required_str(&body, "profileId") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let five_hour = match optional_percent(&body, "fiveHourPct") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let seven_day = match optional_percent(&body, "sevenDayPct") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            if five_hour.is_none() && seven_day.is_none() {
                return Response::error(
                    400,
                    "fiveHourPct or sevenDayPct is required; send null to clear one",
                );
            }
            match backend.set_budget(&profile_id, five_hour, seven_day) {
                Ok(limits) => into_response(Ok(limits)),
                // Everything this backend refuses here is a value the caller
                // chose: a profile id that names nothing is a 404, a
                // percentage it cannot store is a 400.
                Err(err) if err.starts_with(crate::workers::ERR_UNKNOWN) => {
                    Response::error(404, err)
                }
                Err(err) => Response::error(400, err),
            }
        }

        ("POST", ["api", "queue"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let project_id = match required_str(&body, "projectId") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let raw_text = match required_str(&body, "rawText") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let profile_id = body
                .get("profileId")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string);
            let sharpen = body
                .get("sharpen")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let priority = body
                .get("priority")
                .and_then(Value::as_i64)
                .and_then(|value| i32::try_from(value).ok());
            let spawned_by = optional_str(&body, "spawnedBy");
            core_response(backend.enqueue_task(
                &project_id,
                &raw_text,
                profile_id,
                sharpen,
                priority,
                spawned_by,
            ))
        }

        ("GET", ["api", "queue"]) => {
            if let Some(reply) = unknown_project(backend, project_id) {
                return reply;
            }
            into_response(backend.list_queue(project_id))
        }

        ("POST", ["api", "queue", id, "cancel"]) => core_response(
            backend
                .cancel_queued_task(id)
                .map(|()| json!({ "ok": true })),
        ),

        // -- scout and recommendations (Phase 7.1) -------------------------
        ("POST", ["api", "scout"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let project_id = match required_str(&body, "projectId") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            core_response(backend.create_scout(&project_id))
        }

        ("POST", ["api", "scout", "triage"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let project_id = match required_str(&body, "projectId") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let urls: Vec<String> = body
                .get("urls")
                .and_then(Value::as_array)
                .map(|urls| {
                    urls.iter()
                        .filter_map(Value::as_str)
                        .map(str::trim)
                        .filter(|url| !url.is_empty())
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            if urls.is_empty() {
                return Response::error(400, "urls is required");
            }
            core_response(backend.triage_repos(&project_id, &urls))
        }

        ("GET", ["api", "recommendations"]) => {
            if let Some(reply) = unknown_project(backend, project_id) {
                return reply;
            }
            into_response(backend.list_recommendations(project_id))
        }

        ("POST", ["api", "recommendations"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let project_id = match required_str(&body, "projectId") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let title = match required_str(&body, "title") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let rationale = match required_str(&body, "rationale") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            core_response(backend.add_recommendation(
                &project_id,
                &title,
                &rationale,
                optional_str(&body, "url"),
                optional_str(&body, "effort"),
            ))
        }

        ("POST", ["api", "recommendations", id, "accept"]) => {
            core_response(backend.accept_recommendation(id))
        }

        ("POST", ["api", "recommendations", id, "status"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let status = match required_str(&body, "status") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            // The vocabulary is the one part of this request the route can
            // decide on its own, as with the GitHub url and the digest date, so
            // it is decided here and stays a 400 once the core speaks in
            // statuses. That is not symmetry for its own sake: the core's own
            // refusal reads `unknown recommendation status: …` (`scout.rs:434`),
            // which opens with [`crate::workers::ERR_UNKNOWN`], so
            // [`core_status`] would answer 404 - and 404 here means "an id that
            // names nothing", which this is not. The check has to stay in front
            // of the core, however redundant it looks beside `scout.rs`.
            // Behind it the core's own words are read: this route
            // answered 400 for every failure, one line below the `accept` route
            // that had already learned to tell them apart - an id that names
            // nothing and a store that fell over both came back as the caller's
            // mistake, which tells a script to fix a request that was fine.
            if status != crate::store::REC_ACCEPTED && status != crate::store::REC_DISMISSED {
                return Response::error(
                    400,
                    format!(
                        "unknown recommendation status: {status} (expected {} or {})",
                        crate::store::REC_ACCEPTED,
                        crate::store::REC_DISMISSED
                    ),
                );
            }
            // Not [`core_response`]: the reply is `{ok: true}`, which a
            // serialized `()` is not. Only the reading of the failure is shared.
            match backend.set_recommendation_status(id, &status) {
                Ok(()) => Response::ok(json!({ "ok": true })),
                Err(err) => Response::error(core_status(&err), err),
            }
        }

        // -- learnings (Phase 14) --------------------------------------------
        ("GET", ["api", "learnings"]) => {
            if let Some(reply) = unknown_project(backend, project_id) {
                return reply;
            }
            into_response(backend.list_learnings(project_id, status))
        }

        ("POST", ["api", "learnings", id, "approve"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            // Unlike `worker send`, blank is not a legitimate value here: an
            // empty learning would put an empty bullet into the playbook.
            let text = match required_str(&body, "text") {
                Ok(value) => value,
                Err(_) => return Response::error(400, "text is required and must not be empty"),
            };
            match backend.approve_learning(id, &text) {
                Ok(()) => Response::ok(json!({ "ok": true })),
                Err(err) => Response::error(verdict_status(&err), err),
            }
        }

        ("POST", ["api", "learnings", id, "reject"]) => match backend.reject_learning(id) {
            Ok(()) => Response::ok(json!({ "ok": true })),
            Err(err) => Response::error(verdict_status(&err), err),
        },

        // -- questions (Phase 21) --------------------------------------------
        ("POST", ["api", "questions"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let project_id = match required_str(&body, "projectId") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            // A question with nothing in it is the one thing this route can
            // judge on its own, so it does - the core refuses it too, but a
            // 400 says whose mistake it was.
            let question = match required_str(&body, "question") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            // An absent `workerId` is not a mistake: that is a preflight
            // question, asked before there is a worker to ask it.
            let worker_id = optional_str(&body, "workerId");
            let options = optional_str(&body, "options");
            core_response(backend.ask_question(
                &project_id,
                worker_id.as_deref(),
                &question,
                options.as_deref(),
            ))
        }

        ("GET", ["api", "questions"]) => {
            if let Some(reply) = unknown_project(backend, project_id) {
                return reply;
            }
            into_response(backend.list_questions(project_id, status))
        }

        ("POST", ["api", "questions", id, "answer"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            // Only has to be present, like `text` on `send`: an empty answer
            // is a legitimate decision ("go on, it does not matter").
            let Some(answer) = body.get("answer").and_then(Value::as_str) else {
                return Response::error(400, "answer is required");
            };
            // Not a gate: an answer without the token is accepted, it is
            // just not filed as evidence of a person. A *wrong* token is
            // refused, because it was sent in order to prove something.
            let answered_by = match proof {
                VerdictProof::Proven => crate::store::ANSWERED_BY_HUMAN,
                VerdictProof::Absent => crate::store::ANSWERED_BY_UNVERIFIED,
                VerdictProof::Wrong => return Response::error(403, "invalid verdict token"),
            };
            core_response(backend.answer_question(id, answer, answered_by))
        }

        // -- role variants (Phase 15) ----------------------------------------
        ("GET", ["api", "roles"]) => {
            if let Some(reply) = unknown_project(backend, project_id) {
                return reply;
            }
            into_response(backend.list_role_variants(project_id, status))
        }

        // Neither verdict carries a body: the proposal is what it is, and a
        // reviewer either wants it or does not.
        ("POST", ["api", "roles", id, "approve"]) => match backend.approve_role_variant(id) {
            Ok(()) => Response::ok(json!({ "ok": true })),
            Err(err) => Response::error(verdict_status(&err), err),
        },

        ("POST", ["api", "roles", id, "reject"]) => match backend.reject_role_variant(id) {
            Ok(()) => Response::ok(json!({ "ok": true })),
            Err(err) => Response::error(verdict_status(&err), err),
        },

        // -- activity feed (Phase 16) --------------------------------------
        ("GET", ["api", "activity"]) => {
            // Read-only by construction: the feed is a view over tables the
            // other routes write. An absent or unreadable limit is the
            // default, anything above the cap is the cap.
            if let Some(reply) = unknown_project(backend, project_id) {
                return reply;
            }
            let limit = request
                .query
                .get("limit")
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or(50)
                .min(200);
            into_response(backend.get_activity(project_id, limit))
        }

        // -- github (Phase 8) ------------------------------------------------
        ("GET", ["api", "projects"]) => into_response(backend.list_projects()),

        ("POST", ["api", "projects"]) => {
            // The API token is in a file every agent may read. Registering a
            // repository would let a worker spawn into a checkout it was not
            // given, so this write needs the verdict token - unless this
            // process is an isolated F8 scratch (`PROJECTA_APP_DATA`).
            if let Some(denied) = refuse_unproven_project_create(inner, proof) {
                return denied;
            }
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let name = match required_str(&body, "name") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            let repo_path = match required_str(&body, "repoPath") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            core_response(backend.create_project(&name, &repo_path))
        }

        ("GET", ["api", "projects", project_id, "tree"]) => {
            if let Some(reply) = unknown_project(backend, Some(project_id)) {
                return reply;
            }
            // The tree is a view over the flat worker list, built here in the
            // route - the store needs no new query for it.
            match backend.list_workers(Some(project_id)) {
                Ok(workers) => into_response(Ok(build_tree(&workers))),
                Err(err) => Response::error(500, err),
            }
        }

        ("GET", ["api", "projects", project_id, "learnings"]) => {
            if let Some(reply) = unknown_project(backend, Some(project_id)) {
                return reply;
            }
            into_response(backend.list_learnings(Some(project_id), status))
        }

        ("GET", ["api", "projects", project_id, "roles"]) => {
            if let Some(reply) = unknown_project(backend, Some(project_id)) {
                return reply;
            }
            into_response(backend.list_role_variants(Some(project_id), status))
        }

        ("POST", ["api", "projects", project_id, "orchestrator", "send"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            // An empty message is a bare Enter, exactly as on `worker send`,
            // so the field only has to be present.
            let text = match body.get("text").and_then(Value::as_str) {
                Some(text) => text,
                None => return Response::error(400, "text is required"),
            };
            core_response(backend.send_to_orchestrator(project_id, text))
        }

        ("POST", ["api", "projects", project_id, "github", "create"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let name = match required_str(&body, "name") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            // As with the url on `link`: the core checks the name too, but a
            // name GitHub would not take is the caller's mistake, and behind
            // the core it is indistinguishable from `gh` falling over.
            if let Err(err) = crate::gh::validate_repo_name(&name) {
                return Response::error(400, err);
            }
            // Private is the safe default: an omission must not publish code.
            let private = body.get("private").and_then(Value::as_bool).unwrap_or(true);
            core_response(backend.create_github_repo(project_id, &name, private))
        }

        ("POST", ["api", "projects", project_id, "github", "link"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            let url = match required_str(&body, "url") {
                Ok(value) => value,
                Err(err) => return Response::error(400, err),
            };
            // Judged here as well as in the core, like the digest date one
            // route down: the shape of the url is the one part of this request
            // the route can decide on its own, and deciding it here is what
            // keeps it a 400 once everything behind it speaks in statuses.
            if let Err(err) = crate::gh::valid_github_url(&url) {
                return Response::error(400, err);
            }
            // Not [`core_response`] itself: the reply on the way out is
            // `{ok: true}`, which a serialized `()` is not. Only the reading of
            // the failure is shared, and that is the part that was wrong.
            match backend.link_github_remote(project_id, &url) {
                Ok(()) => Response::ok(json!({ "ok": true })),
                Err(err) => Response::error(core_status(&err), err),
            }
        }

        // -- daily digests (Phase 18) ----------------------------------------
        ("GET", ["api", "projects", project_id, "digests"]) => {
            match backend.list_digests(project_id) {
                Ok(dates) => into_response(Ok(dates)),
                Err(err) if err.starts_with(crate::workers::ERR_UNKNOWN) => {
                    Response::error(404, err)
                }
                Err(err) => Response::error(500, err),
            }
        }

        ("GET", ["api", "projects", project_id, "digests", date]) => {
            // Checked here rather than in the backend: the date becomes a file
            // name, so the shape is refused before it reaches a path at all.
            if !crate::digest::is_valid_date(date) {
                return Response::error(400, format!("not a date: {date}"));
            }
            match backend.read_digest(project_id, date) {
                Ok(Some(markdown)) => Response::ok(json!({ "date": date, "markdown": markdown })),
                Ok(None) => Response::error(404, format!("no digest for {date}")),
                Err(err) if err.starts_with(crate::workers::ERR_UNKNOWN) => {
                    Response::error(404, err)
                }
                Err(err) => Response::error(500, err),
            }
        }

        // -- project statistics (Phase 20) -----------------------------------
        ("GET", ["api", "projects", project_id, "stats"]) => {
            // An absent `range` is "all"; a *given* one that names no window
            // is a 400. Widening it silently would answer a question nobody
            // asked, under the label of the one they did.
            let range = match request.query.get("range").map(String::as_str) {
                None | Some("") => crate::stats::StatsRange::All,
                Some(name) => match crate::stats::StatsRange::parse(name) {
                    Some(range) => range,
                    None => {
                        return Response::error(
                            400,
                            format!("unknown range: {name} (today, week, month, all, 7d or 30d)"),
                        )
                    }
                },
            };
            core_response(backend.project_stats(project_id, range))
        }

        // -- landing pages ---------------------------------------------------
        ("GET", ["api", "projects", project_id, "landing-page"]) => {
            match backend.get_landing_page(project_id) {
                Ok(markdown) => Response::ok(json!({ "markdown": markdown })),
                Err(err) if err.starts_with("unknown project") => Response::error(404, err),
                Err(err) => Response::error(500, err),
            }
        }

        ("POST", ["api", "projects", project_id, "landing-page"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(err) => return Response::error(400, err),
            };
            // Absent and null mean the same thing here: clear the page. The
            // content itself is stored verbatim - Markdown is whitespace
            // sensitive, so trimming could break a fenced block.
            let markdown = body.get("markdown").and_then(Value::as_str);
            match backend.set_landing_page(project_id, markdown) {
                Ok(()) => Response::ok(json!({ "ok": true })),
                Err(err) if err.starts_with("unknown project") => Response::error(404, err),
                Err(err) => Response::error(500, err),
            }
        }

        // A known collection reached with the wrong verb is worth saying out
        // loud; anything else is simply not a route. Every shape the match
        // above answers appears here, so "no such route" always means the path
        // is wrong and never that the verb is - the list used to hold half of
        // them, and `send` sitting between `messages` and `merge` was the one
        // most likely to be reached by hand.
        (_, ["api", "health"])
        | (_, ["api", "diagnosis"])
        | (_, ["api", "workers"])
        | (_, ["api", "workers", _])
        | (_, ["api", "workers", _, "messages"])
        | (_, ["api", "workers", _, "send"])
        | (_, ["api", "workers", _, "merge"])
        | (_, ["api", "queens"])
        | (_, ["api", "board"])
        | (_, ["api", "quota"])
        | (_, ["api", "budgets"])
        | (_, ["api", "providers"])
        | (_, ["api", "queue"])
        | (_, ["api", "queue", _, "cancel"])
        | (_, ["api", "scout"])
        | (_, ["api", "scout", "triage"])
        | (_, ["api", "projects"])
        | (_, ["api", "projects", _, "tree"])
        | (_, ["api", "projects", _, "orchestrator", "send"])
        | (_, ["api", "projects", _, "github", "create"])
        | (_, ["api", "projects", _, "github", "link"])
        | (_, ["api", "projects", _, "landing-page"])
        | (_, ["api", "projects", _, "digests"])
        | (_, ["api", "projects", _, "digests", _])
        | (_, ["api", "projects", _, "stats"])
        | (_, ["api", "projects", _, "learnings"])
        | (_, ["api", "projects", _, "roles"])
        | (_, ["api", "learnings"])
        | (_, ["api", "learnings", _, "approve" | "reject"])
        | (_, ["api", "roles"])
        | (_, ["api", "roles", _, "approve" | "reject"])
        | (_, ["api", "activity"])
        | (_, ["api", "usage"])
        | (_, ["api", "recommendations"])
        | (_, ["api", "questions"])
        | (_, ["api", "questions", _, "answer"])
        | (_, ["api", "recommendations", _, "accept" | "status"]) => {
            Response::error(405, format!("{method} is not allowed here"))
        }
        _ => Response::error(404, format!("no such route: {}", request.path)),
    }
}

/// Which status a failed merge deserves.
///
/// [`crate::workers::merge_worker`] refuses for two kinds of reason and the
/// caller can only act on one of them. A wrong id is a 404. The three gate
/// refusals - the card is not in `ready to merge`, the test gate is not green,
/// the agent is still running - all describe a worker that exists and is simply
/// not mergeable yet, which is a 409: retrying later can work, retrying now
/// cannot. Everything else comes from git, `gh` or the store, and is the app's
/// own problem, so it keeps the 500 default.
///
/// This reads the message text because the backend hands the route a bare
/// `String` - the same bargain the landing-page routes already make. The three
/// fragments below are the stable parts of the messages minted in
/// `workers::merge_worker`; a message reworded there falls back to 500, which
/// is the safe direction to be wrong in.
fn merge_status(err: &str) -> u16 {
    if err.starts_with("unknown worker") {
        404
    } else if err.contains("sits in ")
        || err.starts_with("the test gate for ")
        || err.contains("still has a running agent")
        || err.contains("merge blocked")
    {
        409
    } else {
        500
    }
}

/// A verdict the core refused because the row already has one is a 409: the
/// request is well formed, it just arrives too late. Everything else these
/// four routes can fail with is a caller who named the wrong id or wrote an
/// unusable text, which is the 400 they always answered.
///
/// Like [`merge_status`] this reads the message, because the backend hands the
/// route a bare `String`. The prefix is [`crate::workers::ERR_REFUSED`], which
/// is minted in one place per verdict and shared with the rest of the core.
fn verdict_status(err: &str) -> u16 {
    if err.starts_with(crate::workers::ERR_REFUSED) {
        409
    } else {
        400
    }
}

/// The reply a listing route owes a project filter it cannot use, if any.
///
/// The store filters by project id, so an id that names nothing comes back as
/// an empty collection - and an empty collection is a perfectly ordinary
/// answer, which is why a typo in the id reads like a project nobody has done
/// any work in yet. Asking first costs one lookup per listing call and turns
/// that silence into the 404 the id deserves; a lookup that fails is the app's
/// own problem and keeps the 500.
///
/// `None` for the project id is not a mistake but the fleet-wide form of these
/// routes - `/api/workers` with no filter is every project's workers - so
/// there is nothing to check and nothing to answer.
///
/// The routes reached with the id in the path - `/api/projects/<id>/tree` and
/// its neighbours - pass `Some(id)` and get the same treatment. The ones that
/// already reach a core doing its own lookup (`stats`, the digests, the
/// landing page) do not ask: they would only pay for the answer twice.
fn unknown_project(backend: &dyn ControlBackend, project_id: Option<&str>) -> Option<Response> {
    let project_id = project_id?;
    match backend.project_exists(project_id) {
        Ok(true) => None,
        Ok(false) => Some(Response::error(
            404,
            format!("{}project: {project_id}", crate::workers::ERR_UNKNOWN),
        )),
        Err(err) => Some(Response::error(500, err)),
    }
}

/// Which status a failed core call deserves.
///
/// The core answers with a bare `String`, and [`crate::workers`] documents the
/// two openings that make one readable from out here: `unknown <kind>: <id>` is
/// a caller who named something that does not exist, `refused: <reason>` is
/// something that exists but may not be used the way it was asked for. Nothing
/// was attempted in either case. Everything else is git, `gh`, the filesystem,
/// the store or a CLI that would not start - the app's own problem, and the
/// 500 these routes used to answer for all three.
///
/// Only the opening is read, never the sentence after it: that text is for a
/// person and may be reworded, and a rewording must not move a status. A
/// message that stops opening with either prefix falls back to 500, which is
/// the safe direction to be wrong in.
///
/// Phase 21's question routes arrived with this function written a second time
/// under the name `question_status`, on a branch that could not see this one -
/// same three cases, same order, same fallback. Two readers of one vocabulary
/// is one too many, so they are this.
fn core_status(err: &str) -> u16 {
    if err.starts_with(crate::workers::ERR_UNKNOWN) {
        404
    } else if err.starts_with(crate::workers::ERR_REFUSED) {
        409
    } else {
        500
    }
}

/// [`into_response`] for the routes whose core speaks that vocabulary.
///
/// Eight of them create something: a worker, a queen, a queued task, a scout, a
/// triage, a recommendation, a word to the orchestrator, a GitHub repository.
/// Each one starts by looking up the project - and until now a project id with
/// a typo in it came back as a 500, which told a script to retry a request that
/// can never succeed. The ninth only reads: `/api/projects/<id>/stats` arrived
/// with the same lookup and its own copy of this classifier, written on a
/// branch that could not see this one. One reader is enough.
fn core_response<T: Serialize>(result: Result<T, String>) -> Response {
    match result {
        Err(err) => Response::error(core_status(&err), err),
        ok => into_response(ok),
    }
}

/// Turn a backend result into a reply, serializing on the way out.
fn into_response<T: Serialize>(result: Result<T, String>) -> Response {
    match result {
        Ok(value) => match serde_json::to_value(value) {
            Ok(body) => Response::ok(body),
            Err(err) => Response::error(500, format!("failed to render the reply: {err}")),
        },
        Err(err) => Response::error(500, err),
    }
}

fn parse_body(body: &str) -> Result<Value, String> {
    if body.trim().is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(body).map_err(|e| format!("body is not json: {e}"))
}

/// A string field with something in it, or `None` - the shape of every
/// optional field on the wire.
fn optional_str(body: &Value, key: &str) -> Option<String> {
    body.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// A three-valued percentage field: absent (`Ok(None)`), explicitly `null`
/// (`Ok(Some(None))`) or a whole number from 1 to 100 (`Ok(Some(Some(n)))`).
///
/// The range is checked here rather than left to the core so a typo comes back
/// as the 400 it is. The core validates again on the way to the settings
/// table; both callers of it are outside this file.
fn optional_percent(body: &Value, key: &str) -> Result<Option<Option<u8>>, String> {
    let Some(value) = body.get(key) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(Some(None));
    }
    let percent = value
        .as_u64()
        .filter(|percent| (1..=100).contains(percent))
        .ok_or_else(|| format!("{key} must be a whole percentage between 1 and 100, or null"))?;
    Ok(Some(Some(percent as u8)))
}

fn required_str(body: &Value, key: &str) -> Result<String, String> {
    body.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("{key} is required"))
}

fn string_array(body: &Value, key: &str) -> Result<Vec<String>, String> {
    match body.get(key) {
        None => Ok(Vec::new()),
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .map(str::to_string)
                    .ok_or_else(|| format!("{key} must be an array of strings"))
            })
            .collect(),
        Some(_) => Err(format!("{key} must be an array of strings")),
    }
}

fn optional_bool(body: &Value, key: &str) -> Result<Option<bool>, String> {
    match body.get(key) {
        None => Ok(None),
        Some(Value::Bool(value)) => Ok(Some(*value)),
        Some(_) => Err(format!("{key} must be a boolean")),
    }
}

fn only_keys(body: &Value, allowed: &[&str]) -> Result<(), String> {
    let object = body
        .as_object()
        .ok_or_else(|| "body must be a JSON object".to_string())?;
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(format!("unknown field: {key}"));
    }
    Ok(())
}

fn continuous_response<T: Serialize>(result: Result<T, String>) -> Response {
    match result {
        Ok(value) => into_response(Ok(value)),
        Err(err) => continuous_error(err),
    }
}

fn plan_response(result: Result<Value, String>) -> Response {
    match result {
        Ok(value) => Response::ok(value),
        Err(reason) => Response::error(
            crate::development_plan_access::error_status(&reason),
            reason,
        ),
    }
}

fn continuous_error(err: String) -> Response {
    let status = if err.starts_with("unknown ") {
        404
    } else if err.contains("stale")
        || err.contains("already claimed")
        || err.contains("not open")
        || err.contains("not admitted")
        || err.contains("fail-closed")
        || err.contains("budget exhausted")
        || err.contains("dependency is not completed")
        || err.contains("conflicts")
        || err.contains("deadline")
        || err.contains("paused")
        || err.contains("draining")
        || err.contains("not been admitted")
        || err.contains("unresolved")
        || err.contains("retry requires")
        || err.contains("capacity exhausted")
        || err.contains("disabled by its root policy")
        || err.contains("lost race")
        || err.starts_with("team assignment revision conflict")
        || err.starts_with("team assignment is locked")
        || err.starts_with("continuous task is assigned")
    {
        409
    } else if err.contains("is required")
        || err.contains("must be")
        || err.contains("cross-project")
    {
        400
    } else {
        500
    };
    Response::error(status, err)
}

#[test]
fn retry_before_reconciliation_is_a_conflict() {
    assert_eq!(
        continuous_error("retry requires a resolved failed run for the current claim".into())
            .status,
        409
    );
}

/// Split a raw request head into method, path, query and headers.
pub fn parse_request(head: &str, body: String) -> Option<Request> {
    let mut lines = head.lines();
    let mut request_line = lines.next()?.split_whitespace();
    let method = request_line.next()?.to_ascii_uppercase();
    let target = request_line.next()?;

    let (raw_path, raw_query) = match target.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (target, None),
    };

    let mut query = HashMap::new();
    for pair in raw_query.unwrap_or("").split('&').filter(|p| !p.is_empty()) {
        let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
        query.insert(percent_decode(name), percent_decode(value));
    }

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    Some(Request {
        method,
        path: raw_path.to_string(),
        query,
        headers,
        body,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// `redact::looks_secret`/`mask_token_runs` mask exactly-32-character,
    /// lowercase-hex segments — the shape `new_token` produces. Since
    /// `new_token` is private to this module, `redact.rs`'s own tests can
    /// only check against a lookalike (`oneshot::random_hex`), not against
    /// this function. This test closes that gap: if `new_token` ever drifts
    /// to a different length or an uppercase/mixed alphabet,
    /// `redact::looks_secret` stops recognizing a real token, and this is
    /// the test that goes red.
    #[test]
    fn new_token_has_the_shape_redact_expects_to_mask() {
        let token = new_token().unwrap();
        assert_eq!(token.len(), 32, "{token}");
        assert!(
            token
                .chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)),
            "{token}"
        );
        assert!(crate::redact::looks_secret(&token), "{token}");
    }

    #[test]
    fn plan_read_before_import_is_explicitly_missing() {
        let fx = fixture("api-plan-missing");
        let token = fx.token();
        let (status, body) = call(
            fx.server.port(),
            "GET",
            "/api/hq/v1/plan?projectId=pj-1&planId=main",
            Some(&token),
            "",
        );
        assert_eq!(status, 404, "{body}");
        assert_eq!(body["error"], "unknown project or plan");
        assert_eq!(fx.backend.plan_reads.lock().unwrap().len(), 1);
    }

    #[test]
    fn plan_get_returns_projection_and_forwards_exact_revision() {
        let fx = fixture("api-plan-read");
        let token = fx.token();
        let (status, body) = call(
            fx.server.port(),
            "GET",
            "/api/hq/v1/plan?projectId=pj-1&planId=ready&revision=3",
            Some(&token),
            "",
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["contractVersion"], 1);
        assert_eq!(body["availability"], "available");
        assert_eq!(body["projectId"], "pj-1");
        assert_eq!(body["sourceRevision"], "digest-3");
        assert_eq!(body["projection"]["projectionRevision"], 3);
        assert_eq!(body["projection"]["sourcePath"], "docs/PLAN.md");
        assert_eq!(body["projection"]["packages"], json!([]));
        assert_eq!(
            fx.backend.plan_reads.lock().unwrap().as_slice(),
            &[("pj-1".into(), "ready".into(), Some(3))]
        );
        assert!(fx.backend.plan_imports.lock().unwrap().is_empty());
    }

    #[test]
    fn plan_routes_validate_inputs_and_preserve_import_envelope() {
        let fx = fixture("api-plan-contract");
        let token = fx.token();
        let auth = Some(token.as_str());
        let port = fx.server.port();
        for path in [
            "/api/hq/v1/plan?projectId=pj-1",
            "/api/hq/v1/plan?projectId=pj-1&planId=main&revision=0",
            "/api/hq/v1/plan?projectId=pj-1&planId=main&revision=x",
            "/api/hq/v1/plan?projectId=pj-1&planId=main&source=foo",
        ] {
            assert_eq!(call(port, "GET", path, auth, "").0, 400, "{path}");
        }
        assert!(fx.backend.plan_reads.lock().unwrap().is_empty());
        let (status, _) = call(
            port,
            "GET",
            "/api/hq/v1/plan?projectId=pj-1&planId=main&revision=99",
            auth,
            "",
        );
        assert_eq!(status, 404);
        for body in [
            r#"{"projectId":"pj-1","planId":"main","expectedProjectionRevision":0,"source":"x"}"#,
            r#"{"projectId":"pj-1","planId":"main","expectedProjectionRevision":"0"}"#,
            r#"{"projectId":"pj-1","planId":"main","expectedProjectionRevision":-1}"#,
            r#"{"projectId":"pj-1","planId":"main","expectedProjectionRevision":0,"rollbackReason":null}"#,
        ] {
            assert_eq!(
                call(port, "POST", "/api/hq/v1/plan/import", auth, body).0,
                400,
                "{body}"
            );
        }
        assert_eq!(
            call(
                port,
                "POST",
                "/api/hq/v1/plan/import?source=other.md",
                auth,
                r#"{"projectId":"pj-1","planId":"main","expectedProjectionRevision":0}"#
            )
            .0,
            400
        );
        assert!(fx.backend.plan_imports.lock().unwrap().is_empty());
        let (status, reply) = call(
            port,
            "POST",
            "/api/hq/v1/plan/import",
            auth,
            r#"{"projectId":"pj-1","planId":"main","expectedProjectionRevision":0}"#,
        );
        assert_eq!(status, 200, "{reply}");
        assert_eq!(reply["contractVersion"], 1);
        assert_eq!(reply["projection"]["planId"], "main");
        assert_eq!(fx.backend.plan_imports.lock().unwrap().len(), 1);
    }
    #[test]
    fn continuous_policy_refusals_are_conflicts_not_server_failures() {
        for message in [
            "continuous runtime adapters are unattested; resume is fail-closed",
            "continuous project is paused; claims refused",
            "continuous project is draining; claims refused",
            "continuous goal deadline has elapsed; task admission is closed",
            "a draft root has not been admitted; its descendants cannot be admitted",
            "an autonomous continuous root is already unresolved; use sourceGoalId for its replan",
            "team assignment revision conflict",
            "team assignment is locked after the first claim or goal closure",
            "continuous task is assigned to another owner",
        ] {
            assert_eq!(continuous_error(message.into()).status, 409, "{message}");
        }
        assert_eq!(continuous_error("database unavailable".into()).status, 500);
    }
    use crate::store::{KIND_WORKER, STATUS_RUNNING};
    use crate::testutil::TempDir;
    use std::io::Read;
    use std::sync::Mutex;

    // W2-04f, in `api/tests/`: a child of this module so it can use the fake
    // backend and `call`.
    mod planning_access_tests;

    /// The five ways a merge can fail, copied verbatim from
    /// `workers::merge_worker` (and from `gh` for the last one). They are here
    /// so both the fake backend and the [`merge_status`] unit test speak the
    /// exact words the real backend speaks: if one of them is reworded over
    /// there without this file following, the route quietly falls back to 500,
    /// and these constants are where a reader looks to find out why.
    const MERGE_UNKNOWN: &str = "unknown worker: wk-nope";
    const MERGE_WRONG_COLUMN: &str = "worker wk-busy sits in 'working', not 'ready_to_merge': \
         only a card that is ready to merge can be merged";
    const MERGE_TEST_GATE: &str = "the test gate for wk-red is 'fail', not 'pass': \
         merging is blocked until the tests pass";
    const MERGE_STILL_RUNNING: &str = "worker wk-live still has a running agent; archive it \
         first so nothing writes to the branch while it is merged";
    const MERGE_GIT_FAILED: &str = "git merge failed: refusing to merge unrelated histories";

    /// What the fake recorded for one worker spawn:
    /// `(projectId, task, profileId, spawnedBy)`. Named so the tuple stays
    /// readable where it is matched on.
    type SpawnRecord = (String, String, String, Option<String>);
    type PlanImportRecord = (String, String, i64, Option<String>);
    /// The same for a queen spawn, whose profile is optional:
    /// `(projectId, domain, profileId, spawnedBy)`.
    type QueenRecord = (String, String, Option<String>, Option<String>);

    /// A backend that answers from canned data and records what it was asked.
    #[derive(Default)]
    struct FakeBackend {
        plan_reads: Mutex<Vec<(String, String, Option<i64>)>>,
        plan_imports: Mutex<Vec<PlanImportRecord>>,
        native_claim: Option<(String, String, i64)>,
        native_store: Option<crate::store::Store>,
        checkpoints: Mutex<HashMap<String, Value>>,
        reject_agent_run: std::sync::atomic::AtomicBool,
        created: Mutex<Vec<SpawnRecord>>,
        queened: Mutex<Vec<QueenRecord>>,
        sent: Mutex<Vec<(String, String)>>,
        /// `(workerId, removeWorktree)` of every merge the API asked for.
        merged: Mutex<Vec<(String, bool)>>,
        /// `(projectId, text)` of every message aimed at an orchestrator.
        told: Mutex<Vec<(String, String)>>,
        /// `(projectId, urls)` - an empty url list is a plain scout.
        scouted: Mutex<Vec<(String, Vec<String>)>>,
        /// `(name, repoPath)` of every project the API registered.
        created_projects: Mutex<Vec<(String, String)>>,
        statuses: Mutex<Vec<(String, String)>>,
        recommendation_status_calls: std::sync::atomic::AtomicUsize,
        repos: Mutex<Vec<(String, String, bool)>>,
        links: Mutex<Vec<(String, String)>>,
        landings: Mutex<HashMap<String, Option<String>>>,
        /// `(learningId, text)` of every approval, and the ids of every
        /// rejection - the two halves of the human verdict.
        approved: Mutex<Vec<(String, String)>>,
        rejected: Mutex<Vec<String>>,
        /// Every question the API asked, as the route passed it on.
        asked: Mutex<Vec<AskRecord>>,
        /// `(questionId, answer, answeredBy)` of every answer. The third
        /// element is what the route made of the verdict header, which is the
        /// only place that decision is visible.
        answered: Mutex<Vec<(String, String, String)>>,
        /// The ids of every role variant the API approved and rejected.
        roles_approved: Mutex<Vec<String>>,
        roles_rejected: Mutex<Vec<String>>,
        /// Every budget write, as the route passed it on.
        budgets: Mutex<Vec<BudgetWrite>>,
        /// The row limit each `/api/usage` call arrived with, after the route
        /// applied its default and its cap.
        usage_limits: Mutex<Vec<u32>>,
        /// The window each `/api/projects/<id>/stats` call arrived with.
        stats_ranges: Mutex<Vec<crate::stats::StatsRange>>,
        /// W2-04f: what `agent_dispatch_role` answers for the fake's one run;
        /// `None` resolves nothing. Ignored when `native_store` is set.
        dispatch_role: Option<Result<crate::store::development_launches::DispatchRole, String>>,
        /// Every goal, task and assignment write that reached the backend, as
        /// `goal:<projectId>`, `task:<goalId>` and `assign:<taskId>`.
        planned: Mutex<Vec<String>>,
    }

    /// `(projectId, workerId, question, options)` of one `POST /api/questions`.
    type AskRecord = (String, Option<String>, String, Option<String>);

    /// `(profileId, fiveHourPct, sevenDayPct)` of one budget write, with both
    /// windows still three-valued: absent, cleared, or set.
    type BudgetWrite = (String, Option<Option<u8>>, Option<Option<u8>>);

    fn worker(id: &str) -> Worker {
        Worker {
            id: id.to_string(),
            project_id: "pj-1".to_string(),
            task: "do the thing".to_string(),
            profile_id: "claude".to_string(),
            branch: format!("pa/{id}"),
            worktree_path: format!("C:/tmp/.projecta-worktrees/{id}"),
            session_id: Some("pty-1".to_string()),
            status: STATUS_RUNNING.to_string(),
            kind: KIND_WORKER.to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: None,
            tested_at: None,
            paused_reason: None,
            created_at: 42,
        }
    }

    fn scout(id: &str) -> Worker {
        Worker {
            branch: String::new(),
            worktree_path: "C:/repos/a".to_string(),
            kind: crate::store::KIND_SCOUT.to_string(),
            ..worker(id)
        }
    }

    fn queen(id: &str) -> Worker {
        Worker {
            branch: String::new(),
            worktree_path: "C:/repos/a".to_string(),
            kind: KIND_QUEEN.to_string(),
            task: "Queen: Backend-API".to_string(),
            ..worker(id)
        }
    }

    fn recommendation(id: &str) -> Recommendation {
        Recommendation {
            id: id.to_string(),
            project_id: "pj-1".to_string(),
            title: "ratatui".to_string(),
            url: Some("https://github.com/ratatui/ratatui".to_string()),
            rationale: "Board im Terminal".to_string(),
            effort: Some("M".to_string()),
            status: crate::store::REC_NEW.to_string(),
            created_at: 42,
        }
    }

    fn learning(id: &str, status: &str) -> Learning {
        Learning {
            id: id.to_string(),
            project_id: "pj-1".to_string(),
            worker_id: "wk-1".to_string(),
            profile_id: "claude".to_string(),
            pattern_label: Some("Gates".to_string()),
            content: "Gates seriell laufen lassen".to_string(),
            status: status.to_string(),
            created_at: 42,
        }
    }

    /// An open worker question. The statuses that are not open are built from
    /// this one with a struct update, which is also how the core builds them.
    fn question_row(id: &str) -> Question {
        Question {
            id: id.to_string(),
            project_id: "pj-1".to_string(),
            worker_id: Some("wk-1".to_string()),
            scope: crate::store::QUESTION_WORKER.to_string(),
            question: "Postgres oder SQLite?".to_string(),
            answered_by: None,
            options_json: Some(r#"["Postgres","SQLite"]"#.to_string()),
            status: crate::store::QUESTION_OPEN.to_string(),
            answer: None,
            created_at: 42,
            answered_at: None,
            expires_at: Some(42 + 4 * 60 * 60),
        }
    }

    fn role_variant(id: &str, status: &str) -> RoleVariant {
        RoleVariant {
            id: id.to_string(),
            project_id: "pj-1".to_string(),
            name: "Test-Fixer".to_string(),
            base_profile_id: "claude".to_string(),
            pattern_label: "tests-fixen".to_string(),
            system_prompt_addition: "Lauf die Gates seriell.".to_string(),
            version: 1,
            status: status.to_string(),
            created_at: 42,
        }
    }

    fn board_state(id: &str) -> WorkerBoardState {
        WorkerBoardState {
            worker: worker(id),
            column: crate::status::COL_WORKING.to_string(),
            attention_reason: None,
            attention_code: None,
            attention_grade: None,
            attention_observed_at: None,
            pr_url: None,
            context_usage: None,
            // Phase 11 badge: this fixture has no coordinator to resolve.
            controlled_by: None,
            // Phase 12: this fixture's worker has never been through the gate.
            test_status: None,
            tested_at: None,
        }
    }

    /// The three answers every creating route has to tell apart, chosen by the
    /// project id a test names. The wording is copied from the core: `pj-nope`
    /// is [`crate::workers::ERR_UNKNOWN`], `pj-aus` is
    /// [`crate::workers::ERR_REFUSED`] (a profile the user switched off), and
    /// `pj-git` is a worktree that would not check out - the app's own failure,
    /// which has to keep its 500.
    fn core_verdict(project_id: &str) -> Result<(), String> {
        match project_id {
            "pj-nope" => Err(format!(
                "{}project: {project_id}",
                crate::workers::ERR_UNKNOWN
            )),
            "pj-aus" => Err(format!(
                "{}agent profile 'claude' is switched off",
                crate::workers::ERR_REFUSED
            )),
            "pj-git" => Err("failed to add the worktree: git exited with 128".to_string()),
            _ => Ok(()),
        }
    }

    impl ControlBackend for FakeBackend {
        fn assign_continuous_task(
            &self,
            task_id: &str,
            request: crate::store::team_assignments::AssignmentRequest,
        ) -> Result<crate::store::team_assignments::TeamAssignment, String> {
            if request.expected_revision != 0 {
                return Err("team assignment revision conflict".into());
            }
            self.planned
                .lock()
                .unwrap()
                .push(format!("assign:{task_id}"));
            Ok(crate::store::team_assignments::TeamAssignment {
                task_id: task_id.into(),
                team_id: request.team_id,
                role: request.role,
                assignee: request.assignee,
                revision: 1,
                policy_version: 1,
                observed_at: 42,
            })
        }
        fn agent_dispatch_role(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
        ) -> Result<crate::store::development_launches::DispatchRole, String> {
            if let Some(store) = &self.native_store {
                // What `main.rs` does: authority first, then the W2-04 role.
                return tauri::async_runtime::block_on(async {
                    store.agent_run_context(run, owner, fence).await?;
                    store.development_run_role(run).await
                });
            }
            self.agent_run_context(run, owner, fence)?;
            self.dispatch_role
                .clone()
                .unwrap_or_else(|| Err("no dispatch role configured".into()))
        }
        fn create_continuous_goal(
            &self,
            project_id: &str,
            objective: &str,
            _acceptance_criteria: Option<String>,
            source_goal_id: Option<String>,
            admit: bool,
        ) -> Result<ContinuousGoal, String> {
            self.planned
                .lock()
                .unwrap()
                .push(format!("goal:{project_id}"));
            Ok(ContinuousGoal {
                id: "cg-new".into(),
                project_id: project_id.into(),
                source_goal_id,
                root_goal_id: "cg-new".into(),
                objective: objective.into(),
                acceptance_criteria: None,
                status: "open".into(),
                deadline_at: 0,
                admitted: admit,
                created_at: 42,
                updated_at: 42,
            })
        }
        fn create_continuous_task(
            &self,
            goal_id: &str,
            objective: &str,
            profile_id: Option<String>,
            owned_paths: Vec<String>,
            dependencies: Vec<String>,
        ) -> Result<ContinuousTask, String> {
            self.planned.lock().unwrap().push(format!("task:{goal_id}"));
            Ok(ContinuousTask {
                assignment: None,
                id: "ct-new".into(),
                goal_id: goal_id.into(),
                objective: objective.into(),
                profile_id,
                owned_paths,
                dependencies,
                status: "open".into(),
                attempts: 0,
                escalations: 0,
                claim: None,
                created_at: 42,
                updated_at: 42,
            })
        }
        fn wait_continuous_changes(
            &self,
            project: &str,
            cursor: i64,
            wait_ms: u64,
        ) -> Result<Value, String> {
            let mut value = self.continuous_changes(project, cursor)?;
            value["requestedWaitMs"] = json!(wait_ms);
            Ok(value)
        }
        fn continuous_changes(&self, project: &str, cursor: i64) -> Result<Value, String> {
            Ok(
                json!({"apiVersion":1,"projectId":project,"cursor":cursor,"hasMore":false,"events":[]}),
            )
        }
        fn agent_record_page(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
            collection: &str,
            cursor: Option<&str>,
        ) -> Result<Value, String> {
            self.agent_run_context(run, owner, fence)?;
            Ok(json!({"runId":run,"collection":collection,"cursor":cursor}))
        }
        fn agent_run_context(&self, run: &str, owner: &str, fence: i64) -> Result<Value, String> {
            if let Some(store) = &self.native_store {
                return tauri::async_runtime::block_on(store.agent_run_context(run, owner, fence));
            }
            let expected = self
                .native_claim
                .as_ref()
                .map(|(run, owner, fence)| (run.as_str(), owner.as_str(), *fence))
                .unwrap_or(("run-a", "worker-a", 7));
            if self
                .reject_agent_run
                .load(std::sync::atomic::Ordering::SeqCst)
                || (run, owner, fence) != expected
            {
                return Err("unknown or unauthorized development run".into());
            }
            Ok(json!({"apiVersion":1,"runId":run,"owner":owner,"fence":fence}))
        }
        fn agent_bind_candidate(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
            input: CandidateInput,
        ) -> Result<Value, String> {
            self.agent_run_context(run, owner, fence)?;
            Ok(json!({"runId":run,"candidateCommit":input.candidate_commit}))
        }
        fn agent_checkpoint_at(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
            revision: i64,
        ) -> Result<Value, String> {
            self.agent_run_context(run, owner, fence)?;
            Ok(json!({"runId":run,"revision":revision}))
        }
        fn agent_checkpoint(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
            input: crate::store::development_runs::CheckpointInput,
        ) -> Result<Value, String> {
            self.agent_run_context(run, owner, fence)?;
            let mut saved = self.checkpoints.lock().unwrap();
            let raw = json!(input);
            if saved
                .get(&input.idempotency_key)
                .is_some_and(|existing| existing != &raw)
            {
                return Err("checkpoint idempotency key reused with different content".into());
            }
            saved.insert(input.idempotency_key.clone(), raw);
            Ok(json!({"runId":run,"content":input}))
        }
        fn agent_submit_evidence(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
            input: crate::store::development_runs::EvidenceInput,
        ) -> Result<Value, String> {
            self.agent_run_context(run, owner, fence)?;
            Ok(json!({"runId":run,"idempotencyKey":input.idempotency_key}))
        }
        fn agent_submit_review(
            &self,
            reviewer_run: &str,
            owner: &str,
            fence: i64,
            input: crate::store::development_runs::ReviewInput,
        ) -> Result<Value, String> {
            if let Some(store) = &self.native_store {
                let review = tauri::async_runtime::block_on(store.record_development_review(
                    reviewer_run,
                    owner,
                    fence,
                    input,
                ))?;
                return serde_json::to_value(review).map_err(|e| e.to_string());
            }
            self.agent_run_context(reviewer_run, owner, fence)?;
            Ok(json!({"reviewerRunId":reviewer_run,"idempotencyKey":input.idempotency_key}))
        }
        fn development_records(&self, project_id: &str) -> Result<Value, String> {
            Ok(
                json!({"apiVersion": 1, "projectId": project_id, "runs": [], "executionEnabled": false}),
            )
        }
        fn development_plan(
            &self,
            project_id: &str,
            plan_id: &str,
            revision: Option<i64>,
        ) -> Result<Value, String> {
            self.plan_reads
                .lock()
                .unwrap()
                .push((project_id.into(), plan_id.into(), revision));
            if project_id == "pj-1" && plan_id == "ready" && revision == Some(3) {
                return Ok(json!({
                    "contractVersion":1,"availability":"available","generatedAt":42,
                    "projectId":project_id,"sourceRevision":"digest-3",
                    "projection":{
                        "projectId":project_id,"planId":plan_id,"sourcePath":"docs/PLAN.md",
                        "sourceRevision":"digest-3","projectionRevision":3,
                        "source":"plan text","rollbackReason":null,"importedAt":40,"packages":[]
                    }
                }));
            }
            if revision == Some(99) {
                return Err("unknown project, plan or projection revision".into());
            }
            Err("unknown project or plan".into())
        }
        fn import_development_plan(
            &self,
            project_id: &str,
            plan_id: &str,
            expected_projection_revision: i64,
            rollback_reason: Option<&str>,
        ) -> Result<Value, String> {
            self.plan_imports.lock().unwrap().push((
                project_id.into(),
                plan_id.into(),
                expected_projection_revision,
                rollback_reason.map(str::to_owned),
            ));
            Ok(
                json!({"contractVersion":1,"availability":"available","generatedAt":42,"projectId":project_id,"sourceRevision":"digest","projection":{"projectId":project_id,"planId":plan_id,"projectionRevision":1}}),
            )
        }
        fn control_continuous(
            &self,
            _project_id: &str,
            _action: &str,
        ) -> Result<crate::store::ContinuousControl, String> {
            Err("continuous runtime adapters are unattested; resume is fail-closed".into())
        }
        /// Every id names a project except `pj-nope`, which names none - the
        /// same convention the digest, stats and landing-page fakes follow -
        /// and `pj-boom`, whose lookup fails.
        fn project_exists(&self, project_id: &str) -> Result<bool, String> {
            match project_id {
                "pj-boom" => Err("failed to read project: database is locked".to_string()),
                _ => Ok(project_id != "pj-nope"),
            }
        }

        fn create_worker(
            &self,
            project_id: &str,
            task: &str,
            profile_id: &str,
            spawned_by: Option<String>,
        ) -> Result<Worker, String> {
            core_verdict(project_id)?;
            self.created.lock().unwrap().push((
                project_id.to_string(),
                task.to_string(),
                profile_id.to_string(),
                spawned_by,
            ));
            Ok(worker("wk-new"))
        }

        fn create_queen(
            &self,
            project_id: &str,
            task: &str,
            profile_id: Option<String>,
            spawned_by: Option<String>,
        ) -> Result<Worker, String> {
            core_verdict(project_id)?;
            self.queened.lock().unwrap().push((
                project_id.to_string(),
                task.to_string(),
                profile_id,
                spawned_by,
            ));
            Ok(queen("wk-queen"))
        }

        fn list_workers(&self, project_id: Option<&str>) -> Result<Vec<Worker>, String> {
            // A small hierarchy: an orchestrator with a queen, the queen with
            // two employees, one worker started by the user, and one whose
            // controller is gone.
            match project_id {
                Some("pj-1") | None => Ok(vec![
                    worker("wk-1"),
                    Worker {
                        branch: String::new(),
                        worktree_path: "C:/repos/a".to_string(),
                        kind: KIND_ORCHESTRATOR.to_string(),
                        ..worker("wk-orch")
                    },
                    Worker {
                        spawned_by: Some("wk-orch".to_string()),
                        ..queen("wk-queen")
                    },
                    Worker {
                        spawned_by: Some("wk-queen".to_string()),
                        ..worker("wk-e1")
                    },
                    Worker {
                        spawned_by: Some("wk-queen".to_string()),
                        ..worker("wk-e2")
                    },
                    Worker {
                        spawned_by: Some("wk-gone".to_string()),
                        ..worker("wk-orphan")
                    },
                ]),
                Some(_) => Ok(Vec::new()),
            }
        }

        fn worker_state(&self, worker_id: &str) -> Result<Option<WorkerBoardState>, String> {
            Ok((worker_id == "wk-1").then(|| board_state("wk-1")))
        }

        fn send_to_worker(&self, worker_id: &str, text: &str) -> Result<(), String> {
            // Word for word what `ApiBackend::send_to_worker` says when the
            // store has no session for the id.
            if worker_id != "wk-1" {
                return Err(format!("worker {worker_id} has no running agent"));
            }
            self.sent
                .lock()
                .unwrap()
                .push((worker_id.to_string(), text.to_string()));
            Ok(())
        }

        fn send_to_orchestrator(&self, project_id: &str, text: &str) -> Result<Worker, String> {
            core_verdict(project_id)?;
            self.told
                .lock()
                .unwrap()
                .push((project_id.to_string(), text.to_string()));
            Ok(Worker {
                branch: String::new(),
                worktree_path: "C:/repos/a".to_string(),
                kind: KIND_ORCHESTRATOR.to_string(),
                ..worker("wk-orch")
            })
        }

        fn list_worker_messages(
            &self,
            worker_id: &str,
            limit: Option<usize>,
        ) -> Result<Vec<Message>, String> {
            let mut messages = Vec::new();
            let cap = limit.unwrap_or(200);
            for i in 0..cap {
                messages.push(Message {
                    id: format!("msg-{i}"),
                    worker_id: worker_id.to_string(),
                    role: crate::store::MSG_USER.to_string(),
                    content: format!("entry {i}"),
                    created_at: i as i64,
                });
            }
            Ok(messages)
        }

        fn board(&self, _project_id: Option<&str>) -> Result<Vec<WorkerBoardState>, String> {
            Ok(vec![board_state("wk-1")])
        }

        fn quota(&self) -> Result<Vec<QuotaStateRow>, String> {
            Ok(Vec::new())
        }

        fn providers(&self) -> Result<Vec<ProviderOverview>, String> {
            Ok(vec![ProviderOverview {
                id: "claude".to_string(),
                name: "Claude Code".to_string(),
                kind: crate::providers::KIND_SUBSCRIPTION.to_string(),
                connected: true,
                detail: Some("1.2.3".to_string()),
                quota_state: crate::store::QUOTA_BLOCKED.to_string(),
                blocked_until: Some(1_800_000_000),
                omni_route_online: false,
                usage: Some(crate::providers::ProviderUsage {
                    percent: Some(87),
                    used: Some("562,0 k Tokens".to_string()),
                    limit: Some("1,0 M Tokens".to_string()),
                    window_label: "5-Stunden-Fenster".to_string(),
                    resets_at: Some(1_787_793_000),
                    source: "hook".to_string(),
                    observed_at: 1_787_793_000,
                }),
                vault_error: None,
            }])
        }

        fn usage(&self, limit: u32) -> Result<UsageReport, String> {
            self.usage_limits.lock().unwrap().push(limit);
            Ok(UsageReport {
                online: true,
                authorized: true,
                events: vec![crate::store::UsageEvent {
                    id: "ue-1".to_string(),
                    ts: 1_787_910_158,
                    profile_id: None,
                    model: "gpt-5.6-sol".to_string(),
                    provider: "codex".to_string(),
                    tokens_in: 19,
                    tokens_out: 5,
                    cost_usd: None,
                    raw_json: "line".to_string(),
                }],
                today: crate::store::UsageTotals {
                    requests: 1,
                    tokens_in: 19,
                    tokens_out: 5,
                    cost_usd: 0.0,
                    priced: 0,
                },
                total: crate::store::UsageTotals {
                    requests: 2,
                    tokens_in: 119,
                    tokens_out: 15,
                    cost_usd: 0.0,
                    priced: 0,
                },
                reported_cost_usd: Some(42.5),
                history: Some(json!({ "totalCost": 42.5 })),
            })
        }

        fn list_digests(&self, project_id: &str) -> Result<Vec<String>, String> {
            if project_id == "pj-nope" {
                return Err(format!(
                    "{}project: {project_id}",
                    crate::workers::ERR_UNKNOWN
                ));
            }
            Ok(vec!["2026-08-27".to_string(), "2026-08-26".to_string()])
        }

        fn read_digest(&self, project_id: &str, date: &str) -> Result<Option<String>, String> {
            if project_id == "pj-nope" {
                return Err(format!(
                    "{}project: {project_id}",
                    crate::workers::ERR_UNKNOWN
                ));
            }
            Ok((date == "2026-08-27").then(|| "# 2026-08-27 - one\n".to_string()))
        }

        fn project_stats(
            &self,
            project_id: &str,
            range: crate::stats::StatsRange,
        ) -> Result<crate::stats::ProjectStats, String> {
            if project_id == "pj-nope" {
                return Err(format!(
                    "{}project: {project_id}",
                    crate::workers::ERR_UNKNOWN
                ));
            }
            self.stats_ranges.lock().unwrap().push(range);
            Ok(crate::stats::ProjectStats {
                project_id: project_id.to_string(),
                project_name: "one".to_string(),
                range: range.as_str().to_string(),
                since: range.since(1_787_745_600),
                generated_at: 1_787_745_600,
                overview: crate::stats::Overview {
                    workers_total: 2,
                    workers_active: 1,
                    workers_archived: 1,
                    by_column: Vec::new(),
                    by_kind: Vec::new(),
                    needs_attention: 0,
                    queue: Vec::new(),
                    queue_total: 0,
                    learnings_pending: 0,
                    messages: 4,
                    status_events: 3,
                    diff_comments: 0,
                    workers_created: 2,
                    range_scoped: Vec::new(),
                },
                // The honest gap, in the shape the route has to pass through.
                tokens: None,
                sessions: crate::stats::SessionStats {
                    total: 1,
                    open: 0,
                    ended: 1,
                    total_seconds: 120,
                    median_seconds: Some(120),
                    failed: 0,
                    unknown_exit: 0,
                    failure_ratio: Some(0.0),
                    recent: Vec::new(),
                },
                timeline: Vec::new(),
                completion: crate::stats::CompletionEstimate {
                    percent: Some(42.5),
                    components: Vec::new(),
                    workers: Vec::new(),
                    column_weights: Vec::new(),
                },
            })
        }

        fn list_budgets(&self) -> Result<Vec<BudgetLimits>, String> {
            Ok(vec![BudgetLimits {
                profile_id: "claude".to_string(),
                five_hour_pct: Some(90),
                seven_day_pct: None,
            }])
        }

        fn set_budget(
            &self,
            profile_id: &str,
            five_hour_pct: Option<Option<u8>>,
            seven_day_pct: Option<Option<u8>>,
        ) -> Result<BudgetLimits, String> {
            if profile_id == "nope" {
                return Err("unknown agent profile: nope".to_string());
            }
            self.budgets.lock().unwrap().push((
                profile_id.to_string(),
                five_hour_pct,
                seven_day_pct,
            ));
            Ok(BudgetLimits {
                profile_id: profile_id.to_string(),
                five_hour_pct: five_hour_pct.flatten(),
                seven_day_pct: seven_day_pct.flatten(),
            })
        }

        fn enqueue_task(
            &self,
            project_id: &str,
            raw_text: &str,
            profile_id: Option<String>,
            sharpen: bool,
            priority: Option<i32>,
            spawned_by: Option<String>,
        ) -> Result<QueueEntry, String> {
            core_verdict(project_id)?;
            Ok(QueueEntry {
                id: "tq-new".to_string(),
                project_id: project_id.to_string(),
                raw_text: raw_text.to_string(),
                sharpened_text: None,
                profile_id: profile_id.unwrap_or_else(|| DEFAULT_PROFILE.to_string()),
                status: if sharpen { "sharpening" } else { "ready" }.to_string(),
                priority: priority.unwrap_or(0),
                worker_id: None,
                error: None,
                spawned_by,
                created_at: 42,
            })
        }

        fn list_queue(&self, _project_id: Option<&str>) -> Result<Vec<QueueEntry>, String> {
            Ok(Vec::new())
        }

        fn cancel_queued_task(&self, id: &str) -> Result<(), String> {
            // The three answers `store::cancel_queue_entry` can give, in its
            // own words: an id that names nothing, an entry a claim has
            // already taken past queued or ready, and a store that fell over.
            match id {
                "tq-nope" => Err(format!(
                    "{}queued task: tq-nope",
                    crate::workers::ERR_UNKNOWN
                )),
                "tq-busy" => Err(format!(
                    "{}task tq-busy is dispatching, not queued or ready",
                    crate::workers::ERR_REFUSED
                )),
                "tq-boom" => Err("failed to cancel queued task: database is locked".into()),
                _ => Ok(()),
            }
        }

        fn create_scout(&self, project_id: &str) -> Result<Worker, String> {
            core_verdict(project_id)?;
            self.scouted
                .lock()
                .unwrap()
                .push((project_id.to_string(), Vec::new()));
            Ok(scout("wk-scout"))
        }

        fn triage_repos(&self, project_id: &str, urls: &[String]) -> Result<Worker, String> {
            core_verdict(project_id)?;
            self.scouted
                .lock()
                .unwrap()
                .push((project_id.to_string(), urls.to_vec()));
            Ok(scout("wk-triage"))
        }

        fn list_recommendations(
            &self,
            project_id: Option<&str>,
        ) -> Result<Vec<Recommendation>, String> {
            match project_id {
                Some("pj-1") | None => Ok(vec![recommendation("rc-1")]),
                Some(_) => Ok(Vec::new()),
            }
        }

        fn add_recommendation(
            &self,
            project_id: &str,
            title: &str,
            rationale: &str,
            url: Option<String>,
            effort: Option<String>,
        ) -> Result<Recommendation, String> {
            core_verdict(project_id)?;
            Ok(Recommendation {
                id: "rc-new".to_string(),
                project_id: project_id.to_string(),
                title: title.to_string(),
                url,
                rationale: rationale.to_string(),
                effort,
                status: crate::store::REC_NEW.to_string(),
                created_at: 42,
            })
        }

        fn set_recommendation_status(&self, id: &str, status: &str) -> Result<(), String> {
            self.recommendation_status_calls
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if status != crate::store::REC_ACCEPTED && status != crate::store::REC_DISMISSED {
                // The core's wording, from the same constants, so a change to
                // the vocabulary takes this fake with it.
                return Err(format!(
                    "unknown recommendation status: {status} (expected {} or {})",
                    crate::store::REC_ACCEPTED,
                    crate::store::REC_DISMISSED
                ));
            }
            // The same three answers the store can give, in its own words -
            // mirrored here like `accept_recommendation` one function down.
            match id {
                "rc-boom" => return Err("failed to update recommendation: disk full".to_string()),
                "rc-1" => {}
                _ => {
                    return Err(format!(
                        "{}recommendation: {id}",
                        crate::workers::ERR_UNKNOWN
                    ))
                }
            }
            self.statuses
                .lock()
                .unwrap()
                .push((id.to_string(), status.to_string()));
            Ok(())
        }

        fn accept_recommendation(&self, id: &str) -> Result<QueueEntry, String> {
            // The three answers `scout::accept_recommendation` can give, in its
            // own words: an id that names nothing, a row that was accepted
            // already, and a queue insert that failed.
            match id {
                "rc-done" => {
                    return Err(format!(
                        "{}recommendation {id} has already been accepted",
                        crate::workers::ERR_REFUSED
                    ))
                }
                "rc-boom" => return Err("failed to insert the queue entry: disk full".to_string()),
                "rc-1" => {}
                _ => {
                    return Err(format!(
                        "{}recommendation: {id}",
                        crate::workers::ERR_UNKNOWN
                    ))
                }
            }
            Ok(QueueEntry {
                id: "tq-from-rc".to_string(),
                project_id: "pj-1".to_string(),
                raw_text: "Integriere die Empfehlung \"ratatui\" in ProjectA.".to_string(),
                sharpened_text: None,
                profile_id: DEFAULT_PROFILE.to_string(),
                status: "ready".to_string(),
                priority: 0,
                worker_id: None,
                error: None,
                spawned_by: None,
                created_at: 42,
            })
        }

        fn list_learnings(
            &self,
            project_id: Option<&str>,
            status: Option<&str>,
        ) -> Result<Vec<Learning>, String> {
            if matches!(project_id, Some(other) if other != "pj-1") {
                return Ok(Vec::new());
            }
            Ok([learning("lr-1", "pending"), learning("lr-2", "approved")]
                .into_iter()
                .filter(|entry| status.is_none() || status == Some(entry.status.as_str()))
                .collect())
        }

        fn ask_question(
            &self,
            project_id: &str,
            worker_id: Option<&str>,
            question: &str,
            options: Option<&str>,
        ) -> Result<Question, String> {
            if project_id == "pj-nope" {
                return Err(format!("{}project: pj-nope", crate::workers::ERR_UNKNOWN));
            }
            if worker_id == Some("wk-other") {
                return Err(format!(
                    "{}worker wk-other belongs to project pj-2, not {project_id}",
                    crate::workers::ERR_REFUSED
                ));
            }
            self.asked.lock().unwrap().push((
                project_id.to_string(),
                worker_id.map(str::to_string),
                question.to_string(),
                options.map(str::to_string),
            ));
            Ok(Question {
                worker_id: worker_id.map(str::to_string),
                ..question_row("qs-new")
            })
        }

        fn answer_question(
            &self,
            id: &str,
            answer: &str,
            answered_by: &str,
        ) -> Result<Question, String> {
            match id {
                "qs-nope" => Err(format!("{}question: qs-nope", crate::workers::ERR_UNKNOWN)),
                // The row the core refuses a second answer on.
                "qs-done" => Err(format!(
                    "{}question qs-done is already answered",
                    crate::workers::ERR_REFUSED
                )),
                _ => {
                    self.answered.lock().unwrap().push((
                        id.to_string(),
                        answer.to_string(),
                        answered_by.to_string(),
                    ));
                    Ok(Question {
                        status: crate::store::QUESTION_ANSWERED.to_string(),
                        answer: Some(answer.to_string()),
                        answered_at: Some(99),
                        answered_by: Some(answered_by.to_string()),
                        ..question_row(id)
                    })
                }
            }
        }

        fn list_questions(
            &self,
            project_id: Option<&str>,
            status: Option<&str>,
        ) -> Result<Vec<Question>, String> {
            if matches!(project_id, Some(other) if other != "pj-1") {
                return Ok(Vec::new());
            }
            Ok([
                question_row("qs-1"),
                Question {
                    status: crate::store::QUESTION_ANSWERED.to_string(),
                    ..question_row("qs-2")
                },
            ]
            .into_iter()
            .filter(|entry| status.is_none() || status == Some(entry.status.as_str()))
            .collect())
        }

        fn approve_learning(&self, id: &str, text: &str) -> Result<(), String> {
            // lr-2 is the approved row of `list_learnings`: the core refuses a
            // second verdict on it, and the route has to carry that through.
            if id == "lr-2" {
                return Err(format!(
                    "{}learning lr-2 was already approved",
                    crate::workers::ERR_REFUSED
                ));
            }
            if id != "lr-1" {
                return Err(format!("unknown learning: {id}"));
            }
            self.approved
                .lock()
                .unwrap()
                .push((id.to_string(), text.to_string()));
            Ok(())
        }

        fn reject_learning(&self, id: &str) -> Result<(), String> {
            if id == "lr-2" {
                return Err(format!(
                    "{}learning lr-2 was already approved",
                    crate::workers::ERR_REFUSED
                ));
            }
            if id != "lr-1" {
                return Err(format!("unknown learning: {id}"));
            }
            self.rejected.lock().unwrap().push(id.to_string());
            Ok(())
        }

        fn list_role_variants(
            &self,
            project_id: Option<&str>,
            status: Option<&str>,
        ) -> Result<Vec<RoleVariant>, String> {
            if matches!(project_id, Some(other) if other != "pj-1") {
                return Ok(Vec::new());
            }
            Ok([
                role_variant("rv-1", "pending"),
                role_variant("rv-2", "approved"),
            ]
            .into_iter()
            .filter(|entry| status.is_none() || status == Some(entry.status.as_str()))
            .collect())
        }

        fn approve_role_variant(&self, id: &str) -> Result<(), String> {
            if id == "rv-2" {
                return Err(format!(
                    "{}role variant rv-2 was already approved",
                    crate::workers::ERR_REFUSED
                ));
            }
            if id != "rv-1" {
                return Err(format!("unknown role variant: {id}"));
            }
            self.roles_approved.lock().unwrap().push(id.to_string());
            Ok(())
        }

        fn reject_role_variant(&self, id: &str) -> Result<(), String> {
            if id == "rv-2" {
                return Err(format!(
                    "{}role variant rv-2 was already approved",
                    crate::workers::ERR_REFUSED
                ));
            }
            if id != "rv-1" {
                return Err(format!("unknown role variant: {id}"));
            }
            self.roles_rejected.lock().unwrap().push(id.to_string());
            Ok(())
        }

        fn get_activity(
            &self,
            project_id: Option<&str>,
            limit: u32,
        ) -> Result<Vec<ActivityEntry>, String> {
            let entry =
                |id: &str, project_id: &str, category: &str, created_at: i64| ActivityEntry {
                    id: id.to_string(),
                    created_at,
                    category: category.to_string(),
                    project_id: project_id.to_string(),
                    worker_id: Some("wk-1".to_string()),
                    worker_label: Some("do the thing".to_string()),
                    summary: format!("something happened in {id}"),
                };
            Ok([
                entry("ev-2", "pj-1", "message", 2),
                entry("ev-1", "pj-2", "worker", 1),
            ]
            .into_iter()
            .filter(|entry| project_id.is_none() || Some(entry.project_id.as_str()) == project_id)
            .take(limit as usize)
            .collect())
        }

        fn list_projects(&self) -> Result<Vec<ProjectOverview>, String> {
            Ok(vec![ProjectOverview {
                project: Project {
                    id: "pj-1".to_string(),
                    name: "ProjectA".to_string(),
                    repo_path: "C:/repos/a".to_string(),
                    landing_page_markdown: None,
                    max_workers: None,
                    test_command: None,
                    created_at: 42,
                },
                github_remote: true,
            }])
        }

        fn create_project(&self, name: &str, repo_path: &str) -> Result<ProjectOverview, String> {
            // The live backend probes git; this fake records the request so
            // the route test does not need a real repository.
            self.created_projects
                .lock()
                .unwrap()
                .push((name.to_string(), repo_path.to_string()));
            Ok(ProjectOverview {
                project: Project {
                    id: "pj-new".to_string(),
                    name: name.to_string(),
                    repo_path: repo_path.to_string(),
                    landing_page_markdown: None,
                    max_workers: None,
                    test_command: None,
                    created_at: 42,
                },
                github_remote: false,
            })
        }

        fn create_github_repo(
            &self,
            project_id: &str,
            name: &str,
            private: bool,
        ) -> Result<String, String> {
            core_verdict(project_id)?;
            self.repos
                .lock()
                .unwrap()
                .push((project_id.to_string(), name.to_string(), private));
            Ok("https://github.com/o/r".to_string())
        }

        fn link_github_remote(&self, project_id: &str, url: &str) -> Result<(), String> {
            // The three answers behind this route, in the words the real one
            // uses: the project lookup in `main.rs`, and `gh::link_github_remote`
            // refusing an origin it already has or failing at git itself.
            match project_id {
                "pj-nope" => {
                    return Err(format!(
                        "{}project: {project_id}",
                        crate::workers::ERR_UNKNOWN
                    ))
                }
                "pj-linked" => {
                    return Err(format!(
                        "{}remote 'origin' already exists",
                        crate::workers::ERR_REFUSED
                    ))
                }
                "pj-git" => {
                    return Err(
                        "git remote add origin failed: fatal: not a git repository".to_string()
                    )
                }
                _ => {}
            }
            self.links
                .lock()
                .unwrap()
                .push((project_id.to_string(), url.to_string()));
            Ok(())
        }

        fn merge_worker(&self, worker_id: &str, remove_worktree: bool) -> Result<Worker, String> {
            // The four ways `workers::merge_worker` refuses, in its own words,
            // plus one failure from git that is nobody's fault but the app's.
            match worker_id {
                "wk-nope" => return Err(MERGE_UNKNOWN.to_string()),
                "wk-busy" => return Err(MERGE_WRONG_COLUMN.to_string()),
                "wk-red" => return Err(MERGE_TEST_GATE.to_string()),
                "wk-live" => return Err(MERGE_STILL_RUNNING.to_string()),
                "wk-git" => return Err(MERGE_GIT_FAILED.to_string()),
                _ => {}
            }
            self.merged
                .lock()
                .unwrap()
                .push((worker_id.to_string(), remove_worktree));
            Ok(worker(worker_id))
        }

        fn get_landing_page(&self, project_id: &str) -> Result<Option<String>, String> {
            if project_id == "pj-nope" {
                return Err(format!("unknown project: {project_id}"));
            }
            Ok(self
                .landings
                .lock()
                .unwrap()
                .get(project_id)
                .cloned()
                .flatten())
        }

        fn set_landing_page(&self, project_id: &str, markdown: Option<&str>) -> Result<(), String> {
            if project_id == "pj-nope" {
                return Err(format!("unknown project: {project_id}"));
            }
            self.landings
                .lock()
                .unwrap()
                .insert(project_id.to_string(), markdown.map(str::to_string));
            Ok(())
        }
    }

    struct Fixture {
        _dir: TempDir,
        server: ApiServer,
        backend: Arc<FakeBackend>,
    }

    impl Fixture {
        /// The token, read back the way the CLI reads it.
        fn token(&self) -> String {
            let raw =
                std::fs::read_to_string(self.server.descriptor_path()).expect("read descriptor");
            let descriptor: Value = serde_json::from_str(&raw).expect("parse descriptor");
            descriptor["token"].as_str().expect("token").to_string()
        }

        /// The verdict token, read the only way anything can read it: off the
        /// live server, the way the window's Tauri command does.
        fn verdict_token(&self) -> String {
            self.server.verdict_token().to_string()
        }
    }

    fn fixture(label: &str) -> Fixture {
        let dir = TempDir::new(label);
        let backend = Arc::new(FakeBackend::default());
        // Production gate, independent of this process's PROJECTA_APP_DATA:
        // F8 scratch is `scratch_fixture`, which calls `boot(..., true)`.
        let server = boot(
            Arc::clone(&backend) as Arc<dyn ControlBackend>,
            dir.path(),
            false,
        )
        .expect("start api");
        Fixture {
            _dir: dir,
            server,
            backend,
        }
    }

    #[cfg(windows)]
    pub(crate) fn native_server(dir: &Path, run: &str, owner: &str, fence: i64) -> ApiServer {
        let backend = FakeBackend {
            native_claim: Some((run.into(), owner.into(), fence)),
            ..Default::default()
        };
        boot(Arc::new(backend), dir, false).unwrap()
    }

    #[cfg(windows)]
    pub(crate) fn native_store_server(dir: &Path, store: crate::store::Store) -> ApiServer {
        let backend = FakeBackend {
            native_store: Some(store),
            ..Default::default()
        };
        boot(Arc::new(backend), dir, false).unwrap()
    }

    #[cfg(windows)]
    pub(crate) fn native_context_status(descriptor: &Descriptor) -> u16 {
        call(
            descriptor.port,
            "GET",
            "/api/hq/v1/agent/context",
            Some(&descriptor.token),
            "",
        )
        .0
    }
    #[test]
    fn hq_control_requires_api_auth_and_resume_refuses_without_human_token() {
        let fx = fixture("hq-contract");
        let body = r#"{"projectId":"pj-1","action":"resume"}"#;
        assert_eq!(
            call(fx.server.port(), "POST", "/api/hq/v1/control", None, body).0,
            401
        );
        assert_eq!(
            call(
                fx.server.port(),
                "POST",
                "/api/hq/v1/control",
                Some(&fx.token()),
                body
            )
            .0,
            409
        );
        assert_eq!(
            call(
                fx.server.port(),
                "GET",
                "/api/hq/v1/context?projectId=pj-1&cursor=-1",
                Some(&fx.token()),
                ""
            )
            .0,
            400
        );
    }

    #[test]
    fn hq_assignment_requires_auth_and_preserves_revision_contract() {
        let fx = fixture("hq-assignment");
        let path = "/api/hq/v1/tasks/ct-1/assignment";
        let body = json!({"teamId":"development","role":"reviewer","assignee":"alice","expectedRevision":0});
        assert_eq!(
            call(fx.server.port(), "POST", path, None, &body.to_string()).0,
            401
        );
        let (status, value) = call(
            fx.server.port(),
            "POST",
            path,
            Some(&fx.token()),
            &body.to_string(),
        );
        assert_eq!(status, 200);
        assert_eq!(value["assignment"]["taskId"], "ct-1");
        assert_eq!(value["assignment"]["assignee"], "alice");
        assert_eq!(value["assignment"]["role"], "reviewer");
        assert_eq!(value["assignment"]["revision"], 1);
        assert_eq!(value["approvalAuthority"], false);
        let mut stale = body.clone();
        stale["expectedRevision"] = json!(1);
        assert_eq!(
            call(
                fx.server.port(),
                "POST",
                path,
                Some(&fx.token()),
                &stale.to_string()
            )
            .0,
            409
        );
        let mut expanded = body.clone();
        expanded["approvalAuthority"] = json!(true);
        let mut missing = body.clone();
        missing.as_object_mut().unwrap().remove("expectedRevision");
        let mut wrong = body;
        wrong["expectedRevision"] = json!("0");
        for invalid in [expanded, missing, wrong] {
            assert_eq!(
                call(
                    fx.server.port(),
                    "POST",
                    path,
                    Some(&fx.token()),
                    &invalid.to_string()
                )
                .0,
                400
            );
        }
    }

    #[test]
    fn hq_changes_require_auth_project_and_valid_cursor() {
        let fx = fixture("hq-changes");
        let path = "/api/hq/v1/changes?projectId=pj-1&cursor=200";
        assert_eq!(call(fx.server.port(), "GET", path, None, "").0, 401);
        let (status, page) = call(fx.server.port(), "GET", path, Some(&fx.token()), "");
        assert_eq!(status, 200);
        assert_eq!(page["cursor"], 200);
        assert_eq!(page["projectId"], "pj-1");
        let wait_path = "/api/hq/v1/changes?projectId=pj-1&cursor=200&waitMs=25000";
        let (status, page) = call(fx.server.port(), "GET", wait_path, Some(&fx.token()), "");
        assert_eq!(status, 200);
        assert_eq!(page["requestedWaitMs"], 25000);
        let slots = fx
            .server
            .inner
            .journal_waits
            .clone()
            .try_acquire_many_owned(8)
            .unwrap();
        assert_eq!(
            call(fx.server.port(), "GET", wait_path, Some(&fx.token()), "").0,
            503
        );
        assert_eq!(
            call(fx.server.port(), "GET", path, Some(&fx.token()), "").0,
            200
        );
        drop(slots);
        assert_eq!(
            call(fx.server.port(), "GET", wait_path, Some(&fx.token()), "").0,
            200
        );
        for (path, expected) in [
            ("/api/hq/v1/changes?projectId=pj-1&waitMs=-1", 400),
            ("/api/hq/v1/changes?projectId=pj-1&waitMs=25001", 400),
            (
                "/api/hq/v1/changes?projectId=pj-1&waitMs=18446744073709551616",
                400,
            ),
            ("/api/hq/v1/context?projectId=pj-1&waitMs=1", 400),
            ("/api/hq/v1/changes", 400),
            ("/api/hq/v1/changes?projectId=pj-1&cursor=-1", 400),
            (
                "/api/hq/v1/changes?projectId=pj-1&cursor=9223372036854775808",
                400,
            ),
            ("/api/hq/v1/changes?projectId=pj-nope", 404),
        ] {
            assert_eq!(
                call(fx.server.port(), "GET", path, Some(&fx.token()), "").0,
                expected,
                "{path}"
            );
        }
    }

    #[test]
    fn hq_run_records_require_authentication_and_explicit_project() {
        let fx = fixture("hq-run-records");
        assert_eq!(
            call(
                fx.server.port(),
                "GET",
                "/api/hq/v1/runs?projectId=pj-1",
                None,
                ""
            )
            .0,
            401
        );
        assert_eq!(
            call(
                fx.server.port(),
                "GET",
                "/api/hq/v1/runs",
                Some(&fx.token()),
                ""
            )
            .0,
            400
        );
        let (status, body) = call(
            fx.server.port(),
            "GET",
            "/api/hq/v1/runs?projectId=pj-1",
            Some(&fx.token()),
            "",
        );
        assert_eq!(status, 200);
        assert_eq!(body["apiVersion"], 1);
        assert_eq!(body["executionEnabled"], false);
    }

    /// Isolated F8: the app process has `PROJECTA_APP_DATA`, so project
    /// registration does not need the verdict token.
    fn scratch_fixture(label: &str) -> Fixture {
        let dir = TempDir::new(label);
        let backend = Arc::new(FakeBackend::default());
        let server = boot(
            Arc::clone(&backend) as Arc<dyn ControlBackend>,
            dir.path(),
            true,
        )
        .expect("start api");
        Fixture {
            _dir: dir,
            server,
            backend,
        }
    }

    /// Send one raw request and return `(status, body)`.
    fn call(
        port: u16,
        method: &str,
        target: &str,
        token: Option<&str>,
        body: &str,
    ) -> (u16, Value) {
        call_with(port, method, target, token, None, body)
    }

    /// The same, with a verdict token beside the api token: what
    /// `pa --verdict-token` sends at the four review routes.
    fn call_with(
        port: u16,
        method: &str,
        target: &str,
        token: Option<&str>,
        verdict: Option<&str>,
        body: &str,
    ) -> (u16, Value) {
        let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
        let mut stream = TcpStream::connect(addr).expect("connect");
        stream.set_read_timeout(Some(IO_TIMEOUT)).expect("timeout");

        let auth = token.map_or(String::new(), |t| format!("{TOKEN_HEADER}: {t}\r\n"));
        let auth = match verdict {
            Some(verdict) => format!("{auth}{VERDICT_TOKEN_HEADER}: {verdict}\r\n"),
            None => auth,
        };
        let request = format!(
            "{method} {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n{auth}\
             Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(request.as_bytes()).expect("write");

        let mut raw = String::new();
        stream.read_to_string(&mut raw).expect("read");
        let (head, body) = raw.split_once("\r\n\r\n").expect("response body");
        let status: u16 = head
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|code| code.parse().ok())
            .expect("status code");
        let value = serde_json::from_str(body).unwrap_or(Value::Null);
        (status, value)
    }

    #[test]
    fn a_full_server_answers_503_without_spending_a_thread() {
        let inner = Arc::new(Inner {
            journal_waits: crate::http_util::connection_limiter_with(8),
            run_credentials: agent_access::RunCredentials::default(),
            backend: Arc::new(FakeBackend::default()),
            token: "token".to_string(),
            verdict_token: "verdict".to_string(),
            app_data: std::env::temp_dir(),
            allow_unproven_project_create: false,
        });
        let listener = TcpListener::bind(SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)))
            .expect("bind");
        let port = listener.local_addr().expect("local addr").port();
        let limiter = crate::http_util::connection_limiter_with(1);
        let slots = Arc::clone(&limiter);
        std::thread::spawn(move || accept_loop(listener, inner, limiter));

        // One client that never speaks fills the only slot; its handler
        // thread is parked on the read timeout.
        let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
        let idle = TcpStream::connect(addr).expect("connect");
        crate::http_util::wait_for_permits(&slots, 0);

        // The next connection is answered by the accept loop itself.
        let mut second = TcpStream::connect(addr).expect("connect past the limit");
        second.set_read_timeout(Some(IO_TIMEOUT)).expect("timeout");
        let mut response = String::new();
        second.read_to_string(&mut response).expect("read");
        assert!(response.starts_with("HTTP/1.1 503"), "{response}");

        // A freed slot serves the next request normally again.
        drop(idle);
        crate::http_util::wait_for_permits(&slots, 1);
        let (status, _) = call(port, "GET", "/api/health", None, "");
        assert_eq!(status, 401, "a handler thread answers again");
    }

    #[test]
    fn the_descriptor_holds_the_live_port_and_token() {
        let fx = fixture("api-descriptor");

        let raw = std::fs::read_to_string(fx.server.descriptor_path()).expect("read descriptor");
        let descriptor: Value = serde_json::from_str(&raw).expect("parse descriptor");

        assert_eq!(descriptor["port"], fx.server.port());
        assert_eq!(descriptor["token"], fx.token());
        assert_eq!(fx.token().len(), 32, "{}", fx.token());
        assert_ne!(fx.server.port(), 0);
        assert!(fx.server.descriptor_path().ends_with(DESCRIPTOR_FILE));
    }

    #[test]
    fn scoped_descriptor_files_are_unique_and_removed_on_revocation() {
        let fx = fixture("api-run-files");
        let first = fx
            .server
            .issue_run_descriptor_file("run-a", "worker-a", 7, 60)
            .unwrap();
        let second = fx
            .server
            .issue_run_descriptor_file("run-a", "worker-a", 7, 60)
            .unwrap();
        assert_ne!(first, second);
        assert_ne!(first, fx.server.descriptor_path());
        let descriptor: Descriptor =
            serde_json::from_slice(&std::fs::read(&first).unwrap()).unwrap();
        assert_ne!(descriptor.token, fx.server.token);
        assert_eq!(
            call(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/context",
                Some(&descriptor.token),
                ""
            )
            .0,
            200
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&first).unwrap().permissions().mode() & 0o777,
                0o600
            );
            // W2-07b parity with the Windows directory ACL.
            let access = fx
                .server
                .descriptor_path()
                .parent()
                .unwrap()
                .join("agent-access");
            assert_eq!(
                std::fs::metadata(&access).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        fx.server.revoke_run_credentials("run-a").unwrap();
        assert!(!first.exists());
        assert!(!second.exists());
        assert_eq!(
            call(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/context",
                Some(&descriptor.token),
                ""
            )
            .0,
            401
        );
    }

    /// W2-07: a crash skips `Drop`, so `revoke_all` never deleted the scoped
    /// descriptors of the dead process. Their tokens are no longer honoured,
    /// but they must not stay on disk either: the next boot sweeps them.
    #[test]
    fn orphaned_scoped_descriptor_files_are_swept_at_boot() {
        let dir = TempDir::new("api-run-orphans");
        let access = dir.path().join("agent-access");
        std::fs::create_dir_all(&access).unwrap();
        let orphan = access.join(format!("{}.json", "0123456789abcdef".repeat(2)));
        std::fs::write(&orphan, r#"{"port":1,"token":"placeholder"}"#).unwrap();
        let foreign = access.join("notes.txt");
        std::fs::write(&foreign, "not a descriptor").unwrap();
        let server = boot(
            Arc::new(FakeBackend::default()) as Arc<dyn ControlBackend>,
            dir.path(),
            false,
        )
        .expect("start api");
        assert!(
            !orphan.exists(),
            "a predecessor's scoped descriptor survived boot"
        );
        assert!(
            foreign.exists(),
            "only files named like a descriptor are ours"
        );
        // The fresh server's own descriptors are unaffected by the sweep.
        let fresh = server
            .issue_run_descriptor_file("run-a", "worker-a", 7, 60)
            .unwrap();
        assert!(fresh.exists());
    }

    #[test]
    fn exited_session_revokes_credentials_even_when_persistence_fails() {
        let fx = fixture("api-run-exit-failure");
        let issuer = fx.server.run_credential_issuer();
        let path = issuer
            .issue_run_descriptor_file("run-a", "worker-a", 7, 60)
            .unwrap();
        let descriptor: Descriptor =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        issuer.bind_session("run-a", "session-a").unwrap();
        assert!(issuer.bind_session("run-a", "session-b").is_err());
        let result = tauri::async_runtime::block_on(issuer.observe_exit("session-a", async {
            Err::<(), String>("injected database persistence failure".into())
        }));
        assert_eq!(result.unwrap_err(), "injected database persistence failure");
        assert!(!path.exists());
        assert_eq!(
            call(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/context",
                Some(&descriptor.token),
                ""
            )
            .0,
            401
        );
    }

    #[test]
    fn scoped_run_credentials_cannot_escape_their_run_or_gain_verdict_authority() {
        let fx = fixture("api-run-scope");
        assert!(fx
            .server
            .issue_run_descriptor("run-b", "worker-a", 7, 60)
            .is_err());
        assert!(fx
            .server
            .issue_run_descriptor("run-a", "worker-a", 8, 60)
            .is_err());
        assert!(fx
            .server
            .issue_run_descriptor("run-a", "worker-a", 7, 5401)
            .is_err());
        let descriptor = fx
            .server
            .issue_run_descriptor("run-a", "worker-a", 7, 60)
            .unwrap();
        for method in ["GET", "POST"] {
            assert_eq!(
                call(
                    descriptor.port,
                    method,
                    "/api/hq/v1/tasks/ct-1/assignment",
                    Some(&descriptor.token),
                    "{}"
                )
                .0,
                403
            );
        }
        let (status, context) = call(
            descriptor.port,
            "GET",
            "/api/hq/v1/agent/context",
            Some(&descriptor.token),
            "",
        );
        assert_eq!(status, 200);
        assert_eq!(context["runId"], "run-a");
        for (path, field) in [
            ("/api/hq/v1/agent/lessons", "lessons"),
            ("/api/hq/v1/agent/release", "delivery"),
        ] {
            let (status, value) = call(descriptor.port, "GET", path, Some(&descriptor.token), "");
            assert_eq!(status, 200, "{path}");
            assert_eq!(value["apiVersion"], 1);
            assert_eq!(value["runId"], "run-a");
            assert!(value.get(field).is_some(), "{path} missing {field}");
            assert_eq!(value["source"], "rust/sqlite");
        }
        let (_, lessons) = call(
            descriptor.port,
            "GET",
            "/api/hq/v1/agent/lessons",
            Some(&descriptor.token),
            "",
        );
        assert_eq!(lessons["instructionAuthority"], false);
        let (_, release) = call(
            descriptor.port,
            "GET",
            "/api/hq/v1/agent/release",
            Some(&descriptor.token),
            "",
        );
        assert_eq!(release["delivery"]["state"], "unavailable");
        assert_eq!(release["delivery"]["automaticDelivery"], false);
        let checkpoint = json!({"idempotencyKey":"cp-1","expectedRevision":0,"completed":[],"remaining":["Finish task"],"failedApproaches":[],"evidenceIds":[]});
        let (status, saved) = call(
            descriptor.port,
            "POST",
            "/api/hq/v1/agent/checkpoint",
            Some(&descriptor.token),
            &checkpoint.to_string(),
        );
        assert_eq!(status, 200);
        assert_eq!(saved["runId"], "run-a");
        let mut conflict = checkpoint.clone();
        conflict["remaining"] = json!(["Different content"]);
        assert_eq!(
            call(
                descriptor.port,
                "POST",
                "/api/hq/v1/agent/checkpoint",
                Some(&descriptor.token),
                &conflict.to_string()
            )
            .0,
            409
        );
        assert_eq!(
            call(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/checkpoint/1",
                Some(&descriptor.token),
                ""
            )
            .1["revision"],
            1
        );
        assert_eq!(
            call(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/checkpoint/0",
                Some(&descriptor.token),
                ""
            )
            .0,
            400
        );
        let mut injected = checkpoint.clone();
        injected["runId"] = json!("run-b");
        assert_eq!(
            call(
                descriptor.port,
                "POST",
                "/api/hq/v1/agent/checkpoint",
                Some(&descriptor.token),
                &injected.to_string()
            )
            .0,
            400
        );
        assert_eq!(
            call(
                descriptor.port,
                "POST",
                "/api/hq/v1/agent/checkpoint",
                None,
                &checkpoint.to_string()
            )
            .0,
            401
        );
        for (method, path) in [
            ("GET", "/api/hq/v1/runs?projectId=pj-1"),
            ("GET", "/api/hq/v1/changes?projectId=pj-1"),
            ("GET", "/api/hq/v1/changes?projectId=pj-1&waitMs=25000"),
            ("POST", "/api/workers"),
            ("POST", "/api/workers/a/merge"),
            ("POST", "/api/hq/v1/continuous/resume"),
            ("POST", "/api/hq/v1/agent/credentials"),
            ("GET", "/api/hq/v1/agent/context?runId=run-b"),
            ("GET", "/api/hq/v1/agent/records/evidence/start?runId=run-b"),
            ("GET", "/api/hq/v1/agent/records/credentials/start"),
            ("POST", "/api/hq/v1/agent/records/evidence/start"),
        ] {
            assert_eq!(
                call(descriptor.port, method, path, Some(&descriptor.token), "{}").0,
                403,
                "{path}"
            );
        }
        for collection in ["evidence", "reviews"] {
            let path = format!("/api/hq/v1/agent/records/{collection}/start");
            let (status, page) = call(descriptor.port, "GET", &path, Some(&descriptor.token), "");
            assert_eq!(status, 200);
            assert_eq!(page["runId"], "run-a");
            assert_eq!(page["collection"], collection);
            assert!(page["cursor"].is_null());
            assert_eq!(call(descriptor.port, "GET", &path, None, "").0, 401);
            assert_eq!(
                call(descriptor.port, "GET", &path, Some(&fx.token()), "").0,
                403
            );
        }
        assert_eq!(
            call_with(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/context",
                Some(&descriptor.token),
                Some(&fx.verdict_token()),
                ""
            )
            .0,
            403
        );
        assert_eq!(
            call(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/context",
                Some(&fx.token()),
                ""
            )
            .0,
            403
        );
        let input = r#"{"candidateCommit":"commit-a","source":"git","observedAt":1}"#;
        assert_eq!(
            call(
                descriptor.port,
                "POST",
                "/api/hq/v1/agent/candidate",
                Some(&descriptor.token),
                input
            )
            .0,
            200
        );
        let forged =
            r#"{"runId":"run-b","candidateCommit":"commit-a","source":"git","observedAt":1}"#;
        assert_eq!(
            call(
                descriptor.port,
                "POST",
                "/api/hq/v1/agent/candidate",
                Some(&descriptor.token),
                forged
            )
            .0,
            400
        );
        let evidence = r#"{"idempotencyKey":"test-1","source":"cargo","observedAt":1,"candidateCommit":"commit-a","measurement":{"state":"unavailable","reason":"not run"},"payload":{}}"#;
        assert_eq!(
            call(
                descriptor.port,
                "POST",
                "/api/hq/v1/agent/evidence",
                Some(&descriptor.token),
                evidence
            )
            .0,
            200
        );
        fx.backend
            .reject_agent_run
            .store(true, std::sync::atomic::Ordering::SeqCst);
        assert_eq!(
            call(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/context",
                Some(&descriptor.token),
                ""
            )
            .0,
            403
        );
        assert_eq!(
            call(
                descriptor.port,
                "POST",
                "/api/hq/v1/agent/evidence",
                Some(&descriptor.token),
                evidence
            )
            .0,
            403
        );
        for path in ["/api/hq/v1/agent/lessons", "/api/hq/v1/agent/release"] {
            assert_eq!(
                call(descriptor.port, "GET", path, Some(&descriptor.token), "").0,
                403,
                "{path}"
            );
        }
        fx.server.revoke_run_credentials("run-a").unwrap();
        assert_eq!(
            call(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/context",
                Some(&descriptor.token),
                ""
            )
            .0,
            401
        );
    }

    /// A real store behind the scoped review route: one implementer run with a
    /// bound candidate and evidence, one reviewer run and one bystander run in
    /// the same project, and a stranger run in another project. Returns the
    /// server, the run ids, the evidence id and a raw pool for reading what the
    /// store actually wrote.
    struct ReviewRoute {
        server: ApiServer,
        implementer: String,
        reviewer: String,
        bystander: String,
        stranger: String,
        evidence: String,
        pool: sqlx::SqlitePool,
        /// Last, so the directory outlives the server and the pool on drop.
        _dir: TempDir,
    }

    const REVIEW_COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";

    fn review_route() -> ReviewRoute {
        use crate::store::development_runs::{EvidenceInput, EvidenceMeasurement};
        let dir = TempDir::new("api-review-route");
        let db = dir.path().join("projecta.db");
        tauri::async_runtime::block_on(async {
            let store = crate::store::Store::open(&db).await.unwrap();
            let pool = sqlx::SqlitePool::connect(&format!("sqlite:{}", db.display()))
                .await
                .unwrap();
            for (name, goal) in [("review", "goal"), ("elsewhere", "goal-x")] {
                let project = store
                    .create_project(name, &dir.path().join(name).to_string_lossy())
                    .await
                    .unwrap();
                sqlx::query("INSERT INTO continuous_projects VALUES(?, 'enabled', 1)")
                    .bind(&project.id)
                    .execute(&pool)
                    .await
                    .unwrap();
                sqlx::query("INSERT INTO continuous_goals(id,project_id,root_goal_id,objective,status,deadline_at,admitted,created_at,updated_at) VALUES(?1,?2,?1,'goal','open',9999999999,1,1,1)")
                    .bind(goal).bind(&project.id).execute(&pool).await.unwrap();
                sqlx::query("INSERT INTO continuous_root_policies VALUES(?,?,'test',1)")
                    .bind(goal)
                    .bind(
                        serde_json::to_string(
                            &crate::development_policy::DevelopmentPolicy::defaults(),
                        )
                        .unwrap(),
                    )
                    .execute(&pool)
                    .await
                    .unwrap();
            }
            let mut runs = Vec::new();
            for (owner, goal) in [
                ("implementer", "goal"),
                ("reviewer", "goal"),
                ("bystander", "goal"),
                ("stranger", "goal-x"),
            ] {
                sqlx::query("INSERT INTO continuous_tasks(id,goal_id,objective,owned_paths_json,dependencies_json,status,claim_owner,claim_fence,created_at,updated_at) VALUES(?1,?2,?1,'[]','[]','running',?1,1,1,1)")
                    .bind(owner).bind(goal).execute(&pool).await.unwrap();
                runs.push(
                    store
                        .record_development_run_intent(owner, owner, 1)
                        .await
                        .unwrap()
                        .id,
                );
            }
            // The reviewer run is dispatched in the reviewer role (W2-04), so
            // the fixture stays valid once the store checks that role.
            sqlx::query("INSERT INTO continuous_team_assignments(task_id,team_id,role,assignee,revision,policy_version,observed_at) VALUES('reviewer','development','reviewer','reviewer',1,1,1)")
                .execute(&pool).await.unwrap();
            store
                .bind_development_run_candidate(&runs[0], "implementer", 1, REVIEW_COMMIT, "git", 1)
                .await
                .unwrap();
            let evidence = store
                .record_development_evidence(
                    &runs[0],
                    "implementer",
                    1,
                    EvidenceInput {
                        idempotency_key: "evidence-1".into(),
                        source: "cargo".into(),
                        observed_at: 1,
                        candidate_commit: REVIEW_COMMIT.into(),
                        measurement: EvidenceMeasurement::Unavailable {
                            reason: "not run".into(),
                        },
                        payload: json!({}),
                    },
                )
                .await
                .unwrap()
                .id;
            let backend = FakeBackend {
                native_store: Some(store),
                ..Default::default()
            };
            let server = boot(Arc::new(backend), &dir.path().join("api"), false).unwrap();
            ReviewRoute {
                server,
                implementer: runs[0].clone(),
                reviewer: runs[1].clone(),
                bystander: runs[2].clone(),
                stranger: runs[3].clone(),
                evidence,
                pool,
                _dir: dir,
            }
        })
    }

    fn review_body(evidence: &str, key: &str) -> Value {
        json!({
            "idempotencyKey": key,
            "evidenceId": evidence,
            "candidateCommit": REVIEW_COMMIT,
            "disposition": "approved",
            "source": "reviewer-session",
            "observedAt": 2,
        })
    }

    /// `(run_id, reviewer_identity)` of every stored review.
    fn stored_reviews(pool: &sqlx::SqlitePool) -> Vec<(String, String)> {
        tauri::async_runtime::block_on(
            sqlx::query_as(
                "SELECT run_id, reviewer_identity FROM development_run_reviews ORDER BY rowid",
            )
            .fetch_all(pool),
        )
        .unwrap()
    }

    /// W2-01b: the reviewer principal of `POST /api/hq/v1/agent/review` is the
    /// run the scoped credential was minted for. A body that names a run -
    /// the reviewer's own, a bystander's, or the implementer's - is refused
    /// like every other injected run field on the agent routes, and no review
    /// is written for anyone.
    #[test]
    fn review_route_takes_the_reviewer_run_from_the_credential_not_the_body() {
        let fx = review_route();
        let port = fx.server.port();
        let issue = |run: &str, owner: &str| {
            fx.server
                .issue_run_descriptor(run, owner, 1, 60)
                .unwrap()
                .token
        };
        let reviewer = issue(&fx.reviewer, "reviewer");
        let implementer = issue(&fx.implementer, "implementer");
        let path = "/api/hq/v1/agent/review";

        // (1) A valid credential that names a foreign reviewer run.
        for (token, named) in [
            (&reviewer, &fx.bystander),
            (&reviewer, &fx.reviewer),
            (&implementer, &fx.reviewer),
            (&implementer, &fx.bystander),
        ] {
            for field in ["reviewerRunId", "runId"] {
                let mut forged = review_body(&fx.evidence, "forged");
                forged[field] = json!(named);
                let (status, body) = call(port, "POST", path, Some(token), &forged.to_string());
                assert_eq!(status, 400, "{field}={named}: {body}");
            }
        }
        assert!(stored_reviews(&fx.pool).is_empty());

        // The implementer's own credential is not a reviewer principal.
        let (status, body) = call(
            port,
            "POST",
            path,
            Some(&implementer),
            &review_body(&fx.evidence, "self").to_string(),
        );
        assert_eq!(status, 403, "{body}");
        assert!(stored_reviews(&fx.pool).is_empty());

        // (2) Missing, unknown and broad credentials, as on the other routes.
        let clean = review_body(&fx.evidence, "review-1").to_string();
        assert_eq!(call(port, "POST", path, None, &clean).0, 401);
        assert_eq!(
            call(port, "POST", path, Some(&"0".repeat(32)), &clean).0,
            401
        );
        let broad = {
            let raw = std::fs::read_to_string(fx.server.descriptor_path()).unwrap();
            serde_json::from_str::<Value>(&raw).unwrap()["token"]
                .as_str()
                .unwrap()
                .to_string()
        };
        assert_eq!(call(port, "POST", path, Some(&broad), &clean).0, 403);
        let query = format!("{path}?runId={}", fx.bystander);
        assert_eq!(call(port, "POST", &query, Some(&reviewer), &clean).0, 403);
        assert!(stored_reviews(&fx.pool).is_empty());

        // (3) The normal case: the review is stored with the token's run as
        // reviewer and the evidence owner as the reviewed run.
        let (status, review) = call(port, "POST", path, Some(&reviewer), &clean);
        assert_eq!(status, 200, "{review}");
        assert_eq!(review["runId"], json!(fx.implementer));
        let principal = format!("run={} ", fx.reviewer);
        assert!(
            review["reviewerIdentity"]
                .as_str()
                .is_some_and(|identity| identity.starts_with(&principal)),
            "{review}"
        );
        let stored = stored_reviews(&fx.pool);
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].0, fx.implementer);
        assert!(stored[0].1.starts_with(&principal), "{stored:?}");

        // A revoked credential is dead like on every other scoped route.
        fx.server.revoke_run_credentials(&fx.reviewer).unwrap();
        let again = review_body(&fx.evidence, "review-2").to_string();
        assert_eq!(call(port, "POST", path, Some(&reviewer), &again).0, 401);
        assert_eq!(stored_reviews(&fx.pool).len(), 1);
    }

    /// The store's refusals of a well-formed review reach the caller through
    /// the route with their own status, and none of them writes a review:
    /// unknown evidence 404, a candidate other than the evidence's 409, a
    /// reviewer from another project 403. A replay of the same submission is
    /// idempotent; the same key with another payload is a conflict.
    #[test]
    fn review_route_maps_store_refusals_and_replays_at_the_seam() {
        let fx = review_route();
        let port = fx.server.port();
        let reviewer = fx
            .server
            .issue_run_descriptor(&fx.reviewer, "reviewer", 1, 60)
            .unwrap()
            .token;
        let stranger = fx
            .server
            .issue_run_descriptor(&fx.stranger, "stranger", 1, 60)
            .unwrap()
            .token;
        let path = "/api/hq/v1/agent/review";
        let post =
            |token: &str, body: &Value| call(port, "POST", path, Some(token), &body.to_string());

        let (status, body) = post(&reviewer, &review_body("dre-missing", "missing"));
        assert_eq!(status, 404, "{body}");
        let mut other_commit = review_body(&fx.evidence, "other-commit");
        other_commit["candidateCommit"] = json!("f".repeat(40));
        let (status, body) = post(&reviewer, &other_commit);
        assert_eq!(status, 409, "{body}");
        let (status, body) = post(&stranger, &review_body(&fx.evidence, "stranger"));
        assert_eq!(status, 403, "{body}");
        assert!(stored_reviews(&fx.pool).is_empty());

        let first = review_body(&fx.evidence, "replay");
        let (status, saved) = post(&reviewer, &first);
        assert_eq!(status, 200, "{saved}");
        let (status, replayed) = post(&reviewer, &first);
        assert_eq!(status, 200, "{replayed}");
        assert_eq!(replayed["id"], saved["id"]);
        let mut changed = first.clone();
        changed["disposition"] = json!("changesRequested");
        let (status, body) = post(&reviewer, &changed);
        assert_eq!(status, 409, "{body}");
        assert_eq!(stored_reviews(&fx.pool).len(), 1);
    }

    #[test]
    fn scoped_credentials_are_revoked_when_server_handle_drops() {
        let fx = fixture("api-run-teardown");
        let descriptor = fx
            .server
            .issue_run_descriptor("run-a", "worker-a", 7, 60)
            .unwrap();
        drop(fx);
        assert_eq!(
            call(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/context",
                Some(&descriptor.token),
                ""
            )
            .0,
            401
        );
    }

    /// F1-SI-1: a dying instance must not delete a successor's descriptor.
    /// The single-instance plugin releases the mutex on `RunEvent::Exit`
    /// before our Exit handler (and later `Drop`) run; the successor may
    /// already have written a new `projecta-api.json` at the same path.
    #[test]
    fn drop_does_not_delete_a_successor_descriptor() {
        let dir = TempDir::new("api-si1-successor");
        let backend = Arc::new(FakeBackend::default());
        let server =
            start(Arc::clone(&backend) as Arc<dyn ControlBackend>, dir.path()).expect("start api");
        let path = server.descriptor_path().to_path_buf();
        let successor = serde_json::json!({
            "port": 9,
            "token": "ffffffffffffffffffffffffffffffff",
        });
        std::fs::write(&path, successor.to_string()).expect("write successor");
        drop(server);
        let raw = std::fs::read_to_string(&path).expect("successor must survive drop");
        let parsed: Value = serde_json::from_str(&raw).expect("parse");
        assert_eq!(parsed["port"], 9);
        assert_eq!(parsed["token"], "ffffffffffffffffffffffffffffffff");
    }

    #[test]
    fn drop_deletes_our_own_descriptor() {
        let dir = TempDir::new("api-si1-ours");
        let backend = Arc::new(FakeBackend::default());
        let server =
            start(Arc::clone(&backend) as Arc<dyn ControlBackend>, dir.path()).expect("start api");
        let path = server.descriptor_path().to_path_buf();
        assert!(path.is_file(), "{}", path.display());
        drop(server);
        assert!(
            !path.exists(),
            "our descriptor must leave with us: {}",
            path.display()
        );
    }

    #[test]
    fn drop_tolerates_a_missing_descriptor() {
        let dir = TempDir::new("api-si1-missing");
        let backend = Arc::new(FakeBackend::default());
        let server =
            start(Arc::clone(&backend) as Arc<dyn ControlBackend>, dir.path()).expect("start api");
        let path = server.descriptor_path().to_path_buf();
        std::fs::remove_file(&path).expect("remove");
        drop(server);
    }

    #[test]
    fn drop_leaves_a_malformed_descriptor_alone() {
        let dir = TempDir::new("api-si1-malformed");
        let backend = Arc::new(FakeBackend::default());
        let server =
            start(Arc::clone(&backend) as Arc<dyn ControlBackend>, dir.path()).expect("start api");
        let path = server.descriptor_path().to_path_buf();
        std::fs::write(&path, "not-json{{{").expect("write garbage");
        drop(server);
        let raw = std::fs::read_to_string(&path).expect("malformed must survive");
        assert_eq!(raw, "not-json{{{");
    }

    #[test]
    fn two_servers_do_not_share_a_token() {
        let a = fixture("api-token-a");
        let b = fixture("api-token-b");
        assert_ne!(a.token(), b.token());
    }

    #[test]
    fn a_request_without_the_token_is_refused() {
        let fx = fixture("api-token-roundtrip");
        let port = fx.server.port();
        let token = fx.token();

        let (status, body) = call(port, "GET", "/api/health", None, "");
        assert_eq!(status, 401, "{body}");
        assert!(
            body["error"]
                .as_str()
                .unwrap_or_default()
                .contains(TOKEN_HEADER),
            "{body}"
        );

        let (status, body) = call(port, "GET", "/api/health", Some("not-the-token"), "");
        assert_eq!(status, 401, "{body}");

        let (status, body) = call(port, "GET", "/api/health", Some(&token), "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["ok"], true);
    }

    #[test]
    fn diagnosis_reports_the_log_path_and_never_the_pack() {
        let fx = fixture("api-diagnosis");
        let token = fx.token();
        let (status, body) = call(fx.server.port(), "GET", "/api/diagnosis", Some(&token), "");
        assert_eq!(status, 200, "{body}");
        let log_path = body["logPath"].as_str().expect("logPath");
        assert!(log_path.ends_with("projecta.log"), "{log_path}");
        assert_eq!(body["panicCurrent"], false);
        assert_eq!(body["panicPrevious"], false);
        assert!(body.get("logExcerpt").is_none());
        assert!(body.get("projects").is_none());
        assert!(body.get("token").is_none());
    }

    #[test]
    fn an_unauthenticated_request_never_reaches_the_backend() {
        let fx = fixture("api-token-guard");
        let body = r#"{"projectId":"pj-1","task":"boom"}"#;

        let (status, _) = call(fx.server.port(), "POST", "/api/workers", None, body);
        assert_eq!(status, 401);
        assert!(fx.backend.created.lock().unwrap().is_empty());
    }

    #[test]
    fn creating_a_worker_passes_the_payload_through() {
        let fx = fixture("api-create");
        let stored = fx.token();
        let token = Some(stored.as_str());

        let (status, body) = call(
            fx.server.port(),
            "POST",
            "/api/workers",
            token,
            r#"{"projectId":"pj-1","task":"make the tests pass","profileId":"kimi"}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["id"], "wk-new");
        assert_eq!(body["kind"], KIND_WORKER);
        assert_eq!(
            fx.backend.created.lock().unwrap()[0],
            (
                "pj-1".to_string(),
                "make the tests pass".to_string(),
                "kimi".to_string(),
                None
            )
        );

        // The profile is optional and falls back to Claude; `spawnedBy` is the
        // caller's own bookkeeping and travels with the request.
        let (status, _) = call(
            fx.server.port(),
            "POST",
            "/api/workers",
            token,
            r#"{"projectId":"pj-1","task":"again"}"#,
        );
        assert_eq!(status, 200);
        assert_eq!(fx.backend.created.lock().unwrap()[1].2, DEFAULT_PROFILE);
        assert_eq!(fx.backend.created.lock().unwrap()[1].3, None);

        let (status, _) = call(
            fx.server.port(),
            "POST",
            "/api/workers",
            token,
            r#"{"projectId":"pj-1","task":"ordered","spawnedBy":"wk-queen"}"#,
        );
        assert_eq!(status, 200);
        assert_eq!(
            fx.backend.created.lock().unwrap()[2].3.as_deref(),
            Some("wk-queen")
        );
    }

    #[test]
    fn creating_a_worker_needs_a_project_and_a_task() {
        let fx = fixture("api-create-invalid");
        let stored = fx.token();
        let token = Some(stored.as_str());

        for body in [r#"{"task":"t"}"#, r#"{"projectId":"pj-1"}"#, "not json"] {
            let (status, reply) = call(fx.server.port(), "POST", "/api/workers", token, body);
            assert_eq!(status, 400, "{body}: {reply}");
        }
        assert!(fx.backend.created.lock().unwrap().is_empty());
    }

    #[test]
    fn workers_can_be_listed_filtered_and_read_one_at_a_time() {
        let fx = fixture("api-read");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/workers", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body[0]["id"], "wk-1");

        let (_, body) = call(port, "GET", "/api/workers?projectId=pj-other", token, "");
        assert_eq!(body.as_array().expect("array").len(), 0);

        let (status, body) = call(port, "GET", "/api/workers/wk-1/messages?limit=3", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body.as_array().expect("array").len(), 3);
        assert_eq!(body[0]["workerId"], "wk-1");
        assert_eq!(body[0]["role"], crate::store::MSG_USER);

        let (status, body) = call(port, "GET", "/api/workers/wk-1", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["worker"]["id"], "wk-1");
        assert_eq!(body["column"], crate::status::COL_WORKING);

        let (status, body) = call(port, "GET", "/api/workers/wk-nope", token, "");
        assert_eq!(status, 404, "{body}");

        let (status, body) = call(port, "GET", "/api/board?projectId=pj-1", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body[0]["worker"]["id"], "wk-1");

        let (status, body) = call(port, "GET", "/api/quota", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body.as_array().expect("array").len(), 0);
    }

    #[test]
    fn the_usage_ledger_is_served_fleet_wide_with_a_capped_limit() {
        let fx = fixture("api-usage");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/usage", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["online"], true);
        assert_eq!(body["authorized"], true);
        assert_eq!(body["events"][0]["model"], "gpt-5.6-sol");
        assert_eq!(body["events"][0]["tokensIn"], 19);
        assert_eq!(
            body["events"][0]["costUsd"],
            Value::Null,
            "an unpriced row stays unpriced rather than becoming a zero"
        );
        assert_eq!(body["today"]["requests"], 1);
        assert_eq!(body["total"]["tokensIn"], 119);
        assert_eq!(body["reportedCostUsd"], 42.5);

        // The limit travels; an unreadable one is the default, and anything
        // over the cap is the cap.
        let (status, _) = call(port, "GET", "/api/usage?limit=3", token, "");
        assert_eq!(status, 200);
        let (status, _) = call(port, "GET", "/api/usage?limit=nope", token, "");
        assert_eq!(status, 200);
        let (status, _) = call(port, "GET", "/api/usage?limit=99999", token, "");
        assert_eq!(status, 200);
        let (status, _) = call(port, "GET", "/api/usage?limit=0", token, "");
        assert_eq!(status, 200);
        assert_eq!(
            *fx.backend.usage_limits.lock().unwrap(),
            vec![
                USAGE_LIMIT_DEFAULT,
                3,
                USAGE_LIMIT_DEFAULT,
                USAGE_LIMIT_MAX,
                1
            ]
        );

        // Read only, and behind the token like everything else on this port.
        let (status, _) = call(port, "POST", "/api/usage", token, "{}");
        assert_eq!(status, 405);
        let (status, _) = call(port, "GET", "/api/usage", None, "");
        assert_eq!(status, 401);
    }

    #[test]
    fn digests_are_listed_by_date_and_read_one_at_a_time() {
        let fx = fixture("api-digests");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/projects/pj-1/digests", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body[0], "2026-08-27");

        let (status, body) = call(
            port,
            "GET",
            "/api/projects/pj-1/digests/2026-08-27",
            token,
            "",
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["date"], "2026-08-27");
        assert!(body["markdown"]
            .as_str()
            .expect("markdown")
            .starts_with("# 2026-08-27"));

        // A day with no page, and a project that is not one: both 404.
        let (status, _) = call(
            port,
            "GET",
            "/api/projects/pj-1/digests/2026-08-01",
            token,
            "",
        );
        assert_eq!(status, 404);
        let (status, _) = call(port, "GET", "/api/projects/pj-nope/digests", token, "");
        assert_eq!(status, 404);
        let (status, _) = call(
            port,
            "GET",
            "/api/projects/pj-nope/digests/2026-08-27",
            token,
            "",
        );
        assert_eq!(status, 404);

        // The date becomes a file name, so a shape that is not a date is
        // refused by the route before the backend ever sees it.
        for bad in ["2026-8-1", "%2e%2e%2fetc", "nope"] {
            let (status, body) = call(
                port,
                "GET",
                &format!("/api/projects/pj-1/digests/{bad}"),
                token,
                "",
            );
            assert_eq!(status, 400, "{bad} -> {body}");
        }

        let (status, body) = call(port, "POST", "/api/projects/pj-1/digests", token, "{}");
        assert_eq!(status, 405, "{body}");
    }

    #[test]
    fn statistics_carry_their_window_and_say_when_a_number_is_not_measured() {
        let fx = fixture("api-stats");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        // No range at all is "everything", not an error.
        let (status, body) = call(port, "GET", "/api/projects/pj-1/stats", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["range"], "all");
        assert_eq!(body["since"], Value::Null);
        assert_eq!(body["overview"]["workersActive"], 1);
        assert_eq!(body["completion"]["percent"], 42.5);
        // The gap travels as `null` all the way to the client, which is what
        // lets the tab print "nicht gemessen" instead of a zero.
        assert_eq!(body["tokens"], Value::Null);

        let (status, body) = call(
            port,
            "GET",
            "/api/projects/pj-1/stats?range=week",
            token,
            "",
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["range"], "week");
        assert!(body["since"].as_i64().is_some());
        assert_eq!(
            *fx.backend.stats_ranges.lock().unwrap(),
            vec![
                crate::stats::StatsRange::All,
                crate::stats::StatsRange::Week
            ]
        );

        // A window that names nothing is refused rather than widened.
        let (status, body) = call(
            port,
            "GET",
            "/api/projects/pj-1/stats?range=gestern",
            token,
            "",
        );
        assert_eq!(status, 400, "{body}");
        // The refusal names every accepted window, aliases included.
        let text = body.to_string();
        assert!(text.contains("7d"), "{text}");
        assert!(text.contains("30d"), "{text}");

        // The aliases the refusal names are actually accepted.
        let (status, body) = call(port, "GET", "/api/projects/pj-1/stats?range=7d", token, "");
        assert_eq!(status, 200, "{body}");

        let (status, _) = call(port, "GET", "/api/projects/pj-nope/stats", token, "");
        assert_eq!(status, 404);

        let (status, body) = call(port, "POST", "/api/projects/pj-1/stats", token, "{}");
        assert_eq!(status, 405, "{body}");
    }

    #[test]
    fn budgets_are_listed_and_written_one_profile_at_a_time() {
        let fx = fixture("api-budgets");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/budgets", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body[0]["profileId"], "claude");
        assert_eq!(body[0]["fiveHourPct"], 90);
        assert!(body[0]["sevenDayPct"].is_null());

        // An absent window is left alone, an explicit null clears it.
        let (status, body) = call(
            port,
            "PUT",
            "/api/budgets",
            token,
            r#"{"profileId":"claude","fiveHourPct":80,"sevenDayPct":null}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["fiveHourPct"], 80);
        assert!(body["sevenDayPct"].is_null());
        assert_eq!(
            fx.backend.budgets.lock().unwrap().clone(),
            vec![("claude".to_string(), Some(Some(80)), Some(None))]
        );

        // Caller mistakes are 4xx, each named: no profile, no window, a
        // percentage out of range, and a profile that does not exist.
        for (body_text, expected) in [
            (r#"{"fiveHourPct":80}"#, 400),
            (r#"{"profileId":"claude"}"#, 400),
            (r#"{"profileId":"claude","fiveHourPct":0}"#, 400),
            (r#"{"profileId":"claude","fiveHourPct":101}"#, 400),
            (r#"{"profileId":"claude","fiveHourPct":"90"}"#, 400),
            (r#"{"profileId":"nope","fiveHourPct":90}"#, 404),
        ] {
            let (status, reply) = call(port, "PUT", "/api/budgets", token, body_text);
            assert_eq!(status, expected, "{body_text} -> {reply}");
            assert!(reply["error"].is_string(), "{reply}");
        }

        let (status, body) = call(port, "DELETE", "/api/budgets", token, "");
        assert_eq!(status, 405, "{body}");
    }

    #[test]
    fn the_providers_route_mirrors_the_overview() {
        let fx = fixture("api-providers");
        let stored = fx.token();
        let token = Some(stored.as_str());

        let (status, body) = call(fx.server.port(), "GET", "/api/providers", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body[0]["id"], "claude");
        assert_eq!(body[0]["kind"], crate::providers::KIND_SUBSCRIPTION);
        assert_eq!(body[0]["connected"], true);
        assert_eq!(body[0]["detail"], "1.2.3");
        assert_eq!(body[0]["quotaState"], crate::store::QUOTA_BLOCKED);
        assert_eq!(body[0]["blockedUntil"], 1_800_000_000_i64);
        assert_eq!(body[0]["omniRouteOnline"], false);
        assert_eq!(body[0]["usage"]["percent"], 87);
        assert_eq!(body[0]["usage"]["source"], "hook");
        assert!(body[0]["usage"]["used"].is_string());

        // Read only: there is no way to post a key through the control port.
        let (status, body) = call(fx.server.port(), "POST", "/api/providers", token, "{}");
        assert_eq!(status, 405, "{body}");
    }

    #[test]
    fn merging_a_worker_passes_the_worktree_flag_through() {
        let fx = fixture("api-merge");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let stored_verdict = fx.verdict_token();
        let verdict = Some(stored_verdict.as_str());
        let port = fx.server.port();

        // Ordinary API token cannot merge (F0-1).
        let (status, body) = call(port, "POST", "/api/workers/wk-1/merge", token, "");
        assert_eq!(status, 403, "{body}");
        assert!(fx.backend.merged.lock().unwrap().is_empty());

        let (status, body) = call_with(
            port,
            "POST",
            "/api/workers/wk-1/merge",
            token,
            Some("wrong-verdict"),
            "",
        );
        assert_eq!(status, 403, "{body}");
        assert!(fx.backend.merged.lock().unwrap().is_empty());

        // An empty body is the ordinary call: keep the worktree.
        let (status, body) = call_with(port, "POST", "/api/workers/wk-1/merge", token, verdict, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["id"], "wk-1");
        assert_eq!(
            fx.backend.merged.lock().unwrap()[0],
            ("wk-1".to_string(), false)
        );

        // Both spellings of the flag reach the backend.
        let (status, _) = call_with(
            port,
            "POST",
            "/api/workers/wk-2/merge",
            token,
            verdict,
            r#"{"removeWorktree":true}"#,
        );
        assert_eq!(status, 200);
        assert_eq!(
            fx.backend.merged.lock().unwrap()[1],
            ("wk-2".to_string(), true)
        );

        let (status, _) = call_with(
            port,
            "POST",
            "/api/workers/wk-3/merge",
            token,
            verdict,
            r#"{"remove_worktree":true}"#,
        );
        assert_eq!(status, 200);
        assert_eq!(
            fx.backend.merged.lock().unwrap()[2],
            ("wk-3".to_string(), true)
        );

        // Merging is a POST; anything else is named as the wrong verb.
        let (status, _) = call(port, "GET", "/api/workers/wk-1/merge", token, "");
        assert_eq!(status, 405);

        // And it is behind the token like every other route.
        let (status, _) = call(port, "POST", "/api/workers/wk-9/merge", None, "");
        assert_eq!(status, 401);
        assert_eq!(fx.backend.merged.lock().unwrap().len(), 3);
    }

    #[test]
    fn sending_text_reaches_the_worker() {
        let fx = fixture("api-send");
        let stored = fx.token();
        let token = Some(stored.as_str());

        let (status, body) = call(
            fx.server.port(),
            "POST",
            "/api/workers/wk-1/send",
            token,
            r#"{"text":"ja, weiter"}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["ok"], true);
        assert_eq!(
            fx.backend.sent.lock().unwrap()[0],
            ("wk-1".to_string(), "ja, weiter".to_string())
        );

        let (status, _) = call(
            fx.server.port(),
            "POST",
            "/api/workers/wk-1/send",
            token,
            "{}",
        );
        assert_eq!(status, 400);
    }

    #[test]
    fn telling_the_orchestrator_answers_with_it() {
        let fx = fixture("api-orchestrator-send");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(
            port,
            "POST",
            "/api/projects/pj-1/orchestrator/send",
            token,
            r#"{"text":"bau mir X"}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["id"], "wk-orch");
        assert_eq!(body["kind"], KIND_ORCHESTRATOR);
        assert_eq!(
            fx.backend.told.lock().unwrap()[0],
            ("pj-1".to_string(), "bau mir X".to_string())
        );

        // A missing field is a mistake; an empty one is a bare Enter.
        let (status, _) = call(
            port,
            "POST",
            "/api/projects/pj-1/orchestrator/send",
            token,
            "{}",
        );
        assert_eq!(status, 400);
        let (status, _) = call(
            port,
            "POST",
            "/api/projects/pj-1/orchestrator/send",
            token,
            r#"{"text":""}"#,
        );
        assert_eq!(status, 200);

        // Whatever the core says about an unknown project comes through.
        let (status, body) = call(
            port,
            "POST",
            "/api/projects/pj-nope/orchestrator/send",
            token,
            r#"{"text":"hallo"}"#,
        );
        // A mistyped project id is the caller's mistake, not the app's.
        assert_eq!(status, 404);
        assert_eq!(body["error"], "unknown project: pj-nope");

        let (status, _) = call(
            port,
            "GET",
            "/api/projects/pj-1/orchestrator/send",
            token,
            "",
        );
        assert_eq!(status, 405);
    }

    #[test]
    fn a_scout_and_a_triage_are_started_through_the_api() {
        let fx = fixture("api-scout");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "POST", "/api/scout", token, r#"{"projectId":"pj-1"}"#);
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["id"], "wk-scout");
        assert_eq!(body["kind"], crate::store::KIND_SCOUT);
        assert_eq!(body["branch"], "");

        let (status, body) = call(
            port,
            "POST",
            "/api/scout/triage",
            token,
            r#"{"projectId":"pj-1","urls":["https://github.com/a/b","  ","https://github.com/c/d"]}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["id"], "wk-triage");

        assert_eq!(
            *fx.backend.scouted.lock().unwrap(),
            vec![
                ("pj-1".to_string(), Vec::new()),
                (
                    "pj-1".to_string(),
                    vec![
                        "https://github.com/a/b".to_string(),
                        "https://github.com/c/d".to_string(),
                    ],
                ),
            ]
        );

        // A triage without any usable url never reaches the backend.
        for body in [
            r#"{"projectId":"pj-1"}"#,
            r#"{"projectId":"pj-1","urls":[]}"#,
            r#"{"projectId":"pj-1","urls":["  "]}"#,
            r#"{"urls":["https://x"]}"#,
        ] {
            let (status, reply) = call(port, "POST", "/api/scout/triage", token, body);
            assert_eq!(status, 400, "{body}: {reply}");
        }
        assert_eq!(fx.backend.scouted.lock().unwrap().len(), 2);
    }

    #[test]
    fn a_queen_is_no_longer_started_through_the_api() {
        let fx = fixture("api-queen");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(
            port,
            "POST",
            "/api/queens",
            token,
            r#"{"projectId":"pj-1","task":"Backend-API","spawnedBy":"wk-orch"}"#,
        );
        assert_eq!(status, 410, "{body}");
        assert!(
            body["error"]
                .as_str()
                .unwrap_or("")
                .contains("queen creation is retired"),
            "{body}"
        );
        assert!(fx.backend.queened.lock().unwrap().is_empty());

        let (status, _) = call(
            port,
            "POST",
            "/api/queens",
            token,
            r#"{"projectId":"pj-1","task":"Frontend","profileId":"kimi"}"#,
        );
        assert_eq!(status, 410);
        assert!(fx.backend.queened.lock().unwrap().is_empty());

        // The route is gone as a write target; missing fields are not a 400.
        for payload in [r#"{"task":"t"}"#, r#"{"projectId":"pj-1"}"#, "not json"] {
            let (status, reply) = call(port, "POST", "/api/queens", token, payload);
            assert_eq!(status, 410, "{payload}: {reply}");
        }

        let (status, _) = call(port, "GET", "/api/queens", token, "");
        assert_eq!(status, 405);
    }

    #[test]
    fn in_crate_fixtures_may_still_call_create_queen() {
        let fx = fixture("api-queen-fixture");
        let queen = fx
            .backend
            .create_queen("pj-1", "Backend-API", None, None)
            .expect("fixtures keep the in-crate spawn");
        assert_eq!(queen.kind, KIND_QUEEN);
        assert_eq!(fx.backend.queened.lock().unwrap().len(), 1);
    }

    #[test]
    fn the_tree_nests_children_under_their_controllers() {
        let fx = fixture("api-tree");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/projects/pj-1/tree", token, "");
        assert_eq!(status, 200, "{body}");

        // The orchestrator is a root coordinator; the queen nests under it and
        // the two employees under the queen.
        let coordinators = body["coordinators"].as_array().expect("coordinators");
        assert_eq!(coordinators.len(), 1, "{body}");
        let orchestrator = &coordinators[0];
        assert_eq!(orchestrator["id"], "wk-orch");
        assert_eq!(orchestrator["kind"], KIND_ORCHESTRATOR);
        let queens = orchestrator["children"].as_array().expect("queens");
        assert_eq!(queens.len(), 1, "{body}");
        assert_eq!(queens[0]["id"], "wk-queen");
        assert_eq!(queens[0]["kind"], KIND_QUEEN);
        let employees = queens[0]["children"].as_array().expect("employees");
        assert_eq!(
            employees
                .iter()
                .map(|node| node["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["wk-e1", "wk-e2"]
        );

        // The user-started worker and the one whose controller is gone both
        // sit at the root: the tree never drops a worker.
        let workers = body["workers"].as_array().expect("workers");
        assert_eq!(
            workers
                .iter()
                .map(|node| node["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["wk-1", "wk-orphan"]
        );
        assert!(workers
            .iter()
            .all(|node| node["children"].as_array().expect("children").is_empty()));

        let (status, body) = call(port, "GET", "/api/projects/pj-other/tree", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["coordinators"].as_array().expect("empty").len(), 0);
        assert_eq!(body["workers"].as_array().expect("empty").len(), 0);

        let (status, _) = call(port, "POST", "/api/projects/pj-1/tree", token, "{}");
        assert_eq!(status, 405);
    }

    #[test]
    fn build_tree_shows_every_worker_exactly_once() {
        // A queen started by the user (no controller), her employee, and a
        // plain worker: two roots, one child.
        let queen = Worker {
            spawned_by: None,
            ..queen("wk-q")
        };
        let employee = Worker {
            spawned_by: Some("wk-q".to_string()),
            ..worker("wk-e")
        };
        let plain = worker("wk-w");

        let tree = build_tree(&[plain.clone(), queen.clone(), employee.clone()]);
        assert_eq!(tree.coordinators.len(), 1);
        assert_eq!(tree.coordinators[0].worker, queen);
        assert_eq!(
            tree.coordinators[0]
                .children
                .iter()
                .map(|node| node.worker.id.as_str())
                .collect::<Vec<_>>(),
            vec!["wk-e"]
        );
        assert_eq!(tree.workers.len(), 1);
        assert_eq!(tree.workers[0].worker, plain);

        assert_eq!(
            build_tree(&[]),
            ProjectTree {
                coordinators: Vec::new(),
                workers: Vec::new()
            }
        );
    }

    /// Every id the tree renders, roots first and each subtree depth first.
    /// A worker that appears twice - or not at all - shows up here.
    fn tree_ids(tree: &ProjectTree) -> Vec<&str> {
        fn walk<'a>(nodes: &'a [TreeNode], out: &mut Vec<&'a str>) {
            for node in nodes {
                out.push(node.worker.id.as_str());
                walk(&node.children, out);
            }
        }
        let mut out = Vec::new();
        walk(&tree.coordinators, &mut out);
        walk(&tree.workers, &mut out);
        out
    }

    /// A worker with a declared controller. `spawned_by` is whatever the
    /// caller said, so these tests may say anything, cycles included.
    fn spawned(id: &str, parent: &str) -> Worker {
        Worker {
            spawned_by: Some(parent.to_string()),
            ..worker(id)
        }
    }

    #[test]
    fn build_tree_makes_a_worker_that_named_itself_a_root() {
        // The shortest possible cycle: its own controller. It cannot nest
        // under itself, so it stands at the root - once, with no children.
        let selfie = spawned("wk-s", "wk-s");

        let tree = build_tree(std::slice::from_ref(&selfie));
        assert_eq!(tree_ids(&tree), vec!["wk-s"]);
        assert!(tree.coordinators.is_empty());
        assert_eq!(tree.workers[0].worker, selfie);
        assert!(tree.workers[0].children.is_empty());
    }

    #[test]
    fn build_tree_keeps_both_halves_of_a_two_worker_cycle() {
        // A and B name each other: neither is a root by the usual rule, and
        // before the cycle was handled both fell out of the tree entirely.
        let a = spawned("wk-a", "wk-b");
        let b = spawned("wk-b", "wk-a");

        let tree = build_tree(&[a.clone(), b.clone()]);
        assert_eq!(tree_ids(&tree), vec!["wk-a", "wk-b"]);
        assert!(tree.coordinators.is_empty());
        assert_eq!(tree.workers.len(), 1);
        assert_eq!(tree.workers[0].worker, a, "the smaller id becomes the root");
        assert_eq!(tree.workers[0].children.len(), 1);
        assert_eq!(tree.workers[0].children[0].worker, b);
        assert!(tree.workers[0].children[0].children.is_empty());
    }

    #[test]
    fn build_tree_keeps_a_three_worker_cycle_and_the_child_hanging_off_it() {
        // wk-a <- wk-c <- wk-b <- wk-a, and wk-d an ordinary employee of
        // wk-c. All four are rendered, each exactly once.
        let a = spawned("wk-a", "wk-b");
        let b = spawned("wk-b", "wk-c");
        let c = spawned("wk-c", "wk-a");
        let d = spawned("wk-d", "wk-c");

        let tree = build_tree(&[a.clone(), b, c.clone(), d]);
        let mut ids = tree_ids(&tree);
        assert_eq!(ids.len(), 4, "{ids:?}");
        ids.sort_unstable();
        assert_eq!(ids, vec!["wk-a", "wk-b", "wk-c", "wk-d"]);

        // The ring hangs off its root; the child sits where its own
        // `spawned_by` puts it, not at the root.
        assert_eq!(tree.workers.len(), 1);
        let root = &tree.workers[0];
        assert_eq!(root.worker, a);
        assert_eq!(root.children.len(), 1);
        let under_a = &root.children[0];
        assert_eq!(under_a.worker, c);
        assert_eq!(
            under_a
                .children
                .iter()
                .map(|node| node.worker.id.as_str())
                .collect::<Vec<_>>(),
            vec!["wk-b", "wk-d"]
        );
        assert!(under_a.children[0].children.is_empty());
        assert!(under_a.children[1].children.is_empty());
    }

    #[test]
    fn build_tree_leaves_the_healthy_hierarchy_alone_beside_a_cycle() {
        let queen = queen("wk-q");
        let employee = spawned("wk-e", "wk-q");
        let plain = worker("wk-w");
        let healthy = [queen.clone(), employee.clone(), plain.clone()];
        let a = spawned("wk-a", "wk-b");
        let b = spawned("wk-b", "wk-a");

        let alone = build_tree(&healthy);
        let beside = build_tree(&[queen, employee, plain, a.clone(), b]);

        // The queen's subtree and the plain worker are byte-for-byte what
        // they are without the cycle; the cycle only adds a root of its own.
        assert_eq!(beside.coordinators, alone.coordinators);
        assert_eq!(beside.workers[0], alone.workers[0]);
        assert_eq!(alone.workers.len(), 1);
        assert_eq!(beside.workers.len(), 2);
        assert_eq!(beside.workers[1].worker, a);
        assert_eq!(
            tree_ids(&beside),
            vec!["wk-q", "wk-e", "wk-w", "wk-a", "wk-b"]
        );
    }

    #[test]
    fn build_tree_picks_the_same_cycle_root_every_time() {
        let a = spawned("wk-a", "wk-b");
        let b = spawned("wk-b", "wk-a");

        // Same input twice: same tree, down to the order of the roots.
        assert_eq!(
            build_tree(&[a.clone(), b.clone()]),
            build_tree(&[a.clone(), b.clone()])
        );
        // And the order the rows arrive in does not decide the root either.
        assert_eq!(build_tree(&[b, a]).workers[0].worker.id, "wk-a");

        // `created_at` outranks the id: the worker that existed first is the
        // one the ring hangs from, whatever the ids sort like.
        let old = Worker {
            created_at: 1,
            ..spawned("wk-z", "wk-y")
        };
        let young = Worker {
            created_at: 99,
            ..spawned("wk-y", "wk-z")
        };
        for input in [[old.clone(), young.clone()], [young.clone(), old.clone()]] {
            let tree = build_tree(&input);
            assert_eq!(tree.workers.len(), 1);
            assert_eq!(tree.workers[0].worker, old);
            assert_eq!(tree_ids(&tree), vec!["wk-z", "wk-y"]);
        }
    }

    #[test]
    fn build_tree_files_a_promoted_cycle_root_under_its_kind() {
        // A queen and her employee name each other. Promoting the queen to a
        // root must still sort her into `coordinators` - a ring is no reason
        // for a coordinator to show up among the plain employees.
        let queen = Worker {
            created_at: 1,
            spawned_by: Some("wk-e".to_string()),
            ..queen("wk-q")
        };
        let employee = Worker {
            created_at: 2,
            ..spawned("wk-e", "wk-q")
        };

        let tree = build_tree(&[queen.clone(), employee.clone()]);
        assert_eq!(tree_ids(&tree), vec!["wk-q", "wk-e"]);
        assert!(tree.workers.is_empty(), "the queen is not a plain worker");
        assert_eq!(tree.coordinators.len(), 1);
        assert_eq!(tree.coordinators[0].worker, queen);
        assert_eq!(tree.coordinators[0].children.len(), 1);
        assert_eq!(tree.coordinators[0].children[0].worker, employee);
    }

    #[test]
    fn build_tree_gives_every_cycle_a_root_of_its_own() {
        // Two rings that do not touch. Walking the first one must not swallow
        // the second, and the second must not be left without a root.
        let a = spawned("wk-a", "wk-b");
        let b = spawned("wk-b", "wk-a");
        let c = spawned("wk-c", "wk-d");
        let d = spawned("wk-d", "wk-c");

        let tree = build_tree(&[b, d, a, c]);
        assert_eq!(tree_ids(&tree), vec!["wk-a", "wk-b", "wk-c", "wk-d"]);
        assert_eq!(
            tree.workers
                .iter()
                .map(|node| node.worker.id.as_str())
                .collect::<Vec<_>>(),
            vec!["wk-a", "wk-c"]
        );
    }

    #[test]
    fn build_tree_does_not_promote_an_older_descendant_of_a_three_worker_cycle() {
        // The descendant predates every ring member, but root selection is only
        // allowed to consider the ring itself. Otherwise it would be detached
        // from the controller named in `spawned_by`.
        let old_descendant = Worker {
            created_at: 0,
            ..spawned("wk-child", "wk-c")
        };
        let a = Worker {
            created_at: 10,
            ..spawned("wk-a", "wk-b")
        };
        let b = Worker {
            created_at: 20,
            ..spawned("wk-b", "wk-c")
        };
        let c = Worker {
            created_at: 30,
            ..spawned("wk-c", "wk-a")
        };

        for input in [
            [old_descendant.clone(), c.clone(), b.clone(), a.clone()],
            [b.clone(), a.clone(), old_descendant.clone(), c.clone()],
        ] {
            let tree = build_tree(&input);
            assert_eq!(tree.workers.len(), 1);
            assert_eq!(tree.workers[0].worker.id, "wk-a");
            let mut ids = tree_ids(&tree);
            ids.sort_unstable();
            assert_eq!(ids, vec!["wk-a", "wk-b", "wk-c", "wk-child"]);
            let under_c = &tree.workers[0].children[0].children;
            assert!(under_c.iter().any(|node| node.worker == old_descendant));
        }
    }

    #[test]
    fn build_tree_keeps_children_of_a_self_referencing_root() {
        // Treating the self-link as a root must not discard ordinary workers
        // that named that root as their controller.
        let selfie = spawned("wk-self", "wk-self");
        let child = spawned("wk-child", "wk-self");
        let grandchild = spawned("wk-grandchild", "wk-child");

        let tree = build_tree(&[grandchild.clone(), child.clone(), selfie.clone()]);
        assert_eq!(
            tree_ids(&tree),
            vec!["wk-self", "wk-child", "wk-grandchild"]
        );
        assert_eq!(tree.workers.len(), 1);
        assert_eq!(tree.workers[0].worker, selfie);
        assert_eq!(tree.workers[0].children[0].worker, child);
        assert_eq!(tree.workers[0].children[0].children[0].worker, grandchild);
    }

    #[test]
    fn recommendation_status_unknown_id_is_not_a_bad_request() {
        let fx = fixture("api-rec-status-unknown");
        let token = fx.token();
        let (status, body) = call(
            fx.server.port(),
            "POST",
            "/api/recommendations/rc-nope/status",
            Some(&token),
            r#"{"status":"dismissed"}"#,
        );
        assert_eq!(status, 404, "{body}");
        assert_eq!(
            fx.backend
                .recommendation_status_calls
                .load(std::sync::atomic::Ordering::SeqCst),
            1
        );
    }

    #[test]
    fn recommendation_status_store_failure_is_not_a_bad_request() {
        let fx = fixture("api-rec-status-store");
        let token = fx.token();
        let (status, body) = call(
            fx.server.port(),
            "POST",
            "/api/recommendations/rc-boom/status",
            Some(&token),
            r#"{"status":"dismissed"}"#,
        );
        assert_eq!(status, 500, "{body}");
        assert_eq!(
            fx.backend
                .recommendation_status_calls
                .load(std::sync::atomic::Ordering::SeqCst),
            1
        );
    }

    #[test]
    fn recommendation_status_invalid_input_never_calls_the_backend() {
        let fx = fixture("api-rec-status-invalid");
        let token = fx.token();
        for (request, expected_error) in [
            (
                r#"{"status":"maybe"}"#,
                "unknown recommendation status: maybe (expected accepted or dismissed)",
            ),
            ("{}", "status is required"),
            (r#"{"status":42}"#, "status is required"),
            (r#"{"status":null}"#, "status is required"),
        ] {
            let (status, body) = call(
                fx.server.port(),
                "POST",
                "/api/recommendations/rc-1/status",
                Some(&token),
                request,
            );
            assert_eq!(status, 400, "{request}: {body}");
            assert_eq!(body, json!({"error": expected_error}), "{request}");
            assert_eq!(
                fx.backend
                    .recommendation_status_calls
                    .load(std::sync::atomic::Ordering::SeqCst),
                0,
                "{request}"
            );
        }
        assert!(fx.backend.statuses.lock().unwrap().is_empty());
    }

    #[test]
    fn recommendation_status_both_valid_values_keep_the_success_contract() {
        let fx = fixture("api-rec-status-valid");
        let token = fx.token();
        for word in ["accepted", "dismissed"] {
            let request = json!({"status": word}).to_string();
            let (status, body) = call(
                fx.server.port(),
                "POST",
                "/api/recommendations/rc-1/status",
                Some(&token),
                &request,
            );
            assert_eq!(status, 200, "{body}");
            assert_eq!(body, json!({"ok": true}));
        }
        assert_eq!(
            fx.backend
                .recommendation_status_calls
                .load(std::sync::atomic::Ordering::SeqCst),
            2
        );
        assert_eq!(fx.backend.statuses.lock().unwrap().len(), 2);
    }

    #[test]
    fn recommendations_are_listed_added_accepted_and_dismissed() {
        let fx = fixture("api-recommendations");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/recommendations", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body[0]["id"], "rc-1");
        assert_eq!(body[0]["status"], "new");
        assert_eq!(body[0]["effort"], "M");

        let (_, body) = call(
            port,
            "GET",
            "/api/recommendations?projectId=pj-other",
            token,
            "",
        );
        assert_eq!(body.as_array().expect("array").len(), 0);

        let (status, body) = call(
            port,
            "POST",
            "/api/recommendations",
            token,
            r#"{"projectId":"pj-1","title":"notify","rationale":"Dateiwaechter","effort":"S"}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["id"], "rc-new");
        assert_eq!(body["title"], "notify");
        assert_eq!(body["url"], Value::Null);
        assert_eq!(body["effort"], "S");

        // title and rationale are the two the caller cannot leave out.
        for body in [
            r#"{"projectId":"pj-1","title":"t"}"#,
            r#"{"projectId":"pj-1","rationale":"r"}"#,
            r#"{"title":"t","rationale":"r"}"#,
        ] {
            let (status, reply) = call(port, "POST", "/api/recommendations", token, body);
            assert_eq!(status, 400, "{body}: {reply}");
        }

        let (status, body) = call(port, "POST", "/api/recommendations/rc-1/accept", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["id"], "tq-from-rc");
        assert_eq!(body["status"], "ready");

        let (status, body) = call(
            port,
            "POST",
            "/api/recommendations/rc-nope/accept",
            token,
            "",
        );
        assert_eq!(status, 404, "{body}");

        let (status, body) = call(
            port,
            "POST",
            "/api/recommendations/rc-1/status",
            token,
            r#"{"status":"dismissed"}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["ok"], true);
        assert_eq!(
            *fx.backend.statuses.lock().unwrap(),
            vec![("rc-1".to_string(), "dismissed".to_string())]
        );

        let (status, _) = call(
            port,
            "POST",
            "/api/recommendations/rc-1/status",
            token,
            r#"{"status":"maybe"}"#,
        );
        assert_eq!(status, 400);
        let (status, _) = call(
            port,
            "POST",
            "/api/recommendations/rc-1/status",
            token,
            "{}",
        );
        assert_eq!(status, 400);
        assert_eq!(fx.backend.statuses.lock().unwrap().len(), 1);
    }

    #[test]
    fn learnings_are_listed_filtered_approved_and_rejected() {
        let fx = fixture("api-learnings");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/learnings", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body.as_array().expect("array").len(), 2);
        assert_eq!(body[0]["id"], "lr-1");
        assert_eq!(body[0]["patternLabel"], "Gates");
        assert_eq!(body[0]["workerId"], "wk-1");

        // Both filters travel, alone and together.
        let (_, body) = call(port, "GET", "/api/learnings?status=pending", token, "");
        assert_eq!(body.as_array().expect("array").len(), 1);
        assert_eq!(body[0]["id"], "lr-1");
        let (_, body) = call(port, "GET", "/api/learnings?projectId=pj-other", token, "");
        assert_eq!(body.as_array().expect("array").len(), 0);
        let (_, body) = call(
            port,
            "GET",
            "/api/learnings?projectId=pj-1&status=approved",
            token,
            "",
        );
        assert_eq!(body[0]["id"], "lr-2");

        // The per-project route is the same list, scoped by the path.
        let (status, body) = call(port, "GET", "/api/projects/pj-1/learnings", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body.as_array().expect("array").len(), 2);
        let (_, body) = call(
            port,
            "GET",
            "/api/projects/pj-1/learnings?status=pending",
            token,
            "",
        );
        assert_eq!(body.as_array().expect("array").len(), 1);
        let (_, body) = call(port, "GET", "/api/projects/pj-other/learnings", token, "");
        assert_eq!(body.as_array().expect("array").len(), 0);

        // The verdict routes want the second token as well; the rest of this
        // test is about what happens once it is there.
        let stored_verdict = fx.verdict_token();
        let verdict = Some(stored_verdict.as_str());

        let (status, body) = call_with(
            port,
            "POST",
            "/api/learnings/lr-1/approve",
            token,
            verdict,
            r#"{"text":"Gates seriell"}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["ok"], true);
        assert_eq!(
            *fx.backend.approved.lock().unwrap(),
            vec![("lr-1".to_string(), "Gates seriell".to_string())]
        );

        // Missing, empty and blank text are all refused before the backend.
        for body in ["", "{}", r#"{"text":""}"#, r#"{"text":"   "}"#] {
            let (status, reply) = call_with(
                port,
                "POST",
                "/api/learnings/lr-1/approve",
                token,
                verdict,
                body,
            );
            assert_eq!(status, 400, "{body}: {reply}");
            assert!(
                reply["error"]
                    .as_str()
                    .is_some_and(|err| err.contains("text")),
                "{reply}"
            );
        }
        assert_eq!(fx.backend.approved.lock().unwrap().len(), 1);

        let (status, body) = call_with(
            port,
            "POST",
            "/api/learnings/lr-nope/approve",
            token,
            verdict,
            r#"{"text":"x"}"#,
        );
        assert_eq!(status, 400, "{body}");

        let (status, body) = call_with(
            port,
            "POST",
            "/api/learnings/lr-1/reject",
            token,
            verdict,
            "",
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["ok"], true);
        assert_eq!(
            *fx.backend.rejected.lock().unwrap(),
            vec!["lr-1".to_string()]
        );

        let (status, _) = call_with(
            port,
            "POST",
            "/api/learnings/lr-nope/reject",
            token,
            verdict,
            "",
        );
        assert_eq!(status, 400);

        // A collection reached with the wrong verb says so.
        let (status, _) = call(port, "POST", "/api/learnings", token, "{}");
        assert_eq!(status, 405);
    }

    /// The four routes an agent must not be able to reach with the token it
    /// can read out of `projecta-api.json`.
    const VERDICT_ROUTES: [(&str, &str); 4] = [
        ("/api/learnings/lr-1/approve", r#"{"text":"x"}"#),
        ("/api/learnings/lr-1/reject", ""),
        ("/api/roles/rv-1/approve", ""),
        ("/api/roles/rv-1/reject", ""),
    ];

    /// Setup trust is desktop-only: the API has no route that could mint a
    /// grant, not even for a caller holding BOTH tokens — the Tauri command
    /// `approve_setup_trust` has no HTTP counterpart at all.
    #[test]
    fn no_api_route_mints_setup_trust() {
        let fx = fixture("api-no-setup-trust");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let verdict = fx.verdict_token();
        let port = fx.server.port();
        for target in [
            "/api/setup-trust",
            "/api/workers/wk-1/setup-trust",
            "/api/workers/wk-1/setup-trust/approve",
            "/api/projects/pj-1/setup-trust",
        ] {
            let (status, body) =
                call_with(port, "POST", target, token, Some(verdict.as_str()), "{}");
            assert_eq!(status, 404, "{target}: {body}");
        }
    }

    #[test]
    fn a_verdict_needs_the_second_token_the_descriptor_does_not_carry() {
        let fx = fixture("api-verdict-token");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        // What an agent has: the descriptor. It holds the api token and
        // nothing else, so the verdict token cannot be read out of it.
        let raw = std::fs::read_to_string(fx.server.descriptor_path()).expect("read descriptor");
        let descriptor: Value = serde_json::from_str(&raw).expect("parse descriptor");
        assert!(descriptor.get("verdictToken").is_none(), "{descriptor}");
        let stored_verdict = fx.verdict_token();
        assert_eq!(stored_verdict.len(), 32, "{stored_verdict}");
        assert_ne!(stored_verdict, stored);
        assert!(!raw.contains(&stored_verdict), "{raw}");

        for (target, body) in VERDICT_ROUTES {
            // The api token alone is what every agent has, and it is not
            // enough for any of the four.
            let (status, reply) = call(port, "POST", target, token, body);
            assert_eq!(status, 403, "{target}: {reply}");
            assert!(
                reply["error"]
                    .as_str()
                    .is_some_and(|err| err.contains(VERDICT_TOKEN_HEADER)),
                "{target}: {reply}"
            );

            // A guessed one is no better than none.
            let (status, reply) =
                call_with(port, "POST", target, token, Some("not-the-token"), body);
            assert_eq!(status, 403, "{target}: {reply}");

            // And the api token still has to be right: a verdict token does
            // not stand in for it.
            let (status, reply) = call_with(
                port,
                "POST",
                target,
                Some("not-the-token"),
                Some(stored_verdict.as_str()),
                body,
            );
            assert_eq!(status, 401, "{target}: {reply}");

            // With both, the verdict goes through.
            let (status, reply) = call_with(
                port,
                "POST",
                target,
                token,
                Some(stored_verdict.as_str()),
                body,
            );
            assert_eq!(status, 200, "{target}: {reply}");
        }

        // Every route reached the backend exactly once - the refusals above
        // stopped before it.
        assert_eq!(fx.backend.approved.lock().unwrap().len(), 1);
        assert_eq!(fx.backend.rejected.lock().unwrap().len(), 1);
        assert_eq!(fx.backend.roles_approved.lock().unwrap().len(), 1);
        assert_eq!(fx.backend.roles_rejected.lock().unwrap().len(), 1);
    }

    // -- questions (Phase 21) ----------------------------------------------

    #[test]
    fn asking_a_question_reaches_the_core_and_comes_back_whole() {
        let fx = fixture("api-question-ask");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, reply) = call(
            port,
            "POST",
            "/api/questions",
            token,
            r#"{"projectId":"pj-1","workerId":"wk-1","question":"Postgres oder SQLite?","options":"Postgres,SQLite"}"#,
        );
        assert_eq!(status, 200, "{reply}");
        assert_eq!(reply["id"], "qs-new");
        assert_eq!(reply["scope"], "worker");
        assert_eq!(reply["optionsJson"], r#"["Postgres","SQLite"]"#);
        assert_eq!(reply["status"], "open");
        assert_eq!(
            *fx.backend.asked.lock().unwrap(),
            vec![(
                "pj-1".to_string(),
                Some("wk-1".to_string()),
                "Postgres oder SQLite?".to_string(),
                Some("Postgres,SQLite".to_string()),
            )]
        );

        // No worker is a preflight question, not a mistake.
        let (status, reply) = call(
            port,
            "POST",
            "/api/questions",
            token,
            r#"{"projectId":"pj-1","question":"Welche DB?"}"#,
        );
        assert_eq!(status, 200, "{reply}");
        assert_eq!(reply["workerId"], Value::Null);
        assert_eq!(fx.backend.asked.lock().unwrap().len(), 2);
    }

    #[test]
    fn a_question_route_says_whose_mistake_it_was() {
        let fx = fixture("api-question-status");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        // 400: the request itself is unusable.
        for body in [
            r#"{"workerId":"wk-1","question":"was?"}"#,
            r#"{"projectId":"pj-1"}"#,
            r#"{"projectId":"pj-1","question":"   "}"#,
        ] {
            let (status, reply) = call(port, "POST", "/api/questions", token, body);
            assert_eq!(status, 400, "{body}: {reply}");
        }

        // 404: an id that names nothing.
        let (status, reply) = call(
            port,
            "POST",
            "/api/questions",
            token,
            r#"{"projectId":"pj-nope","question":"was?"}"#,
        );
        assert_eq!(status, 404, "{reply}");

        // 409: everything exists, the combination does not.
        let (status, reply) = call(
            port,
            "POST",
            "/api/questions",
            token,
            r#"{"projectId":"pj-1","workerId":"wk-other","question":"was?"}"#,
        );
        assert_eq!(status, 409, "{reply}");

        assert!(
            fx.backend.asked.lock().unwrap().is_empty(),
            "not one of those reached the core"
        );
    }

    /// The decision the user took over Q1's open question: answering stays
    /// open to everybody, but "a person decided this" has to be earned.
    #[test]
    fn an_answer_is_evidence_of_a_person_only_when_it_carries_the_token() {
        let fx = fixture("api-question-answered-by");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let verdict = fx.verdict_token();
        let port = fx.server.port();

        // Without the header: accepted, and filed as what it is.
        let (status, reply) = call(
            port,
            "POST",
            "/api/questions/qs-1/answer",
            token,
            r#"{"answer":"SQLite"}"#,
        );
        assert_eq!(status, 200, "{reply}");
        assert_eq!(reply["answeredBy"], "unverified");

        // With it: the same answer, now on the record as a person's.
        let (status, reply) = call_with(
            port,
            "POST",
            "/api/questions/qs-2/answer",
            token,
            Some(verdict.as_str()),
            r#"{"answer":"SQLite"}"#,
        );
        assert_eq!(status, 200, "{reply}");
        assert_eq!(reply["answeredBy"], "human");

        // A token that is wrong is not the same as no token. Somebody sent it
        // to prove something, and filing that as "unverified" would swallow a
        // typo in the one place it matters.
        let (status, reply) = call_with(
            port,
            "POST",
            "/api/questions/qs-3/answer",
            token,
            Some("nicht-das-token"),
            r#"{"answer":"SQLite"}"#,
        );
        assert_eq!(status, 403, "{reply}");

        let answered = fx.backend.answered.lock().unwrap().clone();
        assert_eq!(
            answered,
            vec![
                (
                    "qs-1".to_string(),
                    "SQLite".to_string(),
                    crate::store::ANSWERED_BY_UNVERIFIED.to_string()
                ),
                (
                    "qs-2".to_string(),
                    "SQLite".to_string(),
                    crate::store::ANSWERED_BY_HUMAN.to_string()
                ),
            ],
            "the refused call must not have reached the core"
        );
    }

    #[test]
    fn answering_a_question_types_it_at_the_core() {
        let fx = fixture("api-question-answer");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, reply) = call(
            port,
            "POST",
            "/api/questions/qs-1/answer",
            token,
            r#"{"answer":"SQLite"}"#,
        );
        assert_eq!(status, 200, "{reply}");
        assert_eq!(reply["status"], "answered");
        assert_eq!(reply["answer"], "SQLite");
        // No verdict header on this call, so the row must not claim a person.
        assert_eq!(
            *fx.backend.answered.lock().unwrap(),
            vec![(
                "qs-1".to_string(),
                "SQLite".to_string(),
                crate::store::ANSWERED_BY_UNVERIFIED.to_string()
            )]
        );
        assert_eq!(reply["answeredBy"], "unverified");

        // An empty answer is a decision too - "go on" - so only the field has
        // to be there, exactly as on `worker send`.
        let (status, reply) = call(
            port,
            "POST",
            "/api/questions/qs-1/answer",
            token,
            r#"{"answer":""}"#,
        );
        assert_eq!(status, 200, "{reply}");

        let (status, reply) = call(port, "POST", "/api/questions/qs-1/answer", token, "{}");
        assert_eq!(status, 400, "{reply}");

        let (status, reply) = call(
            port,
            "POST",
            "/api/questions/qs-nope/answer",
            token,
            r#"{"answer":"x"}"#,
        );
        assert_eq!(status, 404, "{reply}");

        // Somebody already decided this one: too late, not wrong.
        let (status, reply) = call(
            port,
            "POST",
            "/api/questions/qs-done/answer",
            token,
            r#"{"answer":"x"}"#,
        );
        assert_eq!(status, 409, "{reply}");
    }

    #[test]
    fn listing_questions_filters_by_project_and_status() {
        let fx = fixture("api-question-list");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, reply) = call(port, "GET", "/api/questions", token, "");
        assert_eq!(status, 200, "{reply}");
        assert_eq!(reply.as_array().expect("a list").len(), 2);

        let (_, reply) = call(port, "GET", "/api/questions?status=open", token, "");
        let open = reply.as_array().expect("a list");
        assert_eq!(open.len(), 1);
        assert_eq!(open[0]["id"], "qs-1");

        let (_, reply) = call(port, "GET", "/api/questions?projectId=pj-2", token, "");
        assert!(reply.as_array().expect("a list").is_empty());
    }

    #[test]
    fn the_question_routes_refuse_the_wrong_verb() {
        let fx = fixture("api-question-verb");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, _) = call(port, "DELETE", "/api/questions", token, "");
        assert_eq!(status, 405);
        let (status, _) = call(port, "GET", "/api/questions/qs-1/answer", token, "");
        assert_eq!(status, 405);
    }

    #[test]
    fn two_servers_do_not_share_a_verdict_token() {
        let a = fixture("api-verdict-a");
        let b = fixture("api-verdict-b");
        assert_ne!(a.verdict_token(), b.verdict_token());
    }

    #[test]
    fn a_second_verdict_on_a_decided_row_is_a_conflict() {
        let fx = fixture("api-verdict-twice");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let stored_verdict = fx.verdict_token();
        let verdict = Some(stored_verdict.as_str());
        let port = fx.server.port();

        // lr-2 and rv-2 are the rows that already carry a verdict. The core
        // refuses them with the shared `refused: ` prefix, and that is a 409:
        // the request is well formed, it just arrives too late.
        for (target, body) in [
            ("/api/learnings/lr-2/approve", r#"{"text":"x"}"#),
            ("/api/learnings/lr-2/reject", ""),
            ("/api/roles/rv-2/approve", ""),
            ("/api/roles/rv-2/reject", ""),
        ] {
            let (status, reply) = call_with(port, "POST", target, token, verdict, body);
            assert_eq!(status, 409, "{target}: {reply}");
            assert!(
                reply["error"]
                    .as_str()
                    .is_some_and(|err| err.starts_with(crate::workers::ERR_REFUSED)),
                "{target}: {reply}"
            );
        }

        assert!(fx.backend.approved.lock().unwrap().is_empty());
        assert!(fx.backend.roles_approved.lock().unwrap().is_empty());
    }

    #[test]
    fn role_variants_are_listed_filtered_approved_and_rejected() {
        let fx = fixture("api-roles");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/roles", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body.as_array().expect("array").len(), 2);
        assert_eq!(body[0]["id"], "rv-1");
        // The camelCase contract, as the frontend reads it.
        assert_eq!(body[0]["baseProfileId"], "claude");
        assert_eq!(body[0]["patternLabel"], "tests-fixen");
        assert_eq!(body[0]["systemPromptAddition"], "Lauf die Gates seriell.");
        assert_eq!(body[0]["version"], 1);

        // Both filters travel, alone and together.
        let (_, body) = call(port, "GET", "/api/roles?status=pending", token, "");
        assert_eq!(body.as_array().expect("array").len(), 1);
        assert_eq!(body[0]["id"], "rv-1");
        let (_, body) = call(port, "GET", "/api/roles?projectId=pj-other", token, "");
        assert_eq!(body.as_array().expect("array").len(), 0);
        let (_, body) = call(
            port,
            "GET",
            "/api/roles?projectId=pj-1&status=approved",
            token,
            "",
        );
        assert_eq!(body[0]["id"], "rv-2");

        // The per-project route is the same list, scoped by the path.
        let (status, body) = call(port, "GET", "/api/projects/pj-1/roles", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body.as_array().expect("array").len(), 2);
        let (_, body) = call(
            port,
            "GET",
            "/api/projects/pj-1/roles?status=pending",
            token,
            "",
        );
        assert_eq!(body.as_array().expect("array").len(), 1);
        let (_, body) = call(port, "GET", "/api/projects/pj-other/roles", token, "");
        assert_eq!(body.as_array().expect("array").len(), 0);

        // Both verdicts take no body at all.
        let stored_verdict = fx.verdict_token();
        let verdict = Some(stored_verdict.as_str());

        let (status, body) = call_with(port, "POST", "/api/roles/rv-1/approve", token, verdict, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["ok"], true);
        assert_eq!(
            *fx.backend.roles_approved.lock().unwrap(),
            vec!["rv-1".to_string()]
        );

        let (status, body) = call_with(port, "POST", "/api/roles/rv-1/reject", token, verdict, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(
            *fx.backend.roles_rejected.lock().unwrap(),
            vec!["rv-1".to_string()]
        );

        let (status, _) = call_with(
            port,
            "POST",
            "/api/roles/rv-nope/approve",
            token,
            verdict,
            "",
        );
        assert_eq!(status, 400);
        let (status, _) = call_with(
            port,
            "POST",
            "/api/roles/rv-nope/reject",
            token,
            verdict,
            "",
        );
        assert_eq!(status, 400);

        // A collection reached with the wrong verb says so.
        let (status, _) = call(port, "POST", "/api/roles", token, "{}");
        assert_eq!(status, 405);
    }

    #[test]
    fn the_activity_feed_is_listed_filtered_and_capped() {
        let fx = fixture("api-activity");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/activity", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body.as_array().expect("array").len(), 2);
        // The camelCase contract, as the frontend reads it.
        assert_eq!(body[0]["id"], "ev-2");
        assert_eq!(body[0]["category"], "message");
        assert_eq!(body[0]["workerLabel"], "do the thing");
        assert_eq!(body[0]["createdAt"], 2);

        let (_, body) = call(port, "GET", "/api/activity?projectId=pj-2", token, "");
        assert_eq!(body.as_array().expect("array").len(), 1);
        assert_eq!(body[0]["id"], "ev-1");

        // The limit travels; an unreadable one is the default, not an error.
        let (_, body) = call(port, "GET", "/api/activity?limit=1", token, "");
        assert_eq!(body.as_array().expect("array").len(), 1);
        let (status, _) = call(port, "GET", "/api/activity?limit=nope", token, "");
        assert_eq!(status, 200);

        // A collection reached with the wrong verb says so.
        let (status, _) = call(port, "POST", "/api/activity", token, "{}");
        assert_eq!(status, 405);
    }

    #[test]
    fn unknown_routes_and_wrong_verbs_are_named() {
        let fx = fixture("api-routes");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        // A path nothing serves is a 404, and so is a path that only looks
        // like one of the known ones.
        for target in ["/nope", "/api/workers/wk-1/nope", "/api/projects/pj-1"] {
            let (status, body) = call(port, "GET", target, token, "");
            assert_eq!(status, 404, "{target}: {body}");
        }

        // Every shape `route` answers is in the 405 list, so a wrong verb is
        // never reported as a wrong path. `send` between `messages` and
        // `merge` is the one that used to be missing.
        for (method, target) in [
            ("DELETE", "/api/board"),
            ("POST", "/api/health"),
            ("POST", "/api/diagnosis"),
            ("GET", "/api/workers/wk-1/send"),
            ("DELETE", "/api/workers/wk-1"),
            ("DELETE", "/api/workers/wk-1/messages"),
            ("GET", "/api/queue/tq-1/cancel"),
            ("GET", "/api/scout/triage"),
            ("GET", "/api/recommendations/rc-1/accept"),
            ("GET", "/api/recommendations/rc-1/status"),
            ("GET", "/api/learnings/lr-1/approve"),
            ("GET", "/api/learnings/lr-1/reject"),
            ("GET", "/api/roles/rv-1/approve"),
            ("GET", "/api/roles/rv-1/reject"),
        ] {
            let (status, body) = call(port, method, target, token, "");
            assert_eq!(status, 405, "{method} {target}: {body}");
        }
    }

    #[test]
    fn the_project_listing_carries_the_github_remote_flag() {
        let fx = fixture("api-projects");
        let stored = fx.token();
        let token = Some(stored.as_str());

        let (status, body) = call(fx.server.port(), "GET", "/api/projects", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body[0]["id"], "pj-1");
        assert_eq!(body[0]["name"], "ProjectA");
        assert_eq!(body[0]["repoPath"], "C:/repos/a");
        // Additive: the new field sits next to the ones that were always there.
        assert_eq!(body[0]["githubRemote"], true);

        let (status, _) = call(fx.server.port(), "PUT", "/api/projects", token, "");
        assert_eq!(status, 405);
    }

    #[test]
    fn a_project_is_created_through_the_api() {
        let fx = fixture("api-project-create");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let verdict = fx.verdict_token();
        let port = fx.server.port();
        let body = r#"{"name":"Golden","repoPath":"C:/scratch/golden"}"#;

        let (status, reply) = call(port, "POST", "/api/projects", token, body);
        assert_eq!(status, 403, "{reply}");
        assert!(
            reply["error"]
                .as_str()
                .is_some_and(|err| err.contains(VERDICT_TOKEN_HEADER)),
            "{reply}"
        );
        let (status, reply) = call_with(
            port,
            "POST",
            "/api/projects",
            token,
            Some("not-the-token"),
            body,
        );
        assert_eq!(status, 403, "{reply}");
        assert_eq!(reply["error"], "invalid verdict token");
        assert_eq!(fx.backend.created_projects.lock().unwrap().len(), 0);

        let (status, body) = call_with(
            port,
            "POST",
            "/api/projects",
            token,
            Some(verdict.as_str()),
            body,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["id"], "pj-new");
        assert_eq!(body["name"], "Golden");
        assert_eq!(body["repoPath"], "C:/scratch/golden");
        assert_eq!(body["githubRemote"], false);
        assert_eq!(
            *fx.backend.created_projects.lock().unwrap(),
            vec![("Golden".to_string(), "C:/scratch/golden".to_string())]
        );

        for payload in [
            "{}",
            r#"{"name":"Golden"}"#,
            r#"{"repoPath":"C:/scratch/golden"}"#,
            r#"{"name":"","repoPath":"C:/scratch/golden"}"#,
            r#"{"name":"   ","repoPath":"C:/scratch/golden"}"#,
            r#"{"name":"Golden","repo_path":"C:/scratch/golden"}"#,
            "not json",
        ] {
            let (status, reply) = call_with(
                port,
                "POST",
                "/api/projects",
                token,
                Some(verdict.as_str()),
                payload,
            );
            assert_eq!(status, 400, "{payload}: {reply}");
        }
        assert_eq!(fx.backend.created_projects.lock().unwrap().len(), 1);

        let (status, _) = call(port, "DELETE", "/api/projects", token, "");
        assert_eq!(status, 405);
    }

    #[test]
    fn isolated_app_data_may_create_a_project_without_a_verdict() {
        let fx = scratch_fixture("api-project-create-scratch");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let (status, body) = call(
            fx.server.port(),
            "POST",
            "/api/projects",
            token,
            r#"{"name":"Golden","repoPath":"C:/scratch/golden"}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["id"], "pj-new");
        assert_eq!(fx.backend.created_projects.lock().unwrap().len(), 1);
    }

    #[test]
    fn a_github_repository_is_created_through_the_api() {
        let fx = fixture("api-github-create");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(
            port,
            "POST",
            "/api/projects/pj-1/github/create",
            token,
            r#"{"name":"my-repo","private":false}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body, Value::String("https://github.com/o/r".to_string()));
        assert_eq!(
            *fx.backend.repos.lock().unwrap(),
            vec![("pj-1".to_string(), "my-repo".to_string(), false)]
        );

        // `private` defaults to true when it is omitted.
        let (status, _) = call(
            port,
            "POST",
            "/api/projects/pj-1/github/create",
            token,
            r#"{"name":"other"}"#,
        );
        assert_eq!(status, 200);
        assert!(fx.backend.repos.lock().unwrap()[1].2);

        // A repository needs a name.
        for body in ["{}", r#"{"private":true}"#, "not json"] {
            let (status, reply) = call(
                port,
                "POST",
                "/api/projects/pj-1/github/create",
                token,
                body,
            );
            assert_eq!(status, 400, "{body}: {reply}");
        }
        assert_eq!(fx.backend.repos.lock().unwrap().len(), 2);

        let (status, _) = call(
            port,
            "DELETE",
            "/api/projects/pj-1/github/create",
            token,
            "",
        );
        assert_eq!(status, 405);
    }

    #[test]
    fn a_github_remote_is_linked_through_the_api() {
        let fx = fixture("api-github-link");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(
            port,
            "POST",
            "/api/projects/pj-1/github/link",
            token,
            r#"{"url":"https://github.com/o/r.git"}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["ok"], true);
        assert_eq!(
            *fx.backend.links.lock().unwrap(),
            vec![("pj-1".to_string(), "https://github.com/o/r.git".to_string())]
        );

        for body in ["{}", r#"{"name":"r"}"#] {
            let (status, reply) = call(port, "POST", "/api/projects/pj-1/github/link", token, body);
            assert_eq!(status, 400, "{body}: {reply}");
        }
        assert_eq!(fx.backend.links.lock().unwrap().len(), 1);

        let (status, _) = call(port, "DELETE", "/api/projects/pj-1/github/link", token, "");
        assert_eq!(status, 405);
    }

    /// The listing routes filter by project id, and a filter answers an id
    /// that names nothing with an empty collection - which reads like a
    /// project nobody has done any work in yet. Each one asks whether the
    /// project exists first, exactly as `/api/workers/<id>/messages` asks
    /// about its worker.
    #[test]
    fn a_listing_route_refuses_an_unknown_project() {
        let fx = fixture("api-list-unknown-project");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        for target in [
            "/api/workers?projectId=pj-nope",
            "/api/board?projectId=pj-nope",
            "/api/queue?projectId=pj-nope",
            "/api/recommendations?projectId=pj-nope",
            "/api/learnings?projectId=pj-nope",
            "/api/questions?projectId=pj-nope",
            "/api/roles?projectId=pj-nope",
            "/api/activity?projectId=pj-nope",
            "/api/projects/pj-nope/tree",
            "/api/projects/pj-nope/learnings",
            "/api/projects/pj-nope/roles",
        ] {
            let (status, body) = call(port, "GET", target, token, "");
            assert_eq!(status, 404, "{target}: {body}");
            assert_eq!(body["error"], "unknown project: pj-nope", "{target}");
        }

        // A project that exists and simply has nothing filed under it is an
        // ordinary empty answer - the case the 404 has to stay clear of.
        let (status, body) = call(port, "GET", "/api/workers?projectId=pj-other", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body.as_array().expect("a list").len(), 0);

        // No project named at all is the fleet-wide form, which asks nothing.
        let (status, body) = call(port, "GET", "/api/workers", token, "");
        assert_eq!(status, 200, "{body}");
        assert!(!body.as_array().expect("a list").is_empty());

        // A lookup that fails is the app's own problem, not a wrong id.
        let (status, body) = call(port, "GET", "/api/queue?projectId=pj-boom", token, "");
        assert_eq!(status, 500, "{body}");
    }

    /// Both routes used to answer 400 for every failure, including the ones the
    /// app itself is responsible for - the mirror image of the 500-for-all the
    /// creating routes had. They read the core's vocabulary now.
    ///
    /// The url stays a 400 from the route: it is the one part of the request
    /// this file can judge on its own, and it judges it before the core is
    /// asked, exactly as the digest date and the stats range are judged.
    #[test]
    fn linking_and_accepting_say_whose_fault_the_failure_was() {
        let fx = fixture("api-status-4xx");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        for (project, url, expected) in [
            ("pj-nope", "https://github.com/o/r.git", 404),
            ("pj-linked", "https://github.com/o/r.git", 409),
            ("pj-git", "https://github.com/o/r.git", 500),
            ("pj-1", "https://gitlab.com/o/r.git", 400),
            ("pj-1", "https://github.com/o/r.git", 200),
        ] {
            let (status, body) = call(
                port,
                "POST",
                &format!("/api/projects/{project}/github/link"),
                token,
                &format!(r#"{{"url":"{url}"}}"#),
            );
            assert_eq!(status, expected, "{project} {url}: {body}");
        }
        // Only the one that got through reached the backend.
        assert_eq!(fx.backend.links.lock().unwrap().len(), 1);

        // The repository name on the neighbouring create route is the same
        // kind of judgement, made in the same place and for the same reason.
        let (status, body) = call(
            port,
            "POST",
            "/api/projects/pj-1/github/create",
            token,
            r#"{"name":"not a name!"}"#,
        );
        assert_eq!(status, 400, "{body}");
        assert!(fx.backend.repos.lock().unwrap().is_empty());

        for (id, expected) in [
            ("rc-nope", 404),
            ("rc-done", 409),
            ("rc-boom", 500),
            ("rc-1", 200),
        ] {
            let (status, body) = call(
                port,
                "POST",
                &format!("/api/recommendations/{id}/accept"),
                token,
                "",
            );
            assert_eq!(status, expected, "{id}: {body}");
        }
    }

    /// The cancel route answered 400 for every failure too - the member of
    /// the class the rounds above could not reach, because telling a wrong id
    /// from a wrong moment had to happen in `store.rs` first (see the module
    /// head). It reads the core's vocabulary now, like `accept` above.
    #[test]
    fn cancelling_a_queued_task_says_whose_fault_the_failure_was() {
        let fx = fixture("api-queue-cancel");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        // The body carries the core's own sentence, so a caller that reads it
        // learns the same thing the status says.
        for (id, expected, says) in [
            ("tq-nope", 404, "unknown queued task: tq-nope"),
            ("tq-busy", 409, "refused: task tq-busy is dispatching"),
            ("tq-boom", 500, "failed to cancel queued task"),
            ("tq-1", 200, "\"ok\":true"),
        ] {
            let (status, body) = call(port, "POST", &format!("/api/queue/{id}/cancel"), token, "");
            assert_eq!(status, expected, "{id}: {body}");
            assert!(body.to_string().contains(says), "{id}: {body}");
        }
    }

    #[test]
    fn a_landing_page_round_trips_through_the_api() {
        let fx = fixture("api-landing-page");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        // Nothing written yet: the field is null, not missing.
        let (status, body) = call(port, "GET", "/api/projects/pj-1/landing-page", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["markdown"], Value::Null);

        // Storing keeps the content verbatim, newline and all.
        let markdown = "# One\n\nSome *content*.\n";
        let payload = serde_json::json!({ "markdown": markdown }).to_string();
        let (status, body) = call(
            port,
            "POST",
            "/api/projects/pj-1/landing-page",
            token,
            &payload,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["ok"], true);
        assert_eq!(
            fx.backend
                .landings
                .lock()
                .unwrap()
                .get("pj-1")
                .cloned()
                .flatten(),
            Some(markdown.to_string())
        );

        let (status, body) = call(port, "GET", "/api/projects/pj-1/landing-page", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["markdown"], markdown);

        // Null clears; an unknown project is a 404 on both verbs.
        for (method, target, payload) in [
            ("GET", "/api/projects/pj-nope/landing-page", ""),
            (
                "POST",
                "/api/projects/pj-nope/landing-page",
                r#"{"markdown":"x"}"#,
            ),
        ] {
            let (status, reply) = call(port, method, target, token, payload);
            assert_eq!(status, 404, "{reply}");
            assert!(reply["error"].as_str().unwrap().contains("unknown project"));
        }

        let (status, _) = call(
            port,
            "POST",
            "/api/projects/pj-1/landing-page",
            token,
            "null",
        );
        assert_eq!(status, 200);
        let (status, reply) = call(
            port,
            "POST",
            "/api/projects/pj-1/landing-page",
            token,
            "not json",
        );
        assert_eq!(status, 400, "{reply}");

        let (status, _) = call(port, "DELETE", "/api/projects/pj-1/landing-page", token, "");
        assert_eq!(status, 405);
    }

    #[test]
    fn the_request_line_is_split_into_path_query_and_headers() {
        let head = "get /api/workers?projectId=pj%2D1&flag HTTP/1.1\r\n\
                    Host: 127.0.0.1\r\nX-ProjectA-Token: abc";
        let request = parse_request(head, "{}".to_string()).expect("parse");

        assert_eq!(request.method, "GET");
        assert_eq!(request.path, "/api/workers");
        assert_eq!(request.query["projectId"], "pj-1");
        assert_eq!(request.query["flag"], "");
        assert_eq!(request.headers[TOKEN_HEADER], "abc");
        assert_eq!(request.segments(), vec!["api", "workers"]);
    }

    #[test]
    fn percent_escapes_survive_the_path() {
        assert_eq!(percent_decode("wk%2D1"), "wk-1");
        assert_eq!(percent_decode("a+b"), "a+b");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    /// The escapes the old byte-indexed `&str` slice panicked on. Every one of
    /// them reaches `percent_decode` through `parse_request`, which runs before
    /// the token is looked at.
    #[test]
    fn a_broken_escape_is_passed_through_instead_of_panicking() {
        // Three and four byte characters straight after the `%`: the old
        // `raw[i + 1..i + 3]` cut them in half.
        assert_eq!(percent_decode("%\u{20ac}"), "%\u{20ac}");
        assert_eq!(percent_decode("a=%\u{20ac}&b=1"), "a=%\u{20ac}&b=1");
        assert_eq!(percent_decode("%\u{1f980}"), "%\u{1f980}");
        // Two bytes was always short enough to survive; it still does.
        assert_eq!(percent_decode("%\u{e4}"), "%\u{e4}");
        // The replacement character `String::from_utf8_lossy` leaves where the
        // request head carried an invalid byte is three bytes wide - the same
        // trap, reachable by sending any byte that is not UTF-8.
        let lossy = String::from_utf8_lossy(&[b'%', 0xff]).into_owned();
        assert_eq!(lossy, "%\u{fffd}");
        assert_eq!(percent_decode(&lossy), lossy);
        // Escapes running off the end of the input.
        assert_eq!(percent_decode("wk-1%"), "wk-1%");
        assert_eq!(percent_decode("wk-1%2"), "wk-1%2");
        // A sign is not a hex digit, whatever `u8::from_str_radix` thought.
        assert_eq!(percent_decode("%+f"), "%+f");
        // A broken escape does not stop the ones behind it from decoding.
        assert_eq!(percent_decode("%\u{20ac}%2D"), "%\u{20ac}-");
    }

    /// The panic was reachable over the socket, unauthenticated: no token, and
    /// the connection still has to answer rather than die mid-request.
    #[test]
    fn a_multibyte_escape_in_the_query_does_not_kill_the_connection() {
        let fx = fixture("api-percent-panic");
        let stored = fx.token();
        let port = fx.server.port();

        let (status, _) = call(port, "GET", "/api/health?a=%\u{20ac}", None, "");
        assert_eq!(status, 401, "the query is decoded before the token is read");

        let (status, body) = call(port, "GET", "/api/health?a=%\u{20ac}", Some(&stored), "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["ok"], true);
    }

    #[test]
    fn the_token_is_thirty_two_random_hex_characters() {
        // 128 bits, lower case hex, never twice the same. What a test cannot
        // see is *where* the bits came from - see the note on `new_token`.
        let mut seen = std::collections::HashSet::new();
        for _ in 0..256 {
            let token = new_token().expect("draw a token");
            assert_eq!(token.len(), 32, "{token}");
            assert!(
                token
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f')),
                "{token}"
            );
            assert!(seen.insert(token.clone()), "{token} came up twice");
        }
    }

    /// A `send` at an id with no session is something the caller can act on,
    /// so it must not arrive as the app's own failure.
    #[test]
    fn a_send_that_finds_no_agent_is_not_a_server_error() {
        let fx = fixture("api-send-no-agent");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(
            port,
            "POST",
            "/api/workers/wk-tippfehler/send",
            token,
            r#"{"text":"hallo"}"#,
        );
        assert_eq!(status, 409, "{body}");
        // The text is the core's, unchanged; only the status is new.
        assert_eq!(body["error"], "worker wk-tippfehler has no running agent");
        assert!(fx.backend.sent.lock().unwrap().is_empty());

        // And the status line has to name it, or the client reads "500".
        assert_eq!(Response::error(409, "x").reason(), "Conflict");
    }

    #[test]
    fn a_refused_merge_says_whose_turn_it_is() {
        let fx = fixture("api-merge-refused");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let stored_verdict = fx.verdict_token();
        let verdict = Some(stored_verdict.as_str());
        let port = fx.server.port();

        for (worker_id, expected) in [
            ("wk-nope", 404),
            ("wk-busy", 409),
            ("wk-red", 409),
            ("wk-live", 409),
            // Git failing mid-merge is not the caller's doing.
            ("wk-git", 500),
        ] {
            let target = format!("/api/workers/{worker_id}/merge");
            let (status, body) = call_with(port, "POST", &target, token, verdict, "");
            assert_eq!(status, expected, "{worker_id}: {body}");
            assert!(body["error"].is_string(), "{worker_id}: {body}");
        }
        assert!(fx.backend.merged.lock().unwrap().is_empty());
    }

    #[test]
    fn merge_status_separates_the_gate_from_the_app() {
        assert_eq!(merge_status(MERGE_UNKNOWN), 404);
        assert_eq!(merge_status(MERGE_WRONG_COLUMN), 409);
        assert_eq!(merge_status(MERGE_TEST_GATE), 409);
        assert_eq!(merge_status("merge blocked (blocked); dirty: x"), 409);
        assert_eq!(merge_status(MERGE_GIT_FAILED), 500);
        assert_eq!(merge_status("database is locked"), 500);
        // A worker whose project has gone missing is an inconsistency in the
        // store, not a wrong id from the caller - which is why `unknown
        // project` is a 404 on the landing-page routes, where the caller named
        // the project, and a 500 here, where the worker did.
        assert_eq!(merge_status("unknown project: pj-1"), 500);
    }

    /// Every route that creates something starts by looking up the project,
    /// and until this test all three outcomes of that lookup left as a 500 - so
    /// `pa` told a script to retry a project id that will never exist.
    #[test]
    fn the_creating_routes_pass_the_cores_verdict_through() {
        let fx = fixture("api-core-verdict");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        // `{}` stands in for the project id, so one table covers the routes
        // whose id sits in the path as well as those that carry it in a body.
        // `/api/queens` is 410 for every payload (Rev 9) and never reaches the core.
        let routes: &[(&str, &str, &str)] = &[
            (
                "/api/workers",
                r#"{"projectId":"{}","task":"Board bauen"}"#,
                "",
            ),
            (
                "/api/queue",
                r#"{"projectId":"{}","rawText":"Board bauen"}"#,
                "",
            ),
            ("/api/scout", r#"{"projectId":"{}"}"#, ""),
            (
                "/api/scout/triage",
                r#"{"projectId":"{}","urls":["https://example.invalid/repo"]}"#,
                "",
            ),
            (
                "/api/recommendations",
                r#"{"projectId":"{}","title":"ratatui","rationale":"Board im Terminal"}"#,
                "",
            ),
            (
                "/api/projects/{}/orchestrator/send",
                r#"{"text":"hallo"}"#,
                "path",
            ),
            (
                "/api/projects/{}/github/create",
                r#"{"name":"my-repo"}"#,
                "path",
            ),
        ];

        for (route, body, id_in) in routes {
            for (project_id, expected) in [("pj-nope", 404), ("pj-aus", 409), ("pj-git", 500)] {
                let (target, body) = if *id_in == "path" {
                    (route.replace("{}", project_id), body.to_string())
                } else {
                    (route.to_string(), body.replace("{}", project_id))
                };
                let (status, reply) = call(port, "POST", &target, token, &body);
                assert_eq!(status, expected, "{target} {project_id}: {reply}");
                // The core's sentence is passed through untouched; only the
                // status in front of it is new.
                assert!(reply["error"].is_string(), "{target}: {reply}");
            }
        }

        // Nothing was created along the way - a refused route must not leave a
        // row behind, or the status would be the only honest part of the reply.
        assert!(fx.backend.created.lock().unwrap().is_empty());
        assert!(fx.backend.queened.lock().unwrap().is_empty());
        assert!(fx.backend.scouted.lock().unwrap().is_empty());
        assert!(fx.backend.told.lock().unwrap().is_empty());
        assert!(fx.backend.repos.lock().unwrap().is_empty());
    }

    #[test]
    fn core_status_reads_the_opening_and_nothing_else() {
        assert_eq!(core_status("unknown project: pj-1"), 404);
        assert_eq!(core_status("unknown agent profile: kimi"), 404);
        assert_eq!(core_status("refused: profile 'kimi' is switched off"), 409);
        assert_eq!(
            core_status("failed to add the worktree: git exited 128"),
            500
        );
        // The prefix has to open the message. A sentence that merely mentions
        // it somewhere is the app talking about itself, not about the caller.
        assert_eq!(core_status("the store is unknown territory"), 500);
        assert_eq!(core_status("git refused: nothing to commit"), 500);
        // Both constants are what `crate::workers` mints, not a copy of them.
        assert_eq!(
            core_status(&format!("{}worker: wk-1", crate::workers::ERR_UNKNOWN)),
            404
        );
        assert_eq!(
            core_status(&format!("{}the gate is red", crate::workers::ERR_REFUSED)),
            409
        );
    }

    #[test]
    fn messages_for_an_unknown_worker_are_a_404_not_an_empty_list() {
        let fx = fixture("api-messages-unknown");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/workers/wk-1/messages?limit=2", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body.as_array().expect("array").len(), 2);

        // A typo used to read as "this worker has not said anything yet".
        let (status, body) = call(
            port,
            "GET",
            "/api/workers/wk-tippfehler/messages",
            token,
            "",
        );
        assert_eq!(status, 404, "{body}");
        assert_eq!(body["error"], "unknown worker: wk-tippfehler");
    }
}
