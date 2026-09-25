#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! ProjectA - Rust core.
//!
//! Phase 1 scope: spawn CLI coding agents in PTYs, stream their output to the
//! frontend as Tauri events, and expose the embedded agent profiles.
//!
//! Phase 2 adds the things that survive a restart: projects (registered git
//! repositories), workers (one agent + one git worktree + one task) and the
//! SQLite database both live in.
//!
//! Phase 3.5 adds prompt enhancement: the bundled prompt-master skill,
//! run headlessly, turns a rough task description into a proper prompt.
//!
//! Phase 3 adds the board. A status engine folds three sources - the agent's
//! own hooks, heuristics on its terminal output, and `gh` - into one column per
//! worker, and pushes every change out as a `worker:status` event.
//!
//! Phase 4 opens the app up. A token-guarded JSON API on a second loopback
//! port (`api`) exposes the worker lifecycle and the board to other processes,
//! the `pa` bridge CLI speaks to it, and `create_orchestrator` starts one agent
//! per project whose whole job is to plan work and drive `pa`.
//!
//! Phase 5 adds the review. `get_worker_diff` reads what a worker actually
//! changed against the project's default branch, and a comment on one line of
//! that diff is stored and written straight into the agent's terminal, so
//! reviewing a worker and telling it what to fix are one gesture.
//!
//! Phase 3.6 adds usage and quota awareness: which profiles the provider is
//! still serving (`get_quota_state`, backed by the `agent_quota` table), how
//! full each agent's context window is (`contextUsage` on the board), and
//! whether the local OmniRoute router is answering.
//!
//! Phase 7.1 adds the scout. `create_scout` and `triage_repos` start an agent
//! shaped like the orchestrator - repository root, no worktree - whose whole
//! job is research: it reads the repo, reads the internet, and appends what it
//! finds to `.pa-scout.jsonl`. The app ingests that file into the
//! `recommendations` table, and `accept_recommendation` turns one of those
//! findings into a Phase 7.0 queue entry, which becomes an ordinary worker.
//!
//! Phase 7.2 adds the provider vault. `get_provider_overview` says which
//! providers this machine can actually reach - installed, signed in, answering
//! on a loopback port, or keyed - joined with what the quota tracker knows, and
//! `set_provider_key` puts an API key in `provider-keys.json` beside the
//! database, never in the repository.
//!
//! Phase 8 adds the web interface. On demand, every project's landing page -
//! written as Markdown in the design studio - is served over
//! `http://127.0.0.1:<port>`; see [`web_interface`] for the server itself.
//!
//! Exactly one ProjectA runs at a time. Everything below - the dispatcher, the
//! PTY fleet, the reattach pass, the control API descriptor - assumes it is the
//! sole owner of the app data directory, so the single-instance guard is the
//! *first* plugin on the builder and a second launch only raises the window
//! that already exists. See `main` for why that placement is the whole point,
//! and why the guard does not stand in the way of the updater's relaunch.
//!
//! IPC uses Tauri's default camelCase wire names, so the frontend invokes
//! `invoke('spawn_pty', { profileId, cwd, cols, rows })` and reads back
//! `{ sessionId }`. The Rust signatures below keep the usual snake_case.

mod api;
mod budget;
mod capabilities;
mod critic;
mod db_restore;
pub mod delivery_recovery;
pub mod development_plan;
mod development_plan_access;
pub mod development_policy;
mod diagnosis;
mod diff;
mod digest;
mod enhance;
mod freetier;
mod gh;
mod hooks;
mod http_util;
mod learnings;
mod logging;
mod omniroute;
mod oneshot;
mod preflight;
mod proc;
#[allow(dead_code)] // Native parent activation awaits shared session-registry integration.
mod process_capture;
mod profiles;
mod providers;
mod pty;
mod questions;
mod queue;
mod quota;
mod readiness;
mod redact;
mod resources;
mod retention;
mod roles;
mod routing;
mod ruflo;
mod scout;
mod sessionpersist;
mod setupgate;
mod skills;
mod stats;
mod status;
mod store;
mod stuck;
mod submit_guard;
mod testgate;
#[cfg(test)]
mod testutil;
mod web_interface;
mod workers;
mod worktree;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use api::{ApiServer, ControlBackend, ProjectOverview};
use diagnosis::PanicNotice;
use diff::{AgentInput, WorkerDiff};
use enhance::EnhanceResult;
use hooks::HookReceiver;
use omniroute::{OmniRoute, UsageReport};
use profiles::AgentProfile;
use providers::{KeyVault, ProviderOverview, SystemProbe};
use pty::{PtyManager, SubmitGuardEvent};
use quota::{QuotaSink, QuotaStateRow, QuotaTracker};
use skills::SkillPack;
use status::{BoardState, StatusEngine, StatusPayload, StatusSink, WorkerBoardState};
use store::now_unix_secs;
use store::{
    ActivityEntry, AgentQuota, DiffComment, Learning, Message, Project, QueueEntry, Recommendation,
    RoleVariant, Store, Worker,
};
use web_interface::WebInterfaceState;
use workers::{AgentControl, DeliveryCallback, DeliveryOutcome};

/// Size a worker's terminal starts at; the frontend calls `resize_pty` as soon
/// as its terminal has been laid out.
const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;

/// How often quiet workers are re-checked against the idle threshold.
const IDLE_TICK: Duration = Duration::from_secs(5);

/// How often open questions are checked against their four-hour deadline.
const QUESTION_SWEEP_INTERVAL: Duration = Duration::from_secs(60);

/// Return value of `spawn_pty`; serialized as `{ "sessionId": "..." }`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnPtyResponse {
    pub session_id: String,
}

/// Adapts the Phase 1 `PtyManager` to the worker lifecycle.
struct PtyAgents<'a> {
    app: &'a AppHandle,
    manager: &'a PtyManager,
    /// Loopback port the agent's status hooks report to; 0 disables them.
    hook_port: u16,
    store: Store,
    engine: Arc<StatusEngine>,
}

impl<'a> PtyAgents<'a> {
    fn new(
        app: &'a AppHandle,
        manager: &'a PtyManager,
        receiver: &HookReceiver,
        store: Store,
        engine: Arc<StatusEngine>,
    ) -> Self {
        Self::with_port(app, manager, receiver.port(), store, engine)
    }

    /// The same thing for callers that already know the port - the control API
    /// runs off the main thread and keeps the number rather than the receiver.
    fn with_port(
        app: &'a AppHandle,
        manager: &'a PtyManager,
        hook_port: u16,
        store: Store,
        engine: Arc<StatusEngine>,
    ) -> Self {
        Self {
            app,
            manager,
            hook_port,
            store,
            engine,
        }
    }
}

/// The startup reattach pass over every persisted `running` worker, with the
/// release of the queue claims the last process left mid-dispatch placed
/// inside it (KI-23; the order is explained in the body).
///
/// A free function rather than inline in `setup` so the order of the two -
/// which decides whether a claim is attributed or handed out again - is
/// testable without a Tauri app (`queue::tests`).
async fn reattach_workers_and_resolve_claims(
    store: &Store,
    worktree_exists: impl Fn(&str) -> bool,
    profile_enabled: impl Fn(&str) -> bool,
) {
    let workers = match store.list_workers(None).await {
        Ok(workers) => workers,
        Err(err) => {
            eprintln!("projecta: reattach failed to list workers: {err}");
            return;
        }
    };
    let plan = workers::plan_reattach(&workers, worktree_exists, profile_enabled);

    // KI-23: the claim release attributes a claim only to a worker that is
    // still `running`, so the order of the three steps below is the design.
    //
    // 1. Workers whose worktree is gone are retired first. They can never
    //    run their task, so a claim pointing at one goes back to `ready` and
    //    the next sweep starts it for real.
    // 2. The claims are resolved while the workers that wait for a respawn
    //    are still `running`: a claim whose worker did start stays with it
    //    (`dispatched`) instead of being started a second time.
    // 3. Only then are those workers marked `exited` to wait for the board.
    //
    // Skipped workers (profile switched off, budget pause) are never
    // rewritten and stay `running` throughout, so a claim of theirs is
    // attributed as before: `dispatched` with no live process until someone
    // respawns the worker.
    for (worker, action) in &plan {
        match action {
            workers::Reattach::SkipDisabledProfile => eprintln!(
                "projecta: worker {} not reattached: agent profile '{}' is disabled in settings",
                worker.id, worker.profile_id
            ),
            workers::Reattach::SkipPaused => eprintln!(
                "projecta: worker {} not reattached: {}",
                worker.id,
                worker.paused_reason.as_deref().unwrap_or("paused")
            ),
            workers::Reattach::MarkExited => {
                match workers::apply_reattach(store, worker, *action).await {
                    Ok(()) => eprintln!(
                        "projecta: worker {} marked exited; worktree is gone",
                        worker.id
                    ),
                    Err(err) => eprintln!("projecta: could not retire worker {}: {err}", worker.id),
                }
            }
            workers::Reattach::AwaitExplicitRespawn => {}
        }
    }

    match store.release_claimed_queue_entries().await {
        Ok(0) => {}
        Ok(done) => eprintln!("projecta: resolved {done} interrupted queue claim(s)"),
        Err(err) => eprintln!("projecta: could not resolve queue claims: {err}"),
    }

    for (worker, action) in &plan {
        if *action != workers::Reattach::AwaitExplicitRespawn {
            continue;
        }
        match workers::apply_reattach(store, worker, *action).await {
            Ok(()) => eprintln!(
                "projecta: worker {} waiting for explicit respawn after app restart",
                worker.id
            ),
            Err(err) => eprintln!("projecta: could not retire worker {}: {err}", worker.id),
        }
    }
}

/// A short-lived `AgentControl` used only by the startup reattach pass. It owns
/// an `AppHandle`, so it can reach the shared `PtyManager` state without
/// holding a reference to it across an async spawn boundary.
struct AppAgentControl {
    app: AppHandle,
    hook_port: u16,
}

// No `write` override: this control only exists for the startup reattach pass,
// which respawns agents and never types into one.
impl AgentControl for AppAgentControl {
    fn reserve_launch_session(&self) -> Result<String, String> {
        self.app.state::<PtyManager>().reserve_session()
    }
    fn cancel_launch_session(&self, session_id: &str) {
        self.app
            .state::<PtyManager>()
            .cancel_reservation(session_id);
    }
    fn spawn_launch_session(
        &self,
        worker_id: &str,
        profile: &AgentProfile,
        cwd: &Path,
        env: &[(String, String)],
        session_id: &str,
    ) -> Result<String, String> {
        let profile = hooks::with_hook_settings(profile, worker_id, self.hook_port);
        self.app.state::<PtyManager>().spawn_with_id(
            &self.app,
            &profile,
            Some(cwd.to_string_lossy().into_owned()),
            DEFAULT_COLS,
            DEFAULT_ROWS,
            env,
            session_id,
        )
    }
    fn spawn(
        &self,
        worker_id: &str,
        profile: &AgentProfile,
        cwd: &Path,
        env: &[(String, String)],
    ) -> Result<String, String> {
        let profile = hooks::with_hook_settings(profile, worker_id, self.hook_port);
        self.app.state::<PtyManager>().spawn(
            &self.app,
            &profile,
            Some(cwd.to_string_lossy().into_owned()),
            DEFAULT_COLS,
            DEFAULT_ROWS,
            env,
        )
    }

    fn spawn_bound(
        &self,
        worker_id: &str,
        profile: &AgentProfile,
        cwd: &Path,
        env: &[(String, String)],
        bind: &dyn Fn(&str) -> Result<(), String>,
    ) -> Result<String, String> {
        let profile = hooks::with_hook_settings(profile, worker_id, self.hook_port);
        // Reserved, then bound, then spawned: the binding is older than the
        // process, so the exit hook finds the worker even when the agent
        // exits milliseconds into its life.
        let session_id = self.app.state::<PtyManager>().reserve_session()?;
        if let Err(error) = bind(&session_id) {
            self.app
                .state::<PtyManager>()
                .cancel_reservation(&session_id);
            return Err(error);
        }
        self.app.state::<PtyManager>().spawn_with_id(
            &self.app,
            &profile,
            Some(cwd.to_string_lossy().into_owned()),
            DEFAULT_COLS,
            DEFAULT_ROWS,
            env,
            &session_id,
        )
    }

    fn kill(&self, session_id: &str) {
        let _ = self.app.state::<PtyManager>().kill(session_id);
    }
}

/// An `AgentControl` for the one background path that only ever *types* at an
/// agent: the question expiry sweep (Phase 21).
///
/// It owns an `AppHandle` rather than borrowing the `PtyManager`, because the
/// sweep runs on its own thread for the life of the process. Starting an agent
/// is refused rather than implemented - the sweep answers questions, it does
/// not resurrect workers - and the refusal is a plain error so a future caller
/// that reaches for it is told, instead of quietly spawning without hooks.
struct PtyWriter {
    app: AppHandle,
}

impl AgentControl for PtyWriter {
    fn spawn(
        &self,
        _worker_id: &str,
        _profile: &AgentProfile,
        _cwd: &Path,
        _env: &[(String, String)],
    ) -> Result<String, String> {
        Err("this agent control can only type into a running session".to_string())
    }

    fn write(&self, session_id: &str, text: &str) -> Result<(), String> {
        self.app.state::<PtyManager>().write(session_id, text)
    }

    /// C-01: the sweep's answers travel through the submit guard like every
    /// other delivery. Without this override the trait default applied - and
    /// while it was a no-op, the ANSWER_EXPIRED auto-answers were logged as
    /// user turns yet never typed into the terminal ("...or it waits
    /// forever", the sweep's own comment below).
    fn start_task_delivery(
        &self,
        worker_id: &str,
        session_id: &str,
        task: &str,
        readiness_marker: Option<&str>,
        on_outcome: Option<DeliveryCallback>,
    ) -> Result<(), String> {
        let worker_id = worker_id.to_string();
        let app = self.app.clone();
        // Fired at most once: Delivered and Escalated are the guard's
        // terminal events - the PTY layer returns right after emitting them.
        let on_outcome = Mutex::new(on_outcome);
        self.app.state::<PtyManager>().start_submit_guard(
            session_id,
            task.to_string(),
            readiness_marker,
            move |event| {
                // The sweep has no status-event wiring of its own; the answer
                // itself is logged by questions.rs. An escalation still marks
                // the worker as needing a human, once the engine is managed.
                if event == SubmitGuardEvent::Escalated {
                    if let Some(engine) = app.try_state::<Arc<StatusEngine>>() {
                        engine.note_submit_guard_failed(&worker_id);
                    }
                }
                let outcome = match event {
                    SubmitGuardEvent::Delivered => Some(DeliveryOutcome::Delivered),
                    SubmitGuardEvent::Escalated => Some(DeliveryOutcome::Escalated),
                    _ => None,
                };
                if let Some(outcome) = outcome {
                    if let Some(callback) = on_outcome.lock().unwrap().take() {
                        callback(outcome);
                    }
                }
                eprintln!("projecta: question sweep guard ({worker_id}): {event:?}");
            },
        )
    }

    fn kill(&self, session_id: &str) {
        let _ = self.app.state::<PtyManager>().kill(session_id);
    }
}

/// The user-facing reading of one delivery's guard events (F-CORE-3 B.2).
///
/// `SubmitGuardEvent::Escalated` carries no reason - the PTY layer logs it to
/// stderr - so the status text is read from how far the delivery got: an
/// escalation before any write means the readiness marker never appeared and
/// nothing was typed (C-5: "manual Enter required" would send the user
/// pressing Enter into an empty prompt); after the write but before Enter the
/// echo never came; after Enter either the retries ran out or the
/// answer-marker cap did. A delivery stopped by an earlier task in the input
/// line (`InputBlocked`, W1-03d) says so instead of blaming the marker.
/// The one unreachable-in-production blur: with a
/// configured answer marker the guard also escalates when the retries run
/// out, and that path is reported as unanswered retries - no profile wires an
/// answer marker into the guard yet, so the cap text cannot be reached
/// through it today.
#[derive(Default)]
struct GuardNarrative {
    /// W1-03d: the guard stopped before typing because an earlier task
    /// still sits in the input line.
    blocked: bool,
    /// W1-03d: the session was killed or ended under the delivery.
    session_ended: bool,
    wrote: bool,
    entered: bool,
    final_enter_sent: bool,
}

impl GuardNarrative {
    /// The status-event detail for one guard event; updates the progress the
    /// escalation texts are read from.
    fn detail(&mut self, event: &SubmitGuardEvent) -> String {
        match event {
            SubmitGuardEvent::Wrote { write } => {
                self.wrote = true;
                if *write == 1 {
                    "task written after TUI readiness; awaiting echo".to_string()
                } else {
                    format!("task rewritten (write {write}) — no echo from a quiet TUI")
                }
            }
            SubmitGuardEvent::Enter { attempt } => {
                self.entered = true;
                if usize::from(*attempt) == submit_guard::RETRY_BACKOFF.len() {
                    self.final_enter_sent = true;
                }
                if *attempt == 0 {
                    "task echo seen; Enter sent".to_string()
                } else {
                    let seconds = submit_guard::RETRY_BACKOFF[usize::from(*attempt - 1)].as_secs();
                    format!("enter retry {attempt} after {seconds}s without output")
                }
            }
            SubmitGuardEvent::DialogAnswered => {
                "blocking dialog answered (workspace trust)".to_string()
            }
            SubmitGuardEvent::Delivered => {
                // Byte-based progress, not a confirmed delivery: the guard's
                // ConfirmDelivery is not distinguishable at this event
                // boundary, so "task delivery confirmed" is not claimed here.
                "task written and echoed; agent output observed".to_string()
            }
            SubmitGuardEvent::Queued { ahead } => {
                if *ahead == 1 {
                    "queued behind 1 earlier delivery to this session".to_string()
                } else {
                    format!("queued behind {ahead} earlier deliveries to this session")
                }
            }
            SubmitGuardEvent::SessionEnded => {
                self.session_ended = true;
                "the session ended before this delivery was done".to_string()
            }
            SubmitGuardEvent::InputBlocked => {
                self.blocked = true;
                "an earlier task still sits in the input line; this task was not typed".to_string()
            }
            SubmitGuardEvent::Escalated => {
                if self.session_ended {
                    "session ended; task not delivered".to_string()
                } else if self.blocked {
                    "task not typed: an earlier task sits in the input line; type into the terminal to clear it, then resend".to_string()
                } else if !self.wrote {
                    "readiness marker never appeared; task not written".to_string()
                } else if !self.entered {
                    "task never echoed; manual Enter required".to_string()
                } else if self.final_enter_sent {
                    "enter retries unanswered; the task sits on the agent's prompt".to_string()
                } else {
                    // The ANSWER_MARKER_CAP ran out: the task was written and
                    // echoed, but no answer marker confirmed the agent reacted.
                    "answer marker never appeared; delivery not confirmed".to_string()
                }
            }
        }
    }
}

impl AgentControl for PtyAgents<'_> {
    fn reserve_launch_session(&self) -> Result<String, String> {
        self.manager.reserve_session()
    }
    fn cancel_launch_session(&self, session_id: &str) {
        self.manager.cancel_reservation(session_id);
    }
    fn spawn_launch_session(
        &self,
        worker_id: &str,
        profile: &AgentProfile,
        cwd: &Path,
        env: &[(String, String)],
        session_id: &str,
    ) -> Result<String, String> {
        let profile = hooks::with_hook_settings(profile, worker_id, self.hook_port);
        self.manager.spawn_with_id(
            self.app,
            &profile,
            Some(cwd.to_string_lossy().into_owned()),
            DEFAULT_COLS,
            DEFAULT_ROWS,
            env,
            session_id,
        )
    }
    fn spawn(
        &self,
        worker_id: &str,
        profile: &AgentProfile,
        cwd: &Path,
        env: &[(String, String)],
    ) -> Result<String, String> {
        // Agents that understand hooks are handed a generated settings file so
        // they report their own lifecycle straight back to the board.
        let profile = hooks::with_hook_settings(profile, worker_id, self.hook_port);
        self.manager.spawn(
            self.app,
            &profile,
            Some(cwd.to_string_lossy().into_owned()),
            DEFAULT_COLS,
            DEFAULT_ROWS,
            env,
        )
    }

    fn spawn_bound(
        &self,
        worker_id: &str,
        profile: &AgentProfile,
        cwd: &Path,
        env: &[(String, String)],
        bind: &dyn Fn(&str) -> Result<(), String>,
    ) -> Result<String, String> {
        // Agents that understand hooks are handed a generated settings file so
        // they report their own lifecycle straight back to the board.
        let profile = hooks::with_hook_settings(profile, worker_id, self.hook_port);
        // Reserved, then bound, then spawned: the binding is older than the
        // process, so the exit hook finds the worker even when the agent
        // exits milliseconds into its life.
        let session_id = self.manager.reserve_session()?;
        if let Err(error) = bind(&session_id) {
            self.manager.cancel_reservation(&session_id);
            return Err(error);
        }
        self.manager.spawn_with_id(
            self.app,
            &profile,
            Some(cwd.to_string_lossy().into_owned()),
            DEFAULT_COLS,
            DEFAULT_ROWS,
            env,
            &session_id,
        )
    }

    fn write(&self, session_id: &str, text: &str) -> Result<(), String> {
        self.manager.write(session_id, text)
    }

    fn kill(&self, session_id: &str) {
        // The session may already be gone; that is exactly what we wanted.
        let _ = self.manager.kill(session_id);
    }

    fn skill_packs_dir(&self) -> Result<PathBuf, String> {
        skills::bundled_skills_dir(self.app)
    }

    fn start_task_delivery(
        &self,
        worker_id: &str,
        session_id: &str,
        task: &str,
        readiness_marker: Option<&str>,
        on_outcome: Option<DeliveryCallback>,
    ) -> Result<(), String> {
        let worker_id = worker_id.to_string();
        let readiness_marker = readiness_marker.map(str::to_string);
        let store = self.store.clone();
        let engine = Arc::clone(&self.engine);
        // Fired at most once: Delivered and Escalated are the guard's
        // terminal events - the PTY layer returns right after emitting them.
        let on_outcome = Mutex::new(on_outcome);
        let narrative = Mutex::new(GuardNarrative::default());
        self.manager.start_submit_guard(
            session_id,
            task.to_string(),
            readiness_marker.as_deref(),
            move |event| {
                let outcome = match event {
                    SubmitGuardEvent::Delivered => Some(DeliveryOutcome::Delivered),
                    SubmitGuardEvent::Escalated => Some(DeliveryOutcome::Escalated),
                    _ => None,
                };
                if let Some(outcome) = outcome {
                    if let Some(callback) = on_outcome.lock().unwrap().take() {
                        callback(outcome);
                    }
                }
                if event == SubmitGuardEvent::Escalated {
                    engine.note_submit_guard_failed(&worker_id);
                }
                let detail = narrative.lock().unwrap().detail(&event);
                let store = store.clone();
                let worker_id = worker_id.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = store
                        .record_status_event(
                            &worker_id,
                            "submit_guard",
                            &detail,
                            crate::store::SRC_GUARD,
                        )
                        .await
                    {
                        eprintln!("projecta: {err}");
                    }
                });
            },
        )
    }
}

// -- pty commands (Phase 1) ------------------------------------------------

#[tauri::command]
fn spawn_pty(
    app: AppHandle,
    manager: State<'_, PtyManager>,
    profile_id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<SpawnPtyResponse, String> {
    let profile = profiles::find_profile(&profile_id)
        .ok_or_else(|| format!("unknown agent profile: {profile_id}"))?;
    let session_id = manager.spawn(&app, &profile, cwd, cols, rows, &[])?;
    Ok(SpawnPtyResponse { session_id })
}

#[tauri::command]
fn write_pty(
    manager: State<'_, PtyManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    // W1-03d: keystrokes from the terminal view are the user's own input;
    // Enter, Ctrl-U or Ctrl-C there clear a line an escalated delivery left
    // behind (see PtyManager::write_user_input).
    manager.write_user_input(&session_id, &data)
}

#[tauri::command]
fn resize_pty(
    manager: State<'_, PtyManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(&session_id, cols, rows)
}

#[tauri::command]
fn kill_pty(manager: State<'_, PtyManager>, session_id: String) -> Result<(), String> {
    manager.kill(&session_id)
}

#[tauri::command]
fn get_scrollback(manager: State<'_, PtyManager>, session_id: String) -> Result<String, String> {
    manager.scrollback(&session_id)
}

/// Persisted scrollback and draft after a crash or exit. Never a live PTY
/// and never a spawn: `restore.liveSession` is always false.
#[tauri::command]
async fn get_session_restore(
    store: State<'_, Store>,
    worker_id: String,
) -> Result<crate::sessionpersist::Restore, String> {
    let worker = store
        .get_worker(&worker_id)
        .await?
        .ok_or_else(|| format!("unknown worker: {worker_id}"))?;
    let worktree_exists = std::path::Path::new(&worker.worktree_path).is_dir();
    crate::sessionpersist::restore_configured(&worker_id, worktree_exists)
}

/// The agent profiles, each carrying whether learning is enabled for it.
///
/// The registry itself is compiled in and knows nothing about the user's
/// choices, so the stored per-profile switch is folded in here rather than in
/// [`profiles::load_profiles`].
#[tauri::command]
async fn list_agent_profiles(store: State<'_, Store>) -> Result<Vec<AgentProfile>, String> {
    Ok(learnings::profiles_with_enabled(&store).await)
}

// -- project commands (Phase 2) --------------------------------------------

/// Register a repository and answer with the same enriched shape
/// `list_projects` uses: the sidebar decides its GitHub affordances off
/// `githubRemote`, and a freshly created row must not claim "no remote" for a
/// repository that already has one.
#[tauri::command]
async fn create_project(
    store: State<'_, Store>,
    name: String,
    repo_path: String,
) -> Result<ProjectOverview, String> {
    // `git rev-parse` is a child process; keep it off the thread serving the
    // UI - the `with_github_flag` probe two lines below travels the same way.
    let git_path = repo_path.clone();
    tauri::async_runtime::spawn_blocking(move || worktree::ensure_git_repo(&git_path))
        .await
        .map_err(|e| format!("checking the repository did not finish: {e}"))??;
    let project = store.create_project(&name, &repo_path).await?;
    // The git probe is a child process; keep it off the thread serving the UI.
    tauri::async_runtime::spawn_blocking(move || Ok(with_github_flag(project)))
        .await
        .map_err(|e| format!("creating the project did not finish: {e}"))?
}

#[tauri::command]
async fn list_projects(store: State<'_, Store>) -> Result<Vec<ProjectOverview>, String> {
    let projects = store.list_projects().await?;
    // One git child process per project is a probe, not instant - keep it off
    // the thread serving the UI.
    tauri::async_runtime::spawn_blocking(move || {
        Ok(projects
            .into_iter()
            .map(with_github_flag)
            .collect::<Vec<ProjectOverview>>())
    })
    .await
    .map_err(|e| format!("listing the projects did not finish: {e}"))?
}

/// Everything [`Project`] says plus whether its origin points at GitHub.
fn with_github_flag(project: Project) -> ProjectOverview {
    ProjectOverview {
        github_remote: gh::has_github_remote(&project.repo_path),
        project,
    }
}

/// Create a GitHub repository for the project and push it, returning the url.
///
/// The `gh` and git child processes run on a blocking thread: creating a
/// repository can take seconds and must never stall the UI.
#[tauri::command]
async fn create_github_repo(
    store: State<'_, Store>,
    project_id: String,
    name: String,
    private: bool,
) -> Result<String, String> {
    let project = store
        .get_project(&project_id)
        .await?
        .ok_or_else(|| format!("unknown project: {project_id}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        gh::create_github_repo(&project.repo_path, &name, private)
    })
    .await
    .map_err(|e| format!("the github create did not finish: {e}"))?
}

/// Point an existing GitHub repository at this project as `origin`.
#[tauri::command]
async fn link_github_remote(
    store: State<'_, Store>,
    project_id: String,
    url: String,
) -> Result<(), String> {
    let project = store
        .get_project(&project_id)
        .await?
        .ok_or_else(|| format!("unknown project: {project_id}"))?;
    tauri::async_runtime::spawn_blocking(move || gh::link_github_remote(&project.repo_path, &url))
        .await
        .map_err(|e| format!("the github link did not finish: {e}"))?
}

/// The skill packs bundled with this build, including their display metadata.
#[tauri::command]
fn list_skill_packs(app: AppHandle) -> Result<Vec<SkillPack>, String> {
    skills::list_packs(&skills::bundled_skills_dir(&app)?)
}

/// Persist a project's skill-pack selection. An empty selection deliberately
/// means the default: all packs currently bundled with ProjectA.
#[tauri::command]
async fn set_project_skill_packs(
    store: State<'_, Store>,
    project_id: String,
    packs: Vec<String>,
) -> Result<(), String> {
    store.set_project_skill_packs(&project_id, &packs).await
}

/// Resolve the project's selection against this build's bundled packs. This
/// makes a NULL/empty database value useful to the frontend: it receives the
/// concrete default-all list rather than having to reproduce that policy.
#[tauri::command]
async fn get_project_skill_packs(
    app: AppHandle,
    store: State<'_, Store>,
    project_id: String,
) -> Result<Vec<String>, String> {
    let available = skills::pack_ids(&skills::bundled_skills_dir(&app)?)?;
    let selected = store.get_project_skill_packs(&project_id).await?;
    Ok(skills::resolve_enabled(&available, selected.as_deref()))
}

/// The Markdown content of the project's landing page, or `None` when nobody
/// has written one yet.
#[tauri::command]
async fn get_landing_page(
    store: State<'_, Store>,
    project_id: String,
) -> Result<Option<String>, String> {
    store.get_landing_page(&project_id).await
}

/// Store (or with `markdown: null`, clear) the project's landing page content.
#[tauri::command]
async fn set_landing_page(
    store: State<'_, Store>,
    project_id: String,
    markdown: Option<String>,
) -> Result<(), String> {
    store
        .set_landing_page(&project_id, markdown.as_deref())
        .await
}

// -- dispatcher (Phase 9) --------------------------------------------------

/// Store (or with `None`, clear) the cap on this project's concurrently
/// running employees. Clearing it hands the project back to the dispatcher's
/// own default; the change takes effect on the next sweep, without a restart.
#[tauri::command]
async fn set_project_max_workers(
    store: State<'_, Store>,
    project_id: String,
    max_workers: Option<i64>,
) -> Result<(), String> {
    store
        .set_project_max_workers(&project_id, max_workers)
        .await
}

// -- test gate (Phase 12) --------------------------------------------------

/// Store (or with `None`, clear) the shell command the test gate runs for this
/// project. Clearing it switches the gate off for every worker at once.
#[tauri::command]
async fn set_project_test_command(
    store: State<'_, Store>,
    project_id: String,
    command: Option<String>,
) -> Result<(), String> {
    store
        .set_project_test_command(&project_id, command.as_deref())
        .await
}

/// Run the project's test command in this worker's worktree, now, and return
/// the worker with the verdict written to it.
///
/// Unconditional on purpose: the automatic trigger refuses to re-test a worker
/// that already passed, and this is how the user overrules that.
#[tauri::command]
async fn run_worker_tests(store: State<'_, Store>, worker_id: String) -> Result<Worker, String> {
    testgate::run_test_gate(store.inner(), &worker_id).await
}

// -- web interface (Phase 8) -----------------------------------------------

/// Serve every project's landing page, the board and the learnings review over
/// `http://<web_interface.bind>:<port>`.
///
/// A port of 0 lets the operating system pick one; the bound port is what
/// comes back - both as this function's return value and as
/// `web_interface_status`. Starting again while one is already up restarts it:
/// the previous server shuts down first, so exactly one web interface is ever
/// left behind.
#[tauri::command]
fn start_web_interface(
    store: State<'_, Store>,
    engine: State<'_, Arc<StatusEngine>>,
    web: State<'_, Mutex<WebInterfaceState>>,
    port: u16,
) -> Result<u16, String> {
    let mut running = web
        .lock()
        .map_err(|_| "the web interface state was poisoned".to_string())?;
    let _ = web_interface::stop_web_interface(&mut running);
    // The engine comes along because the board routes need it: a column is
    // derived, not stored, so the store alone can only serve landing pages.
    let state = web_interface::start_web_interface(
        Arc::new(store.inner().clone()),
        Arc::clone(engine.inner()),
        port,
    )?;
    let bound = state.port();
    *running = state;
    Ok(bound)
}

#[tauri::command]
fn stop_web_interface(web: State<'_, Mutex<WebInterfaceState>>) -> Result<(), String> {
    let mut running = web
        .lock()
        .map_err(|_| "the web interface state was poisoned".to_string())?;
    web_interface::stop_web_interface(&mut running)
}

/// The port the web interface currently answers on, if any.
#[tauri::command]
fn web_interface_status(web: State<'_, Mutex<WebInterfaceState>>) -> Option<u16> {
    // A poisoned lock here used to read as "no web interface running", which
    // is indistinguishable from the ordinary off state (W1-15). Reading the
    // state is not itself a mutation, so the recovered value is exactly what
    // the panicked start/stop call left behind - take it over instead of
    // hiding a running (or crashed-while-stopping) interface as absent.
    let running = web.lock().unwrap_or_else(|poison| {
        eprintln!("projecta: web interface state was poisoned; reporting its recovered status");
        poison.into_inner()
    });
    web_interface::web_interface_status(&running)
}

/// Forget a project: its workers are archived and their agents stopped, but
/// nothing is deleted from disk - the worktrees are still there afterwards.
#[tauri::command]
async fn remove_project(
    app: AppHandle,
    store: State<'_, Store>,
    manager: State<'_, PtyManager>,
    receiver: State<'_, HookReceiver>,
    engine: State<'_, Arc<StatusEngine>>,
    id: String,
) -> Result<(), String> {
    let agents = PtyAgents::new(
        &app,
        &manager,
        &receiver,
        store.inner().clone(),
        engine.inner().clone(),
    );
    let gone = store.list_workers(Some(&id)).await?;
    workers::remove_project(&store, &agents, &id).await?;
    for worker in gone {
        hooks::remove_worker_files(&worker.id);
        engine.forget_worker(&worker.id);
    }
    Ok(())
}

// -- worker commands (Phase 2) ---------------------------------------------

/// Tauri injects the managed state as parameters, so the payload fields the
/// frontend actually sends are only the last three.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
async fn create_worker(
    app: AppHandle,
    store: State<'_, Store>,
    manager: State<'_, PtyManager>,
    receiver: State<'_, HookReceiver>,
    engine: State<'_, Arc<StatusEngine>>,
    project_id: String,
    task: String,
    profile_id: String,
    // Optional on the wire: a call without the field is the plain profile,
    // exactly as every caller written before roles existed sends it.
    role_variant_id: Option<String>,
) -> Result<Worker, String> {
    let agents = PtyAgents::new(
        &app,
        &manager,
        &receiver,
        store.inner().clone(),
        engine.inner().clone(),
    );
    // The dialog has no coordinator to book the worker under.
    let worker = workers::create_worker_as_role(
        &store,
        &agents,
        &project_id,
        &task,
        &profile_id,
        None,
        role_variant_id.as_deref(),
    )
    .await?;
    engine.observe_worker(&worker);
    Ok(worker)
}

#[tauri::command]
async fn list_workers(
    store: State<'_, Store>,
    project_id: Option<String>,
) -> Result<Vec<Worker>, String> {
    store.list_workers(project_id.as_deref()).await
}

#[tauri::command]
/// Owned sessions, including reserved/starting entries, rather than stale DB
/// worker status. An unavailable registry rejects instead of reporting idle.
fn list_live_sessions(pty: State<'_, PtyManager>) -> Result<Vec<String>, String> {
    pty.live_session_ids()
}

/// Download and verify first, then atomically exclude new session starts before
/// invoking the installer. This is not a database maintenance/recovery protocol.
#[tauri::command]
async fn install_update_when_idle(
    webview: tauri::Webview,
    update_rid: tauri::ResourceId,
) -> Result<(), String> {
    let update = webview
        .resources_table()
        .get::<tauri_plugin_updater::Update>(update_rid)
        .map_err(|error| error.to_string())?;
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    let app = webview.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<PtyManager>()
            .install_when_idle(|| update.install(&bytes).map_err(|error| error.to_string()))
    })
    .await
    .map_err(|error| format!("Installer interrupted: {error}; restart before retrying"))?
}

// -- task queue (Phase 7) -------------------------------------------------

#[tauri::command]
// The queue row simply has this many independent columns; bundling them
// into a params struct would only move the same list one level away.
#[allow(clippy::too_many_arguments)]
async fn enqueue_task(
    app: AppHandle,
    store: State<'_, Store>,
    project_id: String,
    raw_text: String,
    profile_id: Option<String>,
    sharpen: bool,
    priority: Option<i32>,
    spawned_by: Option<String>,
) -> Result<QueueEntry, String> {
    queue::enqueue(
        app,
        store.inner().clone(),
        project_id,
        raw_text,
        profile_id,
        sharpen,
        priority,
        spawned_by,
    )
    .await
}

#[tauri::command]
async fn list_queue(
    store: State<'_, Store>,
    project_id: Option<String>,
) -> Result<Vec<QueueEntry>, String> {
    store.list_queue(project_id.as_deref()).await
}

#[tauri::command]
async fn cancel_queued_task(store: State<'_, Store>, id: String) -> Result<(), String> {
    store.cancel_queue_entry(&id).await
}

#[tauri::command]
async fn archive_worker(
    app: AppHandle,
    store: State<'_, Store>,
    manager: State<'_, PtyManager>,
    receiver: State<'_, HookReceiver>,
    engine: State<'_, Arc<StatusEngine>>,
    worker_id: String,
) -> Result<Worker, String> {
    let agents = PtyAgents::new(
        &app,
        &manager,
        &receiver,
        store.inner().clone(),
        engine.inner().clone(),
    );
    let worker = workers::archive_worker(&store, &agents, &worker_id).await?;
    hooks::remove_worker_files(&worker.id);
    engine.observe_worker(&worker);
    Ok(worker)
}

/// Merge a worker's branch - the one lifecycle action that is only ever
/// triggered by a person. The agents drive ProjectA through the `pa` CLI, and
/// `pa worker merge` is deliberately absent from what their system prompts
/// tell them they may run.
///
/// `remove_worktree` defaults to false: the checkout stays on disk unless the
/// caller says otherwise.
#[tauri::command]
async fn merge_worker(
    app: AppHandle,
    store: State<'_, Store>,
    manager: State<'_, PtyManager>,
    receiver: State<'_, HookReceiver>,
    engine: State<'_, Arc<StatusEngine>>,
    worker_id: String,
    remove_worktree: Option<bool>,
) -> Result<Worker, String> {
    let agents = PtyAgents::new(
        &app,
        &manager,
        &receiver,
        store.inner().clone(),
        engine.inner().clone(),
    );
    // The engine publishes the column change itself, so unlike `archive_worker`
    // there is nothing left to refresh here.
    workers::merge_worker(
        &store,
        &agents,
        engine.inner().as_ref(),
        &worker_id,
        remove_worktree.unwrap_or(false),
    )
    .await
}

#[tauri::command]
async fn respawn_worker(
    app: AppHandle,
    store: State<'_, Store>,
    manager: State<'_, PtyManager>,
    receiver: State<'_, HookReceiver>,
    engine: State<'_, Arc<StatusEngine>>,
    worker_id: String,
) -> Result<Worker, String> {
    let agents = PtyAgents::new(
        &app,
        &manager,
        &receiver,
        store.inner().clone(),
        engine.inner().clone(),
    );
    let worker = workers::respawn_worker(&store, &agents, &worker_id).await?;
    engine.observe_worker(&worker);
    Ok(worker)
}

/// Start a project's orchestrator: one agent in the repository root, with no
/// worktree of its own, told to plan the work and to run the other agents
/// through the `pa` CLI rather than to write code itself.
///
/// Returns a [`Worker`] like any other, with `kind: "orchestrator"`, so the
/// board and the terminal view need to know nothing new about it.
#[tauri::command]
async fn create_orchestrator(
    app: AppHandle,
    store: State<'_, Store>,
    manager: State<'_, PtyManager>,
    receiver: State<'_, HookReceiver>,
    engine: State<'_, Arc<StatusEngine>>,
    project_id: String,
) -> Result<Worker, String> {
    let agents = PtyAgents::new(
        &app,
        &manager,
        &receiver,
        store.inner().clone(),
        engine.inner().clone(),
    );
    let worker = workers::create_orchestrator(&store, &agents, &project_id, None).await?;
    engine.observe_worker(&worker);
    Ok(worker)
}

/// Say something to the project's orchestrator: the chat box of the app.
///
/// Find-or-create, so the first message of a session starts the orchestrator
/// instead of failing - the user should not have to press a separate button
/// before they can talk. Returns the orchestrator whose log now holds the
/// message.
#[tauri::command]
async fn send_to_orchestrator(
    app: AppHandle,
    store: State<'_, Store>,
    manager: State<'_, PtyManager>,
    receiver: State<'_, HookReceiver>,
    engine: State<'_, Arc<StatusEngine>>,
    project_id: String,
    text: String,
) -> Result<Worker, String> {
    let agents = PtyAgents::new(
        &app,
        &manager,
        &receiver,
        store.inner().clone(),
        engine.inner().clone(),
    );
    let worker = workers::send_to_orchestrator(&store, &agents, &project_id, &text).await?;
    engine.observe_worker(&worker);
    Ok(worker)
}

// -- scout commands (Phase 7.1) --------------------------------------------

/// Start a project's research scout: one agent in the repository root, with no
/// worktree of its own, told to read the repo, research the internet, and write
/// what it finds into `.pa-scout.jsonl` - which the app ingests as
/// recommendations.
///
/// Returns a [`Worker`] like any other, with `kind: "scout"`.
#[tauri::command]
async fn create_scout(
    app: AppHandle,
    store: State<'_, Store>,
    manager: State<'_, PtyManager>,
    receiver: State<'_, HookReceiver>,
    engine: State<'_, Arc<StatusEngine>>,
    project_id: String,
) -> Result<Worker, String> {
    let agents = PtyAgents::new(
        &app,
        &manager,
        &receiver,
        store.inner().clone(),
        engine.inner().clone(),
    );
    // A scout is started by the UI, never by a coordinator, so there is
    // nobody to book it under.
    let worker = scout::create_scout(&store, &agents, &project_id, None).await?;
    engine.observe_worker(&worker);
    Ok(worker)
}

/// Start a scout whose whole assignment is judging the repositories in `urls`:
/// one recommendation per URL, including the ones it advises against.
#[tauri::command]
async fn triage_repos(
    app: AppHandle,
    store: State<'_, Store>,
    manager: State<'_, PtyManager>,
    receiver: State<'_, HookReceiver>,
    engine: State<'_, Arc<StatusEngine>>,
    project_id: String,
    urls: Vec<String>,
) -> Result<Worker, String> {
    let agents = PtyAgents::new(
        &app,
        &manager,
        &receiver,
        store.inner().clone(),
        engine.inner().clone(),
    );
    // Same as `create_scout`: triage is ordered by a human, so there is no
    // spawner to record.
    let worker = scout::triage_repos(&store, &agents, &project_id, &urls, None).await?;
    engine.observe_worker(&worker);
    Ok(worker)
}

/// What the scouts have found, with the project's scout file ingested first so
/// a finding written a second ago is already in the list.
#[tauri::command]
async fn list_recommendations(
    store: State<'_, Store>,
    project_id: Option<String>,
) -> Result<Vec<Recommendation>, String> {
    scout::list_recommendations(&store, project_id.as_deref()).await
}

/// Mark a recommendation `accepted` or `dismissed` without queueing anything.
#[tauri::command]
async fn set_recommendation_status(
    store: State<'_, Store>,
    id: String,
    status: String,
) -> Result<(), String> {
    scout::set_recommendation_status(&store, &id, &status).await
}

/// Take a recommendation up: queue the integration work and accept it. The
/// Phase 7.0 dispatcher gives the returned entry a worker on its next sweep.
#[tauri::command]
async fn accept_recommendation(store: State<'_, Store>, id: String) -> Result<QueueEntry, String> {
    scout::accept_recommendation(&store, &id).await
}

// -- board commands (Phase 3) ----------------------------------------------

/// Every worker, with the column the status engine currently puts it in, plus
/// the coordinators steering them.
///
/// Returns `{ cards, coordinators }`. A card is `{ worker, column,
/// attentionReason, prUrl, contextUsage, controlledBy }`, where `column` is one
/// of `working`, `needs_you`, `in_review`, `ready_to_merge` or `done`,
/// `contextUsage` is `{ used, total }` in tokens or `null` when the agent has
/// not printed a status line, and `controlledBy` is `{ workerId, kind, label }`
/// or `null` when a human started the worker. A coordinator is `{ workerId,
/// kind, label, status, sessionId }`.
///
/// Both halves read the same worker list - which includes archived workers, so
/// a badge still resolves once its queen is done.
#[tauri::command]
async fn get_board_state(
    store: State<'_, Store>,
    engine: State<'_, Arc<StatusEngine>>,
    project_id: Option<String>,
) -> Result<BoardState, String> {
    let workers = store.list_workers(project_id.as_deref()).await?;
    Ok(BoardState {
        cards: engine.board(&workers),
        coordinators: status::coordinators(&workers),
    })
}

/// Pin a worker to a column by hand; `null` clears the pin. The next definitive
/// signal - a hook event, a permission or quota prompt, a change to the pull
/// request, or archiving the worker - clears it too.
#[tauri::command]
fn set_worker_column_override(
    engine: State<'_, Arc<StatusEngine>>,
    worker_id: String,
    column: Option<String>,
) -> Result<(), String> {
    engine.set_override(&worker_id, column.as_deref())
}

// -- quota commands (Phase 3.6) --------------------------------------------

/// What each agent profile's provider is currently willing to serve.
///
/// Returns `[{ profileId, state, blockedUntil, reason, omniRouteOnline }]` -
/// one row per known profile, plus any profile that is blocked but no longer
/// listed. `state` is `ok`, `blocked` or `unknown`; `blockedUntil` is unix
/// seconds, and is usually `null` because agents word their reset times for
/// people rather than for parsers.
///
/// Advisory only: the core never refuses to spawn a blocked profile, it just
/// says so.
#[tauri::command]
fn get_quota_state(quota: State<'_, Arc<QuotaTracker>>) -> Result<Vec<QuotaStateRow>, String> {
    let profile_ids: Vec<String> = profiles::load_profiles()
        .into_iter()
        .map(|profile| profile.id)
        .collect();
    Ok(quota.snapshot(&profile_ids))
}

/// What OmniRoute has routed: the newest ledger rows plus the totals.
///
/// Fleet-wide - the router's log has no project dimension, see
/// [`omniroute::UsageReport`] - and honest about the two things it cannot
/// know: `costUsd` is null on every row the feed did not price, and
/// `reportedCostUsd` is the router's own lifetime figure beside it. An
/// `authorized: false` report is the ordinary answer on a machine with no
/// management token; the rows it carries are then whatever was stored before.
#[tauri::command]
async fn get_omniroute_usage(
    store: State<'_, Store>,
    quota: State<'_, Arc<QuotaTracker>>,
    limit: Option<u32>,
) -> Result<UsageReport, String> {
    let limit = limit.unwrap_or(USAGE_VIEW_LIMIT).clamp(1, 500);
    omniroute::usage_report(quota.omni_route(), &store, limit, now_unix_secs()).await
}

/// How many ledger rows the Usage view asks for when it does not say.
const USAGE_VIEW_LIMIT: u32 = 50;

// -- budget commands (Phase 18) --------------------------------------------

/// The percentage ceilings per agent profile, one row per profile that has at
/// least one. A profile without a ceiling is simply absent.
#[tauri::command]
async fn get_budgets(store: State<'_, Store>) -> Result<Vec<budget::BudgetLimits>, String> {
    budget::list_limits(&store).await
}

/// Write one profile's ceilings and answer with what is stored afterwards.
///
/// Each window is three-valued, and the window that is not sent keeps what it
/// had: `undefined` leaves it alone, `null` removes the ceiling, a number sets
/// one. The frontend sends both whenever the user presses save, so the round
/// trip is exactly what is on screen.
#[tauri::command]
async fn set_budget(
    store: State<'_, Store>,
    profile_id: String,
    five_hour_pct: Option<Option<u8>>,
    seven_day_pct: Option<Option<u8>>,
) -> Result<budget::BudgetLimits, String> {
    budget::update_limits(&store, &profile_id, five_hour_pct, seven_day_pct).await
}

// -- digest commands (Phase 18) --------------------------------------------

/// One project's repository path, for the commands that read files under it.
async fn project_repo_path(store: &Store, project_id: &str) -> Result<String, String> {
    store
        .get_project(project_id)
        .await?
        .map(|project| project.repo_path)
        .ok_or_else(|| format!("{}project: {project_id}", workers::ERR_UNKNOWN))
}

/// The days this project has a daily digest for, newest first.
#[tauri::command]
async fn list_digests(store: State<'_, Store>, project_id: String) -> Result<Vec<String>, String> {
    let repo_path = project_repo_path(&store, &project_id).await?;
    Ok(digest::list_digests(&repo_path))
}

/// One day's digest as Markdown, or `null` when that day has no page.
#[tauri::command]
async fn get_digest(
    store: State<'_, Store>,
    project_id: String,
    date: String,
) -> Result<Option<String>, String> {
    let repo_path = project_repo_path(&store, &project_id).await?;
    Ok(digest::read_digest(&repo_path, &date))
}

#[tauri::command]
async fn get_development_plan(
    store: State<'_, Store>,
    project_id: String,
    plan_id: String,
    revision: Option<i64>,
) -> Result<Value, String> {
    development_plan_access::read(&store, &project_id, &plan_id, revision).await
}

#[tauri::command]
async fn import_development_plan(
    store: State<'_, Store>,
    project_id: String,
    plan_id: String,
    expected_projection_revision: i64,
    rollback_reason: Option<String>,
) -> Result<Value, String> {
    development_plan_access::import(
        &store,
        &project_id,
        &plan_id,
        expected_projection_revision,
        rollback_reason.as_deref(),
    )
    .await
}

/// Whether the hourly digest writer runs at all. On unless switched off.
#[tauri::command]
async fn get_digest_enabled(store: State<'_, Store>) -> Result<bool, String> {
    Ok(digest::enabled(&store).await)
}

#[tauri::command]
async fn set_digest_enabled(store: State<'_, Store>, enabled: bool) -> Result<(), String> {
    digest::set_enabled(&store, enabled).await
}

#[tauri::command]
async fn get_routing_status(store: State<'_, Store>) -> Result<routing::RoutingStatus, String> {
    Ok(routing::routing_status(&store).await)
}

#[tauri::command]
async fn set_product_mode(store: State<'_, Store>, mode: String) -> Result<(), String> {
    let parsed = routing::ProductMode::parse(&mode)
        .ok_or_else(|| format!("unknown product mode: {mode}"))?;
    routing::set_product_mode(&store, parsed).await
}

// -- project statistics (Phase 20) -----------------------------------------

/// One project's statistics: overview, tokens, sessions, timeline, estimate.
///
/// `range` is `today`, `week`, `month` or `all`, and `7d`/`30d` name the same
/// windows as `week`/`month`; an absent one is `all`. An unknown one is an
/// error rather than a silent fallback - a window the caller did not ask for
/// would put right numbers under a wrong label.
///
/// One command for the whole tab: the sections are polled together and would
/// otherwise be assembled from five reads taken at five different moments.
#[tauri::command]
async fn get_project_stats(
    store: State<'_, Store>,
    engine: State<'_, Arc<StatusEngine>>,
    project_id: String,
    range: Option<String>,
) -> Result<stats::ProjectStats, String> {
    let range = parse_stats_range(range.as_deref())?;
    stats::project_stats(&store, &engine, &project_id, range, now_unix_secs()).await
}

/// The window a caller named, or [`stats::StatsRange::All`] when it named none.
fn parse_stats_range(range: Option<&str>) -> Result<stats::StatsRange, String> {
    match range {
        None | Some("") => Ok(stats::StatsRange::All),
        Some(name) => stats::StatsRange::parse(name)
            .ok_or_else(|| format!("unknown range: {name} (today, week, month, all, 7d or 30d)")),
    }
}

// -- P2-H diagnosis (log path, pack, Warum) --------------------------------

#[tauri::command]
fn get_log_path(app: AppHandle) -> Result<String, String> {
    let dir = app_data_dir(&app)?;
    Ok(logging::log_file(&dir).display().to_string())
}

#[tauri::command]
fn get_panic_notice(notice: State<'_, PanicNotice>) -> PanicNotice {
    notice.inner().clone()
}

#[tauri::command]
fn get_reason_catalog() -> Vec<diagnosis::ReasonExplanation> {
    diagnosis::reason_catalog()
}

#[tauri::command]
async fn export_diagnosis(
    app: AppHandle,
    store: State<'_, Store>,
    engine: State<'_, Arc<StatusEngine>>,
    vault: State<'_, Arc<KeyVault>>,
    notice: State<'_, PanicNotice>,
) -> Result<String, String> {
    let dir = app_data_dir(&app)?;
    let panic = notice.inner().clone();
    let (pack, secrets) = diagnosis::collect(
        &dir,
        store.inner(),
        engine.inner().as_ref(),
        vault.inner().as_ref(),
        &panic,
    )
    .await?;
    Ok(diagnosis::export_json(&pack, &secrets))
}

/// F5 baseline: CPU/RAM/disk plus the OmniRoute token totals. No ceilings.
#[tauri::command]
async fn get_resource_snapshot(
    app: AppHandle,
    store: State<'_, Store>,
) -> Result<resources::ResourceSnapshot, String> {
    let dir = app_data_dir(&app)?;
    let totals = store.usage_totals(None).await?;
    let (tokens_in, tokens_out) = (totals.tokens_in, totals.tokens_out);
    let now = now_unix_secs();
    // The recursive directory walk is filesystem IO; keep it off the thread
    // serving the UI - the same pattern as create_project/list_projects.
    tauri::async_runtime::spawn_blocking(move || {
        resources::snapshot(&dir, tokens_in, tokens_out, now)
    })
    .await
    .map_err(|e| format!("measuring resources did not finish: {e}"))
}

/// Settings action: wipe every session buffer. Retention still sweeps later.
#[tauri::command]
async fn delete_session_buffers() -> Result<usize, String> {
    // File deletion is filesystem IO; keep it off the UI thread too.
    tauri::async_runtime::spawn_blocking(sessionpersist::delete_all_configured)
        .await
        .map_err(|e| format!("deleting the session buffers did not finish: {e}"))?
}

/// Open the log file in the OS file manager so the user does not have to
/// know `%APPDATA%`. Explorer's `/select,` highlights the file; elsewhere
/// the parent directory opens.
#[tauri::command]
fn reveal_log_path(app: AppHandle) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    let path = logging::log_file(&dir);
    #[cfg(windows)]
    {
        crate::proc::command("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn()
            .map_err(|e| format!("failed to open Explorer: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        crate::proc::command("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("failed to reveal the log file: {e}"))?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = path.parent().unwrap_or(path.as_path());
        crate::proc::command("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("failed to open the log directory: {e}"))?;
        Ok(())
    }
}

// -- stuck diagnosis commands (Phase 18) -----------------------------------

/// After how many quiet minutes a running worker is called stuck, or `null`
/// when the built-in default applies.
#[tauri::command]
async fn get_stuck_after_minutes(store: State<'_, Store>) -> Result<Option<u64>, String> {
    Ok(stuck::threshold_minutes(&store).await)
}

/// Set (or with `null`, clear) that threshold.
#[tauri::command]
async fn set_stuck_after_minutes(
    store: State<'_, Store>,
    minutes: Option<u64>,
) -> Result<(), String> {
    stuck::set_threshold_minutes(&store, minutes).await
}

// -- provider commands (Phase 7.2) -----------------------------------------

/// Which providers this machine can reach, and what each one is doing.
///
/// One row per registered provider: `{ id, name, kind, connected, detail,
/// quotaState, blockedUntil, omniRouteOnline }`. `connected` is what the probe
/// found - a CLI on the PATH, a local server answering, a key in the vault -
/// and `quotaState` is what the provider has been saying to the workers. The
/// two are independent: a signed-in `claude` that is out of credit is
/// `connected: true, quotaState: "blocked"`.
///
/// Probing runs child processes and opens sockets, so it happens on a blocking
/// thread rather than on the one serving the UI.
#[tauri::command]
async fn get_provider_overview(
    vault: State<'_, Arc<KeyVault>>,
    quota: State<'_, Arc<QuotaTracker>>,
    engine: State<'_, Arc<StatusEngine>>,
) -> Result<Vec<ProviderOverview>, String> {
    let vault = Arc::clone(&vault);
    let quota = Arc::clone(&quota);
    let engine = Arc::clone(&engine);
    tauri::async_runtime::spawn_blocking(move || {
        providers::overview(&SystemProbe, &vault, &quota, &engine)
    })
    .await
    .map_err(|e| format!("the provider probe did not finish: {e}"))
}

/// Whether the user has opted in to handing the vault's provider keys to
/// OmniRoute (F-SEC-4, W1-24b). Off unless switched on.
#[tauri::command]
async fn get_omniroute_key_sync(store: State<'_, Store>) -> Result<bool, String> {
    Ok(providers::key_sync_enabled(&store).await)
}

/// Record the key-sync choice. Switching it on pushes the keys already in the
/// vault once - if the router counts as online by its last probe - so that the
/// keys typed before the opt-in reach the router without being typed again;
/// otherwise they go with the next saved key. Switching it off sends nothing.
#[tauri::command]
async fn set_omniroute_key_sync(
    store: State<'_, Store>,
    vault: State<'_, Arc<KeyVault>>,
    quota: State<'_, Arc<QuotaTracker>>,
    enabled: bool,
) -> Result<(), String> {
    providers::set_key_sync_enabled(&store, enabled).await?;
    if enabled {
        spawn_consented_key_sync(&store, &vault, &quota);
    }
    Ok(())
}

/// Push the vault to OmniRoute off the UI thread - if, at the moment the
/// worker thread runs, the settings table still holds the user's opt-in.
///
/// The consent is read *inside* the thread, right before the push, and not
/// by the caller: a disable that lands between a save (or an enable) and the
/// thread actually running is then honoured instead of racing it (dual review
/// W1-24b, R-1). Without consent nothing is read from the vault and nothing
/// is sent.
fn spawn_consented_key_sync(store: &Store, vault: &Arc<KeyVault>, quota: &Arc<QuotaTracker>) {
    let store = store.clone();
    let vault = Arc::clone(vault);
    let omni = Arc::clone(quota.omni_route());
    tauri::async_runtime::spawn_blocking(move || {
        let consent = tauri::async_runtime::block_on(providers::KeySync::from_setting(&store));
        providers::sync_keys_to_omniroute(&omni, &vault, consent);
    });
}

/// Store an API key for a provider.
///
/// The key goes into `provider-keys.json` in the app data directory. Only if
/// the user opted in to the key sync (F-SEC-4, off by default) and the local
/// router is up is it handed to OmniRoute as well.
#[tauri::command]
async fn set_provider_key(
    store: State<'_, Store>,
    vault: State<'_, Arc<KeyVault>>,
    quota: State<'_, Arc<QuotaTracker>>,
    provider_id: String,
    key: String,
) -> Result<(), String> {
    vault.set(&provider_id, &key)?;

    // The management token is the one key the running handle needs in its own
    // hand: the usage poller reads it from there, not from the file, so a
    // token typed now has to reach it now rather than at the next start.
    if provider_id == providers::OMNIROUTE_MANAGEMENT {
        quota.omni_route().set_token(Some(&key));
    }

    // Only with the user's consent (F-SEC-4): without it no thread is spawned
    // and nothing is sent. With it, best effort and off the UI thread:
    // OmniRoute not taking the key costs the router a route, not the user
    // their key. The helper checks the consent once more right before the
    // push.
    if providers::key_sync_enabled(&store).await {
        spawn_consented_key_sync(&store, &vault, &quota);
    }
    Ok(())
}

/// Forget a provider's key. Removing one that was never stored is not an error.
#[tauri::command]
fn delete_provider_key(
    vault: State<'_, Arc<KeyVault>>,
    quota: State<'_, Arc<QuotaTracker>>,
    provider_id: String,
) -> Result<(), String> {
    vault.delete(&provider_id)?;
    // Same reasoning as `set_provider_key`: a key that is gone from the file
    // must be gone from the handle too, or the poller keeps using it until the
    // app restarts.
    if provider_id == providers::OMNIROUTE_MANAGEMENT {
        quota.omni_route().set_token(None);
    }
    Ok(())
}

/// Is there a key for this provider? The key itself is never handed back.
#[tauri::command]
fn has_provider_key(vault: State<'_, Arc<KeyVault>>, provider_id: String) -> bool {
    vault.has(&provider_id)
}

/// What is left in OmniRoute's free pools (Phase 19 T5).
///
/// The route is login-gated, so the vault's `omniroute` entry is sent as the
/// bearer. Without one - or with one the router refuses - the answer carries
/// `available: false` and a reason for the user to read, never an invented
/// number; see [`freetier`]. The call is a blocking socket read, so it happens
/// off the thread serving the UI.
#[tauri::command]
async fn get_free_tier_summary(
    vault: State<'_, Arc<KeyVault>>,
    quota: State<'_, Arc<QuotaTracker>>,
) -> Result<freetier::FreeTierSummary, String> {
    let vault = Arc::clone(&vault);
    let omni = Arc::clone(quota.omni_route());
    tauri::async_runtime::spawn_blocking(move || {
        // The dedicated registry entry wins; the T3 management token is the
        // same router login and works as a fallback, so entering the token
        // once is enough for both surfaces.
        let token = vault
            .get(freetier::VAULT_ID)
            .or_else(|| vault.get(providers::OMNIROUTE_MANAGEMENT));
        freetier::fetch(omni.addr(), token.as_deref())
    })
    .await
    .map_err(|e| format!("the free-tier probe did not finish: {e}"))
}

// -- prompt commands (Phase 3.5) -------------------------------------------

/// Rewrite a rough task description into a prompt worth dispatching - or ask
/// back, when the description is too rough to rewrite honestly.
///
/// Returns `{ enhanced, questions }`, exactly one of which carries the answer.
/// `targetProfile` is the agent the prompt is meant for; leaving it out asks
/// for wording that suits any of them.
///
/// `answers` is what makes this a dialogue (Phase 21 P1). Absent, this is the
/// first round and the enhancer may come back with up to
/// [`enhance::MAX_QUESTIONS`] questions; present, it carries the first round's
/// questions with what the person decided, and the prompt is the only
/// permitted answer. There is no third round by construction: a surface that
/// sends answers gets a prompt or an error, never more questions.
///
/// The work is a child process that may take minutes, so it runs on a blocking
/// thread rather than on the one serving the UI.
#[tauri::command]
async fn enhance_prompt(
    app: AppHandle,
    draft: String,
    target_profile: Option<String>,
    answers: Option<Vec<enhance::Answer>>,
) -> Result<EnhanceResult, String> {
    let skill = enhance::bundled_skill_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let ask = match answers.as_deref() {
            // An empty list is a surface that had nothing to send, not a
            // second round; asking again there is still the right answer.
            None | Some([]) => enhance::Ask::Allowed,
            Some(answers) => enhance::Ask::Answered(answers),
        };
        enhance::enhance(&skill, &draft, target_profile.as_deref(), ask)
    })
    .await
    .map_err(|e| format!("the prompt enhancer did not finish: {e}"))?
}

// -- learning commands (Phase 14) ------------------------------------------

/// Every learning of a project, oldest first, whatever its status.
///
/// The frontend filters: the review queue wants the pending ones, the settings
/// view wants to show what was approved, and both would otherwise need a round
/// trip each.
#[tauri::command]
async fn list_learnings(
    store: State<'_, Store>,
    project_id: String,
) -> Result<Vec<Learning>, String> {
    store.list_learnings(Some(&project_id), None).await
}

/// Hand the window the verdict token.
///
/// The token the four review routes of the control API ask for on top of the
/// API token (see [`crate::api::VERDICT_TOKEN_HEADER`]). It is minted at
/// startup and written to no file, so this command and the `--verdict-token`
/// flag of `pa` are the only two ways to it - and this one answers the window,
/// which is the surface that has a human in front of it.
///
/// Without a running control API there is no token, and saying so is more
/// useful than an empty string that would read as a valid one.
#[tauri::command]
fn get_verdict_token(app: AppHandle) -> Result<String, String> {
    app.try_state::<ApiServer>()
        .map(|server| server.verdict_token().to_string())
        .ok_or_else(|| "the control api is not running; there is no verdict token".to_string())
}

/// Approve a pending learning, with whatever text the human settled on.
#[tauri::command]
async fn approve_learning(store: State<'_, Store>, id: String, text: String) -> Result<(), String> {
    learnings::approve_learning(&store, &id, &text).await
}

/// Reject a pending learning. It stays on record, it just never gets injected.
#[tauri::command]
async fn reject_learning(store: State<'_, Store>, id: String) -> Result<(), String> {
    learnings::reject_learning(&store, &id).await
}

/// Run the learning critic over one finished worker by hand.
///
/// The board starts a critic itself when a card reaches `done`; this is for the
/// runs that finished before the feature existed, and for the ones where the
/// user wants to try again. Returns how many learnings were stored - `0` both
/// when the run taught nothing and when this worker already has learnings.
#[tauri::command]
async fn run_learning_critic(
    app: AppHandle,
    store: State<'_, Store>,
    worker_id: String,
) -> Result<usize, String> {
    critic::run_critic(&app, &store, &worker_id).await
}

/// Turn learning on or off for one agent profile.
#[tauri::command]
async fn set_profile_enabled(
    store: State<'_, Store>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    learnings::set_profile_enabled(&store, &id, enabled).await
}

/// Turn learning on or off for one agent category: worker, queen, orchestrator
/// or scout.
#[tauri::command]
async fn set_category_learning(
    store: State<'_, Store>,
    category: String,
    enabled: bool,
) -> Result<(), String> {
    learnings::set_learning_enabled(&store, &category, enabled).await
}

/// The per-category learning switches, one entry per known category.
#[tauri::command]
async fn get_learning_settings(store: State<'_, Store>) -> Result<BTreeMap<String, bool>, String> {
    Ok(learnings::learning_settings(&store).await)
}

// -- question commands (Phase 21) ------------------------------------------

/// The decisions this project is waiting on, and the ones it has made.
///
/// `status` narrows to one of `open`, `answered`, `expired` or `refused`; the
/// tab asks for `open` for its list and for everything when it opens the
/// history underneath.
#[tauri::command]
async fn list_questions(
    store: State<'_, Store>,
    project_id: Option<String>,
    status: Option<String>,
) -> Result<Vec<store::Question>, String> {
    store
        .list_questions(project_id.as_deref(), status.as_deref())
        .await
}

/// Ask a blocking question from the window.
///
/// The window is not the path this feature was built for - `pa ask` is, and
/// it is the one every agent can reach - but the command exists so the
/// preflight dialogue of Phase 21 P1 has somewhere to put its questions
/// without going out over the loopback port.
#[tauri::command]
async fn ask_question(
    store: State<'_, Store>,
    engine: State<'_, Arc<StatusEngine>>,
    project_id: String,
    worker_id: Option<String>,
    question: String,
    options: Option<String>,
) -> Result<store::Question, String> {
    questions::ask(
        &store,
        &engine,
        &project_id,
        worker_id.as_deref(),
        &question,
        options.as_deref(),
    )
    .await
}

/// Answer one open question: into the record, into the worker's log, and into
/// the worker's terminal.
///
/// Recorded as [`store::ANSWERED_BY_HUMAN`]. A Tauri command is reachable only
/// from the window, and the window is a person - the same reason
/// [`approve_learning`] needs no verdict token here while its HTTP route does.
/// The token exists to tell an agent at the API apart from a person, and there
/// is no agent on this path.
#[tauri::command]
async fn answer_question(
    app: AppHandle,
    store: State<'_, Store>,
    manager: State<'_, PtyManager>,
    receiver: State<'_, HookReceiver>,
    engine: State<'_, Arc<StatusEngine>>,
    id: String,
    answer: String,
) -> Result<store::Question, String> {
    let agents = PtyAgents::new(
        &app,
        &manager,
        &receiver,
        store.inner().clone(),
        engine.inner().clone(),
    );
    questions::answer(
        &store,
        &agents,
        &engine,
        &id,
        &answer,
        store::ANSWERED_BY_HUMAN,
    )
    .await
}

// -- role commands (Phase 15) ----------------------------------------------

/// A project's role variants: what is waiting for review and what is in use.
///
/// Rejected variants are left out. They stay on record so the same pattern is
/// not proposed twice, but a rejected role is an answered question, not
/// something the review screen should keep asking about.
#[tauri::command]
async fn list_role_variants(
    store: State<'_, Store>,
    project_id: String,
) -> Result<Vec<RoleVariant>, String> {
    Ok(store
        .list_role_variants(Some(&project_id), None)
        .await?
        .into_iter()
        .filter(|variant| variant.status != store::ROLE_REJECTED)
        .collect())
}

/// Approve a proposed role. From here on it can be spawned.
#[tauri::command]
async fn approve_role_variant(store: State<'_, Store>, id: String) -> Result<(), String> {
    roles::approve_variant(&store, &id).await
}

/// Reject a proposed role. It stays on record, it just never gets spawned.
#[tauri::command]
async fn reject_role_variant(store: State<'_, Store>, id: String) -> Result<(), String> {
    roles::reject_variant(&store, &id).await
}

// -- diff commands (Phase 5) -----------------------------------------------

/// Lets [`diff::add_comment`] reach a running agent.
struct PtyInput<'a> {
    manager: &'a PtyManager,
}

impl AgentInput for PtyInput<'_> {
    fn send(&self, session_id: &str, text: &str) -> Result<(), String> {
        self.manager.write(session_id, text)
    }
}

/// What a worker changed, as a diff against the project's default branch.
///
/// Returns `{ baseBranch, files, stat }`. A worker without a checkout of its
/// own - an orchestrator - fails with `no worktree`; everything git has to say
/// about a repository it cannot read is passed through verbatim.
///
/// The git calls are child processes on a repository that may be large, so they
/// run on a blocking thread rather than on the one serving the UI.
#[tauri::command]
async fn get_worker_diff(store: State<'_, Store>, worker_id: String) -> Result<WorkerDiff, String> {
    let worker = store
        .get_worker(&worker_id)
        .await?
        .ok_or_else(|| format!("unknown worker: {worker_id}"))?;
    let worktree_path = diff::worktree_of(&worker)?.to_string();
    let project = store
        .get_project(&worker.project_id)
        .await?
        .ok_or_else(|| format!("unknown project: {}", worker.project_id))?;

    tauri::async_runtime::spawn_blocking(move || {
        diff::worker_diff(&project.repo_path, &worktree_path)
    })
    .await
    .map_err(|e| format!("reading the diff did not finish: {e}"))?
}

/// Comment on one line of a worker's diff and tell the agent about it.
///
/// The comment is stored either way; `sentToAgent` says whether it also
/// reached the terminal, which it cannot when the agent has exited.
#[tauri::command]
async fn add_diff_comment(
    store: State<'_, Store>,
    manager: State<'_, PtyManager>,
    worker_id: String,
    file: String,
    line: i64,
    body: String,
) -> Result<DiffComment, String> {
    let input = PtyInput { manager: &manager };
    diff::add_comment(&store, &input, &worker_id, &file, line, &body).await
}

#[tauri::command]
async fn list_diff_comments(
    store: State<'_, Store>,
    worker_id: String,
) -> Result<Vec<DiffComment>, String> {
    store.list_diff_comments(&worker_id).await
}

/// Drop a comment the agent has not seen yet; a delivered one stays.
#[tauri::command]
async fn delete_diff_comment(store: State<'_, Store>, id: String) -> Result<(), String> {
    diff::delete_comment(&store, &id).await
}

/// Mark a review comment open or done. Unknown ids and unknown
/// dispositions are errors; this does not invent a third state.
#[tauri::command]
async fn set_diff_comment_disposition(
    store: State<'_, Store>,
    id: String,
    disposition: String,
) -> Result<(), String> {
    store.set_diff_comment_disposition(&id, &disposition).await
}

/// The same blockers the merge path evaluates, for the Review surface.
#[tauri::command]
async fn get_worker_readiness(
    store: State<'_, Store>,
    worker_id: String,
) -> Result<crate::readiness::ReadinessWire, String> {
    workers::worker_readiness(&store, &worker_id).await
}

/// What the Review surface shows before the person trusts the project's setup
/// command: the normalised command, base SHA, inputs hash and the declared
/// input files of the worker's current merge candidate. `None` when the
/// project has no setup command at all.
#[tauri::command]
async fn get_setup_trust_view(
    store: State<'_, Store>,
    worker_id: String,
) -> Result<Option<crate::readiness::SetupTrustWire>, String> {
    workers::setup_trust_view(&store, &worker_id).await
}

/// Grant setup trust for exactly the grant the Review surface showed.
///
/// Desktop-only review authority, like [`set_review_verdict`]: `pa` and the
/// HTTP API can read readiness but can never mint a grant. The core
/// re-computes the grant from the current merge candidate and refuses a stale
/// `expected`, so a click can never trust inputs nobody saw.
/// `seen_tree_oid` is the merge tree of the diff the reviewer was looking
/// at — an approval for a tree nobody read is refused (review-F4-r18).
#[tauri::command]
async fn approve_setup_trust(
    store: State<'_, Store>,
    worker_id: String,
    expected: crate::readiness::TrustGrant,
    seen_tree_oid: String,
) -> Result<crate::readiness::TrustGrant, String> {
    workers::approve_setup_trust(&store, &worker_id, expected, &seen_tree_oid).await
}

/// Store (or with `None`, clear) the shell command that prepares a merge
/// candidate before the test gate runs. Any change voids the stored trust
/// grant, because the grant covers the normalised command.
#[tauri::command]
async fn set_project_setup_command(
    store: State<'_, Store>,
    project_id: String,
    command: Option<String>,
) -> Result<(), String> {
    store
        .set_setup_command(&project_id, command.as_deref())
        .await
}

/// The project's setup command, if one is configured — the settings field
/// shows what is stored, never a placeholder that looks like one.
#[tauri::command]
async fn get_project_setup_command(
    store: State<'_, Store>,
    project_id: String,
) -> Result<Option<String>, String> {
    store.get_setup_command(&project_id).await
}

/// Stamp the human review verdict on a worker: `approved` or
/// `changes_requested`, bound to the merge-tree tuple the review surface was
/// looking at. A click on a stale diff is refused with an order to reload,
/// never bound to code nobody reviewed.
///
/// This command is the desktop half of the review authority - the other half
/// is a request carrying the verdict token. `pa` and the agents can read
/// readiness but can never reach this command, the same way
/// [`approve_learning`] needs no verdict token here while its HTTP route
/// does. A worker or base commit after the verdict makes it stale by itself.
#[tauri::command]
async fn set_review_verdict(
    store: State<'_, Store>,
    worker_id: String,
    decision: String,
    expected: Option<crate::readiness::CodeTuple>,
) -> Result<(), String> {
    let reviewer = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "desktop".to_string());
    workers::record_review_verdict(&store, &worker_id, &decision, &reviewer, expected).await
}

#[tauri::command]
async fn list_worker_messages(
    store: State<'_, Store>,
    worker_id: String,
    limit: Option<usize>,
) -> Result<Vec<Message>, String> {
    store.list_messages(&worker_id, limit).await
}

/// The fleet-wide activity feed, newest first (Phase 16).
///
/// Same default and cap as the API route: the feed is a glance, not a dump.
#[tauri::command]
async fn get_activity(
    store: State<'_, Store>,
    project_id: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<ActivityEntry>, String> {
    store
        .get_activity(
            project_id.as_deref(),
            i64::from(limit.unwrap_or(50).min(200)),
        )
        .await
}

// -- control api (Phase 4) -------------------------------------------------

/// The control API's view of the app.
///
/// Every method here is the body of a Tauri command minus the command: the API
/// and the frontend go through the same functions, so a worker created by the
/// `pa` CLI is indistinguishable from one created by the New Worker dialog.
struct ApiBackend {
    app: AppHandle,
    store: Store,
    engine: Arc<StatusEngine>,
    quota: Arc<QuotaTracker>,
    vault: Arc<KeyVault>,
    hook_port: u16,
}

impl ApiBackend {
    /// One project's repository path, or the "unknown project" error the API
    /// turns into a 404.
    fn repo_path(&self, project_id: &str) -> Result<String, String> {
        tauri::async_runtime::block_on(self.store.get_project(project_id))?
            .map(|project| project.repo_path)
            .ok_or_else(|| format!("{}project: {project_id}", workers::ERR_UNKNOWN))
    }
}

/// F-CORE-3 B.2: `send_to_worker` delivers through the submit guard
/// (`start_task_delivery` - echo after the write baseline, readiness marker
/// from the worker's profile), never as a blind `write("{text}\r")` - the
/// blind write is the second delivery path the audit found, and it lands in a
/// blocking dialog or a busy prompt without anyone noticing.
///
/// AppHandle-free so the delivery is testable against the `AgentControl`
/// seam (the Typist pattern from questions.rs). The log follows the verdict,
/// never the guard start (C-2): `Ok(())` only means the guard thread is
/// running, so the `MSG_USER` turn is written by the outcome callback on
/// `Delivered`. On `Escalated` the undelivered text is persisted as
/// `MSG_SYSTEM` with the concrete next step instead (Auffangnetz) - the
/// conversation log is what the UI replays, and a text that never landed is
/// not a user turn.
fn deliver_to_worker(
    agents: &dyn AgentControl,
    store: &Store,
    worker_id: &str,
    session_id: &str,
    text: &str,
    readiness_marker: Option<&str>,
) -> Result<(), String> {
    let log_store = store.clone();
    let log_worker = worker_id.to_string();
    let log_text = text.to_string();
    let on_outcome: DeliveryCallback = Box::new(move |outcome| {
        let (role, content) = match outcome {
            DeliveryOutcome::Delivered => (crate::store::MSG_USER, log_text),
            DeliveryOutcome::Escalated => (
                crate::store::MSG_SYSTEM,
                format!(
                    "Text wurde nicht zugestellt (submit guard eskaliert): {log_text} — \
                     im Terminal von Worker {log_worker} nachreichen"
                ),
            ),
        };
        workers::log_message(&log_store, &log_worker, role, &content);
    });
    agents.start_task_delivery(
        worker_id,
        session_id,
        text,
        readiness_marker,
        Some(on_outcome),
    )
}

impl ControlBackend for ApiBackend {
    fn agent_evidence(
        &self,
        run: &str,
        owner: &str,
        fence: i64,
        id: &str,
    ) -> Result<Value, String> {
        tauri::async_runtime::block_on(self.store.agent_evidence(run, owner, fence, id))
    }
    fn agent_record_page(
        &self,
        run: &str,
        owner: &str,
        fence: i64,
        collection: &str,
        cursor: Option<&str>,
    ) -> Result<Value, String> {
        tauri::async_runtime::block_on(
            self.store
                .agent_record_page(run, owner, fence, collection, cursor),
        )
    }
    fn agent_run_context(&self, run: &str, owner: &str, fence: i64) -> Result<Value, String> {
        tauri::async_runtime::block_on(self.store.agent_run_context(run, owner, fence))
    }
    fn agent_dispatch_role(
        &self,
        run: &str,
        owner: &str,
        fence: i64,
    ) -> Result<store::development_launches::DispatchRole, String> {
        // Authority first: a credential whose lease moved on plans nothing.
        tauri::async_runtime::block_on(async {
            self.store.agent_run_context(run, owner, fence).await?;
            self.store.development_run_role(run).await
        })
    }
    fn agent_checkpoint_at(
        &self,
        run: &str,
        owner: &str,
        fence: i64,
        revision: i64,
    ) -> Result<Value, String> {
        tauri::async_runtime::block_on(self.store.agent_checkpoint_at(run, owner, fence, revision))
    }
    fn agent_checkpoint(
        &self,
        run: &str,
        owner: &str,
        fence: i64,
        input: store::development_runs::CheckpointInput,
    ) -> Result<Value, String> {
        tauri::async_runtime::block_on(self.store.record_agent_checkpoint(run, owner, fence, input))
    }
    fn agent_bind_candidate(
        &self,
        run: &str,
        owner: &str,
        fence: i64,
        input: api::CandidateInput,
    ) -> Result<Value, String> {
        let result = tauri::async_runtime::block_on(workers::development::bind_candidate(
            &self.store,
            run,
            owner,
            fence,
            input,
        ))?;
        serde_json::to_value(result).map_err(|e| e.to_string())
    }
    fn agent_submit_evidence(
        &self,
        run: &str,
        owner: &str,
        fence: i64,
        input: store::development_runs::EvidenceInput,
    ) -> Result<Value, String> {
        let result = tauri::async_runtime::block_on(
            self.store
                .record_development_evidence(run, owner, fence, input),
        )?;
        serde_json::to_value(result).map_err(|e| e.to_string())
    }
    fn agent_submit_review(
        &self,
        reviewer_run: &str,
        owner: &str,
        fence: i64,
        input: store::development_runs::ReviewInput,
    ) -> Result<Value, String> {
        let result = tauri::async_runtime::block_on(self.store.record_development_review(
            reviewer_run,
            owner,
            fence,
            input,
        ))?;
        serde_json::to_value(result).map_err(|e| e.to_string())
    }
    fn project_exists(&self, project_id: &str) -> Result<bool, String> {
        Ok(tauri::async_runtime::block_on(self.store.get_project(project_id))?.is_some())
    }

    fn continuous_runtime(&self) -> Result<Value, String> {
        // A provider profile is not an attestation that this process can
        // safely launch it. Keep capability truth explicit until those probes
        // exist, and never put a command, argument or environment value on a
        // loopback API response.
        let diagnostics = profiles::profile_diagnostics();
        let profiles_path = diagnostics
            .get("profilesPath")
            .cloned()
            .unwrap_or(Value::Null);
        let warnings = diagnostics
            .get("warnings")
            .cloned()
            .unwrap_or_else(|| json!([]));
        let profiles: Vec<Value> = tauri::async_runtime::block_on(
            learnings::profiles_with_enabled(&self.store),
        )
        .into_iter()
        .map(
            |profile| json!({ "id": profile.id, "name": profile.name, "enabled": profile.enabled }),
        )
        .collect();
        Ok(json!({
            "apiVersion": 1,
            "profilesPath": profiles_path,
            "warnings": warnings,
            "provenance": diagnostics,
            "profiles": profiles,
            "capabilities": {
                "journalChangesWait": {"supported": true, "maxWaitMs": 25000, "maxConcurrentWaits": 8},
                "policyLimitSupervisor": {"supported": true, "startsWorkers": false},
                "teamAssignments": {"supported":true,"approvalAuthority":false},
                "planProjection": {"supported":true,"contractVersion":1,"startsWorkers":false},
                "continuousScheduler": false,
                "launchIntent": false,
                "automaticDelivery": false,
                "runtimeAdaptersAttested": false
            }
        }))
    }

    fn continuous_context(
        &self,
        project_id: &str,
        cursor: i64,
    ) -> Result<store::ContinuousContext, String> {
        tauri::async_runtime::block_on(self.store.continuous_context(project_id, cursor))
    }
    fn continuous_changes(&self, project_id: &str, cursor: i64) -> Result<Value, String> {
        tauri::async_runtime::block_on(self.store.continuous_changes(project_id, cursor))
    }
    fn wait_continuous_changes(
        &self,
        project_id: &str,
        cursor: i64,
        wait_ms: u64,
    ) -> Result<Value, String> {
        tauri::async_runtime::block_on(
            self.store
                .wait_continuous_changes(project_id, cursor, wait_ms),
        )
    }

    fn development_records(&self, project_id: &str) -> Result<Value, String> {
        tauri::async_runtime::block_on(self.store.development_records_snapshot(project_id))
    }

    fn development_plan(
        &self,
        project_id: &str,
        plan_id: &str,
        revision: Option<i64>,
    ) -> Result<Value, String> {
        tauri::async_runtime::block_on(development_plan_access::read(
            &self.store,
            project_id,
            plan_id,
            revision,
        ))
    }

    fn import_development_plan(
        &self,
        project_id: &str,
        plan_id: &str,
        expected_projection_revision: i64,
        rollback_reason: Option<&str>,
    ) -> Result<Value, String> {
        tauri::async_runtime::block_on(development_plan_access::import(
            &self.store,
            project_id,
            plan_id,
            expected_projection_revision,
            rollback_reason,
        ))
    }

    fn list_continuous_goals(
        &self,
        project_id: &str,
    ) -> Result<Vec<store::ContinuousGoal>, String> {
        tauri::async_runtime::block_on(self.store.list_continuous_goals(project_id))
    }

    fn create_continuous_goal(
        &self,
        project_id: &str,
        objective: &str,
        acceptance_criteria: Option<String>,
        source_goal_id: Option<String>,
        admit: bool,
    ) -> Result<store::ContinuousGoal, String> {
        tauri::async_runtime::block_on(self.store.create_continuous_goal(
            project_id,
            objective,
            acceptance_criteria,
            source_goal_id,
            admit,
        ))
    }

    fn create_continuous_task(
        &self,
        goal_id: &str,
        objective: &str,
        profile_id: Option<String>,
        owned_paths: Vec<String>,
        dependencies: Vec<String>,
    ) -> Result<store::ContinuousTask, String> {
        tauri::async_runtime::block_on(self.store.create_continuous_task(
            goal_id,
            objective,
            profile_id,
            owned_paths,
            dependencies,
        ))
    }

    fn assign_continuous_task(
        &self,
        task_id: &str,
        request: store::team_assignments::AssignmentRequest,
    ) -> Result<store::team_assignments::TeamAssignment, String> {
        tauri::async_runtime::block_on(self.store.assign_continuous_task(task_id, request))
    }
    fn continuous_task_assignment(
        &self,
        task_id: &str,
    ) -> Result<Option<store::team_assignments::TeamAssignment>, String> {
        tauri::async_runtime::block_on(self.store.continuous_task_assignment(task_id))
    }
    fn claim_continuous_task(
        &self,
        task_id: &str,
        owner: &str,
        escalation: bool,
    ) -> Result<store::ContinuousClaim, String> {
        tauri::async_runtime::block_on(self.store.claim_continuous_task(task_id, owner, escalation))
    }

    fn checkpoint_continuous_task(
        &self,
        task_id: &str,
        owner: &str,
        fence: i64,
        status: Option<String>,
        detail: Option<String>,
    ) -> Result<store::ContinuousTask, String> {
        tauri::async_runtime::block_on(self.store.checkpoint_continuous_task(
            task_id,
            owner,
            fence,
            status.as_deref(),
            detail.as_deref(),
        ))
    }

    fn control_continuous(
        &self,
        project_id: &str,
        action: &str,
    ) -> Result<store::ContinuousControl, String> {
        tauri::async_runtime::block_on(self.store.control_continuous(project_id, action))
    }

    fn create_worker(
        &self,
        project_id: &str,
        task: &str,
        profile_id: &str,
        spawned_by: Option<String>,
    ) -> Result<Worker, String> {
        let manager = self.app.state::<PtyManager>();
        let agents = PtyAgents::with_port(
            &self.app,
            &manager,
            self.hook_port,
            self.store.clone(),
            Arc::clone(&self.engine),
        );
        let worker = tauri::async_runtime::block_on(workers::create_worker(
            &self.store,
            &agents,
            project_id,
            task,
            profile_id,
            spawned_by.as_deref(),
        ))?;
        self.engine.observe_worker(&worker);
        Ok(worker)
    }

    fn create_queen(
        &self,
        _project_id: &str,
        _task: &str,
        _profile_id: Option<String>,
        _spawned_by: Option<String>,
    ) -> Result<Worker, String> {
        Err(workers::ERR_QUEEN_RETIRED.to_string())
    }

    fn list_workers(&self, project_id: Option<&str>) -> Result<Vec<Worker>, String> {
        tauri::async_runtime::block_on(self.store.list_workers(project_id))
    }

    fn worker_state(&self, worker_id: &str) -> Result<Option<WorkerBoardState>, String> {
        let Some(worker) = tauri::async_runtime::block_on(self.store.get_worker(worker_id))? else {
            return Ok(None);
        };
        Ok(self.engine.board(&[worker]).into_iter().next())
    }

    fn send_to_worker(&self, worker_id: &str, text: &str) -> Result<(), String> {
        let session_id = self
            .store
            .session_for_worker(worker_id)
            .ok_or_else(|| format!("worker {worker_id} has no running agent"))?;
        // Guarded delivery, not a blind write (F-CORE-3 B.2). The readiness
        // marker comes from the worker's profile (OpenCode: "Ask anything"),
        // the same source the question answers and the orchestrator use.
        // A failed read must travel: without a marker the guard falls back to
        // the silence heuristic, so a database hiccup would look like a
        // profile that simply has none and type into a busy prompt.
        let readiness_marker = tauri::async_runtime::block_on(self.store.get_worker(worker_id))?
            .and_then(|worker| profiles::find_profile(&worker.profile_id))
            .and_then(|profile| profile.caps.readiness_marker);
        let manager = self.app.state::<PtyManager>();
        let agents = PtyAgents::with_port(
            &self.app,
            &manager,
            self.hook_port,
            self.store.clone(),
            Arc::clone(&self.engine),
        );
        deliver_to_worker(
            &agents,
            &self.store,
            worker_id,
            &session_id,
            text,
            readiness_marker.as_deref(),
        )
    }

    fn send_to_orchestrator(&self, project_id: &str, text: &str) -> Result<Worker, String> {
        let manager = self.app.state::<PtyManager>();
        let agents = PtyAgents::with_port(
            &self.app,
            &manager,
            self.hook_port,
            self.store.clone(),
            Arc::clone(&self.engine),
        );
        let worker = tauri::async_runtime::block_on(workers::send_to_orchestrator(
            &self.store,
            &agents,
            project_id,
            text,
        ))?;
        self.engine.observe_worker(&worker);
        Ok(worker)
    }

    fn board(&self, project_id: Option<&str>) -> Result<Vec<WorkerBoardState>, String> {
        let workers = tauri::async_runtime::block_on(self.store.list_workers(project_id))?;
        Ok(self.engine.board(&workers))
    }

    fn quota(&self) -> Result<Vec<QuotaStateRow>, String> {
        let profile_ids: Vec<String> = profiles::load_profiles()
            .into_iter()
            .map(|profile| profile.id)
            .collect();
        Ok(self.quota.snapshot(&profile_ids))
    }

    fn providers(&self) -> Result<Vec<ProviderOverview>, String> {
        Ok(providers::overview(
            &SystemProbe,
            &self.vault,
            &self.quota,
            &self.engine,
        ))
    }

    fn usage(&self, limit: u32) -> Result<UsageReport, String> {
        let omni = Arc::clone(self.quota.omni_route());
        let store = self.store.clone();
        tauri::async_runtime::block_on(async move {
            omniroute::usage_report(&omni, &store, limit, now_unix_secs()).await
        })
    }

    fn list_digests(&self, project_id: &str) -> Result<Vec<String>, String> {
        Ok(digest::list_digests(&self.repo_path(project_id)?))
    }

    fn read_digest(&self, project_id: &str, date: &str) -> Result<Option<String>, String> {
        Ok(digest::read_digest(&self.repo_path(project_id)?, date))
    }

    fn project_stats(
        &self,
        project_id: &str,
        range: stats::StatsRange,
    ) -> Result<stats::ProjectStats, String> {
        tauri::async_runtime::block_on(stats::project_stats(
            &self.store,
            &self.engine,
            project_id,
            range,
            now_unix_secs(),
        ))
    }

    fn list_budgets(&self) -> Result<Vec<budget::BudgetLimits>, String> {
        tauri::async_runtime::block_on(budget::list_limits(&self.store))
    }

    fn set_budget(
        &self,
        profile_id: &str,
        five_hour_pct: Option<Option<u8>>,
        seven_day_pct: Option<Option<u8>>,
    ) -> Result<budget::BudgetLimits, String> {
        tauri::async_runtime::block_on(budget::update_limits(
            &self.store,
            profile_id,
            five_hour_pct,
            seven_day_pct,
        ))
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
        tauri::async_runtime::block_on(queue::enqueue(
            self.app.clone(),
            self.store.clone(),
            project_id.to_string(),
            raw_text.to_string(),
            profile_id,
            sharpen,
            priority,
            spawned_by,
        ))
    }

    fn list_queue(&self, project_id: Option<&str>) -> Result<Vec<QueueEntry>, String> {
        tauri::async_runtime::block_on(self.store.list_queue(project_id))
    }

    fn cancel_queued_task(&self, id: &str) -> Result<(), String> {
        tauri::async_runtime::block_on(self.store.cancel_queue_entry(id))
    }

    fn create_scout(&self, project_id: &str) -> Result<Worker, String> {
        let manager = self.app.state::<PtyManager>();
        let agents = PtyAgents::with_port(
            &self.app,
            &manager,
            self.hook_port,
            self.store.clone(),
            Arc::clone(&self.engine),
        );
        // A scout is started by the UI or by a human at the API, never by a
        // coordinator, so there is nobody to book it under.
        let worker = tauri::async_runtime::block_on(scout::create_scout(
            &self.store,
            &agents,
            project_id,
            None,
        ))?;
        self.engine.observe_worker(&worker);
        Ok(worker)
    }

    fn triage_repos(&self, project_id: &str, urls: &[String]) -> Result<Worker, String> {
        let manager = self.app.state::<PtyManager>();
        let agents = PtyAgents::with_port(
            &self.app,
            &manager,
            self.hook_port,
            self.store.clone(),
            Arc::clone(&self.engine),
        );
        // Same as `create_scout`: triage is ordered by a human, not by a
        // coordinator, so there is no spawner to record.
        let worker = tauri::async_runtime::block_on(scout::triage_repos(
            &self.store,
            &agents,
            project_id,
            urls,
            None,
        ))?;
        self.engine.observe_worker(&worker);
        Ok(worker)
    }

    fn list_recommendations(
        &self,
        project_id: Option<&str>,
    ) -> Result<Vec<Recommendation>, String> {
        tauri::async_runtime::block_on(scout::list_recommendations(&self.store, project_id))
    }

    fn add_recommendation(
        &self,
        project_id: &str,
        title: &str,
        rationale: &str,
        url: Option<String>,
        effort: Option<String>,
    ) -> Result<Recommendation, String> {
        tauri::async_runtime::block_on(scout::add_recommendation(
            &self.store,
            project_id,
            title,
            rationale,
            url,
            effort,
        ))
    }

    fn set_recommendation_status(&self, id: &str, status: &str) -> Result<(), String> {
        tauri::async_runtime::block_on(scout::set_recommendation_status(&self.store, id, status))
    }

    fn accept_recommendation(&self, id: &str) -> Result<QueueEntry, String> {
        tauri::async_runtime::block_on(scout::accept_recommendation(&self.store, id))
    }

    fn list_learnings(
        &self,
        project_id: Option<&str>,
        status: Option<&str>,
    ) -> Result<Vec<Learning>, String> {
        tauri::async_runtime::block_on(self.store.list_learnings(project_id, status))
    }

    fn approve_learning(&self, id: &str, text: &str) -> Result<(), String> {
        tauri::async_runtime::block_on(learnings::approve_learning(&self.store, id, text))
    }

    fn reject_learning(&self, id: &str) -> Result<(), String> {
        tauri::async_runtime::block_on(learnings::reject_learning(&self.store, id))
    }

    // -- questions (Phase 21) ----------------------------------------------

    fn ask_question(
        &self,
        project_id: &str,
        worker_id: Option<&str>,
        question: &str,
        options: Option<&str>,
    ) -> Result<store::Question, String> {
        tauri::async_runtime::block_on(questions::ask(
            &self.store,
            &self.engine,
            project_id,
            worker_id,
            question,
            options,
        ))
    }

    fn answer_question(
        &self,
        id: &str,
        answer: &str,
        answered_by: &str,
    ) -> Result<store::Question, String> {
        let manager = self.app.state::<PtyManager>();
        let agents = PtyAgents::with_port(
            &self.app,
            &manager,
            self.hook_port,
            self.store.clone(),
            Arc::clone(&self.engine),
        );
        tauri::async_runtime::block_on(questions::answer(
            &self.store,
            &agents,
            &self.engine,
            id,
            answer,
            answered_by,
        ))
    }

    fn list_questions(
        &self,
        project_id: Option<&str>,
        status: Option<&str>,
    ) -> Result<Vec<store::Question>, String> {
        tauri::async_runtime::block_on(self.store.list_questions(project_id, status))
    }

    fn list_role_variants(
        &self,
        project_id: Option<&str>,
        status: Option<&str>,
    ) -> Result<Vec<RoleVariant>, String> {
        tauri::async_runtime::block_on(self.store.list_role_variants(project_id, status))
    }

    fn approve_role_variant(&self, id: &str) -> Result<(), String> {
        tauri::async_runtime::block_on(roles::approve_variant(&self.store, id))
    }

    fn reject_role_variant(&self, id: &str) -> Result<(), String> {
        tauri::async_runtime::block_on(roles::reject_variant(&self.store, id))
    }

    fn get_activity(
        &self,
        project_id: Option<&str>,
        limit: u32,
    ) -> Result<Vec<ActivityEntry>, String> {
        tauri::async_runtime::block_on(self.store.get_activity(project_id, i64::from(limit)))
    }

    fn list_worker_messages(
        &self,
        worker_id: &str,
        limit: Option<usize>,
    ) -> Result<Vec<Message>, String> {
        tauri::async_runtime::block_on(self.store.list_messages(worker_id, limit))
    }

    fn list_projects(&self) -> Result<Vec<ProjectOverview>, String> {
        let projects = tauri::async_runtime::block_on(self.store.list_projects())?;
        // This runs on the connection's thread, which is blocking anyway.
        Ok(projects.into_iter().map(with_github_flag).collect())
    }

    fn create_project(&self, name: &str, repo_path: &str) -> Result<ProjectOverview, String> {
        // Same two steps as the IPC command: refuse a path that is not a git
        // work tree, then insert. The connection thread is already blocking.
        worktree::ensure_git_repo(repo_path)?;
        let project = tauri::async_runtime::block_on(self.store.create_project(name, repo_path))?;
        Ok(with_github_flag(project))
    }

    fn create_github_repo(
        &self,
        project_id: &str,
        name: &str,
        private: bool,
    ) -> Result<String, String> {
        let project = tauri::async_runtime::block_on(self.store.get_project(project_id))?
            .ok_or_else(|| format!("{}project: {project_id}", workers::ERR_UNKNOWN))?;
        gh::create_github_repo(&project.repo_path, name, private)
    }

    fn link_github_remote(&self, project_id: &str, url: &str) -> Result<(), String> {
        let project = tauri::async_runtime::block_on(self.store.get_project(project_id))?
            .ok_or_else(|| format!("{}project: {project_id}", workers::ERR_UNKNOWN))?;
        gh::link_github_remote(&project.repo_path, url)
    }

    fn merge_worker(&self, worker_id: &str, remove_worktree: bool) -> Result<Worker, String> {
        let manager = self.app.state::<PtyManager>();
        let agents = PtyAgents::with_port(
            &self.app,
            &manager,
            self.hook_port,
            self.store.clone(),
            Arc::clone(&self.engine),
        );
        tauri::async_runtime::block_on(workers::merge_worker(
            &self.store,
            &agents,
            &self.engine,
            worker_id,
            remove_worktree,
        ))
    }

    fn get_landing_page(&self, project_id: &str) -> Result<Option<String>, String> {
        tauri::async_runtime::block_on(self.store.get_landing_page(project_id))
    }

    fn set_landing_page(&self, project_id: &str, markdown: Option<&str>) -> Result<(), String> {
        tauri::async_runtime::block_on(self.store.set_landing_page(project_id, markdown))
    }
}

/// Isolated F8 / scratch runs: the directory that would otherwise be
/// `%APPDATA%\com.projecta.app`. Empty means "use Tauri's default".
const ENV_APP_DATA: &str = "PROJECTA_APP_DATA";

/// Where the database and the API descriptor live.
///
/// `PROJECTA_APP_DATA` wins so a packaged proof can use a throwaway directory
/// instead of the production queue. The single-instance mutex still uses the
/// bundle id — do not run a proof while a production window is open.
fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = resolve_app_data_dir(
        app.path()
            .app_data_dir()
            .map_err(|e| format!("no app data directory: {e}"))?,
    );
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn resolve_app_data_dir(tauri_dir: PathBuf) -> PathBuf {
    match std::env::var_os(ENV_APP_DATA) {
        Some(path) if !path.is_empty() => PathBuf::from(path),
        _ => tauri_dir,
    }
}

/// Open the database and teach the PTY layer to record agent exits.
fn init_store(_app: &AppHandle, dir: &Path) -> Result<Store, String> {
    tauri::async_runtime::block_on(Store::open(&dir.join("projecta.db")))
}

/// Install the hook that runs when an agent's terminal ends.
///
/// It does two things, in this order and for a reason. The exit note is taken
/// first, while the session is still bound and the board still says what the
/// agent was doing: [`Store::mark_session_exited`] unbinds the session and
/// flips the row to `exited`, which would erase both. Recording the exit comes
/// second, and happens whatever the note decided - it also closes the session's
/// row in `sessions` with the code the child reported, which is where
/// [`crate::stats`] later reads how a run ended.
///
/// Separate from [`init_store`] because it needs the status engine, and the
/// engine needs the store - there is exactly one order in which the three can
/// be built.
/// Exit-hook invocations whose async half is still running. The app-exit
/// path waits for this to reach zero (bounded), so the record a hook
/// writes - the closed session row, the flipped worker - actually lands
/// before the process dies.
static EXIT_HOOKS_IN_FLIGHT: AtomicUsize = AtomicUsize::new(0);

/// How long app exit gives the reaper threads to collect the killed
/// children, and the exit hooks on top of that to finish their writes.
const EXIT_REAPER_GRACE: Duration = Duration::from_millis(1500);
const EXIT_HOOK_GRACE: Duration = Duration::from_millis(500);

fn persist_live_sessions(store: &Store, manager: &PtyManager, reason: &str) {
    let sessions = match manager.live_session_ids() {
        Ok(sessions) => sessions,
        Err(error) => {
            eprintln!("projecta: cannot inventory sessions for persistence: {error}");
            return;
        }
    };
    for session_id in sessions {
        let Some(worker_id) = store.worker_for_session(&session_id) else {
            continue;
        };
        let Ok(body) = manager.scrollback(&session_id) else {
            // A reserved/starting entry has no terminal buffer to persist.
            continue;
        };
        crate::sessionpersist::persist_end(&worker_id, &session_id, &body, reason);
    }
}

fn init_exit_hook(app: &AppHandle, store: &Store, engine: &Arc<StatusEngine>) {
    let hook_store = store.clone();
    let hook_engine = Arc::clone(engine);
    let hook_app = app.clone();
    app.state::<PtyManager>()
        .set_exit_hook(move |session_id, code| {
            let store = hook_store.clone();
            let engine = Arc::clone(&hook_engine);
            let app = hook_app.clone();
            let session_id = session_id.to_string();
            let development_worker = store.worker_for_session(&session_id);
            // Persist while the session is still bound and the ring buffer
            // still exists. mark_session_exited unbinds; the reaper then
            // drops the session.
            if let Some(worker_id) = store.worker_for_session(&session_id) {
                let body = app
                    .state::<PtyManager>()
                    .scrollback(&session_id)
                    .unwrap_or_default();
                crate::sessionpersist::persist_end(
                    &worker_id,
                    &session_id,
                    &body,
                    crate::sessionpersist::CONFIRMED_AGENT_EXITED,
                );
            }
            EXIT_HOOKS_IN_FLIGHT.fetch_add(1, Ordering::Relaxed);
            // Runs on the dedicated native reaper, never the UI/PTY reader.
            // Returning success is the acknowledgement that releases inventory.
            let completed = tauri::async_runtime::block_on(async move {
                let persistence = async {
                    if let Some(worker_id) = development_worker {
                        store
                            .record_development_process_exit(&worker_id, &session_id, code)
                            .await
                    } else {
                        Ok(None)
                    }
                };
                let issuer = app
                    .try_state::<api::ApiServer>()
                    .map(|api| api.run_credential_issuer());
                let result = if let Some(issuer) = issuer {
                    issuer.observe_exit(&session_id, persistence).await
                } else {
                    persistence.await
                };
                let mut errors = Vec::new();
                if let Err(error) = result {
                    eprintln!("projecta: reconcile exited run credentials/state: {error}");
                    errors.push(error);
                }
                stuck::note_exit(&store, &engine, &session_id).await;
                if let Err(err) = store.mark_session_exited(&session_id, code).await {
                    eprintln!("projecta: {err}");
                    errors.push(err);
                }
                if errors.is_empty() {
                    Ok(())
                } else {
                    Err(errors.join("; "))
                }
            });
            EXIT_HOOKS_IN_FLIGHT.fetch_sub(1, Ordering::Relaxed);
            completed
        });
}

/// Writes quota changes through to the `agent_quota` table.
///
/// The tracker is fed from the PTY reader thread, so the write is handed to the
/// async runtime rather than blocked on: a slow disk must never stall the
/// terminal, and a failed write only costs this one observation.
struct StoreQuotaSink {
    store: Store,
}

impl QuotaSink for StoreQuotaSink {
    fn persist(&self, quota: AgentQuota) {
        let store = self.store.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(err) = store.set_agent_quota(&quota).await {
                eprintln!("projecta: {err}");
            }
        });
    }
}

/// Bring up the quota tracker: probe OmniRoute in the background, restore what
/// the last session knew, and feed the status engine's findings back to disk.
fn init_quota(store: &Store, engine: &Arc<StatusEngine>) -> Arc<QuotaTracker> {
    let omni = Arc::new(OmniRoute::default());
    omniroute::start(Arc::clone(&omni));

    let quota = Arc::new(QuotaTracker::new(omni));
    match tauri::async_runtime::block_on(store.list_agent_quota()) {
        Ok(rows) => quota.hydrate(rows),
        // A profile wrongly believed to be available is a far smaller problem
        // than an app that will not start.
        Err(err) => eprintln!("projecta: {err}"),
    }
    quota.set_sink(Arc::new(StoreQuotaSink {
        store: store.clone(),
    }));
    engine.set_quota_tracker(Arc::clone(&quota));
    quota
}

/// Publishes column changes to the frontend as `worker:status`.
struct EventSink {
    app: AppHandle,
}

impl StatusSink for EventSink {
    fn publish(&self, payload: StatusPayload) {
        let _ = self.app.emit("worker:status", payload);
    }
}

/// Wire the status engine up to everything that feeds it.
///
/// Every piece here is optional by design. A hook receiver that cannot bind, a
/// machine without `gh`, a repository without a GitHub remote: each just means
/// one fewer source, never a startup failure.
fn init_status(app: &AppHandle, store: &Store) -> Arc<StatusEngine> {
    let engine = Arc::new(StatusEngine::default());
    engine.set_sink(Arc::new(EventSink { app: app.clone() }));
    // The engine starts the test gate itself when a card reaches review, which
    // is the one thing it needs the database for.
    engine.set_store(store.clone());
    // The learning critic needs one thing the gate does not: the handle that
    // finds the bundled skill inside the installed resources.
    engine.set_app(app.clone());
    // Output classification reads each profile's dialect, not compiled-in
    // per-agent constants.
    engine.set_dialects(
        profiles::load_profiles()
            .into_iter()
            .map(|p| (p.id, p.caps.dialect))
            .collect(),
    );

    // Terminal output feeds the heuristics. The PTY layer knows sessions, not
    // workers, so the mapping is resolved here.
    let output_store = store.clone();
    let output_engine = Arc::clone(&engine);
    app.state::<PtyManager>()
        .set_output_hook(move |session_id, chunk| {
            if let Some(worker_id) = output_store.worker_for_session(session_id) {
                output_engine.note_output(&worker_id, chunk);
            }
        });

    // Nothing arriving is a signal too, so the idle timer needs its own beat.
    let tick_engine = Arc::clone(&engine);
    std::thread::spawn(move || loop {
        std::thread::sleep(IDLE_TICK);
        tick_engine.tick();
    });

    // A question nobody answered is answered by the clock. The deadline is
    // four hours out, so a minute between sweeps is as precise as this needs
    // to be - and the answer has to reach the agent's terminal, because
    // `pa ask` does not block and the agent ended its turn waiting for it.
    let sweep_app = app.clone();
    let sweep_store = store.clone();
    let sweep_engine = Arc::clone(&engine);
    std::thread::spawn(move || {
        let agents = PtyWriter { app: sweep_app };
        loop {
            std::thread::sleep(QUESTION_SWEEP_INTERVAL);
            let expired = tauri::async_runtime::block_on(questions::expire_due(
                &sweep_store,
                &agents,
                &sweep_engine,
                now_unix_secs(),
            ));
            if let Err(err) = expired {
                eprintln!("projecta: {err}");
            }
        }
    });

    gh::start(store.clone(), Arc::clone(&engine));
    engine
}

fn main() {
    let builder = tauri::Builder::default();

    // The guard goes on *first*, before every other plugin and long before the
    // setup closure. Plugins are initialised in registration order at the end
    // of `Builder::build`, and the setup closure only runs later, on the
    // runtime's `Ready` event - after Tauri has already built the `main`
    // window from the config. So a guard registered anywhere else lets the
    // redundant process paint a second ProjectA window and bring up a second
    // WebView2 on the same profile directory before it notices it is
    // redundant. Registered here it never gets that far: it hands its argv to
    // the running instance over `WM_COPYDATA` and exits before `app_data_dir`,
    // before the database, before `api::start` rewrites `projecta-api.json`,
    // and before the dispatcher and the reattach pass take the first sweep.
    //
    // Why this does not break the updater relaunch - the one case where a
    // second process is legitimate. Both relaunch paths hand the successor a
    // machine with no guard left standing:
    //
    // * `plugin:process|restart` (the "restart to apply" button) reaches
    //   `AppHandle::request_restart`, which requests an exit through the event
    //   loop. Tauri dispatches `RunEvent::Exit` to the plugins *before* the
    //   run handler below and before it spawns the successor, and this
    //   plugin's own exit hook releases the mutex and destroys its hidden
    //   window there. The successor starts into a clean machine.
    // * The Windows installer path (`downloadAndInstall`) ends in a hard
    //   `std::process::exit` inside the updater, and the NSIS `/UPDATE` run
    //   waits for that process to be gone before it relaunches the app. A
    //   terminated process owns no mutex and no window.
    //
    // And if a mutex ever did outlive its process, the plugin still fails
    // *open*: it only stands the second instance down when it also finds the
    // running instance's hidden window. That is exactly the property a
    // hand-rolled lock file would not have, which is why there is none here.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        // Someone started ProjectA again; what they want is the window they
        // already have. Raising it is the *whole* body of this callback: the
        // descriptor, the dispatcher, the ingest and the reattach fleet all
        // belong to the instance running here, and the second process must not
        // reach into any of them. It cannot: it is already on its way out.
        //
        // `unminimize` is the `SW_RESTORE` that brings the window back out of
        // the taskbar, `show` covers the window having been hidden rather than
        // minimized, and `set_focus` raises it over whatever was in front. Each
        // step is best effort - on a window that is already up they are no-ops,
        // and a window manager refusing to raise is not a reason to leave a
        // second fleet running.
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        // Only this process can write it down. The one that was turned away
        // exits inside plugin initialisation, long before `logging::init`, so
        // without this line a two-process run leaves no record at all - and the
        // packaged two-process check is a manual one that needs an artefact.
        crate::logf!("app", "second instance turned away; raised the main window");
    }));

    builder
        .plugin(tauri_plugin_process::init())
        // P2-J (02.09.2026): `openExternal` in ipc.ts called this plugin for
        // weeks without it being registered - every call failed silently and
        // fell back to `window.open`, which WebView2 does not honour reliably.
        // The permission with its http(s) scope lives in capabilities/default.json;
        // src/opener-config.test.ts holds crate, registration and scope together.
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PtyManager::default())
        // The web interface starts on demand; its state only exists so the
        // frontend can ask for status or stop it later.
        .manage(Mutex::new(WebInterfaceState::default()))
        .setup(|app| {
            let handle = app.handle().clone();
            let dir = app_data_dir(&handle)?;
            // First with the dir: file logging and the panic hook, so a crash
            // during setup is already on record. A marker from a previous
            // panic is rotated aside here and surfaces in the diagnosis pack.
            // A log directory that cannot be created must not keep the app
            // from starting: `logging::log` falls back to stderr on its own
            // (Review P2-C, Gemini-4). Since W1-22 this registers
            // tauri-plugin-log here rather than on the builder: its file
            // lives under `dir`, which exists only now.
            match logging::init(&handle, &dir) {
                Ok(log_path) => crate::logf!("app", "log file: {}", log_path.display()),
                Err(err) => eprintln!("projecta: file logging unavailable, stderr only: {err}"),
            }
            logging::install_panic_hook(dir.clone());
            crate::sessionpersist::set_root(dir.clone());
            routing::record_review_probe(400, r#"{"error":"unknown combo"}"#, None);
            // Both marker generations are read *before* rotation: take_panic_notice
            // deletes the older previous as it moves .panic-last aside. The
            // visible notice in the window is P2-H; the log line remains so a
            // release build without the tab still has a record.
            let (panic_current, panic_previous) = logging::read_panic_markers(&dir);
            if let Some(notice) = logging::take_panic_notice(&dir) {
                crate::logf!("app", "previous run crashed: {notice}");
                eprintln!("projecta: previous run crashed: {notice}");
            }
            let panic_notice = PanicNotice {
                current: panic_current,
                previous: panic_previous,
            };
            // Before anything can spawn: the authoritative playbooks live
            // beside the database and the key vault, out of reach of the
            // agents that run with the repository as their working directory.
            // Without this every injection would be empty and every approve
            // would fail, which is why it is the first thing done with `dir`.
            learnings::set_data_dir(&dir);
            let store = init_store(&handle, &dir)?;
            // W2-06: committed supervisor changes reach the window as runtime
            // notifications; the payload holds ids and reason codes only.
            let notice_app = handle.clone();
            let notifier: store::supervisor::Notifier = Arc::new(move |notice| {
                let _ = notice_app.emit("supervisor:notification", notice);
            });
            let policy_supervisor = tauri::async_runtime::block_on(store::supervisor::start(store.clone(), Some(notifier)));
            app.manage(policy_supervisor);
            let engine = init_status(&handle, &store);
            init_exit_hook(&handle, &store, &engine);
            let quota = init_quota(&store, &engine);

            // The role distiller runs the same way the learning critic does:
            // headless, through a bundled skill the handle knows how to find.
            roles::set_app(handle.clone());

            // The API keys live beside the database. Nothing is read here: the
            // vault is a file, and every call reads what is actually in it.
            let vault = Arc::new(KeyVault::new(&dir));

            // The usage ledger (Phase 19 T3). The management token is a vault
            // key like any other, so it is read here and not from the
            // environment; a machine without one keeps exactly the behaviour
            // it had before this thread existed - see `omniroute::login`.
            quota
                .omni_route()
                .set_token(vault.get(providers::OMNIROUTE_MANAGEMENT).as_deref());
            omniroute::start_usage_poll(Arc::clone(quota.omni_route()), store.clone());

            // Agents report their own lifecycle to this port; without it the
            // board falls back to the output heuristics alone.
            let receiver = hooks::start(Arc::clone(&engine), Some(store.clone())).unwrap_or_else(|err| {
                eprintln!("projecta: {err}");
                HookReceiver::disabled()
            });
            if !receiver.is_enabled() {
                eprintln!("projecta: agent status hooks are off; the board will rely on the terminal heuristics alone");
            }

            // The control API is what makes the app scriptable. A port that
            // will not bind costs the `pa` CLI and the orchestrators, not the
            // window, so it is reported and stepped over.
            let backend = Arc::new(ApiBackend {
                app: handle.clone(),
                store: store.clone(),
                engine: Arc::clone(&engine),
                quota: Arc::clone(&quota),
                vault: Arc::clone(&vault),
                hook_port: receiver.port(),
            });
            match api::start(backend, &dir) {
                Ok(server) => {
                    println!(
                        "projecta: control api on 127.0.0.1:{} ({})",
                        server.port(),
                        server.descriptor_path().display()
                    );
                    app.manage(server);
                }
                Err(err) => eprintln!("projecta: {err}; the pa CLI will not be able to connect"),
            }

            // The queue dispatcher starts on the reattach thread below, once
            // the claims the last process left behind are resolved (KI-23).

            // The budget watcher needs the quota tracker `init_quota` just
            // built, so it starts after it. The dispatcher's skip list is the
            // whole point of writing a block; the dispatcher reads it on every
            // sweep, so starting a little later changes nothing here. Its own agent
            // control exists only to stop sessions; it never spawns one.
            budget::start(
                store.clone(),
                Arc::clone(&engine),
                Arc::clone(&quota),
                Box::new(AppAgentControl {
                    app: handle.clone(),
                    hook_port: receiver.port(),
                }),
            );

            // The git probe behind the stuck diagnosis: the second channel the
            // board watches beside the terminal. Same shape, same beat, and it
            // only ever reads.
            stuck::start(store.clone(), Arc::clone(&engine));

            // One Markdown page per project per day, into the vault under
            // `.pa/`. Hourly, and it writes the day that is already over -
            // see the module documentation for why not today's.
            digest::start(store.clone(), Arc::clone(&engine), Arc::clone(&quota));

            // The retention sweep (Phase 1.5): once at startup, then daily.
            // Its archive lives in the app data directory, out of the
            // agents' reach - never in the repository.
            retention::start(store.clone(), dir.join("archive"));


            // Scouts write their findings to a file in the repository root;
            // this is the loop that reads them back in. Cheap and restartable:
            // ingest is idempotent, so a missed pass costs nothing.
            scout::start(store.clone());

            // After a restart every worker is sessionless. A PTY does not
            // survive the process, so running rows wait for an explicit respawn
            // rather than coming back as if they were still live. Coordinators
            // are deliberately left for the user to open by hand.
            let reattach_store = store.clone();
            let dispatcher_handle = handle.clone();
            let dispatcher_quota = Arc::clone(&quota);
            let dispatcher_engine = Arc::clone(&engine);
            let dispatcher_port = receiver.port();
            thread::spawn(move || {
                tauri::async_runtime::block_on(async {
                    // A test gate may run for ten minutes, and closing the
                    // window during one leaves `running` in the database with
                    // no process behind it - which the automatic trigger reads
                    // as "a run is already in flight", so that worker is never
                    // gated again and its merge stays refused. Nothing is
                    // running yet at this point, so every such flag is stale.
                    if let Err(error) = reattach_store.reconcile_interrupted_development_launches().await {
                        eprintln!("projecta: continuous launch reconciliation unavailable: {error}");
                    }
                    match testgate::clear_stale_test_runs(&reattach_store).await {
                        Ok(0) => {}
                        Ok(freed) => eprintln!("projecta: freed {freed} interrupted test gate(s)"),
                        Err(err) => eprintln!("projecta: could not clear stale test gates: {err}"),
                    }

                    // One read of the profile switches for the whole pass: a
                    // worker whose profile is off cannot be respawned, and
                    // finding that out here keeps it from taking a respawn slot
                    // away from a worker that can. A profile that has vanished
                    // from the registry is left to `respawn_worker`, which is
                    // where "unknown agent profile" is worded.
                    let enabled: std::collections::HashSet<String> =
                        learnings::profiles_with_enabled(&reattach_store)
                            .await
                            .into_iter()
                            .filter(|profile| profile.enabled)
                            .map(|profile| profile.id)
                            .collect();
                    let known: std::collections::HashSet<String> = profiles::load_profiles()
                        .into_iter()
                        .map(|profile| profile.id)
                        .collect();
                    reattach_workers_and_resolve_claims(
                        &reattach_store,
                        |path| Path::new(path).is_dir(),
                        |profile_id| {
                            enabled.contains(profile_id) || !known.contains(profile_id)
                        },
                    )
                    .await;
                });
                // KI-23: the dispatcher starts only now. Every `dispatching`
                // row the release above saw was left by the last process; a
                // dispatcher already sweeping would add claims of its own that
                // the release cannot tell apart, and hand them back to `ready`
                // or to a worker that is about to be retired. `queue::start`
                // spawns its own thread, outside this `block_on`.
                queue::start(
                    dispatcher_handle,
                    reattach_store,
                    dispatcher_quota,
                    dispatcher_engine,
                    dispatcher_port,
                );
            });

            app.manage(store);
            app.manage(engine);
            app.manage(quota);
            // Restored: 25a2053 dropped this line in a merge, and from that
            // moment every command taking State<Arc<KeyVault>> - the provider
            // dialog, the free-tier panel - failed at runtime with "state not
            // managed". No gate can see this class of bug: Tauri checks state
            // registration on invoke, never at compile time. The test
            // every_command_state_type_is_managed is the net for it.
            app.manage(vault);
            app.manage(receiver);
            app.manage(panic_notice);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            spawn_pty,
            write_pty,
            resize_pty,
            kill_pty,
            get_scrollback,
            get_session_restore,
            list_agent_profiles,
            create_project,
            list_projects,
            create_github_repo,
            link_github_remote,
            list_skill_packs,
            set_project_skill_packs,
            get_project_skill_packs,
            get_landing_page,
            set_landing_page,
            set_project_max_workers,
            set_project_test_command,
            set_project_setup_command,
            get_project_setup_command,
            get_setup_trust_view,
            approve_setup_trust,
            run_worker_tests,
            start_web_interface,
            stop_web_interface,
            web_interface_status,
            remove_project,
            create_worker,
            list_workers,
            list_live_sessions,
            install_update_when_idle,
            enqueue_task,
            list_queue,
            cancel_queued_task,
            archive_worker,
            merge_worker,
            respawn_worker,
            create_orchestrator,
            send_to_orchestrator,
            create_scout,
            triage_repos,
            list_recommendations,
            set_recommendation_status,
            accept_recommendation,
            get_board_state,
            set_worker_column_override,
            get_quota_state,
            get_budgets,
            set_budget,
            get_stuck_after_minutes,
            set_stuck_after_minutes,
            list_digests,
            get_digest,
            get_development_plan,
            import_development_plan,
            get_project_stats,
            get_digest_enabled,
            set_digest_enabled,
            get_routing_status,
            set_product_mode,
            get_provider_overview,
            set_provider_key,
            delete_provider_key,
            get_omniroute_key_sync,
            set_omniroute_key_sync,
            has_provider_key,
            get_free_tier_summary,
            enhance_prompt,
            get_worker_diff,
            add_diff_comment,
            list_diff_comments,
            list_worker_messages,
            delete_diff_comment,
            set_diff_comment_disposition,
            get_worker_readiness,
            set_review_verdict,
            list_learnings,
            get_verdict_token,
            approve_learning,
            reject_learning,
            run_learning_critic,
            set_profile_enabled,
            set_category_learning,
            get_learning_settings,
            list_questions,
            ask_question,
            answer_question,
            list_role_variants,
            approve_role_variant,
            reject_role_variant,
            get_activity,
            get_omniroute_usage,
            get_resource_snapshot,
            delete_session_buffers,
            get_log_path,
            get_panic_notice,
            export_diagnosis,
            reveal_log_path,
            get_reason_catalog
        ])
        .build(tauri::generate_context!())
        .expect("failed to build the ProjectA application")
        .run(|app, event| {
            // Never leave an agent process behind when the app closes - and
            // give the reapers and exit hooks a bounded moment after the
            // kill: the hook is what closes the session's row and flips the
            // worker, and exiting without the wait loses exactly that record
            // (`ended_at NULL`, no exit code).
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(store) = app.try_state::<Store>() {
                    persist_live_sessions(
                        store.inner(),
                        app.state::<PtyManager>().inner(),
                        crate::sessionpersist::CONFIRMED_FLEET_STOP,
                    );
                }
                app.state::<PtyManager>().kill_all_and_wait(EXIT_REAPER_GRACE);
                let hooks_deadline = Instant::now() + EXIT_HOOK_GRACE;
                while EXIT_HOOKS_IN_FLIGHT.load(Ordering::Relaxed) > 0
                    && Instant::now() < hooks_deadline
                {
                    thread::sleep(Duration::from_millis(10));
                }
                // Take *our* descriptor with us. A successor instance may
                // already have rewritten the same path (F1-SI-1).
                if let Some(server) = app.try_state::<ApiServer>() {
                    server.forget_descriptor_if_ours();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    /// The stats-range refusal names every window it accepts, aliases
    /// included - and the aliases it names are really accepted. Third and
    /// last sibling of the same lie: `pa.rs:157/978/1607` and `api.rs:1618`
    /// were fixed first (dual reviews `.pa/review_pa_stats_r1/r2.md`,
    /// `.pa/review_api_stats_r1/r2.md`), and Rev 4 of the spec put this one
    /// into the B.2 window. Double assertion like `api.rs`: the refusal names
    /// the aliases, and the aliases parse.
    #[test]
    fn the_stats_range_refusal_names_the_aliases_it_accepts() {
        let refusal = super::parse_stats_range(Some("nope")).unwrap_err();
        assert!(refusal.contains("7d"), "{refusal}");
        assert!(refusal.contains("30d"), "{refusal}");

        assert!(super::parse_stats_range(Some("7d")).is_ok(), "{refusal}");
        assert!(super::parse_stats_range(Some("30d")).is_ok(), "{refusal}");
    }

    /// F-CORE-3 B.2 (T8): `send_to_worker` delivers through the submit guard,
    /// never as a blind `write("{text}\r")` - the blind write is the second
    /// delivery path the audit found, and it lands in a blocking dialog or a
    /// busy prompt without anyone noticing. Same scan style as the proc.rs
    /// source scans: the body slice keeps the needle from matching the other
    /// write paths in this file.
    #[test]
    fn send_to_worker_contains_no_blind_write() {
        const SOURCE: &str = include_str!("main.rs");
        // Scan only the code above this module - otherwise the needles find
        // this test's own string literals and read garbage.
        let code = &SOURCE[..SOURCE.find("mod tests").expect("this module exists")];
        let start = code
            .find("fn send_to_worker(")
            .expect("send_to_worker exists");
        let body = &code[start..];
        let end = body[1..]
            .find("\n    fn ")
            .map(|at| at + 1)
            .expect("a following method closes the body");
        let body = &body[..end];
        assert!(
            !body.contains(".write("),
            "send_to_worker must not type into the PTY itself - a blind \
             write(\"{{text}}\\r\") lands in dialogs and busy prompts; deliver \
             through the submit guard (start_task_delivery):\n{body}"
        );
        assert!(
            body.contains("deliver_to_worker"),
            "send_to_worker no longer goes through the guard seam - fix the \
             scan or restore the delivery"
        );
    }

    /// A store failure while reading the readiness marker must travel, not
    /// turn into "this worker has no marker". Without a marker the guard
    /// falls back to the silence heuristic and writes after
    /// `READY_MAX_WAIT`; a database hiccup would then type into a busy
    /// prompt - exactly the NT-17 class this seam was built to close. Only
    /// a profile that defines no marker may yield `None`.
    #[test]
    fn the_readiness_marker_lookup_does_not_swallow_store_errors() {
        const SOURCE: &str = include_str!("main.rs");
        let code = &SOURCE[..SOURCE.find("mod tests").expect("this module exists")];
        let start = code
            .find("fn send_to_worker(")
            .expect("send_to_worker exists");
        let body = &code[start..];
        let end = body[1..]
            .find("\n    fn ")
            .map(|at| at + 1)
            .expect("a following method closes the body");
        let body = &body[..end];
        assert!(
            !body.contains(".ok()"),
            "the readiness-marker lookup drops the store error with .ok() - \
             a failed read then looks like a profile without a marker and \
             the guard writes into a busy prompt after READY_MAX_WAIT; \
             propagate with ? instead:\n{body}"
        );
    }

    // -- F-CORE-3 B.2: the send_to_worker delivery seam ----------------------

    /// A recorded `start_task_delivery` call: (worker, session, text,
    /// readiness marker).
    type Delivery = (String, String, String, Option<String>);

    /// An `AgentControl` that records what the seam asks of it and holds the
    /// outcome callback back, so the test can play the guard and fire the
    /// verdict itself - the Typist pattern from questions.rs.
    #[derive(Default)]
    struct Typist {
        writes: std::sync::Mutex<Vec<(String, String)>>,
        deliveries: std::sync::Mutex<Vec<Delivery>>,
        outcomes: std::sync::Mutex<Vec<Option<super::DeliveryCallback>>>,
    }

    impl Typist {
        fn writes(&self) -> Vec<(String, String)> {
            self.writes.lock().unwrap().clone()
        }

        fn deliveries(&self) -> Vec<Delivery> {
            self.deliveries.lock().unwrap().clone()
        }

        /// Fire the guard verdict the fake kept back, like the real guard
        /// does from its thread once delivery is proven or gave up.
        fn confirm(&self, outcome: super::DeliveryOutcome) {
            let callback = self.outcomes.lock().unwrap()[0]
                .take()
                .expect("a pending delivery outcome");
            callback(outcome);
        }
    }

    impl super::AgentControl for Typist {
        fn spawn(
            &self,
            _worker_id: &str,
            _profile: &crate::profiles::AgentProfile,
            _cwd: &std::path::Path,
            _env: &[(String, String)],
        ) -> Result<String, String> {
            unreachable!("send_to_worker never spawns an agent")
        }

        fn write(&self, session_id: &str, text: &str) -> Result<(), String> {
            self.writes
                .lock()
                .unwrap()
                .push((session_id.to_string(), text.to_string()));
            Ok(())
        }

        fn start_task_delivery(
            &self,
            worker_id: &str,
            session_id: &str,
            task: &str,
            readiness_marker: Option<&str>,
            on_outcome: Option<super::DeliveryCallback>,
        ) -> Result<(), String> {
            self.deliveries.lock().unwrap().push((
                worker_id.to_string(),
                session_id.to_string(),
                task.to_string(),
                readiness_marker.map(str::to_string),
            ));
            self.outcomes.lock().unwrap().push(on_outcome);
            Ok(())
        }

        fn kill(&self, _session_id: &str) {}
    }

    async fn roles(store: &super::Store, worker_id: &str) -> Vec<(String, String)> {
        store
            .list_messages(worker_id, None)
            .await
            .expect("messages")
            .into_iter()
            .map(|m| (m.role, m.content))
            .collect()
    }

    /// Poll the log until `found` holds: the outcome callback logs
    /// fire-and-forget through `workers::log_message`, the same way the
    /// questions.rs tests wait for it.
    async fn wait_for_log(
        store: &super::Store,
        worker_id: &str,
        what: &str,
        found: impl Fn(&[(String, String)]) -> bool,
    ) -> Vec<(String, String)> {
        for _ in 0..200 {
            let log = roles(store, worker_id).await;
            if found(&log) {
                return log;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        panic!("{worker_id} never logged {what}");
    }

    async fn seam_fixture(label: &str) -> (crate::testutil::TempDir, super::Store) {
        let dir = crate::testutil::TempDir::new(label);
        let store = super::Store::open(&dir.path().join("projecta.db"))
            .await
            .expect("open store");
        (dir, store)
    }

    /// B.2 behavior at the seam: the text travels through
    /// `start_task_delivery` with the profile's readiness marker, and no raw
    /// `write("{text}\r")` reaches the terminal.
    #[tokio::test]
    async fn a_send_to_worker_text_is_delivered_through_the_guard() {
        let (_dir, store) = seam_fixture("send-through-guard").await;
        let typist = Typist::default();

        super::deliver_to_worker(
            &typist,
            &store,
            "wk-1",
            "pty-wk-1",
            "baue das Formular",
            Some("Ask anything"),
        )
        .expect("delivery starts");

        assert_eq!(
            typist.deliveries(),
            vec![(
                "wk-1".to_string(),
                "pty-wk-1".to_string(),
                "baue das Formular".to_string(),
                Some("Ask anything".to_string())
            )],
            "the text must reach the guard with the profile's readiness marker"
        );
        assert!(
            typist.writes().is_empty(),
            "no blind write may reach the terminal: {:?}",
            typist.writes()
        );
    }

    /// The C-2 principle at this seam: `Ok(())` means no more than "the
    /// guard thread is running" - the MSG_USER turn is written by the outcome
    /// callback once the guard proves the delivery.
    #[tokio::test]
    async fn the_sent_text_is_logged_as_a_user_turn_only_after_proven_delivery() {
        let (_dir, store) = seam_fixture("log-after-delivery").await;
        let typist = Typist::default();

        super::deliver_to_worker(&typist, &store, "wk-1", "pty-wk-1", "mach weiter", None)
            .expect("delivery starts");
        assert!(
            roles(&store, "wk-1").await.is_empty(),
            "the guard start is not a delivery - nothing may be logged yet"
        );

        typist.confirm(super::DeliveryOutcome::Delivered);
        let log = wait_for_log(&store, "wk-1", "the user turn", |log| !log.is_empty()).await;
        assert_eq!(
            log,
            vec![(
                crate::store::MSG_USER.to_string(),
                "mach weiter".to_string()
            )]
        );
    }

    /// The Auffangnetz: an escalation persists the undelivered text as
    /// MSG_SYSTEM with the concrete next step, instead of a user turn that
    /// never happened.
    #[tokio::test]
    async fn an_escalation_persists_the_undelivered_text_with_the_next_step() {
        let (_dir, store) = seam_fixture("escalation-net").await;
        let typist = Typist::default();

        super::deliver_to_worker(&typist, &store, "wk-1", "pty-wk-1", "mach weiter", None)
            .expect("delivery starts");
        typist.confirm(super::DeliveryOutcome::Escalated);

        let log = wait_for_log(&store, "wk-1", "the escalation note", |log| !log.is_empty()).await;
        assert_eq!(log.len(), 1, "exactly one note, no phantom user turn");
        let (role, content) = &log[0];
        assert_eq!(role, crate::store::MSG_SYSTEM);
        assert!(
            content.contains("mach weiter"),
            "the note carries the undelivered text: {content}"
        );
        assert!(
            content.contains("nicht zugestellt") && content.contains("nachreichen"),
            "the note names the next step: {content}"
        );
    }

    /// C-5: an escalation before any write means the readiness marker never
    /// appeared and nothing was typed - "manual Enter required" would send
    /// the user pressing Enter into an empty prompt.
    #[test]
    fn an_escalation_before_any_write_reports_the_missing_marker() {
        let mut narrative = super::GuardNarrative::default();
        assert_eq!(
            narrative.detail(&super::SubmitGuardEvent::Escalated),
            "readiness marker never appeared; task not written"
        );
    }

    /// W1-03d (review B2): a waiting delivery names how many are ahead.
    #[test]
    fn a_queued_delivery_names_the_deliveries_ahead() {
        let mut narrative = super::GuardNarrative::default();
        assert_eq!(
            narrative.detail(&super::SubmitGuardEvent::Queued { ahead: 1 }),
            "queued behind 1 earlier delivery to this session"
        );
        assert_eq!(
            narrative.detail(&super::SubmitGuardEvent::Queued { ahead: 3 }),
            "queued behind 3 earlier deliveries to this session"
        );
    }

    /// W1-03d: a delivery stopped by an earlier task in the input line
    /// wrote nothing, but its readiness marker was never the problem - the
    /// escalation names the line, not the marker.
    #[test]
    fn a_blocked_delivery_escalates_without_blaming_the_readiness_marker() {
        let mut narrative = super::GuardNarrative::default();
        narrative.detail(&super::SubmitGuardEvent::InputBlocked);
        let text = narrative.detail(&super::SubmitGuardEvent::Escalated);
        assert!(text.contains("earlier task"), "{text}");
        assert!(!text.contains("readiness marker"), "{text}");
    }

    /// Reviews GLM-5.3 X2 / DeepSeek X1: a delivery whose session was killed
    /// names the session, not a readiness marker it never waited for.
    #[test]
    fn a_delivery_to_an_ended_session_does_not_blame_the_readiness_marker() {
        let mut narrative = super::GuardNarrative::default();
        narrative.detail(&super::SubmitGuardEvent::SessionEnded);
        let text = narrative.detail(&super::SubmitGuardEvent::Escalated);
        assert!(text.contains("session ended"), "{text}");
        assert!(!text.contains("readiness marker"), "{text}");
    }

    /// The write went out but no echo came back: here a manual Enter is
    /// exactly the right next step.
    #[test]
    fn an_escalation_after_the_write_reports_the_missing_echo() {
        let mut narrative = super::GuardNarrative::default();
        narrative.detail(&super::SubmitGuardEvent::Wrote { write: 1 });
        assert_eq!(
            narrative.detail(&super::SubmitGuardEvent::Escalated),
            "task never echoed; manual Enter required"
        );
    }

    #[test]
    fn an_escalation_after_the_final_enter_retry_reports_unanswered_retries() {
        let mut narrative = super::GuardNarrative::default();
        narrative.detail(&super::SubmitGuardEvent::Wrote { write: 1 });
        narrative.detail(&super::SubmitGuardEvent::Enter { attempt: 0 });
        assert_eq!(
            narrative.detail(&super::SubmitGuardEvent::Enter { attempt: 2 }),
            "enter retry 2 after 30s without output",
            "the retry text is unchanged"
        );
        narrative.detail(&super::SubmitGuardEvent::Enter { attempt: 3 });
        assert_eq!(
            narrative.detail(&super::SubmitGuardEvent::Escalated),
            "enter retries unanswered; the task sits on the agent's prompt"
        );
    }

    /// The ANSWER_MARKER_CAP escalation (A.5): Enter went out and the retries
    /// never ran out, yet no answer marker confirmed the agent reacted - its
    /// own, distinguishable text.
    #[test]
    fn an_escalation_after_enter_without_exhausted_retries_reports_the_answer_marker_cap() {
        let mut narrative = super::GuardNarrative::default();
        narrative.detail(&super::SubmitGuardEvent::Wrote { write: 1 });
        narrative.detail(&super::SubmitGuardEvent::Enter { attempt: 0 });
        assert_eq!(
            narrative.detail(&super::SubmitGuardEvent::Escalated),
            "answer marker never appeared; delivery not confirmed"
        );
    }

    /// "task delivery confirmed" is reserved for a marker-confirmed delivery
    /// (ConfirmDelivery); the byte-based Delivered event must not claim it.
    #[test]
    fn the_byte_progress_delivery_does_not_claim_confirmation() {
        let mut narrative = super::GuardNarrative::default();
        let text = narrative.detail(&super::SubmitGuardEvent::Delivered);
        assert!(
            !text.contains("confirmed"),
            "byte progress is not a confirmed delivery: {text}"
        );
    }

    #[test]
    fn projecta_app_data_overrides_tauris_app_data_dir() {
        let tauri = PathBuf::from("C:/Users/someone/AppData/Roaming/com.projecta.app");
        assert_eq!(super::resolve_app_data_dir(tauri.clone()), tauri);
        let previous = std::env::var_os(super::ENV_APP_DATA);
        std::env::set_var(super::ENV_APP_DATA, "D:/scratch/projecta-f8");
        let isolated = super::resolve_app_data_dir(tauri.clone());
        std::env::set_var(super::ENV_APP_DATA, "");
        let empty_means_default = super::resolve_app_data_dir(tauri.clone());
        match previous {
            Some(value) => std::env::set_var(super::ENV_APP_DATA, value),
            None => std::env::remove_var(super::ENV_APP_DATA),
        }
        assert_eq!(isolated, PathBuf::from("D:/scratch/projecta-f8"));
        assert_eq!(empty_means_default, tauri);
    }

    /// KI-23, review finding B1 (kimi-k3): the startup claim release must not
    /// race the dispatcher. A claim the dispatcher takes while the release
    /// runs is `dispatching` too, and the release cannot tell it from a claim
    /// the last process left behind - it would hand it back to `ready` or
    /// attribute it to a worker about to be retired. So the dispatcher starts
    /// only once `reattach_workers_and_resolve_claims` has returned. Startup
    /// needs a Tauri app, so the order is asserted on the source, like the
    /// single-instance guard below.
    #[test]
    fn the_dispatcher_starts_only_after_the_startup_claims_are_resolved() {
        const SOURCE: &str = include_str!("main.rs");
        let code = &SOURCE[..SOURCE.find("mod tests").expect("this module exists")];
        let setup = code
            .find(".setup(|app| {")
            .expect("main() no longer builds the app with a setup closure");
        let resolved = setup
            + code[setup..]
                .find("reattach_workers_and_resolve_claims(")
                .expect("setup no longer resolves the startup claims");
        // `queue::start(` has exactly one call site in main.rs; the needle
        // takes the first one, so a second call (or the spelling in prose)
        // added above the setup would trip this for the wrong reason.
        let dispatcher = code
            .find("queue::start(")
            .expect("`queue::start(` moved or was renamed - fix the needle");
        assert!(
            resolved < dispatcher,
            "the queue dispatcher starts before the startup claim release; a claim \
             it takes meanwhile is indistinguishable from a leftover one"
        );
    }

    /// The whole value of the single-instance guard is its position, and
    /// nothing about a builder chain makes position a compile error. Plugins
    /// are initialised in registration order at the end of `Builder::build`;
    /// the setup closure runs later still. A guard that is not the first
    /// plugin lets the redundant process build the `main` window and a second
    /// WebView2 before it stands down, and a guard moved into the setup
    /// closure would additionally sit behind the process, opener and updater
    /// plugins. So the order is asserted on the source, the same way the
    /// manage table below is.
    #[test]
    fn the_single_instance_guard_is_the_first_plugin_on_the_builder() {
        const SOURCE: &str = include_str!("main.rs");
        // Scan only the code above this module - otherwise the needles find
        // this test's own string literals and read garbage.
        let code = &SOURCE[..SOURCE.find("mod tests").expect("this module exists")];

        let registration = code
            .find(".plugin(tauri_plugin_single_instance::init")
            .expect(
                "the single-instance guard is gone from main.rs - without it a second \
             launch is a second dispatcher on the same queue",
            );
        let first_plugin = code
            .find(".plugin(")
            .expect("main() no longer registers any plugin at all");
        assert_eq!(
            first_plugin, registration,
            "another plugin is registered before the single-instance guard; the \
             redundant process would run that plugin's setup before standing down"
        );

        let setup = code
            .find(".setup(|app| {")
            .expect("main() no longer builds the app with a setup closure");
        assert!(
            registration < setup,
            "the single-instance guard was moved into (or behind) the setup \
             closure, where the redundant process has already built its window"
        );

        // Each of these is something the redundant process must not reach.
        for (what, needle) in [
            ("resolved the app data directory", "app_data_dir(&handle)"),
            ("opened the database", "init_store(&handle, &dir)"),
            ("published the api descriptor", "api::start(backend, &dir)"),
            ("started the queue dispatcher", "queue::start("),
        ] {
            let at = code.find(needle).unwrap_or_else(|| {
                panic!(
                    "`{needle}` moved or was renamed: this test can no longer prove \
                     the single-instance guard comes first - fix the needle"
                )
            });
            assert!(
                registration < at,
                "the single-instance guard is registered after main() {what} \
                 (`{needle}`); a second launch would get that far before exiting"
            );
        }
    }

    /// The registration sits behind `#[cfg(desktop)]`, and `desktop` is a cfg
    /// `tauri-build` emits - not one cargo knows about. If it ever stopped
    /// arriving, the block would compile away to nothing and the guard would
    /// be silently gone while the source test above still passed.
    // Asserting a constant is exactly the point here, and clippy is right that
    // it could be a `const _: () = assert!(..)`. It deliberately is not: a
    // missing `desktop` cfg is a build-configuration regression to diagnose by
    // name, not a reason to make the crate refuse to compile at all - which is
    // what a const assertion would do on any target where `desktop` is
    // legitimately absent.
    #[allow(clippy::assertions_on_constants)]
    #[test]
    fn the_desktop_cfg_that_gates_the_guard_is_actually_set() {
        assert!(
            cfg!(desktop),
            "`desktop` is not set on this build, so the single-instance guard was \
             compiled out - check that tauri-build still emits the cfg"
        );
    }

    /// The guard must stand a redundant process down, never a legitimate one.
    /// The updater relaunches the app while the old process can still exist,
    /// and the property that keeps that alive is the plugin's: it releases its
    /// mutex and destroys its window on `RunEvent::Exit`, and a second
    /// instance is only turned away when it finds *both*. A lock file, a bare
    /// named mutex or a pid check next to it would fail closed instead - the
    /// successor would find a stale lock and refuse to start. So the guard has
    /// to stay the plugin alone, and nothing may re-destroy its handles from
    /// our own exit path either (the plugin's exit hook already runs, before
    /// the run handler; a second `destroy` would close a closed handle).
    #[test]
    fn nothing_guards_startup_beside_the_plugin() {
        const SOURCE: &str = include_str!("main.rs");
        let code = &SOURCE[..SOURCE.find("mod tests").expect("this module exists")];

        for (needle, why) in [
            (
                "CreateMutex",
                "a hand-rolled mutex has no window to fail open against",
            ),
            (
                "single_instance::destroy",
                "the plugin destroys its own handles on exit; doing it again \
                 closes a closed handle",
            ),
            (
                ".lock\"",
                "a lock file outlives a killed process and would refuse the \
                 updater's relaunch",
            ),
        ] {
            assert!(
                !code.contains(needle),
                "main.rs grew a second startup guard (`{needle}`): {why}"
            );
        }

        assert!(
            code.contains("forget_descriptor_if_ours"),
            "Exit must delete the API descriptor by port+token, not by path"
        );
        assert!(
            !code.contains("remove_file(server.descriptor_path())"),
            "unconditional descriptor delete is F1-SI-1: a successor's file would vanish"
        );
    }

    /// Tauri checks state registration when a command is invoked, never at
    /// compile time - so a `State<T>` parameter whose `T` was never given to
    /// `.manage()` passes every gate and fails only in the running window.
    /// That is exactly how 25a2053 silently broke the provider dialog and the
    /// free-tier panel for weeks. This test scans the source instead: every
    /// state type a command asks for must have its manage line, and a state
    /// type this table does not know fails loudly so the table (and the
    /// manage call) grow together with the code.
    #[test]
    fn every_command_state_type_is_managed() {
        const SOURCE: &str = include_str!("main.rs");

        // Which manage line proves which type. Textual on purpose: the
        // variables are constructed a few lines above their manage call, and
        // renaming either side should force a person through this table.
        let evidence: &[(&str, &str)] = &[
            ("Arc<KeyVault>", "app.manage(vault)"),
            ("Arc<QuotaTracker>", "app.manage(quota)"),
            ("Arc<StatusEngine>", "app.manage(engine)"),
            ("HookReceiver", "app.manage(receiver)"),
            (
                "Mutex<WebInterfaceState>",
                ".manage(Mutex::new(WebInterfaceState::default()))",
            ),
            ("PtyManager", ".manage(PtyManager::default())"),
            ("Store", "app.manage(store)"),
            ("PanicNotice", "app.manage(panic_notice)"),
        ];

        // Scan only the code above this module, and build the marker at
        // runtime - otherwise the scan finds the string literals of this very
        // test and reads garbage after them.
        let code = &SOURCE[..SOURCE.find("mod tests").expect("this module exists")];
        let marker: String = ["State<'", "_, "].concat();
        let marker = marker.as_str();

        let mut wanted = std::collections::BTreeSet::new();
        let mut rest = code;
        while let Some(at) = rest.find(marker) {
            rest = &rest[at + marker.len()..];
            let mut depth = 1usize;
            let mut end = 0usize;
            for (i, ch) in rest.char_indices() {
                match ch {
                    '<' => depth += 1,
                    '>' => {
                        depth -= 1;
                        if depth == 0 {
                            end = i;
                            break;
                        }
                    }
                    _ => {}
                }
            }
            wanted.insert(rest[..end].to_string());
        }
        assert!(
            !wanted.is_empty(),
            "the scan found no State parameters at all - the marker rotted"
        );

        for ty in &wanted {
            let (_, proof) = evidence
                .iter()
                .find(|(known, _)| known == ty)
                .unwrap_or_else(|| {
                    panic!(
                        "command state type `{ty}` is not in the evidence table: \
                         add its `.manage()` call in setup AND its row here"
                    )
                });
            // Line-based on purpose: a commented-out manage call still
            // *contains* the evidence string, and a dead line must not count.
            let live = code
                .lines()
                .any(|line| line.trim_start().starts_with(proof));
            assert!(
                live,
                "state type `{ty}` has no live `{proof}` line in main.rs - \
                 commands taking it will fail at runtime with 'state not managed'"
            );
        }
    }
}
