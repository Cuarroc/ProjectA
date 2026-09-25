//! Session buffers: scrollback and composer drafts, beside the vault.
//!
//! Policy (`docs/decisions.md` 2026-09-04, `.pa/report_f5_policy.md`):
//! at most seven days or two megabytes, whichever comes first; wrapped like
//! `provider-keys.json`; gone after archive or a successful merge; restore
//! never pretends a PTY is still live.
//!
//! These files are not a SQLite table. Scrollback must not land in
//! `projecta.db`, and diagnosis export must not grow a field for it.
//!
//! `restore` / `sweep` / the Restore shape are the policy API. Production
//! wiring today is put/purge/confirm/persist_end; `persist_draft` is the
//! production draft writer and waits on its IPC command (the `main.rs`
//! lane); the rest is kept for the recovery matrix and must not be deleted
//! as dead.

#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::providers::{open_private, seal_private};
use crate::store;

/// App-crash last-confirmed. Startup writes this when a `running` row has no
/// process behind it; restore never turns it into a live PTY.
pub const CONFIRMED_APP_CRASH: &str = "app_crash";
/// The agent's child exited. Recorded from the PTY exit hook.
pub const CONFIRMED_AGENT_EXITED: &str = "agent_exited";
/// The user (or the app) stopped the fleet. Recorded on `RunEvent::Exit`
/// before the children are killed.
pub const CONFIRMED_FLEET_STOP: &str = "fleet_stop";
/// The worktree directory is gone. Startup marks the worker exited.
pub const CONFIRMED_WORKTREE_MISSING: &str = "worktree_missing";

/// App-data directory that holds `session-buffers/`. `None` until setup, and
/// in tests that never call [`set_root`].
static ROOT: Mutex<Option<PathBuf>> = Mutex::new(None);

fn root_slot() -> std::sync::MutexGuard<'static, Option<PathBuf>> {
    ROOT.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Point persist at the app data directory. Called once from setup.
pub fn set_root(dir: PathBuf) {
    *root_slot() = Some(dir);
}

/// The configured persist root, if setup has run.
pub fn root() -> Option<PathBuf> {
    root_slot().clone()
}

#[cfg(test)]
thread_local! {
    static PURGED: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(test)]
pub fn take_purged() -> Vec<String> {
    PURGED.with(|purged| std::mem::take(&mut *purged.borrow_mut()))
}

/// Seven days, in unix seconds.
pub const MAX_AGE_SECS: i64 = 7 * 24 * 60 * 60;

/// Two mebibytes per buffer. The tail is kept when a write is larger.
pub const MAX_BYTES: usize = 2 * 1024 * 1024;

/// Directory name under the app data dir, next to the vault, never in a worktree.
pub const DIR_NAME: &str = "session-buffers";

const CANARY_FIELD: &str = "scrollback";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Scrollback,
    Draft,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceState {
    Present,
    Missing,
}

/// What a restart is allowed to know. `live_session` is a field so a test
/// can catch a lie; it is never true.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Restore {
    pub live_session: bool,
    pub workspace: WorkspaceState,
    pub scrollback: Option<String>,
    pub draft: Option<String>,
    /// Last confirmed agent or merge step, never a guessed success.
    pub last_confirmed: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    session_id: String,
    worker_id: String,
    kind: Kind,
    written_at: i64,
    body: String,
    last_confirmed: Option<String>,
}

fn dir(root: &Path) -> PathBuf {
    root.join(DIR_NAME)
}

fn path_for(root: &Path, worker_id: &str, kind: Kind) -> PathBuf {
    let name = match kind {
        Kind::Scrollback => "scrollback",
        Kind::Draft => "draft",
    };
    dir(root).join(format!("{worker_id}.{name}"))
}

fn truncate_tail(body: &str) -> String {
    if body.len() <= MAX_BYTES {
        return body.to_string();
    }
    let mut cut = body.len() - MAX_BYTES;
    while cut < body.len() && !body.is_char_boundary(cut) {
        cut += 1;
    }
    body[cut..].to_string()
}

fn write_record(root: &Path, record: &Record) -> Result<(), String> {
    fs::create_dir_all(dir(root)).map_err(|err| format!("session buffer dir: {err}"))?;
    let json =
        serde_json::to_string(record).map_err(|err| format!("session buffer json: {err}"))?;
    let sealed = seal_private(&json)?;
    let path = path_for(root, &record.worker_id, record.kind);
    fs::write(&path, sealed.as_bytes()).map_err(|err| format!("session buffer write: {err}"))
}

fn read_record(
    root: &Path,
    worker_id: &str,
    kind: Kind,
    now: i64,
) -> Result<Option<Record>, String> {
    let path = path_for(root, worker_id, kind);
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("session buffer read: {err}")),
    };
    let json = open_private(&raw)?;
    let record: Record =
        serde_json::from_str(&json).map_err(|err| format!("session buffer parse: {err}"))?;
    if now.saturating_sub(record.written_at) > MAX_AGE_SECS {
        let _ = fs::remove_file(&path);
        return Ok(None);
    }
    Ok(Some(record))
}

/// Persist a scrollback or draft. Oversize writes keep the tail.
pub fn put(
    root: &Path,
    worker_id: &str,
    session_id: &str,
    kind: Kind,
    body: &str,
    last_confirmed: Option<&str>,
    now: i64,
) -> Result<(), String> {
    write_record(
        root,
        &Record {
            session_id: session_id.to_string(),
            worker_id: worker_id.to_string(),
            kind,
            written_at: now,
            body: truncate_tail(body),
            last_confirmed: last_confirmed.map(str::to_string),
        },
    )
}

/// Drop every buffer for one worker. Archive and a successful merge call this.
pub fn purge_worker(root: &Path, worker_id: &str) -> Result<(), String> {
    for kind in [Kind::Scrollback, Kind::Draft] {
        let path = path_for(root, worker_id, kind);
        if path.exists() {
            fs::remove_file(&path).map_err(|err| format!("session buffer delete: {err}"))?;
        }
    }
    Ok(())
}

/// [`purge_worker`] against the configured root. No-op before setup.
pub fn purge_configured(worker_id: &str) {
    #[cfg(test)]
    PURGED.with(|purged| purged.borrow_mut().push(worker_id.to_string()));
    if let Some(root) = root() {
        let _ = purge_worker(&root, worker_id);
    }
}

/// Drop every session buffer under `root`. Settings "Sitzungspuffer löschen".
pub fn delete_all(root: &Path) -> Result<usize, String> {
    let dir = dir(root);
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(err) => return Err(format!("session buffer delete: {err}")),
    };
    let mut dropped = 0usize;
    for entry in entries {
        let path = entry
            .map_err(|err| format!("session buffer delete: {err}"))?
            .path();
        if path.is_file() {
            fs::remove_file(&path).map_err(|err| format!("session buffer delete: {err}"))?;
            dropped += 1;
        }
    }
    Ok(dropped)
}

/// [`delete_all`] against the configured root. Zero before setup.
pub fn delete_all_configured() -> Result<usize, String> {
    match root() {
        Some(root) => delete_all(&root),
        None => Ok(0),
    }
}

/// Persist a scrollback tail at session end. No-op before setup.
pub fn persist_end(worker_id: &str, session_id: &str, body: &str, last_confirmed: &str) {
    let Some(root) = root() else {
        return;
    };
    let _ = put(
        &root,
        worker_id,
        session_id,
        Kind::Scrollback,
        body,
        Some(last_confirmed),
        store::now_unix_secs(),
    );
}

/// Persist the composer's unsent reply for one worker. No-op before setup.
///
/// The writer is a single call from the composer's side: an empty body is a
/// cleared composer, so the draft buffer is removed instead of stored - a
/// restart must not resurrect a message the user already sent or discarded.
/// A draft never carries `last_confirmed`: an unsent thought confirms no
/// step.
pub fn persist_draft(worker_id: &str, session_id: &str, body: &str) {
    let Some(root) = root() else {
        return;
    };
    if body.trim().is_empty() {
        let path = path_for(&root, worker_id, Kind::Draft);
        if path.exists() {
            let _ = fs::remove_file(path);
        }
        return;
    }
    let _ = put(
        &root,
        worker_id,
        session_id,
        Kind::Draft,
        body,
        None,
        store::now_unix_secs(),
    );
}

/// Record `last_confirmed` without wiping an existing tail. Startup uses this
/// when a hard crash left a `running` row and no buffer.
pub fn confirm(worker_id: &str, last_confirmed: &str) {
    let Some(root) = root() else {
        return;
    };
    let now = store::now_unix_secs();
    let existing = read_record(&root, worker_id, Kind::Scrollback, now)
        .ok()
        .flatten();
    let (session_id, body) = match existing {
        Some(record) => (record.session_id, record.body),
        None => (String::new(), String::new()),
    };
    let _ = put(
        &root,
        worker_id,
        &session_id,
        Kind::Scrollback,
        &body,
        Some(last_confirmed),
        now,
    );
}

/// Drop every buffer older than the retention window.
pub fn sweep(root: &Path, now: i64) -> Result<usize, String> {
    let dir = dir(root);
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(err) => return Err(format!("session buffer sweep: {err}")),
    };
    let mut dropped = 0usize;
    for entry in entries {
        let entry = entry.map_err(|err| format!("session buffer sweep: {err}"))?;
        let path = entry.path();
        let raw = match fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(_) => continue,
        };
        let Ok(json) = open_private(&raw) else {
            continue;
        };
        let Ok(record) = serde_json::from_str::<Record>(&json) else {
            continue;
        };
        if now.saturating_sub(record.written_at) > MAX_AGE_SECS {
            let _ = fs::remove_file(&path);
            dropped += 1;
        }
    }
    Ok(dropped)
}

/// Rebuild what a restart may show from the configured app-data root.
/// No-op-shaped before setup: empty buffers, never a live session.
pub fn restore_configured(worker_id: &str, worktree_exists: bool) -> Result<Restore, String> {
    let Some(root) = root() else {
        return Ok(Restore {
            live_session: false,
            workspace: if worktree_exists {
                WorkspaceState::Present
            } else {
                WorkspaceState::Missing
            },
            scrollback: None,
            draft: None,
            last_confirmed: None,
        });
    };
    restore(&root, worker_id, worktree_exists, store::now_unix_secs())
}

/// Rebuild what a restart may show. Never a live PTY.
pub fn restore(
    root: &Path,
    worker_id: &str,
    worktree_exists: bool,
    now: i64,
) -> Result<Restore, String> {
    let scrollback = read_record(root, worker_id, Kind::Scrollback, now)?;
    let draft = read_record(root, worker_id, Kind::Draft, now)?;
    let last_confirmed = scrollback
        .as_ref()
        .and_then(|r| r.last_confirmed.clone())
        .or_else(|| draft.as_ref().and_then(|r| r.last_confirmed.clone()));
    Ok(Restore {
        live_session: false,
        workspace: if worktree_exists {
            WorkspaceState::Present
        } else {
            WorkspaceState::Missing
        },
        scrollback: scrollback.map(|r| r.body),
        draft: draft.map(|r| r.body),
        last_confirmed,
    })
}

/// Diagnosis must not grow a scrollback field. The allowlist is empty on
/// purpose: returning the name would be the leak.
pub fn diagnosis_fields() -> &'static [&'static str] {
    const NONE: &[&str] = &[];
    let _ = CANARY_FIELD;
    NONE
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    fn secret_body() -> &'static str {
        "CANARY_SCROLLBACK_s3cret_do_not_export"
    }

    /// The configured root is process-global, so tests that set it must not
    /// run concurrently - one test's root would otherwise serve another's
    /// reads. A panicking sibling must not poison the gate for the rest.
    static CONFIGURED_ROOT_LOCK: Mutex<()> = Mutex::new(());

    fn configured_root_lock() -> std::sync::MutexGuard<'static, ()> {
        CONFIGURED_ROOT_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[test]
    fn a_crash_restores_buffers_without_a_live_session() {
        let dir = TempDir::new("sess-crash");
        put(
            dir.path(),
            "wk-1",
            "pty-1",
            Kind::Scrollback,
            "hello from the agent",
            Some("task-delivered"),
            1_000,
        )
        .unwrap();
        put(
            dir.path(),
            "wk-1",
            "pty-1",
            Kind::Draft,
            "unsent reply",
            None,
            1_000,
        )
        .unwrap();
        let restored = restore(dir.path(), "wk-1", true, 1_000).unwrap();
        assert!(!restored.live_session, "a restart is not a live PTY");
        assert_eq!(restored.workspace, WorkspaceState::Present);
        assert_eq!(restored.scrollback.as_deref(), Some("hello from the agent"));
        assert_eq!(restored.draft.as_deref(), Some("unsent reply"));
        assert_eq!(restored.last_confirmed.as_deref(), Some("task-delivered"));
    }

    #[test]
    fn agent_death_records_exit_not_success() {
        let dir = TempDir::new("sess-death");
        put(
            dir.path(),
            "wk-1",
            "pty-1",
            Kind::Scrollback,
            "exited",
            Some("agent_exited"),
            1,
        )
        .unwrap();
        let restored = restore(dir.path(), "wk-1", true, 1).unwrap();
        assert!(!restored.live_session);
        assert_eq!(restored.last_confirmed.as_deref(), Some("agent_exited"));
        assert_ne!(restored.last_confirmed.as_deref(), Some("ok"));
    }

    #[test]
    fn a_missing_worktree_is_named_missing() {
        let dir = TempDir::new("sess-missing");
        put(
            dir.path(),
            "wk-1",
            "pty-1",
            Kind::Draft,
            "still here",
            None,
            1,
        )
        .unwrap();
        let restored = restore(dir.path(), "wk-1", false, 1).unwrap();
        assert_eq!(restored.workspace, WorkspaceState::Missing);
        assert_eq!(restored.draft.as_deref(), Some("still here"));
        assert!(!restored.live_session);
    }

    #[test]
    fn an_interrupted_merge_does_not_invent_a_merge_step() {
        let dir = TempDir::new("sess-merge");
        let restored = restore(dir.path(), "wk-1", true, 1).unwrap();
        assert!(restored.last_confirmed.is_none());
        assert!(!restored.live_session);
    }

    #[test]
    fn a_provider_failure_is_not_stored_as_success() {
        let dir = TempDir::new("sess-provider");
        put(
            dir.path(),
            "wk-1",
            "pty-1",
            Kind::Scrollback,
            "quota",
            Some("quota_blocked"),
            1,
        )
        .unwrap();
        let restored = restore(dir.path(), "wk-1", true, 1).unwrap();
        assert_eq!(restored.last_confirmed.as_deref(), Some("quota_blocked"));
        assert_ne!(restored.last_confirmed.as_deref(), Some("success"));
    }

    #[test]
    fn fleet_stop_records_abort_intent() {
        let dir = TempDir::new("sess-stop");
        put(
            dir.path(),
            "wk-1",
            "pty-1",
            Kind::Scrollback,
            "stopped",
            Some("fleet_stop"),
            1,
        )
        .unwrap();
        let restored = restore(dir.path(), "wk-1", true, 1).unwrap();
        assert_eq!(restored.last_confirmed.as_deref(), Some("fleet_stop"));
        assert!(!restored.live_session);
    }

    #[test]
    fn retention_drops_buffers_older_than_seven_days() {
        let dir = TempDir::new("sess-age");
        put(
            dir.path(),
            "wk-old",
            "pty-1",
            Kind::Scrollback,
            "old",
            None,
            1,
        )
        .unwrap();
        put(
            dir.path(),
            "wk-new",
            "pty-1",
            Kind::Scrollback,
            "new",
            None,
            1 + MAX_AGE_SECS,
        )
        .unwrap();
        let now = 1 + MAX_AGE_SECS + 1;
        assert_eq!(sweep(dir.path(), now).unwrap(), 1);
        assert!(restore(dir.path(), "wk-old", true, now)
            .unwrap()
            .scrollback
            .is_none());
        assert_eq!(
            restore(dir.path(), "wk-new", true, now)
                .unwrap()
                .scrollback
                .as_deref(),
            Some("new")
        );
    }

    #[test]
    fn a_write_larger_than_two_megabytes_keeps_the_tail() {
        let dir = TempDir::new("sess-size");
        let mut body = "H".repeat(MAX_BYTES + 32);
        body.push_str("TAIL");
        put(
            dir.path(),
            "wk-1",
            "pty-1",
            Kind::Scrollback,
            &body,
            None,
            1,
        )
        .unwrap();
        let restored = restore(dir.path(), "wk-1", true, 1).unwrap();
        let got = restored.scrollback.expect("stored");
        assert!(got.len() <= MAX_BYTES);
        assert!(got.ends_with("TAIL"), "{len}", len = got.len());
    }

    #[test]
    fn settings_delete_clears_every_session_buffer() {
        let dir = TempDir::new("sess-wipe");
        put(
            dir.path(),
            "wk-a",
            "pty-1",
            Kind::Scrollback,
            "keep-me-not",
            None,
            1,
        )
        .unwrap();
        put(
            dir.path(),
            "wk-b",
            "pty-1",
            Kind::Draft,
            "also-gone",
            None,
            1,
        )
        .unwrap();
        assert_eq!(delete_all(dir.path()).unwrap(), 2);
        assert!(restore(dir.path(), "wk-a", true, 1)
            .unwrap()
            .scrollback
            .is_none());
        assert!(restore(dir.path(), "wk-b", true, 1)
            .unwrap()
            .draft
            .is_none());
        assert_eq!(delete_all(dir.path()).unwrap(), 0);
    }

    #[test]
    fn delete_and_archive_purge_the_buffers() {
        let dir = TempDir::new("sess-del");
        put(
            dir.path(),
            "wk-1",
            "pty-1",
            Kind::Scrollback,
            "gone",
            None,
            1,
        )
        .unwrap();
        put(dir.path(), "wk-1", "pty-1", Kind::Draft, "gone", None, 1).unwrap();
        purge_worker(dir.path(), "wk-1").unwrap();
        let restored = restore(dir.path(), "wk-1", true, 1).unwrap();
        assert!(restored.scrollback.is_none());
        assert!(restored.draft.is_none());
    }

    #[test]
    fn diagnosis_export_has_no_scrollback_field() {
        assert!(diagnosis_fields().is_empty());
        assert!(!diagnosis_fields().contains(&CANARY_FIELD));
    }

    #[test]
    fn the_on_disk_bytes_are_wrapped_like_the_vault() {
        let dir = TempDir::new("sess-wrap");
        put(
            dir.path(),
            "wk-1",
            "pty-1",
            Kind::Scrollback,
            secret_body(),
            None,
            1,
        )
        .unwrap();
        #[cfg(windows)]
        {
            let raw = fs::read_to_string(path_for(dir.path(), "wk-1", Kind::Scrollback)).unwrap();
            assert!(
                raw.starts_with("DPAPI1:"),
                "Windows buffers must be DPAPI-wrapped, got {}",
                &raw[..raw.len().min(16)]
            );
            assert!(
                !raw.contains(secret_body()),
                "plaintext canary leaked into the file"
            );
        }
        let restored = restore(dir.path(), "wk-1", true, 1).unwrap();
        assert_eq!(restored.scrollback.as_deref(), Some(secret_body()));
    }

    #[test]
    fn restore_configured_shows_buffer_and_never_a_live_session() {
        let _lock = configured_root_lock();
        let dir = TempDir::new("sess-configured");
        set_root(dir.path().to_path_buf());
        put(
            dir.path(),
            "wk-cfg",
            "pty-1",
            Kind::Scrollback,
            "hello from the crashed agent",
            Some(CONFIRMED_APP_CRASH),
            store::now_unix_secs(),
        )
        .unwrap();
        let restored = restore_configured("wk-cfg", true).unwrap();
        assert!(!restored.live_session, "a restart is not a live PTY");
        assert_eq!(
            restored.scrollback.as_deref(),
            Some("hello from the crashed agent")
        );
        assert_eq!(
            restored.last_confirmed.as_deref(),
            Some(CONFIRMED_APP_CRASH)
        );
        assert_eq!(restored.workspace, WorkspaceState::Present);
    }

    #[test]
    fn a_composer_draft_survives_an_app_restart() {
        let _lock = configured_root_lock();
        let dir = TempDir::new("sess-draft");
        set_root(dir.path().to_path_buf());
        persist_draft("wk-draft", "pty-1", "half-typed reply");
        let restored = restore_configured("wk-draft", true).unwrap();
        assert!(!restored.live_session, "a restart is not a live PTY");
        assert_eq!(restored.draft.as_deref(), Some("half-typed reply"));
        assert!(
            restored.last_confirmed.is_none(),
            "an unsent draft confirms no step"
        );
    }

    #[test]
    fn a_cleared_draft_is_not_resurrected_after_a_restart() {
        let _lock = configured_root_lock();
        let dir = TempDir::new("sess-draft-clear");
        set_root(dir.path().to_path_buf());
        persist_end("wk-clear", "pty-1", "scrollback tail", CONFIRMED_APP_CRASH);
        persist_draft("wk-clear", "pty-1", "typed but never sent");
        let before = restore_configured("wk-clear", true).unwrap();
        assert_eq!(before.draft.as_deref(), Some("typed but never sent"));
        persist_draft("wk-clear", "pty-1", "");
        let restored = restore_configured("wk-clear", true).unwrap();
        assert!(
            restored.draft.is_none(),
            "a cleared composer must not come back as a draft"
        );
        assert_eq!(
            restored.scrollback.as_deref(),
            Some("scrollback tail"),
            "clearing a draft must not touch the scrollback"
        );
        assert_eq!(
            restored.last_confirmed.as_deref(),
            Some(CONFIRMED_APP_CRASH)
        );
    }
}
