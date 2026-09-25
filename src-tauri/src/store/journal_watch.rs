//! One deterministic journal watcher per Store; no models or execution authority.

use super::Store;
use serde_json::Value;
use sqlx::{Connection, SqliteConnection, SqlitePool};
use std::time::Duration;
use tokio::{sync::watch, task::JoinHandle, time::Instant};

const TICK: Duration = Duration::from_millis(250);
pub(super) struct JournalWatch {
    state: watch::Receiver<Result<i64, String>>,
    task: JoinHandle<()>,
}

impl Drop for JournalWatch {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl JournalWatch {
    async fn start(pool: &SqlitePool) -> Result<Self, String> {
        let options = (*pool.connect_options())
            .clone()
            .create_if_missing(false)
            .read_only(true);
        let mut connection = SqliteConnection::connect_with(&options)
            .await
            .map_err(error)?;
        // data_version values are comparable only on this dedicated connection.
        let mut version: i64 = sqlx::query_scalar("PRAGMA data_version")
            .fetch_one(&mut connection)
            .await
            .map_err(error)?;
        let cursor = last_cursor(&mut connection).await?;
        let (sender, state) = watch::channel(Ok(cursor));
        let pool = pool.clone();
        let task = tokio::spawn(async move {
            loop {
                if tokio::time::timeout(TICK, pool.close_event()).await.is_ok() {
                    break;
                }
                // The retained receiver is not a subscriber. No waiting consumers,
                // no healthy database probes. Errors retry so a failed observer
                // can recover even after every failed request has disconnected.
                if sender.receiver_count() <= 1 && sender.borrow().is_ok() {
                    continue;
                }
                let probe: Result<i64, sqlx::Error> = sqlx::query_scalar("PRAGMA data_version")
                    .fetch_one(&mut connection)
                    .await;
                let value = match probe {
                    Ok(next) if next != version || sender.borrow().is_err() => {
                        match last_cursor(&mut connection).await {
                            Ok(cursor) => {
                                version = next;
                                Ok(cursor)
                            }
                            Err(err) => Err(err),
                        }
                    }
                    Ok(_) => continue,
                    Err(err) => Err(error(err)),
                };
                sender.send_if_modified(|current| {
                    if *current == value {
                        false
                    } else {
                        *current = value;
                        true
                    }
                });
            }
        });
        Ok(Self { state, task })
    }
}

async fn last_cursor(connection: &mut SqliteConnection) -> Result<i64, String> {
    sqlx::query_scalar("SELECT COALESCE(MAX(cursor),0) FROM continuous_events")
        .fetch_one(connection)
        .await
        .map_err(error)
}
fn error(err: sqlx::Error) -> String {
    format!("continuous journal watcher unavailable: {err}")
}

impl Store {
    pub(crate) async fn journal_subscription(
        &self,
    ) -> Result<watch::Receiver<Result<i64, String>>, String> {
        let watcher = self
            .journal_watch
            .get_or_try_init(|| JournalWatch::start(&self.pool))
            .await?;
        Ok(watcher.state.clone())
    }
    pub async fn wait_continuous_changes(
        &self,
        project: &str,
        cursor: i64,
        wait_ms: u64,
    ) -> Result<Value, String> {
        if wait_ms > 25_000 {
            return Err("waitMs must be between 0 and 25000".into());
        }
        if wait_ms == 0 {
            return self.continuous_changes(project, cursor).await;
        }
        if cursor < 0 {
            return Err("cursor must be non-negative".into());
        }
        // Validate before allocating the one lazy observer connection.
        self.require_project(project).await?;
        let mut receiver = self.journal_subscription().await?;
        let deadline = Instant::now() + Duration::from_millis(wait_ms);
        loop {
            // Subscribe before reading: a commit between read and wait cannot be lost.
            receiver.borrow_and_update().clone()?;
            let changes = self.continuous_changes(project, cursor).await?;
            if !changes["events"]
                .as_array()
                .ok_or("invalid journal page")?
                .is_empty()
                || Instant::now() >= deadline
            {
                return Ok(changes);
            }
            match tokio::time::timeout_at(deadline, receiver.changed()).await {
                Ok(Ok(())) => {}
                Ok(Err(_)) => return Err("continuous journal watcher stopped".into()),
                Err(_) => return self.continuous_changes(project, cursor).await,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;
    use std::time::Duration;

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn journal_wait_timeout_errors_recovery_and_shutdown_are_explicit() {
        let dir = TempDir::new("journal-watch-errors");
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let project = store
            .create_project("watch", &dir.path().to_string_lossy())
            .await
            .unwrap();
        assert!(store
            .wait_continuous_changes(&project.id, 0, 25001)
            .await
            .is_err());
        assert!(store
            .wait_continuous_changes("unknown", 0, 10)
            .await
            .is_err());
        assert!(store.journal_watch.get().is_none());
        let started = Instant::now();
        let empty = store
            .wait_continuous_changes(&project.id, 0, 150)
            .await
            .unwrap();
        assert!(started.elapsed() >= Duration::from_millis(150));
        assert!(empty["events"].as_array().unwrap().is_empty());
        let watcher = store.journal_watch.get().unwrap();
        let mut observed = watcher.state.clone();
        sqlx::query("DROP TABLE continuous_events")
            .execute(&store.pool)
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(3), observed.changed())
            .await
            .unwrap()
            .unwrap();
        assert!(observed.borrow().is_err());
        assert!(store
            .wait_continuous_changes(&project.id, 0, 100)
            .await
            .is_err());
        // Drop the last external subscriber: recovery must not depend on keeping
        // a failed HTTP request alive.
        drop(observed);
        sqlx::query("CREATE TABLE continuous_events(cursor INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT NOT NULL,kind TEXT NOT NULL,detail TEXT NOT NULL,created_at INTEGER NOT NULL)").execute(&store.pool).await.unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while watcher.state.borrow().is_err() {
            assert!(
                Instant::now() < deadline,
                "observer did not recover without subscribers"
            );
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        let watching = store.clone();
        let id = project.id.clone();
        let waiter =
            tokio::spawn(async move { watching.wait_continuous_changes(&id, 0, 4000).await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        store.pool.close().await;
        assert!(tokio::time::timeout(Duration::from_secs(2), waiter)
            .await
            .unwrap()
            .unwrap()
            .is_err());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn waiting_changes_delivers_only_committed_project_events_and_recovers_cursor() {
        let dir = TempDir::new("journal-watch");
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let project = store
            .create_project("watch", &dir.path().to_string_lossy())
            .await
            .unwrap();
        let watching = store.clone();
        let id = project.id.clone();
        let waiter =
            tokio::spawn(async move { watching.wait_continuous_changes(&id, 0, 4000).await });
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(
            !waiter.is_finished(),
            "empty reads must wait for journal changes"
        );
        let mut tx = store.pool.begin().await.unwrap();
        sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'probe','rolled-back',1)").bind(&project.id).execute(&mut *tx).await.unwrap();
        tx.rollback().await.unwrap();
        sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES('foreign','probe','private',1)").execute(&store.pool).await.unwrap();
        tokio::time::sleep(Duration::from_millis(600)).await;
        assert!(
            !waiter.is_finished(),
            "rollback and foreign events must not complete the wait"
        );
        sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'probe','committed',1)").bind(&project.id).execute(&store.pool).await.unwrap();
        let result = tokio::time::timeout(Duration::from_secs(4), waiter)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(result["events"].as_array().unwrap().len(), 1);
        assert_eq!(result["events"][0]["detail"], "committed");
        let cursor = result["cursor"].as_i64().unwrap();
        let empty = store
            .wait_continuous_changes(&project.id, cursor, 0)
            .await
            .unwrap();
        assert_eq!(empty["cursor"], cursor);
        assert!(empty["events"].as_array().unwrap().is_empty());
        store.pool.close().await;
        let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        assert_eq!(
            reopened
                .wait_continuous_changes(&project.id, 0, 4000)
                .await
                .unwrap()["cursor"],
            cursor
        );
    }
}
