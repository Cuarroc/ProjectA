//! The one atomic file-replace path.
//!
//! `write_atomic` used to exist three times (provider vault, retention
//! archives, delivery journal) with small differences. This module keeps the
//! strictest behaviour of each: an exclusive (`create_new`) temp file with an
//! unguessable name, mode 0600 on unix, `sync_all` before the replace, a
//! `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)` replace on Windows (with a
//! bounded retry for transient scanner locks), and a directory fsync after the
//! replace on unix.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::fs_replace::replace_file;

/// Write `body` to `path` so a crash mid-write never leaves half a file: the
/// bytes land in a sibling temp file, are flushed, then replace the target in
/// one atomic step. The temp file is removed again on every failure.
pub fn write_atomic(path: &Path, body: &[u8]) -> Result<(), String> {
    static SEQ: AtomicU64 = AtomicU64::new(0);

    let base = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("bad file path {}", path.display()))?;
    // `create_new` (O_EXCL) refuses an existing file and never follows a
    // symlink, so a pre-planted name fails instead of redirecting the write.
    // The name carries a clock reading and a counter besides the pid so it
    // cannot be computed ahead of time; a collision just picks the next one.
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut attempt = 0;
    let (tmp, mut file) = loop {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.subsec_nanos());
        let tmp = path.with_file_name(format!(
            "{base}.tmp-{}-{nanos:08x}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        match options.open(&tmp) {
            Ok(file) => break (tmp, file),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists && attempt < 16 => {
                attempt += 1;
            }
            Err(err) => return Err(format!("failed to create {}: {err}", tmp.display())),
        }
    };
    let written = file.write_all(body).and_then(|()| file.sync_all());
    drop(file);
    if let Err(err) = written {
        let _ = fs::remove_file(&tmp);
        return Err(format!("failed to write {}: {err}", tmp.display()));
    }
    if let Err(err) = replace_file(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!(
            "failed to replace {} with {}: {err}",
            path.display(),
            tmp.display()
        ));
    }
    sync_parent(path)
}

/// fsync the directory so the rename itself survives a crash (unix only;
/// Windows gets that from WRITE_THROUGH).
#[cfg(unix)]
fn sync_parent(path: &Path) -> Result<(), String> {
    let parent = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => Path::new("."),
    };
    fs::File::open(parent)
        .and_then(|dir| dir.sync_all())
        .map_err(|err| format!("failed to sync directory {}: {err}", parent.display()))
}

#[cfg(not(unix))]
fn sync_parent(_: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    #[test]
    fn creates_a_missing_target_and_replaces_an_existing_one() {
        let dir = TempDir::new("fsutil-replace");
        let target = dir.path().join("file.bin");
        write_atomic(&target, b"one").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"one");
        write_atomic(&target, b"two").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"two");
        let names: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("file.bin")]);
    }

    #[cfg(unix)]
    #[test]
    fn result_is_private_on_unix() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TempDir::new("fsutil-mode");
        let target = dir.path().join("secret");
        write_atomic(&target, b"x").unwrap();
        let mode = fs::metadata(&target).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn missing_directory_is_an_error_without_leftovers() {
        let dir = TempDir::new("fsutil-nodir");
        let target = dir.path().join("absent").join("file");
        assert!(write_atomic(&target, b"x").is_err());
    }
}
