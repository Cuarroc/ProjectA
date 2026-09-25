//! Native suspended-image and pipe diagnostics. Every process enters a
//! kill-on-close job at creation; bounded pipe execution verifies before resume.
use super::windows_image::{native_id, VerifiedImage};
use serde::Serialize;
use std::ffi::OsString;
use std::mem::{size_of, size_of_val, zeroed};
use std::os::windows::ffi::OsStringExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Path, PathBuf};
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::{FILETIME, HANDLE, WAIT_OBJECT_0};
use windows_sys::Win32::System::JobObjects::*;
use windows_sys::Win32::System::Threading::*;

#[path = "windows_capture.rs"]
mod capture;
#[allow(dead_code)] // Used by the application parent, not the standalone host.
pub fn execute_owned_host(
    host_path: &Path,
    host_sha256: &str,
    prepared: crate::protocol::Prepared,
    checkpoints: std::sync::mpsc::SyncSender<crate::checkpoints::Request>,
    cancelled: &std::sync::atomic::AtomicBool,
) -> Result<NativeSettlement, String> {
    let launch_sha256 = prepared.launch().digest()?;
    let settlement =
        capture::execute_owned_host(host_path, host_sha256, prepared, checkpoints, cancelled)?;
    let observed_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "native capture clock unavailable")?
        .as_secs() as i64;
    Ok(match settlement {
        capture::HostSettlement::Completed(host, reply) => {
            NativeSettlement::Completed(ConfirmedCapture {
                launch_sha256,
                host,
                reply,
                observed_at,
            })
        }
        capture::HostSettlement::ExitedUndelivered(host, exit) => {
            NativeSettlement::ExitedUndelivered(ConfirmedUndeliveredExit {
                launch_sha256,
                host,
                exit,
                observed_at,
            })
        }
    })
}

/// Final native authority of one owned host run. Only `Completed` is a
/// delivery receipt; `ExitedUndelivered` must never be treated as delivered.
pub enum NativeSettlement {
    Completed(ConfirmedCapture),
    ExitedUndelivered(ConfirmedUndeliveredExit),
}

/// Constructed only after owned native execution, pipe EOF and cleanup succeed
/// and the host reported that the provider exited before input delivery.
/// Not deserializable: recovered JSON cannot manufacture this observation.
pub struct ConfirmedUndeliveredExit {
    launch_sha256: String,
    host: SuspendedObservation,
    exit: crate::host_reply::UndeliveredExit,
    observed_at: i64,
}
impl ConfirmedUndeliveredExit {
    pub fn launch_sha256(&self) -> &str {
        &self.launch_sha256
    }
    pub fn host(&self) -> &SuspendedObservation {
        &self.host
    }
    pub fn exit(&self) -> &crate::host_reply::UndeliveredExit {
        &self.exit
    }
    pub fn observed_at(&self) -> i64 {
        self.observed_at
    }
}

/// Constructed only after owned native execution, pipe EOF and cleanup succeed.
/// Not deserializable: a recovered JSON receipt cannot manufacture this proof.
pub struct ConfirmedCapture {
    launch_sha256: String,
    host: SuspendedObservation,
    reply: crate::host_reply::Reply,
    observed_at: i64,
}
impl ConfirmedCapture {
    pub fn launch_sha256(&self) -> &str {
        &self.launch_sha256
    }
    pub fn host(&self) -> &SuspendedObservation {
        &self.host
    }
    pub fn reply(&self) -> &crate::host_reply::Reply {
        &self.reply
    }
    pub fn observed_at(&self) -> i64 {
        self.observed_at
    }
    pub fn into_reply(self) -> crate::host_reply::Reply {
        self.reply
    }
}
pub fn self_test() -> Result<serde_json::Value, String> {
    capture::self_test()
}
pub fn self_test_host() -> Result<serde_json::Value, String> {
    capture::self_test_host()
}
pub fn execute_protocol(prepared: crate::protocol::Prepared) -> Result<serde_json::Value, String> {
    capture::execute_protocol(prepared)
}
pub fn execute_protocol_framed(prepared: crate::protocol::Prepared) -> Result<(), String> {
    capture::execute_protocol_framed(prepared)
}

pub fn execute_protocol_duplex() -> Result<(), String> {
    capture::execute_protocol_duplex()
}
#[path = "windows_command.rs"]
mod command;
use command::Command;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuspendedObservation {
    schema_version: u32,
    process_id: u32,
    #[serde(serialize_with = "native_id")]
    created_filetime: u64,
    volume_serial: u32,
    #[serde(serialize_with = "native_id")]
    file_index: u64,
    image_size: u64,
    image_sha256: String,
    state: &'static str,
}

fn os_error(context: &str) -> String {
    format!("{context}: {}", std::io::Error::last_os_error())
}

struct Attributes(Vec<usize>);
impl Attributes {
    fn pointer(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.0.as_mut_ptr().cast()
    }
}
impl Drop for Attributes {
    fn drop(&mut self) {
        // SAFETY: constructed only after successful initialization.
        unsafe { DeleteProcThreadAttributeList(self.pointer()) }
    }
}

struct SuspendedProcess {
    process: OwnedHandle,
    _thread: OwnedHandle,
    _job: OwnedHandle,
    id: u32,
}

impl SuspendedProcess {
    fn create(command: &Command, pipes: Option<&capture::ChildPipes>) -> Result<Self, String> {
        let mut encoded = command.encode()?;
        // SAFETY: API output structures and attribute storage stay alive for
        // their calls. Every successful returned handle is immediately owned.
        unsafe {
            let raw_job = CreateJobObjectW(null(), null());
            if raw_job.is_null() {
                return Err(os_error("create containment job"));
            }
            let job = OwnedHandle::from_raw_handle(raw_job);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) == 0
            {
                return Err(os_error("configure containment job"));
            }
            let mut bytes = 0;
            let attribute_count = if pipes.is_some() { 2 } else { 1 };
            InitializeProcThreadAttributeList(null_mut(), attribute_count, 0, &mut bytes);
            if bytes == 0 || bytes > 65536 {
                return Err("invalid native attribute size".into());
            }
            let mut storage = vec![0usize; bytes.div_ceil(size_of::<usize>())];
            if InitializeProcThreadAttributeList(
                storage.as_mut_ptr().cast(),
                attribute_count,
                0,
                &mut bytes,
            ) == 0
            {
                return Err(os_error("initialize process attributes"));
            }
            let mut attributes = Attributes(storage);
            let job_handle = job.as_raw_handle();
            if UpdateProcThreadAttribute(
                attributes.pointer(),
                0,
                PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
                (&job_handle as *const HANDLE).cast(),
                size_of_val(&job_handle),
                null_mut(),
                null(),
            ) == 0
            {
                return Err(os_error("bind pre-creation containment"));
            }
            let mut startup: STARTUPINFOEXW = zeroed();
            startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
            startup.lpAttributeList = attributes.pointer();
            let inherited = pipes.map(capture::ChildPipes::handles);
            if let Some(handles) = &inherited {
                if UpdateProcThreadAttribute(
                    attributes.pointer(),
                    0,
                    PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                    handles.as_ptr().cast(),
                    size_of_val(handles),
                    null_mut(),
                    null(),
                ) == 0
                {
                    return Err(os_error("restrict inherited pipe handles"));
                }
                startup.StartupInfo.dwFlags |= STARTF_USESTDHANDLES;
                startup.StartupInfo.hStdInput = handles[0];
                startup.StartupInfo.hStdOutput = handles[1];
                startup.StartupInfo.hStdError = handles[2];
            }
            let mut info: PROCESS_INFORMATION = zeroed();
            // Explicit application path, arguments, cwd and environment. Only the optional
            // three pipe ends inherit; the job is attached during creation.
            if CreateProcessW(
                encoded.executable.as_ptr(),
                encoded.command_line.as_mut_ptr(),
                null(),
                null(),
                i32::from(pipes.is_some()),
                CREATE_SUSPENDED
                    | CREATE_NO_WINDOW
                    | EXTENDED_STARTUPINFO_PRESENT
                    | CREATE_UNICODE_ENVIRONMENT,
                encoded.environment.as_ptr().cast(),
                encoded.cwd.as_ptr(),
                &startup.StartupInfo,
                &mut info,
            ) == 0
            {
                return Err(os_error("create suspended contained process"));
            }
            let process = Self {
                process: OwnedHandle::from_raw_handle(info.hProcess),
                _thread: OwnedHandle::from_raw_handle(info.hThread),
                _job: job,
                id: info.dwProcessId,
            };
            let mut in_job = 0;
            if IsProcessInJob(
                process.process.as_raw_handle(),
                process._job.as_raw_handle(),
                &mut in_job,
            ) == 0
                || in_job == 0
            {
                process.terminate()?;
                return Err("created process containment verification failed".into());
            }
            Ok(process)
        }
    }

    fn inspect(&self, held: &VerifiedImage) -> Result<SuspendedObservation, String> {
        let mut name = vec![0u16; 32768];
        let mut length = name.len() as u32;
        let mut creation: FILETIME = unsafe { zeroed() };
        let mut exit: FILETIME = unsafe { zeroed() };
        let mut kernel: FILETIME = unsafe { zeroed() };
        let mut user: FILETIME = unsafe { zeroed() };
        // SAFETY: live owned process handle, bounded writable buffers.
        unsafe {
            if QueryFullProcessImageNameW(
                self.process.as_raw_handle(),
                0,
                name.as_mut_ptr(),
                &mut length,
            ) == 0
            {
                return Err(os_error("observe suspended image path"));
            }
            if GetProcessTimes(
                self.process.as_raw_handle(),
                &mut creation,
                &mut exit,
                &mut kernel,
                &mut user,
            ) == 0
            {
                return Err(os_error("observe native process creation"));
            }
        }
        let actual_path = PathBuf::from(OsString::from_wide(&name[..length as usize]));
        let actual = VerifiedImage::open(&actual_path, &held.identity().sha256)?;
        if actual.identity().volume_serial != held.identity().volume_serial
            || actual.identity().file_index != held.identity().file_index
        {
            return Err("suspended image differs from held executable identity".into());
        }
        Ok(SuspendedObservation {
            schema_version: 1,
            process_id: self.id,
            created_filetime: ((creation.dwHighDateTime as u64) << 32)
                | creation.dwLowDateTime as u64,
            image_sha256: actual.identity().sha256.clone(),
            volume_serial: actual.identity().volume_serial,
            file_index: actual.identity().file_index,
            image_size: actual.identity().size,
            state: "suspended_image_verified_terminated_without_execution",
        })
    }

    fn terminate(&self) -> Result<(), String> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        // SAFETY: the owned job and process handles are valid. Terminating the
        // job is also safe if the child exited independently.
        unsafe {
            if TerminateJobObject(self._job.as_raw_handle(), 1) == 0 {
                return Err(os_error("terminate diagnostic containment"));
            }
            if WaitForSingleObject(self.process.as_raw_handle(), 5000) != WAIT_OBJECT_0 {
                return Err("diagnostic process termination was not confirmed".into());
            }
            loop {
                let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = zeroed();
                if QueryInformationJobObject(
                    self._job.as_raw_handle(),
                    JobObjectBasicAccountingInformation,
                    (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                    size_of_val(&accounting) as u32,
                    null_mut(),
                ) == 0
                {
                    return Err(os_error("observe terminated job membership"));
                }
                if accounting.ActiveProcesses == 0 {
                    break;
                }
                if std::time::Instant::now() >= deadline {
                    return Err("job termination requires reconciliation".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
        }
        Ok(())
    }
}

pub fn verify(path: &Path, expected: &str) -> Result<SuspendedObservation, String> {
    let held = VerifiedImage::open(path, expected)?;
    verify_held(path, &held)
}

fn verify_held(path: &Path, held: &VerifiedImage) -> Result<SuspendedObservation, String> {
    let child = SuspendedProcess::create(&Command::diagnostic(path), None)?;
    let observation = child.inspect(held);
    let cleanup = child.terminate();
    cleanup?;
    observation
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    #[test]
    fn native_suspended_image_is_bound_and_mismatches_are_terminated() {
        let root = PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32");
        let path = root.join("whoami.exe");
        let digest = format!("{:x}", Sha256::digest(std::fs::read(&path).unwrap()));
        let observation = verify(&path, &digest).unwrap();
        assert!(observation.process_id > 0);
        assert!(observation.created_filetime > 0);
        assert_eq!(observation.image_sha256, digest);
        let held = VerifiedImage::open(&path, &digest).unwrap();
        assert_eq!(observation.schema_version, 1);
        assert_eq!(observation.volume_serial, held.identity().volume_serial);
        assert_eq!(observation.file_index, held.identity().file_index);
        assert_eq!(observation.image_size, held.identity().size);
        let json = serde_json::to_value(&observation).unwrap();
        assert_eq!(
            json["createdFiletime"],
            observation.created_filetime.to_string()
        );
        assert_eq!(json["fileIndex"], observation.file_index.to_string());
        let file_json = serde_json::to_value(held.identity()).unwrap();
        assert_eq!(file_json["schemaVersion"], 2);
        assert_eq!(
            file_json["fileIndex"],
            held.identity().file_index.to_string()
        );
        assert!(verify_held(&root.join("hostname.exe"), &held).is_err());
        assert!(verify(&path, &"0".repeat(64)).is_err());
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let copy = std::env::temp_dir().join(format!(
            "pa-suspended-{:032x}.exe",
            u128::from_le_bytes(random)
        ));
        std::fs::copy(&path, &copy).unwrap();
        // Identical bytes at a different file identity are not the held image.
        let different_file = verify_held(&copy, &held).unwrap_err();
        assert!(different_file.contains("differs from held executable identity"));
        std::fs::remove_file(copy).unwrap();
    }
}
