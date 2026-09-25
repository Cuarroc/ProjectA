use super::*;
use std::{future::Future, time::Duration};

async fn behind_writer<T>(store: &Store, operation: impl Future<Output = Result<T, String>>) -> T {
    let mut writer = store.pool.begin().await.unwrap();
    sqlx::query("UPDATE continuous_goals SET updated_at=updated_at")
        .execute(&mut *writer)
        .await
        .unwrap();
    let mut operation = Box::pin(operation);
    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut operation)
            .await
            .is_err(),
        "writer must wait before reading instead of failing a read-to-write upgrade"
    );
    writer.rollback().await.unwrap();
    tokio::time::timeout(Duration::from_secs(3), operation)
        .await
        .expect("writer resumed")
        .unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn launch_transition_waits_for_existing_writer_before_reading() {
    let (_dir, store, _, task) = tests::fixture().await;
    let run = store
        .record_development_run_intent(&task, "worker-a", 7)
        .await
        .unwrap();
    let launched = behind_writer(
        &store,
        store.mark_development_run_launched(&run.id, "worker-a", 7, None, Some(123)),
    )
    .await;
    assert_eq!(launched.status, RUN_LAUNCHED);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sibling_run_writers_wait_without_losing_authority_or_evidence() {
    let (_dir, store, _, task) = tests::fixture().await;
    let run = behind_writer(
        &store,
        store.record_development_run_intent(&task, "worker-a", 7),
    )
    .await;
    behind_writer(
        &store,
        store.bind_development_run_candidate(
            &run.id,
            "worker-a",
            7,
            tests::COMMIT_A,
            "test",
            now_unix_secs(),
        ),
    )
    .await;
    behind_writer(
        &store,
        store.record_development_evidence(
            &run.id,
            "worker-a",
            7,
            EvidenceInput {
                idempotency_key: "proof".into(),
                source: "test".into(),
                observed_at: now_unix_secs(),
                candidate_commit: tests::COMMIT_A.into(),
                measurement: EvidenceMeasurement::Measured {
                    value: serde_json::json!(true),
                },
                payload: serde_json::json!({}),
            },
        ),
    )
    .await;
    behind_writer(
        &store,
        store.mark_development_run_reconciling(&run.id, "worker-a", 7),
    )
    .await;
    assert!(store
        .complete_development_run(&run.id, "wrong-owner", 7, None)
        .await
        .is_err());
    behind_writer(
        &store,
        store.complete_development_run(&run.id, "worker-a", 7, None),
    )
    .await;
}
