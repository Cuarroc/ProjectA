# Review-Auftrag — W1-03 / C-3: Submit-Guards einer Sitzung serialisieren (PR #72)

Du bist unabhängiger Code-Reviewer. Du hast den Code nicht geschrieben.
Autor: Claude Code (Cloud-Sitzung). Vorher gab es zwei Claude-Reviews
(Disposition `.pa/review_w1-03_c3_disposition.md`, unten nicht enthalten, um
dich nicht zu lenken). Du bist die anbieterfremde Gegenprobe.

## Kontext

ProjectA ist eine Tauri-2-App (Rust), die CLI-Agenten (Codex, Kimi, OpenCode,
Claude) in PTYs startet. Ein **Submit-Guard** tippt einen Auftrag in die TUI
des Agenten und belegt die Zustellung (Readiness-Marker → Write → Echo nach
Write-Baseline → Enter → Ausgabe danach); jede Phase ist gekappt
(`READY_MAX_WAIT` 30 s, `MARKER_BUSY_CAP` 120 s, `ECHO_WINDOW` 8 s,
`ECHO_BUSY_CAP` 120 s × `MAX_WRITES` 3, `ENTER_SETTLE_CAP` 5 s,
`RETRY_BACKOFF` 15/30/60/60 s).

**Befund C-3:** Jede Zustellung startete einen eigenen Guard-Thread ohne
Ordnung; zwei Zustellungen an dieselbe Sitzung tippten in dieselbe
Eingabezeile. **Fix:** eine FIFO je Sitzung (`DeliveryTurns`), nur der Guard
vorn tippt; Wartende geben bei Kill/Sitzungsende mit `Escalated` auf; eskaliert
ein Guard nach dem Tippen, eskalieren die schon Wartenden ohne zu schreiben
(`dirty_below`).

## Worauf du achten sollst

1. Nebenläufigkeit: Deadlock, verlorenes Wakeup, Ticket, das die Queue nie
   verlässt, Lock-Reihenfolge (Registry / Queue / Scrollback), Panic-Pfade.
2. Semantik: Kann ein Nachfolger trotz Fix hinter fremden Text tippen? Ist
   `dirty_below` (nur die zum Eskalationszeitpunkt Wartenden) die richtige
   Grenze? Gibt es Pfade, auf denen ein Aufrufer nie ein Ergebnis hört?
3. Tests: Belegen die vier neuen Tests, was sie behaupten? Deterministisch
   genug (echte Zeit, 100-ms-Ticks)?
4. Alles, was dir sonst auffällt.

## Antwortformat

Befunde als Liste: ID (X1, X2 …), Schwere (hoch/mittel/niedrig), Datei:Zeile
(im Diff), konkretes Fehlerszenario, Fix-Vorschlag. Danach geprüfte und
verworfene Punkte in je einer Zeile. Zum Schluss ein Urteil:
mergebereit / nach Überarbeitung / ablehnen. Deutsch, knapp. Keine Befunde
erfinden: „keine Befunde" ist eine gültige Antwort.

## Der Diff (gegen `main` @ a4a5048)

```diff
diff --git a/src-tauri/src/pty.rs b/src-tauri/src/pty.rs
index 8b6e660..1c35b17 100644
--- a/src-tauri/src/pty.rs
+++ b/src-tauri/src/pty.rs
@@ -7,7 +7,7 @@
 use std::collections::{HashMap, VecDeque};
 use std::io::{Read, Write};
 use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
-use std::sync::{Arc, Mutex};
+use std::sync::{Arc, Condvar, Mutex, MutexGuard};
 use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
 
 use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
@@ -207,6 +207,9 @@ struct Session {
     /// Set as soon as a session is killed. It lets a sleeping guard stop before
     /// the child reaper has removed the session from the registry.
     submit_guard_cancelled: Arc<AtomicBool>,
+    /// C-3: the order in which this session's submit guards may type. Only
+    /// the guard at the front writes; the others wait for their turn.
+    delivery_turns: Arc<DeliveryTurns>,
     /// Opt-in raw I/O trace (`PROJECTA_PTY_TRACE_DIR`): every write into the
     /// PTY and every output chunk, with a millisecond clock, plus the raw
     /// output bytes in a sidecar. Off unless the directory is set - it
@@ -215,6 +218,101 @@ struct Session {
     trace: Option<SessionTrace>,
 }
 
+/// C-3: a FIFO of the submit guards of one session.
+///
+/// Every delivery joins at `start_submit_guard` - synchronously, so the queue
+/// order is the call order - and only the guard at the front may type. A
+/// guard leaves the queue on every way out of its thread (delivered,
+/// escalated, cancelled, session gone, panic), because its [`DeliveryTurn`]
+/// removes it on drop; a guard that gives up while still waiting leaves the
+/// same way, so it can never block the ones behind it.
+///
+/// No wait here is unbounded: every phase of the guard ahead is capped
+/// (`MARKER_BUSY_CAP`/`READY_MAX_WAIT`, `MAX_WRITES` x `ECHO_BUSY_CAP`,
+/// `ENTER_SETTLE_CAP`, `RETRY_BACKOFF` - about eleven minutes in all), and a
+/// waiting guard re-checks cancellation and the session on every wake-up.
+///
+/// A delivery that escalates *after* typing its task may leave that text
+/// unsent in the input line. Every guard already queued behind it at that
+/// moment then escalates instead of typing after it (`dirty_below`); a
+/// delivery started later, once a human has looked, types normally.
+#[derive(Default)]
+struct DeliveryTurns {
+    queue: Mutex<VecDeque<u64>>,
+    changed: Condvar,
+    next_id: AtomicU64,
+    /// Guards with an id below this value joined before a typed task was
+    /// left behind by an escalation; they must not type.
+    dirty_below: AtomicU64,
+}
+
+impl DeliveryTurns {
+    /// A plain queue of ids stays consistent even if a holder panicked, so a
+    /// poisoned lock is taken over instead of wedging every later delivery.
+    fn lock(&self) -> MutexGuard<'_, VecDeque<u64>> {
+        self.queue
+            .lock()
+            .unwrap_or_else(|poison| poison.into_inner())
+    }
+
+    fn join(self: &Arc<Self>) -> DeliveryTurn {
+        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
+        self.lock().push_back(id);
+        DeliveryTurn {
+            turns: Arc::clone(self),
+            id,
+        }
+    }
+
+    /// A guard escalated with its task possibly still in the input line:
+    /// every guard queued so far must not type after it.
+    fn mark_input_dirty(&self) {
+        let issued = self.next_id.load(Ordering::Relaxed);
+        self.dirty_below.fetch_max(issued, Ordering::AcqRel);
+    }
+
+    #[cfg(test)]
+    fn is_empty(&self) -> bool {
+        self.lock().is_empty()
+    }
+}
+
+/// One guard's place in [`DeliveryTurns`]; dropping it leaves the queue.
+struct DeliveryTurn {
+    turns: Arc<DeliveryTurns>,
+    id: u64,
+}
+
+impl DeliveryTurn {
+    /// Wait up to `timeout` for this guard to reach the front. Returns
+    /// whether it is its turn; the caller re-checks cancellation between
+    /// calls.
+    fn wait(&self, timeout: Duration) -> bool {
+        let queue = self.turns.lock();
+        if queue.front() == Some(&self.id) {
+            return true;
+        }
+        let (queue, _) = self
+            .turns
+            .changed
+            .wait_timeout(queue, timeout)
+            .unwrap_or_else(|poison| poison.into_inner());
+        queue.front() == Some(&self.id)
+    }
+
+    /// Whether an escalation ahead of this guard left a typed task behind.
+    fn input_left_dirty(&self) -> bool {
+        self.id < self.turns.dirty_below.load(Ordering::Acquire)
+    }
+}
+
+impl Drop for DeliveryTurn {
+    fn drop(&mut self) {
+        self.turns.lock().retain(|id| *id != self.id);
+        self.turns.changed.notify_all();
+    }
+}
+
 /// See [`Session::trace`].
 struct SessionTrace {
     started: Instant,
@@ -611,6 +709,7 @@ impl PtyManager {
             scrollback: Arc::clone(&scrollback),
             last_output: Arc::clone(&last_output),
             submit_guard_cancelled: Arc::clone(&submit_guard_cancelled),
+            delivery_turns: Arc::new(DeliveryTurns::default()),
             trace: SessionTrace::open(&session_id),
         });
 
@@ -692,6 +791,16 @@ impl PtyManager {
     /// (workspace trust) is answered on sight, because it swallows anything
     /// typed into it. Killing, exiting or archiving the session stops the
     /// guard.
+    ///
+    /// C-3: deliveries to one session take turns (see [`DeliveryTurns`]).
+    /// A second call waits until the first delivery has ended, and its
+    /// clocks and write baseline start only with its own turn. The turn ends
+    /// with the previous guard's terminal event - for a delivered task that
+    /// is the first output after its Enter, not the end of the agent's work;
+    /// from there the next guard's own readiness rules decide when it types.
+    /// A guard that gives up while waiting (session killed or gone) reports
+    /// `Escalated`, as does one queued behind a delivery that escalated with
+    /// its task already typed.
     pub fn start_submit_guard<F>(
         &self,
         session_id: &str,
@@ -707,11 +816,51 @@ impl PtyManager {
             .submit_guard_cancelled
             .store(false, Ordering::Release);
 
+        // C-3: join the session's delivery queue here, on the caller's
+        // thread, so two deliveries keep the order they were started in.
+        let turn = session.delivery_turns.join();
+
         let session_id = session_id.to_string();
         let sessions = Arc::clone(&self.sessions);
         let on_event = Arc::new(on_event);
         let readiness_marker = readiness_marker.unwrap_or_default().to_string();
         std::thread::spawn(move || {
+            // Wait until every earlier delivery to this session has ended.
+            // The guard ahead is still typing, or waiting for its echo or
+            // its Enter to land; a second guard writing now would put both
+            // texts into one input line. `turn` leaves the queue on every
+            // return below. Liveness is checked once more after the turn
+            // arrives: a kill that let the guard ahead return also hands the
+            // turn over, and this guard must still report, not go silent.
+            let mut my_turn = false;
+            loop {
+                let alive = sessions
+                    .lock()
+                    .ok()
+                    .and_then(|map| map.get(&session_id).and_then(SessionEntry::interactive))
+                    .is_some_and(|session| !session.submit_guard_cancelled.load(Ordering::Acquire));
+                if !alive {
+                    // Review A1: the caller still hears that its text was
+                    // not delivered, instead of an outcome that never fires.
+                    on_event(SubmitGuardEvent::Escalated);
+                    return;
+                }
+                if my_turn {
+                    break;
+                }
+                my_turn = turn.wait(Duration::from_millis(100));
+            }
+            if turn.input_left_dirty() {
+                eprintln!(
+                    "projecta: submit guard escalated ({session_id}): an earlier delivery left its task in the input line"
+                );
+                on_event(SubmitGuardEvent::Escalated);
+                return;
+            }
+
+            // The guard's clocks start with its turn, not with its call: the
+            // readiness and echo deadlines must not be spent waiting behind
+            // another delivery.
             let mut guard =
                 SubmitGuard::new(Instant::now(), &task).with_readiness_marker(&readiness_marker);
             // The write baseline, an absolute position on the scrollback's
@@ -720,6 +869,15 @@ impl PtyManager {
             // readiness marker, answer marker - search only the output after
             // it, so leftovers from before can never count.
             let mut write_mark: Option<u64> = None;
+            // Whether this guard has typed its task: an escalation after
+            // that may leave the text in the input line.
+            let mut typed_task = false;
+            let escalate = |typed_task: bool| {
+                if typed_task {
+                    turn.turns.mark_input_dirty();
+                }
+                on_event(SubmitGuardEvent::Escalated);
+            };
 
             loop {
                 let Some(session) = sessions
@@ -765,8 +923,11 @@ impl PtyManager {
                 match guard.tick(&obs) {
                     Some(SubmitAction::WriteTask { write }) => {
                         on_event(SubmitGuardEvent::Wrote { write });
+                        // Set before the write: a failed write may still
+                        // have put part of the text on the line.
+                        typed_task = true;
                         if write_session(&session, &task).is_err() {
-                            on_event(SubmitGuardEvent::Escalated);
+                            escalate(typed_task);
                             return;
                         }
                         // The mark moves past this write: only output after
@@ -778,14 +939,14 @@ impl PtyManager {
                     Some(SubmitAction::SendEnter { attempt }) => {
                         on_event(SubmitGuardEvent::Enter { attempt });
                         if write_session(&session, "\r").is_err() {
-                            on_event(SubmitGuardEvent::Escalated);
+                            escalate(typed_task);
                             return;
                         }
                     }
                     Some(SubmitAction::AnswerDialog(kind)) => {
                         on_event(SubmitGuardEvent::DialogAnswered);
                         if write_session(&session, kind.keystrokes()).is_err() {
-                            on_event(SubmitGuardEvent::Escalated);
+                            escalate(typed_task);
                             return;
                         }
                     }
@@ -800,7 +961,7 @@ impl PtyManager {
                                 "projecta: submit guard escalated ({session_id}): {reason:?}"
                             );
                         }
-                        on_event(SubmitGuardEvent::Escalated);
+                        escalate(typed_task);
                         return;
                     }
                     None => {}
@@ -1799,6 +1960,298 @@ mod tests {
         assert_eq!(count.get(), 1);
     }
 
+    /// A writer that records every byte the guard types, so a test can read
+    /// the order in which two deliveries reached the terminal.
+    ///
+    /// `refuse_enter` makes a bare Enter fail, which escalates the guard
+    /// that sent it right after its task was typed and echoed.
+    #[derive(Clone, Default)]
+    struct RecordingWriter(Arc<Mutex<Vec<u8>>>, Arc<AtomicBool>);
+
+    impl Write for RecordingWriter {
+        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
+            if buf == b"\r" && self.1.load(Ordering::Acquire) {
+                return Err(std::io::Error::other("enter refused by the test"));
+            }
+            self.0.lock().unwrap().extend_from_slice(buf);
+            Ok(buf.len())
+        }
+        fn flush(&mut self) -> std::io::Result<()> {
+            Ok(())
+        }
+    }
+
+    impl RecordingWriter {
+        fn typed(&self) -> String {
+            String::from_utf8_lossy(&self.0.lock().unwrap()).into_owned()
+        }
+
+        fn refuse_enter(&self) {
+            self.1.store(true, Ordering::Release);
+        }
+    }
+
+    /// Echo `text` until the guard answers with its Enter. One push could
+    /// land before the guard has moved its write baseline past the task and
+    /// would then not count as the echo (review A4).
+    fn echo_until_enter(session: &Session, writer: &RecordingWriter, text: &str) {
+        let deadline = Instant::now() + Duration::from_secs(10);
+        while !writer.typed().contains('\r') {
+            assert!(Instant::now() < deadline, "timed out waiting for the Enter");
+            session.scrollback.lock().unwrap().push(text.as_bytes());
+            std::thread::sleep(Duration::from_millis(200));
+        }
+    }
+
+    #[derive(Debug)]
+    struct NoopKiller;
+
+    impl ChildKiller for NoopKiller {
+        fn kill(&mut self) -> std::io::Result<()> {
+            Ok(())
+        }
+        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
+            Box::new(NoopKiller)
+        }
+    }
+
+    const GUARD_TEST_MARKER: &str = "READY>";
+
+    /// An interactive session whose writes land in a recorder and whose
+    /// output the test pushes by hand. It rests on its prompt: the readiness
+    /// marker is on screen and the last output is older than
+    /// READY_IDLE_AFTER, so a guard may write on its first tick (C-1 rule).
+    fn resting_guard_session(manager: &PtyManager, id: &str) -> (Arc<Session>, RecordingWriter) {
+        let pair = native_pty_system()
+            .openpty(PtySize {
+                rows: 24,
+                cols: 80,
+                pixel_width: 0,
+                pixel_height: 0,
+            })
+            .expect("open a pty pair for the guard test");
+        let writer = RecordingWriter::default();
+        let mut scrollback = Scrollback::new();
+        scrollback.push(GUARD_TEST_MARKER.as_bytes());
+        let session = Arc::new(Session {
+            master: Mutex::new(pair.master),
+            writer: Mutex::new(Box::new(writer.clone())),
+            killer: Mutex::new(Box::new(NoopKiller)),
+            scrollback: Arc::new(Mutex::new(scrollback)),
+            last_output: Arc::new(Mutex::new(Some(
+                Instant::now() - crate::submit_guard::READY_IDLE_AFTER - Duration::from_secs(1),
+            ))),
+            submit_guard_cancelled: Arc::new(AtomicBool::new(false)),
+            delivery_turns: Arc::new(DeliveryTurns::default()),
+            trace: None,
+        });
+        manager.sessions.lock().unwrap().insert(
+            id.to_string(),
+            SessionEntry::Interactive(Arc::clone(&session)),
+        );
+        (session, writer)
+    }
+
+    fn wait_until(what: &str, cond: impl Fn() -> bool) {
+        let deadline = Instant::now() + Duration::from_secs(10);
+        while !cond() {
+            assert!(Instant::now() < deadline, "timed out waiting for {what}");
+            std::thread::sleep(Duration::from_millis(20));
+        }
+    }
+
+    /// W1-03 / C-3: two deliveries to the same session must not type into
+    /// each other. Before the fix every `start_submit_guard` ran its own
+    /// thread with nothing ordering them, so the second task was written
+    /// while the first still waited for its echo - both texts ended up in
+    /// the same input line.
+    #[test]
+    fn two_guards_on_one_session_do_not_type_into_each_other() {
+        let manager = PtyManager::default();
+        let (_session, writer) = resting_guard_session(&manager, "c3-interleave");
+
+        manager
+            .start_submit_guard(
+                "c3-interleave",
+                "alpha task text".into(),
+                Some(GUARD_TEST_MARKER),
+                |_| {},
+            )
+            .unwrap();
+        manager
+            .start_submit_guard(
+                "c3-interleave",
+                "bravo task text".into(),
+                Some(GUARD_TEST_MARKER),
+                |_| {},
+            )
+            .unwrap();
+
+        wait_until("the first task to be written", || {
+            writer.typed().contains("alpha task text")
+        });
+        // Several guard ticks: the second guard would have written by now.
+        std::thread::sleep(Duration::from_millis(600));
+        let typed = writer.typed();
+        manager.kill("c3-interleave").unwrap();
+        assert!(
+            !typed.contains("bravo task text"),
+            "second task typed while the first awaited its echo: {typed:?}"
+        );
+    }
+
+    /// The second delivery is only held, not dropped: once the first one has
+    /// ended (echo, Enter, output after it) the next guard takes its turn and
+    /// writes its own task after the first one's Enter.
+    #[test]
+    fn a_queued_guard_writes_once_the_previous_delivery_has_ended() {
+        let manager = PtyManager::default();
+        let (session, writer) = resting_guard_session(&manager, "c3-turn");
+        let events = Arc::new(Mutex::new(Vec::new()));
+        let first_events = Arc::clone(&events);
+
+        manager
+            .start_submit_guard(
+                "c3-turn",
+                "alpha task text".into(),
+                Some(GUARD_TEST_MARKER),
+                move |event| first_events.lock().unwrap().push(event),
+            )
+            .unwrap();
+        manager
+            .start_submit_guard(
+                "c3-turn",
+                "bravo task text".into(),
+                Some(GUARD_TEST_MARKER),
+                |_| {},
+            )
+            .unwrap();
+
+        wait_until("the first task to be written", || {
+            writer.typed().contains("alpha task text")
+        });
+        // The TUI echoes the first task; the guard then sends Enter.
+        echo_until_enter(&session, &writer, "alpha task text");
+        // Output after the Enter: the first delivery is done. The screen is
+        // back on its prompt, still resting (last output clock unchanged).
+        session
+            .scrollback
+            .lock()
+            .unwrap()
+            .push(format!("working... done\n{GUARD_TEST_MARKER}").as_bytes());
+        wait_until("the second task to be written", || {
+            writer.typed().contains("bravo task text")
+        });
+        manager.kill("c3-turn").unwrap();
+
+        assert!(events
+            .lock()
+            .unwrap()
+            .contains(&SubmitGuardEvent::Delivered));
+        let typed = writer.typed();
+        let first_enter = typed.find('\r').unwrap();
+        let second = typed.find("bravo task text").unwrap();
+        assert!(
+            first_enter < second,
+            "second task before the first Enter: {typed:?}"
+        );
+    }
+
+    /// A delivery still waiting for its turn gives up when the session is
+    /// killed, and leaves the queue: nothing is typed into a dead session.
+    #[test]
+    fn a_queued_guard_is_cancelled_with_its_session() {
+        let manager = PtyManager::default();
+        let (session, writer) = resting_guard_session(&manager, "c3-kill");
+        let queued_events = Arc::new(Mutex::new(Vec::new()));
+        let queued_sink = Arc::clone(&queued_events);
+
+        manager
+            .start_submit_guard(
+                "c3-kill",
+                "alpha task text".into(),
+                Some(GUARD_TEST_MARKER),
+                |_| {},
+            )
+            .unwrap();
+        manager
+            .start_submit_guard(
+                "c3-kill",
+                "bravo task text".into(),
+                Some(GUARD_TEST_MARKER),
+                move |event| queued_sink.lock().unwrap().push(event),
+            )
+            .unwrap();
+        wait_until("the first task to be written", || {
+            writer.typed().contains("alpha task text")
+        });
+        manager.kill("c3-kill").unwrap();
+        wait_until("both guards to leave the queue", || {
+            session.delivery_turns.is_empty()
+        });
+        assert!(!writer.typed().contains("bravo task text"));
+        // Review A1: the caller hears that its text was not delivered - an
+        // outcome callback that never fires loses the text without a trace.
+        assert_eq!(
+            *queued_events.lock().unwrap(),
+            vec![SubmitGuardEvent::Escalated]
+        );
+    }
+
+    /// Review A2/B1: when the delivery ahead escalated after typing its task,
+    /// that text may still sit unsent in the input line. A guard that was
+    /// already waiting behind it must not type its own text after it - the
+    /// next Enter would send both as one line, C-3 with a delay. It
+    /// escalates without writing; the worker needs a human anyway.
+    #[test]
+    fn a_queued_guard_does_not_type_behind_a_failed_delivery() {
+        let manager = PtyManager::default();
+        let (session, writer) = resting_guard_session(&manager, "c3-dirty");
+        let queued_events = Arc::new(Mutex::new(Vec::new()));
+        let queued_sink = Arc::clone(&queued_events);
+
+        manager
+            .start_submit_guard(
+                "c3-dirty",
+                "alpha task text".into(),
+                Some(GUARD_TEST_MARKER),
+                |_| {},
+            )
+            .unwrap();
+        manager
+            .start_submit_guard(
+                "c3-dirty",
+                "bravo task text".into(),
+                Some(GUARD_TEST_MARKER),
+                move |event| queued_sink.lock().unwrap().push(event),
+            )
+            .unwrap();
+        wait_until("the first task to be written", || {
+            writer.typed().contains("alpha task text")
+        });
+        // The first task is echoed, but its Enter fails: the guard escalates
+        // with the text still typed into the prompt.
+        writer.refuse_enter();
+        let deadline = Instant::now() + Duration::from_secs(10);
+        while !session.delivery_turns.is_empty() && Instant::now() < deadline {
+            session.scrollback.lock().unwrap().push(b"alpha task text");
+            std::thread::sleep(Duration::from_millis(200));
+        }
+        // Several ticks for a second guard that wrongly got its turn.
+        std::thread::sleep(Duration::from_millis(600));
+        let typed = writer.typed();
+        manager.kill("c3-dirty").unwrap();
+
+        assert!(
+            !typed.contains("bravo task text"),
+            "second task typed behind a failed delivery: {typed:?}"
+        );
+        assert_eq!(
+            *queued_events.lock().unwrap(),
+            vec![SubmitGuardEvent::Escalated]
+        );
+    }
+
     #[test]
     fn scrollback_keeps_only_the_tail() {
         let mut sb = Scrollback::new();
```
