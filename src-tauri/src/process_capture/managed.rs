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

    /// KI-30: an undelivered exit must not settle while a checkpoint it already
    /// submitted is still being persisted. Otherwise the actor's acknowledgement
    /// finds no waiting owner and `run` retains the launch as unresolved.
    #[cfg(windows)]
    #[test]
    #[ignore = "requires built capture host; KI-30 undelivered exit checkpoint drain"]
    fn real_native_owned_host_waits_for_pending_checkpoints_after_an_undelivered_exit() {
        use crate::process_capture::{checkpoints::Stage, protocol};
        use sha2::{Digest, Sha256};
        let host = std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("pa-capture-host.exe");
        let hash = format!("{:x}", Sha256::digest(std::fs::read(&host).unwrap()));
        let dir = crate::testutil::TempDir::new("native-undelivered-drain");
        // Larger than the anonymous pipe buffer, so delivery cannot succeed
        // without the provider reading it.
        let input = vec![b'x'; 8192];
        let binding = protocol::Binding {
            run_id: "run-ki30".into(),
            session_id: "session-ki30".into(),
            process_instance: "attempt-ki30".into(),
            capability: "a".repeat(64),
            route_sha256: "b".repeat(64),
        };
        let launch = protocol::Launch {
            executable: host.to_string_lossy().into_owned(),
            executable_sha256: hash.clone(),
            // Unknown to the host binary: it exits 2 without reading stdin.
            args: vec!["--fixture-exit-before-input".into()],
            cwd: dir.path().to_string_lossy().into_owned(),
            environment: vec![],
            input_bytes: input.len(),
            input_sha256: format!("{:x}", Sha256::digest(&input)),
            output_limit: 1000,
            timeout_ms: 20_000,
        };
        let (mut wire, tail) = protocol::launch_parts(binding, launch, &input).unwrap();
        wire.extend(tail);
        let prepared = protocol::prepare_buffer(&wire).unwrap();
        let (sender, receiver) = mpsc::sync_channel(4);
        let cancelled = std::sync::atomic::AtomicBool::new(false);
        let (settlement, acknowledged) = std::thread::scope(|scope| {
            let actor = scope.spawn(move || {
                let mut acknowledged = Vec::new();
                while let Ok(request) = receiver.recv() {
                    let request: crate::process_capture::checkpoints::Request = request;
                    let stage = request.stage;
                    // Launch releases the input at once; every later checkpoint
                    // commits slowly, like a busy SQLite writer on a CI runner.
                    if stage != Stage::Launch {
                        std::thread::sleep(std::time::Duration::from_secs(3));
                    }
                    acknowledged.push((stage, request.acknowledge(Ok(()))));
                }
                acknowledged
            });
            let settlement =
                windows_process::execute_owned_host(&host, &hash, prepared, sender, &cancelled);
            (settlement, actor.join().unwrap())
        });
        match settlement {
            Ok(windows_process::NativeSettlement::ExitedUndelivered(exit)) => {
                assert_eq!(exit.exit().exit_code, 2);
            }
            Ok(windows_process::NativeSettlement::Completed(_)) => {
                panic!("undelivered fixture completed")
            }
            Err(error) => panic!("undelivered fixture failed: {error}"),
        }
        assert!(
            acknowledged.len() >= 2,
            "launch and process checkpoints expected: {acknowledged:?}"
        );
        assert!(
            acknowledged.iter().all(|(_, result)| result.is_ok()),
            "undelivered exit settled before its checkpoints were acknowledged: {acknowledged:?}"
        );
    }
}
