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
    /// `true` when some entries were unreadable: `disk_app_bytes` is a lower bound.
    pub disk_app_partial: bool,
    pub disk_free_bytes: Option<u64>,
    pub tokens_in: i64,
    pub tokens_out: i64,
}

/// Build one snapshot for `app_data` and the ledger totals the caller read.
pub fn snapshot(app_data: &Path, tokens_in: i64, tokens_out: i64, now: i64) -> ResourceSnapshot {
    let disk_app = dir_size(app_data);
    ResourceSnapshot {
        observed_at: now,
        cpu_permille: cpu_since_start_permille(),
        ram_process_bytes: process_ram_bytes(),
        ram_total_bytes: system_ram_bytes(),
        disk_app_bytes: disk_app.map(|d| d.bytes),
        disk_app_partial: disk_app.is_some_and(|d| d.partial),
        disk_free_bytes: disk_free_bytes(app_data),
        tokens_in,
        tokens_out,
    }
}

/// Bytes found under a directory, and whether every entry could be read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DirSize {
    bytes: u64,
    /// `true` when an entry was skipped, so `bytes` is a lower bound.
    partial: bool,
}

type DirEntries = std::io::Result<Vec<std::io::Result<std::path::PathBuf>>>;

fn list_dir(path: &Path) -> DirEntries {
    Ok(std::fs::read_dir(path)?
        .map(|entry| entry.map(|e| e.path()))
        .collect())
}

fn dir_size(root: &Path) -> Option<DirSize> {
    dir_size_with(root, &list_dir)
}

/// Sum file sizes below `root`; `list` reads one directory (injectable).
fn dir_size_with(root: &Path, list: &dyn Fn(&Path) -> DirEntries) -> Option<DirSize> {
    fn walk(
        path: &Path,
        list: &dyn Fn(&Path) -> DirEntries,
        partial: &mut bool,
        is_root: bool,
    ) -> Option<u64> {
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
        // The root must be listable; below it an unreadable entry is skipped
        // and marked, so readable siblings still count (a lower bound).
        let entries = match list(path) {
            Ok(entries) => entries,
            Err(_) if is_root => return None,
            Err(_) => {
                *partial = true;
                return Some(0);
            }
        };
        for entry in entries {
            match entry {
                Ok(child) => match walk(&child, list, partial, false) {
                    Some(bytes) => total = total.saturating_add(bytes),
                    None => *partial = true,
                },
                Err(_) => *partial = true,
            }
        }
        Some(total)
    }
    let mut partial = false;
    let bytes = walk(root, list, &mut partial, true)?;
    Some(DirSize { bytes, partial })
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

#[cfg(unix)]
fn page_size() -> u64 {
    // SAFETY: sysconf has no preconditions.
    let size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    u64::try_from(size).ok().filter(|&p| p > 0).unwrap_or(4096)
}

#[cfg(not(any(unix, windows)))]
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

    fn bytes_of(size: Option<DirSize>) -> Option<u64> {
        size.map(|d| d.bytes)
    }

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
        assert!(!snap.disk_app_partial);
    }

    #[test]
    fn dir_size_sums_nested_files() {
        let dir = TempDir::new("resource-nested");
        std::fs::create_dir_all(dir.path().join("a/b")).unwrap();
        std::fs::write(dir.path().join("top.bin"), vec![0u8; 10]).unwrap();
        std::fs::write(dir.path().join("a/mid.bin"), vec![0u8; 20]).unwrap();
        std::fs::write(dir.path().join("a/b/deep.bin"), vec![0u8; 30]).unwrap();
        assert_eq!(bytes_of(dir_size(dir.path())), Some(60));
    }

    #[test]
    fn dir_size_of_empty_dir_is_zero_and_of_missing_path_is_none() {
        let dir = TempDir::new("resource-empty");
        assert_eq!(bytes_of(dir_size(dir.path())), Some(0));
        // Missing data is honest: None, not a fake zero.
        assert_eq!(bytes_of(dir_size(&dir.path().join("does-not-exist"))), None);
    }

    #[cfg(unix)]
    #[test]
    fn dir_size_does_not_follow_symlinks() {
        let outside = TempDir::new("resource-outside");
        std::fs::write(outside.path().join("big.bin"), vec![0u8; 4096]).unwrap();
        let dir = TempDir::new("resource-link");
        std::fs::write(dir.path().join("own.bin"), vec![0u8; 5]).unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("dir-link")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("big.bin"), dir.path().join("file-link"))
            .unwrap();
        assert_eq!(bytes_of(dir_size(dir.path())), Some(5));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_probes_report_plausible_memory_figures() {
        let total = system_ram_bytes().expect("MemTotal");
        let process = process_ram_bytes().expect("statm");
        assert!(total > 0);
        assert!(process > 0 && process < total, "{process} vs {total}");
    }

    #[test]
    fn snapshot_of_missing_app_data_keeps_tokens_and_reports_no_size() {
        let dir = TempDir::new("resource-missing");
        let snap = snapshot(&dir.path().join("gone"), -1, 7, 42);
        assert_eq!(snap.disk_app_bytes, None);
        assert!(!snap.disk_app_partial);
        assert_eq!(
            (snap.tokens_in, snap.tokens_out, snap.observed_at),
            (-1, 7, 42)
        );
    }

    #[test]
    fn dir_size_keeps_readable_siblings_when_one_entry_fails() {
        let dir = TempDir::new("resource-partial");
        std::fs::create_dir_all(dir.path().join("locked")).unwrap();
        std::fs::write(dir.path().join("a.bin"), vec![0u8; 10]).unwrap();
        std::fs::write(dir.path().join("b.bin"), vec![0u8; 20]).unwrap();
        std::fs::write(dir.path().join("locked/hidden.bin"), vec![0u8; 99]).unwrap();
        let locked = dir.path().join("locked");
        let flaky = |path: &Path| -> DirEntries {
            if path == locked {
                return Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
            }
            let mut entries = list_dir(path)?;
            if path == dir.path() {
                entries.insert(0, Err(std::io::Error::from(std::io::ErrorKind::Other)));
            }
            Ok(entries)
        };
        let size = dir_size_with(dir.path(), &flaky).expect("root is readable");
        assert_eq!(
            size,
            DirSize {
                bytes: 30,
                partial: true
            }
        );
        // A fully readable tree is reported complete.
        let clean = dir_size_with(dir.path(), &list_dir).unwrap();
        assert_eq!(
            clean,
            DirSize {
                bytes: 129,
                partial: false
            }
        );
    }

    #[cfg(unix)]
    #[test]
    fn page_size_matches_sysconf() {
        // SAFETY: sysconf has no preconditions.
        let expected = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
        assert!(expected > 0, "{expected}");
        assert_eq!(page_size(), expected as u64);
    }
}
