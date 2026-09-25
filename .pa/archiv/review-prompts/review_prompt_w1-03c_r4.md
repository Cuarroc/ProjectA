# Review-Auftrag — W1-03c, Delta nach Review-Runde 3 (PR #81)

Du bist unabhängiger Code-Reviewer (Autor: Claude Code). Den vollständigen PR hast du bzw. ein anderer Reviewer auf
`65dd927` geprüft (Urteile: mergebereit / nach Überarbeitung wegen Tab). Hier nur das DELTA danach:
- `InputScan::feed`: nur `\r` gilt als Enter; `\n` und Tab zählen als Text.
- `DeliveryTurn::type_task` und `DeliveryTurns::user_write` verlangen den gesperrten PTY-Writer
  (`&mut MutexGuard<PtyWriter>`) als Parameter; die Schreib-Closure bekommt ihn durchgereicht.
- Doc-Kommentar zur Unwind-Annahme am Drop.
Prüfe: Korrektheit, Lock-Reihenfolge (writer → turns, turns nie über einen Write), verbleibende Fehlklassifikationen,
Tests. Antwortformat: Befunde (ID, Schwere, Stelle, Szenario, Fix), verworfene Punkte je eine Zeile, Urteil
(mergebereit / nach Überarbeitung / ablehnen). Deutsch, knapp, keine erfundenen Befunde.

```diff
diff --git a/src-tauri/src/pty.rs b/src-tauri/src/pty.rs
index 847d127..accab2b 100644
--- a/src-tauri/src/pty.rs
+++ b/src-tauri/src/pty.rs
@@ -284,36 +284,37 @@ impl DeliveryTurns {
     /// The user emptied or sent the line: clear the dirty flag, and void the
     /// pending text of the delivery still running.
     #[cfg(test)]
     fn clear_input_dirty(&self) {
         Self::clear(&mut self.lock());
     }
 
     fn clear(state: &mut TurnState) {
         state.input_dirty = false;
         state.clear_epoch += 1;
     }
 
-    /// The user's input `data`: written (`write`) and, if it leaves the
-    /// line empty, recorded as a clear. The caller holds the PTY writer
-    /// lock across this call, as a guard does across
-    /// [`DeliveryTurn::type_task`]: the writer lock orders the two, and the
-    /// turn lock is only taken briefly, never across a PTY write that may
-    /// block (review round two, GLM-5.3 X3 / DeepSeek X1).
+    /// The user's input `data`: written (`write`, through the locked PTY
+    /// `writer`) and, if it leaves the line empty, recorded as a clear. The
+    /// writer lock - required by the signature, review round three GLM-5.3
+    /// X2 - orders this against [`DeliveryTurn::type_task`]; the turn lock
+    /// is only taken briefly, never across a PTY write that may block
+    /// (review round two, GLM-5.3 X3 / DeepSeek X1).
     fn user_write(
         &self,
+        writer: &mut MutexGuard<'_, PtyWriter>,
         data: &str,
-        write: impl FnOnce() -> Result<(), String>,
+        write: impl FnOnce(&mut PtyWriter) -> Result<(), String>,
     ) -> Result<(), String> {
-        write()?;
+        write(writer)?;
         let mut state = self.lock();
         if state.input_scan.feed(data) {
             Self::clear(&mut state);
         }
         Ok(())
     }
 
     #[cfg(test)]
     fn is_empty(&self) -> bool {
         self.lock().queue.is_empty()
     }
 
@@ -355,51 +356,58 @@ impl DeliveryTurn {
     /// Record whether this guard's task may sit in the line. `typed_now`
     /// re-arms it in the current epoch: a (re)write after a user's clear
     /// puts text into the line again.
     fn note_input(&self, pending: bool, typed_now: bool) {
         if !pending {
             self.pending_epoch.store(NOT_PENDING, Ordering::Relaxed);
         } else if typed_now || self.pending_epoch.load(Ordering::Relaxed) == NOT_PENDING {
             let epoch = self.turns.lock().clear_epoch;
             self.pending_epoch.store(epoch, Ordering::Relaxed);
         }
     }
 
-    /// Type this guard's task into the line (`write` does the PTY write)
-    /// and record it as pending in the current clear epoch. The caller
-    /// holds the PTY writer lock across this call, as the user's input does
-    /// across [`DeliveryTurns::user_write`], so the two never interleave:
+    /// Type this guard's task into the line (`write` does the PTY write
+    /// through the locked `writer`) and record it as pending in the current
+    /// clear epoch. The writer lock, held across this call as across
+    /// [`DeliveryTurns::user_write`], keeps the two from interleaving:
     /// whichever lands later decides the line - a clear right after the
     /// task voids it, a task right after a clear is pending (Codex review,
     /// PR #81). Recorded before the write, so a panic inside it still counts
     /// the task as typed; nothing is recorded after it, so a clear that
     /// follows wins.
-    fn type_task<R>(&self, write: impl FnOnce() -> R) -> R {
+    fn type_task<R>(
+        &self,
+        writer: &mut MutexGuard<'_, PtyWriter>,
+        write: impl FnOnce(&mut PtyWriter) -> R,
+    ) -> R {
         let epoch = self.turns.lock().clear_epoch;
         self.pending_epoch.store(epoch, Ordering::Relaxed);
-        write()
+        write(writer)
     }
 
     #[cfg(test)]
     fn set_input_pending(&self, pending: bool) {
         self.note_input(pending, pending);
     }
 
     /// Whether a delivery before this one left its task in the session's
     /// input line and no user input has cleared it since.
     fn input_dirty(&self) -> bool {
         self.turns.lock().input_dirty
     }
 }
 
+/// Runs on every way out of the guard thread, a panic included - the
+/// crate builds with the default `panic = "unwind"`; under `abort` the
+/// process ends with the session anyway.
 impl Drop for DeliveryTurn {
     fn drop(&mut self) {
         let mut state = self.turns.lock();
         state.queue.retain(|id| *id != self.id);
         if self.pending_epoch.load(Ordering::Relaxed) == state.clear_epoch {
             state.input_dirty = true;
         }
         self.turns.changed.notify_all();
     }
 }
 
 /// See [`Session::trace`].
@@ -897,27 +905,27 @@ impl PtyManager {
     ///
     /// Written like [`PtyManager::write`]; once it has landed, input that
     /// sends or empties the line - Enter, Ctrl-U, Ctrl-C - clears the
     /// session's dirty input line, so deliveries may type again. Other keys
     /// (a letter, a cursor key) leave an earlier task in place and do not
     /// (reviews GLM-5.3 X3, DeepSeek X2). Automatic paths such as worker
     /// messages or diff comments use `write` and never clear it. The chunk
     /// is read by [`InputScan`], across chunk boundaries.
     #[cfg_attr(not(test), allow(dead_code))] // W1-03d verdrahtet write_pty (main.rs)
     pub fn write_user_input(&self, session_id: &str, data: &str) -> Result<(), String> {
         let session = self.get(session_id)?;
         let mut writer = lock_writer(&session)?;
-        session
-            .delivery_turns
-            .user_write(data, || write_to(&session, &mut **writer, data.as_bytes()))
+        session.delivery_turns.user_write(&mut writer, data, |pty| {
+            write_to(&session, &mut **pty, data.as_bytes())
+        })
     }
 
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
@@ -1056,25 +1064,27 @@ impl PtyManager {
                 let typing = matches!(action, Some(SubmitAction::WriteTask { .. }));
                 // A task write is recorded by `type_task`, right before its
                 // bytes go out: a guard that dies before that has typed
                 // nothing (review round two, DeepSeek X2).
                 if !typing {
                     turn.note_input(guard.input_pending(), false);
                 }
 
                 match action {
                     Some(SubmitAction::WriteTask { write }) => {
                         on_event(SubmitGuardEvent::Wrote { write });
                         let typed = lock_writer(&session).and_then(|mut writer| {
-                            turn.type_task(|| write_to(&session, &mut **writer, task.as_bytes()))
+                            turn.type_task(&mut writer, |pty| {
+                                write_to(&session, &mut **pty, task.as_bytes())
+                            })
                         });
                         if typed.is_err() {
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
@@ -1322,26 +1332,26 @@ fn abort_failed_spawn(child: &mut (dyn Child + Send + Sync)) -> bool {
     }
     if let Err(err) = child.wait() {
         eprintln!("projecta: failed to reap a half-started pty child: {err}");
         return false;
     }
     true
 }
 
 const PASTE_START: &str = "\u{1b}[200~";
 const PASTE_END: &str = "\u{1b}[201~";
 
 /// Reads the user's input chunk by chunk and tells whether the input line
-/// is empty after a chunk: the last Enter, Ctrl-U or Ctrl-C in it comes
-/// after the last text. xterm sends a multi-line paste as one chunk
+/// is empty after a chunk: the last Enter (`\r`), Ctrl-U or Ctrl-C in it
+/// comes after the last text. xterm sends a multi-line paste as one chunk
 /// (`first\rsecond`), and a bracketed paste (`ESC[200~ ... ESC[201~`) is text
 /// as a whole, returns included (Codex review, PR #81). A paste or escape
 /// sequence split between two chunks is carried over (review round two,
 /// GLM-5.3 X2). Other escape sequences and Backspace/Delete add no text;
 /// Alt-Enter (`ESC\r`) does not count as Enter - the conservative side.
 #[derive(Default)]
 struct InputScan {
     in_paste: bool,
     /// An escape sequence or paste end marker cut off at the end of the
     /// last chunk.
     partial: String,
 }
@@ -1389,25 +1399,29 @@ impl InputScan {
                 match escape_len(rest) {
                     Some(len) => rest = &rest[len..],
                     None => {
                         if rest.len() <= Self::MAX_PARTIAL {
                             self.partial = rest.to_string();
                         }
                         rest = "";
                     }
                 }
                 continue;
             }
             match c {
-                '\r' | '\n' | '\u{15}' | '\u{3}' => empty = true,
+                // Enter is `\r`; `\n` (Ctrl-J) is a newline inside a
+                // multi-line composer, and a Tab inserts text or completes
+                // a word - both keep the line (review round three).
+                '\r' | '\u{15}' | '\u{3}' => empty = true,
+                '\n' | '\t' => empty = false,
                 '\u{7f}' | '\u{8}' => {}
                 c if c.is_control() => {}
                 _ => empty = false,
             }
             rest = &rest[c.len_utf8()..];
         }
         empty
     }
 }
 
 /// The length of the escape sequence at the start of `rest` (which starts
 /// with ESC), or `None` when the chunk ends inside it: CSI up to its final
@@ -1425,25 +1439,28 @@ fn escape_len(rest: &str) -> Option<usize> {
     Some(1 + body)
 }
 
 fn write_session(session: &Session, data: &str) -> Result<(), String> {
     write_session_bytes(session, data.as_bytes())
 }
 
 fn write_session_bytes(session: &Session, data: &[u8]) -> Result<(), String> {
     let mut writer = lock_writer(session)?;
     write_to(session, &mut **writer, data)
 }
 
-fn lock_writer(session: &Session) -> Result<MutexGuard<'_, Box<dyn Write + Send>>, String> {
+/// The PTY's input side, locked as one for every write.
+type PtyWriter = Box<dyn Write + Send>;
+
+fn lock_writer(session: &Session) -> Result<MutexGuard<'_, PtyWriter>, String> {
     session
         .writer
         .lock()
         .map_err(|_| "pty writer is poisoned".to_string())
 }
 
 /// Write `data` through a writer the caller has locked.
 fn write_to(session: &Session, writer: &mut (dyn Write + Send), data: &[u8]) -> Result<(), String> {
     if let Some(trace) = &session.trace {
         trace.note("in", data);
     }
     writer
@@ -2892,26 +2909,28 @@ mod tests {
         );
     }
 
     /// Codex review (PR #81, second round, P2): a user's clear that lands
     /// right after the guard's task write must win - the text is gone. The
     /// write and its bookkeeping must be one step towards the clear, or the
     /// guard records the clear's new epoch and its drop marks the emptied
     /// line dirty again.
     #[test]
     fn a_clear_right_after_the_task_write_wins() {
         let turns = Arc::new(DeliveryTurns::default());
         let turn = turns.join();
+        let pty: Mutex<PtyWriter> = Mutex::new(Box::new(Vec::<u8>::new()));
+        let mut writer = pty.lock().unwrap();
         std::thread::scope(|scope| {
-            turn.type_task(|| {
+            turn.type_task(&mut writer, |_| {
                 // The task bytes have landed; the user clears at once.
                 let turns = Arc::clone(&turns);
                 scope.spawn(move || turns.clear_input_dirty());
                 std::thread::sleep(Duration::from_millis(100));
             });
         });
         drop(turn);
         assert!(
             !turns.input_dirty(),
             "the guard's bookkeeping overtook the user's clear"
         );
     }
@@ -2960,24 +2979,43 @@ mod tests {
             .unwrap();
         wait_until("the guard to leave the queue", || {
             session.delivery_turns.is_empty()
         });
         manager.kill("c3-die-early").unwrap();
         assert!(!writer.typed().contains("alpha task text"));
         assert!(
             !session.delivery_turns.input_dirty(),
             "nothing was typed, yet the line counts as dirty"
         );
     }
 
+    /// Review round three: a Tab inserts text or completes a word (DeepSeek
+    /// X1), and Ctrl-J (`\n`) is a newline inside a multi-line composer
+    /// rather than a send (GLM-5.3 X1) - neither leaves the line empty.
+    #[test]
+    fn tab_and_line_feed_do_not_empty_the_line() {
+        let manager = PtyManager::default();
+        let (session, _writer) = resting_guard_session(&manager, "c3-tab-lf");
+        let turn = session.delivery_turns.join();
+        turn.set_input_pending(true);
+        drop(turn);
+        for keys in ["\u{15}\t", "more\n"] {
+            manager.write_user_input("c3-tab-lf", keys).unwrap();
+            assert!(
+                session.delivery_turns.input_dirty(),
+                "{keys:?} leaves text in the line"
+            );
+        }
+    }
+
     /// Codex review (PR #81, P2): what counts is the line after the whole
     /// chunk. A multi-line paste arrives as one chunk (`first\rsecond`), and
     /// a bracketed paste carries its returns as content - both leave text
     /// in the line and must not clear it.
     #[test]
     fn a_paste_that_leaves_text_in_the_line_does_not_clear_it() {
         let manager = PtyManager::default();
         let (session, _writer) = resting_guard_session(&manager, "c3-paste");
         let dirty = || {
             let turn = session.delivery_turns.join();
             turn.set_input_pending(true);
             drop(turn);
```
