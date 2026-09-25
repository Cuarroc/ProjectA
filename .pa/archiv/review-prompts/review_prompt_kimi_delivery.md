# Review-Auftrag: PR #50 — Kimi-Zustellung durch den Launch-Pfad (W1-01, NT-17)

Du bist unabhängiger Reviewer. Du hattest keinen Anteil am Artefakt. Prüfe
den Diff gegen `origin/main` (Merge-Base `cea7dbe`) auf Korrektheit,
Regressionen für die anderen Provider (Codex, OpenCode, Claude), Robustheit
der Zustandsmaschine und Testabdeckung. Belege jeden Befund mit Datei und
Zeile. Urteil am Ende: `URTEIL: annehmen` / `URTEIL: überarbeiten` /
`URTEIL: ablehnen`, dann nummerierte Befunde mit Schwere (hoch/mittel/niedrig).

Kontext: `.pa/report_kimi_raw_stream_2026-09-16.md` (Ursachen, Belege,
Smoke-Timelines). Kernänderungen:

1. `src-tauri/src/pty.rs`: der Reader-Thread beantwortet `ESC[6n`
   (Cursor-Positions-Abfrage) mit `ESC[1;1R`, chunk-übergreifend
   (`CursorReportScanner`); opt-in I/O-Trace `PROJECTA_PTY_TRACE_DIR`.
2. `src-tauri/src/submit_guard.rs`: ohne Readiness-Marker zählt nur
   sichtbarer Inhalt als Startausgabe; neuer Zustand `AwaitingEnter`
   (Enter erst nach 1 s Ruhe nach dem Echo, Cap 5 s); nach dem Write werden
   Dialoge nur noch in der Ausgabe seit dem Write erkannt.
3. `src-tauri/resources/agent-defaults.json`: Kimi-Worker mit `--auto`.
4. `src-tauri/src/testutil.rs`: Capture-Harness mit Env-Schaltern
   (nur `#[ignore]`-Harness, kein Produktionscode).
5. Fixture `src-tauri/testdata/pty/kimi-0.43.0-composer-2026-09-16.raw`.

Fragen, die mich besonders interessieren:
- Kann die doppelte Antwort auf `ESC[6n` (Reader-Thread plus ein später
  gemountetes xterm.js, das den Scrollback nachspielt) einer TUI schaden?
- Verschiebt `AwaitingEnter` die Retry-/Eskalations-Uhren so, dass ein
  bestehendes Verhalten für Codex/OpenCode kippt?
- Ist die Dialog-Erkennung nur in `tail_since_write` nach dem Write
  fail-closed genug (ein echter Dialog nach dem Write wird noch beantwortet)?
- Ist `--auto` für Kimi-Worker mit den Policies in AGENTS.md verträglich
  (Freigabepolitik, `pa ask`)?

## Diff

diff --git a/.gitattributes b/.gitattributes
index 52e4e0e..9f9c19b 100644
--- a/.gitattributes
+++ b/.gitattributes
@@ -8,3 +8,7 @@ Cargo.lock text eol=lf
 # Checkout-Hash mit dem Build-Hash deckungsgleich (Doctor-Befund 15.09.).
 src-tauri/resources/agent-defaults.json text eol=lf
 .pa/ACTIVITY.md merge=union
+# Rohe PTY-Mitschnitte (ANSI, CR/LF byte-genau): nie normalisieren.
+src-tauri/testdata/pty/*.raw binary
+# Rohe PTY-Mitschnitte (ANSI, CR/LF byte-genau): nie normalisieren.
+src-tauri/testdata/pty/*.raw binary
diff --git a/src-tauri/resources/agent-defaults.json b/src-tauri/resources/agent-defaults.json
index 988c9a1..1a5a0d0 100644
--- a/src-tauri/resources/agent-defaults.json
+++ b/src-tauri/resources/agent-defaults.json
@@ -17,7 +17,7 @@
       "env": {}, "fallback": null, "enabled": true
     },
     {
-      "id": "kimi", "name": "Kimi CLI", "command": "kimi", "args": [],
+      "id": "kimi", "name": "Kimi CLI", "command": "kimi", "args": ["--auto"],
       "caps": {
         "systemPrompt": { "mode": "file", "flag": "--agent-file", "ext": "md" },
         "skills": { "mode": "flag", "flag": "--skills-dir" },
diff --git a/src-tauri/src/profiles.rs b/src-tauri/src/profiles.rs
index c6fcf73..45122cb 100644
--- a/src-tauri/src/profiles.rs
+++ b/src-tauri/src/profiles.rs
@@ -419,6 +419,25 @@ mod tests {
         );
     }
 
+    /// W1-01 (user decision 2026-09-17): Kimi Code starts in plan mode
+    /// (`default_plan_mode = true` in the user's config) and its plan
+    /// approval ("Ready to build with this plan? 1. Approve") is a
+    /// `needs_you` verdict by design - the last manual assist in the Kimi
+    /// smoke. Workers run Kimi in "Never Ask" mode (`--auto`): plans and
+    /// tool approvals are decided by Kimi, decisions go through `pa ask`.
+    #[test]
+    fn the_kimi_profile_runs_workers_in_never_ask_mode() {
+        let kimi = default_profiles()
+            .into_iter()
+            .find(|profile| profile.id == "kimi")
+            .expect("kimi");
+        assert_eq!(kimi.args, vec!["--auto"]);
+        // Still no readiness marker: Kimi's empty composer has no stable
+        // placeholder, and a boot-only marker would time out on reused
+        // sessions (.pa/report_kimi_raw_stream_2026-09-16.md §1).
+        assert_eq!(kimi.caps.readiness_marker, None);
+    }
+
     /// NT-17: OpenCode's TUI flushes input written before its loop runs, so
     /// its profiles are the ones that carry the readiness marker.
     #[test]
diff --git a/src-tauri/src/pty.rs b/src-tauri/src/pty.rs
index ec588c0..2f3937f 100644
--- a/src-tauri/src/pty.rs
+++ b/src-tauri/src/pty.rs
@@ -207,6 +207,57 @@ struct Session {
     /// Set as soon as a session is killed. It lets a sleeping guard stop before
     /// the child reaper has removed the session from the registry.
     submit_guard_cancelled: Arc<AtomicBool>,
+    /// Opt-in raw I/O trace (`PROJECTA_PTY_TRACE_DIR`): every write into the
+    /// PTY and every output chunk, with a millisecond clock, plus the raw
+    /// output bytes in a sidecar. Off unless the directory is set - it
+    /// records task text. The W1-01 diagnosis needed exactly this view of
+    /// the launch path, which no harness reproduced.
+    trace: Option<SessionTrace>,
+}
+
+/// See [`Session::trace`].
+struct SessionTrace {
+    started: Instant,
+    log: Mutex<std::fs::File>,
+    raw_out: Mutex<std::fs::File>,
+}
+
+impl SessionTrace {
+    const ENV_DIR: &'static str = "PROJECTA_PTY_TRACE_DIR";
+
+    fn open(session_id: &str) -> Option<Self> {
+        let dir = std::env::var_os(Self::ENV_DIR).filter(|d| !d.is_empty())?;
+        let dir = std::path::PathBuf::from(dir);
+        std::fs::create_dir_all(&dir).ok()?;
+        let open = |name: String| {
+            std::fs::OpenOptions::new()
+                .create(true)
+                .append(true)
+                .open(dir.join(name))
+                .ok()
+        };
+        Some(Self {
+            started: Instant::now(),
+            log: Mutex::new(open(format!("{session_id}.io.log"))?),
+            raw_out: Mutex::new(open(format!("{session_id}.out.raw"))?),
+        })
+    }
+
+    fn note(&self, direction: &str, bytes: &[u8]) {
+        let ms = self.started.elapsed().as_millis();
+        let escaped: String = bytes
+            .iter()
+            .map(|b| std::ascii::escape_default(*b).to_string())
+            .collect();
+        if let Ok(mut log) = self.log.lock() {
+            let _ = writeln!(log, "t={ms}ms {direction} {} bytes: {escaped}", bytes.len());
+        }
+        if direction == "out" {
+            if let Ok(mut raw) = self.raw_out.lock() {
+                let _ = raw.write_all(bytes);
+            }
+        }
+    }
 }
 
 #[cfg(test)]
@@ -560,6 +611,7 @@ impl PtyManager {
             scrollback: Arc::clone(&scrollback),
             last_output: Arc::clone(&last_output),
             submit_guard_cancelled: Arc::clone(&submit_guard_cancelled),
+            trace: SessionTrace::open(&session_id),
         });
 
         // Keep the pseudoconsole alive until failed insertion has killed and
@@ -576,6 +628,7 @@ impl PtyManager {
             scrollback,
             last_output,
             Arc::clone(&self.on_output),
+            Arc::downgrade(&session),
         );
 
         // Reap the child on its own thread so that `kill_pty` never blocks on `wait`.
@@ -962,12 +1015,19 @@ fn abort_failed_spawn(child: &mut (dyn Child + Send + Sync)) -> bool {
 }
 
 fn write_session(session: &Session, data: &str) -> Result<(), String> {
+    write_session_bytes(session, data.as_bytes())
+}
+
+fn write_session_bytes(session: &Session, data: &[u8]) -> Result<(), String> {
+    if let Some(trace) = &session.trace {
+        trace.note("in", data);
+    }
     let mut writer = session
         .writer
         .lock()
         .map_err(|_| "pty writer is poisoned".to_string())?;
     writer
-        .write_all(data.as_bytes())
+        .write_all(data)
         .map_err(|e| format!("failed to write to pty: {e}"))?;
     writer
         .flush()
@@ -1012,6 +1072,53 @@ fn await_reader_retirement(
         .map_err(|error| format!("PTY reader retirement unconfirmed: {error}"))
 }
 
+/// The terminal's answer to a cursor-position report (`ESC[6n`): row 1,
+/// column 1. Any plausible position does - the TUIs that ask use the reply
+/// to find out *whether* a terminal is listening, and lay out a full screen
+/// of their own right after.
+const CURSOR_POSITION_REPLY: &[u8] = b"\x1b[1;1R";
+
+/// Finds cursor-position reports (`ESC[6n`) in a byte stream, across read
+/// chunks (W1-01).
+///
+/// ConPTY passes the query through to whatever reads the master side and
+/// never answers it itself. Inside the app the only thing that ever replied
+/// was an attached xterm.js view - and a worker spawned from the CLI or the
+/// queue has none. Kimi Code 0.43.0 blocks its *entire* startup on that reply
+/// (captured 2026-09-16: four bytes, then 200 s of silence), so the submit
+/// guard met a process that had rendered nothing and consumed nothing, read
+/// the silence as "settled" and typed three copies of the task into a
+/// blocked stdin. The reader thread now answers the query itself.
+#[derive(Debug, Default)]
+struct CursorReportScanner {
+    /// How many bytes of the query were matched at the end of the previous
+    /// chunk (0..=3): the four-byte sequence may straddle two reads.
+    matched: usize,
+}
+
+impl CursorReportScanner {
+    const QUERY: &'static [u8] = b"\x1b[6n";
+
+    /// Feed one chunk; returns how many complete queries it contained.
+    fn feed(&mut self, bytes: &[u8]) -> usize {
+        let mut found = 0;
+        for &byte in bytes {
+            if byte == Self::QUERY[self.matched] {
+                self.matched += 1;
+                if self.matched == Self::QUERY.len() {
+                    found += 1;
+                    self.matched = 0;
+                }
+            } else {
+                // A mismatch restarts the match - and the byte may itself be
+                // the query's first byte (`ESC ESC [6n`).
+                self.matched = usize::from(byte == Self::QUERY[0]);
+            }
+        }
+        found
+    }
+}
+
 fn spawn_reader_thread(
     app: AppHandle,
     session_id: String,
@@ -1019,11 +1126,15 @@ fn spawn_reader_thread(
     scrollback: Arc<Mutex<Scrollback>>,
     last_output: Arc<Mutex<Option<Instant>>>,
     on_output: Arc<Mutex<Option<OutputHook>>>,
+    // Weak: the reader must not keep the pseudoconsole alive past the
+    // registry; it only needs the writer while the session still exists.
+    replier: std::sync::Weak<Session>,
 ) -> std::sync::mpsc::Receiver<()> {
     track_reader_retirement(move || {
         let event = format!("pty:output:{session_id}");
         let mut decoder = Utf8Stream::new();
         let mut buf = vec![0u8; READ_CHUNK];
+        let mut cursor_reports = CursorReportScanner::default();
 
         loop {
             match reader.read(&mut buf) {
@@ -1033,6 +1144,28 @@ fn spawn_reader_thread(
                     if let Ok(mut sb) = scrollback.lock() {
                         sb.push(bytes);
                     }
+                    if let Some(session) = replier.upgrade() {
+                        if let Some(trace) = &session.trace {
+                            trace.note("out", bytes);
+                        }
+                    }
+                    // Answer the terminal query before anything else sees the
+                    // chunk: a TUI blocked on it produces nothing further,
+                    // and the guard's silence heuristic must not meet that.
+                    let queries = cursor_reports.feed(bytes);
+                    if queries > 0 {
+                        if let Some(session) = replier.upgrade() {
+                            for _ in 0..queries {
+                                if let Err(err) =
+                                    write_session_bytes(&session, CURSOR_POSITION_REPLY)
+                                {
+                                    eprintln!(
+                                        "projecta: cursor-position reply failed ({session_id}): {err}"
+                                    );
+                                }
+                            }
+                        }
+                    }
                     let chunk = decoder.push(bytes);
                     if chunk.is_empty() {
                         continue;
@@ -2207,6 +2340,23 @@ mod tests {
         );
     }
 
+    /// W1-01 (NT-17, Kimi): the first four bytes Kimi Code 0.43.0 ever
+    /// prints are `ESC[6n`, and without a reply it prints nothing else
+    /// (`testdata/pty/kimi-0.43.0-composer-2026-09-16.raw` starts with them;
+    /// the no-reply run stayed at four bytes for 200 s). The reader must
+    /// find the query even when a read boundary splits it, and must not be
+    /// fooled by the queries it does not answer (`ESC[?996n`).
+    #[test]
+    fn a_cursor_position_report_is_found_across_read_chunks() {
+        let mut scanner = CursorReportScanner::default();
+        assert_eq!(scanner.feed(b"\x1b[6n\x1b[?9001h\x1b[?1004h"), 1);
+        assert_eq!(scanner.feed(b"\x1b["), 0, "half a query is not a query");
+        assert_eq!(scanner.feed(b"6n"), 1, "the second half completes it");
+        assert_eq!(scanner.feed(b"\x1b[?996n\x1b[?u\x1b[m"), 0);
+        assert_eq!(scanner.feed(b"\x1b\x1b[6n\x1b[6n"), 2);
+        assert_eq!(CURSOR_POSITION_REPLY, b"\x1b[1;1R");
+    }
+
     /// npm-installed agents (`claude`, `codex`, ...) are `.cmd` shims on Windows,
     /// which `CreateProcess` refuses to run directly.
     #[cfg(windows)]
diff --git a/src-tauri/src/submit_guard.rs b/src-tauri/src/submit_guard.rs
index 31a0419..828a4d0 100644
--- a/src-tauri/src/submit_guard.rs
+++ b/src-tauri/src/submit_guard.rs
@@ -34,6 +34,16 @@ pub const MARKER_BUSY_CAP: Duration = Duration::from_secs(120);
 pub const ANSWER_MARKER_CAP: Duration = Duration::from_secs(600);
 /// Full task writes before the guard gives up.
 pub const MAX_WRITES: u8 = 3;
+/// After the echo the Enter waits until the TUI has been quiet this long
+/// (W1-01): Kimi Code 0.43 folds an Enter that arrives on the heels of a
+/// paste into the paste - the launch-path trace of 2026-09-17 shows the
+/// composer growing by one empty line ("↑ 14 more") 29 ms after its
+/// redraw, and no submission. A gap of a hundred milliseconds or more
+/// submitted in every harness run; one second is the safe side of that.
+pub const ENTER_SETTLE: Duration = Duration::from_secs(1);
+/// A TUI that keeps repainting after the echo (a spinner, a status clock)
+/// still gets its Enter, at the latest this long after the echo.
+pub const ENTER_SETTLE_CAP: Duration = Duration::from_secs(5);
 /// Silence windows after the task's Enter and each synthetic Enter retry.
 pub const RETRY_BACKOFF: [Duration; 3] = [
     Duration::from_secs(15),
@@ -127,6 +137,8 @@ pub enum SubmitState {
     IdleWatching,
     /// The task text was written; waiting for the TUI to echo it.
     AwaitingEcho,
+    /// The echo was seen; the Enter waits for the paste to settle.
+    AwaitingEnter,
     /// The echo was seen and Enter sent; waiting for the agent to react.
     /// The number is the Enter retries used so far.
     AwaitingWork(u8),
@@ -151,6 +163,12 @@ enum StateData {
         bytes_at_write: u64,
         last_bytes: u64,
     },
+    /// The echo proved the write landed; the Enter goes once the TUI has
+    /// been quiet for [`ENTER_SETTLE`] (or [`ENTER_SETTLE_CAP`] after the
+    /// echo at the latest).
+    AwaitingEnter {
+        echo_at: Instant,
+    },
     AwaitingWork {
         /// The first Enter; the answer-marker wait is capped from here.
         entered_at: Instant,
@@ -284,6 +302,7 @@ impl SubmitGuard {
         match self.state {
             StateData::IdleWatching { .. } => SubmitState::IdleWatching,
             StateData::AwaitingEcho { .. } => SubmitState::AwaitingEcho,
+            StateData::AwaitingEnter { .. } => SubmitState::AwaitingEnter,
             StateData::AwaitingWork { attempt, .. } => SubmitState::AwaitingWork(attempt),
             StateData::Delivered => SubmitState::Delivered,
             StateData::Escalated(_) => SubmitState::Escalated,
@@ -338,15 +357,28 @@ impl SubmitGuard {
         // left over in the tail from an earlier text is history, not proof.
         if let StateData::AwaitingEcho { bytes_at_write, .. } = self.state {
             if self.echo_seen(obs, bytes_at_write) {
-                self.state = StateData::AwaitingWork {
-                    entered_at: obs.now,
-                    sent_at: obs.now,
-                    attempt: 0,
-                    bytes_at_enter: obs.output_bytes,
-                    last_bytes: obs.output_bytes,
-                };
-                return Some(SubmitAction::SendEnter { attempt: 0 });
+                // Not the Enter yet: an Enter on the heels of the paste is
+                // folded into it (Kimi, W1-01). The next arm sends it once
+                // the TUI has been quiet for ENTER_SETTLE.
+                self.state = StateData::AwaitingEnter { echo_at: obs.now };
+            }
+        }
+        if let StateData::AwaitingEnter { echo_at } = self.state {
+            let quiet = obs
+                .last_output
+                .is_none_or(|last| obs.now.saturating_duration_since(last) >= ENTER_SETTLE);
+            let capped = obs.now.saturating_duration_since(echo_at) >= ENTER_SETTLE_CAP;
+            if !(quiet || capped) {
+                return None;
             }
+            self.state = StateData::AwaitingWork {
+                entered_at: obs.now,
+                sent_at: obs.now,
+                attempt: 0,
+                bytes_at_enter: obs.output_bytes,
+                last_bytes: obs.output_bytes,
+            };
+            return Some(SubmitAction::SendEnter { attempt: 0 });
         }
         // Dialogs are only answered before delivery: after the Enter, words
         // in the agent's own output that look like a marker must not type
@@ -393,9 +425,14 @@ impl SubmitGuard {
                     && squash(last_chars(obs.tail, MARKER_SCREEN_CHARS))
                         .contains(&self.readiness_marker);
                 if self.readiness_marker.is_empty() {
-                    // Without a configured marker the old rule stands,
-                    // bit-exact: silence heuristic or the 30s give-up.
+                    // Without a configured marker the old rule stands:
+                    // silence heuristic or the 30s give-up. "Output" means
+                    // something visible, though (W1-01): Kimi's opening
+                    // bytes are a bare cursor-position query, and a TUI
+                    // that has drawn nothing and gone quiet is blocked on
+                    // its terminal handshake, not settled at its prompt.
                     let settled = first_output.is_some()
+                        && !squash(obs.tail).is_empty()
                         && last_output.is_some_and(|last| {
                             obs.now.saturating_duration_since(last) >= READY_IDLE_AFTER
                         });
@@ -536,6 +573,9 @@ impl SubmitGuard {
                 };
                 Some(SubmitAction::SendEnter { attempt: next })
             }
+            // Handled above, before the dialog check: the echo proved no
+            // dialog is in the way.
+            StateData::AwaitingEnter { .. } => None,
             StateData::Delivered | StateData::Escalated(_) => None,
         }
     }
@@ -543,7 +583,16 @@ impl SubmitGuard {
     /// A dialog answer, when a known blocking dialog is on screen. Checked
     /// ahead of every state: the dialog swallows anything else we would type.
     fn dialog_action(&mut self, obs: &Observation) -> Option<SubmitAction> {
-        let kind = detect_blocking_dialog(obs.tail)?;
+        // Once the task is written, only a dialog that appeared *after* the
+        // write can be in its way. The dismissed trust dialog stays inside
+        // the full tail's dialog window for a while, and re-answering it
+        // typed `Up, Enter` into the composer 100 ms behind the task text
+        // (launch-path trace 2026-09-17, smoke 7).
+        let haystack = match self.state {
+            StateData::AwaitingEcho { .. } => obs.tail_since_write,
+            _ => obs.tail,
+        };
+        let kind = detect_blocking_dialog(haystack)?;
         if self.dialog_answers >= MAX_DIALOG_ANSWERS {
             return None;
         }
@@ -917,8 +966,10 @@ mod tests {
 
         // The TUI re-wraps the input box mid-word; the match must survive it.
         let echoed = "prompt > Baue eine Datei no\ntes.txt mit einer Zeile Inhalt.";
+        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), echoed)), None);
+        assert_eq!(guard.state(), SubmitState::AwaitingEnter);
         assert_eq!(
-            guard.tick(&obs(start, 31, 600, Some(31), echoed)),
+            guard.tick(&obs(start, 32, 600, Some(31), echoed)),
             Some(SubmitAction::SendEnter { attempt: 0 })
         );
         assert_eq!(guard.state(), SubmitState::AwaitingWork(0));
@@ -934,6 +985,7 @@ mod tests {
         let mut guard = SubmitGuard::new(start, TASK);
         let _ = guard.tick(&obs(start, 30, 400, Some(1), "boot"));
         let _ = guard.tick(&obs(start, 31, 600, Some(31), TASK));
+        let _ = guard.tick(&obs(start, 32, 600, Some(31), TASK));
 
         assert_eq!(guard.tick(&obs(start, 33, 900, Some(33), TASK)), None);
         assert_eq!(guard.state(), SubmitState::Delivered);
@@ -947,25 +999,26 @@ mod tests {
         let start = Instant::now();
         let mut guard = SubmitGuard::new(start, TASK);
         let _ = guard.tick(&obs(start, 30, 400, Some(1), "boot"));
+        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), TASK)), None);
         assert_eq!(
-            guard.tick(&obs(start, 31, 600, Some(31), TASK)),
+            guard.tick(&obs(start, 32, 600, Some(31), TASK)),
             Some(SubmitAction::SendEnter { attempt: 0 })
         );
 
         assert_eq!(
-            guard.tick(&obs(start, 46, 600, Some(31), TASK)),
+            guard.tick(&obs(start, 47, 600, Some(31), TASK)),
             Some(SubmitAction::SendEnter { attempt: 1 })
         );
         assert_eq!(
-            guard.tick(&obs(start, 76, 600, Some(31), TASK)),
+            guard.tick(&obs(start, 77, 600, Some(31), TASK)),
             Some(SubmitAction::SendEnter { attempt: 2 })
         );
         assert_eq!(
-            guard.tick(&obs(start, 136, 600, Some(31), TASK)),
+            guard.tick(&obs(start, 137, 600, Some(31), TASK)),
             Some(SubmitAction::SendEnter { attempt: 3 })
         );
         assert_eq!(
-            guard.tick(&obs(start, 196, 600, Some(31), TASK)),
+            guard.tick(&obs(start, 197, 600, Some(31), TASK)),
             Some(SubmitAction::Escalate)
         );
         assert!(guard.is_done());
@@ -1169,11 +1222,16 @@ Hooks need review 2 hooks are new or changed. > 1. Review hooks 2. Trust all and
         // The composer shows only the collapsed indicator and the tail of
         // the input - the longest line ("Create the file...") is hidden.
         let collapsed = "ask anything\n↑ 17 more\n- Ende. ▮";
+        assert_eq!(guard.tick(&obs(start, 31, 900, Some(31), collapsed)), None);
         assert_eq!(
-            guard.tick(&obs(start, 31, 900, Some(31), collapsed)),
-            Some(SubmitAction::SendEnter { attempt: 0 }),
+            guard.state(),
+            SubmitState::AwaitingEnter,
             "the visible input tail is proof the write landed"
         );
+        assert_eq!(
+            guard.tick(&obs(start, 32, 900, Some(31), collapsed)),
+            Some(SubmitAction::SendEnter { attempt: 0 })
+        );
     }
 
     #[test]
@@ -1220,6 +1278,50 @@ Hooks need review 2 hooks are new or changed. > 1. Review hooks 2. Trust all and
         assert_eq!(BlockingDialog::KimiTrust.keystrokes(), "\u{1b}[A\r");
     }
 
+    /// Smoke 7 trace (2026-09-17): the trust dialog was answered at 1.8 s,
+    /// Kimi rendered the composer, the task went in at 5.7 s - and 100 ms
+    /// later the guard typed `Up, Enter` into the composer once more,
+    /// because the dismissed dialog's text still sat inside the full tail's
+    /// dialog window. After the write only output since the write may show
+    /// a dialog worth answering.
+    #[test]
+    fn a_dismissed_dialog_is_not_answered_again_behind_the_written_task() {
+        let start = Instant::now();
+        let mut guard = SubmitGuard::new(start, TASK);
+        let dialog = "This folder is not trusted yet. > Don't trust this folder Trust this folder";
+        assert_eq!(
+            guard.tick(&obs(start, 2, 300, Some(2), dialog)),
+            Some(SubmitAction::AnswerDialog(BlockingDialog::KimiTrust))
+        );
+        // Composer rendered below the still-visible dialog text; quiet.
+        let composer = format!("{dialog} Welcome to Kimi Code! > ");
+        assert_eq!(guard.tick(&obs(start, 3, 900, Some(3), &composer)), None);
+        // Before the write the full-tail window still re-answers the ghost
+        // once the cooldown passed (`Up, Enter` into an empty composer is a
+        // no-op; known, not fixed here). The write follows.
+        assert_eq!(
+            guard.tick(&obs(start, 6, 900, Some(3), &composer)),
+            Some(SubmitAction::AnswerDialog(BlockingDialog::KimiTrust))
+        );
+        assert_eq!(
+            guard.tick(&obs(start, 7, 900, Some(3), &composer)),
+            Some(SubmitAction::WriteTask { write: 1 })
+        );
+        // Nothing new since the write yet: the old dialog text must not be
+        // answered into the composer.
+        assert_eq!(
+            guard.tick(&obs_since(start, 8, 900, Some(3), &composer, "")),
+            None
+        );
+        assert_eq!(guard.state(), SubmitState::AwaitingEcho);
+        // A dialog that really appears after the write is still answered.
+        let late = "Do you trust the contents of this directory? > Yes";
+        assert_eq!(
+            guard.tick(&obs_since(start, 9, 950, Some(9), &composer, late)),
+            Some(SubmitAction::AnswerDialog(BlockingDialog::CodexTrust))
+        );
+    }
+
     #[test]
     fn dialog_answers_respect_the_cooldown_and_the_cap() {
         let start = Instant::now();
@@ -1306,15 +1408,16 @@ Hooks need review 2 hooks are new or changed. > 1. Review hooks 2. Trust all and
         let start = Instant::now();
         let mut guard = SubmitGuard::new(start, TASK);
         let _ = guard.tick(&obs(start, 30, 400, Some(1), "boot"));
+        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), TASK)), None);
         assert_eq!(
-            guard.tick(&obs(start, 31, 600, Some(31), TASK)),
+            guard.tick(&obs(start, 32, 600, Some(31), TASK)),
             Some(SubmitAction::SendEnter { attempt: 0 })
         );
 
         let agent_output =
             "I ran the Quick safety check: Is this a project clean? Yes, I trust this folder now.";
         assert_eq!(
-            guard.tick(&obs(start, 32, 900, Some(32), agent_output)),
+            guard.tick(&obs(start, 33, 900, Some(33), agent_output)),
             None
         );
         assert!(guard.is_delivered());
@@ -1478,15 +1581,16 @@ Hooks need review 2 hooks are new or changed. > 1. Review hooks 2. Trust all and
             Some(SubmitAction::WriteTask { write: 1 })
         );
         let echoed = format!("prompt > {TASK}");
+        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), &echoed)), None);
         assert_eq!(
-            guard.tick(&obs(start, 31, 600, Some(31), &echoed)),
+            guard.tick(&obs(start, 32, 600, Some(31), &echoed)),
             Some(SubmitAction::SendEnter { attempt: 0 })
         );
 
         // Nur die Statuszeile wurde neu gezeichnet: 3 Bytes Spinner, kein
         // Antwort-Marker.
         let spinner = format!("{echoed} ◐");
-        assert_eq!(guard.tick(&obs(start, 32, 603, Some(32), &spinner)), None);
+        assert_eq!(guard.tick(&obs(start, 33, 603, Some(33), &spinner)), None);
         assert!(!guard.is_confirmed());
     }
 
@@ -1503,8 +1607,9 @@ Hooks need review 2 hooks are new or changed. > 1. Review hooks 2. Trust all and
             Some(SubmitAction::WriteTask { write: 1 })
         );
         let echoed = format!("prompt > {TASK}");
+        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), &echoed)), None);
         assert_eq!(
-            guard.tick(&obs(start, 31, 600, Some(31), &echoed)),
+            guard.tick(&obs(start, 32, 600, Some(31), &echoed)),
             Some(SubmitAction::SendEnter { attempt: 0 })
         );
 
@@ -1554,8 +1659,171 @@ Hooks need review 2 hooks are new or changed. > 1. Review hooks 2. Trust all and
 
         let mut flooded = obs(start, 33, 40_000, Some(33), "viel output ohne fragment");
         flooded.write_window_overflowed = true;
+        assert_eq!(guard.tick(&flooded), None);
+        assert_eq!(guard.state(), SubmitState::AwaitingEnter);
+        let mut settled = obs(start, 34, 40_000, Some(33), "viel output ohne fragment");
+        settled.write_window_overflowed = true;
+        assert_eq!(
+            guard.tick(&settled),
+            Some(SubmitAction::SendEnter { attempt: 0 })
+        );
+    }
+
+    /// Kimi Code 0.43.0, raw ConPTY stream captured 2026-09-16 with
+    /// `testutil::capture_kimi_output` and the exact wire text a worker gets
+    /// (task plus the `ENTSCHEIDUNGEN` block). Offsets from the `.offsets`
+    /// sidecar: the task was written at byte 7897, Enter sent at 10422.
+    const KIMI_RAW: &[u8] = include_bytes!("../testdata/pty/kimi-0.43.0-composer-2026-09-16.raw");
+    const KIMI_WRITE_AT: usize = 7897;
+    const KIMI_ENTER_AT: usize = 10422;
+    const KIMI_WIRE_TASK: &str = "Create a file named probe-kimi.txt in the repository root containing exactly PA_KIMI_OK followed by one newline. Read probe-kimi.txt to verify its content. Then reply with exactly PA_KIMI_OK. Do not commit anything.\n\nENTSCHEIDUNGEN\n- Bei wichtigen, blockierenden Entscheidungen frag den Menschen:\n  <repo-root>\\src-tauri\\target\\debug\\pa.exe ask --project pj-1a0a2523d18-1 --worker wk-1a0a2530228-2 --question \"<Frage>\" [--options \"A,B,C\"]\n- Niemals bei Kleinkram. Nur wenn du ohne die Antwort nicht sinnvoll\n  weiterarbeiten kannst und ein falscher Rateschluss teuer waere.\n- Hoechstens 3 offene Fragen gleichzeitig; die vierte wird sofort mit\n  \"entscheide selbst\" beantwortet. Unbeantwortete Fragen laufen nach\n  4 Stunden ab und werden genauso beantwortet.\n- `ask` wartet nicht. Stelle die Frage, sag dass du auf die Entscheidung\n  wartest, und beende deinen Zug - die Antwort kommt als Eingabe in dein\n  Terminal zurueck.";
+
+    fn kimi_normalized(range: std::ops::Range<usize>) -> String {
+        normalize_tui_output(&String::from_utf8_lossy(&KIMI_RAW[range]))
+    }
+
+    /// W1-01 (NT-17, Kimi), the red test for the smoke of 2026-09-15: the
+    /// guard wrote at t+3 s, rewrote at t+8 s and t+16 s and escalated at
+    /// t+24 s - with the composer *later* showing the text. The raw stream
+    /// explains it: Kimi's first four bytes are the cursor-position query
+    /// `ESC[6n`, and unanswered it prints nothing else for minutes. The
+    /// silence heuristic read "four bytes, then quiet" as a settled TUI. A
+    /// handshake that renders nothing is not startup output: the write waits
+    /// until something visible is on screen (or the 30 s give-up, unchanged).
+    #[test]
+    fn a_terminal_query_alone_is_not_settled_startup_output() {
+        let opening = kimi_normalized(0..4);
+        assert_eq!(&KIMI_RAW[..4], b"\x1b[6n");
+        assert_eq!(
+            opening.trim(),
+            "",
+            "the query normalizes to nothing visible"
+        );
+
+        let start = Instant::now();
+        let mut guard = SubmitGuard::new(start, KIMI_WIRE_TASK);
+        assert_eq!(guard.tick(&obs(start, 0, 4, Some(0), &opening)), None);
+        assert_eq!(
+            guard.tick(&obs(start, 3, 4, Some(0), &opening)),
+            None,
+            "nothing visible was rendered: the TUI is blocked, not settled"
+        );
+        assert_eq!(guard.tick(&obs(start, 20, 4, Some(0), &opening)), None);
+        assert_eq!(
+            guard.tick(&obs(start, 30, 4, Some(0), &opening)),
+            Some(SubmitAction::WriteTask { write: 1 }),
+            "the 30 s give-up stands, bit-exact"
+        );
+    }
+
+    /// Evidence, not a bug: once Kimi has rendered (the query was answered),
+    /// its composer echoes the wire text with the top collapsed ("↑ 4 more")
+    /// and the last line visible, and the guard recognizes that echo from
+    /// the real bytes. The 2026-09-15 escalation was never a matching gap.
+    #[test]
+    fn the_kimi_composer_echo_from_the_raw_stream_is_recognized() {
+        let before = kimi_normalized(0..KIMI_WRITE_AT);
+        let full = kimi_normalized(0..KIMI_ENTER_AT);
+        let since = kimi_normalized(KIMI_WRITE_AT..KIMI_ENTER_AT);
+        assert!(before.contains("Send /help for help information."));
+        assert!(since.contains("↑ 4 more"));
+
+        let start = Instant::now();
+        let mut guard = SubmitGuard::new(start, KIMI_WIRE_TASK);
+        assert_eq!(
+            guard.tick(&obs(start, 10, KIMI_WRITE_AT as u64, Some(6), &before)),
+            Some(SubmitAction::WriteTask { write: 1 })
+        );
+        assert_eq!(
+            guard.tick(&obs_since(
+                start,
+                11,
+                KIMI_ENTER_AT as u64,
+                Some(11),
+                &full,
+                &since
+            )),
+            None
+        );
+        assert_eq!(
+            guard.state(),
+            SubmitState::AwaitingEnter,
+            "the collapsed composer's visible tail is the echo"
+        );
+        assert_eq!(
+            guard.tick(&obs_since(
+                start,
+                12,
+                KIMI_ENTER_AT as u64,
+                Some(11),
+                &full,
+                &since
+            )),
+            Some(SubmitAction::SendEnter { attempt: 0 })
+        );
+    }
+
+    /// W1-01, second cause, from the launch-path I/O trace of 2026-09-17
+    /// (`PROJECTA_PTY_TRACE_DIR`): the task was written at t=6154 ms, Kimi
+    /// redrew the composer with the text at t=6326 ms, the guard's Enter went
+    /// at t=6355 ms - and the next redraw showed "↑ 14 more" with the cursor
+    /// on a fresh empty line: the Enter had been folded into the paste as a
+    /// newline, nothing was submitted, and the guard still reported
+    /// "delivered" because the redraw counted as agent output. The Enter
+    /// must wait until the TUI has been quiet after the echo.
+    #[test]
+    fn the_enter_waits_for_the_paste_to_settle_after_the_echo() {
+        let before = kimi_normalized(0..KIMI_WRITE_AT);
+        let full = kimi_normalized(0..KIMI_ENTER_AT);
+        let since = kimi_normalized(KIMI_WRITE_AT..KIMI_ENTER_AT);
+        let start = Instant::now();
+        let mut guard = SubmitGuard::new(start, KIMI_WIRE_TASK);
+        assert_eq!(
+            guard.tick(&obs(start, 10, KIMI_WRITE_AT as u64, Some(6), &before)),
+            Some(SubmitAction::WriteTask { write: 1 })
+        );
+        // The redraw with the echo has just arrived (last output = now).
+        let echo = |now_secs, last_secs| {
+            obs_since(
+                start,
+                now_secs,
+                KIMI_ENTER_AT as u64,
+                Some(last_secs),
+                &full,
+                &since,
+            )
+        };
+        assert_eq!(
+            guard.tick(&echo(11, 11)),
+            None,
+            "an Enter in the same tick as the echo lands inside the paste"
+        );
+        assert_eq!(guard.state(), SubmitState::AwaitingEnter);
+        assert_eq!(
+            guard.tick(&echo(12, 11)),
+            Some(SubmitAction::SendEnter { attempt: 0 }),
+            "one quiet second after the echo the Enter is a keystroke of its own"
+        );
+        assert_eq!(guard.state(), SubmitState::AwaitingWork(0));
+    }
+
+    /// Sibling: a TUI that keeps repainting after the echo (spinner, clock)
+    /// never gets quiet - the Enter still goes, ENTER_SETTLE_CAP after the
+    /// echo at the latest, instead of waiting forever.
+    #[test]
+    fn a_repainting_tui_still_gets_its_enter_after_the_settle_cap() {
+        let start = Instant::now();
+        let mut guard = SubmitGuard::new(start, TASK);
+        assert_eq!(
+            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
+            Some(SubmitAction::WriteTask { write: 1 })
+        );
+        let echoed = format!("prompt > {TASK} spinner");
+        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), &echoed)), None);
+        assert_eq!(guard.tick(&obs(start, 33, 800, Some(33), &echoed)), None);
+        assert_eq!(guard.tick(&obs(start, 35, 900, Some(35), &echoed)), None);
         assert_eq!(
-            guard.tick(&flooded),
+            guard.tick(&obs(start, 36, 1000, Some(36), &echoed)),
             Some(SubmitAction::SendEnter { attempt: 0 })
         );
     }
@@ -1573,8 +1841,10 @@ Hooks need review 2 hooks are new or changed. > 1. Review hooks 2. Trust all and
         );
 
         let echoed = format!("prompt > {task}");
+        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), &echoed)), None);
+        assert_eq!(guard.state(), SubmitState::AwaitingEnter);
         assert_eq!(
-            guard.tick(&obs(start, 31, 600, Some(31), &echoed)),
+            guard.tick(&obs(start, 32, 600, Some(31), &echoed)),
             Some(SubmitAction::SendEnter { attempt: 0 })
         );
     }
