# Review-Auftrag — W1-03d, Endkandidat (PR #88)

Du bist unabhängiger Code-Reviewer (Autor: Claude Code). Frühere Reviews (GLM 5.3, DeepSeek V4 Pro) sahen `3846262`;
seither kamen Review-Nacharbeit (`SessionEnded`, Queued erst bei lebender Sitzung) und die Codex-/Review-Fixes aus
PR #81 (Basis dieses PRs). Dieser Review gilt dem ENDKANDIDATEN. Der Diff ist der eigene Anteil von #88 gegen den
Endstand von #81 (`pty.rs`, `main.rs`, eine Nahtstelle).

## Kontext
Submit-Guards tippen Aufträge in die TUI eines CLI-Agenten in einer PTY; `DeliveryTurns` (FIFO je Sitzung)
serialisiert sie; eine belegte Eingabezeile (`input_dirty`) lässt spätere Zustellungen eskalieren, bis der Nutzer
die Zeile leert (`write_user_input`, liest die Eingabe per `InputScan`). #88 fügt hinzu:
- Ereignisse `Queued { ahead }` (erst nach der ersten Lebendigkeitsprüfung), `InputBlocked`, `SessionEnded`
  (beide vor `Escalated`), mit Armen in `GuardNarrative::detail` (main.rs, erzeugt Status-Texte);
- das geteilte Cancel-Flag `submit_guard_cancelled` wird nie mehr zurückgesetzt (alle Setzer beenden die Sitzung);
- ein Guard, dessen Sitzung stirbt, meldet `SessionEnded` + `Escalated`, auch im laufenden Zug (vorher still);
- der Tauri-Command `write_pty` (einziger Aufrufer: `TerminalView.onData`, Tastatur/Paste des Nutzers) ruft
  `write_user_input` statt `write`; automatische Pfade (Worker, Diff-Kommentare, Fragen-Sweep) bleiben bei `write`.

## Worauf achten
1. Aufrufer-Verträge der neuen Ereignisse (Outcome-Callbacks werten nur `Delivered`/`Escalated`; genau ein
   terminales Ereignis je Guard?).
2. Endgültiges Cancel-Flag: Dauer-Lockout möglich? Race zwischen Kill und Start?
3. `write_pty`-Verdrahtung: räumt Automatik jetzt fälschlich? Fehlerpfade?
4. Narrative-Texte korrekt und nicht irreführend? Tests deterministisch?

## Antwortformat
Befunde: ID (X1…), Schwere (hoch/mittel/niedrig), Stelle, Szenario, Fix. Dann verworfene Punkte je eine Zeile.
Urteil: mergebereit / nach Überarbeitung / ablehnen. Deutsch, knapp, keine erfundenen Befunde.

## Diff `#81 (ec877d9)..9cad3c0`, pty.rs + main.rs
```diff
diff --git a/src-tauri/src/main.rs b/src-tauri/src/main.rs
index 628c503..75ed079 100644
--- a/src-tauri/src/main.rs
+++ b/src-tauri/src/main.rs
@@ -370,27 +370,34 @@ impl AgentControl for PtyWriter {
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
+    /// W1-03d: the session was killed or ended under the delivery.
+    session_ended: bool,
     wrote: bool,
     entered: bool,
     final_enter_sent: bool,
 }
 
 impl GuardNarrative {
     /// The status-event detail for one guard event; updates the progress the
     /// escalation texts are read from.
     fn detail(&mut self, event: &SubmitGuardEvent) -> String {
         match event {
@@ -416,22 +423,41 @@ impl GuardNarrative {
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
+            SubmitGuardEvent::SessionEnded => {
+                self.session_ended = true;
+                "the session ended before this delivery was done".to_string()
+            }
+            SubmitGuardEvent::InputBlocked => {
+                self.blocked = true;
+                "an earlier task still sits in the input line; this task was not typed".to_string()
+            }
             SubmitGuardEvent::Escalated => {
-                if !self.wrote {
+                if self.session_ended {
+                    "session ended; task not delivered".to_string()
+                } else if self.blocked {
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
@@ -600,21 +626,24 @@ fn spawn_pty(
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
@@ -3852,20 +3881,57 @@ mod tests {
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
+    /// Reviews GLM-5.3 X2 / DeepSeek X1: a delivery whose session was killed
+    /// names the session, not a readiness marker it never waited for.
+    #[test]
+    fn a_delivery_to_an_ended_session_does_not_blame_the_readiness_marker() {
+        let mut narrative = super::GuardNarrative::default();
+        narrative.detail(&super::SubmitGuardEvent::SessionEnded);
+        let text = narrative.detail(&super::SubmitGuardEvent::Escalated);
+        assert!(text.contains("session ended"), "{text}");
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
index accab2b..33d2a7e 100644
--- a/src-tauri/src/pty.rs
+++ b/src-tauri/src/pty.rs
@@ -59,20 +59,30 @@ pub enum SubmitGuardEvent {
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
+    /// W1-03d: the session was killed or ended before this delivery was
+    /// done; nothing more is typed. `Escalated` follows.
+    SessionEnded,
 }
 
 /// A byte ring buffer holding the tail of a session's raw output.
 struct Scrollback {
     buf: VecDeque<u8>,
     /// Monotonic count of every byte ever pushed, including bytes the ring
     /// has already dropped. The submit guard's write baseline is an absolute
     /// position on this counter.
     total_pushed: u64,
 }
@@ -199,20 +209,26 @@ impl Utf8Stream {
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
@@ -266,24 +282,26 @@ impl DeliveryTurns {
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
             pending_epoch: AtomicU64::new(NOT_PENDING),
         }
     }
 
     /// The user emptied or sent the line: clear the dirty flag, and void the
     /// pending text of the delivery still running.
     #[cfg(test)]
     fn clear_input_dirty(&self) {
         Self::clear(&mut self.lock());
     }
@@ -321,20 +339,22 @@ impl DeliveryTurns {
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
     /// The `clear_epoch` in which this guard's task went into the line, or
     /// [`NOT_PENDING`].
     pending_epoch: AtomicU64,
 }
 
 /// [`DeliveryTurn::pending_epoch`] when no text of the guard is in the line.
 const NOT_PENDING: u64 = u64::MAX;
 
 impl DeliveryTurn {
     /// Wait up to `timeout` for this guard to reach the front. Returns
@@ -897,27 +917,29 @@ impl PtyManager {
     }
 
     pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
         let session = self.get(session_id)?;
         write_session(&session, data)
     }
 
     /// Input typed by the user into this session (the terminal view).
     ///
     /// Written like [`PtyManager::write`]; once it has landed, input that
-    /// sends or empties the line - Enter, Ctrl-U, Ctrl-C - clears the
-    /// session's dirty input line, so deliveries may type again. Other keys
+    /// sends or empties the line - Enter (`\r`), Ctrl-U, Ctrl-C, after the
+    /// last text ([`InputScan`]) - clears the session's
+    /// dirty input line, so deliveries may type again. Other keys
     /// (a letter, a cursor key) leave an earlier task in place and do not
     /// (reviews GLM-5.3 X3, DeepSeek X2). Automatic paths such as worker
     /// messages or diff comments use `write` and never clear it. The chunk
-    /// is read by [`InputScan`], across chunk boundaries.
-    #[cfg_attr(not(test), allow(dead_code))] // W1-03d verdrahtet write_pty (main.rs)
+    /// is read by [`InputScan`], across chunk boundaries. Known limit: an
+    /// Enter that a dialog swallows clears the flag although the old text
+    /// stays - what a key does is up to the TUI (W1-03d review).
     pub fn write_user_input(&self, session_id: &str, data: &str) -> Result<(), String> {
         let session = self.get(session_id)?;
         let mut writer = lock_writer(&session)?;
         session.delivery_turns.user_write(&mut writer, data, |pty| {
             write_to(&session, &mut **pty, data.as_bytes())
         })
     }
 
     /// Start the non-blocking task delivery guard, armed with the agent
     /// profile's readiness marker when it knows one.
@@ -935,78 +957,91 @@ impl PtyManager {
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
+            // Killed or gone: the caller still hears that its text was not
+            // delivered, and why (reviews A1, GLM-5.3 X1/X2, DeepSeek X1),
+            // instead of an outcome that never fires.
+            let session_ended = || {
+                on_event(SubmitGuardEvent::SessionEnded);
+                on_event(SubmitGuardEvent::Escalated);
+            };
             // Wait until every earlier delivery to this session has ended.
             // The guard ahead is still typing, or waiting for its echo or
             // its Enter to land; a second guard writing now would put both
             // texts into one input line. `turn` leaves the queue on every
             // return below. Liveness is checked once more after the turn
             // arrives: a kill that let the guard ahead return also hands the
             // turn over, and this guard must still report, not go silent.
             let mut my_turn = false;
+            let mut announced = false;
             loop {
                 let alive = sessions
                     .lock()
                     .ok()
                     .and_then(|map| map.get(&session_id).and_then(SessionEntry::interactive))
                     .is_some_and(|session| !session.submit_guard_cancelled.load(Ordering::Acquire));
                 if !alive {
-                    // Review A1: the caller still hears that its text was
-                    // not delivered, instead of an outcome that never fires.
-                    on_event(SubmitGuardEvent::Escalated);
+                    session_ended();
                     return;
                 }
+                // Review B2: say that this delivery waits, instead of
+                // leaving the caller on the previous guard's last event for
+                // minutes - once the session is known to be alive (review
+                // DeepSeek X2: a dead session queues nothing).
+                if !announced && turn.ahead > 0 {
+                    on_event(SubmitGuardEvent::Queued { ahead: turn.ahead });
+                }
+                announced = true;
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
@@ -1015,23 +1050,25 @@ impl PtyManager {
             // readiness marker, answer marker - search only the output after
             // it, so leftovers from before can never count.
             let mut write_mark: Option<u64> = None;
 
             loop {
                 let Some(session) = sessions
                     .lock()
                     .ok()
                     .and_then(|map| map.get(&session_id).and_then(SessionEntry::interactive))
                 else {
+                    session_ended();
                     return;
                 };
                 if session.submit_guard_cancelled.load(Ordering::Acquire) {
+                    session_ended();
                     return;
                 }
 
                 // Tail and byte counter from ONE lock: reading the ring and
                 // a separate counter in sequence could straddle an 8 KiB
                 // read chunk and disagree about what is "new".
                 let (tail_bytes, tail_start, output_bytes) = session
                     .scrollback
                     .lock()
                     .map(|sb| sb.snapshot(GUARD_TAIL_BYTES))
@@ -2393,20 +2430,31 @@ mod tests {
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
@@ -2427,32 +2475,44 @@ mod tests {
                 "c3-interleave",
                 "bravo task text".into(),
                 Some(GUARD_TEST_MARKER),
                 move |event| queued_sink.lock().unwrap().push(event),
             )
             .unwrap();
 
         wait_until("the first task to be written", || {
             writer.typed().contains("alpha task text")
         });
+        // The queued guard announces itself once it has seen the session
+        // alive; kill only after that, or it rightly reports no `Queued`.
+        wait_until("the second guard to report its place", || {
+            queued_events
+                .lock()
+                .unwrap()
+                .contains(&SubmitGuardEvent::Queued { ahead: 1 })
+        });
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
+                SubmitGuardEvent::SessionEnded,
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
@@ -2527,30 +2587,42 @@ mod tests {
             .start_submit_guard(
                 "c3-kill",
                 "bravo task text".into(),
                 Some(GUARD_TEST_MARKER),
                 move |event| queued_sink.lock().unwrap().push(event),
             )
             .unwrap();
         wait_until("the first task to be written", || {
             writer.typed().contains("alpha task text")
         });
+        // The queued guard announces itself once it has seen the session
+        // alive; kill only after that, or it rightly reports no `Queued`.
+        wait_until("the second guard to report its place", || {
+            queued_events
+                .lock()
+                .unwrap()
+                .contains(&SubmitGuardEvent::Queued { ahead: 1 })
+        });
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
+                SubmitGuardEvent::SessionEnded,
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
@@ -2575,38 +2647,42 @@ mod tests {
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
@@ -2639,51 +2715,59 @@ mod tests {
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
@@ -2732,31 +2816,31 @@ mod tests {
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
@@ -3073,37 +3157,211 @@ mod tests {
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
+        assert_eq!(
+            *events.lock().unwrap(),
+            vec![SubmitGuardEvent::SessionEnded, SubmitGuardEvent::Escalated]
+        );
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
+        let late_events = Arc::new(Mutex::new(Vec::new()));
+        let late_sink = Arc::clone(&late_events);
+        manager
+            .start_submit_guard(
+                "c3-revive",
+                "bravo task text".into(),
+                Some(GUARD_TEST_MARKER),
+                move |event| late_sink.lock().unwrap().push(event),
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
+        // Review DeepSeek X2: a delivery to a dead session is not "queued".
+        assert_eq!(
+            *late_events.lock().unwrap(),
+            vec![SubmitGuardEvent::SessionEnded, SubmitGuardEvent::Escalated]
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
+        wait_until("the queued guards to report their place", || {
+            sinks[1]
+                .lock()
+                .unwrap()
+                .contains(&SubmitGuardEvent::Queued { ahead: 1 })
+                && sinks[2]
+                    .lock()
+                    .unwrap()
+                    .contains(&SubmitGuardEvent::Queued { ahead: 2 })
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
+        );
+    }
+
+    /// Review GLM-5.3 X1: a delivery that already has its turn does not end
+    /// in silence when the session is killed - the caller hears the outcome
+    /// like a waiting guard does (review A1), or the text is lost without a
+    /// trace.
+    #[test]
+    fn a_running_delivery_reports_when_its_session_is_killed() {
+        let manager = PtyManager::default();
+        let (_session, writer) = resting_guard_session(&manager, "c3-kill-running");
+        let events = Arc::new(Mutex::new(Vec::new()));
+        let sink = Arc::clone(&events);
+        manager
+            .start_submit_guard(
+                "c3-kill-running",
+                "alpha task text".into(),
+                Some(GUARD_TEST_MARKER),
+                move |event| sink.lock().unwrap().push(event),
+            )
+            .unwrap();
+        wait_until("the task to be written", || {
+            writer.typed().contains("alpha task text")
+        });
+        manager.kill("c3-kill-running").unwrap();
+        wait_until("the killed guard to report", || reported_outcome(&events));
+        assert_eq!(
+            *events.lock().unwrap(),
+            vec![
+                SubmitGuardEvent::Wrote { write: 1 },
+                SubmitGuardEvent::SessionEnded,
+                SubmitGuardEvent::Escalated
+            ]
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
