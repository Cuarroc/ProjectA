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
//! | GET    | `/api/emergency-stop`     |                       | `{active}`        |
//! | POST   | `/api/emergency-stop`     | `{active: bool}` + verdict to deactivate | `{active}` |
//! | GET    | `/api/settings/env-isolation` |                   | `{stage}`         |
//! | PUT    | `/api/settings/env-isolation` | `{stage}` + verdict | `{stage}`       |
//! | GET    | `/api/updater`            |                       | updater state     |
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
//! `unknown ` and `refused: `, and [`error_status`] reads that opening. Where a
//! route still cannot tell the two apart it answers 500, which is the
//! conservative reading: 500 invites a retry or a bug report, a 4xx wrongly
//! blames the caller.
//!
//! Linking a GitHub repository and accepting a recommendation carried the same
//! confusion the other way round: both answered 400 for every failure, so a
//! `git` that would not run, a missing `gh` and a queue insert that failed all
//! came back as the caller's mistake. Both read [`error_status`] now, and the
//! two messages behind them that describe a wrong moment - an `origin` that
//! already exists, a recommendation that was accepted before - say so in the
//! core's own words. What a route can judge on its own it still judges before
//! the core is asked: the shape of a GitHub url and of a repository name are
//! 400 from here, as the digest date and the stats range already were.
//!
//! `/api/recommendations/<id>/status` was left behind by that round, one line
//! below `accept`: a recommendation id that names nothing and a store that fell
//! over both answered 400. It reads [`error_status`] too now, and its own
//! judgement - whether the status is one of the two words the store knows - is
//! made here, before the core is asked, so a misspelled status never reaches
//! the store and stays the 400 it always was. It answers no 409, and that is
//! not an omission: the store writes this one with a plain `UPDATE` and no
//! claim, so there is no wrong moment for it to arrive at - unlike `accept`,
//! which does claim and does answer 409.
//!
//! `POST /api/queue/<id>/cancel` was the last member of that class still
//! open: it answered 400 for every failure, including a store that fell over.
//! It reads [`error_status`] now - 404 for an id that names nothing, 409 for
//! an entry that is no longer queued or ready, 500 for the store - because
//! `store::cancel_queue_entry` opens those two cases with `unknown ` and
//! `refused: ` like the rest of the core. The audit card that found this
//! class named both routes in one breath
//! (`docs/audits/2026-09-03-analyse-claude-web/karten/services.md`).
//!
//! An entry that is already `dispatched` is a 409 too, unless the store can
//! prove the end of its agent's process (W1-05b): then the row goes and the
//! answer is the plain `{ok: true}`. The route does not judge that itself -
//! it reads the opening of the store's sentence like every other refusal and
//! passes the rest through, so the 409 body names what is missing (`worker
//! wk-1 still has a live session`, `1 session(s) of worker wk-1 never reported
//! an exit`, `worker wk-1 has no recorded session`, ...). A refused entry stays
//! in the queue untouched; the second cancel of a removed one is a 404. A store
//! anomaly during the delete keeps its `failed to` opening and is a 500, never
//! a refusal dressed as a 409. The reasons are the store's, in
//! `store/queue_cancel.rs`.
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
use crate::setupgate::repo_scan::RepoScan;
use crate::status::WorkerBoardState;
use crate::store::{
    ActivityEntry, ContinuousClaim, ContinuousContext, ContinuousControl, ContinuousGoal,
    ContinuousTask, Learning, Message, Project, Question, QueueEntry, Recommendation, RoleVariant,
    Worker, KIND_ORCHESTRATOR, KIND_QUEEN, KIND_SCOUT,
};

fn frontend_error_field(value: &str, max_bytes: usize) -> String {
    // Bound redaction work before applying the final escaped log-field limit.
    let mut end = value.len().min(8192);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    let redacted = crate::redact::redact(&value[..end]);
    let mut field = String::new();
    for ch in redacted.chars() {
        let ch = if ch.is_control() || matches!(ch, '\u{2028}' | '\u{2029}') {
            ' '
        } else {
            ch
        };
        let escape = matches!(ch, '"' | '\\');
        if field.len() + ch.len_utf8() + usize::from(escape) > max_bytes {
            break;
        }
        if escape {
            field.push('\\');
        }
        field.push(ch);
    }
    field
}

#[derive(Default)]
struct FrontendErrorLog {
    recent: Vec<(std::time::Instant, Option<String>)>,
    feedback_recent: Vec<std::time::Instant>,
    suppressed: u64,
    summary_at: Option<std::time::Instant>,
}
impl FrontendErrorLog {
    fn write(
        &mut self,
        now: std::time::Instant,
        message: &str,
        stack_frame: &str,
        route: &str,
        feedback: Option<&str>,
        mut emit: impl FnMut(String),
    ) {
        if feedback.is_some() {
            self.feedback_recent
                .retain(|at| now.duration_since(*at).as_secs() < 60);
            if self.feedback_recent.len() >= 10 {
                return;
            }
            self.feedback_recent.push(now);
        }
        self.recent
            .retain(|(at, _)| now.duration_since(*at).as_secs() < 60);
        let message = frontend_error_field(message, 2048);
        let summary_due = now
            .duration_since(*self.summary_at.get_or_insert(now))
            .as_secs()
            >= 60;
        if self.suppressed > 0 && self.recent.len() < 50 && summary_due {
            let suppressed = std::mem::take(&mut self.suppressed);
            emit(format!("ERROR suppressed {suppressed} frontend errors"));
            self.recent.push((now, None));
            self.summary_at = Some(now);
        }
        if feedback.is_none()
            && (self.recent.len() >= 50
                || self.recent.iter().any(|(at, previous)| {
                    previous.as_ref() == Some(&message) && now.duration_since(*at).as_secs() < 10
                }))
        {
            self.suppressed = self.suppressed.saturating_add(1);
            return;
        }
        let route = frontend_error_field(route.split(['?', '#']).next().unwrap_or_default(), 256);
        if let Some(context) = feedback {
            emit(format!(
                "FEEDBACK message=\"{}\" expected=\"{}\" route=\"{}\" context=\"{}\"",
                message,
                frontend_error_field(stack_frame, 1024),
                route,
                frontend_error_field(context, 2048),
            ));
        } else {
            emit(format!(
                "ERROR message=\"{}\" stack=\"{}\" route=\"{}\"",
                message,
                frontend_error_field(stack_frame, 512),
                route,
            ));
        }
        if feedback.is_none() {
            self.recent.push((now, Some(message)));
        }
    }
}

#[tauri::command]
pub fn log_frontend_error(
    message: String,
    stack_frame: String,
    route: String,
    kind: Option<String>,
    context: Option<String>,
) -> bool {
    static LIMITER: std::sync::Mutex<FrontendErrorLog> = std::sync::Mutex::new(FrontendErrorLog {
        recent: Vec::new(),
        feedback_recent: Vec::new(),
        suppressed: 0,
        summary_at: None,
    });
    let feedback = match kind.as_deref() {
        Some("feedback") => Some(context.as_deref().unwrap_or_default()),
        _ => None,
    };
    emit_frontend_error(&LIMITER, &message, &stack_frame, &route, feedback, |line| {
        crate::logging::log("frontend", &line)
    })
}

fn emit_frontend_error(
    limiter: &std::sync::Mutex<FrontendErrorLog>,
    message: &str,
    stack_frame: &str,
    route: &str,
    feedback: Option<&str>,
    mut emit: impl FnMut(String),
) -> bool {
    let mut lines = Vec::new();
    {
        let mut limiter = limiter.lock().unwrap_or_else(|e| e.into_inner());
        limiter.write(
            std::time::Instant::now(),
            message,
            stack_frame,
            route,
            feedback,
            |line| lines.push(line),
        );
    }
    let accepted = feedback.is_none() || lines.iter().any(|line| line.starts_with("FEEDBACK "));
    for line in lines {
        emit(line);
    }
    accepted
}

/// Name of the descriptor file written into the app data directory.
pub const DESCRIPTOR_FILE: &str = "projecta-api.json";

#[path = "api/agent_access.rs"]
mod agent_access;
#[allow(unused_imports)]
pub use crate::workers::delivery_state::{
    record_worker_delivery as record_delivery_receipt, WorkerDeliveryError as DeliveryError,
    WorkerDeliveryReceipt as DeliveryReceipt,
};
#[allow(unused_imports)]
pub use agent_access::{CandidateInput, RunCredentialIssuer};
#[cfg(windows)]
#[path = "api/credential_acl.rs"]
mod credential_acl;
#[cfg(all(test, windows))]
#[path = "api/credential_acl_tests.rs"]
mod credential_acl_tests;
#[path = "api/d4_routes.rs"]
mod d4_routes;
#[path = "api/hq_routes.rs"]
mod hq_routes;
#[path = "api/planning_access.rs"]
pub(crate) mod planning_access;

/// Header carrying the shared token. Lower case: header names are compared
/// case-insensitively, and this is the form the CLI sends.
pub const TOKEN_HEADER: &str = "x-projecta-token";

/// Header carrying the verdict token, required on top of [`TOKEN_HEADER`] by
/// routes that make a human decision or release the emergency stop.
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

/// The updater result already observed by the app's updater plugin.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "phase", rename_all = "kebab-case")]
pub enum UpdaterState {
    #[default]
    Idle,
    Checking,
    UpToDate {
        version: Option<String>,
    },
    Available {
        version: String,
        notes: Option<String>,
        #[serde(rename = "activeWorkers")]
        active_workers: usize,
    },
    Installing {
        version: String,
    },
    Ready {
        version: String,
    },
    Error {
        message: String,
    },
}

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
    /// W1-03f-api: the terminal report of the run a scoped credential speaks
    /// for; answer with `record_delivery_receipt`. Fails closed by default.
    fn agent_record_delivery(
        &self,
        _run: &str,
        _owner: &str,
        _fence: i64,
        _delivery: crate::workers::delivery_state::WorkerDelivery,
    ) -> Result<DeliveryReceipt, DeliveryError> {
        Err(DeliveryError::Failed("delivery service unavailable".into()))
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
    /// M4-R19-08: appends one audit envelope for a planning outcome of the
    /// run a scoped credential speaks for (`result`, route as `source_ref`).
    /// The default writes nothing and says so, so success is never unaudited.
    fn audit_planning(&self, _run: &str, _result: &str, _source_ref: &str) -> Result<(), String> {
        Err("planning audit service unavailable".into())
    }
    fn agent_planning_scope(
        &self,
        _run: &str,
        _owner: &str,
        _fence: i64,
        _kind: &str,
        _target: &str,
    ) -> Result<(), String> {
        Err("planning scope service unavailable".into())
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

    // -- global emergency stop (W5-04c) ------------------------------------
    // The defaults refuse: a backend that does not implement the stop must
    // never report "not stopped" or pretend to have set it.
    fn emergency_stop_active(&self) -> Result<bool, String> {
        Err("emergency stop unavailable".into())
    }
    fn set_emergency_stop(&self, _active: bool, _actor: &str) -> Result<(), String> {
        Err("emergency stop unavailable".into())
    }
    // -- global agent environment stage (W5-02b3) --------------------------
    // The defaults refuse: a backend without the stage must never report
    // `strict` it does not enforce or accept a write it would drop.
    fn agent_env_isolation(&self) -> Result<crate::profiles::EnvIsolation, String> {
        Err("environment stage unavailable".into())
    }
    fn set_agent_env_isolation(&self, _stage: crate::profiles::EnvIsolation) -> Result<(), String> {
        Err("environment stage unavailable".into())
    }
    fn updater_state(&self) -> Result<UpdaterState, String>;

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

    /// Drop a queue entry: `unknown ` for an id that names nothing, `refused: `
    /// for an entry the store may not drop (claimed, failed, or `dispatched`
    /// without a proven process end - see `store/queue_cancel.rs`), anything
    /// else for a store that fell over.
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
    // `create_new` first tells a file this call brings into being (removed
    // again on failure, so a refusal leaves no empty descriptor) from one that
    // was already there (kept: it holds the running instance's descriptor).
    let created = std::cell::Cell::new(false);
    let mut file = credential_acl::open_with_sharing_retry(
        &format!("failed to open {}", path.display()),
        || {
            let mut options = std::fs::OpenOptions::new();
            options
                .write(true)
                .access_mode(GENERIC_WRITE | WRITE_DAC | READ_CONTROL)
                .share_mode(0)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
            match options.create_new(true).open(path) {
                Ok(file) => {
                    created.set(true);
                    Ok(file)
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    created.set(false);
                    options.create_new(false).open(path)
                }
                Err(error) => Err(error),
            }
        },
    )?;
    // No truncate at open: a refused file keeps its previous content (the
    // running instance's descriptor), and only a verified file is emptied.
    let written = credential_acl::refuse_links(&file, &path.display().to_string())
        .and_then(|()| credential_acl::verify_owned(&file))
        .and_then(|()| credential_acl::restrict_to_current_user(&file))
        .and_then(|()| {
            file.set_len(0)
                .and_then(|()| file.write_all(body))
                .and_then(|()| file.sync_all())
                .map_err(|e| format!("failed to write {}: {e}", path.display()))
        });
    if written.is_err() && created.get() {
        drop(file);
        let _ = std::fs::remove_file(path);
    }
    written
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

    if let Some(decision) = verdict_decision(request) {
        match proof {
            VerdictProof::Proven => {}
            VerdictProof::Wrong => return Response::error(403, "invalid verdict token"),
            VerdictProof::Absent => {
                return Response::error(
                    403,
                    format!(
                        "missing {VERDICT_TOKEN_HEADER} header: {decision} is a human or \
                         coordinator decision, and the token for it is held by the window and \
                         by `pa --verdict-token` alone"
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
/// Protected decision routes *need* it and are refused without it.
/// `POST /api/questions/<id>/answer` only
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

/// Name the protected decision made by this request, if any.
///
/// Only the POSTs and the stage PUT. A GET on the same path is a caller who used the wrong verb,
/// and [`route`] tells them that - answering 403 there would send them looking
/// for a token they do not need.
fn verdict_decision(request: &Request) -> Option<&'static str> {
    let segments = request.segments();
    let path: Vec<&str> = segments.iter().map(String::as_str).collect();
    if request.method == "PUT" && path.as_slice() == ["api", "settings", "env-isolation"] {
        return Some("changing the agent environment stage");
    }
    if request.method != "POST" {
        return None;
    }
    if matches!(
        path.as_slice(),
        ["api", "learnings", _, "approve" | "reject"]
            | ["api", "roles", _, "approve" | "reject"]
            | ["api", "workers", _, "merge"]
    ) {
        return Some("approving, rejecting or merging");
    }
    if path.as_slice() == ["api", "emergency-stop"]
        && serde_json::from_str::<Value>(&request.body)
            .ok()
            .and_then(|body| body.get("active").and_then(Value::as_bool))
            == Some(false)
    {
        return Some("releasing the emergency stop");
    }
    None
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

    if let Some(reply) = hq_routes::route(inner, request, method, path.as_slice(), project_id) {
        return reply;
    }

    if let Some(reply) =
        d4_routes::route(inner, request, method, path.as_slice(), project_id, status)
    {
        return reply;
    }

    match (method, path.as_slice()) {
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

        ("GET", ["api", "quota"]) => into_response(backend.quota()),

        // Fail closed: an unreadable state is an error, never `active: false`.
        ("GET", ["api", "emergency-stop"]) => into_response(
            backend
                .emergency_stop_active()
                .map(|a| json!({ "active": a })),
        ),
        ("POST", ["api", "emergency-stop"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(error) => return Response::error(400, error),
            };
            if let Err(error) = only_keys(&body, &["active"]) {
                return Response::error(400, error);
            }
            let Some(active) = body.get("active").and_then(Value::as_bool) else {
                return Response::error(400, "active must be a boolean");
            };
            if let Err(error) = backend.set_emergency_stop(active, "pa") {
                return Response::error(500, error);
            }
            // Report what the store holds, not what was asked for.
            into_response(
                backend
                    .emergency_stop_active()
                    .map(|a| json!({ "active": a })),
            )
        }
        ("GET", ["api", "settings", "env-isolation"]) => into_response(
            backend
                .agent_env_isolation()
                .map(|stage| json!({ "stage": stage.as_str() })),
        ),
        // The verdict gate in `handle` has already run: a worker's API token
        // alone never reaches this arm.
        ("PUT", ["api", "settings", "env-isolation"]) => {
            let body = match parse_body(&request.body) {
                Ok(body) => body,
                Err(error) => return Response::error(400, error),
            };
            if let Err(error) = only_keys(&body, &["stage"]) {
                return Response::error(400, error);
            }
            let stage = match body.get("stage").and_then(Value::as_str) {
                Some(raw) => match raw.parse::<crate::profiles::EnvIsolation>() {
                    Ok(stage) => stage,
                    Err(_) => {
                        return Response::error(
                            400,
                            "stage must be one of inherit, allowlist, strict",
                        )
                    }
                },
                None => return Response::error(400, "stage is required"),
            };
            if let Err(error) = backend.set_agent_env_isolation(stage) {
                return Response::error(500, error);
            }
            into_response(
                backend
                    .agent_env_isolation()
                    .map(|stage| json!({ "stage": stage.as_str() })),
            )
        }
        ("GET", ["api", "updater"]) => into_response(backend.updater_state()),

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
            Err(err) => Response::error(error_status(&err, StatusPolicy::Verdict), err),
        },

        ("POST", ["api", "roles", id, "reject"]) => match backend.reject_role_variant(id) {
            Ok(()) => Response::ok(json!({ "ok": true })),
            Err(err) => Response::error(error_status(&err, StatusPolicy::Verdict), err),
        },

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
                Err(err) => Response::error(error_status(&err, StatusPolicy::Core), err),
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
        | (_, ["api", "emergency-stop"])
        | (_, ["api", "settings", "env-isolation"])
        | (_, ["api", "updater"])
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

/// Which route family a failed call belongs to, for [`error_status`].
///
/// The families read the same error text differently on purpose: the same
/// message is the caller's typo on one route and the app's own inconsistency
/// on another. `api::tests::error_status_pins_every_pattern_per_policy` holds
/// the table.
#[derive(Clone, Copy)]
pub(crate) enum StatusPolicy {
    /// `POST /api/workers/<id>/merge`.
    Merge,
    /// The four verdict routes.
    Verdict,
    /// Every route whose core speaks the [`crate::workers`] vocabulary.
    Core,
    /// The development-plan read and import routes
    /// ([`crate::development_plan_access`]).
    Plan,
}

/// Which status a failed call deserves; the one reader of error text.
///
/// The backend hands the route a bare `String`, so the status is read from the
/// message - the same bargain the landing-page routes already make. A message
/// that stops matching falls back to the policy's default, which for `Merge`
/// and `Core` is the safe 500.
pub(crate) fn error_status(err: &str, policy: StatusPolicy) -> u16 {
    match policy {
        // [`crate::workers::merge_worker`] refuses for two kinds of reason. A
        // wrong id is a 404. The three gate refusals - the card is not in
        // `ready to merge`, the test gate is not green, the agent is still
        // running - describe a worker that exists and is not mergeable yet:
        // a 409. Everything else comes from git, `gh` or the store and keeps
        // the 500. The fragments are the stable parts of the messages minted
        // there. A worker whose project has gone missing is an inconsistency
        // in the store, not a wrong id from the caller, so `unknown project`
        // is a 500 here and a 404 on the core routes.
        StatusPolicy::Merge => {
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
        // A verdict the core refused because the row already has one is a
        // 409: the request is well formed, it just arrives too late.
        // Everything else these routes fail with is a caller who named the
        // wrong id or wrote an unusable text, the 400 they always answered.
        StatusPolicy::Verdict => {
            if err.starts_with(crate::workers::ERR_REFUSED) {
                409
            } else {
                400
            }
        }
        // `unknown <kind>: <id>` is a caller who named something that does
        // not exist, `refused: <reason>` something that exists but may not be
        // used that way; nothing was attempted in either case. Only the
        // opening is read, never the sentence after it: that text is for a
        // person and may be reworded. Everything else is git, `gh`, the
        // filesystem, the store or a CLI that would not start: a 500.
        StatusPolicy::Core => {
            if err.starts_with(crate::workers::ERR_UNKNOWN) {
                404
            } else if err.starts_with(crate::workers::ERR_REFUSED) {
                409
            } else {
                500
            }
        }
        // The bounded set of plan Store errors: an unknown project, plan or
        // missing source is a 404, a revision or binding conflict a 409, a
        // source the importer cannot accept a 422, a malformed id or revision
        // a 400. Anything else - including a failed reader task - stays 500.
        StatusPolicy::Plan => {
            if err.starts_with("unknown project")
                || err.starts_with("plan source docs/PLAN.md: unknown project")
                || err.starts_with("plan source docs/PLAN.md: missing")
                || err.starts_with("plan source docs/PLAN.md: project_root_unavailable")
            {
                404
            } else if err.contains("projection revision conflict")
                || err.contains("already bound")
                || err.contains("nonempty rollback reason")
            {
                409
            } else if err.starts_with("invalid plan source")
                || err.starts_with("plan source docs/PLAN.md: outside_project")
                || err.starts_with("plan source docs/PLAN.md: not_regular_file")
                || err.starts_with("plan source docs/PLAN.md: oversized")
                || err.starts_with("plan source docs/PLAN.md: invalid_utf8")
                || err.starts_with("plan source docs/PLAN.md: unreadable")
                || err.starts_with("plan source docs/PLAN.md: file_identity_unavailable")
            {
                422
            } else if err.starts_with("projectId is required")
                || err.starts_with("planId is required")
                || err.starts_with("revision must")
                || err.starts_with("expectedProjectionRevision must")
            {
                400
            } else {
                500
            }
        }
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
        Err(err) => Response::error(error_status(&err, StatusPolicy::Core), err),
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
        Err(reason) => Response::error(error_status(&reason, StatusPolicy::Plan), reason),
    }
}

fn continuous_error(err: String) -> Response {
    let vocabulary_status = error_status(&err, StatusPolicy::Core);
    if vocabulary_status != 500 {
        return Response::error(vocabulary_status, err);
    }
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

#[test]
fn continuous_refusal_prefix_is_a_conflict() {
    assert_eq!(
        continuous_error("refused: dependency set exceeds limit 64".into()).status,
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

/// V2-S11: the first-run screen's read-only repository scan.
///
/// The path comes from the window, so it is judged in its canonical form
/// (`..` and links resolved): absolute, a folder, the top of a git work tree
/// (the same [`crate::worktree::ensure_git_repo`] check project registration
/// uses). The backend cannot tell a picked folder from a typed one; it only
/// returns the facts of [`RepoScan`], never file contents. Errors are fixed
/// sentences without the path.
pub(crate) fn scan_setup_repo_at(path: &str) -> Result<RepoScan, String> {
    use crate::setupgate::repo_scan::{resolve_inside, scan_repo, simplified};
    // Trimmed for the emptiness check only: a folder name may end in a blank.
    let given = Path::new(path);
    if path.trim().is_empty() || !given.is_absolute() {
        return Err("the repository path must be absolute".to_string());
    }
    // Without `\\?\`: git rejects it and the containment checks compare plain paths.
    let root = std::fs::canonicalize(given)
        .map(|real| simplified(&real))
        .map_err(|_| "the repository folder does not exist or cannot be read".to_string())?;
    if !root.is_dir() {
        return Err("the chosen path is not a folder".to_string());
    }
    // A `.git` link that leaves the folder is "not present", like in the scan.
    if resolve_inside(&root, ".git").is_none() {
        return Err("the chosen folder is not the top of a git repository".to_string());
    }
    crate::worktree::ensure_git_repo(&root.to_string_lossy())
        .map_err(|_| "the chosen folder is not a usable git repository".to_string())?;
    scan_repo(&root).map_err(|_| "the repository scan failed".to_string())
}

/// How long the first-run screen waits for the scan (not the 5-minute setup
/// command limit in `setupgate`: this is a few file reads and one `git` call).
const SCAN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// Run `job` off the calling thread and give up after `limit`. The thread
/// itself cannot be cancelled and finishes in the background; only the wait ends.
/// A timed-out job may leave its `git` child running until that ends on its
/// own: the bound is on the wait, not on the work.
async fn scan_within<T: Send + 'static>(
    limit: std::time::Duration,
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let handle = tauri::async_runtime::spawn_blocking(job);
    match tokio::time::timeout(limit, handle).await {
        Err(_) => Err("the repository scan took too long".to_string()),
        Ok(joined) => joined.map_err(|_| "the repository scan did not finish".to_string())?,
    }
}

/// Read-only: what the first-run screen shows about a repository folder.
#[tauri::command]
pub async fn scan_setup_repo(path: String) -> Result<RepoScan, String> {
    // File reads and one git child process: off the thread serving the UI.
    scan_within(SCAN_TIMEOUT, move || scan_setup_repo_at(&path)).await
}

/// One Wachhund finding for the Betrieb panel (V2-B22).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchdogFinding {
    pub run_id: String,
    pub label: String,
    /// `"steht"` or `"fertig"`.
    pub kind: &'static str,
    pub sentence: String,
    /// Unix milliseconds: the last activity the run showed.
    pub since: u64,
}

/// "Steht seit 15 Minuten" / "Steht seit 2 Stunden 5 Minuten".
fn watchdog_span(ms: u64) -> String {
    let minutes = ms / 60_000;
    let unit = |n: u64, one: &str, many: &str| format!("{n} {}", if n == 1 { one } else { many });
    match (minutes / 60, minutes % 60) {
        (0, m) => unit(m, "Minute", "Minuten"),
        (h, 0) => unit(h, "Stunde", "Stunden"),
        (h, m) => format!(
            "{} {}",
            unit(h, "Stunde", "Stunden"),
            unit(m, "Minute", "Minuten")
        ),
    }
}

/// Run the pure watchdog core over the running workers. A run counts as quiet
/// only when output *and* worktree are both known and old, the same
/// conjunction as the stuck verdict; a worktree never probed is not judged.
/// The dedupe state starts empty on purpose: this is a snapshot for the panel,
/// not a notification, so a standing run is listed on every read. `now` (Unix
/// milliseconds) and `at` (the monotonic clock) are the same moment, passed in
/// so a test fixes both.
fn watchdog_findings(
    workers: &[Worker],
    engine: &crate::status::StatusEngine,
    now: u64,
    at: std::time::Instant,
    stalled_after: Duration,
) -> Vec<WatchdogFinding> {
    use crate::stuck::watchdog::{evaluate, Dedupe, NoticeKind, Run, RunState, Thresholds};
    let ago =
        |age: Duration| now.saturating_sub(u64::try_from(age.as_millis()).unwrap_or(u64::MAX));
    let running: Vec<&Worker> = workers
        .iter()
        .filter(|w| w.status == crate::store::STATUS_RUNNING)
        .collect();
    let runs: Vec<Run> = running
        .iter()
        .map(|w| {
            let (output, worktree) = match engine.activity_ages(&w.id, at) {
                (Some(output), Some(worktree)) => (Some(ago(output)), Some(ago(worktree))),
                _ => (None, None),
            };
            Run {
                id: w.id.clone(),
                state: RunState::Running,
                last_output_at: output,
                last_commit_at: worktree,
                exited_at: None,
            }
        })
        .collect();
    let (notices, _) = evaluate(
        &runs,
        now,
        &Thresholds { stalled_after },
        &Dedupe::default(),
    );
    notices
        .into_iter()
        .filter_map(|n| {
            let worker = running.iter().find(|w| w.id == n.run_id)?;
            let (kind, sentence) = match n.kind {
                NoticeKind::Steht => (
                    "steht",
                    format!(
                        "Steht seit {}: keine Ausgabe, keine Änderung im Arbeitsbaum.",
                        watchdog_span(now.saturating_sub(n.since))
                    ),
                ),
                // Unreachable until Exited/LeaseExpired runs are fed to the core.
                NoticeKind::Fertig => ("fertig", "Der Lauf ist beendet.".to_string()),
            };
            Some(WatchdogFinding {
                label: crate::status::worker_label(worker),
                run_id: n.run_id,
                kind,
                sentence,
                since: n.since,
            })
        })
        .collect()
}

/// Read-only (V2-B22): which running workers of a project stand still.
#[tauri::command]
pub async fn watchdog_report(
    project_id: String,
    store: tauri::State<'_, crate::store::Store>,
    engine: tauri::State<'_, Arc<crate::status::StatusEngine>>,
) -> Result<Vec<WatchdogFinding>, String> {
    let workers = store.list_workers(Some(&project_id)).await.map_err(|err| {
        crate::logf!("watchdog", "could not list workers of {project_id}: {err}");
        "Der Wachhund konnte die Läufe nicht lesen.".to_string()
    })?;
    let stalled_after = crate::stuck::threshold(&store).await;
    let now_ms = crate::store::now_unix_secs().max(0).unsigned_abs() * 1000;
    let at = std::time::Instant::now();
    Ok(watchdog_findings(
        &workers,
        &engine,
        now_ms,
        at,
        stalled_after,
    ))
}

#[cfg(test)]
#[rustfmt::skip]
#[path = "api/tests/mod.rs"]
pub(crate) mod tests;
