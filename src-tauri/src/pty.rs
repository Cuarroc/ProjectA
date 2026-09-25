//! PTY session management on top of `portable-pty` (ConPTY on Windows).
//!
//! Each session owns a spawned CLI agent, a reader thread that streams output to
//! the frontend as Tauri events, and a ~1 MiB scrollback ring buffer so that a
//! view switch never loses terminal history.

use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::profiles::AgentProfile;
use crate::submit_guard::{Observation, SubmitAction, SubmitGuard};

/// Scrollback kept per session, in bytes.
const SCROLLBACK_CAPACITY: usize = 1024 * 1024;

/// Read chunk size for the PTY reader thread.
const READ_CHUNK: usize = 8 * 1024;
const READER_RETIREMENT_TIMEOUT: Duration = Duration::from_secs(5);

/// How much of the scrollback tail the submit guard inspects per tick. The
/// task echo and blocking dialogs live near the end of the stream; 32 KiB
/// covers several screenfuls without copying the whole ring.
const GUARD_TAIL_BYTES: usize = 32 * 1024;

/// Payload of `pty:exit:<session_id>`.
#[derive(Debug, Clone, Serialize)]
pub struct ExitPayload {
    pub code: Option<i32>,
}

/// Called with `(session_id, exit_code)` when a session's child ends.
///
/// Phase 2 uses this to flip the owning worker to `exited` in the database; the
/// PTY layer itself knows nothing about workers.
pub type ExitHook = Arc<dyn Fn(&str, Option<i32>) -> Result<(), String> + Send + Sync>;

/// Called with `(session_id, chunk)` for every piece of decoded output, on the
/// reader thread, just before it reaches the frontend.
///
/// Phase 3 uses this to feed the status engine's output heuristics. Keep the
/// work inside short: this runs between two reads of a live terminal.
pub type OutputHook = Arc<dyn Fn(&str, &str) + Send + Sync>;

/// Events the submit guard reports while getting a task accepted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubmitGuardEvent {
    /// The task text was written (`write == 1`) or rewritten after a quiet
    /// TUI produced no echo.
    Wrote { write: u8 },
    /// Enter was sent as its own write (`attempt == 0` right after the echo,
    /// 1..=3 as silence retries).
    Enter { attempt: u8 },
    /// A blocking dialog (workspace trust) was answered.
    DialogAnswered,
    /// The task's echo was seen and output followed the Enter. On profiles
    /// without an answer marker this is the byte-based progress signal it
    /// always was; with a marker it fires only after the marker confirmed the
    /// delivery (`SubmitAction::ConfirmDelivery`).
    Delivered,
    /// The TUI never accepted the task, so ProjectA asks the user to step in.
    Escalated,
    /// W1-03d: the delivery waits behind `ahead` earlier deliveries to the
    /// same session (C-3); it types once they have ended.
    Queued { ahead: usize },
    /// W1-03d: an earlier delivery left its task in the input line and the
    /// user has not sent or emptied it since; this task is not typed.
    /// `Escalated` follows.
    InputBlocked,
    /// W1-03d: the session was killed or ended before this delivery was
    /// done; nothing more is typed. `Escalated` follows.
    SessionEnded,
}

/// A byte ring buffer holding the tail of a session's raw output.
struct Scrollback {
    buf: VecDeque<u8>,
    /// Monotonic count of every byte ever pushed, including bytes the ring
    /// has already dropped. The submit guard's write baseline is an absolute
    /// position on this counter.
    total_pushed: u64,
}

impl Scrollback {
    fn new() -> Self {
        Self {
            buf: VecDeque::new(),
            total_pushed: 0,
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        self.total_pushed += bytes.len() as u64;
        if bytes.len() >= SCROLLBACK_CAPACITY {
            self.buf.clear();
            self.buf.extend(&bytes[bytes.len() - SCROLLBACK_CAPACITY..]);
            return;
        }
        let overflow = (self.buf.len() + bytes.len()).saturating_sub(SCROLLBACK_CAPACITY);
        if overflow > 0 {
            self.buf.drain(..overflow);
        }
        self.buf.extend(bytes);
    }

    fn to_lossy_string(&self) -> String {
        let (head, tail) = self.buf.as_slices();
        let mut flat = Vec::with_capacity(self.buf.len());
        flat.extend_from_slice(head);
        flat.extend_from_slice(tail);
        String::from_utf8_lossy(&flat).into_owned()
    }

    /// One atomic snapshot for the submit guard: the last `max_bytes` of raw
    /// output, the absolute position of the tail's first byte, and the
    /// absolute end position (`total_pushed`). All three come from one lock
    /// acquisition, so the guard's byte counter and its tail content can never
    /// disagree about an in-flight read - and the write baseline
    /// (`tail_since_write`) is cut out of the very snapshot the counter came
    /// from.
    fn snapshot(&self, max_bytes: usize) -> (Vec<u8>, u64, u64) {
        let (head, tail) = self.buf.as_slices();
        let total = head.len() + tail.len();
        let skip = total.saturating_sub(max_bytes);
        let mut flat = Vec::with_capacity(total - skip);
        if skip < head.len() {
            flat.extend_from_slice(&head[skip..]);
            flat.extend_from_slice(tail);
        } else {
            flat.extend_from_slice(&tail[skip - head.len()..]);
        }
        let end = self.total_pushed;
        let start = end - (total - skip) as u64;
        (flat, start, end)
    }

    /// The current absolute end position - the write baseline the guard moves
    /// to after every task write.
    fn position(&self) -> u64 {
        self.total_pushed
    }
}

/// Incremental UTF-8 decoder: a read can split a multi-byte character, so the
/// trailing partial sequence is carried over into the next chunk.
struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    fn new() -> Self {
        Self {
            pending: Vec::with_capacity(4),
        }
    }

    fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut out = String::with_capacity(self.pending.len());
        let mut start = 0usize;

        loop {
            match std::str::from_utf8(&self.pending[start..]) {
                Ok(valid) => {
                    out.push_str(valid);
                    start = self.pending.len();
                    break;
                }
                Err(err) => {
                    let valid_up_to = err.valid_up_to();
                    if valid_up_to > 0 {
                        out.push_str(
                            std::str::from_utf8(&self.pending[start..start + valid_up_to])
                                .unwrap_or_default(),
                        );
                    }
                    match err.error_len() {
                        // Genuinely invalid bytes: replace them and carry on.
                        Some(len) => {
                            out.push(char::REPLACEMENT_CHARACTER);
                            start += valid_up_to + len;
                        }
                        // Truncated sequence: keep it for the next read.
                        None => {
                            start += valid_up_to;
                            break;
                        }
                    }
                }
            }
        }

        self.pending.drain(..start);
        // A UTF-8 sequence is at most 4 bytes; anything longer cannot complete.
        if self.pending.len() > 4 {
            self.pending.clear();
        }
        out
    }
}

/// One live PTY session.
struct Session {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    scrollback: Arc<Mutex<Scrollback>>,
    /// Last decoded output observed by the reader. The guard uses this instead
    /// of subscribing to the global output hook, so it cannot replace status.
    last_output: Arc<Mutex<Option<Instant>>>,
    /// Set as soon as a session is killed. It lets a sleeping guard stop before
    /// the child reaper has removed the session from the registry.
    ///
    /// Final: never reset. A guard started after the kill must not type into
    /// the dying session, and resetting it would wake the guards the kill
    /// already stopped (review A5/B6). Every setter - kill, kill_all, a
    /// failed exit hook - ends the session, so no per-guard generation is
    /// needed; one would even leave a guard started after the kill running.
    submit_guard_cancelled: Arc<AtomicBool>,
    /// C-3: the order in which this session's submit guards may type. Only
    /// the guard at the front writes; the others wait for their turn.
    delivery_turns: Arc<DeliveryTurns>,
    /// Opt-in raw I/O trace (`PROJECTA_PTY_TRACE_DIR`): every write into the
    /// PTY and every output chunk, with a millisecond clock, plus the raw
    /// output bytes in a sidecar. Off unless the directory is set - it
    /// records task text. The W1-01 diagnosis needed exactly this view of
    /// the launch path, which no harness reproduced.
    trace: Option<SessionTrace>,
}

/// C-3: a FIFO of the submit guards of one session.
///
/// Every delivery joins at `start_submit_guard` - synchronously, so the queue
/// order is the call order - and only the guard at the front may type. A
/// guard leaves the queue on every way out of its thread (delivered,
/// escalated, cancelled, session gone, panic), because its [`DeliveryTurn`]
/// removes it on drop; a guard that gives up while still waiting leaves the
/// same way, so it can never block the ones behind it.
///
/// No wait here is unbounded: every phase of the guard ahead is capped
/// (`MARKER_BUSY_CAP`/`READY_MAX_WAIT`, `MAX_WRITES` x `ECHO_BUSY_CAP`,
/// `ENTER_SETTLE_CAP`, `RETRY_BACKOFF` - about eleven minutes in all), and a
/// waiting guard re-checks cancellation and the session on every wake-up.
///
/// A delivery that escalates *after* typing its task may leave that text
/// unsent in the input line. The session keeps an `input_dirty` flag for
/// this: it is set when a turn leaves the queue while its guard still had
/// input pending, and stays set until the user sends or empties the line
/// ([`PtyManager::write_user_input`]). Every later delivery escalates
/// without writing until then.
#[derive(Default)]
struct DeliveryTurns {
    state: Mutex<TurnState>,
    changed: Condvar,
}

#[derive(Default)]
struct TurnState {
    queue: VecDeque<u64>,
    next_id: u64,
    /// Set when a turn leaves the queue while its task may still sit in the
    /// input line; cleared by user input into this session.
    input_dirty: bool,
    /// Counts the user's clears of the line. A turn marks the line dirty on
    /// drop only if its task went in after the latest clear (Codex review,
    /// PR #81): a line the user emptied mid-delivery stays clean.
    clear_epoch: u64,
    /// Reads the user's input across chunks (a paste or escape sequence can
    /// be split between two `write_pty` calls).
    input_scan: InputScan,
}

impl DeliveryTurns {
    /// A plain queue of ids stays consistent even if a holder panicked, so a
    /// poisoned lock is taken over instead of wedging every later delivery.
    fn lock(&self) -> MutexGuard<'_, TurnState> {
        self.state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    fn join(self: &Arc<Self>) -> DeliveryTurn {
        let mut state = self.lock();
        let id = state.next_id;
        state.next_id += 1;
        let ahead = state.queue.len();
        state.queue.push_back(id);
        DeliveryTurn {
            turns: Arc::clone(self),
            id,
            ahead,
            pending_epoch: AtomicU64::new(NOT_PENDING),
        }
    }

    /// The user emptied or sent the line: clear the dirty flag, and void the
    /// pending text of the delivery still running.
    #[cfg(test)]
    fn clear_input_dirty(&self) {
        Self::clear(&mut self.lock());
    }

    fn clear(state: &mut TurnState) {
        state.input_dirty = false;
        state.clear_epoch += 1;
    }

    /// The user's input `data`: written (`write`, through the locked PTY
    /// `writer`) and, if it leaves the line empty, recorded as a clear. The
    /// writer lock - required by the signature, review round three GLM-5.3
    /// X2 - orders this against [`DeliveryTurn::type_task`]; the turn lock
    /// is only taken briefly, never across a PTY write that may block
    /// (review round two, GLM-5.3 X3 / DeepSeek X1).
    fn user_write(
        &self,
        writer: &mut MutexGuard<'_, PtyWriter>,
        data: &str,
        write: impl FnOnce(&mut PtyWriter) -> Result<(), String>,
    ) -> Result<(), String> {
        write(writer)?;
        let mut state = self.lock();
        if state.input_scan.feed(data) {
            Self::clear(&mut state);
        }
        Ok(())
    }

    #[cfg(test)]
    fn is_empty(&self) -> bool {
        self.lock().queue.is_empty()
    }

    #[cfg(test)]
    fn input_dirty(&self) -> bool {
        self.lock().input_dirty
    }
}

/// One guard's place in [`DeliveryTurns`]; dropping it leaves the queue.
struct DeliveryTurn {
    turns: Arc<DeliveryTurns>,
    id: u64,
    /// Deliveries queued before this one when it joined.
    ahead: usize,
    /// The `clear_epoch` in which this guard's task went into the line, or
    /// [`NOT_PENDING`].
    pending_epoch: AtomicU64,
}

/// [`DeliveryTurn::pending_epoch`] when no text of the guard is in the line.
const NOT_PENDING: u64 = u64::MAX;

impl DeliveryTurn {
    /// Wait up to `timeout` for this guard to reach the front. Returns
    /// whether it is its turn; the caller re-checks cancellation between
    /// calls.
    fn wait(&self, timeout: Duration) -> bool {
        let state = self.turns.lock();
        if state.queue.front() == Some(&self.id) {
            return true;
        }
        let (state, _) = self
            .turns
            .changed
            .wait_timeout(state, timeout)
            .unwrap_or_else(|poison| poison.into_inner());
        state.queue.front() == Some(&self.id)
    }

    /// Record whether this guard's task may sit in the line. `typed_now`
    /// re-arms it in the current epoch: a (re)write after a user's clear
    /// puts text into the line again.
    fn note_input(&self, pending: bool, typed_now: bool) {
        if !pending {
            self.pending_epoch.store(NOT_PENDING, Ordering::Relaxed);
        } else if typed_now || self.pending_epoch.load(Ordering::Relaxed) == NOT_PENDING {
            let epoch = self.turns.lock().clear_epoch;
            self.pending_epoch.store(epoch, Ordering::Relaxed);
        }
    }

    /// Type this guard's task into the line (`write` does the PTY write
    /// through the locked `writer`) and record it as pending in the current
    /// clear epoch. The writer lock, held across this call as across
    /// [`DeliveryTurns::user_write`], keeps the two from interleaving:
    /// whichever lands later decides the line - a clear right after the
    /// task voids it, a task right after a clear is pending (Codex review,
    /// PR #81). Recorded before the write, so a panic inside it still counts
    /// the task as typed; nothing is recorded after it, so a clear that
    /// follows wins.
    fn type_task<R>(
        &self,
        writer: &mut MutexGuard<'_, PtyWriter>,
        write: impl FnOnce(&mut PtyWriter) -> R,
    ) -> R {
        let epoch = self.turns.lock().clear_epoch;
        self.pending_epoch.store(epoch, Ordering::Relaxed);
        write(writer)
    }

    #[cfg(test)]
    fn set_input_pending(&self, pending: bool) {
        self.note_input(pending, pending);
    }

    /// Whether a delivery before this one left its task in the session's
    /// input line and no user input has cleared it since.
    fn input_dirty(&self) -> bool {
        self.turns.lock().input_dirty
    }
}

/// Runs on every way out of the guard thread, a panic included - the
/// crate builds with the default `panic = "unwind"`; under `abort` the
/// process ends with the session anyway.
impl Drop for DeliveryTurn {
    fn drop(&mut self) {
        let mut state = self.turns.lock();
        state.queue.retain(|id| *id != self.id);
        if self.pending_epoch.load(Ordering::Relaxed) == state.clear_epoch {
            state.input_dirty = true;
        }
        self.turns.changed.notify_all();
    }
}

/// See [`Session::trace`].
struct SessionTrace {
    started: Instant,
    log: Mutex<std::fs::File>,
    raw_out: Mutex<std::fs::File>,
}

impl SessionTrace {
    const ENV_DIR: &'static str = "PROJECTA_PTY_TRACE_DIR";

    fn open(session_id: &str) -> Option<Self> {
        let dir = std::env::var_os(Self::ENV_DIR).filter(|d| !d.is_empty())?;
        let dir = std::path::PathBuf::from(dir);
        std::fs::create_dir_all(&dir).ok()?;
        let open = |name: String| {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join(name))
                .ok()
        };
        Some(Self {
            started: Instant::now(),
            log: Mutex::new(open(format!("{session_id}.io.log"))?),
            raw_out: Mutex::new(open(format!("{session_id}.out.raw"))?),
        })
    }

    fn note(&self, direction: &str, bytes: &[u8]) {
        let ms = self.started.elapsed().as_millis();
        let escaped: String = bytes
            .iter()
            .map(|b| std::ascii::escape_default(*b).to_string())
            .collect();
        // Appends only, so a poisoned file lock is taken over (W1-15c): the
        // trace exists for broken sessions and must not go quiet on one.
        let _ = writeln!(
            recover(&self.log),
            "t={ms}ms {direction} {} bytes: {escaped}",
            bytes.len()
        );
        if direction == "out" {
            let _ = recover(&self.raw_out).write_all(bytes);
        }
    }
}

#[path = "pty/agent_env.rs"]
pub(crate) mod agent_env;

#[cfg(test)]
#[path = "pty/native_tests.rs"]
mod native_tests;

enum SessionEntry {
    Reserved,
    /// Stop arrived before a queued consumer entered native/PTY execution.
    /// Keep the tombstone until the owner releases the unconsumed reservation.
    CancelledReservation,
    Starting,
    /// Native exit observed, but resource retirement or persistence is pending
    /// or failed. This entry still blocks installation and cannot be reused.
    Retiring,
    Interactive(Arc<Session>),
    #[allow(dead_code)] // Native execution is Windows-only; inventory remains portable.
    Native(Arc<AtomicBool>),
}

impl SessionEntry {
    fn interactive(&self) -> Option<Arc<Session>> {
        match self {
            Self::Interactive(session) => Some(Arc::clone(session)),
            _ => None,
        }
    }
}

/// Owns a consumed reservation while setup runs outside the registry lock.
/// Once a process may exist, an unwind/error must retain its blocking entry
/// unless cleanup has actually confirmed that the child was reaped.
struct StartingSession {
    registry: Arc<Mutex<HashMap<String, SessionEntry>>>,
    id: String,
    no_process: bool,
}

impl StartingSession {
    fn attach(&mut self, session: Arc<Session>) -> Result<(), String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "pty session registry is poisoned")?;
        let entry = registry
            .get_mut(&self.id)
            .ok_or("starting pty session disappeared")?;
        if !matches!(entry, SessionEntry::Starting) {
            return Err("starting pty session was already consumed".into());
        }
        *entry = SessionEntry::Interactive(session);
        Ok(())
    }
}

impl Drop for StartingSession {
    fn drop(&mut self) {
        if self.no_process {
            // Removing this entry is a plain `HashMap::remove` - never a
            // partial insert - so a poisoned registry is taken over instead
            // of left alone (W1-15). `into_inner()` does NOT clear the
            // poison: `Mutex::lock` on this registry keeps returning `Err`
            // afterwards, and `install_when_idle`/`reserve_session` keep
            // refusing - a poisoned registry blocks installation until
            // restart either way (`poisoned_registry_never_authorizes_installation`).
            // What recovering buys here is a *consistent* map (no dead
            // `Starting` entry sitting in the inventory forever) and the
            // released PTY resources that dropping this entry's `Session`
            // triggers - not admission.
            //
            // `eprintln!` is avoided on purpose: this runs in `Drop`, which
            // can run during an unwind, and a write that itself panics
            // there aborts the process instead of merely losing a log line.
            let mut registry = self.registry.lock().unwrap_or_else(|poison| {
                let _ = writeln!(
                    std::io::stderr(),
                    "projecta: pty session registry was poisoned while reaping a failed spawn of {}; recovering to remove the stale entry",
                    self.id
                );
                poison.into_inner()
            });
            if matches!(registry.get(&self.id), Some(SessionEntry::Starting)) {
                registry.remove(&self.id);
            }
        }
    }
}

/// Owns reserved, starting, interactive and retiring sessions in one registry.
/// Registered as Tauri managed state.
#[derive(Clone)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, SessionEntry>>>,
    installation_started: Arc<AtomicBool>,
    next_id: Arc<AtomicU64>,
    on_exit: Arc<Mutex<Option<ExitHook>>>,
    on_output: Arc<Mutex<Option<OutputHook>>>,
}

impl Default for PtyManager {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            installation_started: Arc::new(AtomicBool::new(false)),
            next_id: Arc::new(AtomicU64::new(1)),
            on_exit: Arc::new(Mutex::new(None)),
            on_output: Arc::new(Mutex::new(None)),
        }
    }
}

impl PtyManager {
    /// Consume the shared reservation for one native operation. The operation
    /// must join its capture/storage tasks and complete durable final handling
    /// before returning success. Error or panic leaves reconciliation inventory.
    #[allow(dead_code)] // Used by the Windows native capture adapter.
    pub(crate) fn run_native_session(
        &self,
        session_id: &str,
        operation: impl FnOnce(Arc<AtomicBool>) -> Result<(), String>,
    ) -> Result<(), String> {
        let cancelled = Arc::new(AtomicBool::new(false));
        {
            let mut registry = self
                .sessions
                .lock()
                .map_err(|_| "pty session registry is poisoned")?;
            match registry.get_mut(session_id) {
                Some(entry @ SessionEntry::Reserved) => {
                    *entry = SessionEntry::Native(Arc::clone(&cancelled))
                }
                _ => return Err("native session reservation missing or consumed".into()),
            }
        }
        struct CancelOnDrop(Arc<AtomicBool>);
        impl Drop for CancelOnDrop {
            fn drop(&mut self) {
                self.0.store(true, Ordering::Release);
            }
        }
        let _cancel_on_drop = CancelOnDrop(Arc::clone(&cancelled));
        operation(Arc::clone(&cancelled))?;
        let mut registry = self
            .sessions
            .lock()
            .map_err(|_| "pty session registry is poisoned")?;
        if !matches!(registry.get(session_id), Some(SessionEntry::Native(current)) if Arc::ptr_eq(current, &cancelled))
        {
            return Err("native session retirement identity changed".into());
        }
        registry.remove(session_id);
        Ok(())
    }

    pub fn install_when_idle(
        &self,
        install: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let registry = self
            .sessions
            .lock()
            .map_err(|_| "pty session registry is poisoned; restart ProjectA")?;
        if self.installation_started.load(Ordering::Relaxed) {
            return Err("Installation already started; restart before starting sessions or another installation".into());
        }
        if !registry.is_empty() {
            return Err("Sessions are active or starting; wait for idle before installing".into());
        }
        // Serialized with reserve_session. Keep this latch even if the installer
        // fails or panics: it may already have replaced application files.
        self.installation_started.store(true, Ordering::Relaxed);
        // The installer can invoke app cleanup, which also accesses the registry.
        drop(registry);
        install().map_err(|error| format!("{error}; session starts remain blocked until restart"))
    }

    /// All owned sessions, including reserved/starting/retiring entries. An inventory
    /// error is never evidence of idle. This snapshot is not a maintenance lock.
    pub fn live_session_ids(&self) -> Result<Vec<String>, String> {
        let registry = self
            .sessions
            .lock()
            .map_err(|_| "pty session registry is poisoned")?;
        let mut ids: Vec<_> = registry.keys().cloned().collect();
        ids.sort();
        Ok(ids)
    }

    /// Install the hook run on the native reaper when its child exits. Success
    /// acknowledges completed bookkeeping; failure retains blocking inventory.
    pub fn set_exit_hook(
        &self,
        hook: impl Fn(&str, Option<i32>) -> Result<(), String> + Send + Sync + 'static,
    ) {
        // A whole-slot replace: a poisoned slot is taken over (W1-15c)
        // instead of dropping the hook for the rest of the process.
        *recover(&self.on_exit) = Some(Arc::new(hook));
    }

    /// Install the hook run for every chunk of output. Set once at startup.
    pub fn set_output_hook(&self, hook: impl Fn(&str, &str) + Send + Sync + 'static) {
        *recover(&self.on_output) = Some(Arc::new(hook));
    }

    fn new_session_id(&self) -> String {
        let seq = self.next_id.fetch_add(1, Ordering::Relaxed);
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis());
        format!("pty-{millis:x}-{seq}")
    }

    fn get(&self, session_id: &str) -> Result<Arc<Session>, String> {
        self.sessions
            .lock()
            .map_err(|_| "pty session registry is poisoned".to_string())?
            .get(session_id)
            .and_then(SessionEntry::interactive)
            .ok_or_else(|| format!("unknown or non-interactive pty session: {session_id}"))
    }

    /// Spawn `profile` in a fresh PTY of `cols` x `rows`, optionally in `cwd`
    /// and with extra environment (e.g. the shared ruflo memory store).
    ///
    /// The session id is created on the spot. Callers that must bind the id
    /// before the child process starts - every worker spawn - reserve it
    /// themselves and call [`PtyManager::spawn_with_id`].
    pub fn spawn(
        &self,
        app: &AppHandle,
        profile: &AgentProfile,
        cwd: Option<String>,
        cols: u16,
        rows: u16,
        env: &[(String, String)],
    ) -> Result<String, String> {
        let session_id = self.reserve_session()?;
        self.spawn_with_id(app, profile, cwd, cols, rows, env, &session_id)
    }

    /// Create a session id *before* any child process exists and hold its
    /// slot for exactly one [`PtyManager::spawn_with_id`].
    ///
    /// This is the handle the worker spawn paths close the spawn→bind race
    /// with: reserve, bind worker and session id synchronously, and only
    /// then spawn - an agent that exits milliseconds into its life is still
    /// found by the exit hook, because the binding is older than the process.
    pub fn reserve_session(&self) -> Result<String, String> {
        let session_id = self.new_session_id();
        let mut registry = self
            .sessions
            .lock()
            .map_err(|_| "pty session registry is poisoned; restart ProjectA")?;
        if self.installation_started.load(Ordering::Relaxed) {
            return Err("Installation has started; restart before starting sessions".into());
        }
        registry.insert(session_id.clone(), SessionEntry::Reserved);
        Ok(session_id)
    }

    /// Cancel only a not-yet-consumed reservation; never touches a live child.
    ///
    /// Same recovery as [`StartingSession::drop`] and the same reason: a
    /// cancellation only ever removes an entry, so a poisoned registry is
    /// taken over rather than leaving the reservation stuck in inventory.
    pub fn cancel_reservation(&self, session_id: &str) {
        let mut registry = self.sessions.lock().unwrap_or_else(|poison| {
            eprintln!(
                "projecta: pty session registry was poisoned while canceling {session_id}; recovering to remove the stale reservation"
            );
            poison.into_inner()
        });
        if matches!(
            registry.get(session_id),
            Some(SessionEntry::Reserved | SessionEntry::CancelledReservation)
        ) {
            registry.remove(session_id);
        }
    }

    fn begin_spawn(&self, session_id: &str) -> Result<StartingSession, String> {
        let mut registry = self
            .sessions
            .lock()
            .map_err(|_| "pty session registry is poisoned")?;
        match registry.get_mut(session_id) {
            Some(entry @ SessionEntry::Reserved) => *entry = SessionEntry::Starting,
            _ => {
                return Err(format!(
                    "unknown or already consumed pty session reservation: {session_id}"
                ))
            }
        }
        Ok(StartingSession {
            registry: Arc::clone(&self.sessions),
            id: session_id.into(),
            no_process: true,
        })
    }

    /// Spawn `profile` under a session id reserved with
    /// [`PtyManager::reserve_session`]. The reservation is consumed either
    /// way: on success it becomes interactive. Confirmed no-process failures
    /// remove the entry; uncertain child cleanup retains the starting entry so
    /// inventory cannot authorize an update or a duplicate spawn.
    #[allow(clippy::too_many_arguments)]
    pub fn spawn_with_id(
        &self,
        app: &AppHandle,
        profile: &AgentProfile,
        cwd: Option<String>,
        cols: u16,
        rows: u16,
        env: &[(String, String)],
        session_id: &str,
    ) -> Result<String, String> {
        let mut starting = self.begin_spawn(session_id)?;

        let size = PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = native_pty_system()
            .openpty(size)
            .map_err(|e| format!("failed to open pty: {e}"))?;

        let mut cmd = build_command(profile);
        if let Some(dir) = cwd {
            if !dir.is_empty() {
                cmd.cwd(dir);
            }
        }
        let gh_config_dir = agent_env::gh_config_dir(app, session_id);
        agent_env::apply(&mut cmd, profile, env, gh_config_dir.as_deref())?;

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("failed to spawn '{}': {e}", profile.command))?;
        starting.no_process = false;

        // Drop the slave handle so the reader sees EOF once the child exits.
        drop(pair.slave);

        // From here on the child exists, so an error path may not just
        // return: the process would keep running with no reader, no reaper
        // and no registry entry - an agent nobody watches and nothing kills.
        let reader = match pair.master.try_clone_reader() {
            Ok(reader) => reader,
            Err(err) => {
                starting.no_process = abort_failed_spawn(&mut *child);
                return Err(format!("failed to clone pty reader: {err}"));
            }
        };
        let writer = match pair.master.take_writer() {
            Ok(writer) => writer,
            Err(err) => {
                starting.no_process = abort_failed_spawn(&mut *child);
                return Err(format!("failed to take pty writer: {err}"));
            }
        };
        let killer = child.clone_killer();

        let session_id = session_id.to_string();
        let scrollback = Arc::new(Mutex::new(Scrollback::new()));
        let last_output = Arc::new(Mutex::new(None));
        let submit_guard_cancelled = Arc::new(AtomicBool::new(false));

        let session = Arc::new(Session {
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            killer: Mutex::new(killer),
            scrollback: Arc::clone(&scrollback),
            last_output: Arc::clone(&last_output),
            submit_guard_cancelled: Arc::clone(&submit_guard_cancelled),
            delivery_turns: Arc::new(DeliveryTurns::default()),
            trace: SessionTrace::open(&session_id),
        });

        // Keep the pseudoconsole alive until failed insertion has killed and
        // reaped the child; dropping its last master handle can itself block.
        if let Err(error) = starting.attach(Arc::clone(&session)) {
            starting.no_process = abort_failed_spawn(&mut *child);
            return Err(error);
        }

        let reader_finished = spawn_reader_thread(
            app.clone(),
            session_id.clone(),
            reader,
            scrollback,
            last_output,
            Arc::clone(&self.on_output),
            Arc::downgrade(&session),
        );

        // Reap the child on its own thread so that `kill_pty` never blocks on `wait`.
        let sessions = Arc::clone(&self.sessions);
        let on_exit = Arc::clone(&self.on_exit);
        let exit_app = app.clone();
        let exit_id = session_id.clone();
        let exit_guard_cancelled = Arc::clone(&submit_guard_cancelled);
        std::thread::spawn(move || {
            // Windows exit codes are u32 (e.g. 0xC000013A for Ctrl-C); the cast
            // keeps the bit pattern so the frontend sees the usual signed form.
            let result = dispatch_confirmed_exit(child.wait(), |code| {
                exit_guard_cancelled.store(true, Ordering::Release);

                // Let the app record the exit (worker status) before the UI hears
                // about it. The hook is cloned out of the lock so a slow hook never
                // blocks `set_exit_hook`.
                let persistence = complete_exit_hook(&on_exit, &exit_id, code);

                // Take the session out under the lock, but drop it outside: closing
                // the pseudoconsole can block, and holding the registry lock while
                // that happens would stall every other pty command.
                if let Err(error) =
                    remove_exited_session_after_reader(&sessions, &exit_id, persistence, || {
                        await_reader_retirement(&reader_finished, READER_RETIREMENT_TIMEOUT)
                    })
                {
                    eprintln!(
                        "projecta: session {exit_id} retirement requires reconciliation: {error}"
                    );
                }
                let _ = exit_app.emit(&format!("pty:exit:{exit_id}"), ExitPayload { code });
            });
            if let Err(error) = result {
                exit_guard_cancelled.store(true, Ordering::Release);
                eprintln!("projecta: session {exit_id} exit requires reconciliation: {error}");
            }
        });

        Ok(session_id)
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
        let session = self.get(session_id)?;
        write_session(&session, data)
    }

    /// Input typed by the user into this session (the terminal view).
    ///
    /// Written like [`PtyManager::write`]; once it has landed, input that
    /// sends or empties the line - Enter (`\r`), Ctrl-U, Ctrl-C, after the
    /// last text ([`InputScan`]) - clears the session's
    /// dirty input line, so deliveries may type again. Other keys
    /// (a letter, a cursor key) leave an earlier task in place and do not
    /// (reviews GLM-5.3 X3, DeepSeek X2). Automatic paths such as worker
    /// messages or diff comments use `write` and never clear it. The chunk
    /// is read by [`InputScan`], across chunk boundaries. Known limit: an
    /// Enter that a dialog swallows clears the flag although the old text
    /// stays - what a key does is up to the TUI (W1-03d review).
    pub fn write_user_input(&self, session_id: &str, data: &str) -> Result<(), String> {
        let session = self.get(session_id)?;
        let mut writer = lock_writer(&session)?;
        session.delivery_turns.user_write(&mut writer, data, |pty| {
            write_to(&session, &mut **pty, data.as_bytes())
        })
    }

    /// Start the non-blocking task delivery guard, armed with the agent
    /// profile's readiness marker when it knows one.
    ///
    /// The task is written once the TUI proves its input loop is alive -
    /// either by showing the profile's `readiness_marker` (OpenCode's "Ask
    /// anything", see NT-17: silence alone is *not* readiness, because
    /// OpenCode flushes ConPTY input written before its loop runs) or, for
    /// profiles without a marker, once the opening burst has been quiet for
    /// three seconds (30s at most). The write goes without a trailing Enter,
    /// which some TUIs swallow when it shares a write with the text. Delivery
    /// is then *proven from content*: the TUI must echo the task (else the
    /// write is repeated), Enter travels as its own write, and only output
    /// after that Enter counts as delivered. A known blocking dialog
    /// (workspace trust) is answered on sight, because it swallows anything
    /// typed into it. Killing, exiting or archiving the session stops the
    /// guard.
    ///
    /// C-3: deliveries to one session take turns (see [`DeliveryTurns`]).
    /// A second call waits until the first delivery has ended, and its
    /// clocks and write baseline start only with its own turn. The turn ends
    /// with the previous guard's terminal event - for a delivered task that
    /// is the first output after its Enter, not the end of the agent's work;
    /// from there the next guard's own readiness rules decide when it types.
    /// A delivery that has to wait first reports `Queued { ahead }`. A guard
    /// that gives up while waiting (session killed or gone) reports
    /// `Escalated`. The dirty-input flag belongs to the session: every later
    /// delivery reports `InputBlocked` and escalates without writing until
    /// the user sends or empties the line ([`PtyManager::write_user_input`]).
    /// A kill is final: a guard started after it escalates without typing.
    pub fn start_submit_guard<F>(
        &self,
        session_id: &str,
        task: String,
        readiness_marker: Option<&str>,
        on_event: F,
    ) -> Result<(), String>
    where
        F: Fn(SubmitGuardEvent) + Send + Sync + 'static,
    {
        let session = self.get(session_id)?;

        // C-3: join the session's delivery queue here, on the caller's
        // thread, so two deliveries keep the order they were started in.
        let turn = session.delivery_turns.join();

        let session_id = session_id.to_string();
        let sessions = Arc::clone(&self.sessions);
        let on_event = Arc::new(on_event);
        let readiness_marker = readiness_marker.unwrap_or_default().to_string();
        std::thread::spawn(move || {
            // Killed or gone: the caller still hears that its text was not
            // delivered, and why (reviews A1, GLM-5.3 X1/X2, DeepSeek X1),
            // instead of an outcome that never fires.
            let session_ended = || {
                on_event(SubmitGuardEvent::SessionEnded);
                on_event(SubmitGuardEvent::Escalated);
            };
            // Wait until every earlier delivery to this session has ended.
            // The guard ahead is still typing, or waiting for its echo or
            // its Enter to land; a second guard writing now would put both
            // texts into one input line. `turn` leaves the queue on every
            // return below. Liveness is checked once more after the turn
            // arrives: a kill that let the guard ahead return also hands the
            // turn over, and this guard must still report, not go silent.
            let mut my_turn = false;
            let mut announced = false;
            loop {
                let alive = live_interactive(&sessions, &session_id)
                    .is_some_and(|session| !session.submit_guard_cancelled.load(Ordering::Acquire));
                if !alive {
                    session_ended();
                    return;
                }
                // Review B2: say that this delivery waits, instead of
                // leaving the caller on the previous guard's last event for
                // minutes - once the session is known to be alive (review
                // DeepSeek X2: a dead session queues nothing).
                if !announced && turn.ahead > 0 {
                    on_event(SubmitGuardEvent::Queued { ahead: turn.ahead });
                }
                announced = true;
                if my_turn {
                    break;
                }
                my_turn = turn.wait(Duration::from_millis(100));
            }
            if turn.input_dirty() {
                eprintln!(
                    "projecta: submit guard escalated ({session_id}): an earlier delivery left its task in the input line"
                );
                on_event(SubmitGuardEvent::InputBlocked);
                on_event(SubmitGuardEvent::Escalated);
                return;
            }

            // The guard's clocks start with its turn, not with its call: the
            // readiness and echo deadlines must not be spent waiting behind
            // another delivery.
            let mut guard =
                SubmitGuard::new(Instant::now(), &task).with_readiness_marker(&readiness_marker);
            // The write baseline, an absolute position on the scrollback's
            // `total_pushed` counter: set at guard start, moved past every
            // task write (including rewrites) and every dialog answer that
            // dismisses its dialog before the first write (W1-01a). All
            // content proofs - echo, readiness marker, answer marker - search
            // only the output after it, so leftovers from before can never
            // count.
            let mut write_mark: Option<u64> = None;
            let mut task_typed = false;

            loop {
                let Some(session) = live_interactive(&sessions, &session_id) else {
                    session_ended();
                    return;
                };
                if session.submit_guard_cancelled.load(Ordering::Acquire) {
                    session_ended();
                    return;
                }

                // Tail and byte counter from ONE lock: reading the ring and
                // a separate counter in sequence could straddle an 8 KiB
                // read chunk and disagree about what is "new".
                let (tail_bytes, tail_start, output_bytes) =
                    recover(&session.scrollback).snapshot(GUARD_TAIL_BYTES);
                let last_output = *recover(&session.last_output);
                let mark = *write_mark.get_or_insert(output_bytes);
                let (since_bytes, window_overflowed) =
                    tail_since_mark(&tail_bytes, tail_start, mark);
                // Partial UTF-8 at the cut is handled like the ring's own
                // lossy decoding: from_utf8_lossy, then normalize.
                let normalized = crate::submit_guard::normalize_tui_output(
                    &String::from_utf8_lossy(&tail_bytes),
                );
                let since_normalized = crate::submit_guard::normalize_tui_output(
                    &String::from_utf8_lossy(since_bytes),
                );
                let obs = Observation {
                    now: Instant::now(),
                    output_bytes,
                    last_output,
                    tail: &normalized,
                    tail_since_write: &since_normalized,
                    write_window_overflowed: window_overflowed,
                };

                let action = guard.tick(&obs);
                // Record whether the task may still be in the input line
                // *before* performing the action, so a panic or failed write
                // is covered by the turn's drop.
                let typing = matches!(action, Some(SubmitAction::WriteTask { .. }));
                // A task write is recorded by `type_task`, right before its
                // bytes go out: a guard that dies before that has typed
                // nothing (review round two, DeepSeek X2).
                if !typing {
                    turn.note_input(guard.input_pending(), false);
                }

                match action {
                    Some(SubmitAction::WriteTask { write }) => {
                        on_event(SubmitGuardEvent::Wrote { write });
                        let typed = lock_writer(&session).and_then(|mut writer| {
                            turn.type_task(&mut writer, |pty| {
                                write_to(&session, &mut **pty, task.as_bytes())
                            })
                        });
                        if typed.is_err() {
                            on_event(SubmitGuardEvent::Escalated);
                            return;
                        }
                        task_typed = true;
                        // The mark moves past this write: only output after
                        // it can prove the echo.
                        write_mark = Some(recover(&session.scrollback).position());
                    }
                    Some(SubmitAction::SendEnter { attempt }) => {
                        on_event(SubmitGuardEvent::Enter { attempt });
                        if write_session(&session, "\r").is_err() {
                            on_event(SubmitGuardEvent::Escalated);
                            return;
                        }
                    }
                    Some(SubmitAction::AnswerDialog(kind)) => {
                        on_event(SubmitGuardEvent::DialogAnswered);
                        if write_session(&session, kind.keystrokes()).is_err() {
                            on_event(SubmitGuardEvent::Escalated);
                            return;
                        }
                        // A dismissed dialog is history: without the move its
                        // text stays in the guard's window and is answered
                        // again into the empty composer (smoke 8, W1-01a).
                        // Only before the task is typed: after it the guard
                        // already searches dialogs since the write, and a
                        // move there could put an echo that arrived between
                        // snapshot and answer behind the baseline - a rewrite
                        // into a line that holds the task (review kimi-k3 1).
                        if kind.dismisses() && !task_typed {
                            write_mark = Some(recover(&session.scrollback).position());
                        }
                    }
                    Some(SubmitAction::ConfirmDelivery) => {
                        // Marker-confirmed delivery ends the guard as
                        // delivered; the `is_done` check below carries the
                        // Delivered event.
                    }
                    Some(SubmitAction::Escalate) => {
                        if let Some(reason) = guard.escalation_reason() {
                            eprintln!(
                                "projecta: submit guard escalated ({session_id}): {reason:?}"
                            );
                        }
                        on_event(SubmitGuardEvent::Escalated);
                        return;
                    }
                    None => {}
                }
                if guard.is_done() {
                    if guard.is_delivered() {
                        on_event(SubmitGuardEvent::Delivered);
                    }
                    return;
                }

                std::thread::sleep(Duration::from_millis(100));
            }
        });
        Ok(())
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let session = self.get(session_id)?;
        let master = session
            .master
            .lock()
            .map_err(|_| "pty master is poisoned".to_string())?;
        master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("failed to resize pty: {e}"))
    }

    /// Kill the child. The reaper thread then removes the session and emits
    /// `pty:exit:<session_id>`.
    pub fn kill(&self, session_id: &str) -> Result<(), String> {
        {
            let mut registry = self
                .sessions
                .lock()
                .map_err(|_| "pty session registry is poisoned")?;
            if let Some(entry @ (SessionEntry::Reserved | SessionEntry::CancelledReservation)) =
                registry.get_mut(session_id)
            {
                *entry = SessionEntry::CancelledReservation;
                return Ok(());
            }
            if let Some(SessionEntry::Native(cancelled)) = registry.get(session_id) {
                cancelled.store(true, Ordering::Release);
                return Ok(());
            }
        }
        let session = self.get(session_id)?;
        session
            .submit_guard_cancelled
            .store(true, Ordering::Release);
        let mut killer = session
            .killer
            .lock()
            .map_err(|_| "pty killer is poisoned".to_string())?;
        killer
            .kill()
            .map_err(|e| format!("failed to kill pty session: {e}"))
    }

    pub fn scrollback(&self, session_id: &str) -> Result<String, String> {
        let session = self.get(session_id)?;
        let scrollback = session
            .scrollback
            .lock()
            .map_err(|_| "pty scrollback is poisoned".to_string())?;
        Ok(scrollback.to_lossy_string())
    }

    /// Kill every session, so app shutdown never orphans an agent process.
    pub fn kill_all(&self) {
        // Shutdown recovers a poisoned registry (W1-15b): returning here
        // left every agent process running after the app was gone. The loop
        // only flags and collects, so a recovered map is safe to walk.
        // `live_session_ids` deliberately stays an error under poison (W1-15):
        // a wrong "idle" would admit an installation, a missed kill cannot.
        let mut map = self.sessions.lock().unwrap_or_else(|poison| {
            eprintln!("projecta: pty session registry was poisoned during shutdown; killing sessions anyway");
            poison.into_inner()
        });
        let sessions: Vec<Arc<Session>> = map
            .values_mut()
            .filter_map(|entry| {
                if matches!(entry, SessionEntry::Reserved) {
                    *entry = SessionEntry::CancelledReservation;
                }
                if let SessionEntry::Native(cancelled) = entry {
                    cancelled.store(true, Ordering::Release);
                }
                entry.interactive()
            })
            .collect();
        drop(map);
        for session in sessions {
            session
                .submit_guard_cancelled
                .store(true, Ordering::Release);
            let _ = session
                .killer
                .lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .kill();
        }
    }

    /// [`PtyManager::kill_all`], then give the reaper threads up to `grace`
    /// to collect their children and fire the exit hooks: a hook is what
    /// closes the session's row and flips its worker, and a kill without
    /// the wait leaves both open - `ended_at NULL` and a lost exit code.
    pub fn kill_all_and_wait(&self, grace: Duration) {
        self.kill_all();
        let deadline = Instant::now() + grace;
        loop {
            let remaining = match self.live_session_ids() {
                Ok(ids) => ids.len(),
                Err(error) => {
                    eprintln!("projecta: cannot confirm session shutdown: {error}");
                    return;
                }
            };
            if remaining == 0 {
                return;
            }
            if Instant::now() >= deadline {
                eprintln!(
                    "projecta: {remaining} pty session(s) still not reaped after {grace:?}; exiting anyway"
                );
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

fn complete_exit_hook(
    hooks: &Mutex<Option<ExitHook>>,
    session: &str,
    code: Option<i32>,
) -> Result<(), String> {
    let hook = hooks
        .lock()
        .map_err(|_| "exit hook registry is poisoned")?
        .clone();
    match hook {
        Some(hook) => hook(session, code),
        None => Ok(()),
    }
}

#[cfg(test)]
fn remove_exited_session(
    sessions: &Mutex<HashMap<String, SessionEntry>>,
    session_id: &str,
    persistence: Result<(), String>,
) -> Result<(), String> {
    remove_exited_session_after_reader(sessions, session_id, persistence, || Ok(()))
}

fn remove_exited_session_after_reader(
    sessions: &Mutex<HashMap<String, SessionEntry>>,
    session_id: &str,
    persistence: Result<(), String>,
    reader_finished: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    // Both locks below only ever move or remove *this* session's own entry
    // (mark it `Retiring`, then remove it once retirement is confirmed), so a
    // poisoned registry is taken over rather than left alone (W1-15).
    // `into_inner()` does NOT clear the poison - `install_when_idle` and
    // `reserve_session` keep refusing afterwards
    // (`poisoned_registry_never_authorizes_installation`), so this does not
    // unblock installation. What it buys is a consistent map: the exited
    // session is real and gone, and leaving its entry behind would keep a
    // dead process's bookkeeping in the inventory (and its PTY resources
    // unreleased) on top of the poison, instead of just the poison.
    let removed = {
        let mut registry = sessions.lock().unwrap_or_else(|poison| {
            eprintln!(
                "projecta: pty session registry was poisoned while reaping exited session {session_id}; recovering to continue the reap"
            );
            poison.into_inner()
        });
        let entry = registry
            .get_mut(session_id)
            .ok_or("exited session missing")?;
        if matches!(entry, SessionEntry::Retiring) {
            return Err("session retirement already consumed; reconcile".into());
        }
        std::mem::replace(entry, SessionEntry::Retiring)
    };
    // Release registry-owned PTY resources outside the mutex while inventory
    // remains nonempty. Closing the master may be necessary to end ConPTY reads.
    drop(removed);
    let reader_result = reader_finished();
    persistence?;
    reader_result?;
    let mut registry = sessions.lock().unwrap_or_else(|poison| poison.into_inner());
    if !matches!(registry.get(session_id), Some(SessionEntry::Retiring)) {
        return Err("session retirement identity changed".into());
    }
    registry.remove(session_id);
    Ok(())
}

fn dispatch_confirmed_exit(
    status: std::io::Result<portable_pty::ExitStatus>,
    confirmed: impl FnOnce(Option<i32>),
) -> Result<(), String> {
    let status =
        status.map_err(|error| format!("native wait did not confirm process exit: {error}"))?;
    confirmed(Some(status.exit_code() as i32));
    Ok(())
}

/// Kill and reap a child whose session setup failed after the process had
/// already started. An early return without this leaves the agent running
/// with no reader, no reaper and no registry entry - a process nobody
/// watches and nothing can kill.
fn abort_failed_spawn(child: &mut (dyn Child + Send + Sync)) -> bool {
    if let Err(err) = child.kill() {
        eprintln!("projecta: failed to kill a half-started pty child: {err}");
    }
    if let Err(err) = child.wait() {
        eprintln!("projecta: failed to reap a half-started pty child: {err}");
        return false;
    }
    true
}

const PASTE_START: &str = "\u{1b}[200~";
const PASTE_END: &str = "\u{1b}[201~";

/// Reads the user's input chunk by chunk and tells whether the input line
/// is empty after a chunk: the last Enter (`\r`), Ctrl-U or Ctrl-C in it
/// comes after the last text. xterm sends a multi-line paste as one chunk
/// (`first\rsecond`), and a bracketed paste (`ESC[200~ ... ESC[201~`) is text
/// as a whole, returns included (Codex review, PR #81). A paste or escape
/// sequence split between two chunks is carried over (review round two,
/// GLM-5.3 X2). Other escape sequences and Backspace/Delete add no text;
/// Alt-Enter (`ESC\r`) does not count as Enter - the conservative side.
#[derive(Default)]
struct InputScan {
    in_paste: bool,
    /// An escape sequence or paste end marker cut off at the end of the
    /// last chunk.
    partial: String,
}

impl InputScan {
    /// Longer than any sequence this scanner reads; a longer carry is noise.
    const MAX_PARTIAL: usize = 16;

    fn feed(&mut self, data: &str) -> bool {
        let joined = std::mem::take(&mut self.partial) + data;
        let mut rest = joined.as_str();
        let mut empty = false;
        while !rest.is_empty() {
            if self.in_paste {
                match rest.find(PASTE_END) {
                    Some(end) => {
                        if end > 0 {
                            empty = false;
                        }
                        self.in_paste = false;
                        rest = &rest[end + PASTE_END.len()..];
                    }
                    None => {
                        // Keep a cut-off end marker for the next chunk.
                        let keep = (1..PASTE_END.len())
                            .rev()
                            .find(|&n| rest.ends_with(&PASTE_END[..n]))
                            .unwrap_or(0);
                        if rest.len() > keep {
                            empty = false;
                        }
                        self.partial = rest[rest.len() - keep..].to_string();
                        rest = "";
                    }
                }
                continue;
            }
            if let Some(after) = rest.strip_prefix(PASTE_START) {
                self.in_paste = true;
                rest = after;
                continue;
            }
            let Some(c) = rest.chars().next() else { break };
            if c == '\u{1b}' {
                match escape_len(rest) {
                    Some(len) => rest = &rest[len..],
                    None => {
                        if rest.len() <= Self::MAX_PARTIAL {
                            self.partial = rest.to_string();
                        }
                        rest = "";
                    }
                }
                continue;
            }
            match c {
                // Enter is `\r`; `\n` (Ctrl-J) is a newline inside a
                // multi-line composer, and a Tab inserts text or completes
                // a word - both keep the line (review round three).
                '\r' | '\u{15}' | '\u{3}' => empty = true,
                '\n' | '\t' => empty = false,
                '\u{7f}' | '\u{8}' => {}
                c if c.is_control() => {}
                _ => empty = false,
            }
            rest = &rest[c.len_utf8()..];
        }
        empty
    }
}

/// The length of the escape sequence at the start of `rest` (which starts
/// with ESC), or `None` when the chunk ends inside it: CSI up to its final
/// byte, SS3 (`ESC O A`, a cursor key in application mode) with its one
/// character, any other ESC with the character after it.
fn escape_len(rest: &str) -> Option<usize> {
    let seq = &rest[1..];
    let body = if let Some(csi) = seq.strip_prefix('[') {
        1 + csi.find(|ch: char| ('\u{40}'..='\u{7e}').contains(&ch))? + 1
    } else if let Some(ss3) = seq.strip_prefix('O') {
        1 + ss3.chars().next()?.len_utf8()
    } else {
        seq.chars().next()?.len_utf8()
    };
    Some(1 + body)
}

fn write_session(session: &Session, data: &str) -> Result<(), String> {
    write_session_bytes(session, data.as_bytes())
}

fn write_session_bytes(session: &Session, data: &[u8]) -> Result<(), String> {
    let mut writer = lock_writer(session)?;
    write_to(session, &mut **writer, data)
}

/// The PTY's input side, locked as one for every write.
type PtyWriter = Box<dyn Write + Send>;

fn lock_writer(session: &Session) -> Result<MutexGuard<'_, PtyWriter>, String> {
    session
        .writer
        .lock()
        .map_err(|_| "pty writer is poisoned".to_string())
}

/// Write `data` through a writer the caller has locked.
fn write_to(session: &Session, writer: &mut (dyn Write + Send), data: &[u8]) -> Result<(), String> {
    if let Some(trace) = &session.trace {
        trace.note("in", data);
    }
    writer
        .write_all(data)
        .map_err(|e| format!("failed to write to pty: {e}"))?;
    writer
        .flush()
        .map_err(|e| format!("failed to flush pty: {e}"))
}

/// Cut the post-baseline slice out of one scrollback snapshot: the output
/// since the write mark `mark`, given the tail bytes and the absolute position
/// of the tail's first byte. Returns the whole tail plus `true` when more
/// output than the window holds arrived since the mark (the echo may have
/// scrolled out already).
///
/// The offset is clamped to the tail length (C-6): a poisoned scrollback lock
/// degrades the snapshot to `(vec![], 0, 0)` while the mark keeps its last
/// value, and the unclamped offset then indexes past the end of the empty
/// slice - a panic in the guard thread where the old code kept running with
/// an empty tail.
fn tail_since_mark(tail: &[u8], tail_start: u64, mark: u64) -> (&[u8], bool) {
    match mark.checked_sub(tail_start) {
        Some(offset) => (&tail[(offset as usize).min(tail.len())..], false),
        None => (tail, true),
    }
}

/// Acknowledgement is sent only after the reader closure and its owned handles
/// have been dropped. Panic disconnects the channel; it cannot acknowledge idle.
fn track_reader_retirement(work: impl FnOnce() + Send + 'static) -> std::sync::mpsc::Receiver<()> {
    let (finished_tx, finished_rx) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        work();
        let _ = finished_tx.send(());
    });
    finished_rx
}

fn await_reader_retirement(
    finished: &std::sync::mpsc::Receiver<()>,
    timeout: Duration,
) -> Result<(), String> {
    finished
        .recv_timeout(timeout)
        .map_err(|error| format!("PTY reader retirement unconfirmed: {error}"))
}

/// The terminal's answer to a cursor-position report (`ESC[6n`): row 1,
/// column 1. Any plausible position does - the TUIs that ask use the reply
/// to find out *whether* a terminal is listening, and lay out a full screen
/// of their own right after.
const CURSOR_POSITION_REPLY: &[u8] = b"\x1b[1;1R";

/// Finds cursor-position reports (`ESC[6n`) in a byte stream, across read
/// chunks (W1-01).
///
/// ConPTY passes the query through to whatever reads the master side and
/// never answers it itself. Inside the app the only thing that ever replied
/// was an attached xterm.js view - and a worker spawned from the CLI or the
/// queue has none. Kimi Code 0.43.0 blocks its *entire* startup on that reply
/// (captured 2026-09-16: four bytes, then 200 s of silence), so the submit
/// guard met a process that had rendered nothing and consumed nothing, read
/// the silence as "settled" and typed three copies of the task into a
/// blocked stdin. The reader thread now answers the query itself.
#[derive(Debug, Default)]
pub(crate) struct CursorReportScanner {
    /// How many bytes of the query were matched at the end of the previous
    /// chunk (0..=3): the four-byte sequence may straddle two reads.
    matched: usize,
}

impl CursorReportScanner {
    const QUERY: &'static [u8] = b"\x1b[6n";

    /// Feed one chunk; returns how many complete queries it contained.
    pub(crate) fn feed(&mut self, bytes: &[u8]) -> usize {
        let mut found = 0;
        for &byte in bytes {
            if byte == Self::QUERY[self.matched] {
                self.matched += 1;
                if self.matched == Self::QUERY.len() {
                    found += 1;
                    self.matched = 0;
                }
            } else {
                // A mismatch restarts the match - and the byte may itself be
                // the query's first byte (`ESC ESC [6n`).
                self.matched = usize::from(byte == Self::QUERY[0]);
            }
        }
        found
    }
}

/// Set after the first poisoned lock taken over by [`recover`].
static PTY_POISON_LOGGED: AtomicBool = AtomicBool::new(false);

/// Lock a session-side slot, taking it over if a panic poisoned it (W1-15c,
/// the pattern of W1-15/W1-15b). Every caller only reads, replaces a whole
/// value or appends one chunk, so the taken-over state is consistent; the old
/// silent drop instead lost hooks, output and trace lines, and made a live
/// session look gone to the submit guard, for the rest of the process.
/// Logged once: the reader calls this on every chunk. The poison flag stays
/// set, so the registry paths that refuse poison (`install_when_idle`,
/// `reserve_session`, `live_session_ids`) keep refusing. `writeln!` instead
/// of `eprintln!`: a failing stderr must not panic a reader or guard thread.
fn recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| {
        if !PTY_POISON_LOGGED.swap(true, Ordering::Relaxed) {
            let _ = writeln!(
                std::io::stderr(),
                "projecta: a pty session lock was poisoned; recovering (further occurrences are not logged)"
            );
        }
        poison.into_inner()
    })
}

/// The submit guard's view of its session: the interactive entry while it is
/// registered, `None` once it is gone. A read only, so a poisoned registry
/// is taken over (W1-15c) instead of ending a live delivery as `SessionEnded`.
fn live_interactive(
    sessions: &Mutex<HashMap<String, SessionEntry>>,
    session_id: &str,
) -> Option<Arc<Session>> {
    recover(sessions)
        .get(session_id)
        .and_then(SessionEntry::interactive)
}

/// Reader thread: keep one chunk of output in the session's scrollback.
fn record_output(scrollback: &Mutex<Scrollback>, bytes: &[u8]) {
    recover(scrollback).push(bytes);
}

/// Reader thread: stamp a decoded chunk as the session's latest output and
/// return the output hook to run for it. The hook is cloned out of the lock
/// so a slow hook cannot block `set_output_hook` - and the status engine
/// sees the chunk before the UI does, as with the exit hook.
fn stamp_output(
    last_output: &Mutex<Option<Instant>>,
    on_output: &Mutex<Option<OutputHook>>,
) -> Option<OutputHook> {
    *recover(last_output) = Some(Instant::now());
    recover(on_output).clone()
}

fn spawn_reader_thread(
    app: AppHandle,
    session_id: String,
    mut reader: Box<dyn Read + Send>,
    scrollback: Arc<Mutex<Scrollback>>,
    last_output: Arc<Mutex<Option<Instant>>>,
    on_output: Arc<Mutex<Option<OutputHook>>>,
    // Weak: the reader must not keep the pseudoconsole alive past the
    // registry; it only needs the writer while the session still exists.
    replier: std::sync::Weak<Session>,
) -> std::sync::mpsc::Receiver<()> {
    track_reader_retirement(move || {
        let event = format!("pty:output:{session_id}");
        let mut decoder = Utf8Stream::new();
        let mut buf = vec![0u8; READ_CHUNK];
        let mut cursor_reports = CursorReportScanner::default();

        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let bytes = &buf[..n];
                    record_output(&scrollback, bytes);
                    if let Some(session) = replier.upgrade() {
                        if let Some(trace) = &session.trace {
                            trace.note("out", bytes);
                        }
                    }
                    // Answer the terminal query before anything else sees the
                    // chunk: a TUI blocked on it produces nothing further,
                    // and the guard's silence heuristic must not meet that.
                    let queries = cursor_reports.feed(bytes);
                    if queries > 0 {
                        if let Some(session) = replier.upgrade() {
                            for _ in 0..queries {
                                if let Err(err) =
                                    write_session_bytes(&session, CURSOR_POSITION_REPLY)
                                {
                                    eprintln!(
                                        "projecta: cursor-position reply failed ({session_id}): {err}"
                                    );
                                }
                            }
                        }
                    }
                    let chunk = decoder.push(bytes);
                    if chunk.is_empty() {
                        continue;
                    }
                    if let Some(hook) = stamp_output(&last_output, &on_output) {
                        hook(&session_id, &chunk);
                    }
                    if app.emit(&event, chunk).is_err() {
                        break;
                    }
                }
            }
        }
    })
}

/// Build the `CommandBuilder` for a profile.
///
/// On Windows the agent CLIs are usually npm shims (`claude.cmd`), which
/// `CreateProcess` cannot execute directly. Where the shim can be read
/// ([`resolve_cmd_shim`]) it is replaced by the interpreter and script it would
/// have started, so the arguments reach that process the way `CreateProcess`
/// passes them and nothing else looks at them. Only a shim this module cannot
/// make sense of still goes through `%COMSPEC% /C` - see
/// [`resolve_cmd_shim`] for what that route costs.
fn build_command(profile: &AgentProfile) -> CommandBuilder {
    #[cfg(windows)]
    if let Some(path) = resolve_windows_program(&profile.command) {
        let (program, prefix) = windows_invocation(&path);
        let mut cmd = CommandBuilder::new(program.as_os_str());
        for arg in prefix {
            cmd.arg(arg);
        }
        for arg in &profile.args {
            cmd.arg(arg);
        }
        return cmd;
    }

    let mut cmd = CommandBuilder::new(&profile.command);
    for arg in &profile.args {
        cmd.arg(arg);
    }
    cmd
}

/// How a resolved Windows program is actually started: the executable, plus
/// whatever has to sit in front of the caller's own arguments.
///
/// Three cases, in the order they are preferred:
///
/// * a real executable - started as it is;
/// * a `.cmd`/`.bat` shim this module can read - replaced by the interpreter
///   and script it would have launched, so no second parser sees the argv;
/// * any other shim - `%COMSPEC% /C <shim>`, which is the only way to start a
///   batch file at all and the reason [`resolve_cmd_shim`] exists.
#[cfg(windows)]
pub(crate) fn windows_invocation(
    path: &std::path::Path,
) -> (std::path::PathBuf, Vec<std::ffi::OsString>) {
    if !is_batch_shim(path) {
        return (path.to_path_buf(), Vec::new());
    }
    if let Some((program, prefix)) = resolve_cmd_shim(path) {
        return (program, prefix);
    }
    let comspec = std::env::var_os("COMSPEC")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("cmd.exe"));
    (
        comspec,
        vec![
            std::ffi::OsString::from("/C"),
            path.as_os_str().to_os_string(),
        ],
    )
}

/// Whether `path` is a batch file, which `CreateProcess` refuses to run.
#[cfg(windows)]
fn is_batch_shim(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"))
}

/// Read an npm-style `.cmd` shim and return the program and leading arguments
/// it would have run, so it can be started without `cmd.exe` in between.
///
/// **Why this exists at all.** `%COMSPEC% /C <shim> <args...>` hands the whole
/// argument list to `cmd.exe`, and `cmd.exe` parses a command line by rules
/// nobody else uses. `portable_pty`'s `CommandBuilder` quotes each argument
/// with the CRT convention every normal Windows program is parsed by
/// (`ArgvQuote`): an embedded `"` becomes `\"`. `cmd.exe` does not know that
/// escape - it only counts quotes - so a single quotation mark inside an
/// argument ends the quoted run there and everything after it is re-tokenised
/// as syntax. `%NAME%` is expanded on top of that, inside quotes as well as
/// outside, and there is no escape on a command line that prevents it.
///
/// That matters because ProjectA puts human text on that command line: a role
/// addition, a coordinator's marching orders, and the project playbook all
/// travel as `--append-system-prompt <text>` for profiles whose
/// [`SystemPrompt`](crate::capabilities::SystemPrompt) is `Arg`. A quoted file
/// name or a pasted error message in approved text is enough to take the
/// command line apart.
///
/// Escaping our way out is not available: the text would have to survive
/// `cmd.exe`, then the batch file's own `%*` re-expansion, then the CRT parse
/// in the program underneath - and the `%NAME%` expansion in the middle has no
/// escape at all. Removing the interpreter is the only fix that leaves the
/// text alone, which is what this does.
///
/// The parsing itself - which line of the script counts, how it is
/// tokenised, what is refused - is [`parse_shim_invocation`], pure string
/// work that runs under every platform's test gate. What stays here is the
/// file read and the `PATH` lookup, the two steps that need a real Windows
/// environment (and with them the refusal of a program that is not on disk).
#[cfg(windows)]
pub(crate) fn resolve_cmd_shim(
    shim: &std::path::Path,
) -> Option<(std::path::PathBuf, Vec<std::ffi::OsString>)> {
    use std::ffi::OsString;

    let dir = shim.parent()?;
    let script = std::fs::read_to_string(shim).ok()?;
    let mut expanded = parse_shim_invocation(&script, dir)?.into_iter();
    let program = expanded.next()?;
    // A bare name (the shim's `node` fallback) is looked up the same way the
    // shell would; anything else has to be on disk, or this is not a shim we
    // understood.
    let program = match std::path::Path::new(&program) {
        path if path.components().count() > 1 => path.is_file().then(|| path.to_path_buf())?,
        _ => resolve_windows_program(&program)?,
    };
    Some((program, expanded.map(OsString::from).collect()))
}

/// The pure half of [`resolve_cmd_shim`]: the shim script in, the program
/// token and leading arguments out - everything up to the `PATH` lookup,
/// which is the only step that needs a real Windows environment.
///
/// **What is read.** The shims npm writes (`cmd-shim`) end in a single line
/// that runs the real program with `%*` appended:
///
/// ```text
/// endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\node_modules\x\cli.js" %*
/// ```
///
/// The last `&`-separated part of that line is tokenised, `%dp0%` becomes the
/// shim's own directory and `%_prog%` the `node.exe` beside it (or `node` from
/// the `PATH`, exactly as the shim decides it), and the trailing `%*` is
/// dropped because the caller's arguments take its place.
///
/// **Deliberately narrow.** Anything that does not match yields `None` and
/// leaves the caller on the `%COMSPEC%` route: a program that is not named by
/// one of the shim's own variables (a hand-written `echo hallo %*` would
/// otherwise resolve `echo` off the `PATH`), a `%_prog%` the file never sets,
/// an unknown `%VARIABLE%`, a `%*` somewhere other than at the end. This is a
/// batch-file interpreter only as far as the one generated shape it
/// recognises, and it refuses everything else rather than guessing.
///
/// None of this touches a Windows API, so the parser is compiled wherever the
/// tests run: `#[cfg(any(windows, test))]` puts it under every platform's
/// test gate, while its only production caller is the Windows resolution
/// above. Without the gate the unix build would meet it as dead code - the
/// same reason `run_in_pty` below is gated.
#[cfg(any(windows, test))]
fn parse_shim_invocation(script: &str, dir: &std::path::Path) -> Option<Vec<String>> {
    // The invocation is the last line that forwards the caller's arguments;
    // everything above it is the shim setting `%_prog%` up.
    let line = script.lines().rev().find(|line| line.contains("%*"))?;
    // `cmd.exe` chains commands with `&`; the run we want is the last link.
    let invocation = split_outside_quotes(line, '&')
        .into_iter()
        .rev()
        .find(|segment| segment.contains("%*"))?;

    let mut tokens = tokenize_command(&invocation);
    // The caller's own arguments replace `%*`, so it has to be last: a shim
    // that puts arguments after it means something this cannot reproduce.
    if tokens.pop().as_deref() != Some("%*") || tokens.is_empty() {
        return None;
    }

    // The program has to come out of one of the shim's own variables. A
    // generated shim always launches `%_prog%` or something under `%dp0%`; a
    // hand-written batch file that happens to end in `echo hallo %*` does not,
    // and resolving `echo` off the `PATH` would run something entirely
    // unrelated. Cheap, and it is what keeps this from being a batch
    // interpreter that guesses.
    let program_token = &tokens[0];
    if !program_token.contains('%') {
        return None;
    }
    // `%_prog%` is only meaningful if this shim is the thing that sets it.
    if program_token.contains("%_prog%") && !script.contains("_prog=") {
        return None;
    }

    let mut expanded: Vec<String> = Vec::with_capacity(tokens.len());
    for token in tokens {
        expanded.push(expand_shim_token(&token, dir)?);
    }
    Some(expanded)
}

/// Substitute the two variables an npm shim uses, or `None` for any other.
///
/// `%dp0%` is the shim's directory - `%~dp0` keeps a trailing backslash, and
/// the template writes its own separator after it, so it is dropped here.
/// `%_prog%` follows the shim's own `IF EXIST` rule: the bundled `node.exe`
/// when there is one, the `PATH` otherwise.
#[cfg(any(windows, test))]
fn expand_shim_token(token: &str, dir: &std::path::Path) -> Option<String> {
    let mut out = String::with_capacity(token.len());
    let mut rest = token;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let tail = &rest[start + 1..];
        let end = tail.find('%')?;
        let name = &tail[..end];
        let value = match name {
            "dp0" | "~dp0" => dir
                .to_string_lossy()
                .trim_end_matches(['\\', '/'])
                .to_string(),
            "_prog" => {
                let bundled = dir.join("node.exe");
                if bundled.is_file() {
                    bundled.to_string_lossy().into_owned()
                } else {
                    "node".to_string()
                }
            }
            // An unknown variable would have been expanded by `cmd.exe` from
            // the live environment; guessing at it is how a resolver starts
            // running the wrong program.
            _ => return None,
        };
        out.push_str(&value);
        rest = &tail[end + 1..];
    }
    out.push_str(rest);
    Some(out)
}

/// Split `line` on `sep`, ignoring separators inside double quotes.
#[cfg(any(windows, test))]
fn split_outside_quotes(line: &str, sep: char) -> Vec<String> {
    let mut parts = vec![String::new()];
    let mut quoted = false;
    for ch in line.chars() {
        match ch {
            '"' => {
                quoted = !quoted;
                parts.last_mut().expect("never empty").push(ch);
            }
            c if c == sep && !quoted => parts.push(String::new()),
            _ => parts.last_mut().expect("never empty").push(ch),
        }
    }
    parts
}

/// Split a `cmd.exe` command into its tokens, dropping the quotes that only
/// held a token together.
#[cfg(any(windows, test))]
fn tokenize_command(command: &str) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut started = false;
    for ch in command.chars() {
        match ch {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            c if c.is_whitespace() && !quoted => {
                if started {
                    tokens.push(std::mem::take(&mut current));
                    started = false;
                }
            }
            _ => {
                current.push(ch);
                started = true;
            }
        }
    }
    if started {
        tokens.push(current);
    }
    tokens
}

/// Resolve `program` against `PATH` using `PATHEXT`, mirroring shell lookup.
#[cfg(windows)]
pub(crate) fn resolve_windows_program(program: &str) -> Option<std::path::PathBuf> {
    use std::path::Path;

    let direct = Path::new(program);
    if direct.components().count() > 1 {
        return direct.is_file().then(|| direct.to_path_buf());
    }

    let has_explicit_ext = direct.extension().is_some();
    let pathext: Vec<String> = std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string())
        .split(';')
        .filter(|e| !e.is_empty())
        .map(|e| e.to_ascii_lowercase())
        .collect();

    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        let base = dir.join(program);
        if has_explicit_ext && base.is_file() {
            return Some(base);
        }
        for ext in &pathext {
            let mut name = program.to_string();
            name.push_str(ext);
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installation_does_not_start_while_a_session_is_owned() {
        let manager = PtyManager::default();
        let id = manager.reserve_session().unwrap();
        let called = std::cell::Cell::new(false);
        let result = manager.install_when_idle(|| {
            called.set(true);
            Ok(())
        });
        assert!(result.is_err());
        assert!(!called.get());
        manager.cancel_reservation(&id);
        assert!(manager.install_when_idle(|| Ok(())).is_ok());
        assert!(manager.reserve_session().is_err());
    }

    /// Shutdown under poison used to return before touching a single session,
    /// leaving every agent process running after the app was gone. A
    /// reservation is the one entry a test can check without a real child:
    /// this proves the early return is gone, not that `killer.kill()` ran.
    #[test]
    fn poisoned_registry_still_cancels_everything_on_kill_all() {
        let manager = PtyManager::default();
        let id = manager.reserve_session().unwrap();
        let registry = Arc::clone(&manager.sessions);
        let _ = std::thread::spawn(move || {
            let _guard = registry.lock().unwrap();
            panic!("poison registry fixture");
        })
        .join();
        assert!(manager.sessions.is_poisoned());
        manager.kill_all();
        let recovered = manager
            .sessions
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        assert!(
            matches!(recovered.get(&id), Some(SessionEntry::CancelledReservation)),
            "kill_all must cancel a reservation even under poison"
        );
    }

    /// Poison `mutex` the way a real panic would: a thread holding it dies.
    fn poison<T: Send>(mutex: &Mutex<T>) {
        std::thread::scope(|scope| {
            let _ = scope
                .spawn(|| {
                    let _guard = mutex.lock();
                    panic!("poison fixture");
                })
                .join();
        });
        assert!(mutex.is_poisoned());
    }

    /// W1-15c, setters: a poisoned hook slot used to drop the hook without
    /// a word, so exits and output reached nobody for the rest of the run.
    #[test]
    fn poisoned_hook_slots_still_take_their_hook() {
        let manager = PtyManager::default();
        poison(&manager.on_exit);
        poison(&manager.on_output);
        manager.set_exit_hook(|_, _| Ok(()));
        manager.set_output_hook(|_, _| {});
        let exit = manager
            .on_exit
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let output = manager
            .on_output
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        assert!(exit.is_some(), "the exit hook was dropped under poison");
        assert!(output.is_some(), "the output hook was dropped under poison");
    }

    /// W1-15c, reader hook: under poison the reader used to lose the chunk
    /// from the scrollback, the output timestamp and the output hook - the
    /// status engine and the submit guard went blind for the session.
    #[test]
    fn poisoned_output_state_still_records_a_chunk() {
        let scrollback = Mutex::new(Scrollback::new());
        let last_output: Mutex<Option<Instant>> = Mutex::new(None);
        let hook: OutputHook = Arc::new(|_, _| {});
        let on_output = Mutex::new(Some(hook));
        poison(&scrollback);
        poison(&last_output);
        poison(&on_output);
        record_output(&scrollback, b"chunk");
        let hook = stamp_output(&last_output, &on_output);
        assert!(hook.is_some(), "the output hook was skipped under poison");
        assert!(
            last_output
                .lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .is_some(),
            "the output timestamp was skipped under poison"
        );
        assert_eq!(
            scrollback
                .lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .to_lossy_string(),
            "chunk",
            "the chunk was lost from the scrollback under poison"
        );
    }

    /// W1-15c, trace: a poisoned trace file lock used to drop every later
    /// line of the byte trace, the one diagnostic meant for broken sessions.
    #[test]
    fn poisoned_trace_still_records_both_files() {
        let dir = std::env::temp_dir().join(format!("projecta-pty-trace-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let open = |name: &str| {
            std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(dir.join(name))
                .unwrap()
        };
        let trace = SessionTrace {
            started: Instant::now(),
            log: Mutex::new(open("t.io.log")),
            raw_out: Mutex::new(open("t.out.raw")),
        };
        poison(&trace.log);
        poison(&trace.raw_out);
        trace.note("out", b"xyz");
        drop(trace);
        let log = std::fs::read_to_string(dir.join("t.io.log")).unwrap();
        let raw = std::fs::read(dir.join("t.out.raw")).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(
            log.contains("out 3 bytes: xyz"),
            "trace log lost the line: {log:?}"
        );
        assert_eq!(raw, b"xyz", "raw trace lost the bytes");
    }

    /// W1-15c, submit guard: a poisoned registry made a live session look
    /// gone, so the guard reported `SessionEnded` and gave up its delivery.
    #[test]
    fn a_poisoned_registry_does_not_end_a_live_guard_session() {
        let manager = PtyManager::default();
        let _session = resting_guard_session(&manager, "w1-15c-registry");
        poison(&manager.sessions);
        assert!(
            live_interactive(&manager.sessions, "w1-15c-registry").is_some(),
            "a poisoned registry hid a live session from the submit guard"
        );
        assert!(live_interactive(&manager.sessions, "unknown").is_none());
    }

    /// W1-15c, submit guard: a poisoned scrollback used to read as empty,
    /// so the guard never saw the readiness marker and never typed the task.
    #[test]
    fn a_poisoned_scrollback_does_not_blind_the_submit_guard() {
        let manager = PtyManager::default();
        let (session, writer) = resting_guard_session(&manager, "w1-15c-scrollback");
        poison(&session.scrollback);
        manager
            .start_submit_guard(
                "w1-15c-scrollback",
                "alpha task text".into(),
                Some(GUARD_TEST_MARKER),
                |_| {},
            )
            .unwrap();
        wait_until("the task to be written under poison", || {
            writer.typed().contains("alpha task text")
        });
        manager.kill("w1-15c-scrollback").unwrap();
    }

    #[test]
    fn poisoned_registry_still_reaps_a_cancelled_reservation() {
        let manager = PtyManager::default();
        let id = manager.reserve_session().unwrap();
        let registry = Arc::clone(&manager.sessions);
        let _ = std::thread::spawn(move || {
            let _guard = registry.lock().unwrap();
            panic!("poison registry fixture");
        })
        .join();
        manager.cancel_reservation(&id);
        let recovered = manager
            .sessions
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        assert!(
            recovered.is_empty(),
            "a cancelled reservation must be reaped even under poison"
        );
    }

    #[test]
    fn poisoned_registry_still_reaps_a_failed_spawn() {
        let manager = PtyManager::default();
        let id = manager.reserve_session().unwrap();
        let starting = manager.begin_spawn(&id).unwrap();
        let registry = Arc::clone(&manager.sessions);
        let _ = std::thread::spawn(move || {
            let _guard = registry.lock().unwrap();
            panic!("poison registry fixture");
        })
        .join();
        drop(starting);
        let recovered = manager
            .sessions
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        assert!(
            recovered.is_empty(),
            "a failed spawn must be reaped even under poison"
        );
    }

    #[test]
    fn poisoned_registry_still_reaps_an_exited_session() {
        let manager = PtyManager::default();
        let id = manager.reserve_session().unwrap();
        let registry = Arc::clone(&manager.sessions);
        let _ = std::thread::spawn(move || {
            let _guard = registry.lock().unwrap();
            panic!("poison registry fixture");
        })
        .join();
        assert!(remove_exited_session(&manager.sessions, &id, Ok(())).is_ok());
        let recovered = manager
            .sessions
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        assert!(
            recovered.is_empty(),
            "an exited session must be reaped even under poison"
        );
    }

    #[test]
    fn failed_or_panicked_installation_keeps_admission_closed() {
        for panic in [false, true] {
            let manager = PtyManager::default();
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                manager.install_when_idle(|| {
                    // Installer cleanup must be able to take the registry lock.
                    assert!(manager.live_session_ids().unwrap().is_empty());
                    assert!(manager.reserve_session().is_err());
                    if panic {
                        panic!("interrupted installer");
                    }
                    Err("installer failure".into())
                })
            }));
            if panic {
                assert!(outcome.is_err());
            } else {
                assert!(outcome.unwrap().is_err());
            }
            assert!(manager.reserve_session().is_err());
            assert!(manager
                .install_when_idle(|| panic!("must not retry"))
                .is_err());
        }
    }

    #[test]
    fn session_reservation_and_installation_have_exactly_one_winner() {
        for _ in 0..64 {
            let manager = PtyManager::default();
            let barrier = std::sync::Barrier::new(2);
            std::thread::scope(|scope| {
                let installer = scope.spawn(|| {
                    barrier.wait();
                    manager.install_when_idle(|| Ok(())).is_ok()
                });
                barrier.wait();
                let reserved = manager.reserve_session().is_ok();
                assert_ne!(reserved, installer.join().unwrap());
            });
        }
    }

    #[test]
    fn poisoned_registry_never_authorizes_installation() {
        let manager = PtyManager::default();
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _registry = manager.sessions.lock().unwrap();
            panic!("poison registry");
        }));
        assert!(manager
            .install_when_idle(|| panic!("must not install"))
            .is_err());
    }

    #[test]
    fn reserved_sessions_are_not_reported_as_idle() {
        let manager = PtyManager::default();
        let reserved = manager.reserve_session().unwrap();
        assert_eq!(manager.live_session_ids().unwrap(), vec![reserved]);
    }

    #[test]
    fn consumed_start_stays_visible_and_cannot_be_canceled_or_claimed_twice() {
        let manager = PtyManager::default();
        let id = manager.reserve_session().unwrap();
        let starting = manager.begin_spawn(&id).unwrap();
        manager.cancel_reservation(&id);
        assert_eq!(manager.live_session_ids().unwrap(), vec![id.clone()]);
        assert!(manager.begin_spawn(&id).is_err());
        assert!(manager.write(&id, "task").is_err());
        assert!(manager.resize(&id, 80, 24).is_err());
        assert!(manager.scrollback(&id).is_err());
        // Setup failed before a process could exist: remove, without making
        // the consumed id available for another spawn.
        drop(starting);
        assert!(manager.live_session_ids().unwrap().is_empty());
        assert!(manager.begin_spawn(&id).is_err());
    }

    #[test]
    fn unconfirmed_start_cleanup_keeps_blocking_inventory() {
        let manager = PtyManager::default();
        let id = manager.reserve_session().unwrap();
        let mut starting = manager.begin_spawn(&id).unwrap();
        starting.no_process = false;
        drop(starting);
        manager.cancel_reservation(&id);
        assert_eq!(manager.live_session_ids().unwrap(), vec![id.clone()]);
        assert!(manager.begin_spawn(&id).is_err());
    }

    #[test]
    fn concurrent_starts_consume_exactly_one_visible_reservation() {
        let manager = PtyManager::default();
        let id = manager.reserve_session().unwrap();
        let barrier = std::sync::Barrier::new(2);
        let starts = std::thread::scope(|scope| {
            let attempt = || {
                barrier.wait();
                manager.begin_spawn(&id)
            };
            let a = scope.spawn(attempt);
            let b = scope.spawn(attempt);
            [a.join().unwrap(), b.join().unwrap()]
        });
        assert_eq!(starts.iter().filter(|entry| entry.is_ok()).count(), 1);
        assert_eq!(manager.live_session_ids().unwrap(), vec![id]);
        drop(starts);
        assert!(manager.live_session_ids().unwrap().is_empty());
    }

    #[test]
    fn poisoned_session_inventory_is_an_error_not_idle() {
        let manager = PtyManager::default();
        let registry = Arc::clone(&manager.sessions);
        let _ = std::thread::spawn(move || {
            let _guard = registry.lock().unwrap();
            panic!("poison inventory fixture");
        })
        .join();
        assert!(manager.live_session_ids().is_err());
        assert!(manager.reserve_session().is_err());
    }

    #[test]
    fn failed_exit_persistence_keeps_installation_blocked() {
        let manager = PtyManager::default();
        let id = manager.reserve_session().unwrap();
        let removed =
            remove_exited_session(&manager.sessions, &id, Err("database unavailable".into()));
        assert!(removed.is_err());
        assert!(remove_exited_session(&manager.sessions, &id, Ok(())).is_err());
        assert_eq!(manager.live_session_ids().unwrap(), vec![id]);
        assert!(manager.install_when_idle(|| Ok(())).is_err());
    }

    #[test]
    fn unresolved_reader_keeps_installation_blocked() {
        let manager = PtyManager::default();
        let id = manager.reserve_session().unwrap();
        let result = remove_exited_session_after_reader(&manager.sessions, &id, Ok(()), || {
            Err("reader still running".into())
        });
        assert!(result.is_err());
        assert_eq!(manager.live_session_ids().unwrap(), vec![id]);
        assert!(manager.install_when_idle(|| Ok(())).is_err());
    }

    #[test]
    fn reader_ack_follows_owned_resource_drop() {
        struct Held(std::sync::mpsc::Receiver<()>, Arc<AtomicBool>);
        impl Drop for Held {
            fn drop(&mut self) {
                self.0.recv_timeout(Duration::from_secs(5)).unwrap();
                self.1.store(true, Ordering::Release);
            }
        }
        let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
        let dropped = Arc::new(AtomicBool::new(false));
        let held = Held(release_rx, Arc::clone(&dropped));
        let finished = track_reader_retirement(move || drop(held));
        assert!(await_reader_retirement(&finished, Duration::from_millis(20)).is_err());
        assert!(!dropped.load(Ordering::Acquire));
        release_tx.send(()).unwrap();
        await_reader_retirement(&finished, Duration::from_secs(5)).unwrap();
        assert!(dropped.load(Ordering::Acquire));
    }

    #[test]
    fn panicked_reader_cannot_acknowledge_idle() {
        let manager = PtyManager::default();
        let id = manager.reserve_session().unwrap();
        let finished = track_reader_retirement(|| panic!("reader fixture"));
        assert!(
            remove_exited_session_after_reader(&manager.sessions, &id, Ok(()), || {
                await_reader_retirement(&finished, Duration::from_secs(5))
            })
            .is_err()
        );
        assert_eq!(manager.live_session_ids().unwrap(), vec![id]);
        assert!(manager.install_when_idle(|| Ok(())).is_err());
    }

    #[test]
    fn reader_wait_does_not_hold_registry_and_success_releases_inventory() {
        let manager = PtyManager::default();
        let id = manager.reserve_session().unwrap();
        let finished = track_reader_retirement(|| {});
        remove_exited_session_after_reader(&manager.sessions, &id, Ok(()), || {
            assert_eq!(manager.live_session_ids().unwrap(), vec![id.clone()]);
            assert!(manager.install_when_idle(|| Ok(())).is_err());
            await_reader_retirement(&finished, Duration::from_secs(5))
        })
        .unwrap();
        assert!(manager.live_session_ids().unwrap().is_empty());
        assert!(manager.install_when_idle(|| Ok(())).is_ok());
    }

    #[test]
    fn exit_hook_work_finishes_before_session_retires() {
        let manager = PtyManager::default();
        let id = manager.reserve_session().unwrap();
        let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
        let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
        let release_rx = Mutex::new(release_rx);
        manager.set_exit_hook(move |_, _| {
            entered_tx.send(()).unwrap();
            release_rx
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
            Ok(())
        });
        std::thread::scope(|scope| {
            let reaper = scope.spawn(|| {
                let result = complete_exit_hook(&manager.on_exit, &id, Some(0));
                remove_exited_session(&manager.sessions, &id, result)
            });
            entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            assert_eq!(manager.live_session_ids().unwrap(), vec![id.clone()]);
            assert!(manager.install_when_idle(|| Ok(())).is_err());
            release_tx.send(()).unwrap();
            reaper.join().unwrap().unwrap();
        });
        assert!(manager.live_session_ids().unwrap().is_empty());
        assert!(manager.install_when_idle(|| Ok(())).is_ok());
    }

    #[test]
    fn poisoned_exit_hook_cannot_acknowledge_retirement() {
        let manager = PtyManager::default();
        let id = manager.reserve_session().unwrap();
        let hooks = Arc::clone(&manager.on_exit);
        let _ = std::thread::spawn(move || {
            let _guard = hooks.lock().unwrap();
            panic!("poison exit hook");
        })
        .join();
        let result = complete_exit_hook(&manager.on_exit, &id, Some(0));
        assert!(remove_exited_session(&manager.sessions, &id, result).is_err());
        assert!(manager.install_when_idle(|| Ok(())).is_err());
    }

    #[test]
    fn failed_native_wait_does_not_dispatch_exit_or_remove_inventory() {
        let manager = PtyManager::default();
        let id = manager.reserve_session().unwrap();
        let result = dispatch_confirmed_exit(Err(std::io::Error::other("wait failed")), |_| {
            manager.sessions.lock().unwrap().remove(&id);
        });
        assert!(result.is_err());
        assert_eq!(manager.live_session_ids().unwrap(), vec![id]);
    }

    #[test]
    fn confirmed_native_exit_dispatches_once_with_windows_bit_pattern() {
        let count = std::cell::Cell::new(0);
        dispatch_confirmed_exit(
            Ok(portable_pty::ExitStatus::with_exit_code(u32::MAX)),
            |code| {
                assert_eq!(code, Some(-1));
                count.set(count.get() + 1);
            },
        )
        .unwrap();
        assert_eq!(count.get(), 1);
    }

    /// A writer that records every byte the guard types, so a test can read
    /// the order in which two deliveries reached the terminal.
    ///
    /// `refuse_enter` makes a bare Enter fail, which escalates the guard
    /// that sent it right after its task was typed and echoed.
    #[derive(Clone, Default)]
    struct RecordingWriter(Arc<Mutex<Vec<u8>>>, Arc<AtomicBool>);

    impl Write for RecordingWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            if buf == b"\r" && self.1.load(Ordering::Acquire) {
                return Err(std::io::Error::other("enter refused by the test"));
            }
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl RecordingWriter {
        fn typed(&self) -> String {
            String::from_utf8_lossy(&self.0.lock().unwrap()).into_owned()
        }

        fn refuse_enter(&self) {
            self.1.store(true, Ordering::Release);
        }
    }

    /// Echo `text` until the guard answers with its Enter. One push could
    /// land before the guard has moved its write baseline past the task and
    /// would then not count as the echo (review A4).
    fn echo_until_enter(session: &Session, writer: &RecordingWriter, text: &str) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !writer.typed().contains('\r') {
            assert!(Instant::now() < deadline, "timed out waiting for the Enter");
            session.scrollback.lock().unwrap().push(text.as_bytes());
            std::thread::sleep(Duration::from_millis(200));
        }
    }

    #[derive(Debug)]
    struct NoopKiller;

    impl ChildKiller for NoopKiller {
        fn kill(&mut self) -> std::io::Result<()> {
            Ok(())
        }
        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(NoopKiller)
        }
    }

    const GUARD_TEST_MARKER: &str = "READY>";

    /// An interactive session whose writes land in a recorder and whose
    /// output the test pushes by hand. It rests on its prompt: the readiness
    /// marker is on screen and the last output is older than
    /// READY_IDLE_AFTER, so a guard may write on its first tick (C-1 rule).
    fn resting_guard_session(manager: &PtyManager, id: &str) -> (Arc<Session>, RecordingWriter) {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("open a pty pair for the guard test");
        let writer = RecordingWriter::default();
        let mut scrollback = Scrollback::new();
        scrollback.push(GUARD_TEST_MARKER.as_bytes());
        let session = Arc::new(Session {
            master: Mutex::new(pair.master),
            writer: Mutex::new(Box::new(writer.clone())),
            killer: Mutex::new(Box::new(NoopKiller)),
            scrollback: Arc::new(Mutex::new(scrollback)),
            last_output: Arc::new(Mutex::new(Some(
                Instant::now() - crate::submit_guard::READY_IDLE_AFTER - Duration::from_secs(1),
            ))),
            submit_guard_cancelled: Arc::new(AtomicBool::new(false)),
            delivery_turns: Arc::new(DeliveryTurns::default()),
            trace: None,
        });
        manager.sessions.lock().unwrap().insert(
            id.to_string(),
            SessionEntry::Interactive(Arc::clone(&session)),
        );
        (session, writer)
    }

    fn wait_until(what: &str, cond: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !cond() {
            assert!(Instant::now() < deadline, "timed out waiting for {what}");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// Whether a guard has reported its terminal outcome. Waiting for this
    /// instead of for any event: a queued guard reports `Queued` first.
    fn reported_outcome(events: &Mutex<Vec<SubmitGuardEvent>>) -> bool {
        events.lock().unwrap().iter().any(|event| {
            matches!(
                event,
                SubmitGuardEvent::Escalated | SubmitGuardEvent::Delivered
            )
        })
    }

    /// W1-01a (a), smoke 8 trace (2026-09-17): after the trust dialog was
    /// answered, the guard typed `Up, Enter` twice more into Kimi's empty
    /// composer - the dismissed dialog stayed in the tail while the welcome
    /// box repainted past the dialog cooldown. The write baseline has to move
    /// past a dismissing dialog answer, so only output drawn after it can
    /// show a dialog worth answering.
    #[test]
    fn a_dismissing_dialog_answer_moves_the_write_baseline() {
        const KIMI_TRUST: &str = "\u{1b}[?25lThis folder is not trusted yet.\r\n> Don't trust this folder\r\n  Trust this folder\r\n";
        const ANSWER: &str = "\u{1b}[A\r";
        let manager = PtyManager::default();
        let (session, writer) = resting_guard_session(&manager, "w1-01a-ghost");
        session
            .scrollback
            .lock()
            .unwrap()
            .push(KIMI_TRUST.as_bytes());
        *session.last_output.lock().unwrap() = Some(Instant::now());
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);

        // No readiness marker: Kimi's profile runs on the silence heuristic.
        manager
            .start_submit_guard(
                "w1-01a-ghost",
                "alpha task text".into(),
                None,
                move |event| sink.lock().unwrap().push(event),
            )
            .unwrap();
        wait_until("the trust dialog to be answered", || {
            writer.typed().contains(ANSWER)
        });
        // Kimi draws its composer and welcome box and keeps repainting past
        // the dialog cooldown; the dismissed dialog is still in the tail.
        let redraw_until = Instant::now() + crate::submit_guard::DIALOG_COOLDOWN * 3 / 2;
        while Instant::now() < redraw_until {
            session
                .scrollback
                .lock()
                .unwrap()
                .push("\u{1b}[2K Welcome to Kimi Code! Send /help for help information.\r\n\u{2502} > \u{2502}\r\n".as_bytes());
            *session.last_output.lock().unwrap() = Some(Instant::now());
            std::thread::sleep(Duration::from_millis(200));
        }
        // Quiet now: the task goes in after READY_IDLE_AFTER.
        wait_until("the task to be written", || {
            writer.typed().contains("alpha task text")
        });
        let typed = writer.typed();
        manager.kill("w1-01a-ghost").unwrap();
        assert_eq!(
            typed.matches(ANSWER).count(),
            1,
            "the dismissed dialog was answered again into the empty composer: {typed:?}"
        );
        assert!(
            events
                .lock()
                .unwrap()
                .iter()
                .filter(|event| **event == SubmitGuardEvent::DialogAnswered)
                .count()
                == 1
        );
    }

    /// W1-03 / C-3: two deliveries to the same session must not type into
    /// each other. Before the fix every `start_submit_guard` ran its own
    /// thread with nothing ordering them, so the second task was written
    /// while the first still waited for its echo - both texts ended up in
    /// the same input line. The queued guard escalates once the session is
    /// killed, so a guard that wrongly wrote would report `Wrote`, not
    /// `Escalated`.
    #[test]
    fn two_guards_on_one_session_do_not_type_into_each_other() {
        let manager = PtyManager::default();
        let (_session, writer) = resting_guard_session(&manager, "c3-interleave");
        let queued_events = Arc::new(Mutex::new(Vec::new()));
        let queued_sink = Arc::clone(&queued_events);

        manager
            .start_submit_guard(
                "c3-interleave",
                "alpha task text".into(),
                Some(GUARD_TEST_MARKER),
                |_| {},
            )
            .unwrap();
        manager
            .start_submit_guard(
                "c3-interleave",
                "bravo task text".into(),
                Some(GUARD_TEST_MARKER),
                move |event| queued_sink.lock().unwrap().push(event),
            )
            .unwrap();

        wait_until("the first task to be written", || {
            writer.typed().contains("alpha task text")
        });
        // The queued guard announces itself once it has seen the session
        // alive; kill only after that, or it rightly reports no `Queued`.
        wait_until("the second guard to report its place", || {
            queued_events
                .lock()
                .unwrap()
                .contains(&SubmitGuardEvent::Queued { ahead: 1 })
        });
        manager.kill("c3-interleave").unwrap();
        wait_until("the queued guard to report its outcome", || {
            reported_outcome(&queued_events)
        });
        let typed = writer.typed();
        assert!(
            !typed.contains("bravo task text"),
            "second task typed while the first awaited its echo: {typed:?}"
        );
        assert_eq!(
            *queued_events.lock().unwrap(),
            vec![
                SubmitGuardEvent::Queued { ahead: 1 },
                SubmitGuardEvent::SessionEnded,
                SubmitGuardEvent::Escalated
            ]
        );
    }

    /// The second delivery is only held, not dropped: once the first one has
    /// ended (echo, Enter, output after it) the next guard takes its turn and
    /// writes its own task after the first one's Enter.
    #[test]
    fn a_queued_guard_writes_once_the_previous_delivery_has_ended() {
        let manager = PtyManager::default();
        let (session, writer) = resting_guard_session(&manager, "c3-turn");
        let events = Arc::new(Mutex::new(Vec::new()));
        let first_events = Arc::clone(&events);

        manager
            .start_submit_guard(
                "c3-turn",
                "alpha task text".into(),
                Some(GUARD_TEST_MARKER),
                move |event| first_events.lock().unwrap().push(event),
            )
            .unwrap();
        manager
            .start_submit_guard(
                "c3-turn",
                "bravo task text".into(),
                Some(GUARD_TEST_MARKER),
                |_| {},
            )
            .unwrap();

        wait_until("the first task to be written", || {
            writer.typed().contains("alpha task text")
        });
        // The TUI echoes the first task; the guard then sends Enter.
        echo_until_enter(&session, &writer, "alpha task text");
        // Output after the Enter: the first delivery is done. The screen is
        // back on its prompt, still resting (last output clock unchanged).
        session
            .scrollback
            .lock()
            .unwrap()
            .push(format!("working... done\n{GUARD_TEST_MARKER}").as_bytes());
        wait_until("the second task to be written", || {
            writer.typed().contains("bravo task text")
        });
        manager.kill("c3-turn").unwrap();

        assert!(events
            .lock()
            .unwrap()
            .contains(&SubmitGuardEvent::Delivered));
        let typed = writer.typed();
        let first_enter = typed.find('\r').unwrap();
        let second = typed.find("bravo task text").unwrap();
        assert!(
            first_enter < second,
            "second task before the first Enter: {typed:?}"
        );
    }

    /// A delivery still waiting for its turn gives up when the session is
    /// killed, and leaves the queue: nothing is typed into a dead session.
    #[test]
    fn a_queued_guard_is_cancelled_with_its_session() {
        let manager = PtyManager::default();
        let (session, writer) = resting_guard_session(&manager, "c3-kill");
        let queued_events = Arc::new(Mutex::new(Vec::new()));
        let queued_sink = Arc::clone(&queued_events);

        manager
            .start_submit_guard(
                "c3-kill",
                "alpha task text".into(),
                Some(GUARD_TEST_MARKER),
                |_| {},
            )
            .unwrap();
        manager
            .start_submit_guard(
                "c3-kill",
                "bravo task text".into(),
                Some(GUARD_TEST_MARKER),
                move |event| queued_sink.lock().unwrap().push(event),
            )
            .unwrap();
        wait_until("the first task to be written", || {
            writer.typed().contains("alpha task text")
        });
        // The queued guard announces itself once it has seen the session
        // alive; kill only after that, or it rightly reports no `Queued`.
        wait_until("the second guard to report its place", || {
            queued_events
                .lock()
                .unwrap()
                .contains(&SubmitGuardEvent::Queued { ahead: 1 })
        });
        manager.kill("c3-kill").unwrap();
        wait_until("both guards to leave the queue", || {
            session.delivery_turns.is_empty()
        });
        assert!(!writer.typed().contains("bravo task text"));
        // Review A1: the caller hears that its text was not delivered - an
        // outcome callback that never fires loses the text without a trace.
        assert_eq!(
            *queued_events.lock().unwrap(),
            vec![
                SubmitGuardEvent::Queued { ahead: 1 },
                SubmitGuardEvent::SessionEnded,
                SubmitGuardEvent::Escalated
            ]
        );
    }

    /// Review A2/B1: when the delivery ahead escalated after typing its task,
    /// that text may still sit unsent in the input line. A guard that was
    /// already waiting behind it must not type its own text after it - the
    /// next Enter would send both as one line, C-3 with a delay. It
    /// escalates without writing; the worker needs a human anyway.
    #[test]
    fn a_queued_guard_does_not_type_behind_a_failed_delivery() {
        let manager = PtyManager::default();
        let (session, writer) = resting_guard_session(&manager, "c3-dirty");
        let queued_events = Arc::new(Mutex::new(Vec::new()));
        let queued_sink = Arc::clone(&queued_events);

        manager
            .start_submit_guard(
                "c3-dirty",
                "alpha task text".into(),
                Some(GUARD_TEST_MARKER),
                |_| {},
            )
            .unwrap();
        manager
            .start_submit_guard(
                "c3-dirty",
                "bravo task text".into(),
                Some(GUARD_TEST_MARKER),
                move |event| queued_sink.lock().unwrap().push(event),
            )
            .unwrap();
        wait_until("the first task to be written", || {
            writer.typed().contains("alpha task text")
        });
        // The first task is echoed, but its Enter fails: the guard escalates
        // with the text still typed into the prompt.
        writer.refuse_enter();
        let deadline = Instant::now() + Duration::from_secs(10);
        while !reported_outcome(&queued_events) && Instant::now() < deadline {
            session.scrollback.lock().unwrap().push(b"alpha task text");
            std::thread::sleep(Duration::from_millis(200));
        }
        assert!(
            reported_outcome(&queued_events),
            "timed out waiting for the queued guard to report"
        );
        let typed = writer.typed();
        manager.kill("c3-dirty").unwrap();

        assert!(
            !typed.contains("bravo task text"),
            "second task typed behind a failed delivery: {typed:?}"
        );
        assert_eq!(
            *queued_events.lock().unwrap(),
            vec![
                SubmitGuardEvent::Queued { ahead: 1 },
                SubmitGuardEvent::InputBlocked,
                SubmitGuardEvent::Escalated
            ]
        );
    }

    /// When the active delivery escalates with its task still in the input
    /// line, every guard already queued behind it must escalate, not type
    /// after it. A third guard that joined before the escalation is also
    /// covered by the dirty-input marker.
    #[test]
    fn three_queued_guards_all_stop_behind_a_failed_delivery() {
        let manager = PtyManager::default();
        let (session, writer) = resting_guard_session(&manager, "c3-dirty-three");
        let second_events = Arc::new(Mutex::new(Vec::new()));
        let second_sink = Arc::clone(&second_events);
        let third_events = Arc::new(Mutex::new(Vec::new()));
        let third_sink = Arc::clone(&third_events);

        manager
            .start_submit_guard(
                "c3-dirty-three",
                "alpha task text".into(),
                Some(GUARD_TEST_MARKER),
                |_| {},
            )
            .unwrap();
        manager
            .start_submit_guard(
                "c3-dirty-three",
                "bravo task text".into(),
                Some(GUARD_TEST_MARKER),
                move |event| second_sink.lock().unwrap().push(event),
            )
            .unwrap();
        manager
            .start_submit_guard(
                "c3-dirty-three",
                "charlie task text".into(),
                Some(GUARD_TEST_MARKER),
                move |event| third_sink.lock().unwrap().push(event),
            )
            .unwrap();

        wait_until("the first task to be written", || {
            writer.typed().contains("alpha task text")
        });
        writer.refuse_enter();
        let deadline = Instant::now() + Duration::from_secs(10);
        while (!reported_outcome(&second_events) || !reported_outcome(&third_events))
            && Instant::now() < deadline
        {
            session.scrollback.lock().unwrap().push(b"alpha task text");
            std::thread::sleep(Duration::from_millis(200));
        }
        assert!(
            reported_outcome(&second_events),
            "timed out waiting for the second guard to report"
        );
        assert!(
            reported_outcome(&third_events),
            "timed out waiting for the third guard to report"
        );
        let typed = writer.typed();
        manager.kill("c3-dirty-three").unwrap();
        assert!(
            !typed.contains("bravo task text"),
            "second task typed behind a failed delivery: {typed:?}"
        );
        assert!(
            !typed.contains("charlie task text"),
            "third task typed behind a failed delivery: {typed:?}"
        );
        assert_eq!(
            *second_events.lock().unwrap(),
            vec![
                SubmitGuardEvent::Queued { ahead: 1 },
                SubmitGuardEvent::InputBlocked,
                SubmitGuardEvent::Escalated
            ]
        );
        assert_eq!(
            *third_events.lock().unwrap(),
            vec![
                SubmitGuardEvent::Queued { ahead: 2 },
                SubmitGuardEvent::InputBlocked,
                SubmitGuardEvent::Escalated
            ]
        );
    }

    /// External review X1: a delivery started only after a previous one
    /// escalated with its task typed must still see the input line as dirty:
    /// the leftover text was never sent, so typing after it would merge both
    /// tasks - C-3 with a delay. It escalates instead.
    #[test]
    fn a_delivery_started_after_a_failed_one_does_not_type_behind_it() {
        let manager = PtyManager::default();
        let (session, writer) = resting_guard_session(&manager, "c3-dirty-after");
        let first_events = Arc::new(Mutex::new(Vec::new()));
        let first_sink = Arc::clone(&first_events);

        manager
            .start_submit_guard(
                "c3-dirty-after",
                "alpha task text".into(),
                Some(GUARD_TEST_MARKER),
                move |event| first_sink.lock().unwrap().push(event),
            )
            .unwrap();

        wait_until("the first task to be written", || {
            writer.typed().contains("alpha task text")
        });
        writer.refuse_enter();
        let deadline = Instant::now() + Duration::from_secs(10);
        while !(first_events
            .lock()
            .unwrap()
            .contains(&SubmitGuardEvent::Escalated)
            && session.delivery_turns.is_empty())
            && Instant::now() < deadline
        {
            session.scrollback.lock().unwrap().push(b"alpha task text");
            std::thread::sleep(Duration::from_millis(200));
        }
        assert!(
            first_events
                .lock()
                .unwrap()
                .contains(&SubmitGuardEvent::Escalated),
            "the first delivery did not escalate"
        );
        assert!(
            session.delivery_turns.is_empty(),
            "the first delivery did not leave the queue"
        );

        let second_events = Arc::new(Mutex::new(Vec::new()));
        let second_sink = Arc::clone(&second_events);
        manager
            .start_submit_guard(
                "c3-dirty-after",
                "bravo task text".into(),
                Some(GUARD_TEST_MARKER),
                move |event| second_sink.lock().unwrap().push(event),
            )
            .unwrap();

        wait_until("the second guard to report its outcome", || {
            reported_outcome(&second_events)
        });
        let typed = writer.typed();
        manager.kill("c3-dirty-after").unwrap();
        assert!(
            !typed.contains("bravo task text"),
            "second task typed behind a failed delivery: {typed:?}"
        );
        assert_eq!(
            *second_events.lock().unwrap(),
            vec![SubmitGuardEvent::InputBlocked, SubmitGuardEvent::Escalated]
        );
    }

    /// User input into a session that has a dirty input line clears the
    /// flag, so the next delivery can type normally again.
    #[test]
    fn user_input_clears_the_dirty_line_for_the_next_delivery() {
        let manager = PtyManager::default();
        let (session, writer) = resting_guard_session(&manager, "c3-user-input-clears");
        let first_events = Arc::new(Mutex::new(Vec::new()));
        let first_sink = Arc::clone(&first_events);

        manager
            .start_submit_guard(
                "c3-user-input-clears",
                "alpha task text".into(),
                Some(GUARD_TEST_MARKER),
                move |event| first_sink.lock().unwrap().push(event),
            )
            .unwrap();

        wait_until("the first task to be written", || {
            writer.typed().contains("alpha task text")
        });
        writer.refuse_enter();
        let deadline = Instant::now() + Duration::from_secs(10);
        while !(first_events
            .lock()
            .unwrap()
            .contains(&SubmitGuardEvent::Escalated)
            && session.delivery_turns.is_empty())
            && Instant::now() < deadline
        {
            session.scrollback.lock().unwrap().push(b"alpha task text");
            std::thread::sleep(Duration::from_millis(200));
        }
        assert!(
            first_events
                .lock()
                .unwrap()
                .contains(&SubmitGuardEvent::Escalated),
            "the first delivery did not escalate"
        );
        assert!(
            session.delivery_turns.is_empty(),
            "the first delivery did not leave the queue"
        );
        assert!(
            session.delivery_turns.input_dirty(),
            "the failed delivery should have left the input line dirty"
        );

        // Ctrl-U from the user clears the dirty line.
        manager
            .write_user_input("c3-user-input-clears", "\u{15}")
            .unwrap();
        assert!(
            !session.delivery_turns.input_dirty(),
            "user input should clear the dirty flag"
        );

        let second_events = Arc::new(Mutex::new(Vec::new()));
        let second_sink = Arc::clone(&second_events);
        manager
            .start_submit_guard(
                "c3-user-input-clears",
                "bravo task text".into(),
                Some(GUARD_TEST_MARKER),
                move |event| second_sink.lock().unwrap().push(event),
            )
            .unwrap();

        wait_until("the second task to be written", || {
            writer.typed().contains("bravo task text")
        });
        manager.kill("c3-user-input-clears").unwrap();

        assert!(
            second_events
                .lock()
                .unwrap()
                .contains(&SubmitGuardEvent::Wrote { write: 1 }),
            "the second delivery should have typed its task"
        );
    }

    /// Reviews GLM-5.3 X3 / DeepSeek X2: only input that empties or sends the
    /// line clears the dirty state. A cursor key or a typed letter leaves
    /// the earlier task in place, and the next delivery would type behind it.
    #[test]
    fn only_line_clearing_user_input_clears_the_dirty_line() {
        let manager = PtyManager::default();
        let (session, _writer) = resting_guard_session(&manager, "c3-user-keys");
        let turn = session.delivery_turns.join();
        turn.set_input_pending(true);
        drop(turn);
        assert!(session.delivery_turns.input_dirty());

        for keys in ["\u{1b}[D", "a", "\u{7f}"] {
            manager.write_user_input("c3-user-keys", keys).unwrap();
            assert!(
                session.delivery_turns.input_dirty(),
                "{keys:?} does not empty the line"
            );
        }
        for keys in ["\r", "\u{15}", "\u{3}"] {
            let turn = session.delivery_turns.join();
            turn.set_input_pending(true);
            drop(turn);
            manager.write_user_input("c3-user-keys", keys).unwrap();
            assert!(
                !session.delivery_turns.input_dirty(),
                "{keys:?} sends or empties the line"
            );
        }
    }

    /// Codex review (PR #81, P2): the user may empty a visibly stuck line
    /// while its delivery is still running. When that guard later gives up,
    /// its drop must not mark the line dirty again - the user already
    /// cleared it, and every later delivery would escalate for nothing.
    #[test]
    fn a_line_the_user_cleared_mid_delivery_stays_clean() {
        let manager = PtyManager::default();
        let (session, writer) = resting_guard_session(&manager, "c3-clear-mid");
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        manager
            .start_submit_guard(
                "c3-clear-mid",
                "alpha task text".into(),
                Some(GUARD_TEST_MARKER),
                move |event| sink.lock().unwrap().push(event),
            )
            .unwrap();
        wait_until("the task to be written", || {
            writer.typed().contains("alpha task text")
        });
        manager.write_user_input("c3-clear-mid", "\u{15}").unwrap();
        writer.refuse_enter();
        let deadline = Instant::now() + Duration::from_secs(10);
        while !(events
            .lock()
            .unwrap()
            .contains(&SubmitGuardEvent::Escalated)
            && session.delivery_turns.is_empty())
            && Instant::now() < deadline
        {
            session.scrollback.lock().unwrap().push(b"alpha task text");
            std::thread::sleep(Duration::from_millis(200));
        }
        assert!(session.delivery_turns.is_empty(), "the guard never ended");
        manager.kill("c3-clear-mid").unwrap();
        assert!(
            !session.delivery_turns.input_dirty(),
            "the guard's drop undid the user's clear"
        );
    }

    /// Codex review (PR #81, second round, P2): a user's clear that lands
    /// right after the guard's task write must win - the text is gone. The
    /// write and its bookkeeping must be one step towards the clear, or the
    /// guard records the clear's new epoch and its drop marks the emptied
    /// line dirty again.
    #[test]
    fn a_clear_right_after_the_task_write_wins() {
        let turns = Arc::new(DeliveryTurns::default());
        let turn = turns.join();
        let pty: Mutex<PtyWriter> = Mutex::new(Box::new(Vec::<u8>::new()));
        let mut writer = pty.lock().unwrap();
        std::thread::scope(|scope| {
            turn.type_task(&mut writer, |_| {
                // The task bytes have landed; the user clears at once.
                let turns = Arc::clone(&turns);
                scope.spawn(move || turns.clear_input_dirty());
                std::thread::sleep(Duration::from_millis(100));
            });
        });
        drop(turn);
        assert!(
            !turns.input_dirty(),
            "the guard's bookkeeping overtook the user's clear"
        );
    }

    /// Review GLM-5.3 (second round) X2: a bracketed paste may reach
    /// `write_pty` in two chunks. The return inside its second half is
    /// still paste content, not an Enter, and must not clear the line.
    #[test]
    fn a_paste_split_across_chunks_does_not_clear_the_line() {
        let manager = PtyManager::default();
        let (session, _writer) = resting_guard_session(&manager, "c3-split-paste");
        let turn = session.delivery_turns.join();
        turn.set_input_pending(true);
        drop(turn);
        manager
            .write_user_input("c3-split-paste", "\u{1b}[200~first")
            .unwrap();
        manager
            .write_user_input("c3-split-paste", "second\r\u{1b}[201~")
            .unwrap();
        assert!(
            session.delivery_turns.input_dirty(),
            "the return inside the paste cleared the line"
        );
        manager.write_user_input("c3-split-paste", "\r").unwrap();
        assert!(!session.delivery_turns.input_dirty(), "a real Enter clears");
    }

    /// Review DeepSeek-V4-Pro (second round) X2: a guard that dies before
    /// its task reaches the PTY has typed nothing - the line stays clean.
    #[test]
    fn a_guard_that_dies_before_typing_leaves_the_line_clean() {
        let manager = PtyManager::default();
        let (session, writer) = resting_guard_session(&manager, "c3-die-early");
        manager
            .start_submit_guard(
                "c3-die-early",
                "alpha task text".into(),
                Some(GUARD_TEST_MARKER),
                |event| {
                    if matches!(event, SubmitGuardEvent::Wrote { .. }) {
                        panic!("the guard dies before typing, by the test");
                    }
                },
            )
            .unwrap();
        wait_until("the guard to leave the queue", || {
            session.delivery_turns.is_empty()
        });
        manager.kill("c3-die-early").unwrap();
        assert!(!writer.typed().contains("alpha task text"));
        assert!(
            !session.delivery_turns.input_dirty(),
            "nothing was typed, yet the line counts as dirty"
        );
    }

    /// Review round three: a Tab inserts text or completes a word (DeepSeek
    /// X1), and Ctrl-J (`\n`) is a newline inside a multi-line composer
    /// rather than a send (GLM-5.3 X1) - neither leaves the line empty.
    #[test]
    fn tab_and_line_feed_do_not_empty_the_line() {
        let manager = PtyManager::default();
        let (session, _writer) = resting_guard_session(&manager, "c3-tab-lf");
        let turn = session.delivery_turns.join();
        turn.set_input_pending(true);
        drop(turn);
        for keys in ["\u{15}\t", "more\n"] {
            manager.write_user_input("c3-tab-lf", keys).unwrap();
            assert!(
                session.delivery_turns.input_dirty(),
                "{keys:?} leaves text in the line"
            );
        }
    }

    /// Codex review (PR #81, P2): what counts is the line after the whole
    /// chunk. A multi-line paste arrives as one chunk (`first\rsecond`), and
    /// a bracketed paste carries its returns as content - both leave text
    /// in the line and must not clear it.
    #[test]
    fn a_paste_that_leaves_text_in_the_line_does_not_clear_it() {
        let manager = PtyManager::default();
        let (session, _writer) = resting_guard_session(&manager, "c3-paste");
        let dirty = || {
            let turn = session.delivery_turns.join();
            turn.set_input_pending(true);
            drop(turn);
            assert!(session.delivery_turns.input_dirty());
        };
        dirty();
        for keys in [
            "first\rsecond",
            "\u{1b}[200~one\rtwo\u{1b}[201~",
            "\u{15}more text",
        ] {
            manager.write_user_input("c3-paste", keys).unwrap();
            assert!(
                session.delivery_turns.input_dirty(),
                "{keys:?} leaves text in the line"
            );
        }
        for keys in [
            "typed\r",
            "\u{1b}[200~pasted\u{1b}[201~\r",
            "junk\u{15}",
            "\u{15}\u{1b}OA\u{1b}[D",
        ] {
            dirty();
            manager.write_user_input("c3-paste", keys).unwrap();
            assert!(
                !session.delivery_turns.input_dirty(),
                "{keys:?} ends with an empty line"
            );
        }
    }

    /// Review Kimi K3 X2: a guard that panics after typing its task leaves
    /// the queue on unwind, but its text may still sit in the input line.
    /// The next guard must escalate instead of typing after it.
    #[test]
    fn a_panicking_delivery_does_not_let_the_next_one_type_behind_it() {
        let manager = PtyManager::default();
        let (session, writer) = resting_guard_session(&manager, "c3-panic");
        let second_events = Arc::new(Mutex::new(Vec::new()));
        let second_sink = Arc::clone(&second_events);

        manager
            .start_submit_guard(
                "c3-panic",
                "alpha task text".into(),
                Some(GUARD_TEST_MARKER),
                |event| {
                    if matches!(event, SubmitGuardEvent::Enter { .. }) {
                        panic!("first guard aborted on Enter by the test");
                    }
                },
            )
            .unwrap();
        manager
            .start_submit_guard(
                "c3-panic",
                "bravo task text".into(),
                Some(GUARD_TEST_MARKER),
                move |event| second_sink.lock().unwrap().push(event),
            )
            .unwrap();

        let deadline = Instant::now() + Duration::from_secs(10);
        while !reported_outcome(&second_events) && Instant::now() < deadline {
            session.scrollback.lock().unwrap().push(b"alpha task text");
            std::thread::sleep(Duration::from_millis(200));
        }
        assert!(
            reported_outcome(&second_events),
            "timed out waiting for the second guard to report"
        );
        let typed = writer.typed();
        manager.kill("c3-panic").unwrap();
        assert!(
            !typed.contains("bravo task text"),
            "second task typed behind a panicked delivery: {typed:?}"
        );
        assert_eq!(
            *second_events.lock().unwrap(),
            vec![
                SubmitGuardEvent::Queued { ahead: 1 },
                SubmitGuardEvent::InputBlocked,
                SubmitGuardEvent::Escalated
            ]
        );
    }

    /// Review A5/B6: a kill is final for the session's guards. A delivery
    /// started between the kill and the reaper must not type into the dying
    /// session; before W1-03d `start_submit_guard` reset the shared cancel
    /// flag and the new guard wrote on its first tick.
    #[test]
    fn a_delivery_started_after_a_kill_does_not_type() {
        let manager = PtyManager::default();
        let (_session, writer) = resting_guard_session(&manager, "c3-after-kill");
        manager.kill("c3-after-kill").unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        manager
            .start_submit_guard(
                "c3-after-kill",
                "alpha task text".into(),
                Some(GUARD_TEST_MARKER),
                move |event| sink.lock().unwrap().push(event),
            )
            .unwrap();
        wait_until("the guard to report its outcome", || {
            reported_outcome(&events)
        });
        assert!(
            !writer.typed().contains("alpha task text"),
            "a guard started after the kill typed: {:?}",
            writer.typed()
        );
        assert_eq!(
            *events.lock().unwrap(),
            vec![SubmitGuardEvent::SessionEnded, SubmitGuardEvent::Escalated]
        );
    }

    /// Review A5/B6: starting a delivery must not revive guards that a kill
    /// already cancelled. Before W1-03d the reset of the shared flag let the
    /// cancelled guard see its echo and send Enter into the killed session.
    #[test]
    fn a_new_delivery_does_not_revive_cancelled_guards() {
        let manager = PtyManager::default();
        let (session, writer) = resting_guard_session(&manager, "c3-revive");
        manager
            .start_submit_guard(
                "c3-revive",
                "alpha task text".into(),
                Some(GUARD_TEST_MARKER),
                |_| {},
            )
            .unwrap();
        wait_until("the first task to be written", || {
            writer.typed().contains("alpha task text")
        });
        manager.kill("c3-revive").unwrap();
        let late_events = Arc::new(Mutex::new(Vec::new()));
        let late_sink = Arc::clone(&late_events);
        manager
            .start_submit_guard(
                "c3-revive",
                "bravo task text".into(),
                Some(GUARD_TEST_MARKER),
                move |event| late_sink.lock().unwrap().push(event),
            )
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while !session.delivery_turns.is_empty() && Instant::now() < deadline {
            session.scrollback.lock().unwrap().push(b"alpha task text");
            std::thread::sleep(Duration::from_millis(200));
        }
        let typed = writer.typed();
        assert!(
            session.delivery_turns.is_empty(),
            "a cancelled guard kept its turn: {typed:?}"
        );
        assert!(
            !typed.contains('\r'),
            "a cancelled guard sent Enter into the killed session: {typed:?}"
        );
        // Review DeepSeek X2: a delivery to a dead session is not "queued".
        assert_eq!(
            *late_events.lock().unwrap(),
            vec![SubmitGuardEvent::SessionEnded, SubmitGuardEvent::Escalated]
        );
    }

    /// W1-03d (review B2): a delivery that has to wait says so, with the
    /// number of deliveries ahead of it, instead of leaving the UI on the
    /// previous guard's last event for minutes.
    #[test]
    fn a_queued_delivery_reports_how_many_are_ahead() {
        let manager = PtyManager::default();
        let (_session, writer) = resting_guard_session(&manager, "c3-queued");
        let sinks: Vec<_> = (0..3).map(|_| Arc::new(Mutex::new(Vec::new()))).collect();
        for (task, sink) in ["alpha task text", "bravo task text", "charlie task text"]
            .iter()
            .zip(&sinks)
        {
            let sink = Arc::clone(sink);
            manager
                .start_submit_guard(
                    "c3-queued",
                    (*task).into(),
                    Some(GUARD_TEST_MARKER),
                    move |event| sink.lock().unwrap().push(event),
                )
                .unwrap();
        }
        wait_until("the first task to be written", || {
            writer.typed().contains("alpha task text")
        });
        wait_until("the queued guards to report their place", || {
            sinks[1]
                .lock()
                .unwrap()
                .contains(&SubmitGuardEvent::Queued { ahead: 1 })
                && sinks[2]
                    .lock()
                    .unwrap()
                    .contains(&SubmitGuardEvent::Queued { ahead: 2 })
        });
        manager.kill("c3-queued").unwrap();
        wait_until("the queued guards to report", || {
            reported_outcome(&sinks[1]) && reported_outcome(&sinks[2])
        });
        assert_eq!(
            sinks[0].lock().unwrap().first(),
            Some(&SubmitGuardEvent::Wrote { write: 1 }),
            "the first delivery waits for nobody"
        );
        assert_eq!(
            sinks[1].lock().unwrap().first(),
            Some(&SubmitGuardEvent::Queued { ahead: 1 })
        );
        assert_eq!(
            sinks[2].lock().unwrap().first(),
            Some(&SubmitGuardEvent::Queued { ahead: 2 })
        );
    }

    /// Review GLM-5.3 X1: a delivery that already has its turn does not end
    /// in silence when the session is killed - the caller hears the outcome
    /// like a waiting guard does (review A1), or the text is lost without a
    /// trace.
    #[test]
    fn a_running_delivery_reports_when_its_session_is_killed() {
        let manager = PtyManager::default();
        let (_session, writer) = resting_guard_session(&manager, "c3-kill-running");
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        manager
            .start_submit_guard(
                "c3-kill-running",
                "alpha task text".into(),
                Some(GUARD_TEST_MARKER),
                move |event| sink.lock().unwrap().push(event),
            )
            .unwrap();
        wait_until("the task to be written", || {
            writer.typed().contains("alpha task text")
        });
        manager.kill("c3-kill-running").unwrap();
        wait_until("the killed guard to report", || reported_outcome(&events));
        assert_eq!(
            *events.lock().unwrap(),
            vec![
                SubmitGuardEvent::Wrote { write: 1 },
                SubmitGuardEvent::SessionEnded,
                SubmitGuardEvent::Escalated
            ]
        );
    }

    #[test]
    fn scrollback_keeps_only_the_tail() {
        let mut sb = Scrollback::new();
        sb.push(&vec![b'a'; SCROLLBACK_CAPACITY]);
        sb.push(b"tail");
        let out = sb.to_lossy_string();
        assert_eq!(out.len(), SCROLLBACK_CAPACITY);
        assert!(out.ends_with("tail"));
    }

    /// F-CORE-3 A.1: the guard's snapshot pairs the tail bytes with absolute
    /// stream positions under one lock, so the write baseline
    /// (`tail_since_write`) can be cut out of the same snapshot the byte
    /// counter came from.
    #[test]
    fn the_guard_snapshot_reports_absolute_positions() {
        let mut sb = Scrollback::new();
        assert_eq!(sb.snapshot(GUARD_TAIL_BYTES), (Vec::new(), 0, 0));

        sb.push(b"hello ");
        assert_eq!(sb.snapshot(GUARD_TAIL_BYTES), (b"hello ".to_vec(), 0, 6));

        sb.push(b"world");
        let (tail, start, end) = sb.snapshot(4);
        assert_eq!(tail, b"orld");
        assert_eq!((start, end), (7, 11));

        // After a ring overflow the positions keep counting absolutely: the
        // tail window starts that many bytes into the stream.
        sb.push(&vec![b'x'; SCROLLBACK_CAPACITY]);
        let total = 11 + SCROLLBACK_CAPACITY as u64;
        let (tail, start, end) = sb.snapshot(GUARD_TAIL_BYTES);
        assert_eq!(tail.len(), GUARD_TAIL_BYTES);
        assert_eq!((start, end), (total - GUARD_TAIL_BYTES as u64, total));
    }

    /// F-CORE-3 C-6 (Review Claude): faellt der Scrollback-Lock vergiftet auf
    /// `(vec![], 0, 0)` zurueck, behaelt die Write-Marke ihren letzten Wert,
    /// und der Offset zeigt ueber das leere Tail hinaus. Der Slice muss auf
    /// leer klemmen statt im Guard-Thread zu panicken; die Normal- und
    /// Ueberlauf-Faelle bleiben unveraendert.
    #[test]
    fn the_write_baseline_slice_is_clamped_to_the_tail() {
        // Der Poison-Fall: Marke jenseits des leeren Tails.
        let (slice, overflowed) = tail_since_mark(&[], 0, 42);
        assert!(slice.is_empty(), "clamped instead of panicking");
        assert!(!overflowed);

        // Normalfall: Offset innerhalb des Tails.
        let (slice, overflowed) = tail_since_mark(b"hello", 0, 2);
        assert_eq!(slice, b"llo");
        assert!(!overflowed);

        // Ueberlauf-Regel: die Marke ist aus dem Fenster gerollt - das Echo
        // koennte schon herausgescrollt sein und gilt.
        let (slice, overflowed) = tail_since_mark(b"hello", 10, 5);
        assert_eq!(slice, b"hello");
        assert!(overflowed);
    }

    /// A session setup error after the child started must not leave the
    /// process running: every such path kills and reaps it first, or the
    /// agent keeps living with no reader, no reaper and no registry entry.
    #[test]
    fn a_failed_setup_kills_and_reaps_the_half_started_child() {
        #[derive(Debug, Default)]
        struct Record {
            killed: bool,
            waited: bool,
        }

        #[derive(Debug, Clone, Default)]
        struct FakeChild {
            record: Arc<Mutex<Record>>,
            wait_fails: bool,
        }

        impl portable_pty::ChildKiller for FakeChild {
            fn kill(&mut self) -> std::io::Result<()> {
                self.record.lock().unwrap().killed = true;
                Ok(())
            }

            fn clone_killer(&self) -> Box<dyn portable_pty::ChildKiller + Send + Sync> {
                Box::new(self.clone())
            }
        }

        impl portable_pty::Child for FakeChild {
            fn try_wait(&mut self) -> std::io::Result<Option<portable_pty::ExitStatus>> {
                Ok(None)
            }

            fn wait(&mut self) -> std::io::Result<portable_pty::ExitStatus> {
                self.record.lock().unwrap().waited = true;
                if self.wait_fails {
                    return Err(std::io::Error::other("unconfirmed cleanup"));
                }
                Ok(portable_pty::ExitStatus::with_exit_code(1))
            }

            fn process_id(&self) -> Option<u32> {
                None
            }

            #[cfg(windows)]
            fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
                None
            }
        }

        let child = FakeChild::default();
        let record = Arc::clone(&child.record);
        let mut boxed: Box<dyn portable_pty::Child + Send + Sync> = Box::new(child);
        assert!(abort_failed_spawn(&mut *boxed));

        let mut unresolved = FakeChild {
            wait_fails: true,
            ..Default::default()
        };
        assert!(!abort_failed_spawn(&mut unresolved));

        let record = record.lock().unwrap();
        assert!(record.killed, "the half-started child must be killed");
        assert!(record.waited, "and reaped, or it stays a zombie");
    }

    /// The shutdown grace is for sessions that exist: with none, the wait
    /// must return at once rather than spend it.
    #[test]
    fn kill_all_and_wait_returns_at_once_without_sessions() {
        let manager = PtyManager::default();
        let started = Instant::now();
        manager.kill_all_and_wait(Duration::from_secs(5));
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "an empty registry must not wait out the grace"
        );
    }

    #[test]
    fn scrollback_truncates_oversized_writes() {
        let mut sb = Scrollback::new();
        sb.push(&vec![b'x'; SCROLLBACK_CAPACITY + 512]);
        assert_eq!(sb.to_lossy_string().len(), SCROLLBACK_CAPACITY);
    }

    #[test]
    fn utf8_stream_joins_split_characters() {
        let mut stream = Utf8Stream::new();
        // "ä" is 0xC3 0xA4 - split across two reads.
        assert_eq!(stream.push(&[0xC3]), "");
        assert_eq!(stream.push(&[0xA4]), "ä");
    }

    #[test]
    fn utf8_stream_replaces_invalid_bytes() {
        let mut stream = Utf8Stream::new();
        assert_eq!(stream.push(&[b'a', 0xFF, b'b']), "a\u{FFFD}b");
    }

    /// Run `profile` in a real PTY and return everything it printed.
    ///
    /// Mirrors the production flow: the master handle stays alive for the whole
    /// read, and output is consumed incrementally rather than via `read_to_end`.
    /// Every caller is a `#[cfg(windows)]` test (ConPTY), so the helper is
    /// Windows-only too - otherwise clippy meets dead code on unix.
    #[cfg(all(test, windows))]
    fn run_in_pty(profile: &AgentProfile) -> String {
        run_in_pty_with_ack(profile, None)
    }

    #[cfg(all(test, windows))]
    fn run_in_pty_with_ack(profile: &AgentProfile, expected: Option<&str>) -> String {
        run_command_in_pty(build_command(profile), expected)
    }

    #[cfg(all(test, windows))]
    fn run_command_in_pty(command: CommandBuilder, expected: Option<&str>) -> String {
        use std::sync::mpsc::{self, RecvTimeoutError};
        use std::time::{Duration, Instant};

        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");
        let mut child = pair.slave.spawn_command(command).expect("spawn");
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().expect("reader");
        let mut writer = pair.master.take_writer().expect("writer");
        let (tx, rx) = mpsc::channel();
        let (reader_outcome_tx, reader_outcome_rx) = mpsc::sync_channel(1);
        let reader_finished = track_reader_retirement(move || {
            let mut buf = vec![0u8; 4096];
            let outcome = loop {
                match reader.read(&mut buf) {
                    Ok(0) => break "eof".to_string(),
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break "receiver disconnected".to_string();
                        }
                    }
                    Err(error) => break format!("read error: {error}"),
                }
            };
            let _ = reader_outcome_tx.try_send(outcome);
        });

        let started = Instant::now();
        let deadline = started + Duration::from_secs(15);
        let mut out = Vec::new();
        let mut answered_dsr = false;
        let mut dsr_reply_error = None;
        let mut acknowledged = false;
        let mut loop_exit = "deadline";
        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(chunk) => {
                    out.extend_from_slice(&chunk);
                    // ConPTY probes the terminal with a Device Status Report and
                    // stalls until it is answered. xterm.js replies on its own;
                    // this stand-in terminal has to do it by hand.
                    if !answered_dsr && out.windows(4).any(|w| w == b"[6n") {
                        // Answer once, as before; a failed write is recorded,
                        // never retried (a partial reply must not be repeated).
                        answered_dsr = true;
                        if let Err(error) = writer
                            .write_all(CURSOR_POSITION_REPLY)
                            .and_then(|()| writer.flush())
                        {
                            dsr_reply_error = Some(error.to_string());
                        }
                    }
                    if !acknowledged
                        && expected.is_some_and(|marker| {
                            out.windows(marker.len())
                                .any(|bytes| bytes == marker.as_bytes())
                        })
                    {
                        // Keep the fixture alive until its actual PTY output
                        // has arrived. A fast child exit can race ConPTY's
                        // output forwarding on the hosted Windows runner.
                        writer
                            .write_all(b"PROJECTA_TEST_EXIT\r\n")
                            .expect("ack output");
                        writer.flush().expect("flush output acknowledgement");
                        acknowledged = true;
                    }
                }
                Err(RecvTimeoutError::Disconnected) => {
                    loop_exit = "reader disconnected";
                    break;
                }
                Err(RecvTimeoutError::Timeout) => {
                    // Output has stopped and the child is gone: we have it all.
                    if !out.is_empty() && matches!(child.try_wait(), Ok(Some(_))) {
                        loop_exit = "child exited";
                        break;
                    }
                }
            }
        }
        let status_before_cleanup = format!("{:?}", child.try_wait());
        let reader_before_cleanup = format!("{:?}", reader_outcome_rx.try_recv());
        let elapsed = started.elapsed();
        let _ = child.kill();
        let _ = child.wait();
        drop(writer);
        drop(pair.master);
        await_reader_retirement(&reader_finished, READER_RETIREMENT_TIMEOUT)
            .expect("native PTY reader retired after master close");
        if expected.is_some_and(|marker| {
            !out.windows(marker.len())
                .any(|bytes| bytes == marker.as_bytes())
        }) {
            eprintln!(
                "native PTY fixture missing marker: bytes={}, elapsed={elapsed:?}, loop_exit={loop_exit}, pre-cleanup status={status_before_cleanup}, reader_before_cleanup={reader_before_cleanup}, reader_outcome_if_first_was_empty={:?}, DSR seen={answered_dsr}, DSR reply error={dsr_reply_error:?}, escaped_output={:?}",
                out.len(),
                reader_outcome_rx.try_recv(),
                String::from_utf8_lossy(&out)
            );
        }
        String::from_utf8_lossy(&out).into_owned()
    }

    /// W5-02b manual run against the real machine: every built-in provider
    /// CLI that is installed still starts under `strict`, and a real push to
    /// this repository's `origin` fails without asking. Ignored because it
    /// needs the installed CLIs and the user's real credentials; it prints
    /// only versions and git's refusal, never a credential.
    /// `cargo test --bin projecta -- --ignored manual_strict_env_ -- --nocapture`
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn manual_strict_env_starts_provider_clis_and_blocks_a_real_push() {
        let strict = crate::profiles::EnvPolicy {
            isolation: crate::profiles::EnvIsolation::Strict,
            passthrough: Vec::new(),
        };
        let gh = crate::testutil::TempDir::new("w5-02b-manual");
        for base in crate::profiles::default_profiles() {
            if resolve_windows_program(&base.command).is_none() {
                eprintln!("{}: not installed, skipped", base.id);
                continue;
            }
            let profile = AgentProfile {
                args: vec!["--version".into()],
                env_policy: strict.clone(),
                ..base
            };
            let mut cmd = build_command(&profile);
            agent_env::apply(&mut cmd, &profile, &[], Some(gh.path())).expect("apply");
            let out = crate::status::strip_ansi(&run_command_in_pty(cmd, None));
            let version = out
                .lines()
                .map(|line| line.trim_matches(|c: char| c.is_control() || c == ' '))
                .rfind(|line| line.chars().any(|c| c.is_ascii_digit()) && line.contains('.'))
                .unwrap_or("");
            eprintln!(
                "{}: {:?}",
                profile.id,
                version.chars().take(80).collect::<String>()
            );
            assert!(
                !version.is_empty(),
                "{} did not start under strict",
                profile.id
            );
        }

        // allowlist keeps today's push path (GCM via the credential store);
        // strict must refuse it. --dry-run: nothing is ever written.
        for (isolation, may_push) in [
            (crate::profiles::EnvIsolation::Allowlist, true),
            (crate::profiles::EnvIsolation::Strict, false),
        ] {
            let profile = AgentProfile {
                command: "git".into(),
                env_policy: crate::profiles::EnvPolicy {
                    isolation,
                    passthrough: Vec::new(),
                },
                ..crate::profiles::default_profiles().remove(0)
            };
            let mut cmd = build_command(&profile);
            agent_env::apply(&mut cmd, &profile, &[], Some(gh.path())).expect("apply");
            let env: Vec<(String, String)> = cmd
                .iter_full_env_as_str()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect();
            let output = std::process::Command::new("git")
                // The probe must not start this repository's pre-push gate lane.
                .arg("-c")
                .arg(format!("core.hooksPath={}", gh.path().display()))
                .args(["-C", env!("CARGO_MANIFEST_DIR"), "push", "--dry-run"])
                .args(["origin", "HEAD:refs/heads/w5-02b-probe-never-created"])
                .env_clear()
                .envs(env)
                .stdin(std::process::Stdio::null())
                .output()
                .expect("git push");
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!(
                "{isolation:?} git push --dry-run: success={} stderr={}",
                output.status.success(),
                stderr.trim()
            );
            assert_eq!(output.status.success(), may_push, "{isolation:?}");
        }
    }

    /// W5-02b end to end: the PTY child itself prints what it inherited.
    #[cfg(windows)]
    #[test]
    fn pty_child_sees_only_the_allowlisted_environment() {
        const SENTINEL: &str = "w5-02b-sentinel-not-a-real-token";
        let profile = AgentProfile {
            id: "test".into(),
            name: "test".into(),
            command: "cmd".into(),
            args: vec!["/C".into(), "set".into()],
            caps: Default::default(),
            env: Default::default(),
            fallback: None,
            enabled: true,
            env_policy: crate::profiles::EnvPolicy {
                isolation: crate::profiles::EnvIsolation::Allowlist,
                passthrough: Vec::new(),
            },
        };
        let mut cmd = build_command(&profile);
        // What ProjectA's own environment could carry.
        for name in [
            "GH_TOKEN",
            "GITHUB_TOKEN",
            "OPENAI_API_KEY",
            "SSH_AUTH_SOCK",
        ] {
            cmd.env(name, SENTINEL);
        }
        let gh = crate::testutil::TempDir::new("w5-02b-pty");
        agent_env::apply(&mut cmd, &profile, &[], Some(gh.path())).expect("apply");
        let out = run_command_in_pty(cmd, None).to_ascii_uppercase();
        assert!(out.contains("PATH="), "the child printed no PATH");
        assert!(out.contains("SYSTEMROOT="), "the child lost SystemRoot");
        assert!(
            !out.contains(&SENTINEL.to_ascii_uppercase()),
            "a planted secret reached the PTY child"
        );
        for name in [
            "GH_TOKEN=",
            "GITHUB_TOKEN=",
            "OPENAI_API_KEY=",
            "SSH_AUTH_SOCK=",
        ] {
            assert!(!out.contains(name), "{name} reached the PTY child");
        }
    }

    #[cfg(windows)]
    #[test]
    fn spawns_a_path_resolved_exe_in_a_pty() {
        let profile = AgentProfile {
            id: "test".into(),
            name: "test".into(),
            command: "cmd".into(),
            args: vec!["/C".into(), "echo projecta-pty-ok".into()],
            caps: Default::default(),
            env: Default::default(),
            fallback: None,
            enabled: true,
            env_policy: Default::default(),
        };
        assert!(run_in_pty(&profile).contains("projecta-pty-ok"));
    }

    /// The shim text `cmd-shim` generates, byte for byte - kept apart from
    /// writing it to disk so the parser tests can feed it in on any platform.
    fn npm_shim_text(script: &str) -> String {
        format!(
            "@ECHO off\r\n\
             GOTO start\r\n\
             :find_dp0\r\n\
             SET dp0=%~dp0\r\n\
             EXIT /b\r\n\
             :start\r\n\
             SETLOCAL\r\n\
             CALL :find_dp0\r\n\
             \r\n\
             IF EXIST \"%dp0%\\node.exe\" (\r\n\
             \x20 SET \"_prog=%dp0%\\node.exe\"\r\n\
             ) ELSE (\r\n\
             \x20 SET \"_prog=node\"\r\n\
             \x20 SET PATHEXT=%PATHEXT:;.JS;=;%\r\n\
             )\r\n\
             \r\n\
             endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & \"%_prog%\"  \
             \"%dp0%\\{script}\" %*\r\n"
        )
    }

    /// Write an npm-style shim into `dir`, pointing at `script`.
    ///
    /// Byte for byte the shape `cmd-shim` generates, because that is what the
    /// resolver claims to understand.
    #[cfg(windows)]
    fn npm_shim(dir: &std::path::Path, name: &str, script: &str) -> std::path::PathBuf {
        let shim = dir.join(format!("{name}.cmd"));
        std::fs::write(&shim, npm_shim_text(script)).expect("write shim");
        shim
    }

    /// The parser is pure string work, so the generated shape has to parse on
    /// every platform - this is the gate-runnable twin of the
    /// `#[cfg(windows)]` end-to-end tests below.
    #[test]
    fn a_generated_shims_invocation_parses_on_any_platform() {
        let dir = std::env::temp_dir().join(format!("projecta-pty-parse-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let script = npm_shim_text("node_modules/fake/cli.js");

        let tokens = parse_shim_invocation(&script, &dir).expect("a generated shim parses");
        let _ = std::fs::remove_dir_all(&dir);

        // No node.exe beside the shim, so `%_prog%` is the PATH fallback...
        assert_eq!(tokens[0], "node");
        // ... and `%dp0%` became the shim's own directory, without the
        // trailing separator `%~dp0` keeps.
        let prefix = dir
            .to_string_lossy()
            .trim_end_matches(['\\', '/'])
            .to_string();
        assert_eq!(tokens[1], format!("{prefix}\\node_modules/fake/cli.js"));
        // `%*` is dropped: the caller's arguments take its place.
        assert_eq!(tokens.len(), 2);
    }

    /// What the parser does not recognise is refused, not guessed at: a
    /// hand-written batch file, an unknown variable, a `%*` that is not the
    /// last token, a `%_prog%` the file never sets.
    #[test]
    fn the_parser_refuses_what_it_cannot_reproduce() {
        let dir = std::path::Path::new(".");
        assert_eq!(
            parse_shim_invocation("@echo off\r\necho hallo %*\r\n", dir),
            None
        );
        assert_eq!(
            parse_shim_invocation(
                "endLocal & \"%SOMETHING_ELSE%\" \"%dp0%\\cli.js\" %*\r\n",
                dir
            ),
            None
        );
        assert_eq!(
            parse_shim_invocation("\"%dp0%\\cli.js\" %* --appended\r\n", dir),
            None
        );
        assert_eq!(
            parse_shim_invocation("\"%_prog%\" \"%dp0%\\cli.js\" %*\r\n", dir),
            None
        );
    }

    #[test]
    fn quotes_hold_tokens_and_splits_together() {
        assert_eq!(
            tokenize_command("  \"%_prog%\"  \"a b\" %*"),
            vec!["%_prog%", "a b", "%*"]
        );
        let parts = split_outside_quotes("title x & \"a & b\" & c", '&');
        assert_eq!(parts, vec!["title x ", " \"a & b\" ", " c"]);
        assert_eq!(
            expand_shim_token("%dp0%\\cli.js", std::path::Path::new("C:\\shims")),
            Some("C:\\shims\\cli.js".to_string())
        );
        assert_eq!(
            expand_shim_token("%UNKNOWN%", std::path::Path::new(".")),
            None
        );
    }

    /// The shim's own `IF EXIST` rule: a `node.exe` beside the shim wins over
    /// the `PATH` fallback.
    #[test]
    fn a_bundled_node_wins_over_the_path_fallback() {
        let dir = std::env::temp_dir().join(format!("projecta-pty-prog-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        std::fs::write(dir.join("node.exe"), b"").expect("bundled node");

        let bundled = expand_shim_token("%_prog%", &dir).expect("known variable");
        let expected = dir.join("node.exe").to_string_lossy().into_owned();
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(bundled, expected);
        // With the directory gone the same token is the PATH fallback.
        assert_eq!(expand_shim_token("%_prog%", &dir), Some("node".to_string()));
    }

    /// Phase 16, the heart of it: a quotation mark and a `%VAR%` in an
    /// argument have to arrive at the agent as data.
    ///
    /// Without the shim resolution the command line reads
    /// `cmd.exe /C <shim> --append-system-prompt "er sagte \"hi\" zu %PATH%"`.
    /// `portable_pty` writes `\"` because that is the CRT convention every
    /// normal Windows program is parsed by; `cmd.exe` does not know it and
    /// only counts quotes, so the quoted run ends at the first inner quote and
    /// the rest is re-tokenised - and `%PATH%` is expanded on the way past.
    /// Resolved, `CreateProcess` is called with the interpreter directly and
    /// nothing looks at the argument twice.
    #[cfg(windows)]
    #[test]
    fn an_argument_with_a_quote_and_a_variable_survives_the_command_build() {
        let dir = std::env::temp_dir().join(format!("projecta-pty-argv-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let shim = npm_shim(&dir, "projecta-fake-argv", "node_modules/fake/cli.js");

        let text = "er sagte \"hi\" zu %PATH% & echo pwned";
        let profile = AgentProfile {
            id: "test".into(),
            name: "test".into(),
            command: shim.to_string_lossy().into_owned(),
            args: vec!["--append-system-prompt".into(), text.into()],
            caps: Default::default(),
            env: Default::default(),
            fallback: None,
            enabled: true,
            env_policy: Default::default(),
        };
        let argv: Vec<String> = build_command(&profile)
            .get_argv()
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let _ = std::fs::remove_file(&shim);

        // No interpreter in front of the program any more...
        assert!(
            !argv[0].to_ascii_lowercase().contains("cmd.exe"),
            "still routed through cmd.exe: {argv:?}"
        );
        assert!(!argv.iter().any(|a| a == "/C"), "{argv:?}");
        // ... the script the shim would have started is there instead ...
        assert!(argv[1].ends_with("cli.js"), "{argv:?}");
        // ... and the text is one argument, byte for byte as it went in.
        assert_eq!(argv.last().map(String::as_str), Some(text), "{argv:?}");
    }

    /// The resolver reads only the one generated shape it claims to; anything
    /// else keeps the `%COMSPEC%` route, which is still the only way to run a
    /// batch file at all.
    #[cfg(windows)]
    #[test]
    fn an_unreadable_shim_still_goes_through_comspec() {
        let dir =
            std::env::temp_dir().join(format!("projecta-pty-fallback-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let shim = dir.join("projecta-handwritten.cmd");
        std::fs::write(&shim, "@echo off\r\necho hallo %*\r\n").expect("write shim");

        assert_eq!(resolve_cmd_shim(&shim), None);
        let (program, prefix) = windows_invocation(&shim);
        assert!(
            program
                .to_string_lossy()
                .to_ascii_lowercase()
                .contains("cmd"),
            "{program:?}"
        );
        assert_eq!(
            prefix.first().map(|a| a.to_string_lossy().into_owned()),
            Some("/C".to_string())
        );

        // A shim whose invocation uses a variable this module does not know is
        // refused rather than guessed at.
        let unknown = dir.join("projecta-unknown-var.cmd");
        std::fs::write(
            &unknown,
            "endLocal & \"%SOMETHING_ELSE%\" \"%dp0%\\cli.js\" %*\r\n",
        )
        .expect("write shim");
        assert_eq!(resolve_cmd_shim(&unknown), None);

        let _ = std::fs::remove_file(&shim);
        let _ = std::fs::remove_file(&unknown);
    }

    /// The same text, through a real PTY and a real `node`, printed back by
    /// the script the shim points at. `argv` is what the process itself sees,
    /// so this is the end of the chain rather than a claim about it.
    #[cfg(windows)]
    #[test]
    fn a_quote_and_a_variable_reach_the_process_unchanged() {
        let Some(node) = resolve_windows_program("node") else {
            eprintln!("node is not on the PATH; skipping the end-to-end argv check");
            return;
        };
        // The first node.exe start on a fresh hosted runner can outlast the
        // PTY deadline: CI showed node's console title with DSR answered but
        // no script output and no argv sidecar after 15 s, while 1200 warm
        // repetitions on the same image all passed. Starting node once outside
        // the PTY keeps that cold start out of the deadline below, which then
        // measures only the PTY path this test is about.
        let _ = std::process::Command::new(&node)
            .args(["-e", ""])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();

        let dir = std::env::temp_dir().join(format!("projecta-pty-e2e-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("node_modules").join("fake")).expect("temp dir");
        let cli = dir.join("node_modules").join("fake").join("cli.js");
        let script_argv_path = cli.with_extension("js.started");
        if let Err(error) = std::fs::remove_file(&script_argv_path) {
            assert_eq!(
                error.kind(),
                std::io::ErrorKind::NotFound,
                "remove stale argv sidecar: {error}"
            );
        }
        std::fs::write(
            &cli,
            "try { require('fs').writeFileSync(__filename + '.started', JSON.stringify(process.argv.slice(2))); } catch (_) {}\n\
             process.stdin.setEncoding('utf8');\n\
             let input = '';\n\
             process.stdin.on('data', chunk => { input += chunk; if (input.includes('PROJECTA_TEST_EXIT')) process.exit(0); });\n\
             process.stdin.resume();\n\
             console.log('ARGV<' + process.argv.slice(2).join('|') + '>');\n",
        )
        .expect("write cli");
        let shim = npm_shim(&dir, "projecta-fake-e2e", "node_modules/fake/cli.js");

        let text = "er sagte \"hi\" zu %PATH%";
        let profile = AgentProfile {
            id: "test".into(),
            name: "test".into(),
            command: shim.to_string_lossy().into_owned(),
            args: vec!["--append-system-prompt".into(), text.into()],
            caps: Default::default(),
            env: Default::default(),
            fallback: None,
            enabled: true,
            env_policy: Default::default(),
        };
        let expected = format!("ARGV<--append-system-prompt|{text}>");
        let out = run_in_pty_with_ack(&profile, Some(&expected));
        let script_argv = std::fs::read_to_string(&script_argv_path);
        let _ = std::fs::remove_dir_all(&dir);

        assert!(
            out.contains(&expected),
            "the argument did not arrive as data: {out:?}; script argv sidecar: {script_argv:?}"
        );
    }

    /// W1-01 (NT-17, Kimi): the first four bytes Kimi Code 0.43.0 ever
    /// prints are `ESC[6n`, and without a reply it prints nothing else
    /// (`testdata/pty/kimi-0.43.0-composer-2026-09-16.raw` starts with them;
    /// the no-reply run stayed at four bytes for 200 s). The reader must
    /// find the query even when a read boundary splits it, and must not be
    /// fooled by the queries it does not answer (`ESC[?996n`).
    #[test]
    fn a_cursor_position_report_is_found_across_read_chunks() {
        let mut scanner = CursorReportScanner::default();
        assert_eq!(scanner.feed(b"\x1b[6n\x1b[?9001h\x1b[?1004h"), 1);
        assert_eq!(scanner.feed(b"\x1b["), 0, "half a query is not a query");
        assert_eq!(scanner.feed(b"6n"), 1, "the second half completes it");
        assert_eq!(scanner.feed(b"\x1b[?996n\x1b[?u\x1b[m"), 0);
        assert_eq!(scanner.feed(b"\x1b\x1b[6n\x1b[6n"), 2);
        assert_eq!(CURSOR_POSITION_REPLY, b"\x1b[1;1R");
    }

    // Retain the Claude regression's historical Test-First target after the
    // Kimi scanner integration. Exercise the current reader primitives.
    #[test]
    fn a_cursor_position_query_is_answered_by_the_reader() {
        let mut scanner = CursorReportScanner::default();
        assert_eq!(scanner.feed(b"\x1b[6n\x1b[?9001h\x1b[?1004h"), 1);
        assert_eq!(CURSOR_POSITION_REPLY, b"\x1b[1;1R");
        assert_eq!(scanner.feed(b"plain output\x1b[?25h"), 0);
        assert_eq!(scanner.feed(b"\x1b[6"), 0);
        assert_eq!(scanner.feed(b"n"), 1);
    }

    /// npm-installed agents (`claude`, `codex`, ...) are `.cmd` shims on Windows,
    /// which `CreateProcess` refuses to run directly.
    #[cfg(windows)]
    #[test]
    fn spawns_a_cmd_shim_through_comspec() {
        let dir = std::env::temp_dir().join("projecta-pty-shim-test");
        std::fs::create_dir_all(&dir).expect("temp dir");
        let shim = dir.join("projecta-fake-agent.cmd");
        std::fs::write(&shim, "@echo off\r\necho projecta-shim-ok %*\r\n").expect("write shim");

        let profile = AgentProfile {
            id: "test".into(),
            name: "test".into(),
            command: shim.to_string_lossy().into_owned(),
            args: vec!["arg1".into()],
            caps: Default::default(),
            env: Default::default(),
            fallback: None,
            enabled: true,
            env_policy: Default::default(),
        };
        let out = run_in_pty(&profile);
        let _ = std::fs::remove_file(&shim);

        assert!(out.contains("projecta-shim-ok"), "unexpected output: {out}");
        assert!(out.contains("arg1"), "args were not forwarded: {out}");
    }
}
