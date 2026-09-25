//! Stuck diagnosis: telling a thinking agent from a wedged one.
//!
//! The board already knows when a worker goes quiet - [`crate::status`] calls
//! that idle after 45 seconds, and idle is a fine thing to be: an agent that
//! reads for a minute prints nothing. What idle cannot tell is the difference
//! between an agent that is working without printing and one that has stopped
//! working altogether.
//!
//! The missing evidence is the worktree. An agent that is doing anything at
//! all eventually writes a file or makes a commit, and that shows up in
//! `git status --porcelain` and `git rev-parse HEAD`. So a thread probes both
//! for every running worker once a minute, hashes them into one opaque
//! fingerprint, and hands it to the engine. Two facts come out of that:
//!
//! * **Stuck.** Output *and* the worktree have both been quiet for
//!   [`crate::status::STUCK_AFTER`] (ten minutes by default, `stuck.after_minutes`
//!   to change it). The conjunction is the whole idea - either half alone is an
//!   agent doing something. The card lands in `needs_you` with a reason that
//!   quotes the last thing the terminal printed; output or a file change clears
//!   it again through the paths that already exist.
//! * **Exit without result.** When an agent's session ends while the board
//!   still had it working and its fingerprint is the one it started with, it
//!   left nothing behind. That is not an error - agents give up - but it is
//!   worth a line in the worker's own log, where the history is read and where
//!   the daily digest picks it up.
//!
//! Nothing here spawns, kills or writes to a worktree. It reads git, and it
//! writes notes.

use std::path::Path;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use crate::status::{StatusEngine, COL_WORKING, STUCK_AFTER};
use crate::store::{Store, MSG_SYSTEM, SRC_GIT, STATUS_RUNNING};
use crate::workers;

/// How often the worktrees are probed. One minute: a git probe per running
/// worker is cheap but not free, and the threshold it feeds is measured in
/// tens of minutes.
pub const POLL_INTERVAL: Duration = Duration::from_secs(60);

/// Settings key for the stuck threshold, in whole minutes.
pub const SETTING_AFTER_MINUTES: &str = "stuck.after_minutes";

/// Event kind recorded when an agent ends without having changed anything.
pub const EVENT_EXIT_WITHOUT_RESULT: &str = "exit_without_result";

/// The note such an exit leaves on the worker's log.
pub const MSG_EXIT_WITHOUT_RESULT: &str =
    "Agent beendet ohne erkennbares Ergebnis - keine Commits, keine Dateiaenderungen \
     seit dem Start.";

/// A threshold below this would fire before the idle verdict does, which would
/// only be a more alarming word for the same silence.
const MIN_AFTER_MINUTES: u64 = 2;
/// Above this the verdict would arrive long after the user has given up
/// waiting for it; a stored value beyond it is treated as a typo.
const MAX_AFTER_MINUTES: u64 = 24 * 60;

/// One worktree's git state, hashed.
///
/// FNV-1a, and deliberately not a cryptographic hash: nothing here defends
/// against a crafted collision, and the only question ever asked of the value
/// is whether it is the same string as the one from a minute ago. The two
/// inputs are joined by a byte that cannot appear in either, so a change that
/// moves text from one to the other cannot cancel itself out.
pub fn fingerprint(head: &str, porcelain: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut eat = |bytes: &[u8]| {
        for byte in bytes {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100_0000_01b3);
        }
    };
    eat(head.trim().as_bytes());
    eat(&[0]);
    eat(porcelain.as_bytes());
    format!("{hash:016x}")
}

/// Read one worktree's git state, or `None` when git could not answer.
///
/// A worktree that has been deleted, a repository mid-rebase, a git that is
/// not on the PATH: each means "no observation", never "nothing changed". The
/// difference matters - the stuck verdict needs a probe to have succeeded at
/// least once, so an unreadable worktree simply never produces one.
pub fn probe(worktree_path: &Path) -> Option<String> {
    if !worktree_path.is_dir() {
        return None;
    }
    let run = |args: &[&str]| -> Option<String> {
        let output = crate::proc::command("git")
            .arg("-C")
            .arg(worktree_path)
            .args(args)
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        Some(String::from_utf8_lossy(&output.stdout).into_owned())
    };
    // `-uno` on purpose: untracked files are mostly build output, and a
    // compiler writing into `target/` is not the agent making progress.
    let head = run(&["rev-parse", "HEAD"])?;
    let porcelain = run(&["status", "--porcelain=v1", "-uno"])?;
    Some(fingerprint(&head, &porcelain))
}

/// The configured stuck threshold, or the default when nobody set one.
///
/// Anything unreadable or outside the sane range is the default rather than an
/// error: this is read on a timer by a background thread, and a typo in a
/// settings row must not stop the diagnosis it was meant to tune.
pub async fn threshold(store: &Store) -> Duration {
    let raw = match store.get_setting(SETTING_AFTER_MINUTES).await {
        Ok(Some(raw)) => raw,
        _ => return STUCK_AFTER,
    };
    raw.trim()
        .parse::<u64>()
        .ok()
        .filter(|minutes| (MIN_AFTER_MINUTES..=MAX_AFTER_MINUTES).contains(minutes))
        .map_or(STUCK_AFTER, |minutes| Duration::from_secs(minutes * 60))
}

/// The stored threshold in whole minutes, or `None` when the default applies.
pub async fn threshold_minutes(store: &Store) -> Option<u64> {
    let raw = store.get_setting(SETTING_AFTER_MINUTES).await.ok()??;
    raw.trim()
        .parse::<u64>()
        .ok()
        .filter(|minutes| (MIN_AFTER_MINUTES..=MAX_AFTER_MINUTES).contains(minutes))
}

/// Write (`Some`) or clear (`None`) the threshold.
///
/// Clearing removes the key rather than storing the default as a number: the
/// default is a decision this module gets to change, and a copy of today's
/// value in the settings table would outlive it.
pub async fn set_threshold_minutes(store: &Store, minutes: Option<u64>) -> Result<(), String> {
    match minutes {
        Some(minutes) if !(MIN_AFTER_MINUTES..=MAX_AFTER_MINUTES).contains(&minutes) => Err(
            format!("stuck threshold must be between {MIN_AFTER_MINUTES} and {MAX_AFTER_MINUTES} minutes, got {minutes}"),
        ),
        Some(minutes) => {
            store
                .set_setting(SETTING_AFTER_MINUTES, &minutes.to_string())
                .await
        }
        None => store.delete_setting(SETTING_AFTER_MINUTES).await,
    }
}

/// Did this agent end without leaving anything behind?
///
/// Three things have to be true, and each is a guard against a false accusation:
///
/// * the board still had it **working** - a card that had already reached
///   review, or that was waiting for the user, ended for a reason of its own;
/// * a fingerprint from the **start of this run** exists - without a baseline
///   there is nothing to compare, and a probe that never ran must not read as
///   "changed nothing";
/// * the fingerprint is **unchanged** - same HEAD, same tracked files.
pub fn exit_without_result(
    column: Option<&str>,
    spawn_fingerprint: Option<&str>,
    current_fingerprint: Option<&str>,
) -> bool {
    if column != Some(COL_WORKING) {
        return false;
    }
    match (spawn_fingerprint, current_fingerprint) {
        (Some(spawn), Some(current)) => spawn == current,
        _ => false,
    }
}

/// Note an agent's exit on its worker's log, when it left nothing behind.
///
/// Called from the PTY exit hook *before* [`Store::mark_session_exited`], for
/// two reasons: that call unbinds the session, so the worker could no longer
/// be found afterwards, and it flips the row to `exited`, which would change
/// the very column this decision reads.
pub async fn note_exit(store: &Store, engine: &StatusEngine, session_id: &str) {
    let Some(worker_id) = store.worker_for_session(session_id) else {
        return;
    };
    let (spawn, cached) = engine.git_fingerprints(&worker_id);
    // The cached fingerprint is only as fresh as the last sweep: whatever the
    // worker changed between that sweep and its exit would be judged by a
    // probe that never saw it, and "nothing changed" is the one accusation
    // this note must never make falsely. Re-probe now; only a failed probe
    // falls back to the cache, because an unreadable worktree is no
    // observation at all, not proof that nothing moved.
    let current = match store.get_worker(&worker_id).await {
        Ok(Some(worker)) => {
            let path = worker.worktree_path.clone();
            match tauri::async_runtime::spawn_blocking(move || probe(Path::new(&path))).await {
                Ok(Some(fresh)) => Some(fresh),
                _ => cached,
            }
        }
        _ => cached,
    };
    let column = engine.column_of(&worker_id);
    if !exit_without_result(column.as_deref(), spawn.as_deref(), current.as_deref()) {
        return;
    }
    workers::log_message(store, &worker_id, MSG_SYSTEM, MSG_EXIT_WITHOUT_RESULT);
    if let Err(err) = store
        .record_status_event(
            &worker_id,
            EVENT_EXIT_WITHOUT_RESULT,
            MSG_EXIT_WITHOUT_RESULT,
            SRC_GIT,
        )
        .await
    {
        eprintln!("projecta: could not record the exit note for {worker_id}: {err}");
    }
}

/// One probing sweep: every running worker's worktree, once.
///
/// The git calls run on the blocking pool - `spawn_blocking` is where a child
/// process belongs in an async runtime - and a worker whose probe fails is
/// skipped rather than reported: an unreadable worktree is an observation this
/// sweep did not make, not a fact about the agent.
pub async fn probe_once(store: &Store, engine: &StatusEngine) {
    engine.set_stuck_after(threshold(store).await);

    let workers = match store.list_workers(None).await {
        Ok(workers) => workers,
        Err(err) => {
            eprintln!("projecta: stuck probe could not list workers: {err}");
            return;
        }
    };
    for worker in workers {
        if worker.status != STATUS_RUNNING {
            continue;
        }
        let path = worker.worktree_path.clone();
        let probed = tauri::async_runtime::spawn_blocking(move || probe(Path::new(&path)))
            .await
            .ok()
            .flatten();
        if let Some(fingerprint) = probed {
            engine.note_git_activity(&worker.id, &fingerprint);
        }
    }
}

/// Start the always-on git probe.
///
/// The same shape as the dispatcher and the budget watcher: a plain OS thread
/// with one `block_on` at the top, everything below awaited.
pub fn start(store: Store, engine: Arc<StatusEngine>) {
    thread::spawn(move || loop {
        tauri::async_runtime::block_on(probe_once(&store, &engine));
        thread::sleep(POLL_INTERVAL);
    });
}

#[cfg(test)]
mod tests {
    // Tests bauen Commands direkt: ein Fenster waehrend `cargo test`
    // stoert niemanden, und proc::command waere hier nur Umweg.
    use super::*;
    use crate::status::{COL_IN_REVIEW, COL_NEEDS_YOU};
    use crate::store::{WorkerRow, KIND_WORKER};
    use crate::testutil::{init_repo, TempDir};
    use std::process::Command;

    #[test]
    fn a_fingerprint_changes_with_either_half_and_cannot_be_cancelled_out() {
        let base = fingerprint("abc123", " M src/main.rs\n");
        assert_eq!(
            base,
            fingerprint("abc123\n", " M src/main.rs\n"),
            "HEAD is trimmed"
        );
        assert_ne!(base, fingerprint("def456", " M src/main.rs\n"));
        assert_ne!(base, fingerprint("abc123", " M src/other.rs\n"));
        // Moving text across the boundary is a different fingerprint, which is
        // what the separator byte is there for.
        assert_ne!(fingerprint("ab", "c"), fingerprint("a", "bc"));
        assert_eq!(base.len(), 16);
    }

    #[test]
    fn an_exit_is_only_noted_for_a_working_card_with_a_baseline_and_no_change() {
        assert!(exit_without_result(Some(COL_WORKING), Some("a"), Some("a")));

        // Something happened on disk.
        assert!(!exit_without_result(
            Some(COL_WORKING),
            Some("a"),
            Some("b")
        ));
        // The card had already moved on; that exit has its own explanation.
        assert!(!exit_without_result(
            Some(COL_IN_REVIEW),
            Some("a"),
            Some("a")
        ));
        assert!(!exit_without_result(
            Some(COL_NEEDS_YOU),
            Some("a"),
            Some("a")
        ));
        // The probe never ran, so there is nothing to compare. Silence, not
        // an accusation.
        assert!(!exit_without_result(Some(COL_WORKING), None, None));
        assert!(!exit_without_result(Some(COL_WORKING), None, Some("a")));
        assert!(!exit_without_result(None, Some("a"), Some("a")));
    }

    /// `git` inside a test repository, failing loudly.
    fn git_in(repo: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn a_real_worktree_is_probed_and_the_fingerprint_follows_its_files() {
        let dir = TempDir::new("stuck-probe");
        let repo = dir.path().join("repo");
        init_repo(&repo);
        std::fs::write(repo.join("README.md"), "one\n").expect("write");
        git_in(&repo, &["add", "README.md"]);
        git_in(&repo, &["commit", "--no-gpg-sign", "-m", "readme"]);

        let first = probe(&repo).expect("a checkout is probeable");
        assert_eq!(probe(&repo).as_deref(), Some(first.as_str()), "stable");

        // A tracked file the agent edited: this is the signal.
        std::fs::write(repo.join("README.md"), "two\n").expect("write");
        let edited = probe(&repo).expect("probe");
        assert_ne!(edited, first);

        // An untracked file is not progress: `-uno` leaves build output out.
        std::fs::write(repo.join("scratch.tmp"), "noise").expect("write");
        assert_eq!(probe(&repo).as_deref(), Some(edited.as_str()));

        // A commit moves HEAD, which is the other half of the fingerprint.
        git_in(&repo, &["commit", "--no-gpg-sign", "-am", "edit"]);
        let committed = probe(&repo).expect("probe");
        assert_ne!(committed, edited);
        assert_ne!(committed, first);

        // Nothing to read is no observation, not an unchanged one.
        assert_eq!(probe(&dir.path().join("nowhere")), None);
    }

    async fn fixture() -> (TempDir, Store, String) {
        let dir = TempDir::new("stuck");
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let project = store.create_project("one", "C:/repo/one").await.unwrap();
        (dir, store, project.id)
    }

    #[tokio::test]
    async fn the_threshold_falls_back_to_the_default_for_anything_unusable() {
        let (_dir, store, _project) = fixture().await;
        assert_eq!(threshold(&store).await, STUCK_AFTER);

        store
            .set_setting(SETTING_AFTER_MINUTES, " 25 ")
            .await
            .unwrap();
        assert_eq!(threshold(&store).await, Duration::from_secs(25 * 60));

        for bad in ["0", "1", "zwanzig", "", "-5", "100000"] {
            store.set_setting(SETTING_AFTER_MINUTES, bad).await.unwrap();
            assert_eq!(threshold(&store).await, STUCK_AFTER, "{bad} was accepted");
            assert_eq!(threshold_minutes(&store).await, None, "{bad} was reported");
        }
    }

    #[tokio::test]
    async fn the_threshold_round_trips_and_refuses_what_it_cannot_mean() {
        let (_dir, store, _project) = fixture().await;
        assert_eq!(threshold_minutes(&store).await, None);

        set_threshold_minutes(&store, Some(20)).await.unwrap();
        assert_eq!(threshold_minutes(&store).await, Some(20));
        assert_eq!(threshold(&store).await, Duration::from_secs(20 * 60));

        // Clearing removes the key, so the default stays the module's to change.
        set_threshold_minutes(&store, None).await.unwrap();
        assert!(store
            .get_setting(SETTING_AFTER_MINUTES)
            .await
            .unwrap()
            .is_none());
        assert_eq!(threshold(&store).await, STUCK_AFTER);

        assert!(set_threshold_minutes(&store, Some(1)).await.is_err());
        assert!(set_threshold_minutes(&store, Some(10_000)).await.is_err());
    }

    #[tokio::test]
    async fn exit_must_recheck_git_after_a_worker_changes_files_between_polls() {
        let dir = TempDir::new("stuck-exit-race");
        let repo = dir.path().join("repo");
        init_repo(&repo);
        std::fs::write(repo.join("README.md"), "one\n").expect("write");
        git_in(&repo, &["add", "README.md"]);
        git_in(&repo, &["commit", "--no-gpg-sign", "-m", "baseline"]);

        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let project = store
            .create_project("one", repo.to_string_lossy().as_ref())
            .await
            .unwrap();
        store
            .insert_worker(&WorkerRow {
                id: "wk-exit-race".to_string(),
                project_id: project.id.clone(),
                task: "work".to_string(),
                profile_id: "claude".to_string(),
                branch: "pa/wk-exit-race".to_string(),
                worktree_path: repo.to_string_lossy().into_owned(),
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
        store.bind_session("wk-exit-race", "sess-exit-race").await;
        let engine = StatusEngine::default();
        engine.note_git_activity("wk-exit-race", &probe(&repo).unwrap());

        std::fs::write(repo.join("README.md"), "two\n").expect("write");
        note_exit(&store, &engine, "sess-exit-race").await;

        let events = store
            .list_status_events(&project.id, 0, i64::MAX)
            .await
            .unwrap();
        assert!(
            events
                .iter()
                .all(|event| event.kind != EVENT_EXIT_WITHOUT_RESULT),
            "a tracked-file change before exit must prevent an exit-without-result event"
        );
    }

    #[tokio::test]
    async fn an_exit_note_lands_on_the_worker_log_only_when_nothing_changed() {
        let (_dir, store, project) = fixture().await;
        let engine = StatusEngine::default();
        for (id, kept) in [("wk-quiet", true), ("wk-busy", false)] {
            store
                .insert_worker(&WorkerRow {
                    id: id.to_string(),
                    project_id: project.clone(),
                    task: "work".to_string(),
                    profile_id: "claude".to_string(),
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
            engine.note_git_activity(id, "baseline");
            if !kept {
                engine.note_git_activity(id, "moved");
            }
        }

        note_exit(&store, &engine, "sess-wk-quiet").await;
        note_exit(&store, &engine, "sess-wk-busy").await;
        // An id nobody knows is a no-op rather than a panic.
        note_exit(&store, &engine, "sess-nope").await;

        let events = store
            .list_status_events(&project, 0, i64::MAX)
            .await
            .unwrap();
        let noted: Vec<&str> = events.iter().map(|e| e.worker_id.as_str()).collect();
        assert_eq!(noted, vec!["wk-quiet"]);
        assert_eq!(events[0].kind, EVENT_EXIT_WITHOUT_RESULT);
        assert_eq!(events[0].source, SRC_GIT);
    }
}
