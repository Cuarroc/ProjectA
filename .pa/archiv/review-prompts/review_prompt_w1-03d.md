# Review-Auftrag — W1-03d: Queued-Ereignis, InputBlocked, endgültiges Abbrechen (Folge von C-3 / W1-03c)

Du bist unabhängiger Code-Reviewer. Du hast den Code nicht geschrieben (Autor: Claude Code).
Dieser Diff berührt `src-tauri/src/main.rs`, eine Nahtstelle; deshalb zwei anbieterfremde Reviews.

## Kontext

ProjectA (Tauri 2, Rust) startet CLI-Agenten in PTYs. Ein Submit-Guard (Thread je Zustellung) tippt einen
Auftrag in die TUI und belegt die Zustellung. C-3 serialisiert die Guards einer Sitzung über eine FIFO
(`DeliveryTurns`). W1-03c (PR #81, Basis dieses Diffs) hält einen Dirty-Zustand an der Sitzung: Verlässt ein
Guard die Queue, während sein Text noch in der Eingabezeile stehen kann, eskaliert jede spätere Zustellung ohne
zu schreiben, bis `PtyManager::write_user_input` mit Enter/Ctrl-U/Ctrl-C ihn räumt.

**Dieser Diff (W1-03d):**
- f) Neues Ereignis `SubmitGuardEvent::Queued { ahead }` (Zahl der vorher eingereihten Zustellungen, unter dem
  Queue-Lock bestimmt), gemeldet am Anfang des Guard-Threads, wenn ahead > 0. Neues Ereignis `InputBlocked`
  vor `Escalated`, wenn eine belegte Zeile den Guard stoppt. `GuardNarrative::detail` (main.rs, exhaustiver
  match, erzeugt Status-Texte, die als status_events gespeichert werden) hat Arme dafür. Das Frontend zeigt
  Guard-Ereignisse nur als Zähler (StatisticsView) – daher keine Frontend-Änderung.
- g) `start_submit_guard` setzte das geteilte `submit_guard_cancelled` auf false zurück. Ein Start zwischen
  Kill und Reaper weckte so bereits abgebrochene Guards (gemessen: der abgebrochene Guard schickte Enter in die
  gekillte Sitzung, der neue tippte). Jetzt: nie zurücksetzen. Alle Setzer (kill, kill_all, Exit-Hook-Fehler)
  beenden die Sitzung. Statt einer Generation je Guard (Auftrag lautete „Cancel-Token je Guard (Generation)“)
  bleibt es beim endgültigen Flag, weil eine Generation einen nach dem Kill gestarteten Guard nicht abbräche.
- main.rs `write_pty` (Tauri-Command für Tastatureingaben der Terminal-Ansicht) ruft `write_user_input`
  statt `write`. Automatische Pfade (Worker-Nachrichten, Diff-Kommentare, Fragen-Sweep) benutzen weiter `write`.
- Tests: rote Tests für g) und f); die C-3-Tests erwarten jetzt `Queued`/`InputBlocked` und warten auf das
  terminale Ereignis (`reported_outcome`).

## Worauf du achten sollst
1. Aufrufer-Verträge: Wer konsumiert `SubmitGuardEvent`? Bricht ein neues, nicht-terminales Ereignis vor dem
   ersten `Wrote` irgendeine Annahme (Outcome-Callbacks, Status-Engine, Tests)?
2. g): Gibt es einen Pfad, auf dem `submit_guard_cancelled` gesetzt wird, ohne dass die Sitzung endet (dann
   wäre „nie zurücksetzen“ ein dauerhafter Lockout)? Ist der Verzicht auf die Generation richtig begründet?
3. `write_pty` → `write_user_input`: Schreibt das Frontend auch automatisierte Texte über `write_pty` (dann
   würde Automatik den Dirty-Zustand räumen)? Ist das Räumen erst nach erfolgreichem Write korrekt?
4. Narrative-Texte: irreführend? Fehlt ein Fall (z. B. wartender Guard, dessen Sitzung stirbt)?
5. Alles, was dir sonst auffällt.

## Antwortformat
Befunde als Liste: ID (X1 …), Schwere (hoch/mittel/niedrig), Datei/Stelle, konkretes Fehlerszenario,
Fix-Vorschlag. Danach geprüfte und verworfene Punkte je eine Zeile. Urteil: mergebereit / nach Überarbeitung /
ablehnen. Deutsch, knapp. Keine Befunde erfinden.

## Der Diff (gegen W1-03c @ e6e227a)

```diff
diff --git a/src-tauri/src/main.rs b/src-tauri/src/main.rs
index acb645a..deea93d 100644
--- a/src-tauri/src/main.rs
+++ b/src-tauri/src/main.rs
@@ -370,27 +370,32 @@ impl AgentControl for PtyWriter {
 }
 
 /// The user-facing reading of one delivery's guard events (F-CORE-3 B.2).
 ///
 /// `SubmitGuardEvent::Escalated` carries no reason - the PTY layer logs it to
 /// stderr - so the status text is read from how far the delivery got: an
 /// escalation before any write means the readiness marker never appeared and
 /// nothing was typed (C-5: "manual Enter required" would send the user
 /// pressing Enter into an empty prompt); after the write but before Enter the
 /// echo never came; after Enter either the retries ran out or the
-/// answer-marker cap did. The one unreachable-in-production blur: with a
+/// answer-marker cap did. A delivery stopped by an earlier task in the input
+/// line (`InputBlocked`, W1-03d) says so instead of blaming the marker.
+/// The one unreachable-in-production blur: with a
 /// configured answer marker the guard also escalates when the retries run
 /// out, and that path is reported as unanswered retries - no profile wires an
 /// answer marker into the guard yet, so the cap text cannot be reached
 /// through it today.
 #[derive(Default)]
 struct GuardNarrative {
+    /// W1-03d: the guard stopped before typing because an earlier task
+    /// still sits in the input line.
+    blocked: bool,
     wrote: bool,
     entered: bool,
     final_enter_sent: bool,
 }
 
 impl GuardNarrative {
     /// The status-event detail for one guard event; updates the progress the
     /// escalation texts are read from.
     fn detail(&mut self, event: &SubmitGuardEvent) -> String {
         match event {
@@ -416,22 +421,35 @@ impl GuardNarrative {
             }
             SubmitGuardEvent::DialogAnswered => {
                 "blocking dialog answered (workspace trust)".to_string()
             }
             SubmitGuardEvent::Delivered => {
                 // Byte-based progress, not a confirmed delivery: the guard's
                 // ConfirmDelivery is not distinguishable at this event
                 // boundary, so "task delivery confirmed" is not claimed here.
                 "task written and echoed; agent output observed".to_string()
             }
+            SubmitGuardEvent::Queued { ahead } => {
+                if *ahead == 1 {
+                    "queued behind 1 earlier delivery to this session".to_string()
+                } else {
+                    format!("queued behind {ahead} earlier deliveries to this session")
+                }
+            }
+            SubmitGuardEvent::InputBlocked => {
+                self.blocked = true;
+                "an earlier task still sits in the input line; this task was not typed".to_string()
+            }
             SubmitGuardEvent::Escalated => {
-                if !self.wrote {
+                if self.blocked {
+                    "task not typed: an earlier task sits in the input line; type into the terminal to clear it, then resend".to_string()
+                } else if !self.wrote {
                     "readiness marker never appeared; task not written".to_string()
                 } else if !self.entered {
                     "task never echoed; manual Enter required".to_string()
                 } else if self.final_enter_sent {
                     "enter retries unanswered; the task sits on the agent's prompt".to_string()
                 } else {
                     // The ANSWER_MARKER_CAP ran out: the task was written and
                     // echoed, but no answer marker confirmed the agent reacted.
                     "answer marker never appeared; delivery not confirmed".to_string()
                 }
@@ -600,21 +618,24 @@ fn spawn_pty(
     let session_id = manager.spawn(&app, &profile, cwd, cols, rows, &[])?;
     Ok(SpawnPtyResponse { session_id })
 }
 
 #[tauri::command]
 fn write_pty(
     manager: State<'_, PtyManager>,
     session_id: String,
     data: String,
 ) -> Result<(), String> {
-    manager.write(&session_id, &data)
+    // W1-03d: keystrokes from the terminal view are the user's own input;
+    // Enter, Ctrl-U or Ctrl-C there clear a line an escalated delivery left
+    // behind (see PtyManager::write_user_input).
+    manager.write_user_input(&session_id, &data)
 }
 
 #[tauri::command]
 fn resize_pty(
     manager: State<'_, PtyManager>,
     session_id: String,
     cols: u16,
     rows: u16,
 ) -> Result<(), String> {
     manager.resize(&session_id, cols, rows)
@@ -3844,20 +3865,46 @@ mod tests {
     /// the user pressing Enter into an empty prompt.
     #[test]
     fn an_escalation_before_any_write_reports_the_missing_marker() {
         let mut narrative = super::GuardNarrative::default();
         assert_eq!(
             narrative.detail(&super::SubmitGuardEvent::Escalated),
             "readiness marker never appeared; task not written"
         );
     }
 
+    /// W1-03d (review B2): a waiting delivery names how many are ahead.
+    #[test]
+    fn a_queued_delivery_names_the_deliveries_ahead() {
+        let mut narrative = super::GuardNarrative::default();
+        assert_eq!(
+            narrative.detail(&super::SubmitGuardEvent::Queued { ahead: 1 }),
+            "queued behind 1 earlier delivery to this session"
+        );
+        assert_eq!(
+            narrative.detail(&super::SubmitGuardEvent::Queued { ahead: 3 }),
+            "queued behind 3 earlier deliveries to this session"
+        );
+    }
+
+    /// W1-03d: a delivery stopped by an earlier task in the input line
+    /// wrote nothing, but its readiness marker was never the problem - the
+    /// escalation names the line, not the marker.
+    #[test]
+    fn a_blocked_delivery_escalates_without_blaming_the_readiness_marker() {
+        let mut narrative = super::GuardNarrative::default();
+        narrative.detail(&super::SubmitGuardEvent::InputBlocked);
+        let text = narrative.detail(&super::SubmitGuardEvent::Escalated);
+        assert!(text.contains("earlier task"), "{text}");
+        assert!(!text.contains("readiness marker"), "{text}");
+    }
+
     /// The write went out but no echo came back: here a manual Enter is
     /// exactly the right next step.
     #[test]
     fn an_escalation_after_the_write_reports_the_missing_echo() {
         let mut narrative = super::GuardNarrative::default();
         narrative.detail(&super::SubmitGuardEvent::Wrote { write: 1 });
         assert_eq!(
             narrative.detail(&super::SubmitGuardEvent::Escalated),
             "task never echoed; manual Enter required"
         );
diff --git a/src-tauri/src/pty.rs b/src-tauri/src/pty.rs
index ba066c3..7072e94 100644
--- a/src-tauri/src/pty.rs
+++ b/src-tauri/src/pty.rs
@@ -59,20 +59,27 @@ pub enum SubmitGuardEvent {
     Enter { attempt: u8 },
     /// A blocking dialog (workspace trust) was answered.
     DialogAnswered,
     /// The task's echo was seen and output followed the Enter. On profiles
     /// without an answer marker this is the byte-based progress signal it
     /// always was; with a marker it fires only after the marker confirmed the
     /// delivery (`SubmitAction::ConfirmDelivery`).
     Delivered,
     /// The TUI never accepted the task, so ProjectA asks the user to step in.
     Escalated,
+    /// W1-03d: the delivery waits behind `ahead` earlier deliveries to the
+    /// same session (C-3); it types once they have ended.
+    Queued { ahead: usize },
+    /// W1-03d: an earlier delivery left its task in the input line and the
+    /// user has not sent or emptied it since; this task is not typed.
+    /// `Escalated` follows.
+    InputBlocked,
 }
 
 /// A byte ring buffer holding the tail of a session's raw output.
 struct Scrollback {
     buf: VecDeque<u8>,
     /// Monotonic count of every byte ever pushed, including bytes the ring
     /// has already dropped. The submit guard's write baseline is an absolute
     /// position on this counter.
     total_pushed: u64,
 }
@@ -199,20 +206,26 @@ impl Utf8Stream {
 struct Session {
     master: Mutex<Box<dyn MasterPty + Send>>,
     writer: Mutex<Box<dyn Write + Send>>,
     killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
     scrollback: Arc<Mutex<Scrollback>>,
     /// Last decoded output observed by the reader. The guard uses this instead
     /// of subscribing to the global output hook, so it cannot replace status.
     last_output: Arc<Mutex<Option<Instant>>>,
     /// Set as soon as a session is killed. It lets a sleeping guard stop before
     /// the child reaper has removed the session from the registry.
+    ///
+    /// Final: never reset. A guard started after the kill must not type into
+    /// the dying session, and resetting it would wake the guards the kill
+    /// already stopped (review A5/B6). Every setter - kill, kill_all, a
+    /// failed exit hook - ends the session, so no per-guard generation is
+    /// needed; one would even leave a guard started after the kill running.
     submit_guard_cancelled: Arc<AtomicBool>,
     /// C-3: the order in which this session's submit guards may type. Only
     /// the guard at the front writes; the others wait for their turn.
     delivery_turns: Arc<DeliveryTurns>,
     /// Opt-in raw I/O trace (`PROJECTA_PTY_TRACE_DIR`): every write into the
     /// PTY and every output chunk, with a millisecond clock, plus the raw
     /// output bytes in a sidecar. Off unless the directory is set - it
     /// records task text. The W1-01 diagnosis needed exactly this view of
     /// the launch path, which no harness reproduced.
     trace: Option<SessionTrace>,
@@ -259,24 +272,26 @@ impl DeliveryTurns {
     fn lock(&self) -> MutexGuard<'_, TurnState> {
         self.state
             .lock()
             .unwrap_or_else(|poison| poison.into_inner())
     }
 
     fn join(self: &Arc<Self>) -> DeliveryTurn {
         let mut state = self.lock();
         let id = state.next_id;
         state.next_id += 1;
+        let ahead = state.queue.len();
         state.queue.push_back(id);
         DeliveryTurn {
             turns: Arc::clone(self),
             id,
+            ahead,
             input_pending: AtomicBool::new(false),
         }
     }
 
     /// Clear the dirty-input flag: the user has typed into this session.
     fn clear_input_dirty(&self) {
         self.lock().input_dirty = false;
     }
 
     #[cfg(test)]
@@ -287,20 +302,22 @@ impl DeliveryTurns {
     #[cfg(test)]
     fn input_dirty(&self) -> bool {
         self.lock().input_dirty
     }
 }
 
 /// One guard's place in [`DeliveryTurns`]; dropping it leaves the queue.
 struct DeliveryTurn {
     turns: Arc<DeliveryTurns>,
     id: u64,
+    /// Deliveries queued before this one when it joined.
+    ahead: usize,
     input_pending: AtomicBool,
 }
 
 impl DeliveryTurn {
     /// Wait up to `timeout` for this guard to reach the front. Returns
     /// whether it is its turn; the caller re-checks cancellation between
     /// calls.
     fn wait(&self, timeout: Duration) -> bool {
         let state = self.turns.lock();
         if state.queue.front() == Some(&self.id) {
@@ -799,21 +816,20 @@ impl PtyManager {
     }
 
     /// Input typed by the user into this session (the terminal view).
     ///
     /// Written like [`PtyManager::write`]; once it has landed, input that
     /// sends or empties the line - Enter, Ctrl-U, Ctrl-C - clears the
     /// session's dirty input line, so deliveries may type again. Other keys
     /// (a letter, a cursor key) leave an earlier task in place and do not
     /// (reviews GLM-5.3 X3, DeepSeek X2). Automatic paths such as worker
     /// messages or diff comments use `write` and never clear it.
-    #[cfg_attr(not(test), allow(dead_code))] // W1-03d verdrahtet write_pty (main.rs)
     pub fn write_user_input(&self, session_id: &str, data: &str) -> Result<(), String> {
         let session = self.get(session_id)?;
         write_session(&session, data)?;
         if data.contains(['\r', '\n', '\u{15}', '\u{3}']) {
             session.delivery_turns.clear_input_dirty();
         }
         Ok(())
     }
 
     /// Start the non-blocking task delivery guard, armed with the agent
@@ -832,49 +848,52 @@ impl PtyManager {
     /// (workspace trust) is answered on sight, because it swallows anything
     /// typed into it. Killing, exiting or archiving the session stops the
     /// guard.
     ///
     /// C-3: deliveries to one session take turns (see [`DeliveryTurns`]).
     /// A second call waits until the first delivery has ended, and its
     /// clocks and write baseline start only with its own turn. The turn ends
     /// with the previous guard's terminal event - for a delivered task that
     /// is the first output after its Enter, not the end of the agent's work;
     /// from there the next guard's own readiness rules decide when it types.
-    /// A guard that gives up while waiting (session killed or gone) reports
-    /// `Escalated`, as does one queued behind a delivery that escalated with
-    /// its task already typed. The dirty-input flag belongs to the session:
-    /// every later delivery escalates without writing until the user sends
-    /// or empties the line ([`PtyManager::write_user_input`]).
+    /// A delivery that has to wait first reports `Queued { ahead }`. A guard
+    /// that gives up while waiting (session killed or gone) reports
+    /// `Escalated`. The dirty-input flag belongs to the session: every later
+    /// delivery reports `InputBlocked` and escalates without writing until
+    /// the user sends or empties the line ([`PtyManager::write_user_input`]).
+    /// A kill is final: a guard started after it escalates without typing.
     pub fn start_submit_guard<F>(
         &self,
         session_id: &str,
         task: String,
         readiness_marker: Option<&str>,
         on_event: F,
     ) -> Result<(), String>
     where
         F: Fn(SubmitGuardEvent) + Send + Sync + 'static,
     {
         let session = self.get(session_id)?;
-        session
-            .submit_guard_cancelled
-            .store(false, Ordering::Release);
 
         // C-3: join the session's delivery queue here, on the caller's
         // thread, so two deliveries keep the order they were started in.
         let turn = session.delivery_turns.join();
 
         let session_id = session_id.to_string();
         let sessions = Arc::clone(&self.sessions);
         let on_event = Arc::new(on_event);
         let readiness_marker = readiness_marker.unwrap_or_default().to_string();
         std::thread::spawn(move || {
+            // Review B2: say that this delivery waits, instead of leaving
+            // the caller on the previous guard's last event for minutes.
+            if turn.ahead > 0 {
+                on_event(SubmitGuardEvent::Queued { ahead: turn.ahead });
+            }
             // Wait until every earlier delivery to this session has ended.
             // The guard ahead is still typing, or waiting for its echo or
             // its Enter to land; a second guard writing now would put both
             // texts into one input line. `turn` leaves the queue on every
             // return below. Liveness is checked once more after the turn
             // arrives: a kill that let the guard ahead return also hands the
             // turn over, and this guard must still report, not go silent.
             let mut my_turn = false;
             loop {
                 let alive = sessions
@@ -890,20 +909,21 @@ impl PtyManager {
                 }
                 if my_turn {
                     break;
                 }
                 my_turn = turn.wait(Duration::from_millis(100));
             }
             if turn.input_dirty() {
                 eprintln!(
                     "projecta: submit guard escalated ({session_id}): an earlier delivery left its task in the input line"
                 );
+                on_event(SubmitGuardEvent::InputBlocked);
                 on_event(SubmitGuardEvent::Escalated);
                 return;
             }
 
             // The guard's clocks start with its turn, not with its call: the
             // readiness and echo deadlines must not be spent waiting behind
             // another delivery.
             let mut guard =
                 SubmitGuard::new(Instant::now(), &task).with_readiness_marker(&readiness_marker);
             // The write baseline, an absolute position on the scrollback's
@@ -2090,20 +2110,31 @@ mod tests {
     }
 
     fn wait_until(what: &str, cond: impl Fn() -> bool) {
         let deadline = Instant::now() + Duration::from_secs(10);
         while !cond() {
             assert!(Instant::now() < deadline, "timed out waiting for {what}");
             std::thread::sleep(Duration::from_millis(20));
         }
     }
 
+    /// Whether a guard has reported its terminal outcome. Waiting for this
+    /// instead of for any event: a queued guard reports `Queued` first.
+    fn reported_outcome(events: &Mutex<Vec<SubmitGuardEvent>>) -> bool {
+        events.lock().unwrap().iter().any(|event| {
+            matches!(
+                event,
+                SubmitGuardEvent::Escalated | SubmitGuardEvent::Delivered
+            )
+        })
+    }
+
     /// W1-03 / C-3: two deliveries to the same session must not type into
     /// each other. Before the fix every `start_submit_guard` ran its own
     /// thread with nothing ordering them, so the second task was written
     /// while the first still waited for its echo - both texts ended up in
     /// the same input line. The queued guard escalates once the session is
     /// killed, so a guard that wrongly wrote would report `Wrote`, not
     /// `Escalated`.
     #[test]
     fn two_guards_on_one_session_do_not_type_into_each_other() {
         let manager = PtyManager::default();
@@ -2126,30 +2157,33 @@ mod tests {
                 Some(GUARD_TEST_MARKER),
                 move |event| queued_sink.lock().unwrap().push(event),
             )
             .unwrap();
 
         wait_until("the first task to be written", || {
             writer.typed().contains("alpha task text")
         });
         manager.kill("c3-interleave").unwrap();
         wait_until("the queued guard to report its outcome", || {
-            !queued_events.lock().unwrap().is_empty()
+            reported_outcome(&queued_events)
         });
         let typed = writer.typed();
         assert!(
             !typed.contains("bravo task text"),
             "second task typed while the first awaited its echo: {typed:?}"
         );
         assert_eq!(
             *queued_events.lock().unwrap(),
-            vec![SubmitGuardEvent::Escalated]
+            vec![
+                SubmitGuardEvent::Queued { ahead: 1 },
+                SubmitGuardEvent::Escalated
+            ]
         );
     }
 
     /// The second delivery is only held, not dropped: once the first one has
     /// ended (echo, Enter, output after it) the next guard takes its turn and
     /// writes its own task after the first one's Enter.
     #[test]
     fn a_queued_guard_writes_once_the_previous_delivery_has_ended() {
         let manager = PtyManager::default();
         let (session, writer) = resting_guard_session(&manager, "c3-turn");
@@ -2233,21 +2267,24 @@ mod tests {
         });
         manager.kill("c3-kill").unwrap();
         wait_until("both guards to leave the queue", || {
             session.delivery_turns.is_empty()
         });
         assert!(!writer.typed().contains("bravo task text"));
         // Review A1: the caller hears that its text was not delivered - an
         // outcome callback that never fires loses the text without a trace.
         assert_eq!(
             *queued_events.lock().unwrap(),
-            vec![SubmitGuardEvent::Escalated]
+            vec![
+                SubmitGuardEvent::Queued { ahead: 1 },
+                SubmitGuardEvent::Escalated
+            ]
         );
     }
 
     /// Review A2/B1: when the delivery ahead escalated after typing its task,
     /// that text may still sit unsent in the input line. A guard that was
     /// already waiting behind it must not type its own text after it - the
     /// next Enter would send both as one line, C-3 with a delay. It
     /// escalates without writing; the worker needs a human anyway.
     #[test]
     fn a_queued_guard_does_not_type_behind_a_failed_delivery() {
@@ -2272,38 +2309,42 @@ mod tests {
                 move |event| queued_sink.lock().unwrap().push(event),
             )
             .unwrap();
         wait_until("the first task to be written", || {
             writer.typed().contains("alpha task text")
         });
         // The first task is echoed, but its Enter fails: the guard escalates
         // with the text still typed into the prompt.
         writer.refuse_enter();
         let deadline = Instant::now() + Duration::from_secs(10);
-        while queued_events.lock().unwrap().is_empty() && Instant::now() < deadline {
+        while !reported_outcome(&queued_events) && Instant::now() < deadline {
             session.scrollback.lock().unwrap().push(b"alpha task text");
             std::thread::sleep(Duration::from_millis(200));
         }
         assert!(
-            !queued_events.lock().unwrap().is_empty(),
+            reported_outcome(&queued_events),
             "timed out waiting for the queued guard to report"
         );
         let typed = writer.typed();
         manager.kill("c3-dirty").unwrap();
 
         assert!(
             !typed.contains("bravo task text"),
             "second task typed behind a failed delivery: {typed:?}"
         );
         assert_eq!(
             *queued_events.lock().unwrap(),
-            vec![SubmitGuardEvent::Escalated]
+            vec![
+                SubmitGuardEvent::Queued { ahead: 1 },
+                SubmitGuardEvent::InputBlocked,
+                SubmitGuardEvent::Escalated
+            ]
         );
     }
 
     /// When the active delivery escalates with its task still in the input
     /// line, every guard already queued behind it must escalate, not type
     /// after it. A third guard that joined before the escalation is also
     /// covered by the dirty-input marker.
     #[test]
     fn three_queued_guards_all_stop_behind_a_failed_delivery() {
         let manager = PtyManager::default();
@@ -2336,51 +2377,59 @@ mod tests {
                 Some(GUARD_TEST_MARKER),
                 move |event| third_sink.lock().unwrap().push(event),
             )
             .unwrap();
 
         wait_until("the first task to be written", || {
             writer.typed().contains("alpha task text")
         });
         writer.refuse_enter();
         let deadline = Instant::now() + Duration::from_secs(10);
-        while (second_events.lock().unwrap().is_empty() || third_events.lock().unwrap().is_empty())
+        while (!reported_outcome(&second_events) || !reported_outcome(&third_events))
             && Instant::now() < deadline
         {
             session.scrollback.lock().unwrap().push(b"alpha task text");
             std::thread::sleep(Duration::from_millis(200));
         }
         assert!(
-            !second_events.lock().unwrap().is_empty(),
+            reported_outcome(&second_events),
             "timed out waiting for the second guard to report"
         );
         assert!(
-            !third_events.lock().unwrap().is_empty(),
+            reported_outcome(&third_events),
             "timed out waiting for the third guard to report"
         );
         let typed = writer.typed();
         manager.kill("c3-dirty-three").unwrap();
         assert!(
             !typed.contains("bravo task text"),
             "second task typed behind a failed delivery: {typed:?}"
         );
         assert!(
             !typed.contains("charlie task text"),
             "third task typed behind a failed delivery: {typed:?}"
         );
         assert_eq!(
             *second_events.lock().unwrap(),
-            vec![SubmitGuardEvent::Escalated]
+            vec![
+                SubmitGuardEvent::Queued { ahead: 1 },
+                SubmitGuardEvent::InputBlocked,
+                SubmitGuardEvent::Escalated
+            ]
         );
         assert_eq!(
             *third_events.lock().unwrap(),
-            vec![SubmitGuardEvent::Escalated]
+            vec![
+                SubmitGuardEvent::Queued { ahead: 2 },
+                SubmitGuardEvent::InputBlocked,
+                SubmitGuardEvent::Escalated
+            ]
         );
     }
 
     /// External review X1: a delivery started only after a previous one
     /// escalated with its task typed must still see the input line as dirty:
     /// the leftover text was never sent, so typing after it would merge both
     /// tasks - C-3 with a delay. It escalates instead.
     #[test]
     fn a_delivery_started_after_a_failed_one_does_not_type_behind_it() {
         let manager = PtyManager::default();
@@ -2429,31 +2478,31 @@ mod tests {
         manager
             .start_submit_guard(
                 "c3-dirty-after",
                 "bravo task text".into(),
                 Some(GUARD_TEST_MARKER),
                 move |event| second_sink.lock().unwrap().push(event),
             )
             .unwrap();
 
         wait_until("the second guard to report its outcome", || {
-            !second_events.lock().unwrap().is_empty()
+            reported_outcome(&second_events)
         });
         let typed = writer.typed();
         manager.kill("c3-dirty-after").unwrap();
         assert!(
             !typed.contains("bravo task text"),
             "second task typed behind a failed delivery: {typed:?}"
         );
         assert_eq!(
             *second_events.lock().unwrap(),
-            vec![SubmitGuardEvent::Escalated]
+            vec![SubmitGuardEvent::InputBlocked, SubmitGuardEvent::Escalated]
         );
     }
 
     /// User input into a session that has a dirty input line clears the
     /// flag, so the next delivery can type normally again.
     #[test]
     fn user_input_clears_the_dirty_line_for_the_next_delivery() {
         let manager = PtyManager::default();
         let (session, writer) = resting_guard_session(&manager, "c3-user-input-clears");
         let first_events = Arc::new(Mutex::new(Vec::new()));
@@ -2589,37 +2638,158 @@ mod tests {
         manager
             .start_submit_guard(
                 "c3-panic",
                 "bravo task text".into(),
                 Some(GUARD_TEST_MARKER),
                 move |event| second_sink.lock().unwrap().push(event),
             )
             .unwrap();
 
         let deadline = Instant::now() + Duration::from_secs(10);
-        while second_events.lock().unwrap().is_empty() && Instant::now() < deadline {
+        while !reported_outcome(&second_events) && Instant::now() < deadline {
             session.scrollback.lock().unwrap().push(b"alpha task text");
             std::thread::sleep(Duration::from_millis(200));
         }
         assert!(
-            !second_events.lock().unwrap().is_empty(),
+            reported_outcome(&second_events),
             "timed out waiting for the second guard to report"
         );
         let typed = writer.typed();
         manager.kill("c3-panic").unwrap();
         assert!(
             !typed.contains("bravo task text"),
             "second task typed behind a panicked delivery: {typed:?}"
         );
         assert_eq!(
             *second_events.lock().unwrap(),
-            vec![SubmitGuardEvent::Escalated]
+            vec![
+                SubmitGuardEvent::Queued { ahead: 1 },
+                SubmitGuardEvent::InputBlocked,
+                SubmitGuardEvent::Escalated
+            ]
+        );
+    }
+
+    /// Review A5/B6: a kill is final for the session's guards. A delivery
+    /// started between the kill and the reaper must not type into the dying
+    /// session; before W1-03d `start_submit_guard` reset the shared cancel
+    /// flag and the new guard wrote on its first tick.
+    #[test]
+    fn a_delivery_started_after_a_kill_does_not_type() {
+        let manager = PtyManager::default();
+        let (_session, writer) = resting_guard_session(&manager, "c3-after-kill");
+        manager.kill("c3-after-kill").unwrap();
+        let events = Arc::new(Mutex::new(Vec::new()));
+        let sink = Arc::clone(&events);
+        manager
+            .start_submit_guard(
+                "c3-after-kill",
+                "alpha task text".into(),
+                Some(GUARD_TEST_MARKER),
+                move |event| sink.lock().unwrap().push(event),
+            )
+            .unwrap();
+        wait_until("the guard to report its outcome", || {
+            reported_outcome(&events)
+        });
+        assert!(
+            !writer.typed().contains("alpha task text"),
+            "a guard started after the kill typed: {:?}",
+            writer.typed()
+        );
+        assert_eq!(*events.lock().unwrap(), vec![SubmitGuardEvent::Escalated]);
+    }
+
+    /// Review A5/B6: starting a delivery must not revive guards that a kill
+    /// already cancelled. Before W1-03d the reset of the shared flag let the
+    /// cancelled guard see its echo and send Enter into the killed session.
+    #[test]
+    fn a_new_delivery_does_not_revive_cancelled_guards() {
+        let manager = PtyManager::default();
+        let (session, writer) = resting_guard_session(&manager, "c3-revive");
+        manager
+            .start_submit_guard(
+                "c3-revive",
+                "alpha task text".into(),
+                Some(GUARD_TEST_MARKER),
+                |_| {},
+            )
+            .unwrap();
+        wait_until("the first task to be written", || {
+            writer.typed().contains("alpha task text")
+        });
+        manager.kill("c3-revive").unwrap();
+        manager
+            .start_submit_guard(
+                "c3-revive",
+                "bravo task text".into(),
+                Some(GUARD_TEST_MARKER),
+                |_| {},
+            )
+            .unwrap();
+        let deadline = Instant::now() + Duration::from_secs(10);
+        while !session.delivery_turns.is_empty() && Instant::now() < deadline {
+            session.scrollback.lock().unwrap().push(b"alpha task text");
+            std::thread::sleep(Duration::from_millis(200));
+        }
+        let typed = writer.typed();
+        assert!(
+            session.delivery_turns.is_empty(),
+            "a cancelled guard kept its turn: {typed:?}"
+        );
+        assert!(
+            !typed.contains('\r'),
+            "a cancelled guard sent Enter into the killed session: {typed:?}"
+        );
+    }
+
+    /// W1-03d (review B2): a delivery that has to wait says so, with the
+    /// number of deliveries ahead of it, instead of leaving the UI on the
+    /// previous guard's last event for minutes.
+    #[test]
+    fn a_queued_delivery_reports_how_many_are_ahead() {
+        let manager = PtyManager::default();
+        let (_session, writer) = resting_guard_session(&manager, "c3-queued");
+        let sinks: Vec<_> = (0..3).map(|_| Arc::new(Mutex::new(Vec::new()))).collect();
+        for (task, sink) in ["alpha task text", "bravo task text", "charlie task text"]
+            .iter()
+            .zip(&sinks)
+        {
+            let sink = Arc::clone(sink);
+            manager
+                .start_submit_guard(
+                    "c3-queued",
+                    (*task).into(),
+                    Some(GUARD_TEST_MARKER),
+                    move |event| sink.lock().unwrap().push(event),
+                )
+                .unwrap();
+        }
+        wait_until("the first task to be written", || {
+            writer.typed().contains("alpha task text")
+        });
+        manager.kill("c3-queued").unwrap();
+        wait_until("the queued guards to report", || {
+            reported_outcome(&sinks[1]) && reported_outcome(&sinks[2])
+        });
+        assert_eq!(
+            sinks[0].lock().unwrap().first(),
+            Some(&SubmitGuardEvent::Wrote { write: 1 }),
+            "the first delivery waits for nobody"
+        );
+        assert_eq!(
+            sinks[1].lock().unwrap().first(),
+            Some(&SubmitGuardEvent::Queued { ahead: 1 })
+        );
+        assert_eq!(
+            sinks[2].lock().unwrap().first(),
+            Some(&SubmitGuardEvent::Queued { ahead: 2 })
         );
     }
 
     #[test]
     fn scrollback_keeps_only_the_tail() {
         let mut sb = Scrollback::new();
         sb.push(&vec![b'a'; SCROLLBACK_CAPACITY]);
         sb.push(b"tail");
         let out = sb.to_lossy_string();
         assert_eq!(out.len(), SCROLLBACK_CAPACITY);
```

## Anhang: Kontext (der Reviewer hat keinen Dateizugriff)

### Frontend – einziger Aufrufer von write_pty (src/components/TerminalView.tsx)
```tsx
    const dataSub = term.onData((data) => {
      void writePty(sessionId, data).catch(reportError);
    });
```

### main.rs – Konsumenten von SubmitGuardEvent
```rust
    fn start_task_delivery(
        &self,
        worker_id: &str,
        session_id: &str,
        task: &str,
        readiness_marker: Option<&str>,
        on_outcome: Option<DeliveryCallback>,
    ) -> Result<(), String> {
        let worker_id = worker_id.to_string();
        let app = self.app.clone();
        // Fired at most once: Delivered and Escalated are the guard's
        // terminal events - the PTY layer returns right after emitting them.
        let on_outcome = Mutex::new(on_outcome);
        self.app.state::<PtyManager>().start_submit_guard(
            session_id,
            task.to_string(),
            readiness_marker,
            move |event| {
                // The sweep has no status-event wiring of its own; the answer
                // itself is logged by questions.rs. An escalation still marks
                // the worker as needing a human, once the engine is managed.
                if event == SubmitGuardEvent::Escalated {
                    if let Some(engine) = app.try_state::<Arc<StatusEngine>>() {
                        engine.note_submit_guard_failed(&worker_id);
                    }
                }
                let outcome = match event {
                    SubmitGuardEvent::Delivered => Some(DeliveryOutcome::Delivered),
                    SubmitGuardEvent::Escalated => Some(DeliveryOutcome::Escalated),
                    _ => None,
                };
                if let Some(outcome) = outcome {
                    if let Some(callback) = on_outcome.lock().unwrap().take() {
                        callback(outcome);
                    }
                }
                eprintln!("projecta: question sweep guard ({worker_id}): {event:?}");
            },
        )
    }

    fn kill(&self, session_id: &str) {
        let _ = self.app.state::<PtyManager>().kill(session_id);
    }
}

// ...
        let readiness_marker = readiness_marker.map(str::to_string);
        let store = self.store.clone();
        let engine = Arc::clone(&self.engine);
        // Fired at most once: Delivered and Escalated are the guard's
        // terminal events - the PTY layer returns right after emitting them.
        let on_outcome = Mutex::new(on_outcome);
        let narrative = Mutex::new(GuardNarrative::default());
        self.manager.start_submit_guard(
            session_id,
            task.to_string(),
            readiness_marker.as_deref(),
            move |event| {
                let outcome = match event {
                    SubmitGuardEvent::Delivered => Some(DeliveryOutcome::Delivered),
                    SubmitGuardEvent::Escalated => Some(DeliveryOutcome::Escalated),
                    _ => None,
                };
                if let Some(outcome) = outcome {
                    if let Some(callback) = on_outcome.lock().unwrap().take() {
                        callback(outcome);
                    }
                }
                if event == SubmitGuardEvent::Escalated {
                    engine.note_submit_guard_failed(&worker_id);
                }
                let detail = narrative.lock().unwrap().detail(&event);
                let store = store.clone();
                let worker_id = worker_id.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = store
                        .record_status_event(
                            &worker_id,
                            "submit_guard",
                            &detail,
                            crate::store::SRC_GUARD,
                        )
                        .await
                    {
                        eprintln!("projecta: {err}");
                    }
                });
            },
        )
    }
}

// -- pty commands (Phase 1) ------------------------------------------------

#[tauri::command]
fn spawn_pty(
    app: AppHandle,
    manager: State<'_, PtyManager>,
```

### pty.rs – alle Stellen mit submit_guard_cancelled (Produktivcode)
```
222:    submit_guard_cancelled: Arc<AtomicBool>,
743:        let submit_guard_cancelled = Arc::new(AtomicBool::new(false));
751:            submit_guard_cancelled: Arc::clone(&submit_guard_cancelled),
778:        let exit_guard_cancelled = Arc::clone(&submit_guard_cancelled);
783:                exit_guard_cancelled.store(true, Ordering::Release);
805:                exit_guard_cancelled.store(true, Ordering::Release);
903:                    .is_some_and(|session| !session.submit_guard_cancelled.load(Ordering::Acquire));
944:                if session.submit_guard_cancelled.load(Ordering::Acquire) {
1076:            .submit_guard_cancelled
1115:                .submit_guard_cancelled
```

### pty.rs – start_submit_guard vollständig
```rust
    pub fn start_submit_guard<F>(
        &self,
        session_id: &str,
        task: String,
        readiness_marker: Option<&str>,
        on_event: F,
    ) -> Result<(), String>
    where
        F: Fn(SubmitGuardEvent) + Send + Sync + 'static,
    {
        let session = self.get(session_id)?;

        // C-3: join the session's delivery queue here, on the caller's
        // thread, so two deliveries keep the order they were started in.
        let turn = session.delivery_turns.join();

        let session_id = session_id.to_string();
        let sessions = Arc::clone(&self.sessions);
        let on_event = Arc::new(on_event);
        let readiness_marker = readiness_marker.unwrap_or_default().to_string();
        std::thread::spawn(move || {
            // Review B2: say that this delivery waits, instead of leaving
            // the caller on the previous guard's last event for minutes.
            if turn.ahead > 0 {
                on_event(SubmitGuardEvent::Queued { ahead: turn.ahead });
            }
            // Wait until every earlier delivery to this session has ended.
            // The guard ahead is still typing, or waiting for its echo or
            // its Enter to land; a second guard writing now would put both
            // texts into one input line. `turn` leaves the queue on every
            // return below. Liveness is checked once more after the turn
            // arrives: a kill that let the guard ahead return also hands the
            // turn over, and this guard must still report, not go silent.
            let mut my_turn = false;
            loop {
                let alive = sessions
                    .lock()
                    .ok()
                    .and_then(|map| map.get(&session_id).and_then(SessionEntry::interactive))
                    .is_some_and(|session| !session.submit_guard_cancelled.load(Ordering::Acquire));
                if !alive {
                    // Review A1: the caller still hears that its text was
                    // not delivered, instead of an outcome that never fires.
                    on_event(SubmitGuardEvent::Escalated);
                    return;
                }
                if my_turn {
                    break;
                }
                my_turn = turn.wait(Duration::from_millis(100));
            }
            if turn.input_dirty() {
                eprintln!(
                    "projecta: submit guard escalated ({session_id}): an earlier delivery left its task in the input line"
                );
                on_event(SubmitGuardEvent::InputBlocked);
                on_event(SubmitGuardEvent::Escalated);
                return;
            }

            // The guard's clocks start with its turn, not with its call: the
            // readiness and echo deadlines must not be spent waiting behind
            // another delivery.
            let mut guard =
                SubmitGuard::new(Instant::now(), &task).with_readiness_marker(&readiness_marker);
            // The write baseline, an absolute position on the scrollback's
            // `total_pushed` counter: set at guard start, moved past every
            // task write (including rewrites). All content proofs - echo,
            // readiness marker, answer marker - search only the output after
            // it, so leftovers from before can never count.
            let mut write_mark: Option<u64> = None;

            loop {
                let Some(session) = sessions
                    .lock()
                    .ok()
                    .and_then(|map| map.get(&session_id).and_then(SessionEntry::interactive))
                else {
                    return;
                };
                if session.submit_guard_cancelled.load(Ordering::Acquire) {
                    return;
                }

                // Tail and byte counter from ONE lock: reading the ring and
                // a separate counter in sequence could straddle an 8 KiB
                // read chunk and disagree about what is "new".
                let (tail_bytes, tail_start, output_bytes) = session
                    .scrollback
                    .lock()
                    .map(|sb| sb.snapshot(GUARD_TAIL_BYTES))
                    .unwrap_or_default();
                let last_output = session.last_output.lock().ok().and_then(|at| *at);
                let mark = *write_mark.get_or_insert(output_bytes);
                let (since_bytes, window_overflowed) =
                    tail_since_mark(&tail_bytes, tail_start, mark);
                // Partial UTF-8 at the cut is handled like the ring's own
                // lossy decoding: from_utf8_lossy, then normalize.
                let normalized = crate::submit_guard::normalize_tui_output(
                    &String::from_utf8_lossy(&tail_bytes),
                );
                let since_normalized = crate::submit_guard::normalize_tui_output(
                    &String::from_utf8_lossy(since_bytes),
                );
                let obs = Observation {
                    now: Instant::now(),
                    output_bytes,
                    last_output,
                    tail: &normalized,
                    tail_since_write: &since_normalized,
                    write_window_overflowed: window_overflowed,
                };

                let action = guard.tick(&obs);
                // Record whether the task may still be in the input line
                // *before* performing the action, so a panic or failed write
                // is covered by the turn's drop.
                turn.set_input_pending(guard.input_pending());

                match action {
                    Some(SubmitAction::WriteTask { write }) => {
                        on_event(SubmitGuardEvent::Wrote { write });
                        if write_session(&session, &task).is_err() {
                            on_event(SubmitGuardEvent::Escalated);
                            return;
                        }
                        // The mark moves past this write: only output after
                        // it can prove the echo.
                        if let Ok(sb) = session.scrollback.lock() {
                            write_mark = Some(sb.position());
                        }
                    }
                    Some(SubmitAction::SendEnter { attempt }) => {
                        on_event(SubmitGuardEvent::Enter { attempt });
                        if write_session(&session, "\r").is_err() {
                            on_event(SubmitGuardEvent::Escalated);
                            return;
                        }
                    }
                    Some(SubmitAction::AnswerDialog(kind)) => {
                        on_event(SubmitGuardEvent::DialogAnswered);
                        if write_session(&session, kind.keystrokes()).is_err() {
                            on_event(SubmitGuardEvent::Escalated);
                            return;
                        }
                    }
                    Some(SubmitAction::ConfirmDelivery) => {
                        // Marker-confirmed delivery ends the guard as
                        // delivered; the `is_done` check below carries the
                        // Delivered event.
                    }
                    Some(SubmitAction::Escalate) => {
                        if let Some(reason) = guard.escalation_reason() {
                            eprintln!(
                                "projecta: submit guard escalated ({session_id}): {reason:?}"
                            );
                        }
                        on_event(SubmitGuardEvent::Escalated);
                        return;
                    }
                    None => {}
                }
                if guard.is_done() {
                    if guard.is_delivered() {
                        on_event(SubmitGuardEvent::Delivered);
                    }
                    return;
                }

                std::thread::sleep(Duration::from_millis(100));
            }
        });
        Ok(())
    }

```
