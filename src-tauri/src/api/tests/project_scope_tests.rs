//! M4-R4-PROOF (acceptance row 4): goals, tasks, runs and records stay inside
//! the released project. Real router, real store, two projects: a credential
//! scoped to a run of project A is never shown anything of project B, and it
//! still reads its own project.
use super::*;

const COMMIT_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const COMMIT_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SECRETS: [&str; 3] = ["secret-goal-b", "secret-task-b", "project-b-id"];

struct Scope {
    server: ApiServer,
    pool: sqlx::SqlitePool,
    a: Descriptor,
    run_b: String,
    evidence_a: String,
    evidence_b: String,
    _dir: TempDir,
}

fn seed(dir: &TempDir, store: &crate::store::Store, pool: &sqlx::SqlitePool, tag: &str) -> String {
    let (project, objective) = if tag == "a" {
        ("project-a-id", "goal-a")
    } else {
        ("project-b-id", "secret-goal-b")
    };
    tauri::async_runtime::block_on(async {
        let policy =
            serde_json::to_string(&crate::development_policy::DevelopmentPolicy::defaults())
                .unwrap();
        let path = dir.path().join(tag).to_string_lossy().into_owned();
        let created = store.create_project(tag, &path).await.unwrap();
        for sql in [
            format!("UPDATE projects SET id='{project}' WHERE id='{}'", created.id),
            format!("INSERT INTO continuous_projects VALUES('{project}', 'enabled', 1)"),
            format!("INSERT INTO continuous_goals(id,project_id,root_goal_id,objective,status,deadline_at,admitted,created_at,updated_at) VALUES('goal-{tag}','{project}','goal-{tag}','{objective}','open',9999999999,1,1,1)"),
            format!("INSERT INTO continuous_root_policies VALUES('goal-{tag}','{policy}','test',1)"),
            format!("INSERT INTO continuous_tasks(id,goal_id,objective,owned_paths_json,dependencies_json,status,claim_owner,claim_fence,created_at,updated_at) VALUES('task-{tag}','goal-{tag}','{}','[]','[]','running','worker-{tag}',1,1,1)", if tag == "a" { "task-a" } else { "secret-task-b" }),
            format!("INSERT INTO continuous_team_assignments(task_id,team_id,role,assignee,revision,policy_version,observed_at) VALUES('task-{tag}','development','implementer','worker-{tag}',1,1,1)"),
        ] {
            sqlx::query(&sql).execute(pool).await.unwrap();
        }
    });
    project.into()
}

fn run_with_evidence(
    store: &crate::store::Store,
    tag: &str,
    commit: &str,
    run_label: &str,
    evidence_label: &str,
) -> (String, String) {
    use crate::store::development_runs::{EvidenceInput, EvidenceMeasurement};
    tauri::async_runtime::block_on(async {
        let run = store
            .record_development_run_intent(&format!("task-{tag}"), &format!("worker-{tag}"), 1)
            .await
            .unwrap()
            .id;
        let owner = format!("worker-{tag}");
        store
            .bind_development_run_candidate(&run, &owner, 1, commit, "git", 1)
            .await
            .unwrap();
        let evidence = store
            .record_development_evidence(
                &run,
                &owner,
                1,
                EvidenceInput {
                    idempotency_key: format!("{run_label}-{evidence_label}"),
                    source: "cargo".into(),
                    observed_at: 1,
                    candidate_commit: commit.into(),
                    measurement: EvidenceMeasurement::Unavailable {
                        reason: "not run".into(),
                    },
                    payload: json!({}),
                },
            )
            .await
            .unwrap()
            .id;
        (run, evidence)
    })
}

fn scope() -> Scope {
    let dir = TempDir::new("project-scope");
    let db = dir.path().join("projecta.db");
    let (store, pool) = tauri::async_runtime::block_on(async {
        let store = crate::store::Store::open(&db).await.unwrap();
        let pool = sqlx::SqlitePool::connect(&format!("sqlite:{}", db.display()))
            .await
            .unwrap();
        (store, pool)
    });
    seed(&dir, &store, &pool, "a");
    seed(&dir, &store, &pool, "b");
    let (run_a, evidence_a) = run_with_evidence(&store, "a", COMMIT_A, "ra", "ea");
    let (run_b, evidence_b) = run_with_evidence(&store, "b", COMMIT_B, "rb", "eb");
    assert_ne!(run_a, run_b);
    assert_eq!(
        count(
            &pool,
            "UPDATE continuous_team_assignments SET role='coordinator' WHERE task_id='task-a' RETURNING 1",
        ),
        1
    );
    let backend = FakeBackend {
        native_store: Some(store),
        ..Default::default()
    };
    let server = boot(Arc::new(backend), &dir.path().join("api"), false).unwrap();
    let a = server
        .issue_run_descriptor(&run_a, "worker-a", 1, 60)
        .unwrap();
    Scope {
        server,
        pool,
        a,
        run_b,
        evidence_a,
        evidence_b,
        _dir: dir,
    }
}

fn count(pool: &sqlx::SqlitePool, sql: &str) -> i64 {
    tauri::async_runtime::block_on(sqlx::query_scalar(sql).fetch_one(pool)).unwrap()
}

fn assert_no_leak(what: &str, body: &Value, extra: &[&str]) {
    let text = body.to_string();
    // The failure message names the marker's position, never its value or the body.
    for (index, secret) in SECRETS.iter().chain(extra).enumerate() {
        assert!(
            !text.contains(secret),
            "{what} leaked foreign marker #{index} ({} bytes)",
            secret.len()
        );
    }
}

#[test]
fn hq_context_changes_goals_records_of_a_foreign_project_leak_nothing() {
    let fx = scope();
    let _ = &fx.server;
    let goals_before = count(&fx.pool, "SELECT COUNT(*) FROM continuous_goals");
    let tasks_before = count(&fx.pool, "SELECT COUNT(*) FROM continuous_tasks");
    let get = |path: &str| call(fx.a.port, "GET", path, Some(&fx.a.token), "");
    let post = |path: &str, body: &str| call(fx.a.port, "POST", path, Some(&fx.a.token), body);

    // Project-wide reads: a run credential has none, whatever project it names.
    for path in [
        "/api/hq/v1/goals?projectId=project-b-id",
        "/api/hq/v1/runs?projectId=project-b-id",
        "/api/hq/v1/context?projectId=project-b-id",
        "/api/hq/v1/changes?projectId=project-b-id",
        "/api/hq/v1/goals",
        "/api/hq/v1/runs",
        "/api/hq/v1/tasks/task-b/assignment",
        "/api/hq/v1/runtime",
    ] {
        let (status, body) = get(path);
        assert_eq!(status, 403, "{path}: {body}");
        assert_no_leak(path, &body, &[&fx.run_b, &fx.evidence_b]);
    }
    // Every planning route must reach the real project-scope check, rather
    // than being refused earlier for an unrelated role or route reason.
    for (path, body) in [
        (
            "/api/hq/v1/plan/import",
            r#"{"projectId":"project-b-id","planId":"main","expectedProjectionRevision":0}"#,
        ),
        (
            "/api/hq/v1/goals",
            r#"{"projectId":"project-b-id","objective":"x"}"#,
        ),
        (
            "/api/hq/v1/goals/goal-b/tasks",
            r#"{"objective":"x","ownedPaths":[],"dependencies":[]}"#,
        ),
        (
            "/api/hq/v1/tasks/task-b/assignment",
            r#"{"teamId":"development","role":"implementer","assignee":"worker-b","expectedRevision":0,"policyVersion":1}"#,
        ),
    ] {
        let (status, reply) = post(path, body);
        assert_eq!(status, 403, "{path}: {reply}");
        assert_eq!(
            reply["error"], "planning target is outside the run project",
            "{path}: {reply}"
        );
        assert_no_leak(path, &reply, &[&fx.run_b, &fx.evidence_b]);
    }
    assert_eq!(
        count(&fx.pool, "SELECT COUNT(*) FROM continuous_goals"),
        goals_before
    );
    assert_eq!(
        count(&fx.pool, "SELECT COUNT(*) FROM continuous_tasks"),
        tasks_before
    );
    assert_eq!(
        count(
            &fx.pool,
            "SELECT COUNT(*) FROM continuous_projects WHERE status<>'enabled'"
        ),
        0
    );

    // Run-scoped records: B's evidence is unknown to A, A's pages hold only A's.
    let (status, body) = get(&format!("/api/hq/v1/agent/evidence/{}", fx.evidence_b));
    assert_eq!(status, 404, "{body}");
    assert_no_leak("foreign evidence", &body, &[&fx.run_b, &fx.evidence_b]);
    let (status, page) = get("/api/hq/v1/agent/records/evidence/start");
    assert_eq!(status, 200, "{page}");
    assert_no_leak("evidence page", &page, &[&fx.run_b, &fx.evidence_b]);
    assert!(page.to_string().contains(&fx.evidence_a), "{page}");
    let (status, page) = get("/api/hq/v1/agent/records/reviews/start");
    assert_eq!(status, 200, "{page}");
    assert_no_leak("review page", &page, &[&fx.run_b, &fx.evidence_b]);
}

#[test]
fn run_credential_reads_its_own_project_context_and_records() {
    let fx = scope();
    let get = |path: &str| call(fx.a.port, "GET", path, Some(&fx.a.token), "");
    let (status, context) = get("/api/hq/v1/agent/context");
    assert_eq!(status, 200, "{context}");
    assert!(context.to_string().contains("task-a"), "{context}");
    assert_no_leak("own context", &context, &[&fx.run_b, &fx.evidence_b]);
    let (status, own) = get(&format!("/api/hq/v1/agent/evidence/{}", fx.evidence_a));
    assert_eq!(status, 200, "{own}");
    assert_eq!(own["id"], fx.evidence_a.as_str());
    let (status, page) = get("/api/hq/v1/agent/records/evidence/start");
    assert_eq!(status, 200, "{page}");
    assert!(page.to_string().contains(&fx.evidence_a), "{page}");
}
