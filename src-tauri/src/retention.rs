//! Database retention: keep the tables that grow forever from actually
//! growing forever (Phase 1.5, `docs/archive/plaene-2026-09/SANIERUNGSPLAN.md` §2.2 Nr. 5, deadlines
//! §8.21).
//!
//! Three tables accumulate one row per thing that *happened* and are never
//! pruned by their writers: `status_events` (every column change of every
//! worker), `usage_events` (the OmniRoute ledger, one row per request) and
//! `messages` (the durable interaction logs). Left alone the database grows
//! without bound, so this module sweeps them:
//!
//! - `status_events` and `usage_events` older than the events deadline are
//!   simply deleted - their value is diagnostic and decays to zero.
//! - `messages` older than the messages deadline are first exported to a
//!   Markdown archive under the app data directory, and only deleted once
//!   that export is verified on disk. A failed export keeps every row:
//!   losing the log is worse than keeping it.
//!
//! The deadlines are settings (`retention.events_days`,
//! `retention.messages_days`); a row that is missing, unparsable or outside
//! the sane range falls back to the default, exactly like the stuck
//! threshold does (`crate::stuck::threshold`) - a typo in a settings row
//! must not stop the sweep.
//!
//! Deletions run in chunks of [`DELETE_CHUNK`] rows so a sweep never holds
//! the write lock for longer than one small batch; the board, the hooks and
//! the dispatcher keep writing while it runs. Note that deleting rows does
//! not shrink the database file: SQLite only hands freed pages back on
//! `VACUUM`, which is deliberately *not* run here (it would rewrite the
//! whole file under a full lock). Until somebody schedules one, the file
//! reuses the freed space internally.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use crate::digest::utc_date;
use crate::store::{now_unix_secs, Message, Store};

/// How often the sweep runs after the one at startup. The deadlines are
/// measured in months, so a daily pass is far finer than the thing it
/// enforces - and cheap: every query below is an indexed range scan that
/// returns zero rows on an ordinary day.
pub const SWEEP_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

/// Settings key for the events deadline, in whole days.
pub const SETTING_EVENTS_DAYS: &str = "retention.events_days";
/// Settings key for the messages deadline, in whole days.
pub const SETTING_MESSAGES_DAYS: &str = "retention.messages_days";

/// The events deadline when nobody set one (§8.21).
pub const DEFAULT_EVENTS_DAYS: u64 = 90;
/// The messages deadline when nobody set one (§8.21).
pub const DEFAULT_MESSAGES_DAYS: u64 = 180;

/// A deadline below a day would sweep data the UI is still showing; beyond
/// ten years the setting is a typo for "forever", which the settings UI
/// should say by not setting the key at all.
const MIN_DAYS: u64 = 1;
const MAX_DAYS: u64 = 3650;

/// One delete statement's batch: large enough that a big first sweep does
/// not take all night, small enough that no single write lock outlives a
/// busy-timeout.
const DELETE_CHUNK: i64 = 500;

const DAY_SECS: i64 = 24 * 60 * 60;

/// Archive directory for messages whose worker row is already gone. The
/// export must not depend on the join having succeeded - a message without
/// a worker still gets archived rather than silently kept forever.
const UNKNOWN_PROJECT: &str = "_unknown";

/// What one sweep did, for the log line and for tests.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct SweepReport {
    pub status_events_deleted: u64,
    pub usage_events_deleted: u64,
    /// Messages written into a verified archive file.
    pub messages_exported: u64,
    /// Messages deleted after their export verified.
    pub messages_deleted: u64,
    /// Archive files written this pass.
    pub archives: Vec<PathBuf>,
    /// Workers whose export failed; their messages were kept, untouched.
    pub export_failures: Vec<String>,
    /// Everything else that went wrong (a failed delete, a failed read).
    pub errors: Vec<String>,
}

/// The configured deadline behind `key`, or `default` when the row is
/// missing, unreadable or outside the sane range - the same bargain
/// [`crate::stuck::threshold`] makes, for the same reason: this is read by a
/// background thread, and a typo must not stop the sweep.
async fn retention_days(store: &Store, key: &str, default: u64) -> u64 {
    let raw = match store.get_setting(key).await {
        Ok(Some(raw)) => raw,
        _ => return default,
    };
    raw.trim()
        .parse::<u64>()
        .ok()
        .filter(|days| (MIN_DAYS..=MAX_DAYS).contains(days))
        .unwrap_or(default)
}

/// One sweep against the current wall clock.
pub async fn run_once(store: &Store, archive_root: &Path) -> SweepReport {
    sweep_at(store, archive_root, now_unix_secs()).await
}

/// One sweep as of `now`: delete expired events, archive then delete
/// expired messages. `now` is a parameter so tests can pin the deadlines.
///
/// Never fails as a whole: every fallible step lands in the report and the
/// sweep moves on, because a background loop that dies on the first error
/// is a retention job that silently stopped retaining.
async fn sweep_at(store: &Store, archive_root: &Path, now: i64) -> SweepReport {
    let mut report = SweepReport::default();
    let events_days = retention_days(store, SETTING_EVENTS_DAYS, DEFAULT_EVENTS_DAYS).await;
    let messages_days = retention_days(store, SETTING_MESSAGES_DAYS, DEFAULT_MESSAGES_DAYS).await;
    let events_cutoff = now - events_days as i64 * DAY_SECS;
    let messages_cutoff = now - messages_days as i64 * DAY_SECS;

    // Events decay to zero value with age, so they go without an archive.
    loop {
        match store
            .delete_status_events_before(events_cutoff, DELETE_CHUNK)
            .await
        {
            Ok(0) => break,
            Ok(n) => report.status_events_deleted += n,
            Err(err) => {
                report.errors.push(err);
                break;
            }
        }
    }
    loop {
        match store
            .delete_usage_events_before(events_cutoff, DELETE_CHUNK)
            .await
        {
            Ok(0) => break,
            Ok(n) => report.usage_events_deleted += n,
            Err(err) => {
                report.errors.push(err);
                break;
            }
        }
    }

    // Messages are the record of what the user and the agent actually said:
    // export first, verify on disk, only then delete. Any failure before the
    // delete keeps every row.
    let workers = match store.workers_with_messages_before(messages_cutoff).await {
        Ok(workers) => workers,
        Err(err) => {
            report.errors.push(err);
            return report;
        }
    };
    for (worker_id, project_id) in workers {
        let project_dir = project_id.unwrap_or_else(|| UNKNOWN_PROJECT.to_string());
        let messages = match store
            .list_messages_before(&worker_id, messages_cutoff)
            .await
        {
            Ok(messages) => messages,
            Err(err) => {
                report.errors.push(err);
                continue;
            }
        };
        if messages.is_empty() {
            continue;
        }
        let path =
            match export_worker_messages(archive_root, &project_dir, &worker_id, &messages, now) {
                Ok(path) => path,
                Err(err) => {
                    report
                        .export_failures
                        .push(format!("worker {worker_id}: {err}"));
                    continue;
                }
            };
        let mut deleted = 0_u64;
        loop {
            match store
                .delete_messages_before(&worker_id, messages_cutoff, DELETE_CHUNK)
                .await
            {
                Ok(0) => break,
                Ok(n) => deleted += n,
                Err(err) => {
                    report.errors.push(err);
                    break;
                }
            }
        }
        report.messages_exported += messages.len() as u64;
        report.messages_deleted += deleted;
        report.archives.push(path);
    }
    report
}

/// Write one worker's expired messages as one Markdown archive file and
/// verify it landed, returning the verified path.
///
/// Layout: `<archive_root>/messages/<project_id>/<worker_id>-<from>-<to>.md`,
/// where the dates are the UTC days of the oldest and youngest message in
/// the file. The app data directory is the right home for it (archivierter SANIERUNGSPLAN
/// §2.2 Nr. 5): an archive under `.pa/` in the repository would be readable
/// and committable by the very agents the log is about.
fn export_worker_messages(
    archive_root: &Path,
    project_id: &str,
    worker_id: &str,
    messages: &[Message],
    now: i64,
) -> Result<PathBuf, String> {
    let (Some(first), Some(last)) = (messages.first(), messages.last()) else {
        return Err("nothing to export".to_string());
    };
    let dir = archive_root.join("messages").join(project_id);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create {}: {e}", dir.display()))?;
    let path = dir.join(format!(
        "{worker_id}-{}-{}.md",
        utc_date(first.created_at),
        utc_date(last.created_at)
    ));
    write_atomic(&path, &render_archive(project_id, worker_id, messages, now))?;
    verify_export(&path)?;
    Ok(path)
}

/// The archive page: a metadata header (project, worker, period, count) and
/// then the messages in order. Plain Markdown, no escaping beyond the
/// section layout - this is a document for a human to read later, not a
/// format anything parses back.
fn render_archive(project_id: &str, worker_id: &str, messages: &[Message], now: i64) -> String {
    let first = messages.first().map_or(0, |m| m.created_at);
    let last = messages.last().map_or(0, |m| m.created_at);
    let mut out = format!(
        "# Message archive: worker `{worker_id}`\n\n\
         - project: `{project_id}`\n\
         - worker: `{worker_id}`\n\
         - period: {} to {} (UTC)\n\
         - messages: {}\n\
         - exported: {} (UTC)\n\n\
         ---\n",
        utc_date(first),
        utc_date(last),
        messages.len(),
        utc_date(now),
    );
    for message in messages {
        out.push_str(&format!(
            "\n## {} {} - {}\n\n{}\n",
            utc_date(message.created_at),
            utc_time(message.created_at),
            message.role,
            message.content,
        ));
    }
    out
}

/// The UTC clock time `unix` falls on, as `HH:MM:SS` - the companion of
/// [`utc_date`] for within-day ordering in the archive.
fn utc_time(unix: i64) -> String {
    let secs = unix.rem_euclid(DAY_SECS);
    format!(
        "{:02}:{:02}:{:02}",
        secs / 3600,
        (secs % 3600) / 60,
        secs % 60
    )
}

/// Write `contents` to `path` atomically: a temporary file beside it, then a
/// rename - the pattern [`crate::digest::write_digest`] established, so a
/// reader (or the verification below) either sees the whole archive or no
/// file at all. Mode 0600 where permissions exist: the archive is a chat
/// log, not a shared document.
fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("bad archive path {}", path.display()))?;
    // The process id keeps two instances on the same app data directory from
    // writing the same temporary file at the same moment.
    let tmp = path.with_file_name(format!(".{file_name}.{}.tmp", std::process::id()));
    let _ = std::fs::remove_file(&tmp); // left over from a crashed sweep
    let written = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&tmp)
            .map_err(|e| format!("failed to create {}: {e}", tmp.display()))?;
        file.write_all(contents.as_bytes())
            .and_then(|()| file.sync_all())
            .map_err(|e| format!("failed to write {}: {e}", tmp.display()))?;
        Ok::<(), String>(())
    })();
    if let Err(err) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(err);
    }
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(err) => {
            let _ = std::fs::remove_file(&tmp);
            Err(format!("failed to place {}: {err}", path.display()))
        }
    }
}

/// The gate between export and delete: the file is there and it has lines.
/// Read back rather than trusted from the write - the delete that follows
/// this check is the irreversible step, so the check looks at what is on
/// disk, not at what the writer believes it did.
fn verify_export(path: &Path) -> Result<(), String> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("export verification failed for {}: {e}", path.display()))?;
    if text.lines().count() == 0 {
        return Err(format!(
            "export verification failed for {}: file is empty",
            path.display()
        ));
    }
    Ok(())
}

/// The background thread: one sweep at startup (the app may have been off
/// for weeks), then one per [`SWEEP_INTERVAL`]. Same shape as
/// [`crate::stuck::start`], and like it the loop never exits on an error -
/// the report carries them instead.
pub fn start(store: Store, archive_root: PathBuf) {
    thread::spawn(move || loop {
        let report = tauri::async_runtime::block_on(run_once(&store, &archive_root));
        for err in &report.errors {
            eprintln!("projecta: retention sweep: {err}");
        }
        for err in &report.export_failures {
            eprintln!("projecta: retention sweep: export failed, messages kept: {err}");
        }
        if report.status_events_deleted > 0
            || report.usage_events_deleted > 0
            || report.messages_deleted > 0
        {
            println!(
                "projecta: retention sweep: deleted {} status events, {} usage events; archived {} messages into {} file(s)",
                report.status_events_deleted,
                report.usage_events_deleted,
                report.messages_deleted,
                report.archives.len(),
            );
        }
        thread::sleep(SWEEP_INTERVAL);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{new_id, UsageEvent, WorkerRow, STATUS_RUNNING};
    use crate::testutil::TempDir;

    /// A fixed "now" so every deadline in these tests is exact.
    /// 2026-08-27 12:00:00 UTC, the same pin the stats tests use.
    const NOW: i64 = 1_787_745_600;

    async fn fixture() -> (TempDir, Store) {
        let dir = TempDir::new("retention");
        let store = Store::open(&dir.path().join("projecta.db"))
            .await
            .expect("open store");
        (dir, store)
    }

    async fn add_worker(store: &Store, project_id: &str, id: &str) {
        store
            .insert_worker(&WorkerRow {
                id: id.to_string(),
                project_id: project_id.to_string(),
                task: format!("task for {id}"),
                profile_id: "claude".to_string(),
                branch: format!("pa/{id}"),
                worktree_path: format!("/tmp/{id}"),
                status: STATUS_RUNNING.to_string(),
                kind: "worker".to_string(),
                pr_url: None,
                spawned_by: None,
                test_status: None,
                tested_at: None,
                role_variant_id: None,
                paused_reason: None,
                created_at: NOW - 3600,
            })
            .await
            .expect("insert worker");
    }

    fn usage_event(id: &str, ts: i64) -> UsageEvent {
        UsageEvent {
            id: id.to_string(),
            ts,
            profile_id: Some("claude".to_string()),
            model: "gpt-5.6-sol".to_string(),
            provider: "openai".to_string(),
            tokens_in: 10,
            tokens_out: 20,
            cost_usd: None,
            raw_json: "{}".to_string(),
        }
    }

    async fn status_events_left(store: &Store, project_id: &str) -> usize {
        store
            .list_status_events(project_id, 0, i64::MAX)
            .await
            .expect("list status events")
            .len()
    }

    async fn usage_events_left(store: &Store) -> usize {
        store
            .list_usage_events(None, None)
            .await
            .expect("list usage events")
            .len()
    }

    async fn messages_left(store: &Store, worker_id: &str) -> usize {
        store
            .list_messages(worker_id, None)
            .await
            .expect("list messages")
            .len()
    }

    // -- events ------------------------------------------------------------

    #[tokio::test]
    async fn old_status_and_usage_events_are_deleted_recent_ones_survive() {
        let (dir, store) = fixture().await;
        let project = store.create_project("one", "/tmp/one").await.unwrap();
        add_worker(&store, &project.id, "wk-1").await;
        let old = NOW - 91 * DAY_SECS;
        let recent = NOW - DAY_SECS;
        store
            .insert_status_event_at("wk-1", &new_id("ev"), old)
            .await
            .unwrap();
        store
            .insert_status_event_at("wk-1", &new_id("ev"), recent)
            .await
            .unwrap();
        store
            .insert_usage_event(&usage_event(&new_id("us"), old))
            .await
            .unwrap();
        store
            .insert_usage_event(&usage_event(&new_id("us"), recent))
            .await
            .unwrap();

        let report = sweep_at(&store, &dir.path().join("archive"), NOW).await;

        assert_eq!(report.status_events_deleted, 1);
        assert_eq!(report.usage_events_deleted, 1);
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert_eq!(status_events_left(&store, &project.id).await, 1);
        assert_eq!(usage_events_left(&store).await, 1);
    }

    #[tokio::test]
    async fn deletion_runs_in_chunks_until_the_table_is_clean() {
        let (dir, store) = fixture().await;
        let project = store.create_project("one", "/tmp/one").await.unwrap();
        add_worker(&store, &project.id, "wk-1").await;
        // More than two DELETE_CHUNK batches, so the loop has to iterate.
        let count = DELETE_CHUNK * 2 + 200;
        for _ in 0..count {
            store
                .insert_status_event_at("wk-1", &new_id("ev"), NOW - 400 * DAY_SECS)
                .await
                .unwrap();
        }

        let report = sweep_at(&store, &dir.path().join("archive"), NOW).await;

        assert_eq!(report.status_events_deleted, count as u64);
        assert_eq!(status_events_left(&store, &project.id).await, 0);
    }

    // -- messages ----------------------------------------------------------

    #[tokio::test]
    async fn old_messages_are_exported_before_they_are_deleted() {
        let (dir, store) = fixture().await;
        let project = store.create_project("one", "/tmp/one").await.unwrap();
        add_worker(&store, &project.id, "wk-1").await;
        let old_1 = NOW - 200 * DAY_SECS;
        let old_2 = NOW - 190 * DAY_SECS;
        store
            .insert_message_at("wk-1", "msg-old-1", "user", old_1)
            .await
            .unwrap();
        store
            .insert_message_at("wk-1", "msg-old-2", "agent", old_2)
            .await
            .unwrap();
        store
            .insert_message_at("wk-1", "msg-new", "user", NOW - DAY_SECS)
            .await
            .unwrap();

        let archive = dir.path().join("archive");
        let report = sweep_at(&store, &archive, NOW).await;

        assert_eq!(report.messages_exported, 2);
        assert_eq!(report.messages_deleted, 2);
        assert_eq!(report.archives.len(), 1);
        assert!(
            report.export_failures.is_empty(),
            "{:?}",
            report.export_failures
        );
        assert_eq!(messages_left(&store, "wk-1").await, 1);

        let path = archive.join("messages").join(&project.id).join(format!(
            "wk-1-{}-{}.md",
            utc_date(old_1),
            utc_date(old_2)
        ));
        assert_eq!(report.archives[0], path);
        let text = std::fs::read_to_string(&path).expect("read archive");
        // Metadata: project, worker, period, count - then the messages.
        assert!(text.contains(&project.id), "{text}");
        assert!(text.contains("wk-1"), "{text}");
        assert!(text.contains(&utc_date(old_1)), "{text}");
        assert!(text.contains(&utc_date(old_2)), "{text}");
        assert!(text.contains('2'), "{text}");
        assert!(text.contains("user"), "{text}");
        assert!(text.contains("agent"), "{text}");
    }

    #[tokio::test]
    async fn a_failed_export_deletes_nothing() {
        let (dir, store) = fixture().await;
        let project = store.create_project("one", "/tmp/one").await.unwrap();
        add_worker(&store, &project.id, "wk-1").await;
        store
            .insert_message_at("wk-1", "msg-old", "user", NOW - 200 * DAY_SECS)
            .await
            .unwrap();
        // An unwritable archive root, portably: not permissions (a read-only
        // directory is not enforced on Windows) but a *file* where the
        // archive directory would have to be created - `create_dir_all`
        // fails on that on every platform.
        let archive = dir.path().join("archive");
        std::fs::write(&archive, "not a directory").unwrap();

        let report = sweep_at(&store, &archive, NOW).await;

        assert_eq!(report.messages_deleted, 0);
        assert_eq!(report.messages_exported, 0);
        assert_eq!(report.export_failures.len(), 1);
        // The row is still there, untouched - the next sweep with a working
        // archive root will try again.
        assert_eq!(messages_left(&store, "wk-1").await, 1);
    }

    #[tokio::test]
    async fn messages_of_a_worker_without_a_worker_row_are_still_exported() {
        let (dir, store) = fixture().await;
        // No worker row at all: the join has nothing to find.
        store
            .insert_message_at("wk-gone", "msg-old", "user", NOW - 200 * DAY_SECS)
            .await
            .unwrap();

        let archive = dir.path().join("archive");
        let report = sweep_at(&store, &archive, NOW).await;

        assert_eq!(report.messages_deleted, 1);
        assert_eq!(report.archives.len(), 1);
        assert!(report.archives[0].starts_with(archive.join("messages").join(UNKNOWN_PROJECT)));
        assert_eq!(messages_left(&store, "wk-gone").await, 0);
    }

    // -- the deadlines -----------------------------------------------------

    #[tokio::test]
    async fn the_deadlines_come_from_the_settings_table() {
        let (dir, store) = fixture().await;
        let project = store.create_project("one", "/tmp/one").await.unwrap();
        add_worker(&store, &project.id, "wk-1").await;
        store.set_setting(SETTING_EVENTS_DAYS, "10").await.unwrap();
        store
            .set_setting(SETTING_MESSAGES_DAYS, "20")
            .await
            .unwrap();
        // 15 days old: past the events deadline, inside the messages one.
        store
            .insert_status_event_at("wk-1", &new_id("ev"), NOW - 15 * DAY_SECS)
            .await
            .unwrap();
        store
            .insert_message_at("wk-1", "msg-keep", "user", NOW - 15 * DAY_SECS)
            .await
            .unwrap();
        // 25 days old: past the messages deadline too.
        store
            .insert_message_at("wk-1", "msg-export", "user", NOW - 25 * DAY_SECS)
            .await
            .unwrap();

        let report = sweep_at(&store, &dir.path().join("archive"), NOW).await;

        assert_eq!(report.status_events_deleted, 1);
        assert_eq!(report.messages_deleted, 1);
        assert_eq!(messages_left(&store, "wk-1").await, 1);
        assert_eq!(status_events_left(&store, &project.id).await, 0);
    }

    #[tokio::test]
    async fn the_cutoff_is_exclusive_to_the_second() {
        let (dir, store) = fixture().await;
        let project = store.create_project("one", "/tmp/one").await.unwrap();
        add_worker(&store, &project.id, "wk-1").await;
        let events_cutoff = NOW - DEFAULT_EVENTS_DAYS as i64 * DAY_SECS;
        let messages_cutoff = NOW - DEFAULT_MESSAGES_DAYS as i64 * DAY_SECS;
        // Exactly at the deadline: kept. One second older: gone.
        store
            .insert_status_event_at("wk-1", &new_id("ev"), events_cutoff)
            .await
            .unwrap();
        store
            .insert_status_event_at("wk-1", &new_id("ev"), events_cutoff - 1)
            .await
            .unwrap();
        store
            .insert_message_at("wk-1", "msg-at", "user", messages_cutoff)
            .await
            .unwrap();
        store
            .insert_message_at("wk-1", "msg-past", "user", messages_cutoff - 1)
            .await
            .unwrap();

        let report = sweep_at(&store, &dir.path().join("archive"), NOW).await;

        assert_eq!(report.status_events_deleted, 1);
        assert_eq!(report.messages_deleted, 1);
        assert_eq!(status_events_left(&store, &project.id).await, 1);
        assert_eq!(messages_left(&store, "wk-1").await, 1);
    }

    #[tokio::test]
    async fn a_garbage_setting_falls_back_to_the_default() {
        let (dir, store) = fixture().await;
        let project = store.create_project("one", "/tmp/one").await.unwrap();
        add_worker(&store, &project.id, "wk-1").await;
        store
            .set_setting(SETTING_EVENTS_DAYS, "viel zu lang")
            .await
            .unwrap();
        // 100 days: past the default of 90, inside a garbage setting's
        // unknown intent - the default has to win.
        store
            .insert_status_event_at("wk-1", &new_id("ev"), NOW - 100 * DAY_SECS)
            .await
            .unwrap();

        let report = sweep_at(&store, &dir.path().join("archive"), NOW).await;

        assert_eq!(report.status_events_deleted, 1);
        assert_eq!(status_events_left(&store, &project.id).await, 0);
    }
}
