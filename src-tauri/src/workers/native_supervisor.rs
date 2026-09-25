//! Single completion consumer. Resource authorization and app pre-exit policy
//! belong to the caller; this owner never enables routing or cancels sessions.
use super::{Drain, WindowsNativeRunner};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

struct Retirement {
    thread: Option<JoinHandle<Result<Drain, String>>>,
    result: Option<Result<Drain, String>>,
}

pub struct NativeSupervisor {
    runner: Arc<WindowsNativeRunner>,
    stop: Arc<AtomicBool>,
    retirement: Mutex<Retirement>,
}

impl NativeSupervisor {
    /// The caller transfers completion-consumer ownership: it must no longer
    /// call wait_completion/drain directly while this supervisor exists.
    pub fn start(runner: Arc<WindowsNativeRunner>) -> Result<Self, String> {
        {
            let mut registry = runner
                .registry
                .lock()
                .map_err(|_| "native registry unavailable")?;
            if registry.supervisor_owned || registry.admission_closed {
                return Err("native supervisor already owned or admission closed".into());
            }
            // Exclude an existing manual consumer before transferring ownership.
            let _receiver = runner
                .receiver
                .try_lock()
                .map_err(|_| "native receiver busy")?;
            registry.supervisor_owned = true;
        }
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        let worker_runner = runner.clone();
        let thread = std::thread::Builder::new()
            .name("projecta-native-completions".into())
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    supervise(&worker_runner, &worker_stop)
                }))
                .unwrap_or_else(|_| Err("native supervisor panicked; reconcile".into()));
                // A failed observer must not leave an apparently usable lane.
                let closure = worker_runner.close_admission();
                match (result, closure) {
                    (Err(error), _) => Err(error),
                    (Ok(_), Err(error)) => Err(error),
                    (Ok(drained), Ok(())) => Ok(drained),
                }
            })
            .map_err(|_| {
                let _ = runner.close_admission();
                "native completion supervisor could not start"
            })?;
        Ok(Self {
            runner,
            stop,
            retirement: Mutex::new(Retirement {
                thread: Some(thread),
                result: None,
            }),
        })
    }

    /// None means still retiring, with ownership retained for another call.
    /// Call before final process exit while Store, API and runtime remain alive.
    /// A returned Drain may contain unresolved IDs; it is not update authority.
    /// Its completions are only the last drain batch, not a run history. Earlier
    /// completions have already been consumed and their effects persisted.
    pub fn shutdown(&self, timeout: Duration) -> Result<Option<Drain>, String> {
        if timeout > Duration::from_secs(60) {
            return Err("native supervisor shutdown exceeds limit".into());
        }
        let deadline = Instant::now() + timeout;
        self.runner.close_admission()?;
        self.stop.store(true, Ordering::Release);
        let mut retirement = self
            .retirement
            .try_lock()
            .map_err(|_| "native supervisor retirement busy or unavailable")?;
        retirement.wait(deadline)
    }
}

impl Retirement {
    fn wait(&mut self, deadline: Instant) -> Result<Option<Drain>, String> {
        loop {
            if let Some(result) = &self.result {
                return result.clone().map(Some);
            }
            if self.thread.as_ref().is_some_and(JoinHandle::is_finished) {
                let result = self
                    .thread
                    .take()
                    .expect("finished owned supervisor")
                    .join()
                    .unwrap_or_else(|_| Err("native supervisor panicked; reconcile".into()));
                self.result = Some(result);
                continue;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Ok(None);
            }
            std::thread::sleep(remaining.min(Duration::from_millis(5)));
        }
    }
}

fn supervise(runner: &WindowsNativeRunner, stop: &AtomicBool) -> Result<Drain, String> {
    let receiver = runner
        .receiver
        .try_lock()
        .map_err(|_| "native supervisor receiver unavailable")?;
    loop {
        if stop.load(Ordering::Acquire) {
            let drained = runner.drain_owned(&receiver, Duration::from_secs(1))?;
            if drained.running.is_empty() {
                return Ok(drained);
            }
        } else {
            // Completion effects are already durable. Do not accumulate an
            // unbounded second history of successful runs in memory. The runner
            // preserves failed outcomes in its unresolved inventory.
            if let Some(completion) =
                runner.consume_completion(&receiver, Duration::from_secs(1))?
            {
                if let Err(error) = completion.result {
                    crate::logf!(
                        "native-supervisor",
                        "session {} requires reconciliation: {}",
                        completion.session_id,
                        error
                    );
                }
            }
        }
    }
}

impl Drop for NativeSupervisor {
    fn drop(&mut self) {
        // Request drain without blocking a destructor. Explicit shutdown must
        // confirm retirement before the caller terminates the process; dropping
        // this value alone makes no completion or recovery claim.
        let _ = self.runner.close_admission();
        self.stop.store(true, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retirement_timeout_keeps_handle_and_replays_success_or_failure() {
        for failure in [false, true] {
            let (release, receiver) = std::sync::mpsc::channel();
            let thread = std::thread::spawn(move || {
                receiver.recv_timeout(Duration::from_secs(5)).unwrap();
                if failure {
                    Err("observed failure".into())
                } else {
                    Ok(Drain {
                        completions: vec![],
                        running: vec![],
                        unresolved: vec!["retained".into()],
                    })
                }
            });
            let mut retirement = Retirement {
                thread: Some(thread),
                result: None,
            };
            assert!(retirement.wait(Instant::now()).unwrap().is_none());
            assert!(retirement.thread.is_some());
            release.send(()).unwrap();
            let first = retirement.wait(Instant::now() + Duration::from_secs(10));
            let repeated = retirement.wait(Instant::now());
            if failure {
                assert!(matches!(first, Err(ref error) if error == "observed failure"));
                assert!(matches!(repeated, Err(ref error) if error == "observed failure"));
            } else {
                assert_eq!(first.unwrap().unwrap().unresolved, ["retained"]);
                assert_eq!(repeated.unwrap().unwrap().unresolved, ["retained"]);
            }
            assert!(retirement.thread.is_none());
        }
    }
}
