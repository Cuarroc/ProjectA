//! Quota awareness: which agent profiles can still be spawned.
//!
//! A worker stops for many reasons; running out of credit is the one the user
//! can do nothing about from inside the terminal. It is also not a property of
//! the worker at all - the account behind `claude` is shared by every worker
//! running `claude`, so the moment one of them prints "credit balance is too
//! low" the others are finished too.
//!
//! Hence a tracker keyed by *profile*, fed from the status engine's output
//! heuristics: a quota line blocks the profile, and the next chunk of ordinary
//! activity from any of its workers clears it again. The in-memory map is the
//! source of truth; every change is mirrored to the `agent_quota` table through
//! a [`QuotaSink`] so a restart starts where the last session left off.
//!
//! [`QuotaTracker`] is the shared struct Phase 4's control API will read for
//! `GET /api/quota`; nothing here is Tauri-specific.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::omniroute::OmniRoute;
use crate::store::{now_unix_secs, AgentQuota, QUOTA_BLOCKED, QUOTA_OK};

/// Keep the stored reason readable without letting a redrawn TUI frame turn
/// into a database row of its own.
const MAX_REASON: usize = 200;

/// One profile's row in the `get_quota_state` reply.
///
/// Serialized as `{ "profileId", "state", "blockedUntil", "reason",
/// "omniRouteOnline" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaStateRow {
    pub profile_id: String,
    /// `ok`, `blocked` or `unknown`.
    pub state: String,
    /// Unix seconds at which the block lifts, or `null` when open-ended.
    pub blocked_until: Option<i64>,
    pub reason: Option<String>,
    /// Whether the local OmniRoute router answered its last probe. Repeated on
    /// every row: it is one fact about the machine, and the frontend reads the
    /// rows one at a time.
    pub omni_route_online: bool,
}

/// Where quota changes are persisted. The app writes them to SQLite; tests
/// record them.
pub trait QuotaSink: Send + Sync {
    fn persist(&self, quota: AgentQuota);
}

/// The quota map. Cheap to share: register it once as Tauri state and hand
/// `Arc` clones to the status engine and to whatever else needs to ask.
pub struct QuotaTracker {
    rows: Mutex<HashMap<String, AgentQuota>>,
    sink: Mutex<Option<Arc<dyn QuotaSink>>>,
    omni: Arc<OmniRoute>,
}

impl Default for QuotaTracker {
    fn default() -> Self {
        Self::new(Arc::new(OmniRoute::default()))
    }
}

impl QuotaTracker {
    pub fn new(omni: Arc<OmniRoute>) -> Self {
        Self {
            rows: Mutex::new(HashMap::new()),
            sink: Mutex::new(None),
            omni,
        }
    }

    /// Install the destination for quota changes. Set once at startup.
    ///
    /// A slot replace can never leave `sink` half-written, so a poisoned lock
    /// is taken over rather than silently keeping the tracker mute (W1-15).
    pub fn set_sink(&self, sink: Arc<dyn QuotaSink>) {
        *self
            .sink
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = Some(sink);
    }

    /// Seed the map from the database at startup. Nothing is persisted back:
    /// these rows came from there.
    pub fn hydrate(&self, rows: Vec<AgentQuota>) {
        let mut map = self
            .rows
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        for row in rows {
            map.insert(row.profile_id.clone(), row);
        }
    }

    /// The router handle this tracker reports on. [`crate::providers`] pushes
    /// the stored API keys at it once the user has typed one in.
    pub fn omni_route(&self) -> &Arc<OmniRoute> {
        &self.omni
    }

    /// Record that the provider refused this profile.
    ///
    /// `blocked_until` is the unix second the block lifts; pass `None` whenever
    /// the message did not say, which is nearly always - agents word their
    /// reset times for humans ("resets at 3pm"), not for parsers.
    pub fn note_blocked(&self, profile_id: &str, reason: &str, blocked_until: Option<i64>) {
        let reason = clamp_reason(reason);
        self.write(profile_id, |row| {
            row.state = QUOTA_BLOCKED.to_string();
            row.reason = reason;
            row.blocked_until = blocked_until;
        });
    }

    /// Record that the profile is working again.
    ///
    /// Called for every chunk of ordinary agent output, so it has to be cheap
    /// and quiet: an already-`ok` profile is left exactly as it was, and
    /// nothing reaches the sink.
    pub fn note_ok(&self, profile_id: &str) {
        self.write(profile_id, |row| {
            row.state = QUOTA_OK.to_string();
            row.reason = None;
            row.blocked_until = None;
        });
    }

    /// Apply `edit` and persist, but only if it actually changed something.
    fn write<F>(&self, profile_id: &str, edit: F)
    where
        F: FnOnce(&mut AgentQuota),
    {
        let changed = {
            // `note_blocked`/`note_ok` used to be silently dropped on a
            // poisoned map: the profile would stay `blocked` (or wrongly
            // `ok`) forever with nothing on stderr to say why (W1-15). The
            // edit below only ever inserts-or-mutates one row, so a poisoned
            // map is taken over instead of skipped. `note_ok` runs on every
            // chunk of ordinary output, so the log fires once per process
            // rather than once per chunk.
            static ROWS_POISON_LOGGED: AtomicBool = AtomicBool::new(false);
            let mut rows = self.rows.lock().unwrap_or_else(|poison| {
                if !ROWS_POISON_LOGGED.swap(true, Ordering::Relaxed) {
                    eprintln!("projecta: quota row map was poisoned; recovering (further occurrences are not logged)");
                }
                poison.into_inner()
            });
            let row = rows
                .entry(profile_id.to_string())
                .or_insert_with(|| AgentQuota::unknown(profile_id));
            let before = row.clone();
            edit(row);
            // `updated_at` is not part of the comparison, or every chunk of
            // output would count as a change.
            if same_facts(&before, row) {
                None
            } else {
                row.updated_at = now_unix_secs();
                Some(row.clone())
            }
        };

        // Outside the lock: the sink writes to SQLite, and the caller is the
        // PTY reader thread.
        let Some(row) = changed else { return };
        let sink = self
            .sink
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone();
        if let Some(sink) = sink {
            sink.persist(row);
        }
    }

    /// One profile's row, or `None` if nothing has been observed about it.
    ///
    /// [`QuotaTracker::snapshot`] is how the app asks - it answers for every
    /// profile at once, which is what both the command and Phase 4's endpoint
    /// want. This one is for a caller that has to look at a single profile's
    /// reason before writing to it: [`crate::budget`] releases only the blocks
    /// it wrote itself, and telling those apart means reading the row.
    pub fn state_of(&self, profile_id: &str) -> Option<AgentQuota> {
        self.rows
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .get(profile_id)
            .cloned()
    }

    /// A poisoned map is taken over rather than answered as "not blocked"
    /// (W1-15): the read that used to shortcut through `.ok()` could let a
    /// genuinely blocked profile straight through the budget gate.
    pub fn is_blocked(&self, profile_id: &str) -> bool {
        self.rows
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .get(profile_id)
            .is_some_and(|row| row.state == QUOTA_BLOCKED)
    }

    /// The `get_quota_state` payload: one row per profile in `profile_ids`,
    /// defaulting to `unknown`, plus any profile that has a row but is no
    /// longer in the list - a profile dropped from `agents.json` while blocked
    /// is exactly the case the user needs to see.
    pub fn snapshot(&self, profile_ids: &[String]) -> Vec<QuotaStateRow> {
        let online = self.omni.is_online();
        // A read-only snapshot of the recovered map is still a truthful
        // answer under poison; reporting every profile as `unknown` instead
        // (the old `.ok()` shortcut) would hide a real block from the UI.
        let rows = self
            .rows
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let known = |id: &str| -> AgentQuota {
            rows.get(id)
                .cloned()
                .unwrap_or_else(|| AgentQuota::unknown(id))
        };

        let mut out: Vec<QuotaStateRow> = profile_ids
            .iter()
            .map(|id| row_of(&known(id), online))
            .collect();

        let mut extra: Vec<String> = rows
            .keys()
            .filter(|id| !profile_ids.iter().any(|known| known == *id))
            .cloned()
            .collect();
        extra.sort();
        out.extend(extra.iter().map(|id| row_of(&known(id), online)));
        out
    }
}

fn row_of(quota: &AgentQuota, omni_route_online: bool) -> QuotaStateRow {
    QuotaStateRow {
        profile_id: quota.profile_id.clone(),
        state: quota.state.clone(),
        blocked_until: quota.blocked_until,
        reason: quota.reason.clone(),
        omni_route_online,
    }
}

/// Everything except the timestamp: two rows with the same facts are the same
/// row as far as persisting goes.
fn same_facts(a: &AgentQuota, b: &AgentQuota) -> bool {
    a.state == b.state && a.blocked_until == b.blocked_until && a.reason == b.reason
}

/// Trim a matched line down to something worth storing. An empty line carries
/// no information and is stored as no reason at all.
fn clamp_reason(reason: &str) -> Option<String> {
    let reason = reason.trim();
    if reason.is_empty() {
        return None;
    }
    if reason.chars().count() <= MAX_REASON {
        return Some(reason.to_string());
    }
    let mut clamped: String = reason.chars().take(MAX_REASON).collect();
    clamped.push('\u{2026}');
    Some(clamped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    use crate::store::QUOTA_UNKNOWN;

    #[derive(Default)]
    struct Recorder {
        persisted: Mutex<Vec<AgentQuota>>,
    }

    impl Recorder {
        fn states(&self) -> Vec<String> {
            self.persisted
                .lock()
                .unwrap()
                .iter()
                .map(|q| q.state.clone())
                .collect()
        }
    }

    impl QuotaSink for Recorder {
        fn persist(&self, quota: AgentQuota) {
            self.persisted.lock().unwrap().push(quota);
        }
    }

    fn tracker() -> (QuotaTracker, Arc<Recorder>) {
        let tracker = QuotaTracker::default();
        let recorder = Arc::new(Recorder::default());
        tracker.set_sink(recorder.clone());
        (tracker, recorder)
    }

    /// A router that answers, so `omniRouteOnline` can be asserted as true.
    fn online_tracker() -> QuotaTracker {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind");
        let addr = listener.local_addr().expect("addr");
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                use std::io::{Read, Write};
                let Ok(mut stream) = stream else { continue };
                // Drain the request before answering: closing a socket that
                // still holds unread bytes resets the connection on Windows,
                // and the reset throws away the reply along with it.
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                );
                let _ = stream.flush();
            }
        });
        let omni = Arc::new(OmniRoute::new(addr));
        omni.probe_once();
        QuotaTracker::new(omni)
    }

    #[test]
    fn an_unseen_profile_is_unknown() {
        let (tracker, recorder) = tracker();
        assert_eq!(tracker.state_of("claude"), None);
        assert!(!tracker.is_blocked("claude"));

        let rows = tracker.snapshot(&["claude".to_string(), "kimi".to_string()]);
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|r| r.state == QUOTA_UNKNOWN));
        assert!(rows.iter().all(|r| r.reason.is_none()));
        assert!(rows.iter().all(|r| r.blocked_until.is_none()));
        assert!(recorder.states().is_empty(), "reading persists nothing");
    }

    #[test]
    fn blocking_a_profile_records_the_line_that_said_so() {
        let (tracker, recorder) = tracker();
        tracker.note_blocked("claude", "  Claude usage limit reached.  ", None);

        let row = tracker.state_of("claude").expect("row");
        assert_eq!(row.state, QUOTA_BLOCKED);
        assert_eq!(row.reason.as_deref(), Some("Claude usage limit reached."));
        assert!(row.blocked_until.is_none());
        assert!(tracker.is_blocked("claude"));
        assert_eq!(recorder.states(), vec![QUOTA_BLOCKED]);
    }

    #[test]
    fn activity_on_a_blocked_profile_resets_it_to_ok() {
        let (tracker, recorder) = tracker();
        tracker.note_blocked("claude", "credit balance is too low", Some(42));
        tracker.note_ok("claude");

        let row = tracker.state_of("claude").expect("row");
        assert_eq!(row.state, QUOTA_OK);
        assert!(row.reason.is_none(), "a stale reason would still be shown");
        assert!(row.blocked_until.is_none());
        assert!(!tracker.is_blocked("claude"));
        assert_eq!(recorder.states(), vec![QUOTA_BLOCKED, QUOTA_OK]);
    }

    #[test]
    fn only_changes_are_persisted() {
        let (tracker, recorder) = tracker();
        // Ordinary output arrives constantly; it must not hammer the database.
        for _ in 0..5 {
            tracker.note_ok("claude");
        }
        tracker.note_blocked("claude", "rate limit", None);
        tracker.note_blocked("claude", "rate limit", None);
        // A different reason for the same state is still worth recording.
        tracker.note_blocked("claude", "quota exceeded", None);

        assert_eq!(
            recorder.states(),
            vec![QUOTA_OK, QUOTA_BLOCKED, QUOTA_BLOCKED]
        );
    }

    #[test]
    fn profiles_are_tracked_apart() {
        let (tracker, _recorder) = tracker();
        tracker.note_blocked("claude", "usage limit reached", None);
        tracker.note_ok("kimi");

        assert!(tracker.is_blocked("claude"));
        assert!(!tracker.is_blocked("kimi"));

        let rows = tracker.snapshot(&["claude".to_string(), "kimi".to_string()]);
        assert_eq!(rows[0].state, QUOTA_BLOCKED);
        assert_eq!(rows[1].state, QUOTA_OK);
    }

    #[test]
    fn a_blocked_profile_missing_from_the_list_is_still_reported() {
        let (tracker, _recorder) = tracker();
        tracker.note_blocked("removed-agent", "quota exceeded", None);

        let rows = tracker.snapshot(&["claude".to_string()]);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].profile_id, "claude");
        assert_eq!(rows[1].profile_id, "removed-agent");
        assert_eq!(rows[1].state, QUOTA_BLOCKED);
    }

    #[test]
    fn hydrating_restores_the_last_session() {
        let (tracker, recorder) = tracker();
        tracker.hydrate(vec![AgentQuota {
            profile_id: "claude".to_string(),
            state: QUOTA_BLOCKED.to_string(),
            blocked_until: Some(1_800_000_000),
            reason: Some("usage limit reached".to_string()),
            updated_at: 1,
        }]);

        assert!(tracker.is_blocked("claude"));
        let rows = tracker.snapshot(&["claude".to_string()]);
        assert_eq!(rows[0].blocked_until, Some(1_800_000_000));
        assert!(
            recorder.states().is_empty(),
            "hydration must not write back what it just read"
        );
    }

    #[test]
    fn a_very_long_line_is_clamped_and_a_blank_one_is_dropped() {
        let long = "x".repeat(MAX_REASON * 2);
        let clamped = clamp_reason(&long).expect("reason");
        assert_eq!(clamped.chars().count(), MAX_REASON + 1);
        assert!(clamped.ends_with('\u{2026}'));

        assert_eq!(clamp_reason("   \n  "), None);
        assert_eq!(clamp_reason(" hi "), Some("hi".to_string()));
    }

    #[test]
    fn every_row_carries_the_router_state() {
        let (offline, _recorder) = tracker();
        let rows = offline.snapshot(&["claude".to_string()]);
        assert!(!rows[0].omni_route_online);

        let online = online_tracker();
        assert!(online.omni_route().is_online());
        let rows = online.snapshot(&["claude".to_string(), "kimi".to_string()]);
        assert!(rows.iter().all(|r| r.omni_route_online));
    }

    #[test]
    fn the_payload_uses_the_camel_case_wire_names() {
        let (tracker, _recorder) = tracker();
        tracker.note_blocked("claude", "usage limit reached", Some(7));
        let rows = tracker.snapshot(&["claude".to_string()]);
        let json = serde_json::to_value(&rows[0]).unwrap();

        assert_eq!(json["profileId"], "claude");
        assert_eq!(json["state"], QUOTA_BLOCKED);
        assert_eq!(json["blockedUntil"], 7);
        assert_eq!(json["reason"], "usage limit reached");
        assert_eq!(json["omniRouteOnline"], false);
    }

    #[test]
    fn an_unknown_row_serializes_its_empty_fields_as_null() {
        let (tracker, _recorder) = tracker();
        let rows = tracker.snapshot(&["claude".to_string()]);
        let json = serde_json::to_value(&rows[0]).unwrap();
        assert!(json["blockedUntil"].is_null());
        assert!(json["reason"].is_null());
        assert_eq!(json["state"], QUOTA_UNKNOWN);
    }

    /// A poisoned row map must not read as "nothing is blocked" (W1-15): that
    /// would let a genuinely blocked profile straight through the budget
    /// gate, and it would also make `note_blocked` a no-op instead of a write
    /// that is merely logged as recovered.
    #[test]
    fn poisoned_rows_still_record_and_report_a_block() {
        let (tracker, _recorder) = tracker();
        // Poison the tracker's own `rows` map from a scoped thread: lock it,
        // then panic while holding it, exactly like the poisoned_* fixtures
        // in pty.rs.
        std::thread::scope(|scope| {
            let _ = scope
                .spawn(|| {
                    let _guard = tracker.rows.lock().unwrap();
                    panic!("poison quota rows fixture");
                })
                .join();
        });
        assert!(!tracker.is_blocked("claude"));
        tracker.note_blocked("claude", "usage limit reached", Some(7));
        assert!(tracker.is_blocked("claude"));
        assert_eq!(
            tracker.state_of("claude").map(|row| row.state),
            Some(QUOTA_BLOCKED.to_string())
        );
    }
}
