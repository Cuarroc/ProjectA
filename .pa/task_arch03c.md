# ARCH-03c: share the replace primitive with DB restore

Status: entwurf

Goal: `pa db restore` replaces the database through the same replace primitive
as `fsutil::write_atomic`, so a transient scanner lock on Windows is retried
instead of failing the restore on the first attempt.

Scope: new leaf `src-tauri/src/fs_replace.rs` (the two existing
`replace_file` variants, moved verbatim, `pub(crate)`), consumed by `fsutil.rs`
and `db_restore.rs`; registered in `main.rs` and `bin/pa.rs`.
Out of scope: `write_atomic` itself, flags per caller, durability changes,
ADR A3 (stays an open proposal).

Proof: Windows-only test `restore_succeeds_when_the_destination_lock_is_released_during_the_retry_window`
in `db_restore_safety_tests.rs`, red on the `ci` workflow before the move.
Tier A (database, filesystem): two reviewers from other vendors.
