use super::*;
use crate::process_capture::checkpoints::Gate;
use crate::store::development_launches::tests::{bind_test_route, fixture};
use crate::testutil::TempDir;
use std::sync::mpsc;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn populated_schema17_upgrade_preserves_delivery_without_fabricating_native_proof() {
    let (dir, store, binding, _launch) = ready().await;
    for statement in [
        "DROP TABLE development_identity_observations",
        "DROP TABLE development_execution_identities",
        "DROP TABLE development_plan_revisions",
        "DROP TABLE development_plans",
        "DROP TABLE development_capture_results",
        "DROP TABLE development_capture_checkpoints",
        "DROP TABLE development_capture_owners",
        "PRAGMA user_version=17",
    ] {
        sqlx::query(statement).execute(&store.pool).await.unwrap();
    }
    store.pool.close().await;
    let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
    let delivery = reopened
        .development_delivery(&binding.run_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(delivery.process_instance, binding.process_instance);
    assert_eq!(delivery.route_sha256, binding.route_sha256);
    assert_eq!(delivery.state, "started");
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM development_capture_owners")
        .fetch_one(&reopened.pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn waiting_checkpoint_rechecks_expiry_and_close_after_acquiring_sqlite_writer() {
    for mutation in [
        "UPDATE development_capture_owners SET deadline_ms=0",
        "UPDATE development_capture_owners SET state='closed'",
    ] {
        let (_dir, store, binding, launch) = ready().await;
        let owner = store
            .reserve_native_capture_owner(binding, launch, "owner", 1)
            .await
            .unwrap();
        let (pending, _gate) = request(&owner.binding, Stage::Launch, launch_payload(&owner));
        let mut blocker = store.pool.begin().await.unwrap();
        sqlx::query("UPDATE development_capture_owners SET next_stage=next_stage")
            .execute(&mut *blocker)
            .await
            .unwrap();
        let write = store.persist_native_checkpoint(&owner, &pending);
        let fence = async {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            sqlx::query(mutation).execute(&mut *blocker).await.unwrap();
            blocker.commit().await.unwrap();
        };
        let (result, ()) = tokio::join!(write, fence);
        assert!(
            result
                .unwrap_err()
                .contains("stale, closed, expired or out of order"),
            "{mutation}"
        );
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM development_capture_checkpoints")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn native_checkpoint_rejects_foreign_response_binding_before_any_write() {
    let (_dir, store, binding, launch) = ready().await;
    let owner = store
        .reserve_native_capture_owner(binding, launch, "owner", 1)
        .await
        .unwrap();
    for field in [
        "runId",
        "sessionId",
        "processInstance",
        "routeSha256",
        "capability",
    ] {
        let mut foreign = serde_json::to_value(&owner.binding).unwrap();
        foreign[field] = json!("wrong");
        let foreign = serde_json::from_value(foreign).unwrap();
        let (pending, _gate) = request(&foreign, Stage::Launch, launch_payload(&owner));
        assert!(store
            .persist_native_checkpoint(&owner, &pending)
            .await
            .unwrap_err()
            .contains("binding mismatch"));
    }
    accept(&store, &owner, Stage::Launch, launch_payload(&owner)).await;
}

pub(super) async fn ready() -> (TempDir, Store, Binding, Launch) {
    let (dir, store, run) = fixture().await;
    let reservation = store
        .reserve_development_launch(&run, "owner", 1, "codex")
        .await
        .unwrap();
    bind_test_route(&store, &run).await;
    store
        .consume_development_launch(&run, "owner", 1, &reservation.worker_id, "session")
        .await
        .unwrap();
    let delivery = store
        .begin_development_delivery(&run, "owner", 1, "session", b"task")
        .await
        .unwrap();
    let binding = Binding {
        run_id: run,
        session_id: delivery.session_id,
        process_instance: delivery.process_instance,
        capability: "e".repeat(64),
        route_sha256: delivery.route_sha256,
    };
    let launch = Launch {
        executable: "fixture.exe".into(),
        executable_sha256: "a".repeat(64),
        args: vec!["private-argument".into()],
        cwd: "fixture".into(),
        environment: vec![],
        input_bytes: 4,
        input_sha256: delivery.input_sha256,
        output_limit: 1000,
        timeout_ms: 20000,
    };
    (dir, store, binding, launch)
}

fn request(binding: &Binding, stage: Stage, payload: Value) -> (Request, Gate) {
    let (tx, rx) = mpsc::sync_channel(4);
    let mut gate = Gate::new(binding.clone(), Some(tx));
    for earlier in [Stage::Launch, Stage::Process, Stage::Input, Stage::Receipt] {
        if earlier == stage {
            break;
        }
        gate.submit(earlier, Value::Null).unwrap();
        rx.recv().unwrap().acknowledge(Ok(())).unwrap();
        gate.poll().unwrap();
    }
    gate.submit(stage, payload).unwrap();
    (rx.recv().unwrap(), gate)
}
pub(super) fn launch_payload(owner: &CaptureOwner) -> Value {
    json!({"launchSha256":owner.launch_sha256,"inputBytes":4,"inputSha256":owner.launch.input_sha256})
}
pub(super) fn identity(state: &str) -> Value {
    json!({"schemaVersion":1,"processId":42,"createdFiletime":"123456","volumeSerial":0,"fileIndex":"456",
        "imageSize":100,"imageSha256":"a".repeat(64),"state":state})
}
pub(super) async fn accept(store: &Store, owner: &CaptureOwner, stage: Stage, payload: Value) {
    let (request, mut gate) = request(&owner.binding, stage, payload);
    store
        .acknowledge_native_checkpoint(owner, request)
        .await
        .unwrap();
    assert_eq!(gate.poll().unwrap(), Some(stage));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn checkpoint_commit_precedes_ack_and_provisional_receipt_survives_restart_without_secrets() {
    let (dir, store, binding, launch) = ready().await;
    let owner = store
        .reserve_native_capture_owner(binding, launch, "owner", 1)
        .await
        .unwrap();
    let (late, mut late_gate) = request(
        &owner.binding,
        Stage::Input,
        json!({"inputBytes":4,"inputSha256":owner.launch.input_sha256}),
    );
    store
        .acknowledge_native_checkpoint(&owner, late)
        .await
        .unwrap();
    assert!(late_gate.poll().is_err());
    accept(&store, &owner, Stage::Launch, launch_payload(&owner)).await;
    accept(
        &store,
        &owner,
        Stage::Process,
        identity("native_image_verified_suspended_before_execution"),
    )
    .await;
    accept(
        &store,
        &owner,
        Stage::Input,
        json!({"inputBytes":4,"inputSha256":owner.launch.input_sha256}),
    )
    .await;
    let receipt = json!({"schemaVersion":1,"state":"native_protocol_capture_completed","binding":owner.binding,
        "inputBytes":4,"inputSha256":owner.launch.input_sha256,"capture":{"identity":identity("native_image_verified_execution_exited_and_pipes_drained"),
        "exitCode":0,"stdout":[115,101,99,114,101,116],"stderr":[]}});
    let mut changed = receipt.clone();
    changed["capture"]["identity"]["processId"] = json!(99);
    let (bad, _gate) = request(&owner.binding, Stage::Receipt, changed);
    assert!(store
        .persist_native_checkpoint(&owner, &bad)
        .await
        .unwrap_err()
        .contains("process changed"));
    accept(&store, &owner, Stage::Receipt, receipt.clone()).await;
    let (duplicate, _gate) = request(&owner.binding, Stage::Receipt, receipt);
    assert!(store
        .persist_native_checkpoint(&owner, &duplicate)
        .await
        .is_err());
    store.close_native_capture_owner(&owner).await.unwrap();
    store.pool.close().await;
    let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
    let evidence: Vec<String> = sqlx::query_scalar(
        "SELECT evidence_json FROM development_capture_checkpoints ORDER BY stage",
    )
    .fetch_all(&reopened.pool)
    .await
    .unwrap();
    assert_eq!(evidence.len(), 4);
    let terminal: Value = serde_json::from_str(&evidence[3]).unwrap();
    assert_eq!(terminal["state"], "receipt_observed_provisional");
    assert_eq!(terminal["stdoutSha256"], digest(b"secret"));
    for forbidden in [
        "secret",
        "private-argument",
        &owner.binding.capability,
        "stdout\":",
        "stderr\":",
    ] {
        assert!(!evidence.join("").contains(forbidden));
    }
    let delivery = reopened
        .development_delivery(&owner.binding.run_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(delivery.state, "started");
    let status: String = sqlx::query_scalar("SELECT status FROM development_runs WHERE id=?")
        .bind(&owner.binding.run_id)
        .fetch_one(&reopened.pool)
        .await
        .unwrap();
    assert_eq!(status, "intent");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn checkpoint_owner_and_stage_races_have_exactly_one_winner() {
    let (_dir, store, binding, launch) = ready().await;
    let second: Launch = serde_json::from_value(serde_json::to_value(&launch).unwrap()).unwrap();
    let (a, b) = tokio::join!(
        store.reserve_native_capture_owner(binding.clone(), launch, "owner", 1),
        store.reserve_native_capture_owner(binding, second, "owner", 1)
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    let owner = a.or(b).unwrap();
    let (a, _ag) = request(&owner.binding, Stage::Launch, launch_payload(&owner));
    let (b, _bg) = request(&owner.binding, Stage::Launch, launch_payload(&owner));
    let (a, b) = tokio::join!(
        store.persist_native_checkpoint(&owner, &a),
        store.persist_native_checkpoint(&owner, &b)
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn late_closed_reassigned_and_rebound_checkpoint_writes_are_rejected() {
    for mutation in [
        "UPDATE development_capture_owners SET deadline_ms=0",
        "UPDATE development_capture_owners SET state='closed'",
        "UPDATE continuous_tasks SET claim_fence=2",
        "UPDATE development_runs SET claim_fence=2",
        "UPDATE development_launches SET session_id='other'",
        "UPDATE development_launches SET process_instance='other'",
        "UPDATE development_launches SET route_json='{}'",
        "UPDATE development_launches SET state='exited'",
    ] {
        let (_dir, store, binding, launch) = ready().await;
        let owner = store
            .reserve_native_capture_owner(binding, launch, "owner", 1)
            .await
            .unwrap();
        sqlx::query(mutation).execute(&store.pool).await.unwrap();
        let (pending, mut gate) = request(&owner.binding, Stage::Launch, launch_payload(&owner));
        store
            .acknowledge_native_checkpoint(&owner, pending)
            .await
            .unwrap();
        assert!(gate.poll().is_err(), "{mutation}");
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM development_capture_checkpoints")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(count, 0, "{mutation}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dropped_response_does_not_cancel_commit_and_close_is_a_write_barrier() {
    let (_dir, store, binding, launch) = ready().await;
    let owner = store
        .reserve_native_capture_owner(binding, launch, "owner", 1)
        .await
        .unwrap();
    let (pending, gate) = request(&owner.binding, Stage::Launch, launch_payload(&owner));
    drop(gate);
    assert!(store
        .acknowledge_native_checkpoint(&owner, pending)
        .await
        .is_err());
    store.close_native_capture_owner(&owner).await.unwrap();
    let (pending, _gate) = request(
        &owner.binding,
        Stage::Process,
        identity("native_image_verified_suspended_before_execution"),
    );
    assert!(store
        .persist_native_checkpoint(&owner, &pending)
        .await
        .is_err());
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM development_capture_checkpoints")
        .fetch_one(&store.pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn native_capture_writers_wait_for_a_foreign_writer() {
    use crate::store::write_lock_tests::waits;
    let (dir, store, binding, launch) = ready().await;
    let owner = waits(
        "a capture owner reservation",
        &dir,
        store.reserve_native_capture_owner(binding, launch, "owner", 1),
    )
    .await
    .unwrap();
    let (request, mut gate) = request(&owner.binding, Stage::Launch, launch_payload(&owner));
    waits(
        "a native checkpoint",
        &dir,
        store.acknowledge_native_checkpoint(&owner, request),
    )
    .await
    .unwrap();
    assert_eq!(gate.poll().unwrap(), Some(Stage::Launch));
}
