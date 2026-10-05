//! M4-ROW3-A (acceptance row 3): `resume` stays closed in v1.5.0 whatever the
//! caller presents, on a real store, and a refused resume writes nothing.
use super::*;

const CONTROL: &str = "/api/hq/v1/control";
const REFUSAL: &str = "continuous runtime adapters are unattested; resume is fail-closed";

/// Control row, journal, claims, runs and launches as one comparable string.
async fn state(pool: &sqlx::SqlitePool) -> String {
    let mut out = Vec::new();
    for sql in [
        "SELECT project_id||'|'||status||'|'||updated_at FROM continuous_projects",
        "SELECT cursor||'|'||kind||'|'||detail FROM continuous_events ORDER BY cursor",
        "SELECT id||'|'||status||'|'||ifnull(claim_owner,'')||'|'||ifnull(claim_fence,'')||'|'||attempts FROM continuous_tasks ORDER BY id",
        "SELECT id||'|'||status FROM development_runs ORDER BY id",
        "SELECT run_id||'|'||state||'|'||reserved_at FROM development_launches ORDER BY run_id",
    ] {
        let rows: Vec<(String,)> = sqlx::query_as(sql).fetch_all(pool).await.unwrap();
        out.push(rows.into_iter().map(|r| r.0).collect::<Vec<_>>().join(";"));
    }
    out.join("\n")
}

/// The real context: the journal cursor and the runtime capabilities.
fn context(store: &crate::store::Store, project: &str) -> (i64, Value, String) {
    let ctx = tauri::async_runtime::block_on(store.continuous_context(project, 0)).unwrap();
    (ctx.cursor, ctx.effective_limits, ctx.control.status)
}

fn serve(store: &crate::store::Store, dir: &Path) -> ApiServer {
    let backend = FakeBackend {
        native_store: Some(store.clone()),
        ..Default::default()
    };
    boot(Arc::new(backend), dir, false).unwrap()
}

fn assert_closed(server: &ApiServer, body: &str) {
    let port = server.port();
    let api = std::fs::read_to_string(server.descriptor_path()).unwrap();
    let api: Value = serde_json::from_str(&api).unwrap();
    let api = api["token"].as_str().unwrap();
    assert_eq!(call(port, "POST", CONTROL, None, body).0, 401);
    assert_eq!(
        call_with(
            port,
            "POST",
            CONTROL,
            None,
            Some(server.verdict_token()),
            body
        )
        .0,
        401
    );
    for verdict in [None, Some("wrong-verdict"), Some(server.verdict_token())] {
        let (status, reply) = call_with(port, "POST", CONTROL, Some(api), verdict, body);
        assert_eq!(status, 409, "{verdict:?}: {reply}");
        assert_eq!(reply["error"], REFUSAL);
    }
}

#[test]
fn resume_remains_closed_for_every_verdict_and_preserves_runtime_state() {
    let dir = TempDir::new("resume-closed");
    let db = dir.path().join("projecta.db");
    let (store, pool, project) = tauri::async_runtime::block_on(async {
        let store = crate::store::Store::open(&db).await.unwrap();
        let pool = sqlx::SqlitePool::connect(&format!("sqlite:{}", db.display()))
            .await
            .unwrap();
        let p = store
            .create_project("row3", &dir.path().join("p").to_string_lossy())
            .await
            .unwrap()
            .id;
        let policy =
            serde_json::to_string(&crate::development_policy::DevelopmentPolicy::defaults())
                .unwrap();
        for sql in [
            format!("INSERT INTO continuous_projects VALUES('{p}', 'paused', 1)"),
            format!("INSERT INTO continuous_goals(id,project_id,root_goal_id,objective,status,deadline_at,admitted,created_at,updated_at) VALUES('goal','{p}','goal','goal','open',9999999999,1,1,1)"),
            format!("INSERT INTO continuous_root_policies VALUES('goal','{policy}','test',1)"),
            "INSERT INTO continuous_tasks(id,goal_id,objective,owned_paths_json,dependencies_json,status,claim_owner,claim_fence,created_at,updated_at) VALUES('task-1','goal','task','[]','[]','running','worker-a',1,1,1)".into(),
        ] {
            sqlx::query(&sql).execute(&pool).await.unwrap();
        }
        let run = store
            .record_development_run_intent("task-1", "worker-a", 1)
            .await
            .unwrap()
            .id;
        sqlx::query("INSERT INTO development_launches(run_id,worker_id,project_id,profile_id,repo_path,worktree_path,branch,state,reserved_at) VALUES(?1,'wk-1',?2,'claude','/r','/w','b','reserved',1)")
            .bind(run).bind(&p).execute(&pool).await.unwrap();
        (store, pool, p)
    });
    let before = tauri::async_runtime::block_on(state(&pool));
    let (cursor, limits, control) = context(&store, &project);
    assert_eq!(control, "paused");
    assert_eq!(limits["continuousScheduler"], false);
    assert_eq!(limits["launchIntent"], false);
    let body = json!({"projectId": project, "action": "resume"}).to_string();

    let server = serve(&store, &dir.path().join("api"));
    assert_closed(&server, &body);
    assert_eq!(
        tauri::async_runtime::block_on(store.control_continuous(&project, "resume")),
        Err(REFUSAL.to_string())
    );
    assert_eq!(tauri::async_runtime::block_on(state(&pool)), before);
    assert_eq!(
        context(&store, &project),
        (cursor, limits.clone(), control.clone())
    );
    drop(server);

    // Reopen the database and serve it again: still closed, still unchanged.
    let reopened = tauri::async_runtime::block_on(crate::store::Store::open(&db)).unwrap();
    let server = serve(&reopened, &dir.path().join("api2"));
    assert_closed(&server, &body);
    assert_eq!(tauri::async_runtime::block_on(state(&pool)), before);
    assert_eq!(context(&reopened, &project), (cursor, limits, control));
}
