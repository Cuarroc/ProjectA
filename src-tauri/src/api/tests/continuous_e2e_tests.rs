//! M4-E2E-14 (acceptance row 14): a checkpoint written by an agent process
//! survives that process' abort and is read back, and extended, by the next
//! fenced run - real router, real store, real child process.
use super::*;

const ENV_DESCRIPTOR: &str = "PA_E2E_FAKE_AGENT_DESCRIPTOR";
const CHECKPOINT: &str = "/api/hq/v1/agent/checkpoint";
const CHILD: &str = "api::tests::continuous_e2e_tests::fake_agent_child";

fn checkpoint(key: &str, expected: i64, remaining: &str) -> String {
    json!({"idempotencyKey":key,"expectedRevision":expected,"completed":[],"remaining":[remaining],"failedApproaches":[],"evidenceIds":[]}).to_string()
}

/// Not a test unless the parent sets the descriptor path: then this process
/// is the fake agent. It reads its scoped credential, posts one checkpoint
/// and dies with a non-zero status, the way an aborted agent does.
#[test]
fn fake_agent_child() {
    let Ok(path) = std::env::var(ENV_DESCRIPTOR) else {
        return;
    };
    let d: Descriptor = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let (status, _) = call(
        d.port,
        "POST",
        CHECKPOINT,
        Some(&d.token),
        &checkpoint("cp-1", 0, "Finish task"),
    );
    std::process::exit(if status == 200 { 3 } else { 4 });
}

#[test]
fn checkpoint_survives_agent_abort_and_is_resumed_by_the_next_run() {
    let dir = TempDir::new("continuous-e2e-checkpoint");
    let db = dir.path().join("projecta.db");
    let (store, pool, first) = tauri::async_runtime::block_on(async {
        let store = crate::store::Store::open(&db).await.unwrap();
        let pool = sqlx::SqlitePool::connect(&format!("sqlite:{}", db.display()))
            .await
            .unwrap();
        let project = store
            .create_project("e2e", &dir.path().join("p").to_string_lossy())
            .await
            .unwrap();
        let policy =
            serde_json::to_string(&crate::development_policy::DevelopmentPolicy::defaults())
                .unwrap();
        for sql in [
            format!("INSERT INTO continuous_projects VALUES('{}', 'enabled', 1)", project.id),
            format!("INSERT INTO continuous_goals(id,project_id,root_goal_id,objective,status,deadline_at,admitted,created_at,updated_at) VALUES('goal','{}','goal','goal','open',9999999999,1,1,1)", project.id),
            format!("INSERT INTO continuous_root_policies VALUES('goal','{policy}','test',1)"),
            "INSERT INTO continuous_tasks(id,goal_id,objective,owned_paths_json,dependencies_json,status,claim_owner,claim_fence,created_at,updated_at) VALUES('task-1','goal','task','[]','[]','running','worker-a',1,1,1)".into(),
        ] {
            sqlx::query(&sql).execute(&pool).await.unwrap();
        }
        let first = store
            .record_development_run_intent("task-1", "worker-a", 1)
            .await
            .unwrap()
            .id;
        (store, pool, first)
    });
    let backend = FakeBackend {
        native_store: Some(store.clone()),
        ..Default::default()
    };
    let server = boot(Arc::new(backend), &dir.path().join("api"), false).unwrap();
    let port = server.port();

    // The first run's agent checkpoints, then aborts.
    let old = server
        .issue_run_descriptor(&first, "worker-a", 1, 60)
        .unwrap();
    let file = dir.path().join("agent-descriptor.json");
    std::fs::write(&file, serde_json::to_string(&old).unwrap()).unwrap();
    let exit = crate::proc::command(std::env::current_exe().unwrap())
        .args(["--exact", CHILD, "--nocapture", "--test-threads=1"])
        .env(ENV_DESCRIPTOR, &file)
        .status()
        .unwrap();
    assert_eq!(exit.code(), Some(3), "the child must post (200) and abort");

    // Reconcile through the production lifecycle, then the task is reclaimed.
    tauri::async_runtime::block_on(async {
        store
            .mark_development_run_reconciling(&first, "worker-a", 1)
            .await
            .unwrap();
        store
            .fail_development_run(&first, "worker-a", 1, "agent exited with code 3")
            .await
            .unwrap();
        sqlx::query(
            "UPDATE continuous_tasks SET claim_owner='worker-b', claim_fence=2 WHERE id='task-1'",
        )
        .execute(&pool)
        .await
        .unwrap();
    });
    let second = tauri::async_runtime::block_on(
        store.record_development_run_intent("task-1", "worker-b", 2),
    )
    .unwrap()
    .id;
    let new = server
        .issue_run_descriptor(&second, "worker-b", 2, 60)
        .unwrap();
    let get = |path: &str| call(port, "GET", path, Some(&new.token), "");
    let post = |body: &str| call(port, "POST", CHECKPOINT, Some(&new.token), body);

    // The next run sees the prior run's checkpoint, by context and revision.
    let (status, context) = get("/api/hq/v1/agent/context");
    assert_eq!(status, 200, "{context}");
    let (status, by_revision) = get("/api/hq/v1/agent/checkpoint/1");
    assert_eq!(status, 200, "{by_revision}");
    assert_eq!(context["checkpoint"], by_revision);
    assert_eq!(by_revision["runId"], first.as_str());
    assert_eq!(by_revision["content"]["remaining"][0], "Finish task");
    assert_eq!(by_revision["trust"], "unverified-data");

    // It extends it once; an identical replay is unchanged, a changed one is
    // refused, and a stale expected revision is refused.
    let next = checkpoint("cp-2", 1, "Review");
    let (status, saved) = post(&next);
    assert_eq!((status, &saved["revision"]), (200, &json!(2)), "{saved}");
    assert_eq!(post(&next), (200, saved.clone()));
    assert_eq!(post(&checkpoint("cp-2", 1, "Changed")).0, 409);
    assert_eq!(post(&checkpoint("cp-3", 1, "Stale")).0, 409);
    assert_eq!(get("/api/hq/v1/agent/checkpoint/3").0, 404);
    assert_eq!(get("/api/hq/v1/agent/checkpoint/2").1, saved);

    // The old credential and fence can neither write nor read any more.
    let (status, _) = call(
        port,
        "POST",
        CHECKPOINT,
        Some(&old.token),
        &checkpoint("cp-4", 2, "Zombie"),
    );
    assert_ne!(status, 200);
    assert_ne!(
        call(
            port,
            "GET",
            "/api/hq/v1/agent/checkpoint/1",
            Some(&old.token),
            ""
        )
        .0,
        200
    );
    assert_eq!(
        get("/api/hq/v1/agent/checkpoint/3").0,
        404,
        "no zombie revision"
    );
}
