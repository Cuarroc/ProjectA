# Review-Auftrag — W1-03c: Submit-Guard-Härtung (Folge von C-3 / PR #72)

Du bist unabhängiger Code-Reviewer. Du hast den Code nicht geschrieben.
Implementiert hat opencode mit kimi-k2.7-code nach einem Design von Claude Code;
Claude hat Diff und Tests geprüft. Du bist die anbieterfremde Gegenprobe.

## Kontext

ProjectA ist eine Tauri-2-App (Rust), die CLI-Agenten in PTYs startet. Ein
**Submit-Guard** (Thread je Zustellung) tippt einen Auftrag in die TUI des
Agenten und belegt die Zustellung (Readiness → Write → Echo → Enter → Output
danach); jede Phase ist gekappt. C-3 (PR #72, gemergt) hat die Guards einer
Sitzung über eine FIFO (`DeliveryTurns`) serialisiert. Eskalierte ein Guard nach
dem Tippen, eskalierten die zu diesem Zeitpunkt Wartenden ohne zu schreiben
(Epochengrenze `dirty_below` über `next_id`).

Drei externe Reviews fanden danach:
- X1: `dirty_below` ist nur eine Epochengrenze; eine NACH der Eskalation
  gestartete Zustellung tippt hinter den liegengebliebenen Text.
- `typed_task` wurde nach erfolgreichem Enter nie zurückgesetzt.
- Ein Panic nach dem Schreiben markierte nichts.
- `next_id.load` war nicht mit dem Queue-Lock synchronisiert.
- Die Tests nutzten feste 600-ms-Negativfenster.

**Dieser Diff:**
- `SubmitGuard::input_pending()`: gesetzt beim `WriteTask`, geräumt, sobald
  Output das Enter beantwortet (dasselbe byte-basierte Kriterium wie
  `Delivered`). Produktiv ist kein Answer-Marker verdrahtet; dann endet jeder
  beantwortete Enter in `Delivered`.
- `DeliveryTurns`: Queue, `next_id` und `input_dirty` unter EINEM Mutex.
  `DeliveryTurn::drop` entfernt das Ticket und setzt – falls der Guard
  `input_pending` gemeldet hat – `input_dirty` im selben Lock. Das deckt jeden
  Ausweg ab, auch Panic (Unwind).
- Der Guard-Thread meldet nach jedem `tick` `turn.set_input_pending(...)`,
  BEVOR er die Aktion ausführt.
- Ein Guard, der an die Reihe kommt und `input_dirty` sieht, meldet
  `Escalated`, ohne zu schreiben. Der Zustand bleibt, bis
  `PtyManager::write_user_input` (Nutzereingabe) ihn räumt. `PtyManager::write`
  räumt NICHT, weil auch automatische Pfade (Worker-Nachrichten,
  Diff-Kommentare) es benutzen. Die Verdrahtung von `write_pty` (Tauri-Command
  für Tastatureingaben aus der Terminal-Ansicht, main.rs) auf
  `write_user_input` folgt bewusst im nächsten PR (W1-03d), weil main.rs eine
  Nahtstelle ist.
- Tests: rote Tests für die späte Zustellung, den Panic und `input_pending`,
  plus drei Guards in Reihe und das Räumen durch Nutzereingabe. Die zwei
  600-ms-Fenster warten jetzt auf das Ereignis des wartenden Guards.

## Worauf du achten sollst

1. Nebenläufigkeit: Kann ein Guard trotz Fix hinter fremden Text tippen
   (z. B. Reihenfolge von `on_event(Escalated)` und Drop, Aufrufer stellt auf
   das Ereignis hin sofort neu zu)? Lock-Reihenfolge, Poisoning, Panic im
   Drop.
2. Semantik von `input_pending`: Gibt es einen Pfad, auf dem Text in der Zeile
   steht und das Flag trotzdem false ist, oder umgekehrt eine unnötige
   Blockade? Ist das „dauerhaft bis Nutzereingabe“ angemessen, solange die
   Verdrahtung in main.rs noch fehlt (bis dahin blockiert eine
   Dirty-Eskalation die Sitzung bis zum Neustart)?
3. Tests: Belegen sie, was sie behaupten? Deterministisch genug?
4. Alles, was dir sonst auffällt.

## Antwortformat

Befunde als Liste: ID (X1, X2 …), Schwere (hoch/mittel/niedrig), Datei und
Stelle, konkretes Fehlerszenario, Fix-Vorschlag. Danach geprüfte und verworfene
Punkte in je einer Zeile. Zum Schluss ein Urteil: mergebereit / nach
Überarbeitung / ablehnen. Deutsch, knapp. Keine Befunde erfinden: „keine
Befunde“ ist eine gültige Antwort.

## Der Diff (gegen `main` @ 45b6a19)

```diff
diff --git a/src-tauri/src/pty.rs b/src-tauri/src/pty.rs
index 1c35b17..3d75d9b 100644
--- a/src-tauri/src/pty.rs
+++ b/src-tauri/src/pty.rs
@@ -224,100 +224,123 @@ struct Session {
 /// order is the call order - and only the guard at the front may type. A
 /// guard leaves the queue on every way out of its thread (delivered,
 /// escalated, cancelled, session gone, panic), because its [`DeliveryTurn`]
 /// removes it on drop; a guard that gives up while still waiting leaves the
 /// same way, so it can never block the ones behind it.
 ///
 /// No wait here is unbounded: every phase of the guard ahead is capped
 /// (`MARKER_BUSY_CAP`/`READY_MAX_WAIT`, `MAX_WRITES` x `ECHO_BUSY_CAP`,
 /// `ENTER_SETTLE_CAP`, `RETRY_BACKOFF` - about eleven minutes in all), and a
 /// waiting guard re-checks cancellation and the session on every wake-up.
 ///
 /// A delivery that escalates *after* typing its task may leave that text
-/// unsent in the input line. Every guard already queued behind it at that
-/// moment then escalates instead of typing after it (`dirty_below`); a
-/// delivery started later, once a human has looked, types normally.
+/// unsent in the input line. The session keeps an `input_dirty` flag for
+/// this: it is set when a turn leaves the queue while its guard still had
+/// input pending, and stays set until user input into this session clears it
+/// via [`PtyManager::write_user_input`]. Every later delivery escalates
+/// without writing until the user has looked at the session.
 #[derive(Default)]
 struct DeliveryTurns {
-    queue: Mutex<VecDeque<u64>>,
+    state: Mutex<TurnState>,
     changed: Condvar,
-    next_id: AtomicU64,
-    /// Guards with an id below this value joined before a typed task was
-    /// left behind by an escalation; they must not type.
-    dirty_below: AtomicU64,
+}
+
+#[derive(Default)]
+struct TurnState {
+    queue: VecDeque<u64>,
+    next_id: u64,
+    /// Set when a turn leaves the queue while its task may still sit in the
+    /// input line; cleared by user input into this session.
+    input_dirty: bool,
 }
 
 impl DeliveryTurns {
     /// A plain queue of ids stays consistent even if a holder panicked, so a
     /// poisoned lock is taken over instead of wedging every later delivery.
-    fn lock(&self) -> MutexGuard<'_, VecDeque<u64>> {
-        self.queue
+    fn lock(&self) -> MutexGuard<'_, TurnState> {
+        self.state
             .lock()
             .unwrap_or_else(|poison| poison.into_inner())
     }
 
     fn join(self: &Arc<Self>) -> DeliveryTurn {
-        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
-        self.lock().push_back(id);
+        let mut state = self.lock();
+        let id = state.next_id;
+        state.next_id += 1;
+        state.queue.push_back(id);
         DeliveryTurn {
             turns: Arc::clone(self),
             id,
+            input_pending: AtomicBool::new(false),
         }
     }
 
-    /// A guard escalated with its task possibly still in the input line:
-    /// every guard queued so far must not type after it.
-    fn mark_input_dirty(&self) {
-        let issued = self.next_id.load(Ordering::Relaxed);
-        self.dirty_below.fetch_max(issued, Ordering::AcqRel);
+    /// Clear the dirty-input flag: the user has typed into this session.
+    fn clear_input_dirty(&self) {
+        self.lock().input_dirty = false;
     }
 
     #[cfg(test)]
     fn is_empty(&self) -> bool {
-        self.lock().is_empty()
+        self.lock().queue.is_empty()
+    }
+
+    #[cfg(test)]
+    fn input_dirty(&self) -> bool {
+        self.lock().input_dirty
     }
 }
 
 /// One guard's place in [`DeliveryTurns`]; dropping it leaves the queue.
 struct DeliveryTurn {
     turns: Arc<DeliveryTurns>,
     id: u64,
+    input_pending: AtomicBool,
 }
 
 impl DeliveryTurn {
     /// Wait up to `timeout` for this guard to reach the front. Returns
     /// whether it is its turn; the caller re-checks cancellation between
     /// calls.
     fn wait(&self, timeout: Duration) -> bool {
-        let queue = self.turns.lock();
-        if queue.front() == Some(&self.id) {
+        let state = self.turns.lock();
+        if state.queue.front() == Some(&self.id) {
             return true;
         }
-        let (queue, _) = self
+        let (state, _) = self
             .turns
             .changed
-            .wait_timeout(queue, timeout)
+            .wait_timeout(state, timeout)
             .unwrap_or_else(|poison| poison.into_inner());
-        queue.front() == Some(&self.id)
+        state.queue.front() == Some(&self.id)
+    }
+
+    fn set_input_pending(&self, pending: bool) {
+        self.input_pending.store(pending, Ordering::Relaxed);
     }
 
-    /// Whether an escalation ahead of this guard left a typed task behind.
-    fn input_left_dirty(&self) -> bool {
-        self.id < self.turns.dirty_below.load(Ordering::Acquire)
+    /// Whether a delivery before this one left its task in the session's
+    /// input line and no user input has cleared it since.
+    fn input_dirty(&self) -> bool {
+        self.turns.lock().input_dirty
     }
 }
 
 impl Drop for DeliveryTurn {
     fn drop(&mut self) {
-        self.turns.lock().retain(|id| *id != self.id);
+        let mut state = self.turns.lock();
+        state.queue.retain(|id| *id != self.id);
+        if self.input_pending.load(Ordering::Relaxed) {
+            state.input_dirty = true;
+        }
         self.turns.changed.notify_all();
     }
 }
 
 /// See [`Session::trace`].
 struct SessionTrace {
     started: Instant,
     log: Mutex<std::fs::File>,
     raw_out: Mutex<std::fs::File>,
 }
 
 impl SessionTrace {
@@ -766,24 +789,37 @@ impl PtyManager {
                 eprintln!("projecta: session {exit_id} exit requires reconciliation: {error}");
             }
         });
 
         Ok(session_id)
     }
 
     pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
         let session = self.get(session_id)?;
         write_session(&session, data)
     }
 
+    /// Input typed by the user into this session (the terminal view).
+    ///
+    /// This clears the guard's `input_dirty` flag for the session because a
+    /// person has looked at the prompt, then writes the bytes the same way
+    /// [`PtyManager::write`] does. Automatic paths such as worker messages or
+    /// diff comments use `write` and therefore do *not* clear the flag.
+    #[cfg_attr(not(test), allow(dead_code))] // W1-03d verdrahtet write_pty (main.rs)
+    pub fn write_user_input(&self, session_id: &str, data: &str) -> Result<(), String> {
+        let session = self.get(session_id)?;
+        session.delivery_turns.clear_input_dirty();
+        write_session(&session, data)
+    }
+
     /// Start the non-blocking task delivery guard, armed with the agent
     /// profile's readiness marker when it knows one.
     ///
     /// The task is written once the TUI proves its input loop is alive -
     /// either by showing the profile's `readiness_marker` (OpenCode's "Ask
     /// anything", see NT-17: silence alone is *not* readiness, because
     /// OpenCode flushes ConPTY input written before its loop runs) or, for
     /// profiles without a marker, once the opening burst has been quiet for
     /// three seconds (30s at most). The write goes without a trailing Enter,
     /// which some TUIs swallow when it shares a write with the text. Delivery
     /// is then *proven from content*: the TUI must echo the task (else the
     /// write is repeated), Enter travels as its own write, and only output
@@ -791,25 +827,27 @@ impl PtyManager {
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
     /// A guard that gives up while waiting (session killed or gone) reports
     /// `Escalated`, as does one queued behind a delivery that escalated with
-    /// its task already typed.
+    /// its task already typed. The dirty-input flag belongs to the session:
+    /// every later delivery escalates without writing until user input into
+    /// this session clears it via [`PtyManager::write_user_input`].
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
         session
@@ -841,52 +879,43 @@ impl PtyManager {
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
-            if turn.input_left_dirty() {
+            if turn.input_dirty() {
                 eprintln!(
                     "projecta: submit guard escalated ({session_id}): an earlier delivery left its task in the input line"
                 );
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
-            // Whether this guard has typed its task: an escalation after
-            // that may leave the text in the input line.
-            let mut typed_task = false;
-            let escalate = |typed_task: bool| {
-                if typed_task {
-                    turn.turns.mark_input_dirty();
-                }
-                on_event(SubmitGuardEvent::Escalated);
-            };
 
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
@@ -911,66 +940,69 @@ impl PtyManager {
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
 
-                match guard.tick(&obs) {
+                let action = guard.tick(&obs);
+                // Record whether the task may still be in the input line
+                // *before* performing the action, so a panic or failed write
+                // is covered by the turn's drop.
+                turn.set_input_pending(guard.input_pending());
+
+                match action {
                     Some(SubmitAction::WriteTask { write }) => {
                         on_event(SubmitGuardEvent::Wrote { write });
-                        // Set before the write: a failed write may still
-                        // have put part of the text on the line.
-                        typed_task = true;
                         if write_session(&session, &task).is_err() {
-                            escalate(typed_task);
+                            on_event(SubmitGuardEvent::Escalated);
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
-                            escalate(typed_task);
+                            on_event(SubmitGuardEvent::Escalated);
                             return;
                         }
                     }
                     Some(SubmitAction::AnswerDialog(kind)) => {
                         on_event(SubmitGuardEvent::DialogAnswered);
                         if write_session(&session, kind.keystrokes()).is_err() {
-                            escalate(typed_task);
+                            on_event(SubmitGuardEvent::Escalated);
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
-                        escalate(typed_task);
+                        on_event(SubmitGuardEvent::Escalated);
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
@@ -2055,58 +2087,67 @@ mod tests {
     fn wait_until(what: &str, cond: impl Fn() -> bool) {
         let deadline = Instant::now() + Duration::from_secs(10);
         while !cond() {
             assert!(Instant::now() < deadline, "timed out waiting for {what}");
             std::thread::sleep(Duration::from_millis(20));
         }
     }
 
     /// W1-03 / C-3: two deliveries to the same session must not type into
     /// each other. Before the fix every `start_submit_guard` ran its own
     /// thread with nothing ordering them, so the second task was written
     /// while the first still waited for its echo - both texts ended up in
-    /// the same input line.
+    /// the same input line. The queued guard escalates once the session is
+    /// killed, so a guard that wrongly wrote would report `Wrote`, not
+    /// `Escalated`.
     #[test]
     fn two_guards_on_one_session_do_not_type_into_each_other() {
         let manager = PtyManager::default();
         let (_session, writer) = resting_guard_session(&manager, "c3-interleave");
+        let queued_events = Arc::new(Mutex::new(Vec::new()));
+        let queued_sink = Arc::clone(&queued_events);
 
         manager
             .start_submit_guard(
                 "c3-interleave",
                 "alpha task text".into(),
                 Some(GUARD_TEST_MARKER),
                 |_| {},
             )
             .unwrap();
         manager
             .start_submit_guard(
                 "c3-interleave",
                 "bravo task text".into(),
                 Some(GUARD_TEST_MARKER),
-                |_| {},
+                move |event| queued_sink.lock().unwrap().push(event),
             )
             .unwrap();
 
         wait_until("the first task to be written", || {
             writer.typed().contains("alpha task text")
         });
-        // Several guard ticks: the second guard would have written by now.
-        std::thread::sleep(Duration::from_millis(600));
-        let typed = writer.typed();
         manager.kill("c3-interleave").unwrap();
+        wait_until("the queued guard to report its outcome", || {
+            !queued_events.lock().unwrap().is_empty()
+        });
+        let typed = writer.typed();
         assert!(
             !typed.contains("bravo task text"),
             "second task typed while the first awaited its echo: {typed:?}"
         );
+        assert_eq!(
+            *queued_events.lock().unwrap(),
+            vec![SubmitGuardEvent::Escalated]
+        );
     }
 
     /// The second delivery is only held, not dropped: once the first one has
     /// ended (echo, Enter, output after it) the next guard takes its turn and
     /// writes its own task after the first one's Enter.
     #[test]
     fn a_queued_guard_writes_once_the_previous_delivery_has_ended() {
         let manager = PtyManager::default();
         let (session, writer) = resting_guard_session(&manager, "c3-turn");
         let events = Arc::new(Mutex::new(Vec::new()));
         let first_events = Arc::clone(&events);
 
@@ -2224,43 +2265,330 @@ mod tests {
                 "bravo task text".into(),
                 Some(GUARD_TEST_MARKER),
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
-        while !session.delivery_turns.is_empty() && Instant::now() < deadline {
+        while queued_events.lock().unwrap().is_empty() && Instant::now() < deadline {
             session.scrollback.lock().unwrap().push(b"alpha task text");
             std::thread::sleep(Duration::from_millis(200));
         }
-        // Several ticks for a second guard that wrongly got its turn.
-        std::thread::sleep(Duration::from_millis(600));
+        assert!(
+            !queued_events.lock().unwrap().is_empty(),
+            "timed out waiting for the queued guard to report"
+        );
         let typed = writer.typed();
         manager.kill("c3-dirty").unwrap();
 
         assert!(
             !typed.contains("bravo task text"),
             "second task typed behind a failed delivery: {typed:?}"
         );
         assert_eq!(
             *queued_events.lock().unwrap(),
             vec![SubmitGuardEvent::Escalated]
         );
     }
 
+    /// When the active delivery escalates with its task still in the input
+    /// line, every guard already queued behind it must escalate, not type
+    /// after it. A third guard that joined before the escalation is also
+    /// covered by the dirty-input marker.
+    #[test]
+    fn three_queued_guards_all_stop_behind_a_failed_delivery() {
+        let manager = PtyManager::default();
+        let (session, writer) = resting_guard_session(&manager, "c3-dirty-three");
+        let second_events = Arc::new(Mutex::new(Vec::new()));
+        let second_sink = Arc::clone(&second_events);
+        let third_events = Arc::new(Mutex::new(Vec::new()));
+        let third_sink = Arc::clone(&third_events);
+
+        manager
+            .start_submit_guard(
+                "c3-dirty-three",
+                "alpha task text".into(),
+                Some(GUARD_TEST_MARKER),
+                |_| {},
+            )
+            .unwrap();
+        manager
+            .start_submit_guard(
+                "c3-dirty-three",
+                "bravo task text".into(),
+                Some(GUARD_TEST_MARKER),
+                move |event| second_sink.lock().unwrap().push(event),
+            )
+            .unwrap();
+        manager
+            .start_submit_guard(
+                "c3-dirty-three",
+                "charlie task text".into(),
+                Some(GUARD_TEST_MARKER),
+                move |event| third_sink.lock().unwrap().push(event),
+            )
+            .unwrap();
+
+        wait_until("the first task to be written", || {
+            writer.typed().contains("alpha task text")
+        });
+        writer.refuse_enter();
+        let deadline = Instant::now() + Duration::from_secs(10);
+        while (second_events.lock().unwrap().is_empty() || third_events.lock().unwrap().is_empty())
+            && Instant::now() < deadline
+        {
+            session.scrollback.lock().unwrap().push(b"alpha task text");
+            std::thread::sleep(Duration::from_millis(200));
+        }
+        assert!(
+            !second_events.lock().unwrap().is_empty(),
+            "timed out waiting for the second guard to report"
+        );
+        assert!(
+            !third_events.lock().unwrap().is_empty(),
+            "timed out waiting for the third guard to report"
+        );
+        let typed = writer.typed();
+        manager.kill("c3-dirty-three").unwrap();
+        assert!(
+            !typed.contains("bravo task text"),
+            "second task typed behind a failed delivery: {typed:?}"
+        );
+        assert!(
+            !typed.contains("charlie task text"),
+            "third task typed behind a failed delivery: {typed:?}"
+        );
+        assert_eq!(
+            *second_events.lock().unwrap(),
+            vec![SubmitGuardEvent::Escalated]
+        );
+        assert_eq!(
+            *third_events.lock().unwrap(),
+            vec![SubmitGuardEvent::Escalated]
+        );
+    }
+
+    /// External review X1: a delivery started only after a previous one
+    /// escalated with its task typed must still see the input line as dirty:
+    /// the leftover text was never sent, so typing after it would merge both
+    /// tasks - C-3 with a delay. It escalates instead.
+    #[test]
+    fn a_delivery_started_after_a_failed_one_does_not_type_behind_it() {
+        let manager = PtyManager::default();
+        let (session, writer) = resting_guard_session(&manager, "c3-dirty-after");
+        let first_events = Arc::new(Mutex::new(Vec::new()));
+        let first_sink = Arc::clone(&first_events);
+
+        manager
+            .start_submit_guard(
+                "c3-dirty-after",
+                "alpha task text".into(),
+                Some(GUARD_TEST_MARKER),
+                move |event| first_sink.lock().unwrap().push(event),
+            )
+            .unwrap();
+
+        wait_until("the first task to be written", || {
+            writer.typed().contains("alpha task text")
+        });
+        writer.refuse_enter();
+        let deadline = Instant::now() + Duration::from_secs(10);
+        while !(first_events
+            .lock()
+            .unwrap()
+            .contains(&SubmitGuardEvent::Escalated)
+            && session.delivery_turns.is_empty())
+            && Instant::now() < deadline
+        {
+            session.scrollback.lock().unwrap().push(b"alpha task text");
+            std::thread::sleep(Duration::from_millis(200));
+        }
+        assert!(
+            first_events
+                .lock()
+                .unwrap()
+                .contains(&SubmitGuardEvent::Escalated),
+            "the first delivery did not escalate"
+        );
+        assert!(
+            session.delivery_turns.is_empty(),
+            "the first delivery did not leave the queue"
+        );
+
+        let second_events = Arc::new(Mutex::new(Vec::new()));
+        let second_sink = Arc::clone(&second_events);
+        manager
+            .start_submit_guard(
+                "c3-dirty-after",
+                "bravo task text".into(),
+                Some(GUARD_TEST_MARKER),
+                move |event| second_sink.lock().unwrap().push(event),
+            )
+            .unwrap();
+
+        wait_until("the second guard to report its outcome", || {
+            !second_events.lock().unwrap().is_empty()
+        });
+        let typed = writer.typed();
+        manager.kill("c3-dirty-after").unwrap();
+        assert!(
+            !typed.contains("bravo task text"),
+            "second task typed behind a failed delivery: {typed:?}"
+        );
+        assert_eq!(
+            *second_events.lock().unwrap(),
+            vec![SubmitGuardEvent::Escalated]
+        );
+    }
+
+    /// User input into a session that has a dirty input line clears the
+    /// flag, so the next delivery can type normally again.
+    #[test]
+    fn user_input_clears_the_dirty_line_for_the_next_delivery() {
+        let manager = PtyManager::default();
+        let (session, writer) = resting_guard_session(&manager, "c3-user-input-clears");
+        let first_events = Arc::new(Mutex::new(Vec::new()));
+        let first_sink = Arc::clone(&first_events);
+
+        manager
+            .start_submit_guard(
+                "c3-user-input-clears",
+                "alpha task text".into(),
+                Some(GUARD_TEST_MARKER),
+                move |event| first_sink.lock().unwrap().push(event),
+            )
+            .unwrap();
+
+        wait_until("the first task to be written", || {
+            writer.typed().contains("alpha task text")
+        });
+        writer.refuse_enter();
+        let deadline = Instant::now() + Duration::from_secs(10);
+        while !(first_events
+            .lock()
+            .unwrap()
+            .contains(&SubmitGuardEvent::Escalated)
+            && session.delivery_turns.is_empty())
+            && Instant::now() < deadline
+        {
+            session.scrollback.lock().unwrap().push(b"alpha task text");
+            std::thread::sleep(Duration::from_millis(200));
+        }
+        assert!(
+            first_events
+                .lock()
+                .unwrap()
+                .contains(&SubmitGuardEvent::Escalated),
+            "the first delivery did not escalate"
+        );
+        assert!(
+            session.delivery_turns.is_empty(),
+            "the first delivery did not leave the queue"
+        );
+        assert!(
+            session.delivery_turns.input_dirty(),
+            "the failed delivery should have left the input line dirty"
+        );
+
+        // Ctrl-U from the user clears the dirty line.
+        manager
+            .write_user_input("c3-user-input-clears", "\u{15}")
+            .unwrap();
+        assert!(
+            !session.delivery_turns.input_dirty(),
+            "user input should clear the dirty flag"
+        );
+
+        let second_events = Arc::new(Mutex::new(Vec::new()));
+        let second_sink = Arc::clone(&second_events);
+        manager
+            .start_submit_guard(
+                "c3-user-input-clears",
+                "bravo task text".into(),
+                Some(GUARD_TEST_MARKER),
+                move |event| second_sink.lock().unwrap().push(event),
+            )
+            .unwrap();
+
+        wait_until("the second task to be written", || {
+            writer.typed().contains("bravo task text")
+        });
+        manager.kill("c3-user-input-clears").unwrap();
+
+        assert!(
+            second_events
+                .lock()
+                .unwrap()
+                .contains(&SubmitGuardEvent::Wrote { write: 1 }),
+            "the second delivery should have typed its task"
+        );
+    }
+
+    /// Review Kimi K3 X2: a guard that panics after typing its task leaves
+    /// the queue on unwind, but its text may still sit in the input line.
+    /// The next guard must escalate instead of typing after it.
+    #[test]
+    fn a_panicking_delivery_does_not_let_the_next_one_type_behind_it() {
+        let manager = PtyManager::default();
+        let (session, writer) = resting_guard_session(&manager, "c3-panic");
+        let second_events = Arc::new(Mutex::new(Vec::new()));
+        let second_sink = Arc::clone(&second_events);
+
+        manager
+            .start_submit_guard(
+                "c3-panic",
+                "alpha task text".into(),
+                Some(GUARD_TEST_MARKER),
+                |event| {
+                    if matches!(event, SubmitGuardEvent::Enter { .. }) {
+                        panic!("first guard aborted on Enter by the test");
+                    }
+                },
+            )
+            .unwrap();
+        manager
+            .start_submit_guard(
+                "c3-panic",
+                "bravo task text".into(),
+                Some(GUARD_TEST_MARKER),
+                move |event| second_sink.lock().unwrap().push(event),
+            )
+            .unwrap();
+
+        let deadline = Instant::now() + Duration::from_secs(10);
+        while second_events.lock().unwrap().is_empty() && Instant::now() < deadline {
+            session.scrollback.lock().unwrap().push(b"alpha task text");
+            std::thread::sleep(Duration::from_millis(200));
+        }
+        assert!(
+            !second_events.lock().unwrap().is_empty(),
+            "timed out waiting for the second guard to report"
+        );
+        let typed = writer.typed();
+        manager.kill("c3-panic").unwrap();
+        assert!(
+            !typed.contains("bravo task text"),
+            "second task typed behind a panicked delivery: {typed:?}"
+        );
+        assert_eq!(
+            *second_events.lock().unwrap(),
+            vec![SubmitGuardEvent::Escalated]
+        );
+    }
+
     #[test]
     fn scrollback_keeps_only_the_tail() {
         let mut sb = Scrollback::new();
         sb.push(&vec![b'a'; SCROLLBACK_CAPACITY]);
         sb.push(b"tail");
         let out = sb.to_lossy_string();
         assert_eq!(out.len(), SCROLLBACK_CAPACITY);
         assert!(out.ends_with("tail"));
     }
 
     /// F-CORE-3 A.1: the guard's snapshot pairs the tail bytes with absolute
     /// stream positions under one lock, so the write baseline
diff --git a/src-tauri/src/submit_guard.rs b/src-tauri/src/submit_guard.rs
index f7f45a9..67b7d10 100644
--- a/src-tauri/src/submit_guard.rs
+++ b/src-tauri/src/submit_guard.rs
@@ -255,41 +255,44 @@ pub struct SubmitGuard {
     /// tail, so the longest line can sit in the hidden region while the
     /// last line is always visible when the write fully landed.
     tail_fragment: String,
     /// Squashed prompt marker that proves the input loop is alive; empty
     /// means "no marker known, use the silence heuristic".
     readiness_marker: String,
     /// Squashed answer marker that *confirms* the delivery (the agent reacted
     /// to the task); empty means the byte-based `Delivered` signal stands.
     answer_marker: String,
     state: StateData,
     /// Set when the answer marker appeared after the write baseline.
     confirmed: bool,
+    /// See [`SubmitGuard::input_pending`].
+    input_pending: bool,
     dialog_answers: u8,
     last_dialog_answer: Option<Instant>,
 }
 
 impl SubmitGuard {
     pub fn new(started_at: Instant, task: &str) -> Self {
         Self {
             started_at,
             fragment: task_fragment(task),
             tail_fragment: task_tail_fragment(task),
             readiness_marker: String::new(),
             answer_marker: String::new(),
             state: StateData::IdleWatching {
                 first_output: None,
                 last_output: None,
             },
             confirmed: false,
+            input_pending: false,
             dialog_answers: 0,
             last_dialog_answer: None,
         }
     }
 
     /// Arm the guard with the agent's prompt marker. Empty or whitespace-only
     /// markers are ignored, so an unconfigured profile behaves exactly as
     /// before (silence heuristic).
     pub fn with_readiness_marker(mut self, marker: &str) -> Self {
         self.readiness_marker = squash(&normalize_tui_output(marker));
         self
     }
@@ -341,27 +344,55 @@ impl SubmitGuard {
     }
 
     /// Terminal state reached (delivered or escalated): no further ticks.
     pub fn is_done(&self) -> bool {
         matches!(self.state, StateData::Delivered | StateData::Escalated(_))
     }
 
     fn escalate(&mut self, reason: EscalationReason) -> Option<SubmitAction> {
         self.state = StateData::Escalated(reason);
         Some(SubmitAction::Escalate)
     }
 
+    /// Whether the task text may still sit unsent in the TUI's input line.
+    ///
+    /// Set once the guard asks for the task to be typed (`WriteTask`), and
+    /// cleared as soon as output answers the Enter - the same byte-based
+    /// proof that makes a profile without answer marker count the task as
+    /// delivered. An escalation after that point (`AnswerMarkerNeverSeen`)
+    /// leaves it `false`; `EchoNeverSeen` and `EnterUnanswered` leave it
+    /// `true`, and the PTY layer then keeps later deliveries off the line.
+    pub fn input_pending(&self) -> bool {
+        self.input_pending
+    }
+
     /// Advance the machine with one observation and return an effect when a
     /// state boundary is crossed.
     pub fn tick(&mut self, obs: &Observation) -> Option<SubmitAction> {
+        let action = self.step(obs);
+        if matches!(action, Some(SubmitAction::WriteTask { .. })) {
+            self.input_pending = true;
+        }
+        let answered = if let StateData::AwaitingWork { bytes_at_enter, .. } = self.state {
+            obs.output_bytes > bytes_at_enter
+        } else {
+            matches!(self.state, StateData::Delivered)
+        };
+        if answered {
+            self.input_pending = false;
+        }
+        action
+    }
+
+    fn step(&mut self, obs: &Observation) -> Option<SubmitAction> {
         if self.is_done() {
             return None;
         }
         // Echo before dialogs: a real blocking dialog swallows input, so a
         // visible echo proves none is in the way - and a task whose own text
         // mentions a marker must not trigger an answer (double Enter). The
         // echo only counts in output *after* the write baseline: a fragment
         // left over in the tail from an earlier text is history, not proof.
         if let StateData::AwaitingEcho { bytes_at_write, .. } = self.state {
             if self.echo_seen(obs, bytes_at_write) {
                 // Not the Enter yet: an Enter on the heels of the paste is
                 // folded into it (Kimi, W1-01). The next arm sends it once
@@ -1776,24 +1807,90 @@ Hooks need review 2 hooks are new or changed. > 1. Review hooks 2. Trust all and
         let working = format!("{echoed} working end");
         assert_eq!(
             guard.tick(&obs(start, 632, bytes, Some(632), &working)),
             Some(SubmitAction::Escalate)
         );
         assert_eq!(guard.state(), SubmitState::Escalated);
         assert_eq!(
             guard.escalation_reason(),
             Some(EscalationReason::AnswerMarkerNeverSeen)
         );
     }
 
+    /// W1-03c (review GPT-5.3-Codex X1): the task counts as left in the
+    /// input line from its write until output answers the Enter. A later
+    /// escalation - here the answer marker's cap - must not report the line
+    /// as dirty, or the next delivery to the session escalates for nothing.
+    #[test]
+    fn input_is_pending_only_until_output_answers_the_enter() {
+        let start = Instant::now();
+        let mut guard = SubmitGuard::new(start, TASK).with_answer_marker("⏺");
+        assert!(!guard.input_pending());
+        assert_eq!(
+            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
+            Some(SubmitAction::WriteTask { write: 1 })
+        );
+        assert!(guard.input_pending(), "typed, not yet echoed");
+        let echoed = format!("prompt > {TASK}");
+        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), &echoed)), None);
+        assert_eq!(
+            guard.tick(&obs(start, 32, 600, Some(31), &echoed)),
+            Some(SubmitAction::SendEnter { attempt: 0 })
+        );
+        assert!(guard.input_pending(), "Enter sent, not yet answered");
+
+        let working = format!("{echoed} working");
+        assert_eq!(guard.tick(&obs(start, 40, 700, Some(40), &working)), None);
+        assert!(!guard.input_pending(), "output answered the Enter");
+
+        assert_eq!(
+            guard.tick(&obs(start, 632, 800, Some(632), &working)),
+            Some(SubmitAction::Escalate)
+        );
+        assert_eq!(
+            guard.escalation_reason(),
+            Some(EscalationReason::AnswerMarkerNeverSeen)
+        );
+        assert!(!guard.input_pending());
+    }
+
+    /// The counterpart: Enter retries that no output answers leave the task
+    /// on the prompt, and the escalation reports it as still pending.
+    #[test]
+    fn unanswered_enter_retries_leave_the_input_pending() {
+        let start = Instant::now();
+        let mut guard = SubmitGuard::new(start, TASK);
+        assert_eq!(
+            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
+            Some(SubmitAction::WriteTask { write: 1 })
+        );
+        let echoed = format!("prompt > {TASK}");
+        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), &echoed)), None);
+        assert_eq!(
+            guard.tick(&obs(start, 32, 600, Some(31), &echoed)),
+            Some(SubmitAction::SendEnter { attempt: 0 })
+        );
+        let mut now = 32;
+        while !guard.is_done() {
+            now += 10;
+            guard.tick(&obs(start, now, 600, Some(31), &echoed));
+            assert!(now < 1000, "the retries never ran out");
+        }
+        assert_eq!(
+            guard.escalation_reason(),
+            Some(EscalationReason::EnterUnanswered)
+        );
+        assert!(guard.input_pending());
+    }
+
     #[test]
     fn an_echo_that_scrolled_out_of_the_guard_window_still_counts() {
         // Grenze/UEberlauf-Regel: kam seit dem Write mehr Output an, als das
         // Guard-Fenster (GUARD_TAIL_BYTES) haelt, koennte das Echo schon
         // herausgerollt sein - es gilt, sonst schreibt der Rewrite-Arm den
         // Task bis zu dreimal in einen arbeitenden Agenten.
         let start = Instant::now();
         let mut guard = SubmitGuard::new(start, TASK);
         assert_eq!(
             guard.tick(&obs(start, 30, 400, Some(1), "boot")),
             Some(SubmitAction::WriteTask { write: 1 })
         );
```
