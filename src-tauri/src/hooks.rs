//! Hook receiver: the agent tells us what it is doing.
//!
//! Heuristics on terminal output are guesswork. Claude Code, though, can be
//! asked to report its own lifecycle through *hooks* - shell commands it runs
//! on `SessionStart`, `Notification`, `PermissionRequest` and `Stop`, each
//! handed the event as JSON on stdin.
//!
//! So ProjectA listens on an ephemeral loopback port and hands every worker a
//! generated settings file whose hooks `POST` that stdin straight back:
//!
//! ```text
//! POST http://127.0.0.1:<port>/hook/<worker_id>
//! x-projecta-hook-secret: <this worker's secret>
//! { "hook_event_name": "Notification", "message": "Claude needs your permission" }
//! ```
//!
//! The settings live in a per-worker generated file passed with `--settings`.
//! The user's own `~/.claude/settings.json` is never read and never written.
//!
//! The server is deliberately tiny: a `TcpListener`, one thread per connection,
//! and just enough HTTP to find the path, the secret and the body. There is
//! nothing here worth a framework. "One thread per connection" is capped,
//! though: past [`crate::http_util::MAX_CONNECTIONS`] live connections the
//! accept loop answers 503 itself instead of spending another thread.
//!
//! ## What a request can do, and why it needs a secret
//!
//! An accepted hook does two things: it moves the worker's card on the board,
//! *and* it writes the payload into that worker's message log
//! ([`crate::store::Store::insert_message`]). The second one is why this port
//! is authenticated like the control API next door. That log is read back by
//! [`crate::critic`] as the evidence a learning is distilled from, and a `Stop`
//! event is what moves the card to `done` and sets the critic going in the
//! first place - so an unauthenticated write here is a write into the app's
//! memory, not a cosmetic one.
//!
//! So every worker gets a secret of its own, minted when its settings file is
//! written, stored in a private curl `--config` file (not in the hook command
//! that becomes process argv), and checked in [`serve`]. A request without it,
//! or with another worker's, is refused before anything reaches the database.
//!
//! **Where the boundary is.** The secret sits in a private file under the
//! application data directory that the agent can read - it has to, curl `-K`
//! opens that file when the hook fires. That is deliberate: the point is that
//! *other* local processes cannot write into *this* worker's log, not that the
//! agent is kept from its own. An agent that reads its own curl config and
//! posts its own hooks is doing exactly what it was started to do. The
//! settings command itself must not carry the secret: that string becomes
//! argv, visible to every local process list.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};

use crate::http_util::{
    answer_overloaded, connection_limiter, token_eq, try_acquire_connection, ConnectionLimiter,
    MAX_BODY, MAX_HEAD,
};
use crate::profiles::AgentProfile;
use crate::status::StatusEngine;
use crate::store::{Store, MSG_AGENT};

/// The Claude Code hook events ProjectA subscribes to.
pub const HOOK_EVENTS: [&str; 4] = ["SessionStart", "Notification", "PermissionRequest", "Stop"];

/// A slow or wedged client must not tie up a thread forever. Shared with the
/// other two hand-rolled servers, and set on the connection before the first
/// read, so it covers the head exactly as it covers the body.
const IO_TIMEOUT: Duration = Duration::from_secs(5);

/// Total budget for one whole request, enforced by [`read_request`] for all
/// three servers at once. [`IO_TIMEOUT`] alone caps only a *single* `read`:
/// a client that answers every read just inside the window - one byte every
/// four seconds, say - holds its connection slot for as long as the byte caps
/// allow, which at [`MAX_BODY`] is measured in days, not seconds. Thirty
/// seconds stays generous for the largest honest request these servers ever
/// see (a hook post arrives in milliseconds, even over LAN) and turns the
/// worst drip from days into half a minute.
const REQUEST_DEADLINE: Duration = Duration::from_secs(30);

/// Path prefix every hook posts to.
const HOOK_PATH: &str = "/hook/";
/// Path prefix for Claude Code's `statusLine` hook.
const STATUSLINE_PATH: &str = "/statusline/";

/// Header carrying a worker's hook secret. Lower case: header names are
/// compared case-insensitively, and this spares every lookup a conversion.
pub const SECRET_HEADER: &str = "x-projecta-hook-secret";

// -- per-worker secrets ----------------------------------------------------

/// The secrets of the workers started by *this* run of the app.
///
/// In memory only, and deliberately so. The port these secrets protect is
/// ephemeral: it is bound at startup and gone when the app exits, and every
/// worker is a child of that same app process. A worker that outlives the app
/// therefore has no receiver left to talk to, whatever it holds - so there is
/// nothing a persisted secret could still authorise.
static SECRETS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn secrets() -> &'static Mutex<HashMap<String, String>> {
    SECRETS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Mint a fresh secret for `worker_id`, replacing any earlier one.
///
/// Called once per settings file, which means once per spawn and once per
/// respawn: a new generation of a worker invalidates the previous one's, so a
/// late hook from a killed session cannot write into its successor's log.
fn issue_secret(worker_id: &str) -> String {
    let secret = crate::oneshot::random_hex();
    // A poisoned secrets map used to drop the new secret silently - the
    // settings file would then hold a token `secret_for` can never see, so
    // every hook from that worker looks unauthorized (W1-15). Inserting one
    // key can never leave the map itself inconsistent, so the lock is taken
    // over and logged instead.
    secrets()
        .lock()
        .unwrap_or_else(|poison| {
            eprintln!("projecta: worker secret map was poisoned while issuing a secret for {worker_id}; recovering");
            poison.into_inner()
        })
        .insert(worker_id.to_string(), secret.clone());
    secret
}

/// This worker's current secret, if it has one.
fn secret_for(worker_id: &str) -> Option<String> {
    secrets()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .get(worker_id)
        .cloned()
}

/// Drop a worker's secret. Runs with the files it belongs to, so an archived
/// worker's id stops being a valid target the moment its settings are gone.
fn forget_secret(worker_id: &str) {
    secrets()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .remove(worker_id);
}

/// Whether this request may act on `worker_id`.
///
/// A worker with no secret on file is refused rather than trusted. The two
/// ways to get here are a request for a worker this app never started, and a
/// hook from a generation whose secret has since been replaced - and in both
/// cases the honest answer is no. Rejecting also costs nothing across an
/// update: a worker from an older build was a child of an older app process
/// and died with it, so no live agent is talking to this port without a
/// secret. See [`with_hook_settings`], which mints one on every respawn.
fn authorized(head: &str, worker_id: &str) -> bool {
    let Some(expected) = secret_for(worker_id) else {
        return false;
    };
    header_value(head, SECRET_HEADER).is_some_and(|got| token_eq(got, &expected))
}

/// One header's value, matched case-insensitively by name.
fn header_value<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    head.lines()
        .skip(1) // the request line
        .filter_map(|line| line.split_once(':'))
        .find(|(header, _)| header.trim().eq_ignore_ascii_case(name))
        .map(|(_, value)| value.trim())
}

/// A running hook receiver. Registered as Tauri state so the worker commands
/// can read the port when they build an agent's settings file.
///
/// `port` is 0 when the listener could not be bound; hooks are then simply not
/// installed and the board falls back to the output heuristics.
pub struct HookReceiver {
    port: u16,
}

impl HookReceiver {
    /// A receiver that never starts. Used when binding failed.
    pub fn disabled() -> Self {
        Self { port: 0 }
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn is_enabled(&self) -> bool {
        self.port != 0
    }
}

/// Bind an ephemeral loopback port and serve hook posts into `engine`.
pub fn start(engine: Arc<StatusEngine>, store: Option<Store>) -> Result<HookReceiver, String> {
    let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0));
    let listener =
        TcpListener::bind(addr).map_err(|e| format!("failed to bind the hook receiver: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("failed to read the hook receiver port: {e}"))?
        .port();

    std::thread::spawn(move || accept_loop(listener, engine, store, connection_limiter()));

    Ok(HookReceiver { port })
}

/// Accept connections until the listener dies, admitting up to
/// [`crate::http_util::MAX_CONNECTIONS`] live ones. A connection past the
/// limit is answered by this loop itself - a fast 503 - because every thread
/// a wedged client can conjure is memory the app no longer has.
fn accept_loop(
    listener: TcpListener,
    engine: Arc<StatusEngine>,
    store: Option<Store>,
    limiter: ConnectionLimiter,
) {
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let Some(permit) = try_acquire_connection(&limiter) else {
            answer_overloaded(stream);
            continue;
        };
        let engine = Arc::clone(&engine);
        let store = store.clone();
        std::thread::spawn(move || {
            // The permit releases itself when this connection is done.
            let _permit = permit;
            serve(stream, &engine, store.as_ref());
        });
    }
}

/// Handle one connection: read the request, feed the engine, answer 204.
fn serve(mut stream: TcpStream, engine: &StatusEngine, store: Option<&Store>) {
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));

    let status_line = match read_request(&mut stream) {
        Some((head, body)) => {
            if let Some(hook) = parse_request(&head, &body) {
                // Before the engine and before the store: an unauthenticated
                // request must leave no trace at all.
                if !authorized(&head, &hook.worker_id) {
                    return answer(stream, "401 Unauthorized");
                }
                engine.note_hook(&hook.worker_id, &hook.event, hook.message.as_deref());
                if let Some(store) = store {
                    let content = hook
                        .message
                        .clone()
                        .unwrap_or_else(|| default_hook_description(&hook.event));
                    let store = store.clone();
                    let worker_id = hook.worker_id.clone();
                    let event = hook.event.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(err) = store
                            .insert_message(&worker_id, MSG_AGENT, &format!("[{event}] {content}"))
                            .await
                        {
                            eprintln!("projecta: {err}");
                        }
                    });
                }
                "204 No Content"
            } else if let Some(worker_id) = parse_statusline_request(&head, &body) {
                // The statusLine command is generated from the same settings
                // file and carries the same secret, so it is held to it too.
                if !authorized(&head, &worker_id) {
                    return answer(stream, "401 Unauthorized");
                }
                engine.note_statusline(&worker_id, &body);
                "204 No Content"
            } else {
                "400 Bad Request"
            }
        }
        None => "400 Bad Request",
    };

    answer(stream, status_line);
}

/// Write one bodyless HTTP response and close.
fn answer(mut stream: TcpStream, status_line: &str) {
    let _ = stream.write_all(
        format!("HTTP/1.1 {status_line}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .as_bytes(),
    );
    let _ = stream.flush();
}

/// Read one request, returning its head (without the blank line) and its body.
///
/// Shared with the Phase 4 control API ([`crate::api`]) and the web interface
/// ([`crate::web_interface`]), which speak the same dialect of HTTP into the
/// same kind of listener.
///
/// `None` is always a refusal, and four of the reasons are limits rather
/// than parse failures: a head that does not end within [`MAX_HEAD`] bytes, a
/// declared body beyond [`MAX_BODY`], a Content-Length this request must not
/// be trusted with (see [`content_length`]), and a request that outlives
/// [`REQUEST_DEADLINE`]. The byte caps bound how much a client can send, not
/// how long it may take; the read timeout every caller sets before this runs
/// bounds each single read, and the deadline bounds the whole wait - without
/// it a client dripping one byte just inside every read window would hold its
/// connection slot for days.
pub fn read_request(stream: &mut TcpStream) -> Option<(String, String)> {
    let deadline = std::time::Instant::now() + REQUEST_DEADLINE;
    let mut buf: Vec<u8> = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    let mut header_end: Option<usize> = None;

    loop {
        if header_end.is_none() {
            header_end = buf.windows(4).position(|w| w == b"\r\n\r\n");
        }
        match header_end {
            // A head has a size or it is not a head - and it does not matter
            // whether the terminator arrived in the same chunk that crossed
            // the cap.
            Some(end) if end > MAX_HEAD => return None,
            None if buf.len() > MAX_HEAD => return None,
            _ => {}
        }
        if let Some(end) = header_end {
            let head = String::from_utf8_lossy(&buf[..end]).into_owned();
            let start = end + 4;
            let length = content_length(&head)?;
            if length > MAX_BODY {
                return None;
            }
            if buf.len() >= start + length {
                let body = String::from_utf8_lossy(&buf[start..start + length]).into_owned();
                return Some((head, body));
            }
        }

        // The next read gets whichever ends sooner: the per-read timeout, or
        // the time this request has left. `IO_TIMEOUT` standing in for "the
        // caller's timeout" is sound because all three servers set exactly
        // IO_TIMEOUT before calling in today - a future caller with a shorter
        // per-read timeout would be widened here and must then pass its own
        // in. Capping, never widening.
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return None;
        }
        let _ = stream.set_read_timeout(Some(remaining.min(IO_TIMEOUT)));
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return None,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    }
}

/// The body length to read after this head: `Some(0)` when no Content-Length
/// is present.
///
/// `None` is a refusal, not an absence. Two Content-Length headers - even two
/// that agree - or one value that is not plain ASCII digits is the seam
/// request smuggling lives on: this parser's "first header wins" used to meet
/// another parser's "last header wins", and two parties reading two body
/// lengths from one request is how a second request gets smuggled inside the
/// first. The only answer that cannot desync is refusing the request whole.
fn content_length(head: &str) -> Option<usize> {
    let mut values = head.lines().filter_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.trim()
            .eq_ignore_ascii_case("content-length")
            .then_some(value.trim())
    });
    let Some(value) = values.next() else {
        return Some(0);
    };
    if values.next().is_some() {
        return None;
    }
    parse_content_length(value)
}

/// One Content-Length value: 1*DIGIT, nothing else. `usize::from_str` alone
/// would also take a leading `+`, which the grammar does not allow - and a
/// parser differential is exactly what this function exists to remove.
fn parse_content_length(value: &str) -> Option<usize> {
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    value.parse().ok()
}

/// One decoded hook post.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookRequest {
    pub worker_id: String,
    pub event: String,
    pub message: Option<String>,
}

/// Pull the worker id out of the path and the event out of the JSON body.
///
/// Anything that is not a `POST /hook/<id>` with a readable event name is
/// rejected: this port is reachable from every local process, so a request that
/// does not look exactly like one of our hooks is not one of our hooks.
///
/// Shape only. Whether the sender may act on the worker it names is
/// [`authorized`]'s question, and [`serve`] asks it before anything happens.
pub fn parse_request(head: &str, body: &str) -> Option<HookRequest> {
    let mut request_line = head.lines().next()?.split_whitespace();
    if !request_line.next()?.eq_ignore_ascii_case("POST") {
        return None;
    }
    let path = request_line.next()?;
    let worker_id = path.strip_prefix(HOOK_PATH)?.trim_end_matches('/');
    if worker_id.is_empty() || worker_id.contains('/') {
        return None;
    }

    let payload: Value = serde_json::from_str(body).ok()?;
    let event = payload.get("hook_event_name")?.as_str()?.trim();
    if event.is_empty() {
        return None;
    }

    Some(HookRequest {
        worker_id: worker_id.to_string(),
        event: event.to_string(),
        message: payload
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

/// Pull the worker id out of a `POST /statusline/<id>` request.
///
/// The body is the raw Claude Code statusLine JSON; it is validated later by
/// [`crate::status::StatusEngine::note_statusline`].
fn parse_statusline_request(head: &str, body: &str) -> Option<String> {
    let mut request_line = head.lines().next()?.split_whitespace();
    if !request_line.next()?.eq_ignore_ascii_case("POST") {
        return None;
    }
    let path = request_line.next()?;
    let worker_id = path.strip_prefix(STATUSLINE_PATH)?.trim_end_matches('/');
    if worker_id.is_empty() || worker_id.contains('/') || body.trim().is_empty() {
        return None;
    }
    Some(worker_id.to_string())
}

// -- settings injection ----------------------------------------------------

/// Same name as `main.rs` / `api.rs` / `pa.rs`. An isolated instance keeps
/// its generated files out of the production directory too.
const ENV_APP_DATA: &str = "PROJECTA_APP_DATA";

/// The per-user application data directory, resolved the way `bin/pa.rs`
/// resolves it: `main.rs` asks Tauri, but the paths this module writes are
/// also built from contexts without an `AppHandle`, so this asks the
/// environment the same questions Tauri's answer comes from.
///
/// Deliberately compiled in test builds too: a production path that only
/// `cargo build` ever compiles can rot while every `cargo test` stays green
/// (review S-03). The test arm of [`settings_dir`] never calls it, hence the
/// `allow(dead_code)` under test.
#[cfg_attr(test, allow(dead_code))]
fn app_data_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os(ENV_APP_DATA).filter(|path| !path.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
    });
    #[cfg(all(unix, not(target_os = "macos")))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
        });
    base.map(|dir| dir.join("com.projecta.app"))
}

#[cfg(test)]
thread_local! {
    /// A test's own hooks directory. Thread-local rather than a global
    /// because tests run in parallel, and a test that poisons its directory
    /// must not disturb its neighbours.
    static TEST_SETTINGS_DIR: std::cell::RefCell<Option<PathBuf>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn test_settings_dir() -> Option<PathBuf> {
    TEST_SETTINGS_DIR.with(|slot| slot.borrow().clone())
}

/// Run `f` with the hooks directory pointed at `dir`, then restore.
///
/// Only the unix permission tests need a poisoned directory of their own.
#[cfg(all(test, unix))]
fn with_test_settings_dir<R>(dir: &std::path::Path, f: impl FnOnce() -> R) -> R {
    TEST_SETTINGS_DIR.with(|slot| *slot.borrow_mut() = Some(dir.to_path_buf()));
    let result = f();
    TEST_SETTINGS_DIR.with(|slot| *slot.borrow_mut() = None);
    result
}

/// Directory holding the generated per-worker files (settings, agent prompts).
///
/// Lives under the per-user application data directory, not the shared temp
/// root: a directory another local user placed under `$TMPDIR` first would be
/// silently adopted here, contents and all (F-SEC-8). The app data directory
/// is private to this user from birth, and [`ensure_private_dir`] still
/// refuses anything it cannot prove is ours. Files from the temp-era location
/// are deliberately not migrated: a respawn rewrites them, and carrying them
/// over would carry their provenance questions over too.
fn settings_dir() -> PathBuf {
    #[cfg(test)]
    {
        test_settings_dir().unwrap_or_else(|| {
            std::env::temp_dir().join(format!("projecta-hooks-test-{}", std::process::id()))
        })
    }
    #[cfg(not(test))]
    {
        app_data_dir()
            // Last resort only: wherever this points, `ensure_private_dir`
            // adopts a pre-existing directory only if it provably belongs to
            // this user - so even a temp fallback cannot be taken over.
            .unwrap_or_else(|| std::env::temp_dir().join("projecta-hooks"))
            .join("hooks")
    }
}

/// Where a worker's generated file of one kind lives:
/// `<app data>/hooks/<worker_id>.<kind>.<ext>`. The settings file and the
/// orchestrator's agent file share this mechanism - one directory, one naming
/// scheme, one cleanup.
pub fn worker_file_path(worker_id: &str, kind: &str, ext: &str) -> PathBuf {
    settings_dir().join(format!("{worker_id}.{kind}.{ext}"))
}

/// Where a worker's generated settings file lives.
#[cfg(test)]
fn settings_path(worker_id: &str) -> PathBuf {
    worker_file_path(worker_id, "settings", "json")
}

/// Create the hooks directory, or prove the one already there is ours.
///
/// `create_dir_all` would silently adopt a directory another local user
/// placed first - with everything in it, and with `rename` rights over
/// anything written into it (F-SEC-8). So a fresh directory is created with
/// mode 0700, and an already-existing one must pass three checks before it is
/// used: not a symlink, no group/other permission bits, and owned by this
/// user. Ownership is proven with a probe file: what this process creates
/// carries its uid, and only the directory's owner (or root) can match it.
#[cfg(unix)]
fn ensure_private_dir(dir: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};

    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }
    let mut builder = std::fs::DirBuilder::new();
    builder.mode(0o700);
    match builder.create(dir) {
        Ok(()) => return Ok(()),
        Err(err) if err.kind() != std::io::ErrorKind::AlreadyExists => {
            return Err(format!("failed to create {}: {err}", dir.display()));
        }
        _ => {}
    }
    let meta = std::fs::symlink_metadata(dir)
        .map_err(|e| format!("failed to inspect {}: {e}", dir.display()))?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err(format!(
            "refusing to use {}: not a plain directory",
            dir.display()
        ));
    }
    let mode = meta.permissions().mode() & 0o777;
    if mode & 0o077 != 0 {
        return Err(format!(
            "refusing to use {}: group/other bits are set ({mode:o})",
            dir.display()
        ));
    }
    // The probe name is unique per call (S-02): two threads probing the same
    // directory from parallel spawns used to share `.owner-probe-<pid>`, and
    // one removing the other's probe mid-check produced a false "cannot prove
    // ownership". With a unique name there is also no leftover to clear
    // first - that pre-remove was the other half of the race.
    let probe = dir.join(format!(".owner-probe-{}", unique_file_tag()));
    let owns = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .and_then(|_| std::fs::metadata(&probe).map(|m| m.uid() == meta.uid()));
    let _ = std::fs::remove_file(&probe);
    match owns {
        Ok(true) => Ok(()),
        Ok(false) => Err(format!(
            "refusing to use {}: owned by another user",
            dir.display()
        )),
        Err(err) => Err(format!(
            "refusing to use {}: cannot prove ownership ({err})",
            dir.display()
        )),
    }
}

/// Windows has no portable create-with-mode in std; the per-user ACL of the
/// application data directory is inherited at creation, which is the best
/// std can do (same stance as `providers::write_atomic`).
#[cfg(not(unix))]
fn ensure_private_dir(dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("failed to create {}: {e}", dir.display()))
}

/// A per-call unique tag for the name of a file this process is about to
/// create with `create_new`. The process id keeps a leftover attributable to
/// the run that made it; the random tail means two racing threads never share
/// a name (the S-02 ownership probe above) and nothing can be pre-placed
/// under a guessed one (the mirror tmp file in `learnings::write_mirror`).
pub(crate) fn unique_file_tag() -> String {
    format!("{}-{}", std::process::id(), crate::oneshot::random_hex())
}

/// Write `content` to `path`, owner-only from birth.
///
/// The file is created with `create_new` and mode 0600 rather than written
/// and chmodded afterwards: between `write` and `chmod` the secret is
/// readable by the umask's courtesy, and plain `create` would follow a
/// symlink placed after the check above. A leftover from a crashed run is
/// removed once and the create retried; a second `AlreadyExists` is refused,
/// because nothing legitimate races this write.
fn write_private_file(path: &std::path::Path, content: &str) -> Result<(), String> {
    for attempt in 0..2 {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let written = options
            .open(path)
            .and_then(|mut file| file.write_all(content.as_bytes()));
        match written {
            Ok(()) => return Ok(()),
            Err(err) if attempt == 0 && err.kind() == std::io::ErrorKind::AlreadyExists => {
                std::fs::remove_file(path)
                    .map_err(|e| format!("failed to replace {}: {e}", path.display()))?;
            }
            Err(err) => return Err(format!("failed to write {}: {err}", path.display())),
        }
    }
    unreachable!("the retry loop returns on success and on every error but the first AlreadyExists")
}

/// Write one generated per-worker file, creating the directory as needed.
pub fn write_worker_file(
    worker_id: &str,
    kind: &str,
    ext: &str,
    content: &str,
) -> Result<PathBuf, String> {
    let dir = settings_dir();
    // The settings file carries this worker's hook secret, and the agent file
    // carries its task. The directory holding them must provably be ours -
    // on unix a pre-existing one is checked, not adopted (F-SEC-8).
    ensure_private_dir(&dir)?;
    let path = worker_file_path(worker_id, kind, ext);
    // A symlink at this path is not ours - nothing in this app creates one
    // here - so it was placed for this write to follow, landing the secret or
    // the prompt behind an attacker's chosen target. Refused rather than
    // followed. Checked by name first so the refusal says why, though
    // `write_private_file`'s `create_new` would not follow it either.
    if let Ok(meta) = std::fs::symlink_metadata(&path) {
        if meta.file_type().is_symlink() {
            return Err(format!(
                "refusing to write {}: a symlink is already there",
                path.display()
            ));
        }
    }
    write_private_file(&path, content)?;
    Ok(path)
}

/// The working directory of one coordinator (W5-02a): an empty, private
/// directory `<app data>/hooks-cwd/<worker_id>`, next to the hooks directory
/// but not in it - that one holds every worker's hook secret. It is outside
/// the project's repository and every worktree by construction; the caller
/// still checks that before the agent starts. The same id gets the same
/// directory back on a respawn.
pub fn coordinator_dir(worker_id: &str) -> Result<PathBuf, String> {
    let hooks = settings_dir();
    let name = hooks
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "hooks".to_string());
    let root = hooks.with_file_name(format!("{name}-cwd"));
    ensure_private_dir(&root)?;
    let dir = root.join(worker_id);
    ensure_private_dir(&dir)?;
    Ok(dir)
}

/// Delete every generated file of one worker. Best effort - leftovers are
/// harmless, but a respawn must never inherit a previous generation's files,
/// so this runs on archive AND before each respawn.
///
/// The worker's hook secret goes with them: the file that told the agent what
/// to send is gone, so the id it named must stop being a valid target too.
pub fn remove_worker_files(worker_id: &str) {
    forget_secret(worker_id);
    let Ok(entries) = std::fs::read_dir(settings_dir()) else {
        return;
    };
    let prefix = format!("{worker_id}.");
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// The command a hook runs: `curl -K` a private config that holds the
/// endpoint and this worker's secret. The command itself must not name the
/// secret — it becomes process argv.
///
/// `curl` ships with Windows 10+ and with every mainstream unix; if it is
/// missing the hook simply fails and the board falls back to the heuristics.
fn forward_command(worker_id: &str, kind: &str) -> String {
    format!(
        "curl -K \"{}\"",
        worker_file_path(worker_id, kind, "curl").display()
    )
}

/// Write the private curl `--config` that [`forward_command`] points at.
///
/// The header and URL live here so they never become argv. `write_worker_file`
/// already refuses preplaced symlinks and marks the file owner-only.
fn write_curl_config(
    worker_id: &str,
    kind: &str,
    port: u16,
    path: &str,
    secret: &str,
) -> Result<PathBuf, String> {
    let url = format!("http://127.0.0.1:{port}{path}{worker_id}");
    let body = format!(
        "silent\n\
         max-time = \"5\"\n\
         request = \"POST\"\n\
         header = \"Content-Type: application/json\"\n\
         header = \"{SECRET_HEADER}: {secret}\"\n\
         data-binary = \"@-\"\n\
         url = \"{url}\"\n"
    );
    write_worker_file(worker_id, kind, "curl", &body)
}

/// The `--settings` document wiring [`HOOK_EVENTS`] and `statusLine` to this
/// worker's private curl configs. Commands name those files, not the secret.
pub fn settings_json(worker_id: &str) -> Value {
    let mut hooks = serde_json::Map::new();
    let command = forward_command(worker_id, "hook");
    for event in HOOK_EVENTS {
        hooks.insert(
            event.to_string(),
            json!([{ "hooks": [{ "type": "command", "command": command }] }]),
        );
    }
    // Claude Code's `statusLine` is not a hook event: it sits at the top
    // level of the settings document, beside `hooks`.
    let statusline_command = forward_command(worker_id, "statusline");
    json!({
        "hooks": Value::Object(hooks),
        "statusLine": { "type": "command", "command": statusline_command }
    })
}

/// Write a worker's settings file, overwriting any previous one, and mint the
/// secret that goes with it.
///
/// Minting here rather than in the caller keeps the two halves inseparable:
/// the only settings file that exists is one whose secret the receiver knows,
/// and every rewrite retires the previous generation's. The secret is written
/// into the private curl configs first, then the settings that point at them.
pub fn write_settings(worker_id: &str, port: u16) -> Result<PathBuf, String> {
    let secret = issue_secret(worker_id);
    write_curl_config(worker_id, "hook", port, HOOK_PATH, &secret)?;
    write_curl_config(worker_id, "statusline", port, STATUSLINE_PATH, &secret)?;
    let body = serde_json::to_string_pretty(&settings_json(worker_id))
        .map_err(|e| format!("failed to render hook settings: {e}"))?;
    write_worker_file(worker_id, "settings", "json", &body)
}

/// Short description for a hook event when the agent did not send text.
fn default_hook_description(event: &str) -> String {
    match event {
        "SessionStart" => "Agent session started".to_string(),
        "Notification" => "Agent sent a notification".to_string(),
        "PermissionRequest" => "Agent is asking for permission".to_string(),
        "Stop" => "Agent finished its turn".to_string(),
        _ => format!("Agent hook: {event}"),
    }
}

/// A copy of `profile` that reports back to the hook receiver.
///
/// Returns the profile untouched for agents whose lifecycle is heuristic only,
/// when the receiver is disabled, or when the settings file cannot be written:
/// status reporting is a nicety and must never stop an agent from starting.
pub fn with_hook_settings(profile: &AgentProfile, worker_id: &str, port: u16) -> AgentProfile {
    use crate::capabilities::Lifecycle;
    let Lifecycle::SettingsHooks { flag } = &profile.caps.lifecycle else {
        return profile.clone();
    };
    if port == 0 {
        return profile.clone();
    }
    let path = match write_settings(worker_id, port) {
        Ok(path) => path,
        Err(err) => {
            eprintln!("projecta: {err}");
            return profile.clone();
        }
    };

    let mut profile = profile.clone();
    profile.args.push(flag.clone());
    profile.args.push(path.to_string_lossy().into_owned());
    profile
}

/// Send one hook payload to a running receiver. Used by the tests, and handy
/// when reproducing a board state by hand.
#[cfg(test)]
fn post_hook(
    port: u16,
    worker_id: &str,
    secret: Option<&str>,
    body: &str,
) -> Result<String, String> {
    let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
    let mut stream = TcpStream::connect(addr).map_err(|e| format!("connect: {e}"))?;
    stream
        .set_read_timeout(Some(IO_TIMEOUT))
        .map_err(|e| format!("timeout: {e}"))?;
    let auth = secret.map_or(String::new(), |s| format!("{SECRET_HEADER}: {s}\r\n"));
    let request = format!(
        "POST {HOOK_PATH}{worker_id} HTTP/1.1\r\nHost: 127.0.0.1\r\n{auth}\
         Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("write: {e}"))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|e| format!("read: {e}"))?;
    Ok(response)
}

/// Send one raw request - well-formed or not - and read whatever answer comes
/// back.
///
/// Reads to EOF but keeps what arrived when the connection resets instead: a
/// server that closes with client bytes still unread resets the connection,
/// and the answer it sent before closing is the thing under test.
#[cfg(test)]
fn post_raw(port: u16, request: &str) -> String {
    let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
    let mut stream = TcpStream::connect(addr).expect("connect");
    // Longer than the server's own read timeout, or the tests of that
    // timeout would race themselves.
    stream
        .set_read_timeout(Some(IO_TIMEOUT * 4))
        .expect("timeout");
    stream.write_all(request.as_bytes()).expect("write");
    let mut response = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => response.extend_from_slice(&chunk[..n]),
        }
    }
    String::from_utf8_lossy(&response).into_owned()
}

/// Read a settings file back, for tests.
#[cfg(test)]
fn read_settings(path: &std::path::Path) -> Value {
    let raw = std::fs::read_to_string(path).expect("read settings");
    serde_json::from_str(&raw).expect("parse settings")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::status::{COL_NEEDS_YOU, COL_WORKING};

    fn engine() -> Arc<StatusEngine> {
        Arc::new(StatusEngine::default())
    }

    #[cfg(unix)]
    #[test]
    fn generated_worker_files_do_not_follow_preplaced_symlinks() {
        use std::os::unix::fs::symlink;

        let target_dir = crate::testutil::TempDir::new("hooks-symlink-target");
        let target = target_dir.path().join("victim.txt");
        std::fs::write(&target, "unchanged").unwrap();

        let worker_id = format!("wk-symlink-{}", std::process::id());
        let path = worker_file_path(&worker_id, "agent", "md");
        ensure_private_dir(path.parent().unwrap()).unwrap();
        let _ = std::fs::remove_file(&path);
        symlink(&target, &path).unwrap();

        let result = write_worker_file(&worker_id, "agent", "md", "secret coordinator prompt");
        let target_body = std::fs::read_to_string(&target).unwrap();
        let _ = std::fs::remove_file(&path);

        assert!(result.is_err(), "a preplaced symlink must be refused");
        assert_eq!(
            target_body, "unchanged",
            "the symlink target was overwritten"
        );
    }

    /// F-SEC-8: a hooks directory that was already there - world-writable, or
    /// not a directory at all but a symlink to one - is refused, and nothing
    /// is written into it. Before the fix `create_dir_all` adopted it and the
    /// hook secret landed in another user's hands.
    #[cfg(unix)]
    #[test]
    fn a_foreign_or_world_writable_hooks_dir_is_refused() {
        use std::os::unix::fs::PermissionsExt;

        // Case one: a directory with group/other bits, the way another user
        // on a shared host would have placed it under `$TMPDIR`.
        let root = crate::testutil::TempDir::new("hooks-world-writable");
        let dir = root.path().join("hooks");
        std::fs::create_dir(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o777)).unwrap();

        let result = with_test_settings_dir(&dir, || {
            write_worker_file("wk-foreign", "settings", "json", "{}")
        });
        assert!(
            result.is_err(),
            "a world-writable hooks dir must be refused, got {result:?}"
        );
        assert!(
            std::fs::read_dir(&dir).unwrap().next().is_none(),
            "nothing may be written into a refused directory"
        );

        // Case two: not a directory at all, but a symlink pointing at one.
        let target_root = crate::testutil::TempDir::new("hooks-symlinked-target");
        let link_root = crate::testutil::TempDir::new("hooks-symlinked");
        let link = link_root.path().join("hooks");
        std::os::unix::fs::symlink(target_root.path(), &link).unwrap();

        let result = with_test_settings_dir(&link, || {
            write_worker_file("wk-foreign", "settings", "json", "{}")
        });
        assert!(
            result.is_err(),
            "a symlinked hooks dir must be refused, got {result:?}"
        );
        assert!(
            std::fs::read_dir(target_root.path())
                .unwrap()
                .next()
                .is_none(),
            "nothing may be written through a refused symlink"
        );
    }

    #[test]
    fn parses_a_claude_hook_post() {
        let head = "POST /hook/wk-1 HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 82";
        let body =
            r#"{"session_id":"abc","hook_event_name":"Notification","message":"needs input"}"#;
        assert_eq!(
            parse_request(head, body),
            Some(HookRequest {
                worker_id: "wk-1".to_string(),
                event: "Notification".to_string(),
                message: Some("needs input".to_string()),
            })
        );
    }

    #[test]
    fn rejects_anything_that_is_not_one_of_our_hooks() {
        let body = r#"{"hook_event_name":"Stop"}"#;
        // Wrong method, wrong path, no worker id, nested path, unreadable body.
        assert!(parse_request("GET /hook/wk-1 HTTP/1.1", body).is_none());
        assert!(parse_request("POST /admin HTTP/1.1", body).is_none());
        assert!(parse_request("POST /hook/ HTTP/1.1", body).is_none());
        assert!(parse_request("POST /hook/a/b HTTP/1.1", body).is_none());
        assert!(parse_request("POST /hook/wk-1 HTTP/1.1", "not json").is_none());
        assert!(parse_request("POST /hook/wk-1 HTTP/1.1", "{}").is_none());
    }

    #[test]
    fn reads_the_content_length_header_case_insensitively() {
        let head = "POST /hook/wk-1 HTTP/1.1\r\ncontent-length: 17\r\nHost: x";
        assert_eq!(content_length(head), Some(17));
        // No header means no body - a GET has none.
        assert_eq!(content_length("POST /hook/wk-1 HTTP/1.1"), Some(0));
    }

    #[test]
    fn a_second_content_length_is_refused_even_when_both_agree() {
        // Differing values are the classic smuggling desync; agreeing ones
        // are refused too, because merging them is a parser's opinion and
        // this server does not get to have one.
        let differing = "POST /hook/wk-1 HTTP/1.1\r\nContent-Length: 4\r\nContent-Length: 5";
        let agreeing = "POST /hook/wk-1 HTTP/1.1\r\nContent-Length: 4\r\ncontent-length: 4";
        assert_eq!(content_length(differing), None);
        assert_eq!(content_length(agreeing), None);
    }

    #[test]
    fn a_content_length_that_is_not_plain_digits_is_refused() {
        for head in [
            "POST /hook/wk-1 HTTP/1.1\r\nContent-Length: +5",
            "POST /hook/wk-1 HTTP/1.1\r\nContent-Length: 5, 5",
            "POST /hook/wk-1 HTTP/1.1\r\nContent-Length: 0x5",
            "POST /hook/wk-1 HTTP/1.1\r\nContent-Length:",
            "POST /hook/wk-1 HTTP/1.1\r\nContent-Length: 99999999999999999999999999",
        ] {
            assert_eq!(content_length(head), None, "{head}");
        }
    }

    #[test]
    fn conflicting_content_lengths_over_the_wire_get_a_400() {
        let engine = engine();
        let receiver = start(Arc::clone(&engine), None).expect("start receiver");
        let secret = issue_secret("wk-desync");
        let body = r#"{"hook_event_name":"Stop"}"#;

        // A first-header-wins parser would take the first Content-Length,
        // read the whole body and accept this as a perfectly valid hook.
        let response = post_raw(
            receiver.port(),
            &format!(
                "POST /hook/wk-desync HTTP/1.1\r\nHost: 127.0.0.1\r\n{SECRET_HEADER}: {secret}\r\n\
                 Content-Type: application/json\r\nContent-Length: {}\r\n\
                 Content-Length: 0\r\n\r\n{body}",
                body.len()
            ),
        );
        assert!(response.starts_with("HTTP/1.1 400"), "{response}");
        // And the refusal happened before anything reached the engine.
        assert_eq!(engine.verdict_for("wk-desync").column, COL_WORKING);
        forget_secret("wk-desync");
    }

    #[test]
    fn an_oversized_head_is_refused() {
        let engine = engine();
        let receiver = start(Arc::clone(&engine), None).expect("start receiver");
        let secret = issue_secret("wk-bighead");
        let body = r#"{"hook_event_name":"Stop"}"#;

        // A valid hook in every way except one: the head alone is past the
        // 16 KiB cap, so the request dies before the body is even weighed.
        let request = format!(
            "POST /hook/wk-bighead HTTP/1.1\r\nHost: 127.0.0.1\r\n{SECRET_HEADER}: {secret}\r\n\
             X-Filler: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            "x".repeat(MAX_HEAD),
            body.len()
        );
        let response = post_raw(receiver.port(), &request);
        assert!(response.starts_with("HTTP/1.1 400"), "{response}");
        assert_eq!(engine.verdict_for("wk-bighead").column, COL_WORKING);
        forget_secret("wk-bighead");
    }

    #[test]
    fn a_slow_client_is_cut_off_by_the_read_timeout() {
        let engine = engine();
        let receiver = start(Arc::clone(&engine), None).expect("start receiver");

        // A head that never terminates. The server's read timeout is the only
        // thing that ends this wait - without it the test would hang, which
        // is exactly the failure mode it proves absent.
        let began = std::time::Instant::now();
        let response = post_raw(
            receiver.port(),
            "POST /hook/wk-1 HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 10\r\n",
        );
        assert!(response.starts_with("HTTP/1.1 400"), "{response}");
        assert!(
            began.elapsed() >= IO_TIMEOUT - Duration::from_secs(1),
            "the answer came before the read timeout could have fired: {:?}",
            began.elapsed()
        );
    }

    /// F-SEC-1: the per-read timeout bounds one read, not the request. A
    /// client that answers every read well inside the window - one byte a
    /// second here - must still lose its slot once the request as a whole is
    /// past its total deadline.
    #[test]
    fn a_request_outliving_the_total_deadline_is_refused() {
        let listener = TcpListener::bind(SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)))
            .expect("bind");
        let addr = listener.local_addr().expect("local addr");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
            let began = std::time::Instant::now();
            let refused = read_request(&mut stream).is_none();
            (refused, began.elapsed())
        });

        let mut client = TcpStream::connect(addr).expect("connect");
        client
            .write_all(b"POST /hook/wk-1 HTTP/1.1\r\nContent-Length: 65536\r\n\r\n")
            .expect("write head");
        // One byte a second: every single read is answered far inside
        // IO_TIMEOUT, so no per-read timeout can ever fire on this request.
        // Only a total deadline can end it.
        for _ in 0..40 {
            std::thread::sleep(Duration::from_secs(1));
            if client.write_all(b"x").is_err() {
                break; // the server hung up - the total deadline fired
            }
        }
        let (refused, elapsed) = server.join().expect("join");
        assert!(refused, "a request dripped past its deadline was answered");
        assert!(
            elapsed < Duration::from_secs(35),
            "a drip client held the slot for {elapsed:?} - there is no total deadline"
        );
    }

    /// The total deadline must not replace the per-read timeout: a client
    /// that says nothing at all is still cut off after IO_TIMEOUT, not after
    /// the much longer request deadline.
    #[test]
    fn the_per_read_timeout_still_bounds_a_silent_client() {
        let listener = TcpListener::bind(SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)))
            .expect("bind");
        let addr = listener.local_addr().expect("local addr");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
            let began = std::time::Instant::now();
            let refused = read_request(&mut stream).is_none();
            (refused, began.elapsed())
        });

        // Connect and say nothing; the socket stays open so only a timeout
        // can end the read.
        let _silent = TcpStream::connect(addr).expect("connect");
        let (refused, elapsed) = server.join().expect("join");
        assert!(refused, "a silent client was not refused");
        assert!(
            elapsed >= IO_TIMEOUT - Duration::from_secs(1),
            "refused before the read timeout could have fired: {elapsed:?}"
        );
        assert!(
            elapsed < IO_TIMEOUT * 2,
            "a silent client held the slot for {elapsed:?} - the per-read timeout is gone"
        );
    }

    /// S-02: the ownership probe's name used to be `.owner-probe-<pid>` - one
    /// name for every probe this process ever makes. Two threads probing the
    /// same directory (two parallel spawns) interleaved the probe protocol -
    /// remove, create_new, metadata, remove - on that shared name and one of
    /// them got a false "cannot prove ownership". The race lives entirely in
    /// the shared name: with a per-call unique tag no two probes can ever
    /// touch the same directory entry, whatever the interleaving. Pinning the
    /// tag's uniqueness pins the fix, which a two-thread timing test could
    /// only show flakily.
    #[test]
    fn two_probe_names_never_collide() {
        let first = unique_file_tag();
        let second = unique_file_tag();
        assert_ne!(first, second, "two probe names collided: {first}");
        assert!(
            first.starts_with(&format!("{}-", std::process::id())),
            "the tag keeps a leftover attributable to its run: {first}"
        );
    }

    #[test]
    fn a_full_server_answers_503_without_spending_a_thread() {
        let listener = TcpListener::bind(SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)))
            .expect("bind");
        let port = listener.local_addr().expect("local addr").port();
        let limiter = crate::http_util::connection_limiter_with(2);
        let slots = Arc::clone(&limiter);
        std::thread::spawn(move || accept_loop(listener, engine(), None, limiter));

        // Two clients that never speak fill both slots; their handler threads
        // are parked on the read timeout.
        let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
        let idle_a = TcpStream::connect(addr).expect("connect a");
        let idle_b = TcpStream::connect(addr).expect("connect b");
        crate::http_util::wait_for_permits(&slots, 0);

        // The third connection is answered by the accept loop itself.
        let response = post_raw(port, "");
        assert!(response.starts_with("HTTP/1.1 503"), "{response}");

        // Slots free as the idle clients leave, and the next request reaches
        // a real handler again - a 401, because only a thread checks secrets.
        drop(idle_a);
        drop(idle_b);
        crate::http_util::wait_for_permits(&slots, 2);
        let response =
            post_hook(port, "wk-1", None, r#"{"hook_event_name":"Stop"}"#).expect("post hook");
        assert!(response.starts_with("HTTP/1.1 401"), "{response}");
    }

    #[test]
    fn a_posted_hook_moves_the_worker_on_the_board() {
        let engine = engine();
        let receiver = start(Arc::clone(&engine), None).expect("start receiver");
        assert!(receiver.is_enabled());
        let secret = issue_secret("wk-1");

        let response = post_hook(
            receiver.port(),
            "wk-1",
            Some(&secret),
            r#"{"hook_event_name":"Notification","message":"Claude needs your permission"}"#,
        )
        .expect("post hook");
        assert!(response.starts_with("HTTP/1.1 204"), "{response}");

        let verdict = engine.verdict_for("wk-1");
        assert_eq!(verdict.column, COL_NEEDS_YOU);
        assert_eq!(
            verdict.reason.as_deref(),
            Some("Claude needs your permission")
        );

        // The same connection handling works for the rest of the lifecycle.
        let response = post_hook(
            receiver.port(),
            "wk-1",
            Some(&secret),
            r#"{"hook_event_name":"SessionStart","source":"startup"}"#,
        )
        .expect("post hook");
        assert!(response.starts_with("HTTP/1.1 204"), "{response}");
        assert_eq!(engine.verdict_for("wk-1").column, COL_WORKING);
        forget_secret("wk-1");
    }

    #[test]
    fn a_malformed_post_is_refused_and_leaves_the_board_alone() {
        let engine = engine();
        let receiver = start(Arc::clone(&engine), None).expect("start receiver");
        let secret = issue_secret("wk-2");

        let response =
            post_hook(receiver.port(), "wk-2", Some(&secret), "{ not json").expect("post");
        assert!(response.starts_with("HTTP/1.1 400"), "{response}");
        assert_eq!(engine.verdict_for("wk-2").column, COL_WORKING);
        forget_secret("wk-2");
    }

    /// The port is reachable from every local process, so a request that
    /// cannot prove which worker it belongs to must not move a card and must
    /// not reach the message log the critic later reads.
    #[test]
    fn a_hook_without_the_right_secret_is_refused_and_changes_nothing() {
        let engine = engine();
        let receiver = start(Arc::clone(&engine), None).expect("start receiver");
        let secret = issue_secret("wk-auth");
        let body = r#"{"hook_event_name":"Notification","message":"forged"}"#;

        // No header at all - what any other local process can send.
        let response = post_hook(receiver.port(), "wk-auth", None, body).expect("post");
        assert!(response.starts_with("HTTP/1.1 401"), "{response}");
        assert_eq!(engine.verdict_for("wk-auth").column, COL_WORKING);

        // A guess, and another worker's secret: both are somebody else's.
        let other = issue_secret("wk-auth-other");
        for wrong in ["", "0123456789abcdef0123456789abcdef", other.as_str()] {
            let response = post_hook(receiver.port(), "wk-auth", Some(wrong), body).expect("post");
            assert!(response.starts_with("HTTP/1.1 401"), "{wrong}: {response}");
            assert_eq!(engine.verdict_for("wk-auth").column, COL_WORKING);
        }

        // The worker's own secret is the one that works.
        let response = post_hook(receiver.port(), "wk-auth", Some(&secret), body).expect("post");
        assert!(response.starts_with("HTTP/1.1 204"), "{response}");
        assert_eq!(engine.verdict_for("wk-auth").column, COL_NEEDS_YOU);

        forget_secret("wk-auth");
        forget_secret("wk-auth-other");
    }

    /// A worker this app never started - or one whose files have been removed
    /// again - has no secret, and no request can invent one.
    #[test]
    fn an_unknown_worker_is_refused_rather_than_trusted() {
        let engine = engine();
        let receiver = start(Arc::clone(&engine), None).expect("start receiver");
        let body = r#"{"hook_event_name":"Stop"}"#;

        let response = post_hook(receiver.port(), "wk-never-seen", None, body).expect("post");
        assert!(response.starts_with("HTTP/1.1 401"), "{response}");

        // And a retired one stops being a target with its files.
        let secret = issue_secret("wk-retired");
        assert!(
            post_hook(receiver.port(), "wk-retired", Some(&secret), body)
                .expect("post")
                .starts_with("HTTP/1.1 204")
        );
        remove_worker_files("wk-retired");
        let response = post_hook(receiver.port(), "wk-retired", Some(&secret), body).expect("post");
        assert!(response.starts_with("HTTP/1.1 401"), "{response}");
    }

    #[test]
    fn a_secret_is_reissued_for_every_generation_of_a_worker() {
        let first = issue_secret("wk-gen");
        let second = issue_secret("wk-gen");
        assert_ne!(first, second, "a respawn must retire the previous secret");
        assert_eq!(secret_for("wk-gen").as_deref(), Some(second.as_str()));
        forget_secret("wk-gen");
        assert_eq!(secret_for("wk-gen"), None);
    }

    #[test]
    fn hook_secrets_do_not_flow_through_unhardened_random_hex() {
        let hooks_source = include_str!("hooks.rs");
        let issue_secret = hooks_source
            .split_once("fn issue_secret")
            .expect("issue_secret must remain inspectable")
            .1
            .split_once("/// This worker's current secret")
            .expect("end of issue_secret section")
            .0;
        let oneshot_source = include_str!("oneshot.rs");
        let random_hex = oneshot_source
            .split_once("pub fn random_hex")
            .expect("random_hex must remain inspectable")
            .1
            .split_once("/// Narrow `path`")
            .expect("end of random_hex section")
            .0;

        assert!(
            !issue_secret.contains("crate::oneshot::random_hex()")
                || random_hex.contains("getrandom::fill("),
            "issue_secret uses oneshot::random_hex, but random_hex does not call getrandom::fill"
        );
    }

    #[test]
    fn a_header_is_found_by_name_whatever_its_case() {
        let head = "POST /hook/wk-1 HTTP/1.1\r\nX-ProjectA-Hook-Secret:  abc \r\nHost: x";
        assert_eq!(header_value(head, SECRET_HEADER), Some("abc"));
        assert_eq!(header_value(head, "content-length"), None);
        assert_eq!(
            header_value("POST /hook/wk-1 HTTP/1.1", SECRET_HEADER),
            None
        );
    }

    #[test]
    fn hook_settings_commands_point_at_private_curl_configs_without_the_secret() {
        let value = settings_json("wk-7");
        let serialized = value.to_string();
        let hooks = value["hooks"].as_object().expect("hooks object");
        // The lifecycle events live in the hooks map; `statusLine` is a
        // top-level sibling of `hooks`, as Claude Code documents it.
        assert_eq!(hooks.len(), HOOK_EVENTS.len());
        let hook_config = worker_file_path("wk-7", "hook", "curl")
            .to_string_lossy()
            .into_owned();

        for event in HOOK_EVENTS {
            let command = hooks[event][0]["hooks"][0]["command"]
                .as_str()
                .unwrap_or_default();
            assert!(command.contains(&hook_config), "{event}: {command}");
            assert!(
                !command.contains("s3cr3t"),
                "{event}: hook secret leaked into curl argv: {command}"
            );
            assert_eq!(hooks[event][0]["hooks"][0]["type"], "command");
        }

        assert_eq!(value["statusLine"]["type"], "command");
        let statusline = value["statusLine"]["command"].as_str().unwrap_or_default();
        let statusline_config = worker_file_path("wk-7", "statusline", "curl")
            .to_string_lossy()
            .into_owned();
        assert!(statusline.contains(&statusline_config), "{statusline}");
        assert!(
            !statusline.contains("s3cr3t"),
            "statusLine leaked the hook secret into curl argv: {statusline}"
        );
        assert!(
            !serialized.contains("s3cr3t"),
            "the settings command becomes process argv: {serialized}"
        );
    }

    /// The file the agent is handed and the secret the receiver checks are
    /// written by the same call, so one can never exist without the other.
    #[test]
    fn writing_settings_puts_the_secret_in_a_private_curl_config_not_argv() {
        let path = write_settings("wk-secret", 51234).expect("write");
        let secret = secret_for("wk-secret").expect("a secret was registered");
        let written = read_settings(&path)["hooks"]["Stop"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        assert!(
            !written.contains(&secret),
            "the hook secret must not become curl argv: {written}"
        );
        let hook_config = worker_file_path("wk-secret", "hook", "curl");
        let config = std::fs::read_to_string(&hook_config).expect("read private curl config");
        assert!(config.contains(&format!("{SECRET_HEADER}: {secret}")));
        assert!(
            written.contains(&hook_config.to_string_lossy().into_owned()),
            "settings must point curl at the private config: {written}"
        );
        remove_worker_files("wk-secret");
        assert_eq!(secret_for("wk-secret"), None);
        assert!(!hook_config.exists());
    }

    fn claude_caps() -> crate::capabilities::AgentCapabilities {
        crate::capabilities::AgentCapabilities {
            lifecycle: crate::capabilities::Lifecycle::SettingsHooks {
                flag: "--settings".into(),
            },
            ..Default::default()
        }
    }

    #[test]
    fn settings_hooks_lifecycle_appends_the_configured_flag() {
        let profile = AgentProfile {
            id: "claude".into(),
            name: "Claude Code".into(),
            command: "claude".into(),
            args: vec![],
            caps: claude_caps(),
            env: Default::default(),
            fallback: None,
            enabled: true,
            env_policy: Default::default(),
        };
        let wired = with_hook_settings(&profile, "wk-cap-1", 4711);
        assert_eq!(wired.args[0], "--settings");
        assert!(
            wired.args[1].ends_with("wk-cap-1.settings.json"),
            "{}",
            wired.args[1]
        );
        remove_worker_files("wk-cap-1");
    }

    #[test]
    fn heuristic_lifecycle_returns_the_profile_untouched() {
        let profile = AgentProfile {
            id: "kimi".into(),
            name: "Kimi CLI".into(),
            command: "kimi".into(),
            args: vec!["--fast".into()],
            caps: Default::default(), // lifecycle: Heuristic
            env: Default::default(),
            fallback: None,
            enabled: true,
            env_policy: Default::default(),
        };
        let with = with_hook_settings(&profile, "wk-cap-2", 4711);
        assert_eq!(
            with.args, profile.args,
            "heuristic lifecycle must leave args unchanged"
        );
        assert!(
            !settings_path("wk-cap-2").exists(),
            "no file must be written"
        );
    }

    /// The settings file is now a key to one worker's log, so on unix it says
    /// so - both the file and the directory holding it.
    #[cfg(unix)]
    #[test]
    fn the_generated_files_are_readable_by_their_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let path = write_settings("wk-perms", 51234).expect("write");
        let mode = |p: &std::path::Path| {
            std::fs::metadata(p).expect("metadata").permissions().mode() & 0o777
        };
        let hook_config = worker_file_path("wk-perms", "hook", "curl");
        assert_eq!(mode(&path), 0o600, "{:o}", mode(&path));
        assert_eq!(mode(&hook_config), 0o600, "{:o}", mode(&hook_config));
        assert_eq!(mode(&settings_dir()), 0o700, "{:o}", mode(&settings_dir()));
        remove_worker_files("wk-perms");
    }

    #[test]
    fn remove_worker_files_takes_every_kind_at_once() {
        let settings = write_worker_file("wk-cap-3", "settings", "json", "{}").expect("write");
        let agent = write_worker_file("wk-cap-3", "agent", "md", "# role").expect("write");
        assert!(settings.exists() && agent.exists());
        remove_worker_files("wk-cap-3");
        assert!(!settings.exists() && !agent.exists());
    }

    #[test]
    fn claude_gets_a_settings_flag_and_other_agents_do_not() {
        let claude = AgentProfile {
            id: "claude".into(),
            name: "Claude Code".into(),
            command: "claude".into(),
            args: vec![],
            caps: claude_caps(),
            env: Default::default(),
            fallback: None,
            enabled: true,
            env_policy: Default::default(),
        };
        let other = AgentProfile {
            id: "kimi".into(),
            name: "Kimi CLI".into(),
            command: "kimi".into(),
            args: vec!["--fast".into()],
            caps: Default::default(),
            env: Default::default(),
            fallback: None,
            enabled: true,
            env_policy: Default::default(),
        };

        let wired = with_hook_settings(&claude, "wk-8", 51234);
        assert_eq!(wired.args[0], "--settings");
        let path = PathBuf::from(&wired.args[1]);
        assert_eq!(path, settings_path("wk-8"));
        assert!(secret_for("wk-8").is_some(), "secret");
        assert_eq!(
            read_settings(&path)["hooks"]["Stop"][0]["hooks"][0]["command"],
            settings_json("wk-8")["hooks"]["Stop"][0]["hooks"][0]["command"]
        );

        // A disabled receiver, and agents without hook support, are left alone.
        assert_eq!(with_hook_settings(&claude, "wk-8", 0).args, claude.args);
        assert_eq!(with_hook_settings(&other, "wk-8", 51234).args, other.args);

        remove_worker_files("wk-8");
        assert!(!settings_path("wk-8").exists());
    }
}
