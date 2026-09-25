//! Budget stop: percentage thresholds on the provider's own rate-limit windows.
//!
//! There is no cost ledger in this app, so a budget in money is not something
//! that could be enforced honestly. What there *is* is the figure Claude Code
//! puts on its `statusLine` hook: how much of the five-hour and the seven-day
//! window an account has spent (see [`crate::status::StatusLineUsage`]). That
//! is the shape the pain actually has - "Claude sits at 98 % again" - so that
//! is the shape of the budget: a percentage per window, per agent profile.
//!
//! Two settings hold it, both optional and both empty by default:
//!
//! ```text
//! budget.<profile_id>.five_hour_pct = 90
//! budget.<profile_id>.seven_day_pct = 80
//! ```
//!
//! When a window crosses its threshold the profile is handed to the existing
//! [`QuotaTracker`] as blocked. Nothing new is invented for the stop itself:
//! the dispatcher already skips a blocked profile ([`crate::queue`]), the
//! Usage view already shows one, and Phase 19's failover will already read it.
//! The one thing the quota path does not do is stop the agents that are
//! *already* running, so this module does that too: their sessions are killed
//! and the worker rows keep a `paused_reason`, which is the note the user (and
//! [`crate::workers::respawn_worker`]) reads to bring them back.
//!
//! Releasing is this module's job as well, and it has to be: the moment the
//! agents are gone, no new `statusLine` payload arrives, so the last observed
//! percentage would stay high forever and the block would never lift. Every
//! budget block therefore carries a concrete `blocked_until` - the window's
//! own `resets_at` where the provider named one, and the window's length from
//! now where it did not - and the watcher clears its own block once that
//! moment has passed. Only its own: a block that came from a provider error
//! message is left exactly where it is.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;

use crate::quota::QuotaTracker;
use crate::status::{StatusEngine, StatusLineUsage};
use crate::store::{now_unix_secs, Store, MSG_SYSTEM, SRC_BUDGET, STATUS_RUNNING};
use crate::workers::{self, AgentControl};

/// How often the watcher looks. Same beat as the other background pollers: a
/// budget is a ceiling, not a stopwatch, and a minute of overshoot is cheaper
/// than a poll that competes with the dispatcher.
pub const POLL_INTERVAL: Duration = Duration::from_secs(60);

/// Prefix of every budget setting, and what `list_limits` scans for.
pub const KEY_PREFIX: &str = "budget.";

/// Opens the reason of every quota block this module writes. It is the marker
/// that tells "the user's ceiling" from "the provider said no", and only the
/// former is ever released here.
pub const REASON_PREFIX: &str = "Budget: ";

/// Event kind recorded under [`SRC_BUDGET`] for every worker a budget stop
/// paused. Status events are keyed by worker, so this is where a stop becomes
/// visible to the activity feed and to the daily digest.
pub const EVENT_PAUSED: &str = "budget_paused";

const FIVE_HOUR_SECS: i64 = 5 * 60 * 60;
const SEVEN_DAY_SECS: i64 = 7 * 24 * 60 * 60;

/// Which rate-limit window a threshold is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Window {
    FiveHour,
    SevenDay,
}

impl Window {
    /// The settings key suffix. Together with the profile id this is the whole
    /// key, and the two are parsed back apart by [`limits_from_settings`].
    pub fn suffix(self) -> &'static str {
        match self {
            Window::FiveHour => ".five_hour_pct",
            Window::SevenDay => ".seven_day_pct",
        }
    }

    /// How the window is named to the user, matching the wording the provider
    /// overview already uses.
    pub fn label(self) -> &'static str {
        match self {
            Window::FiveHour => "5-Stunden-Fenster",
            Window::SevenDay => "7-Tage-Fenster",
        }
    }

    /// How long the window is. Used as the fallback reset time when the
    /// provider reported a percentage but no `resets_at`: a block with no end
    /// would stop the queue for good, and the window's own length is the only
    /// honest guess available.
    fn length_secs(self) -> i64 {
        match self {
            Window::FiveHour => FIVE_HOUR_SECS,
            Window::SevenDay => SEVEN_DAY_SECS,
        }
    }
}

/// The settings key for one profile and window.
pub fn setting_key(profile_id: &str, window: Window) -> String {
    format!("{KEY_PREFIX}{profile_id}{}", window.suffix())
}

/// One profile's thresholds. `None` on a window means no limit there.
///
/// Serialized as `{ "profileId", "fiveHourPct", "sevenDayPct" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetLimits {
    pub profile_id: String,
    pub five_hour_pct: Option<u8>,
    pub seven_day_pct: Option<u8>,
}

impl BudgetLimits {
    pub fn none(profile_id: &str) -> Self {
        Self {
            profile_id: profile_id.to_string(),
            five_hour_pct: None,
            seven_day_pct: None,
        }
    }

    fn limit_for(&self, window: Window) -> Option<u8> {
        match window {
            Window::FiveHour => self.five_hour_pct,
            Window::SevenDay => self.seven_day_pct,
        }
    }
}

/// A crossed threshold: which window, how far over, and until when the profile
/// is out of play.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BudgetStop {
    pub profile_id: String,
    pub window: Window,
    pub percent: u8,
    pub limit: u8,
    /// Unix seconds at which the block lifts. Always known: see the module
    /// documentation for why a budget block may not be open-ended.
    pub blocked_until: i64,
}

impl BudgetStop {
    /// The line the user reads, in the quota row and on the worker's log.
    pub fn reason(&self) -> String {
        format!(
            "{REASON_PREFIX}{} bei {} % (Limit {} %)",
            self.window.label(),
            self.percent,
            self.limit
        )
    }
}

/// What one sweep did, in the order it did it. Returned so a test - and the
/// log line the thread prints - can see the decision rather than the side
/// effect.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BudgetAction {
    /// The profile crossed a threshold and was blocked.
    Stopped(BudgetStop),
    /// A block this module wrote has expired and was lifted.
    Released { profile_id: String },
}

/// Read a stored threshold. Rejects everything that is not a whole percentage
/// between 1 and 100: 0 would mean "block immediately", which is not a budget
/// but a switch, and the profile switch in the settings already is that one.
pub fn parse_percent(raw: &str) -> Result<u8, String> {
    let raw = raw.trim();
    let value: u32 = raw
        .parse()
        .map_err(|_| format!("budget must be a whole percentage between 1 and 100, got '{raw}'"))?;
    if !(1..=100).contains(&value) {
        return Err(format!(
            "budget must be a whole percentage between 1 and 100, got '{raw}'"
        ));
    }
    Ok(value as u8)
}

/// Fold a flat `key = value` list into one entry per profile, newest wording
/// of the keys only. Unparsable values are dropped rather than guessed at: a
/// threshold nobody can read is no threshold, and blocking on one would be the
/// worst possible reading of a typo.
pub fn limits_from_settings(settings: &[(String, String)]) -> Vec<BudgetLimits> {
    let mut out: Vec<BudgetLimits> = Vec::new();
    for (key, value) in settings {
        let Some(rest) = key.strip_prefix(KEY_PREFIX) else {
            continue;
        };
        let (profile_id, window) = if let Some(id) = rest.strip_suffix(Window::FiveHour.suffix()) {
            (id, Window::FiveHour)
        } else if let Some(id) = rest.strip_suffix(Window::SevenDay.suffix()) {
            (id, Window::SevenDay)
        } else {
            continue;
        };
        if profile_id.is_empty() {
            continue;
        }
        let Ok(percent) = parse_percent(value) else {
            continue;
        };
        let entry = match out.iter_mut().find(|e| e.profile_id == profile_id) {
            Some(entry) => entry,
            None => {
                out.push(BudgetLimits::none(profile_id));
                out.last_mut().expect("just pushed")
            }
        };
        match window {
            Window::FiveHour => entry.five_hour_pct = Some(percent),
            Window::SevenDay => entry.seven_day_pct = Some(percent),
        }
    }
    out.sort_by(|a, b| a.profile_id.cmp(&b.profile_id));
    out
}

/// Every profile that has at least one threshold set.
pub async fn list_limits(store: &Store) -> Result<Vec<BudgetLimits>, String> {
    Ok(limits_from_settings(
        &store.list_settings(KEY_PREFIX).await?,
    ))
}

/// One profile's thresholds, whether or not any are set.
pub async fn limits_of(store: &Store, profile_id: &str) -> Result<BudgetLimits, String> {
    let mut limits = BudgetLimits::none(profile_id);
    for window in [Window::FiveHour, Window::SevenDay] {
        let key = setting_key(profile_id, window);
        let Some(raw) = store.get_setting(&key).await? else {
            continue;
        };
        let Ok(percent) = parse_percent(&raw) else {
            continue;
        };
        match window {
            Window::FiveHour => limits.five_hour_pct = Some(percent),
            Window::SevenDay => limits.seven_day_pct = Some(percent),
        }
    }
    Ok(limits)
}

/// Write (`Some`) or clear (`None`) one threshold.
///
/// Clearing deletes the key rather than storing an empty string: "no limit"
/// has to be the absence of a value, or every reader would have to agree on
/// which empty string means what.
pub async fn set_limit(
    store: &Store,
    profile_id: &str,
    window: Window,
    percent: Option<u8>,
) -> Result<(), String> {
    if profile_id.trim().is_empty() {
        return Err(format!("{}profile id is required", workers::ERR_REFUSED));
    }
    let key = setting_key(profile_id, window);
    match percent {
        Some(percent) => {
            // Re-validated here rather than trusted from the caller: the API
            // and the CLI both reach this, and a `u8` can still be 0 or 200.
            let percent = parse_percent(&percent.to_string())?;
            store.set_setting(&key, &percent.to_string()).await
        }
        None => store.delete_setting(&key).await,
    }
}

/// Write both windows of one profile at once and answer with what is stored
/// afterwards - the shape the API and the CLI both want.
///
/// Each window is three-valued: `None` leaves it alone, `Some(None)` clears
/// it, `Some(Some(pct))` sets it. The profile has to exist: a ceiling on a
/// profile that is not in the registry would never be read by anything, and a
/// typo that stores quietly is worse than one that is refused.
pub async fn update_limits(
    store: &Store,
    profile_id: &str,
    five_hour_pct: Option<Option<u8>>,
    seven_day_pct: Option<Option<u8>>,
) -> Result<BudgetLimits, String> {
    if crate::profiles::find_profile(profile_id).is_none() {
        return Err(format!(
            "{}agent profile: {profile_id}",
            workers::ERR_UNKNOWN
        ));
    }
    if let Some(percent) = five_hour_pct {
        set_limit(store, profile_id, Window::FiveHour, percent).await?;
    }
    if let Some(percent) = seven_day_pct {
        set_limit(store, profile_id, Window::SevenDay, percent).await?;
    }
    limits_of(store, profile_id).await
}

/// Does this usage snapshot cross one of the thresholds?
///
/// Pure, and the whole decision: everything else in this module is what
/// happens once it has answered. The five-hour window is checked first because
/// it is the one that trips in practice; a profile over both is reported for
/// the shorter one, whose reset is the one that matters.
pub fn evaluate(
    limits: &BudgetLimits,
    usage: Option<&StatusLineUsage>,
    now: i64,
) -> Option<BudgetStop> {
    let usage = usage?;
    for window in [Window::FiveHour, Window::SevenDay] {
        let Some(limit) = limits.limit_for(window) else {
            continue;
        };
        let observed = match window {
            Window::FiveHour => usage.five_hour,
            Window::SevenDay => usage.seven_day,
        };
        let Some(observed) = observed else { continue };
        let Some(percent) = observed.percent else {
            continue;
        };
        if percent < limit {
            continue;
        }
        // A `resets_at` in the past is a stale payload, not an expired block:
        // treating it as one would block and release on every single sweep.
        // And one further out than a full window is not a window at all: the
        // figure comes from the statusline, which any process of this user can
        // write, so it is clamped rather than trusted (F-SEC-9). The window's
        // own length is both the fallback and the ceiling.
        let ceiling = now.saturating_add(window.length_secs());
        let blocked_until = observed
            .resets_at
            .filter(|reset| *reset > now)
            .map(|reset| reset.min(ceiling))
            .unwrap_or(ceiling);
        return Some(BudgetStop {
            profile_id: limits.profile_id.clone(),
            window,
            percent,
            limit,
            blocked_until,
        });
    }
    None
}

/// The budget watcher: the settings, the usage figures and the quota map.
pub struct BudgetWatcher {
    store: Store,
    engine: Arc<StatusEngine>,
    quota: Arc<QuotaTracker>,
    /// `observed_at` of the payload that caused each profile's last stop.
    ///
    /// This is what keeps a stop from happening twice on the same evidence.
    /// Killing the agents is what stops the `statusLine` payloads, so once a
    /// block is lifted the newest observation there is still reads 93 % - and
    /// re-blocking on it would leave the queue permanently stopped, five hours
    /// at a time. Only a measurement younger than the one behind the last stop
    /// counts. In memory on purpose: after a restart nothing is running yet,
    /// so the first payload to arrive is by definition a new measurement.
    last_stop_observation: Mutex<HashMap<String, i64>>,
}

impl BudgetWatcher {
    pub fn new(store: Store, engine: Arc<StatusEngine>, quota: Arc<QuotaTracker>) -> Self {
        Self {
            store,
            engine,
            quota,
            last_stop_observation: Mutex::new(HashMap::new()),
        }
    }

    /// One sweep over every profile that has a threshold.
    ///
    /// `now` is passed in rather than read, so the release path - which is
    /// entirely about a moment passing - can be tested without waiting five
    /// hours. `agents` is what stops the sessions of a profile that just
    /// crossed its ceiling; a control that cannot kill (there is none in the
    /// app, but tests have one) costs the pause and nothing else.
    pub async fn check_once(&self, agents: &dyn AgentControl, now: i64) -> Vec<BudgetAction> {
        let limits = match list_limits(&self.store).await {
            Ok(limits) => limits,
            // A settings table that cannot be read is not a reason to stop
            // every profile, and not a reason to kill the thread either.
            Err(err) => {
                eprintln!("projecta: budget watcher could not read its settings: {err}");
                return Vec::new();
            }
        };

        let mut actions = Vec::new();
        for limits in limits {
            let usage = self.engine.provider_usage(&limits.profile_id);
            let current = self.quota.state_of(&limits.profile_id);
            let ours = current
                .as_ref()
                .and_then(|row| row.reason.as_deref())
                .is_some_and(|reason| reason.starts_with(REASON_PREFIX));
            let blocked = self.quota.is_blocked(&limits.profile_id);

            // Expiry comes first, and it is decided on the clock alone. The
            // usage figure cannot be consulted here: stopping the agents is
            // what stops the `statusLine` payloads, so the last observation
            // still says 93 % and always will. Only a block this module wrote
            // is ever lifted - a provider's own refusal stays where it is.
            if blocked {
                if !ours {
                    continue;
                }
                // `map_or(true, ..)` rather than `is_none_or`: the crate's
                // MSRV is older than the latter.
                let expired = current
                    .as_ref()
                    .and_then(|row| row.blocked_until)
                    .is_none_or(|until| now >= until);
                if expired {
                    self.quota.note_ok(&limits.profile_id);
                    actions.push(BudgetAction::Released {
                        profile_id: limits.profile_id.clone(),
                    });
                }
                // Nothing else this sweep either way: a block that stands is
                // already doing its job, and one just lifted may only be put
                // back by a *newer* measurement than the release, which by
                // definition has not arrived yet.
                continue;
            }

            let Some(usage) = usage else { continue };
            // See `last_stop_observation`: the same reading may not stop the
            // same profile twice.
            let seen = self
                .last_stop_observation
                .lock()
                .ok()
                .and_then(|map| map.get(&limits.profile_id).copied());
            if seen.is_some_and(|seen| usage.observed_at <= seen) {
                continue;
            }

            let Some(stop) = evaluate(&limits, Some(&usage), now) else {
                continue;
            };
            let reason = stop.reason();
            self.quota
                .note_blocked(&stop.profile_id, &reason, Some(stop.blocked_until));
            if let Ok(mut map) = self.last_stop_observation.lock() {
                map.insert(stop.profile_id.clone(), usage.observed_at);
            }
            self.pause_workers(agents, &stop.profile_id, &reason).await;
            actions.push(BudgetAction::Stopped(stop));
        }
        actions
    }

    /// Stop every live agent of one profile without archiving it.
    ///
    /// The worker row keeps its `running` status on purpose: it is the same
    /// worker on the same branch, only without a session, and rewriting the
    /// status would say the work ended. What changes is `paused_reason`, which
    /// is what tells a paused worker from one whose agent merely exited.
    ///
    /// Every kind is paused, coordinators included. The ceiling is on the
    /// account behind the profile, and a queen spends from the same account as
    /// the workers she orders.
    async fn pause_workers(&self, agents: &dyn AgentControl, profile_id: &str, reason: &str) {
        let workers = match self.store.list_workers(None).await {
            Ok(workers) => workers,
            Err(err) => {
                eprintln!("projecta: budget watcher could not list workers: {err}");
                return;
            }
        };
        for worker in workers {
            if worker.profile_id != profile_id || worker.status != STATUS_RUNNING {
                continue;
            }
            // Unbind before killing, for the same reason `archive_worker`
            // does: the PTY exit hook resolves sessions through this map, and
            // an unbound session cannot race the note written below.
            let Some(session_id) = self.store.take_session(&worker.id) else {
                continue;
            };
            agents.kill(&session_id);
            if let Err(err) = self
                .store
                .set_worker_paused_reason(&worker.id, Some(reason))
                .await
            {
                eprintln!(
                    "projecta: budget watcher could not mark {}: {err}",
                    worker.id
                );
            }
            workers::log_message(
                &self.store,
                &worker.id,
                MSG_SYSTEM,
                &format!(
                    "{reason} - Agent pausiert, Worktree bleibt liegen. \
                     Respawn holt ihn zurueck."
                ),
            );
            if let Err(err) = self
                .store
                .record_status_event(&worker.id, EVENT_PAUSED, reason, SRC_BUDGET)
                .await
            {
                eprintln!("projecta: budget watcher could not record the pause: {err}");
            }
        }
    }
}

/// Record a sweep's decisions against the profile they were about.
///
/// Status events are keyed by worker, and a profile is not one - so the events
/// that carry a budget stop into the digest are written per paused worker in
/// [`BudgetWatcher::pause_workers`]. What is left for the thread is the line on
/// stderr, which is where an operator looks when the queue went quiet.
fn announce(actions: &[BudgetAction]) {
    for action in actions {
        match action {
            BudgetAction::Stopped(stop) => eprintln!(
                "projecta: {} stopped by budget: {}",
                stop.profile_id,
                stop.reason()
            ),
            BudgetAction::Released { profile_id } => {
                eprintln!("projecta: budget block on {profile_id} lifted")
            }
        }
    }
}

/// Start the always-on budget watcher.
///
/// A plain OS thread with exactly one `block_on` at its top, the shape the
/// dispatcher settled on: everything below is awaited, never blocked on again,
/// so nothing here can start a runtime inside a runtime.
pub fn start(
    store: Store,
    engine: Arc<StatusEngine>,
    quota: Arc<QuotaTracker>,
    agents: Box<dyn AgentControl + Send + Sync>,
) {
    let watcher = BudgetWatcher::new(store, engine, quota);
    thread::spawn(move || loop {
        let actions =
            tauri::async_runtime::block_on(watcher.check_once(agents.as_ref(), now_unix_secs()));
        announce(&actions);
        thread::sleep(POLL_INTERVAL);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    use crate::profiles::AgentProfile;
    use crate::status::RateWindowUsage;
    use crate::store::{WorkerRow, KIND_WORKER, QUOTA_BLOCKED, QUOTA_OK};
    use crate::testutil::TempDir;

    #[derive(Default)]
    struct FakeAgents {
        killed: Mutex<Vec<String>>,
    }

    impl AgentControl for FakeAgents {
        fn spawn(
            &self,
            _worker_id: &str,
            _profile: &AgentProfile,
            _cwd: &Path,
            _env: &[(String, String)],
        ) -> Result<String, String> {
            Err("this control never spawns".to_string())
        }

        fn skill_packs_dir(&self) -> Result<PathBuf, String> {
            Ok(PathBuf::from("."))
        }

        fn kill(&self, session_id: &str) {
            self.killed.lock().unwrap().push(session_id.to_string());
        }
    }

    fn usage(five: Option<(u8, Option<i64>)>, seven: Option<(u8, Option<i64>)>) -> StatusLineUsage {
        StatusLineUsage {
            percent: five.map(|(p, _)| p).or(seven.map(|(p, _)| p)),
            used: None,
            limit: None,
            window_label: "5-Stunden-Fenster".to_string(),
            resets_at: five.and_then(|(_, r)| r),
            five_hour: five.map(|(percent, resets_at)| RateWindowUsage {
                percent: Some(percent),
                resets_at,
            }),
            seven_day: seven.map(|(percent, resets_at)| RateWindowUsage {
                percent: Some(percent),
                resets_at,
            }),
            observed_at: 1,
        }
    }

    async fn fixture() -> (TempDir, Store, String) {
        let dir = TempDir::new("budget");
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let project = store.create_project("one", "C:/repo/one").await.unwrap();
        (dir, store, project.id)
    }

    async fn running_worker(store: &Store, project_id: &str, id: &str, profile_id: &str) {
        store
            .insert_worker(&WorkerRow {
                id: id.to_string(),
                project_id: project_id.to_string(),
                task: "work".to_string(),
                profile_id: profile_id.to_string(),
                branch: format!("pa/{id}"),
                worktree_path: format!("C:/tmp/{id}"),
                status: STATUS_RUNNING.to_string(),
                kind: KIND_WORKER.to_string(),
                pr_url: None,
                spawned_by: None,
                test_status: None,
                tested_at: None,
                role_variant_id: None,
                paused_reason: None,
                created_at: 1,
            })
            .await
            .unwrap();
        store.bind_session(id, &format!("sess-{id}")).await;
    }

    fn watcher(store: &Store) -> (BudgetWatcher, Arc<StatusEngine>, Arc<QuotaTracker>) {
        let engine = Arc::new(StatusEngine::default());
        let quota = Arc::new(QuotaTracker::default());
        (
            BudgetWatcher::new(store.clone(), Arc::clone(&engine), Arc::clone(&quota)),
            engine,
            quota,
        )
    }

    #[test]
    fn a_percentage_is_a_whole_number_between_one_and_a_hundred() {
        assert_eq!(parse_percent(" 90 "), Ok(90));
        assert_eq!(parse_percent("1"), Ok(1));
        assert_eq!(parse_percent("100"), Ok(100));
        for bad in ["0", "101", "-5", "90.5", "", "neunzig"] {
            assert!(parse_percent(bad).is_err(), "{bad} was accepted");
        }
    }

    #[test]
    fn settings_fold_into_one_entry_per_profile() {
        let settings = vec![
            ("budget.claude.five_hour_pct".to_string(), "90".to_string()),
            ("budget.claude.seven_day_pct".to_string(), "80".to_string()),
            ("budget.kimi.seven_day_pct".to_string(), "70".to_string()),
            // Not a budget key, an unreadable value and an empty profile id:
            // each is skipped rather than guessed at.
            ("learning.worker".to_string(), "0".to_string()),
            ("budget.gpt.five_hour_pct".to_string(), "abc".to_string()),
            ("budget..five_hour_pct".to_string(), "50".to_string()),
        ];
        let limits = limits_from_settings(&settings);
        assert_eq!(
            limits,
            vec![
                BudgetLimits {
                    profile_id: "claude".to_string(),
                    five_hour_pct: Some(90),
                    seven_day_pct: Some(80),
                },
                BudgetLimits {
                    profile_id: "kimi".to_string(),
                    five_hour_pct: None,
                    seven_day_pct: Some(70),
                },
            ]
        );
    }

    /// The fixture repeats most of `settings_fold_into_one_entry_per_profile`
    /// (same three drop cases, same claude/kimi entries). What it adds is a
    /// third profile with both windows, a key set twice (the later value
    /// wins, as `limits_from_settings` overwrites in input order), and the
    /// whole `Debug` shape as one reviewed file instead of named fields.
    #[test]
    fn settings_fold_snapshot() {
        let settings = vec![
            ("budget.claude.five_hour_pct".to_string(), "90".to_string()),
            ("budget.claude.seven_day_pct".to_string(), "80".to_string()),
            ("budget.kimi.seven_day_pct".to_string(), "70".to_string()),
            ("budget.gpt-5.five_hour_pct".to_string(), "1".to_string()),
            ("budget.gpt-5.seven_day_pct".to_string(), "100".to_string()),
            // Set twice: the later value wins.
            ("budget.claude.five_hour_pct".to_string(), "95".to_string()),
            // Skipped: wrong prefix, unparsable value, empty profile id.
            ("learning.worker".to_string(), "0".to_string()),
            ("budget.gpt.five_hour_pct".to_string(), "abc".to_string()),
            ("budget..five_hour_pct".to_string(), "50".to_string()),
        ];
        insta::assert_debug_snapshot!(limits_from_settings(&settings));
    }

    /// The reason line is user-visible text (quota row, worker log); a
    /// snapshot pins the exact German wording across both windows so a
    /// wording change is a reviewed diff, not a silent drift.
    #[test]
    fn budget_stop_reason_snapshot() {
        let claude = BudgetStop {
            profile_id: "claude".to_string(),
            window: Window::FiveHour,
            percent: 92,
            limit: 90,
            blocked_until: 1_000,
        };
        let kimi = BudgetStop {
            profile_id: "kimi".to_string(),
            window: Window::SevenDay,
            percent: 100,
            limit: 80,
            blocked_until: 2_000,
        };
        insta::assert_debug_snapshot!(vec![claude.reason(), kimi.reason()]);
    }

    #[test]
    fn a_window_trips_only_its_own_threshold() {
        let limits = BudgetLimits {
            profile_id: "claude".to_string(),
            five_hour_pct: None,
            seven_day_pct: Some(80),
        };
        // 95 % of five hours with no five-hour limit set is not a stop.
        let calm = usage(Some((95, None)), Some((30, None)));
        assert_eq!(evaluate(&limits, Some(&calm), 1_000), None);

        let hot = usage(Some((10, None)), Some((81, Some(9_000))));
        let stop = evaluate(&limits, Some(&hot), 1_000).expect("stop");
        assert_eq!(stop.window, Window::SevenDay);
        assert_eq!(stop.percent, 81);
        assert_eq!(stop.blocked_until, 9_000);
        assert_eq!(
            stop.reason(),
            "Budget: 7-Tage-Fenster bei 81 % (Limit 80 %)"
        );
    }

    #[test]
    fn a_missing_reset_time_becomes_the_windows_own_length() {
        let limits = BudgetLimits {
            profile_id: "claude".to_string(),
            five_hour_pct: Some(90),
            seven_day_pct: None,
        };
        let hot = usage(Some((90, None)), None);
        let stop = evaluate(&limits, Some(&hot), 1_000).expect("stop");
        assert_eq!(stop.blocked_until, 1_000 + FIVE_HOUR_SECS);

        // A reset time already in the past is a stale payload, not an expired
        // block: it would otherwise block and release on every sweep.
        let stale = usage(Some((90, Some(500))), None);
        let stop = evaluate(&limits, Some(&stale), 1_000).expect("stop");
        assert_eq!(stop.blocked_until, 1_000 + FIVE_HOUR_SECS);
    }

    /// F-SEC-9: `resets_at` arrives from the statusline, which any process of
    /// the same user can write - and it went into `blocked_until` unchecked.
    /// One forged payload with `i64::MAX` parked the profile, and with it every
    /// sibling session on it, for longer than the machine will exist. A window
    /// cannot reset later than one full window from now, so that is the
    /// ceiling; below it the provider's own figure is still used verbatim.
    #[test]
    fn a_reset_time_beyond_the_window_is_clamped_to_it() {
        let limits = BudgetLimits {
            profile_id: "claude".to_string(),
            five_hour_pct: Some(90),
            seven_day_pct: Some(80),
        };

        let forged = usage(Some((95, Some(i64::MAX))), None);
        let stop = evaluate(&limits, Some(&forged), 1_000).expect("stop");
        assert_eq!(stop.blocked_until, 1_000 + FIVE_HOUR_SECS);

        // One second past the window is already too far.
        let nudged = usage(Some((95, Some(1_000 + FIVE_HOUR_SECS + 1))), None);
        let stop = evaluate(&limits, Some(&nudged), 1_000).expect("stop");
        assert_eq!(stop.blocked_until, 1_000 + FIVE_HOUR_SECS);

        // The seven-day window gets its own, longer ceiling - clamping it to
        // five hours would release a real seven-day block far too early.
        let seven = usage(Some((10, None)), Some((85, Some(i64::MAX))));
        let stop = evaluate(&limits, Some(&seven), 1_000).expect("stop");
        assert_eq!(stop.window, Window::SevenDay);
        assert_eq!(stop.blocked_until, 1_000 + SEVEN_DAY_SECS);

        // A figure inside the window is still taken as reported.
        let honest = usage(Some((95, Some(9_000))), None);
        let stop = evaluate(&limits, Some(&honest), 1_000).expect("stop");
        assert_eq!(stop.blocked_until, 9_000);
    }

    #[test]
    fn no_usage_and_no_limit_are_both_quiet() {
        let limits = BudgetLimits {
            profile_id: "claude".to_string(),
            five_hour_pct: Some(90),
            seven_day_pct: None,
        };
        assert_eq!(evaluate(&limits, None, 1), None);
        assert_eq!(
            evaluate(
                &BudgetLimits::none("claude"),
                Some(&usage(Some((99, None)), None)),
                1
            ),
            None
        );
        // Exactly at the limit counts as reached: a ceiling of 90 % means 90 %
        // is as far as this profile goes.
        let stop = evaluate(&limits, Some(&usage(Some((90, None)), None)), 1);
        assert!(stop.is_some());
    }

    #[tokio::test]
    async fn crossing_the_threshold_blocks_the_profile_and_pauses_its_workers() {
        let (_dir, store, project) = fixture().await;
        running_worker(&store, &project, "wk-1", "claude").await;
        running_worker(&store, &project, "wk-2", "kimi").await;
        set_limit(&store, "claude", Window::FiveHour, Some(90))
            .await
            .unwrap();

        let (watcher, engine, quota) = watcher(&store);
        engine.note_statusline(
            "wk-1",
            r#"{"rate_limits":{"five_hour":{"used_percentage":93,"resets_at":9000}}}"#,
        );
        // The engine only knows which profile a worker runs once it has seen
        // the row, which is what the board does on every refresh.
        for worker in store.list_workers(None).await.unwrap() {
            engine.observe_worker(&worker);
        }

        let agents = FakeAgents::default();
        let actions = watcher.check_once(&agents, 1_000).await;
        assert_eq!(actions.len(), 1, "{actions:?}");
        assert!(quota.is_blocked("claude"));
        assert_eq!(quota.state_of("claude").unwrap().blocked_until, Some(9_000));
        assert!(!quota.is_blocked("kimi"), "another profile is untouched");

        assert_eq!(agents.killed.lock().unwrap().clone(), vec!["sess-wk-1"]);
        let row = store.get_worker_row("wk-1").await.unwrap().unwrap();
        assert!(row
            .paused_reason
            .as_deref()
            .unwrap()
            .starts_with(REASON_PREFIX));
        assert_eq!(row.status, STATUS_RUNNING, "a pause is not an ending");
        assert!(store.session_for_worker("wk-1").is_none());
        let untouched = store.get_worker_row("wk-2").await.unwrap().unwrap();
        assert_eq!(untouched.paused_reason, None);

        // A second sweep a minute later must not kill anything again.
        let actions = watcher.check_once(&agents, 1_060).await;
        assert!(actions.is_empty(), "{actions:?}");
        assert_eq!(agents.killed.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn the_block_lifts_when_the_window_has_rolled_over() {
        let (_dir, store, _project) = fixture().await;
        set_limit(&store, "claude", Window::FiveHour, Some(90))
            .await
            .unwrap();
        let (watcher, engine, quota) = watcher(&store);
        engine.note_statusline_at(
            "wk-1",
            r#"{"rate_limits":{"five_hour":{"used_percentage":93,"resets_at":9000}}}"#,
            500,
        );
        engine.set_profile_for_test("wk-1", "claude");

        let agents = FakeAgents::default();
        watcher.check_once(&agents, 1_000).await;
        assert_eq!(quota.state_of("claude").unwrap().state, QUOTA_BLOCKED);

        // Still blocked while the window runs, even though no fresh payload
        // can arrive - the agents were stopped.
        assert!(watcher.check_once(&agents, 8_999).await.is_empty());
        assert!(quota.is_blocked("claude"));

        let actions = watcher.check_once(&agents, 9_000).await;
        assert_eq!(
            actions,
            vec![BudgetAction::Released {
                profile_id: "claude".to_string()
            }]
        );
        assert_eq!(quota.state_of("claude").unwrap().state, QUOTA_OK);

        // The payload that caused the block is still the newest one there is -
        // the agents it came from are gone. It must not block the profile all
        // over again, or the queue would never get a turn.
        assert!(watcher.check_once(&agents, 9_060).await.is_empty());
        assert!(!quota.is_blocked("claude"));

        // A fresh measurement that is still over the ceiling does block again.
        engine.note_statusline_at(
            "wk-1",
            r#"{"rate_limits":{"five_hour":{"used_percentage":95}}}"#,
            9_100,
        );
        let actions = watcher.check_once(&agents, 9_120).await;
        assert!(
            matches!(actions.as_slice(), [BudgetAction::Stopped(_)]),
            "{actions:?}"
        );
    }

    #[tokio::test]
    async fn a_providers_own_refusal_is_never_released_here() {
        let (_dir, store, _project) = fixture().await;
        set_limit(&store, "claude", Window::FiveHour, Some(90))
            .await
            .unwrap();
        let (watcher, engine, quota) = watcher(&store);
        engine.note_statusline(
            "wk-1",
            r#"{"rate_limits":{"five_hour":{"used_percentage":10}}}"#,
        );
        engine.set_profile_for_test("wk-1", "claude");
        quota.note_blocked("claude", "Claude usage limit reached", Some(10));

        let agents = FakeAgents::default();
        let actions = watcher.check_once(&agents, 1_000_000).await;
        assert!(actions.is_empty(), "{actions:?}");
        assert!(
            quota.is_blocked("claude"),
            "only the budget's own blocks are lifted here"
        );
    }

    #[tokio::test]
    async fn limits_round_trip_through_the_settings_table() {
        let (_dir, store, _project) = fixture().await;
        assert_eq!(
            list_limits(&store).await.unwrap(),
            Vec::<BudgetLimits>::new()
        );

        set_limit(&store, "claude", Window::FiveHour, Some(90))
            .await
            .unwrap();
        set_limit(&store, "claude", Window::SevenDay, Some(80))
            .await
            .unwrap();
        assert_eq!(
            limits_of(&store, "claude").await.unwrap(),
            BudgetLimits {
                profile_id: "claude".to_string(),
                five_hour_pct: Some(90),
                seven_day_pct: Some(80),
            }
        );

        set_limit(&store, "claude", Window::FiveHour, None)
            .await
            .unwrap();
        assert_eq!(
            limits_of(&store, "claude").await.unwrap().five_hour_pct,
            None
        );
        assert!(store
            .get_setting(&setting_key("claude", Window::FiveHour))
            .await
            .unwrap()
            .is_none());

        assert!(set_limit(&store, "claude", Window::FiveHour, Some(0))
            .await
            .is_err());
        assert!(set_limit(&store, "  ", Window::FiveHour, Some(50))
            .await
            .is_err());
    }
}
