//! Streaming enforcement for one bounded native capture (W2-08a). Pure
//! decisions with an injected clock, so the boundaries are testable on every
//! platform. The Windows pipe loop applies them; an abort there retires the
//! whole job before the error returns, and output events already handed to
//! the observer (and checkpoints already persisted) are never taken back.

use std::time::{Duration, Instant};

/// Stable abort reason for a capture whose process stayed alive without
/// producing a single output byte for the whole no-progress window.
pub const STALLED: &str = "capture stalled without output progress";
/// Stable abort reason for output beyond the capture's byte limit.
pub const BYTE_LIMIT: &str = "capture output exceeded byte limit";

/// Operational default for the no-progress window. It is deliberately long:
/// providers may think silently for minutes, and a false abort loses work.
/// Its job is to end the class of stall observed on 2026-09-16 (a TUI blocked
/// on an unanswered terminal query, silent for 200 s and then indefinitely),
/// which otherwise holds its claim until the 90-minute launch deadline.
pub const NO_PROGRESS_LIMIT: Duration = Duration::from_secs(15 * 60);

/// Output-progress watch. Any byte on stdout or stderr counts as progress;
/// silence reaching the window exactly aborts (like the deadline, `>=`).
#[derive(Debug, Clone, Copy)]
pub struct ProgressWatch {
    window: Duration,
    last_progress: Instant,
}

impl ProgressWatch {
    /// A zero window would abort before the first read and is rejected.
    pub fn new(window: Duration, started: Instant) -> Result<Self, &'static str> {
        if window.is_zero() {
            return Err("invalid no-progress window");
        }
        Ok(Self {
            window,
            last_progress: started,
        })
    }

    /// The same window, counted from `now` (e.g. when the process resumes).
    pub fn restarted(self, now: Instant) -> Self {
        Self {
            last_progress: now,
            ..self
        }
    }

    /// Records `bytes` newly read at `now`. Zero bytes are not progress. A
    /// clock value before the last progress never moves the mark backwards.
    pub fn record(&mut self, bytes: usize, now: Instant) {
        if bytes > 0 && now > self.last_progress {
            self.last_progress = now;
        }
    }

    /// `Err(STALLED)` once the silence since the last progress reaches the
    /// window. A clock reading before the last progress counts as no silence.
    pub fn check(&self, now: Instant) -> Result<(), &'static str> {
        if now.saturating_duration_since(self.last_progress) >= self.window {
            Err(STALLED)
        } else {
            Ok(())
        }
    }
}

/// Admits `incoming` bytes on top of `captured` under `limit`. Exactly at the
/// limit is admitted; one byte more aborts. An arithmetic overflow or an
/// already exceeded total is treated as over the limit (fail-closed).
pub fn admit_output(captured: usize, incoming: usize, limit: usize) -> Result<(), &'static str> {
    match captured.checked_add(incoming) {
        Some(total) if total <= limit => Ok(()),
        _ => Err(BYTE_LIMIT),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_reaching_the_window_exactly_aborts_with_the_stall_reason() {
        let start = Instant::now();
        let window = Duration::from_millis(500);
        let watch = ProgressWatch::new(window, start).unwrap();
        assert_eq!(watch.check(start), Ok(()));
        assert_eq!(
            watch.check(start + window - Duration::from_nanos(1)),
            Ok(())
        );
        assert_eq!(watch.check(start + window), Err(STALLED));
        assert_eq!(watch.check(start + window * 3), Err(STALLED));
    }

    #[test]
    fn any_output_byte_restarts_the_window_but_empty_reads_do_not() {
        let start = Instant::now();
        let window = Duration::from_millis(500);
        let mut watch = ProgressWatch::new(window, start).unwrap();
        watch.record(0, start + Duration::from_millis(400));
        assert_eq!(watch.check(start + window), Err(STALLED));
        watch.record(1, start + Duration::from_millis(450));
        assert_eq!(watch.check(start + window), Ok(()));
        assert_eq!(
            watch.check(start + Duration::from_millis(450) + window),
            Err(STALLED)
        );
    }

    #[test]
    fn an_earlier_clock_reading_never_extends_or_resets_progress() {
        let start = Instant::now();
        let later = start + Duration::from_millis(300);
        let mut watch = ProgressWatch::new(Duration::from_millis(500), later).unwrap();
        // A reading before the mark neither moves it back nor counts as silence.
        watch.record(10, start);
        assert_eq!(watch.check(start), Ok(()));
        assert_eq!(
            watch.check(later + Duration::from_millis(500)),
            Err(STALLED)
        );
    }

    #[test]
    fn a_zero_window_is_rejected_instead_of_aborting_every_capture() {
        assert!(ProgressWatch::new(Duration::ZERO, Instant::now()).is_err());
        assert!(NO_PROGRESS_LIMIT > Duration::from_secs(200));
    }

    #[test]
    fn output_exactly_at_the_limit_is_admitted_and_one_byte_more_aborts() {
        assert_eq!(admit_output(0, 10, 10), Ok(()));
        assert_eq!(admit_output(6, 4, 10), Ok(()));
        assert_eq!(admit_output(10, 0, 10), Ok(()));
        assert_eq!(admit_output(6, 5, 10), Err(BYTE_LIMIT));
        assert_eq!(admit_output(11, 0, 10), Err(BYTE_LIMIT));
        // Overflow is over the limit, never a wrapped small total.
        assert_eq!(admit_output(usize::MAX, 1, usize::MAX), Err(BYTE_LIMIT));
    }
}
