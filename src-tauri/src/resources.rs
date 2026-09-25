//! F5 resource baseline: measure CPU, RAM, disk and tokens before limits.
//!
//! Absolute ceilings wait for this snapshot. Tokens come from the OmniRoute
//! ledger the caller already has; process and disk figures are best-effort
//! and stay `None` when the platform cannot say.

use std::path::Path;

use serde::Serialize;

/// One observation. Missing fields are honest, not zero.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSnapshot {
    pub observed_at: i64,
    /// Process CPU since start, thousandths of one machine (0–1000).
    pub cpu_permille: Option<u32>,
    pub ram_process_bytes: Option<u64>,
    pub ram_total_bytes: Option<u64>,
    pub disk_app_bytes: Option<u64>,
    pub disk_free_bytes: Option<u64>,
    pub tokens_in: i64,
    pub tokens_out: i64,
}

/// Build one snapshot for `app_data` and the ledger totals the caller read.
pub fn snapshot(app_data: &Path, tokens_in: i64, tokens_out: i64, now: i64) -> ResourceSnapshot {
    ResourceSnapshot {
        observed_at: now,
        cpu_permille: cpu_since_start_permille(),
        ram_process_bytes: process_ram_bytes(),
        ram_total_bytes: system_ram_bytes(),
        disk_app_bytes: dir_size(app_data),
        disk_free_bytes: disk_free_bytes(app_data),
        tokens_in,
        tokens_out,
    }
}

fn dir_size(root: &Path) -> Option<u64> {
    fn walk(path: &Path) -> Option<u64> {
        let meta = std::fs::symlink_metadata(path).ok()?;
        if meta.file_type().is_symlink() {
            return Some(0);
        }
        if meta.is_file() {
            return Some(meta.len());
        }
        if !meta.is_dir() {
            return Some(0);
        }
        let mut total = 0u64;
        for entry in std::fs::read_dir(path).ok()? {
            let entry = entry.ok()?;
            total = total.saturating_add(walk(&entry.path()).unwrap_or(0));
        }
        Some(total)
    }
    walk(root)
}

#[cfg(windows)]
fn cpu_since_start_permille() -> Option<u32> {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::SystemInformation::GetSystemTimeAsFileTime;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};

    unsafe {
        let mut created = FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        };
        let mut exited = created;
        let mut kernel = created;
        let mut user = created;
        if GetProcessTimes(
            GetCurrentProcess(),
            &mut created,
            &mut exited,
            &mut kernel,
            &mut user,
        ) == 0
        {
            return None;
        }
        let mut now = created;
        GetSystemTimeAsFileTime(&mut now);
        let as_u64 =
            |ft: FILETIME| ((u64::from(ft.dwHighDateTime)) << 32) | u64::from(ft.dwLowDateTime);
        let used = as_u64(kernel).saturating_add(as_u64(user));
        let wall = as_u64(now).saturating_sub(as_u64(created));
        if wall == 0 {
            return None;
        }
        let cpus = std::thread::available_parallelism().ok()?.get() as u64;
        let permille = used.saturating_mul(1000) / wall.saturating_mul(cpus.max(1));
        Some(u32::try_from(permille.min(1000)).unwrap_or(1000))
    }
}

#[cfg(not(windows))]
fn cpu_since_start_permille() -> Option<u32> {
    None
}

#[cfg(windows)]
fn process_ram_bytes() -> Option<u64> {
    use windows_sys::Win32::System::ProcessStatus::{
        GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    unsafe {
        let mut counters = PROCESS_MEMORY_COUNTERS {
            cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
            PageFaultCount: 0,
            PeakWorkingSetSize: 0,
            WorkingSetSize: 0,
            QuotaPeakPagedPoolUsage: 0,
            QuotaPagedPoolUsage: 0,
            QuotaPeakNonPagedPoolUsage: 0,
            QuotaNonPagedPoolUsage: 0,
            PagefileUsage: 0,
            PeakPagefileUsage: 0,
        };
        if GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, counters.cb) == 0 {
            return None;
        }
        Some(counters.WorkingSetSize as u64)
    }
}

#[cfg(not(windows))]
fn process_ram_bytes() -> Option<u64> {
    let body = std::fs::read_to_string("/proc/self/statm").ok()?;
    let pages: u64 = body.split_whitespace().nth(1)?.parse().ok()?;
    Some(pages.saturating_mul(page_size()))
}

#[cfg(not(windows))]
fn page_size() -> u64 {
    4096
}

#[cfg(windows)]
fn system_ram_bytes() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

    unsafe {
        let mut status = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            dwMemoryLoad: 0,
            ullTotalPhys: 0,
            ullAvailPhys: 0,
            ullTotalPageFile: 0,
            ullAvailPageFile: 0,
            ullTotalVirtual: 0,
            ullAvailVirtual: 0,
            ullAvailExtendedVirtual: 0,
        };
        if GlobalMemoryStatusEx(&mut status) == 0 {
            return None;
        }
        Some(status.ullTotalPhys)
    }
}

#[cfg(not(windows))]
fn system_ram_bytes() -> Option<u64> {
    let body = std::fs::read_to_string("/proc/meminfo").ok()?;
    for line in body.lines() {
        if let Some(rest) = line.strip_prefix("MemTotal:") {
            let kb: u64 = rest.split_whitespace().next()?.parse().ok()?;
            return Some(kb.saturating_mul(1024));
        }
    }
    None
}

#[cfg(windows)]
fn disk_free_bytes(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut free = 0u64;
    unsafe {
        if GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        ) == 0
        {
            return None;
        }
    }
    Some(free)
}

#[cfg(not(windows))]
fn disk_free_bytes(_path: &Path) -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    #[test]
    fn snapshot_counts_app_data_bytes_and_keeps_token_totals() {
        let dir = TempDir::new("resource-snap");
        std::fs::write(dir.path().join("a.bin"), vec![0u8; 32]).unwrap();
        let snap = snapshot(dir.path(), 11, 22, 1_700_000_000);
        assert_eq!(snap.observed_at, 1_700_000_000);
        assert_eq!(snap.tokens_in, 11);
        assert_eq!(snap.tokens_out, 22);
        assert!(
            snap.disk_app_bytes.unwrap_or(0) >= 32,
            "{:?}",
            snap.disk_app_bytes
        );
    }
}
