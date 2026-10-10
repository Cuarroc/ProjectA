//! Watchdog core: which runs are finished, which stand still.
//!
//! A pure function from a snapshot of runs to notices. It reads no clock, no
//! git and no database; the caller passes `now` and the runs, and carries the
//! dedupe state from one tick to the next. That is what keeps "one notice per
//! stall" testable: the state is an explicit value in and out, never a global.
//!
//! * **Fertig.** A run whose process exited gets exactly one notice, however
//!   many ticks still list it.
//! * **Steht.** A run with neither output nor commit for the threshold gets
//!   one notice. It gets the next one only after it has shown activity again
//!   and stalled again.
//! * **A lease alone proves nothing.** An expired lease is not an exit
//!   ([`RunState::LeaseExpired`] never yields Fertig); it may still stall.
//!
//! A run with no activity timestamp at all cannot be judged and stays silent.

use std::collections::BTreeSet;
use std::time::Duration;

use crate::status::STUCK_AFTER;

/// Unix time in milliseconds, as the caller observed it.
pub type Millis = u64;

/// What the caller knows about a run's process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunState {
    Running,
    /// The lease ran out but no exit was observed: the process may live on.
    LeaseExpired,
    Exited,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Run {
    pub id: String,
    pub state: RunState,
    pub last_output_at: Option<Millis>,
    pub last_commit_at: Option<Millis>,
    pub exited_at: Option<Millis>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Thresholds {
    /// Silence (no output, no commit) after which a run counts as standing.
    pub stalled_after: Duration,
}

impl Default for Thresholds {
    /// The same ten minutes the stuck diagnosis uses.
    fn default() -> Self {
        Self {
            stalled_after: STUCK_AFTER,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoticeKind {
    Fertig,
    Steht,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notice {
    pub run_id: String,
    pub kind: NoticeKind,
    /// Fertig: when the run exited (the tick's `now` if unknown). Steht: the
    /// last activity the run showed.
    pub since: Millis,
}

/// What has been announced already. Start from [`Dedupe::default`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Dedupe {
    stalled: BTreeSet<String>,
    finished: BTreeSet<String>,
}

/// One tick: the notices that are new, and the dedupe state for the next tick.
///
/// A stall mark is dropped when the run shows activity again or leaves the
/// list; a finished mark is kept, so a run that stays in the list or comes
/// back as exited is never announced twice.
pub fn evaluate(
    runs: &[Run],
    now: Millis,
    thresholds: &Thresholds,
    dedupe: &Dedupe,
) -> (Vec<Notice>, Dedupe) {
    let limit = u64::try_from(thresholds.stalled_after.as_millis()).unwrap_or(u64::MAX);
    let mut notices = Vec::new();
    let mut next = Dedupe {
        stalled: BTreeSet::new(),
        finished: dedupe.finished.clone(),
    };
    for run in runs {
        if run.state == RunState::Exited {
            if next.finished.insert(run.id.clone()) {
                notices.push(Notice {
                    run_id: run.id.clone(),
                    kind: NoticeKind::Fertig,
                    since: run.exited_at.unwrap_or(now),
                });
            }
            continue;
        }
        let Some(last) = run.last_output_at.max(run.last_commit_at) else {
            continue;
        };
        // A clock that stepped back reads as zero silence, not as a stall.
        if now.saturating_sub(last) < limit {
            continue;
        }
        next.stalled.insert(run.id.clone());
        if !dedupe.stalled.contains(&run.id) {
            notices.push(Notice {
                run_id: run.id.clone(),
                kind: NoticeKind::Steht,
                since: last,
            });
        }
    }
    (notices, next)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: Millis = 60_000;

    fn run(id: &str, state: RunState, output: Option<Millis>, commit: Option<Millis>) -> Run {
        Run {
            id: id.into(),
            state,
            last_output_at: output,
            last_commit_at: commit,
            exited_at: None,
        }
    }

    fn th() -> Thresholds {
        Thresholds {
            stalled_after: Duration::from_millis(10 * MIN),
        }
    }

    #[test]
    fn a_stalled_run_yields_exactly_one_notice_across_three_ticks() {
        let runs = [run("r1", RunState::Running, Some(0), None)];
        let mut state = Dedupe::default();
        let mut all = Vec::new();
        for now in [11 * MIN, 12 * MIN, 13 * MIN] {
            let (notices, next) = evaluate(&runs, now, &th(), &state);
            all.extend(notices);
            state = next;
        }
        assert_eq!(
            all,
            vec![Notice {
                run_id: "r1".into(),
                kind: NoticeKind::Steht,
                since: 0
            }]
        );
    }

    #[test]
    fn activity_resets_the_stall_so_the_next_stall_is_announced_again() {
        let mut state = Dedupe::default();
        let stalled = [run("r1", RunState::Running, Some(0), None)];
        let (first, next) = evaluate(&stalled, 11 * MIN, &th(), &state);
        assert_eq!(first.len(), 1);
        state = next;
        // Fresh output: no notice, and the stall mark is gone.
        let active = [run("r1", RunState::Running, Some(12 * MIN), None)];
        let (quiet, next) = evaluate(&active, 13 * MIN, &th(), &state);
        assert!(quiet.is_empty());
        state = next;
        let (second, _) = evaluate(&active, 23 * MIN, &th(), &state);
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].kind, NoticeKind::Steht);
        assert_eq!(second[0].since, 12 * MIN);
    }

    #[test]
    fn a_recent_commit_alone_keeps_a_silent_run_from_standing() {
        let runs = [run("r1", RunState::Running, Some(0), Some(8 * MIN))];
        let (notices, _) = evaluate(&runs, 11 * MIN, &th(), &Dedupe::default());
        assert!(notices.is_empty());
        let (notices, _) = evaluate(&runs, 18 * MIN, &th(), &Dedupe::default());
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].since, 8 * MIN);
    }

    #[test]
    fn an_exited_run_yields_one_fertig_however_often_it_is_listed() {
        let mut exited = run("r1", RunState::Exited, Some(0), None);
        exited.exited_at = Some(5 * MIN);
        let runs = [exited];
        let mut state = Dedupe::default();
        let mut all = Vec::new();
        for now in [6 * MIN, 30 * MIN, 60 * MIN] {
            let (notices, next) = evaluate(&runs, now, &th(), &state);
            all.extend(notices);
            state = next;
        }
        assert_eq!(
            all,
            vec![Notice {
                run_id: "r1".into(),
                kind: NoticeKind::Fertig,
                since: 5 * MIN
            }]
        );
    }

    #[test]
    fn an_expired_lease_without_exit_does_not_yield_fertig() {
        let runs = [run("r1", RunState::LeaseExpired, Some(0), None)];
        let (notices, _) = evaluate(&runs, 5 * MIN, &th(), &Dedupe::default());
        assert!(notices.is_empty(), "lease alone is no proof of an exit");
        // Silent long enough it may stand, but it is never finished.
        let (notices, _) = evaluate(&runs, 20 * MIN, &th(), &Dedupe::default());
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].kind, NoticeKind::Steht);
    }

    #[test]
    fn a_run_without_any_timestamp_stays_silent_and_a_back_step_is_no_stall() {
        let runs = [run("r1", RunState::Running, None, None)];
        let (notices, _) = evaluate(&runs, 99 * MIN, &th(), &Dedupe::default());
        assert!(notices.is_empty());
        let runs = [run("r2", RunState::Running, Some(50 * MIN), None)];
        let (notices, _) = evaluate(&runs, 10 * MIN, &th(), &Dedupe::default());
        assert!(notices.is_empty());
    }

    #[test]
    fn the_default_threshold_is_the_stuck_diagnosis_threshold() {
        assert_eq!(Thresholds::default().stalled_after, STUCK_AFTER);
    }
}
