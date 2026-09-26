# Review-Auftrag — W1-03c, Endkandidat (PR #81)

Du bist unabhängiger Code-Reviewer (Autor: Claude Code, Kern von opencode/kimi-k2.7-code). Frühere Reviews sahen
ältere Stände; seither kamen funktionale Änderungen. Dieser Review gilt dem ENDKANDIDATEN. Der Diff ist der
vollständige PR-Diff gegen die Merge-Base (nur `pty.rs`, `submit_guard.rs`).

## Kontext
Submit-Guards (ein Thread je Zustellung) tippen Aufträge in die TUI eines CLI-Agenten in einer PTY. `DeliveryTurns`
(FIFO je Sitzung) serialisiert sie. Kann der Text eines Guards nach seinem Ende noch in der Eingabezeile stehen
(`SubmitGuard::input_pending`: gesetzt beim Task-Write, geräumt nur bei `Delivered`), markiert der Drop seines
`DeliveryTurn` die Sitzung `input_dirty` – aber nur, wenn sein Task nach der letzten Nutzer-Leerung in die Zeile kam
(`clear_epoch`/`pending_epoch`). Spätere Zustellungen eskalieren ohne zu schreiben, bis eine Nutzereingabe die Zeile
leert (`write_user_input` → `InputScan` über Chunk-Grenzen: letztes Enter/Ctrl-U/Ctrl-C nach dem letzten Text;
Bracketed-Paste-Inhalt ist Text; CSI/SS3/Backspace kein Text). Guard-Task-Write (`type_task`) und Nutzer-Write
(`user_write`) halten beide den PTY-Writer-Lock über Write und Buchhaltung; der turns-Lock wird nur kurz darin
genommen (Reihenfolge writer → turns). Die Verdrahtung des Tauri-Commands `write_pty` auf `write_user_input` folgt
im nächsten PR (main.rs ist Nahtstelle).

## Worauf achten
1. Nebenläufigkeit: Lock-Reihenfolge writer→turns überall? Nimmt irgendein Pfad turns und dann writer? Deadlock,
   verlorene Wakeups, falsche/fehlende Dirty-Markierung zwischen Guard, Nutzer, Drop, Panic.
2. `InputScan`: Fehlklassifikation, Panics (Slicing an Zeichengrenzen), Carry-Zustand.
3. Semantik und Tests (deterministisch? belegen sie ihre Behauptung?).

## Antwortformat
Befunde: ID (X1…), Schwere (hoch/mittel/niedrig), Stelle, konkretes Fehlerszenario, Fix-Vorschlag. Dann geprüfte und
verworfene Punkte je eine Zeile. Urteil: mergebereit / nach Überarbeitung / ablehnen. Deutsch, knapp, keine
erfundenen Befunde.

## PR-Diff `c23e050..65dd927`
```diff
diff --git a/src-tauri/src/pty.rs b/src-tauri/src/pty.rs
index 5afc041..847d127 100644
--- a/src-tauri/src/pty.rs
+++ b/src-tauri/src/pty.rs
@@ -226,96 +226,185 @@ struct Session {
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
+/// input pending, and stays set until the user sends or empties the line
+/// ([`PtyManager::write_user_input`]). Every later delivery escalates
+/// without writing until then.
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
+    /// Counts the user's clears of the line. A turn marks the line dirty on
+    /// drop only if its task went in after the latest clear (Codex review,
+    /// PR #81): a line the user emptied mid-delivery stays clean.
+    clear_epoch: u64,
+    /// Reads the user's input across chunks (a paste or escape sequence can
+    /// be split between two `write_pty` calls).
+    input_scan: InputScan,
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
+            pending_epoch: AtomicU64::new(NOT_PENDING),
         }
     }
 
-    /// A guard escalated with its task possibly still in the input line:
-    /// every guard queued so far must not type after it.
-    fn mark_input_dirty(&self) {
-        let issued = self.next_id.load(Ordering::Relaxed);
-        self.dirty_below.fetch_max(issued, Ordering::AcqRel);
+    /// The user emptied or sent the line: clear the dirty flag, and void the
+    /// pending text of the delivery still running.
+    #[cfg(test)]
+    fn clear_input_dirty(&self) {
+        Self::clear(&mut self.lock());
+    }
+
+    fn clear(state: &mut TurnState) {
+        state.input_dirty = false;
+        state.clear_epoch += 1;
+    }
+
+    /// The user's input `data`: written (`write`) and, if it leaves the
+    /// line empty, recorded as a clear. The caller holds the PTY writer
+    /// lock across this call, as a guard does across
+    /// [`DeliveryTurn::type_task`]: the writer lock orders the two, and the
+    /// turn lock is only taken briefly, never across a PTY write that may
+    /// block (review round two, GLM-5.3 X3 / DeepSeek X1).
+    fn user_write(
+        &self,
+        data: &str,
+        write: impl FnOnce() -> Result<(), String>,
+    ) -> Result<(), String> {
+        write()?;
+        let mut state = self.lock();
+        if state.input_scan.feed(data) {
+            Self::clear(&mut state);
+        }
+        Ok(())
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
+    /// The `clear_epoch` in which this guard's task went into the line, or
+    /// [`NOT_PENDING`].
+    pending_epoch: AtomicU64,
 }
 
+/// [`DeliveryTurn::pending_epoch`] when no text of the guard is in the line.
+const NOT_PENDING: u64 = u64::MAX;
+
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
+    /// Record whether this guard's task may sit in the line. `typed_now`
+    /// re-arms it in the current epoch: a (re)write after a user's clear
+    /// puts text into the line again.
+    fn note_input(&self, pending: bool, typed_now: bool) {
+        if !pending {
+            self.pending_epoch.store(NOT_PENDING, Ordering::Relaxed);
+        } else if typed_now || self.pending_epoch.load(Ordering::Relaxed) == NOT_PENDING {
+            let epoch = self.turns.lock().clear_epoch;
+            self.pending_epoch.store(epoch, Ordering::Relaxed);
+        }
+    }
+
+    /// Type this guard's task into the line (`write` does the PTY write)
+    /// and record it as pending in the current clear epoch. The caller
+    /// holds the PTY writer lock across this call, as the user's input does
+    /// across [`DeliveryTurns::user_write`], so the two never interleave:
+    /// whichever lands later decides the line - a clear right after the
+    /// task voids it, a task right after a clear is pending (Codex review,
+    /// PR #81). Recorded before the write, so a panic inside it still counts
+    /// the task as typed; nothing is recorded after it, so a clear that
+    /// follows wins.
+    fn type_task<R>(&self, write: impl FnOnce() -> R) -> R {
+        let epoch = self.turns.lock().clear_epoch;
+        self.pending_epoch.store(epoch, Ordering::Relaxed);
+        write()
+    }
+
+    #[cfg(test)]
+    fn set_input_pending(&self, pending: bool) {
+        self.note_input(pending, pending);
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
+        if self.pending_epoch.load(Ordering::Relaxed) == state.clear_epoch {
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
@@ -797,20 +886,38 @@ impl PtyManager {
         });
 
         Ok(session_id)
     }
 
     pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
         let session = self.get(session_id)?;
         write_session(&session, data)
     }
 
+    /// Input typed by the user into this session (the terminal view).
+    ///
+    /// Written like [`PtyManager::write`]; once it has landed, input that
+    /// sends or empties the line - Enter, Ctrl-U, Ctrl-C - clears the
+    /// session's dirty input line, so deliveries may type again. Other keys
+    /// (a letter, a cursor key) leave an earlier task in place and do not
+    /// (reviews GLM-5.3 X3, DeepSeek X2). Automatic paths such as worker
+    /// messages or diff comments use `write` and never clear it. The chunk
+    /// is read by [`InputScan`], across chunk boundaries.
+    #[cfg_attr(not(test), allow(dead_code))] // W1-03d verdrahtet write_pty (main.rs)
+    pub fn write_user_input(&self, session_id: &str, data: &str) -> Result<(), String> {
+        let session = self.get(session_id)?;
+        let mut writer = lock_writer(&session)?;
+        session
+            .delivery_turns
+            .user_write(data, || write_to(&session, &mut **writer, data.as_bytes()))
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
@@ -822,21 +929,23 @@ impl PtyManager {
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
+    /// every later delivery escalates without writing until the user sends
+    /// or empties the line ([`PtyManager::write_user_input`]).
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
@@ -872,48 +981,39 @@ impl PtyManager {
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
@@ -942,62 +1042,74 @@ impl PtyManager {
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
+                let typing = matches!(action, Some(SubmitAction::WriteTask { .. }));
+                // A task write is recorded by `type_task`, right before its
+                // bytes go out: a guard that dies before that has typed
+                // nothing (review round two, DeepSeek X2).
+                if !typing {
+                    turn.note_input(guard.input_pending(), false);
+                }
+
+                match action {
                     Some(SubmitAction::WriteTask { write }) => {
                         on_event(SubmitGuardEvent::Wrote { write });
-                        // Set before the write: a failed write may still
-                        // have put part of the text on the line.
-                        typed_task = true;
-                        if write_session(&session, &task).is_err() {
-                            escalate(typed_task);
+                        let typed = lock_writer(&session).and_then(|mut writer| {
+                            turn.type_task(|| write_to(&session, &mut **writer, task.as_bytes()))
+                        });
+                        if typed.is_err() {
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
@@ -1208,32 +1320,139 @@ fn abort_failed_spawn(child: &mut (dyn Child + Send + Sync)) -> bool {
     if let Err(err) = child.kill() {
         eprintln!("projecta: failed to kill a half-started pty child: {err}");
     }
     if let Err(err) = child.wait() {
         eprintln!("projecta: failed to reap a half-started pty child: {err}");
         return false;
     }
     true
 }
 
+const PASTE_START: &str = "\u{1b}[200~";
+const PASTE_END: &str = "\u{1b}[201~";
+
+/// Reads the user's input chunk by chunk and tells whether the input line
+/// is empty after a chunk: the last Enter, Ctrl-U or Ctrl-C in it comes
+/// after the last text. xterm sends a multi-line paste as one chunk
+/// (`first\rsecond`), and a bracketed paste (`ESC[200~ ... ESC[201~`) is text
+/// as a whole, returns included (Codex review, PR #81). A paste or escape
+/// sequence split between two chunks is carried over (review round two,
+/// GLM-5.3 X2). Other escape sequences and Backspace/Delete add no text;
+/// Alt-Enter (`ESC\r`) does not count as Enter - the conservative side.
+#[derive(Default)]
+struct InputScan {
+    in_paste: bool,
+    /// An escape sequence or paste end marker cut off at the end of the
+    /// last chunk.
+    partial: String,
+}
+
+impl InputScan {
+    /// Longer than any sequence this scanner reads; a longer carry is noise.
+    const MAX_PARTIAL: usize = 16;
+
+    fn feed(&mut self, data: &str) -> bool {
+        let joined = std::mem::take(&mut self.partial) + data;
+        let mut rest = joined.as_str();
+        let mut empty = false;
+        while !rest.is_empty() {
+            if self.in_paste {
+                match rest.find(PASTE_END) {
+                    Some(end) => {
+                        if end > 0 {
+                            empty = false;
+                        }
+                        self.in_paste = false;
+                        rest = &rest[end + PASTE_END.len()..];
+                    }
+                    None => {
+                        // Keep a cut-off end marker for the next chunk.
+                        let keep = (1..PASTE_END.len())
+                            .rev()
+                            .find(|&n| rest.ends_with(&PASTE_END[..n]))
+                            .unwrap_or(0);
+                        if rest.len() > keep {
+                            empty = false;
+                        }
+                        self.partial = rest[rest.len() - keep..].to_string();
+                        rest = "";
+                    }
+                }
+                continue;
+            }
+            if let Some(after) = rest.strip_prefix(PASTE_START) {
+                self.in_paste = true;
+                rest = after;
+                continue;
+            }
+            let Some(c) = rest.chars().next() else { break };
+            if c == '\u{1b}' {
+                match escape_len(rest) {
+                    Some(len) => rest = &rest[len..],
+                    None => {
+                        if rest.len() <= Self::MAX_PARTIAL {
+                            self.partial = rest.to_string();
+                        }
+                        rest = "";
+                    }
+                }
+                continue;
+            }
+            match c {
+                '\r' | '\n' | '\u{15}' | '\u{3}' => empty = true,
+                '\u{7f}' | '\u{8}' => {}
+                c if c.is_control() => {}
+                _ => empty = false,
+            }
+            rest = &rest[c.len_utf8()..];
+        }
+        empty
+    }
+}
+
+/// The length of the escape sequence at the start of `rest` (which starts
+/// with ESC), or `None` when the chunk ends inside it: CSI up to its final
+/// byte, SS3 (`ESC O A`, a cursor key in application mode) with its one
+/// character, any other ESC with the character after it.
+fn escape_len(rest: &str) -> Option<usize> {
+    let seq = &rest[1..];
+    let body = if let Some(csi) = seq.strip_prefix('[') {
+        1 + csi.find(|ch: char| ('\u{40}'..='\u{7e}').contains(&ch))? + 1
+    } else if let Some(ss3) = seq.strip_prefix('O') {
+        1 + ss3.chars().next()?.len_utf8()
+    } else {
+        seq.chars().next()?.len_utf8()
+    };
+    Some(1 + body)
+}
+
 fn write_session(session: &Session, data: &str) -> Result<(), String> {
     write_session_bytes(session, data.as_bytes())
 }
 
 fn write_session_bytes(session: &Session, data: &[u8]) -> Result<(), String> {
+    let mut writer = lock_writer(session)?;
+    write_to(session, &mut **writer, data)
+}
+
+fn lock_writer(session: &Session) -> Result<MutexGuard<'_, Box<dyn Write + Send>>, String> {
+    session
+        .writer
+        .lock()
+        .map_err(|_| "pty writer is poisoned".to_string())
+}
+
+/// Write `data` through a writer the caller has locked.
+fn write_to(session: &Session, writer: &mut (dyn Write + Send), data: &[u8]) -> Result<(), String> {
     if let Some(trace) = &session.trace {
         trace.note("in", data);
     }
-    let mut writer = session
-        .writer
-        .lock()
-        .map_err(|_| "pty writer is poisoned".to_string())?;
     writer
         .write_all(data)
         .map_err(|e| format!("failed to write to pty: {e}"))?;
     writer
         .flush()
         .map_err(|e| format!("failed to flush pty: {e}"))
 }
 
 /// Cut the post-baseline slice out of one scrollback snapshot: the output
 /// since the write mark `mark`, given the tail bytes and the absolute position
@@ -2161,54 +2380,63 @@ mod tests {
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
@@ -2330,39 +2558,517 @@ mod tests {
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
+    /// Reviews GLM-5.3 X3 / DeepSeek X2: only input that empties or sends the
+    /// line clears the dirty state. A cursor key or a typed letter leaves
+    /// the earlier task in place, and the next delivery would type behind it.
+    #[test]
+    fn only_line_clearing_user_input_clears_the_dirty_line() {
+        let manager = PtyManager::default();
+        let (session, _writer) = resting_guard_session(&manager, "c3-user-keys");
+        let turn = session.delivery_turns.join();
+        turn.set_input_pending(true);
+        drop(turn);
+        assert!(session.delivery_turns.input_dirty());
+
+        for keys in ["\u{1b}[D", "a", "\u{7f}"] {
+            manager.write_user_input("c3-user-keys", keys).unwrap();
+            assert!(
+                session.delivery_turns.input_dirty(),
+                "{keys:?} does not empty the line"
+            );
+        }
+        for keys in ["\r", "\u{15}", "\u{3}"] {
+            let turn = session.delivery_turns.join();
+            turn.set_input_pending(true);
+            drop(turn);
+            manager.write_user_input("c3-user-keys", keys).unwrap();
+            assert!(
+                !session.delivery_turns.input_dirty(),
+                "{keys:?} sends or empties the line"
+            );
+        }
+    }
+
+    /// Codex review (PR #81, P2): the user may empty a visibly stuck line
+    /// while its delivery is still running. When that guard later gives up,
+    /// its drop must not mark the line dirty again - the user already
+    /// cleared it, and every later delivery would escalate for nothing.
+    #[test]
+    fn a_line_the_user_cleared_mid_delivery_stays_clean() {
+        let manager = PtyManager::default();
+        let (session, writer) = resting_guard_session(&manager, "c3-clear-mid");
+        let events = Arc::new(Mutex::new(Vec::new()));
+        let sink = Arc::clone(&events);
+        manager
+            .start_submit_guard(
+                "c3-clear-mid",
+                "alpha task text".into(),
+                Some(GUARD_TEST_MARKER),
+                move |event| sink.lock().unwrap().push(event),
+            )
+            .unwrap();
+        wait_until("the task to be written", || {
+            writer.typed().contains("alpha task text")
+        });
+        manager.write_user_input("c3-clear-mid", "\u{15}").unwrap();
+        writer.refuse_enter();
+        let deadline = Instant::now() + Duration::from_secs(10);
+        while !(events
+            .lock()
+            .unwrap()
+            .contains(&SubmitGuardEvent::Escalated)
+            && session.delivery_turns.is_empty())
+            && Instant::now() < deadline
+        {
+            session.scrollback.lock().unwrap().push(b"alpha task text");
+            std::thread::sleep(Duration::from_millis(200));
+        }
+        assert!(session.delivery_turns.is_empty(), "the guard never ended");
+        manager.kill("c3-clear-mid").unwrap();
+        assert!(
+            !session.delivery_turns.input_dirty(),
+            "the guard's drop undid the user's clear"
+        );
+    }
+
+    /// Codex review (PR #81, second round, P2): a user's clear that lands
+    /// right after the guard's task write must win - the text is gone. The
+    /// write and its bookkeeping must be one step towards the clear, or the
+    /// guard records the clear's new epoch and its drop marks the emptied
+    /// line dirty again.
+    #[test]
+    fn a_clear_right_after_the_task_write_wins() {
+        let turns = Arc::new(DeliveryTurns::default());
+        let turn = turns.join();
+        std::thread::scope(|scope| {
+            turn.type_task(|| {
+                // The task bytes have landed; the user clears at once.
+                let turns = Arc::clone(&turns);
+                scope.spawn(move || turns.clear_input_dirty());
+                std::thread::sleep(Duration::from_millis(100));
+            });
+        });
+        drop(turn);
+        assert!(
+            !turns.input_dirty(),
+            "the guard's bookkeeping overtook the user's clear"
+        );
+    }
+
+    /// Review GLM-5.3 (second round) X2: a bracketed paste may reach
+    /// `write_pty` in two chunks. The return inside its second half is
+    /// still paste content, not an Enter, and must not clear the line.
+    #[test]
+    fn a_paste_split_across_chunks_does_not_clear_the_line() {
+        let manager = PtyManager::default();
+        let (session, _writer) = resting_guard_session(&manager, "c3-split-paste");
+        let turn = session.delivery_turns.join();
+        turn.set_input_pending(true);
+        drop(turn);
+        manager
+            .write_user_input("c3-split-paste", "\u{1b}[200~first")
+            .unwrap();
+        manager
+            .write_user_input("c3-split-paste", "second\r\u{1b}[201~")
+            .unwrap();
+        assert!(
+            session.delivery_turns.input_dirty(),
+            "the return inside the paste cleared the line"
+        );
+        manager.write_user_input("c3-split-paste", "\r").unwrap();
+        assert!(!session.delivery_turns.input_dirty(), "a real Enter clears");
+    }
+
+    /// Review DeepSeek-V4-Pro (second round) X2: a guard that dies before
+    /// its task reaches the PTY has typed nothing - the line stays clean.
+    #[test]
+    fn a_guard_that_dies_before_typing_leaves_the_line_clean() {
+        let manager = PtyManager::default();
+        let (session, writer) = resting_guard_session(&manager, "c3-die-early");
+        manager
+            .start_submit_guard(
+                "c3-die-early",
+                "alpha task text".into(),
+                Some(GUARD_TEST_MARKER),
+                |event| {
+                    if matches!(event, SubmitGuardEvent::Wrote { .. }) {
+                        panic!("the guard dies before typing, by the test");
+                    }
+                },
+            )
+            .unwrap();
+        wait_until("the guard to leave the queue", || {
+            session.delivery_turns.is_empty()
+        });
+        manager.kill("c3-die-early").unwrap();
+        assert!(!writer.typed().contains("alpha task text"));
+        assert!(
+            !session.delivery_turns.input_dirty(),
+            "nothing was typed, yet the line counts as dirty"
+        );
+    }
+
+    /// Codex review (PR #81, P2): what counts is the line after the whole
+    /// chunk. A multi-line paste arrives as one chunk (`first\rsecond`), and
+    /// a bracketed paste carries its returns as content - both leave text
+    /// in the line and must not clear it.
+    #[test]
+    fn a_paste_that_leaves_text_in_the_line_does_not_clear_it() {
+        let manager = PtyManager::default();
+        let (session, _writer) = resting_guard_session(&manager, "c3-paste");
+        let dirty = || {
+            let turn = session.delivery_turns.join();
+            turn.set_input_pending(true);
+            drop(turn);
+            assert!(session.delivery_turns.input_dirty());
+        };
+        dirty();
+        for keys in [
+            "first\rsecond",
+            "\u{1b}[200~one\rtwo\u{1b}[201~",
+            "\u{15}more text",
+        ] {
+            manager.write_user_input("c3-paste", keys).unwrap();
+            assert!(
+                session.delivery_turns.input_dirty(),
+                "{keys:?} leaves text in the line"
+            );
+        }
+        for keys in [
+            "typed\r",
+            "\u{1b}[200~pasted\u{1b}[201~\r",
+            "junk\u{15}",
+            "\u{15}\u{1b}OA\u{1b}[D",
+        ] {
+            dirty();
+            manager.write_user_input("c3-paste", keys).unwrap();
+            assert!(
+                !session.delivery_turns.input_dirty(),
+                "{keys:?} ends with an empty line"
+            );
+        }
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
 
diff --git a/src-tauri/src/submit_guard.rs b/src-tauri/src/submit_guard.rs
index f7f45a9..9bfe6bc 100644
--- a/src-tauri/src/submit_guard.rs
+++ b/src-tauri/src/submit_guard.rs
@@ -257,37 +257,40 @@ pub struct SubmitGuard {
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
@@ -343,23 +346,52 @@ impl SubmitGuard {
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
+    /// cleared only by proof that the agent took it: without an answer
+    /// marker, output after the Enter (the byte-based delivery proof); with
+    /// one, the marker itself - there a byte bump is just a sign of life,
+    /// and a TUI that folded the Enter and redrew its status line looks the
+    /// same (Codex review, PR #81). Every escalation with the task typed
+    /// (`EchoNeverSeen`, `EnterUnanswered`, `AnswerMarkerNeverSeen`) leaves
+    /// it `true`, and the PTY layer then keeps later deliveries off the
+    /// line.
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
+        // `Delivered` is the proof in both modes: byte-based without an
+        // answer marker (the step checks the output before any retry cap,
+        // review GLM-5.3 X2), marker-confirmed with one.
+        if matches!(self.state, StateData::Delivered) {
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
@@ -1778,20 +1810,148 @@ Hooks need review 2 hooks are new or changed. > 1. Review hooks 2. Trust all and
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
+    /// input line from its write until output answers the Enter - without
+    /// an answer marker that output is the delivery proof itself.
+    #[test]
+    fn input_is_pending_only_until_output_answers_the_enter() {
+        let start = Instant::now();
+        let mut guard = SubmitGuard::new(start, TASK);
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
+        assert!(guard.is_delivered());
+        assert!(!guard.input_pending(), "output answered the Enter");
+    }
+
+    /// Review GLM-5.3 X2, read for the profile without answer marker: the
+    /// first output after the Enter can land in the tick in which the last
+    /// Enter retry would escalate. The output wins - the line is empty and
+    /// must not be reported as pending.
+    #[test]
+    fn output_in_the_tick_of_the_cap_still_answers_the_enter() {
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
+        let working = format!("{echoed} working");
+        assert_eq!(
+            guard.tick(&obs(start, 1000, 700, Some(1000), &working)),
+            None,
+            "output after the Enter is delivery, not an escalation"
+        );
+        assert!(guard.is_delivered());
+        assert!(!guard.input_pending(), "output answered the Enter");
+    }
+
+    /// Codex review (PR #81, P2): with an answer marker configured, output
+    /// after the Enter is only a sign of life - a TUI that folded the Enter
+    /// and merely redrew its status line looks the same. The task counts as
+    /// left in the line until the marker proves the agent took it, and an
+    /// escalation at the cap keeps the line dirty.
+    #[test]
+    fn with_an_answer_marker_input_stays_pending_until_the_marker() {
+        let start = Instant::now();
+        let mut guard = SubmitGuard::new(start, TASK).with_answer_marker("⏺");
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
+        let redraw = format!("{echoed} status");
+        assert_eq!(guard.tick(&obs(start, 40, 700, Some(40), &redraw)), None);
+        assert!(guard.input_pending(), "a redraw proves nothing");
+        assert_eq!(
+            guard.tick(&obs(start, 632, 800, Some(632), &redraw)),
+            Some(SubmitAction::Escalate)
+        );
+        assert_eq!(
+            guard.escalation_reason(),
+            Some(EscalationReason::AnswerMarkerNeverSeen)
+        );
+        assert!(guard.input_pending(), "the cap leaves the line dirty");
+
+        let mut confirmed = SubmitGuard::new(start, TASK).with_answer_marker("⏺");
+        confirmed.tick(&obs(start, 30, 400, Some(1), "boot"));
+        confirmed.tick(&obs(start, 31, 600, Some(31), &echoed));
+        confirmed.tick(&obs(start, 32, 600, Some(31), &echoed));
+        let answer = format!("{echoed} ⏺ on it");
+        assert_eq!(
+            confirmed.tick(&obs(start, 40, 700, Some(40), &answer)),
+            Some(SubmitAction::ConfirmDelivery)
+        );
+        assert!(!confirmed.input_pending(), "the marker proves the take");
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
```
