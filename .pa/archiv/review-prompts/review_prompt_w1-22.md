# Review request W1-22: tauri-plugin-log instead of hand-rolled file logging (ProjectA, Tauri 2, Rust)

You are an independent code reviewer from a different model vendor than the
author (Claude Code). Review the diff below for correctness and security
bugs. Report findings as a numbered list, each with: severity
(high/medium/low), file:line, what is wrong, a concrete failing scenario, and a
suggested fix. Say explicitly if you find nothing blocking. Do not restate the
diff.

## Task (docs/PLAN.md, W1-22)
"tauri-plugin-log statt handgerolltem File-Logging · S · Lane main.rs,
logging.rs, docs/plugin-matrix.md · Abnahme: Redaction-Canaries bleiben leer,
Diagnostics zeigt weiter den Logpfad". Hard condition from the coordinator: if
the plugin cannot guarantee redaction before disk, stop instead of weakening it.

## Design
- tauri-plugin-log 2.9.2 (tauri 2.11.5 in the lock). Only target:
  `TargetKind::Folder { path: <app data>/logs, file_name: "projecta" }` ->
  `<app data>/logs/projecta.log`, the same path `logging::log_file` returns and
  the Diagnostics tab / `GET diagnosis` (`logPath`) show. No Stdout, no Webview
  target. No `log:` permission in capabilities/default.json, so the webview's
  `plugin:log|log` command is denied by the ACL.
- Redaction: `logging::format_line` is passed to `Builder::format`, i.e. it is
  the format of the plugin's outer fern `Dispatch`; every target is chained
  below it (see plugin source excerpt), so every record - ours via
  `logging::log` (target "projecta") and any dependency's via the `log`
  facade - is `redact::redact`ed before any Output. Dependencies only at Warn
  (`level(Warn)`, `level_for("projecta", Info)`).
- Registered at runtime in the setup closure via `AppHandle::plugin` because
  the folder is only known there; this keeps the single-instance guard the
  first plugin on the builder (a source-asserting test checks that).
- Before init / if init fails, `log::max_level()` is Off and `logging::log`
  writes a redacted line to stderr (previously: unredacted stderr).
- Panic hook unchanged: writes a redacted line directly to projecta.log (past
  the plugin) and a marker file.
- Rotation: 1 MiB, `RotationStrategy::KeepSome(5)`; the plugin names
  generations `projecta_<date>.log`. `init` deletes the legacy
  `projecta.log.1..5` from the old writer.
- Removed: the mpsc writer thread, its rotation and the tests of both.
  Writing is now synchronous in the calling thread (fern Output::writer with a
  mutex, flush per record).
- Tests: `canary_no_secret_reaches_the_file_through_the_plugin_formatter`
  (fern Dispatch with `format_line`, chained to a file like the plugin's Folder
  target; 5 secret shapes x own/foreign target; red before `redact` was wired),
  `the_plugin_writes_the_file_diagnostics_shows_and_the_webview_cannot`.

## Relevant plugin source (tauri-plugin-log 2.9.2, src/lib.rs, excerpts)
```rust
// lines 309-336
impl Write for RotatingFile {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.buffer.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        if self.buffer.is_empty() {
            return Ok(());
        }
        if self.inner.is_none() {
            self.open_file().map_err(std::io::Error::other)?;
        }

        if self.current_size != 0 && self.current_size + (self.buffer.len() as u64) > self.max_size
        {
            self.rotate().map_err(std::io::Error::other)?;
        }

        if let Some(file) = self.inner.as_mut() {
            file.write_all(&self.buffer)?;
            self.current_size += self.buffer.len() as u64;
            file.flush()?;
        }
        self.buffer.clear();
        Ok(())
    }
}
// lines 549-555
    pub fn format<F>(mut self, formatter: F) -> Self
    where
        F: Fn(FormatCallback, &Arguments, &Record) + Sync + Send + 'static,
    {
        self.dispatch = self.dispatch.format(formatter);
        self
    }
// lines 721-742
    fn acquire_logger<R: Runtime>(
        app_handle: &AppHandle<R>,
        mut dispatch: fern::Dispatch,
        rotation_strategy: RotationStrategy,
        timezone_strategy: TimezoneStrategy,
        file_open_strategy: FileOpenStrategy,
        max_file_size: u64,
        targets: Vec<Target>,
    ) -> Result<(log::LevelFilter, Box<dyn log::Log>), Error> {
        let app_name = &app_handle.package_info().name;

        // setup targets
        for target in targets {
            let mut target_dispatch = fern::Dispatch::new();
            for filter in target.filters {
                target_dispatch = target_dispatch.filter(filter);
            }
            if let Some(formatter) = target.formatter {
                target_dispatch = target_dispatch.format(formatter);
            }

            let logger = match target.kind {
// lines 764-782
                #[cfg(desktop)]
                TargetKind::Stdout => std::io::stdout().into(),
                #[cfg(desktop)]
                TargetKind::Stderr => std::io::stderr().into(),
                TargetKind::Folder { path, file_name } => {
                    if !path.exists() {
                        fs::create_dir_all(&path)?;
                    }

                    let rotator = RotatingFile::new(
                        &path,
                        file_name.unwrap_or(app_name.clone()),
                        max_file_size,
                        rotation_strategy.clone(),
                        timezone_strategy.clone(),
                        file_open_strategy.clone(),
                    )?;
                    fern::Output::writer(Box::new(rotator), "\n")
                }
// lines 813-821
                TargetKind::Dispatch(dispatch) => dispatch.into(),
            };
            target_dispatch = target_dispatch.chain(logger);

            dispatch = dispatch.chain(target_dispatch);
        }

        Ok(dispatch.into_log())
    }
// lines 849-878
    pub fn build<R: Runtime>(self) -> TauriPlugin<R> {
        Self::plugin_builder()
            .setup(move |app_handle, _api| {
                if !self.is_skip_logger {
                    let (max_level, log) = Self::acquire_logger(
                        app_handle,
                        self.dispatch,
                        self.rotation_strategy,
                        self.timezone_strategy,
                        self.file_open_strategy,
                        self.max_file_size as u64,
                        self.targets,
                    )?;
                    attach_logger(max_level, log)?;
                }
                Ok(())
            })
            .build()
    }
}

/// Attaches the given logger
pub fn attach_logger(
    max_level: log::LevelFilter,
    log: Box<dyn log::Log>,
) -> Result<(), log::SetLoggerError> {
    log::set_boxed_logger(log)?;
    log::set_max_level(max_level);
    Ok(())
}
```

## Diff (Cargo.lock omitted: adds fern 0.7.1, tauri-plugin-log 2.9.2, android_logger, env_filter, num_threads)

```diff
diff --git a/.pa/task_w1-22.md b/.pa/task_w1-22.md
index 8c701c9..91f5bac 100644
--- a/.pa/task_w1-22.md
+++ b/.pa/task_w1-22.md
@@ -1,6 +1,6 @@
 # W1-22: tauri-plugin-log statt handgerolltem File-Logging
 
-Status: aktiv
+Status: historisch
 
 Paket aus `docs/PLAN.md` (Welle W1). Angelegt 2026-09-17 als ausfuehrbare
 Spezifikation; der Plan ist die Quelle, diese Datei der Auftrag.
diff --git a/docs/plugin-matrix.md b/docs/plugin-matrix.md
index b941545..285e282 100644
--- a/docs/plugin-matrix.md
+++ b/docs/plugin-matrix.md
@@ -1,6 +1,6 @@
 # Plugin- und Capability-Matrix
 
-Stand: 17.09.2026 (nachgeführt in W1-06; Substanz aus P2-F, Phase 2).
+Stand: 24.09.2026 (`log` registriert in W1-22; davor W1-06; Substanz aus P2-F, Phase 2).
 Quelle der Wahrheit sind `src-tauri/Cargo.toml`,
 `src-tauri/src/main.rs` (`.plugin()`-Aufrufe) und
 `src-tauri/capabilities/default.json`; diese Tabelle erklärt **warum**. Wer ein
@@ -16,13 +16,13 @@ zusammenhält (Tauri prüft die `.plugin()`-Registrierung nicht).
 | `updater` (2) | Auto-Update über den öffentlichen Mirror `Cuarroc/ProjectA-updates` | `updater:allow-check`, `updater:allow-download`, `updater:allow-install`, `updater:allow-download-and-install` | Endpoint in `tauri.conf.json` (`plugins.updater.endpoints`), Signatur-Pubkey dort. Test: `src/updater-config.test.ts`. Läuft Rust-seitig (reqwest), **nicht** durch die Webview-CSP. |
 | `process` (2) | Neustart nach Update | `process:allow-restart` | Nur `restart`; `exit` ist nicht erlaubt (die App beendet sich über das Fenster). |
 | `single-instance` (2.4.4) | Eine Flotte, ein Fenster: der Guard verhindert, dass eine zweite Instanz denselben App-Data-Ordner und dieselbe Queue übernimmt | keine (reines Rust-Plugin, keine JS-API und damit keine Permission) | Nachgetragen 17.09.2026 (W1-06) — das Plugin fehlte in dieser Tabelle, obwohl es seit F1 registriert ist. Es muss **das erste** `.plugin()` auf dem Builder sein (`main.rs:3137`), sonst läuft Initialisierung der zweiten Instanz an; der Test `the_single_instance_guard_is_the_first_plugin_on_the_builder` (`main.rs:3936`) hält diese Position fest. Deskriptor-Grenze: `remove_descriptor_if_ours` löscht `projecta-api.json` nur bei eigenem Port und Token (`.pa/report_f1_si1_descriptor.md`). |
+| `log` (2.9.2, seit W1-22 24.09.) | Datei-Logging nach `<app data>/logs/projecta.log` (der Pfad, den Diagnostics zeigt), Rotation 1 MiB × 5 Generationen (`projecta_<datum>.log`) | keine — bewusst **kein** `log:default`: die Webview hat keinen Weg in die Datei | Ersetzt das handgerollte P2-C-Logging. Registriert im Setup (`logging::init(&handle, &dir)`), nicht am Builder: die Datei liegt unter dem App-Data-Ordner, der erst dort feststeht — und so hinter dem Single-Instance-Guard. Einziges Ziel ist die Datei (kein Stdout, kein Webview-Ziel). **Redaction:** `logging::format_line` ist der Formatter des Plugins und läuft vor jedem Ziel über jeden Datensatz, auch über die fremder Crates (die nur ab `Warn` durchkommen). Canary: `logging::tests::canary_no_secret_reaches_the_file_through_the_plugin_formatter`; Verdrahtung/Pfad/keine Permission: `the_plugin_writes_the_file_diagnostics_shows_and_the_webview_cannot`. Der Panic-Hook schreibt weiter direkt (am Plugin vorbei, redigiert). Schreiben ist jetzt synchron im aufrufenden Thread (fern), nicht mehr über einen Writer-Thread. |
 | `opener` (2.5.5, seit P2-J 02.09.) | Links im OS-Browser öffnen (PR-Links, Web-Interface-URL, Empfehlungen, Markdown-Preview) | `opener:allow-open-url` mit Scope `https://*`, `http://*` | Bewusst **nicht** `opener:default` (erlaubt `mailto:`/`tel:` und `reveal-item-in-dir`). Kein GitHub-only-Scope, weil das Web-Interface LAN-URLs (`http://`) öffnet. `ipc.ts::openExternal` weist alles außer http(s) vorher ab. Glob `https://*` matcht Pfade (glob 0.3.4, `require_literal_separator=false`, nachgemessen). Test: `src/opener-config.test.ts`. |
 
 ## Bewusst nicht registriert
 
 | Plugin | Warum nicht (jetzt) | Wann |
 |---|---|---|
-| `log` | P2-C hat ein handgerolltes File-Logging (`logging.rs`, mpsc-Writer, Redaction als Choke-Point, Panic-Hook). Das Plugin würde einen zweiten Log-Pfad ohne Redaction öffnen. | **Wiedervorlage 17.09.2026:** Paket **W1-22** in `docs/PLAN.md` prüft den Umstieg auf `tauri-plugin-log` als Scout-Empfehlung, Bedingung ist, dass Redaction-Canaries leer bleiben und Diagnostics den Logpfad weiter zeigt. Bis dahin: nicht registriert. |
 | `dialog` | Ordner-Picker für Projekte; heute Texteingabe. Edge-Cases (Off-Screen, AppUserModelID) sind der eigentliche Aufwand. | Wenn ein Paket es braucht — `docs/PLAN.md` §3 („bewusst zurückgestellt"). Die alte Marke „Phase 8 B3" existiert seit Sanierungsplan Rev 9 nicht mehr. |
 | `notification` | Attention-Meldungen (5 Worker → 1 Meldung, Coalescing), Taskleisten-Badge. Dev-Build ist ohne AppUserModelID stumm — braucht eigenes Verify. | Wenn ein Paket es braucht — `docs/PLAN.md` §3. Die alten Marken „Phase 3.6 / Phase 8 B1" existieren seit Rev 9 nicht mehr; die Attention-Arbeit selbst ist mit F1/F3 abgenommen. |
 | `window-state` | Fenstergröße/-position merken; Off-Screen-Restore muss getestet werden. | Wenn ein Paket es braucht — `docs/PLAN.md` §3. Die alte Marke „Phase 8 B2" existiert seit Rev 9 nicht mehr. |
diff --git a/src-tauri/Cargo.toml b/src-tauri/Cargo.toml
index 65c7a81..23dfcba 100644
--- a/src-tauri/Cargo.toml
+++ b/src-tauri/Cargo.toml
@@ -54,6 +54,9 @@ base64 = "0.22"
 tauri-plugin-updater = "2"
 tauri-plugin-process = "2"
 tauri-plugin-opener = "2"
+# W1-22: file logging. Redaction sits in its formatter (`logging::format_line`);
+# no `log:` permission is granted, so the webview has no path into the file.
+tauri-plugin-log = "2.9"
 
 # One ProjectA per machine. There is one `projecta.db` and one 30-second
 # dispatcher, so a second process is not a second window - it is a second
diff --git a/src-tauri/src/logging.rs b/src-tauri/src/logging.rs
index 31eb475..0ce8fa5 100644
--- a/src-tauri/src/logging.rs
+++ b/src-tauri/src/logging.rs
@@ -1,40 +1,42 @@
-//! Hand-rolled file logging: a channel decouples the caller from the disk.
+//! File logging through `tauri-plugin-log` (W1-22; hand-rolled until then).
 //!
-//! No framework, by project decision (2026-09-01): the caller formats and
-//! redacts, one writer thread appends and rotates. A panic lands in the log
-//! and in a marker file, which the next start rotates aside for the
-//! diagnosis pack and reports.
+//! The plugin owns the file, the append and the rotation; this module owns
+//! what goes in: [`format_line`] is the plugin's formatter, runs on every
+//! record - ours and every dependency's - and redacts before the writer sees
+//! the line. A panic lands in the log and in a marker file, which the next
+//! start rotates aside for the diagnosis pack and reports.
 
-use std::fs::{self, File, OpenOptions};
+use std::fs::{self, OpenOptions};
 use std::io::Write;
 use std::path::{Path, PathBuf};
-use std::sync::mpsc::{channel, Receiver, Sender};
-use std::sync::OnceLock;
-use std::thread::JoinHandle;
 use std::time::{SystemTime, UNIX_EPOCH};
 
+use tauri_plugin_log::log::{self as facade, LevelFilter};
+use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
+
 use crate::redact;
 
 /// Rotate at 1 MiB, keep five generations.
 const DEFAULT_MAX_BYTES: u64 = 1024 * 1024;
 const GENERATIONS: usize = 5;
+/// The plugin appends `.log` to the stem; together they are [`LOG_FILE`].
+const LOG_STEM: &str = "projecta";
 const LOG_FILE: &str = "projecta.log";
 /// Written by the panic hook; read and rotated aside by the next start.
 const PANIC_MARKER: &str = ".panic-last";
 /// Where the read marker goes: the diagnosis pack (Phase 2) picks it up here.
 const PANIC_PREVIOUS: &str = ".panic-previous";
 
-static GLOBAL: OnceLock<Logger> = OnceLock::new();
-
-/// One line into the log: timestamped, handed to the writer thread.
-/// Before `init` (or if it failed) the line goes to stderr instead, so
-/// nothing is ever silently lost.
+/// One line into the log, through the plugin (which redacts it).
+/// Before `init` (or if it failed) no logger is attached and the line goes
+/// to stderr instead - redacted as well - so nothing is ever silently lost.
 pub fn log(component: &str, message: &str) {
-    let line = format!("{} [{}] {}", timestamp(), component, message);
-    match GLOBAL.get() {
-        Some(logger) => logger.send(line),
-        None => eprintln!("projecta: {line}"),
+    if facade::max_level() == LevelFilter::Off {
+        let line = format!("{} [{component}] {message}", timestamp());
+        eprintln!("projecta: {}", redact::redact(&line));
+        return;
     }
+    facade::info!(target: OWN_TARGET, "[{component}] {message}");
 }
 
 /// Formatted variant of [`log`], so callers do not build strings by hand.
@@ -45,63 +47,45 @@ macro_rules! logf {
     };
 }
 
-/// A running file logger: lines travel over the channel, the thread does the
-/// blocking I/O. Construct with [`Logger::start`]; [`init`] installs the
-/// process-global one.
-pub struct Logger {
-    tx: Sender<String>,
-    _thread: JoinHandle<()>,
+/// The plugin as ProjectA configures it: one file target at
+/// `<app data>/logs/projecta.log` (the path Diagnostics shows), no stdout and
+/// no webview target, 1 MiB x five generations, and [`format_line`] as the
+/// formatter every record passes. Dependencies only get in at `Warn`.
+fn plugin<R: tauri::Runtime>(app_data: &Path) -> tauri::plugin::TauriPlugin<R> {
+    tauri_plugin_log::Builder::new()
+        .clear_targets()
+        .target(Target::new(TargetKind::Folder {
+            path: app_data.join("logs"),
+            file_name: Some(LOG_STEM.to_string()),
+        }))
+        .format(format_line)
+        .level(LevelFilter::Warn)
+        .level_for(OWN_TARGET, LevelFilter::Info)
+        .max_file_size(u128::from(DEFAULT_MAX_BYTES))
+        .rotation_strategy(RotationStrategy::KeepSome(GENERATIONS))
+        .build()
 }
 
-impl Logger {
-    /// Start the writer thread on `<dir>/projecta.log`. Testable without
-    /// touching the process-global logger.
-    pub fn start(dir: &Path) -> Result<Self, String> {
-        Self::start_with_limit(dir, DEFAULT_MAX_BYTES)
+/// Register the log plugin on `<app data>/logs`. Returns the log file path.
+/// Calling it twice is a bug in the caller, not an error to hide.
+pub fn init<R: tauri::Runtime>(
+    app: &tauri::AppHandle<R>,
+    app_data: &Path,
+) -> Result<PathBuf, String> {
+    // The hand-rolled writer rotated to `projecta.log.1..5`; the plugin names
+    // its generations `projecta_<date>.log` and would never remove these.
+    for n in 1..=GENERATIONS {
+        let _ = fs::remove_file(app_data.join("logs").join(format!("{LOG_FILE}.{n}")));
     }
-
-    /// Same, with the rotation threshold injected - the rotation test should
-    /// not have to write a megabyte.
-    pub fn start_with_limit(dir: &Path, max_bytes: u64) -> Result<Self, String> {
-        fs::create_dir_all(dir).map_err(|e| format!("create log dir: {e}"))?;
-        let (tx, rx) = channel::<String>();
-        let writer_dir = dir.to_path_buf();
-        let thread = std::thread::Builder::new()
-            .name("log-writer".to_string())
-            .spawn(move || writer_loop(&writer_dir, rx, max_bytes))
-            .map_err(|e| format!("spawn log writer: {e}"))?;
-        Ok(Self {
-            tx,
-            _thread: thread,
-        })
-    }
-
-    /// Every line reaching the file is redacted here - the single choke point
-    /// no caller can accidentally bypass.
-    fn send(&self, line: String) {
-        let line = redact::redact(&line);
-        // A disconnected writer (should not happen) degrades to stderr.
-        if self.tx.send(line.clone()).is_err() {
-            eprintln!("projecta: {line}");
-        }
-    }
-}
-
-/// Install the process-global logger on `<app data>/logs`. Returns the log
-/// file path. Calling it twice is a bug in the caller, not an error to hide.
-pub fn init(app_data: &Path) -> Result<PathBuf, String> {
-    let dir = app_data.join("logs");
-    let logger = Logger::start(&dir)?;
-    GLOBAL
-        .set(logger)
-        .map_err(|_| "logging already initialized".to_string())?;
+    app.plugin(plugin(app_data))
+        .map_err(|e| format!("log plugin: {e}"))?;
     log("app", "logging initialized");
-    Ok(dir.join(LOG_FILE))
+    Ok(log_file(app_data))
 }
 
 /// What the panic hook does, split out so a test can call it (a hook
 /// registered globally could never be observed safely). Writes go straight to
-/// disk: the channel thread may already be gone when a panic flies.
+/// disk, past the plugin: its writer lock may be held by the panicking thread.
 pub fn handle_panic(app_data: &Path, message: &str, location: Option<(&str, u32)>) {
     let mut detail = format!("PANIC: {message}");
     if let Some((file, line)) = location {
@@ -191,85 +175,24 @@ pub fn tail_log(app_data: &Path, n: usize) -> String {
     lines[start..].join("\n")
 }
 
-fn writer_loop(dir: &Path, rx: Receiver<String>, max_bytes: u64) {
-    let path = dir.join(LOG_FILE);
-    let mut file = match open_append(&path) {
-        Ok(file) => file,
-        Err(err) => {
-            eprintln!("projecta: log file unavailable: {err}");
-            return drain_to_stderr(rx);
-        }
+/// Target of every line that comes through [`log`]; anything else is a
+/// dependency speaking through the `log` facade.
+const OWN_TARGET: &str = "projecta";
+
+/// The formatter the log plugin runs on every record, whatever its source,
+/// and so the redaction choke point: whatever reaches the file (or any other
+/// target added later) passed `redact::redact` here first.
+fn format_line(
+    out: tauri_plugin_log::fern::FormatCallback,
+    message: &std::fmt::Arguments,
+    record: &tauri_plugin_log::log::Record,
+) {
+    let line = if record.target() == OWN_TARGET {
+        message.to_string()
+    } else {
+        format!("[{}] {} {message}", record.target(), record.level())
     };
-    // The size is kept here and advanced per line; the OS is asked only when a
-    // file is (re)opened, not once per line (Review P2-C, GLM-4).
-    let mut written = current_len(&file);
-    while let Ok(line) = rx.recv() {
-        if written >= max_bytes {
-            // Handle closed before the rename: no platform has to move an
-            // open file (Review P2-C, Gemini-1).
-            drop(file);
-            file = match rotate_and_reopen(dir, &path) {
-                Ok(fresh) => fresh,
-                // A failed rotation must not end file logging for the rest of
-                // the run (Review P2-C, GLM-2): keep appending to the current
-                // file and retry the rotation on the next line.
-                Err(err) => {
-                    eprintln!("projecta: log rotation failed: {err}");
-                    match open_append(&path) {
-                        Ok(same) => same,
-                        Err(err) => {
-                            eprintln!("projecta: log file lost: {err}");
-                            eprintln!("projecta: {line}");
-                            return drain_to_stderr(rx);
-                        }
-                    }
-                }
-            };
-            written = current_len(&file);
-        }
-        if writeln!(file, "{line}").is_err() {
-            eprintln!("projecta: {line}");
-        } else {
-            written += line.len() as u64 + 1;
-        }
-        let _ = file.flush();
-    }
-}
-
-/// Callers must never learn about the writer's problem: whatever still
-/// arrives goes to stderr until every sender is gone.
-fn drain_to_stderr(rx: Receiver<String>) {
-    for line in rx {
-        eprintln!("projecta: {line}");
-    }
-}
-
-fn current_len(file: &File) -> u64 {
-    file.metadata().map(|m| m.len()).unwrap_or(0)
-}
-
-fn open_append(path: &Path) -> Result<File, std::io::Error> {
-    OpenOptions::new().create(true).append(true).open(path)
-}
-
-/// Shift `projecta.log.N` up one and the current file to `.1`; the oldest
-/// generation falls off the end. Windows refuses to rename over an existing
-/// file, so each target is removed first.
-fn rotate_and_reopen(dir: &Path, path: &Path) -> Result<File, std::io::Error> {
-    let oldest = dir.join(format!("{LOG_FILE}.{GENERATIONS}"));
-    let _ = fs::remove_file(&oldest);
-    for n in (1..GENERATIONS).rev() {
-        let from = dir.join(format!("{LOG_FILE}.{n}"));
-        if from.exists() {
-            let to = dir.join(format!("{LOG_FILE}.{}", n + 1));
-            let _ = fs::remove_file(&to);
-            fs::rename(&from, &to)?;
-        }
-    }
-    let first = dir.join(format!("{LOG_FILE}.1"));
-    let _ = fs::remove_file(&first);
-    fs::rename(path, &first)?;
-    open_append(path)
+    out.finish(format_args!("{} {}", timestamp(), redact::redact(&line)))
 }
 
 /// UTC wall-clock for the log line, computed by hand (no date crate).
@@ -306,113 +229,10 @@ fn civil_from_days(days: i64) -> (i64, u32, u32) {
 mod tests {
     use super::*;
     use crate::testutil::TempDir;
-    use std::io::Read;
+    use std::fs::File;
 
     fn read_log(dir: &Path) -> String {
-        let mut text = String::new();
-        match File::open(dir.join(LOG_FILE)) {
-            Ok(mut file) => {
-                file.read_to_string(&mut text).expect("log file reads");
-            }
-            // The writer thread creates the file; polling beats racing it.
-            Err(_) => return String::new(),
-        }
-        text
-    }
-
-    fn wait_for_content(dir: &Path, needle: &str) -> String {
-        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
-        loop {
-            let content = read_log(dir);
-            if content.contains(needle) {
-                return content;
-            }
-            assert!(
-                std::time::Instant::now() < deadline,
-                "log never contained {needle:?}: {content:?}"
-            );
-            std::thread::sleep(std::time::Duration::from_millis(50));
-        }
-    }
-
-    #[test]
-    fn starting_the_logger_creates_the_file_before_any_line_is_logged() {
-        let dir = TempDir::new("logging-exists");
-        let _logger = Logger::start(dir.path()).expect("logger starts");
-
-        let path = dir.path().join(LOG_FILE);
-        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
-        while !path.exists() {
-            assert!(
-                std::time::Instant::now() < deadline,
-                "log file never appeared"
-            );
-            std::thread::sleep(std::time::Duration::from_millis(20));
-        }
-    }
-
-    #[test]
-    fn a_logged_line_lands_redacted_in_the_file() {
-        let dir = TempDir::new("logging-redact");
-        let logger = Logger::start(dir.path()).expect("logger starts");
-
-        logger.send("test [core] key is sk-1234567890abcdef".to_string());
-
-        let content = wait_for_content(dir.path(), "[core]");
-        assert!(content.contains("[redacted]"), "{content}");
-        assert!(!content.contains("sk-1234567890abcdef"), "{content}");
-    }
-
-    #[test]
-    fn rotation_keeps_generations_when_the_file_grows_past_the_limit() {
-        let dir = TempDir::new("logging-rotate");
-        let logger = Logger::start_with_limit(dir.path(), 512).expect("logger starts");
-
-        for n in 0..40 {
-            logger.send(format!("line {n} {}", "x".repeat(40)));
-        }
-        // Both files, not just the generation: between the rename and the
-        // reopen there is a moment in which `.1` exists and the current file
-        // does not (see `the_rotation_window_has_no_current_file`). Waiting on
-        // `.1` alone let the test observe exactly that moment under load and
-        // fail on the line below - the flake this condition removes.
-        let first = dir.path().join(format!("{LOG_FILE}.1"));
-        let current = dir.path().join(LOG_FILE);
-        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
-        while !(first.exists() && current.exists()) {
-            assert!(std::time::Instant::now() < deadline, "never rotated");
-            std::thread::sleep(std::time::Duration::from_millis(50));
-        }
-    }
-
-    /// Why the test above waits for both files. Rotation renames the current
-    /// file to `.1` and only then opens a fresh one; in between, a reader sees
-    /// the generation but no current file. That window is inherent to a
-    /// rename-then-create rotation and harmless for the writer - but a test
-    /// that treats "`.1` is there" as "rotation is done" is racing it.
-    #[test]
-    fn the_rotation_window_has_no_current_file() {
-        let dir = TempDir::new("logging-window");
-        let path = dir.path().join(LOG_FILE);
-        let first = dir.path().join(format!("{LOG_FILE}.1"));
-        fs::write(&path, "a line\n").expect("seed the current file");
-
-        fs::rename(&path, &first).expect("the rename rotation does first");
-
-        assert!(first.exists(), "the generation is there");
-        assert!(
-            !path.exists(),
-            "and the current file is not - this is the window"
-        );
-
-        // What `rotate_and_reopen` guarantees once it returns: both files.
-        // It moves the *current* file aside, so there has to be one - the
-        // window above removed it.
-        fs::write(&path, "another line\n").expect("seed it again");
-        let fresh = rotate_and_reopen(dir.path(), &path).expect("rotation");
-        drop(fresh);
-        assert!(path.exists(), "rotation leaves a current file behind");
-        assert!(first.exists(), "and keeps the generation");
+        fs::read_to_string(dir.join(LOG_FILE)).unwrap_or_default()
     }
 
     #[test]
@@ -463,6 +283,67 @@ mod tests {
         assert_eq!(kept, "PANIC: second");
     }
 
+    /// Redaction canaries on the plugin path: every record, ours or a
+    /// dependency's, goes through `format_line` before the file sees it. The
+    /// dispatch is the plugin's own engine (fern, re-exported), chained to a
+    /// file the way its `Folder` target is.
+    #[test]
+    fn canary_no_secret_reaches_the_file_through_the_plugin_formatter() {
+        use tauri_plugin_log::{fern, log};
+        const CANARIES: [&str; 5] = [
+            "sk-ant-CANARYPROVIDERKEY99xxxx",
+            "ghp_CANARY1234567890abcdef",
+            "github_pat_CANARY_1234567890",
+            "AKIACANARY1234567890",
+            "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
+        ];
+        let dir = TempDir::new("logging-plugin-canary");
+        let path = dir.path().join(LOG_FILE);
+        let file = File::create(&path).expect("log file");
+        let (_, logger) = fern::Dispatch::new()
+            .format(format_line)
+            .chain(fern::Output::writer(Box::new(file), "\n"))
+            .into_log();
+        for target in [OWN_TARGET, "reqwest::connect"] {
+            for secret in CANARIES {
+                logger.log(
+                    &log::Record::builder()
+                        .target(target)
+                        .level(log::Level::Warn)
+                        .args(format_args!("[core] key is {secret}"))
+                        .build(),
+                );
+            }
+        }
+        logger.flush();
+
+        let content = fs::read_to_string(&path).expect("log reads");
+        assert_eq!(content.lines().count(), 10, "{content}");
+        let leaks: Vec<_> = CANARIES.iter().filter(|s| content.contains(*s)).collect();
+        assert!(leaks.is_empty(), "canary leaks: {leaks:?}\n{content}");
+        assert!(content.contains("[core] key is [redacted]"), "{content}");
+        assert!(
+            content.contains("[reqwest::connect] WARN [core]"),
+            "{content}"
+        );
+    }
+
+    /// Diagnostics shows `log_file`; the plugin writes `<stem>.log` into the
+    /// folder target. Both have to name the same file. And the webview must
+    /// have no way into the file: no `log:` permission in the capability.
+    #[test]
+    fn the_plugin_writes_the_file_diagnostics_shows_and_the_webview_cannot() {
+        assert_eq!(format!("{LOG_STEM}.log"), LOG_FILE);
+        assert!(log_file(Path::new("data")).ends_with("logs/projecta.log"));
+        const MAIN: &str = include_str!("main.rs");
+        assert!(
+            MAIN.contains("logging::init(&handle, &dir)"),
+            "plugin not registered"
+        );
+        const CAPS: &str = include_str!("../capabilities/default.json");
+        assert!(!CAPS.contains("\"log:"), "webview may write into the log");
+    }
+
     #[test]
     fn the_timestamp_is_utc_rfc3339_shaped() {
         let stamp = timestamp();
diff --git a/src-tauri/src/main.rs b/src-tauri/src/main.rs
index 1c1b5e0..24b7201 100644
--- a/src-tauri/src/main.rs
+++ b/src-tauri/src/main.rs
@@ -3403,8 +3403,10 @@ fn main() {
             // panic is rotated aside here and surfaces in the diagnosis pack.
             // A log directory that cannot be created must not keep the app
             // from starting: `logging::log` falls back to stderr on its own
-            // (Review P2-C, Gemini-4).
-            match logging::init(&dir) {
+            // (Review P2-C, Gemini-4). Since W1-22 this registers
+            // tauri-plugin-log here rather than on the builder: its file
+            // lives under `dir`, which exists only now.
+            match logging::init(&handle, &dir) {
                 Ok(log_path) => crate::logf!("app", "log file: {}", log_path.display()),
                 Err(err) => eprintln!("projecta: file logging unavailable, stderr only: {err}"),
             }

```
