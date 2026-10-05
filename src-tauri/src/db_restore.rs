//! Filesystem restore of `<db>.pre-migration-<ts>.bak` snapshots.
//!
//! These files are copies of the live database *before* numbered migration
//! steps. Opening one with [`crate::store::Store::open`] migrates it in place
//! and writes more backups — that is not restore. Restore copies bytes onto
//! the destination and never opens SQLite.
//!
//! This module avoids sqlx so `pa` can `#[path]` it; its only sibling is the
//! leaf `fs_replace` (std plus `windows-sys`).
#![allow(dead_code)] // pa calls these; the app binary only tests them

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::fs_replace::replace_file;

/// Newest last. The timestamp sorts lexicographically with the current width.
#[allow(dead_code)] // pa uses this via #[path]; the app binary only tests it
pub fn list_pre_migration_backups(db_path: &Path) -> Result<Vec<PathBuf>, String> {
    let name = db_path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| format!("{} has no file name", db_path.display()))?;
    let Some(dir) = db_path.parent() else {
        return Ok(Vec::new());
    };
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let prefix = format!("{name}.pre-migration-");
    let mut backups: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(|e| format!("failed to list {}: {e}", dir.display()))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|p| {
            p.file_name().is_some_and(|n| {
                let n = n.to_string_lossy();
                n.starts_with(&prefix) && n.ends_with(".bak")
            })
        })
        .collect();
    backups.sort();
    Ok(backups)
}

/// Where the in-app updater snapshots `db_path` before installing.
pub fn update_backup_path(db_path: &Path) -> PathBuf {
    db_path.with_extension("update-backup")
}

/// Replace `dest` with a copy of `backup`. The backup file is not opened and
/// its bytes must be unchanged afterwards.
#[allow(dead_code)] // pa uses this via #[path]; the app binary only tests it
pub fn restore_from_pre_migration_backup(backup: &Path, dest: &Path) -> Result<PathBuf, String> {
    if !backup.is_file() {
        return Err(format!("backup is not a file: {}", backup.display()));
    }
    let source = fs::File::open(backup)
        .map_err(|e| format!("failed to open backup {}: {e}", backup.display()))?;
    restore_from_reader(backup, dest, source, false)
}

/// Restore bytes already verified by the recovery journal adapter. The
/// identity path is still checked, but it is never reopened as the byte source;
/// besides pre-migration backups it may be the updater's [`update_backup_path`].
pub(crate) fn restore_verified_snapshot_bytes(
    backup: &Path,
    dest: &Path,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    restore_from_reader(backup, dest, bytes, true)
}

fn restore_from_reader(
    backup: &Path,
    dest: &Path,
    mut source: impl Read,
    update_backup_too: bool,
) -> Result<PathBuf, String> {
    let dest_name = dest
        .file_name()
        .ok_or_else(|| format!("{} has no file name", dest.display()))?;
    let bak_name = backup
        .file_name()
        .ok_or_else(|| format!("{} has no file name", backup.display()))?;

    if same_file(backup, dest)? {
        return Err("refused: destination is the backup file itself".to_string());
    }

    let prefix = format!("{}.pre-migration-", dest_name.to_string_lossy());
    let bak = bak_name.to_string_lossy();
    let update_backup =
        update_backup_too && update_backup_path(Path::new(dest_name)).as_os_str() == bak_name;
    if !(bak.starts_with(&prefix) && bak.ends_with(".bak")) && !update_backup {
        return Err(format!(
            "{} is not a pre-migration backup of {}",
            backup.display(),
            dest.display()
        ));
    }

    let parent = dest
        .parent()
        .ok_or_else(|| format!("{} has no parent", dest.display()))?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;

    let (tmp, mut output) = create_restore_temp(parent, &dest_name.to_string_lossy())
        .map_err(|e| format!("failed to create restore temporary file: {e}"))?;
    let copied = std::io::copy(&mut source, &mut output).and_then(|_| output.sync_all());
    // Close handles before the replace. Only `tmp` was created by us;
    // preexisting files, including leftovers from interrupted runs, are untouched.
    drop(output);
    drop(source);
    if let Err(err) = copied {
        let _ = fs::remove_file(&tmp);
        return Err(format!(
            "failed to copy {} to {}: {err}",
            backup.display(),
            tmp.display()
        ));
    }
    if let Err(err) = replace_file(&tmp, dest) {
        let _ = fs::remove_file(&tmp);
        return Err(format!(
            "failed to replace {} with {}: {err}",
            dest.display(),
            tmp.display()
        ));
    }
    unlink_sidecar(dest, "-wal");
    unlink_sidecar(dest, "-shm");
    Ok(dest.to_path_buf())
}

fn same_file(a: &Path, b: &Path) -> Result<bool, String> {
    if a == b {
        return Ok(true);
    }
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(left), Ok(right)) => Ok(paths_equal(&left, &right)),
        _ => Ok(false),
    }
}

#[cfg(windows)]
fn paths_equal(a: &Path, b: &Path) -> bool {
    a.as_os_str().eq_ignore_ascii_case(b.as_os_str())
}

#[cfg(not(windows))]
fn paths_equal(a: &Path, b: &Path) -> bool {
    a == b
}

fn unlink_sidecar(dest: &Path, suffix: &str) {
    let name = dest.file_name().map(|n| n.to_string_lossy().into_owned());
    let Some(name) = name else {
        return;
    };
    if let Some(parent) = dest.parent() {
        let _ = fs::remove_file(parent.join(format!("{name}{suffix}")));
    }
}

fn create_restore_temp(parent: &Path, name: &str) -> std::io::Result<(PathBuf, fs::File)> {
    for slot in 0..32 {
        let path = parent.join(format!("{name}.restore-tmp-{}-{slot}", std::process::id()));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "all restore temporary slots are occupied; existing files were preserved",
    ))
}

#[cfg(test)]
#[path = "db_restore_safety_tests.rs"]
mod safety_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    pub(super) fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "projecta-db-restore-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn restore_closes_the_source_before_replacing_the_destination() {
        struct Probe {
            bytes: &'static [u8],
            dest: PathBuf,
            dest_at_drop: std::rc::Rc<std::cell::RefCell<Option<Vec<u8>>>>,
        }
        impl Read for Probe {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                self.bytes.read(buf)
            }
        }
        impl Drop for Probe {
            fn drop(&mut self) {
                *self.dest_at_drop.borrow_mut() = fs::read(&self.dest).ok();
            }
        }

        let dir = scratch("close-source");
        let dest = dir.join("projecta.db");
        let bak = dir.join("projecta.db.pre-migration-1.bak");
        fs::write(&dest, b"candidate").unwrap();
        let seen = std::rc::Rc::new(std::cell::RefCell::new(None));
        let probe = Probe {
            bytes: b"original",
            dest: dest.clone(),
            dest_at_drop: seen.clone(),
        };
        restore_from_reader(&bak, &dest, probe, false).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"original");
        assert_eq!(seen.borrow().as_deref(), Some(&b"candidate"[..]));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn restore_refuses_when_dest_is_the_bak_path() {
        let dir = scratch("same");
        let bak = dir.join("projecta.db.pre-migration-1.bak");
        fs::write(&bak, b"sqlite-bytes").unwrap();
        let err = restore_from_pre_migration_backup(&bak, &bak).unwrap_err();
        assert!(err.contains("itself"), "{err}");
        assert_eq!(fs::read(&bak).unwrap(), b"sqlite-bytes");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn restore_refuses_when_dest_name_does_not_match_the_bak_prefix() {
        let dir = scratch("rename");
        let dest = dir.join("other.db");
        let bak = dir.join("projecta.db.pre-migration-1.bak");
        fs::write(&bak, b"snapshot").unwrap();
        let err = restore_from_pre_migration_backup(&bak, &dest).unwrap_err();
        assert!(err.contains("not a pre-migration backup"), "{err}");
        assert_eq!(fs::read(&bak).unwrap(), b"snapshot");
        assert!(!dest.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn pre_migration_restore_refuses_the_update_backup() {
        let dir = scratch("update-backup");
        let dest = dir.join("projecta.db");
        let bak = update_backup_path(&dest);
        fs::write(&bak, b"snapshot").unwrap();
        let err = restore_from_pre_migration_backup(&bak, &dest).unwrap_err();
        assert!(err.contains("not a pre-migration backup"), "{err}");
        assert!(!dest.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn restore_leaves_bak_bytes_unchanged_and_drops_wal() {
        let dir = scratch("copy");
        let dest = dir.join("projecta.db");
        let bak = dir.join("projecta.db.pre-migration-9.bak");
        fs::write(&bak, b"snapshot").unwrap();
        fs::write(&dest, b"live").unwrap();
        fs::write(dir.join("projecta.db-wal"), b"stale-wal").unwrap();
        fs::write(dir.join("projecta.db-shm"), b"stale-shm").unwrap();

        restore_from_pre_migration_backup(&bak, &dest).expect("restore");

        assert_eq!(fs::read(&bak).unwrap(), b"snapshot");
        assert_eq!(fs::read(&dest).unwrap(), b"snapshot");
        assert!(!dir.join("projecta.db-wal").exists());
        assert!(!dir.join("projecta.db-shm").exists());
        assert!(!dir
            .join("projecta.db.pre-migration-9.bak.pre-migration-1.bak")
            .exists());
        let _ = fs::remove_dir_all(dir);
    }
}
