use super::*;

pub(super) async fn launched(store: &Store, root: &str) -> (String, String, String) {
    let task = store
        .create_continuous_task(
            root,
            "implementation",
            None,
            vec!["src/probe.rs".into()],
            vec![],
        )
        .await
        .unwrap();
    let claim = store
        .claim_continuous_task(&task.id, "owner", false)
        .await
        .unwrap();
    let run = store
        .record_development_run_intent(&task.id, "owner", claim.fence)
        .await
        .unwrap();
    let launch = store
        .reserve_development_launch(&run.id, "owner", claim.fence, "codex")
        .await
        .unwrap();
    store.bind_development_launch_route(&run.id, "owner", claim.fence,
        &serde_json::json!({"selection":{"resolved":{"profileId":"codex"}},"expiresAt":now_unix_secs()+600})).await.unwrap();
    store
        .bind_development_launch_baseline(&run.id, "owner", claim.fence, &"a".repeat(40))
        .await
        .unwrap();
    let reservation = store
        .reserve_development_tokens(
            root,
            "usage",
            BudgetPurpose::Implementation,
            1000,
            Some(&run.id),
        )
        .await
        .unwrap();
    store
        .consume_development_launch(&run.id, "owner", claim.fence, &launch.worker_id, "session")
        .await
        .unwrap();
    (reservation.id, run.id, launch.worker_id)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_usage_cannot_settle_without_explicit_run_session_binding() {
    let (_dir, store, _, root) = tests::fixture().await;
    let (reservation, _, worker) = launched(&store, &root).await;
    store
        .record_development_process_exit(&worker, "session", Some(0))
        .await
        .unwrap();
    assert!(store
        .settle_development_tokens(&reservation, 200, "trusted-receipt", now_unix_secs())
        .await
        .is_err());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn run_usage_binding_survives_restart_and_checks_replays_before_acceptance() {
    let (dir, store, _, root) = tests::fixture().await;
    let (reservation, run, worker) = launched(&store, &root).await;
    assert!(store
        .settle_development_run_tokens(
            &reservation,
            RunUsageBinding {
                run_id: &run,
                session_id: "session"
            },
            200,
            "receipt",
            now_unix_secs()
        )
        .await
        .is_err());
    store
        .record_development_process_exit(&worker, "session", Some(1))
        .await
        .unwrap();
    let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
    let observed = now_unix_secs();
    for after_settlement in [false, true] {
        for (run_id, session_id) in [("foreign-run", "session"), (&*run, "foreign-session")] {
            assert!(reopened
                .settle_development_run_tokens(
                    &reservation,
                    RunUsageBinding { run_id, session_id },
                    200,
                    "receipt",
                    observed
                )
                .await
                .is_err());
        }
        reopened
            .settle_development_run_tokens(
                &reservation,
                RunUsageBinding {
                    run_id: &run,
                    session_id: "session",
                },
                200,
                "receipt",
                observed,
            )
            .await
            .unwrap();
        if after_settlement {
            assert!(reopened
                .settle_development_run_tokens(
                    &reservation,
                    RunUsageBinding {
                        run_id: &run,
                        session_id: "session"
                    },
                    201,
                    "receipt",
                    observed
                )
                .await
                .is_err());
        }
    }
    let row: TokenReservation =
        sqlx::query_as("SELECT * FROM development_token_reservations WHERE id=?")
            .bind(&reservation)
            .fetch_one(&reopened.pool)
            .await
            .unwrap();
    assert_eq!(row.actual_tokens, Some(200));
    assert_eq!(row.state, "settled");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn run_receipt_cannot_settle_a_nonworker_reservation() {
    let (_dir, store, _, root) = tests::fixture().await;
    let reservation = store
        .reserve_development_tokens(&root, "planning", BudgetPurpose::Planning, 1000, None)
        .await
        .unwrap();
    store
        .start_development_tokens(&reservation.id)
        .await
        .unwrap();
    assert!(store
        .settle_development_run_tokens(
            &reservation.id,
            RunUsageBinding {
                run_id: "run",
                session_id: "session"
            },
            200,
            "receipt",
            now_unix_secs()
        )
        .await
        .is_err());
}
