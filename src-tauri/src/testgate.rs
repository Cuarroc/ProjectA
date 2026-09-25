//! The test gate: run a project's test command inside one worker's worktree
//! and record whether it came back green.
//!
//! The gate is deliberately dumb. It knows one shell line per project (see
//! [`crate::store::detect_test_command`]), runs it where the worker's code
//! actually is, and writes down the verdict. It never decides *which* tests to
//! run, never parses their output, and never blocks anything else in the app.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::store::{now_unix_secs, Store, Worker, MSG_SYSTEM, TEST_FAIL, TEST_PASS, TEST_RUNNING};
use crate::workers;

mod candidate;

/// How long a single gate run may take before it is killed.
///
/// A test suite that hangs - a prompt nobody answers, a server that never binds,
/// a watcher started by mistake - would otherwise pin its worker in `running`
/// for the rest of the session: the board would keep showing a test in flight,
/// and the debounce would never let another run start. Ten minutes is well past
/// any suite worth gating on, and being killed counts as a failure, which is
/// the honest answer: nobody saw these tests go green.
///
/// Within one session, and only that. A gate that was still running when the
/// app was closed leaves its `running` behind in the database, where no
/// timeout can reach it; [`clear_stale_test_runs`] is what frees those, at the
/// next startup.
pub const TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// How often the child is looked at while the gate waits for it.
const POLL_INTERVAL: Duration = Duration::from_millis(50);

/// How long the drain threads get to hand over the last of the output once the
/// child itself is gone. Bounded, because the whole point of not joining them
/// is that a pipe can outlive the process that was gated on.
const DRAIN_GRACE: Duration = Duration::from_millis(500);

/// Appended to the captured output when a run is killed for exceeding
/// [`TIMEOUT`].
///
/// The verdict does not depend on it - [`run_command`] reports the timeout as a
/// flag of its own - but the tail that lands in the worker's log would
/// otherwise stop mid-sentence with no hint that anyone pulled the plug.
pub const TIMEOUT_MARKER: &str = "[projecta] test gate timed out";

/// How many trailing lines of the run are kept in the worker's message log.
const TAIL_LINES: usize = 50;

/// How much captured output is held in memory while a run is in flight. Only
/// the tail is ever reported, so a chatty suite must not be allowed to grow
/// without bound.
const OUTPUT_CAP: usize = 64 * 1024;

/// The exit code and timeout flag of a finished - or killed - run, mapped to
/// the status that goes into the database.
///
/// Only a process that ran to completion *and* returned zero passes. Everything
/// else is a failure: a non-zero code, a run ended by a signal with no code at
/// all, and our own timeout kill. The kill needs a flag of its own because it
/// leaves no distinctive code behind: on Windows it looks like an ordinary
/// non-zero exit, and a suite that raced the deadline could even be reaped with
/// a zero one.
pub fn gate_result(exit_code: Option<i32>, timed_out: bool) -> &'static str {
    if timed_out {
        return TEST_FAIL;
    }
    match exit_code {
        Some(0) => TEST_PASS,
        _ => TEST_FAIL,
    }
}

/// The last `max` lines of `output`, with trailing blank lines dropped so the
/// log entry does not end in whitespace.
fn tail_lines(output: &str, max: usize) -> String {
    let lines: Vec<&str> = output.lines().collect();
    let start = lines.len().saturating_sub(max);
    lines[start..].join("\n").trim_end().to_string()
}

/// Run the project's test command for one worker and record the verdict.
///
/// Errors are for the things that make a run impossible - an unknown worker, a
/// project without a gate, a worktree that is no longer on disk. A gate that
/// runs and comes back red is not an error: it is a `fail` on the worker.
pub async fn run_test_gate(store: &Store, worker_id: &str) -> Result<Worker, String> {
    let worker = worker_or_err(store, worker_id).await?;
    let project = store
        .get_project(&worker.project_id)
        .await?
        .ok_or_else(|| format!("unknown project: {}", worker.project_id))?;
    let setup_trust = store
        .get_setup_trust(&project.id)
        .await?
        .map(|row| row.grant());
    // Only for the note in the no-git legacy branch below — every trust
    // decision reads `baseline.setup_command`, never this flag.
    let setup_configured = store.get_setup_command(&project.id).await?.is_some();
    let project_repo = PathBuf::from(&project.repo_path);
    let run_worker_id = worker.id.clone();
    // A setup command is never a substitute test: without a real test command
    // the gate refuses instead of minting a synthetic green (review-F4-r1).
    let command = project
        .test_command
        .clone()
        .ok_or_else(|| format!("project {} has no test command", project.id))?;
    let cwd = PathBuf::from(&worker.worktree_path);
    if !cwd.is_dir() {
        return Err(format!(
            "worker {worker_id} has no worktree at {}",
            worker.worktree_path
        ));
    }

    // Published before the run, so the board can show a test in flight and the
    // trigger in `status.rs` has something to debounce against.
    store
        .set_worker_test_status(worker_id, Some(TEST_RUNNING), None)
        .await?;

    // The old green goes first: for the duration of the run there is no valid
    // test evidence at all, so a failed rerun (or a failed evidence write) can
    // never leave a stale pass standing. The tuple the run starts against is
    // what the verdict is bound to afterwards.
    let code_before = match workers::record_candidate_run_started(store, &worker, &project).await {
        Ok(code) => code,
        Err(err) => {
            release_test_status(store, worker_id).await;
            return Err(err);
        }
    };

    let baseline = code_before.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let Some(baseline) = baseline else {
            if crate::readiness::rev_parse(&cwd, "HEAD").is_ok() {
                return (None, false, "No clean merge candidate; commit changes or resolve the conflict and rerun".into(), false);
            }
            let (exit, timeout, mut output) = run_command(&command, &cwd);
            if setup_configured {
                // No git, no merge candidate — and the whole setup branch is
                // part of the candidate. Say so instead of skipping silently.
                // Deliberately NOT running setup here (review-F4-r15, Sonnet
                // Fund 4): without git there is no isolation, and executing a
                // mutating setup command in the worker's real worktree is
                // worse than skipping it. The test command itself is
                // owner-configured and runs as it always has (pre-F4 legacy).
                output.push_str("\n[projecta] setup command configured but not run: no git, no merge candidate");
            }
            return (exit, timeout, output, false);
        };
        let candidate = match candidate::Candidate::prepare(&baseline.repo, &baseline.code) {
            Ok(candidate) => candidate,
            Err(err) => return (None, false, err, false),
        };
        if let Some(setup) = baseline.setup_command.as_deref() {
            // Trust is checked against the merge tree's committed blobs — the
            // exact bytes the display and the approval hashed — never against
            // whatever the checkout's clean/smudge filters put on disk.
            let current = match crate::setupgate::grant_for_tree(
                &project_repo,
                &baseline.repo,
                &baseline.code,
                setup,
            ) {
                Ok(grant) => grant,
                Err(err) => return (None, false, err, false),
            };
            let record = crate::setupgate::candidate_run_path(
                &cwd,
                &run_worker_id,
                &baseline.code,
                baseline.setup_command.as_deref(),
            );
            // One record+log pair per worker+candidate tuple, overwritten on
            // a rerun; older trees' pairs are swept after the run, or every
            // agent commit would pile up beside the worktree (r17, Opus 1a).
            let log = record.with_extension("log");
            let outcome = crate::setupgate::run_if_trusted(setup, candidate.path(), setup_trust.as_ref(), &current,
                &log, &record, crate::setupgate::TIMEOUT);
            if outcome.is_ok() {
                crate::setupgate::prune_candidate_runs(
                    &record,
                    &crate::readiness::acceptance_hash(&run_worker_id),
                );
            }
            match outcome {
                Ok(run) if run.ok => {}
                Ok(run) => return (None, run.timed_out, format!("Setup failed; log: {}", run.log_path), false),
                Err(trust) => return (None, false, format!("Setup trust {trust:?}; review the candidate inputs and approve setup first"), false),
            }
        }
        let (exit, timeout, mut output) = run_command(&command, candidate.path());
        // Validation decides the evidence; cleanup is housekeeping. A
        // transient cleanup failure (locked file, AV scan) must not void a
        // proven run — Drop retries it, and the note stays in the output.
        let validation = candidate.validate(&baseline.code);
        if let Err(err) = candidate.cleanup() {
            output.push_str(&format!("\n[projecta] candidate cleanup failed (retried on drop): {err}"));
        }
        if let Err(err) = &validation {
            output.push_str(&format!("\n[projecta] {err}"));
        }
        (exit, timeout, output, validation.is_ok())
    }).await;
    let (exit_code, timed_out, output, candidate_valid) = match outcome {
        Ok(outcome) => outcome,
        Err(e) => {
            // Nothing will write a verdict now, so the flag set above has to
            // come off here. `run_test_gate_if_due` reads `running` as "a run
            // is already in flight" and would refuse this worker a gate for
            // the rest of the session - and the merge that depends on it.
            release_test_status(store, worker_id).await;
            return Err(format!("test gate did not finish: {e}"));
        }
    };

    let status = gate_result(exit_code, timed_out);
    store
        .set_worker_test_status(worker_id, Some(status), Some(now_unix_secs()))
        .await?;
    // The legacy flag above is display. What the merge preflight reads is the
    // same verdict bound to the merge-tree tuple (F0-3); without git there is
    // no tuple and readiness says so itself. A head or base that moved during
    // the run means the verdict belongs to code that no longer exists.
    workers::record_test_evidence(
        store,
        &worker,
        &project,
        status == TEST_PASS,
        code_before.filter(|_| candidate_valid),
    )
    .await;
    workers::log_message(
        store,
        worker_id,
        MSG_SYSTEM,
        &format!("Test gate: {status}\n{}", tail_lines(&output, TAIL_LINES)),
    );
    worker_or_err(store, worker_id).await
}

/// Run the gate only if this worker is actually due for one.
///
/// This is what the automatic trigger calls, and it is where "once" is decided:
/// a worker with a run already in flight is left alone, and so is one that has
/// already passed - re-running a green gate would only cost a test suite per
/// poll. [`run_test_gate`] itself stays unconditional, so the manual command
/// can always ask for a fresh run.
///
/// "Once" is decided by [`Store::claim_test_gate`] rather than by reading the
/// worker here, and that is the whole point of the split. The trigger in
/// `status.rs` is fire-and-forget on whichever thread saw the transition, so
/// two of them genuinely overlap: a plain read-then-run lets both observe a
/// worker that is due before either writes [`TEST_RUNNING`], and the project's
/// suite runs twice in one worktree. The claim is a single conditional
/// statement, so exactly one caller gets the `true` and the other one leaves.
///
/// The project is looked at *before* the claim, because a project without a
/// gate must not be left holding a `running` flag for a run that was never
/// going to happen - and if [`run_test_gate`] then fails on something only it
/// can see, the claim is released again, for the same reason.
pub async fn run_test_gate_if_due(
    store: &Store,
    worker_id: &str,
) -> Result<Option<Worker>, String> {
    let worker = worker_or_err(store, worker_id).await?;
    let gated = store
        .get_project(&worker.project_id)
        .await?
        .is_some_and(|project| project.test_command.is_some());
    if !gated {
        return Ok(None);
    }
    if !store.claim_test_gate(worker_id).await? {
        return Ok(None);
    }
    match run_test_gate(store, worker_id).await {
        Ok(worker) => Ok(Some(worker)),
        Err(err) => {
            release_test_status(store, worker_id).await;
            Err(err)
        }
    }
}

/// Take a worker's `running` flag off again, leaving it as if the gate had
/// never run.
///
/// `NULL` rather than [`TEST_FAIL`]: a run that was interrupted produced no
/// verdict at all, and calling that red would block the merge on evidence
/// nobody ever gathered. `tested_at` goes with it - it belonged to a verdict
/// that `running` has already overwritten.
///
/// Best effort by design: this runs on paths that are already failing, and a
/// second error on top of the first would only bury it.
async fn release_test_status(store: &Store, worker_id: &str) {
    if let Err(err) = store.set_worker_test_status(worker_id, None, None).await {
        eprintln!("projecta: could not clear the test flag of {worker_id}: {err}");
    }
}

/// Free every worker left in [`TEST_RUNNING`] by a previous run of the app,
/// and report how many there were.
///
/// A gate can take ten minutes, and the commonest way to interrupt one needs
/// no failure at all: the user closes the window while it runs. The flag then
/// survives in the database with no process behind it, and because
/// [`run_test_gate_if_due`] reads `running` as "already in flight", that
/// worker never gets an automatic gate again - the merge stays refused, and
/// only the unconditional manual command still gets through.
///
/// Called from the startup reattach pass, where every gate this app knows
/// about is by definition not running yet.
pub async fn clear_stale_test_runs(store: &Store) -> Result<usize, String> {
    let workers = store.list_workers(None).await?;
    let stale: Vec<String> = workers
        .into_iter()
        .filter(|worker| worker.test_status.as_deref() == Some(TEST_RUNNING))
        .map(|worker| worker.id)
        .collect();

    for worker_id in &stale {
        release_test_status(store, worker_id).await;
        workers::log_message(
            store,
            worker_id,
            MSG_SYSTEM,
            "Test gate was still running when the app closed; cleared so it can run again",
        );
    }
    Ok(stale.len())
}

async fn worker_or_err(store: &Store, worker_id: &str) -> Result<Worker, String> {
    store
        .get_worker(worker_id)
        .await?
        .ok_or_else(|| format!("unknown worker: {worker_id}"))
}

/// The gate is a *shell* line, not a program: a project carrying both manifests
/// is gated on `npm test && cargo test --quiet`, and `&&` means nothing to the
/// operating system's process loader. `cfg!` rather than `#[cfg]` keeps both
/// arms compiling everywhere.
fn shell_command(command: &str) -> Command {
    let mut shell = if cfg!(windows) {
        crate::proc::command("cmd")
    } else {
        crate::proc::command("sh")
    };
    shell.arg(if cfg!(windows) { "/C" } else { "-c" });
    // cmd.exe is not a C runtime: `Command::arg` would CRT-quote the line,
    // re-wrapping quotes the test command already carries. `raw_arg` hands it
    // over untouched. `sh -c` takes the line as one argument, so the Unix arm
    // keeps `arg`. This arm needs `#[cfg]`: `raw_arg` exists only on Windows.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        shell.raw_arg(command);
    }
    #[cfg(not(windows))]
    shell.arg(command);
    // The gate's child is an interpreter, and a suite is whatever it starts
    // underneath. The timeout has to reach that, not just the shell.
    crate::oneshot::detach_process_group(&mut shell);
    shell
}

/// Run `command` in `cwd`, capturing stdout and stderr together, and give up
/// after [`TIMEOUT`].
fn run_command(command: &str, cwd: &Path) -> (Option<i32>, bool, String) {
    run_command_with_timeout(command, cwd, TIMEOUT)
}

/// [`run_command`] with the deadline as a parameter, so a test can prove what
/// the wait actually waits for without sitting out the full [`TIMEOUT`].
///
/// `std::process::Command` has no timeout, so the wait is built out of the
/// pieces the standard library does have: the child is polled with `try_wait`
/// until it is gone or the deadline passes, while two threads drain its pipes
/// into a shared buffer so that a chatty suite cannot fill one and block. On
/// expiry the child's whole process tree is killed and whatever was captured
/// so far is reported.
///
/// The wait watches the *child*, not the pipes, and that distinction is the
/// whole point. A pipe stays open as long as *any* write end does, and a suite
/// that leaves something behind - a dev server, a watcher, a stray `&` -
/// bequeaths its write end to that grandchild. Waiting for the pipes would
/// then mean waiting for the grandchild, and a green suite would be reported
/// as a timeout ten minutes after it passed.
fn run_command_with_timeout(
    command: &str,
    cwd: &Path,
    timeout: Duration,
) -> (Option<i32>, bool, String) {
    let mut child = match shell_command(command)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        // A command that cannot even be started is a failed gate, not a crash.
        Err(err) => return (None, false, format!("failed to start `{command}`: {err}")),
    };
    let mut tree = crate::oneshot::ProcessTree::attach(&child);

    let captured = Arc::new(Mutex::new(String::new()));
    let (done, closed) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        drain(stdout, Arc::clone(&captured), done.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        drain(stderr, Arc::clone(&captured), done.clone());
    }
    drop(done);

    let deadline = Instant::now() + timeout;
    let (status, timed_out) = loop {
        match child.try_wait() {
            Ok(Some(status)) => break (Some(status), false),
            Ok(None) => {}
            // The child cannot be observed any more, so there is nothing
            // left to wait for. No exit code reads as a failure below, which
            // is the honest verdict: nobody saw these tests go green.
            Err(_) => break (None, false),
        }
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break (None, true);
        }
        thread::sleep(left.min(POLL_INTERVAL));
    };

    let exit_code = if timed_out {
        // Everything the shell started, not just the shell: a suite killed
        // halfway through can have a compiler, a server and an agent under it,
        // and those would otherwise keep running - and keep writing into the
        // worktree - long after the gate reported.
        tree.kill(&mut child);
        None
    } else {
        let code = status.and_then(|status| status.code());
        // The shell may exit while its server/compiler children still write.
        // Reap this operation's descendants before validating its checkout.
        tree.kill(&mut child);
        code
    };

    // Let the drains hand over the last of the output, but only for a moment:
    // a grandchild that inherited a pipe can hold it open indefinitely, and
    // joining these threads is exactly the hang this function avoids. What is
    // in the buffer by then is what gets reported.
    await_drains(&closed, DRAIN_GRACE);
    let mut output = captured
        .lock()
        .map(|buffer| buffer.clone())
        .unwrap_or_default();
    if timed_out {
        output.push_str(&format!(
            "\n{TIMEOUT_MARKER} after {} s\n",
            timeout.as_secs()
        ));
    }
    (exit_code, timed_out, output)
}

/// Wait until every drain thread has reported EOF, or `grace` has passed.
fn await_drains(closed: &Receiver<()>, grace: Duration) {
    let deadline = Instant::now() + grace;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return;
        }
        match closed.recv_timeout(left) {
            // One pipe down; give the other the rest of the grace.
            Ok(()) => continue,
            // Disconnected: every drain is done. Timeout: out of patience.
            Err(_) => return,
        }
    }
}

/// Copy one pipe into the shared buffer until it closes, then report.
fn drain<R: Read + Send + 'static>(mut pipe: R, sink: Arc<Mutex<String>>, done: Sender<()>) {
    thread::spawn(move || {
        let mut chunk = [0u8; 4096];
        while let Ok(read) = pipe.read(&mut chunk) {
            if read == 0 {
                break;
            }
            let Ok(mut buffer) = sink.lock() else { break };
            buffer.push_str(&String::from_utf8_lossy(&chunk[..read]));
            if buffer.len() > OUTPUT_CAP {
                let mut cut = buffer.len() - OUTPUT_CAP;
                while !buffer.is_char_boundary(cut) {
                    cut += 1;
                }
                *buffer = buffer[cut..].to_string();
            }
        }
        let _ = done.send(());
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{WorkerRow, KIND_WORKER, STATUS_RUNNING};
    use crate::testutil::TempDir;

    #[test]
    fn a_quoted_windows_test_command_is_not_crt_quoted_for_cmd() {
        let source = include_str!("testgate.rs");
        let shell_command = source
            .split("fn shell_command(command: &str)")
            .nth(1)
            .and_then(|rest| rest.split("fn run_command(").next())
            .expect("shell_command source");
        assert!(
            shell_command.contains("raw_arg(command)"),
            "cmd /C receives the test line through Command::arg, which applies CRT quoting that cmd.exe does not parse:\n{shell_command}"
        );
    }

    #[test]
    fn the_verdict_follows_the_exit_code_and_recognises_a_timeout() {
        // Success: the only way to pass.
        assert_eq!(gate_result(Some(0), false), TEST_PASS);
        // Failure: the suite ran and said no.
        assert_eq!(gate_result(Some(1), false), TEST_FAIL);
        // Ended by a signal, so no code at all - not evidence of green.
        assert_eq!(gate_result(None, false), TEST_FAIL);
        // Timeout: a fail whatever the kill left behind, including the zero a
        // suite that raced the deadline could be reaped with.
        assert_eq!(gate_result(Some(1), true), TEST_FAIL);
        assert_eq!(gate_result(None, true), TEST_FAIL);
        assert_eq!(gate_result(Some(0), true), TEST_FAIL);
    }

    #[test]
    fn every_nonzero_exit_code_is_red_even_at_integer_extremes() {
        for code in [i32::MIN, -255, -1, 1, 2, 255, i32::MAX] {
            assert_eq!(gate_result(Some(code), false), TEST_FAIL, "exit {code}");
        }
    }

    #[test]
    fn the_log_entry_keeps_the_last_lines_only() {
        let output: String = (1..=120).map(|n| format!("line {n}\n")).collect();
        let tail = tail_lines(&output, TAIL_LINES);
        assert!(tail.starts_with("line 71"), "{tail}");
        assert!(tail.ends_with("line 120"), "{tail}");
        assert_eq!(tail.lines().count(), TAIL_LINES);
        // Short output survives whole, without the trailing blank line.
        assert_eq!(tail_lines("one\ntwo\n", TAIL_LINES), "one\ntwo");
    }

    /// A shell line that exits 0 at once but leaves a background process
    /// holding the write end of its pipes for several seconds.
    ///
    /// This is the everyday shape of the bug, not a contrived one: any suite
    /// that starts a server, a watcher or a `&` job and does not collect it
    /// ends exactly like this.
    const LEAKS_A_PIPE: &str = if cfg!(windows) {
        "start /B ping -n 6 127.0.0.1 & exit 0"
    } else {
        "sleep 5 & exit 0"
    };

    /// A shell that is still running at the deadline, with a background
    /// descendant that holds a file in the working directory open.
    #[cfg(windows)]
    const LEAKS_A_TREE: &str =
        "start /B cmd /C ping -n 20 127.0.0.1 > held.txt & ping -n 20 127.0.0.1";
    /// The same, but the descendant reports its own pid so the test can ask
    /// the operating system whether it is still there.
    #[cfg(unix)]
    const LEAKS_A_TREE: &str = "sleep 20 & echo pid=$! ; sleep 20";

    /// The wait is about the child, not about its pipes. A suite that exits
    /// green while something it started still holds the pipe open must be
    /// reported green *now* - not as a timeout ten minutes later, with the
    /// merge blocked and the card stuck on "test running".
    #[test]
    fn a_green_suite_that_leaks_a_pipe_is_not_a_timeout() {
        let dir = TempDir::new("testgate-pipe");
        let started = Instant::now();
        let (exit_code, timed_out, _output) =
            run_command_with_timeout(LEAKS_A_PIPE, dir.path(), Duration::from_secs(3));
        let elapsed = started.elapsed();

        assert!(!timed_out, "a shell that exited 0 is not a timeout");
        assert_eq!(exit_code, Some(0));
        assert_eq!(gate_result(exit_code, timed_out), TEST_PASS);
        assert!(
            elapsed < Duration::from_secs(2),
            "the wait followed the pipe, not the child: {elapsed:?}"
        );
    }

    /// The kill has to reach what the shell started. On Windows the proof is
    /// the working directory: a live descendant holds a file in it open, and
    /// Windows refuses to delete a directory in that state - which is also
    /// exactly how a one-shot run loses its workspace.
    #[cfg(windows)]
    #[test]
    fn a_timeout_takes_the_whole_process_tree_with_it() {
        let dir = TempDir::new("testgate-tree");
        let cwd = dir.path().join("run");
        std::fs::create_dir_all(&cwd).expect("mkdir");

        let (_code, timed_out, _output) =
            run_command_with_timeout(LEAKS_A_TREE, &cwd, Duration::from_secs(1));
        assert!(timed_out, "the shell was supposed to outlive the deadline");

        // Termination is asynchronous enough that the handle can outlive the
        // call by a moment; the descendant, if it survived, holds it for the
        // best part of twenty seconds.
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut last = std::fs::remove_dir_all(&cwd);
        while last.is_err() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(100));
            last = std::fs::remove_dir_all(&cwd);
        }
        assert!(
            last.is_ok(),
            "a descendant is still holding the worktree: {last:?}"
        );
    }

    /// `kill -0` asks "does this pid have a slot", not "is this process
    /// running". A process that exited but was never reaped keeps its slot as
    /// a zombie, and `kill -0` answers yes. Containers without a reaping init
    /// keep zombies around for the whole run, which is why the group test
    /// below was red in 7 of 10 Linux runs (gemessen 03.09.2026).
    ///
    /// This is the deterministic reproduction: a child that exits and is
    /// never waited on IS a zombie, every time.
    // `cfg(target_os = "linux")`, nicht `cfg(unix)`: der Test wartet auf den
    // Zustand `Z` in `/proc/<pid>/stat`, und procfs gibt es auf macOS und den
    // BSDs nicht. Unter `cfg(unix)` waere er dort nach 5 s Timeout rot - mit
    // der irrefuehrenden Meldung, das Kind habe den Zombie-Zustand nie
    // erreicht. Die Helfer selbst bleiben `cfg(unix)`, sie haben fuer genau
    // diesen Fall den dokumentierten kill-0-Rueckfall.
    // (Befund des externen Dual-Reviews zu PR #29, Grok-Protokoll.)
    #[cfg(target_os = "linux")]
    #[test]
    fn a_zombie_is_not_alive_even_though_kill_zero_finds_it() {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("exit 0")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("the shell starts");
        let pid = child.id().to_string();

        // No wait() until the end of the test, so the slot stays a zombie.
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while proc_state(&pid) != Some('Z') {
            assert!(
                std::time::Instant::now() < deadline,
                "the child never reached the zombie state"
            );
            std::thread::sleep(Duration::from_millis(10));
        }

        assert!(
            kill_zero_finds(&pid),
            "kill -0 was supposed to find the zombie's slot - that is the trap"
        );
        assert!(
            !process_is_alive(&pid),
            "a zombie has exited, so it is not alive"
        );

        let _ = child.wait();
    }

    /// The unix half of the same finding: the child leads its own process
    /// group, so the kill reaches the group and the background job goes with
    /// it.
    #[cfg(unix)]
    #[test]
    fn a_timeout_takes_the_whole_process_group_with_it() {
        let dir = TempDir::new("testgate-tree");
        let (_code, timed_out, output) =
            run_command_with_timeout(LEAKS_A_TREE, dir.path(), Duration::from_secs(1));
        assert!(timed_out, "the shell was supposed to outlive the deadline");

        let pid = output
            .lines()
            .find_map(|line| line.trim().strip_prefix("pid="))
            .expect("the background job reported its pid")
            .to_string();

        // Der Gruppen-Kill ist asynchron: `kill -9 -- -pgid` kehrt zurueck,
        // bevor der Kernel den Hintergrundjob durch `do_exit` geschoben hat.
        // Die einzige Synchronisation davor ist `await_drains`, und die wartet
        // die DRAIN_GRACE nicht ab - sie kehrt beim EOF der Pipe zurueck, und
        // die Deskriptoren schliesst der Kernel VOR dem Zustandswechsel.
        // Gemessen: 1,0-5,1 ms statt 500 ms, der Job stirbt ~1,1 ms nach dem
        // Messpunkt. Ohne diese Schleife ist der Test auf einem 2-vCPU-Runner
        // in 2 von 9 Vollsuiten rot (06.09.2026).
        //
        // Dieselbe Warteschleife hat die Windows-Schwester weiter oben schon;
        // sie fehlte hier, weil der Zombie-Fix nur die Frage "laeuft der
        // Prozess" repariert hat, nicht den Zeitpunkt, zu dem sie gestellt wird.
        //
        // Das Urteil ist die letzte Lesung der Schleife, keine zweite danach
        // (KI-25). Ein gelesener Endzustand - kein Eintrag, `Z` oder `X` -
        // kehrt nicht in einen laufenden zurueck. Eine spaetere Lesung koennte
        // nur noch einen anderen Prozess unter derselben, wiedervergebenen pid
        // treffen. Gemessen ist diese Wiedervergabe nicht - die Ursache des
        // roten Laufs war der Zustand X (siehe
        // `a_process_being_reaped_is_not_alive`). "Kein Eintrag" heisst auch
        // "Lesefehler"; bei einem lebenden Prozess gab es davon in 2 Mio.
        // Lesungen unter Last keinen (gemessen 25.09.2026, Review PR #138).
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut alive = process_is_alive(&pid);
        while alive && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
            alive = process_is_alive(&pid);
        }
        assert!(!alive, "background job {pid} survived the timeout");
    }

    /// Does the pid have a slot? Coarse on purpose - see the zombie test.
    #[cfg(unix)]
    fn kill_zero_finds(pid: &str) -> bool {
        Command::new("kill")
            .args(["-0", pid])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    /// The state character from `/proc/<pid>/stat`. The command name sits in
    /// parentheses and may itself contain spaces and parentheses, so the
    /// fields are read after the *last* `)`.
    #[cfg(unix)]
    fn proc_state(pid: &str) -> Option<char> {
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        stat.rsplit_once(')')?.1.trim_start().chars().next()
    }

    /// Is the process behind this pid actually running? `/proc/<pid>/stat`
    /// separates the two cases `kill -0` conflates: no entry means the slot
    /// is gone, state `Z` or `X` means the process exited and only the slot
    /// is left. None of these counts as alive.
    ///
    /// On a unix without `/proc` there is nothing better than the coarse
    /// question, so it stays as the fallback - documented, not silent.
    #[cfg(unix)]
    fn process_is_alive(pid: &str) -> bool {
        if !std::path::Path::new("/proc").is_dir() {
            return kill_zero_finds(pid);
        }
        proc_state(pid).is_some_and(state_is_running)
    }

    /// Does this state character from `/proc/<pid>/stat` mean the process is
    /// still running? `Z` has exited and waits to be reaped; `X` (`x` on
    /// Linux 2.6.33 to 3.13) is being reaped right now and vanishes a moment later -
    /// see the test below for why the second one matters.
    #[cfg(unix)]
    fn state_is_running(state: char) -> bool {
        !matches!(state, 'Z' | 'X' | 'x')
    }

    /// KI-25 (W1-29): der Kernel zeigt auf dem Weg vom Zombie zum Verschwinden
    /// einen weiteren Zustand. Wer den Zombie abholt (`wait_task_zombie`),
    /// setzt ihn erst auf `X` (EXIT_DEAD) und haengt ihn danach aus; in dem
    /// Fenster liest `/proc/<pid>/stat` ein `X`. Gemessen 24.09.2026: in 136
    /// von 300 Laeufen folgte auf `Z` direkt `X`. Der Gruppen-Test liest den
    /// Zustand zweimal hintereinander - Schleife, dann Assert -, und `Z`
    /// dann `X` hiess "tot", dann "lebt": der rote CI-Lauf 35630751744.
    ///
    /// Der Zustand ist hier eingespeist statt abgewartet, weil das Fenster
    /// nur Mikrosekunden breit ist; `x` ist dasselbe unter Linux 2.6.33 bis 3.13.
    #[cfg(unix)]
    #[test]
    fn a_process_being_reaped_is_not_alive() {
        for dead in ['Z', 'X', 'x'] {
            assert!(!state_is_running(dead), "state {dead} has exited");
        }
        for running in ['R', 'S', 'D', 'T', 't', 'I', 'P'] {
            assert!(state_is_running(running), "state {running} still runs");
        }
    }

    async fn gated(command: &str) -> (TempDir, Store, Worker) {
        let dir = TempDir::new("testgate");
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let project = store
            .create_project("one", &dir.path().to_string_lossy())
            .await
            .unwrap();
        store
            .set_project_test_command(&project.id, Some(command))
            .await
            .unwrap();
        let row = WorkerRow {
            id: "wk-1".to_string(),
            project_id: project.id.clone(),
            task: "do it".to_string(),
            profile_id: "claude".to_string(),
            branch: "pa/wk-1".to_string(),
            worktree_path: dir.path().to_string_lossy().to_string(),
            status: STATUS_RUNNING.to_string(),
            kind: KIND_WORKER.to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: None,
            tested_at: None,
            role_variant_id: None,
            paused_reason: None,
            created_at: 42,
        };
        store.insert_worker(&row).await.unwrap();
        let worker = store.get_worker("wk-1").await.unwrap().unwrap();
        (dir, store, worker)
    }

    /// A green command and a red one, through the real shell, end up on the
    /// worker - and the second run is what proves `run_test_gate` itself is
    /// unconditional.
    #[tokio::test]
    async fn a_run_records_pass_then_fail_on_the_worker() {
        let (_dir, store, worker) = gated("exit 0").await;
        let passed = run_test_gate(&store, &worker.id).await.unwrap();
        assert_eq!(passed.test_status.as_deref(), Some(TEST_PASS));
        assert!(passed.tested_at.is_some());

        store
            .set_project_test_command(&worker.project_id, Some("exit 3"))
            .await
            .unwrap();
        let failed = run_test_gate(&store, &worker.id).await.unwrap();
        assert_eq!(failed.test_status.as_deref(), Some(TEST_FAIL));
    }

    /// Same shape as `gated`, but the worktree is a real git repository, so
    /// the gate verdict has a merge-tree tuple to bind to (F0-3).
    async fn gated_git(command: &str) -> (TempDir, Store, Worker) {
        let dir = TempDir::new("testgate-git");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"))
            .to_string_lossy()
            .into_owned();
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let project = store.create_project("one", &repo).await.unwrap();
        store
            .set_project_test_command(&project.id, Some(command))
            .await
            .unwrap();
        let row = WorkerRow {
            id: "wk-1".to_string(),
            project_id: project.id.clone(),
            task: "do it".to_string(),
            profile_id: "claude".to_string(),
            branch: "pa/wk-1".to_string(),
            worktree_path: repo,
            status: STATUS_RUNNING.to_string(),
            kind: KIND_WORKER.to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: None,
            tested_at: None,
            role_variant_id: None,
            paused_reason: None,
            created_at: 42,
        };
        store.insert_worker(&row).await.unwrap();
        let worker = store.get_worker("wk-1").await.unwrap().unwrap();
        (dir, store, worker)
    }

    /// The legacy flag is not what readiness reads: a green gate must bind its
    /// verdict to the merge-tree tuple in `review_evidence`, or the merge
    /// preflight keeps saying `tests_stale` forever.
    #[tokio::test]
    async fn a_green_gate_binds_its_verdict_to_the_merge_tree_tuple() {
        let (_dir, store, worker) = gated_git("exit 0").await;
        run_test_gate(&store, &worker.id).await.unwrap();

        let row = store
            .get_review_evidence(&worker.id)
            .await
            .unwrap()
            .expect("the gate wrote merge-tree-bound evidence");
        let test = row.test_record().expect("a test record");
        assert!(test.passed);
        assert_eq!(
            test.verification_policy_hash,
            crate::readiness::verification_policy_hash("exit 0")
        );
        let project = store
            .get_project(&worker.project_id)
            .await
            .unwrap()
            .unwrap();
        let base = crate::gh::default_base_branch(&project.repo_path);
        let code = crate::readiness::measure_code(
            std::path::Path::new(&worker.worktree_path),
            &base,
            "HEAD",
        )
        .expect("git can measure the fixture");
        assert!(test.code.matches(&code));
    }

    #[tokio::test]
    async fn a_diverged_base_is_tested_without_changing_the_worker_checkout() {
        let command = if cfg!(windows) {
            "if not exist base-only.txt exit /b 7"
        } else {
            "test -f base-only.txt"
        };
        let (_dir, store, worker) = gated_git(command).await;
        let repo = Path::new(&worker.worktree_path);
        let git = |args: &[&str]| {
            let output = crate::proc::command("git")
                .arg("-C")
                .arg(repo)
                .args(args)
                .output()
                .expect("git");
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&["checkout", "-b", "worker"]);
        git(&["commit", "--allow-empty", "-m", "worker change"]);
        git(&["checkout", "main"]);
        std::fs::write(repo.join("base-only.txt"), "required base input\n").unwrap();
        git(&["add", "base-only.txt"]);
        git(&["commit", "-m", "base input"]);
        git(&["checkout", "worker"]);
        let before = crate::readiness::measure_code(repo, "main", "HEAD").unwrap();
        let result = run_test_gate(&store, &worker.id).await.unwrap();
        assert_eq!(
            result.test_status.as_deref(),
            Some(TEST_PASS),
            "tests must see the merge candidate's base files"
        );
        assert!(
            !repo.join("base-only.txt").exists(),
            "the worker checkout must remain unchanged"
        );
        assert_eq!(
            crate::readiness::measure_code(repo, "main", "HEAD").unwrap(),
            before
        );
        let evidence = store
            .get_review_evidence(&worker.id)
            .await
            .unwrap()
            .unwrap();
        let tested = evidence.test_record().expect("candidate-bound evidence");
        assert!(tested.passed);
        assert_eq!(tested.code, before);
    }

    #[tokio::test]
    async fn test_side_effects_stay_out_of_the_worker_checkout() {
        let (_dir, store, worker) = gated_git("echo isolated>candidate-output.txt").await;
        let result = run_test_gate(&store, &worker.id).await.unwrap();
        assert!(
            !Path::new(&worker.worktree_path)
                .join("candidate-output.txt")
                .exists(),
            "test output belongs to the disposable candidate, not the worker"
        );
        // Untracked build/test artifacts are the run's own business: the
        // disposable candidate may hold them and the verdict still binds —
        // only tracked-code tampering or a moved HEAD voids isolation.
        assert_eq!(
            result.test_status.as_deref(),
            Some(TEST_PASS),
            "the run's own artifacts must not void its verdict"
        );
        let evidence = store
            .get_review_evidence(&worker.id)
            .await
            .unwrap()
            .unwrap();
        assert!(
            evidence.test_record().is_some_and(|test| test.passed),
            "a passing run in a validated candidate binds its evidence"
        );
    }

    #[tokio::test]
    async fn configured_setup_requires_trust_before_running_tests() {
        let (_dir, store, worker) = gated_git("exit 0").await;
        store
            .set_setup_command(&worker.project_id, Some("exit 0"))
            .await
            .unwrap();
        let result = run_test_gate(&store, &worker.id).await.unwrap();
        assert_eq!(
            result.test_status.as_deref(),
            Some(TEST_FAIL),
            "setup without trust must prevent the test run"
        );
        assert!(!store
            .get_review_evidence(&worker.id)
            .await
            .unwrap()
            .and_then(|row| row.test_record())
            .is_some_and(|test| test.passed));
    }

    /// Review-F4-r1 (Sonnet Fund 1): a configured setup command must never
    /// turn into a synthetic green "exit 0" test run. Without a real test
    /// command the gate refuses — a badge saying "passed" without a test is
    /// a lie.
    #[tokio::test]
    async fn setup_without_a_test_command_is_no_synthetic_green() {
        let (_dir, store, worker) = gated_git("exit 0").await;
        store
            .set_project_test_command(&worker.project_id, None)
            .await
            .unwrap();
        store
            .set_setup_command(&worker.project_id, Some("exit 0"))
            .await
            .unwrap();
        let err = run_test_gate(&store, &worker.id)
            .await
            .expect_err("no test command, no gate run — setup is not a test");
        assert!(
            err.contains("no test command"),
            "the refusal says why: {err}"
        );
        let after = store.get_worker(&worker.id).await.unwrap().unwrap();
        assert_eq!(after.test_status, None, "no synthetic pass badge");
    }

    /// Task-F4 #4: children of the run end before validation and cleanup,
    /// even when the shell itself exits successfully. A survivor would write
    /// its marker after the gate returned.
    #[tokio::test]
    async fn children_of_a_successful_run_are_dead_before_cleanup() {
        let (dir, store, worker) = gated_git("PLACEHOLDER").await;
        // Without node the spawned child never exists and this test would
        // pass vacuously — fail loudly instead (review-F4-r12, k3 obs. 2).
        let node = crate::proc::command("node")
            .arg("--version")
            .output()
            .expect("node probe");
        assert!(node.status.success(), "this test needs node in PATH");
        let marker = dir.path().join("child-survived.txt");
        let child_js = dir.path().join("child.js");
        std::fs::write(
            &child_js,
            format!(
                "setTimeout(()=>require('fs').writeFileSync({:?},'x'),2500)",
                marker.to_string_lossy()
            ),
        )
        .expect("write child script");
        let command = if cfg!(windows) {
            format!("start \"\" /b node \"{}\"", child_js.to_string_lossy())
        } else {
            format!("node \"{}\" &", child_js.to_string_lossy())
        };
        store
            .set_project_test_command(&worker.project_id, Some(&command))
            .await
            .unwrap();

        run_test_gate(&store, &worker.id).await.unwrap();
        // Marker-Timer 2500 ms; 5000 ms Schlaf nach Gate-Rueckkehr laesst
        // auch unter Last genug Marge (review-F4-r15, Sonnet Fund 5).
        tokio::time::sleep(std::time::Duration::from_millis(5000)).await;
        assert!(
            !marker.exists(),
            "the run's background child must be reaped with the process tree"
        );
    }

    /// Review-F4-r24 (Opus Fund 2): die erste Batch-Fassung nutzte
    /// `hash-object --stdin-paths` — das C-unquotet Zeilen mit führendem `"`
    /// und strippt abschließendes `\r` (strbuf_getline): `x` und `"x"` (bzw.
    /// `x\r`) mit identischem Inhalt hätten die falsche Datei gehasht.
    /// Jetzt gehen Pfade als ARGUMENTE — es gibt kein Zeilenprotokoll mehr.
    /// Nur unix: Windows verbietet `"` und Steuerzeichen in Dateinamen
    /// (dort scheitert der Checkout solcher Bäume bereits fail-closed).
    #[cfg(unix)]
    #[tokio::test]
    async fn a_quoted_lookalike_path_cannot_hide_tampering() {
        let node = crate::proc::command("node")
            .arg("--version")
            .output()
            .expect("node probe");
        assert!(node.status.success(), "this test needs node in PATH");
        let (_dir, store, worker) = gated_git("node plant.js").await;
        let repo = Path::new(&worker.worktree_path);
        // `x` and `"x"` with identical content — identical blob OID.
        std::fs::write(repo.join("x"), "original\n").expect("write");
        std::fs::write(repo.join("\"x\""), "original\n").expect("write");
        std::fs::write(
            repo.join("plant.js"),
            "const fs=require('fs');fs.writeFileSync('\"x\"','tampered\\n');\n",
        )
        .expect("write plant script");
        for args in [
            vec!["add", "x", "\"x\"", "plant.js"],
            vec!["commit", "--no-gpg-sign", "-m", "lookalikes"],
        ] {
            let out = std::process::Command::new("git")
                .arg("-C")
                .arg(repo)
                .args(&args)
                .output()
                .expect("run git");
            assert!(
                out.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }

        let result = run_test_gate(&store, &worker.id).await.unwrap();
        assert_eq!(result.test_status.as_deref(), Some(TEST_PASS));
        assert!(
            !store
                .get_review_evidence(&worker.id)
                .await
                .unwrap()
                .and_then(|row| row.test_record())
                .is_some_and(|test| test.passed),
            "tampering on `\"x\"` must not hide behind the lookalike `x`"
        );
    }

    /// Review-F4-r24 (Opus Fund 1, blockierend): `refs/replace/*` liegt im
    /// GEMEINSAMEN git-common-dir und ersetzt beim Lesen den Inhalt eines
    /// Objekts bei unveränderter OID. Ein Lauf kann `git replace <tree_m>
    /// <tree_fake>` pflanzen; ohne Neutralisierung lesen Sweep, Checkout und
    /// validate den ERSATZ-Baum — getestet wird T_fake, gemergt wird T_m.
    /// Alle Mess-/Checkout-Spawns laufen mit GIT_NO_REPLACE_OBJECTS=1.
    #[tokio::test]
    async fn a_planted_replace_ref_never_reaches_the_candidate() {
        let node = crate::proc::command("node")
            .arg("--version")
            .output()
            .expect("node probe");
        assert!(node.status.success(), "this test needs node in PATH");
        let (dir, store, worker) = gated_git("node see.js").await;
        let repo = Path::new(&worker.worktree_path);
        let marker = dir.path().join("candidate-saw.txt");
        std::fs::write(repo.join("tracked.txt"), "real\n").expect("write");
        std::fs::write(
            repo.join("see.js"),
            format!(
                "require('fs').writeFileSync({:?},require('fs').readFileSync('tracked.txt','utf8'))",
                marker.to_string_lossy()
            ),
        )
        .expect("write see script");
        let git = |args: &[&str]| {
            let out = std::process::Command::new("git")
                .arg("-C")
                .arg(repo)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                out.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };
        git(&["add", "tracked.txt", "see.js"]);
        git(&["commit", "--no-gpg-sign", "-m", "real content"]);

        // A previous (hostile) run planted a replace ref: the merge tree now
        // reads as a harmless fake.
        let tree_m = git(&["merge-tree", "--write-tree", "main", "HEAD"]);
        let fake_blob = {
            let mut hasher = std::process::Command::new("git")
                .arg("-C")
                .arg(repo)
                .args(["hash-object", "-w", "--stdin"])
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .spawn()
                .expect("hash-object");
            use std::io::Write;
            hasher
                .stdin
                .as_mut()
                .expect("stdin")
                .write_all(b"fake\n")
                .expect("write");
            String::from_utf8_lossy(&hasher.wait_with_output().expect("hash").stdout)
                .trim()
                .to_string()
        };
        let see_blob = git(&["rev-parse", "HEAD:see.js"]);
        let fake_tree = {
            let input =
                format!("100644 blob {fake_blob}\ttracked.txt\n100644 blob {see_blob}\tsee.js\n");
            let mut mt = std::process::Command::new("git")
                .arg("-C")
                .arg(repo)
                .args(["mktree"])
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .spawn()
                .expect("mktree");
            use std::io::Write;
            mt.stdin
                .as_mut()
                .expect("stdin")
                .write_all(input.as_bytes())
                .expect("write");
            String::from_utf8_lossy(&mt.wait_with_output().expect("mktree").stdout)
                .trim()
                .to_string()
        };
        git(&["replace", &tree_m, &fake_tree]);

        run_test_gate(&store, &worker.id).await.unwrap();
        assert_eq!(
            std::fs::read_to_string(&marker).expect("the test command ran"),
            "real\n",
            "the candidate must contain the REAL tree, never the planted replacement"
        );
    }

    /// Review-F4-r23 (k3 Fund 1, blockierend): validate ging über
    /// filtervermittelte Hashes (`update-index --really-refresh` +
    /// `status --porcelain`). Ein Lauf, der im gemeinsamen git-common-dir
    /// einen Clean-Filter pflanzt, machte manipulierte Dateien unsichtbar —
    /// plattformübergreifend, ohne Zeitstempelfälschung. Jetzt: roher
    /// Byte-Vergleich, kein Filter je beteiligt.
    #[tokio::test]
    async fn a_run_hiding_tampering_behind_a_planted_clean_filter_binds_no_evidence() {
        let node = crate::proc::command("node")
            .arg("--version")
            .output()
            .expect("node probe");
        assert!(node.status.success(), "this test needs node in PATH");
        let (_dir, store, worker) = gated_git("node plant.js").await;
        let repo = Path::new(&worker.worktree_path);
        // Committed, "reviewed" test code — the attack travels inside the diff.
        std::fs::write(repo.join("tracked.txt"), "original\n").expect("write");
        std::fs::write(
            repo.join("plant.js"),
            "const{execSync,execFileSync}=require('child_process');const fs=require('fs');const path=require('path');\
             const common=execSync('git rev-parse --git-common-dir').toString().trim();\
             fs.writeFileSync('tracked.txt','tampered\\n');\
             fs.appendFileSync(path.join(common,'info','attributes'),'tracked.txt filter=hide\\n');\
             execFileSync('git',['config','--file',path.join(common,'config'),'filter.hide.clean','printf original\\n']);\n",
        )
        .expect("write plant script");
        for args in [
            vec!["add", "tracked.txt", "plant.js"],
            vec!["commit", "--no-gpg-sign", "-m", "plant"],
        ] {
            let out = std::process::Command::new("git")
                .arg("-C")
                .arg(repo)
                .args(&args)
                .output()
                .expect("run git");
            assert!(
                out.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }

        let result = run_test_gate(&store, &worker.id).await.unwrap();
        assert_eq!(
            result.test_status.as_deref(),
            Some(TEST_PASS),
            "the run itself passed (exit 0) — the tamper shows in the binding"
        );
        assert!(
            !store
                .get_review_evidence(&worker.id)
                .await
                .unwrap()
                .and_then(|row| row.test_record())
                .is_some_and(|test| test.passed),
            "a planted clean filter must not launder tampered bytes into bound evidence"
        );
    }

    /// Review-F4-r23 (Opus Fund 3): der Sweep muss VOR `worktree add`
    /// feuern — danach hat der committed Filter bereits gefetcht/ausgeführt.
    /// Der installierte Treiber (hier: simulierter, wie git-lfs auf einer
    /// echten Maschine) schreibt bei Ausführung einen Marker; die
    /// Verweigerung nach dem Checkout liefe zu spät.
    #[tokio::test]
    async fn prepare_never_runs_a_smudge_filter_of_an_unreviewed_tree() {
        let node = crate::proc::command("node")
            .arg("--version")
            .output()
            .expect("node probe");
        assert!(node.status.success(), "this test needs node in PATH");
        let (dir, store, worker) = gated_git("exit 0").await;
        let repo = Path::new(&worker.worktree_path);
        let marker = dir.path().join("smudge-ran.txt");
        let smudge_js = repo.join("smudge.js");
        std::fs::write(
            &smudge_js,
            format!(
                "require('fs').writeFileSync({:?},'ran')",
                marker.to_string_lossy()
            ),
        )
        .expect("write smudge script");
        std::fs::write(repo.join("x.bin"), "pointer\n").expect("write");
        std::fs::write(repo.join(".gitattributes"), "x.bin filter=rec\n").expect("write");
        for args in [
            vec!["add", "."],
            vec!["commit", "--no-gpg-sign", "-m", "filtered"],
        ] {
            let out = std::process::Command::new("git")
                .arg("-C")
                .arg(repo)
                .args(&args)
                .output()
                .expect("run git");
            assert!(
                out.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }
        // The driver lives in the repo config — like git-lfs on a real host.
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(repo)
            .args([
                "config",
                "filter.rec.smudge",
                &format!("node \"{}\"", smudge_js.to_string_lossy()),
            ])
            .output()
            .expect("run git");
        assert!(
            out.status.success(),
            "git config: {}",
            String::from_utf8_lossy(&out.stderr)
        );

        let result = run_test_gate(&store, &worker.id).await.unwrap();
        assert_eq!(result.test_status.as_deref(), Some(TEST_FAIL));
        assert!(
            !marker.exists(),
            "the smudge driver must NEVER run on an unreviewed tree"
        );
        // And no candidate residue: no admin entry, no temp root.
        let worktrees = std::process::Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["worktree", "list", "--porcelain"])
            .output()
            .expect("run git");
        assert_eq!(
            String::from_utf8_lossy(&worktrees.stdout)
                .lines()
                .filter(|line| line.starts_with("worktree "))
                .count(),
            1,
            "no candidate worktree may remain: {}",
            String::from_utf8_lossy(&worktrees.stdout)
        );
    }

    /// Review-F4-r22 (Opus Fund 1, blockierend): der Ganz-Baum-Attribut-Sweep
    /// gehört zum KANDIDATEN, nicht zum Setup-Kommando. Ohne Setup-Kommando
    /// lief der Test gegen gesmudgte Bytes, die niemand las — und die
    /// Evidence band trotzdem. Ein transformierendes Attribut irgendwo im
    /// Baum verweigert den Lauf, BEVOR der Checkout passiert.
    #[tokio::test]
    async fn a_filtered_tree_without_a_setup_command_binds_no_evidence() {
        let (_dir, store, worker) = gated_git("exit 0").await;
        let repo = Path::new(&worker.worktree_path);
        std::fs::create_dir_all(repo.join("scripts")).expect("mkdir");
        std::fs::write(repo.join("scripts/build.sh"), "pointer\n").expect("write");
        std::fs::write(repo.join(".gitattributes"), "scripts/* filter=lfs\n").expect("write");
        for args in [
            vec!["add", "."],
            vec!["commit", "--no-gpg-sign", "-m", "filtered tree"],
        ] {
            let out = std::process::Command::new("git")
                .arg("-C")
                .arg(repo)
                .args(&args)
                .output()
                .expect("run git");
            assert!(
                out.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }

        let result = run_test_gate(&store, &worker.id).await.unwrap();
        assert_eq!(
            result.test_status.as_deref(),
            Some(TEST_FAIL),
            "a tree carrying transforming attributes must not run at all"
        );
        assert!(!store
            .get_review_evidence(&worker.id)
            .await
            .unwrap()
            .and_then(|row| row.test_record())
            .is_some_and(|test| test.passed));
    }

    /// Review-F4-r14 (Sonnet Befund 3): derselbe Reap-Vertrag wie oben, aber
    /// durch die volle Pipeline — `run_test_gate` → `Candidate::prepare` →
    /// `grant_for_tree` → `run_if_trusted` → `validate` → `cleanup`. Eine
    /// Regression in der Verdrahtung des Setup-Aufrufs (falscher cwd, falscher
    /// Record-Pfad) darf nicht hinter dem Direktaufruf-Test in setupgate
    /// verschwinden.
    #[tokio::test]
    async fn children_of_a_setup_run_in_the_pipeline_are_dead_before_cleanup() {
        let (dir, store, worker) = gated_git("exit 0").await;
        // Without node the spawned child never exists and this test would
        // pass vacuously — fail loudly instead (Muster: siehe oben).
        let node = crate::proc::command("node")
            .arg("--version")
            .output()
            .expect("node probe");
        assert!(node.status.success(), "this test needs node in PATH");
        let repo = Path::new(&worker.worktree_path);
        std::fs::write(repo.join("package-lock.json"), "{}\n").expect("write lockfile");
        for args in [
            vec!["add", "package-lock.json"],
            vec!["commit", "--no-gpg-sign", "-m", "lockfile"],
        ] {
            let out = std::process::Command::new("git")
                .arg("-C")
                .arg(repo)
                .args(&args)
                .output()
                .expect("run git");
            assert!(
                out.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }
        let marker = dir.path().join("setup-child-survived.txt");
        let child_js = dir.path().join("setup-child.js");
        std::fs::write(
            &child_js,
            format!(
                "setTimeout(()=>require('fs').writeFileSync({:?},'x'),2500)",
                marker.to_string_lossy()
            ),
        )
        .expect("write child script");
        let setup = if cfg!(windows) {
            format!("start \"\" /b node \"{}\"", child_js.to_string_lossy())
        } else {
            format!("node \"{}\" &", child_js.to_string_lossy())
        };
        store
            .set_setup_command(&worker.project_id, Some(&setup))
            .await
            .unwrap();
        let code = crate::readiness::measure_code(repo, "main", "HEAD").expect("tuple");
        let grant =
            crate::setupgate::grant_for_tree(repo, repo, &code, &setup).expect("current grant");
        store
            .put_setup_trust(&crate::store::SetupTrust {
                project_id: worker.project_id.clone(),
                repo_identity: grant.repo_identity,
                command_normalized: grant.command_normalized,
                base_sha: grant.base_sha,
                inputs_hash: grant.inputs_hash,
                granted_at: crate::store::now_unix_secs(),
            })
            .await
            .unwrap();

        let passed = run_test_gate(&store, &worker.id).await.unwrap();
        assert_eq!(passed.test_status.as_deref(), Some(TEST_PASS));
        // Marker-Timer 2500 ms; 5000 ms Schlaf nach Gate-Rueckkehr laesst
        // auch unter Last genug Marge (review-F4-r15, Sonnet Fund 5).
        tokio::time::sleep(std::time::Duration::from_millis(5000)).await;
        assert!(
            !marker.exists(),
            "the setup run's background child must be reaped with the process tree"
        );
    }

    /// Review-F4-r17 (Opus Fund 1a): Record + Log sind pro Kandidaten-Baum
    /// geschlüsselt — ohne Retention würde jeder Commit ein neues Paar neben
    /// dem Worktree zurücklassen. Nach zwei Läufen auf verschiedenen Bäumen
    /// darf nur das neueste Paar existieren, und der Worker-Checkout bleibt
    /// sauber (die Dateien liegen außerhalb des Repos).
    #[tokio::test]
    async fn setup_records_are_pruned_to_the_current_candidate_tree() {
        let (dir, store, worker) = gated_git("exit 0").await;
        let repo = Path::new(&worker.worktree_path);
        let git = |args: &[&str]| {
            let out = std::process::Command::new("git")
                .arg("-C")
                .arg(repo)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                out.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };
        std::fs::write(repo.join("package-lock.json"), "{}\n").expect("write lockfile");
        git(&["add", "package-lock.json"]);
        git(&["commit", "--no-gpg-sign", "-m", "lockfile"]);
        let setup = "exit 0";
        store
            .set_setup_command(&worker.project_id, Some(setup))
            .await
            .unwrap();
        // The grant binds the candidate tree — every new tree needs its own
        // approval, so the test approves before each run.
        let code = crate::readiness::measure_code(repo, "main", "HEAD").expect("tuple");
        let grant = crate::setupgate::grant_for_tree(repo, repo, &code, setup).expect("grant");
        store
            .put_setup_trust(&crate::store::SetupTrust {
                project_id: worker.project_id.clone(),
                repo_identity: grant.repo_identity,
                command_normalized: grant.command_normalized,
                base_sha: grant.base_sha,
                inputs_hash: grant.inputs_hash,
                granted_at: crate::store::now_unix_secs(),
            })
            .await
            .unwrap();
        run_test_gate(&store, &worker.id).await.unwrap();

        // A new candidate tree, re-approved, then run 2.
        std::fs::write(repo.join("code.txt"), "v2\n").expect("write");
        git(&["add", "code.txt"]);
        git(&["commit", "--no-gpg-sign", "-m", "second tree"]);
        let code = crate::readiness::measure_code(repo, "main", "HEAD").expect("tuple");
        let grant = crate::setupgate::grant_for_tree(repo, repo, &code, setup).expect("grant");
        store
            .put_setup_trust(&crate::store::SetupTrust {
                project_id: worker.project_id.clone(),
                repo_identity: grant.repo_identity,
                command_normalized: grant.command_normalized,
                base_sha: grant.base_sha,
                inputs_hash: grant.inputs_hash,
                granted_at: crate::store::now_unix_secs(),
            })
            .await
            .unwrap();
        run_test_gate(&store, &worker.id).await.unwrap();

        let records = dir.path().join(".projecta-setup");
        let prefix = format!("{}-", crate::readiness::acceptance_hash(&worker.id));
        let mut jsons = 0;
        let mut logs = 0;
        for entry in std::fs::read_dir(&records).expect("record dir").flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with(&prefix) {
                continue;
            }
            match name.rsplit('.').next() {
                Some("json") => jsons += 1,
                Some("log") => logs += 1,
                _ => {}
            }
        }
        assert_eq!(
            (jsons, logs),
            (1, 1),
            "only the current tree's record+log may survive"
        );
        // The record files live outside the repo: the checkout stays clean.
        assert_eq!(git(&["status", "--porcelain", "--untracked-files=all"]), "");
    }

    /// Review-F4-r1: a setup command that rewrites a declared input (think
    /// `npm install` regenerating a lockfile) changes tracked code in the
    /// candidate — validation fails and nothing binds, because the tested
    /// tree is no longer the merge tree.
    #[tokio::test]
    async fn setup_that_modifies_a_declared_input_binds_no_evidence() {
        let (_dir, store, worker) = gated_git("exit 0").await;
        let repo = Path::new(&worker.worktree_path);
        std::fs::write(repo.join("package-lock.json"), "{}\n").expect("write lockfile");
        for args in [
            vec!["add", "package-lock.json"],
            vec!["commit", "--no-gpg-sign", "-m", "lockfile"],
        ] {
            let out = std::process::Command::new("git")
                .arg("-C")
                .arg(repo)
                .args(&args)
                .output()
                .expect("run git");
            assert!(
                out.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }
        let setup = "echo regenerated>>package-lock.json";
        store
            .set_setup_command(&worker.project_id, Some(setup))
            .await
            .unwrap();
        let code = crate::readiness::measure_code(repo, "main", "HEAD").expect("tuple");
        let grant =
            crate::setupgate::grant_for_tree(repo, repo, &code, setup).expect("current grant");
        store
            .put_setup_trust(&crate::store::SetupTrust {
                project_id: worker.project_id.clone(),
                repo_identity: grant.repo_identity,
                command_normalized: grant.command_normalized,
                base_sha: grant.base_sha,
                inputs_hash: grant.inputs_hash,
                granted_at: crate::store::now_unix_secs(),
            })
            .await
            .unwrap();

        let passed = run_test_gate(&store, &worker.id).await.unwrap();
        assert_eq!(passed.test_status.as_deref(), Some(TEST_PASS));
        let row = store.get_review_evidence(&worker.id).await.unwrap();
        assert!(
            row.and_then(|r| r.test_record().map(|t| t.passed))
                .is_none(),
            "a setup that rewrote a declared input tested another tree"
        );
        assert_eq!(
            std::fs::read_to_string(repo.join("package-lock.json")).expect("read"),
            "{}\n",
            "the rewrite stays inside the discarded candidate"
        );
    }

    /// Review-F4-r9 (k3 Fund 2): index bits hide tracked modifications from
    /// porcelain — a run that sets assume-unchanged and then edits tracked
    /// code must not bind. (skip-worktree is refused the same way, via the
    /// `ls-files -v` bit check.)
    #[tokio::test]
    async fn a_run_that_hides_tampering_behind_index_bits_binds_no_evidence() {
        let (_dir, store, worker) = gated_git(
            "git update-index --assume-unchanged tracked.txt && echo tampered>>tracked.txt && exit 0",
        )
        .await;
        let repo = Path::new(&worker.worktree_path);
        std::fs::write(repo.join("tracked.txt"), "original\n").expect("write");
        for args in [
            vec!["add", "tracked.txt"],
            vec!["commit", "--no-gpg-sign", "-m", "tracked input"],
        ] {
            let out = std::process::Command::new("git")
                .arg("-C")
                .arg(repo)
                .args(&args)
                .output()
                .expect("run git");
            assert!(
                out.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }

        let passed = run_test_gate(&store, &worker.id).await.unwrap();
        assert_eq!(passed.test_status.as_deref(), Some(TEST_PASS));
        let row = store.get_review_evidence(&worker.id).await.unwrap();
        assert!(
            row.and_then(|r| r.test_record().map(|t| t.passed))
                .is_none(),
            "tampering hidden behind index bits must not bind"
        );
    }

    /// Review-F4-r10 (k3 F1): the bit combination skip-worktree +
    /// assume-unchanged shows as `s` in `ls-files -v` and slips past a
    /// single-bit blacklist. A fresh candidate carries no flags at all, so
    /// anything but `H` is the run's doing.
    #[tokio::test]
    async fn a_run_setting_both_index_bits_binds_no_evidence() {
        let (_dir, store, worker) = gated_git(
            "git update-index --skip-worktree --assume-unchanged tracked.txt && echo tampered>>tracked.txt && exit 0",
        )
        .await;
        let repo = Path::new(&worker.worktree_path);
        std::fs::write(repo.join("tracked.txt"), "original\n").expect("write");
        for args in [
            vec!["add", "tracked.txt"],
            vec!["commit", "--no-gpg-sign", "-m", "tracked input"],
        ] {
            let out = std::process::Command::new("git")
                .arg("-C")
                .arg(repo)
                .args(&args)
                .output()
                .expect("run git");
            assert!(
                out.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }

        let passed = run_test_gate(&store, &worker.id).await.unwrap();
        assert_eq!(passed.test_status.as_deref(), Some(TEST_PASS));
        let row = store.get_review_evidence(&worker.id).await.unwrap();
        assert!(
            row.and_then(|r| r.test_record().map(|t| t.passed))
                .is_none(),
            "tampering behind the combined index bits must not bind"
        );
    }

    /// The happy path the negative tests circle around: a trusted setup runs
    /// in the same candidate the test then sees, the artifact is visible
    /// there, the evidence binds — and nothing of it touches the worker.
    #[tokio::test]
    async fn a_trusted_setup_runs_in_the_same_candidate_the_test_sees() {
        let command = if cfg!(windows) {
            "if not exist setup-ran.txt exit /b 7"
        } else {
            "test -f setup-ran.txt"
        };
        let (_dir, store, worker) = gated_git(command).await;
        let repo = Path::new(&worker.worktree_path);
        let setup = "echo ok>setup-ran.txt";
        store
            .set_setup_command(&worker.project_id, Some(setup))
            .await
            .unwrap();
        let code = crate::readiness::measure_code(repo, "main", "HEAD").expect("tuple");
        let grant =
            crate::setupgate::grant_for_tree(repo, repo, &code, setup).expect("current grant");
        store
            .put_setup_trust(&crate::store::SetupTrust {
                project_id: worker.project_id.clone(),
                repo_identity: grant.repo_identity,
                command_normalized: grant.command_normalized,
                base_sha: grant.base_sha,
                inputs_hash: grant.inputs_hash,
                granted_at: crate::store::now_unix_secs(),
            })
            .await
            .unwrap();

        let result = run_test_gate(&store, &worker.id).await.unwrap();
        assert_eq!(
            result.test_status.as_deref(),
            Some(TEST_PASS),
            "the test only passes where the setup ran"
        );
        let evidence = store
            .get_review_evidence(&worker.id)
            .await
            .unwrap()
            .unwrap();
        assert!(
            evidence.test_record().is_some_and(|test| test.passed),
            "the proven pass binds to the merge-tree tuple"
        );
        assert!(
            !repo.join("setup-ran.txt").exists(),
            "the setup artifact stays inside the discarded candidate"
        );
    }

    /// Review-F4-r12 (Sonnet Fund 1, Checkout-Seite): die Kandidaten-Gits
    /// pinnen `core.autocrlf=false`/`core.eol=lf` — die ausgecheckten Bytes
    /// sind die Blob-Bytes, egal was die Maschine global konfiguriert.
    #[test]
    fn the_candidate_checks_out_blob_bytes_despite_ambient_autocrlf() {
        let dir = TempDir::new("candidate-eol");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        let git = |args: &[&str]| {
            let output = crate::proc::command("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .output()
                .expect("run git");
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&["config", "core.autocrlf", "true"]);
        std::fs::write(repo.join("script.sh"), "#!/bin/sh\necho hi\n").expect("write");
        git(&["add", "script.sh"]);
        git(&["commit", "--no-gpg-sign", "-m", "lf blob"]);

        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let candidate = super::candidate::Candidate::prepare(&repo, &code).expect("prepare");
        let bytes = std::fs::read(candidate.path().join("script.sh")).expect("read");
        assert_eq!(
            bytes, b"#!/bin/sh\necho hi\n",
            "checkout bytes == blob bytes"
        );
    }

    /// Review-F4-r1 (Sonnet Fund 2): cleanup is housekeeping — its failure
    /// (here: an open handle locking the candidate on Windows) must not
    /// question a validation that already proved the tested tree.
    #[cfg(windows)]
    #[test]
    fn a_locked_candidate_fails_cleanup_but_validation_still_stands() {
        let dir = TempDir::new("candidate-lock");
        let repo = crate::testutil::init_repo(&dir.path().join("repo"));
        let code = crate::readiness::measure_code(&repo, "main", "HEAD").expect("tuple");
        let candidate = super::candidate::Candidate::prepare(&repo, &code).expect("prepare");
        let locked = candidate.path().join("locked.txt");
        std::fs::write(&locked, "held\n").expect("write");
        // Rust opens with DELETE sharing by default; share_mode(0) is the
        // exclusive hold that actually blocks removal.
        use std::os::windows::fs::OpenOptionsExt;
        let _handle = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&locked)
            .expect("open exclusively");

        candidate.validate(&code).expect("validation is unaffected");
        assert!(
            candidate.cleanup().is_err(),
            "the locked file blocks removal on Windows"
        );
    }

    /// Without git there is no tuple to bind to: the worker verdict is still
    /// recorded the legacy way, and readiness reports `git_unsupported`
    /// instead of ever mistaking the run for bound evidence.
    #[tokio::test]
    async fn a_gate_without_git_records_the_verdict_but_no_evidence() {
        let (_dir, store, worker) = gated("exit 0").await;
        let passed = run_test_gate(&store, &worker.id).await.unwrap();
        assert_eq!(passed.test_status.as_deref(), Some(TEST_PASS));
        assert!(
            store
                .get_review_evidence(&worker.id)
                .await
                .unwrap()
                .is_none(),
            "a run without git must not invent a tuple"
        );
    }

    /// Review-r1 (Codex Befund 2): a green run is bound to the code it
    /// actually ran against. A head that moves mid-run means this verdict
    /// belongs to code that no longer exists — nothing is bound, readiness
    /// stays stale.
    #[tokio::test]
    async fn a_run_that_moves_the_head_mid_test_binds_no_evidence() {
        let (_dir, store, worker) = gated_git("git commit --allow-empty -m moved && exit 0").await;
        let passed = run_test_gate(&store, &worker.id).await.unwrap();
        assert_eq!(passed.test_status.as_deref(), Some(TEST_PASS));
        let row = store.get_review_evidence(&worker.id).await.unwrap();
        assert!(
            row.and_then(|r| r.test_record().map(|t| t.passed))
                .is_none(),
            "a verdict for code that moved mid-run must not be bound"
        );
    }

    /// Review-r7 (Codex), new contract: the run plays in the disposable
    /// candidate, so its own untracked artifacts are fine — but a run that
    /// modifies *tracked* code in the candidate tested something other than
    /// the merge tree, and the end-of-run validation must catch exactly that.
    #[tokio::test]
    async fn a_run_that_tamperes_with_tracked_code_binds_no_evidence() {
        let (_dir, store, worker) = gated_git("echo tampered>>tracked.txt && exit 0").await;
        let repo = Path::new(&worker.worktree_path);
        std::fs::write(repo.join("tracked.txt"), "original\n").expect("write");
        for args in [
            vec!["add", "tracked.txt"],
            vec!["commit", "--no-gpg-sign", "-m", "tracked input"],
        ] {
            let out = std::process::Command::new("git")
                .arg("-C")
                .arg(repo)
                .args(&args)
                .output()
                .expect("run git");
            assert!(
                out.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }

        let passed = run_test_gate(&store, &worker.id).await.unwrap();
        assert_eq!(passed.test_status.as_deref(), Some(TEST_PASS));
        let row = store.get_review_evidence(&worker.id).await.unwrap();
        assert!(
            row.and_then(|r| r.test_record().map(|t| t.passed))
                .is_none(),
            "a verdict gathered against tampered tracked code must not be bound"
        );
        assert_eq!(
            std::fs::read_to_string(repo.join("tracked.txt")).expect("read"),
            "original\n",
            "the tampering stays inside the discarded candidate"
        );
    }

    /// The automatic trigger runs once and then leaves the worker alone; a
    /// project without a command is never gated at all.
    #[tokio::test]
    async fn the_automatic_trigger_skips_a_worker_that_already_passed() {
        let (_dir, store, worker) = gated("exit 0").await;
        assert!(run_test_gate_if_due(&store, &worker.id)
            .await
            .unwrap()
            .is_some());
        assert!(run_test_gate_if_due(&store, &worker.id)
            .await
            .unwrap()
            .is_none());

        store
            .set_worker_test_status(&worker.id, None, None)
            .await
            .unwrap();
        store
            .set_project_test_command(&worker.project_id, None)
            .await
            .unwrap();
        assert!(run_test_gate_if_due(&store, &worker.id)
            .await
            .unwrap()
            .is_none());
        let err = run_test_gate(&store, &worker.id)
            .await
            .expect_err("no test command");
        assert!(err.contains("no test command"), "{err}");
        assert!(run_test_gate(&store, "wk-nope").await.is_err());
    }

    /// Two automatic polls can both observe an unset status before either one
    /// writes `running`. A debounce must make that check-and-claim atomic, not
    /// merely store a flag after the race has already been won twice.
    #[tokio::test]
    async fn parallel_automatic_triggers_start_exactly_one_gate() {
        // The gate runs with the worker's worktree as its working directory,
        // so a relative target lands in that directory on both platforms.
        // (`>nul` and quoted absolute paths do not survive cmd /C's own
        // command line, so the file stays a plain relative name.)
        let command = if cfg!(windows) {
            "echo x>> count && ping -n 2 127.0.0.1 && exit 0".to_string()
        } else {
            "printf x >> count && sleep 1 && exit 0".to_string()
        };
        let (_dir, store, worker) = gated(&command).await;
        let count = PathBuf::from(&worker.worktree_path).join("count");

        let (left, right) = tokio::join!(
            run_test_gate_if_due(&store, &worker.id),
            run_test_gate_if_due(&store, &worker.id),
        );
        let started = [left.unwrap(), right.unwrap()]
            .into_iter()
            .filter(Option::is_some)
            .count();
        assert_eq!(started, 1, "two automatic runs escaped the debounce");
        // The winning gate runs in the background; claiming is what join!
        // waited for, not completion. Poll briefly for the file it writes -
        // with tokio's sleep, not thread::sleep, so a current-thread runtime
        // keeps scheduling the gate while we wait.
        let mut contents = String::new();
        for _ in 0..50 {
            if let Ok(read) = std::fs::read_to_string(&count) {
                contents = read;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        assert_eq!(contents.trim(), "x");
    }

    /// Closing the app during a ten minute run leaves `running` in the
    /// database with nothing behind it, and the automatic trigger reads that
    /// as "already in flight" forever. The startup pass has to free it.
    #[tokio::test]
    async fn a_run_interrupted_by_a_restart_is_freed_at_the_next_start() {
        let (_dir, store, worker) = gated("exit 0").await;
        store
            .set_worker_test_status(&worker.id, Some(TEST_RUNNING), None)
            .await
            .unwrap();

        // Without the pass this worker is gated out for good.
        assert!(run_test_gate_if_due(&store, &worker.id)
            .await
            .unwrap()
            .is_none());

        assert_eq!(clear_stale_test_runs(&store).await.unwrap(), 1);
        let freed = store.get_worker(&worker.id).await.unwrap().unwrap();
        assert_eq!(
            freed.test_status, None,
            "a run nobody finished is not a fail"
        );
        assert_eq!(freed.tested_at, None);

        // And the gate runs again, which is the point of freeing it.
        let gated_again = run_test_gate_if_due(&store, &worker.id).await.unwrap();
        assert_eq!(
            gated_again.and_then(|w| w.test_status).as_deref(),
            Some(TEST_PASS)
        );

        // A finished verdict is left exactly as it was; only `running` is stale.
        assert_eq!(clear_stale_test_runs(&store).await.unwrap(), 0);
        let untouched = store.get_worker(&worker.id).await.unwrap().unwrap();
        assert_eq!(untouched.test_status.as_deref(), Some(TEST_PASS));
        assert!(untouched.tested_at.is_some());
    }

    /// The same release, on the in-session path: whatever goes wrong between
    /// setting `running` and writing a verdict, the flag comes off.
    #[tokio::test]
    async fn a_gate_that_never_reaches_a_verdict_gives_the_flag_back() {
        let (_dir, store, worker) = gated("exit 0").await;
        store
            .set_worker_test_status(&worker.id, Some(TEST_RUNNING), Some(now_unix_secs()))
            .await
            .unwrap();

        release_test_status(&store, &worker.id).await;

        let freed = store.get_worker(&worker.id).await.unwrap().unwrap();
        assert_eq!(freed.test_status, None);
        assert_eq!(freed.tested_at, None);
        assert!(run_test_gate_if_due(&store, &worker.id)
            .await
            .unwrap()
            .is_some());
    }
}
