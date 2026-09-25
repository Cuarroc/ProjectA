use super::*;
use crate::testutil::TempDir;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn projects_share_capacity_across_races_restart_pause_and_expired_leases() {
    let dir = TempDir::new("continuous-global-capacity");
    let db = dir.path().join("projecta.db");
    let store = Store::open(&db).await.unwrap();
    let mut projects = Vec::new();
    let mut tasks = Vec::new();
    for i in 0..3 {
        let repo = dir.path().join(format!("repo-{i}"));
        std::fs::create_dir(&repo).unwrap();
        std::fs::write(
            repo.join(development_policy::POLICY_FILE),
            serde_json::to_vec(&DevelopmentPolicy::defaults()).unwrap(),
        )
        .unwrap();
        let project = store
            .create_project("P", repo.to_str().unwrap())
            .await
            .unwrap();
        sqlx::query("INSERT INTO continuous_projects VALUES(?, 'enabled', 0)")
            .bind(&project.id)
            .execute(&store.pool)
            .await
            .unwrap();
        let goal = store
            .create_continuous_goal(&project.id, "work", None, None, true)
            .await
            .unwrap();
        let task = store
            .create_continuous_task(&goal.id, "task", None, vec!["owned.rs".into()], vec![])
            .await
            .unwrap();
        projects.push(project.id);
        tasks.push(task.id);
    }
    let first = store
        .claim_continuous_task(&tasks[0], "first", false)
        .await
        .unwrap();
    let (a, b) = tokio::join!(
        store.claim_continuous_task(&tasks[1], "a", false),
        store.claim_continuous_task(&tasks[2], "b", false),
    );
    assert_eq!(
        usize::from(a.is_ok()) + usize::from(b.is_ok()),
        1,
        "two projects raced for one remaining host slot: {a:?}, {b:?}"
    );
    let loser = if a.is_err() { &tasks[1] } else { &tasks[2] };
    let denied = store.get_continuous_task(loser).await.unwrap().unwrap();
    assert_eq!(denied.attempts, 0);
    assert!(denied.claim.is_none());
    sqlx::query("UPDATE continuous_projects SET status='paused' WHERE project_id=?")
        .bind(&projects[0])
        .execute(&store.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE continuous_tasks SET lease_expires_at=1 WHERE id=?")
        .bind(&tasks[0])
        .execute(&store.pool)
        .await
        .unwrap();
    store.pool.close().await;
    let reopened = Store::open(&db).await.unwrap();
    assert!(reopened
        .claim_continuous_task(loser, "retry", false)
        .await
        .unwrap_err()
        .contains("capacity"));
    assert_eq!(
        reopened
            .get_continuous_task(loser)
            .await
            .unwrap()
            .unwrap()
            .attempts,
        0
    );
    // Only a resolved terminal transition releases the slot, never expiry/pause.
    reopened
        .checkpoint_continuous_task(&tasks[0], "first", first.fence, Some("completed"), None)
        .await
        .unwrap();
    reopened
        .claim_continuous_task(loser, "retry", false)
        .await
        .unwrap();
    let (running,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM continuous_tasks WHERE status='running'")
            .fetch_one(&reopened.pool)
            .await
            .unwrap();
    assert_eq!(running, 2);
}
