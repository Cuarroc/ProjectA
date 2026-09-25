//! Fail-soft OmniRoute probing and usage parsing.
//!
//! OmniRoute is an optional local router. ProjectA never depends on it: an
//! offline daemon, a rejected management token, a busy daemon, a timeout or an
//! unreadable payload leaves the existing ledger untouched and the rest of the
//! app running. Management fetches keep those causes distinct internally so a
//! later caller can react without turning telemetry into an application error.
//!
//! The liveness probe tries `/health`, `/healthz` and `/`, then best-effort quota
//! routes and `/api/version`. The version and last valid quota document remain
//! optional because management routes differ between OmniRoute builds and may
//! be authentication-gated.
//!
//! Usage has two real wire formats. `/api/usage/logs` is the legacy rolling JSON
//! array of seven-field pipe strings and remains the ingestion fallback.
//! `/api/usage/call-logs` is an array of objects with stable request ids,
//! attribution (`apiKeyName`, `sessionTag`, `comboName`) and nested token counts;
//! [`parse_call_logs`] preserves that richer shape for the worker-attribution
//! layer without making current ingestion depend on it.
//!
//! The HTTP client remains a `TcpStream` and a `format!`, matching
//! [`crate::hooks`] on the other side of the loopback: one `GET`,
//! `Connection: close`, bounded reads and no new dependency.

use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::store::{Store, UsageEvent, UsageTotals};

/// Where OmniRoute listens when nobody says otherwise.
pub const DEFAULT_PORT: u16 = 20128;

/// How often the probe runs after the one at startup.
pub const PROBE_INTERVAL: Duration = Duration::from_secs(120);

/// Connect, write and read budget for a single request. A local service that
/// cannot answer in two seconds is not a service the board should wait on.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// Tried in order until one answers `2xx`. `/healthz` is OmniRoute's real
/// liveness route; `/health` is a 404 and `/` a 307 to the dashboard on
/// production builds.
const HEALTH_PATHS: [&str; 3] = ["/health", "/healthz", "/"];

/// Optional version document. OmniRoute builds that gate or omit it are still
/// healthy; the probe simply leaves the version empty.
const VERSION_PATH: &str = "/api/version";

/// Tried in order until one answers `2xx` with JSON. Nothing here is required.
const QUOTA_PATHS: [&str; 3] = [
    "/api/v1/quota",
    "/dashboard/api/free-tiers",
    "/api/v1/free-tiers",
];

/// Refuse a response larger than this; a health check is a few hundred bytes.
pub const MAX_RESPONSE: usize = 256 * 1024;

// -- the management API (Phase 19 T3) --------------------------------------

/// The rolling request log. Verified against OmniRoute 3.8.51: it answers a
/// JSON array of pipe-delimited strings, newest first, and holds the last few
/// hundred requests. See [`parse_usage_log`] for the line format.
const USAGE_PATH: &str = "/api/usage/logs";

/// Lifetime totals with a per-provider and per-model breakdown, including the
/// dollars the log lines do not carry. Read on the same beat as
/// [`USAGE_PATH`], kept verbatim, and never mixed into the ledger.
const USAGE_HISTORY_PATH: &str = "/api/usage/history";

/// How often the ledger is refreshed. Five minutes against a log that holds
/// hundreds of lines leaves a wide margin before the ring buffer could wrap
/// past what has already been stored.
pub const USAGE_INTERVAL: Duration = Duration::from_secs(300);

/// The management API is slower than a health check - it renders a log - so it
/// gets its own, longer budget.
const USAGE_TIMEOUT: Duration = Duration::from_secs(10);

/// Refuse a usage document larger than this. A few hundred log lines is tens
/// of kilobytes; a megabyte means something other than the log answered.
const MAX_USAGE_RESPONSE: usize = 4 * 1024 * 1024;

/// What the last probe found. Shared: the probe thread writes, the quota
/// snapshot reads, and Phase 4's control API will read the same handle.
pub struct OmniRoute {
    addr: SocketAddr,
    online: AtomicBool,
    /// Whatever the quota endpoints returned, unparsed beyond "it is JSON".
    quota: Mutex<Option<Value>>,
    /// Version reported by the last successful `/api/version` read. Kept when a
    /// later probe cannot read that optional route, just like the quota cache.
    omniroute_version: Mutex<Option<String>>,
    /// The management API token, when the vault holds one. `None` is the
    /// ordinary state of a machine that never typed one in.
    token: Mutex<Option<String>>,
    /// Did the last management call get through? Cleared by a `401` and by
    /// every [`OmniRoute::set_token`], so a replaced token is re-checked.
    authorized: AtomicBool,
    /// The last `/api/usage/history` document, verbatim. This is where the
    /// real dollars live; see [`OmniRoute::usage_history`].
    history: Mutex<Option<Value>>,
}

impl Default for OmniRoute {
    fn default() -> Self {
        Self::new(SocketAddr::V4(SocketAddrV4::new(
            Ipv4Addr::LOCALHOST,
            DEFAULT_PORT,
        )))
    }
}

impl OmniRoute {
    pub fn new(addr: SocketAddr) -> Self {
        Self {
            addr,
            online: AtomicBool::new(false),
            quota: Mutex::new(None),
            omniroute_version: Mutex::new(None),
            token: Mutex::new(None),
            authorized: AtomicBool::new(false),
            history: Mutex::new(None),
        }
    }

    /// Where this handle probes. [`crate::providers`] needs it to push the
    /// stored keys back at the router it just found.
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// Did the last probe reach OmniRoute? `false` until the first one lands.
    pub fn is_online(&self) -> bool {
        self.online.load(Ordering::Relaxed)
    }

    /// The last quota document, if any endpoint ever returned one.
    ///
    /// Nothing in Phase 3.6 renders it: the board only needs to know whether
    /// the router is up. It is collected now so that Phase 4's `GET /api/quota`
    /// has something to serve without a second probe, and so that whatever
    /// shape the local build answers with is visible in the tests today.
    #[allow(dead_code)]
    pub fn quota_json(&self) -> Option<Value> {
        self.quota
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
    }

    /// Version reported by the last successful optional version probe.
    #[allow(dead_code)]
    pub fn omniroute_version(&self) -> Option<String> {
        self.omniroute_version
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
    }

    /// Run one probe and record what it found. Returns the new online state.
    ///
    /// A probe that cannot connect clears `online` but *keeps* the last quota
    /// document: it is stale, not wrong, and a restarting router should not
    /// blank the panel.
    pub fn probe_once(&self) -> bool {
        let online = HEALTH_PATHS
            .iter()
            .any(|path| matches!(get(self.addr, path), Some((status, _)) if is_ok(status)));
        self.online.store(online, Ordering::Relaxed);

        if online {
            // Both slots are plain replaces, so a poisoned lock is taken
            // over rather than dropping a probe result the router just spent
            // a request producing (W1-15).
            if let Some(version) = self.probe_version() {
                *self
                    .omniroute_version
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner()) = Some(version);
            }
            if let Some(value) = self.probe_quota() {
                *self
                    .quota
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner()) = Some(value);
            }
        }
        online
    }

    fn probe_version(&self) -> Option<String> {
        let (status, body) = get(self.addr, VERSION_PATH)?;
        if !is_ok(status) {
            return None;
        }
        parse_version(&body)
    }

    /// Ask each candidate endpoint until one answers with JSON we can keep.
    fn probe_quota(&self) -> Option<Value> {
        QUOTA_PATHS.iter().find_map(|path| {
            let (status, body) = get(self.addr, path)?;
            if !is_ok(status) {
                return None;
            }
            serde_json::from_str::<Value>(body.trim()).ok()
        })
    }
}

// -- the usage ledger (Phase 19 T3) ----------------------------------------

/// One `/api/usage/call-logs` object, kept richer than the current ledger.
///
/// W1 consumes the attribution and stable `id`; W0 only establishes the parser
/// against a live fixture so the storage migration does not have to discover
/// the wire format at the same time.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallLogRow {
    pub id: String,
    /// Unix seconds, from the router's own timestamp.
    pub ts: i64,
    pub api_key_name: Option<String>,
    pub session_tag: Option<String>,
    pub combo_name: Option<String>,
    pub tokens_in: i64,
    pub tokens_out: i64,
    pub tokens_cache_read: Option<i64>,
    pub tokens_cache_write: Option<i64>,
    pub tokens_reasoning: Option<i64>,
    pub tokens_compressed: Option<i64>,
    /// The source object, verbatim.
    pub raw: String,
}

/// One request as OmniRoute's legacy log reports it, before it becomes a
/// ledger row.
///
/// Deliberately not the storage type: [`crate::store::UsageEvent`] is what is
/// kept, and the step between the two is where the id is hashed and the
/// profile is guessed. Splitting them keeps the parser a pure function of the
/// response body, which is what makes it cheap to test against real payloads.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UsageRow {
    /// Unix seconds, from the router's own timestamp.
    pub ts: i64,
    pub model: String,
    /// Lowercased: the log shouts its providers (`CODEX`), the rest of
    /// ProjectA does not.
    pub provider: String,
    /// The provider account the row was billed to - an e-mail or an opaque
    /// id. Not a ProjectA worker and not a ProjectA profile.
    pub account: String,
    pub tokens_in: i64,
    pub tokens_out: i64,
    /// `None` when the feed did not price the row, which the current line
    /// format never does.
    pub cost_usd: Option<f64>,
    /// The source line or object, verbatim.
    pub raw: String,
}

/// Why a usage poll produced nothing.
///
/// Every one of these is an ordinary answer that leaves the ledger as it was.
/// None of them is ever propagated as an application error: the ledger is
/// telemetry, and ProjectA worked without it for eighteen phases.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageError {
    /// Nothing answered. The router is down, or was never there.
    Offline,
    /// The management API refused the credential - or there was none to
    /// refuse. This is the degradation path the phase plan asks for: the probe
    /// keeps reporting online/offline and the ledger stops growing.
    Unauthorized,
    /// The daemon is deliberately applying backpressure (`429` or `503`).
    BusyRateLimited,
    /// A socket connected, but a management response did not arrive within its
    /// budget.
    Timeout,
    /// Something answered, but not a usage document.
    Unreadable,
}

impl OmniRoute {
    /// Hand over the management API token, or `None` to forget it.
    ///
    /// Always clears the authorization verdict: a token that just changed has
    /// not been checked, whatever the last one did.
    pub fn set_token(&self, token: Option<&str>) {
        let token = token
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .map(str::to_string);
        *self
            .token
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = token;
        self.authorized.store(false, Ordering::Relaxed);
    }

    fn token(&self) -> Option<String> {
        self.token
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
    }

    /// Did the last management call get through? `false` until one has.
    pub fn is_authorized(&self) -> bool {
        self.authorized.load(Ordering::Relaxed)
    }

    /// The last `/api/usage/history` document, if one was ever fetched.
    ///
    /// Kept verbatim and served as-is. This is the only source of real dollars
    /// ProjectA has: the per-request log carries tokens but no price, so the
    /// ledger's own `cost_usd` stays empty and the totals come from here.
    pub fn usage_history(&self) -> Option<Value> {
        self.history
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
    }

    /// Establish that the held token opens the management API, and cache it.
    ///
    /// There is no JWT to fetch. `POST /api/auth/login` exists, but it is the
    /// dashboard's password form - it wants the human's password and hands
    /// back a browser session. What the management API actually accepts, and
    /// what the plan's env file holds, is a personal `oma_live_…` token
    /// presented as `Authorization: Bearer`. Verified against 3.8.51:
    /// `/api/usage/logs` answers `200` with the token and `401` with
    /// `{"error":{"code":"AUTH_001"}}` without it or with a wrong one.
    ///
    /// So "logging in" here is one authenticated read whose verdict is
    /// remembered. Returns whether the management API is open to us.
    ///
    /// The read is `/api/usage/history`, and it is not a throwaway: that
    /// document is the only real dollar figure ProjectA has, so the call that
    /// establishes the credential is the same call that refreshes the totals.
    /// A route that answers anything other than `401`/`403` counts as open -
    /// a build without this particular endpoint has still not refused us.
    pub fn login(&self) -> bool {
        // No token is the same outcome as a rejected one - there is nothing to
        // present - and it costs a socket to find that out the long way.
        let Some(token) = self.token() else {
            self.authorized.store(false, Ordering::Relaxed);
            return false;
        };
        let Ok((status, body)) = get_usage_authorized(self.addr, USAGE_HISTORY_PATH, &token) else {
            self.authorized.store(false, Ordering::Relaxed);
            return false;
        };
        if status == 401 || status == 403 {
            self.authorized.store(false, Ordering::Relaxed);
            return false;
        }
        if is_ok(status) {
            if let Ok(value) = serde_json::from_str::<Value>(body.trim()) {
                *self
                    .history
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner()) = Some(value);
            }
        }
        self.authorized.store(true, Ordering::Relaxed);
        true
    }

    /// One read of the request log.
    pub fn fetch_usage(&self) -> Result<Vec<UsageRow>, UsageError> {
        let Some(token) = self.token() else {
            return Err(UsageError::Unauthorized);
        };
        let response = get_usage_authorized(self.addr, USAGE_PATH, &token)?;
        let rows = match classify_usage_response(response) {
            Err(UsageError::Unauthorized) => {
                self.authorized.store(false, Ordering::Relaxed);
                return Err(UsageError::Unauthorized);
            }
            result => result?,
        };
        self.authorized.store(true, Ordering::Relaxed);
        Ok(rows)
    }
}

/// Everything one caller needs to render "what has OmniRoute cost us".
///
/// Serialized as `{ online, authorized, events, today, total, reportedCostUsd,
/// history }` and served by `GET /api/usage`, `pa usage` and the UsageView
/// section alike, so the three cannot drift apart.
///
/// It is deliberately **not** scoped to a project. OmniRoute's log has no
/// project dimension and no way to acquire one - its rows are keyed by
/// provider account, not by repository - so `/api/projects/<id>/usage` would
/// have to answer every project with the same numbers. One honest fleet-wide
/// route says that out loud instead of implying a filter that does not exist.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageReport {
    /// Did the last probe reach the router?
    pub online: bool,
    /// Is the management API open to us? `false` means the ledger is frozen -
    /// no token, or one the router refused.
    pub authorized: bool,
    /// The newest ledger rows, newest first.
    pub events: Vec<UsageEvent>,
    /// Totals since midnight UTC, and over everything ever stored.
    pub today: UsageTotals,
    pub total: UsageTotals,
    /// What the router itself says it has spent, lifetime, from
    /// `/api/usage/history`. This is the only real dollar figure available:
    /// the per-request log carries tokens but no price, so the ledger's own
    /// `cost_usd` is empty and a UI must show this beside it, not instead of
    /// the token counts. `None` when the history has never been read.
    pub reported_cost_usd: Option<f64>,
    /// The history document verbatim, for a caller that wants the per-model
    /// breakdown ProjectA does not model.
    pub history: Option<Value>,
}

/// Build the report: the stored ledger, plus what the live handle knows.
pub async fn usage_report(
    omni: &OmniRoute,
    store: &Store,
    limit: u32,
    now: i64,
) -> Result<UsageReport, String> {
    let midnight = crate::digest::day_start(&crate::digest::utc_date(now));
    let history = omni.usage_history();
    Ok(UsageReport {
        online: omni.is_online(),
        authorized: omni.is_authorized(),
        events: store.list_usage_events(None, Some(limit)).await?,
        today: store.usage_totals(midnight).await?,
        total: store.usage_totals(None).await?,
        reported_cost_usd: history
            .as_ref()
            .and_then(|value| value.get("totalCost"))
            .and_then(Value::as_f64),
        history,
    })
}

/// Cheap wins only on a strict, finite drop. Equal or inverted totals are
/// not a cost victory — that is the live O-0 finding on this router.
#[allow(dead_code)] // product predicate; spawn cutover is a later switch
pub fn cheap_beats_reliable(cheap: f64, reliable: f64) -> bool {
    cheap.is_finite() && reliable.is_finite() && cheap < reliable
}

/// Read the log once and store what is new. Returns how many rows were added.
///
/// The whole poll is one function so the thread has nothing in it but a sleep,
/// and so a test can run a single pass against a fake router. Every failure is
/// an `Ok(0)` with a reason on stderr at most once per transition: there is
/// nothing a caller could do about a router that is down.
pub async fn ingest_usage_once(omni: &OmniRoute, store: &Store) -> usize {
    // The login is the gate, and it is also what refreshes the cost totals -
    // see [`OmniRoute::login`]. Without a management token, or with one the
    // router refuses, there is nothing to read and the ledger stays put.
    if !omni.login() {
        return 0;
    }
    let rows = match omni.fetch_usage() {
        Ok(rows) => rows,
        Err(_) => return 0,
    };
    let mut stored = 0;
    for row in rows {
        let status = usage_line_http_status(&row.raw);
        match store.insert_usage_event(&row.into_event()).await {
            Ok(true) => {
                stored += 1;
                if let Some(status) = status {
                    crate::routing::note_live_chat_outcome(Some(status), "");
                }
            }
            // The ordinary case: the log is a ring buffer, so most of what it
            // hands back on any given pass has already been stored.
            Ok(false) => {}
            Err(err) => eprintln!("projecta: {err}"),
        }
    }
    stored
}

/// Trailing HTTP status on a pipe-delimited usage line, when present.
pub fn usage_line_http_status(raw: &str) -> Option<u16> {
    let line = raw.trim();
    if line.starts_with('{') {
        return None;
    }
    // The ledger line has seven pipe-delimited fields with the HTTP status
    // last. A shorter line ends in a token count, not a status — parsing it
    // as one would invent a chat failure out of a big request.
    if line.matches('|').count() < 6 {
        return None;
    }
    line.rsplit('|').next()?.trim().parse().ok()
}

impl UsageRow {
    /// The ledger row this log line becomes.
    fn into_event(self) -> UsageEvent {
        let id = usage_event_id(&self.raw);
        UsageEvent {
            id,
            ts: self.ts,
            profile_id: attribute(&self.model),
            model: self.model,
            provider: self.provider,
            tokens_in: self.tokens_in,
            tokens_out: self.tokens_out,
            cost_usd: self.cost_usd,
            raw_json: self.raw,
        }
    }
}

/// The dedup key: a stable hash of the source line.
///
/// FNV-1a and not `DefaultHasher`, because this value goes into a database and
/// has to mean the same thing after a Rust upgrade - `DefaultHasher`'s output
/// is explicitly not guaranteed between releases.
///
/// Two genuinely distinct requests collide only if the router logged them with
/// the same millisecond, model, provider, account and token counts, at which
/// point the two lines are indistinguishable in the feed anyway.
pub fn usage_event_id(raw: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in raw.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("ue-{hash:016x}")
}

/// Which ProjectA profile a usage row belongs to, when that can be *known*.
///
/// Almost always `None`, and that is the honest answer. Two things were
/// verified against the live router (3.8.51) before settling on it:
///
/// 1. **The session header is not ours to set.** A request carrying
///    `X-OmniRoute-Session-Id: pa-test-session-42` came back with
///    `x-omniroute-session-id: 5a95caeaa16a36d7` - OmniRoute assigns its own,
///    and the header is not in its `access-control-allow-headers` list. So
///    `ANTHROPIC_CUSTOM_HEADERS` cannot stamp a worker id onto a request.
/// 2. **The log has nowhere to put one anyway.** Every line is exactly seven
///    fields - timestamp, model, provider, account, tokens in, tokens out,
///    HTTP status - and none of them is a session, a request id or a client.
///
/// Worker-level cost attribution is therefore not possible from this feed, and
/// nothing here pretends otherwise. What is left is profile level, and only
/// where a routed profile pinned a virtual model that survived into the log
/// (`auto/coding`); once OmniRoute has resolved the alias to a concrete model
/// the trail is gone, so a resolved row stays unattributed rather than being
/// guessed at.
fn attribute(model: &str) -> Option<String> {
    let model = model.trim();
    crate::profiles::load_profiles()
        .into_iter()
        .find(|profile| profile.args.iter().any(|arg| arg == model))
        .map(|profile| profile.id)
}

/// Split a `/api/usage/call-logs` body into rich object rows.
///
/// Field names match the live v3.8.49 management response. A malformed object
/// costs only itself, while a non-array body is not a call-log document. JSON
/// `null` remains `None`; absent token subtotals are not silently invented.
#[allow(dead_code)]
pub fn parse_call_logs(body: &str) -> Option<Vec<CallLogRow>> {
    let value: Value = serde_json::from_str(body.trim()).ok()?;
    let items = value
        .as_array()
        .or_else(|| value.get("callLogs").and_then(Value::as_array))
        .or_else(|| value.get("data").and_then(Value::as_array))?;
    Some(items.iter().filter_map(parse_call_log_item).collect())
}

fn parse_call_log_item(item: &Value) -> Option<CallLogRow> {
    let text = |key: &str| item.get(key).and_then(Value::as_str).map(str::to_string);
    let tokens = item.get("tokens")?.as_object()?;
    let token = |key: &str| tokens.get(key).and_then(json_i64);

    Some(CallLogRow {
        id: non_empty(&text("id")?)?,
        ts: parse_rfc3339(&text("timestamp")?)?,
        api_key_name: text("apiKeyName"),
        session_tag: text("sessionTag"),
        combo_name: text("comboName"),
        tokens_in: token("in").unwrap_or(0),
        tokens_out: token("out").unwrap_or(0),
        tokens_cache_read: token("cacheRead"),
        tokens_cache_write: token("cacheWrite"),
        tokens_reasoning: token("reasoning"),
        tokens_compressed: token("compressed"),
        raw: item.to_string(),
    })
}

fn json_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
        .or_else(|| value.as_f64().map(|value| value as i64))
}

/// Split a `/api/usage/logs` body into rows, or `None` if it is not one.
///
/// The shipped format is a JSON array of pipe-delimited strings:
///
/// ```text
/// "2026-08-28T09:42:38.861Z | gpt-5.6-sol | CODEX | a@b.c | 19 | 5 | 200"
/// ```
///
/// An array of objects is accepted too. Nothing in OmniRoute 3.8.51 produces
/// one, but the endpoint takes a `format` parameter and the object form is the
/// obvious shape a later build would switch to - and it is the only form that
/// could ever carry a `cost`, so being able to read it is what lets the
/// ledger's `cost_usd` column fill itself if that day comes.
///
/// A single unreadable element is skipped, not fatal: one malformed line must
/// not cost the other three hundred.
pub fn parse_usage_log(body: &str) -> Option<Vec<UsageRow>> {
    let value: Value = serde_json::from_str(body.trim()).ok()?;
    // Some builds wrap the array; look one level down before giving up.
    let items = value
        .as_array()
        .or_else(|| value.get("logs").and_then(Value::as_array))
        .or_else(|| value.get("data").and_then(Value::as_array))?;
    Some(items.iter().filter_map(parse_usage_item).collect())
}

fn parse_usage_item(item: &Value) -> Option<UsageRow> {
    match item {
        Value::String(line) => parse_usage_line(line),
        Value::Object(_) => parse_usage_object(item),
        _ => None,
    }
}

/// One pipe-delimited log line.
///
/// The trailing HTTP status is read and dropped: a `429` is still a request
/// the provider counted, and the ledger's job is to say what went through the
/// router, not to re-judge it.
fn parse_usage_line(line: &str) -> Option<UsageRow> {
    let fields: Vec<&str> = line.split('|').map(str::trim).collect();
    // Six is the useful minimum; the seventh field is the status.
    if fields.len() < 6 {
        return None;
    }
    Some(UsageRow {
        ts: parse_rfc3339(fields[0])?,
        model: non_empty(fields[1])?,
        provider: non_empty(fields[2])?.to_lowercase(),
        account: fields[3].to_string(),
        tokens_in: fields[4].parse().ok()?,
        tokens_out: fields[5].parse().ok()?,
        // The line format has no price. See [`UsageRow::cost_usd`].
        cost_usd: None,
        raw: line.to_string(),
    })
}

/// The object form, read by the field names a later build would plausibly use.
fn parse_usage_object(item: &Value) -> Option<UsageRow> {
    let text = |keys: &[&str]| -> Option<String> {
        keys.iter()
            .find_map(|key| item.get(*key).and_then(Value::as_str))
            .map(str::to_string)
    };
    let number = |keys: &[&str]| -> Option<i64> {
        keys.iter()
            .find_map(|key| item.get(*key))
            .and_then(json_i64)
    };

    let ts = match text(&["timestamp", "ts", "createdAt", "time"]) {
        Some(raw) => parse_rfc3339(&raw)?,
        None => number(&["timestamp", "ts"])?,
    };
    Some(UsageRow {
        ts,
        model: non_empty(&text(&["model", "modelId", "rawModel"])?)?,
        provider: non_empty(&text(&["provider", "providerId"])?)?.to_lowercase(),
        account: text(&["account", "user", "key", "apiKey"]).unwrap_or_default(),
        // Both counts are required, like the line form's `.parse().ok()?`: a
        // request whose cost was never counted - rate-limited, dropped
        // mid-call - is not a "0 tokens" event, and zero is the one number
        // that is certainly wrong for it. Dropped, not fabricated.
        tokens_in: number(&["tokensIn", "promptTokens", "tokens_in", "inputTokens"])?,
        tokens_out: number(&[
            "tokensOut",
            "completionTokens",
            "tokens_out",
            "outputTokens",
        ])?,
        cost_usd: ["cost", "costUsd", "cost_usd"]
            .iter()
            .find_map(|key| item.get(*key))
            .and_then(Value::as_f64),
        raw: item.to_string(),
    })
}

fn non_empty(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn parse_version(body: &str) -> Option<String> {
    let body = body.trim();
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        return ["version", "omnirouteVersion", "appVersion"]
            .iter()
            .find_map(|key| value.get(*key).and_then(Value::as_str))
            .and_then(non_empty);
    }
    non_empty(body).filter(|version| version != "ok")
}

/// `2026-08-28T09:42:38.861Z` to Unix seconds.
///
/// Only the shape OmniRoute emits: UTC, `Z`-suffixed, fractional seconds
/// optional. An offset other than `Z` is refused rather than silently read as
/// UTC - a timestamp an hour out would file requests under the wrong day.
/// The calendar arithmetic itself is [`crate::digest::day_start`]'s, which is
/// the app's one implementation of it.
fn parse_rfc3339(raw: &str) -> Option<i64> {
    let raw = raw.trim();
    let (date, time) = raw.split_once('T').or_else(|| raw.split_once(' '))?;
    let time = time.strip_suffix('Z').or_else(|| time.strip_suffix('z'))?;
    // Drop the fractional part; the ledger's resolution is a second.
    let time = time.split_once('.').map_or(time, |(whole, _)| whole);

    let mut parts = time.split(':');
    let hours: i64 = parts.next()?.parse().ok()?;
    let minutes: i64 = parts.next()?.parse().ok()?;
    let seconds: i64 = parts.next().unwrap_or("0").parse().ok()?;
    if parts.next().is_some()
        || !(0..24).contains(&hours)
        || !(0..60).contains(&minutes)
        // A leap second lands on 60 and is not worth refusing a whole row for.
        || !(0..=60).contains(&seconds)
    {
        return None;
    }
    crate::digest::day_start(date)?.checked_add(hours * 3600 + minutes * 60 + seconds)
}

/// One authenticated `GET` with the usage budget: a bearer token and
/// [`USAGE_TIMEOUT`], because the usage log is a bigger payload than a probe.
///
/// This stays a separate name from [`get`] rather than an `Option<&str>` on
/// the probe path: the probe runs every two minutes on every machine and must
/// never grow a way to accidentally carry a credential.
fn get_usage_authorized(
    addr: SocketAddr,
    path: &str,
    token: &str,
) -> Result<(u16, String), UsageError> {
    get_authorized_classified(addr, path, Some(token), USAGE_TIMEOUT, MAX_USAGE_RESPONSE)
}

fn classify_usage_response(response: (u16, String)) -> Result<Vec<UsageRow>, UsageError> {
    let (status, body) = response;
    match status {
        401 | 403 => Err(UsageError::Unauthorized),
        429 | 503 => Err(UsageError::BusyRateLimited),
        status if is_ok(status) => parse_usage_log(&body).ok_or(UsageError::Unreadable),
        _ => Err(UsageError::Unreadable),
    }
}

fn is_ok(status: u16) -> bool {
    (200..300).contains(&status)
}

/// Start the background probe: once now, then every [`PROBE_INTERVAL`].
///
/// A plain OS thread, like the GitHub poller: the work is a blocking socket
/// read with its own timeout, and it must not sit on the UI runtime.
pub fn start(omni: Arc<OmniRoute>) {
    std::thread::spawn(move || loop {
        omni.probe_once();
        std::thread::sleep(PROBE_INTERVAL);
    });
}

/// Start the usage poller: one read now, then every [`USAGE_INTERVAL`].
///
/// The shape [`crate::queue::start`] and [`crate::budget::start`] settled on -
/// a plain OS thread with exactly one `block_on` at its top - because the work
/// is a blocking socket read followed by a handful of awaited inserts.
///
/// Nothing here can fail in a way a caller would want to hear about. A machine
/// with no router, no management token or a token the router rejects simply
/// never adds a row, and the rest of the app is exactly as it was before this
/// thread existed. The one thing it does say out loud is a change in the
/// authorization verdict, once per transition, because "the ledger is empty
/// because your token is wrong" is worth being able to find in a log.
pub fn start_usage_poll(omni: Arc<OmniRoute>, store: Store) {
    std::thread::spawn(move || {
        let mut was_authorized: Option<bool> = None;
        loop {
            // A router that is not answering at all is not an authorization
            // problem, and probing it here would only duplicate `start`.
            if omni.is_online() {
                let stored = tauri::async_runtime::block_on(ingest_usage_once(&omni, &store));
                let authorized = omni.is_authorized();
                if was_authorized != Some(authorized) {
                    if authorized {
                        eprintln!("projecta: omniroute usage ledger is open");
                    } else {
                        eprintln!(
                            "projecta: omniroute usage is login-gated and the management token \
                             was refused or missing; the ledger stays as it is"
                        );
                    }
                    was_authorized = Some(authorized);
                }
                if stored > 0 {
                    eprintln!("projecta: {stored} new omniroute usage event(s)");
                }
            }
            std::thread::sleep(USAGE_INTERVAL);
        }
    });
}

/// One probe `GET`, returning the status code and body.
///
/// Probe callers only need an answer or no answer, so this compatibility layer
/// deliberately collapses the management error classes exposed by
/// [`get_authorized_classified`].
pub fn get(addr: SocketAddr, path: &str) -> Option<(u16, String)> {
    get_authorized(addr, path, None, PROBE_TIMEOUT, MAX_RESPONSE)
}

/// [`get`], with a bearer token when there is one to send, and the caller's
/// time budget. Existing probe/free-tier callers retain the fail-soft `Option`
/// contract; management usage calls use [`get_authorized_classified`] directly.
pub fn get_authorized(
    addr: SocketAddr,
    path: &str,
    token: Option<&str>,
    budget: Duration,
    cap: usize,
) -> Option<(u16, String)> {
    get_authorized_classified(addr, path, token, budget, cap).ok()
}

fn get_authorized_classified(
    addr: SocketAddr,
    path: &str,
    token: Option<&str>,
    budget: Duration,
    cap: usize,
) -> Result<(u16, String), UsageError> {
    let mut stream = TcpStream::connect_timeout(&addr, budget).map_err(classify_io_error)?;
    stream
        .set_read_timeout(Some(budget))
        .map_err(classify_io_error)?;
    stream
        .set_write_timeout(Some(budget))
        .map_err(classify_io_error)?;

    let authorization = match token {
        Some(token) => format!("Authorization: Bearer {token}\r\n"),
        None => String::new(),
    };
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {addr}\r\nAccept: application/json\r\n\
         {authorization}User-Agent: ProjectA\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(classify_io_error)?;
    stream.flush().map_err(classify_io_error)?;

    let mut raw: Vec<u8> = Vec::with_capacity(1024);
    let mut chunk = [0u8; 4096];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => raw.extend_from_slice(&chunk[..n]),
            Err(error) if is_timeout(&error) => {
                if raw.is_empty() {
                    return Err(UsageError::Timeout);
                }
                break;
            }
            Err(error) => return Err(classify_io_error(error)),
        }
        if raw.len() >= cap {
            break;
        }
    }
    parse_response(&raw).ok_or(UsageError::Unreadable)
}

fn classify_io_error(error: io::Error) -> UsageError {
    if is_timeout(&error) {
        UsageError::Timeout
    } else {
        UsageError::Offline
    }
}

fn is_timeout(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
    )
}

/// Split a raw response into its status code and its body.
///
/// Chunked bodies are reassembled. That is not theoretical tidiness: the
/// management API answers `/api/usage/logs` with `Transfer-Encoding: chunked`,
/// so without this the ledger would only ever see a hex length followed by the
/// first chunk and read every response as unparseable.
pub fn parse_response(raw: &[u8]) -> Option<(u16, String)> {
    let head_end = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = String::from_utf8_lossy(&raw[..head_end]);
    let status = head
        .lines()
        .next()?
        .split_whitespace()
        .nth(1)?
        .parse::<u16>()
        .ok()?;

    let body = &raw[head_end + 4..];
    let chunked = head.lines().skip(1).any(|line| {
        let (name, value) = line.split_once(':').unwrap_or_default();
        name.trim().eq_ignore_ascii_case("transfer-encoding")
            && value.to_ascii_lowercase().contains("chunked")
    });
    let body = if chunked {
        dechunk(body)
    } else {
        body.to_vec()
    };
    Some((status, String::from_utf8_lossy(&body).into_owned()))
}

/// Reassemble a chunked body: `<hex length>CRLF<bytes>CRLF`, until a zero.
///
/// A truncated or malformed stream returns what was recovered before the
/// damage rather than nothing. The caller is about to try to parse it as JSON
/// and will reject a half document on its own; losing a whole response over a
/// missing trailer would be the worse failure.
fn dechunk(mut body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len());
    loop {
        let Some(line_end) = body.windows(2).position(|w| w == b"\r\n") else {
            return out;
        };
        // A chunk length may carry extensions after a semicolon.
        let header = String::from_utf8_lossy(&body[..line_end]);
        let length = header.split(';').next().unwrap_or_default().trim();
        let Ok(length) = usize::from_str_radix(length, 16) else {
            return out;
        };
        if length == 0 {
            return out;
        }
        let start = line_end + 2;
        // Compare without adding: a chunk length is attacker-controlled hex
        // up to `usize::MAX`, and `start + length` wraps past the buffer and
        // back into range. `length > available` says the same thing and
        // cannot overflow.
        let available = body.len().saturating_sub(start);
        if length > available {
            // Truncated by the read cap or the timeout, or a length no
            // address space holds: keep the tail we have.
            out.extend_from_slice(&body[start.min(body.len())..]);
            return out;
        }
        let end = start + length;
        out.extend_from_slice(&body[start..end]);
        // Step over the chunk's own trailing CRLF, when it arrived.
        body = &body[(end + 2).min(body.len())..];
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    /// A throwaway HTTP server that answers a fixed route table.
    ///
    /// Returns the address it bound. The listener moves into the thread and
    /// lives as long as the test process, which is what makes a second request
    /// on the same address work.
    fn serve(routes: Vec<(&'static str, &'static str)>) -> SocketAddr {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind");
        let addr = listener.local_addr().expect("addr");
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut buf = [0u8; 2048];
                let Ok(n) = stream.read(&mut buf) else {
                    continue;
                };
                let head = String::from_utf8_lossy(&buf[..n]).into_owned();
                let path = head
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or_default()
                    .to_string();

                let body = routes
                    .iter()
                    .find(|(route, _)| *route == path)
                    .map(|(_, body)| *body);
                let response = match body {
                    Some(body) => format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
                         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    ),
                    None => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\
                             Connection: close\r\n\r\n"
                        .to_string(),
                };
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });
        addr
    }

    /// A throwaway management API: it answers the route table, but only to a
    /// request carrying the expected bearer token. Anything else gets the
    /// `401` the live router gives, body and all.
    ///
    /// `/healthz` is always open, so [`OmniRoute::probe_once`] can bring the
    /// handle online without a credential - which is the split the real thing
    /// has too: inference and liveness are ungated, `/api/usage/*` is not.
    fn serve_management(
        token: &'static str,
        routes: Vec<(&'static str, &'static str)>,
    ) -> SocketAddr {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind");
        let addr = listener.local_addr().expect("addr");
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut buf = [0u8; 4096];
                let Ok(n) = stream.read(&mut buf) else {
                    continue;
                };
                let head = String::from_utf8_lossy(&buf[..n]).into_owned();
                let path = head
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or_default()
                    .to_string();
                let authorized = head
                    .lines()
                    .any(|line| line.trim() == format!("Authorization: Bearer {token}"));

                let response = if path == "/health" || path == "/healthz" {
                    ok_response("{}")
                } else if !authorized {
                    let body = "{\"error\":{\"code\":\"AUTH_001\",\
                                \"message\":\"Authentication required\"}}";
                    format!(
                        "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\n\
                         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                } else {
                    match routes.iter().find(|(route, _)| *route == path) {
                        Some((_, body)) => ok_response(body),
                        None => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\
                                 Connection: close\r\n\r\n"
                            .to_string(),
                    }
                };
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });
        addr
    }

    fn ok_response(body: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\
             Connection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn serve_status(status: u16, body: &'static str) -> SocketAddr {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind");
        let addr = listener.local_addr().expect("addr");
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut request = [0u8; 2048];
            let _ = stream.read(&mut request);
            let response = format!(
                "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\n\
                 Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).expect("respond");
        });
        addr
    }

    fn serve_stalled() -> SocketAddr {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind");
        let addr = listener.local_addr().expect("addr");
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut request = [0u8; 2048];
            let _ = stream.read(&mut request);
            std::thread::sleep(Duration::from_millis(200));
        });
        addr
    }

    fn fetch_usage_from(addr: SocketAddr, budget: Duration) -> Result<Vec<UsageRow>, UsageError> {
        let response = get_authorized_classified(
            addr,
            USAGE_PATH,
            Some("oma_live_test"),
            budget,
            MAX_USAGE_RESPONSE,
        )?;
        classify_usage_response(response)
    }

    /// Two lines in exactly the shape OmniRoute 3.8.51 answers with, copied
    /// from a live `GET /api/usage/logs`.
    const LIVE_LOG: &str = r#"[
        "2026-08-28T09:42:38.861Z | gpt-5.6-sol | CODEX | user@example.com | 19 | 5 | 200",
        "2026-08-28T09:41:37.536Z | connection-test | KIMI-CODING | a1b2c3d4 | 0 | 0 | 200"
    ]"#;

    /// A live `GET /api/usage/history`, cut down to the fields that matter.
    const LIVE_HISTORY: &str = r#"{"totalRequests":261,"totalCost":42.5,
        "byProvider":{"codex":{"requests":156,"cost":42.5}}}"#;

    async fn ledger() -> (crate::testutil::TempDir, Store) {
        let dir = crate::testutil::TempDir::new("omni-usage");
        let store = Store::open(&dir.path().join("projecta.db"))
            .await
            .expect("open store");
        (dir, store)
    }

    /// An address nothing can be listening on: port 0 is never a listening
    /// port, so the connect fails instantly and identically on both platforms.
    ///
    /// A bound-then-dropped real port is NOT a reliable fixture: on Windows a
    /// SYN to a recently bound (or even never bound) loopback port can be
    /// swallowed instead of answered with RST, so the connect dies on its
    /// timeout and the test asserts the wrong error class (measured on this
    /// machine, 2026-08-30: even a fresh connect to port 9 timed out).
    fn dead_addr() -> SocketAddr {
        SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
    }

    const CALL_LOGS_FIXTURE: &str = include_str!("../testdata/omniroute/call-logs.json");
    const ERROR_401_FIXTURE: &str = include_str!("../testdata/omniroute/error-401.json");

    #[test]
    fn a_malformed_maximum_chunk_length_is_rejected_without_panicking() {
        let result = std::panic::catch_unwind(|| dechunk(b"ffffffffffffffff\r\nABCD"));
        assert!(
            result.is_ok(),
            "a malformed router response must not kill the usage poller thread"
        );
    }

    #[test]
    fn a_health_endpoint_that_answers_two_hundred_is_online() {
        let addr = serve(vec![("/health", "{\"status\":\"ok\"}")]);
        let omni = OmniRoute::new(addr);
        assert!(omni.probe_once());
        assert!(omni.is_online());
    }

    #[test]
    fn a_refused_connection_is_offline() {
        let omni = OmniRoute::new(dead_addr());
        assert!(!omni.probe_once());
        assert!(!omni.is_online());
        assert_eq!(omni.quota_json(), None);
    }

    #[test]
    fn a_router_without_a_health_route_is_still_online_through_the_root() {
        // Only `/` answers; `/health` 404s, which must not read as offline.
        let addr = serve(vec![("/", "{}")]);
        let omni = OmniRoute::new(addr);
        assert!(omni.probe_once());
    }

    #[test]
    fn a_quota_endpoint_is_kept_verbatim_when_it_parses() {
        let addr = serve(vec![
            ("/health", "{}"),
            ("/api/v1/quota", "{\"free_tier\":{\"remaining\":42}}"),
        ]);
        let omni = OmniRoute::new(addr);
        assert!(omni.probe_once());
        let quota = omni.quota_json().expect("quota document");
        assert_eq!(quota["free_tier"]["remaining"], 42);
    }

    #[test]
    fn a_second_candidate_endpoint_is_tried_when_the_first_is_missing() {
        let addr = serve(vec![
            ("/health", "{}"),
            ("/dashboard/api/free-tiers", "[{\"id\":\"a\"}]"),
        ]);
        let omni = OmniRoute::new(addr);
        omni.probe_once();
        let quota = omni.quota_json().expect("quota document");
        assert_eq!(quota[0]["id"], "a");
    }

    #[test]
    fn an_online_router_with_no_quota_route_reports_none() {
        let addr = serve(vec![("/health", "{}")]);
        let omni = OmniRoute::new(addr);
        assert!(omni.probe_once());
        assert_eq!(omni.quota_json(), None);
    }

    #[test]
    fn the_probe_keeps_an_optional_version_from_a_management_shape() {
        let addr = serve(vec![
            ("/healthz", "ok"),
            ("/api/version", "{\"version\":\"3.8.49\"}"),
        ]);
        let omni = OmniRoute::new(addr);

        assert!(omni.probe_once());
        assert_eq!(omni.omniroute_version(), Some("3.8.49".to_string()));
    }

    #[test]
    fn a_quota_route_that_answers_html_is_ignored() {
        let addr = serve(vec![
            ("/health", "{}"),
            ("/api/v1/quota", "<!doctype html><p>nope</p>"),
        ]);
        let omni = OmniRoute::new(addr);
        assert!(omni.probe_once());
        assert_eq!(omni.quota_json(), None, "HTML is not a quota document");
    }

    #[test]
    fn going_offline_keeps_the_last_quota_document() {
        let addr = serve(vec![("/health", "{}"), ("/api/v1/quota", "{\"left\":1}")]);
        let omni = OmniRoute::new(addr);
        omni.probe_once();
        assert!(omni.quota_json().is_some());

        // Same struct, pointed at nothing: offline, but the numbers survive.
        let offline = OmniRoute::new(dead_addr());
        if let Ok(mut slot) = offline.quota.lock() {
            *slot = omni.quota_json();
        }
        offline.online.store(true, Ordering::Relaxed);
        assert!(!offline.probe_once());
        assert!(offline.quota_json().is_some());
    }

    #[test]
    fn the_default_probe_points_at_the_omniroute_port() {
        let omni = OmniRoute::default();
        assert_eq!(omni.addr().port(), DEFAULT_PORT);
        assert!(omni.addr().ip().is_loopback());
        assert!(!omni.is_online(), "nothing has been probed yet");
    }

    #[test]
    fn responses_are_split_into_a_status_and_a_body() {
        let raw = b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n";
        assert_eq!(parse_response(raw), Some((204, String::new())));

        let raw = b"HTTP/1.1 200 OK\r\nX: y\r\n\r\n{\"a\":1}";
        assert_eq!(parse_response(raw), Some((200, "{\"a\":1}".to_string())));

        // A body with no head, and a head with no status code.
        assert_eq!(parse_response(b"{\"a\":1}"), None);
        assert_eq!(parse_response(b"garbage\r\n\r\n"), None);
    }

    #[test]
    fn a_chunked_body_is_reassembled() {
        // What the management API actually sends: OmniRoute answers
        // /api/usage/logs with Transfer-Encoding: chunked.
        let raw = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n\
                    4\r\n[\"a\"\r\n1\r\n]\r\n0\r\n\r\n";
        assert_eq!(parse_response(raw), Some((200, "[\"a\"]".to_string())));

        // Header name and value are both matched case insensitively, and a
        // chunk extension after the length is stepped over.
        let raw = b"HTTP/1.1 200 OK\r\ntransfer-encoding: CHUNKED\r\n\r\n\
                    3;x=y\r\nabc\r\n0\r\n\r\n";
        assert_eq!(parse_response(raw), Some((200, "abc".to_string())));

        // A stream cut off mid-flight keeps what arrived; the caller's JSON
        // parse is what rejects a half document.
        let raw = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n\
                    ff\r\nabc";
        assert_eq!(parse_response(raw), Some((200, "abc".to_string())));

        // Without the header the body is taken as it is, hex-looking or not.
        let raw = b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\n5\r\nab";
        assert_eq!(parse_response(raw), Some((200, "5\r\nab".to_string())));
    }

    #[test]
    fn a_chunked_usage_log_is_read_end_to_end() {
        let body = LIVE_LOG.replace('\n', "");
        let raw = format!(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{body}\r\n0\r\n\r\n",
            body.len()
        );
        let (status, decoded) = parse_response(raw.as_bytes()).expect("a response");
        assert_eq!(status, 200);
        assert_eq!(parse_usage_log(&decoded).map(|rows| rows.len()), Some(2));
    }

    #[test]
    fn only_two_hundreds_count_as_reachable() {
        assert!(is_ok(200));
        assert!(is_ok(204));
        assert!(!is_ok(199));
        assert!(!is_ok(301));
        assert!(!is_ok(404));
        assert!(!is_ok(503));
    }

    // -- the usage ledger (Phase 19 T3) ------------------------------------

    #[test]
    fn the_live_call_logs_fixture_preserves_attribution_and_tokens() {
        let rows = parse_call_logs(CALL_LOGS_FIXTURE).expect("a call-logs document");
        assert_eq!(rows.len(), 5, "every fixture object must survive");

        let first = &rows[0];
        assert_eq!(first.id, "1788125098645-449");
        assert_eq!(first.ts, 1_788_125_098);
        assert_eq!(first.api_key_name, None);
        assert_eq!(first.session_tag, None);
        assert_eq!(first.combo_name, None);
        assert_eq!(first.tokens_in, 0);
        assert_eq!(first.tokens_out, 0);
        assert_eq!(first.tokens_cache_read, None);
        assert_eq!(first.tokens_cache_write, None);
        assert_eq!(first.tokens_reasoning, None);
        assert_eq!(first.tokens_compressed, None);

        assert!(rows.iter().all(|row| !row.id.is_empty()));
        assert!(rows.iter().all(|row| row.ts > 1_700_000_000));
    }

    #[test]
    fn a_live_log_line_is_read_into_a_row() {
        let rows = parse_usage_log(LIVE_LOG).expect("a usage document");
        assert_eq!(rows.len(), 2);

        let first = &rows[0];
        // 2026-08-28T09:42:38Z. The milliseconds are dropped on purpose.
        assert_eq!(first.ts, 1_787_910_158);
        assert_eq!(first.model, "gpt-5.6-sol");
        assert_eq!(
            first.provider, "codex",
            "the log shouts, the ledger does not"
        );
        assert_eq!(first.account, "user@example.com");
        assert_eq!(first.tokens_in, 19);
        assert_eq!(first.tokens_out, 5);
        assert_eq!(first.cost_usd, None, "the line format carries no price");
        assert!(first.raw.contains("gpt-5.6-sol"), "the source line is kept");
    }

    #[test]
    fn an_unreadable_line_costs_only_itself() {
        let body = r#"["nonsense", "a | b | c", 42,
            "2026-08-28T09:42:38.861Z | m | P | who | 1 | 2 | 200",
            "not-a-date | m | P | who | 1 | 2 | 200",
            "2026-08-28T09:42:38.861Z | m | P | who | lots | 2 | 200"]"#;
        let rows = parse_usage_log(body).expect("a usage document");
        assert_eq!(
            rows.len(),
            1,
            "only the well formed line survives: {rows:?}"
        );
        assert_eq!(rows[0].model, "m");
    }

    #[test]
    fn a_body_that_is_not_a_log_is_not_a_log() {
        assert_eq!(parse_usage_log("<!doctype html>"), None);
        assert_eq!(parse_usage_log("{\"error\":\"nope\"}"), None);
        assert_eq!(parse_usage_log(""), None);
        // An empty log is a document, and an empty one - not a failure.
        assert_eq!(parse_usage_log("[]"), Some(Vec::new()));
    }

    #[test]
    fn the_object_form_is_read_too_including_its_price() {
        // Nothing ships this shape today; it is the one that could carry cost.
        let body = r#"[{"timestamp":"2026-08-28T09:42:38Z","model":"gpt-5.6-sol",
            "provider":"Codex","user":"a@b.c","promptTokens":19,"completionTokens":5,
            "cost":0.0042}]"#;
        let rows = parse_usage_log(body).expect("a usage document");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].tokens_in, 19);
        assert_eq!(rows[0].tokens_out, 5);
        assert_eq!(rows[0].cost_usd, Some(0.0042));
        assert_eq!(rows[0].provider, "codex");
    }

    #[test]
    fn an_object_without_token_counts_is_not_fabricated_as_zero() {
        // A failed request - rate-limited or dropped mid-call - that OmniRoute
        // logs without token counts must not arrive as a "0 tokens" event.
        // Zero is the one number that is certainly wrong for a request whose
        // cost was never counted, and the line form already refuses such a
        // row (`.parse().ok()?` returns `None`). The object form must behave
        // the same: drop what cannot be counted, never invent a zero.
        let body = r#"[{"timestamp":"2026-08-28T09:42:38Z","model":"gpt-5.6-sol",
            "provider":"Codex","user":"a@b.c","error":"rate_limited"}]"#;
        let rows = parse_usage_log(body).expect("a usage document");
        assert!(
            rows.is_empty(),
            "a row without token counts must not become a fabricated zero"
        );
    }

    #[test]
    fn a_wrapped_array_is_still_an_array() {
        let body = format!("{{\"logs\":{LIVE_LOG}}}");
        assert_eq!(parse_usage_log(&body).map(|rows| rows.len()), Some(2));
    }

    #[test]
    fn timestamps_are_read_as_utc_or_not_at_all() {
        assert_eq!(parse_rfc3339("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339("1970-01-02T00:00:01Z"), Some(86_401));
        assert_eq!(
            parse_rfc3339("2026-08-28T09:42:38.861Z"),
            Some(1_787_910_158)
        );
        // No fractional part, and a lowercase suffix, are both fine.
        assert_eq!(parse_rfc3339("2026-08-28T09:42:38z"), Some(1_787_910_158));

        // An offset that is not UTC would file the row under the wrong day.
        assert_eq!(parse_rfc3339("2026-08-28T09:42:38+02:00"), None);
        assert_eq!(parse_rfc3339("2026-08-28T09:42:38"), None);
        assert_eq!(parse_rfc3339("2026-02-31T00:00:00Z"), None, "no such day");
        assert_eq!(parse_rfc3339("2026-08-28T25:00:00Z"), None);
        assert_eq!(parse_rfc3339(""), None);
    }

    #[test]
    fn a_huge_year_in_a_foreign_log_line_is_dropped_without_overflowing() {
        // `fields[0]` of a pipe-delimited line feeds `parse_rfc3339`, which
        // calls `day_start` unbounded - the same path a huge chunk length takes
        // to `dechunk`. A year the i64 parser accepts but whose day arithmetic
        // overflows must not panic the usage poller; the row is refused, not a
        // crash.
        let bad = "25252734927766801-01-01T00:00:00Z | gpt-5.6-sol | CODEX | a@b.c | 19 | 5 | 200";
        let result = std::panic::catch_unwind(|| parse_usage_log(&format!("[{bad:?}]")));
        assert!(
            result.is_ok(),
            "a huge year in a foreign timestamp must not kill the usage poller"
        );
    }

    #[test]
    fn the_dedup_id_is_a_stable_function_of_the_line() {
        let line = "2026-08-28T09:42:38.861Z | gpt-5.6-sol | CODEX | a@b.c | 19 | 5 | 200";
        assert_eq!(usage_event_id(line), usage_event_id(line));
        assert_ne!(
            usage_event_id(line),
            usage_event_id(&line.replace("19", "20"))
        );
        // Pinned, because this value is a database key: changing the hash
        // would silently re-import every row the ledger already holds.
        assert_eq!(usage_event_id(""), "ue-cbf29ce484222325");
        assert_eq!(usage_event_id("a"), "ue-af63dc4c8601ec8c");
    }

    #[test]
    fn a_usage_line_status_is_the_trailing_http_code() {
        assert_eq!(
            usage_line_http_status(
                "2026-08-28T09:42:38.861Z | gpt-5.6-sol | CODEX | a@b.c | 19 | 5 | 400"
            ),
            Some(400)
        );
        assert_eq!(usage_line_http_status("{\"tokens\":1}"), None);
    }

    #[test]
    fn a_usage_line_without_the_status_column_is_not_a_chat_failure() {
        // Six fields: the trailing number is the token count, not an HTTP
        // status. Parsing it as one would invent a client failure.
        let line = "2026-08-28T09:42:38.861Z | gpt-5.6-sol | CODEX | a@b.c | 19 | 400";
        assert_eq!(usage_line_http_status(line), None);
    }

    // -- auth --------------------------------------------------------------

    #[test]
    fn a_handle_with_no_token_never_reaches_the_wire() {
        let addr = serve_management("oma_live_good", vec![(USAGE_PATH, LIVE_LOG)]);
        let omni = OmniRoute::new(addr);
        assert!(omni.probe_once(), "liveness is not gated");

        assert!(!omni.login(), "there is nothing to log in with");
        assert!(!omni.is_authorized());
        assert_eq!(omni.fetch_usage(), Err(UsageError::Unauthorized));
        // The point of the phase: no token degrades to exactly today.
        assert!(omni.is_online());
    }

    #[test]
    fn the_management_token_opens_the_log() {
        let addr = serve_management(
            "oma_live_good",
            vec![(USAGE_PATH, LIVE_LOG), (USAGE_HISTORY_PATH, LIVE_HISTORY)],
        );
        let omni = OmniRoute::new(addr);
        omni.set_token(Some("oma_live_good"));

        assert!(omni.login());
        assert!(omni.is_authorized());
        let rows = omni.fetch_usage().expect("the log");
        assert_eq!(rows.len(), 2);
        // The history is picked up on the same beat, verbatim.
        let history = omni.usage_history().expect("a history document");
        assert_eq!(history["totalRequests"], 261);
        assert_eq!(history["totalCost"], 42.5);
    }

    #[test]
    fn a_rejected_token_degrades_instead_of_failing() {
        let addr = serve_management("oma_live_good", vec![(USAGE_PATH, LIVE_LOG)]);
        let omni = OmniRoute::new(addr);
        omni.set_token(Some("oma_live_stale"));
        assert!(omni.probe_once());

        assert!(!omni.login(), "the router said 401");
        assert!(!omni.is_authorized());
        assert_eq!(omni.fetch_usage(), Err(UsageError::Unauthorized));
        assert_eq!(omni.usage_history(), None);
        // Everything the app depended on before the ledger existed is intact.
        assert!(omni.is_online());
        assert!(omni.probe_once());
    }

    #[test]
    fn a_replaced_token_is_checked_again() {
        let addr = serve_management("oma_live_good", vec![(USAGE_PATH, LIVE_LOG)]);
        let omni = OmniRoute::new(addr);
        omni.set_token(Some("oma_live_good"));
        assert!(omni.login());

        omni.set_token(Some("oma_live_stale"));
        assert!(!omni.is_authorized(), "a new token starts unverified");
        assert!(!omni.login());

        omni.set_token(Some("oma_live_good"));
        assert!(omni.login(), "and back again");

        // Whitespace and emptiness are both "no token".
        omni.set_token(Some("   "));
        assert!(!omni.login());
        omni.set_token(None);
        assert!(!omni.login());
    }

    #[tokio::test]
    async fn a_build_without_the_history_route_still_fills_the_ledger() {
        // `login` reads the history document, but a 404 there is a missing
        // endpoint, not a refused credential - the ledger must not depend on
        // OmniRoute keeping that particular route.
        let addr = serve_management("oma_live_good", vec![(USAGE_PATH, LIVE_LOG)]);
        let omni = OmniRoute::new(addr);
        omni.set_token(Some("oma_live_good"));

        assert!(omni.login());
        assert!(omni.is_authorized());
        assert_eq!(omni.usage_history(), None, "there was none to cache");

        let (_dir, store) = ledger().await;
        assert_eq!(ingest_usage_once(&omni, &store).await, 2);
    }

    #[test]
    fn a_router_that_is_not_there_is_offline_not_unauthorized() {
        let omni = OmniRoute::new(dead_addr());
        omni.set_token(Some("oma_live_good"));
        assert_eq!(omni.fetch_usage(), Err(UsageError::Offline));
        assert!(!omni.login());
    }

    #[test]
    fn management_failures_keep_their_http_and_network_classes() {
        for status in [401, 403] {
            let addr = serve_status(status, ERROR_401_FIXTURE);
            assert_eq!(
                fetch_usage_from(addr, Duration::from_millis(100)),
                Err(UsageError::Unauthorized)
            );
        }
        for status in [429, 503] {
            let addr = serve_status(status, "{}");
            assert_eq!(
                fetch_usage_from(addr, Duration::from_millis(100)),
                Err(UsageError::BusyRateLimited)
            );
        }

        let addr = serve_stalled();
        assert_eq!(
            fetch_usage_from(addr, Duration::from_millis(20)),
            Err(UsageError::Timeout)
        );
        assert_eq!(
            fetch_usage_from(dead_addr(), Duration::from_millis(20)),
            Err(UsageError::Offline)
        );
    }

    #[test]
    fn a_route_that_answers_something_else_is_unreadable() {
        let addr = serve_management("oma_live_good", vec![(USAGE_PATH, "<!doctype html>")]);
        let omni = OmniRoute::new(addr);
        omni.set_token(Some("oma_live_good"));
        assert_eq!(omni.fetch_usage(), Err(UsageError::Unreadable));
    }

    // -- the ledger --------------------------------------------------------

    #[tokio::test]
    async fn a_poll_fills_the_ledger_and_a_second_one_adds_nothing() {
        let addr = serve_management(
            "oma_live_good",
            vec![(USAGE_PATH, LIVE_LOG), (USAGE_HISTORY_PATH, LIVE_HISTORY)],
        );
        let omni = OmniRoute::new(addr);
        omni.set_token(Some("oma_live_good"));
        let (_dir, store) = ledger().await;

        assert_eq!(ingest_usage_once(&omni, &store).await, 2);
        let rows = store.list_usage_events(None, None).await.unwrap();
        assert_eq!(rows.len(), 2);
        // Newest first, and the numbers came through the parse intact.
        assert_eq!(rows[0].model, "gpt-5.6-sol");
        assert_eq!(rows[0].tokens_in, 19);
        assert_eq!(rows[0].provider, "codex");
        assert_eq!(rows[0].cost_usd, None);

        // The log is a ring buffer: the next pass sees the same two lines.
        assert_eq!(
            ingest_usage_once(&omni, &store).await,
            0,
            "the same rows must not be stored twice"
        );
        assert_eq!(store.list_usage_events(None, None).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn a_gated_router_leaves_the_ledger_exactly_as_it_was() {
        let addr = serve_management(
            "oma_live_good",
            vec![(USAGE_PATH, LIVE_LOG), (USAGE_HISTORY_PATH, LIVE_HISTORY)],
        );
        let omni = OmniRoute::new(addr);
        let (_dir, store) = ledger().await;

        omni.set_token(Some("oma_live_good"));
        assert_eq!(ingest_usage_once(&omni, &store).await, 2);

        // The token is rotated out from under us, which is the 401 path.
        omni.set_token(Some("oma_live_stale"));
        assert_eq!(ingest_usage_once(&omni, &store).await, 0);
        assert!(!omni.is_authorized());
        assert_eq!(
            store.list_usage_events(None, None).await.unwrap().len(),
            2,
            "a 401 must not empty a ledger that was already filled"
        );

        // And with no router at all.
        let offline = OmniRoute::new(dead_addr());
        offline.set_token(Some("oma_live_good"));
        assert_eq!(ingest_usage_once(&offline, &store).await, 0);
    }

    #[tokio::test]
    async fn the_ledger_totals_what_the_router_reported() {
        let addr = serve_management(
            "oma_live_good",
            vec![(USAGE_PATH, LIVE_LOG), (USAGE_HISTORY_PATH, LIVE_HISTORY)],
        );
        let omni = OmniRoute::new(addr);
        omni.set_token(Some("oma_live_good"));
        let (_dir, store) = ledger().await;
        ingest_usage_once(&omni, &store).await;

        let totals = store.usage_totals(None).await.unwrap();
        assert_eq!(totals.requests, 2);
        assert_eq!(totals.tokens_in, 19);
        assert_eq!(totals.tokens_out, 5);
        assert_eq!(
            totals.priced, 0,
            "the line format prices nothing, so neither does the ledger"
        );
    }

    #[test]
    fn twenty_healthz_probes_against_a_fake_router_all_succeed() {
        let addr = serve(vec![("/healthz", "ok")]);
        let omni = OmniRoute::new(addr);
        let mut ok = 0;
        for _ in 0..20 {
            if omni.probe_once() {
                ok += 1;
            }
        }
        assert_eq!(ok, 20);
    }

    #[tokio::test]
    async fn reported_cost_comes_from_history_and_equal_totals_are_not_a_cheap_win() {
        // OmniRoute's line log still has no cost_usd (see omniroute_live).
        // Dollars come from /api/usage/history totalCost via usage_report.
        const CHEAP_HISTORY: &str = r#"{"totalRequests":20,"totalCost":12.5}"#;
        const RELIABLE_HISTORY: &str = r#"{"totalRequests":20,"totalCost":40.0}"#;

        async fn cost_from(history: &'static str) -> f64 {
            let addr = serve_management(
                "oma_live_good",
                vec![(USAGE_PATH, LIVE_LOG), (USAGE_HISTORY_PATH, history)],
            );
            let omni = OmniRoute::new(addr);
            omni.set_token(Some("oma_live_good"));
            assert!(omni.login());
            let (_dir, store) = ledger().await;
            usage_report(&omni, &store, 50, 1_700_000_000)
                .await
                .unwrap()
                .reported_cost_usd
                .expect("history dollars")
        }

        let cheap = cost_from(CHEAP_HISTORY).await;
        let reliable = cost_from(RELIABLE_HISTORY).await;
        let same = cost_from(CHEAP_HISTORY).await;
        assert!(cheap_beats_reliable(cheap, reliable));
        assert!(!cheap_beats_reliable(same, cheap));
        assert!(!cheap_beats_reliable(reliable, cheap));
        assert!(!cheap_beats_reliable(f64::NAN, reliable));
    }

    #[test]
    fn cheap_beats_reliable_is_a_strict_finite_drop() {
        assert!(cheap_beats_reliable(12.5, 40.0));
        assert!(!cheap_beats_reliable(12.5, 12.5));
        assert!(!cheap_beats_reliable(40.0, 12.5));
        assert!(!cheap_beats_reliable(f64::NAN, 1.0));
        assert!(!cheap_beats_reliable(1.0, f64::INFINITY));
    }

    /// The live check behind every claim in this module's documentation.
    ///
    /// Ignored by default: it needs a real OmniRoute on the default port and a
    /// real management token, neither of which a checkout has. Run it against
    /// one with
    ///
    /// ```text
    /// OMNIROUTE_TOKEN=oma_live_… cargo test -- --ignored omniroute_live
    /// ```
    ///
    /// It asserts the two things the parser depends on and nothing about the
    /// numbers, which are whatever that machine has been doing.
    #[tokio::test]
    #[ignore = "needs a live OmniRoute and a management token"]
    async fn omniroute_live_answers_the_shape_this_module_parses() {
        let Ok(token) = std::env::var("OMNIROUTE_TOKEN") else {
            panic!("set OMNIROUTE_TOKEN to run this");
        };
        let omni = OmniRoute::default();
        assert!(omni.probe_once(), "no router on the default port");
        omni.set_token(Some(&token));
        assert!(omni.login(), "the management api refused the token");

        let rows = omni.fetch_usage().expect("the usage log");
        assert!(!rows.is_empty(), "the live log was empty");
        for row in &rows {
            assert!(row.ts > 1_700_000_000, "a timestamp that parsed: {row:?}");
            assert!(!row.model.is_empty());
            assert!(!row.provider.is_empty());
        }
        // The verified gap, asserted so a build that closes it fails loudly
        // here instead of quietly leaving `cost_usd` empty forever.
        assert!(
            rows.iter().all(|row| row.cost_usd.is_none()),
            "the log started carrying prices - the ledger can use them now"
        );

        let (_dir, store) = ledger().await;
        let first = ingest_usage_once(&omni, &store).await;
        assert_eq!(first, rows.len(), "every row was new to an empty ledger");
        assert_eq!(
            ingest_usage_once(&omni, &store).await,
            0,
            "the second pass re-read the same ring buffer"
        );
    }

    #[test]
    fn a_resolved_model_is_left_unattributed() {
        // The verified limit: OmniRoute logs the model it resolved to, and no
        // profile pins `gpt-5.6-sol`, so there is nobody to bill it to.
        assert_eq!(attribute("gpt-5.6-sol"), None);
        assert_eq!(attribute(""), None);
    }
}
