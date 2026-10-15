//! Pool connects that outlast a late-released lock (KI-24).
//!
//! SQLite's busy handler gives up after `SQLITE_BUSY_TIMEOUT_MS`, and some
//! locks are never waited on at all (changing the journal mode, WAL
//! recovery). On Windows a just-closed pool or a scanner can keep the file
//! locked past that point, and `Store::open` then failed with
//! `(code: 5) database is locked` - observed when it reopens the startup pool
//! after a migration and when a test reopens a database it just closed. Only
//! SQLITE_BUSY is retried, a few times with a short backoff; every other
//! error and the final BUSY are returned unchanged.
use super::*;

/// Connect attempts per pool, the first included.
const ATTEMPTS: u32 = 3;
/// Pause before the second attempt; doubled for each further one.
const BACKOFF: Duration = Duration::from_millis(250);

/// Whether `error` is SQLITE_BUSY, extended codes (recovery, snapshot,
/// timeout) included: they share the primary code in the low byte.
pub(super) fn is_busy(error: &sqlx::Error) -> bool {
    matches!(error, sqlx::Error::Database(db)
        if db.code().and_then(|code| code.parse::<i32>().ok()).is_some_and(|code| code & 0xff == 5))
}

/// The pool `Store` runs on, retrying a connect that fails with SQLITE_BUSY.
pub(super) async fn connect_pool(
    options: &SqliteConnectOptions,
) -> Result<SqlitePool, sqlx::Error> {
    let mut backoff = BACKOFF;
    let mut attempt = 1;
    loop {
        let result = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options.clone())
            .await;
        match result {
            Err(error) if attempt < ATTEMPTS && is_busy(&error) => {
                tokio::time::sleep(backoff).await;
                backoff *= 2;
                attempt += 1;
            }
            other => return other,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;
    use sqlx::sqlite::SqliteConnection;
    use sqlx::sqlite::SqliteLockingMode;
    use sqlx::Connection as _;

    /// Longer than the 5 s busy timeout, so one connect attempt cannot span it.
    const HOLD: Duration = Duration::from_secs(6);

    /// Holds the database exclusively on a foreign connection - no other
    /// connection can even read - and closes it after `hold`.
    async fn foreign_exclusive_holder(path: &Path, hold: Duration) -> tokio::task::JoinHandle<()> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .journal_mode(SqliteJournalMode::Wal)
            .locking_mode(SqliteLockingMode::Exclusive);
        let (locked_tx, locked_rx) = tokio::sync::oneshot::channel();
        let holder = tokio::spawn(async move {
            let mut conn = SqliteConnection::connect_with(&options)
                .await
                .expect("open foreign connection");
            // Exclusive locking mode keeps the lock once the first access took it.
            sqlx::query("BEGIN IMMEDIATE")
                .execute(&mut conn)
                .await
                .expect("take the database lock");
            sqlx::query("ROLLBACK")
                .execute(&mut conn)
                .await
                .expect("end the transaction, keeping the lock");
            locked_tx.send(()).expect("signal lock held");
            tokio::time::sleep(hold).await;
            conn.close().await.expect("release the lock");
        });
        locked_rx.await.expect("foreign connection holds the lock");
        holder
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn open_waits_out_a_lock_that_outlasts_the_busy_timeout() {
        let dir = TempDir::new("store-connect-retry");
        let path = dir.path().join("projecta.db");
        Store::open(&path)
            .await
            .expect("create the database")
            .pool
            .close()
            .await;
        let holder = foreign_exclusive_holder(&path, HOLD).await;

        let store = Store::open(&path).await;

        holder.await.expect("holder task");
        store.expect("open must wait out a foreign lock held past the busy timeout");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn only_busy_errors_are_classified_as_retryable() {
        let dir = TempDir::new("store-connect-classify");
        let path = dir.path().join("projecta.db");
        Store::open(&path)
            .await
            .expect("create the database")
            .pool
            .close()
            .await;
        let holder = foreign_exclusive_holder(&path, Duration::from_millis(300)).await;
        let busy = SqliteConnectOptions::new()
            .filename(&path)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::ZERO);
        // One raw attempt: `connect_pool` itself would outwait the short hold.
        let locked = SqliteConnection::connect_with(&busy)
            .await
            .expect_err("held exclusively");
        let not_there = SqliteConnectOptions::new().filename(dir.path().join("missing/x.db"));
        let cannot_open = connect_pool(&not_there)
            .await
            .expect_err("directory does not exist");
        holder.await.expect("holder task");

        assert!(is_busy(&locked), "{locked}");
        assert!(!is_busy(&cannot_open), "{cannot_open}");
    }
}
