# Delta review W1-22: tauri-plugin-log (round 2)

You reviewed this change in round 1 (prompt `.pa/review_prompt_w1-22.md`).
Below: the author's disposition of all round-1 findings, the fern source the
disposition relies on, and the delta diff since round 1. Check (a) whether the
rejections of Kimi-1 and Kimi-4 are correct given the fern source, (b) whether
the delta introduces any bug, (c) anything still blocking. Numbered findings
with severity, file:line, failing scenario, fix. Say explicitly if nothing is
blocking. Do not restate the diff.

## Disposition (round 1)

# Review-Disposition W1-22 (tauri-plugin-log)

Autor: Claude Code. Reviewer: kimi-k3 (`review_w1-22_kimi-k3.md`), glm-5.2
(`review_w1-22_glm-5.2.md`), beide über Ollama Cloud, Prompt
`review_prompt_w1-22.md`, Kandidat = Commit aade43a (grün) auf 83378cb (rot).

| Befund | Schwere | Entscheidung | Beleg / Änderung |
|---|---|---|---|
| Kimi-1: `Builder::format` erreiche das Folder-Ziel nicht, Datei bekomme Rohtext | high | **abgelehnt** (widerlegt) | fern 0.7.1 `log_impl.rs:450-491`: ein Kind-Dispatch ohne Formatter (`None`) ruft `finish_logging(record)` mit dem Datensatz, den es bekommt — und das ist der vom Eltern-Formatter über `FormatCallback::finish` (`:531`) neu gebaute, formatierte Datensatz. Kein „Backfill" eines Default-Formatters. Empirisch: der Canary läuft jetzt in genau der Plugin-Topologie (formatierter Eltern-Dispatch → unformatierter Ziel-Dispatch → Writer) und ist grün; er prüft zusätzlich `[reqwest::connect] WARN`, das nur `format_line` erzeugt. GLM kam unabhängig zum selben Schluss. |
| Kimi-2: Canary testet eine andere Topologie als Produktion | medium | **angenommen** | Canary baut jetzt `acquire_logger` nach (Kind-Dispatch zwischen Formatter und Writer, Level Warn). |
| Kimi-3: Verbraucher des alten Rotationsnamens `projecta.log.N` | low | **geprüft, keine Änderung** | Einziger Leser ist `tail_log` (nur die aktuelle Datei, `diagnosis.rs:177`); `grep projecta.log.` findet keinen weiteren Verbraucher. |
| Kimi-4: Schreibfehler würden still verworfen | low | **abgelehnt** (widerlegt), Doku präzisiert | fern `log_impl.rs:596-618` + `fallback_on_error`/`backup_logging` (`:874-887`): Fehler aus `write`/`flush` (auch aus `RotatingFile::flush`) gehen mit der schon redigierten Zeile auf stderr. Satz in `docs/plugin-matrix.md`. |
| Kimi-5: max_level nach Attach nicht mehr Off | low | **ohne Änderung** | `logging::log` braucht nur Off ↔ nicht-Off; die Level-Filter des Dispatch (Warn / projecta=Info) filtern weiter. Kein Korrektheits- oder Sicherheitseffekt (Kimi selbst: „no fix strictly required"). |
| GLM-1: Schreiben jetzt synchron im aufrufenden Thread | low | **hingenommen, dokumentiert** | Stand bereits in `docs/plugin-matrix.md`; Logging ist spärlich (9 Aufrufstellen), keine im PTY-Heißpfad. |
| GLM-2: Capability-Prüfung per Substring | low | **angenommen** | Test parst `capabilities/default.json` mit serde_json und prüft Identifier (String- und Objekt-Form) auf Präfix `log:`. |
| GLM-3: fremde Crate mit Target `projecta` | low | **abgelehnt** | Kosmetisch: Redaction gilt trotzdem; Level-Grenze Info statt Warn für diesen Fall ohne Sicherheitswirkung. |

Zusätzlich aus der Prüfung von Kimi-1 (eigener Befund): fern leitet den
**rohen** Datensatz weiter, wenn ein Formatter ohne `out.finish` zurückkehrt
(`log_impl.rs:468`). `format_line` ruft `finish` auf jedem Pfad; der Doc-Kommentar
hält diese Pflicht jetzt fest.

Da sich Code geändert hat (Test + Kommentar), folgt eine Delta-Runde
(`review_w1-22-delta_*.md`).

## fern source

```rust
// fern 0.7.1 src/log_impl.rs lines 445-491
impl Log for Dispatch {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        self.deep_enabled(metadata)
    }

    fn log(&self, record: &log::Record) {
        if self.shallow_enabled(record.metadata()) {
            match self.format {
                Some(ref format) => {
                    // flag to ensure the log message is completed even if the formatter doesn't
                    // complete the callback.
                    let mut callback_called_flag = false;

                    (format)(
                        FormatCallback(InnerFormatCallback(
                            &mut callback_called_flag,
                            self,
                            record,
                        )),
                        record.args(),
                        record,
                    );

                    if !callback_called_flag {
                        self.finish_logging(record);
                    }
                }
                None => {
                    self.finish_logging(record);
                }
            }
        }
    }

    fn flush(&self) {
        for log in &self.output {
            log.flush();
        }
    }
}

impl Dispatch {
    fn finish_logging(&self, record: &log::Record) {
        for log in &self.output {
            log.log(record);
        }
    }
// fern 0.7.1 src/log_impl.rs lines 531-545
    pub fn finish(self, formatted_message: fmt::Arguments) {
        let FormatCallback(InnerFormatCallback(callback_called_flag, dispatch, record)) = self;

        // let the dispatch know that we did in fact get called.
        *callback_called_flag = true;

        // NOTE: This needs to be updated whenever new things are added to
        // `log::Record`.
        let new_record = log::RecordBuilder::new()
            .args(formatted_message)
            .metadata(record.metadata().clone())
            .level(record.level())
            .target(record.target())
            .module_path(record.module_path())
            .file(record.file())
// fern 0.7.1 src/log_impl.rs lines 596-618
            fn log(&self, record: &log::Record) {
                fallback_on_error(record, |record| {
                    if cfg!(feature = "meta-logging-in-format") {
                        // Formatting first prevents deadlocks on file-logging,
                        // when the process of formatting itself is logged.
                        // note: this is only ever needed if some Debug, Display, or other
                        // formatting trait itself is logging.
                        let msg = format!("{}{}", record.args(), self.line_sep);

                        let mut writer = self.stream.lock().unwrap_or_else(|e| e.into_inner());

                        write!(writer, "{}", msg)?;

                        writer.flush()?;
                    } else {
                        let mut writer = self.stream.lock().unwrap_or_else(|e| e.into_inner());

                        write!(writer, "{}{}", record.args(), self.line_sep)?;

                        writer.flush()?;
                    }
                    Ok(())
                });
// fern 0.7.1 src/log_impl.rs lines 874-895
fn fallback_on_error<F>(record: &log::Record, log_func: F)
where
    F: FnOnce(&log::Record) -> Result<(), LogError>,
{
    if let Err(error) = log_func(record) {
        backup_logging(record, &error)
    }
}

fn backup_logging(record: &log::Record, error: &LogError) {
    let second = write!(
        io::stderr(),
        "Error performing logging.\
         \n\tattempted to log: {}\
         \n\trecord: {:?}\
         \n\tlogging error: {}",
        record.args(),
        record,
        error
    );

    if let Err(second_error) = second {
```

## Delta diff

```diff
diff --git a/docs/plugin-matrix.md b/docs/plugin-matrix.md
index 285e282..0aefe36 100644
--- a/docs/plugin-matrix.md
+++ b/docs/plugin-matrix.md
@@ -16,7 +16,7 @@ zusammenhält (Tauri prüft die `.plugin()`-Registrierung nicht).
 | `updater` (2) | Auto-Update über den öffentlichen Mirror `Cuarroc/ProjectA-updates` | `updater:allow-check`, `updater:allow-download`, `updater:allow-install`, `updater:allow-download-and-install` | Endpoint in `tauri.conf.json` (`plugins.updater.endpoints`), Signatur-Pubkey dort. Test: `src/updater-config.test.ts`. Läuft Rust-seitig (reqwest), **nicht** durch die Webview-CSP. |
 | `process` (2) | Neustart nach Update | `process:allow-restart` | Nur `restart`; `exit` ist nicht erlaubt (die App beendet sich über das Fenster). |
 | `single-instance` (2.4.4) | Eine Flotte, ein Fenster: der Guard verhindert, dass eine zweite Instanz denselben App-Data-Ordner und dieselbe Queue übernimmt | keine (reines Rust-Plugin, keine JS-API und damit keine Permission) | Nachgetragen 17.09.2026 (W1-06) — das Plugin fehlte in dieser Tabelle, obwohl es seit F1 registriert ist. Es muss **das erste** `.plugin()` auf dem Builder sein (`main.rs:3137`), sonst läuft Initialisierung der zweiten Instanz an; der Test `the_single_instance_guard_is_the_first_plugin_on_the_builder` (`main.rs:3936`) hält diese Position fest. Deskriptor-Grenze: `remove_descriptor_if_ours` löscht `projecta-api.json` nur bei eigenem Port und Token (`.pa/report_f1_si1_descriptor.md`). |
-| `log` (2.9.2, seit W1-22 24.09.) | Datei-Logging nach `<app data>/logs/projecta.log` (der Pfad, den Diagnostics zeigt), Rotation 1 MiB × 5 Generationen (`projecta_<datum>.log`) | keine — bewusst **kein** `log:default`: die Webview hat keinen Weg in die Datei | Ersetzt das handgerollte P2-C-Logging. Registriert im Setup (`logging::init(&handle, &dir)`), nicht am Builder: die Datei liegt unter dem App-Data-Ordner, der erst dort feststeht — und so hinter dem Single-Instance-Guard. Einziges Ziel ist die Datei (kein Stdout, kein Webview-Ziel). **Redaction:** `logging::format_line` ist der Formatter des Plugins und läuft vor jedem Ziel über jeden Datensatz, auch über die fremder Crates (die nur ab `Warn` durchkommen). Canary: `logging::tests::canary_no_secret_reaches_the_file_through_the_plugin_formatter`; Verdrahtung/Pfad/keine Permission: `the_plugin_writes_the_file_diagnostics_shows_and_the_webview_cannot`. Der Panic-Hook schreibt weiter direkt (am Plugin vorbei, redigiert). Schreiben ist jetzt synchron im aufrufenden Thread (fern), nicht mehr über einen Writer-Thread. |
+| `log` (2.9.2, seit W1-22 24.09.) | Datei-Logging nach `<app data>/logs/projecta.log` (der Pfad, den Diagnostics zeigt), Rotation 1 MiB × 5 Generationen (`projecta_<datum>.log`) | keine — bewusst **kein** `log:default`: die Webview hat keinen Weg in die Datei | Ersetzt das handgerollte P2-C-Logging. Registriert im Setup (`logging::init(&handle, &dir)`), nicht am Builder: die Datei liegt unter dem App-Data-Ordner, der erst dort feststeht — und so hinter dem Single-Instance-Guard. Einziges Ziel ist die Datei (kein Stdout, kein Webview-Ziel). **Redaction:** `logging::format_line` ist der Formatter des Plugins und läuft vor jedem Ziel über jeden Datensatz, auch über die fremder Crates (die nur ab `Warn` durchkommen). Canary: `logging::tests::canary_no_secret_reaches_the_file_through_the_plugin_formatter`; Verdrahtung/Pfad/keine Permission: `the_plugin_writes_the_file_diagnostics_shows_and_the_webview_cannot`. Der Panic-Hook schreibt weiter direkt (am Plugin vorbei, redigiert). Schreiben ist jetzt synchron im aufrufenden Thread (fern), nicht mehr über einen Writer-Thread. Scheitert das Schreiben (volle Platte), gibt fern die schon redigierte Zeile mit „Error performing logging" auf stderr aus (`fern 0.7.1 log_impl.rs::backup_logging`) — wie der alte Writer (Review W1-22, Kimi-4). |
 | `opener` (2.5.5, seit P2-J 02.09.) | Links im OS-Browser öffnen (PR-Links, Web-Interface-URL, Empfehlungen, Markdown-Preview) | `opener:allow-open-url` mit Scope `https://*`, `http://*` | Bewusst **nicht** `opener:default` (erlaubt `mailto:`/`tel:` und `reveal-item-in-dir`). Kein GitHub-only-Scope, weil das Web-Interface LAN-URLs (`http://`) öffnet. `ipc.ts::openExternal` weist alles außer http(s) vorher ab. Glob `https://*` matcht Pfade (glob 0.3.4, `require_literal_separator=false`, nachgemessen). Test: `src/opener-config.test.ts`. |
 
 ## Bewusst nicht registriert
diff --git a/src-tauri/src/logging.rs b/src-tauri/src/logging.rs
index 0ce8fa5..abf8955 100644
--- a/src-tauri/src/logging.rs
+++ b/src-tauri/src/logging.rs
@@ -181,7 +181,9 @@ const OWN_TARGET: &str = "projecta";
 
 /// The formatter the log plugin runs on every record, whatever its source,
 /// and so the redaction choke point: whatever reaches the file (or any other
-/// target added later) passed `redact::redact` here first.
+/// target added later) passed `redact::redact` here first. It has to call
+/// `out.finish` on every path: fern forwards the *raw* record when a
+/// formatter returns without it (fern 0.7.1, `log_impl.rs:468`).
 fn format_line(
     out: tauri_plugin_log::fern::FormatCallback,
     message: &std::fmt::Arguments,
@@ -300,9 +302,14 @@ mod tests {
         let dir = TempDir::new("logging-plugin-canary");
         let path = dir.path().join(LOG_FILE);
         let file = File::create(&path).expect("log file");
+        // The plugin's topology (`acquire_logger`): the builder's dispatch
+        // carries the format, each target is an unformatted child dispatch
+        // chained below it, the file writer below that (Review W1-22, Kimi-2).
+        let target = fern::Dispatch::new().chain(fern::Output::writer(Box::new(file), "\n"));
         let (_, logger) = fern::Dispatch::new()
             .format(format_line)
-            .chain(fern::Output::writer(Box::new(file), "\n"))
+            .level(log::LevelFilter::Warn)
+            .chain(target)
             .into_log();
         for target in [OWN_TARGET, "reqwest::connect"] {
             for secret in CANARIES {
@@ -340,8 +347,21 @@ mod tests {
             MAIN.contains("logging::init(&handle, &dir)"),
             "plugin not registered"
         );
-        const CAPS: &str = include_str!("../capabilities/default.json");
-        assert!(!CAPS.contains("\"log:"), "webview may write into the log");
+        // Parsed, not grepped (Review W1-22, GLM-2): object entries carry
+        // their name under `identifier`.
+        let caps: serde_json::Value =
+            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
+        let granted: Vec<&str> = caps["permissions"]
+            .as_array()
+            .expect("permissions")
+            .iter()
+            .filter_map(|p| p.as_str().or_else(|| p["identifier"].as_str()))
+            .collect();
+        assert!(granted.len() >= 4, "{granted:?}");
+        assert!(
+            !granted.iter().any(|p| p.starts_with("log:")),
+            "webview may write into the log: {granted:?}"
+        );
     }
 
     #[test]

```
