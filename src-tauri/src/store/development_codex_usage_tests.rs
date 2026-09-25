use super::*;

fn stream(usage: Value) -> Vec<u8> {
    format!("{{\"type\":\"thread.started\",\"thread_id\":\"native-thread\"}}\n{{\"type\":\"turn.started\"}}\n{}\n",
        serde_json::json!({"type":"turn.completed","usage":usage})).into_bytes()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn capture_rechecks_provider_after_waiting_for_writer() {
    let mutations = [
        "UPDATE development_launches SET route_json=json_set(route_json,'$.selection.resolved.provider','other') WHERE run_id=?",
        "UPDATE development_launches SET route_json=json_set(route_json,'$.selection.resolved.model','changed') WHERE run_id=?",
        "UPDATE development_launches SET exit_code=7 WHERE run_id=?",
    ];
    for mutation in mutations {
        for replay in [false, true] {
            let (_dir, store, _, root) = super::super::tests::fixture().await;
            let (reservation, run, worker) =
                super::super::usage_binding_tests::launched(&store, &root).await;
            store
                .record_development_process_exit(&worker, "session", Some(0))
                .await
                .unwrap();
            sqlx::query("UPDATE development_launches SET route_json=json_set(route_json,'$.selection.resolved.provider','codex') WHERE run_id=?")
        .bind(&run).execute(&store.pool).await.unwrap();
            let captured = stream(serde_json::json!({"input_tokens":30,"output_tokens":4}));
            let observed_at = super::super::now_unix_secs();
            if replay {
                store
                    .settle_codex_run_capture(
                        &reservation,
                        RunUsageBinding {
                            run_id: &run,
                            session_id: "session",
                        },
                        &captured,
                        Some(0),
                        observed_at,
                    )
                    .await
                    .unwrap();
            }
            let mut writer = store.pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
            sqlx::query(mutation)
                .bind(&run)
                .execute(&mut *writer)
                .await
                .unwrap();
            let pending = store.settle_codex_run_capture(
                &reservation,
                RunUsageBinding {
                    run_id: &run,
                    session_id: "session",
                },
                &captured,
                Some(0),
                observed_at,
            );
            tokio::pin!(pending);
            assert!(
                tokio::time::timeout(std::time::Duration::from_millis(100), &mut pending)
                    .await
                    .is_err()
            );
            writer.commit().await.unwrap();
            assert!(
                tokio::time::timeout(std::time::Duration::from_secs(3), &mut pending)
                    .await
                    .unwrap()
                    .is_err(),
                "changed launch must invalidate capture before settlement or replay: {mutation}"
            );
            let (state, actual): (String, Option<i64>) = sqlx::query_as(
                "SELECT state,actual_tokens FROM development_token_reservations WHERE id=?",
            )
            .bind(&reservation)
            .fetch_one(&store.pool)
            .await
            .unwrap();
            assert_eq!(state, if replay { "settled" } else { "started" });
            assert_eq!(actual, if replay { Some(34) } else { None });
        }
    }
}

#[test]
fn native_usage_does_not_double_count_cache_or_reasoning() {
    let captured = stream(
        serde_json::json!({"input_tokens":32776,"cached_input_tokens":25088,
        "output_tokens":254,"reasoning_output_tokens":82}),
    );
    assert_eq!(complete_usage(&captured, Some(0)).unwrap(), 33030);
    assert!(complete_usage(&captured, None).is_err());
    assert!(complete_usage(&captured, Some(1)).is_err());
    assert!(complete_usage(&captured[..captured.len() - 1], Some(0)).is_err());
    let mut duplicate = captured.clone();
    duplicate.extend_from_slice(&captured);
    assert!(complete_usage(&duplicate, Some(0)).is_err());
    for suffix in [b"{\"type\":\"error\"}\n".as_slice(), b"not json\n"] {
        let mut invalid = captured.clone();
        invalid.extend_from_slice(suffix);
        assert!(complete_usage(&invalid, Some(0)).is_err());
    }
}

#[test]
fn unavailable_or_impossible_counts_never_become_zero() {
    for usage in [
        serde_json::json!({}),
        serde_json::json!({"input_tokens":-1,"output_tokens":1}),
        serde_json::json!({"input_tokens":1.5,"output_tokens":1}),
        serde_json::json!({"input_tokens":1,"output_tokens":1,"cached_input_tokens":2}),
        serde_json::json!({"input_tokens":1,"output_tokens":1,"reasoning_output_tokens":2}),
        serde_json::json!({"input_tokens":i64::MAX,"output_tokens":1}),
    ] {
        assert!(complete_usage(&stream(usage), Some(0)).is_err());
    }
    assert!(complete_usage(&vec![b'\n'; 1_048_577], Some(0)).is_err());
}

#[test]
fn every_rejection_names_its_reason() {
    let valid = stream(serde_json::json!({"input_tokens":3,"output_tokens":1}));
    let mut failed = valid.clone();
    failed.extend_from_slice(b"{\"type\":\"turn.failed\"}\n");
    let cases: Vec<(Vec<u8>, Option<i32>, &str)> = vec![
        (valid.clone(), Some(2), "process exit code is not zero"),
        (Vec::new(), Some(0), "capture is empty"),
        (vec![b'\n'; 1_048_577], Some(0), "capture exceeds 1 MiB"),
        (
            valid[..valid.len() - 1].to_vec(),
            Some(0),
            "capture is truncated before a final newline",
        ),
        (b"\xff\n".to_vec(), Some(0), "capture is not UTF-8"),
        (b"{not json\n".to_vec(), Some(0), "capture line is not JSON"),
        (failed, Some(0), "unexpected or out-of-order event"),
        (
            b"{\"type\":\"thread.started\",\"thread_id\":\"t\"}\n{\"type\":\"turn.started\"}\n{\"type\":\"item.started\",\"item\":null}\n".to_vec(),
            Some(0),
            "item event without an item object",
        ),
        (
            stream(
                serde_json::json!({"input_tokens":3,"output_tokens":1,"cache_write_input_tokens":2}),
            ),
            Some(0),
            "nonzero cache-write tokens are unsupported",
        ),
        (
            stream(serde_json::json!({"input_tokens":-3,"output_tokens":1})),
            Some(0),
            "usage count is missing, negative or not an integer",
        ),
        (
            stream(serde_json::json!({"input_tokens":3,"output_tokens":1,"cached_input_tokens":4})),
            Some(0),
            "cached or reasoning count is invalid or exceeds its total",
        ),
        (
            stream(serde_json::json!({"input_tokens":1_000_000_000,"output_tokens":1})),
            Some(0),
            "usage total exceeds the ledger limit",
        ),
        (
            b"{\"type\":\"thread.started\",\"thread_id\":\"t\"}\n{\"type\":\"turn.started\"}\n"
                .to_vec(),
            Some(0),
            "no final turn.completed event",
        ),
    ];
    for (stdout, exit, reason) in cases {
        assert_eq!(complete_usage(&stdout, exit), Err(reason));
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn trusted_capture_settles_only_its_exited_codex_run() {
    let (_dir, store, _, root) = super::super::tests::fixture().await;
    let (reservation, run, worker) =
        super::super::usage_binding_tests::launched(&store, &root).await;
    let captured = stream(serde_json::json!({"input_tokens":30,"output_tokens":4}));
    store
        .record_development_process_exit(&worker, "session", Some(0))
        .await
        .unwrap();
    let now = super::super::now_unix_secs();
    // Legacy or other-provider route is not an attested Codex source.
    assert!(store
        .settle_codex_run_capture(
            &reservation,
            RunUsageBinding {
                run_id: &run,
                session_id: "session"
            },
            &captured,
            Some(0),
            now
        )
        .await
        .is_err());
    sqlx::query("UPDATE development_launches SET route_json=json_set(route_json,'$.selection.resolved.provider','codex') WHERE run_id=?")
        .bind(&run).execute(&store.pool).await.unwrap();
    assert!(store
        .settle_codex_run_capture(
            &reservation,
            RunUsageBinding {
                run_id: &run,
                session_id: "session"
            },
            &captured,
            Some(1),
            now
        )
        .await
        .is_err());
    assert!(store
        .settle_codex_run_capture(
            &reservation,
            RunUsageBinding {
                run_id: &run,
                session_id: "session"
            },
            b"partial",
            Some(0),
            now
        )
        .await
        .is_err());
    let (state,): (String,) =
        sqlx::query_as("SELECT state FROM development_token_reservations WHERE id=?")
            .bind(&reservation)
            .fetch_one(&store.pool)
            .await
            .unwrap();
    assert_eq!(state, "started");
    for _ in 0..2 {
        store
            .settle_codex_run_capture(
                &reservation,
                RunUsageBinding {
                    run_id: &run,
                    session_id: "session",
                },
                &captured,
                Some(0),
                now,
            )
            .await
            .unwrap();
    }
    let (tokens, source): (i64, String) = sqlx::query_as(
        "SELECT actual_tokens,source FROM development_token_reservations WHERE id=?",
    )
    .bind(&reservation)
    .fetch_one(&store.pool)
    .await
    .unwrap();
    assert_eq!(tokens, 34);
    assert!(source.starts_with("codex-exec-json-v1:sha256:"));
}
