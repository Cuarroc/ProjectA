//! One synchronous native session operation for the trusted worker lane. Invoke
//! on an owned blocking task, never a UI or Tokio worker thread. No scheduler.
use super::{protocol::Prepared, windows_process};
use crate::{
    pty::PtyManager,
    store::{development_capture::CaptureOwner, Store},
};
use std::{path::Path, sync::mpsc};

fn combine_results<T>(native: Result<T, String>, actor: Result<(), String>) -> Result<T, String> {
    match (native, actor) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(first), Err(second)) => Err(format!("{first}; {second}")),
        (Err(error), Ok(())) | (Ok(_), Err(error)) => Err(error),
    }
}

/// What the trusted final handler observes after durable settlement. Only
/// `Completed` carries a delivered, receipted capture. `ExitedUndelivered`
/// means the provider demonstrably exited before its task input was
/// delivered; it is reconcilable, never delivered, successful or reviewable.
pub enum Settled {
    Completed(Box<super::host_reply::Reply>),
    ExitedUndelivered { exit_code: u32 },
}

/// Returns only after the native executor, checkpoint actor, close barrier and
/// trusted final handler finish. Failure retains the shared registry entry.
/// Capture/exit accounting commits before the final handler runs. This function
/// never invokes the legacy PTY exit hook.
pub fn run(
    manager: &PtyManager,
    store: &Store,
    owner: &CaptureOwner,
    host: (&Path, &str),
    prepared: Prepared,
    runtime: &tokio::runtime::Handle,
    finish: impl FnOnce(Settled) -> Result<(), String>,
) -> Result<(), String> {
    owner.validate_prepared(&prepared)?;
    let session = prepared.binding().session_id.clone();
    manager.run_native_session(&session, |cancelled| {
        let (sender, receiver) = mpsc::sync_channel(4);
        let native = std::thread::scope(|scope| -> Result<_, String> {
            let actor = std::thread::Builder::new()
                .name("native-checkpoints".into())
                .spawn_scoped(scope, move || {
                    let mut outcome = Ok(());
                    while let Ok(request) = receiver.recv() {
                        if let Err(error) =
                            runtime.block_on(store.acknowledge_native_checkpoint(owner, request))
                        {
                            outcome = Err(error);
                            break;
                        }
                    }
                    // Always attempt closure, even when acknowledgement delivery fails.
                    let closed = runtime.block_on(store.close_native_capture_owner(owner));
                    combine_results(outcome, closed)
                })
                .map_err(|_| "native checkpoint actor could not start")?;
            // Ownership of sender transfers to the executor; every return or
            // unwind disconnects the actor after its already queued work drains.
            let native = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                windows_process::execute_owned_host(host.0, host.1, prepared, sender, &cancelled)
            }))
            .unwrap_or_else(|_| Err("native capture panicked; cleanup unconfirmed".into()));
            let actor_result = actor.join().unwrap_or_else(|_| {
                Err("native checkpoint actor panicked; closure unconfirmed".into())
            });
            combine_results(native, actor_result)
        })?;
        match native {
            windows_process::NativeSettlement::Completed(confirmed) => {
                runtime.block_on(store.finalize_native_capture(owner, &confirmed))?;
                finish(Settled::Completed(Box::new(confirmed.into_reply())))
            }
            windows_process::NativeSettlement::ExitedUndelivered(exit) => {
                // Same fenced owner, launch and session closure as a capture,
                // recorded as a distinct terminal state that nothing reads as
                // delivered. The final handler still revokes credentials.
                runtime.block_on(store.finalize_native_undelivered_exit(owner, &exit))?;
                finish(Settled::ExitedUndelivered {
                    exit_code: exit.exit().exit_code,
                })
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn simultaneous_native_actor_and_close_failures_keep_every_uncertainty() {
        let actor = combine_results::<()>(
            Err("acknowledgement lost".into()),
            Err("SQL closure unconfirmed".into()),
        );
        let result =
            combine_results::<()>(Err("native cleanup unconfirmed".into()), actor).unwrap_err();
        for expected in [
            "acknowledgement lost",
            "SQL closure unconfirmed",
            "native cleanup unconfirmed",
        ] {
            assert!(result.contains(expected), "missing {expected}: {result}");
        }
        assert_eq!(combine_results(Ok(7), Ok(())), Ok(7));
        assert_eq!(
            combine_results::<()>(Err("native".into()), Ok(())),
            Err("native".into())
        );
        assert_eq!(
            combine_results(Ok(7), Err("actor".into())),
            Err("actor".into())
        );
    }
}
