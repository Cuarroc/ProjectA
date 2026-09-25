# Review-Auftrag W1-01a: Reste aus der Kimi-Diagnose (ProjectA, Tauri 2, Rust)

Du bist ein unabhaengiger Code-Reviewer. Pruefe den folgenden Diff gegen den Auftrag. Nenne Befunde mit Schwere (hoch/mittel/niedrig), Datei/Zeile und konkretem Fix. Sage ausdruecklich, wenn du etwas NICHT pruefen konntest. Kein Lob, nur Befunde und ein Gesamturteil (freigeben / freigeben mit Auflagen / nicht freigeben).

## Kontext
- `submit_guard.rs` ist eine reine Zustandsmaschine, die einen Auftrag in eine interaktive TUI (Claude Code, Codex, Kimi, OpenCode) tippt: IdleWatching -> WriteTask -> AwaitingEcho -> AwaitingEnter -> AwaitingWork -> Delivered/Escalated. Bekannte Blockierdialoge (Workspace-Trust) werden vorher beantwortet (`AnswerDialog`), hoechstens 3-mal, mit 2 s Cooldown, nur wenn der Marker in den letzten 2048 Zeichen steht.
- `pty.rs::start_submit_guard` treibt die Maschine alle 100 ms mit einem Snapshot: `tail` (normalisierter voller Tail) und `tail_since_write` (Ausgabe seit der Write-Baseline `write_mark`). Die Baseline wurde bisher bei Guard-Start gesetzt und nach jedem Task-Write verschoben.
- Seit W1-01 sucht der Guard Dialoge nach dem Write nur noch in `tail_since_write`; davor im vollen Tail.

## Auftrag (docs/PLAN.md W1-01a)
(a) Geister-Antworten auf einen dismissed Dialog *vor* dem Write: Launch-Pfad-Trace Smoke 8 (17.09.) zeigt `ESC[A\r` bei 2613 ms (echte Trust-Antwort), dann zweimal `ESC[A\r` bei 4642 und 6683 ms in den leeren Kimi-Composer, weil der beantwortete Dialogtext noch im 2048-Zeichen-Fenster stand, waehrend Kimi die Welcome-Box ueber den Cooldown hinaus nachzeichnete. Forderung: Baseline auch bei Dialogantworten verschieben; roter Test "ein beantworteter Dialog wird nicht erneut in den leeren Composer getippt".
(b) Echo-Fenster (fest 8 s) gegen die Paste-Laenge: Kimi rendert 945 Bytes in 0,2-4,7 s, waehrend eines Auto-Updates 10,7 s. Ein stiller Composer, der laenger rendert, bekommt nach 8 s einen Rewrite (Auftrag doppelt in der Zeile). Forderung: Fenster mit der Textlaenge skalieren oder Paste-Rendering messen.

## Umsetzung
(a) `BlockingDialog::dismisses()` = Antwort endet mit `\r` (Trust-Dialoge, Codex-Hooks-Confirm); reine Cursor-Moves (Claude-2.1-Stufe 1, Codex-Hooks-Move) schliessen nichts. pty.rs verschiebt `write_mark` nach jeder schliessenden Antwort. Der Guard merkt sich `dialog_dismissed`; danach ist der Dialog-Heuhaufen in IdleWatching `tail_since_write`, sofern dort etwas Sichtbares steht. Ist seit der Antwort nichts Sichtbares gekommen (Antwort evtl. verloren), bleibt der volle Tail der Heuhaufen und die Antwort wird wie bisher nach dem Cooldown wiederholt.
(b) `echo_window_for(task)` = 15 ms je Byte, geklemmt auf [8 s, 60 s]; ersetzt ECHO_WINDOW an allen drei Stellen (erster Write, Busy-Slide, Rewrite). Auftraege bis 533 Bytes bleiben bei 8 s.

## Belege des Autors (lokal, Windows 11)
- Red first: vier Commits. (a) rot: `submit_guard::tests::an_answered_dialog_is_not_typed_again_into_the_empty_composer` (AnswerDialog statt None) und `pty::tests::a_dismissing_dialog_answer_moves_the_write_baseline` (Recorder zaehlt 3 Antworten statt 1 - exakt das Smoke-8-Muster), Exit 101; danach gruen. (b) rot: `a_long_paste_gets_the_echo_time_kimi_needed_during_an_update` (WriteTask{2} nach 8 s), Exit 101; danach gruen.
- `cargo test --bin projecta -- submit_guard:: pty::tests:: profiles:: workers::` -> 296 passed, 0 failed.

## Fragen, die du besonders pruefen sollst
1. Kann die verengte Dialogsuche (a) einen *echten* Dialog verpassen - z. B. eine Dialogkette, einen Dialog, der nur teilweise neu gezeichnet wird, oder eine Antwort, die zwar etwas Sichtbares, aber nicht den Dialogwechsel zeichnet?
2. Wirkt die verschobene Baseline in IdleWatching auf den Readiness-Marker (OpenCode/Codex/Claude konfigurieren einen) oder auf das Echo nach einer Dialogantwort in AwaitingEcho unguenstig?
3. Ist 15 ms/Byte mit Deckel 60 s angemessen? Folgen fuer einen wirklich verlorenen Write (3 Writes bis zur Eskalation), Zusammenspiel mit ECHO_BUSY_CAP (120 s).
4. Sind die Tests aussagekraeftig (insb. der pty-Test mit echter Zeit, Flakiness)?

## Vollstaendiger Diff (origin/main..HEAD)
```diff
diff --git a/src-tauri/src/pty.rs b/src-tauri/src/pty.rs
index 99e3838..4b4e83e 100644
--- a/src-tauri/src/pty.rs
+++ b/src-tauri/src/pty.rs
@@ -1047,7 +1047,8 @@ impl PtyManager {
                 SubmitGuard::new(Instant::now(), &task).with_readiness_marker(&readiness_marker);
             // The write baseline, an absolute position on the scrollback's
             // `total_pushed` counter: set at guard start, moved past every
-            // task write (including rewrites). All content proofs - echo,
+            // task write (including rewrites) and every dialog answer that
+            // dismisses its dialog (W1-01a). All content proofs - echo,
             // readiness marker, answer marker - search only the output after
             // it, so leftovers from before can never count.
             let mut write_mark: Option<u64> = None;
@@ -1138,6 +1139,14 @@ impl PtyManager {
                             on_event(SubmitGuardEvent::Escalated);
                             return;
                         }
+                        // A dismissed dialog is history: without the move its
+                        // text stays in the guard's window and is answered
+                        // again into the empty composer (smoke 8, W1-01a).
+                        if kind.dismisses() {
+                            if let Ok(sb) = session.scrollback.lock() {
+                                write_mark = Some(sb.position());
+                            }
+                        }
                     }
                     Some(SubmitAction::ConfirmDelivery) => {
                         // Marker-confirmed delivery ends the guard as
@@ -2484,6 +2493,73 @@ mod tests {
         })
     }
 
+    /// W1-01a (a), smoke 8 trace (2026-09-17): after the trust dialog was
+    /// answered, the guard typed `Up, Enter` twice more into Kimi's empty
+    /// composer - the dismissed dialog stayed in the tail while the welcome
+    /// box repainted past the dialog cooldown. The write baseline has to move
+    /// past a dismissing dialog answer, so only output drawn after it can
+    /// show a dialog worth answering.
+    #[test]
+    fn a_dismissing_dialog_answer_moves_the_write_baseline() {
+        const KIMI_TRUST: &str = "\u{1b}[?25lThis folder is not trusted yet.\r\n> Don't trust this folder\r\n  Trust this folder\r\n";
+        const ANSWER: &str = "\u{1b}[A\r";
+        let manager = PtyManager::default();
+        let (session, writer) = resting_guard_session(&manager, "w1-01a-ghost");
+        session
+            .scrollback
+            .lock()
+            .unwrap()
+            .push(KIMI_TRUST.as_bytes());
+        *session.last_output.lock().unwrap() = Some(Instant::now());
+        let events = Arc::new(Mutex::new(Vec::new()));
+        let sink = Arc::clone(&events);
+
+        // No readiness marker: Kimi's profile runs on the silence heuristic.
+        manager
+            .start_submit_guard(
+                "w1-01a-ghost",
+                "alpha task text".into(),
+                None,
+                move |event| sink.lock().unwrap().push(event),
+            )
+            .unwrap();
+        wait_until("the trust dialog to be answered", || {
+            writer.typed().contains(ANSWER)
+        });
+        // Kimi draws its composer and welcome box and keeps repainting past
+        // the dialog cooldown; the dismissed dialog is still in the tail.
+        let redraw_until = Instant::now() + crate::submit_guard::DIALOG_COOLDOWN * 3 / 2;
+        while Instant::now() < redraw_until {
+            session
+                .scrollback
+                .lock()
+                .unwrap()
+                .push("\u{1b}[2K Welcome to Kimi Code! Send /help for help information.\r\n\u{2502} > \u{2502}\r\n".as_bytes());
+            *session.last_output.lock().unwrap() = Some(Instant::now());
+            std::thread::sleep(Duration::from_millis(200));
+        }
+        // Quiet now: the task goes in after READY_IDLE_AFTER.
+        wait_until("the task to be written", || {
+            writer.typed().contains("alpha task text")
+        });
+        let typed = writer.typed();
+        manager.kill("w1-01a-ghost").unwrap();
+        assert_eq!(
+            typed.matches(ANSWER).count(),
+            1,
+            "the dismissed dialog was answered again into the empty composer: {typed:?}"
+        );
+        assert!(
+            events
+                .lock()
+                .unwrap()
+                .iter()
+                .filter(|event| **event == SubmitGuardEvent::DialogAnswered)
+                .count()
+                == 1
+        );
+    }
+
     /// W1-03 / C-3: two deliveries to the same session must not type into
     /// each other. Before the fix every `start_submit_guard` ran its own
     /// thread with nothing ordering them, so the second task was written
diff --git a/src-tauri/src/submit_guard.rs b/src-tauri/src/submit_guard.rs
index 9bfe6bc..1d6aaa8 100644
--- a/src-tauri/src/submit_guard.rs
+++ b/src-tauri/src/submit_guard.rs
@@ -17,6 +17,26 @@ pub const READY_MAX_WAIT: Duration = Duration::from_secs(30);
 /// A quiet TUI must echo the written task within this window; silence means
 /// the write was lost (the TUI was not ready after all) and is repeated.
 pub const ECHO_WINDOW: Duration = Duration::from_secs(8);
+/// A composer renders a paste in time proportional to its length and may
+/// print nothing until it is done: Kimi Code took 0.2-4.7 s for a 945-byte
+/// task, 10.7 s during an auto-update (W1-01a, raw-stream report section
+/// 6) - about 11 ms per byte at worst. The echo window is at least this
+/// much per byte of the task, so a long paste still rendering is not
+/// written a second time; short tasks keep [`ECHO_WINDOW`].
+pub const ECHO_PER_BYTE: Duration = Duration::from_millis(15);
+/// The scaled echo window never exceeds this: a write that was really lost
+/// must still be repeated within a minute, and a busy TUI slides the
+/// deadline anyway (up to [`ECHO_BUSY_CAP`]).
+pub const ECHO_WINDOW_CAP: Duration = Duration::from_secs(60);
+
+/// The echo window for one task: [`ECHO_PER_BYTE`] times its wire length,
+/// no shorter than [`ECHO_WINDOW`] and no longer than [`ECHO_WINDOW_CAP`].
+pub fn echo_window_for(task: &str) -> Duration {
+    let bytes = u32::try_from(task.len()).unwrap_or(u32::MAX);
+    ECHO_PER_BYTE
+        .saturating_mul(bytes)
+        .clamp(ECHO_WINDOW, ECHO_WINDOW_CAP)
+}
 /// A busy TUI slides the echo deadline instead of being typed over, but only
 /// up to this cap after each write - an agent stuck loading (slow MCP
 /// servers) must surface as a failure eventually.
@@ -108,6 +128,15 @@ impl BlockingDialog {
             BlockingDialog::CodexHooksConfirm => "\r",
         }
     }
+
+    /// Whether the answer closes the dialog (it ends with the Enter). A
+    /// cursor move only aims the selector: the dialog stays open, and its
+    /// second stage must still see the whole dialog. After a dismissing
+    /// answer the PTY layer moves the write baseline past it (W1-01a), so
+    /// the dismissed text is history, not a dialog.
+    pub fn dismisses(self) -> bool {
+        self.keystrokes().ends_with('\r')
+    }
 }
 
 /// One polled snapshot of the session's output, built by the PTY layer.
@@ -261,6 +290,9 @@ pub struct SubmitGuard {
     /// Squashed answer marker that *confirms* the delivery (the agent reacted
     /// to the task); empty means the byte-based `Delivered` signal stands.
     answer_marker: String,
+    /// [`echo_window_for`] the task: how long a quiet TUI may take to echo
+    /// a write before it is repeated.
+    echo_window: Duration,
     state: StateData,
     /// Set when the answer marker appeared after the write baseline.
     confirmed: bool,
@@ -268,6 +300,9 @@ pub struct SubmitGuard {
     input_pending: bool,
     dialog_answers: u8,
     last_dialog_answer: Option<Instant>,
+    /// A dialog was answered with its Enter ([`BlockingDialog::dismisses`]);
+    /// see [`SubmitGuard::dialog_action`].
+    dialog_dismissed: bool,
 }
 
 impl SubmitGuard {
@@ -278,6 +313,7 @@ impl SubmitGuard {
             tail_fragment: task_tail_fragment(task),
             readiness_marker: String::new(),
             answer_marker: String::new(),
+            echo_window: echo_window_for(task),
             state: StateData::IdleWatching {
                 first_output: None,
                 last_output: None,
@@ -286,6 +322,7 @@ impl SubmitGuard {
             input_pending: false,
             dialog_answers: 0,
             last_dialog_answer: None,
+            dialog_dismissed: false,
         }
     }
 
@@ -499,7 +536,7 @@ impl SubmitGuard {
                 self.state = StateData::AwaitingEcho {
                     wrote_at: obs.now,
                     writes: 1,
-                    deadline: obs.now + ECHO_WINDOW,
+                    deadline: obs.now + self.echo_window,
                     bytes_at_write: obs.output_bytes,
                     last_bytes: obs.output_bytes,
                 };
@@ -522,7 +559,7 @@ impl SubmitGuard {
                     self.state = StateData::AwaitingEcho {
                         wrote_at,
                         writes,
-                        deadline: (obs.now + ECHO_WINDOW).min(wrote_at + ECHO_BUSY_CAP),
+                        deadline: (obs.now + self.echo_window).min(wrote_at + ECHO_BUSY_CAP),
                         bytes_at_write,
                         last_bytes: obs.output_bytes,
                     };
@@ -541,7 +578,7 @@ impl SubmitGuard {
                 self.state = StateData::AwaitingEcho {
                     wrote_at: obs.now,
                     writes: write,
-                    deadline: obs.now + ECHO_WINDOW,
+                    deadline: obs.now + self.echo_window,
                     bytes_at_write: obs.output_bytes,
                     last_bytes: obs.output_bytes,
                 };
@@ -632,9 +669,20 @@ impl SubmitGuard {
         // the full tail's dialog window for a while, and re-answering it
         // typed `Up, Enter` into the composer 100 ms behind the task text
         // (launch-path trace 2026-09-17, smoke 7). Before the write the full
-        // tail is the right haystack: the dialog is the only thing on screen.
+        // tail is the right haystack: the dialog is the only thing on screen
+        // - until a dialog has been dismissed (W1-01a). The PTY layer moves
+        // the baseline past every dismissing answer, and once the TUI has
+        // drawn something visible after it, only that output can show a
+        // dialog: smoke 8 (2026-09-17) typed `Up, Enter` twice more into
+        // Kimi's empty composer from the dismissed trust dialog. Nothing
+        // visible since the answer means it may have been lost - the dialog
+        // is still the screen, and the full tail re-answers it after the
+        // cooldown, as before.
         let haystack = match self.state {
             StateData::AwaitingEcho { .. } => obs.tail_since_write,
+            _ if self.dialog_dismissed && !squash(obs.tail_since_write).is_empty() => {
+                obs.tail_since_write
+            }
             _ => obs.tail,
         };
         let kind = detect_blocking_dialog(haystack)?;
@@ -649,6 +697,7 @@ impl SubmitGuard {
         }
         self.dialog_answers += 1;
         self.last_dialog_answer = Some(obs.now);
+        self.dialog_dismissed |= kind.dismisses();
         Some(SubmitAction::AnswerDialog(kind))
     }
 
@@ -1438,18 +1487,18 @@ Hooks need review 2 hooks are new or changed. > 1. Review hooks 2. Trust all and
             guard.tick(&obs(start, 2, 300, Some(2), dialog)),
             Some(SubmitAction::AnswerDialog(BlockingDialog::KimiTrust))
         );
-        // Composer rendered below the still-visible dialog text; quiet.
-        let composer = format!("{dialog} Welcome to Kimi Code! > ");
-        assert_eq!(guard.tick(&obs(start, 3, 900, Some(3), &composer)), None);
-        // Before the write the full-tail window still re-answers the ghost
-        // once the cooldown passed (`Up, Enter` into an empty composer is a
-        // no-op; known, not fixed here). The write follows.
+        // Composer rendered below the still-visible dialog text; quiet. The
+        // baseline moved past the dismissing answer (W1-01a), so the slice
+        // since then holds only the composer: no ghost before the write
+        // either (`an_answered_dialog_is_not_typed_again_into_the_empty_composer`).
+        let redraw = "Welcome to Kimi Code! > ";
+        let composer = format!("{dialog} {redraw}");
         assert_eq!(
-            guard.tick(&obs(start, 6, 900, Some(3), &composer)),
-            Some(SubmitAction::AnswerDialog(BlockingDialog::KimiTrust))
+            guard.tick(&obs_since(start, 3, 900, Some(3), &composer, redraw)),
+            None
         );
         assert_eq!(
-            guard.tick(&obs(start, 7, 900, Some(3), &composer)),
+            guard.tick(&obs_since(start, 6, 900, Some(3), &composer, redraw)),
             Some(SubmitAction::WriteTask { write: 1 })
         );
         // Nothing new since the write yet: the old dialog text must not be
@@ -1467,6 +1516,95 @@ Hooks need review 2 hooks are new or changed. > 1. Review hooks 2. Trust all and
         );
     }
 
+    /// W1-01a (a), smoke 8 trace (2026-09-17): the trust dialog was answered
+    /// at 2.6 s, Kimi drew its composer and welcome box - and the guard typed
+    /// `Up, Enter` into the empty composer twice more (4.6 s, 6.7 s), because
+    /// the dismissed dialog still sat in the full tail's dialog window. Once
+    /// a dialog is dismissed (its answer carries the Enter) and the TUI has
+    /// drawn something after the answer, only that output can show a dialog
+    /// worth answering: the PTY layer moves the baseline past every
+    /// dismissing answer, so `tail_since_write` is exactly that output.
+    #[test]
+    fn an_answered_dialog_is_not_typed_again_into_the_empty_composer() {
+        let start = Instant::now();
+        let mut guard = SubmitGuard::new(start, TASK);
+        let dialog = "This folder is not trusted yet. > Don't trust this folder Trust this folder";
+        assert_eq!(
+            guard.tick(&obs(start, 2, 300, Some(2), dialog)),
+            Some(SubmitAction::AnswerDialog(BlockingDialog::KimiTrust))
+        );
+        // Kimi redraws composer and welcome box below the dismissed dialog;
+        // the slice since the answer holds only that redraw.
+        let composer = "Welcome to Kimi Code! Send /help for help information. > ";
+        let full = format!("{dialog} {composer}");
+        assert_eq!(
+            guard.tick(&obs_since(start, 3, 900, Some(3), &full, composer)),
+            None
+        );
+        // Past the cooldown, the welcome box still repainting: no ghost.
+        assert_eq!(
+            guard.tick(&obs_since(start, 5, 1200, Some(5), &full, composer)),
+            None,
+            "a dismissed dialog was answered again into the empty composer"
+        );
+        // Quiet for READY_IDLE_AFTER: the task goes in, with no second answer.
+        assert_eq!(
+            guard.tick(&obs_since(start, 8, 1200, Some(5), &full, composer)),
+            Some(SubmitAction::WriteTask { write: 1 })
+        );
+    }
+
+    /// Sibling: an answer that drew nothing visible may have been lost -
+    /// the dialog is still the whole screen. The full tail stays the
+    /// haystack, and the answer is repeated after the cooldown as before.
+    #[test]
+    fn a_dialog_answer_without_a_visible_redraw_is_repeated_after_the_cooldown() {
+        let start = Instant::now();
+        let mut guard = SubmitGuard::new(start, TASK);
+        let dialog = "This folder is not trusted yet. > Don't trust this folder Trust this folder";
+        assert_eq!(
+            guard.tick(&obs(start, 2, 300, Some(2), dialog)),
+            Some(SubmitAction::AnswerDialog(BlockingDialog::KimiTrust))
+        );
+        // Only escape sequences since the answer (a cursor toggle).
+        assert_eq!(
+            guard.tick(&obs_since(start, 3, 310, Some(3), dialog, "")),
+            None
+        );
+        assert_eq!(
+            guard.tick(&obs_since(start, 4, 310, Some(3), dialog, "")),
+            Some(SubmitAction::AnswerDialog(BlockingDialog::KimiTrust))
+        );
+    }
+
+    /// Sibling: a cursor move leaves the dialog open and does not narrow the
+    /// haystack (the Claude 2.1 stage 2 still sees the whole dialog), and a
+    /// codex chain - trust dismissed, hooks review drawn after it - is found
+    /// in the output since the dismissal.
+    #[test]
+    fn only_an_answer_with_its_enter_dismisses_the_dialog() {
+        assert!(BlockingDialog::ClaudeTrust.dismisses());
+        assert!(BlockingDialog::KimiTrust.dismisses());
+        assert!(BlockingDialog::CodexTrust.dismisses());
+        assert!(BlockingDialog::CodexHooksConfirm.dismisses());
+        assert!(!BlockingDialog::ClaudeTrustMove.dismisses());
+        assert!(!BlockingDialog::CodexHooksMove.dismisses());
+
+        let start = Instant::now();
+        let mut guard = SubmitGuard::new(start, TASK);
+        let trust = "Do you trust the contents of this directory? > 1. Yes, continue";
+        assert_eq!(
+            guard.tick(&obs(start, 2, 300, Some(2), trust)),
+            Some(SubmitAction::AnswerDialog(BlockingDialog::CodexTrust))
+        );
+        let hooks = "Hooks need review > 1. Review hooks 2. Trust all and continue 3. Continue without trusting";
+        let full = format!("{trust} {hooks}");
+        assert_eq!(
+            guard.tick(&obs_since(start, 5, 600, Some(5), &full, hooks)),
+            Some(SubmitAction::AnswerDialog(BlockingDialog::CodexHooksMove))
+        );
+    }
+
     /// Review-Auflage (kimi-k3, 2026-09-17, Befund 1): the settle window
     /// between echo and Enter must not type dialog keystrokes either. A
     /// dialog marker still sitting in the tail during `AwaitingEnter` gets
@@ -2108,6 +2246,69 @@ Hooks need review 2 hooks are new or changed. > 1. Review hooks 2. Trust all and
         assert_eq!(guard.state(), SubmitState::AwaitingWork(0));
     }
 
+    /// W1-01a (b), Kimi raw-stream report section 6: the 945-byte wire task
+    /// took 0.2-4.7 s to render in the composer, 10.7 s during a Kimi
+    /// auto-update. A composer that renders a paste without printing
+    /// anything in between is quiet, not deaf - a rewrite at the fixed 8 s
+    /// would paste the task a second time into a line that already holds it.
+    /// The echo window grows with the length of the paste.
+    #[test]
+    fn a_long_paste_gets_the_echo_time_kimi_needed_during_an_update() {
+        let start = Instant::now();
+        let mut guard = SubmitGuard::new(start, KIMI_WIRE_TASK);
+        assert_eq!(
+            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
+            Some(SubmitAction::WriteTask { write: 1 })
+        );
+        // Quiet since the write, no echo yet: 10.7 s is the measured worst
+        // case for this very text.
+        for now in [31, 38, 39, 41] {
+            assert_eq!(
+                guard.tick(&obs_since(start, now, 400, Some(1), "boot", "")),
+                None,
+                "the 945-byte paste was rewritten {} s after the write",
+                now - 30
+            );
+        }
+        let echoed = format!("> {KIMI_WIRE_TASK}");
+        assert_eq!(
+            guard.tick(&obs_since(start, 42, 1400, Some(42), &echoed, &echoed)),
+            None
+        );
+        assert_eq!(guard.state(), SubmitState::AwaitingEnter);
+    }
+
+    /// Siblings of (b): short tasks keep the 8 s window bit-exact, the
+    /// window grows with the paste and stops at the cap, and a long write
+    /// that was really lost is still repeated once its window ran out.
+    #[test]
+    fn the_echo_window_scales_with_the_paste_and_stays_bounded() {
+        assert_eq!(echo_window_for(""), ECHO_WINDOW);
+        assert_eq!(echo_window_for(TASK), ECHO_WINDOW);
+        assert_eq!(KIMI_WIRE_TASK.len(), 945, "the measured wire text");
+        assert_eq!(
+            echo_window_for(KIMI_WIRE_TASK),
+            Duration::from_millis(945 * 15)
+        );
+        assert_eq!(echo_window_for(&"x".repeat(100_000)), ECHO_WINDOW_CAP);
+
+        let start = Instant::now();
+        let mut guard = SubmitGuard::new(start, KIMI_WIRE_TASK);
+        assert_eq!(
+            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
+            Some(SubmitAction::WriteTask { write: 1 })
+        );
+        assert_eq!(
+            guard.tick(&obs_since(start, 44, 400, Some(1), "boot", "")),
+            None
+        );
+        assert_eq!(
+            guard.tick(&obs_since(start, 45, 400, Some(1), "boot", "")),
+            Some(SubmitAction::WriteTask { write: 2 }),
+            "a lost write is repeated once the scaled window ran out"
+        );
+    }
+
     /// Sibling: a TUI that keeps repainting after the echo (spinner, clock)
     /// never gets quiet - the Enter still goes, ENTER_SETTLE_CAP after the
     /// echo at the latest, instead of waiting forever.
```
