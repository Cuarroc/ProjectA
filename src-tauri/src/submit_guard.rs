//! Pure decision logic for delivering a task to an interactive TUI.
//!
//! A CLI can render the pasted task without accepting it, a repaint is not
//! proof of delivery, and a modal dialog (workspace trust) swallows keystrokes
//! until it is answered. The machine therefore works off *content*
//! observations - the task's echo, known blocking dialogs, a monotonic output
//! byte counter - rather than output timestamps alone. The PTY integration
//! drives it with snapshots of the scrollback; keeping the decisions here
//! independent of PTYs makes the timing behaviour deterministic to test.

use std::time::{Duration, Instant};

/// Wait for a TUI's opening output to settle before writing the task.
pub const READY_IDLE_AFTER: Duration = Duration::from_secs(3);
/// Never wait indefinitely for a TUI that emits no opening output.
pub const READY_MAX_WAIT: Duration = Duration::from_secs(30);
/// A quiet TUI must echo the written task within this window; silence means
/// the write was lost (the TUI was not ready after all) and is repeated.
pub const ECHO_WINDOW: Duration = Duration::from_secs(8);
/// A composer renders a paste in time proportional to its length and may
/// print nothing until it is done: Kimi Code took 0.2-4.7 s for a 945-byte
/// task, 10.7 s during an auto-update (W1-01a, raw-stream report section
/// 6) - about 11 ms per byte at worst. The echo window is at least this
/// much per byte of the task, so a long paste still rendering is not
/// written a second time; short tasks keep [`ECHO_WINDOW`].
pub const ECHO_PER_BYTE: Duration = Duration::from_millis(15);
/// The scaled echo window never exceeds this: a write that was really lost
/// must still be repeated within a minute, and a busy TUI slides the
/// deadline anyway (up to [`ECHO_BUSY_CAP`]).
pub const ECHO_WINDOW_CAP: Duration = Duration::from_secs(60);

/// The echo window for one task: [`ECHO_PER_BYTE`] times its wire length,
/// no shorter than [`ECHO_WINDOW`] and no longer than [`ECHO_WINDOW_CAP`].
pub fn echo_window_for(task: &str) -> Duration {
    let bytes = u32::try_from(task.len()).unwrap_or(u32::MAX);
    ECHO_PER_BYTE
        .saturating_mul(bytes)
        .clamp(ECHO_WINDOW, ECHO_WINDOW_CAP)
}
/// A busy TUI slides the echo deadline instead of being typed over, but only
/// up to this cap after each write - an agent stuck loading (slow MCP
/// servers) must surface as a failure eventually.
pub const ECHO_BUSY_CAP: Duration = Duration::from_secs(120);
/// With a configured readiness marker the 30s give-up no longer writes blind:
/// silence at the deadline escalates, and flowing output slides the deadline
/// like `ECHO_BUSY_CAP` - but only up to this cap, so a profile whose UI
/// changed (its marker never comes) surfaces as a failure instead of waiting
/// forever.
pub const MARKER_BUSY_CAP: Duration = Duration::from_secs(120);
/// With a configured answer marker, delivery is confirmed by the marker
/// appearing after the write baseline. If it never does, the wait ends here,
/// measured from the Enter - without a cap the guard thread would never
/// return (it only stops on `is_done()`).
pub const ANSWER_MARKER_CAP: Duration = Duration::from_secs(600);
/// Full task writes before the guard gives up.
pub const MAX_WRITES: u8 = 3;
/// After the echo the Enter waits until the TUI has been quiet this long
/// (W1-01): Kimi Code 0.43 folds an Enter that arrives on the heels of a
/// paste into the paste - the launch-path trace of 2026-09-17 shows the
/// composer growing by one empty line ("↑ 14 more") 29 ms after its
/// redraw, and no submission. A gap of a hundred milliseconds or more
/// submitted in every harness run; one second is the safe side of that.
pub const ENTER_SETTLE: Duration = Duration::from_secs(1);
/// A TUI that keeps repainting after the echo (a spinner, a status clock)
/// still gets its Enter, at the latest this long after the echo.
pub const ENTER_SETTLE_CAP: Duration = Duration::from_secs(5);
/// Silence windows after the task's Enter and each synthetic Enter retry.
pub const RETRY_BACKOFF: [Duration; 3] = [
    Duration::from_secs(15),
    Duration::from_secs(30),
    Duration::from_secs(60),
];
/// The same dialog is never answered twice inside this window - its marker
/// needs a moment to scroll out of the observed tail once dismissed.
pub const DIALOG_COOLDOWN: Duration = Duration::from_secs(2);
/// Bound on dialog answers, so a marker that never clears cannot loop.
pub const MAX_DIALOG_ANSWERS: u8 = 3;
/// A dialog is only real while its marker sits in the last this many
/// characters of the normalized tail (roughly the visible screen). Dismissed
/// dialogs stay in the raw stream far longer, and answering a ghost types
/// stray Enters into the prompt.
const DIALOG_WINDOW_CHARS: usize = 2048;
/// How far back from the end of the normalized tail a readiness marker still
/// counts as on screen for an already-running, quiet session (C-1): roughly a
/// screenful, like the dialog window.
const MARKER_SCREEN_CHARS: usize = 2048;

/// A modal dialog that swallows the task until it is answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockingDialog {
    /// Claude Code's workspace trust prompt, stage 1: since 2.1.266 the
    /// selector rests on "No, exit" (captured 2026-09-16), so a blind Enter
    /// would end the agent. One cursor move down aims at "Yes, I trust this
    /// folder"; the Enter waits for the selector to be seen there.
    ClaudeTrustMove,
    /// Stage 2, only when the tail shows the selector resting on "Yes, I
    /// trust this folder" (older builds preselect it): a plain Enter confirms.
    ClaudeTrust,
    /// kimi's first-run folder trust prompt rests on "Don't trust", so the
    /// cursor must move up to "Trust this folder" before Enter.
    KimiTrust,
    /// Codex CLI's directory trust prompt preselects "1. Yes, continue", so
    /// a plain Enter confirms it (captured 2026-09-14).
    CodexTrust,
    /// Codex CLI's hooks review, stage 1: the menu rests on "1. Review
    /// hooks", so two cursor moves down aim at "3. Continue without
    /// trusting (hooks won't run)". Never a blind Enter: the option above
    /// the target is "Trust all and continue", which would run hooks
    /// outside the sandbox, and the menu order belongs to a self-updating
    /// CLI (0.153.4 -> 0.154.0 arrived unannounced on 2026-09-14).
    CodexHooksMove,
    /// Stage 2, only when the tail actually shows the selector resting on
    /// "3. Continue without trusting": a single Enter confirms. Without
    /// that observed selector no Enter is ever sent - the guard escalates
    /// instead of gambling on a menu order.
    CodexHooksConfirm,
}

impl BlockingDialog {
    /// The keystrokes that accept the dialog, as the PTY layer writes them.
    pub fn keystrokes(self) -> &'static str {
        match self {
            BlockingDialog::ClaudeTrustMove => "\u{1b}[B",
            BlockingDialog::ClaudeTrust => "\r",
            BlockingDialog::KimiTrust => "\u{1b}[A\r",
            BlockingDialog::CodexTrust => "\r",
            BlockingDialog::CodexHooksMove => "\u{1b}[B\u{1b}[B",
            BlockingDialog::CodexHooksConfirm => "\r",
        }
    }

    /// Whether the answer closes the dialog (it ends with the Enter). A
    /// cursor move only aims the selector: the dialog stays open, and its
    /// second stage must still see the whole dialog. After a dismissing
    /// answer before the task is written, the PTY layer moves the write
    /// baseline past it (W1-01a), so the dismissed text is history, not a
    /// dialog.
    pub fn dismisses(self) -> bool {
        self.keystrokes().ends_with('\r')
    }
}

/// One polled snapshot of the session's output, built by the PTY layer.
#[derive(Debug)]
pub struct Observation<'a> {
    pub now: Instant,
    /// Monotonic count of output bytes the session has produced (0 = none).
    /// Comes from the same atomic scrollback snapshot as `tail`, so counter
    /// and content can never disagree about an in-flight read.
    pub output_bytes: u64,
    /// When the last output chunk arrived.
    pub last_output: Option<Instant>,
    /// Normalized (ANSI-stripped, whitespace-collapsed) scrollback tail.
    pub tail: &'a str,
    /// The normalized output produced *since the current write baseline*
    /// (guard start until the first write, the latest `WriteTask` after).
    /// All three content searches - echo, readiness marker, answer marker -
    /// run against this slice, never against the full tail: a fragment or
    /// marker left over from before the baseline is history, not proof.
    pub tail_since_write: &'a str,
    /// More output arrived since the baseline than the captured tail window
    /// holds: the echo may have scrolled out already and counts as seen -
    /// otherwise the rewrite arm would type the whole task up to three times
    /// into a working agent.
    pub write_window_overflowed: bool,
}

/// The explicit lifecycle of one task delivery.
#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubmitState {
    /// Waiting for the initial output burst to become quiet.
    IdleWatching,
    /// The task text was written; waiting for the TUI to echo it.
    AwaitingEcho,
    /// The echo was seen; the Enter waits for the paste to settle.
    AwaitingEnter,
    /// The echo was seen and Enter sent; waiting for the agent to react.
    /// The number is the Enter retries used so far.
    AwaitingWork(u8),
    /// Output followed the Enter - the agent is working on the task.
    Delivered,
    /// The TUI never accepted the task, so a person must intervene.
    Escalated,
}

#[derive(Debug, Clone)]
enum StateData {
    IdleWatching {
        first_output: Option<Instant>,
        last_output: Option<Instant>,
    },
    AwaitingEcho {
        wrote_at: Instant,
        writes: u8,
        deadline: Instant,
        /// Output counter at the latest write: the echo baseline. An echo
        /// without new bytes since this mark is a leftover, not proof.
        bytes_at_write: u64,
        last_bytes: u64,
    },
    /// The echo proved the write landed; the Enter goes once the TUI has
    /// been quiet for [`ENTER_SETTLE`] (or [`ENTER_SETTLE_CAP`] after the
    /// echo at the latest).
    AwaitingEnter {
        echo_at: Instant,
    },
    AwaitingWork {
        /// The first Enter; the answer-marker wait is capped from here.
        entered_at: Instant,
        /// Last Enter or last sign of life; the retry clock runs from here.
        sent_at: Instant,
        attempt: u8,
        bytes_at_enter: u64,
        last_bytes: u64,
    },
    Delivered,
    Escalated(EscalationReason),
}

/// Why the guard escalated. The PTY layer logs it; the user-facing texts per
/// reason are mapped at the event boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EscalationReason {
    /// The task write was never echoed (rewrites exhausted or the echo busy
    /// cap ran out).
    EchoNeverSeen,
    /// A configured readiness marker never appeared after the baseline; the
    /// task was not written.
    ReadinessMarkerNeverSeen,
    /// The task was written and echoed, but the answer marker never confirmed
    /// within `ANSWER_MARKER_CAP` after the Enter that the agent reacted.
    AnswerMarkerNeverSeen,
    /// The Enter retries went unanswered.
    EnterUnanswered,
}

/// An effect requested by the guard. The PTY layer performs it separately.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubmitAction {
    /// Write the task text *without* a trailing Enter: a same-write Enter is
    /// swallowed by some TUIs' input handling. `write` counts the attempts.
    WriteTask { write: u8 },
    /// Press Enter as its own write. `attempt == 0` follows the echo,
    /// 1..=RETRY_BACKOFF.len() are the silence retries.
    SendEnter { attempt: u8 },
    /// A known blocking dialog is on screen; answer it so loading continues.
    AnswerDialog(BlockingDialog),
    /// The answer marker appeared after the write baseline: the delivery is
    /// *confirmed*, not just progressed. Only profiles with a configured
    /// answer marker produce this; for all others the byte-based `Delivered`
    /// signal stands, bit-exact.
    ConfirmDelivery,
    /// The TUI never accepted the task; ask the user to take over.
    Escalate,
}

/// The state machine that decides when to type the task, Enter, or a dialog
/// answer. It never assumes a write worked - only observed effects advance it.
///
/// `readiness_marker` is the agent's prompt text (OpenCode: "Ask anything").
/// NT-17 showed a quiet TUI is not a readiness signal: OpenCode flushes
/// ConPTY input written before its input loop runs, and its splash goes quiet
/// *before* that. With a marker configured, the guard writes as soon as the
/// marker is visible in the output *after the guard's baseline* - or, for a
/// session that was already resting on its prompt when the guard started and
/// never re-prints it (C-1), when the marker sits at the end of the full tail
/// and the session has been quiet for `READY_IDLE_AFTER`. Silence at the
/// deadline escalates instead of writing blind, and flowing output slides
/// the deadline up to `MARKER_BUSY_CAP`. Without a marker the silence
/// heuristic stays exactly as it was.
///
/// `answer_marker` is the agent's reaction text (Claude: "⏺"). With one
/// configured, delivery is *confirmed* via [`SubmitAction::ConfirmDelivery`]
/// only when the marker appears after the write baseline, and the wait is
/// capped by `ANSWER_MARKER_CAP`; without one, the byte-based `Delivered`
/// progress signal is unchanged.
#[derive(Debug, Clone)]
pub struct SubmitGuard {
    started_at: Instant,
    /// Squashed echo fragment of the task; empty disables the echo check.
    fragment: String,
    /// Squashed fragment of the task's *last* line: a composer that
    /// collapses long pastes (kimi: "↑ 17 more") shows only the input's
    /// tail, so the longest line can sit in the hidden region while the
    /// last line is always visible when the write fully landed.
    tail_fragment: String,
    /// Squashed prompt marker that proves the input loop is alive; empty
    /// means "no marker known, use the silence heuristic".
    readiness_marker: String,
    /// Squashed answer marker that *confirms* the delivery (the agent reacted
    /// to the task); empty means the byte-based `Delivered` signal stands.
    answer_marker: String,
    /// [`echo_window_for`] the task: how long a quiet TUI may take to echo
    /// a write before it is repeated.
    echo_window: Duration,
    state: StateData,
    /// Set when the answer marker appeared after the write baseline.
    confirmed: bool,
    /// See [`SubmitGuard::input_pending`].
    input_pending: bool,
    dialog_answers: u8,
    last_dialog_answer: Option<Instant>,
    /// A dialog was answered with its Enter ([`BlockingDialog::dismisses`]);
    /// see [`SubmitGuard::dialog_action`].
    dialog_dismissed: bool,
}

impl SubmitGuard {
    pub fn new(started_at: Instant, task: &str) -> Self {
        Self {
            started_at,
            fragment: task_fragment(task),
            tail_fragment: task_tail_fragment(task),
            readiness_marker: String::new(),
            answer_marker: String::new(),
            echo_window: echo_window_for(task),
            state: StateData::IdleWatching {
                first_output: None,
                last_output: None,
            },
            confirmed: false,
            input_pending: false,
            dialog_answers: 0,
            last_dialog_answer: None,
            dialog_dismissed: false,
        }
    }

    /// Arm the guard with the agent's prompt marker. Empty or whitespace-only
    /// markers are ignored, so an unconfigured profile behaves exactly as
    /// before (silence heuristic).
    pub fn with_readiness_marker(mut self, marker: &str) -> Self {
        self.readiness_marker = squash(&normalize_tui_output(marker));
        self
    }

    /// Arm the guard with the agent's answer marker. Empty or whitespace-only
    /// markers are ignored: a profile without one keeps the byte-based
    /// delivery signal, bit-exact.
    #[cfg_attr(not(test), allow(dead_code))] // Baustein B verdrahtet den Marker aus dem Profil
    pub fn with_answer_marker(mut self, marker: &str) -> Self {
        self.answer_marker = squash(&normalize_tui_output(marker));
        self
    }

    #[cfg(test)]
    pub fn state(&self) -> SubmitState {
        match self.state {
            StateData::IdleWatching { .. } => SubmitState::IdleWatching,
            StateData::AwaitingEcho { .. } => SubmitState::AwaitingEcho,
            StateData::AwaitingEnter { .. } => SubmitState::AwaitingEnter,
            StateData::AwaitingWork { attempt, .. } => SubmitState::AwaitingWork(attempt),
            StateData::Delivered => SubmitState::Delivered,
            StateData::Escalated(_) => SubmitState::Escalated,
        }
    }

    /// The internal progress signal: the TUI echoed the task and output
    /// followed the Enter. On profiles without an answer marker this is the
    /// delivery signal it always was; with a marker it is reached only via
    /// [`SubmitGuard::is_confirmed`]. The PTY layer logs the confirmation and
    /// stops the guard thread on this.
    pub fn is_delivered(&self) -> bool {
        matches!(self.state, StateData::Delivered)
    }

    /// Delivery was *confirmed*: the profile's answer marker appeared in the
    /// output after the write baseline. Always false for profiles without a
    /// configured answer marker - their behavior is unchanged.
    #[cfg_attr(not(test), allow(dead_code))] // Baustein B bindet das confirmed-Event daran
    pub fn is_confirmed(&self) -> bool {
        self.confirmed
    }

    /// Why the guard escalated, once it did.
    pub fn escalation_reason(&self) -> Option<EscalationReason> {
        match self.state {
            StateData::Escalated(reason) => Some(reason),
            _ => None,
        }
    }

    /// Terminal state reached (delivered or escalated): no further ticks.
    pub fn is_done(&self) -> bool {
        matches!(self.state, StateData::Delivered | StateData::Escalated(_))
    }

    fn escalate(&mut self, reason: EscalationReason) -> Option<SubmitAction> {
        self.state = StateData::Escalated(reason);
        Some(SubmitAction::Escalate)
    }

    /// Whether the task text may still sit unsent in the TUI's input line.
    ///
    /// Set once the guard asks for the task to be typed (`WriteTask`), and
    /// cleared only by proof that the agent took it: without an answer
    /// marker, output after the Enter (the byte-based delivery proof); with
    /// one, the marker itself - there a byte bump is just a sign of life,
    /// and a TUI that folded the Enter and redrew its status line looks the
    /// same (Codex review, PR #81). Every escalation with the task typed
    /// (`EchoNeverSeen`, `EnterUnanswered`, `AnswerMarkerNeverSeen`) leaves
    /// it `true`, and the PTY layer then keeps later deliveries off the
    /// line.
    pub fn input_pending(&self) -> bool {
        self.input_pending
    }

    /// Advance the machine with one observation and return an effect when a
    /// state boundary is crossed.
    pub fn tick(&mut self, obs: &Observation) -> Option<SubmitAction> {
        let action = self.step(obs);
        if matches!(action, Some(SubmitAction::WriteTask { .. })) {
            self.input_pending = true;
        }
        // `Delivered` is the proof in both modes: byte-based without an
        // answer marker (the step checks the output before any retry cap,
        // review GLM-5.3 X2), marker-confirmed with one.
        if matches!(self.state, StateData::Delivered) {
            self.input_pending = false;
        }
        action
    }

    fn step(&mut self, obs: &Observation) -> Option<SubmitAction> {
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
                // the TUI has been quiet for ENTER_SETTLE.
                self.state = StateData::AwaitingEnter { echo_at: obs.now };
            }
        }
        if let StateData::AwaitingEnter { echo_at } = self.state {
            let quiet = obs
                .last_output
                .is_none_or(|last| obs.now.saturating_duration_since(last) >= ENTER_SETTLE);
            let capped = obs.now.saturating_duration_since(echo_at) >= ENTER_SETTLE_CAP;
            if !(quiet || capped) {
                return None;
            }
            self.state = StateData::AwaitingWork {
                entered_at: obs.now,
                sent_at: obs.now,
                attempt: 0,
                bytes_at_enter: obs.output_bytes,
                last_bytes: obs.output_bytes,
            };
            return Some(SubmitAction::SendEnter { attempt: 0 });
        }
        // Dialogs are only answered before delivery: after the Enter, words
        // in the agent's own output that look like a marker must not type
        // keystrokes into a working agent.
        if matches!(
            self.state,
            StateData::IdleWatching { .. } | StateData::AwaitingEcho { .. }
        ) {
            if let Some(dialog) = self.dialog_action(obs) {
                return Some(dialog);
            }
        }
        // Matched by value: every field of StateData is Copy, so no borrow of
        // `self.state` outlives a binding and arms can assign the next state.
        match self.state {
            StateData::IdleWatching {
                first_output,
                last_output,
            } => {
                let first_output = first_output.or(obs.last_output);
                let last_output = obs.last_output.or(last_output);
                self.state = StateData::IdleWatching {
                    first_output,
                    last_output,
                };
                // The marker only counts in output after the guard's
                // baseline: a leftover "Ask anything" from a previous prompt
                // in a reused session is exactly the NT-17 trap through the
                // back door.
                let marker_seen = !self.readiness_marker.is_empty()
                    && squash(obs.tail_since_write).contains(&self.readiness_marker);
                // C-1: a session that was already resting on its prompt when
                // the guard started never re-prints the marker after the
                // baseline - it is already on screen. For that case the
                // readiness proof is the marker visible at the end of the
                // full tail plus a quiet window. A busy agent keeps its
                // output clock fresh, so the leftover-marker trap above stays
                // shut (T4): output younger than READY_IDLE_AFTER means the
                // prompt is occupied.
                let marker_idle_on_screen = !self.readiness_marker.is_empty()
                    && last_output.is_some_and(|last| {
                        obs.now.saturating_duration_since(last) >= READY_IDLE_AFTER
                    })
                    && squash(last_chars(obs.tail, MARKER_SCREEN_CHARS))
                        .contains(&self.readiness_marker);
                if self.readiness_marker.is_empty() {
                    // Without a configured marker the old rule stands:
                    // silence heuristic or the 30s give-up. "Output" means
                    // something visible, though (W1-01): Kimi's opening
                    // bytes are a bare cursor-position query, and a TUI
                    // that has drawn nothing and gone quiet is blocked on
                    // its terminal handshake, not settled at its prompt.
                    let settled = first_output.is_some()
                        && !squash(obs.tail).is_empty()
                        && last_output.is_some_and(|last| {
                            obs.now.saturating_duration_since(last) >= READY_IDLE_AFTER
                        });
                    let gave_up_waiting =
                        obs.now.saturating_duration_since(self.started_at) >= READY_MAX_WAIT;
                    if !(settled || gave_up_waiting) {
                        return None;
                    }
                } else if !marker_seen && !marker_idle_on_screen {
                    // NT-17: with a configured marker only the marker proves
                    // readiness. The 30s give-up no longer writes blind into
                    // that window: silence at the deadline escalates, flowing
                    // output slides the deadline - capped by MARKER_BUSY_CAP,
                    // so a profile whose UI changed cannot deadlock.
                    let busy_cap_reached =
                        obs.now.saturating_duration_since(self.started_at) >= MARKER_BUSY_CAP;
                    let quiet_at_deadline =
                        last_output.is_none_or(|last| {
                            obs.now.saturating_duration_since(last) >= READY_IDLE_AFTER
                        }) && obs.now.saturating_duration_since(self.started_at) >= READY_MAX_WAIT;
                    if busy_cap_reached || quiet_at_deadline {
                        return self.escalate(EscalationReason::ReadinessMarkerNeverSeen);
                    }
                    return None;
                }
                self.state = StateData::AwaitingEcho {
                    wrote_at: obs.now,
                    writes: 1,
                    deadline: obs.now + self.echo_window,
                    bytes_at_write: obs.output_bytes,
                    last_bytes: obs.output_bytes,
                };
                Some(SubmitAction::WriteTask { write: 1 })
            }
            StateData::AwaitingEcho {
                wrote_at,
                writes,
                deadline,
                bytes_at_write,
                last_bytes,
            } => {
                if obs.output_bytes > last_bytes {
                    // The TUI is alive but busy (loading models/MCP servers):
                    // slide the deadline instead of typing into the noise -
                    // bounded, so a stuck agent still surfaces as a failure.
                    if obs.now.saturating_duration_since(wrote_at) >= ECHO_BUSY_CAP {
                        return self.escalate(EscalationReason::EchoNeverSeen);
                    }
                    self.state = StateData::AwaitingEcho {
                        wrote_at,
                        writes,
                        deadline: (obs.now + self.echo_window).min(wrote_at + ECHO_BUSY_CAP),
                        bytes_at_write,
                        last_bytes: obs.output_bytes,
                    };
                    return None;
                }
                if obs.now < deadline {
                    return None;
                }
                if writes >= MAX_WRITES {
                    return self.escalate(EscalationReason::EchoNeverSeen);
                }
                // The TUI is quiet but never echoed the task: the write was
                // lost, so repeat the whole text (not a bare Enter). Each
                // rewrite moves the echo baseline to the new write.
                let write = writes + 1;
                self.state = StateData::AwaitingEcho {
                    wrote_at: obs.now,
                    writes: write,
                    deadline: obs.now + self.echo_window,
                    bytes_at_write: obs.output_bytes,
                    last_bytes: obs.output_bytes,
                };
                Some(SubmitAction::WriteTask { write })
            }
            StateData::AwaitingWork {
                entered_at,
                sent_at,
                attempt,
                bytes_at_enter,
                last_bytes,
            } => {
                if self.answer_marker.is_empty() {
                    // No answer marker configured: the historical byte-based
                    // progress signal stands, bit-exact.
                    if obs.output_bytes > bytes_at_enter {
                        // The TUI consumed the Enter (its redraw is output)
                        // and the agent reacts.
                        self.state = StateData::Delivered;
                        return None;
                    }
                } else {
                    // Retry clock and delivery proof are separate: the marker
                    // after the write baseline confirms, a bare byte bump is
                    // only a sign of life.
                    if squash(obs.tail_since_write).contains(&self.answer_marker) {
                        self.confirmed = true;
                        self.state = StateData::Delivered;
                        return Some(SubmitAction::ConfirmDelivery);
                    }
                    if obs.now.saturating_duration_since(entered_at) >= ANSWER_MARKER_CAP {
                        return self.escalate(EscalationReason::AnswerMarkerNeverSeen);
                    }
                    if obs.output_bytes > last_bytes {
                        // A sign of life slides the retry deadline (like
                        // ECHO_BUSY_CAP does in AwaitingEcho) instead of
                        // typing a retry Enter into a working agent.
                        self.state = StateData::AwaitingWork {
                            entered_at,
                            sent_at: obs.now,
                            attempt,
                            bytes_at_enter,
                            last_bytes: obs.output_bytes,
                        };
                        return None;
                    }
                }
                let wait = RETRY_BACKOFF[usize::from(attempt).min(RETRY_BACKOFF.len() - 1)];
                if obs.now.saturating_duration_since(sent_at) < wait {
                    return None;
                }
                if usize::from(attempt) == RETRY_BACKOFF.len() {
                    let reason = if self.answer_marker.is_empty() {
                        EscalationReason::EnterUnanswered
                    } else {
                        EscalationReason::AnswerMarkerNeverSeen
                    };
                    return self.escalate(reason);
                }
                let next = attempt + 1;
                self.state = StateData::AwaitingWork {
                    entered_at,
                    sent_at: obs.now,
                    attempt: next,
                    bytes_at_enter,
                    last_bytes,
                };
                Some(SubmitAction::SendEnter { attempt: next })
            }
            // Handled above, before the dialog check: the echo proved no
            // dialog is in the way.
            StateData::AwaitingEnter { .. } => None,
            StateData::Delivered | StateData::Escalated(_) => None,
        }
    }

    /// A dialog answer, when a known blocking dialog is on screen.
    ///
    /// Called from the two states that can still be *waiting* on a dialog:
    /// `IdleWatching` (nothing typed yet) and `AwaitingEcho` (task written,
    /// no echo). `AwaitingEnter` returns before this - the echo already
    /// proved no dialog is in the way, and a keystroke inside the settle
    /// window is exactly the W1-01 paste-folding bug - and after the Enter
    /// the agent's own words must never trigger keystrokes.
    fn dialog_action(&mut self, obs: &Observation) -> Option<SubmitAction> {
        // Once the task is written, only a dialog that appeared *after* the
        // write can be in its way. The dismissed trust dialog stays inside
        // the full tail's dialog window for a while, and re-answering it
        // typed `Up, Enter` into the composer 100 ms behind the task text
        // (launch-path trace 2026-09-17, smoke 7). Before the write the full
        // tail is the right haystack: the dialog is the only thing on screen
        // - until a dialog has been dismissed (W1-01a). The PTY layer moves
        // the baseline past every dismissing answer, and once the TUI has
        // drawn something visible after it, only that output can show a
        // dialog: smoke 8 (2026-09-17) typed `Up, Enter` twice more into
        // Kimi's empty composer from the dismissed trust dialog. Nothing
        // visible since the answer means it may have been lost - the dialog
        // is still the screen, and the full tail re-answers it after the
        // cooldown, as before. Known limit (review kimi-k3 2): an answer
        // that was lost while the TUI drew something *else* visible and
        // left the dialog unrepainted is not repeated - ghost and lost
        // answer look the same then (the dialog text sits before the
        // baseline in both). No observed TUI does that; each redraws its
        // open dialog or its prompt after an answer.
        let haystack = match self.state {
            StateData::AwaitingEcho { .. } => obs.tail_since_write,
            _ if self.dialog_dismissed && !squash(obs.tail_since_write).is_empty() => {
                obs.tail_since_write
            }
            _ => obs.tail,
        };
        let kind = detect_blocking_dialog(haystack)?;
        if self.dialog_answers >= MAX_DIALOG_ANSWERS {
            return None;
        }
        if self
            .last_dialog_answer
            .is_some_and(|at| obs.now.saturating_duration_since(at) < DIALOG_COOLDOWN)
        {
            return None;
        }
        self.dialog_answers += 1;
        self.last_dialog_answer = Some(obs.now);
        self.dialog_dismissed |= kind.dismisses();
        Some(SubmitAction::AnswerDialog(kind))
    }

    /// The task counts as echoed when its fragment reappears in the output
    /// *after* the write: new bytes since `bytes_at_write`, and the fragment
    /// inside the post-baseline slice (or the slice already overflowed, so
    /// the echo may have scrolled out). An empty fragment (whitespace-only
    /// task) has no echo to find: without an answer marker the historical
    /// rule stands (check disabled); with one, only the marker counts.
    fn echo_seen(&self, obs: &Observation, bytes_at_write: u64) -> bool {
        if self.fragment.is_empty() {
            return self.answer_marker.is_empty()
                || squash(obs.tail_since_write).contains(&self.answer_marker);
        }
        if obs.output_bytes <= bytes_at_write {
            return false;
        }
        if obs.write_window_overflowed {
            return true;
        }
        let slice = squash(obs.tail_since_write);
        slice.contains(&self.fragment)
            || (!self.tail_fragment.is_empty() && slice.contains(&self.tail_fragment))
    }
}

/// Detect a known blocking dialog in the normalized scrollback tail.
pub fn detect_blocking_dialog(tail: &str) -> Option<BlockingDialog> {
    let window = last_chars(tail, DIALOG_WINDOW_CHARS);
    // Claude's options read "No, exit" / "Yes, I trust this folder"; kimi
    // words its own "Trust this folder" / "Don't trust this folder". The
    // capital T keeps the two markers disjoint; codex words its trust prompt
    // "contents of this directory", disjoint from Claude's "files in this
    // folder".
    const CLAUDE_MARKERS: [&str; 3] = [
        "Do you trust the files in this folder",
        "Yes, I trust this folder",
        // The full question, not the loose phrase: "quick safety check" alone
        // also appears in ordinary agent output.
        "Quick safety check: Is this a project",
    ];
    // The visible dialog is the one whose marker sits *latest* in the
    // window: codex prints a chain (trust, then hooks review) and both texts
    // stay in the scrollback, so a fixed check order would re-answer the
    // already-dismissed dialog and type its keystrokes into the current one.
    let claude = CLAUDE_MARKERS
        .iter()
        .filter_map(|marker| window.rfind(marker))
        .max();
    // Which option the selector rests on decides the Claude stage: Ink draws
    // the selector as "❯" (older builds normalized to ">"), and the selected
    // line is the one that carries it. Without a visible selector on "Yes"
    // no Enter is sent - the same rule as the codex hooks review.
    let claude_yes_selected = ["\u{276f} Yes, I trust", "> Yes, I trust"]
        .iter()
        .filter_map(|marker| window.rfind(marker))
        .max();
    let claude_no_selected = ["\u{276f} No, exit", "> No, exit"]
        .iter()
        .filter_map(|marker| window.rfind(marker))
        .max();
    let claude_confirm = claude.filter(|_| {
        claude_yes_selected.is_some_and(|yes| claude_no_selected.is_none_or(|no| yes > no))
    });
    let claude_move = claude.filter(|_| claude_confirm.is_none());
    let codex_trust = window.rfind("Do you trust the contents of this directory");
    // The hooks review answers in two observed stages: while the selector
    // is not visibly on option 3, only cursor moves are sent; the Enter
    // requires the selector on "3. Continue without trusting" in the tail.
    let codex_hooks_move = window.rfind("Hooks need review");
    let codex_hooks_confirm = window.rfind("> 3. Continue without trusting");
    let kimi = window.rfind("Trust this folder");
    // Codex's billing notice ("Add Credits" / "Continue with Luna Reserve")
    // is deliberately absent: a capped account must surface as an honest
    // escalation, not a silent continue.
    [
        (claude_move, BlockingDialog::ClaudeTrustMove),
        (claude_confirm, BlockingDialog::ClaudeTrust),
        (codex_trust, BlockingDialog::CodexTrust),
        (
            codex_hooks_move.filter(|_| codex_hooks_confirm.is_none()),
            BlockingDialog::CodexHooksMove,
        ),
        (codex_hooks_confirm, BlockingDialog::CodexHooksConfirm),
        (kimi, BlockingDialog::KimiTrust),
    ]
    .into_iter()
    .filter_map(|(position, dialog)| position.map(|p| (p, dialog)))
    // A tie is practically impossible with the disjoint markers above;
    // `max_by_key` would then take the last candidate listed (kimi).
    .max_by_key(|(position, _)| *position)
    .map(|(_, dialog)| dialog)
}

/// The distinctive snippet whose reappearance proves the TUI accepted the
/// task: the longest line (the most distinctive one), normalized and squashed,
/// capped short enough that the match survives the TUI's own decoration.
pub fn task_fragment(task: &str) -> String {
    let longest = task
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .max_by_key(|line| line.chars().count())
        .unwrap_or("");
    let squashed = squash(&normalize_tui_output(longest));
    const FRAGMENT_CHARS: usize = 24;
    if squashed.chars().count() > FRAGMENT_CHARS {
        squashed.chars().take(FRAGMENT_CHARS).collect()
    } else {
        squashed
    }
}

/// The echo fragment from the task's *last* non-empty line: the line the
/// composer cursor rests on after a full paste. Capped like
/// [`task_fragment`]; empty for a whitespace-only tail line.
pub fn task_tail_fragment(task: &str) -> String {
    let last = task
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let squashed = squash(&normalize_tui_output(last));
    const FRAGMENT_CHARS: usize = 24;
    if squashed.chars().count() > FRAGMENT_CHARS {
        squashed.chars().take(FRAGMENT_CHARS).collect()
    } else {
        squashed
    }
}

/// Strip ANSI escape sequences and control bytes and collapse whitespace, so
/// raw TUI output can be searched for the task echo and known dialogs.
pub fn normalize_tui_output(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            match chars.next() {
                // CSI: parameter/intermediate bytes, then a final 0x40-0x7E.
                // Cursor moves (`C` forward, `H`/`f` absolute) are how Ink
                // (Claude Code 2.1.x) separates words and starts lines, so
                // they count as one gap - otherwise "Quick safety check"
                // arrives as "Quicksafetycheck" and no marker ever matches.
                Some('[') => {
                    for c in chars.by_ref() {
                        if ('\u{40}'..='\u{7e}').contains(&c) {
                            if matches!(c, 'C' | 'H' | 'f')
                                && !out.is_empty()
                                && !out.ends_with(' ')
                            {
                                out.push(' ');
                            }
                            break;
                        }
                    }
                }
                // OSC: terminated by BEL or ST (ESC \).
                Some(']') => {
                    let mut prev_esc = false;
                    for c in chars.by_ref() {
                        if c == '\u{7}' || (prev_esc && c == '\\') {
                            break;
                        }
                        prev_esc = c == '\u{1b}';
                    }
                }
                // Two-byte sequence; the second byte is already consumed.
                Some(_) => {}
                None => break,
            }
            continue;
        }
        if c.is_whitespace() {
            if !out.ends_with(' ') {
                out.push(' ');
            }
            continue;
        }
        if c.is_control() {
            continue;
        }
        out.push(c);
    }
    out
}

/// Remove all whitespace: a TUI re-wraps the input box mid-word, and the wrap
/// newline must not break the echo match.
fn squash(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace()).collect()
}

/// The last `n` characters of `s`, cut at a char boundary.
fn last_chars(s: &str, n: usize) -> &str {
    if n == 0 {
        return "";
    }
    let start = s
        .char_indices()
        .rev()
        .nth(n - 1)
        .map(|(i, _)| i)
        .unwrap_or(0);
    &s[start..]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(start: Instant, seconds: u64) -> Instant {
        start + Duration::from_secs(seconds)
    }

    /// Build one observation. `last_secs` marks when the last output chunk
    /// arrived; `bytes` is the monotonic output counter. `tail_since_write`
    /// defaults to the whole tail: in these fixtures everything observed is
    /// "since the baseline" unless a test says otherwise (`obs_since`).
    fn obs<'a>(
        start: Instant,
        now_secs: u64,
        bytes: u64,
        last_secs: Option<u64>,
        tail: &'a str,
    ) -> Observation<'a> {
        obs_since(start, now_secs, bytes, last_secs, tail, tail)
    }

    /// Wie `obs`, aber mit explizitem `tail_since_write`: was vor der
    /// Write-Baseline lag, steht nur in `tail`, nicht in der Baseline-Scheibe.
    fn obs_since<'a>(
        start: Instant,
        now_secs: u64,
        bytes: u64,
        last_secs: Option<u64>,
        tail: &'a str,
        tail_since_write: &'a str,
    ) -> Observation<'a> {
        Observation {
            now: at(start, now_secs),
            output_bytes: bytes,
            last_output: last_secs.map(|s| at(start, s)),
            tail,
            tail_since_write,
            write_window_overflowed: false,
        }
    }

    const TASK: &str = "Baue eine Datei notes.txt mit einer Zeile Inhalt.";
    const CLAUDE_DIALOG: &str = "Accessing workspace: Quick safety check: Is this a project you created or one you trust? No, exit > Yes, I trust this folder Enter to confirm - Esc to cancel";

    #[test]
    fn the_last_startup_output_must_be_quiet_for_three_seconds() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);

        assert_eq!(guard.tick(&obs(start, 1, 100, Some(1), "boot")), None);
        assert_eq!(guard.tick(&obs(start, 3, 200, Some(3), "boot")), None);
        assert_eq!(guard.tick(&obs(start, 5, 200, Some(3), "boot")), None);
        assert_eq!(
            guard.tick(&obs(start, 6, 200, Some(3), "boot")),
            Some(SubmitAction::WriteTask { write: 1 })
        );
        assert_eq!(guard.state(), SubmitState::AwaitingEcho);
    }

    #[test]
    fn a_silent_tui_gets_the_task_after_thirty_seconds() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);

        assert_eq!(guard.tick(&obs(start, 29, 0, None, "")), None);
        assert_eq!(
            guard.tick(&obs(start, 30, 0, None, "")),
            Some(SubmitAction::WriteTask { write: 1 })
        );
    }

    #[test]
    fn a_quiet_tui_showing_its_prompt_marker_is_written_immediately() {
        // NT-17: OpenCode flushes ConPTY input written before its input loop
        // runs. Its TUI renders a static splash and then goes *quiet* - the
        // 3s-silence heuristic reads that as ready and the write is lost.
        // The prompt marker ("Ask anything") is the only honest readiness
        // signal: once it is visible, the input loop is alive. The write must
        // not wait for more silence.
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK).with_readiness_marker("Ask anything");

        let splash = "opencode\nAsk anything... \"Fix a TODO in the codebase\"";
        assert_eq!(
            guard.tick(&obs(start, 1, 100, Some(1), splash)),
            Some(SubmitAction::WriteTask { write: 1 }),
            "the marker is visible; waiting for more silence just loses the write"
        );
        assert_eq!(guard.state(), SubmitState::AwaitingEcho);
    }

    #[test]
    fn a_marker_appearing_late_still_beats_the_silence_heuristic() {
        // Slow machines: the splash renders in bursts, each chunk resetting
        // the quiet timer. The marker must not be held hostage by trailing
        // repaint noise - once the prompt is visible, the input loop is alive.
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK).with_readiness_marker("Ask anything");

        assert_eq!(guard.tick(&obs(start, 4, 100, Some(4), "boot")), None);
        // Only 2s quiet: too early for the silence heuristic, no marker yet.
        assert_eq!(guard.tick(&obs(start, 6, 100, Some(4), "boot")), None);
        // A repaint 1s ago, and now the prompt is visible: write at once.
        assert_eq!(
            guard.tick(&obs(start, 7, 200, Some(6), "boot Ask anything...")),
            Some(SubmitAction::WriteTask { write: 1 })
        );
    }

    #[test]
    fn a_configured_marker_silences_the_silence_heuristic() {
        // NT-17, Review Gemini-1 (angenommen): die Stille-Heuristik waere
        // genau die Falle - OpenCodes Splash ist *still*, bevor der Input-Loop
        // laeuft, und ein Write in dieses Fenster wird geflusht. Bei
        // konfiguriertem Marker darf 3s Stille allein NICHT schreiben.
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK).with_readiness_marker("Ask anything");

        // Output kam, ist seit 3s ruhig - aber kein Marker: kein Write.
        assert_eq!(guard.tick(&obs(start, 0, 100, Some(0), "splash")), None);
        assert_eq!(guard.tick(&obs(start, 4, 100, Some(0), "splash")), None);
        // Erst wenn der Prompt sichtbar ist, schreibt der Guard.
        assert_eq!(
            guard.tick(&obs(start, 5, 100, Some(0), "splash\nAsk anything...")),
            Some(SubmitAction::WriteTask { write: 1 })
        );
    }

    #[test]
    fn an_ansi_colored_prompt_marker_is_still_seen() {
        // Review Gemini-2 (angenommen): obs.tail ist im Produktionspfad
        // (pty.rs) bereits normalize_tui_output durchlaufen; der Test beweist
        // die Annahme, indem er rohe ANSI-Artefakte *vor* dem Squash stehen
        // laesst und das Normalisieren simuliert. Direkter wichtiger: der
        // Marker selbst wurde bei der Registrierung normalisiert - ein Tail
        // mit Farbcodes um den Prompt muss matchen.
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK).with_readiness_marker("Ask anything");

        let tail = crate::submit_guard::normalize_tui_output(
            "opencode \u{1b}[36mAsk anything...\u{1b}[0m",
        );
        assert_eq!(
            guard.tick(&obs(start, 1, 100, Some(0), &tail)),
            Some(SubmitAction::WriteTask { write: 1 }),
            "ANSI um den Prompt herum darf das Matching nicht brechen"
        );
    }

    #[test]
    fn a_repaint_after_submission_without_an_echo_is_not_delivery() {
        // NT-3: a TUI that never accepted the task still repaints (spinner).
        // That repaint must not count as delivery - only the task's echo does.
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        assert_eq!(
            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
            Some(SubmitAction::WriteTask { write: 1 })
        );

        assert_eq!(guard.tick(&obs(start, 31, 500, Some(31), "loading")), None);
        assert_ne!(guard.state(), SubmitState::Delivered);

        // The write went nowhere and the TUI went quiet: the guard rewrites
        // the full task instead of sending an Enter into the void.
        assert_eq!(guard.tick(&obs(start, 38, 500, Some(31), "loading")), None);
        assert_eq!(
            guard.tick(&obs(start, 39, 500, Some(31), "loading")),
            Some(SubmitAction::WriteTask { write: 2 })
        );
    }

    #[test]
    fn the_task_echo_triggers_a_separate_enter() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        let _ = guard.tick(&obs(start, 30, 400, Some(1), "boot"));

        // The TUI re-wraps the input box mid-word; the match must survive it.
        let echoed = "prompt > Baue eine Datei no\ntes.txt mit einer Zeile Inhalt.";
        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), echoed)), None);
        assert_eq!(guard.state(), SubmitState::AwaitingEnter);
        assert_eq!(
            guard.tick(&obs(start, 32, 600, Some(31), echoed)),
            Some(SubmitAction::SendEnter { attempt: 0 })
        );
        assert_eq!(guard.state(), SubmitState::AwaitingWork(0));
    }

    #[test]
    fn output_after_the_enter_marks_the_task_delivered() {
        // F-CORE-3 A.2 (Variante A, Klarstellung): auf Profilen OHNE
        // Antwort-Marker bleibt `Delivered` das byte-basierte interne
        // Fortschrittssignal - keine bestaetigte Zustellung; die bestaetigte
        // Zustellung ist das neue `ConfirmDelivery`/`is_confirmed()`.
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        let _ = guard.tick(&obs(start, 30, 400, Some(1), "boot"));
        let _ = guard.tick(&obs(start, 31, 600, Some(31), TASK));
        let _ = guard.tick(&obs(start, 32, 600, Some(31), TASK));

        assert_eq!(guard.tick(&obs(start, 33, 900, Some(33), TASK)), None);
        assert_eq!(guard.state(), SubmitState::Delivered);
        assert!(guard.is_delivered());
        assert!(guard.is_done());
        assert_eq!(guard.tick(&obs(start, 200, 900, Some(200), TASK)), None);
    }

    #[test]
    fn enter_retries_after_silence_then_escalate() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        let _ = guard.tick(&obs(start, 30, 400, Some(1), "boot"));
        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), TASK)), None);
        assert_eq!(
            guard.tick(&obs(start, 32, 600, Some(31), TASK)),
            Some(SubmitAction::SendEnter { attempt: 0 })
        );

        assert_eq!(
            guard.tick(&obs(start, 47, 600, Some(31), TASK)),
            Some(SubmitAction::SendEnter { attempt: 1 })
        );
        assert_eq!(
            guard.tick(&obs(start, 77, 600, Some(31), TASK)),
            Some(SubmitAction::SendEnter { attempt: 2 })
        );
        assert_eq!(
            guard.tick(&obs(start, 137, 600, Some(31), TASK)),
            Some(SubmitAction::SendEnter { attempt: 3 })
        );
        assert_eq!(
            guard.tick(&obs(start, 197, 600, Some(31), TASK)),
            Some(SubmitAction::Escalate)
        );
        assert!(guard.is_done());
    }

    #[test]
    fn a_quiet_tui_that_never_echoes_gets_three_writes_then_escalates() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);

        assert_eq!(
            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
            Some(SubmitAction::WriteTask { write: 1 })
        );
        assert_eq!(
            guard.tick(&obs(start, 38, 400, Some(1), "boot")),
            Some(SubmitAction::WriteTask { write: 2 })
        );
        assert_eq!(
            guard.tick(&obs(start, 46, 400, Some(1), "boot")),
            Some(SubmitAction::WriteTask { write: 3 })
        );
        assert_eq!(
            guard.tick(&obs(start, 54, 400, Some(1), "boot")),
            Some(SubmitAction::Escalate)
        );
        assert_eq!(guard.state(), SubmitState::Escalated);
    }

    #[test]
    fn a_busy_tui_slides_the_echo_deadline_but_cannot_slide_forever() {
        // B-2: an agent loading MCP servers is busy for a long while. Typing
        // over the noise loses the text, so the deadline slides - but a TUI
        // that never settles surfaces as a failure at the cap.
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        assert_eq!(
            guard.tick(&obs(start, 30, 400, Some(30), "loading")),
            Some(SubmitAction::WriteTask { write: 1 })
        );

        // Steady spinner output: no rewrite, no delivery, no escalation.
        for (s, bytes) in [(31, 500), (60, 900), (120, 2000), (149, 4000)] {
            assert_eq!(
                guard.tick(&obs(start, s, bytes, Some(s), "loading")),
                None,
                "busy TUI at {s}s"
            );
        }
        // Still busy at the 120s cap: give up honestly instead of hammering.
        assert_eq!(
            guard.tick(&obs(start, 150, 5000, Some(150), "loading")),
            Some(SubmitAction::Escalate)
        );
    }

    #[test]
    fn a_busy_tui_that_settles_gets_its_echo_window_back() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        let _ = guard.tick(&obs(start, 30, 400, Some(30), "loading"));

        // Busy past the first echo window, then quiet: the deadline slid, so
        // no premature rewrite; the eventual echo delivers normally.
        assert_eq!(guard.tick(&obs(start, 50, 900, Some(50), "loading")), None);
        assert_eq!(guard.tick(&obs(start, 55, 900, Some(50), "loading")), None);
        assert_eq!(
            guard.tick(&obs(start, 57, 900, Some(50), TASK)),
            Some(SubmitAction::SendEnter { attempt: 0 })
        );
    }

    #[test]
    fn the_codex_trust_dialog_is_confirmed_with_enter() {
        // Real capture 2026-09-14 (codex after self-update, scratch repo):
        // the codex TUI preselects "1. Yes, continue", so a plain Enter
        // confirms - like Claude's trust dialog.
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        let codex_dialog = "You are in C:\\work\nDo you trust the contents of this directory? Working with untrusted contents comes with higher risk of prompt injection. > 1. Yes, continue 2. No, quit Press enter to continue";

        assert_eq!(
            guard.tick(&obs(start, 2, 300, Some(2), codex_dialog)),
            Some(SubmitAction::AnswerDialog(BlockingDialog::CodexTrust))
        );
        assert_eq!(BlockingDialog::CodexTrust.keystrokes(), "\r");
    }

    #[test]
    fn the_codex_hooks_review_moves_the_cursor_but_never_enters_blindly() {
        // Real capture 2026-09-14: after the trust answer codex shows "Hooks
        // need review" with "1. Review hooks" preselected. The safe choice is
        // "3. Continue without trusting (hooks won't run)". The answer is
        // staged: only cursor moves while the selector is not observed on
        // option 3 - the neighbour above the target is "Trust all and
        // continue", and the menu order belongs to a self-updating CLI.
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        let hooks_dialog = "Hooks need review 2 hooks are new or changed. Hooks can run outside the sandbox after you trust them. > 1. Review hooks 2. Trust all and continue 3. Continue without trusting (hooks won't run) Press enter to confirm or esc to go back";

        assert_eq!(
            guard.tick(&obs(start, 2, 300, Some(2), hooks_dialog)),
            Some(SubmitAction::AnswerDialog(BlockingDialog::CodexHooksMove))
        );
        assert_eq!(
            BlockingDialog::CodexHooksMove.keystrokes(),
            "\u{1b}[B\u{1b}[B"
        );
    }

    #[test]
    fn the_hooks_review_enter_requires_the_selector_observed_on_option_three() {
        // Stage 2: once the tail shows the selector resting on "3. Continue
        // without trusting", a single Enter confirms.
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        let selected = "Hooks need review 1. Review hooks 2. Trust all and continue > 3. Continue without trusting (hooks won't run)";

        assert_eq!(
            guard.tick(&obs(start, 2, 300, Some(2), selected)),
            Some(SubmitAction::AnswerDialog(
                BlockingDialog::CodexHooksConfirm
            ))
        );
        assert_eq!(BlockingDialog::CodexHooksConfirm.keystrokes(), "\r");
    }

    #[test]
    fn a_reordered_hooks_menu_without_the_observed_selector_never_gets_enter() {
        // A codex update that reorders the menu must not gamble: with no
        // "> 3. Continue without trusting" in the tail the only allowed
        // keystrokes are cursor moves; the dialog cap then stops the loop
        // and the guard escalates instead of typing Enter into the unknown.
        assert_ne!(
            detect_blocking_dialog("Hooks need review > 1. Review hooks 2. Continue without trusting (hooks won't run) 3. Trust all and continue"),
            Some(BlockingDialog::CodexHooksConfirm)
        );
    }

    #[test]
    fn the_hooks_review_wins_over_an_earlier_trust_dialog_in_the_same_tail() {
        // The codex startup is a *chain*: trust, then hooks review. Both
        // texts stay inside the tail window after the trust answer, so an
        // order-based check would answer the trust dialog again - and that
        // stray Enter would open "Review hooks". The visible dialog is the
        // one whose marker sits *latest* in the tail.
        let combined = "Do you trust the contents of this directory? > 1. Yes, continue 2. No, quit Press enter to continue
Hooks need review 2 hooks are new or changed. > 1. Review hooks 2. Trust all and continue 3. Continue without trusting (hooks won't run)";
        assert_eq!(
            detect_blocking_dialog(combined),
            Some(BlockingDialog::CodexHooksMove)
        );
    }

    #[test]
    fn the_codex_usage_limit_notice_is_not_auto_dismissed() {
        // The "Add Credits / Continue with Luna Reserve" notice sits on a
        // billing decision. The guard must not answer it: a capped account
        // surfaces as an honest escalation, never as a silent continue.
        assert_eq!(
            detect_blocking_dialog(
                "Automatically switched to Luna Reserve medium due to usage limits. > 1. Add Credits 2. Continue with Luna Reserve Press enter to confirm or esc to continue working"
            ),
            None
        );
    }

    #[test]
    fn a_quiet_codex_tui_showing_its_prompt_marker_is_written_immediately() {
        // Real capture 2026-09-14: the codex composer prompt reads
        // "› Ask Codex to do anything"; the composer echoes typed input once
        // the input loop is alive.
        let start = Instant::now();
        let mut guard =
            SubmitGuard::new(start, TASK).with_readiness_marker("Ask Codex to do anything");

        let tui = "codex\n› Ask Codex to do anything\nLuna Reserve medium fast · ~/repo";
        assert_eq!(
            guard.tick(&obs(start, 1, 100, Some(1), tui)),
            Some(SubmitAction::WriteTask { write: 1 })
        );
    }

    #[test]
    fn a_composer_showing_only_the_inputs_tail_still_proves_the_echo() {
        // Kimi smoke 2026-09-14: kimi's composer collapses long inputs
        // ("↑ 17 more"); only the *end* of the pasted text is visible in the
        // PTY stream. The write landed (a manual Enter ran the task), but
        // the longest-line fragment sat in the collapsed region, the echo
        // never matched and the guard escalated after three pointless
        // rewrites. The last line of the input is visible whenever the
        // composer holds the full text, so it is an equally valid echo.
        let task = "Create the file probe-kimi.txt containing exactly the marker PA_KIMI_OK and then verify the content carefully.\n\nENTSCHEIDUNGEN\n- kurze Zeile.\n- Ende.";
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, task);
        assert_eq!(
            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
            Some(SubmitAction::WriteTask { write: 1 })
        );

        // The composer shows only the collapsed indicator and the tail of
        // the input - the longest line ("Create the file...") is hidden.
        let collapsed = "ask anything\n↑ 17 more\n- Ende. ▮";
        assert_eq!(guard.tick(&obs(start, 31, 900, Some(31), collapsed)), None);
        assert_eq!(
            guard.state(),
            SubmitState::AwaitingEnter,
            "the visible input tail is proof the write landed"
        );
        assert_eq!(
            guard.tick(&obs(start, 32, 900, Some(31), collapsed)),
            Some(SubmitAction::SendEnter { attempt: 0 })
        );
    }

    #[test]
    fn a_composer_with_neither_fragment_still_triggers_the_rewrite() {
        // Sibling case: the tail fragment must not weaken the rewrite arm.
        // Neither the longest nor the last line visible = no echo.
        let task = "Create probe.txt with the marker inside.\n\nletzte Zeile des Auftrags";
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, task);
        assert_eq!(
            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
            Some(SubmitAction::WriteTask { write: 1 })
        );
        assert_eq!(
            guard.tick(&obs(start, 39, 400, Some(1), "boot")),
            Some(SubmitAction::WriteTask { write: 2 }),
            "no echo from either end: the write is repeated"
        );
    }

    #[test]
    fn the_claude_workspace_trust_dialog_is_confirmed_with_enter() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);

        assert_eq!(
            guard.tick(&obs(start, 2, 300, Some(2), CLAUDE_DIALOG)),
            Some(SubmitAction::AnswerDialog(BlockingDialog::ClaudeTrust))
        );
        assert_eq!(BlockingDialog::ClaudeTrust.keystrokes(), "\r");
    }

    /// Raw excerpt of the Claude Code 2.1.266 trust dialog as captured on
    /// 2026-09-16 (`testutil::capture_claude_output`): Ink draws word gaps
    /// as cursor moves (`ESC[1C`) and line starts as absolute positioning
    /// (`ESC[row;colH`), and the selector rests on "No, exit".
    const CLAUDE_DIALOG_2_1_RAW: &str = "\u{1b}[1m\u{1b}[3;2HAccessing\u{1b}[1Cworkspace:\u{1b}[m\u{1b}[7;2HQuick\u{1b}[1Csafety\u{1b}[1Ccheck:\u{1b}[1CIs\u{1b}[1Cthis\u{1b}[1Ca\u{1b}[1Cproject\u{1b}[1Cyou\u{1b}[1Ccreated\u{1b}[1Cor\u{1b}[1Cone\u{1b}[1Cyou\u{1b}[1Ctrust?\u{1b}[1C(Like\u{1b}[1Cyour\u{1b}[1Cown\u{1b}[1Ccode,\u{1b}[1Ca\u{1b}[1Cwell-known\u{1b}[1Copen\u{1b}[1Csource\u{1b}[8;2Hproject,\u{1b}[1Cor\u{1b}[1Cwork\u{1b}[1Cfrom\u{1b}[1Cyour\u{1b}[1Cteam).\u{1b}[38;2;153;204;255m\u{1b}[14;2H\u{276f}\u{1b}[1CNo,\u{1b}[1Cexit\u{1b}[m\u{1b}[15;4HYes,\u{1b}[1CI\u{1b}[1Ctrust\u{1b}[1Cthis\u{1b}[1Cfolder\u{1b}[38;2;153;153;153m\u{1b}[17;2HEnter\u{1b}[1Cto\u{1b}[1Cconfirm\u{1b}[1C\u{b7}\u{1b}[1CEsc\u{1b}[1Cto\u{1b}[1Ccancel";

    /// Ink's renderer separates words with cursor moves, not spaces: without
    /// a gap for `ESC[nC` / `ESC[r;cH` the dialog markers ("Quick safety
    /// check: Is this a project") never match the normalized tail.
    #[test]
    fn normalize_turns_cursor_moves_into_word_gaps() {
        let normalized = normalize_tui_output(CLAUDE_DIALOG_2_1_RAW);
        assert!(
            normalized.contains("Quick safety check: Is this a project"),
            "{normalized}"
        );
        assert!(normalized.contains("open source project,"), "{normalized}");
        assert!(
            normalized.contains("Yes, I trust this folder"),
            "{normalized}"
        );
        // A cursor move before any text is not a gap (review finding).
        assert_eq!(normalize_tui_output("\u{1b}[3;2HAccessing"), "Accessing");
    }

    /// The composer line as Claude Code 2.1.266 draws it (raw capture
    /// 2026-09-16): prompt glyph, a no-break space, the dimmed placeholder.
    /// The profile marker `❯ Try "` must arm the write from exactly this
    /// line - squash makes the no-break space irrelevant.
    #[test]
    fn the_claude_composer_placeholder_arms_the_marker() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK).with_readiness_marker("\u{276f} Try \"");
        let raw = "\u{1b}[m\u{276f}\u{a0}\u{1b}[2mTry \"how does <filepath> work?\"\u{1b}[38;2;136;136;136m\u{1b}[22m\r\n";
        let tail = normalize_tui_output(raw);
        assert_eq!(
            guard.tick(&obs(start, 1, 300, Some(1), &tail)),
            Some(SubmitAction::WriteTask { write: 1 })
        );
    }

    /// Claude Code 2.1.266 preselects "No, exit" (captured 2026-09-16); the
    /// old blind Enter would end the agent. Stage 1 moves the selector down
    /// and never presses Enter.
    #[test]
    fn the_claude_2_1_trust_dialog_moves_the_selector_off_no_exit_first() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        let tail = normalize_tui_output(CLAUDE_DIALOG_2_1_RAW);

        assert_eq!(
            guard.tick(&obs(start, 2, 300, Some(2), &tail)),
            Some(SubmitAction::AnswerDialog(BlockingDialog::ClaudeTrustMove))
        );
        assert_eq!(BlockingDialog::ClaudeTrustMove.keystrokes(), "\u{1b}[B");
        assert!(!BlockingDialog::ClaudeTrustMove.keystrokes().contains('\r'));
    }

    /// Stage 2: only a tail that shows the selector resting on "Yes, I trust
    /// this folder" gets the Enter.
    #[test]
    fn the_claude_2_1_trust_dialog_is_confirmed_once_the_selector_rests_on_yes() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        let moved = "Accessing workspace: Quick safety check: Is this a project you created or one you trust? No, exit \u{276f} Yes, I trust this folder Enter to confirm \u{b7} Esc to cancel";

        assert_eq!(
            guard.tick(&obs(start, 2, 300, Some(2), moved)),
            Some(SubmitAction::AnswerDialog(BlockingDialog::ClaudeTrust))
        );
        assert_eq!(BlockingDialog::ClaudeTrust.keystrokes(), "\r");
    }

    #[test]
    fn the_kimi_trust_dialog_moves_the_cursor_off_dont_trust_first() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        let kimi_dialog =
            "This folder is not trusted yet. > Don't trust this folder Trust this folder";

        assert_eq!(
            guard.tick(&obs(start, 2, 300, Some(2), kimi_dialog)),
            Some(SubmitAction::AnswerDialog(BlockingDialog::KimiTrust))
        );
        assert_eq!(BlockingDialog::KimiTrust.keystrokes(), "\u{1b}[A\r");
    }

    /// Smoke 7 trace (2026-09-17): the trust dialog was answered at 1.8 s,
    /// Kimi rendered the composer, the task went in at 5.7 s - and 100 ms
    /// later the guard typed `Up, Enter` into the composer once more,
    /// because the dismissed dialog's text still sat inside the full tail's
    /// dialog window. After the write only output since the write may show
    /// a dialog worth answering.
    #[test]
    fn a_dismissed_dialog_is_not_answered_again_behind_the_written_task() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        let dialog = "This folder is not trusted yet. > Don't trust this folder Trust this folder";
        assert_eq!(
            guard.tick(&obs(start, 2, 300, Some(2), dialog)),
            Some(SubmitAction::AnswerDialog(BlockingDialog::KimiTrust))
        );
        // Composer rendered below the still-visible dialog text; quiet. The
        // baseline moved past the dismissing answer (W1-01a), so the slice
        // since then holds only the composer: no ghost before the write
        // either (`an_answered_dialog_is_not_typed_again_into_the_empty_composer`).
        let redraw = "Welcome to Kimi Code! > ";
        let composer = format!("{dialog} {redraw}");
        assert_eq!(
            guard.tick(&obs_since(start, 3, 900, Some(3), &composer, redraw)),
            None
        );
        assert_eq!(
            guard.tick(&obs_since(start, 6, 900, Some(3), &composer, redraw)),
            Some(SubmitAction::WriteTask { write: 1 })
        );
        // Nothing new since the write yet: the old dialog text must not be
        // answered into the composer.
        assert_eq!(
            guard.tick(&obs_since(start, 8, 900, Some(3), &composer, "")),
            None
        );
        assert_eq!(guard.state(), SubmitState::AwaitingEcho);
        // A dialog that really appears after the write is still answered.
        let late = "Do you trust the contents of this directory? > Yes";
        assert_eq!(
            guard.tick(&obs_since(start, 9, 950, Some(9), &composer, late)),
            Some(SubmitAction::AnswerDialog(BlockingDialog::CodexTrust))
        );
    }

    /// W1-01a (a), smoke 8 trace (2026-09-17): the trust dialog was answered
    /// at 2.6 s, Kimi drew its composer and welcome box - and the guard typed
    /// `Up, Enter` into the empty composer twice more (4.6 s, 6.7 s), because
    /// the dismissed dialog still sat in the full tail's dialog window. Once
    /// a dialog is dismissed (its answer carries the Enter) and the TUI has
    /// drawn something after the answer, only that output can show a dialog
    /// worth answering: the PTY layer moves the baseline past every
    /// dismissing answer, so `tail_since_write` is exactly that output.
    #[test]
    fn an_answered_dialog_is_not_typed_again_into_the_empty_composer() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        let dialog = "This folder is not trusted yet. > Don't trust this folder Trust this folder";
        assert_eq!(
            guard.tick(&obs(start, 2, 300, Some(2), dialog)),
            Some(SubmitAction::AnswerDialog(BlockingDialog::KimiTrust))
        );
        // Kimi redraws composer and welcome box below the dismissed dialog;
        // the slice since the answer holds only that redraw.
        let composer = "Welcome to Kimi Code! Send /help for help information. > ";
        let full = format!("{dialog} {composer}");
        assert_eq!(
            guard.tick(&obs_since(start, 3, 900, Some(3), &full, composer)),
            None
        );
        // Past the cooldown, the welcome box still repainting: no ghost.
        assert_eq!(
            guard.tick(&obs_since(start, 5, 1200, Some(5), &full, composer)),
            None,
            "a dismissed dialog was answered again into the empty composer"
        );
        // Quiet for READY_IDLE_AFTER: the task goes in, with no second answer.
        assert_eq!(
            guard.tick(&obs_since(start, 8, 1200, Some(5), &full, composer)),
            Some(SubmitAction::WriteTask { write: 1 })
        );
    }

    /// Sibling: an answer that drew nothing visible may have been lost -
    /// the dialog is still the whole screen. The full tail stays the
    /// haystack, and the answer is repeated after the cooldown as before.
    #[test]
    fn a_dialog_answer_without_a_visible_redraw_is_repeated_after_the_cooldown() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        let dialog = "This folder is not trusted yet. > Don't trust this folder Trust this folder";
        assert_eq!(
            guard.tick(&obs(start, 2, 300, Some(2), dialog)),
            Some(SubmitAction::AnswerDialog(BlockingDialog::KimiTrust))
        );
        // Only escape sequences since the answer (a cursor toggle): they
        // normalize to nothing visible (review glm-5.2 3).
        assert!(squash(&normalize_tui_output("\u{1b}[?25h\u{1b}[?25l\r\n")).is_empty());
        assert_eq!(
            guard.tick(&obs_since(start, 3, 310, Some(3), dialog, "")),
            None
        );
        assert_eq!(
            guard.tick(&obs_since(start, 4, 310, Some(3), dialog, "")),
            Some(SubmitAction::AnswerDialog(BlockingDialog::KimiTrust))
        );
    }

    /// Sibling: a cursor move leaves the dialog open and does not narrow the
    /// haystack (the Claude 2.1 stage 2 still sees the whole dialog), and a
    /// codex chain - trust dismissed, hooks review drawn after it - is found
    /// in the output since the dismissal.
    #[test]
    fn only_an_answer_with_its_enter_dismisses_the_dialog() {
        assert!(BlockingDialog::ClaudeTrust.dismisses());
        assert!(BlockingDialog::KimiTrust.dismisses());
        assert!(BlockingDialog::CodexTrust.dismisses());
        assert!(BlockingDialog::CodexHooksConfirm.dismisses());
        assert!(!BlockingDialog::ClaudeTrustMove.dismisses());
        assert!(!BlockingDialog::CodexHooksMove.dismisses());

        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        let trust = "Do you trust the contents of this directory? > 1. Yes, continue";
        assert_eq!(
            guard.tick(&obs(start, 2, 300, Some(2), trust)),
            Some(SubmitAction::AnswerDialog(BlockingDialog::CodexTrust))
        );
        let hooks = "Hooks need review > 1. Review hooks 2. Trust all and continue 3. Continue without trusting";
        let full = format!("{trust} {hooks}");
        assert_eq!(
            guard.tick(&obs_since(start, 5, 600, Some(5), &full, hooks)),
            Some(SubmitAction::AnswerDialog(BlockingDialog::CodexHooksMove))
        );
    }

    /// Review-Auflage (kimi-k3, 2026-09-17, Befund 1): the settle window
    /// between echo and Enter must not type dialog keystrokes either. A
    /// dialog marker still sitting in the tail during `AwaitingEnter` gets
    /// no answer - `Up, Enter` right before the real Enter is the same
    /// paste-folding bug the settle window exists to prevent - and the
    /// Enter still goes out on schedule.
    #[test]
    fn the_settle_window_between_echo_and_enter_answers_no_dialog() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        assert_eq!(
            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
            Some(SubmitAction::WriteTask { write: 1 })
        );
        // Echo seen; the dismissed trust dialog is still in the full tail.
        let echoed = format!("Trust this folder {TASK}");
        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), &echoed)), None);
        assert_eq!(guard.state(), SubmitState::AwaitingEnter);
        assert_eq!(
            guard.tick(&obs(start, 32, 600, Some(31), &echoed)),
            Some(SubmitAction::SendEnter { attempt: 0 }),
            "the settle window sends the Enter, never a dialog keystroke"
        );
        // And after the Enter the agent's own words stay unanswered.
        assert_eq!(guard.tick(&obs(start, 33, 900, Some(33), &echoed)), None);
        assert!(guard.is_delivered());
    }

    #[test]
    fn dialog_answers_respect_the_cooldown_and_the_cap() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);

        assert_eq!(
            guard.tick(&obs(start, 2, 300, Some(2), CLAUDE_DIALOG)),
            Some(SubmitAction::AnswerDialog(BlockingDialog::ClaudeTrust))
        );
        // Inside the cooldown the state machine carries on instead.
        assert_eq!(
            guard.tick(&obs(start, 3, 300, Some(2), CLAUDE_DIALOG)),
            None
        );
        assert_eq!(
            guard.tick(&obs(start, 5, 300, Some(2), CLAUDE_DIALOG)),
            Some(SubmitAction::AnswerDialog(BlockingDialog::ClaudeTrust))
        );
        assert_eq!(
            guard.tick(&obs(start, 8, 300, Some(2), CLAUDE_DIALOG)),
            Some(SubmitAction::AnswerDialog(BlockingDialog::ClaudeTrust))
        );
        // Cap reached: no fourth answer, the machine returns to its flow -
        // the opening burst has been quiet long enough, so the task is written.
        assert_eq!(
            guard.tick(&obs(start, 11, 300, Some(2), CLAUDE_DIALOG)),
            Some(SubmitAction::WriteTask { write: 1 })
        );
    }

    #[test]
    fn a_dismissed_dialog_that_scrolled_out_of_view_is_not_answered_again() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        let long_aftermath = format!("{}{}", CLAUDE_DIALOG, "working… ".repeat(400));

        assert_eq!(
            guard.tick(&obs(start, 2, 300, Some(2), &long_aftermath)),
            None,
            "a marker beyond the visible window is history, not a dialog"
        );
    }

    #[test]
    fn normalize_strips_ansi_sequences_and_collapses_whitespace() {
        assert_eq!(
            normalize_tui_output("\u{1b}[32mfoo\u{1b}[0m  bar\r\nbaz"),
            "foo bar baz"
        );
        assert_eq!(normalize_tui_output("\u{1b}]0;title\u{7}x"), "x");
        assert_eq!(normalize_tui_output("\u{1b}]8;;link\u{1b}\\y"), "y");
        assert_eq!(normalize_tui_output("a\u{7}b"), "ab");
    }

    #[test]
    fn the_task_fragment_comes_from_the_longest_line_and_stays_short() {
        let task = "ok\nEine deutlich längere Zeile, die den eigentlichen Auftrag trägt.\n";
        assert_eq!(task_fragment(task), "EinedeutlichlängereZeile");
        assert_eq!(task_fragment("   \n  "), "");
        assert_eq!(task_fragment("kurz"), "kurz");
    }

    #[test]
    fn a_whitespace_only_task_disables_the_echo_check() {
        // Degenerate input must not deadlock the guard in AwaitingEcho.
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, "   ");
        assert_eq!(
            guard.tick(&obs(start, 30, 0, None, "")),
            Some(SubmitAction::WriteTask { write: 1 })
        );
        assert_eq!(
            guard.tick(&obs(start, 31, 0, None, "")),
            Some(SubmitAction::SendEnter { attempt: 0 })
        );
    }

    #[test]
    fn a_dialog_marker_in_agent_output_after_the_enter_is_not_answered() {
        // Review-Auflage: once the agent works, marker-like words in its own
        // output must not type keystrokes into it. (`is_delivered()` ist dabei
        // das interne, byte-basierte Fortschrittssignal des markerlosen
        // Profils - keine bestaetigte Zustellung im Sinne von F-CORE-3 A.2.)
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        let _ = guard.tick(&obs(start, 30, 400, Some(1), "boot"));
        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), TASK)), None);
        assert_eq!(
            guard.tick(&obs(start, 32, 600, Some(31), TASK)),
            Some(SubmitAction::SendEnter { attempt: 0 })
        );

        let agent_output =
            "I ran the Quick safety check: Is this a project clean? Yes, I trust this folder now.";
        assert_eq!(
            guard.tick(&obs(start, 33, 900, Some(33), agent_output)),
            None
        );
        assert!(guard.is_delivered());
    }

    #[test]
    fn an_echo_that_was_already_in_the_tail_before_the_write_does_not_count() {
        // F-CORE-3 T1 (erstes Loch): das 24-Zeichen-Fragment eines frueheren
        // Textes steht bei wiederholten Writes bereits im Tail. Ohne neue
        // Bytes seit dem Write darf es nicht als Echo zaehlen.
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        let tail = format!("früher: prompt > {TASK}");
        assert_eq!(
            guard.tick(&obs(start, 30, 400, Some(1), &tail)),
            Some(SubmitAction::WriteTask { write: 1 })
        );

        // Derselbe Tail, keine neuen Bytes: das alte Fragment ist kein Echo.
        assert_eq!(guard.tick(&obs(start, 31, 400, Some(1), &tail)), None);
        assert_eq!(guard.state(), SubmitState::AwaitingEcho);
    }

    #[test]
    fn a_configured_marker_is_not_overridden_by_the_thirty_second_give_up() {
        // F-CORE-3 T3 (drittes Loch): bei konfiguriertem Marker darf der
        // 30-s-Fallback nicht mehr blind schreiben - Stille am Fristende
        // eskaliert.
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK).with_readiness_marker("Ask anything");

        // Output kam, ist seit 31 s still, der Marker erschien nie.
        assert_eq!(
            guard.tick(&obs(start, 31, 100, Some(0), "splash ohne prompt")),
            Some(SubmitAction::Escalate)
        );
        assert_eq!(guard.state(), SubmitState::Escalated);
    }

    #[test]
    fn a_busy_marker_tui_is_not_escalated_while_output_flows() {
        // F-CORE-3 T5 (A.4): die Marker-Frist gleitet bei fliessendem Output
        // wie ECHO_BUSY_CAP; erst Stille am Fristende (oder die Kappe)
        // eskaliert. Kein WriteTask in eine besetzte Eingabe.
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK).with_readiness_marker("Ask anything");

        // READY_MAX_WAIT ueberschritten, aber Output fliesst (letzter Output
        // juenger als READY_IDLE_AFTER); der Marker kam nicht.
        for (s, bytes) in [(31, 200), (60, 900), (100, 3000)] {
            assert_eq!(
                guard.tick(&obs(start, s, bytes, Some(s), "working…")),
                None,
                "busy marker TUI at {s}s: Frist gleitet, kein WriteTask, kein Escalate"
            );
            assert_eq!(guard.state(), SubmitState::IdleWatching);
        }
    }

    #[test]
    fn a_marked_tui_that_stays_busy_past_the_marker_cap_escalates() {
        // F-CORE-3 A.5 (ersetzt
        // a_marked_tui_that_never_shows_the_marker_falls_back_to_the_max_wait):
        // die gleitende Marker-Frist ist nach oben gekappt (MARKER_BUSY_CAP) -
        // ein Profil, dessen UI sich geaendert hat, darf nicht deadlocken.
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK).with_readiness_marker("Ask anything");

        // Output fliesst durchgehend (die Frist gleitet), der Marker kommt nie.
        for (s, bytes) in [(30, 400), (60, 900), (119, 5000)] {
            assert_eq!(
                guard.tick(&obs(start, s, bytes, Some(s), "loading…")),
                None,
                "busy at {s}s"
            );
        }
        assert_eq!(
            guard.tick(&obs(start, 120, 6000, Some(120), "loading…")),
            Some(SubmitAction::Escalate)
        );
        assert_eq!(guard.state(), SubmitState::Escalated);
    }

    #[test]
    fn a_readiness_marker_left_over_from_a_previous_prompt_does_not_arm_the_write() {
        // F-CORE-3 T4 (viertes Loch): "Ask anything" aus dem ersten Prompt
        // steht in der Historie einer laufenden OpenCode-Session. Nur ein
        // Marker *nach* der Guard-Baseline darf den Write arm machen - sonst
        // geht WriteTask{1} in eine besetzte Eingabe (NT-17 durch die
        // Hintertuer).
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK).with_readiness_marker("Ask anything");

        // Der Marker steht im Volltail (vor der Baseline), kam aber seit
        // Guard-Start nicht wieder: tail_since_write ist leer.
        let tail = "opencode\nAsk anything... \"Fix a TODO in the codebase\"\narbeitet…";
        assert_eq!(
            guard.tick(&obs_since(start, 5, 400, Some(4), tail, "")),
            None
        );
        assert_eq!(guard.state(), SubmitState::IdleWatching);

        // Positive Kontrolle: der Marker erscheint erneut, nach der Baseline.
        assert_eq!(
            guard.tick(&obs_since(start, 8, 500, Some(8), tail, "Ask anything")),
            Some(SubmitAction::WriteTask { write: 1 })
        );
    }

    #[test]
    fn a_resting_session_still_showing_its_prompt_marker_is_written_into() {
        // C-1 (Review Claude, hoch): eine bereits laufende, ruhende Sitzung
        // druckt ihren Readiness-Marker nach der Guard-Baseline nie erneut -
        // er steht schon auf dem Schirm. Sucht der Guard nur in
        // tail_since_write, eskaliert er nach 30 s, ohne je geschrieben zu
        // haben (Fragen-Antworten an laufende opencode-Worker). Die zweite
        // Bereitschaftsregel: Marker sichtbar am Ende des Volltails UND
        // mindestens READY_IDLE_AFTER Stille = der Prompt steht und ist frei.
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK).with_readiness_marker("Ask anything");

        // Der Marker steht nur vor der Baseline im Volltail (tail_since_write
        // ist leer), letzter Output 10 s her: die Sitzung ruht auf ihrem
        // Prompt.
        let tail = "opencode\nvorherige Antwortzeile\nAsk anything...";
        assert_eq!(
            guard.tick(&obs_since(start, 10, 400, Some(0), tail, "")),
            Some(SubmitAction::WriteTask { write: 1 }),
            "ein ruhender Prompt ist bereit - Eskalation ohne Write waere C-1"
        );
        assert_eq!(guard.state(), SubmitState::AwaitingEcho);
    }

    #[test]
    fn a_busy_session_with_a_leftover_marker_is_not_written_into() {
        // Gegenstueck zu C-1: der Marker steht im Volltail, aber die Sitzung
        // arbeitet (letzter Output juenger als READY_IDLE_AFTER) - der Prompt
        // ist besetzt, und der Write darf nicht arm werden (T4-Regel).
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK).with_readiness_marker("Ask anything");

        let tail = "opencode\nAsk anything...\narbeitet…";
        assert_eq!(
            guard.tick(&obs_since(start, 10, 400, Some(9), tail, "")),
            None,
            "besetzter Prompt: Output vor 1 s, die Ruheregel darf nicht greifen"
        );
        assert_eq!(guard.state(), SubmitState::IdleWatching);
    }

    #[test]
    fn a_status_bar_redraw_after_the_enter_is_not_delivery() {
        // F-CORE-3 T2 (A.2/A.3): Cursor-Blink, Spinner, Statuszeilen-Uhr sind
        // ein Lebenszeichen, kein Zustellbeweis. Ohne den Antwort-Marker nach
        // der Write-Baseline gibt es kein ConfirmDelivery (der interne
        // Byte-Fortschritt darf weitergehen: die Retry-Uhr gleitet).
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK).with_answer_marker("⏺");
        assert_eq!(
            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
            Some(SubmitAction::WriteTask { write: 1 })
        );
        let echoed = format!("prompt > {TASK}");
        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), &echoed)), None);
        assert_eq!(
            guard.tick(&obs(start, 32, 600, Some(31), &echoed)),
            Some(SubmitAction::SendEnter { attempt: 0 })
        );

        // Nur die Statuszeile wurde neu gezeichnet: 3 Bytes Spinner, kein
        // Antwort-Marker.
        let spinner = format!("{echoed} ◐");
        assert_eq!(guard.tick(&obs(start, 33, 603, Some(33), &spinner)), None);
        assert!(!guard.is_confirmed());
    }

    #[test]
    fn a_working_agent_without_an_answer_marker_is_not_typed_into() {
        // F-CORE-3 T6 (A.3/A.5): Retry-Uhr und Zustellbeweis sind getrennt -
        // ein Lebenszeichen setzt die Retry-Frist zurueck, also fliegen keine
        // Retry-Enters in einen arbeitenden Agenten. Ohne Marker endet die
        // Wartephase an der ANSWER_MARKER_CAP mit eigenem Eskalationsgrund.
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK).with_answer_marker("⏺");
        assert_eq!(
            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
            Some(SubmitAction::WriteTask { write: 1 })
        );
        let echoed = format!("prompt > {TASK}");
        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), &echoed)), None);
        assert_eq!(
            guard.tick(&obs(start, 32, 600, Some(31), &echoed)),
            Some(SubmitAction::SendEnter { attempt: 0 })
        );

        // Output fliesst ueber alle RETRY_BACKOFF-Fenster hinweg (15+30+60 s),
        // der Antwort-Marker erscheint nicht.
        let mut bytes = 600;
        for s in [40, 50, 70, 100, 140, 200] {
            bytes += 100;
            let working = format!("{echoed} working {s}");
            assert_eq!(
                guard.tick(&obs(start, s, bytes, Some(s), &working)),
                None,
                "ein arbeitender Agent bekommt kein Retry-Enter (t={s})"
            );
            assert!(!guard.is_confirmed());
            assert_ne!(guard.state(), SubmitState::Escalated);
        }
        assert_eq!(guard.state(), SubmitState::AwaitingWork(0));

        // A.5: gekappt 10 min nach dem Enter - ohne Marker eskaliert der Guard
        // mit eigenem Grund, statt nie zurueckzukehren.
        bytes += 100;
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

    /// W1-03c (review GPT-5.3-Codex X1): the task counts as left in the
    /// input line from its write until output answers the Enter - without
    /// an answer marker that output is the delivery proof itself.
    #[test]
    fn input_is_pending_only_until_output_answers_the_enter() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        assert!(!guard.input_pending());
        assert_eq!(
            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
            Some(SubmitAction::WriteTask { write: 1 })
        );
        assert!(guard.input_pending(), "typed, not yet echoed");
        let echoed = format!("prompt > {TASK}");
        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), &echoed)), None);
        assert_eq!(
            guard.tick(&obs(start, 32, 600, Some(31), &echoed)),
            Some(SubmitAction::SendEnter { attempt: 0 })
        );
        assert!(guard.input_pending(), "Enter sent, not yet answered");

        let working = format!("{echoed} working");
        assert_eq!(guard.tick(&obs(start, 40, 700, Some(40), &working)), None);
        assert!(guard.is_delivered());
        assert!(!guard.input_pending(), "output answered the Enter");
    }

    /// Review GLM-5.3 X2, read for the profile without answer marker: the
    /// first output after the Enter can land in the tick in which the last
    /// Enter retry would escalate. The output wins - the line is empty and
    /// must not be reported as pending.
    #[test]
    fn output_in_the_tick_of_the_cap_still_answers_the_enter() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        assert_eq!(
            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
            Some(SubmitAction::WriteTask { write: 1 })
        );
        let echoed = format!("prompt > {TASK}");
        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), &echoed)), None);
        assert_eq!(
            guard.tick(&obs(start, 32, 600, Some(31), &echoed)),
            Some(SubmitAction::SendEnter { attempt: 0 })
        );
        let working = format!("{echoed} working");
        assert_eq!(
            guard.tick(&obs(start, 1000, 700, Some(1000), &working)),
            None,
            "output after the Enter is delivery, not an escalation"
        );
        assert!(guard.is_delivered());
        assert!(!guard.input_pending(), "output answered the Enter");
    }

    /// Codex review (PR #81, P2): with an answer marker configured, output
    /// after the Enter is only a sign of life - a TUI that folded the Enter
    /// and merely redrew its status line looks the same. The task counts as
    /// left in the line until the marker proves the agent took it, and an
    /// escalation at the cap keeps the line dirty.
    #[test]
    fn with_an_answer_marker_input_stays_pending_until_the_marker() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK).with_answer_marker("⏺");
        assert_eq!(
            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
            Some(SubmitAction::WriteTask { write: 1 })
        );
        let echoed = format!("prompt > {TASK}");
        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), &echoed)), None);
        assert_eq!(
            guard.tick(&obs(start, 32, 600, Some(31), &echoed)),
            Some(SubmitAction::SendEnter { attempt: 0 })
        );
        let redraw = format!("{echoed} status");
        assert_eq!(guard.tick(&obs(start, 40, 700, Some(40), &redraw)), None);
        assert!(guard.input_pending(), "a redraw proves nothing");
        assert_eq!(
            guard.tick(&obs(start, 632, 800, Some(632), &redraw)),
            Some(SubmitAction::Escalate)
        );
        assert_eq!(
            guard.escalation_reason(),
            Some(EscalationReason::AnswerMarkerNeverSeen)
        );
        assert!(guard.input_pending(), "the cap leaves the line dirty");

        let mut confirmed = SubmitGuard::new(start, TASK).with_answer_marker("⏺");
        confirmed.tick(&obs(start, 30, 400, Some(1), "boot"));
        confirmed.tick(&obs(start, 31, 600, Some(31), &echoed));
        confirmed.tick(&obs(start, 32, 600, Some(31), &echoed));
        let answer = format!("{echoed} ⏺ on it");
        assert_eq!(
            confirmed.tick(&obs(start, 40, 700, Some(40), &answer)),
            Some(SubmitAction::ConfirmDelivery)
        );
        assert!(!confirmed.input_pending(), "the marker proves the take");
    }

    /// The counterpart: Enter retries that no output answers leave the task
    /// on the prompt, and the escalation reports it as still pending.
    #[test]
    fn unanswered_enter_retries_leave_the_input_pending() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        assert_eq!(
            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
            Some(SubmitAction::WriteTask { write: 1 })
        );
        let echoed = format!("prompt > {TASK}");
        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), &echoed)), None);
        assert_eq!(
            guard.tick(&obs(start, 32, 600, Some(31), &echoed)),
            Some(SubmitAction::SendEnter { attempt: 0 })
        );
        let mut now = 32;
        while !guard.is_done() {
            now += 10;
            guard.tick(&obs(start, now, 600, Some(31), &echoed));
            assert!(now < 1000, "the retries never ran out");
        }
        assert_eq!(
            guard.escalation_reason(),
            Some(EscalationReason::EnterUnanswered)
        );
        assert!(guard.input_pending());
    }

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

        let mut flooded = obs(start, 33, 40_000, Some(33), "viel output ohne fragment");
        flooded.write_window_overflowed = true;
        assert_eq!(guard.tick(&flooded), None);
        assert_eq!(guard.state(), SubmitState::AwaitingEnter);
        let mut settled = obs(start, 34, 40_000, Some(33), "viel output ohne fragment");
        settled.write_window_overflowed = true;
        assert_eq!(
            guard.tick(&settled),
            Some(SubmitAction::SendEnter { attempt: 0 })
        );
    }

    /// Kimi Code 0.43.0, raw ConPTY stream captured 2026-09-16 with
    /// `testutil::capture_kimi_output` and the exact wire text a worker gets
    /// (task plus the `ENTSCHEIDUNGEN` block). Offsets from the `.offsets`
    /// sidecar: the task was written at byte 7897, Enter sent at 10422.
    const KIMI_RAW: &[u8] = include_bytes!("../testdata/pty/kimi-0.43.0-composer-2026-09-16.raw");
    const KIMI_WRITE_AT: usize = 7897;
    const KIMI_ENTER_AT: usize = 10422;
    const KIMI_WIRE_TASK: &str = "Create a file named probe-kimi.txt in the repository root containing exactly PA_KIMI_OK followed by one newline. Read probe-kimi.txt to verify its content. Then reply with exactly PA_KIMI_OK. Do not commit anything.\n\nENTSCHEIDUNGEN\n- Bei wichtigen, blockierenden Entscheidungen frag den Menschen:\n  C:\\Users\\user1\\Desktop\\ProjectA\\src-tauri\\target\\debug\\pa.exe ask --project pj-1a0a2523d18-1 --worker wk-1a0a2530228-2 --question \"<Frage>\" [--options \"A,B,C\"]\n- Niemals bei Kleinkram. Nur wenn du ohne die Antwort nicht sinnvoll\n  weiterarbeiten kannst und ein falscher Rateschluss teuer waere.\n- Hoechstens 3 offene Fragen gleichzeitig; die vierte wird sofort mit\n  \"entscheide selbst\" beantwortet. Unbeantwortete Fragen laufen nach\n  4 Stunden ab und werden genauso beantwortet.\n- `ask` wartet nicht. Stelle die Frage, sag dass du auf die Entscheidung\n  wartest, und beende deinen Zug - die Antwort kommt als Eingabe in dein\n  Terminal zurueck.";

    fn kimi_normalized(range: std::ops::Range<usize>) -> String {
        normalize_tui_output(&String::from_utf8_lossy(&KIMI_RAW[range]))
    }

    /// W1-01 (NT-17, Kimi), the red test for the smoke of 2026-09-15: the
    /// guard wrote at t+3 s, rewrote at t+8 s and t+16 s and escalated at
    /// t+24 s - with the composer *later* showing the text. The raw stream
    /// explains it: Kimi's first four bytes are the cursor-position query
    /// `ESC[6n`, and unanswered it prints nothing else for minutes. The
    /// silence heuristic read "four bytes, then quiet" as a settled TUI. A
    /// handshake that renders nothing is not startup output: the write waits
    /// until something visible is on screen (or the 30 s give-up, unchanged).
    #[test]
    fn a_terminal_query_alone_is_not_settled_startup_output() {
        let opening = kimi_normalized(0..4);
        assert_eq!(&KIMI_RAW[..4], b"\x1b[6n");
        assert_eq!(
            opening.trim(),
            "",
            "the query normalizes to nothing visible"
        );

        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, KIMI_WIRE_TASK);
        assert_eq!(guard.tick(&obs(start, 0, 4, Some(0), &opening)), None);
        assert_eq!(
            guard.tick(&obs(start, 3, 4, Some(0), &opening)),
            None,
            "nothing visible was rendered: the TUI is blocked, not settled"
        );
        assert_eq!(guard.tick(&obs(start, 20, 4, Some(0), &opening)), None);
        assert_eq!(
            guard.tick(&obs(start, 30, 4, Some(0), &opening)),
            Some(SubmitAction::WriteTask { write: 1 }),
            "the 30 s give-up stands, bit-exact"
        );
    }

    /// Evidence, not a bug: once Kimi has rendered (the query was answered),
    /// its composer echoes the wire text with the top collapsed ("↑ 4 more")
    /// and the last line visible, and the guard recognizes that echo from
    /// the real bytes. The 2026-09-15 escalation was never a matching gap.
    #[test]
    fn the_kimi_composer_echo_from_the_raw_stream_is_recognized() {
        let before = kimi_normalized(0..KIMI_WRITE_AT);
        let full = kimi_normalized(0..KIMI_ENTER_AT);
        let since = kimi_normalized(KIMI_WRITE_AT..KIMI_ENTER_AT);
        assert!(before.contains("Send /help for help information."));
        assert!(since.contains("↑ 4 more"));

        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, KIMI_WIRE_TASK);
        assert_eq!(
            guard.tick(&obs(start, 10, KIMI_WRITE_AT as u64, Some(6), &before)),
            Some(SubmitAction::WriteTask { write: 1 })
        );
        assert_eq!(
            guard.tick(&obs_since(
                start,
                11,
                KIMI_ENTER_AT as u64,
                Some(11),
                &full,
                &since
            )),
            None
        );
        assert_eq!(
            guard.state(),
            SubmitState::AwaitingEnter,
            "the collapsed composer's visible tail is the echo"
        );
        assert_eq!(
            guard.tick(&obs_since(
                start,
                12,
                KIMI_ENTER_AT as u64,
                Some(11),
                &full,
                &since
            )),
            Some(SubmitAction::SendEnter { attempt: 0 })
        );
    }

    /// W1-01, second cause, from the launch-path I/O trace of 2026-09-17
    /// (`PROJECTA_PTY_TRACE_DIR`): the task was written at t=6154 ms, Kimi
    /// redrew the composer with the text at t=6326 ms, the guard's Enter went
    /// at t=6355 ms - and the next redraw showed "↑ 14 more" with the cursor
    /// on a fresh empty line: the Enter had been folded into the paste as a
    /// newline, nothing was submitted, and the guard still reported
    /// "delivered" because the redraw counted as agent output. The Enter
    /// must wait until the TUI has been quiet after the echo.
    #[test]
    fn the_enter_waits_for_the_paste_to_settle_after_the_echo() {
        let before = kimi_normalized(0..KIMI_WRITE_AT);
        let full = kimi_normalized(0..KIMI_ENTER_AT);
        let since = kimi_normalized(KIMI_WRITE_AT..KIMI_ENTER_AT);
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, KIMI_WIRE_TASK);
        assert_eq!(
            guard.tick(&obs(start, 10, KIMI_WRITE_AT as u64, Some(6), &before)),
            Some(SubmitAction::WriteTask { write: 1 })
        );
        // The redraw with the echo has just arrived (last output = now).
        let echo = |now_secs, last_secs| {
            obs_since(
                start,
                now_secs,
                KIMI_ENTER_AT as u64,
                Some(last_secs),
                &full,
                &since,
            )
        };
        assert_eq!(
            guard.tick(&echo(11, 11)),
            None,
            "an Enter in the same tick as the echo lands inside the paste"
        );
        assert_eq!(guard.state(), SubmitState::AwaitingEnter);
        assert_eq!(
            guard.tick(&echo(12, 11)),
            Some(SubmitAction::SendEnter { attempt: 0 }),
            "one quiet second after the echo the Enter is a keystroke of its own"
        );
        assert_eq!(guard.state(), SubmitState::AwaitingWork(0));
    }

    /// W1-01a (b), Kimi raw-stream report section 6: the 945-byte wire task
    /// took 0.2-4.7 s to render in the composer, 10.7 s during a Kimi
    /// auto-update. A composer that renders a paste without printing
    /// anything in between is quiet, not deaf - a rewrite at the fixed 8 s
    /// would paste the task a second time into a line that already holds it.
    /// The echo window grows with the length of the paste.
    #[test]
    fn a_long_paste_gets_the_echo_time_kimi_needed_during_an_update() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, KIMI_WIRE_TASK);
        assert_eq!(
            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
            Some(SubmitAction::WriteTask { write: 1 })
        );
        // Quiet since the write, no echo yet: 10.7 s is the measured worst
        // case for this very text.
        for now in [31, 38, 39, 41] {
            assert_eq!(
                guard.tick(&obs_since(start, now, 400, Some(1), "boot", "")),
                None,
                "the 945-byte paste was rewritten {} s after the write",
                now - 30
            );
        }
        let echoed = format!("> {KIMI_WIRE_TASK}");
        assert_eq!(
            guard.tick(&obs_since(start, 42, 1400, Some(42), &echoed, &echoed)),
            None
        );
        assert_eq!(guard.state(), SubmitState::AwaitingEnter);
    }

    /// Siblings of (b): short tasks keep the 8 s window bit-exact, the
    /// window grows with the paste and stops at the cap, and a long write
    /// that was really lost is still repeated once its window ran out.
    #[test]
    fn the_echo_window_scales_with_the_paste_and_stays_bounded() {
        assert_eq!(echo_window_for(""), ECHO_WINDOW);
        assert_eq!(echo_window_for(TASK), ECHO_WINDOW);
        assert_eq!(KIMI_WIRE_TASK.len(), 945, "the measured wire text");
        assert_eq!(
            echo_window_for(KIMI_WIRE_TASK),
            Duration::from_millis(945 * 15)
        );
        assert_eq!(echo_window_for(&"x".repeat(100_000)), ECHO_WINDOW_CAP);

        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, KIMI_WIRE_TASK);
        assert_eq!(
            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
            Some(SubmitAction::WriteTask { write: 1 })
        );
        assert_eq!(
            guard.tick(&obs_since(start, 44, 400, Some(1), "boot", "")),
            None
        );
        assert_eq!(
            guard.tick(&obs_since(start, 45, 400, Some(1), "boot", "")),
            Some(SubmitAction::WriteTask { write: 2 }),
            "a lost write is repeated once the scaled window ran out"
        );
    }

    /// Review kimi-k3 3: the worst-case latency to escalation for a capped
    /// paste that is really lost, spelled out: three writes, one capped
    /// window each - 3 x ECHO_WINDOW_CAP after the first write.
    #[test]
    fn a_lost_capped_paste_escalates_after_three_capped_windows() {
        let task = "x".repeat(100_000);
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, &task);
        assert_eq!(
            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
            Some(SubmitAction::WriteTask { write: 1 })
        );
        let quiet = |now| obs_since(start, now, 400, Some(1), "boot", "");
        assert_eq!(guard.tick(&quiet(89)), None);
        assert_eq!(
            guard.tick(&quiet(90)),
            Some(SubmitAction::WriteTask { write: 2 })
        );
        assert_eq!(guard.tick(&quiet(149)), None);
        assert_eq!(
            guard.tick(&quiet(150)),
            Some(SubmitAction::WriteTask { write: 3 })
        );
        assert_eq!(guard.tick(&quiet(209)), None);
        assert_eq!(guard.tick(&quiet(210)), Some(SubmitAction::Escalate));
        assert_eq!(
            guard.escalation_reason(),
            Some(EscalationReason::EchoNeverSeen)
        );
    }

    /// Sibling: a TUI that keeps repainting after the echo (spinner, clock)
    /// never gets quiet - the Enter still goes, ENTER_SETTLE_CAP after the
    /// echo at the latest, instead of waiting forever.
    #[test]
    fn a_repainting_tui_still_gets_its_enter_after_the_settle_cap() {
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, TASK);
        assert_eq!(
            guard.tick(&obs(start, 30, 400, Some(1), "boot")),
            Some(SubmitAction::WriteTask { write: 1 })
        );
        let echoed = format!("prompt > {TASK} spinner");
        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), &echoed)), None);
        assert_eq!(guard.tick(&obs(start, 33, 800, Some(33), &echoed)), None);
        assert_eq!(guard.tick(&obs(start, 35, 900, Some(35), &echoed)), None);
        assert_eq!(
            guard.tick(&obs(start, 36, 1000, Some(36), &echoed)),
            Some(SubmitAction::SendEnter { attempt: 0 })
        );
    }

    #[test]
    fn a_task_mentioning_the_marker_gets_an_echo_enter_not_a_dialog_answer() {
        // Review-Auflage: the task's own text may quote the marker; the echo
        // check wins because a real dialog swallows input and prevents echoes.
        let task = "Bitte pruefe: Quick safety check: Is this a project you trust?";
        let start = Instant::now();
        let mut guard = SubmitGuard::new(start, task);
        assert_eq!(
            guard.tick(&obs(start, 30, 0, None, "")),
            Some(SubmitAction::WriteTask { write: 1 })
        );

        let echoed = format!("prompt > {task}");
        assert_eq!(guard.tick(&obs(start, 31, 600, Some(31), &echoed)), None);
        assert_eq!(guard.state(), SubmitState::AwaitingEnter);
        assert_eq!(
            guard.tick(&obs(start, 32, 600, Some(31), &echoed)),
            Some(SubmitAction::SendEnter { attempt: 0 })
        );
    }
}
