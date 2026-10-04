use super::*;
use crate::testutil::TempDir;
use std::time::Duration;

#[tokio::test]
async fn maintenance_refuses_writes_without_losing_data() {
    let dir = TempDir::new("maintenance-write");
    let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
    let before = store.create_project("before", "/before").await.unwrap();
    let clone = store.clone();

    store.enter_maintenance().await.unwrap();
    assert!(store.is_maintenance_active());
    assert!(clone.is_maintenance_active());
    assert_eq!(
        clone.enter_maintenance().await,
        Err(MaintenanceError::AlreadyActive)
    );

    let refused = tokio::time::timeout(
        Duration::from_secs(7),
        clone.create_project("refused", "/refused"),
    )
    .await
    .expect("maintenance must bound the writer wait")
    .expect_err("maintenance must refuse a new write");
    assert!(refused.contains("database is locked"), "{refused}");
    assert_eq!(store.list_projects().await.unwrap(), vec![before]);

    clone.leave_maintenance().await.unwrap();
    assert!(!store.is_maintenance_active());
    assert_eq!(
        store.leave_maintenance().await,
        Err(MaintenanceError::NotActive)
    );
    store.create_project("after", "/after").await.unwrap();
    assert_eq!(store.list_projects().await.unwrap().len(), 2);
}
