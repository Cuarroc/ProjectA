//! New-claim admission only. Existing work is never killed or reclaimed.
use serde::Serialize;

const MIB: u64 = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Capacity {
    pub limit: u8,
    pub reason: &'static str,
    state: &'static str,
    observed_at: i64,
    source: &'static str,
    total_bytes: Option<u64>,
    available_bytes: Option<u64>,
}

pub(super) fn assess(memory: Option<(u64, u64)>, source: &'static str) -> Capacity {
    let memory = memory.filter(|(total, available)| *total > 0 && available <= total);
    let (limit, reason) = match memory {
        None => (1, "memory_unavailable"),
        Some((total, available))
            if available < 512 * MIB || u128::from(available) * 100 < u128::from(total) * 5 =>
        {
            (0, "critical_memory_pressure")
        }
        Some((total, available))
            if available < 2048 * MIB || u128::from(available) * 100 < u128::from(total) * 15 =>
        {
            (1, "memory_pressure")
        }
        Some(_) => (crate::development_policy::DEFAULT_MAX_WORKERS, "normal"),
    };
    Capacity {
        limit,
        reason,
        state: if memory.is_some() {
            "measured"
        } else {
            "unavailable"
        },
        observed_at: super::now_unix_secs(),
        source,
        total_bytes: memory.map(|m| m.0),
        available_bytes: memory.map(|m| m.1),
    }
}

// Store unit tests use an explicit healthy sensor fixture, so parallel builds
// cannot make claim tests depend on the machine's changing free memory.
#[cfg(test)]
pub(super) fn sample() -> Capacity {
    assess(Some((16 * 1024 * MIB, 8 * 1024 * MIB)), "test-fixture")
}

#[cfg(not(test))]
pub(super) fn sample() -> Capacity {
    assess(read_memory(), native_source())
}

fn native_source() -> &'static str {
    if cfg!(windows) {
        "windows:GlobalMemoryStatusEx"
    } else if cfg!(target_os = "linux") {
        "linux:/proc/meminfo"
    } else {
        "unsupported-platform"
    }
}

#[cfg(windows)]
fn read_memory() -> Option<(u64, u64)> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    // MEMORYSTATUSEX contains only integer fields; zero is valid for each.
    let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
        return None;
    }
    Some((status.ullTotalPhys, status.ullAvailPhys))
}

#[cfg(target_os = "linux")]
fn read_memory() -> Option<(u64, u64)> {
    use std::io::Read;
    let mut body = String::new();
    std::fs::File::open("/proc/meminfo")
        .ok()?
        .take(16384)
        .read_to_string(&mut body)
        .ok()?;
    parse_meminfo(&body)
}

#[cfg(any(target_os = "linux", test))]
fn parse_meminfo(body: &str) -> Option<(u64, u64)> {
    fn field(body: &str, key: &str) -> Option<u64> {
        let mut rows = body.lines().filter_map(|line| line.strip_prefix(key));
        let mut words = rows.next()?.split_whitespace();
        let value: u64 = words.next()?.parse().ok()?;
        if words.next()? != "kB" || words.next().is_some() || rows.next().is_some() {
            return None;
        }
        value.checked_mul(1024)
    }
    Some((field(body, "MemTotal:")?, field(body, "MemAvailable:")?))
}

#[cfg(not(any(windows, target_os = "linux")))]
fn read_memory() -> Option<(u64, u64)> {
    None
}

#[cfg(test)]
#[path = "continuous_pressure_tests.rs"]
mod tests;
