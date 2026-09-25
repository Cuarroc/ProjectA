//! W2-04f: planning writes through a scoped run credential need the
//! coordinator dispatch role. Worker, reviewer and unresolved roles are
//! refused before the backend is asked to plan anything; the operator token
//! is not a dispatch credential and keeps planning as before.
use super::*;
use crate::store::development_launches::DispatchRole;

/// The four planning writes: `(path, body, what the fake records)`.
const PLANNING: [(&str, &str, &str); 4] = [
    (
        "/api/hq/v1/plan/import",
        r#"{"projectId":"pj-1","planId":"plan-1","expectedProjectionRevision":0}"#,
        "import:pj-1",
    ),
    (
        "/api/hq/v1/goals",
        r#"{"projectId":"pj-1","objective":"Plan the next slice"}"#,
        "goal:pj-1",
    ),
    (
        "/api/hq/v1/goals/cg-1/tasks",
        r#"{"objective":"First step","ownedPaths":["src/"],"dependencies":[]}"#,
        "task:cg-1",
    ),
    (
        "/api/hq/v1/tasks/ct-1/assignment",
        r#"{"teamId":"development","role":"implementer","assignee":"worker-b","expectedRevision":0}"#,
        "assign:ct-1",
    ),
];

/// A server whose one run (`run-a`, `worker-a`, fence 7) dispatches as
/// `role`, and a live scoped credential for it.
fn role_fixture(label: &str, role: Option<Result<DispatchRole, String>>) -> (Fixture, Descriptor) {
    let dir = TempDir::new(label);
    let backend = Arc::new(FakeBackend {
        dispatch_role: role,
        ..Default::default()
    });
    let server = boot(
        Arc::clone(&backend) as Arc<dyn ControlBackend>,
        dir.path(),
        false,
    )
    .expect("start api");
    let descriptor = server
        .issue_run_descriptor("run-a", "worker-a", 7, 60)
        .expect("scoped credential");
    (
        Fixture {
            _dir: dir,
            server,
            backend,
        },
        descriptor,
    )
}

/// Everything that reached the planning side of the backend.
fn planned(fx: &Fixture) -> Vec<String> {
    let mut all = fx.backend.planned.lock().unwrap().clone();
    all.extend(
        fx.backend
            .plan_imports
            .lock()
            .unwrap()
            .iter()
            .map(|(project, ..)| format!("import:{project}")),
    );
    all
}

/// Every planning route answers 403 naming the coordinator requirement and
/// `expected`, and nothing reaches the backend.
fn assert_refused_everywhere(
    label: &str,
    role: Option<Result<DispatchRole, String>>,
    expected: &str,
) {
    let (fx, descriptor) = role_fixture(label, role);
    for (path, body, _) in PLANNING {
        let (status, reply) = call(descriptor.port, "POST", path, Some(&descriptor.token), body);
        assert_eq!(status, 403, "{path}: {reply}");
        let error = reply["error"].as_str().unwrap_or_default();
        assert!(
            error.contains("coordinator dispatch role"),
            "{path}: {error}"
        );
        assert!(error.contains(expected), "{path}: {error}");
    }
    assert_eq!(planned(&fx), Vec::<String>::new());
}

#[test]
fn coordinator_run_credential_may_use_every_planning_route() {
    let (fx, descriptor) = role_fixture("w2-04f-coordinator", Some(Ok(DispatchRole::Coordinator)));
    for (path, body, record) in PLANNING {
        let (status, reply) = call(descriptor.port, "POST", path, Some(&descriptor.token), body);
        assert_eq!(status, 200, "{path}: {reply}");
        assert!(
            planned(&fx).iter().any(|entry| entry == record),
            "{path} did not reach the backend: {:?}",
            planned(&fx)
        );
    }
}

#[test]
fn implementer_run_credential_is_refused_on_every_planning_route() {
    assert_refused_everywhere(
        "w2-04f-implementer",
        Some(Ok(DispatchRole::Implementer)),
        "dispatches as implementer",
    );
}

#[test]
fn integrator_run_credential_is_refused_on_every_planning_route() {
    assert_refused_everywhere(
        "w2-04f-integrator",
        Some(Ok(DispatchRole::Integrator)),
        "dispatches as integrator",
    );
}

#[test]
fn reviewer_run_credential_is_refused_on_every_planning_route() {
    assert_refused_everywhere(
        "w2-04f-reviewer",
        Some(Ok(DispatchRole::Reviewer)),
        "dispatches as reviewer",
    );
}

#[test]
fn run_credential_without_a_resolvable_role_is_refused_on_every_planning_route() {
    assert_refused_everywhere(
        "w2-04f-unresolved",
        Some(Err("malformed team assignment row".into())),
        "unresolved: malformed team assignment row",
    );
    // A backend that cannot answer at all is no coordinator either.
    assert_refused_everywhere("w2-04f-silent", None, "unresolved");
}

#[test]
fn coordinator_cannot_admit_a_new_autonomous_root() {
    let (fx, descriptor) = role_fixture("w2-04f-admit", Some(Ok(DispatchRole::Coordinator)));
    // A blank or null sourceGoalId is no source to the route either.
    for body in [
        r#"{"projectId":"pj-1","objective":"New root","admit":true}"#,
        r#"{"projectId":"pj-1","objective":"New root","admit":true,"sourceGoalId":""}"#,
        r#"{"projectId":"pj-1","objective":"New root","admit":true,"sourceGoalId":"  "}"#,
        r#"{"projectId":"pj-1","objective":"New root","admit":true,"sourceGoalId":null}"#,
    ] {
        let (status, reply) = call(
            descriptor.port,
            "POST",
            "/api/hq/v1/goals",
            Some(&descriptor.token),
            body,
        );
        assert_eq!(status, 403, "{body}: {reply}");
        let error = reply["error"].as_str().unwrap_or_default();
        assert!(error.contains("operator"), "{body}: {error}");
        // Review pr135 K1: the gate checks that a source exists, not that it
        // lies in the coordinator's own root, so it must not claim that.
        assert!(!error.contains("inside its root"), "{body}: {error}");
        assert!(
            error.contains("replans of an existing goal"),
            "{body}: {error}"
        );
    }
    assert_eq!(planned(&fx), Vec::<String>::new());
    // A replan inside an admitted root spends that root's budget, not a new one.
    let (status, reply) = call(
        descriptor.port,
        "POST",
        "/api/hq/v1/goals",
        Some(&descriptor.token),
        r#"{"projectId":"pj-1","objective":"Replan","sourceGoalId":"cg-root","admit":true}"#,
    );
    assert_eq!(status, 200, "{reply}");
    assert_eq!(planned(&fx), vec!["goal:pj-1".to_string()]);
}

#[test]
fn coordinator_planning_keeps_the_run_credential_limits() {
    let (fx, descriptor) = role_fixture("w2-04f-limits", Some(Ok(DispatchRole::Coordinator)));
    let (_, body, _) = PLANNING[1];
    let (status, reply) = call_with(
        descriptor.port,
        "POST",
        "/api/hq/v1/goals",
        Some(&descriptor.token),
        Some("anything"),
        body,
    );
    assert_eq!(status, 403, "{reply}");
    let (status, reply) = call(
        descriptor.port,
        "POST",
        "/api/hq/v1/goals?projectId=pj-2",
        Some(&descriptor.token),
        body,
    );
    assert_eq!(status, 403, "{reply}");
    assert_eq!(planned(&fx), Vec::<String>::new());
    // Reads and other writes stay outside a run credential, coordinator or not.
    for (method, path) in [
        ("GET", "/api/hq/v1/goals?projectId=pj-1"),
        ("POST", "/api/hq/v1/control"),
        ("POST", "/api/queue"),
    ] {
        let (status, reply) = call(descriptor.port, method, path, Some(&descriptor.token), "{}");
        assert_eq!(status, 403, "{method} {path}: {reply}");
    }
}

/// Review pr135 G2/K2: a coordinator may assign work, but not mint another
/// coordinator; the store trims the role, so the gate does too.
#[test]
fn coordinator_cannot_assign_the_coordinator_role() {
    let (fx, descriptor) = role_fixture("w2-04f-mint", Some(Ok(DispatchRole::Coordinator)));
    for role in ["coordinator", "  coordinator "] {
        let body =
            json!({"teamId":"development","role":role,"assignee":"worker-b","expectedRevision":0});
        let (status, reply) = call(
            descriptor.port,
            "POST",
            "/api/hq/v1/tasks/ct-1/assignment",
            Some(&descriptor.token),
            &body.to_string(),
        );
        assert_eq!(status, 403, "{role:?}: {reply}");
        let error = reply["error"].as_str().unwrap_or_default();
        assert!(error.contains("operator"), "{role:?}: {error}");
    }
    assert_eq!(planned(&fx), Vec::<String>::new());
    let (status, reply) = call(
        fx.server.port(),
        "POST",
        "/api/hq/v1/tasks/ct-1/assignment",
        Some(&fx.token()),
        r#"{"teamId":"development","role":"coordinator","assignee":"worker-b","expectedRevision":0}"#,
    );
    assert_eq!(
        status, 200,
        "operator keeps the coordinator assignment: {reply}"
    );
    assert_eq!(planned(&fx), vec!["assign:ct-1".to_string()]);
}

/// Review pr135 G1: plan import takes no plan content from the request (the
/// source is the repository file), so a coordinator cannot smuggle goals in.
#[test]
fn plan_import_carries_no_goals_from_the_request() {
    let (fx, descriptor) = role_fixture("w2-04f-import", Some(Ok(DispatchRole::Coordinator)));
    let (status, reply) = call(
        descriptor.port,
        "POST",
        "/api/hq/v1/plan/import",
        Some(&descriptor.token),
        r#"{"projectId":"pj-1","planId":"plan-1","expectedProjectionRevision":0,"goals":[{"objective":"root","admit":true}]}"#,
    );
    assert_eq!(status, 400, "{reply}");
    assert_eq!(planned(&fx), Vec::<String>::new());
}

#[test]
fn operator_token_planning_is_unchanged() {
    let (fx, _) = role_fixture("w2-04f-operator", None);
    let token = fx.token();
    for (path, body, record) in PLANNING {
        let (status, reply) = call(fx.server.port(), "POST", path, Some(&token), body);
        assert_eq!(status, 200, "{path}: {reply}");
        assert!(planned(&fx).iter().any(|entry| entry == record), "{path}");
    }
}

/// The role comes from the store's W2-04 resolution of each run, not from
/// the fake: one coordinator, three non-coordinators and one assignment the
/// frozen root policy does not permit.
#[test]
fn store_resolved_roles_decide_planning_access() {
    let dir = TempDir::new("w2-04f-store");
    let db = dir.path().join("projecta.db");
    let (store, runs, pool) = tauri::async_runtime::block_on(async {
        let store = crate::store::Store::open(&db).await.unwrap();
        let pool = sqlx::SqlitePool::connect(&format!("sqlite:{}", db.display()))
            .await
            .unwrap();
        let project = store
            .create_project("plan", &dir.path().join("plan").to_string_lossy())
            .await
            .unwrap();
        sqlx::query("INSERT INTO continuous_projects VALUES(?, 'enabled', 1)")
            .bind(&project.id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO continuous_goals(id,project_id,root_goal_id,objective,status,deadline_at,admitted,created_at,updated_at) VALUES('goal',?1,'goal','goal','open',9999999999,1,1,1)")
            .bind(&project.id).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO continuous_root_policies VALUES('goal',?,'test',1)")
            .bind(
                serde_json::to_string(&crate::development_policy::DevelopmentPolicy::defaults())
                    .unwrap(),
            )
            .execute(&pool)
            .await
            .unwrap();
        let mut runs = Vec::new();
        for owner in [
            "coordinator",
            "implementer",
            "reviewer",
            "integrator",
            "ghost",
        ] {
            sqlx::query("INSERT INTO continuous_tasks(id,goal_id,objective,owned_paths_json,dependencies_json,status,claim_owner,claim_fence,created_at,updated_at) VALUES(?1,'goal',?1,'[]','[]','running',?1,1,1,1)")
                .bind(owner).execute(&pool).await.unwrap();
            runs.push((
                owner,
                store
                    .record_development_run_intent(owner, owner, 1)
                    .await
                    .unwrap()
                    .id,
            ));
        }
        // `implementer` stays unassigned and dispatches as implementer (W2-04);
        // `ghost` names a team the frozen root policy does not have.
        for (task, team, role) in [
            ("coordinator", "development", "coordinator"),
            ("reviewer", "development", "reviewer"),
            ("integrator", "development", "integrator"),
            ("ghost", "nosuchteam", "coordinator"),
        ] {
            sqlx::query("INSERT INTO continuous_team_assignments(task_id,team_id,role,assignee,revision,policy_version,observed_at) VALUES(?1,?2,?3,?1,1,1,1)")
                .bind(task).bind(team).bind(role).execute(&pool).await.unwrap();
        }
        (store, runs, pool)
    });
    let backend = Arc::new(FakeBackend {
        native_store: Some(store),
        ..Default::default()
    });
    let server = boot(
        Arc::clone(&backend) as Arc<dyn ControlBackend>,
        dir.path(),
        false,
    )
    .expect("start api");
    let (_, body, _) = PLANNING[1];
    for (owner, run) in &runs {
        let descriptor = server
            .issue_run_descriptor(run, owner, 1, 60)
            .expect("scoped credential");
        let (status, reply) = call(
            descriptor.port,
            "POST",
            "/api/hq/v1/goals",
            Some(&descriptor.token),
            body,
        );
        let error = reply["error"].as_str().unwrap_or_default().to_string();
        match *owner {
            "coordinator" => assert_eq!(status, 200, "{owner}: {reply}"),
            "ghost" => {
                assert_eq!(status, 403, "{owner}: {reply}");
                assert!(error.contains("unresolved"), "{owner}: {error}");
                assert!(error.contains("frozen root policy"), "{owner}: {error}");
            }
            role => {
                assert_eq!(status, 403, "{owner}: {reply}");
                assert!(
                    error.contains(&format!("dispatches as {role}")),
                    "{owner}: {error}"
                );
            }
        }
    }
    assert_eq!(
        *backend.planned.lock().unwrap(),
        vec!["goal:pj-1".to_string()]
    );

    // Review pr135 K4: the role is resolved per request, and authority comes
    // first. Rows are rewritten out of band to simulate drift.
    let (owner, run) = &runs[0];
    let descriptor = server
        .issue_run_descriptor(run, owner, 1, 60)
        .expect("scoped credential");
    let sql = |statement: &'static str| {
        tauri::async_runtime::block_on(sqlx::query(statement).execute(&pool)).unwrap();
    };
    let post = || {
        call(
            descriptor.port,
            "POST",
            "/api/hq/v1/goals",
            Some(&descriptor.token),
            body,
        )
    };
    sql("UPDATE continuous_team_assignments SET role='reviewer' WHERE task_id='coordinator'");
    let (status, reply) = post();
    assert_eq!(status, 403, "{reply}");
    assert!(
        reply["error"]
            .as_str()
            .unwrap_or_default()
            .contains("dispatches as reviewer"),
        "{reply}"
    );
    sql("UPDATE continuous_team_assignments SET role='coordinator' WHERE task_id='coordinator'");
    assert_eq!(post().0, 200);
    // A stale fence: the lease moved on, so nothing is planned under it.
    sql("UPDATE continuous_tasks SET claim_fence=2 WHERE id='coordinator'");
    let (status, reply) = post();
    assert_eq!(status, 403, "{reply}");
    assert!(
        reply["error"]
            .as_str()
            .unwrap_or_default()
            .contains("unresolved"),
        "{reply}"
    );
    assert_eq!(backend.planned.lock().unwrap().len(), 2);
}
