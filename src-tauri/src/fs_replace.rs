//! The shared atomic-replace primitive: `fsutil::write_atomic` and the
//! database restore both move a finished temp file over its target here.
//! Std plus `windows-sys` only, so `pa` can `#[path]` it without the app.

#[cfg(not(windows))]
use std::fs;
use std::path::Path;

/// Windows needs `MoveFileExW` with REPLACE_EXISTING called directly (std's
/// `rename` guarantee there is toolchain-dependent). Freshly written files are
/// briefly scanned by indexers/AV, which makes the move fail transiently with
/// access/sharing errors; retry within a small bounded budget, return any
/// other error at once.
#[cfg(windows)]
pub(crate) fn replace_file(tmp: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let wide = |path: &Path| -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    };
    let from = wide(tmp);
    let to = wide(target);
    const RETRYABLE: [i32; 2] = [5, 32]; // ERROR_ACCESS_DENIED, ERROR_SHARING_VIOLATION
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(500);
    loop {
        let ok = unsafe {
            MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if ok != 0 {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        if !error.raw_os_error().is_some_and(|c| RETRYABLE.contains(&c))
            || std::time::Instant::now() >= deadline
        {
            return Err(error);
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
}

/// The unix counterpart: `rename(2)` replaces atomically by definition.
#[cfg(not(windows))]
pub(crate) fn replace_file(tmp: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(tmp, target)
}
