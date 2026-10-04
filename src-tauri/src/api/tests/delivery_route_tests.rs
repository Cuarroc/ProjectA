//! W1-03f-api: `POST /api/hq/v1/agent/delivery` on a real store; the body
use super::*;
use crate::workers::delivery_state::WorkerDelivery;

const PATH: &str = "/api/hq/v1/agent/delivery";

struct Route {
    server: ApiServer,
    run: String,
    store: crate::store::Store,
    pool: sqlx::SqlitePool,
    _dir: TempDir, // last: outlives the server and pool
}

/// One launched run (`worker-a`, fence 1) of a running task.
fn route(label: &str) -> Route {
    let dir = TempDir::new(label);
    let db = dir.path().join("projecta.db");
    tauri::async_runtime::block_on(async {
        let store = crate::store::Store::open(&db).await.unwrap();
        let pool = sqlx::SqlitePool::connect(&format!("sqlite:{}", db.display()))
            .await
            .unwrap();
        let project = store
            .create_project("delivery", &dir.path().join("p").to_string_lossy())
            .await
            .unwrap();
        let policy = crate::development_policy::DevelopmentPolicy::defaults();
        let policy = serde_json::to_string(&policy).unwrap();
        for sql in [
            format!("INSERT INTO continuous_projects VALUES('{}', 'enabled', 1)", project.id),
            format!("INSERT INTO continuous_goals(id,project_id,root_goal_id,objective,status,deadline_at,admitted,created_at,updated_at) VALUES('goal','{}','goal','goal','open',9999999999,1,1,1)", project.id),
            format!("INSERT INTO continuous_root_policies VALUES('goal','{policy}','test',1)"),
            "INSERT INTO continuous_tasks(id,goal_id,objective,owned_paths_json,dependencies_json,status,claim_owner,claim_fence,created_at,updated_at) VALUES('worker-a','goal','worker-a','[]','[]','running','worker-a',1,1,1)".into(),
        ] {
            sqlx::query(&sql).execute(&pool).await.unwrap();
        }
        let run = store
            .record_development_run_intent("worker-a", "worker-a", 1)
            .await
            .unwrap()
            .id;
        sqlx::query("UPDATE development_runs SET status='launched' WHERE id=?")
            .bind(&run)
            .execute(&pool)
            .await
            .unwrap();
        let backend = FakeBackend {
            native_store: Some(store.clone()),
            ..Default::default()
        };
        let server = boot(Arc::new(backend), &dir.path().join("api"), false).unwrap();
        Route {
            server,
            run,
            store,
            pool,
            _dir: dir,
        }
    })
}

#[test]
fn concurrent_identical_deliveries_mark_exactly_one_as_repeated() {
    let fx = route("delivery-route-concurrent-repeat");
    let mut writer = tauri::async_runtime::block_on(fx.pool.acquire()).unwrap();
    tauri::async_runtime::block_on(sqlx::query("BEGIN IMMEDIATE").execute(&mut *writer)).unwrap();
    let (first_store, second_store) = (fx.store.clone(), fx.store.clone());
    let (first, second, ()) = tauri::async_runtime::block_on(async move {
        tokio::join!(
            record_delivery_receipt(&first_store, &fx.run, "worker-a", 1, WorkerDelivery::Done),
            record_delivery_receipt(&second_store, &fx.run, "worker-a", 1, WorkerDelivery::Done),
            async move {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                sqlx::query("COMMIT").execute(&mut *writer).await.unwrap();
            }
        )
    });
    assert_ne!(first.unwrap().1, second.unwrap().1);
}

impl Route {
    fn post(&self, run: &str, owner: &str, fence: i64, body: &str) -> (u16, Value) {
        let token = self
            .server
            .issue_run_descriptor(run, owner, fence, 60)
            .unwrap()
            .token;
        call(self.server.port(), "POST", PATH, Some(&token), body)
    }

    fn status(&self) -> String {
        tauri::async_runtime::block_on(
            sqlx::query_scalar("SELECT status FROM development_runs WHERE id=?")
                .bind(&self.run)
                .fetch_one(&self.pool),
        )
        .unwrap()
    }
}

#[test]
fn delivery_done_records_once_and_answers_the_repeat_as_such() {
    let fx = route("delivery-route-twice");
    let (status, first) = fx.post(&fx.run, "worker-a", 1, r#"{"outcome":"done"}"#);
    assert_eq!(
        (status, fx.status().as_str()),
        (200, "completed"),
        "{first}"
    );
    let (status, second) = fx.post(&fx.run, "worker-a", 1, r#"{"outcome":"done"}"#);
    assert_eq!(status, 200, "{second}");
    assert_eq!(first["repeated"], false);
    assert_eq!(second["repeated"], true);
    assert_eq!(second["run"], first["run"]);
}

#[test]
fn delivery_blocked_keeps_its_reason() {
    let fx = route("delivery-route-blocked");
    let body = r#"{"outcome":"blocked","reason":"needs the api lane"}"#;
    let (status, reply) = fx.post(&fx.run, "worker-a", 1, body);
    assert_eq!(status, 200, "{reply}");
    assert_eq!(reply["status"], "failed");
    assert_eq!(reply["run"]["terminalDetail"], "needs the api lane");
}

#[test]
fn no_credential_exists_for_another_owner_or_an_unknown_run() {
    let fx = route("delivery-route-wrong-run");
    for (run, owner) in [
        (fx.run.as_str(), "intruder"),
        ("run-does-not-exist", "worker-a"),
    ] {
        assert!(fx.server.issue_run_descriptor(run, owner, 1, 60).is_err());
    }
    assert_eq!(fx.status(), "launched");
}

#[test]
fn delivery_with_a_stale_fence_is_refused_without_state_change() {
    let fx = route("delivery-route-stale-fence");
    let token = fx
        .server
        .issue_run_descriptor(&fx.run, "worker-a", 1, 60)
        .unwrap()
        .token;
    let moved = sqlx::query("UPDATE continuous_tasks SET claim_fence=2").execute(&fx.pool);
    tauri::async_runtime::block_on(moved).unwrap();
    let body = r#"{"outcome":"done"}"#;
    let (status, reply) = call(fx.server.port(), "POST", PATH, Some(&token), body);
    assert_eq!(status, 403, "{reply}");
    assert_eq!(fx.status(), "launched");
}

#[test]
fn delivery_blocked_without_a_reason_is_a_bad_request() {
    let fx = route("delivery-route-no-reason");
    for body in [
        r#"{"outcome":"blocked"}"#,
        r#"{"outcome":"blocked","reason":"  "}"#,
        r#"{"outcome":"done","reason":"why"}"#,
        r#"{"outcome":"finished"}"#,
        r#"{"outcome":"done","runId":"other"}"#,
    ] {
        let (status, reply) = fx.post(&fx.run, "worker-a", 1, body);
        assert_eq!(status, 400, "{body}: {reply}");
        assert_eq!(fx.status(), "launched");
    }
}

#[test]
fn a_different_second_outcome_conflicts_and_keeps_the_first() {
    let fx = route("delivery-route-conflict");
    fx.post(&fx.run, "worker-a", 1, r#"{"outcome":"done"}"#);
    let (status, reply) = fx.post(
        &fx.run,
        "worker-a",
        1,
        r#"{"outcome":"blocked","reason":"late"}"#,
    );
    assert_eq!(status, 409, "{reply}");
    assert_eq!(fx.status(), "completed");
}
