//! The public face of the projects: every registered repository serves its
//! landing page over plain HTTP on a loopback port.
//!
//! Phase 8 added a second listener beside the control API ([`crate::api`]);
//! Phase 17 added the remote board on top of it:
//!
//! ```text
//! GET /                          project index
//! GET /project/<id>              the project's landing page
//! GET /project/<id>/board        one project's board
//! GET /project/<id>/learnings    that project's learnings, pending first
//! GET /board                     every project, whoever needs a human first
//! GET /board.json                the same rows as JSON
//! GET /health                    {"ok": true}
//! ```
//!
//! Everything here is read-only, and that is a security boundary rather than a
//! missing feature: approving a learning or moving a card stays in the desktop
//! app, which is the only surface that authenticates a person.
//!
//! Setting `web_interface.token` gates every route but `/health` on a matching
//! `?token=`. It is a hurdle for the local network, not authentication - a
//! token in a URL travels through logs and browser history. What it prevents is
//! an accidentally open board once the listener binds beyond loopback.
//!
//! Setting `web_interface.bind` decides how far the listener reaches:
//! `127.0.0.1` (the default) keeps it on this machine, `0.0.0.0` opens it to
//! the local network so a phone can read the board. Binding beyond loopback
//! without a token is legal and logged as the warning it is.
//!
//! The Host header is checked before anything else: a browser page on an
//! attacker domain whose DNS answers 127.0.0.1 keeps that domain in its Host
//! header (browsers do not rewrite it), so only `localhost` and IP literals
//! are accepted - loopback is how the app probes itself, and a LAN literal is
//! what the phone uses. Every other DNS name gets a 403, which is what keeps
//! DNS rebinding from reading the board through the victim's own browser.
//!
//! The board routes only exist when the backend can supply board data; the
//! store alone cannot, since deriving columns is the status engine's job. Such
//! a backend answers 404 there rather than pretending the board is empty.
//!
//! Landing pages are written as Markdown in the design studio and rendered by
//! [`render_markdown`] below - deliberately dependency-free, because the set
//! of constructs worth supporting here is small and stable.
//!
//! The server is the same shape as every other listener in this code base
//! (see [`crate::hooks`]): bind 127.0.0.1, one thread per connection, just
//! enough HTTP to read a request and answer it. Shutdown goes through
//! `WebInterfaceState`: sending into its `oneshot` channel makes the accept
//! loop exit on its next beat, so stopping never has to kill a thread. The
//! thread count is capped as everywhere: past
//! [`crate::http_util::MAX_CONNECTIONS`] live connections the accept loop
//! answers 503 itself - on a LAN-bound listener that cap is the whole
//! difference between a scanner and a memory leak.

use std::io::Write;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use serde_json::json;
use tokio::sync::oneshot;

use crate::http_util::{
    answer_overloaded, connection_limiter, percent_decode, token_eq, try_acquire_connection,
    ConnectionLimiter,
};
use crate::status::{
    worker_label, StatusEngine, COL_DONE, COL_IN_REVIEW, COL_NEEDS_YOU, COL_READY_TO_MERGE,
    COL_WORKING,
};
use crate::store::{now_unix_secs, Learning, Project, Store, KIND_WORKER, LEARNING_PENDING};

/// One line on the remote board.
///
/// Deliberately its own shape rather than the engine's `WorkerBoardState`: the
/// browser needs a name, a column, a reason and an age, and nothing else. A
/// read-only page for a phone is the wrong place to widen what leaves the
/// machine, so the row carries the smallest set that still answers "who is
/// working, who is stuck".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardRow {
    pub project_id: String,
    pub project_name: String,
    pub worker_name: String,
    /// The worker's role, when it has one beyond the plain default.
    pub role: Option<String>,
    /// Board column as the engine derived it.
    pub column: String,
    /// Why this worker wants a human, when it does.
    pub attention_reason: Option<String>,
    /// Seconds since the worker was created.
    pub age_seconds: i64,
}

/// How long the accept loop may keep listening before checking for a stop
/// signal again. Shutdown latency is bounded by roughly this interval.
const ACCEPT_POLL: Duration = Duration::from_millis(200);

/// A slow or wedged client must not tie up a thread forever.
const IO_TIMEOUT: Duration = Duration::from_secs(5);

const HTML_TYPE: &str = "text/html; charset=utf-8";
const JSON_TYPE: &str = "application/json";
const PLAIN_TYPE: &str = "text/plain; charset=utf-8";

/// Settings key holding the optional fern-access token.
const TOKEN_SETTING: &str = "web_interface.token";

/// Settings key holding the address the listener binds to. Absent or unparsable
/// means loopback.
const BIND_SETTING: &str = "web_interface.bind";

/// How long a board page waits before reloading itself.
///
/// A meta refresh rather than a fetch loop: the phone is looking at a page for
/// half a minute at a time, and half a minute of staleness is cheaper than a
/// script that has to re-render the board it just replaced.
const REFRESH_SECONDS: u32 = 30;

/// What the pages source their rows from.
///
/// Behind this trait the app reaches into the SQLite store - which does not
/// exist outside the running application. Tests swap in canned data instead
/// and are done in milliseconds.
trait LandingPages: Send + Sync {
    fn projects(&self) -> Result<Vec<Project>, String>;
    fn project(&self, id: &str) -> Result<Option<Project>, String>;

    /// The configured fern-access token, or `None` when the interface is open.
    ///
    /// Read through the backend rather than at startup on purpose: the accept
    /// loop is a plain OS thread, so a blocking store read is sound there.
    /// Reading it inside `start_web_interface` would block within Tauri's async
    /// setup - a runtime inside a runtime, the exact panic Phase 16 had to
    /// remove from the dispatcher.
    fn access_token(&self) -> Option<String> {
        None
    }

    /// Board rows, all projects or one.
    ///
    /// `None` means this backend has no board to show - the store alone cannot
    /// derive columns, that is the status engine's job. The routes then answer
    /// 404 rather than an empty board, because "no such page" is true and "no
    /// workers" would be a lie.
    fn board(&self, _project_id: Option<&str>) -> Option<Result<Vec<BoardRow>, String>> {
        None
    }

    /// Reviewed and unreviewed learnings for one project. `None` as above.
    fn learnings(&self, _project_id: &str) -> Option<Result<Vec<Learning>, String>> {
        None
    }

    /// The IPv4 address the listener should bind, or `None` for loopback.
    ///
    /// Read on the server's own thread for the same reason as
    /// [`LandingPages::access_token`]: it is a blocking store read, and the
    /// only sound place for one is off the async runtime.
    fn bind_address(&self) -> Option<String> {
        None
    }
}

impl LandingPages for Store {
    fn projects(&self) -> Result<Vec<Project>, String> {
        tauri::async_runtime::block_on(self.list_projects())
    }

    fn project(&self, id: &str) -> Result<Option<Project>, String> {
        tauri::async_runtime::block_on(self.get_project(id))
    }

    fn access_token(&self) -> Option<String> {
        self.setting(TOKEN_SETTING)
    }

    fn bind_address(&self) -> Option<String> {
        self.setting(BIND_SETTING)
    }
}

impl Store {
    /// One setting, blank treated as unset - an empty string in the table is
    /// how a cleared field arrives, and "" is not a token nor an address.
    fn setting(&self, key: &str) -> Option<String> {
        tauri::async_runtime::block_on(self.get_setting(key))
            .ok()
            .flatten()
            .filter(|value| !value.trim().is_empty())
    }
}

/// The application's own backend: the store for the pages, the status engine
/// for the columns.
///
/// The two have to travel together. `Store` alone cannot say which column a
/// worker sits in - folding hooks, terminal output and pull-request state into
/// one verdict is [`StatusEngine`]'s whole job - which is exactly why the
/// board routes stay 404 for a store-only backend.
struct BoardBackend {
    store: Arc<Store>,
    engine: Arc<StatusEngine>,
}

impl BoardBackend {
    /// The board as rows, for one project or for all of them.
    ///
    /// `None` reads every project, because `Store::list_workers` already means
    /// "all projects" for `None` - the cross-project board is the union that
    /// falls out of that, not a second query shape.
    fn rows(&self, project_id: Option<&str>) -> Result<Vec<BoardRow>, String> {
        let workers = tauri::async_runtime::block_on(self.store.list_workers(project_id))?;
        let projects = tauri::async_runtime::block_on(self.store.list_projects())?;
        let now = now_unix_secs();

        Ok(self
            .engine
            .board(&workers)
            .into_iter()
            .map(|card| BoardRow {
                project_id: card.worker.project_id.clone(),
                // A worker whose project row has gone still belongs on the
                // board; its project id is the only name left to print.
                project_name: projects
                    .iter()
                    .find(|project| project.id == card.worker.project_id)
                    .map(|project| project.name.clone())
                    .unwrap_or_else(|| card.worker.project_id.clone()),
                worker_name: worker_label(&card.worker),
                // The plain worker is the norm, and naming the norm is noise;
                // an orchestrator, queen or scout says so.
                role: (card.worker.kind != KIND_WORKER).then(|| card.worker.kind.clone()),
                // A clock that went backwards must not print a negative age.
                age_seconds: (now - card.worker.created_at).max(0),
                column: card.column,
                attention_reason: card.attention_reason,
            })
            .collect())
    }
}

impl LandingPages for BoardBackend {
    fn projects(&self) -> Result<Vec<Project>, String> {
        self.store.projects()
    }

    fn project(&self, id: &str) -> Result<Option<Project>, String> {
        self.store.project(id)
    }

    fn access_token(&self) -> Option<String> {
        self.store.access_token()
    }

    fn bind_address(&self) -> Option<String> {
        self.store.bind_address()
    }

    fn board(&self, project_id: Option<&str>) -> Option<Result<Vec<BoardRow>, String>> {
        Some(self.rows(project_id))
    }

    fn learnings(&self, project_id: &str) -> Option<Result<Vec<Learning>, String>> {
        Some(tauri::async_runtime::block_on(
            self.store.list_learnings(Some(project_id), None),
        ))
    }
}

/// Handle to a running web interface.
///
/// The server thread itself keeps the listener and the store alive; this state
/// only holds the facts callers need - which port answers, and whether there
/// still is something behind it (`shutdown_tx` present).
///
/// `Default` is the "never started" state: no port to name and nothing behind
/// it.
#[derive(Default)]
pub struct WebInterfaceState {
    /// The bound loopback port; [`start_web_interface`] resolves a requested
    /// port of 0 to whatever the operating system picked.
    port: u16,
    /// Sending into this channel ends the accept loop. Taken by
    /// [`stop_web_interface`], so presence doubles as the running flag.
    shutdown_tx: Option<oneshot::Sender<()>>,
}

impl WebInterfaceState {
    /// The port this interface answers on, if it ever started.
    pub fn port(&self) -> u16 {
        self.port
    }
}

/// Bind a port and start serving the projects' landing pages and the board.
///
/// A `port` of 0 lets the operating system pick one; whichever port ended up
/// answering is reported back via the returned state's `port()`. Building the
/// state here rather than in the caller is on purpose: the shutdown sender
/// belongs inside `WebInterfaceState`, so everything lives in exactly one
/// place.
///
/// The engine travels along because the board is the point: without it the
/// server can only serve landing pages, which is what a store-only backend
/// still does (see [`LandingPages::board`]).
pub fn start_web_interface(
    store: Arc<Store>,
    engine: Arc<StatusEngine>,
    port: u16,
) -> Result<WebInterfaceState, String> {
    spawn_server(Arc::new(BoardBackend { store, engine }), port)
}

/// Stop the interface: the accept loop exits within one [`ACCEPT_POLL`] tick,
/// connections already being served finish on their own.
pub fn stop_web_interface(state: &mut WebInterfaceState) -> Result<(), String> {
    match state.shutdown_tx.take() {
        // Stopping twice is harmless; only a send nobody received - because
        // the loop died first - is worth reporting.
        Some(tx) => tx
            .send(())
            .map_err(|_| "the web interface had already stopped".to_string()),
        None => Ok(()),
    }
}

/// The active port, or `None` when the interface is not running.
pub fn web_interface_status(state: &WebInterfaceState) -> Option<u16> {
    state.shutdown_tx.as_ref().map(|_| state.port)
}

// -- serving ---------------------------------------------------------------

fn spawn_server(backend: Arc<dyn LandingPages>, port: u16) -> Result<WebInterfaceState, String> {
    let (ready_tx, ready_rx) = mpsc::channel::<Result<u16, String>>();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    // Binding happens on the server's own thread rather than here, because
    // both the address and the token come out of the settings table and a
    // blocking store read is only sound off the async runtime - the same
    // reason `LandingPages::access_token` is documented for. The bound port
    // travels back through `ready_rx`, so a caller still learns it before this
    // function returns.
    thread::spawn(move || {
        // One read of each for the lifetime of this server.
        let token: Option<Arc<str>> = backend.access_token().map(Arc::from);
        let listener = match bind_listener(backend.as_ref(), port, token.is_some()) {
            Ok(listener) => listener,
            Err(err) => {
                let _ = ready_tx.send(Err(err));
                return;
            }
        };
        match listener.local_addr() {
            Ok(addr) => {
                // A caller that has given up takes the server with it: there
                // is no `WebInterfaceState` out there that could stop it.
                if ready_tx.send(Ok(addr.port())).is_err() {
                    return;
                }
            }
            Err(e) => {
                let _ = ready_tx.send(Err(format!("failed to read the web interface port: {e}")));
                return;
            }
        }
        accept_loop(listener, backend, token, shutdown_rx, connection_limiter());
    });

    let bound = ready_rx
        .recv()
        .map_err(|_| "the web interface stopped before it bound a port".to_string())??;

    Ok(WebInterfaceState {
        port: bound,
        shutdown_tx: Some(shutdown_tx),
    })
}

/// Resolve `web_interface.bind` and bind it.
///
/// An address that is not a plain IPv4 literal falls back to loopback instead
/// of refusing to start: a typo in a setting should cost the fern board, not
/// the local one. Reaching beyond loopback without a token is allowed - it is
/// the user's network and the user's call - but it is said out loud, because an
/// open board is the one mistake this whole setting can cause.
fn bind_listener(
    backend: &dyn LandingPages,
    port: u16,
    has_token: bool,
) -> Result<TcpListener, String> {
    let ip = match backend.bind_address() {
        None => Ipv4Addr::LOCALHOST,
        Some(raw) => raw.trim().parse::<Ipv4Addr>().unwrap_or_else(|_| {
            eprintln!(
                "projecta: {BIND_SETTING} is not an IPv4 address ({raw}); staying on 127.0.0.1"
            );
            Ipv4Addr::LOCALHOST
        }),
    };
    if !ip.is_loopback() && !has_token {
        eprintln!(
            "projecta: the web interface is bound to {ip} without {TOKEN_SETTING} - \
             everyone on this network can read the board"
        );
    }

    TcpListener::bind(SocketAddr::V4(SocketAddrV4::new(ip, port)))
        .map_err(|e| format!("failed to bind the web interface: {e}"))
}

/// Accept connections until told otherwise.
///
/// Nonblocking accept plus a short poll keeps shutdown responsive without
/// depending on timeout socket options, whose platform support is uneven.
/// Admission is capped at [`crate::http_util::MAX_CONNECTIONS`] live
/// connections; the one past the limit gets a fast 503 from this loop itself,
/// because every thread a scanner can conjure is memory the app no longer
/// has.
fn accept_loop(
    listener: TcpListener,
    backend: Arc<dyn LandingPages>,
    token: Option<Arc<str>>,
    mut shutdown_rx: oneshot::Receiver<()>,
    limiter: ConnectionLimiter,
) {
    let _ = listener.set_nonblocking(true);
    loop {
        match shutdown_rx.try_recv() {
            Ok(()) | Err(oneshot::error::TryRecvError::Closed) => break,
            Err(oneshot::error::TryRecvError::Empty) => {}
        }

        match listener.accept() {
            Ok((stream, _addr)) => {
                // On Windows a socket accepted from a nonblocking listener
                // is itself nonblocking - the handler below does blocking
                // reads on a timeout, like the other two servers' handlers.
                let _ = stream.set_nonblocking(false);
                let Some(permit) = try_acquire_connection(&limiter) else {
                    answer_overloaded(stream);
                    continue;
                };
                let backend = Arc::clone(&backend);
                let token = token.clone();
                thread::spawn(move || {
                    // The permit releases itself when this connection is done.
                    let _permit = permit;
                    serve(stream, backend.as_ref(), token.as_deref());
                });
            }
            // WouldBlock is the ordinary no-customer-yet signal; anything
            // else is treated the same - lose one beat, then try again.
            Err(_) => thread::sleep(ACCEPT_POLL),
        }
    }
}

/// Handle one connection: read, route, answer, hang up.
fn serve(mut stream: TcpStream, backend: &dyn LandingPages, token: Option<&str>) {
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));

    let page = match crate::hooks::read_request(&mut stream) {
        // The Host gate runs before the token gate: a rebinded request must
        // not even learn whether a token is configured.
        Some((head, _body)) if !host_allowed(&head) => Page::plain(403, "forbidden host"),
        Some((head, _body)) => match parse_head(&head) {
            // The gate sees the raw target, query included; the router only
            // gets the path. Splitting before decoding keeps a `%3F` inside an
            // id from inventing a query string.
            Some(("GET", target)) if authorized(token, target) => {
                let path = target.split('?').next().unwrap_or(target);
                route(backend, &percent_decode(path), &link_query(token))
            }
            Some(("GET", _)) => Page::plain(401, "missing or wrong token"),
            Some((_, _)) => Page::plain(405, "method not allowed"),
            None => Page::plain(400, "malformed request"),
        },
        None => Page::plain(400, "malformed request"),
    };

    let _ = stream.write_all(
        format!(
            "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\n\
             Connection: close\r\n\r\n{}",
            page.status,
            reason(page.status),
            page.content_type,
            page.body.len(),
            page.body
        )
        .as_bytes(),
    );
    let _ = stream.flush();
}

/// One decoded answer: status, media type, payload.
struct Page {
    status: u16,
    content_type: &'static str,
    body: String,
}

impl Page {
    fn html(body: String) -> Self {
        Self {
            status: 200,
            content_type: HTML_TYPE,
            body,
        }
    }

    fn json(body: serde_json::Value) -> Self {
        Self {
            status: 200,
            content_type: JSON_TYPE,
            body: body.to_string(),
        }
    }

    fn plain(status: u16, message: &str) -> Self {
        Self {
            status,
            content_type: PLAIN_TYPE,
            body: format!("{message}\n"),
        }
    }
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Internal Server Error",
    }
}

/// DNS rebinding check: the Host header, when present, must name this
/// machine. A browser page on an attacker domain whose DNS answers
/// 127.0.0.1 keeps that domain in its Host header - browsers do not rewrite
/// it - so every DNS name but `localhost` is refused. IP literals pass:
/// loopback is how the app probes itself, and a LAN literal is exactly what
/// the phone on the local network uses when the listener binds `0.0.0.0`.
///
/// A request without a Host line (HTTP/1.0 style) is let through on purpose:
/// the attack needs a browser, and browsers always send Host.
fn host_allowed(head: &str) -> bool {
    let Some(host) = head.lines().skip(1).find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.trim()
            .eq_ignore_ascii_case("host")
            .then(|| value.trim())
    }) else {
        return true;
    };
    let name = match host.strip_prefix('[') {
        // [::1]:8080 - the closing bracket ends the address, the port follows.
        Some(rest) => rest.split(']').next().unwrap_or(rest),
        None => match host.rsplit_once(':') {
            // A single colon separates an IPv4 address or a name from its
            // port; several colons make it a bare IPv6 literal without one.
            Some((name, _)) if !name.contains(':') => name,
            _ => host,
        },
    };
    // A trailing dot is the DNS root marker, not a different name.
    let name = name.strip_suffix('.').unwrap_or(name);
    name.eq_ignore_ascii_case("localhost") || name.parse::<IpAddr>().is_ok()
}

/// Split the first head line into method and the raw request target.
///
/// The query string stays attached: the access gate needs to read it. Cutting
/// it off is the caller's job, once the request has been let through.
fn parse_head(head: &str) -> Option<(&str, &str)> {
    let mut parts = head.lines().next()?.split_whitespace();
    let method = parts.next()?;
    let target = parts.next()?;
    Some((method, target))
}

// -- fern access -----------------------------------------------------------

/// Does this request carry the configured token?
///
/// Reads the *raw* target, query string included, because [`parse_head`] hands
/// the router a path with the query already cut off - the gate has to run
/// before that.
///
/// `/health` stays open on purpose: it is what the app itself probes to learn
/// whether its own interface is up, and it reveals nothing but liveness.
///
/// Honest about what this is: a token in a URL is a hurdle for the local
/// network, not authentication. It rides along in logs and browser history.
/// Binding beyond loopback without one is the thing worth refusing.
fn authorized(token: Option<&str>, target: &str) -> bool {
    let Some(expected) = token else {
        return true;
    };
    let (path, query) = match target.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (target, None),
    };
    if path == "/health" {
        return true;
    }
    query
        .into_iter()
        .flat_map(|query| query.split('&'))
        .filter_map(|pair| pair.split_once('='))
        // The value arrives percent-encoded - [`link_query`] encodes every
        // token it puts into a link - so the comparison has to happen on the
        // decoded form, or the interface locks itself out of any token with a
        // character outside the unreserved set.
        .any(|(name, value)| name == "token" && token_eq(&percent_decode(value), expected))
}

/// The query string every internal link has to carry.
///
/// Without this a gated board is a dead end on a phone: the first URL is typed
/// or scanned, and every tap after it would land on a 401. Empty when no token
/// is configured, so the ungated pages keep their bare hrefs.
fn link_query(token: Option<&str>) -> String {
    match token {
        None => String::new(),
        Some(token) => format!("?token={}", percent_encode(token)),
    }
}

/// Percent-encode everything outside RFC 3986's unreserved set.
///
/// That set contains no `&`, `<`, `"` or `'`, so an encoded token is safe to
/// drop into an `href` without a second escaping pass - and a token with a `&`
/// in it no longer cuts its own query string in half.
fn percent_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

// -- routes ----------------------------------------------------------------

fn route(backend: &dyn LandingPages, path: &str, query: &str) -> Page {
    match path {
        "/" => index_page(backend, query),
        "/health" => Page::json(json!({ "ok": true })),
        "/board" => board_page(backend, None, Format::Html, query),
        "/board.json" => board_page(backend, None, Format::Json, query),
        _ => match path.strip_prefix("/project/") {
            // The suffixes are checked before the bare id, or a project called
            // "x/board" would be indistinguishable from x's board.
            Some(rest) => match rest.rsplit_once('/') {
                Some((id, "board")) => board_page(backend, Some(id), Format::Html, query),
                Some((id, "learnings")) => learnings_page(backend, id, query),
                _ => project_page(backend, rest, query),
            },
            None => Page::plain(404, "no such page"),
        },
    }
}

/// Which representation a board route was asked for.
enum Format {
    Html,
    Json,
}

fn board_page(
    backend: &dyn LandingPages,
    project_id: Option<&str>,
    format: Format,
    query: &str,
) -> Page {
    match backend.board(project_id) {
        None => Page::plain(404, "no such page"),
        Some(Err(err)) => Page::plain(500, &err),
        Some(Ok(mut rows)) => {
            // Whoever needs a human comes first; the rest keeps the order the
            // engine produced. A stable sort is what makes that true.
            rows.sort_by_key(|row| row.attention_reason.is_none());
            match format {
                Format::Json => Page::json(json!({ "rows": rows })),
                Format::Html => Page::html(live_document("Board", &render_board(&rows, query))),
            }
        }
    }
}

fn learnings_page(backend: &dyn LandingPages, project_id: &str, query: &str) -> Page {
    match backend.learnings(project_id) {
        None => Page::plain(404, "no such page"),
        Some(Err(err)) => Page::plain(500, &err),
        Some(Ok(mut rows)) => {
            // Pending first: those are the ones waiting on a decision.
            rows.sort_by_key(|learning| learning.status != LEARNING_PENDING);
            Page::html(live_document(
                "Learnings",
                &render_learnings(project_id, &rows, query),
            ))
        }
    }
}

fn index_page(backend: &dyn LandingPages, query: &str) -> Page {
    match backend.projects() {
        Ok(projects) => Page::html(render_index(&projects, query)),
        Err(err) => Page::plain(500, &err),
    }
}

fn project_page(backend: &dyn LandingPages, id: &str, query: &str) -> Page {
    match backend.project(id) {
        Ok(Some(project)) => Page::html(render_project(&project, query)),
        Ok(None) => Page::plain(404, &format!("no such project: {id}")),
        Err(err) => Page::plain(500, &err),
    }
}

/// Minutes are the unit a glance wants; anything under one reads as "just now".
fn render_age(seconds: i64) -> String {
    match seconds / 60 {
        0 => "gerade eben".to_string(),
        minutes if minutes < 60 => format!("{minutes} min"),
        minutes => format!("{} h {} min", minutes / 60, minutes % 60),
    }
}

/// The name the desktop board gives a column, so a phone and a desktop never
/// call the same column two different things. An unknown value prints as it
/// arrived rather than as a guess.
fn column_label(column: &str) -> &str {
    match column {
        COL_WORKING => "Working",
        COL_NEEDS_YOU => "Needs you",
        COL_IN_REVIEW => "In review",
        COL_READY_TO_MERGE => "Ready to merge",
        COL_DONE => "Done",
        other => other,
    }
}

fn render_board(rows: &[BoardRow], query: &str) -> String {
    let mut body = format!(
        "<div class=\"page-wrap\"><h1>Board</h1>\
         <p class=\"page-nav\"><a href=\"/{query}\">Projekte</a></p>"
    );

    if rows.is_empty() {
        // An empty board is a fact, not an error: say which fact it is.
        body.push_str("<p class=\"empty-note\">Kein Worker läuft gerade.</p>");
        body.push_str("</div>");
        body.push_str(FOOTER_HTML);
        return body;
    }

    let attention = rows.iter().filter(|r| r.attention_reason.is_some()).count();
    body.push_str(&match attention {
        0 => "<p class=\"lead\">Alle arbeiten, nichts braucht dich.</p>".to_string(),
        1 => "<p class=\"lead attention\">1 braucht dich.</p>".to_string(),
        many => format!("<p class=\"lead attention\">{many} brauchen dich.</p>"),
    });

    body.push_str("<div class=\"board-list\">");
    for row in rows {
        let role = row
            .role
            .as_deref()
            .map(|role| format!(" · {}", escape_html(role)))
            .unwrap_or_default();
        let reason = row
            .attention_reason
            .as_deref()
            .map(|reason| format!("<p class=\"reason\">{}</p>", escape_html(reason)))
            .unwrap_or_default();
        body.push_str(&format!(
            "<article class=\"card col-{column}\">\
             <h2>{name}</h2>\
             <p class=\"meta\"><span class=\"chip chip-{column}\">{label}</span>\
             <a href=\"/project/{project_id}/learnings{query}\">{project}</a>{role} · {age}</p>\
             {reason}</article>",
            column = escape_html(&row.column),
            label = escape_html(column_label(&row.column)),
            name = escape_html(&row.worker_name),
            project_id = escape_html(&row.project_id),
            project = escape_html(&row.project_name),
            role = role,
            age = render_age(row.age_seconds),
            reason = reason,
            query = query,
        ));
    }
    body.push_str("</div></div>");
    body.push_str(FOOTER_HTML);
    body
}

fn render_learnings(project_id: &str, rows: &[Learning], query: &str) -> String {
    let mut body = format!(
        "<div class=\"page-wrap\"><h1>Learnings</h1>\
         <p class=\"page-nav\"><a href=\"/project/{id}/board{query}\">Board</a> · \
         <a href=\"/{query}\">Projekte</a></p>",
        id = escape_html(project_id),
        query = query,
    );

    if rows.is_empty() {
        body.push_str("<p class=\"empty-note\">Noch nichts gelernt in diesem Projekt.</p>");
        body.push_str("</div>");
        body.push_str(FOOTER_HTML);
        return body;
    }

    let pending = rows
        .iter()
        .filter(|learning| learning.status == LEARNING_PENDING)
        .count();
    body.push_str(&match pending {
        0 => "<p class=\"lead\">Nichts wartet auf eine Entscheidung.</p>".to_string(),
        1 => "<p class=\"lead attention\">1 wartet auf eine Entscheidung.</p>".to_string(),
        many => format!("<p class=\"lead attention\">{many} warten auf eine Entscheidung.</p>"),
    });

    body.push_str("<div class=\"board-list\">");
    for learning in rows {
        let label = learning
            .pattern_label
            .as_deref()
            .map(escape_html)
            .unwrap_or_else(|| "ohne Titel".to_string());
        body.push_str(&format!(
            "<article class=\"card learning-{status}\">\
             <h2>{label}</h2>\
             <p class=\"meta\"><span class=\"chip chip-{status}\">{status}</span>\
             {profile}</p>\
             <p class=\"content\">{content}</p></article>",
            status = escape_html(&learning.status),
            label = label,
            profile = escape_html(&learning.profile_id),
            content = escape_html(&learning.content),
        ));
    }
    body.push_str("</div></div>");
    body.push_str(FOOTER_HTML);
    body
}

/// One embedded stylesheet serving both pages. Dark, quiet, and deliberately
/// dependency-free - the pages carry no external assets at all.
const PAGE_CSS: &str = concat!(
    "<style>",
    "body{margin:0;background:#1e1e1e;color:#cccccc;",
    "font-family:'Segoe UI',system-ui,-apple-system,sans-serif;line-height:1.5}",
    ".page-wrap{max-width:860px;margin:0 auto;padding:28px 20px 40px}",
    "h1{color:#ffffff;font-weight:600;margin:0 0 4px}",
    "a{color:#75b6e3;text-decoration:none}",
    "a:hover{text-decoration:underline}",
    ".page-sub{margin:0 0 22px;color:#8a8a8a;font-size:13px}",
    ".repo-path{margin:0 0 24px;font-size:12px;color:#8a8a8a}",
    ".repo-path a{font-family:'Cascadia Mono',Consolas,monospace}",
    ".card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}",
    ".card{display:flex;flex-direction:column;gap:3px;padding:12px 14px;",
    "border:1px solid #3c3c3c;border-radius:4px;background:#252526;color:#cccccc}",
    ".card:hover{border-color:#4d4d4d;text-decoration:none;color:#ffffff}",
    ".card-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".card-path{font-size:11px;font-family:'Cascadia Mono',Consolas,monospace;",
    "color:#8a8a8a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".markdown-preview{padding:18px 20px;border:1px solid #3c3c3c;border-radius:4px;background:#252526}",
    ".markdown-preview h1,.markdown-preview h2,.markdown-preview h3",
    "{color:#ffffff;margin:18px 0 8px}",
    ".markdown-preview :first-child{margin-top:0}",
    ".markdown-preview ul{margin:8px 0;padding-left:22px}",
    ".markdown-preview p{margin:8px 0}",
    ".empty-note{color:#8a8a8a;font-style:italic}",
    ".site-footer{max-width:860px;margin:30px auto 0;padding-top:12px;border-top:1px solid #3c3c3c;",
    "color:#8a8a8a;font-size:11px}",
    // -- board and learnings, phone first --------------------------------
    ".page-nav{margin:0 0 18px;font-size:13px}",
    ".lead{margin:0 0 16px;color:#8a8a8a;font-size:14px}",
    ".lead.attention{color:#e0c257;font-weight:600}",
    // auto-fill collapses to a single column on its own; the media query
    // below is about thumbs, not about the count.
    ".board-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}",
    ".board-list .card{gap:6px;padding:14px 16px;border-left-width:3px}",
    ".card h2{margin:0;font-size:16px;font-weight:600;color:#ffffff}",
    ".card .meta{margin:0;font-size:12px;color:#8a8a8a}",
    ".card .reason{margin:2px 0 0;font-size:13px;color:#e0c257}",
    ".card .content{margin:2px 0 0;font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere}",
    ".chip{display:inline-block;margin-right:8px;padding:1px 8px;border-radius:999px;",
    "font-size:11px;background:#3c3c3c;color:#cccccc}",
    ".chip-working{background:rgba(14,99,156,0.35);color:#75b6e3}",
    ".chip-needs_you,.chip-pending{background:rgba(204,167,0,0.16);color:#e0c257}",
    ".chip-in_review{background:rgba(126,86,156,0.3);color:#c8a2dc}",
    ".chip-ready_to_merge,.chip-approved{background:rgba(35,134,54,0.3);color:#84cc8e}",
    ".chip-done,.chip-rejected{background:#3c3c3c;color:#8a8a8a}",
    ".col-needs_you{border-left-color:#cca700}",
    ".col-in_review{border-left-color:#7e569c}",
    ".col-ready_to_merge{border-left-color:#238636}",
    ".col-working{border-left-color:#0e639c}",
    // Under 700px the page is a thumb-width column: one card per row, more
    // room around every tap target, and no horizontal scrolling.
    "@media (max-width:700px){",
    ".page-wrap{padding:20px 14px 32px}",
    ".board-list{grid-template-columns:1fr;gap:14px}",
    ".board-list .card{padding:16px}",
    ".card h2{font-size:17px}",
    ".page-nav,.card .meta{font-size:13px}",
    "}",
    "</style>"
);

/// Shared closing strip under the page content.
const FOOTER_HTML: &str = "<footer class=\"site-footer\">ProjectA Web Interface</footer>";

/// A complete little document around every HTML answer, so browsers never
/// have to sniff one. The embedded stylesheet keeps every page self-contained
/// and dark without shipping an asset server alongside them; the viewport tag
/// is what makes the phone lay them out at reading size instead of zooming a
/// desktop page out.
fn html_document(title: &str, body: &str) -> String {
    document(title, body, false)
}

/// The same document, reloading itself every [`REFRESH_SECONDS`].
///
/// Only the board and the learnings list get this: they are the pages someone
/// leaves open on a phone. A landing page does not change while you read it.
/// The refresh re-requests the current URL, query string included, so a gated
/// page keeps its token across every reload.
fn live_document(title: &str, body: &str) -> String {
    document(title, body, true)
}

fn document(title: &str, body: &str, refresh: bool) -> String {
    let refresh = if refresh {
        format!("<meta http-equiv=\"refresh\" content=\"{REFRESH_SECONDS}\">")
    } else {
        String::new()
    };
    format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
         {refresh}<title>{}</title>{PAGE_CSS}</head><body>{body}</body></html>",
        escape_html(title)
    )
}

/// The `/` overview: one card per project, linking into its landing page.
fn render_index(projects: &[Project], query: &str) -> String {
    let mut body = String::from("<div class=\"page-wrap\">");
    body.push_str("<h1>Projects</h1>");
    body.push_str("<p class=\"page-sub\">Every registered repository has a landing page.</p>");
    body.push_str(&format!(
        "<p class=\"page-nav\"><a href=\"/board{query}\">Board</a></p>"
    ));
    if projects.is_empty() {
        body.push_str("<p class=\"empty-note\">No projects yet.</p>");
    } else {
        body.push_str("<div class=\"card-grid\">");
        for project in projects {
            body.push_str(&format!(
                "<a class=\"card\" href=\"/project/{}{query}\">\
                 <span class=\"card-name\">{}</span>\
                 <span class=\"card-path\">{}</span></a>",
                escape_html(&project.id),
                escape_html(&project.name),
                escape_html(&project.repo_path)
            ));
        }
        body.push_str("</div>");
    }
    body.push_str("</div>");
    body.push_str(FOOTER_HTML);
    html_document("ProjectA", &body)
}

/// The `/project/<id>` landing page: name and repository link in a shared
/// header, the rendered Markdown in a framed preview underneath.
fn render_project(project: &Project, query: &str) -> String {
    let id = escape_html(&project.id);
    let name = escape_html(&project.name);
    let repo_path = escape_html(&project.repo_path);
    let repo_link = escape_html(&format!(
        "file:///{path}",
        path = project.repo_path.trim_start_matches('/')
    ));

    let page = match &project.landing_page_markdown {
        Some(markdown) => render_markdown(markdown),
        None => "<p class=\"empty-note\">This landing page has no content yet - it is edited in \
                 the design studio.</p>"
            .to_string(),
    };

    html_document(
        &project.name,
        &format!(
            "<div class=\"page-wrap\"><header><h1>{name}</h1>\
             <p class=\"repo-path\"><small><a href=\"{repo_link}\">{repo_path}</a>\
             </small></p></header>\
             <p class=\"page-nav\"><a href=\"/project/{id}/board{query}\">Board</a> · \
             <a href=\"/project/{id}/learnings{query}\">Learnings</a></p>\
             <main class=\"markdown-preview\">{page}</main></div>{FOOTER_HTML}"
        ),
    )
}

// -- markdown --------------------------------------------------------------

/// Render the Markdown subset the landing pages speak into HTML.
///
/// Supported, on purpose nothing more: `#`/`##`/`###` headings, blank-line
/// separated paragraphs (a single newline inside becomes a break), `- ` lists,
/// `**bold**`, `*italic*`, `[text](url)` links. Everything else passes
/// through as plain text; any HTML in the source is escaped rather than
/// interpreted.
pub fn render_markdown(markdown: &str) -> String {
    fn flush_paragraph(html: &mut String, lines: &mut Vec<String>) {
        if lines.is_empty() {
            return;
        }
        html.push_str("<p>");
        for (index, line) in lines.iter().enumerate() {
            if index > 0 {
                html.push_str("<br>");
            }
            html.push_str(&render_inline(line));
        }
        html.push_str("</p>");
        lines.clear();
    }

    fn flush_list(html: &mut String, items: &mut Vec<String>) {
        if items.is_empty() {
            return;
        }
        html.push_str("<ul>");
        for item in items.iter() {
            html.push_str("<li>");
            html.push_str(&render_inline(item));
            html.push_str("</li>");
        }
        html.push_str("</ul>");
        items.clear();
    }

    let mut html = String::new();
    let mut paragraph: Vec<String> = Vec::new();
    let mut list: Vec<String> = Vec::new();

    for line in markdown.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            flush_paragraph(&mut html, &mut paragraph);
            flush_list(&mut html, &mut list);
        } else if let Some(level) = heading_level(trimmed) {
            flush_paragraph(&mut html, &mut paragraph);
            flush_list(&mut html, &mut list);
            let text = render_inline(trimmed[level..].trim_start());
            html.push_str("<h");
            html.push_str(&level.to_string());
            html.push('>');
            html.push_str(&text);
            html.push_str("</h");
            html.push_str(&level.to_string());
            html.push('>');
        } else if let Some(item) = trimmed.strip_prefix("- ") {
            flush_paragraph(&mut html, &mut paragraph);
            list.push(item.trim_end().to_string());
        } else {
            flush_list(&mut html, &mut list);
            paragraph.push(trimmed.to_string());
        }
    }
    flush_paragraph(&mut html, &mut paragraph);
    flush_list(&mut html, &mut list);

    html
}

/// A `#`-prefixed line of level 1..=3, with whitespace after the hashes.
fn heading_level(line: &str) -> Option<usize> {
    let hashes = line.bytes().take_while(|byte| *byte == b'#').count();
    if !(1..=3).contains(&hashes) {
        return None;
    }
    line[hashes..].starts_with([' ', '\t']).then_some(hashes)
}

/// Bold, italics and links on one already escaped line.
fn render_inline(line: &str) -> String {
    apply_italic(&apply_bold(&apply_links(&escape_html(line))))
}

/// HTML-escape everything dangerous; the whole renderer runs on this result.
fn escape_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            other => out.push(other),
        }
    }
    out
}

/// Pair up `[text](url)` occurrences. Everything else - including brackets
/// that do not form a link - passes through untouched.
///
/// URLs are restricted to a small allow-list and HTML-escaped before they
/// reach the `href` attribute. Unsafe schemes such as `javascript:` are
/// rejected and rendered as plain text instead.
fn apply_links(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('[') {
        out.push_str(&rest[..open]);
        let after_open = &rest[open + 1..];
        let Some(label_end) = after_open.find("](") else {
            out.push('[');
            rest = after_open;
            continue;
        };
        let label = &after_open[..label_end];
        let url_area = &after_open[label_end + 2..];
        let Some(close) = url_area.find(')') else {
            out.push('[');
            rest = after_open;
            continue;
        };
        let url = &url_area[..close];
        if is_safe_url(url) {
            // The URL has already been HTML-escaped by render_inline before
            // apply_links runs, so it is safe to drop it into the attribute.
            out.push_str(&format!("<a href=\"{}\">{}</a>", url, label));
        } else {
            // Rejected URL: keep the original Markdown literal so no link
            // is rendered and no unsafe attribute reaches the browser.
            out.push('[');
            out.push_str(label);
            out.push_str("](");
            out.push_str(url);
            out.push(')');
        }
        rest = &url_area[close + 1..];
    }
    out.push_str(rest);
    out
}

/// Only these URL schemes may become an `href`. Everything else (including
/// `javascript:`, `data:` and `vbscript:`) is treated as plain text.
fn is_safe_url(url: &str) -> bool {
    let url = url.trim();
    url.is_empty()
        || url.starts_with("http://")
        || url.starts_with("https://")
        || url.starts_with("mailto:")
        || url.starts_with("file://")
}

/// Pair up `**bold**`.
fn apply_bold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find("**") {
        out.push_str(&rest[..open]);
        let inner = &rest[open + 2..];
        match inner.find("**") {
            Some(close) => {
                out.push_str("<strong>");
                out.push_str(&inner[..close]);
                out.push_str("</strong>");
                rest = &inner[close + 2..];
            }
            None => {
                out.push_str("**");
                rest = inner;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Pair up single `*italic*` stars. Doubles left over from unmatched bold pass
/// through literally.
fn apply_italic(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('*') {
        if rest[open..].starts_with("**") {
            out.push_str(&rest[..open + 2]);
            rest = &rest[open + 2..];
            continue;
        }
        out.push_str(&rest[..open]);
        let inner = &rest[open + 1..];
        match inner.find('*') {
            Some(close) if !inner[..close].contains('*') && !inner[close..].starts_with("**") => {
                out.push_str("<em>");
                out.push_str(&inner[..close]);
                out.push_str("</em>");
                rest = &inner[close + 1..];
            }
            _ => {
                out.push('*');
                rest = inner;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{
        WorkerRow, KIND_ORCHESTRATOR, LEARNING_APPROVED, STATUS_EXITED, STATUS_RUNNING,
    };
    use crate::testutil::TempDir;
    use std::io::Read;
    use std::net::IpAddr;
    use std::time::Instant;

    /// A fresh status engine, for every test that goes through the real
    /// backend rather than a fake one.
    fn engine() -> Arc<StatusEngine> {
        Arc::new(StatusEngine::default())
    }

    // -- percent decoding ----------------------------------------------------

    /// The escape that panicked the old byte-indexed `&str` slice: a multibyte
    /// character straight after the `%`, cut in half by `raw[i + 1..i + 3]`.
    /// Reached unauthenticated - the path is decoded before the access gate
    /// has looked at any token. A broken escape is passed through verbatim,
    /// the same contract the control API has always had.
    #[test]
    fn a_multibyte_escape_is_passed_through_instead_of_panicking() {
        assert_eq!(percent_decode("/project/%\u{20ac}"), "/project/%\u{20ac}");
        assert_eq!(percent_decode("%\u{1f980}"), "%\u{1f980}");
    }

    #[test]
    fn every_token_link_generated_by_the_interface_authorizes_its_target() {
        let token = "a b+c/d=e!";
        let target = format!("/board{}", link_query(Some(token)));
        assert!(
            authorized(Some(token), &target),
            "the interface's own link must remain usable: {target}"
        );
    }

    // -- markdown ----------------------------------------------------------

    #[test]
    fn headings_render_at_all_three_levels() {
        assert_eq!(render_markdown("# One"), "<h1>One</h1>");
        assert_eq!(render_markdown("## Two"), "<h2>Two</h2>");
        assert_eq!(render_markdown("### Three"), "<h3>Three</h3>");
        // Four hashes or a hash without a following space stay plain text.
        assert_eq!(render_markdown("#### four"), "<p>#### four</p>");
        assert_eq!(render_markdown("#tag"), "<p>#tag</p>");
    }

    #[test]
    fn bold_italic_and_links_render_inline() {
        assert_eq!(
            render_markdown("It **works**."),
            "<p>It <strong>works</strong>.</p>"
        );
        assert_eq!(
            render_markdown("Very *neat*."),
            "<p>Very <em>neat</em>.</p>"
        );
        assert_eq!(
            render_markdown("[docs](https://example.com/x?a=1&b=2) here"),
            "<p><a href=\"https://example.com/x?a=1&amp;b=2\">docs</a> here</p>"
        );
    }

    #[test]
    fn unmatched_markers_pass_through_literally() {
        assert_eq!(render_markdown("a * b"), "<p>a * b</p>");
        assert_eq!(render_markdown("a ** b"), "<p>a ** b</p>");
        assert_eq!(render_markdown("see [docs](nope"), "<p>see [docs](nope</p>");
    }

    #[test]
    fn blank_lines_split_paragraphs_and_newlines_break() {
        assert_eq!(
            render_markdown("first\nsecond\n\nthird"),
            "<p>first<br>second</p><p>third</p>"
        );
    }

    #[test]
    fn dashes_become_lists_until_the_blank_line() {
        assert_eq!(
            render_markdown("- eins\n- zwei\n\nafter"),
            "<ul><li>eins</li><li>zwei</li></ul><p>after</p>"
        );
    }

    #[test]
    fn combined_markup_stays_correct() {
        assert_eq!(
            render_markdown("## Save **time**\n\nRead [this](https://x.y).\n- one\n- two"),
            "<h2>Save <strong>time</strong></h2>\
             <p>Read <a href=\"https://x.y\">this</a>.</p>\
             <ul><li>one</li><li>two</li></ul>"
        );
    }

    #[test]
    fn unsafe_links_are_not_rendered_as_anchors() {
        // javascript: and data: schemes must not become executable hrefs.
        assert_eq!(
            render_markdown("[x](javascript:alert(1))"),
            "<p>[x](javascript:alert(1))</p>"
        );
        assert_eq!(
            render_markdown("[x](data:text/html,<script>alert(1)</script>)"),
            "<p>[x](data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;)</p>"
        );
        // Safe schemes still work and are HTML-escaped.
        assert_eq!(
            render_markdown("[x](https://a.test?q=\"1\")"),
            "<p><a href=\"https://a.test?q=&quot;1&quot;\">x</a></p>"
        );
    }

    #[test]
    fn html_in_the_source_never_reaches_the_browser_unescaped() {
        assert_eq!(
            render_markdown("hi <script>alert('x')</script>"),
            "<p>hi &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;</p>"
        );
    }

    #[test]
    fn empty_input_stays_empty() {
        assert_eq!(render_markdown(""), "");
        assert_eq!(render_markdown("\n\n  \n"), "");
    }

    // -- endpoints ---------------------------------------------------------

    /// Send one GET and split the answer apart.
    ///
    /// Retries rather than flaking: the suite runs these live-server tests in
    /// parallel with hundreds of others, and on a loaded machine the accept
    /// thread can outstay a single 5 s read budget. The behaviour under test
    /// is the answer, not the latency, so three attempts it is.
    fn get(port: u16, target: &str) -> (u16, String, String) {
        let mut last_err = None;
        for _ in 0..3 {
            match get_once(port, target) {
                Ok(reply) => return reply,
                Err(err) => {
                    last_err = Some(err);
                    std::thread::sleep(Duration::from_millis(300));
                }
            }
        }
        panic!("get {target} failed three times: {:?}", last_err.unwrap());
    }

    fn get_once(port: u16, target: &str) -> Result<(u16, String, String), String> {
        let attempt = || -> Result<(u16, String, String), String> {
            let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
            let mut stream = TcpStream::connect(addr).map_err(|e| format!("connect: {e}"))?;
            stream
                .set_read_timeout(Some(IO_TIMEOUT))
                .map_err(|e| format!("timeout: {e}"))?;

            let request =
                format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
            stream
                .write_all(request.as_bytes())
                .map_err(|e| format!("write: {e}"))?;

            let mut raw = String::new();
            stream
                .read_to_string(&mut raw)
                .map_err(|e| format!("read: {e}"))?;
            let (head, body) = raw
                .split_once("\r\n\r\n")
                .ok_or_else(|| "response body".to_string())?;
            let status: u16 = head
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .and_then(|code| code.parse().ok())
                .ok_or_else(|| "status code".to_string())?;
            let content_type = head
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.trim()
                        .eq_ignore_ascii_case("content-type")
                        .then(|| value.trim().to_string())
                })
                .ok_or_else(|| "content-type header".to_string())?;
            Ok((status, content_type, body.to_string()))
        };
        attempt()
    }

    #[test]
    fn the_interface_serves_pages_and_shuts_down_cleanly() {
        let dir = TempDir::new("web-interface-roundtrip");
        let (store, project_id) = tauri::async_runtime::block_on(async {
            let store = Store::open(&dir.path().join("projecta.db"))
                .await
                .expect("open store");
            let project = store
                .create_project("Landing", "C:/repos/landing")
                .await
                .unwrap();
            store
                .set_landing_page(
                    &project.id,
                    Some("# Welcome\n\nIt **works**.\n\n- eins\n- zwei\n"),
                )
                .await
                .unwrap();
            (store, project.id)
        });

        let mut state = start_web_interface(Arc::new(store), engine(), 0).expect("start");
        let port = state.port();
        assert_eq!(web_interface_status(&state), Some(port));

        // Health speaks JSON.
        let (status, content_type, body) = get(port, "/health");
        assert_eq!(status, 200);
        assert_eq!(content_type, JSON_TYPE);
        assert_eq!(body, "{\"ok\":true}");

        // The index shows every project as a card with a working link, styled
        // by the embedded stylesheet and signed by the footer.
        let (status, _, body) = get(port, "/");
        assert_eq!(status, 200);
        assert!(
            body.contains(&format!("href=\"/project/{project_id}\""))
                && body.contains(">Landing<")
                && body.contains("card-name"),
            "{body}"
        );
        assert!(body.contains("background:#1e1e1e"), "{body}");
        assert!(body.contains("ProjectA Web Interface"), "{body}");

        // The landing page carries the name, the repo link and the rendered
        // Markdown.
        let target = format!("/project/{project_id}");
        let (status, content_type, body) = get(port, &target);
        assert_eq!(status, 200);
        assert_eq!(content_type, HTML_TYPE);
        assert!(body.contains("<h1>Landing</h1>"), "{body}");
        assert!(body.contains("<h1>Welcome</h1>"), "{body}");
        assert!(body.contains("<strong>works</strong>"), "{body}");
        assert!(body.contains("<li>eins</li>"), "{body}");

        // An unknown project and an unknown path both say so plainly.
        for (unknown, expected) in [("/project/pj-nope", 404u16), ("/nowhere", 404)] {
            let (status, _, _) = get(port, unknown);
            assert_eq!(status, expected, "{unknown}");
        }

        // Round trip closed: stop flips the status off...
        stop_web_interface(&mut state).expect("stop");
        assert_eq!(web_interface_status(&state), None);

        // ...and the port stops answering once the accept loop caught up.
        let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_err() {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "the web interface kept answering after stop"
            );
            thread::sleep(Duration::from_millis(100));
        }
    }

    #[test]
    fn a_full_server_answers_503_without_spending_a_thread() {
        let listener = TcpListener::bind(SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)))
            .expect("bind");
        let port = listener.local_addr().expect("local addr").port();
        let (_shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let limiter = crate::http_util::connection_limiter_with(1);
        let slots = Arc::clone(&limiter);
        thread::spawn(move || {
            accept_loop(listener, Arc::new(fake_board()), None, shutdown_rx, limiter)
        });

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
        let (status, _, _) = get(port, "/health");
        assert_eq!(status, 200, "a handler thread answers again");
    }

    // -- fern access: token gate -------------------------------------------

    #[test]
    fn without_a_configured_token_every_path_is_allowed() {
        // Loopback-only is the default posture: no token, no gate.
        assert!(authorized(None, "/board"));
        assert!(authorized(None, "/board?token=whatever"));
    }

    #[test]
    fn a_configured_token_must_match_exactly() {
        assert!(authorized(Some("s3cret"), "/board?token=s3cret"));
        assert!(!authorized(Some("s3cret"), "/board?token=wrong"));
        assert!(!authorized(Some("s3cret"), "/board"));
    }

    #[test]
    fn health_answers_even_without_the_token() {
        // The probe has to work for the app itself, which has no token.
        assert!(authorized(Some("s3cret"), "/health"));
    }

    #[test]
    fn the_token_is_read_from_any_position_in_the_query() {
        assert!(authorized(Some("abc"), "/board?a=1&token=abc"));
        assert!(authorized(Some("abc"), "/board?token=abc&b=2"));
        // A parameter that merely ends in "token" is not the token.
        assert!(!authorized(Some("abc"), "/board?mytoken=abc"));
    }

    #[test]
    fn a_configured_token_gates_the_live_server() {
        let dir = TempDir::new("web-interface-token");
        let store = tauri::async_runtime::block_on(async {
            let store = Store::open(&dir.path().join("projecta.db"))
                .await
                .expect("open store");
            store
                .set_setting(TOKEN_SETTING, "s3cret")
                .await
                .expect("set token");
            store
        });

        let mut state = start_web_interface(Arc::new(store), engine(), 0).expect("start");
        let port = state.port();

        let (status, _, _) = get(port, "/");
        assert_eq!(status, 401, "no token must be refused");

        let (status, _, _) = get(port, "/?token=wrong");
        assert_eq!(status, 401, "a wrong token must be refused");

        let (status, _, _) = get(port, "/?token=s3cret");
        assert_eq!(status, 200, "the right token must pass");

        let (status, _, _) = get(port, "/health");
        assert_eq!(status, 200, "the probe stays open");

        stop_web_interface(&mut state).expect("stop");
    }

    // -- DNS rebinding: the Host header has to name this machine ------------

    /// Like [`get`], but the caller picks the Host header; `None` sends the
    /// request without any Host line, HTTP/1.0 style.
    fn get_with_host(port: u16, target: &str, host: Option<&str>) -> (u16, String, String) {
        let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
        let mut stream = TcpStream::connect(addr).expect("connect");
        stream.set_read_timeout(Some(IO_TIMEOUT)).expect("timeout");
        let host_line = host.map(|h| format!("Host: {h}\r\n")).unwrap_or_default();
        let request = format!("GET {target} HTTP/1.1\r\n{host_line}Connection: close\r\n\r\n");
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
        (status, String::new(), body.to_string())
    }

    /// A browser page on an attacker domain whose DNS answers 127.0.0.1 still
    /// sends that domain as the Host header - browsers do not rewrite it - so
    /// any Host that is not `localhost` or an IP literal is refused before the
    /// token gate ever runs.
    #[test]
    fn the_live_server_refuses_foreign_host_headers() {
        let dir = TempDir::new("web-interface-host");
        let store = tauri::async_runtime::block_on(async {
            Store::open(&dir.path().join("projecta.db"))
                .await
                .expect("open store")
        });
        let mut state = start_web_interface(Arc::new(store), engine(), 0).expect("start");
        let port = state.port();

        for foreign in [
            "evil.example.com",
            "attacker.test:8080",
            "localhost.evil.com",
        ] {
            let (status, _, _) = get_with_host(port, "/health", Some(foreign));
            assert_eq!(status, 403, "{foreign}");
        }

        for local in [
            format!("127.0.0.1:{port}"),
            format!("localhost:{port}"),
            "192.168.0.10:8080".to_string(),
            "[::1]:8080".to_string(),
        ] {
            let (status, _, _) = get_with_host(port, "/health", Some(&local));
            assert_eq!(status, 200, "{local}");
        }

        // HTTP/1.0 probes without a Host line keep working: rebinding always
        // comes from a browser, and browsers always send Host.
        let (status, _, _) = get_with_host(port, "/health", None);
        assert_eq!(status, 200, "no Host header");

        stop_web_interface(&mut state).expect("stop");
    }

    #[test]
    fn the_host_gate_reads_the_header_case_insensitively() {
        let allowed =
            |host_line: &str| host_allowed(&format!("GET / HTTP/1.1\r\n{host_line}\r\n\r\n"));

        // localhost in every spelling, with and without port and root dot.
        assert!(allowed("Host: localhost"));
        assert!(allowed("Host: localhost:8080"));
        assert!(allowed("Host: LOCALHOST."));
        // IP literals, loopback or LAN, v4 and v6, with and without port.
        assert!(allowed("Host: 127.0.0.1"));
        assert!(allowed("Host: 192.168.0.10:8080"));
        assert!(allowed("Host: [::1]:8080"));
        assert!(allowed("Host: ::1"));
        // The header name is case-insensitive too.
        assert!(allowed("hOsT: 127.0.0.1:8080"));

        // DNS names are the rebinding shape - all of them, including the
        // ones that merely start with an allowed word.
        assert!(!allowed("Host: evil.example.com"));
        assert!(!allowed("Host: attacker.test:8080"));
        assert!(!allowed("Host: localhost.evil.com"));
        assert!(!allowed("Host: 127.0.0.1.evil.com"));
    }

    #[test]
    fn a_request_without_a_host_line_is_not_the_attack() {
        assert!(host_allowed("GET /health HTTP/1.0\r\n\r\n"));
    }

    // -- board and learnings routes ----------------------------------------

    /// A backend that has board data, so the fern routes exist for it.
    struct FakeBoard {
        rows: Vec<BoardRow>,
        learnings: Vec<Learning>,
    }

    fn row(project: &str, name: &str, column: &str, reason: Option<&str>) -> BoardRow {
        BoardRow {
            project_id: project.to_string(),
            project_name: format!("Project {project}"),
            worker_name: name.to_string(),
            role: None,
            column: column.to_string(),
            attention_reason: reason.map(str::to_string),
            age_seconds: 42,
        }
    }

    fn learning(id: &str, status: &str, content: &str) -> Learning {
        Learning {
            id: id.to_string(),
            project_id: "p1".to_string(),
            worker_id: "w1".to_string(),
            profile_id: "claude".to_string(),
            pattern_label: Some("label".to_string()),
            content: content.to_string(),
            status: status.to_string(),
            created_at: 0,
        }
    }

    impl LandingPages for FakeBoard {
        fn projects(&self) -> Result<Vec<Project>, String> {
            Ok(Vec::new())
        }
        fn project(&self, _id: &str) -> Result<Option<Project>, String> {
            Ok(None)
        }
        fn board(&self, project_id: Option<&str>) -> Option<Result<Vec<BoardRow>, String>> {
            let rows = self
                .rows
                .iter()
                .filter(|r| project_id.is_none_or(|id| r.project_id == id))
                .cloned()
                .collect();
            Some(Ok(rows))
        }
        fn learnings(&self, project_id: &str) -> Option<Result<Vec<Learning>, String>> {
            let rows = self
                .learnings
                .iter()
                .filter(|l| l.project_id == project_id)
                .cloned()
                .collect();
            Some(Ok(rows))
        }
    }

    fn fake_board() -> FakeBoard {
        FakeBoard {
            rows: vec![
                row("p1", "budget", "working", None),
                row("p1", "ledger", "needs_you", Some("Entscheidung wartet")),
                row("p2", "landing", "done", None),
            ],
            learnings: vec![
                learning("l1", LEARNING_APPROVED, "approved one"),
                learning("l2", LEARNING_PENDING, "pending one"),
            ],
        }
    }

    #[test]
    fn board_json_carries_every_row() {
        let page = route(&fake_board(), "/board.json", "");
        assert_eq!(page.status, 200);
        assert_eq!(page.content_type, JSON_TYPE);
        let value: serde_json::Value = serde_json::from_str(&page.body).expect("json");
        let rows = value["rows"].as_array().expect("rows array");
        assert_eq!(rows.len(), 3, "every project's rows, not just one");
        // The JSON carries the same order as the page: whoever needs a human
        // comes first. A widget reading this should not have to re-sort to
        // show the same thing the browser shows.
        assert_eq!(rows[0]["workerName"], "ledger");
        assert_eq!(rows[0]["attentionReason"], "Entscheidung wartet");
        assert!(rows[1]["attentionReason"].is_null());
    }

    #[test]
    fn the_board_page_puts_attention_first() {
        let page = route(&fake_board(), "/board", "");
        assert_eq!(page.status, 200);
        assert_eq!(page.content_type, HTML_TYPE);
        let needs = page.body.find("ledger").expect("attention row rendered");
        let working = page.body.find("budget").expect("working row rendered");
        assert!(needs < working, "rows needing the user must come first");
    }

    #[test]
    fn a_project_board_shows_only_that_project() {
        let page = route(&fake_board(), "/project/p2/board", "");
        assert_eq!(page.status, 200);
        assert!(page.body.contains("landing"));
        assert!(
            !page.body.contains("budget"),
            "other projects must not leak in"
        );
    }

    #[test]
    fn learnings_list_pending_before_the_rest() {
        let page = route(&fake_board(), "/project/p1/learnings", "");
        assert_eq!(page.status, 200);
        let pending = page.body.find("pending one").expect("pending rendered");
        let approved = page.body.find("approved one").expect("approved rendered");
        assert!(
            pending < approved,
            "pending entries are the ones needing review"
        );
    }

    // -- the real backend: store + status engine ---------------------------

    /// A worker row that exists only in the database - no worktree, no PTY.
    /// The board never touches either, so this is a whole worker as far as
    /// these tests are concerned.
    fn worker_row(id: &str, project_id: &str, task: &str, status: &str, age: i64) -> WorkerRow {
        WorkerRow {
            id: id.to_string(),
            project_id: project_id.to_string(),
            task: task.to_string(),
            profile_id: "claude".to_string(),
            branch: format!("pa/{id}"),
            worktree_path: format!("/tmp/{id}"),
            status: status.to_string(),
            kind: KIND_WORKER.to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: None,
            tested_at: None,
            role_variant_id: None,
            paused_reason: None,
            created_at: now_unix_secs() - age,
        }
    }

    #[test]
    fn the_real_backend_puts_live_workers_on_the_board() {
        let dir = TempDir::new("web-interface-live-board");
        let (store, project_id) = tauri::async_runtime::block_on(async {
            let store = Store::open(&dir.path().join("projecta.db"))
                .await
                .expect("open store");
            let project = store.create_project("Fern", "/repos/fern").await.unwrap();
            store
                .insert_worker(&worker_row(
                    "wk-run",
                    &project.id,
                    "Login-Formular reparieren",
                    STATUS_RUNNING,
                    180,
                ))
                .await
                .unwrap();
            // An agent that ended is the plainest way to earn a reason: the
            // engine files it under "needs you" without any hook traffic.
            store
                .insert_worker(&worker_row(
                    "wk-gone",
                    &project.id,
                    "Migration schreiben",
                    STATUS_EXITED,
                    60,
                ))
                .await
                .unwrap();
            // A second project proves that /board is the union of all of them.
            let other = store
                .create_project("Andere", "/repos/andere")
                .await
                .unwrap();
            store
                .insert_worker(&worker_row(
                    "wk-other",
                    &other.id,
                    "Docs",
                    STATUS_RUNNING,
                    5,
                ))
                .await
                .unwrap();
            (store, project.id)
        });

        let mut state = start_web_interface(Arc::new(store), engine(), 0).expect("start");
        let port = state.port();

        let (status, content_type, body) = get(port, "/board.json");
        assert_eq!(status, 200);
        assert_eq!(content_type, JSON_TYPE);
        let value: serde_json::Value = serde_json::from_str(&body).expect("json");
        let rows = value["rows"].as_array().expect("rows array");
        assert_eq!(rows.len(), 3, "every project's workers: {body}");

        // The one that ended leads, with the reason the engine derived.
        assert_eq!(rows[0]["workerName"], "Migration schreiben");
        assert_eq!(rows[0]["column"], COL_NEEDS_YOU);
        // F1-Attention: der Satz wird aus `ReasonCode::AgentExited` abgeleitet.
        // Das Feld selbst bleibt derselbe String, den diese Route immer las.
        assert_eq!(
            rows[0]["attentionReason"],
            "Der Agent ist beendet — prüfe sein Ergebnis, dann neu starten oder archivieren"
        );
        assert_eq!(rows[0]["projectName"], "Fern");
        assert_eq!(rows[0]["projectId"], project_id.as_str());
        assert!(
            rows[0]["role"].is_null(),
            "a plain worker has no role to name"
        );
        // A range, not 60 exactly: `worker_row` seeds `created_at` from the
        // wall clock and the board reads it back from the same, so a second
        // that ticks over between the two makes this 61 and the test flake.
        let age = rows[0]["ageSeconds"].as_i64().expect("an age");
        assert!((60..=65).contains(&age), "{age}");

        // The others are working, in no particular order beyond the engine's.
        let working: Vec<&str> = rows[1..]
            .iter()
            .map(|row| row["workerName"].as_str().expect("name"))
            .collect();
        assert!(working.contains(&"Login-Formular reparieren"), "{body}");
        assert!(working.contains(&"Docs"), "{body}");
        assert!(
            rows[1..].iter().all(|row| row["column"] == COL_WORKING),
            "{body}"
        );

        // The HTML board says the same thing, with the attention row first.
        let (status, content_type, body) = get(port, "/board");
        assert_eq!(status, 200);
        assert_eq!(content_type, HTML_TYPE);
        assert!(body.contains("1 braucht dich."), "{body}");
        assert!(body.contains("Der Agent ist beendet"), "{body}");
        assert!(
            body.contains("Needs you"),
            "the desktop's column name: {body}"
        );
        assert!(
            body.find("Migration schreiben") < body.find("Login-Formular"),
            "{body}"
        );

        // One project's board is only that project's.
        let (status, _, body) = get(port, &format!("/project/{project_id}/board"));
        assert_eq!(status, 200);
        assert!(body.contains("Migration schreiben"), "{body}");
        assert!(
            !body.contains(">Docs<"),
            "another project leaked in: {body}"
        );

        stop_web_interface(&mut state).expect("stop");
    }

    #[test]
    fn the_real_backend_names_a_coordinator_by_its_role() {
        let dir = TempDir::new("web-interface-role");
        let store = tauri::async_runtime::block_on(async {
            let store = Store::open(&dir.path().join("projecta.db"))
                .await
                .expect("open store");
            let project = store.create_project("Fern", "/repos/fern").await.unwrap();
            let mut row = worker_row(
                "wk-orch",
                &project.id,
                "Du bist der Orchestrator...",
                STATUS_RUNNING,
                30,
            );
            row.kind = KIND_ORCHESTRATOR.to_string();
            store.insert_worker(&row).await.unwrap();
            store
        });

        let mut state = start_web_interface(Arc::new(store), engine(), 0).expect("start");
        let port = state.port();

        let (_, _, body) = get(port, "/board.json");
        let value: serde_json::Value = serde_json::from_str(&body).expect("json");
        let row = &value["rows"][0];
        // Not the first line of its role prompt: the role is the only name a
        // coordinator has that is worth reading on a phone.
        assert_eq!(row["workerName"], "Orchestrator");
        assert_eq!(row["role"], KIND_ORCHESTRATOR);

        stop_web_interface(&mut state).expect("stop");
    }

    #[test]
    fn the_real_backend_lists_learnings_pending_first() {
        let dir = TempDir::new("web-interface-live-learnings");
        let (store, project_id) = tauri::async_runtime::block_on(async {
            let store = Store::open(&dir.path().join("projecta.db"))
                .await
                .expect("open store");
            let project = store.create_project("Fern", "/repos/fern").await.unwrap();
            // Inserted approved-first, so pending can only lead if the route
            // sorted it there - `list_learnings` returns oldest first.
            for (id, status, content) in [
                ("ln-1", LEARNING_APPROVED, "Immer erst die Tests lesen."),
                (
                    "ln-2",
                    LEARNING_PENDING,
                    "Der Build braucht CARGO_BUILD_JOBS=2.",
                ),
            ] {
                store
                    .insert_learning(&Learning {
                        id: id.to_string(),
                        project_id: project.id.clone(),
                        worker_id: "wk-1".to_string(),
                        profile_id: "claude".to_string(),
                        pattern_label: Some(format!("Muster {id}")),
                        content: content.to_string(),
                        status: status.to_string(),
                        created_at: now_unix_secs(),
                    })
                    .await
                    .unwrap();
            }
            (store, project.id)
        });

        let mut state = start_web_interface(Arc::new(store), engine(), 0).expect("start");
        let port = state.port();

        let (status, content_type, body) = get(port, &format!("/project/{project_id}/learnings"));
        assert_eq!(status, 200);
        assert_eq!(content_type, HTML_TYPE);
        assert!(body.contains("1 wartet auf eine Entscheidung."), "{body}");
        // Full text, not a preview: reviewing is reading the whole thing.
        assert!(
            body.contains("Der Build braucht CARGO_BUILD_JOBS=2."),
            "{body}"
        );
        assert!(
            body.find("Muster ln-2") < body.find("Muster ln-1"),
            "pending is what waits on a decision: {body}"
        );

        // A project without learnings says so instead of showing an empty box.
        let (status, _, body) = get(port, "/project/pj-nothing/learnings");
        assert_eq!(status, 200);
        assert!(body.contains("Noch nichts gelernt"), "{body}");

        stop_web_interface(&mut state).expect("stop");
    }

    // -- fern access: how far the listener reaches -------------------------

    /// A backend that answers nothing but the bind setting.
    struct FakeBind(Option<&'static str>);

    impl LandingPages for FakeBind {
        fn projects(&self) -> Result<Vec<Project>, String> {
            Ok(Vec::new())
        }
        fn project(&self, _id: &str) -> Result<Option<Project>, String> {
            Ok(None)
        }
        fn bind_address(&self) -> Option<String> {
            self.0.map(str::to_string)
        }
    }

    fn bound_ip(bind: Option<&'static str>) -> IpAddr {
        bind_listener(&FakeBind(bind), 0, true)
            .expect("bind")
            .local_addr()
            .expect("local addr")
            .ip()
    }

    #[test]
    fn the_bind_setting_decides_how_far_the_listener_reaches() {
        // The default posture: this machine only.
        assert_eq!(bound_ip(None), IpAddr::V4(Ipv4Addr::LOCALHOST));
        // The WLAN posture: every interface, which is what a phone needs.
        assert_eq!(bound_ip(Some("0.0.0.0")), IpAddr::V4(Ipv4Addr::UNSPECIFIED));
        // A typo costs the fern board, not the local one.
        assert_eq!(bound_ip(Some("nonsense")), IpAddr::V4(Ipv4Addr::LOCALHOST));
        // Blank is how a cleared settings field arrives.
        assert_eq!(bound_ip(Some("")), IpAddr::V4(Ipv4Addr::LOCALHOST));
    }

    #[test]
    fn the_bind_setting_comes_out_of_the_store() {
        let dir = TempDir::new("web-interface-bind-setting");
        let store = tauri::async_runtime::block_on(async {
            let store = Store::open(&dir.path().join("projecta.db"))
                .await
                .expect("open store");
            store
        });
        // Read outside the async block on purpose: `bind_address` blocks on
        // the store, and doing that inside a runtime is the panic this whole
        // "read it on the server's own thread" arrangement exists to avoid.
        assert_eq!(LandingPages::bind_address(&store), None, "unset by default");

        tauri::async_runtime::block_on(store.set_setting(BIND_SETTING, "0.0.0.0")).unwrap();
        assert_eq!(
            LandingPages::bind_address(&store),
            Some("0.0.0.0".to_string())
        );
    }

    // -- phone-shaped pages ------------------------------------------------

    #[test]
    fn board_pages_reload_themselves_and_landing_pages_do_not() {
        let refresh = format!("http-equiv=\"refresh\" content=\"{REFRESH_SECONDS}\"");
        assert!(route(&fake_board(), "/board", "").body.contains(&refresh));
        assert!(route(&fake_board(), "/project/p1/learnings", "")
            .body
            .contains(&refresh));
        // The index has nothing that changes while it is read.
        assert!(!route(&fake_board(), "/", "").body.contains(&refresh));
    }

    #[test]
    fn board_pages_are_laid_out_for_a_phone() {
        let body = route(&fake_board(), "/board", "").body;
        // Reading size rather than a zoomed-out desktop page...
        assert!(
            body.contains("name=\"viewport\" content=\"width=device-width,initial-scale=1\""),
            "{body}"
        );
        // ...one card per row on a thumb-width screen...
        assert!(body.contains("@media (max-width:700px)"), "{body}");
        assert!(body.contains("grid-template-columns:1fr"), "{body}");
        // ...and the column as a chip a glance can tell apart.
        assert!(body.contains("chip chip-needs_you"), "{body}");
    }

    #[test]
    fn an_empty_board_says_which_kind_of_empty_it_is() {
        let empty = FakeBoard {
            rows: Vec::new(),
            learnings: Vec::new(),
        };
        let body = route(&empty, "/board", "").body;
        assert!(body.contains("Kein Worker läuft gerade."), "{body}");
        // A board where nobody is stuck is the good kind of quiet, and says so.
        let calm = FakeBoard {
            rows: vec![row("p1", "budget", "working", None)],
            learnings: Vec::new(),
        };
        assert!(route(&calm, "/board", "")
            .body
            .contains("Alle arbeiten, nichts braucht dich."),);
    }

    // -- fern access: links keep the token ---------------------------------

    #[test]
    fn a_token_rides_along_on_every_internal_link() {
        // Without a token nothing is appended: the local pages keep bare hrefs.
        assert_eq!(link_query(None), "");
        assert_eq!(link_query(Some("s3cret")), "?token=s3cret");
        // A token with a query separator in it must not cut its own link in
        // half, and must not open an attribute either.
        assert_eq!(link_query(Some("a&b=\"c\"")), "?token=a%26b%3D%22c%22");

        // Every link a phone can tap carries it, or the second tap is a 401.
        let query = link_query(Some("s3cret"));
        let board = route(&fake_board(), "/board", &query).body;
        assert!(
            board.contains("/project/p1/learnings?token=s3cret"),
            "{board}"
        );
        let learnings = route(&fake_board(), "/project/p1/learnings", &query).body;
        assert!(
            learnings.contains("/project/p1/board?token=s3cret"),
            "{learnings}"
        );
    }

    #[test]
    fn a_backend_without_board_data_has_no_board_routes() {
        // The store-only backend keeps serving landing pages and nothing more.
        let dir = TempDir::new("web-interface-no-board");
        let store = tauri::async_runtime::block_on(async {
            Store::open(&dir.path().join("projecta.db"))
                .await
                .expect("open store")
        });
        assert_eq!(route(&store, "/board", "").status, 404);
        assert_eq!(route(&store, "/board.json", "").status, 404);
    }
}
