//! File logging through `tauri-plugin-log` (W1-22; hand-rolled until then).
//!
//! The plugin owns the file, the append and the rotation; this module owns
//! what goes in: [`format_line`] is the plugin's formatter, runs on every
//! record - ours and every dependency's - and redacts before the writer sees
//! the line. A panic lands in the log and in a marker file, which the next
//! start rotates aside for the diagnosis pack and reports.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri_plugin_log::log::{self as facade, LevelFilter};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

use crate::redact;

/// Rotate at 1 MiB, keep five generations.
const DEFAULT_MAX_BYTES: u64 = 1024 * 1024;
const GENERATIONS: usize = 5;
/// The plugin appends `.log` to the stem; together they are [`LOG_FILE`].
const LOG_STEM: &str = "projecta";
const LOG_FILE: &str = "projecta.log";
/// Written by the panic hook; read and rotated aside by the next start.
const PANIC_MARKER: &str = ".panic-last";
/// Where the read marker goes: the diagnosis pack (Phase 2) picks it up here.
const PANIC_PREVIOUS: &str = ".panic-previous";

/// One line into the log, through the plugin (which redacts it).
/// Before `init` (or if it failed) no logger is attached and the line goes
/// to stderr instead - redacted as well - so nothing is ever silently lost.
pub fn log(component: &str, message: &str) {
    if facade::max_level() == LevelFilter::Off {
        let line = format!("{} [{component}] {message}", timestamp());
        eprintln!("projecta: {}", redact::redact(&line));
        return;
    }
    facade::info!(target: OWN_TARGET, "[{component}] {message}");
}

/// Formatted variant of [`log`], so callers do not build strings by hand.
#[macro_export]
macro_rules! logf {
    ($component:expr, $($arg:tt)*) => {
        $crate::logging::log($component, &format!($($arg)*))
    };
}

/// The plugin as ProjectA configures it: one file target at
/// `<app data>/logs/projecta.log` (the path Diagnostics shows), no stdout and
/// no webview target, 1 MiB x five generations, and [`format_line`] as the
/// formatter every record passes. Dependencies only get in at `Warn`.
fn plugin<R: tauri::Runtime>(app_data: &Path) -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .target(Target::new(TargetKind::Folder {
            path: app_data.join("logs"),
            file_name: Some(LOG_STEM.to_string()),
        }))
        .format(format_line)
        .level(LevelFilter::Warn)
        .level_for(OWN_TARGET, LevelFilter::Info)
        .max_file_size(u128::from(DEFAULT_MAX_BYTES))
        .rotation_strategy(RotationStrategy::KeepSome(GENERATIONS))
        .build()
}

/// Register the log plugin on `<app data>/logs`. Returns the log file path.
/// Calling it twice is a bug in the caller, not an error to hide.
pub fn init<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    app_data: &Path,
) -> Result<PathBuf, String> {
    // The hand-rolled writer rotated to `projecta.log.1..5`; the plugin names
    // its generations `projecta_<date>.log` and would never remove these.
    for n in 1..=GENERATIONS {
        let _ = fs::remove_file(app_data.join("logs").join(format!("{LOG_FILE}.{n}")));
    }
    app.plugin(plugin(app_data))
        .map_err(|e| format!("log plugin: {e}"))?;
    log("app", "logging initialized");
    Ok(log_file(app_data))
}

/// What the panic hook does, split out so a test can call it (a hook
/// registered globally could never be observed safely). Writes go straight to
/// disk, past the plugin: its writer lock may be held by the panicking thread.
pub fn handle_panic(app_data: &Path, message: &str, location: Option<(&str, u32)>) {
    let mut detail = format!("PANIC: {message}");
    if let Some((file, line)) = location {
        detail.push_str(&format!(" at {file}:{line}"));
    }
    let detail = redact::redact(&detail);
    let line = format!("{} [panic] {detail}", timestamp());
    let path = app_data.join("logs").join(LOG_FILE);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
        let _ = file.flush();
    }
    let _ = fs::write(app_data.join(PANIC_MARKER), &detail);
}

/// Forward panics into the log + marker. Call once, right after [`init`].
///
/// The hook that was installed before (Rust's default: message and, with
/// `RUST_BACKTRACE`, the backtrace on stderr) keeps running after ours, so a
/// dev build loses nothing (Review P2-C, GLM-1/Gemini-2).
pub fn install_panic_hook(app_data: PathBuf) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown payload".to_string());
        handle_panic(
            &app_data,
            &message,
            info.location().map(|loc| (loc.file(), loc.line())),
        );
        previous(info);
    }));
}

/// The next start's notice of a previous panic: the marker content, with the
/// marker rotated to `.panic-previous` so the diagnosis pack still finds it.
/// `None` when no panic was recorded.
pub fn take_panic_notice(app_data: &Path) -> Option<String> {
    let marker = app_data.join(PANIC_MARKER);
    let content = fs::read_to_string(&marker).ok()?;
    // A second panic before the diagnosis pack collected the first: the older
    // record gives way. Removed first so the rename cannot be refused by a
    // platform that will not overwrite (Review P2-C, GLM-3/Gemini-3).
    let previous = app_data.join(PANIC_PREVIOUS);
    let _ = fs::remove_file(&previous);
    let _ = fs::rename(&marker, &previous);
    log(
        "app",
        "previous run ended in a panic; the diagnosis tab has it",
    );
    Some(content)
}

/// Path of the live log file: `<app data>/logs/projecta.log`.
pub fn log_file(app_data: &Path) -> PathBuf {
    app_data.join("logs").join(LOG_FILE)
}

/// Current and previous panic markers, without rotating them.
///
/// [`take_panic_notice`] must still run at startup so the next crash has a
/// clean slot; the diagnosis pack reads both generations *before* that
/// rotation, otherwise the older previous is deleted.
pub fn read_panic_markers(app_data: &Path) -> (Option<String>, Option<String>) {
    let current = fs::read_to_string(app_data.join(PANIC_MARKER))
        .ok()
        .map(|text| text.trim_end().to_string())
        .filter(|text| !text.is_empty());
    let previous = fs::read_to_string(app_data.join(PANIC_PREVIOUS))
        .ok()
        .map(|text| text.trim_end().to_string())
        .filter(|text| !text.is_empty());
    (current, previous)
}

/// Last `n` lines of the current log file. Older rotations are not included.
pub fn tail_log(app_data: &Path, n: usize) -> String {
    let Ok(text) = fs::read_to_string(log_file(app_data)) else {
        return String::new();
    };
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

/// Target of every line that comes through [`log`]; anything else is a
/// dependency speaking through the `log` facade.
const OWN_TARGET: &str = "projecta";

/// The formatter the log plugin runs on every record, whatever its source,
/// and so the redaction choke point: whatever reaches the file (or any other
/// target added later) passed `redact::redact` here first. It has to call
/// `out.finish` on every path: fern forwards the *raw* record when a
/// formatter returns without it (fern 0.7.1, `log_impl.rs:468`).
fn format_line(
    out: tauri_plugin_log::fern::FormatCallback,
    message: &std::fmt::Arguments,
    record: &tauri_plugin_log::log::Record,
) {
    let line = if record.target() == OWN_TARGET {
        message.to_string()
    } else {
        format!("[{}] {} {message}", record.target(), record.level())
    };
    out.finish(format_args!("{} {}", timestamp(), redact::redact(&line)))
}

/// UTC wall-clock for the log line, computed by hand (no date crate).
fn timestamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let days = (secs / 86_400) as i64;
    let secs_of_day = secs % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        secs_of_day / 3600,
        (secs_of_day % 3600) / 60,
        secs_of_day % 60
    )
}

/// Civil date from days since the epoch (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;
    use std::fs::File;

    fn read_log(dir: &Path) -> String {
        fs::read_to_string(dir.join(LOG_FILE)).unwrap_or_default()
    }

    #[test]
    fn a_panic_writes_the_marker_and_a_redacted_log_line() {
        let dir = TempDir::new("logging-panic");
        let logs = dir.path().join("logs");
        fs::create_dir_all(&logs).unwrap();

        handle_panic(
            dir.path(),
            "boom with ghp_1234567890abcdef inside",
            Some(("pty.rs", 42)),
        );

        let marker = fs::read_to_string(dir.path().join(PANIC_MARKER)).expect("marker written");
        assert!(marker.contains("PANIC: boom"), "{marker}");
        assert!(marker.contains("pty.rs:42"), "{marker}");
        assert!(!marker.contains("ghp_"), "{marker}");
        let content = read_log(&logs);
        assert!(content.contains("[panic] PANIC: boom"), "{content}");
    }

    #[test]
    fn the_next_start_rotates_the_marker_aside_and_says_what_it_said() {
        let dir = TempDir::new("logging-notice");
        fs::write(dir.path().join(PANIC_MARKER), "PANIC: earlier boom").unwrap();

        let notice = take_panic_notice(dir.path());

        assert_eq!(notice.as_deref(), Some("PANIC: earlier boom"));
        assert!(!dir.path().join(PANIC_MARKER).exists());
        let kept = fs::read_to_string(dir.path().join(PANIC_PREVIOUS)).expect("rotated aside");
        assert_eq!(kept, "PANIC: earlier boom");
        assert!(take_panic_notice(dir.path()).is_none());
    }

    #[test]
    fn a_second_panic_replaces_a_previous_marker_nobody_collected() {
        let dir = TempDir::new("logging-notice-twice");
        fs::write(dir.path().join(PANIC_PREVIOUS), "PANIC: first").unwrap();
        fs::write(dir.path().join(PANIC_MARKER), "PANIC: second").unwrap();

        let notice = take_panic_notice(dir.path());

        assert_eq!(notice.as_deref(), Some("PANIC: second"));
        assert!(!dir.path().join(PANIC_MARKER).exists());
        let kept = fs::read_to_string(dir.path().join(PANIC_PREVIOUS)).expect("rotated aside");
        assert_eq!(kept, "PANIC: second");
    }

    /// Redaction canaries on the plugin path: every record, ours or a
    /// dependency's, goes through `format_line` before the file sees it. The
    /// dispatch is the plugin's own engine (fern, re-exported), chained to a
    /// file the way its `Folder` target is.
    #[test]
    fn canary_no_secret_reaches_the_file_through_the_plugin_formatter() {
        use tauri_plugin_log::{fern, log};
        const CANARIES: [&str; 5] = [
            "sk-ant-CANARYPROVIDERKEY99xxxx",
            "ghp_CANARY1234567890abcdef",
            "github_pat_CANARY_1234567890",
            "AKIACANARY1234567890",
            "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        ];
        let dir = TempDir::new("logging-plugin-canary");
        let path = dir.path().join(LOG_FILE);
        let file = File::create(&path).expect("log file");
        // The plugin's topology (`acquire_logger`): the builder's dispatch
        // carries the format, each target is an unformatted child dispatch
        // chained below it, the file writer below that (Review W1-22, Kimi-2).
        let target = fern::Dispatch::new().chain(fern::Output::writer(Box::new(file), "\n"));
        let (_, logger) = fern::Dispatch::new()
            .format(format_line)
            .level(log::LevelFilter::Warn)
            .chain(target)
            .into_log();
        for target in [OWN_TARGET, "reqwest::connect"] {
            for secret in CANARIES {
                logger.log(
                    &log::Record::builder()
                        .target(target)
                        .level(log::Level::Warn)
                        .args(format_args!("[core] key is {secret}"))
                        .build(),
                );
            }
        }
        logger.flush();

        let content = fs::read_to_string(&path).expect("log reads");
        assert_eq!(content.lines().count(), 10, "{content}");
        let leaks: Vec<_> = CANARIES.iter().filter(|s| content.contains(*s)).collect();
        assert!(leaks.is_empty(), "canary leaks: {leaks:?}\n{content}");
        assert!(content.contains("[core] key is [redacted]"), "{content}");
        assert!(
            content.contains("[reqwest::connect] WARN [core]"),
            "{content}"
        );
    }

    /// Diagnostics shows `log_file`; the plugin writes `<stem>.log` into the
    /// folder target. Both have to name the same file. And the webview must
    /// have no way into the file: no `log:` permission in the capability.
    #[test]
    fn the_plugin_writes_the_file_diagnostics_shows_and_the_webview_cannot() {
        assert_eq!(format!("{LOG_STEM}.log"), LOG_FILE);
        assert!(log_file(Path::new("data")).ends_with("logs/projecta.log"));
        const MAIN: &str = include_str!("main.rs");
        assert!(
            MAIN.contains("logging::init(&handle, &dir)"),
            "plugin not registered"
        );
        // Parsed, not grepped (Review W1-22, GLM-2): object entries carry
        // their name under `identifier`.
        let caps: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let granted: Vec<&str> = caps["permissions"]
            .as_array()
            .expect("permissions")
            .iter()
            .filter_map(|p| p.as_str().or_else(|| p["identifier"].as_str()))
            .collect();
        assert!(granted.len() >= 4, "{granted:?}");
        assert!(
            !granted.iter().any(|p| p.starts_with("log:")),
            "webview may write into the log: {granted:?}"
        );
    }

    #[test]
    fn the_timestamp_is_utc_rfc3339_shaped() {
        let stamp = timestamp();
        assert_eq!(stamp.len(), 20, "{stamp}");
        assert_eq!(&stamp[4..5], "-");
        assert_eq!(&stamp[10..11], "T");
        assert!(stamp.ends_with('Z'), "{stamp}");
        let (year, month, day) = civil_from_days(20_480); // 2026-01-27
        assert_eq!((year, month, day), (2026, 1, 27));
    }

    #[test]
    fn read_panic_markers_sees_both_generations_without_rotating() {
        let dir = TempDir::new("logging-markers");
        fs::write(dir.path().join(PANIC_MARKER), "PANIC: now").unwrap();
        fs::write(dir.path().join(PANIC_PREVIOUS), "PANIC: then").unwrap();

        let (current, previous) = read_panic_markers(dir.path());
        assert_eq!(current.as_deref(), Some("PANIC: now"));
        assert_eq!(previous.as_deref(), Some("PANIC: then"));
        assert!(dir.path().join(PANIC_MARKER).exists());
        assert!(dir.path().join(PANIC_PREVIOUS).exists());
    }

    #[test]
    fn tail_log_keeps_only_the_last_n_lines_of_the_current_file() {
        let dir = TempDir::new("logging-tail");
        let logs = dir.path().join("logs");
        fs::create_dir_all(&logs).unwrap();
        fs::write(logs.join(LOG_FILE), "one\ntwo\nthree\nfour\n").unwrap();
        fs::write(
            logs.join(format!("{LOG_FILE}.1")),
            "old-rotation-must-not-appear\n",
        )
        .unwrap();

        let tail = tail_log(dir.path(), 2);
        assert_eq!(tail, "three\nfour");
        assert!(!tail.contains("old-rotation"));
        assert!(!tail.contains("one"));
    }
}
