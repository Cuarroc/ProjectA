use super::*;
use crate::testutil::TempDir;

async fn fixture() -> (TempDir, Store) {
    let dir = TempDir::new("emergency-stop");
    let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
    // Supply the state on the old schema too: red-first must exercise the
    // dispatch barrier, rather than fail because a new Rust API is absent.
    sqlx::query("CREATE TABLE IF NOT EXISTS emergency_stop (id INTEGER PRIMARY KEY CHECK(id=1), active INTEGER NOT NULL CHECK(active IN (0,1)))")
        .execute(&store.pool).await.unwrap();
    sqlx::query("INSERT OR IGNORE INTO emergency_stop VALUES(1,0)")
        .execute(&store.pool)
        .await
        .unwrap();
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
        assert!(!store.claim_queue_entry(id).await.unwrap_or(false));
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
    assert!(!store.claim_queue_entry("a").await.unwrap_or(false));
    sqlx::query("DROP TABLE emergency_stop")
        .execute(&store.pool)
        .await
        .unwrap();
    assert!(store.claim_queue_entry("b").await.is_err());
}
