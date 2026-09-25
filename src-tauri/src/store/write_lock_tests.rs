//! Store writers against a foreign SQLite writer (W1-25b).
//!
//! SQLite runs the busy handler only while a connection holds no
//! transaction yet (`btreeBeginTrans`: the retry loop requires
//! `inTransaction == TRANS_NONE`). A deferred `BEGIN` whose first statement
//! reads and whose later statement writes therefore fails with
//! `(code: 5) database is locked` at once instead of waiting `busy_timeout`.
//! Each test lets a second connection hold the writer lock for [`HOLD`] and
//! requires the store call to wait for it.
use super::development_budget::BudgetPurpose;
use super::development_launches::tests::{bind_test_route, fixture};
use super::development_runs::CheckpointInput;
use super::team_assignments::AssignmentRequest;
use super::*;
use crate::testutil::TempDir;
use std::time::{Duration, Instant};

const HOLD: Duration = Duration::from_millis(300);

/// Takes SQLite's writer lock on a second, foreign connection - as another
/// process or a not yet rolled back pooled connection would - and releases
/// it after [`HOLD`].
async fn foreign_writer(dir: &TempDir) -> tokio::task::JoinHandle<()> {
    use sqlx::Connection as _;
    let options = SqliteConnectOptions::new()
        .filename(dir.path().join("projecta.db"))
        .busy_timeout(Duration::from_secs(5));
    let (locked_tx, locked_rx) = tokio::sync::oneshot::channel();
    let holder = tokio::spawn(async move {
        let mut conn = sqlx::sqlite::SqliteConnection::connect_with(&options)
            .await
            .expect("open foreign connection");
        sqlx::query("BEGIN IMMEDIATE")
            .execute(&mut conn)
            .await
            .expect("take the writer lock");
        locked_tx.send(()).expect("signal lock held");
        tokio::time::sleep(HOLD).await;
        sqlx::query("ROLLBACK")
            .execute(&mut conn)
            .await
            .expect("release the writer lock");
    });
    locked_rx.await.expect("foreign writer holds the lock");
    holder
}

/// Runs `call` while a foreign writer holds the lock; the call must wait
/// for it instead of failing busy. Returns the call's result.
pub(in crate::store) async fn waits<T>(
    what: &str,
    dir: &TempDir,
    call: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let holder = foreign_writer(dir).await;
    let started = Instant::now();
    let result = tokio::time::timeout(Duration::from_secs(20), call)
        .await
        .expect("store call must not hang");
    let elapsed = started.elapsed();
    holder.await.expect("foreign writer task");
    if let Err(error) = &result {
        assert!(
            !error.contains("database is locked"),
            "{what} must wait for the foreign writer, failed busy after {elapsed:?}: {error}"
        );
    }
    // A busy failure returns within about a millisecond; half of HOLD keeps
    // that separation while leaving room for a slow wake-up of this task
    // after the holder signalled.
    assert!(
        elapsed >= HOLD / 2,
        "{what} must have waited for the lock, took {elapsed:?}: {}",
        match &result {
            Ok(_) => "returned Ok without waiting".to_string(),
            Err(error) => error.clone(),
        }
    );
    result
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn releasing_claimed_queue_entries_waits_for_a_foreign_writer() {
    let dir = TempDir::new("write-lock-queue");
    let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
    let project = store
        .create_project("queue", &dir.path().join("repo").to_string_lossy())
        .await
        .unwrap();
    sqlx::query("INSERT INTO task_queue (id, project_id, raw_text, status, created_at) VALUES ('q1', ?, 'task', ?, 1)")
        .bind(&project.id)
        .bind(QUEUE_DISPATCHING)
        .execute(&store.pool)
        .await
        .unwrap();
    let released = waits(
        "releasing claimed queue entries",
        &dir,
        store.release_claimed_queue_entries(),
    )
    .await;
    assert_eq!(released, Ok(1));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn development_launch_writers_wait_for_a_foreign_writer() {
    let (dir, store, run) = fixture().await;
    let launch = waits(
        "a launch reservation",
        &dir,
        store.reserve_development_launch(&run, "owner", 1, "codex"),
    )
    .await
    .unwrap();
    bind_test_route(&store, &run).await;
    waits(
        "a launch consumption",
        &dir,
        store.consume_development_launch(&run, "owner", 1, &launch.worker_id, "session"),
    )
    .await
    .unwrap();
    waits(
        "a delivery",
        &dir,
        store.begin_development_delivery(&run, "owner", 1, "session", b"task"),
    )
    .await
    .unwrap();
    let exited = waits(
        "a process exit",
        &dir,
        store.record_development_process_exit(&launch.worker_id, "session", Some(0)),
    )
    .await;
    assert_eq!(exited, Ok(Some(run)));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn token_budget_writers_wait_for_a_foreign_writer() {
    let (dir, store, _run) = fixture().await;
    let started = waits(
        "a token reservation",
        &dir,
        store.reserve_development_tokens("goal", "plan", BudgetPurpose::Planning, 10, None),
    )
    .await
    .unwrap();
    waits(
        "a token start",
        &dir,
        store.start_development_tokens(&started.id),
    )
    .await
    .unwrap();
    waits(
        "a token settlement",
        &dir,
        store.settle_development_tokens(&started.id, 5, "receipt", now_unix_secs()),
    )
    .await
    .unwrap();
    let cancelled = store
        .reserve_development_tokens("goal", "cancel", BudgetPurpose::Review, 10, None)
        .await
        .unwrap();
    waits(
        "a token cancellation",
        &dir,
        store.cancel_development_tokens(&cancelled.id),
    )
    .await
    .unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_discovery_reservation_waits_for_a_foreign_writer() {
    let (dir, store, _run) = fixture().await;
    waits(
        "a discovery reservation",
        &dir,
        store.reserve_discovery_scan("goal", "scan"),
    )
    .await
    .unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_team_assignment_waits_for_a_foreign_writer() {
    let (dir, store, _run) = fixture().await;
    sqlx::query("INSERT INTO continuous_tasks(id, goal_id, objective, owned_paths_json, dependencies_json, status, created_at, updated_at) VALUES('open-task', 'goal', 'task', '[]', '[]', 'open', 1, 1)")
        .execute(&store.pool)
        .await
        .unwrap();
    let request = AssignmentRequest {
        team_id: "development".into(),
        role: "implementer".into(),
        assignee: "agent".into(),
        expected_revision: 0,
    };
    waits(
        "a team assignment",
        &dir,
        store.assign_continuous_task("open-task", request),
    )
    .await
    .unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_agent_checkpoint_waits_for_a_foreign_writer() {
    let (dir, store, run) = fixture().await;
    let input = CheckpointInput {
        idempotency_key: "first".into(),
        expected_revision: 0,
        completed: vec!["step".into()],
        remaining: vec![],
        failed_approaches: vec![],
        evidence_ids: vec![],
    };
    waits(
        "an agent checkpoint",
        &dir,
        store.record_agent_checkpoint(&run, "owner", 1, input),
    )
    .await
    .unwrap();
}

/// Measured, not assumed: reopening an up-to-date database writes nothing,
/// so it neither needs the writer lock nor fails busy under a foreign writer.
/// Pending migrations are not covered here.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reopening_the_store_does_not_fail_under_a_foreign_writer() {
    let dir = TempDir::new("write-lock-open");
    let path = dir.path().join("projecta.db");
    Store::open(&path).await.unwrap().pool.close().await;
    let holder = foreign_writer(&dir).await;
    let reopened = Store::open(&path).await;
    holder.await.expect("foreign writer task");
    assert!(reopened.is_ok(), "{:?}", reopened.err());
}
