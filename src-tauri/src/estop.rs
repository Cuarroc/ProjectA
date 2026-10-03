//! App side of the global emergency stop (W5-04b). The store half (W5-04a)
//! owns the persistent barrier; this half ends the running agent processes
//! within [`DEADLINE`] and says so only when it has observed that no session
//! is left. Fail closed: a fleet that cannot be counted, or still has
//! sessions at the deadline, is reported as not stopped - never as stopped.
use std::time::{Duration, Instant};

/// How long the app may take to end every running dispatch.
pub const DEADLINE: Duration = Duration::from_secs(10);

/// How often the fleet is re-checked (and re-signalled) while waiting.
const POLL: Duration = Duration::from_millis(100);

/// Time source, injectable so the deadline is tested without waiting.
pub trait Clock {
    fn now(&self) -> Instant;
    fn sleep(&self, duration: Duration);
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration);
    }
}

/// The running agent processes, as far as the stop can reach them.
pub trait Fleet {
    /// Signal every session, including reservations not yet spawned.
    fn kill_all(&self);
    /// Sessions still alive; an error means "cannot tell".
    fn live(&self) -> Result<usize, String>;
}

impl Fleet for crate::pty::PtyManager {
    fn kill_all(&self) {
        crate::pty::PtyManager::kill_all(self);
    }
    fn live(&self) -> Result<usize, String> {
        self.live_session_ids().map(|ids| ids.len())
    }
}

/// Kill the fleet and wait until it is observed empty. Signals again on every
/// poll so a spawn that raced the first signal is caught too.
pub fn enforce(fleet: &dyn Fleet, clock: &dyn Clock, deadline: Duration) -> Result<(), String> {
    let end = clock.now() + deadline;
    loop {
        fleet.kill_all();
        let remaining = fleet.live().map_err(|error| {
            format!("emergency stop: cannot confirm that agents ended: {error}")
        })?;
        if remaining == 0 {
            return Ok(());
        }
        if clock.now() >= end {
            return Err(format!(
                "emergency stop: {remaining} agent session(s) still alive after {}s",
                deadline.as_secs()
            ));
        }
        clock.sleep(POLL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    /// Virtual clock: `sleep` advances time and never waits.
    struct FakeClock {
        start: Instant,
        elapsed: Cell<Duration>,
    }

    impl FakeClock {
        fn new() -> Self {
            Self {
                start: Instant::now(),
                elapsed: Cell::new(Duration::ZERO),
            }
        }
    }

    impl Clock for FakeClock {
        fn now(&self) -> Instant {
            self.start + self.elapsed.get()
        }
        fn sleep(&self, duration: Duration) {
            self.elapsed.set(self.elapsed.get() + duration);
        }
    }

    /// Dies `dies_after` into the fake timeline; `None` never dies.
    struct FakeFleet<'a> {
        clock: &'a FakeClock,
        dies_after: Option<Duration>,
        signals: Cell<u32>,
        broken: bool,
    }

    impl Fleet for FakeFleet<'_> {
        fn kill_all(&self) {
            self.signals.set(self.signals.get() + 1);
        }
        fn live(&self) -> Result<usize, String> {
            if self.broken {
                return Err("registry poisoned".into());
            }
            Ok(match self.dies_after {
                Some(after) if self.clock.elapsed.get() >= after => 0,
                _ => 1,
            })
        }
    }

    fn fleet(clock: &FakeClock, dies_after: Option<Duration>, broken: bool) -> FakeFleet<'_> {
        FakeFleet {
            clock,
            dies_after,
            signals: Cell::new(0),
            broken,
        }
    }

    #[test]
    fn a_fleet_that_ends_inside_the_deadline_is_stopped() {
        let clock = FakeClock::new();
        let fleet = fleet(&clock, Some(Duration::from_secs(9)), false);
        enforce(&fleet, &clock, DEADLINE).unwrap();
        assert!(clock.elapsed.get() <= DEADLINE);
        assert!(fleet.signals.get() > 1, "survivors are signalled again");
    }

    #[test]
    fn a_fleet_alive_at_the_deadline_is_reported_not_stopped() {
        let clock = FakeClock::new();
        let fleet = fleet(&clock, None, false);
        let error = enforce(&fleet, &clock, DEADLINE).unwrap_err();
        assert!(error.contains("still alive after 10s"), "{error}");
        assert!(clock.elapsed.get() >= DEADLINE);
        assert!(clock.elapsed.get() <= DEADLINE + POLL, "no overshoot");
    }

    #[test]
    fn a_fleet_that_cannot_be_counted_is_never_reported_stopped() {
        let clock = FakeClock::new();
        let fleet = fleet(&clock, Some(Duration::ZERO), true);
        let error = enforce(&fleet, &clock, DEADLINE).unwrap_err();
        assert!(error.contains("cannot confirm"), "{error}");
    }

    #[test]
    fn an_empty_fleet_returns_without_waiting() {
        let clock = FakeClock::new();
        let fleet = fleet(&clock, Some(Duration::ZERO), false);
        enforce(&fleet, &clock, DEADLINE).unwrap();
        assert_eq!(clock.elapsed.get(), Duration::ZERO);
    }
}
