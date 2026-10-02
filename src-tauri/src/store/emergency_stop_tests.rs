use super::*;
use crate::testutil::TempDir;

async fn fixture() -> (TempDir, Store) {
    let dir = TempDir::new("emergency-stop");
    let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
    for id in ["a", "b"] {
        sqlx::query("INSERT INTO task_queue(id,project_id,raw_text,profile_id,status,priority,created_at) VALUES(?,?,'task','codex','ready',0,1)")
            .bind(id).bind(id).execute(&store.pool).await.unwrap();
    }
    (dir, store)
}

#[tokio::test]
async fn emergency_stop_blocks_dispatch_across_projects() {
    let (_dir, store) = fixture().await;
    sqlx::query("UPDATE emergency_stop SET active=1")
        .execute(&store.pool)
        .await
        .unwrap();
    for id in ["a", "b"] {
        assert!(store
            .claim_queue_entry(id)
            .await
            .unwrap_err()
            .contains("global emergency stop"));
        assert_eq!(
            store.get_queue_entry(id).await.unwrap().unwrap().status,
            QUEUE_READY
        );
    }
}

#[tokio::test]
async fn emergency_stop_blocks_an_inflight_dispatch_commit() {
    let (_dir, store) = fixture().await;
    assert!(store.claim_queue_entry("a").await.unwrap());
    sqlx::query("UPDATE emergency_stop SET active=1")
        .execute(&store.pool)
        .await
        .unwrap();
    assert!(store.mark_queue_dispatched("a", "worker", 4).await.is_err());
}

#[tokio::test]
async fn emergency_stop_missing_state_fails_closed() {
    let (_dir, store) = fixture().await;
    sqlx::query("DELETE FROM emergency_stop")
        .execute(&store.pool)
        .await
        .unwrap();
    assert!(store
        .claim_queue_entry("a")
        .await
        .unwrap_err()
        .contains("global emergency stop"));
    sqlx::query("DROP TABLE emergency_stop")
        .execute(&store.pool)
        .await
        .unwrap();
    assert!(store.claim_queue_entry("b").await.is_err());
}

#[tokio::test]
async fn emergency_stop_activation_moves_open_runs_to_reconciling() {
    let (_dir, store) = fixture().await;
    sqlx::query("INSERT INTO continuous_projects VALUES('p','disabled',1)")
        .execute(&store.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO continuous_goals(id,project_id,root_goal_id,objective,status,deadline_at,admitted,created_at,updated_at) VALUES('g','p','g','goal','open',9999999999,1,1,1)")
        .execute(&store.pool).await.unwrap();
    for (id, status) in [("r1", "intent"), ("r2", "launched"), ("r3", "failed")] {
        sqlx::query("INSERT INTO continuous_tasks(id,goal_id,objective,owned_paths_json,dependencies_json,status,claim_owner,claim_fence,created_at,updated_at) VALUES(?1,'g',?1,'[]','[]','running',?1,1,1,1)")
            .bind(id).execute(&store.pool).await.unwrap();
        sqlx::query("INSERT INTO development_runs(id,task_id,root_goal_id,claim_owner,claim_fence,policy_json,status,intent_at,created_at,updated_at) VALUES(?,?,'g','o',1,'{}',?,1,1,1)")
            .bind(id).bind(id).bind(status).execute(&store.pool).await.unwrap();
    }
    store.set_emergency_stop(true, "human").await.unwrap();
    assert!(store.emergency_stop_active().await.unwrap());
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT id,status FROM development_runs ORDER BY id")
            .fetch_all(&store.pool)
            .await
            .unwrap();
    assert_eq!(
        rows,
        vec![
            ("r1".into(), "reconciling".into()),
            ("r2".into(), "reconciling".into()),
            ("r3".into(), "failed".into())
        ]
    );
}
