use super::*;

#[test]
fn replacement_failure_preserves_the_original_database() {
    let dir = tests::scratch("replace-failure");
    let dest = dir.join("projecta.db");
    fs::write(&dest, b"original-database").unwrap();
    assert!(replace_file(&dir.join("missing.tmp"), &dest).is_err());
    assert_eq!(fs::read(&dest).unwrap(), b"original-database");
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn restore_does_not_overwrite_a_preexisting_temporary_file() {
    let dir = tests::scratch("temp-collision");
    let dest = dir.join("projecta.db");
    let backup = dir.join("projecta.db.pre-migration-1.bak");
    let collision = dir.join(format!("projecta.db.restore-tmp-{}", std::process::id()));
    fs::write(&dest, b"original-database").unwrap();
    fs::write(&backup, b"verified-snapshot").unwrap();
    fs::write(&collision, b"unrelated-existing-file").unwrap();
    restore_from_pre_migration_backup(&backup, &dest).unwrap();
    assert_eq!(fs::read(&collision).unwrap(), b"unrelated-existing-file");
    assert_eq!(fs::read(&backup).unwrap(), b"verified-snapshot");
    assert_eq!(fs::read(&dest).unwrap(), b"verified-snapshot");
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn occupied_temporary_slots_preserve_every_file_and_the_database() {
    let dir = tests::scratch("temp-exhaustion");
    let dest = dir.join("projecta.db");
    let backup = dir.join("projecta.db.pre-migration-1.bak");
    fs::write(&dest, b"original").unwrap();
    fs::write(&backup, b"snapshot").unwrap();
    let paths: Vec<_> = (0..32)
        .map(|slot| {
            dir.join(format!(
                "projecta.db.restore-tmp-{}-{slot}",
                std::process::id()
            ))
        })
        .collect();
    for path in &paths {
        fs::write(path, b"occupied").unwrap();
    }
    assert!(restore_from_pre_migration_backup(&backup, &dest)
        .unwrap_err()
        .contains("occupied"));
    assert_eq!(fs::read(&dest).unwrap(), b"original");
    assert_eq!(fs::read(&backup).unwrap(), b"snapshot");
    for path in paths {
        assert_eq!(fs::read(path).unwrap(), b"occupied");
    }
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn two_temporary_allocations_never_share_a_file() {
    let dir = tests::scratch("temp-ownership");
    let (a, mut first) = create_restore_temp(&dir, "projecta.db").unwrap();
    let (b, mut second) = create_restore_temp(&dir, "projecta.db").unwrap();
    assert_ne!(a, b);
    use std::io::Write;
    first.write_all(b"first").unwrap();
    second.write_all(b"second").unwrap();
    drop((first, second));
    assert_eq!(fs::read(a).unwrap(), b"first");
    assert_eq!(fs::read(b).unwrap(), b"second");
    fs::remove_dir_all(dir).unwrap();
}

#[cfg(windows)]
#[test]
fn restore_succeeds_when_the_destination_lock_is_released_during_the_retry_window() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = tests::scratch("transient-lock");
    let dest = dir.join("projecta.db");
    let backup = dir.join("projecta.db.pre-migration-1.bak");
    fs::write(&dest, b"original").unwrap();
    fs::write(&backup, b"snapshot").unwrap();
    fs::write(dir.join("projecta.db-wal"), b"stale-wal").unwrap();
    fs::write(dir.join("projecta.db-shm"), b"stale-shm").unwrap();
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&dest)
        .unwrap();
    let releaser = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(150));
        drop(held);
    });
    let result = restore_from_pre_migration_backup(&backup, &dest);
    releaser.join().unwrap();
    result.expect("a lock released inside the retry window must not fail the restore");
    assert_eq!(fs::read(&dest).unwrap(), b"snapshot");
    assert_eq!(fs::read(&backup).unwrap(), b"snapshot");
    assert!(!dir.join("projecta.db-wal").exists());
    assert!(!dir.join("projecta.db-shm").exists());
    let mut names: Vec<_> = fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names, ["projecta.db", "projecta.db.pre-migration-1.bak"]);
    fs::remove_dir_all(dir).unwrap();
}

#[cfg(windows)]
#[test]
fn locked_destination_refuses_restore_without_deleting_the_original() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = tests::scratch("locked-destination");
    let dest = dir.join("projecta.db");
    let backup = dir.join("projecta.db.pre-migration-1.bak");
    fs::write(&dest, b"original").unwrap();
    fs::write(&backup, b"snapshot").unwrap();
    fs::write(dir.join("projecta.db-wal"), b"live-wal").unwrap();
    fs::write(dir.join("projecta.db-shm"), b"live-shm").unwrap();
    fs::write(dir.join("projecta.db.unrelated.tmp"), b"unrelated").unwrap();
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&dest)
        .unwrap();
    let result = restore_from_pre_migration_backup(&backup, &dest);
    drop(held);
    assert!(result.is_err());
    assert_eq!(fs::read(&dest).unwrap(), b"original");
    assert_eq!(fs::read(&backup).unwrap(), b"snapshot");
    assert_eq!(fs::read(dir.join("projecta.db-wal")).unwrap(), b"live-wal");
    assert_eq!(fs::read(dir.join("projecta.db-shm")).unwrap(), b"live-shm");
    assert_eq!(
        fs::read(dir.join("projecta.db.unrelated.tmp")).unwrap(),
        b"unrelated"
    );
    assert_eq!(
        fs::read_dir(&dir).unwrap().count(),
        5,
        "only owned temp is cleaned"
    );
    fs::remove_dir_all(dir).unwrap();
}

#[cfg(unix)]
#[test]
fn temporary_files_start_private_and_restored_database_stays_private() {
    use std::os::unix::fs::OpenOptionsExt;
    use std::os::unix::fs::PermissionsExt;
    let dir = tests::scratch("private-temp");
    let (tmp, file) = create_restore_temp(&dir, "projecta.db").unwrap();
    assert_eq!(file.metadata().unwrap().permissions().mode() & 0o777, 0o600);
    drop(file);
    fs::remove_file(tmp).unwrap();
    let backup = dir.join("projecta.db.pre-migration-1.bak");
    let dest = dir.join("projecta.db");
    use std::io::Write;
    let mut source = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&backup)
        .unwrap();
    source.write_all(b"private-snapshot").unwrap();
    drop(source);
    restore_from_pre_migration_backup(&backup, &dest).unwrap();
    assert_eq!(
        fs::metadata(&dest).unwrap().permissions().mode() & 0o777,
        0o600
    );
    fs::remove_dir_all(dir).unwrap();
}
