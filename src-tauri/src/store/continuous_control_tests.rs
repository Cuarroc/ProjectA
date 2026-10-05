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

/// Row 21 proof. Simulates a crash: the pool is dropped without a clean close
/// and the same SQLite file (WAL included) is reopened.
async fn crash(dir: &crate::testutil::TempDir, store: Store) -> Store {
    drop(store);
    Store::open(&dir.path().join("projecta.db")).await.unwrap()
}

async fn claim_of(store: &Store, task: &str) -> (Option<String>, i64) {
    sqlx::query_as("SELECT claim_owner, claim_fence FROM continuous_tasks WHERE id = ?1")
        .bind(task)
        .fetch_one(&store.pool)
        .await
        .unwrap()
}

struct Killpoint<'a> {
    task: &'a str,
    fence: i64,
    /// Expected durable `(task status, run status)` right after the crash.
    expect: (&'a str, Option<&'a str>),
}

/// After a crash the task is either as before or blocked on reconciliation:
/// nobody else can claim it, and the owner cannot release it past a run that
/// is still unresolved.
async fn assert_unreclaimable(store: &Store, project: &str, kp: &Killpoint<'_>) {
    let task = store.get_continuous_task(kp.task).await.unwrap().unwrap();
    let run: Option<String> =
        sqlx::query_scalar("SELECT status FROM development_runs WHERE task_id = ?1")
            .bind(kp.task)
            .fetch_optional(&store.pool)
            .await
            .unwrap();
    assert_eq!((task.status.as_str(), run.as_deref()), kp.expect);
    assert_eq!(
        claim_of(store, kp.task).await,
        (Some("owner".into()), kp.fence)
    );
    assert_eq!(
        lock_count(store, project).await,
        1,
        "scope lock must survive"
    );
    let err = store
        .claim_continuous_task(kp.task, "thief", false)
        .await
        .unwrap_err();
    assert!(err.contains("not open"), "task was reclaimable: {err}");
    if matches!(run.as_deref(), Some("intent" | "launched" | "reconciling")) {
        for status in ["retry", "completed", "failed", "cancelled"] {
            let err = store
                .checkpoint_continuous_task(kp.task, "owner", kp.fence, Some(status), None)
                .await
                .unwrap_err();
            assert!(
                err.contains("unresolved") || err.contains("resolved failed run"),
                "{status} released a live run: {err}"
            );
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reopen_after_each_transition_never_leaves_an_unreconciled_claim_reclaimable() {
    let (dir, store, project) = store().await;
    let goal = store
        .create_continuous_goal(&project, "killpoints", None, None, true)
        .await
        .unwrap();
    let task = store
        .create_continuous_task(&goal.id, "task", None, vec!["a.rs".into()], vec![])
        .await
        .unwrap();
    let task = task.id.as_str();

    // Kill point 0: claim committed, no run yet. The claim is kept, not dropped.
    let claim = store
        .claim_continuous_task(task, "owner", false)
        .await
        .unwrap();
    let mut kp = Killpoint {
        task,
        fence: claim.fence,
        expect: ("running", None),
    };
    let store = crash(&dir, store).await;
    assert_unreclaimable(&store, &project, &kp).await;

    // Kill point 1: launch intent committed, nothing spawned.
    let run = store
        .record_development_run_intent(task, "owner", claim.fence)
        .await
        .unwrap()
        .id;
    kp.expect = ("running", Some("intent"));
    let store = crash(&dir, store).await;
    assert_unreclaimable(&store, &project, &kp).await;

    // Kill point 2: reservation, route and consumption committed, before the
    // run is marked launched. The reopen must not authorize a second launch.
    let launch = store
        .reserve_development_launch(&run, "owner", claim.fence, "codex")
        .await
        .unwrap();
    store
        .bind_development_launch_baseline(&run, "owner", claim.fence, &"a".repeat(40))
        .await
        .unwrap();
    store
        .bind_development_launch_route(&run, "owner", claim.fence, &serde_json::json!({"selection":{"resolved":{"profileId":"codex"}},"expiresAt":crate::store::now_unix_secs()+600}))
        .await
        .unwrap();
    store
        .reserve_development_tokens(
            &goal.id,
            "kp-budget",
            crate::store::development_budget::BudgetPurpose::Implementation,
            1000,
            Some(&run),
        )
        .await
        .unwrap();
    store
        .consume_development_launch(&run, "owner", claim.fence, &launch.worker_id, "session")
        .await
        .unwrap();
    let store = crash(&dir, store).await;
    assert_unreclaimable(&store, &project, &kp).await;
    assert!(store
        .reserve_development_launch(&run, "owner", claim.fence, "codex")
        .await
        .is_err());

    // Kill point 3: the run is marked launched. A crash here is only ever
    // resolved by startup reconciliation, which blocks it as `reconciling`.
    store
        .mark_development_run_launched(&run, "owner", claim.fence, Some(&launch.worker_id), None)
        .await
        .unwrap();
    kp.expect = ("running", Some("launched"));
    let store = crash(&dir, store).await;
    assert_unreclaimable(&store, &project, &kp).await;
    assert_eq!(
        store
            .reconcile_interrupted_development_launches()
            .await
            .unwrap(),
        1
    );
    kp.expect = ("running", Some("reconciling"));
    let store = crash(&dir, store).await;
    assert_unreclaimable(&store, &project, &kp).await;

    // Kill point 4: the process exit is evidence, not acceptance of the task.
    store
        .record_development_process_exit(&launch.worker_id, "session", Some(0))
        .await
        .unwrap();
    kp.expect = ("running", Some("reconciling"));
    let store = crash(&dir, store).await;
    assert_unreclaimable(&store, &project, &kp).await;

    // Kill point 5: the run is resolved, then the checkpoint releases the claim.
    store
        .fail_development_run(&run, "owner", claim.fence, "exit observed, not accepted")
        .await
        .unwrap();
    kp.expect = ("running", Some("failed"));
    let store = crash(&dir, store).await;
    assert_unreclaimable(&store, &project, &kp).await;
    store
        .checkpoint_continuous_task(task, "owner", claim.fence, Some("failed"), None)
        .await
        .unwrap();
    let store = crash(&dir, store).await;
    let done = store.get_continuous_task(task).await.unwrap().unwrap();
    assert_eq!(done.status, "failed");
    assert_eq!(claim_of(&store, task).await.0, None);
    assert_eq!(lock_count(&store, &project).await, 0);
}
