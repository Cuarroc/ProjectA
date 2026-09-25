//! Bounded native pipe executor for host diagnostics and native fixture tests.
//! The app/agent launch lane and provider protocol do not call this yet.
use super::*;
use crate::host_events::{OutputEvent, OutputStream};
use std::fs::File;
use std::io::{Read, Write};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex, OnceLock,
};
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{
    GetLastError, SetHandleInformation, ERROR_BROKEN_PIPE, HANDLE_FLAG_INHERIT, WAIT_TIMEOUT,
};
use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
use windows_sys::Win32::System::Pipes::{CreatePipe, PeekNamedPipe};

const MAX_BYTES: usize = 1_048_576;
const INPUT_PIPE_CLOSED: &str = "native input pipe closed by reader";
const INPUT_NOT_CONFIRMED: &str = "native input delivery not confirmed";
// After a closed-input write failure, a provider that is not observed exited
// with drained pipes within this bound keeps today's unconfirmed failure.
const UNDELIVERED_EXIT_GRACE: Duration = Duration::from_secs(5);

/// Result of one bounded native execution. Only `Completed` can carry a
/// confirmed input delivery; `ExitedUndelivered` is produced solely when the
/// provider was observed exited (signaled, exit code read, pipes drained,
/// cleanup confirmed) after its input pipe was closed by the provider.
enum Outcome {
    Completed(Capture),
    ExitedUndelivered {
        identity: SuspendedObservation,
        exit_code: u32,
    },
}

enum Exit {
    Code(u32),
    Undelivered(u32),
}

/// Settles an observed undelivered exit. Anything other than confirmed
/// cleanup plus a joined writer that failed on the closed pipe is ambiguous.
fn confirmed_undelivered_exit(
    cleanup: Result<(), String>,
    writer: Result<Result<(), String>, String>,
) -> Result<(), String> {
    cleanup?;
    match writer? {
        Err(error) if error == INPUT_PIPE_CLOSED => Ok(()),
        _ => Err(INPUT_NOT_CONFIRMED.into()),
    }
}

enum Observer<'a> {
    None,
    Channel(&'a std::sync::mpsc::SyncSender<OutputEvent>),
    // Trusted synchronous parser only: callbacks must not block or perform IO.
    Callback(&'a mut dyn FnMut(OutputEvent) -> Result<(), String>),
    Polling(Box<Observer<'a>>, &'a mut dyn FnMut() -> Result<(), String>),
    Controlled(Box<Observer<'a>>, &'a AtomicBool),
    Host(
        &'a std::sync::mpsc::SyncSender<crate::host_events::Message>,
        bool,
    ),
}

impl Observer<'_> {
    fn send(&mut self, event: OutputEvent) -> Result<(), String> {
        match self {
            Self::None => Ok(()),
            Self::Channel(channel) => send_output(channel, event),
            Self::Callback(callback) => callback(event),
            Self::Controlled(output, _) => output.send(event),
            Self::Polling(output, _) => output.send(event),
            Self::Host(sender, _) => {
                send_host_message(sender, crate::host_events::Message::Output { event })
            }
        }
    }

    fn cancelled(&self) -> bool {
        match self {
            Self::Controlled(_, cancel) => cancel.load(Ordering::Acquire),
            Self::Polling(output, _) => output.cancelled(),
            _ => false,
        }
    }

    fn poll(&mut self) -> Result<(), String> {
        match self {
            Self::Polling(output, poll) => {
                output.poll()?;
                poll()
            }
            Self::Controlled(output, _) => output.poll(),
            _ => Ok(()),
        }
    }

    fn verified(&mut self, identity: &SuspendedObservation) -> Result<(), String> {
        match self {
            Self::Controlled(output, _) => output.verified(identity),
            Self::Polling(output, _) => output.verified(identity),
            Self::Host(sender, true) => {
                let mut value = serde_json::to_value(identity)
                    .map_err(|_| "native identity serialization failed")?;
                value["state"] = "native_image_verified_suspended_before_execution".into();
                let identity = serde_json::from_value(value)
                    .map_err(|_| "invalid native process observation")?;
                send_host_message(
                    sender,
                    crate::host_events::Message::ProcessVerified {
                        identity: Box::new(identity),
                    },
                )
            }
            _ => Ok(()),
        }
    }

    fn delivered(&mut self, input_bytes: usize, input_sha256: &str) -> Result<(), String> {
        match self {
            Self::Controlled(output, _) => output.delivered(input_bytes, input_sha256),
            Self::Polling(output, _) => output.delivered(input_bytes, input_sha256),
            Self::Host(sender, true) => send_host_message(
                sender,
                crate::host_events::Message::InputDelivered {
                    input_bytes,
                    input_sha256: input_sha256.into(),
                },
            ),
            _ => Ok(()),
        }
    }
}

fn send_host_message(
    sender: &std::sync::mpsc::SyncSender<crate::host_events::Message>,
    message: crate::host_events::Message,
) -> Result<(), String> {
    sender.try_send(message).map_err(|error| match error {
        std::sync::mpsc::TrySendError::Full(_) => "capture event capacity exceeded".into(),
        std::sync::mpsc::TrySendError::Disconnected(_) => {
            "capture event observer disconnected".into()
        }
    })
}

fn confirmed_capture_exit(
    execution: Result<u32, String>,
    cleanup: Result<(), String>,
    writer: Result<Result<(), String>, String>,
) -> Result<u32, String> {
    cleanup?;
    let delivered = writer?;
    let code = execution?;
    delivered?;
    Ok(code)
}

type InputThread = std::thread::JoinHandle<Result<(), String>>;
static UNRESOLVED_WRITERS: OnceLock<Mutex<Vec<InputThread>>> = OnceLock::new();

// Outer result confirms the writer thread was joined. Inner result describes
// delivery; cancellation after an execution failure is expected, a lost thread
// or panic is not. Keep those facts separate for settlement.
fn finish_writer(writer: InputThread, stop: &AtomicBool) -> Result<Result<(), String>, String> {
    stop.store(true, Ordering::Release);
    let deadline = Instant::now() + Duration::from_secs(5);
    while !writer.is_finished() && Instant::now() < deadline {
        // Repeat cancellation to cover the race between the writer's stop
        // check and entering synchronous WriteFile. The thread handle is owned.
        unsafe {
            windows_sys::Win32::System::IO::CancelSynchronousIo(writer.as_raw_handle());
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    if !writer.is_finished() {
        UNRESOLVED_WRITERS
            .get_or_init(|| Mutex::new(Vec::new()))
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(writer);
        return Err("input writer retained for reconciliation".into());
    }
    writer.join().map_err(|_| "input writer panicked".into())
}

struct ControlUpdate {
    bytes: Vec<u8>,
    close: bool,
}

enum InputDelivery {
    Closed(Vec<u8>),
    Live {
        initial: Vec<u8>,
        updates: std::sync::mpsc::Receiver<ControlUpdate>,
        closed: Arc<AtomicBool>,
    },
}

impl InputDelivery {
    fn len(&self) -> usize {
        match self {
            Self::Closed(bytes) | Self::Live { initial: bytes, .. } => bytes.len(),
        }
    }
}

fn write_bytes(stdin: &mut File, input: &[u8], stop: &AtomicBool) -> Result<(), String> {
    let mut offset = 0;
    while offset < input.len() {
        if stop.load(Ordering::Acquire) {
            return Err("input delivery canceled".into());
        }
        let written = stdin.write(&input[offset..]).map_err(|error| {
            // A fixed marker, so the settlement can tell a reader that closed
            // its end from every other (fail-closed) write failure.
            if error.kind() == std::io::ErrorKind::BrokenPipe {
                INPUT_PIPE_CLOSED.to_string()
            } else {
                error.to_string()
            }
        })?;
        if written == 0 {
            return Err("zero-byte input write".into());
        }
        offset += written;
    }
    Ok(())
}

fn write_delivery(
    mut stdin: File,
    delivery: InputDelivery,
    stop: Arc<AtomicBool>,
    delivered: Arc<AtomicBool>,
) -> Result<(), String> {
    match delivery {
        InputDelivery::Closed(bytes) => {
            write_bytes(&mut stdin, &bytes, &stop)?;
            drop(stdin);
            delivered.store(true, Ordering::Release);
            Ok(())
        }
        InputDelivery::Live {
            initial,
            updates,
            closed,
        } => {
            write_bytes(&mut stdin, &initial, &stop)?;
            let mut total = initial.len();
            loop {
                if stop.load(Ordering::Acquire) {
                    return Ok(());
                }
                match updates.recv_timeout(Duration::from_millis(20)) {
                    Ok(ControlUpdate { bytes, close }) => {
                        total = total
                            .checked_add(bytes.len())
                            .filter(|size| *size <= crate::protocol::MAX_CONTROL_BYTES)
                            .ok_or("capture control byte limit exceeded")?;
                        write_bytes(&mut stdin, &bytes, &stop)?;
                        if close {
                            drop(stdin);
                            closed.store(true, Ordering::Release);
                            return Ok(());
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        return Err("capture control sender disconnected".into());
                    }
                }
            }
        }
    }
}

pub(super) struct ChildPipes([OwnedHandle; 3]);
impl ChildPipes {
    pub(super) fn handles(&self) -> [HANDLE; 3] {
        [
            self.0[0].as_raw_handle(),
            self.0[1].as_raw_handle(),
            self.0[2].as_raw_handle(),
        ]
    }
}

fn pipe(parent_reads: bool) -> Result<(OwnedHandle, File), String> {
    let mut read = null_mut();
    let mut write = null_mut();
    let security = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: null_mut(),
        bInheritHandle: 1,
    };
    // SAFETY: writable handle slots and a valid security attributes structure.
    unsafe {
        if CreatePipe(&mut read, &mut write, &security, 0) == 0 {
            return Err(os_error("create capture pipe"));
        }
        let read = OwnedHandle::from_raw_handle(read);
        let write = OwnedHandle::from_raw_handle(write);
        let (child, parent) = if parent_reads {
            (write, read)
        } else {
            (read, write)
        };
        if SetHandleInformation(parent.as_raw_handle(), HANDLE_FLAG_INHERIT, 0) == 0 {
            return Err(os_error("exclude parent pipe handle from inheritance"));
        }
        Ok((child, File::from(parent)))
    }
}

fn drain(
    file: &mut File,
    output: &mut Vec<u8>,
    remaining: usize,
    stream: OutputStream,
    events: &mut Observer<'_>,
) -> Result<bool, String> {
    let mut available = 0;
    // SAFETY: this is the only reader for a live owned pipe. Peek avoids a
    // blocking read when a descendant retains a writer without producing data.
    if unsafe {
        PeekNamedPipe(
            file.as_raw_handle(),
            null_mut(),
            0,
            null_mut(),
            &mut available,
            null_mut(),
        )
    } == 0
    {
        if unsafe { GetLastError() } == ERROR_BROKEN_PIPE {
            if !matches!(events, Observer::None) {
                events.send(OutputEvent::Eof {
                    stream,
                    offset: output.len(),
                })?;
            }
            return Ok(true);
        }
        return Err(os_error("inspect capture pipe"));
    }
    crate::stream_guard::admit_output(0, available as usize, remaining)?;
    if available > 0 {
        let mut bytes = [0u8; 32768];
        let count = (available as usize).min(bytes.len());
        file.read_exact(&mut bytes[..count])
            .map_err(|e| e.to_string())?;
        if !matches!(events, Observer::None) {
            events.send(OutputEvent::Bytes {
                stream,
                offset: output.len(),
                bytes: bytes[..count].to_vec(),
            })?;
        }
        output.extend_from_slice(&bytes[..count]);
    }
    Ok(false)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Capture {
    identity: SuspendedObservation,
    exit_code: u32,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

fn send_output(
    events: &std::sync::mpsc::SyncSender<OutputEvent>,
    event: OutputEvent,
) -> Result<(), String> {
    // Never block the sole pipe reader on a stalled observer. Previously sent
    // progress is not a completed capture; the caller must observe settlement.
    events.try_send(event).map_err(|error| match error {
        std::sync::mpsc::TrySendError::Full(_) => "capture event capacity exceeded".into(),
        std::sync::mpsc::TrySendError::Disconnected(_) => {
            "capture event observer disconnected".into()
        }
    })
}

#[cfg(test)]
fn execute(
    path: &Path,
    expected: &str,
    input: Vec<u8>,
    limit: usize,
    timeout: Duration,
) -> Result<Capture, String> {
    execute_command(&Command::diagnostic(path), expected, input, limit, timeout)
}

#[cfg(test)]
fn execute_command(
    command: &Command,
    expected: &str,
    input: Vec<u8>,
    limit: usize,
    timeout: Duration,
) -> Result<Capture, String> {
    execute_command_with_bound(command, expected, input, limit, timeout, MAX_BYTES)
}

// The outer host pipe carries JSON-encoded byte arrays, so its bounded wire
// envelope is larger than the provider's unchanged 1 MiB raw-byte ceiling.
fn execute_command_with_bound(
    command: &Command,
    expected: &str,
    input: Vec<u8>,
    limit: usize,
    timeout: Duration,
    maximum: usize,
) -> Result<Capture, String> {
    execute_observed(command, expected, input, limit, timeout, maximum, None)
}

fn execute_observed(
    command: &Command,
    expected: &str,
    input: Vec<u8>,
    limit: usize,
    timeout: Duration,
    maximum: usize,
    events: Option<&std::sync::mpsc::SyncSender<OutputEvent>>,
) -> Result<Capture, String> {
    if timeout > Duration::from_secs(30) {
        return Err("diagnostic capture timeout exceeds 30 seconds".into());
    }
    let observer = match events {
        Some(channel) => Observer::Channel(channel),
        None => Observer::None,
    };
    execute_with_observer(
        command,
        expected,
        InputDelivery::Closed(input),
        limit,
        timeout,
        maximum,
        observer,
    )
}

/// Strict form for every caller that has no separate undelivered settlement:
/// an unconfirmed input delivery stays the same failure as before.
fn execute_with_observer(
    command: &Command,
    expected: &str,
    input: InputDelivery,
    limit: usize,
    timeout: Duration,
    maximum: usize,
    events: Observer<'_>,
) -> Result<Capture, String> {
    match execute_with_observer_outcome(command, expected, input, limit, timeout, maximum, events)?
    {
        Outcome::Completed(capture) => Ok(capture),
        Outcome::ExitedUndelivered { .. } => Err(INPUT_NOT_CONFIRMED.into()),
    }
}

fn execute_with_observer_outcome(
    command: &Command,
    expected: &str,
    input: InputDelivery,
    limit: usize,
    timeout: Duration,
    maximum: usize,
    mut events: Observer<'_>,
) -> Result<Outcome, String> {
    if events.cancelled() {
        return Err("capture cancelled by control".into());
    }
    if input.len() > maximum
        || limit == 0
        || limit > maximum
        || timeout.is_zero()
        || timeout
            > Duration::from_millis(
                crate::protocol::MAX_TIMEOUT_MS + crate::protocol::HOST_GRACE_MS,
            )
    {
        return Err("invalid bounded capture limits".into());
    }
    // Validated before any process exists, so no early return can leak one.
    let progress = crate::stream_guard::ProgressWatch::new(command.no_progress, Instant::now())
        .map_err(|_| "invalid bounded capture limits")?;
    let live_control = matches!(&input, InputDelivery::Live { .. });
    let input_receipt = match &input {
        InputDelivery::Closed(bytes) => {
            use sha2::Digest;
            Some((bytes.len(), format!("{:x}", sha2::Sha256::digest(bytes))))
        }
        _ => None,
    };
    let control_closed = match &input {
        InputDelivery::Live { closed, .. } => Some(Arc::clone(closed)),
        _ => None,
    };
    let deadline = Instant::now() + timeout;
    let held = VerifiedImage::open(&command.executable, expected)?;
    let (stdin_child, stdin) = pipe(false)?;
    let (stdout_child, mut stdout) = pipe(true)?;
    let (stderr_child, mut stderr) = pipe(true)?;
    let pipes = ChildPipes([stdin_child, stdout_child, stderr_child]);
    let child = SuspendedProcess::create(command, Some(&pipes))?;
    // Parent copies must close before EOF or termination can be observed.
    drop(pipes);
    let mut identity = match child.inspect(&held) {
        Ok(identity) => identity,
        Err(error) => {
            child.terminate()?;
            return Err(error);
        }
    };
    if let Err(error) = events.verified(&identity) {
        child.terminate()?;
        return Err(error);
    }
    if Instant::now() >= deadline || events.cancelled() {
        child.terminate()?;
        return Err("capture deadline before resume".into());
    }
    // SAFETY: primary thread belongs to the held, identity-checked process.
    if unsafe { ResumeThread(child._thread.as_raw_handle()) } != 1 {
        child.terminate()?;
        return Err("unexpected suspended thread state".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    let writer_stop = Arc::clone(&stop);
    let delivered = Arc::new(AtomicBool::new(false));
    let writer_delivered = Arc::clone(&delivered);
    let writer = match std::thread::Builder::new()
        .name("capture-input".into())
        .spawn(move || write_delivery(stdin, input, writer_stop, writer_delivered))
    {
        Ok(writer) => writer,
        Err(error) => {
            child.terminate()?;
            return Err(error.to_string());
        }
    };
    let mut out = Vec::new();
    let mut err = Vec::new();
    // The window starts when the verified process resumes, not at validation.
    let mut progress = progress.restarted(Instant::now());
    let result = (|| {
        let (mut out_eof, mut err_eof) = (false, false);
        let mut delivery_reported = false;
        // Set once the writer finished without delivery. From then on only an
        // observed exit with drained pipes settles; nothing is reported delivered.
        let mut undelivered_since: Option<Instant> = None;
        loop {
            if events.cancelled() {
                return Err("capture cancelled by control".into());
            }
            if let Some(since) = undelivered_since {
                if since.elapsed() >= UNDELIVERED_EXIT_GRACE || Instant::now() >= deadline {
                    return Err(INPUT_NOT_CONFIRMED.into());
                }
            } else if Instant::now() >= deadline {
                return Err("capture deadline exceeded".into());
            }
            events.poll()?;
            if !live_control && !delivery_reported && undelivered_since.is_none() {
                if delivered.load(Ordering::Acquire) {
                    let (bytes, hash) = input_receipt
                        .as_ref()
                        .ok_or("native input receipt unavailable")?;
                    events.delivered(*bytes, hash)?;
                    delivery_reported = true;
                } else if writer.is_finished() && !delivered.load(Ordering::Acquire) {
                    undelivered_since = Some(Instant::now());
                }
            }
            let captured_before = out.len() + err.len();
            if !out_eof {
                let remaining = limit - out.len() - err.len();
                out_eof = drain(
                    &mut stdout,
                    &mut out,
                    remaining,
                    OutputStream::Stdout,
                    &mut events,
                )?;
            }
            if !err_eof {
                let remaining = limit - out.len() - err.len();
                err_eof = drain(
                    &mut stderr,
                    &mut err,
                    remaining,
                    OutputStream::Stderr,
                    &mut events,
                )?;
            }
            // SAFETY: live process handle, zero-time observation only.
            let state = unsafe { WaitForSingleObject(child.process.as_raw_handle(), 0) };
            if state != WAIT_OBJECT_0 && state != WAIT_TIMEOUT {
                return Err(os_error("observe capture exit"));
            }
            let settled = live_control || (writer.is_finished() && delivery_reported);
            if state == WAIT_OBJECT_0
                && out_eof
                && err_eof
                && (settled || undelivered_since.is_some())
            {
                let mut code = 0;
                if unsafe { GetExitCodeProcess(child.process.as_raw_handle(), &mut code) } == 0 {
                    return Err(os_error("read capture exit code"));
                }
                return Ok(if settled {
                    Exit::Code(code)
                } else {
                    Exit::Undelivered(code)
                });
            }
            // A live process that produced no byte for the whole window is
            // aborted; the job is retired below before the reason returns.
            let now = Instant::now();
            progress.record(out.len() + err.len() - captured_before, now);
            progress.check(now)?;
            if live_control
                && writer.is_finished()
                && !control_closed
                    .as_ref()
                    .is_some_and(|closed| closed.load(Ordering::Acquire))
            {
                return Err("capture control writer stopped before host exit".into());
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    })();
    // Retire the complete job and cancel any blocked synchronous input write.
    // Unknown cleanup never returns a successful/truncated capture.
    let cleanup = child.terminate();
    let written = finish_writer(writer, &stop);
    let result = match result {
        Ok(Exit::Undelivered(exit_code)) => {
            confirmed_undelivered_exit(cleanup, written)?;
            identity.state = crate::host_reply::UNDELIVERED_IDENTITY_STATE;
            return Ok(Outcome::ExitedUndelivered {
                identity,
                exit_code,
            });
        }
        Ok(Exit::Code(code)) => Ok(code),
        Err(error) => Err(error),
    };
    let exit_code = confirmed_capture_exit(result, cleanup, written)?;
    identity.state = "native_image_verified_execution_exited_and_pipes_drained";
    Ok(Outcome::Completed(Capture {
        identity,
        exit_code,
        stdout: out,
        stderr: err,
    }))
}

fn system_sort() -> Result<PathBuf, String> {
    let mut buffer = vec![0u16; 32768];
    let count = unsafe {
        windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW(
            buffer.as_mut_ptr(),
            buffer.len() as u32,
        )
    };
    if count == 0 || count as usize >= buffer.len() {
        return Err(os_error("resolve native system directory"));
    }
    Ok(PathBuf::from(OsString::from_wide(&buffer[..count as usize])).join("sort.exe"))
}

pub fn self_test() -> Result<serde_json::Value, String> {
    self_test_impl(false)
}

pub fn self_test_host() -> Result<serde_json::Value, String> {
    self_test_impl(true)
}

fn self_test_impl(through_host: bool) -> Result<serde_json::Value, String> {
    let path = system_sort()?;
    let held = VerifiedImage::observe(&path)?;
    let mut capability = [0u8; 32];
    getrandom::fill(&mut capability).map_err(|_| "capture randomness unavailable")?;
    let binding = crate::protocol::Binding {
        run_id: "diagnostic-not-a-development-run".into(),
        session_id: "diagnostic-session".into(),
        process_instance: format!(
            "diagnostic-{}",
            u128::from_le_bytes(capability[..16].try_into().unwrap())
        ),
        capability: capability
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
        route_sha256: held.identity().sha256.clone(),
    };
    let repetitions = if through_host { 32768 } else { 1 };
    let input = b"z\r\na\r\n".repeat(repetitions);
    let expected_output = [b"a\r\n".repeat(repetitions), b"z\r\n".repeat(repetitions)].concat();
    let launch = crate::protocol::Launch {
        executable: path
            .to_str()
            .ok_or("diagnostic image path is not UTF-8")?
            .into(),
        executable_sha256: held.identity().sha256.clone(),
        args: Vec::new(),
        cwd: path
            .parent()
            .and_then(Path::to_str)
            .ok_or("diagnostic cwd is not UTF-8")?
            .into(),
        environment: Vec::new(),
        input_bytes: input.len(),
        input_sha256: {
            use sha2::Digest;
            format!("{:x}", sha2::Sha256::digest(&input))
        },
        output_limit: MAX_BYTES,
        timeout_ms: 10000,
    };
    let mut control = Vec::new();
    crate::protocol::write_launch(&mut control, binding.clone(), launch.clone(), &input)?;
    if through_host {
        let path = std::env::current_exe().map_err(|error| error.to_string())?;
        let held = VerifiedImage::observe(&path)?;
        let wrong_digest = if held.identity().sha256 == "0".repeat(64) {
            "1".repeat(64)
        } else {
            "0".repeat(64)
        };
        let rejected = execute_host(
            &path,
            &wrong_digest,
            crate::protocol::prepare_buffer(&control)?,
        );
        if !matches!(rejected, Err(error) if error.starts_with("executable identity mismatch:")) {
            return Err("wrong host image digest was not rejected before execution".into());
        }
        let (bad_binding, mut bad_launch, bad_input) =
            crate::protocol::prepare_buffer(&control)?.into_parts();
        bad_launch.executable_sha256 = if bad_launch.executable_sha256 == "0".repeat(64) {
            "1".repeat(64)
        } else {
            "0".repeat(64)
        };
        let mut bad_control = Vec::new();
        crate::protocol::write_launch(&mut bad_control, bad_binding, bad_launch, &bad_input)?;
        if !matches!(execute_host(&path, &held.identity().sha256,
            crate::protocol::prepare_buffer(&bad_control)?),
            Err(error) if error == "native host did not complete cleanly")
        {
            return Err("host accepted wrong provider image digest".into());
        }
        let mut overflow = launch.clone();
        overflow.output_limit = 1;
        let mut overflow_control = Vec::new();
        crate::protocol::write_launch(&mut overflow_control, binding.clone(), overflow, &input)?;
        if !matches!(execute_host(&path, &held.identity().sha256,
            crate::protocol::prepare_buffer(&overflow_control)?),
            Err(error) if error == "native host did not complete cleanly")
        {
            return Err("host accepted truncated provider output".into());
        }
        // Run the built host itself as an ordinary native fixture. Its unknown
        // argument exits 2 and emits stderr; the outer host must still exit 0
        // and preserve that provider outcome separately.
        let mut nonzero = launch.clone();
        nonzero.executable = path.to_str().ok_or("host path is not UTF-8")?.into();
        nonzero.executable_sha256 = held.identity().sha256.clone();
        nonzero.args = vec!["--invalid-provider-fixture".into()];
        nonzero.input_bytes = 0;
        nonzero.input_sha256 = {
            use sha2::Digest;
            format!("{:x}", sha2::Sha256::digest([]))
        };
        let mut nonzero_control = Vec::new();
        crate::protocol::write_launch(&mut nonzero_control, binding.clone(), nonzero, &[])?;
        let (_, failed_provider) = execute_host(
            &path,
            &held.identity().sha256,
            crate::protocol::prepare_buffer(&nonzero_control)?,
        )?;
        if failed_provider.capture.exit_code != 2
            || !failed_provider.capture.stdout.is_empty()
            || !failed_provider
                .capture
                .stderr
                .starts_with(b"capture host: usage:")
        {
            return Err("host did not preserve failed provider exit and stderr".into());
        }
        let (host, reply) = execute_host(
            &path,
            &held.identity().sha256,
            crate::protocol::prepare_buffer(&control)?,
        )?;
        if reply.capture.exit_code != 0
            || reply.capture.stdout != expected_output
            || !reply.capture.stderr.is_empty()
        {
            return Err("contained host sort result mismatch".into());
        }
        self_test_host_blocked_input(&path, &held.identity().sha256, &binding, &launch)?;
        self_test_host_live_output(&path, &held.identity().sha256, &binding, &launch)?;
        self_test_host_controls(&path, &held.identity().sha256, &binding, &launch)?;
        self_test_host_receipt_ack(&path, &held.identity().sha256, &binding, &launch)?;
        self_test_host_launch_gate(&path, &held.identity().sha256, &binding, &launch)?;
        self_test_host_checkpoints(&path, &held.identity().sha256, &control)?;
        self_test_host_stalled_checkpoint(&path, &held.identity().sha256, &control)?;
        self_test_operational_timeout(&path, &held.identity().sha256, &control)?;
        return Ok(
            serde_json::json!({"schemaVersion":1,"state":"contained_host_self_test_passed",
            "hostIdentity":host,"inputBytes":input.len(),"stdoutBytes":reply.capture.stdout.len(),
            "stderrBytes":reply.capture.stderr.len(),"wrongHostDigestRejected":true,
            "wrongProviderDigestRejected":true,"providerOverflowRejected":true,
            "providerNonzeroExitPreserved":true,"blockedInputDeadlineAndCleanupPassed":true,
            "framedReplyValidated":true,"liveParentObservationBeforeExitPassed":true,
            "duplexControlRetirementPassed":true,"receiptAcknowledgementValidated":true,
            "processAndDeliveryObservationsValidated":true,
            "launchAcceptedBeforeInputValidated":true,"checkpointHandoffValidated":true,
            "stalledCheckpointDeadlineValidated":true,
            "operationalLongRunDeadlineAndCancellationValidated":true}),
        );
    }
    let (observed_binding, captured) =
        execute_prepared(crate::protocol::prepare_buffer(&control)?)?;
    if observed_binding != binding {
        return Err("diagnostic capture binding changed".into());
    }
    if captured.exit_code != 0 || captured.stdout != expected_output || !captured.stderr.is_empty()
    {
        return Err("native sort pipe self-test output mismatch".into());
    }
    Ok(
        serde_json::json!({"schemaVersion":1,"state":"native_pipe_self_test_passed",
        "identity":captured.identity,"stdoutBytes":captured.stdout.len(),"stderrBytes":captured.stderr.len()}),
    )
}

/// Real host/provider timeout drill. The fixture never reads its large
/// stdin, so successful retirement must join the writer after native cleanup.
fn self_test_host_blocked_input(
    host: &Path,
    host_sha256: &str,
    binding: &crate::protocol::Binding,
    template: &crate::protocol::Launch,
) -> Result<(), String> {
    use sha2::Digest;
    let mut nonce = [0u8; 16];
    getrandom::fill(&mut nonce).map_err(|error| error.to_string())?;
    let root = std::env::temp_dir().join(format!(
        "pa-host-timeout-{:032x}",
        u128::from_le_bytes(nonce)
    ));
    std::fs::create_dir(&root).map_err(|error| error.to_string())?;
    let marker = root.join("capture-ready.txt");
    let result = (|| {
        let input = vec![b'x'; MAX_BYTES];
        let mut launch = template.clone();
        launch.executable = host.to_str().ok_or("fixture path is not UTF-8")?.into();
        launch.executable_sha256 = host_sha256.into();
        launch.cwd = root.to_str().ok_or("fixture cwd is not UTF-8")?.into();
        launch.args = vec!["--fixture-blocked-input".into()];
        launch.input_bytes = input.len();
        launch.input_sha256 = format!("{:x}", sha2::Sha256::digest(&input));
        launch.timeout_ms = 10000;
        let mut control = Vec::new();
        crate::protocol::write_launch(&mut control, binding.clone(), launch, &input)?;
        let mut command = Command::diagnostic(host);
        command.args.push("--protocol-framed".into());
        let captured = execute_command_with_bound(
            &command,
            host_sha256,
            control,
            crate::host_reply::MAX_REPLY_BYTES,
            Duration::from_secs(20),
            crate::protocol::MAX_CONTROL_BYTES,
        )?;
        if std::fs::read(&marker).map_err(|error| {
            format!(
                "fixture never started: {error}; host exit={}, stderr={:?}",
                captured.exit_code,
                String::from_utf8_lossy(&captured.stderr)
            )
        })? != b"ready"
        {
            return Err("unexpected native fixture marker".into());
        }
        if captured.exit_code != 2
            || !captured.stdout.is_empty()
            || captured.stderr != b"capture host: capture deadline exceeded\n"
        {
            return Err(format!(
                "host timeout did not return its exact failure: exit={}, stderr={:?}",
                captured.exit_code,
                String::from_utf8_lossy(&captured.stderr)
            ));
        }
        // execute_command returns only after the outer job has zero active
        // processes and its writer is joined. Host error proves inner cleanup.
        Ok(())
    })();
    if marker.exists() {
        std::fs::remove_file(&marker).map_err(|error| error.to_string())?;
    }
    std::fs::remove_dir(&root).map_err(|error| error.to_string())?;
    result
}

fn self_test_host_live_output(
    host: &Path,
    host_sha256: &str,
    binding: &crate::protocol::Binding,
    template: &crate::protocol::Launch,
) -> Result<(), String> {
    use sha2::Digest;
    let mut nonce = [0u8; 16];
    getrandom::fill(&mut nonce).map_err(|error| error.to_string())?;
    let root =
        std::env::temp_dir().join(format!("pa-host-live-{:032x}", u128::from_le_bytes(nonce)));
    std::fs::create_dir(&root).map_err(|error| error.to_string())?;
    let marker = root.join("capture-ack.txt");
    let result = (|| {
        let mut launch = template.clone();
        launch.executable = host.to_str().ok_or("fixture path is not UTF-8")?.into();
        launch.executable_sha256 = host_sha256.into();
        launch.cwd = root.to_str().ok_or("fixture cwd is not UTF-8")?.into();
        launch.args = vec!["--fixture-live-output".into()];
        launch.input_bytes = 0;
        launch.input_sha256 = format!("{:x}", sha2::Sha256::digest([]));
        launch.timeout_ms = 10000;
        let mut control = Vec::new();
        crate::protocol::write_launch(&mut control, binding.clone(), launch, &[])?;
        let prepared = crate::protocol::prepare_buffer(&control)?;
        let (tx, rx) = std::sync::mpsc::sync_channel(64);
        let captured = std::thread::scope(|scope| {
            let marker = &marker;
            let observer = scope.spawn(move || -> Result<(), String> {
                let deadline = Instant::now() + Duration::from_secs(12);
                let mut bytes = Vec::new();
                let mut acknowledged = false;
                while Instant::now() < deadline {
                    match rx.recv_timeout(Duration::from_millis(50)) {
                        Ok(OutputEvent::Bytes {
                            stream: OutputStream::Stdout,
                            bytes: part,
                            ..
                        }) => {
                            bytes.extend(part);
                            if !acknowledged && bytes == b"live-ready\n" {
                                let mut file = std::fs::OpenOptions::new()
                                    .write(true)
                                    .create_new(true)
                                    .open(marker)
                                    .map_err(|e| e.to_string())?;
                                file.write_all(b"observed").map_err(|e| e.to_string())?;
                                acknowledged = true;
                            }
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                        _ => {}
                    }
                }
                if acknowledged {
                    Ok(())
                } else {
                    Err("parent did not observe live provider output".into())
                }
            });
            let capture = execute_host_observed(host, host_sha256, prepared, Some(&tx));
            drop(tx);
            let observed = observer.join().map_err(|_| "fixture observer panicked")?;
            observed?;
            capture
        })?;
        if captured.1.capture.exit_code != 0 || captured.1.capture.stdout != b"live-ready\n" {
            return Err("provider exited without live parent acknowledgement".into());
        }
        std::fs::remove_file(&marker).map_err(|error| error.to_string())?;
        for disconnected in [false, true] {
            let (tx, rx) = std::sync::mpsc::sync_channel(1);
            tx.try_send(OutputEvent::Eof {
                stream: OutputStream::Stdout,
                offset: 0,
            })
            .map_err(|error| error.to_string())?;
            let _receiver = if disconnected {
                drop(rx);
                None
            } else {
                Some(rx)
            };
            let failure = execute_host_observed(
                host,
                host_sha256,
                crate::protocol::prepare_buffer(&control)?,
                Some(&tx),
            );
            let expected = if disconnected {
                "capture event observer disconnected"
            } else {
                "capture event capacity exceeded"
            };
            if !matches!(failure, Err(ref error) if error == expected) || marker.exists() {
                return Err("unavailable live observer did not retire native capture".into());
            }
        }
        Ok(())
    })();
    if marker.exists() {
        std::fs::remove_file(&marker).map_err(|error| error.to_string())?;
    }
    std::fs::remove_dir(&root).map_err(|error| error.to_string())?;
    result
}

fn self_test_host_controls(
    host: &Path,
    host_sha256: &str,
    binding: &crate::protocol::Binding,
    template: &crate::protocol::Launch,
) -> Result<(), String> {
    use sha2::Digest;
    let mut nonce = [0u8; 16];
    getrandom::fill(&mut nonce).map_err(|error| error.to_string())?;
    let root = std::env::temp_dir().join(format!(
        "pa-host-control-{:032x}",
        u128::from_le_bytes(nonce)
    ));
    std::fs::create_dir(&root).map_err(|error| error.to_string())?;
    let result = (|| {
        for case in 0..3 {
            let mut launch = template.clone();
            launch.executable = host.to_str().ok_or("fixture path is not UTF-8")?.into();
            launch.executable_sha256 = host_sha256.into();
            launch.cwd = root.to_str().ok_or("fixture cwd is not UTF-8")?.into();
            launch.args = vec!["--fixture-live-output".into()];
            launch.input_bytes = 0;
            launch.input_sha256 = format!("{:x}", sha2::Sha256::digest([]));
            launch.timeout_ms = 10000;
            let mut initial = Vec::new();
            crate::protocol::write_launch(&mut initial, binding.clone(), launch.clone(), &[])?;
            let mut update_binding = binding.clone();
            if case == 1 {
                update_binding.session_id.push_str("-wrong");
            }
            let message = if case == 2 {
                crate::protocol::Control::Input {
                    offset: 0,
                    bytes: vec![b'x'],
                }
            } else {
                crate::protocol::Control::Cancel
            };
            let mut update = Vec::new();
            crate::protocol::write_packet(
                &mut update,
                &crate::protocol::Packet {
                    schema_version: crate::protocol::VERSION,
                    sequence: 2,
                    binding: update_binding,
                    message,
                },
            )?;
            let (tx, rx) = std::sync::mpsc::sync_channel(1);
            let mut update = Some(update);
            let mut receiver =
                crate::host_events::IncrementalReceiver::with_lifecycle(binding.clone(), launch)?;
            let mut observed = Vec::new();
            let mut consume = |event| -> Result<(), String> {
                if let OutputEvent::Bytes {
                    stream: OutputStream::Stdout,
                    bytes,
                    ..
                } = event
                {
                    for event in receiver.push(&bytes)? {
                        if let crate::host_events::Event::Output(OutputEvent::Bytes {
                            stream: OutputStream::Stdout,
                            bytes,
                            ..
                        }) = event
                        {
                            observed.extend(bytes);
                            if observed == b"live-ready\n" {
                                if let Some(bytes) = update.take() {
                                    tx.try_send(ControlUpdate {
                                        bytes,
                                        close: false,
                                    })
                                    .map_err(|_| "fixture control update unavailable")?;
                                }
                            }
                        }
                    }
                }
                Ok(())
            };
            let mut command = Command::diagnostic(host);
            command.args.push("--protocol-duplex".into());
            let captured = execute_with_observer(
                &command,
                host_sha256,
                InputDelivery::Live {
                    initial,
                    updates: rx,
                    closed: Arc::new(AtomicBool::new(false)),
                },
                crate::host_events::MAX_WIRE_BYTES,
                Duration::from_secs(20),
                crate::host_events::MAX_WIRE_BYTES,
                Observer::Callback(&mut consume),
            )?;
            if update.is_some() || captured.exit_code != 2 || receiver.finish().is_ok() {
                return Err("native control did not reject a live incomplete capture".into());
            }
            let stderr =
                String::from_utf8(captured.stderr).map_err(|_| "invalid host diagnostic")?;
            let expected = match case {
                0 => "capture host: capture cancelled by control\n",
                1 => "control reader failed: capture binding mismatch",
                _ => "control reader failed: input outside capture delivery",
            };
            if (case == 0 && stderr != expected) || (case != 0 && !stderr.contains(expected)) {
                return Err(format!("native control diagnostic mismatch: {stderr}"));
            }
        }
        Ok(())
    })();
    std::fs::remove_dir(&root).map_err(|error| error.to_string())?;
    result
}

fn self_test_host_launch_gate(
    host: &Path,
    host_sha256: &str,
    binding: &crate::protocol::Binding,
    launch: &crate::protocol::Launch,
) -> Result<(), String> {
    let mut initial = Vec::new();
    crate::protocol::write_packet(
        &mut initial,
        &crate::protocol::Packet {
            schema_version: crate::protocol::VERSION,
            sequence: 0,
            binding: binding.clone(),
            message: crate::protocol::Control::Launch {
                launch: launch.clone(),
            },
        },
    )?;
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let mut receiver =
        crate::host_events::IncrementalReceiver::with_lifecycle(binding.clone(), launch.clone())?;
    let mut accepted = false;
    let mut consume = |event| -> Result<(), String> {
        if let OutputEvent::Bytes {
            stream: OutputStream::Stdout,
            bytes,
            ..
        } = event
        {
            for event in receiver.push(&bytes)? {
                if !matches!(event, crate::host_events::Event::LaunchAccepted) || accepted {
                    return Err("native execution started before input was supplied".into());
                }
                accepted = true;
                let mut bytes = Vec::new();
                crate::protocol::write_packet(
                    &mut bytes,
                    &crate::protocol::Packet {
                        schema_version: crate::protocol::VERSION,
                        sequence: 1,
                        binding: binding.clone(),
                        message: crate::protocol::Control::Cancel,
                    },
                )?;
                tx.try_send(ControlUpdate {
                    bytes,
                    close: false,
                })
                .map_err(|_| "startup cancellation channel unavailable")?;
            }
        }
        Ok(())
    };
    let mut command = Command::diagnostic(host);
    command.args.push("--protocol-duplex".into());
    let captured = execute_with_observer(
        &command,
        host_sha256,
        InputDelivery::Live {
            initial,
            updates: rx,
            closed: Arc::new(AtomicBool::new(false)),
        },
        crate::host_events::MAX_WIRE_BYTES,
        Duration::from_secs(10),
        crate::host_events::MAX_WIRE_BYTES,
        Observer::Callback(&mut consume),
    )?;
    if !accepted
        || captured.exit_code != 2
        || receiver.finish().is_ok()
        || !String::from_utf8_lossy(&captured.stderr)
            .contains("capture input preparation unavailable")
    {
        return Err("native launch-only cancellation did not retire cleanly".into());
    }
    Ok(())
}

fn self_test_host_receipt_ack(
    host: &Path,
    host_sha256: &str,
    binding: &crate::protocol::Binding,
    template: &crate::protocol::Launch,
) -> Result<(), String> {
    use sha2::Digest;
    for case in 0..5 {
        let input = b"a\r\n";
        let mut launch = template.clone();
        launch.input_bytes = input.len();
        launch.input_sha256 = format!("{:x}", sha2::Sha256::digest(input));
        let mut initial = Vec::new();
        crate::protocol::write_launch(&mut initial, binding.clone(), launch.clone(), input)?;
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let mut receiver =
            crate::host_events::IncrementalReceiver::with_lifecycle(binding.clone(), launch)?;
        let mut completed = false;
        let mut consume = |event| -> Result<(), String> {
            if let OutputEvent::Bytes {
                stream: OutputStream::Stdout,
                bytes,
                ..
            } = event
            {
                receiver.push(&bytes)?;
                if let Some(sequence) = receiver.completion_sequence() {
                    if !completed {
                        completed = true;
                        if case != 0 {
                            let mut ack_binding = binding.clone();
                            if case == 2 {
                                ack_binding.session_id.push_str("-wrong");
                            }
                            let mut bytes = Vec::new();
                            crate::protocol::write_packet(
                                &mut bytes,
                                &crate::protocol::Packet {
                                    schema_version: crate::protocol::VERSION,
                                    sequence: 3,
                                    binding: ack_binding,
                                    message: crate::protocol::Control::ReceiptObserved {
                                        event_sequence: sequence + u64::from(case == 1),
                                    },
                                },
                            )?;
                            if case == 3 {
                                bytes.extend(bytes.clone());
                            }
                            if case == 4 {
                                bytes.push(0);
                            }
                            tx.try_send(ControlUpdate { bytes, close: true })
                                .map_err(|_| "fixture receipt update unavailable")?;
                        }
                    }
                }
            }
            Ok(())
        };
        let mut command = Command::diagnostic(host);
        command.args.push("--protocol-duplex".into());
        let captured = execute_with_observer(
            &command,
            host_sha256,
            InputDelivery::Live {
                initial,
                updates: rx,
                closed: Arc::new(AtomicBool::new(false)),
            },
            crate::host_events::MAX_WIRE_BYTES,
            Duration::from_secs(20),
            crate::host_events::MAX_WIRE_BYTES,
            Observer::Callback(&mut consume),
        )?;
        if !completed || captured.exit_code != 2 {
            return Err("host accepted an absent or invalid terminal acknowledgement".into());
        }
        let stderr = String::from_utf8(captured.stderr).map_err(|_| "invalid host diagnostic")?;
        let expected = match case {
            0 => "receipt acknowledgement unavailable",
            1 => "receipt acknowledgement sequence mismatch",
            2 => "capture binding mismatch",
            _ => "extra control after terminal acknowledgement",
        };
        if !stderr.contains(expected) {
            return Err(format!("receipt rejection diagnostic mismatch: {stderr}"));
        }
    }
    Ok(())
}

fn execute_prepared(
    prepared: crate::protocol::Prepared,
) -> Result<(crate::protocol::Binding, Capture), String> {
    execute_prepared_observed(prepared, None)
}

fn execute_prepared_observed(
    prepared: crate::protocol::Prepared,
    events: Option<&std::sync::mpsc::SyncSender<OutputEvent>>,
) -> Result<(crate::protocol::Binding, Capture), String> {
    execute_prepared_controlled(prepared, events, None)
}

fn execute_prepared_controlled(
    prepared: crate::protocol::Prepared,
    events: Option<&std::sync::mpsc::SyncSender<OutputEvent>>,
    cancel: Option<&AtomicBool>,
) -> Result<(crate::protocol::Binding, Capture), String> {
    let observer = events.map_or(Observer::None, Observer::Channel);
    let observer = match cancel {
        Some(cancel) => Observer::Controlled(Box::new(observer), cancel),
        None => observer,
    };
    execute_prepared_with_observer(prepared, observer)
}

fn execute_prepared_with_observer(
    prepared: crate::protocol::Prepared,
    observer: Observer<'_>,
) -> Result<(crate::protocol::Binding, Capture), String> {
    match execute_prepared_outcome(prepared, observer)? {
        (binding, Outcome::Completed(captured)) => Ok((binding, captured)),
        (_, Outcome::ExitedUndelivered { .. }) => Err(INPUT_NOT_CONFIRMED.into()),
    }
}

fn execute_prepared_outcome(
    prepared: crate::protocol::Prepared,
    observer: Observer<'_>,
) -> Result<(crate::protocol::Binding, Outcome), String> {
    let (binding, launch, input) = prepared.into_parts();
    let command = Command {
        executable: launch.executable.into(),
        args: launch.args.into_iter().map(OsString::from).collect(),
        cwd: launch.cwd.into(),
        environment: launch
            .environment
            .into_iter()
            .map(|entry| (entry.key, OsString::from(entry.value)))
            .collect(),
        no_progress: crate::stream_guard::NO_PROGRESS_LIMIT,
    };
    let outcome = execute_with_observer_outcome(
        &command,
        &launch.executable_sha256,
        InputDelivery::Closed(input),
        launch.output_limit,
        Duration::from_millis(launch.timeout_ms),
        MAX_BYTES,
        observer,
    )?;
    Ok((binding, outcome))
}

pub(super) fn execute_protocol(
    prepared: crate::protocol::Prepared,
) -> Result<serde_json::Value, String> {
    if prepared.launch().timeout_ms > 30_000 {
        return Err("diagnostic capture timeout exceeds 30 seconds".into());
    }
    execute_protocol_observed(prepared, None, None)
}

fn execute_protocol_observed(
    prepared: crate::protocol::Prepared,
    events: Option<&std::sync::mpsc::SyncSender<OutputEvent>>,
    cancel: Option<&AtomicBool>,
) -> Result<serde_json::Value, String> {
    let observer = events.map_or(Observer::None, Observer::Channel);
    let observer = match cancel {
        Some(cancel) => Observer::Controlled(Box::new(observer), cancel),
        None => observer,
    };
    execute_protocol_with_observer(prepared, observer)
}

fn execute_protocol_with_observer(
    prepared: crate::protocol::Prepared,
    observer: Observer<'_>,
) -> Result<serde_json::Value, String> {
    let (input_bytes, input_sha256) = prepared.input_receipt();
    let input_sha256 = input_sha256.to_owned();
    let (binding, captured) = execute_prepared_with_observer(prepared, observer)?;
    serde_json::to_value(serde_json::json!({
        "schemaVersion": 1,
        "state": "native_protocol_capture_completed",
        "binding": binding,
        "inputBytes": input_bytes,
        "inputSha256": input_sha256,
        "capture": captured,
    }))
    .map_err(|error| format!("serialize native capture result: {error}"))
}

/// Terminal settlement for the event stream. Only a lifecycle stream (which
/// carries process verification and delivery observations) may report an
/// undelivered exit; every other stream keeps the unconfirmed failure.
fn execute_protocol_settlement(
    prepared: crate::protocol::Prepared,
    observer: Observer<'_>,
    lifecycle: bool,
) -> Result<crate::host_events::Settlement, String> {
    use crate::host_events::Settlement;
    let (input_bytes, input_sha256) = prepared.input_receipt();
    let input_sha256 = input_sha256.to_owned();
    match execute_prepared_outcome(prepared, observer)? {
        (binding, Outcome::Completed(captured)) => {
            // Stream bytes have already been framed. Completion carries their bound
            // native identity/exit receipt only; the receiver reconstructs the bytes.
            let mut value = serde_json::json!({
                "schemaVersion": 1,
                "state": "native_protocol_capture_completed",
                "binding": binding,
                "inputBytes": input_bytes,
                "inputSha256": input_sha256,
                "capture": captured,
            });
            value["capture"]["stdout"] = serde_json::json!([]);
            value["capture"]["stderr"] = serde_json::json!([]);
            serde_json::from_value(value)
                .map(Settlement::Completed)
                .map_err(|_| "invalid native event settlement".into())
        }
        (
            binding,
            Outcome::ExitedUndelivered {
                identity,
                exit_code,
            },
        ) if lifecycle => serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "state": crate::host_reply::UNDELIVERED_EXIT_STATE,
            "binding": binding,
            "inputBytes": input_bytes,
            "inputSha256": input_sha256,
            "identity": identity,
            "exitCode": exit_code,
            "reason": crate::host_reply::UndeliveredReason::ProviderExitedBeforeInputDelivery,
        }))
        .map(Settlement::ExitedUndelivered)
        .map_err(|_| "invalid native undelivered exit".into()),
        (_, Outcome::ExitedUndelivered { .. }) => Err(INPUT_NOT_CONFIRMED.into()),
    }
}

pub(super) fn execute_protocol_framed(prepared: crate::protocol::Prepared) -> Result<(), String> {
    if prepared.launch().timeout_ms > 30_000 {
        return Err("diagnostic capture timeout exceeds 30 seconds".into());
    }
    execute_protocol_framed_controlled(prepared, None, None)
}

struct ReceiptHandshake {
    expected: AtomicU64,
    observed: AtomicBool,
}

impl ReceiptHandshake {
    fn new() -> Self {
        Self {
            expected: AtomicU64::new(u64::MAX),
            observed: AtomicBool::new(false),
        }
    }

    fn arm(&self, sequence: u64) -> Result<(), String> {
        if sequence == u64::MAX {
            return Err("invalid receipt sequence".into());
        }
        self.expected
            .compare_exchange(u64::MAX, sequence, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| ())
            .map_err(|_| "receipt already published".into())
    }

    fn validate(&self, sequence: u64) -> Result<(), String> {
        let expected = self.expected.load(Ordering::Acquire);
        if expected == u64::MAX || sequence != expected {
            return Err("receipt acknowledgement sequence mismatch".into());
        }
        Ok(())
    }

    fn confirm(&self, sequence: u64) -> Result<(), String> {
        self.validate(sequence)?;
        self.observed
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| ())
            .map_err(|_| "duplicate receipt acknowledgement".into())
    }
}

fn expected_control_shutdown(stopping: bool, error: &str) -> bool {
    stopping && error == crate::protocol::READ_CANCELLED
}

pub(super) fn execute_protocol_duplex() -> Result<(), String> {
    let receipt = Arc::new(ReceiptHandshake::new());
    let reader_receipt = Arc::clone(&receipt);
    let cancel = Arc::new(AtomicBool::new(false));
    let stop = Arc::new(AtomicBool::new(false));
    let reader_cancel = Arc::clone(&cancel);
    let reader_stop = Arc::clone(&stop);
    let (prepared_tx, prepared_rx) = std::sync::mpsc::sync_channel(1);
    let (launch_tx, launch_rx) = std::sync::mpsc::sync_channel(1);
    let startup_deadline = Instant::now() + Duration::from_secs(30);
    let reader = std::thread::Builder::new()
        .name("capture-control".into())
        .spawn(move || {
            let stdin = std::io::stdin();
            let mut input = stdin.lock();
            let mut receiver = crate::protocol::Receiver::default();
            loop {
                if reader_stop.load(Ordering::Acquire) {
                    return Ok(());
                }
                match receiver.read(&mut input) {
                    Ok(crate::protocol::Accepted::Pending) => {
                        if let Some((binding, launch)) = receiver.launch_header() {
                            if launch_tx
                                .try_send((binding.clone(), launch.clone()))
                                .is_err()
                            {
                                reader_cancel.store(true, Ordering::Release);
                                return Err("capture launch observer unavailable".into());
                            }
                        }
                    }
                    Ok(crate::protocol::Accepted::Ready(prepared)) => {
                        if prepared_tx.try_send(*prepared).is_err() {
                            reader_cancel.store(true, Ordering::Release);
                            return Err("capture preparation observer unavailable".into());
                        }
                    }
                    Ok(crate::protocol::Accepted::Cancelled) => {
                        reader_cancel.store(true, Ordering::Release);
                        return Ok(());
                    }
                    Ok(crate::protocol::Accepted::ReceiptObserved(sequence)) => {
                        let acknowledgement = reader_receipt
                            .validate(sequence)
                            .and_then(|_| receiver.finish(&mut input).map_err(String::from))
                            .and_then(|_| reader_receipt.confirm(sequence));
                        if acknowledgement.is_err() {
                            reader_cancel.store(true, Ordering::Release);
                        }
                        return acknowledgement;
                    }
                    Err(error) => {
                        if expected_control_shutdown(reader_stop.load(Ordering::Acquire), error) {
                            return Ok(());
                        }
                        reader_cancel.store(true, Ordering::Release);
                        return Err(error.into());
                    }
                }
            }
        })
        .map_err(|error| error.to_string())?;
    let execution = launch_rx
        .recv_timeout(startup_deadline.saturating_duration_since(Instant::now()))
        .map_err(|_| "capture launch unavailable".into())
        .and_then(|(binding, launch)| {
            execute_protocol_events(binding, Some(&cancel), Some(receipt), |events| {
                send_host_message(
                    events,
                    crate::host_events::Message::LaunchAccepted {
                        launch_sha256: launch.digest()?,
                    },
                )?;
                prepared_rx
                    .recv_timeout(startup_deadline.saturating_duration_since(Instant::now()))
                    .map_err(|_| "capture input preparation unavailable".into())
            })
        });
    let reader_result = finish_writer(reader, &stop);
    let mut errors = Vec::new();
    if let Err(error) = execution {
        errors.push(error);
    }
    match reader_result {
        Err(error) => errors.push(format!("control reader cleanup failed: {error}")),
        Ok(Err(error)) => errors.push(format!("control reader failed: {error}")),
        Ok(Ok(())) => {}
    }
    if cancel.load(Ordering::Acquire) && errors.is_empty() {
        errors.push("capture cancelled by control".into());
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn execute_protocol_framed_controlled(
    prepared: crate::protocol::Prepared,
    cancel: Option<&AtomicBool>,
    handshake: Option<Arc<ReceiptHandshake>>,
) -> Result<(), String> {
    execute_protocol_events(prepared.binding().clone(), cancel, handshake, |_| {
        Ok(prepared)
    })
}

fn execute_protocol_events(
    binding: crate::protocol::Binding,
    cancel: Option<&AtomicBool>,
    handshake: Option<Arc<ReceiptHandshake>>,
    prepare: impl FnOnce(
        &std::sync::mpsc::SyncSender<crate::host_events::Message>,
    ) -> Result<crate::protocol::Prepared, String>,
) -> Result<(), String> {
    use crate::host_events::{Message, Sender, Settlement};
    let lifecycle = handshake.is_some();
    let (events_tx, events_rx) = std::sync::mpsc::sync_channel(64);
    let (terminal_tx, terminal_rx) = std::sync::mpsc::sync_channel::<Result<Settlement, String>>(1);
    let stop = Arc::new(AtomicBool::new(false));
    let writer_stop = Arc::clone(&stop);
    let writer = std::thread::Builder::new()
        .name("capture-events".into())
        .spawn(move || {
            let stdout = std::io::stdout();
            let mut sender = Sender::new(stdout.lock(), binding)?;
            loop {
                if writer_stop.load(Ordering::Acquire) {
                    return Err("event writer canceled".into());
                }
                match events_rx.recv_timeout(Duration::from_millis(50)) {
                    Ok(message) => sender.send(message)?,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
            let receipt = match terminal_rx
                .recv_timeout(Duration::from_secs(5))
                .map_err(|_| "event settlement unavailable")??
            {
                Settlement::Completed(receipt) => receipt,
                Settlement::ExitedUndelivered(exit) => {
                    // Nothing was delivered, so there is no receipt for the
                    // parent to persist and acknowledge before host exit.
                    sender.send(Message::ExitedUndelivered {
                        exit: Box::new(exit),
                    })?;
                    return Ok(());
                }
            };
            if let Some(handshake) = &handshake {
                handshake.arm(sender.next_sequence())?;
            }
            sender.send(Message::Completed {
                receipt: Box::new(receipt),
            })?;
            if let Some(handshake) = &handshake {
                let deadline = Instant::now() + Duration::from_secs(3);
                while !handshake.observed.load(Ordering::Acquire) {
                    if writer_stop.load(Ordering::Acquire) || Instant::now() >= deadline {
                        return Err("receipt acknowledgement unavailable".into());
                    }
                    std::thread::sleep(Duration::from_millis(2));
                }
            }
            Ok(())
        })
        .map_err(|error| error.to_string())?;
    let observer = Observer::Host(&events_tx, lifecycle);
    let observer = match cancel {
        Some(cancel) => Observer::Controlled(Box::new(observer), cancel),
        None => observer,
    };
    let terminal = prepare(&events_tx)
        .and_then(|prepared| execute_protocol_settlement(prepared, observer, lifecycle));
    let capture_failure = terminal.as_ref().err().cloned();
    drop(events_tx);
    let submitted = terminal_tx.send(terminal);
    drop(terminal_tx);
    let drain_deadline = Instant::now() + Duration::from_secs(5);
    while !writer.is_finished() && Instant::now() < drain_deadline {
        std::thread::sleep(Duration::from_millis(2));
    }
    // Cancel a blocked stdout write, boundedly join, and never accept a prefix.
    confirm_event_writer(
        capture_failure,
        finish_writer(writer, &stop),
        submitted.is_ok(),
    )
}

fn confirm_event_writer(
    capture_failure: Option<String>,
    writer: Result<Result<(), String>, String>,
    submitted: bool,
) -> Result<(), String> {
    let mut failures: Vec<String> = capture_failure.into_iter().collect();
    match writer {
        Err(error) => failures.push(format!("event writer cleanup failed: {error}")),
        Ok(Err(error)) if !failures.contains(&error) => {
            failures.push(format!("event writer failed: {error}"));
        }
        Ok(_) => {}
    }
    if !submitted {
        failures.push("event settlement observer disconnected".into());
    }
    if !failures.is_empty() {
        return Err(failures.join("; "));
    }
    Ok(())
}

/// A real parent-owned process boundary. This bounded diagnostic transport is
/// not the durable/streaming app adapter: no reservation or settlement is made.
/// Never use an unverified PATH host or reinterpret stderr as a provider reply.
fn execute_host(
    host_path: &Path,
    host_sha256: &str,
    prepared: crate::protocol::Prepared,
) -> Result<(SuspendedObservation, crate::host_reply::Reply), String> {
    execute_host_observed(host_path, host_sha256, prepared, None)
}

fn self_test_host_checkpoints(
    host: &Path,
    host_sha256: &str,
    control: &[u8],
) -> Result<(), String> {
    use crate::checkpoints::Stage;
    for rejected in [
        None,
        Some(Stage::Launch),
        Some(Stage::Process),
        Some(Stage::Input),
        Some(Stage::Receipt),
    ] {
        let (sender, receiver) = std::sync::mpsc::sync_channel::<crate::checkpoints::Request>(4);
        let done = AtomicBool::new(false);
        std::thread::scope(|scope| -> Result<(), String> {
            let done = &done;
            let owner = scope.spawn(move || -> Result<(), String> {
                for stage in [Stage::Launch, Stage::Process, Stage::Input, Stage::Receipt] {
                    let request = receiver
                        .recv_timeout(Duration::from_secs(10))
                        .map_err(|_| "checkpoint fixture did not receive expected stage")?;
                    if request.stage != stage
                        || request.binding.run_id != "diagnostic-not-a-development-run"
                        || !request.payload.is_object()
                    {
                        return Err(
                            "checkpoint fixture received wrong binding/stage/payload".into()
                        );
                    }
                    if stage == Stage::Launch
                        && !matches!(
                            receiver.recv_timeout(Duration::from_millis(50)),
                            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
                        )
                    {
                        return Err(
                            "provider progressed before launch checkpoint acknowledgement".into(),
                        );
                    }
                    if stage == Stage::Receipt {
                        std::thread::sleep(Duration::from_millis(50));
                        if done.load(Ordering::Acquire) {
                            return Err(
                                "parent completed before receipt checkpoint acknowledgement".into(),
                            );
                        }
                    }
                    if rejected == Some(stage) {
                        if stage == Stage::Input {
                            drop(request);
                        } else {
                            request.acknowledge(Err("fixture storage unavailable".into()))?;
                        }
                        return Ok(());
                    }
                    request.acknowledge(Ok(()))?;
                }
                Ok(())
            });
            let result = execute_host_checkpointed(
                host,
                host_sha256,
                crate::protocol::prepare_buffer(control)?,
                None,
                Some(sender),
            );
            done.store(true, Ordering::Release);
            owner.join().map_err(|_| "checkpoint fixture panicked")??;
            match (rejected, result) {
                (None, Ok(_)) => Ok(()),
                (Some(_), Err(error))
                    if error == "checkpoint persistence unconfirmed"
                        || error == "checkpoint consumer unavailable" =>
                {
                    Ok(())
                }
                (_, Err(error)) => Err(format!("checkpoint fixture unexpected failure: {error}")),
                _ => Err("native host ignored rejected checkpoint".into()),
            }
        })?;
    }
    Ok(())
}

fn self_test_host_stalled_checkpoint(
    host: &Path,
    host_sha256: &str,
    control: &[u8],
) -> Result<(), String> {
    let (binding, mut launch, input) = crate::protocol::prepare_buffer(control)?.into_parts();
    launch.timeout_ms = 250;
    let mut wire = Vec::new();
    crate::protocol::write_launch(&mut wire, binding, launch, &input)?;
    let (sender, receiver) = std::sync::mpsc::sync_channel::<crate::checkpoints::Request>(4);
    let done = AtomicBool::new(false);
    std::thread::scope(|scope| -> Result<(), String> {
        let done = &done;
        let owner = scope.spawn(move || -> Result<(), String> {
            let request = receiver
                .recv_timeout(Duration::from_secs(10))
                .map_err(|_| "stalled fixture checkpoint missing")?;
            if request.stage != crate::checkpoints::Stage::Launch {
                return Err("stalled fixture received wrong stage".into());
            }
            let deadline = Instant::now() + Duration::from_secs(15);
            while !done.load(Ordering::Acquire) && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(2));
            }
            if !done.load(Ordering::Acquire) || request.acknowledge(Ok(())).is_ok() {
                return Err(
                    "stalled checkpoint outlived deadline or accepted late acknowledgement".into(),
                );
            }
            Ok(())
        });
        let result = execute_host_checkpointed(
            host,
            host_sha256,
            crate::protocol::prepare_buffer(&wire)?,
            None,
            Some(sender),
        );
        done.store(true, Ordering::Release);
        owner
            .join()
            .map_err(|_| "stalled fixture owner panicked")??;
        match result {
            Err(error) if error == "capture deadline exceeded" => Ok(()),
            Err(error) => Err(format!("stalled checkpoint failed unexpectedly: {error}")),
            Ok(_) => Err("stalled checkpoint allowed completion".into()),
        }
    })
}

fn execute_host_observed(
    host_path: &Path,
    host_sha256: &str,
    prepared: crate::protocol::Prepared,
    observer: Option<&std::sync::mpsc::SyncSender<OutputEvent>>,
) -> Result<(SuspendedObservation, crate::host_reply::Reply), String> {
    execute_host_checkpointed(host_path, host_sha256, prepared, observer, None)
}

struct ParentControls {
    gate: crate::checkpoints::Gate,
    input: Option<Vec<u8>>,
    sender: std::sync::mpsc::SyncSender<ControlUpdate>,
    binding: crate::protocol::Binding,
    acknowledgement_sequence: u64,
    receipt_sequence: Option<u64>,
    acknowledged: bool,
}

impl ParentControls {
    fn poll(&mut self) -> Result<(), String> {
        use crate::checkpoints::Stage;
        while let Some(stage) = self.gate.poll()? {
            let update = match stage {
                Stage::Launch => Some(ControlUpdate {
                    bytes: self.input.take().ok_or("launch input already consumed")?,
                    close: false,
                }),
                Stage::Receipt => {
                    let event_sequence =
                        self.receipt_sequence.ok_or("receipt checkpoint missing")?;
                    let mut bytes = Vec::new();
                    crate::protocol::write_packet(
                        &mut bytes,
                        &crate::protocol::Packet {
                            schema_version: crate::protocol::VERSION,
                            sequence: self.acknowledgement_sequence,
                            binding: self.binding.clone(),
                            message: crate::protocol::Control::ReceiptObserved { event_sequence },
                        },
                    )?;
                    self.acknowledged = true;
                    Some(ControlUpdate { bytes, close: true })
                }
                Stage::Process | Stage::Input => None,
            };
            if let Some(update) = update {
                self.sender
                    .try_send(update)
                    .map_err(|_| "checkpoint control channel unavailable")?;
            }
        }
        Ok(())
    }
}

fn self_test_operational_timeout(
    host: &Path,
    host_sha256: &str,
    control: &[u8],
) -> Result<(), String> {
    use crate::checkpoints::Stage;
    use sha2::Digest;
    // Run through the operational parent entry, with an explicit test consumer.
    // This proves native timing/cleanup, not SQLite durability or provider support.
    for case in 0..4 {
        let (binding, mut launch, _) = crate::protocol::prepare_buffer(control)?.into_parts();
        launch.executable = host.to_str().ok_or("fixture host path encoding")?.into();
        launch.executable_sha256 = if case == 3 {
            "0".repeat(64)
        } else {
            host_sha256.into()
        };
        launch.args = vec!["--fixture-long-running".into()];
        launch.input_bytes = 0;
        launch.input_sha256 = format!("{:x}", sha2::Sha256::digest([]));
        launch.timeout_ms = if case >= 2 { 2_000 } else { 40_000 };
        let mut wire = Vec::new();
        crate::protocol::write_launch(&mut wire, binding, launch, &[])?;
        let prepared = crate::protocol::prepare_buffer(&wire)?;
        if case == 0
            && !matches!(execute_host(host, host_sha256, crate::protocol::prepare_buffer(&wire)?),
                Err(error) if error == "diagnostic host provider timeout exceeds 20 seconds")
        {
            return Err("diagnostic host accepted operational timeout".into());
        }
        if case == 0 {
            for error in [
                execute_protocol(crate::protocol::prepare_buffer(&wire)?).err(),
                execute_protocol_framed(crate::protocol::prepare_buffer(&wire)?).err(),
            ] {
                if error.as_deref() != Some("diagnostic capture timeout exceeds 30 seconds") {
                    return Err("legacy diagnostic accepted operational timeout".into());
                }
            }
        }
        let cancelled = AtomicBool::new(false);
        let (sender, receiver) = std::sync::mpsc::sync_channel::<crate::checkpoints::Request>(4);
        let started = Instant::now();
        let (result, stages) = std::thread::scope(|scope| -> Result<_, String> {
            let cancelled = &cancelled;
            let actor = scope.spawn(move || -> Result<Vec<Stage>, String> {
                let mut stages = Vec::new();
                while let Ok(request) = receiver.recv_timeout(Duration::from_secs(50)) {
                    let stage = request.stage;
                    stages.push(stage);
                    request.acknowledge(Ok(()))?;
                    if case == 1 && stage == Stage::Input {
                        cancelled.store(true, Ordering::Release);
                    }
                }
                Ok(stages)
            });
            let result = execute_owned_host(host, host_sha256, prepared, sender, cancelled);
            let stages = actor
                .join()
                .map_err(|_| "timeout fixture actor panicked")??;
            Ok((result, stages))
        })?;
        if case == 0 {
            let HostSettlement::Completed(_, reply) = result? else {
                return Err("operational long-running fixture exited undelivered".into());
            };
            if started.elapsed() < Duration::from_secs(30)
                || reply.capture.exit_code != 0
                || reply.capture.stdout != b"long-running-complete\n"
                || !reply.capture.stderr.is_empty()
                || stages != [Stage::Launch, Stage::Process, Stage::Input, Stage::Receipt]
            {
                return Err("operational long-running completion mismatch".into());
            }
        } else {
            let error = result
                .err()
                .ok_or("interrupted long-running fixture completed")?;
            if started.elapsed() > Duration::from_secs(15)
                || (case == 1 && error != "capture cancelled by control")
                || (case == 2
                    && (error != "native host provider deadline exceeded"
                        || stages != [Stage::Launch, Stage::Process, Stage::Input]))
                || (case == 3
                    && (error != "native host did not complete cleanly"
                        || stages != [Stage::Launch]))
            {
                return Err(format!(
                    "operational interruption/cleanup mismatch: {error}"
                ));
            }
        }
    }
    Ok(())
}

fn execute_host_checkpointed(
    host_path: &Path,
    host_sha256: &str,
    prepared: crate::protocol::Prepared,
    observer: Option<&std::sync::mpsc::SyncSender<OutputEvent>>,
    checkpoints: Option<std::sync::mpsc::SyncSender<crate::checkpoints::Request>>,
) -> Result<(SuspendedObservation, crate::host_reply::Reply), String> {
    if prepared.launch().timeout_ms > 20_000 {
        return Err("diagnostic host provider timeout exceeds 20 seconds".into());
    }
    match execute_host_inner(
        host_path,
        host_sha256,
        prepared,
        observer,
        checkpoints,
        &AtomicBool::new(false),
    )? {
        HostSettlement::Completed(host, reply) => Ok((host, reply)),
        HostSettlement::ExitedUndelivered(..) => Err(INPUT_NOT_CONFIRMED.into()),
    }
}

/// Parent-side settlement of one owned host run. Only `Completed` carries an
/// acknowledged, checkpointed delivery receipt. `ExitedUndelivered` is a
/// validated terminal observation that the task input was never delivered.
pub enum HostSettlement {
    Completed(SuspendedObservation, crate::host_reply::Reply),
    ExitedUndelivered(SuspendedObservation, crate::host_reply::UndeliveredExit),
}

/// Operational callers must supply their owned durable consumer and keep the
/// registry occupied until both this native operation and that consumer retire.
#[allow(dead_code)] // Application parent entry; the host binary exports only diagnostics.
pub fn execute_owned_host(
    host_path: &Path,
    host_sha256: &str,
    prepared: crate::protocol::Prepared,
    checkpoints: std::sync::mpsc::SyncSender<crate::checkpoints::Request>,
    cancelled: &AtomicBool,
) -> Result<HostSettlement, String> {
    execute_host_inner(
        host_path,
        host_sha256,
        prepared,
        None,
        Some(checkpoints),
        cancelled,
    )
}

fn execute_host_inner(
    host_path: &Path,
    host_sha256: &str,
    prepared: crate::protocol::Prepared,
    observer: Option<&std::sync::mpsc::SyncSender<OutputEvent>>,
    checkpoints: Option<std::sync::mpsc::SyncSender<crate::checkpoints::Request>>,
    cancelled: &AtomicBool,
) -> Result<HostSettlement, String> {
    let (binding, launch, input) = prepared.into_parts();
    let (control, pending_input) =
        crate::protocol::launch_parts(binding.clone(), launch.clone(), &input)?;
    let mut command = Command::diagnostic(host_path);
    command.args.push("--protocol-duplex".into());
    // The host enforces the provider's no-progress window itself and then
    // reports its failure; the parent waits the same grace as for the deadline
    // so it never races the host's own, more precise stall result.
    command.no_progress = crate::stream_guard::NO_PROGRESS_LIMIT
        + Duration::from_millis(crate::protocol::HOST_GRACE_MS);
    // Prepared validates the protocol ceiling before this bounded addition.
    let timeout = Duration::from_millis(launch.timeout_ms + crate::protocol::HOST_GRACE_MS);
    let acknowledgement_sequence = input.len().div_ceil(crate::protocol::MAX_CHUNK) as u64 + 2;
    let launch_digest = launch.digest()?;
    let input_receipt = serde_json::json!({"launchSha256":launch_digest,"inputBytes":launch.input_bytes,"inputSha256":launch.input_sha256});
    let mut receiver =
        crate::host_events::IncrementalReceiver::with_lifecycle(binding.clone(), launch)?;
    let mut wire_eof = false;
    let (control_tx, control_rx) = std::sync::mpsc::sync_channel(1);
    let controls = std::cell::RefCell::new(ParentControls {
        gate: crate::checkpoints::Gate::new(binding.clone(), checkpoints),
        input: Some(pending_input),
        sender: control_tx,
        binding,
        acknowledgement_sequence,
        receipt_sequence: None,
        acknowledged: false,
    });
    let mut consume = |event| -> Result<(), String> {
        match event {
            OutputEvent::Bytes {
                stream: OutputStream::Stdout,
                bytes,
                ..
            } => {
                for event in receiver.push(&bytes)? {
                    use crate::checkpoints::Stage;
                    let checkpoint = match &event {
                        crate::host_events::Event::LaunchAccepted => {
                            Some((Stage::Launch, input_receipt.clone()))
                        }
                        crate::host_events::Event::ProcessVerified(identity) => Some((
                            Stage::Process,
                            serde_json::to_value(identity)
                                .map_err(|_| "checkpoint identity serialization failed")?,
                        )),
                        crate::host_events::Event::InputDelivered {
                            input_bytes,
                            input_sha256,
                        } => Some((
                            Stage::Input,
                            serde_json::json!({"inputBytes":input_bytes,"inputSha256":input_sha256}),
                        )),
                        crate::host_events::Event::Output(_) => None,
                    };
                    if let Some((stage, payload)) = checkpoint {
                        controls.borrow_mut().gate.submit(stage, payload)?;
                    }
                    if let (Some(observer), crate::host_events::Event::Output(event)) =
                        (observer, event)
                    {
                        send_output(observer, event)?;
                    }
                }
                if let Some(event_sequence) = receiver.completion_sequence() {
                    let mut controls = controls.borrow_mut();
                    if controls.receipt_sequence.is_none() {
                        let receipt = receiver
                            .pending_receipt()
                            .ok_or("checkpoint receipt unavailable")?;
                        controls.gate.submit(
                            crate::checkpoints::Stage::Receipt,
                            serde_json::to_value(receipt)
                                .map_err(|_| "checkpoint receipt serialization failed")?,
                        )?;
                        controls.receipt_sequence = Some(event_sequence);
                    }
                }
            }
            OutputEvent::Eof {
                stream: OutputStream::Stdout,
                ..
            } => wire_eof = true,
            _ => {} // Bootstrap stderr is checked after confirmed native cleanup.
        }
        Ok(())
    };
    let mut poll_checkpoints = || controls.borrow_mut().poll();
    let captured = execute_with_observer(
        &command,
        host_sha256,
        InputDelivery::Live {
            initial: control,
            updates: control_rx,
            closed: Arc::new(AtomicBool::new(false)),
        },
        crate::host_events::MAX_WIRE_BYTES,
        timeout,
        crate::host_events::MAX_WIRE_BYTES,
        Observer::Controlled(
            Box::new(Observer::Polling(
                Box::new(Observer::Callback(&mut consume)),
                &mut poll_checkpoints,
            )),
            cancelled,
        ),
    )?;
    if captured.exit_code != 0 || !captured.stderr.is_empty() {
        // Report only a known fixed diagnostic, never arbitrary provider/host
        // stderr. Cleanup and pipe retirement have already succeeded here.
        if captured.exit_code == 2
            && captured.stderr == b"capture host: capture deadline exceeded\n"
        {
            return Err("native host provider deadline exceeded".into());
        }
        return Err("native host did not complete cleanly".into());
    }
    if !wire_eof {
        return Err("native host event EOF unavailable".into());
    }
    let undelivered = receiver.exited_undelivered();
    let (acknowledged, receipt_checkpointed) = {
        let controls = controls.borrow();
        (controls.acknowledged, controls.receipt_sequence.is_some())
    };
    if !undelivered && !acknowledged {
        return Err("native host receipt checkpoint unconfirmed".into());
    }
    match receiver.finish_settlement()? {
        crate::host_events::Settlement::Completed(reply) if !undelivered => {
            Ok(HostSettlement::Completed(captured.identity, reply))
        }
        // No receipt may exist beside an undelivered exit: it was neither
        // checkpointed as delivered nor acknowledged to the host.
        crate::host_events::Settlement::ExitedUndelivered(exit)
            if undelivered && !acknowledged && !receipt_checkpointed =>
        {
            Ok(HostSettlement::ExitedUndelivered(captured.identity, exit))
        }
        _ => Err("native host settlement inconsistent".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operational_capture_accepts_bounded_provider_timeout_above_diagnostic_limit() {
        let path = PathBuf::from(std::env::var_os("SystemRoot").unwrap())
            .join("System32")
            .join("sort.exe");
        let image = VerifiedImage::observe(&path).unwrap();
        let captured = execute_with_observer(
            &Command::diagnostic(&path),
            &image.identity().sha256,
            InputDelivery::Closed(b"z\r\na\r\n".to_vec()),
            MAX_BYTES,
            Duration::from_secs(60),
            MAX_BYTES,
            Observer::None,
        )
        .unwrap();
        assert_eq!(captured.exit_code, 0);
        assert_eq!(captured.stdout, b"a\r\nz\r\n");
        assert!(captured.stderr.is_empty());
        assert_eq!(
            execute(
                &path,
                &image.identity().sha256,
                vec![],
                MAX_BYTES,
                Duration::from_secs(60)
            )
            .err()
            .as_deref(),
            Some("diagnostic capture timeout exceeds 30 seconds")
        );
        for timeout in [
            Duration::ZERO,
            Duration::from_millis(
                crate::protocol::MAX_TIMEOUT_MS + crate::protocol::HOST_GRACE_MS + 1,
            ),
        ] {
            assert_eq!(
                execute_with_observer(
                    &Command::diagnostic(&path),
                    &image.identity().sha256,
                    InputDelivery::Closed(vec![]),
                    MAX_BYTES,
                    timeout,
                    MAX_BYTES,
                    Observer::None,
                )
                .err()
                .as_deref(),
                Some("invalid bounded capture limits")
            );
        }
    }

    #[test]
    fn native_receipt_gate_requires_published_sequence_exactly_once() {
        let gate = ReceiptHandshake::new();
        assert!(gate.confirm(0).is_err());
        gate.arm(4).unwrap();
        assert!(gate.arm(5).is_err());
        assert!(gate.confirm(3).is_err());
        assert!(!gate.observed.load(Ordering::Acquire));
        gate.confirm(4).unwrap();
        assert!(gate.observed.load(Ordering::Acquire));
        assert!(gate.confirm(4).is_err());
    }

    #[test]
    fn control_shutdown_never_suppresses_parsed_validation_failures() {
        assert!(expected_control_shutdown(
            true,
            crate::protocol::READ_CANCELLED
        ));
        assert!(!expected_control_shutdown(
            false,
            crate::protocol::READ_CANCELLED
        ));
        for error in [
            "capture binding mismatch",
            "capture version or sequence mismatch",
            "capture control byte limit exceeded",
            "malformed capture frame",
            "input outside capture delivery",
            "capture frame ended before payload",
        ] {
            assert!(!expected_control_shutdown(true, error), "{error}");
            assert!(!expected_control_shutdown(false, error), "{error}");
        }
    }

    #[test]
    fn event_writer_failure_preserves_native_cleanup_uncertainty() {
        let error = confirm_event_writer(
            Some("job termination requires reconciliation".into()),
            Ok(Err("event write failed".into())),
            false,
        )
        .unwrap_err();
        assert!(
            error.contains("job termination requires reconciliation"),
            "{error}"
        );
        assert!(error.contains("event write failed"));
        assert!(error.contains("observer disconnected"));
    }

    #[test]
    fn event_settlement_preserves_all_failures_and_exact_deadline() {
        assert_eq!(confirm_event_writer(None, Ok(Ok(())), true), Ok(()));
        assert_eq!(
            confirm_event_writer(
                Some("capture deadline exceeded".into()),
                Ok(Err("capture deadline exceeded".into())),
                true
            ),
            Err("capture deadline exceeded".into())
        );
        assert_eq!(
            confirm_event_writer(None, Err("retained thread".into()), true),
            Err("event writer cleanup failed: retained thread".into())
        );
        assert_eq!(
            confirm_event_writer(Some("native cleanup unknown".into()),
                Err("retained thread".into()), false),
            Err("native cleanup unknown; event writer cleanup failed: retained thread; event settlement observer disconnected".into())
        );
    }

    #[test]
    fn unresolved_writer_cleanup_is_not_hidden_by_execution_failure() {
        assert_eq!(
            confirmed_capture_exit(
                Err("capture deadline exceeded".into()),
                Ok(()),
                Err("input writer retained for reconciliation".into()),
            ),
            Err("input writer retained for reconciliation".into())
        );
    }

    #[test]
    fn capture_settlement_distinguishes_delivery_failure_from_unresolved_cleanup() {
        assert_eq!(
            confirmed_capture_exit(Err("deadline".into()), Ok(()), Ok(Err("canceled".into()))),
            Err("deadline".into())
        );
        assert_eq!(
            confirmed_capture_exit(Ok(0), Ok(()), Ok(Err("partial delivery".into()))),
            Err("partial delivery".into())
        );
        assert_eq!(
            confirmed_capture_exit(Ok(0), Ok(()), Err("writer panicked".into())),
            Err("writer panicked".into())
        );
        assert_eq!(
            confirmed_capture_exit(Ok(0), Err("job unresolved".into()), Ok(Ok(()))),
            Err("job unresolved".into())
        );
        assert_eq!(confirmed_capture_exit(Ok(2), Ok(()), Ok(Ok(()))), Ok(2));
    }

    #[test]
    fn undelivered_exit_requires_confirmed_cleanup_and_a_closed_input_pipe() {
        assert_eq!(
            confirmed_undelivered_exit(Ok(()), Ok(Err(INPUT_PIPE_CLOSED.into()))),
            Ok(())
        );
        for (cleanup, writer) in [
            (
                Err("job unresolved".to_string()),
                Ok(Err(INPUT_PIPE_CLOSED.to_string())),
            ),
            (Ok(()), Err("writer retained".to_string())),
            (Ok(()), Ok(Ok(()))),
            (
                Ok(()),
                Ok(Err("Access is denied. (os error 5)".to_string())),
            ),
            (Ok(()), Ok(Err("input delivery canceled".to_string()))),
        ] {
            assert!(confirmed_undelivered_exit(cleanup, writer).is_err());
        }
        assert_eq!(
            confirmed_undelivered_exit(Ok(()), Ok(Ok(()))),
            Err(INPUT_NOT_CONFIRMED.into())
        );
    }

    fn undelivered_run(mode: &str) -> Result<Outcome, String> {
        let command = fixture_command(mode);
        let image = VerifiedImage::observe(&command.executable).unwrap();
        // Larger than the anonymous pipe buffer, so delivery needs a reader.
        execute_with_observer_outcome(
            &command,
            &image.identity().sha256,
            InputDelivery::Closed(vec![b'x'; 256 * 1024]),
            MAX_BYTES,
            Duration::from_secs(20),
            MAX_BYTES,
            Observer::None,
        )
    }

    #[test]
    fn provider_exit_before_reading_input_is_an_observed_undelivered_exit() {
        match undelivered_run("exit-early") {
            Ok(Outcome::ExitedUndelivered {
                identity,
                exit_code,
            }) => {
                assert_eq!(exit_code, 3);
                assert_eq!(
                    identity.state,
                    crate::host_reply::UNDELIVERED_IDENTITY_STATE
                );
            }
            Ok(Outcome::Completed(_)) => panic!("an unread input must never count as delivered"),
            Err(error) => panic!("observed early exit was not classified: {error}"),
        }
        // Every caller without the undelivered settlement keeps today's failure.
        let command = fixture_command("exit-early");
        let image = VerifiedImage::observe(&command.executable).unwrap();
        assert_eq!(
            execute_with_observer(
                &command,
                &image.identity().sha256,
                InputDelivery::Closed(vec![b'x'; 256 * 1024]),
                MAX_BYTES,
                Duration::from_secs(20),
                MAX_BYTES,
                Observer::None,
            )
            .err()
            .as_deref(),
            Some(INPUT_NOT_CONFIRMED)
        );
    }

    #[test]
    fn closed_input_of_a_live_provider_stays_an_unconfirmed_delivery() {
        let started = Instant::now();
        match undelivered_run("close-input-and-hold") {
            Err(error) => assert_eq!(error, INPUT_NOT_CONFIRMED),
            Ok(Outcome::ExitedUndelivered { .. }) => {
                panic!("a live provider is never an observed exit")
            }
            Ok(Outcome::Completed(_)) => panic!("a closed input is never a delivery"),
        }
        assert!(started.elapsed() < Duration::from_secs(20));
    }

    fn write_fixture_pid() {
        if let Some(path) = std::env::var_os("PA_CAPTURE_READY_FILE") {
            std::fs::write(path, std::process::id().to_string()).unwrap();
        }
    }

    fn unique_temp(prefix: &str) -> PathBuf {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        std::env::temp_dir().join(format!("{prefix}-{:032x}", u128::from_le_bytes(random)))
    }

    /// The fixture recorded its PID; after the capture returned, that process
    /// must be gone (or at least signaled exited), never a live zombie.
    fn assert_fixture_retired(marker: &Path) {
        use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
        use windows_sys::Win32::System::Threading::{
            OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
            PROCESS_SYNCHRONIZE,
        };
        let pid: u32 = std::fs::read_to_string(marker)
            .expect("fixture must record its pid before the abort")
            .trim()
            .parse()
            .unwrap();
        std::fs::remove_file(marker).unwrap();
        // SAFETY: a plain query/synchronize open of a PID; the handle is
        // closed below and never used for anything but a zero-time wait.
        let handle = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                0,
                pid,
            )
        };
        if handle.is_null() {
            return; // Already fully reaped: no such process.
        }
        let state = unsafe { WaitForSingleObject(handle, 0) };
        unsafe { CloseHandle(handle) };
        assert_eq!(state, WAIT_OBJECT_0, "fixture {pid} still running");
    }

    fn observed_run(
        command: &Command,
        limit: usize,
    ) -> (Result<Capture, String>, Vec<OutputEvent>, Duration) {
        let image = VerifiedImage::observe(&command.executable).unwrap();
        let (tx, rx) = std::sync::mpsc::sync_channel(1024);
        let started = Instant::now();
        let captured = execute_observed(
            command,
            &image.identity().sha256,
            vec![],
            limit,
            Duration::from_secs(20),
            MAX_BYTES,
            Some(&tx),
        );
        let elapsed = started.elapsed();
        drop(tx);
        (captured, rx.into_iter().collect(), elapsed)
    }

    fn stdout_of(events: &[OutputEvent]) -> Vec<u8> {
        let mut stdout = Vec::new();
        for event in events {
            if let OutputEvent::Bytes {
                stream: OutputStream::Stdout,
                bytes,
                ..
            } = event
            {
                stdout.extend_from_slice(bytes);
            }
        }
        stdout
    }

    #[test]
    fn a_silent_live_provider_is_aborted_with_the_stall_reason_and_retired() {
        let marker = unique_temp("pa-capture-stall");
        let mut command = fixture_command("stall");
        command.environment.push((
            "PA_CAPTURE_READY_FILE".into(),
            marker.as_os_str().to_owned(),
        ));
        command.no_progress = Duration::from_secs(1);
        let (captured, events, elapsed) = observed_run(&command, MAX_BYTES);
        assert_eq!(
            captured.err().as_deref(),
            Some(crate::stream_guard::STALLED),
            "after {elapsed:?}"
        );
        // Aborted by the window, long before the 20 s deadline or the
        // fixture's own 30 s sleep.
        assert!(elapsed < Duration::from_secs(10), "{elapsed:?}");
        // Output handed out before the abort stays delivered to the observer.
        let stdout = stdout_of(&events);
        assert!(
            stdout
                .windows(b"PA_STALL_PARTIAL".len())
                .any(|bytes| bytes == b"PA_STALL_PARTIAL"),
            "{}",
            String::from_utf8_lossy(&stdout)
        );
        assert_fixture_retired(&marker);
    }

    #[test]
    fn steady_output_below_the_window_is_never_a_stall() {
        let mut command = fixture_command("trickle");
        // Shorter than the fixture's 3 s runtime, far longer than its gaps.
        command.no_progress = Duration::from_secs(2);
        let (captured, _, elapsed) = observed_run(&command, MAX_BYTES);
        let captured = captured.unwrap_or_else(|error| panic!("{error} after {elapsed:?}"));
        assert_eq!(captured.exit_code, 0);
        assert!(elapsed >= Duration::from_secs(2), "{elapsed:?}");
        assert!(String::from_utf8_lossy(&captured.stdout).contains("PA_TRICKLE_DONE"));
    }

    #[test]
    fn output_over_the_byte_limit_is_aborted_with_its_reason_and_retired() {
        let marker = unique_temp("pa-capture-flood");
        let mut command = fixture_command("flood");
        command.environment.push((
            "PA_CAPTURE_READY_FILE".into(),
            marker.as_os_str().to_owned(),
        ));
        let limit = 1000;
        let (captured, events, elapsed) = observed_run(&command, limit);
        assert_eq!(
            captured.err().as_deref(),
            Some(crate::stream_guard::BYTE_LIMIT),
            "after {elapsed:?}"
        );
        assert!(elapsed < Duration::from_secs(10), "{elapsed:?}");
        // The head admitted before the overrun stays delivered to the
        // observer, and nothing beyond the limit was ever handed out.
        let stdout = stdout_of(&events);
        assert!(stdout.len() <= limit, "{}", stdout.len());
        assert!(
            stdout
                .windows(b"PA_FLOOD_HEAD".len())
                .any(|bytes| bytes == b"PA_FLOOD_HEAD"),
            "{}",
            String::from_utf8_lossy(&stdout)
        );
        // The fixture writes its PID before its first output byte.
        assert_fixture_retired(&marker);
    }

    fn fixture_name() -> String {
        // libtest omits the crate prefix, but this module has a different
        // parent path in the application and standalone host binaries.
        format!(
            "{}::native_argument_fixture",
            module_path!().split_once("::").unwrap().1
        )
    }

    fn fixture_command(mode: &str) -> Command {
        let fixture = fixture_name();
        let mut command = Command::diagnostic(&std::env::current_exe().unwrap());
        command.args = [
            "--ignored",
            "--exact",
            fixture.as_str(),
            "--nocapture",
            "--",
        ]
        .into_iter()
        .map(OsString::from)
        .collect();
        command.environment = vec![("PA_CAPTURE_FIXTURE_MODE".into(), mode.into())];
        command
    }

    #[test]
    #[ignore = "isolated native child fixture; invoked by capture tests"]
    fn native_argument_fixture() {
        match std::env::var("PA_CAPTURE_FIXTURE_MODE").as_deref() {
            Ok("observe") => {
                let args: Vec<_> = std::env::args()
                    .skip_while(|arg| arg != "--")
                    .skip(1)
                    .collect();
                let value = serde_json::json!({
                    "args": args,
                    "cwd": std::env::current_dir().unwrap(),
                    "value": std::env::var("PA_CAPTURE_TEST_VALUE").ok(),
                    "path": std::env::var("PATH").ok(),
                });
                println!("PA_CAPTURE_FIXTURE:{value}");
                eprintln!("separate stderr: 雪");
            }
            Ok("descendant") => {
                let child = std::process::Command::new(std::env::current_exe().unwrap())
                    .args([
                        "--ignored",
                        "--exact",
                        fixture_name().as_str(),
                        "--nocapture",
                    ])
                    .env_clear()
                    .env("PA_CAPTURE_FIXTURE_MODE", "hold")
                    .spawn()
                    .unwrap();
                std::fs::write(
                    std::env::var_os("PA_CAPTURE_READY_FILE").unwrap(),
                    child.id().to_string(),
                )
                .unwrap();
                // Only this isolated child exits. Its descendant retains both
                // output handles, exercising capture drain and job cleanup.
                std::process::exit(0);
            }
            Ok("hold") => std::thread::sleep(Duration::from_secs(30)),
            // DF-15: a provider that exits without ever reading its input.
            Ok("exit-early") => std::process::exit(3),
            // A reader that closes its input end but stays alive: never an
            // observed exit, so it must remain an unconfirmed delivery.
            Ok("close-input-and-hold") => {
                use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
                // SAFETY: this isolated child owns its inherited stdin handle
                // and never uses stdin again after closing it here.
                drop(unsafe { OwnedHandle::from_raw_handle(std::io::stdin().as_raw_handle()) });
                std::thread::sleep(Duration::from_secs(30));
            }
            // W2-08a: some output, then a live but silent provider.
            Ok("stall") => {
                write_fixture_pid();
                println!("PA_STALL_PARTIAL");
                std::io::stdout().flush().unwrap();
                std::thread::sleep(Duration::from_secs(30));
            }
            // W2-08a: steady output, never silent for long, then a clean exit.
            Ok("trickle") => {
                for _ in 0..30 {
                    print!(".");
                    std::io::stdout().flush().unwrap();
                    std::thread::sleep(Duration::from_millis(100));
                }
                println!("PA_TRICKLE_DONE");
            }
            // W2-08a: far more output than the capture's byte limit, then held.
            Ok("flood") => {
                write_fixture_pid();
                // An admitted head below the limit, then the overrun.
                println!("PA_FLOOD_HEAD");
                std::io::stdout().flush().unwrap();
                std::thread::sleep(Duration::from_millis(300));
                let line = "x".repeat(1023);
                for _ in 0..256 {
                    println!("{line}");
                }
                std::io::stdout().flush().unwrap();
                std::thread::sleep(Duration::from_secs(30));
            }
            Ok("stream") => {
                println!("PA_STREAM_READY");
                std::io::stdout().flush().unwrap();
                let ack = std::env::var_os("PA_CAPTURE_ACK_FILE").unwrap();
                let deadline = Instant::now() + Duration::from_secs(3);
                while !Path::new(&ack).exists() && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(2));
                }
                assert!(
                    Path::new(&ack).is_file(),
                    "parent must observe output before exit"
                );
                eprintln!("PA_STREAM_STDERR:雪");
            }
            _ => panic!("fixture must only run with explicit isolated mode"),
        }
    }

    #[test]
    fn native_launch_preserves_arguments_cwd_and_explicit_environment() {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let dir = std::env::temp_dir().join(format!(
            "pa-capture-args-{:032x}",
            u128::from_le_bytes(random)
        ));
        std::fs::create_dir(&dir).unwrap();
        let mut command = fixture_command("observe");
        command.cwd = dir.clone();
        let args = [
            "",
            "with space",
            "tab\tvalue",
            "line\nvalue",
            "雪",
            "a\"b",
            "tail\\",
            "slashes\\\\\"quote",
            "&|<>^()%!",
            "--literal",
        ];
        command.args.extend(args.iter().map(OsString::from));
        command.environment.push((
            "PA_CAPTURE_TEST_VALUE".into(),
            "value=雪\nsecond line".into(),
        ));
        let held = VerifiedImage::observe(&command.executable).unwrap();
        let captured = execute_command(
            &command,
            &held.identity().sha256,
            Vec::new(),
            MAX_BYTES,
            Duration::from_secs(10),
        )
        .unwrap();
        assert_eq!(captured.exit_code, 0);
        let out = String::from_utf8(captured.stdout).unwrap();
        let line = out
            .lines()
            .find_map(|line| line.strip_prefix("PA_CAPTURE_FIXTURE:"))
            .expect("native fixture output");
        let value: serde_json::Value = serde_json::from_str(line).unwrap();
        assert_eq!(value["args"], serde_json::json!(args));
        assert_eq!(
            PathBuf::from(value["cwd"].as_str().unwrap())
                .canonicalize()
                .unwrap(),
            dir.canonicalize().unwrap()
        );
        assert_eq!(value["value"], "value=雪\nsecond line");
        assert!(value["path"].is_null(), "host PATH must not inherit");
        assert_eq!(
            String::from_utf8(captured.stderr).unwrap().trim(),
            "separate stderr: 雪"
        );
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn output_events_arrive_before_provider_exit_and_preserve_stream_boundaries() {
        let mut nonce = [0u8; 16];
        getrandom::fill(&mut nonce).unwrap();
        let ack =
            std::env::temp_dir().join(format!("pa-stream-ack-{:032x}", u128::from_le_bytes(nonce)));
        let mut command = fixture_command("stream");
        command
            .environment
            .push(("PA_CAPTURE_ACK_FILE".into(), ack.as_os_str().to_owned()));
        let image = VerifiedImage::observe(&command.executable).unwrap();
        let (tx, rx) = std::sync::mpsc::sync_channel(8);
        let (captured, events) = std::thread::scope(|scope| {
            let ack = &ack;
            let observer = scope.spawn(move || {
                let mut observed = Vec::new();
                let mut stdout = Vec::new();
                let mut acknowledged = false;
                while let Ok(event) = rx.recv_timeout(Duration::from_secs(5)) {
                    if let OutputEvent::Bytes {
                        stream: OutputStream::Stdout,
                        bytes,
                        ..
                    } = &event
                    {
                        stdout.extend_from_slice(bytes);
                        if !acknowledged
                            && stdout
                                .windows(b"PA_STREAM_READY\n".len())
                                .any(|bytes| bytes == b"PA_STREAM_READY\n")
                        {
                            std::fs::write(ack, b"observed").unwrap();
                            acknowledged = true;
                        }
                    }
                    observed.push(event);
                }
                observed
            });
            let captured = execute_observed(
                &command,
                &image.identity().sha256,
                vec![],
                MAX_BYTES,
                Duration::from_secs(10),
                MAX_BYTES,
                Some(&tx),
            );
            drop(tx);
            (captured, observer.join().unwrap())
        });
        if ack.exists() {
            std::fs::remove_file(&ack).unwrap();
        }
        let captured = captured.unwrap();
        assert_eq!(
            captured.exit_code, 0,
            "fixture must receive acknowledgement before exiting"
        );
        for (stream, expected) in [
            (OutputStream::Stdout, captured.stdout),
            (OutputStream::Stderr, captured.stderr),
        ] {
            let mut received = Vec::new();
            let mut closed = false;
            for event in &events {
                match event {
                    OutputEvent::Bytes {
                        stream: actual,
                        offset,
                        bytes,
                    } if *actual == stream => {
                        assert!(!closed);
                        assert_eq!(*offset, received.len());
                        received.extend_from_slice(bytes);
                    }
                    OutputEvent::Eof {
                        stream: actual,
                        offset,
                    } if *actual == stream => {
                        assert!(!closed);
                        assert_eq!(*offset, received.len());
                        closed = true;
                    }
                    _ => {}
                }
            }
            assert!(closed);
            assert_eq!(received, expected);
        }
    }

    #[test]
    fn unavailable_output_observer_retires_native_capture_instead_of_hanging() {
        let command = fixture_command("hold");
        let image = VerifiedImage::observe(&command.executable).unwrap();
        for disconnected in [false, true] {
            let (tx, rx) = std::sync::mpsc::sync_channel(0);
            let _receiver = if disconnected {
                drop(rx);
                None
            } else {
                Some(rx)
            };
            let error = execute_observed(
                &command,
                &image.identity().sha256,
                vec![],
                MAX_BYTES,
                Duration::from_secs(10),
                MAX_BYTES,
                Some(&tx),
            )
            .unwrap_err();
            assert_eq!(
                error,
                if disconnected {
                    "capture event observer disconnected"
                } else {
                    "capture event capacity exceeded"
                }
            );
            // This error can return only after the job and writer are retired.
        }
    }

    #[test]
    fn descendant_held_pipes_hit_deadline_and_job_is_retired() {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let marker = std::env::temp_dir().join(format!(
            "pa-capture-descendant-{:032x}",
            u128::from_le_bytes(random)
        ));
        let mut command = fixture_command("descendant");
        command.environment.push((
            "PA_CAPTURE_READY_FILE".into(),
            marker.as_os_str().to_owned(),
        ));
        let held = VerifiedImage::observe(&command.executable).unwrap();
        let started = Instant::now();
        let error = execute_command(
            &command,
            &held.identity().sha256,
            Vec::new(),
            MAX_BYTES,
            Duration::from_secs(2),
        )
        .unwrap_err();
        assert!(
            marker.is_file(),
            "fixture must actually create a descendant (elapsed: {:?}, capture error: {error})",
            started.elapsed()
        );
        assert!(error.contains("capture deadline exceeded"), "{error}");
        // execute_command returns this execution error only after terminate()
        // confirms the primary exit and zero active processes in the job.
        std::fs::remove_file(marker).unwrap();
    }

    #[test]
    fn native_pipes_deliver_large_input_and_reject_overflow() {
        self_test().unwrap();
        let path = system_sort().unwrap();
        let held = VerifiedImage::observe(&path).unwrap();
        let hash = held.identity().sha256.clone();
        let input = b"b\r\na\r\n".repeat(10000);
        let result = execute(&path, &hash, input, MAX_BYTES, Duration::from_secs(10)).unwrap();
        assert_eq!(
            result.stdout,
            [b"a\r\n".repeat(10000), b"b\r\n".repeat(10000)].concat()
        );
        assert_eq!(result.exit_code, 0);
        assert!(result.stderr.is_empty());
        assert!(execute(
            &path,
            &hash,
            b"z\r\na\r\n".to_vec(),
            1,
            Duration::from_secs(10)
        )
        .unwrap_err()
        .contains("byte limit"));
        assert!(
            execute(&path, &hash, vec![], MAX_BYTES, Duration::from_nanos(1))
                .unwrap_err()
                .contains("deadline")
        );
    }

    #[test]
    fn blocked_input_writer_is_canceled_and_joined() {
        let (_held_reader, stdin) = pipe(false).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let delivered = Arc::new(AtomicBool::new(false));
        let thread_delivered = Arc::clone(&delivered);
        let writer = std::thread::spawn(move || {
            write_delivery(
                stdin,
                InputDelivery::Closed(vec![b'x'; MAX_BYTES]),
                thread_stop,
                thread_delivered,
            )
        });
        std::thread::sleep(Duration::from_millis(50));
        assert!(!writer.is_finished(), "fixture must block without a reader");
        assert!(finish_writer(writer, &stop)
            .expect("writer must be joined")
            .is_err());
        assert!(
            !delivered.load(Ordering::Acquire),
            "partial input cannot be acknowledged"
        );
        assert!(UNRESOLVED_WRITERS
            .get()
            .is_none_or(|writers| writers.lock().unwrap().is_empty()));
    }

    #[test]
    fn input_delivery_observation_follows_complete_write_and_real_eof() {
        let (reader, stdin) = pipe(false).unwrap();
        let delivered = Arc::new(AtomicBool::new(false));
        write_delivery(
            stdin,
            InputDelivery::Closed(b"ack".to_vec()),
            Arc::new(AtomicBool::new(false)),
            Arc::clone(&delivered),
        )
        .unwrap();
        assert!(delivered.load(Ordering::Acquire));
        let mut bytes = Vec::new();
        File::from(reader).read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes, b"ack");
    }
}
