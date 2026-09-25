//! Durable task queue and its small, deliberately conservative dispatcher.
//!
//! A queue item becomes a normal worker only when the project has spare
//! capacity.  That keeps the expensive pieces (a worktree and a PTY) in the
//! existing worker lifecycle, while making delayed dispatch restart-safe.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::budget;
use crate::enhance;
use crate::learnings;
use crate::preflight::{self, Facts, Report};
use crate::profiles::AgentProfile;
use crate::quota::QuotaTracker;
use crate::status::StatusEngine;
use crate::store::{
    new_id, now_unix_secs, QueueEntry, Store, KIND_WORKER, MSG_SYSTEM, QUEUE_DISPATCHED,
    QUEUE_DISPATCHING, QUEUE_READY, QUEUE_SHARPENING, STATUS_EXITED, STATUS_RUNNING,
};
use crate::workers;

/// The default cap on concurrently running *employees* of one project, used
/// when the project has no `max_workers` of its own. Coordinators -
/// orchestrators, queens, scouts - never count against it: they must be able to
/// steer even when every employee slot is taken.
pub const DEFAULT_MAX_CONCURRENT: usize = 4;
/// The queue is deliberately a slow poller: it is a safety net, not a hot path.
pub const POLL_INTERVAL: Duration = Duration::from_secs(30);

/// How many hops of [`AgentProfile::fallback`] the dispatcher will take before
/// it gives up and leaves the task queued.
///
/// Two, and deliberately small. A fallback exists so a blocked profile can
/// hand one task to a free one, not so a misconfigured `agents.json` can walk
/// a chain of eight agents until it finds something that will take the work -
/// by hop three nobody could still say which agent a task ran on or why.
pub const MAX_FALLBACK_DEPTH: usize = 2;

/// Starts a worker for a ready queue entry. Kept small so tests never need a
/// PTY, a Tauri app, or a real coding agent.
///
/// The method is asynchronous, and it has to be: spawning a worker is async all
/// the way down, and the dispatcher already drives this whole chain from a
/// single `block_on` at the top of its own thread. A launcher that blocked on a
/// runtime again from in here would be starting a runtime from within one,
/// which panics and takes the dispatcher thread with it. Returning a boxed
/// future keeps the trait object-safe without pulling in an async-trait crate.
pub trait TaskLauncher: Send + Sync {
    fn launch<'a>(
        &'a self,
        entry: &'a QueueEntry,
    ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>>;
}

/// Insert a queue entry and, when requested, run the supplied enhancer before
/// returning it. Enhancement failures deliberately leave the task dispatchable
/// with its original text: a missing optional convenience must not lose work.
#[cfg(test)]
// The queue row simply has this many independent columns; bundling them
// into a params struct would only move the same list one level away.
#[allow(clippy::too_many_arguments)]
pub async fn enqueue_with_enhancer<F>(
    store: &Store,
    project_id: &str,
    raw_text: &str,
    profile_id: Option<String>,
    sharpen: bool,
    priority: Option<i32>,
    spawned_by: Option<String>,
    enhancer: F,
) -> Result<QueueEntry, String>
where
    F: FnOnce(&str, &str) -> Result<String, String>,
{
    if raw_text.trim().is_empty() {
        return Err("task is required".to_string());
    }
    if store.get_project(project_id).await?.is_none() {
        return Err(format!("{}project: {project_id}", workers::ERR_UNKNOWN));
    }

    let mut entry = QueueEntry {
        id: new_id("tq"),
        project_id: project_id.to_string(),
        raw_text: raw_text.to_string(),
        sharpened_text: None,
        profile_id: profile_id.unwrap_or_else(|| "claude".to_string()),
        status: if sharpen {
            QUEUE_SHARPENING.to_string()
        } else {
            QUEUE_READY.to_string()
        },
        priority: priority.unwrap_or(0),
        worker_id: None,
        error: None,
        spawned_by,
        created_at: now_unix_secs(),
    };
    store.insert_queue_entry(&entry).await?;

    if sharpen {
        // An enhancer error is intentionally not persisted as a task failure:
        // task_queue's sharpened_text remains NULL and the dispatcher uses raw_text.
        let enhanced = enhancer(&entry.raw_text, &entry.profile_id).ok();
        entry = store
            .set_queue_ready_result(&entry.id, enhanced.as_deref())
            .await?;
    }
    Ok(entry)
}

/// Preflight verdicts the dispatcher may reuse.
///
/// One report per profile, kept only as long as it still describes the
/// situation: [`Report::is_valid_for`] checks the fingerprint of the facts and
/// the report's age, and a report that fails either is simply recomputed.
/// Evaluating is cheap, so the cache is not about speed - it is about the
/// dispatcher having one verdict per profile per sweep instead of one per
/// queue entry, so two entries of the same profile cannot be told two
/// different stories in the same second.
#[derive(Default)]
pub struct PreflightCache {
    reports: Mutex<HashMap<String, Report>>,
}

impl PreflightCache {
    /// The current verdict for these facts, from the cache when it still
    /// holds and freshly evaluated when it does not.
    pub fn report(&self, facts: &Facts, now: i64) -> Report {
        if let Ok(reports) = self.reports.lock() {
            if let Some(cached) = reports.get(&facts.profile_id) {
                if cached.is_valid_for(facts, now) {
                    return cached.clone();
                }
            }
        }
        let report = preflight::evaluate(facts, now);
        if let Ok(mut reports) = self.reports.lock() {
            reports.insert(facts.profile_id.clone(), report.clone());
        }
        report
    }
}

/// Read everything a preflight verdict is computed from.
async fn gather_facts(
    store: &Store,
    quota: &QuotaTracker,
    profiles: &[AgentProfile],
    profile_id: &str,
) -> Facts {
    let row = quota.state_of(profile_id);
    Facts {
        profile_id: profile_id.to_string(),
        known: profiles.iter().any(|profile| profile.id == profile_id),
        enabled: learnings::profile_enabled(store, profile_id).await,
        quota_state: row.as_ref().map_or_else(
            || crate::store::QUOTA_UNKNOWN.to_string(),
            |row| row.state.clone(),
        ),
        quota_reason: row.as_ref().and_then(|row| row.reason.clone()),
        blocked_until: row.as_ref().and_then(|row| row.blocked_until),
        budget: budget::limits_of(store, profile_id).await.ok(),
    }
}

/// Take at most one ready task for one project. Returning `Ok(None)` means
/// either that no task was ready, the project is at capacity, or every ready
/// task's profile is currently held up by something (see [`crate::preflight`]).
///
/// `profiles` is the registry as one sweep sees it, read once by the caller so
/// that every entry in this pass is judged against the same `agents.json`.
///
/// **Failover (phase 19 T4).** A profile that is out of quota - the provider's
/// own refusal or the phase 18 budget ceiling, both of which arrive through
/// [`QuotaTracker::is_blocked`] - hands its task to
/// [`AgentProfile::fallback`], if it named one that can work right now. The
/// redirect is spoken on the worker's own log rather than written back onto
/// the queue row: the row is what the user asked for and stays that way, while
/// the worker row and its first system message are what actually happened.
pub async fn dispatch_project(
    store: &Store,
    quota: &QuotaTracker,
    preflight: &PreflightCache,
    profiles: &[AgentProfile],
    project_id: &str,
    launcher: &dyn TaskLauncher,
) -> Result<Option<QueueEntry>, String> {
    // Capacity is counted in employees only: coordinators steer, they do not
    // hold a worktree, so a running orchestrator or queen must never block the
    // workers it is about to order. No project cap means the queue default;
    // zero deliberately pauses dispatch for this project. Return before the
    // worker scan because a paused project has no capacity to calculate.
    let limit = match store
        .get_project(project_id)
        .await?
        .and_then(|project| project.max_workers)
    {
        None => DEFAULT_MAX_CONCURRENT,
        Some(0) => return Ok(None),
        Some(limit) => usize::try_from(limit).unwrap_or(DEFAULT_MAX_CONCURRENT),
    };
    let running = store
        .list_workers(Some(project_id))
        .await?
        .into_iter()
        .filter(|worker| worker.status == STATUS_RUNNING && worker.kind == KIND_WORKER)
        .count();
    if running >= limit {
        return Ok(None);
    }

    // A held-up high-priority item must not head-of-line block another profile
    // that can still work, so the ready list is walked until one entry gets
    // all the way through.
    let candidates: Vec<QueueEntry> = store
        .list_queue(Some(project_id))
        .await?
        .into_iter()
        .filter(|entry| entry.status == QUEUE_READY)
        .collect();

    let now = now_unix_secs();
    for entry in candidates {
        let facts = gather_facts(store, quota, profiles, &entry.profile_id).await;
        let report = preflight.report(&facts, now);

        // A blocker that waiting cannot fix is worth failing the task over,
        // with the repair hint in the error - retrying an unknown profile
        // every thirty seconds forever helps nobody. A transient one leaves
        // the entry exactly where it is: a profile the user switched off is a
        // decision about the future, and the queued task is what they will
        // want back when they switch it on again.
        if !report.permanent().is_empty() {
            store
                .mark_queue_failed(&entry.id, &report.summary())
                .await?;
            continue;
        }
        // Being out of quota is the one hold-up somebody else can absorb, so
        // it is the only one a fallback is consulted for. A profile switched
        // off in settings is not rerouted around: that switch is a decision
        // about which agents may run at all, and honouring it by starting a
        // different agent would be reading it backwards.
        let redirect = if report.is_clear() {
            None
        } else if quota.is_blocked(&entry.profile_id) {
            match resolve_fallback(store, quota, preflight, profiles, &entry.profile_id, now).await
            {
                Some(target) => Some(target),
                None => continue,
            }
        } else {
            continue;
        };
        // Whoever ends up doing the work: the fallback when there is one, the
        // profile on the entry otherwise.
        let launch_as = redirect.clone().unwrap_or_else(|| entry.profile_id.clone());

        // The reservation. Everything above this line was a read, and reads
        // race; from here the entry is this dispatcher's, or it belongs to
        // somebody else and there is nothing to do.
        if !store.claim_queue_entry(&entry.id).await? {
            continue;
        }
        // One last look immediately before the spawn, because the budget
        // watcher runs on its own thread and may have blocked the profile
        // while the claim was being written. The claim is what makes putting
        // it back safe: the entry is off the ready list, so releasing it is a
        // single write nobody else can be in the middle of.
        if quota.is_blocked(&launch_as) {
            store.release_queue_entry(&entry.id).await?;
            continue;
        }

        // The entry as it is handed to the launcher carries the profile that
        // will actually run it; everything else about it is untouched.
        let launched = QueueEntry {
            profile_id: launch_as,
            ..entry.clone()
        };
        return match launcher.launch(&launched).await {
            Ok(worker_id) => {
                // Say the redirect on the worker's own log, first thing. A
                // worker that quietly runs on an agent nobody chose is the
                // failure mode this whole feature has to avoid.
                if let Some(target) = &redirect {
                    let _ = store
                        .insert_message(
                            &worker_id,
                            MSG_SYSTEM,
                            &format!("umgeleitet: {} \u{2192} {target} (Quota)", entry.profile_id),
                        )
                        .await;
                }
                // Launching takes seconds, and two things can be lost inside
                // that window. A cancel takes the *claim*: the worker is
                // already up by then, so tearing it down would throw away real
                // work over a bookkeeping race - and failing the whole sweep
                // would hide it. Say so on the worker's own log and report
                // "nothing dispatched", which is what the queue now believes.
                // An overlapping dispatcher takes the *slot*: the entry is
                // still claimed but the capacity is gone, and then the worker
                // is one too many. It is retired and the task goes back to
                // `ready` to run when a slot frees - the limit the project was
                // given is the limit it keeps.
                if let Err(err) = store
                    .mark_queue_dispatched(&entry.id, &worker_id, limit)
                    .await
                {
                    let still_claimed = store
                        .list_queue(Some(project_id))
                        .await?
                        .into_iter()
                        .any(|row| row.id == entry.id && row.status == QUEUE_DISPATCHING);
                    if still_claimed {
                        store.release_queue_entry(&entry.id).await?;
                        let _ = store.set_worker_status(&worker_id, STATUS_EXITED).await;
                        let _ = store
                            .insert_message(
                                &worker_id,
                                MSG_SYSTEM,
                                "Worker retired: an overlapping dispatch took the project's \
                                 last worker slot; the task went back to the queue",
                            )
                            .await;
                        return Ok(None);
                    }
                    let _ = store
                        .insert_message(
                            &worker_id,
                            "system",
                            &format!("Worker started, but the queue entry was gone: {err}"),
                        )
                        .await;
                    return Ok(None);
                }
                let mut dispatched = entry;
                dispatched.status = QUEUE_DISPATCHED.to_string();
                dispatched.worker_id = Some(worker_id);
                Ok(Some(dispatched))
            }
            Err(err) => {
                store.mark_queue_failed(&entry.id, &err).await?;
                Ok(None)
            }
        };
    }
    Ok(None)
}

/// The profile that should take this task instead, when the one it names is
/// out of quota.
///
/// Walks [`AgentProfile::fallback`] from `profile_id` for at most
/// [`MAX_FALLBACK_DEPTH`] hops and returns the first candidate whose own
/// preflight is clear - so a fallback that is itself blocked, switched off or
/// missing from the registry is passed over rather than spawned into a second
/// failure.
///
/// `None` means "leave the task queued": no fallback was named, the chain ran
/// out, or it bit its own tail.
///
/// `seen` is what makes that last case an immediate, deliberate stop. A pair
/// of profiles that name each other (`A -> B -> A`) is an easy thing to write
/// in `agents.json`; at today's depth of two the walk would end anyway - the
/// profile it came back to is the blocked one - but only by accident of the
/// arithmetic, and re-judging a profile this walk has already judged is not a
/// thing to leave standing behind a constant somebody may raise.
async fn resolve_fallback(
    store: &Store,
    quota: &QuotaTracker,
    preflight: &PreflightCache,
    profiles: &[AgentProfile],
    profile_id: &str,
    now: i64,
) -> Option<String> {
    let find = |id: &str| profiles.iter().find(|profile| profile.id == id);

    let mut seen = vec![profile_id.to_string()];
    let mut current = find(profile_id)?;
    for _ in 0..MAX_FALLBACK_DEPTH {
        let next = current.fallback.clone()?;
        if seen.contains(&next) {
            return None;
        }
        seen.push(next.clone());

        let facts = gather_facts(store, quota, profiles, &next).await;
        if preflight.report(&facts, now).is_clear() {
            return Some(next);
        }
        // Blocked in turn, but it may know somebody who is not.
        current = find(&next)?;
    }
    None
}

/// Run one sweep over every project. Individual launch failures are retained on
/// their queue entry, while store failures are skipped so one bad project does
/// not freeze the others.
///
/// Async on purpose, and awaited exactly once by the dispatcher thread: every
/// `block_on` below this line would be nested inside that one and would panic.
pub async fn dispatch_once(
    store: &Store,
    quota: &QuotaTracker,
    preflight: &PreflightCache,
    launcher: &dyn TaskLauncher,
) -> usize {
    let Ok(projects) = store.list_projects().await else {
        return 0;
    };
    // Once per sweep, not once per entry: `agents.json` is read from disk, and
    // every project in this pass should be judged against the same registry.
    let profiles = crate::profiles::load_profiles();
    let mut dispatched = 0;
    for project in &projects {
        let taken =
            dispatch_project(store, quota, preflight, &profiles, &project.id, launcher).await;
        if let Ok(Some(_)) = taken {
            dispatched += 1;
        }
    }
    dispatched
}

struct LiveLauncher {
    app: AppHandle,
    store: Store,
    engine: Arc<StatusEngine>,
    hook_port: u16,
}

impl TaskLauncher for LiveLauncher {
    fn launch<'a>(
        &'a self,
        entry: &'a QueueEntry,
    ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>> {
        Box::pin(async move {
            let manager = self.app.state::<crate::pty::PtyManager>();
            let agents = crate::PtyAgents::with_port(
                &self.app,
                &manager,
                self.hook_port,
                self.store.clone(),
                Arc::clone(&self.engine),
            );
            // The dispatcher starts the worker, but it is not who ordered it: a
            // queen that hit the employee cap and fell back to `queue add` would
            // otherwise lose her booking the moment the task was dispatched. The
            // entry carries the coordinator through the wait.
            let worker = workers::create_worker(
                &self.store,
                &agents,
                &entry.project_id,
                entry.sharpened_text.as_deref().unwrap_or(&entry.raw_text),
                &entry.profile_id,
                entry.spawned_by.as_deref(),
            )
            .await?;
            self.engine.observe_worker(&worker);
            Ok(worker.id)
        })
    }
}

/// Start the always-on dispatcher at application startup.
pub fn start(
    app: AppHandle,
    store: Store,
    quota: Arc<QuotaTracker>,
    engine: Arc<StatusEngine>,
    hook_port: u16,
) {
    let launcher = LiveLauncher {
        app,
        store: store.clone(),
        engine,
        hook_port,
    };
    // The cache outlives the sweeps, which is the point: a verdict is reused
    // until the facts behind it change or it ages out.
    let preflight = PreflightCache::default();
    // The one and only `block_on` on this path. It is sound because this is a
    // plain OS thread with no runtime entered on it; everything below is
    // awaited, never blocked on again.
    thread::spawn(move || {
        // Claims interrupted by the last process are resolved on the startup
        // reattach thread (`main.rs`), not here: only there is it known which
        // persisted `running` workers survived - respawned, or retired because
        // the checkout is gone - and that is what decides whether a leftover
        // claim is attributed to its worker or released back to `ready`.
        loop {
            let _ = tauri::async_runtime::block_on(dispatch_once(
                &store, &quota, &preflight, &launcher,
            ));
            thread::sleep(POLL_INTERVAL);
        }
    });
}

/// The Tauri command's blocking enhancement call. Keeping it here makes the
/// command a thin adapter and keeps all state transitions testable above.
// The queue row simply has this many independent columns; bundling them
// into a params struct would only move the same list one level away.
#[allow(clippy::too_many_arguments)]
pub async fn enqueue(
    app: AppHandle,
    store: Store,
    project_id: String,
    raw_text: String,
    profile_id: Option<String>,
    sharpen: bool,
    priority: Option<i32>,
    spawned_by: Option<String>,
) -> Result<QueueEntry, String> {
    if raw_text.trim().is_empty() {
        return Err("task is required".to_string());
    }
    if store.get_project(&project_id).await?.is_none() {
        return Err(format!("{}project: {project_id}", workers::ERR_UNKNOWN));
    }
    let profile_id = profile_id.unwrap_or_else(|| "claude".to_string());
    let entry = QueueEntry {
        id: new_id("tq"),
        project_id,
        raw_text,
        sharpened_text: None,
        profile_id,
        status: if sharpen {
            QUEUE_SHARPENING.into()
        } else {
            QUEUE_READY.into()
        },
        priority: priority.unwrap_or(0),
        worker_id: None,
        error: None,
        spawned_by,
        created_at: now_unix_secs(),
    };
    store.insert_queue_entry(&entry).await?;
    if !sharpen {
        return Ok(entry);
    }

    let enhanced = match enhance::bundled_skill_dir(&app) {
        Err(_) => None,
        Ok(skill) => {
            let draft = entry.raw_text.clone();
            let profile = entry.profile_id.clone();
            tauri::async_runtime::spawn_blocking(move || {
                // `Ask::Never`: this run has nobody in front of it. A
                // question from here would have no way back to a person, and
                // the entry would sit in `sharpening` waiting for one.
                enhance::enhance(&skill, &draft, Some(&profile), enhance::Ask::Never)
                    .map(|result| result.enhanced)
            })
            .await
            .ok()
            .and_then(Result::ok)
            .flatten()
        }
    };
    store
        .set_queue_ready_result(&entry.id, enhanced.as_deref())
        .await
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::store::{WorkerRow, KIND_ORCHESTRATOR, KIND_QUEEN, KIND_SCOUT, KIND_WORKER};
    use crate::testutil::TempDir;

    /// Records `(entry id, profile id)` per launch. The profile is what the
    /// failover tests are about: it is the only place the redirect shows.
    struct FakeLauncher {
        calls: Mutex<Vec<(String, String)>>,
    }

    /// A launcher that writes the worker row it would have created, which is
    /// where `spawned_by` has to arrive for the booking to survive dispatch.
    #[derive(Default)]
    struct RecordingLauncher {
        rows: Mutex<Vec<WorkerRow>>,
    }

    impl TaskLauncher for RecordingLauncher {
        fn launch<'a>(
            &'a self,
            entry: &'a QueueEntry,
        ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>> {
            Box::pin(async move {
                let id = format!("wk-{}", entry.id);
                let mut row = running_worker(&entry.project_id, &id, KIND_WORKER);
                row.spawned_by.clone_from(&entry.spawned_by);
                self.rows.lock().unwrap().push(row);
                Ok(id)
            })
        }
    }

    impl FakeLauncher {
        fn new() -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
            }
        }
    }

    impl TaskLauncher for FakeLauncher {
        fn launch<'a>(
            &'a self,
            entry: &'a QueueEntry,
        ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>> {
            Box::pin(async move {
                self.calls
                    .lock()
                    .unwrap()
                    .push((entry.id.clone(), entry.profile_id.clone()));
                Ok(format!("wk-{}", entry.id))
            })
        }
    }

    /// The profile registry the dispatcher tests run against: the built-ins,
    /// so `claude` and `kimi` are known and nothing carries a fallback. Tests
    /// about failover build their own.
    fn registry() -> Vec<AgentProfile> {
        crate::profiles::default_profiles()
    }

    async fn fixture() -> (TempDir, Store, String) {
        let dir = TempDir::new("queue");
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let project = store.create_project("one", "C:/repo/one").await.unwrap();
        (dir, store, project.id)
    }

    #[test]
    fn queue_dispatch_disabled_recognizes_the_off_switches() {
        for value in ["off", "OFF", " off ", "0", "false", "False"] {
            assert!(
                queue_dispatch_disabled(Some(value)),
                "{value:?} must switch the dispatcher off"
            );
        }
    }

    #[test]
    fn queue_dispatch_disabled_keeps_the_historical_default() {
        assert!(!queue_dispatch_disabled(None));
        for value in ["", "on", "1", "true", "yes", "later"] {
            assert!(
                !queue_dispatch_disabled(Some(value)),
                "{value:?} must keep the dispatcher running"
            );
        }
    }

    #[tokio::test]
    async fn enqueue_supports_plain_and_mocked_sharpened_tasks() {
        let (_dir, store, project) = fixture().await;
        let plain = enqueue_with_enhancer(
            &store,
            &project,
            "plain",
            None,
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        assert_eq!(plain.status, QUEUE_READY);
        assert_eq!(plain.sharpened_text, None);

        let enhanced = enqueue_with_enhancer(
            &store,
            &project,
            "rough",
            Some("kimi".into()),
            true,
            Some(4),
            None,
            |draft, profile| Ok(format!("{profile}: {draft}")),
        )
        .await
        .unwrap();
        assert_eq!(enhanced.status, QUEUE_READY);
        assert_eq!(enhanced.sharpened_text.as_deref(), Some("kimi: rough"));
        assert_eq!(enhanced.priority, 4);

        let fallback = enqueue_with_enhancer(
            &store,
            &project,
            "keep me",
            None,
            true,
            None,
            None,
            |_, _| Err("offline".into()),
        )
        .await
        .unwrap();
        assert_eq!(fallback.status, QUEUE_READY);
        assert_eq!(fallback.sharpened_text, None);
    }

    /// A running row with the given kind - the fixtures below need many of
    /// them and only ever vary id and kind.
    fn running_worker(project: &str, id: &str, kind: &str) -> WorkerRow {
        WorkerRow {
            id: id.into(),
            project_id: project.into(),
            task: "running".into(),
            profile_id: "claude".into(),
            branch: String::new(),
            worktree_path: String::new(),
            status: STATUS_RUNNING.into(),
            kind: kind.into(),
            pr_url: None,
            spawned_by: None,
            test_status: None,
            tested_at: None,
            role_variant_id: None,
            paused_reason: None,
            created_at: 1,
        }
    }

    #[tokio::test]
    async fn priority_wins_and_capacity_never_exceeds_the_limit() {
        let (_dir, store, project) = fixture().await;
        // The project has no cap of its own, so the default of four applies.
        for id in ["one", "two", "three"] {
            store
                .insert_worker(&running_worker(&project, id, KIND_WORKER))
                .await
                .unwrap();
        }
        let low = enqueue_with_enhancer(
            &store,
            &project,
            "low",
            None,
            false,
            Some(1),
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        let high = enqueue_with_enhancer(
            &store,
            &project,
            "high",
            None,
            false,
            Some(9),
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        let quota = QuotaTracker::default();
        let launcher = FakeLauncher::new();
        let dispatched = dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher,
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(dispatched.id, high.id);
        assert_ne!(dispatched.id, low.id);
        // Simulate the just-created worker: the next pass is at capacity.
        store
            .insert_worker(&running_worker(&project, "four", KIND_WORKER))
            .await
            .unwrap();
        assert!(dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher
        )
        .await
        .unwrap()
        .is_none());
        assert_eq!(launcher.calls.lock().unwrap().len(), 1);
    }

    struct OverlappingLauncher {
        store: Store,
        both_claimed: tokio::sync::Barrier,
    }

    impl TaskLauncher for OverlappingLauncher {
        fn launch<'a>(
            &'a self,
            entry: &'a QueueEntry,
        ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>> {
            Box::pin(async move {
                self.both_claimed.wait().await;
                let id = format!("wk-{}", entry.id);
                self.store
                    .insert_worker(&running_worker(&entry.project_id, &id, KIND_WORKER))
                    .await?;
                Ok(id)
            })
        }
    }

    #[tokio::test]
    async fn overlapping_dispatchers_must_share_the_projects_single_worker_slot() {
        let (_dir, store, project) = fixture().await;
        store
            .set_project_max_workers(&project, Some(1))
            .await
            .unwrap();
        for task in ["first", "second"] {
            enqueue_with_enhancer(
                &store,
                &project,
                task,
                None,
                false,
                None,
                None,
                |_, _| unreachable!(),
            )
            .await
            .unwrap();
        }
        let launcher = OverlappingLauncher {
            store: store.clone(),
            both_claimed: tokio::sync::Barrier::new(2),
        };
        let quota = QuotaTracker::default();
        let preflight = PreflightCache::default();
        let profiles = registry();

        let (first, second) = tokio::join!(
            dispatch_project(&store, &quota, &preflight, &profiles, &project, &launcher,),
            dispatch_project(&store, &quota, &preflight, &profiles, &project, &launcher,),
        );
        first.unwrap();
        second.unwrap();

        let running = store
            .list_workers(Some(&project))
            .await
            .unwrap()
            .into_iter()
            .filter(|worker| worker.status == STATUS_RUNNING && worker.kind == KIND_WORKER)
            .count();
        assert_eq!(running, 1);
    }

    /// A launcher that awaits the store, exactly like the real one awaits
    /// `create_worker`. Anything that merely returns `Ok` without ever
    /// suspending would pass the test below even with the bug in place.
    struct AwaitingLauncher {
        store: Store,
    }

    impl TaskLauncher for AwaitingLauncher {
        fn launch<'a>(
            &'a self,
            entry: &'a QueueEntry,
        ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>> {
            Box::pin(async move {
                let id = format!("wk-{}", entry.id);
                self.store
                    .insert_worker(&running_worker(&entry.project_id, &id, KIND_WORKER))
                    .await?;
                Ok(id)
            })
        }
    }

    /// Regression: the dispatcher runs on a plain OS thread and drives the
    /// whole sweep from one `block_on`. A launcher that blocked on a runtime
    /// again from inside that sweep would panic with "Cannot start a runtime
    /// from within a runtime", and because the panic unwinds out of the thread
    /// closure it would kill the dispatcher silently - no log, nothing joined,
    /// the queue simply dead for the rest of the session. This reproduces that
    /// exact shape: real thread, one `block_on`, a launcher that suspends.
    #[test]
    fn the_dispatcher_survives_a_launcher_that_awaits() {
        let handle = thread::spawn(|| {
            tauri::async_runtime::block_on(async {
                let (_dir, store, project) = fixture().await;
                enqueue_with_enhancer(
                    &store,
                    &project,
                    "work",
                    None,
                    false,
                    None,
                    None,
                    |_, _| unreachable!(),
                )
                .await
                .unwrap();
                let quota = QuotaTracker::default();
                let launcher = AwaitingLauncher {
                    store: store.clone(),
                };
                let count =
                    dispatch_once(&store, &quota, &PreflightCache::default(), &launcher).await;
                let queue = store.list_queue(Some(&project)).await.unwrap();
                (count, queue[0].status.clone(), queue[0].worker_id.clone())
            })
        });
        let (count, status, worker_id) = handle.join().expect("dispatcher thread must survive");
        assert_eq!(count, 1);
        assert_eq!(status, QUEUE_DISPATCHED);
        assert!(worker_id.is_some());
    }

    /// A launcher that tries to cancel the entry while it is "starting the
    /// worker" - the real race, where the user hits cancel during the seconds
    /// a worktree and a PTY take. The attempt's outcome is recorded rather
    /// than raised, because the outcome is what the test is about.
    struct CancellingLauncher {
        store: Store,
        cancelled: Mutex<Option<Result<(), String>>>,
    }

    impl TaskLauncher for CancellingLauncher {
        fn launch<'a>(
            &'a self,
            entry: &'a QueueEntry,
        ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>> {
            Box::pin(async move {
                let id = format!("wk-{}", entry.id);
                self.store
                    .insert_worker(&running_worker(&entry.project_id, &id, KIND_WORKER))
                    .await?;
                let outcome = self.store.cancel_queue_entry(&entry.id).await;
                *self.cancelled.lock().unwrap() = Some(outcome);
                Ok(id)
            })
        }
    }

    /// The claim is what closes the cancel race. A claimed entry is no longer
    /// "queued or ready", so the cancel is refused *while* the worker starts -
    /// which is the honest answer: the work is already under way, and the user
    /// is told so instead of ending up with a running agent whose queue row
    /// somebody deleted underneath it.
    #[tokio::test]
    async fn cancelling_during_the_launch_is_refused_rather_than_orphaning_the_worker() {
        let (_dir, store, project) = fixture().await;
        let entry = enqueue_with_enhancer(
            &store,
            &project,
            "work",
            None,
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        let quota = QuotaTracker::default();
        let launcher = CancellingLauncher {
            store: store.clone(),
            cancelled: Mutex::new(None),
        };
        let dispatched = dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher,
        )
        .await
        .unwrap()
        .expect("the entry was claimed, so the launch counts");
        assert_eq!(dispatched.id, entry.id);

        let refusal = launcher
            .cancelled
            .lock()
            .unwrap()
            .clone()
            .expect("cancel attempted");
        assert!(
            refusal.unwrap_err().contains("not queued or ready"),
            "a claimed entry may not be cancelled out from under its own launch"
        );

        let rows = store.list_queue(Some(&project)).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, QUEUE_DISPATCHED);
        assert_eq!(
            rows[0].worker_id.as_deref(),
            Some(format!("wk-{}", entry.id).as_str())
        );
    }

    /// A launcher whose entry stops being claimed while the worker starts -
    /// one of the two ways `mark_queue_dispatched` can come back empty (the
    /// other is the slot going to an overlapping dispatch). The worker is
    /// already up by then, so it stays running and says why.
    struct StolenEntryLauncher {
        store: Store,
    }

    impl TaskLauncher for StolenEntryLauncher {
        fn launch<'a>(
            &'a self,
            entry: &'a QueueEntry,
        ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>> {
            Box::pin(async move {
                let id = format!("wk-{}", entry.id);
                self.store
                    .insert_worker(&running_worker(&entry.project_id, &id, KIND_WORKER))
                    .await?;
                self.store
                    .mark_queue_failed(&entry.id, "taken elsewhere")
                    .await?;
                Ok(id)
            })
        }
    }

    #[tokio::test]
    async fn a_worker_whose_entry_moved_on_stays_running_and_says_so() {
        let (_dir, store, project) = fixture().await;
        let entry = enqueue_with_enhancer(
            &store,
            &project,
            "work",
            None,
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        let quota = QuotaTracker::default();
        let launcher = StolenEntryLauncher {
            store: store.clone(),
        };
        assert!(dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher
        )
        .await
        .unwrap()
        .is_none());

        let worker_id = format!("wk-{}", entry.id);
        let workers = store.list_workers(Some(&project)).await.unwrap();
        assert!(workers.iter().any(|w| w.id == worker_id));
        let messages = store.list_messages(&worker_id, None).await.unwrap();
        assert!(
            messages
                .iter()
                .any(|m| m.content.contains("queue entry was gone")),
            "the orphaned worker has to say why it has no queue entry"
        );
    }

    /// A claim whose worker was started (only `mark_queue_dispatched` never
    /// landed) plus that worker, left behind by a process that died - the
    /// state the startup recovery in `main.rs` meets.
    async fn claim_with_started_worker(store: &Store, project: &str) -> String {
        let entry = enqueue_with_enhancer(
            store,
            project,
            "exactly once",
            None,
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        assert!(store.claim_queue_entry(&entry.id).await.unwrap());
        let mut worker = running_worker(project, "wk-started", KIND_WORKER);
        worker.task = "exactly once".into();
        store.insert_worker(&worker).await.unwrap();
        entry.id
    }

    /// KI-23: the worker waits for an explicit respawn, so the claim stays
    /// with it. Handing it back to `ready` would start the task a second
    /// time under a cap above 0 - two worktrees for one task. Runs the real
    /// startup sequence from `main.rs`, not a copy of its order.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_claim_whose_worker_started_stays_with_it_after_the_reattach_pass() {
        let (_dir, store, project) = fixture().await;
        let entry = claim_with_started_worker(&store, &project).await;

        // Worktree on disk, profile enabled: `AwaitExplicitRespawn`.
        crate::reattach_workers_and_resolve_claims(&store, |_| true, |_| true).await;

        let rows = store.list_queue(Some(&project)).await.unwrap();
        assert_eq!(rows[0].id, entry);
        assert_eq!(
            rows[0].status, QUEUE_DISPATCHED,
            "the claim belongs to the worker that was started for it"
        );
        assert_eq!(rows[0].worker_id.as_deref(), Some("wk-started"));
        // The second half of the sequence: the worker still waits for the
        // board afterwards, it is not left `running` with no process.
        let worker = store.get_worker("wk-started").await.unwrap().unwrap();
        assert_eq!(worker.status, STATUS_EXITED);
    }

    /// KI-23, review finding B3.1: the app dies between the claim release
    /// and retiring the waiting workers (claim `dispatched`, worker still
    /// `running`). The next start must end in the same state as an
    /// uninterrupted one - the claim stays put, the worker is retired.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_start_interrupted_after_the_claim_release_is_repeated_without_harm() {
        let (_dir, store, project) = fixture().await;
        claim_with_started_worker(&store, &project).await;
        // The claim release landed, retiring the waiting worker did not.
        assert_eq!(store.release_claimed_queue_entries().await.unwrap(), 1);

        crate::reattach_workers_and_resolve_claims(&store, |_| true, |_| true).await;

        let rows = store.list_queue(Some(&project)).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, QUEUE_DISPATCHED);
        assert_eq!(rows[0].worker_id.as_deref(), Some("wk-started"));
        let worker = store.get_worker("wk-started").await.unwrap().unwrap();
        assert_eq!(worker.status, STATUS_EXITED);
    }

    /// KI-23, the other half: the worker's worktree is gone (`MarkExited`),
    /// so it can never run the task. The claim goes back to `ready` and the
    /// next sweep starts it for real - attributing it would lose the task.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_claim_whose_worktree_is_gone_goes_back_to_ready_after_the_reattach_pass() {
        let (_dir, store, project) = fixture().await;
        claim_with_started_worker(&store, &project).await;

        crate::reattach_workers_and_resolve_claims(&store, |_| false, |_| true).await;

        let rows = store.list_queue(Some(&project)).await.unwrap();
        assert_eq!(rows[0].status, QUEUE_READY);
        assert_eq!(rows[0].worker_id, None);
    }

    /// KI-23, unchanged by the fix: a worker the pass skips (profile switched
    /// off; a budget pause takes the same branch) stays `running`, and its
    /// claim stays with it - `dispatched` without a live process until the
    /// board respawns it, never a second start.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_claim_whose_worker_is_skipped_stays_with_it_after_the_reattach_pass() {
        let (_dir, store, project) = fixture().await;
        claim_with_started_worker(&store, &project).await;

        crate::reattach_workers_and_resolve_claims(&store, |_| true, |_| false).await;

        let rows = store.list_queue(Some(&project)).await.unwrap();
        assert_eq!(rows[0].status, QUEUE_DISPATCHED);
        assert_eq!(rows[0].worker_id.as_deref(), Some("wk-started"));
        let worker = store.get_worker("wk-started").await.unwrap().unwrap();
        assert_eq!(worker.status, STATUS_RUNNING);
    }

    /// The budget-pause branch of the same guard (review, deepseek-v4-flash).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_claim_whose_worker_is_paused_stays_with_it_after_the_reattach_pass() {
        let (_dir, store, project) = fixture().await;
        let entry = enqueue_with_enhancer(
            &store,
            &project,
            "exactly once",
            None,
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        assert!(store.claim_queue_entry(&entry.id).await.unwrap());
        let mut worker = running_worker(&project, "wk-paused", KIND_WORKER);
        worker.task = "exactly once".into();
        worker.paused_reason = Some("budget ceiling".into());
        store.insert_worker(&worker).await.unwrap();

        crate::reattach_workers_and_resolve_claims(&store, |_| true, |_| true).await;

        let rows = store.list_queue(Some(&project)).await.unwrap();
        assert_eq!(rows[0].status, QUEUE_DISPATCHED);
        assert_eq!(rows[0].worker_id.as_deref(), Some("wk-paused"));
        let worker = store.get_worker("wk-paused").await.unwrap().unwrap();
        assert_eq!(worker.status, STATUS_RUNNING);
    }

    #[tokio::test]
    async fn a_second_dispatcher_must_not_release_and_duplicate_an_active_claim() {
        let (_dir, store, project) = fixture().await;
        let entry = enqueue_with_enhancer(
            &store,
            &project,
            "exactly once",
            None,
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        assert!(store.claim_queue_entry(&entry.id).await.unwrap());
        // The dispatcher's own worker: it carries exactly this task, which is
        // what the startup recovery matches on.
        let mut worker = running_worker(&project, "wk-first-dispatcher", KIND_WORKER);
        worker.task = "exactly once".into();
        store.insert_worker(&worker).await.unwrap();

        assert_eq!(store.release_claimed_queue_entries().await.unwrap(), 1);

        let launcher = FakeLauncher::new();
        let dispatched = dispatch_project(
            &store,
            &QuotaTracker::default(),
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher,
        )
        .await
        .unwrap();
        assert!(dispatched.is_none());
        assert!(launcher.calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_running_worker_with_an_unrelated_task_is_not_attributed_the_claim() {
        let (_dir, store, project) = fixture().await;
        let entry = enqueue_with_enhancer(
            &store,
            &project,
            "the claimed task",
            None,
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        assert!(store.claim_queue_entry(&entry.id).await.unwrap());
        // A hand-started worker on something else entirely: attributing the
        // claim to it would mark the task dispatched without it ever running.
        store
            .insert_worker(&running_worker(&project, "wk-hand-started", KIND_WORKER))
            .await
            .unwrap();

        assert_eq!(store.release_claimed_queue_entries().await.unwrap(), 1);

        let rows = store.list_queue(Some(&project)).await.unwrap();
        assert_eq!(
            rows[0].status, QUEUE_READY,
            "a claim whose work never started goes back, not to a stranger"
        );
        assert_eq!(rows[0].worker_id, None);
    }

    /// Interruption between the claim and the bookkeeping, with sharpening
    /// on: the worker was already spawned with the *sharpened* prompt when
    /// the app died, so startup recovery has to match on that text. Matching
    /// the raw text instead would free the claim, and the next sweep would
    /// spawn the task a second time - the double the F5 acceptance forbids.
    #[tokio::test]
    async fn a_sharpened_worker_keeps_its_claim_after_a_crash_mid_dispatch() {
        let (_dir, store, project) = fixture().await;
        let entry = enqueue_with_enhancer(
            &store,
            &project,
            "rough task",
            None,
            true,
            None,
            None,
            |draft, _| Ok(format!("sharpened: {draft}")),
        )
        .await
        .unwrap();
        assert_eq!(
            entry.sharpened_text.as_deref(),
            Some("sharpened: rough task")
        );
        assert!(store.claim_queue_entry(&entry.id).await.unwrap());
        // The launcher had already spawned the worker on the sharpened
        // prompt; the app died before the dispatch bookkeeping landed.
        let mut worker = running_worker(&project, "wk-sharpened", KIND_WORKER);
        worker.task = "sharpened: rough task".into();
        store.insert_worker(&worker).await.unwrap();

        assert_eq!(store.release_claimed_queue_entries().await.unwrap(), 1);

        let rows = store.list_queue(Some(&project)).await.unwrap();
        assert_eq!(
            rows[0].status, QUEUE_DISPATCHED,
            "the claim belongs to the worker that is already running it"
        );
        assert_eq!(rows[0].worker_id.as_deref(), Some("wk-sharpened"));

        // The next sweep must find nothing to do: no second spawn.
        let launcher = FakeLauncher::new();
        let dispatched = dispatch_project(
            &store,
            &QuotaTracker::default(),
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher,
        )
        .await
        .unwrap();
        assert!(dispatched.is_none());
        assert!(
            launcher.calls.lock().unwrap().is_empty(),
            "an attributed claim must not be dispatched again"
        );
    }

    /// Interruption between the claim and the spawn, without a worker: the
    /// orphan goes back to `ready` at startup, and the sweep after the
    /// restart runs the task exactly once.
    #[tokio::test]
    async fn an_orphaned_claim_is_dispatched_exactly_once_after_the_restart() {
        let (_dir, store, project) = fixture().await;
        let entry = enqueue_with_enhancer(
            &store,
            &project,
            "run me once",
            None,
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        assert!(store.claim_queue_entry(&entry.id).await.unwrap());
        // The app died here: claimed, but nothing was ever spawned.

        assert_eq!(store.release_claimed_queue_entries().await.unwrap(), 1);
        let rows = store.list_queue(Some(&project)).await.unwrap();
        assert_eq!(rows[0].status, QUEUE_READY);

        let launcher = FakeLauncher::new();
        let first = dispatch_project(
            &store,
            &QuotaTracker::default(),
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher,
        )
        .await
        .unwrap();
        assert!(first.is_some(), "the orphaned task must still run");
        assert_eq!(launcher.calls.lock().unwrap().len(), 1);

        let second = dispatch_project(
            &store,
            &QuotaTracker::default(),
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher,
        )
        .await
        .unwrap();
        assert!(second.is_none());
        assert_eq!(
            launcher.calls.lock().unwrap().len(),
            1,
            "one task, one spawn - even across an interrupted dispatch"
        );
    }

    /// KI-13 / W1-16: a project whose cap is 0 is switched off, and a restart
    /// must not switch it back on. Orphaned claims (the updater E2E left four)
    /// go back to `ready` at startup and stay there until the cap is raised -
    /// the recovery path is held to the same limit as a normal sweep.
    ///
    /// This covers the store and dispatcher halves; the reattach order itself
    /// is covered by the KI-23 tests above, and the dispatcher thread's start
    /// needs a Tauri app. What makes startup safe for a cap of 0 is that
    /// neither the reattach pass nor the claim release ever starts an agent.
    #[tokio::test]
    async fn orphaned_claims_stay_ready_after_the_restart_while_the_cap_is_zero() {
        let (_dir, store, project) = fixture().await;
        let mut ids = Vec::new();
        for text in ["orphan-1", "orphan-2", "orphan-3", "orphan-4"] {
            let entry = enqueue_with_enhancer(
                &store,
                &project,
                text,
                None,
                false,
                None,
                None,
                |_, _| unreachable!(),
            )
            .await
            .unwrap();
            assert!(store.claim_queue_entry(&entry.id).await.unwrap());
            ids.push(entry.id);
        }
        store
            .set_project_max_workers(&project, Some(0))
            .await
            .unwrap();
        // The app died here: four claims, no worker behind any of them.

        assert_eq!(store.release_claimed_queue_entries().await.unwrap(), 4);
        let launcher = FakeLauncher::new();
        for _ in 0..ids.len() + 1 {
            let taken = dispatch_project(
                &store,
                &QuotaTracker::default(),
                &PreflightCache::default(),
                &registry(),
                &project,
                &launcher,
            )
            .await
            .unwrap();
            assert!(taken.is_none(), "a cap of 0 dispatches nothing");
        }
        assert!(
            launcher.calls.lock().unwrap().is_empty(),
            "the restart must not spawn orphaned claims of a paused project"
        );
        let rows = store.list_queue(Some(&project)).await.unwrap();
        assert_eq!(rows.len(), 4, "no orphan may be lost either");
        assert!(rows.iter().all(|row| row.status == QUEUE_READY));

        // Raising the cap is what lets them run - one sweep, one task.
        store
            .set_project_max_workers(&project, Some(1))
            .await
            .unwrap();
        assert!(dispatch_project(
            &store,
            &QuotaTracker::default(),
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher,
        )
        .await
        .unwrap()
        .is_some());
        assert_eq!(launcher.calls.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_claim_is_taken_once_and_released_intact() {
        let (_dir, store, project) = fixture().await;
        let entry = enqueue_with_enhancer(
            &store,
            &project,
            "work",
            None,
            false,
            Some(5),
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        assert!(store.claim_queue_entry(&entry.id).await.unwrap());
        // The second caller finds it taken: that is the whole mechanism.
        assert!(!store.claim_queue_entry(&entry.id).await.unwrap());

        store.release_queue_entry(&entry.id).await.unwrap();
        let rows = store.list_queue(Some(&project)).await.unwrap();
        assert_eq!(rows[0].status, QUEUE_READY);
        assert_eq!(
            rows[0].priority, 5,
            "a released claim costs the entry nothing"
        );

        // A claim left behind by a process that died is freed at startup.
        assert!(store.claim_queue_entry(&entry.id).await.unwrap());
        assert_eq!(store.release_claimed_queue_entries().await.unwrap(), 1);
        assert_eq!(store.release_claimed_queue_entries().await.unwrap(), 0);
        let rows = store.list_queue(Some(&project)).await.unwrap();
        assert_eq!(rows[0].status, QUEUE_READY);
    }

    /// Orchestrators, queens and scouts steer; they never hold an employee
    /// slot, so a project full of coordinators still dispatches.
    #[tokio::test]
    async fn coordinators_do_not_count_against_the_limit() {
        let (_dir, store, project) = fixture().await;
        store
            .insert_worker(&running_worker(&project, "orch", KIND_ORCHESTRATOR))
            .await
            .unwrap();
        store
            .insert_worker(&running_worker(&project, "queen", KIND_QUEEN))
            .await
            .unwrap();
        store
            .insert_worker(&running_worker(&project, "scout", KIND_SCOUT))
            .await
            .unwrap();
        for id in ["one", "two", "three"] {
            store
                .insert_worker(&running_worker(&project, id, KIND_WORKER))
                .await
                .unwrap();
        }
        enqueue_with_enhancer(
            &store,
            &project,
            "next",
            None,
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();

        let quota = QuotaTracker::default();
        let launcher = FakeLauncher::new();
        // Three employees plus three coordinators are below the employee cap.
        assert!(dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher
        )
        .await
        .unwrap()
        .is_some());

        // The fourth employee fills the cap; the coordinators change nothing.
        store
            .insert_worker(&running_worker(&project, "four", KIND_WORKER))
            .await
            .unwrap();
        enqueue_with_enhancer(
            &store,
            &project,
            "later",
            None,
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        assert!(dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher
        )
        .await
        .unwrap()
        .is_none());
        assert_eq!(launcher.calls.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn the_projects_own_limit_overrides_the_default() {
        let (_dir, store, project) = fixture().await;
        store
            .set_project_max_workers(&project, Some(2))
            .await
            .unwrap();
        store
            .insert_worker(&running_worker(&project, "one", KIND_WORKER))
            .await
            .unwrap();
        enqueue_with_enhancer(
            &store,
            &project,
            "next",
            None,
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        let quota = QuotaTracker::default();
        let launcher = FakeLauncher::new();

        // One of two slots is taken: dispatch. Then the cap is full.
        assert!(dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher
        )
        .await
        .unwrap()
        .is_some());
        store
            .insert_worker(&running_worker(&project, "two", KIND_WORKER))
            .await
            .unwrap();
        enqueue_with_enhancer(
            &store,
            &project,
            "blocked",
            None,
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        assert!(dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher
        )
        .await
        .unwrap()
        .is_none());

        // Clearing the cap returns to the default.
        store.set_project_max_workers(&project, None).await.unwrap();
        assert!(dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher
        )
        .await
        .unwrap()
        .is_some());
        store
            .set_project_max_workers(&project, Some(0))
            .await
            .unwrap();
        // The launcher is a fake and inserts no worker rows, so the two
        // dispatches above left the queue empty - a third task is what makes
        // this assertion about the cap rather than about an empty queue.
        enqueue_with_enhancer(
            &store,
            &project,
            "after-zero",
            None,
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        assert!(dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher
        )
        .await
        .unwrap()
        .is_none());
        assert_eq!(launcher.calls.lock().unwrap().len(), 2);
        assert!(store
            .list_queue(Some(&project))
            .await
            .unwrap()
            .iter()
            .any(|task| task.raw_text == "after-zero" && task.status == QUEUE_READY));
    }

    /// Phase 12 A3: a task booked by a coordinator hands that booking to the
    /// worker the dispatcher makes out of it. The launcher here is the real
    /// question - the entry alone proves nothing.
    #[tokio::test]
    async fn a_dispatched_task_hands_its_coordinator_to_the_worker() {
        let (_dir, store, project) = fixture().await;
        let entry = enqueue_with_enhancer(
            &store,
            &project,
            "for the queen",
            None,
            false,
            None,
            Some("wk-queen".to_string()),
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        assert_eq!(entry.spawned_by.as_deref(), Some("wk-queen"));

        let quota = QuotaTracker::default();
        let launcher = RecordingLauncher::default();
        let dispatched = dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher,
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(dispatched.spawned_by.as_deref(), Some("wk-queen"));
        assert_eq!(
            launcher.rows.lock().unwrap()[0].spawned_by.as_deref(),
            Some("wk-queen")
        );

        // A task nobody booked still produces a worker nobody booked.
        enqueue_with_enhancer(
            &store,
            &project,
            "for nobody",
            None,
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher,
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(launcher.rows.lock().unwrap()[1].spawned_by, None);
    }

    /// Phase 14: a profile switched off in settings is skipped exactly like a
    /// quota-blocked one - the task keeps its place instead of being retried
    /// into failure every thirty seconds.
    #[tokio::test]
    async fn a_disabled_profile_is_skipped_and_its_task_stays_ready() {
        let (_dir, store, project) = fixture().await;
        let disabled = enqueue_with_enhancer(
            &store,
            &project,
            "later",
            Some("claude".into()),
            false,
            Some(9),
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        let available = enqueue_with_enhancer(
            &store,
            &project,
            "now",
            Some("kimi".into()),
            false,
            Some(1),
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        learnings::set_profile_enabled(&store, "claude", false)
            .await
            .unwrap();
        let quota = QuotaTracker::default();
        let launcher = FakeLauncher::new();

        // The higher-priority task is the disabled one, so this only passes if
        // the dispatcher skipped it rather than stopping at it.
        let dispatched = dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher,
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(dispatched.id, available.id);
        assert!(store
            .list_queue(Some(&project))
            .await
            .unwrap()
            .iter()
            .any(|task| task.id == disabled.id && task.status == QUEUE_READY));

        // Nothing else is dispatchable while the profile stays off.
        assert!(dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher
        )
        .await
        .unwrap()
        .is_none());

        // Switching it back on releases the task, unchanged.
        learnings::set_profile_enabled(&store, "claude", true)
            .await
            .unwrap();
        let dispatched = dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher,
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(dispatched.id, disabled.id);
    }

    #[tokio::test]
    async fn blocked_profiles_stay_ready_and_only_ready_tasks_cancel() {
        let (_dir, store, project) = fixture().await;
        let entry = enqueue_with_enhancer(
            &store,
            &project,
            "later",
            Some("claude".into()),
            false,
            Some(9),
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        let available = enqueue_with_enhancer(
            &store,
            &project,
            "now",
            Some("kimi".into()),
            false,
            Some(1),
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        let quota = QuotaTracker::default();
        quota.note_blocked("claude", "limit", None);
        let launcher = FakeLauncher::new();
        let dispatched = dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &registry(),
            &project,
            &launcher,
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(dispatched.id, available.id);
        assert!(store
            .list_queue(Some(&project))
            .await
            .unwrap()
            .iter()
            .any(|task| task.id == entry.id && task.status == QUEUE_READY));
        store.cancel_queue_entry(&entry.id).await.unwrap();
        assert!(store.cancel_queue_entry(&entry.id).await.is_err());
    }

    /// A launcher that must never be reached.
    struct NeverLauncher;

    impl TaskLauncher for NeverLauncher {
        fn launch<'a>(
            &'a self,
            _entry: &'a QueueEntry,
        ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>> {
            Box::pin(async move { unreachable!("preflight should have stopped this") })
        }
    }

    #[tokio::test]
    async fn a_profile_that_does_not_exist_fails_the_task_with_a_repair_hint() {
        let (_dir, store, project) = fixture().await;
        let entry = enqueue_with_enhancer(
            &store,
            &project,
            "work",
            Some("nosuchagent".into()),
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();

        let quota = QuotaTracker::default();
        assert!(dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &registry(),
            &project,
            &NeverLauncher
        )
        .await
        .unwrap()
        .is_none());

        // Failed, not retried forever - and the error says what to do.
        let rows = store.list_queue(Some(&project)).await.unwrap();
        assert_eq!(rows[0].id, entry.id);
        assert_eq!(rows[0].status, crate::store::QUEUE_FAILED);
        let error = rows[0].error.clone().expect("a failed task says why");
        assert!(error.contains("nosuchagent"), "{error}");
        assert!(error.contains("agents.json"), "{error}");
    }

    /// A launcher that blocks the profile the moment it is asked to start -
    /// standing in for the budget watcher, which runs on its own thread and
    /// can land in exactly this gap.
    struct BlockingLauncher {
        quota: Arc<QuotaTracker>,
    }

    impl TaskLauncher for BlockingLauncher {
        fn launch<'a>(
            &'a self,
            _entry: &'a QueueEntry,
        ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>> {
            Box::pin(async move { unreachable!("the profile was blocked before the spawn") })
        }
    }

    #[tokio::test]
    async fn a_profile_blocked_between_the_claim_and_the_spawn_puts_the_task_back() {
        let (_dir, store, project) = fixture().await;
        let entry = enqueue_with_enhancer(
            &store,
            &project,
            "work",
            None,
            false,
            Some(3),
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();

        // Clear when the preflight ran, blocked by the time the claim is in:
        // the report is taken from the cache with facts read a moment earlier,
        // which is exactly the window the last-look check exists for.
        let quota = Arc::new(QuotaTracker::default());
        let preflight = PreflightCache::default();
        let facts = gather_facts(&store, &quota, &registry(), "claude").await;
        assert!(preflight.report(&facts, now_unix_secs()).is_clear());
        quota.note_blocked(
            "claude",
            "Budget: 5-Stunden-Fenster bei 93 % (Limit 90 %)",
            None,
        );

        let launcher = BlockingLauncher {
            quota: Arc::clone(&quota),
        };
        assert!(dispatch_project(
            &store,
            &launcher.quota.clone(),
            &preflight,
            &registry(),
            &project,
            &launcher
        )
        .await
        .unwrap()
        .is_none());

        // Back on the ready list, unspent: same priority, no error, no worker.
        let rows = store.list_queue(Some(&project)).await.unwrap();
        assert_eq!(rows[0].id, entry.id);
        assert_eq!(rows[0].status, QUEUE_READY);
        assert_eq!(rows[0].priority, 3);
        assert_eq!(rows[0].error, None);
        assert_eq!(rows[0].worker_id, None);
    }

    #[tokio::test]
    async fn a_cached_verdict_is_dropped_as_soon_as_the_facts_move() {
        let (_dir, store, _project) = fixture().await;
        let quota = QuotaTracker::default();
        let preflight = PreflightCache::default();
        let now = 1_000;

        let clear = gather_facts(&store, &quota, &registry(), "claude").await;
        assert!(preflight.report(&clear, now).is_clear());

        // The same facts inside the TTL answer from the cache...
        assert!(preflight.report(&clear, now + 1).is_clear());
        // ...but a profile the user just switched off is different facts, and
        // the cached "all clear" may not survive them.
        learnings::set_profile_enabled(&store, "claude", false)
            .await
            .unwrap();
        let disabled = gather_facts(&store, &quota, &registry(), "claude").await;
        let report = preflight.report(&disabled, now + 1);
        assert!(!report.is_clear());
        assert!(report.permanent().is_empty(), "a switch is not permanent");
        assert!(
            report.summary().contains("Einstellungen"),
            "{}",
            report.summary()
        );
    }

    // -- quota failover (phase 19 T4) --------------------------------------

    /// A registry built for one chain: `profile(&[("a", Some("b")), ...])`.
    /// Everything else about these profiles is irrelevant here - what matters
    /// is which id names which fallback.
    fn chain(links: &[(&str, Option<&str>)]) -> Vec<AgentProfile> {
        links
            .iter()
            .map(|(id, fallback)| {
                serde_json::from_value(serde_json::json!({
                    "id": id,
                    "name": id,
                    "command": id,
                    "fallback": fallback,
                }))
                .expect("profile")
            })
            .collect()
    }

    #[tokio::test]
    async fn a_blocked_profile_hands_its_task_to_its_fallback() {
        let (_dir, store, project) = fixture().await;
        let entry = enqueue_with_enhancer(
            &store,
            &project,
            "work",
            Some("claude".into()),
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();

        let quota = QuotaTracker::default();
        quota.note_blocked("claude", "Claude usage limit reached", None);
        let profiles = chain(&[("claude", Some("opencode-free")), ("opencode-free", None)]);
        let launcher = FakeLauncher::new();

        let dispatched = dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &profiles,
            &project,
            &launcher,
        )
        .await
        .unwrap()
        .expect("the fallback takes it");
        assert_eq!(dispatched.id, entry.id);

        // The worker runs on the fallback...
        assert_eq!(
            launcher.calls.lock().unwrap().as_slice(),
            [(entry.id.clone(), "opencode-free".to_string())]
        );
        // ...and says so, naming both ends of the redirect and the reason.
        let messages = store
            .list_messages(&format!("wk-{}", entry.id), None)
            .await
            .unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].role, MSG_SYSTEM);
        assert_eq!(
            messages[0].content,
            "umgeleitet: claude \u{2192} opencode-free (Quota)"
        );

        // The queue row keeps the profile the user asked for; the redirect is
        // a fact about this one worker, not a rewrite of the request.
        let rows = store.list_queue(Some(&project)).await.unwrap();
        assert_eq!(rows[0].status, QUEUE_DISPATCHED);
        assert_eq!(rows[0].profile_id, "claude");
    }

    /// The phase 18 budget block arrives through the same tracker, so it takes
    /// the same way out - and an ordinary dispatch still says nothing.
    #[tokio::test]
    async fn a_budget_block_reroutes_too_and_an_open_profile_is_left_alone() {
        let (_dir, store, project) = fixture().await;
        enqueue_with_enhancer(
            &store,
            &project,
            "work",
            Some("claude".into()),
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();

        let quota = QuotaTracker::default();
        quota.note_blocked(
            "claude",
            "Budget: 5-Stunden-Fenster bei 93 % (Limit 90 %)",
            None,
        );
        let profiles = chain(&[("claude", Some("opencode-free")), ("opencode-free", None)]);
        let launcher = FakeLauncher::new();
        dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &profiles,
            &project,
            &launcher,
        )
        .await
        .unwrap()
        .expect("dispatched");
        assert_eq!(launcher.calls.lock().unwrap()[0].1, "opencode-free");

        // Nothing blocked: the profile on the entry runs it, and no redirect
        // is announced on a worker that was never redirected.
        let open = enqueue_with_enhancer(
            &store,
            &project,
            "more",
            Some("opencode-free".into()),
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &profiles,
            &project,
            &launcher,
        )
        .await
        .unwrap()
        .expect("dispatched");
        assert_eq!(launcher.calls.lock().unwrap()[1].1, "opencode-free");
        assert!(store
            .list_messages(&format!("wk-{}", open.id), None)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn a_blocked_profile_without_a_fallback_keeps_its_task_ready() {
        let (_dir, store, project) = fixture().await;
        let entry = enqueue_with_enhancer(
            &store,
            &project,
            "work",
            Some("claude".into()),
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();

        let quota = QuotaTracker::default();
        quota.note_blocked("claude", "Claude usage limit reached", None);
        let profiles = chain(&[("claude", None), ("opencode-free", None)]);

        assert!(dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &profiles,
            &project,
            &NeverLauncher
        )
        .await
        .unwrap()
        .is_none());

        let rows = store.list_queue(Some(&project)).await.unwrap();
        assert_eq!(rows[0].id, entry.id);
        assert_eq!(
            rows[0].status, QUEUE_READY,
            "the task waits for the window to roll over"
        );
        assert_eq!(rows[0].error, None);
    }

    /// `A -> B -> A`, with both ends blocked. Without the cycle guard the walk
    /// would arrive back at the profile that is out of quota and, one hop
    /// later, hand the task to it.
    #[tokio::test]
    async fn a_fallback_chain_that_loops_back_stops_instead_of_spawning() {
        let (_dir, store, project) = fixture().await;
        let entry = enqueue_with_enhancer(
            &store,
            &project,
            "work",
            Some("a".into()),
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();

        let quota = QuotaTracker::default();
        quota.note_blocked("a", "limit", None);
        quota.note_blocked("b", "limit", None);
        let profiles = chain(&[("a", Some("b")), ("b", Some("a"))]);

        assert!(dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &profiles,
            &project,
            &NeverLauncher
        )
        .await
        .unwrap()
        .is_none());

        let rows = store.list_queue(Some(&project)).await.unwrap();
        assert_eq!(rows[0].id, entry.id);
        assert_eq!(rows[0].status, QUEUE_READY);
        assert_eq!(
            rows[0].error, None,
            "a loop in agents.json is not the task's fault"
        );
    }

    /// Two hops are allowed and three are not: `a -> b -> c` lands on `c`,
    /// while `a -> b -> c -> d` gives up with `d` still untouched even though
    /// `d` could have taken the work.
    #[tokio::test]
    async fn the_walk_stops_after_two_hops() {
        let (_dir, store, project) = fixture().await;
        let quota = QuotaTracker::default();
        for id in ["a", "b", "c"] {
            quota.note_blocked(id, "limit", None);
        }
        let launcher = FakeLauncher::new();

        enqueue_with_enhancer(
            &store,
            &project,
            "two hops",
            Some("a".into()),
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        let two = chain(&[("a", Some("b")), ("b", Some("c")), ("c", None)]);
        // `c` is blocked in the tracker above, so this pass has to find
        // nothing - and then the same chain with `c` free has to find `c`.
        assert!(dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &two,
            &project,
            &launcher
        )
        .await
        .unwrap()
        .is_none());
        quota.note_ok("c");
        dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &two,
            &project,
            &launcher,
        )
        .await
        .unwrap()
        .expect("two hops are allowed");
        assert_eq!(launcher.calls.lock().unwrap()[0].1, "c");

        let three = chain(&[
            ("a", Some("b")),
            ("b", Some("c")),
            ("c", Some("d")),
            ("d", None),
        ]);
        enqueue_with_enhancer(
            &store,
            &project,
            "three hops",
            Some("a".into()),
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();
        quota.note_blocked("c", "limit", None);
        assert!(dispatch_project(
            &store,
            &quota,
            &PreflightCache::default(),
            &three,
            &project,
            &launcher
        )
        .await
        .unwrap()
        .is_none());
        assert_eq!(
            launcher.calls.lock().unwrap().len(),
            1,
            "`d` is one hop too far"
        );
    }

    /// A fallback that cannot work either is passed over rather than spawned
    /// into a second failure: switched off in settings, or not in the registry
    /// at all.
    #[tokio::test]
    async fn a_fallback_that_cannot_run_is_not_used() {
        let (_dir, store, project) = fixture().await;
        enqueue_with_enhancer(
            &store,
            &project,
            "work",
            Some("a".into()),
            false,
            None,
            None,
            |_, _| unreachable!(),
        )
        .await
        .unwrap();

        let quota = QuotaTracker::default();
        quota.note_blocked("a", "limit", None);
        learnings::set_profile_enabled(&store, "b", false)
            .await
            .unwrap();

        // `b` is off, `ghost` is not a profile at all.
        for profiles in [
            chain(&[("a", Some("b")), ("b", None)]),
            chain(&[("a", Some("ghost"))]),
        ] {
            assert!(dispatch_project(
                &store,
                &quota,
                &PreflightCache::default(),
                &profiles,
                &project,
                &NeverLauncher
            )
            .await
            .unwrap()
            .is_none());
        }
        assert_eq!(
            store.list_queue(Some(&project)).await.unwrap()[0].status,
            QUEUE_READY
        );
    }
}
