//! Row 6 proof: pause, drain and cancel stop new continuous work, survive a
//! reopen, and leave the legacy task queue alone.
use super::super::{QueueEntry, Store, QUEUE_READY};
use super::tests::store;

async fn project_state(store: &Store, project: &str) -> Option<String> {
    sqlx::query_scalar("SELECT status FROM continuous_projects WHERE project_id = ?1")
        .bind(project)
        .fetch_optional(&store.pool)
        .await
        .unwrap()
}

async fn lock_count(store: &Store, project: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM continuous_scope_locks WHERE project_id = ?1")
        .bind(project)
        .fetch_one(&store.pool)
        .await
        .unwrap()
}

/// Claim must be refused with `state` in the message and must not spend budget.
async fn assert_refused(store: &Store, task: &str, state: &str) {
    let err = store
        .claim_continuous_task(task, "late", false)
        .await
        .unwrap_err();
    assert!(err.contains(state), "unexpected refusal: {err}");
    let row = store.get_continuous_task(task).await.unwrap().unwrap();
    assert_eq!((row.status.as_str(), row.attempts), ("open", 0));
}

async fn reopen(dir: &crate::testutil::TempDir, store: Store) -> Store {
    store.pool.close().await;
    drop(store);
    Store::open(&dir.path().join("projecta.db")).await.unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn paused_draining_and_absent_state_refuse_claims_and_survive_reopen() {
    let (dir, store, project) = store().await;
    let goal = store
        .create_continuous_goal(&project, "control", None, None, true)
        .await
        .unwrap();
    let mut ids = Vec::new();
    for name in ["running", "late", "after"] {
        let path = format!("{name}.rs");
        let task = store
            .create_continuous_task(&goal.id, name, None, vec![path], vec![])
            .await
            .unwrap();
        ids.push(task.id);
    }
    let (running, late, after) = (&ids[0], &ids[1], &ids[2]);
    let claim = store
        .claim_continuous_task(running, "owner", false)
        .await
        .unwrap();

    // Absent state is treated as paused, not as enabled.
    sqlx::query("DELETE FROM continuous_projects WHERE project_id = ?1")
        .bind(&project)
        .execute(&store.pool)
        .await
        .unwrap();
    assert_refused(&store, late, "paused").await;

    // Pause is durable across a reopen.
    assert_eq!(
        store
            .control_continuous(&project, "pause")
            .await
            .unwrap()
            .status,
        "paused"
    );
    let store = reopen(&dir, store).await;
    assert_eq!(
        project_state(&store, &project).await.as_deref(),
        Some("paused")
    );
    assert_refused(&store, late, "paused").await;

    // Drain refuses new claims, yet the claim already running stays checkpointable.
    assert_eq!(
        store
            .control_continuous(&project, "drain")
            .await
            .unwrap()
            .status,
        "draining"
    );
    let store = reopen(&dir, store).await;
    assert_eq!(
        project_state(&store, &project).await.as_deref(),
        Some("draining")
    );
    assert_refused(&store, late, "draining").await;
    let cp = store
        .checkpoint_continuous_task(running, "owner", claim.fence, None, Some("still working"))
        .await
        .unwrap();
    assert_eq!(cp.status, "running");

    // The legacy queue neither reads nor is blocked by the continuous state.
    let entry = QueueEntry {
        id: "legacy-1".into(),
        project_id: project.clone(),
        raw_text: "legacy work".into(),
        sharpened_text: None,
        profile_id: "claude".into(),
        status: QUEUE_READY.into(),
        priority: 0,
        worker_id: None,
        error: None,
        spawned_by: None,
        created_at: 1,
    };
    store.insert_queue_entry(&entry).await.unwrap();
    assert!(store.claim_queue_entry("legacy-1").await.unwrap());
    let waiting = QueueEntry {
        id: "legacy-2".into(),
        ..entry.clone()
    };
    store.insert_queue_entry(&waiting).await.unwrap();
    assert_eq!(
        project_state(&store, &project).await.as_deref(),
        Some("draining")
    );

    // Cancel releases every scope lock, cancels open and running work, and stays paused.
    assert_eq!(lock_count(&store, &project).await, 3);
    assert_eq!(
        store
            .control_continuous(&project, "cancel")
            .await
            .unwrap()
            .status,
        "paused"
    );
    assert_eq!(lock_count(&store, &project).await, 0);
    for id in &ids {
        let task = store.get_continuous_task(id).await.unwrap().unwrap();
        assert_eq!(task.status, "cancelled");
    }
    let queue = store.list_queue(Some(&project)).await.unwrap();
    let status_of = |id: &str| queue.iter().find(|e| e.id == id).map(|e| e.status.clone());
    assert_eq!(status_of("legacy-2").as_deref(), Some(QUEUE_READY));
    assert_ne!(status_of("legacy-1").as_deref(), Some(QUEUE_READY));
    let store = reopen(&dir, store).await;
    assert_eq!(
        project_state(&store, &project).await.as_deref(),
        Some("paused")
    );
    let err = store
        .claim_continuous_task(after, "late", false)
        .await
        .unwrap_err();
    assert!(err.contains("not open"), "unexpected refusal: {err}");
    assert!(store
        .checkpoint_continuous_task(running, "owner", claim.fence, None, None)
        .await
        .is_err());
}
