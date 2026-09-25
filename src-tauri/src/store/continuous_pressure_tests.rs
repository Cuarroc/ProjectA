use super::*;

#[test]
fn memory_thresholds_and_unknown_observations_reduce_only_admission() {
    let total = 16 * 1024 * MIB;
    assert_eq!(assess(Some((total, 8 * 1024 * MIB)), "test").limit, 2);
    assert_eq!(assess(Some((total, 1024 * MIB)), "test").limit, 1);
    assert_eq!(assess(Some((total, 256 * MIB)), "test").limit, 0);
    assert_eq!(assess(Some((total, 0)), "test").limit, 0);
    let missing = assess(None, "test");
    assert_eq!(missing.limit, 1);
    assert_eq!(missing.reason, "memory_unavailable");
    assert!(missing.available_bytes.is_none());
    for invalid in [(0, 0), (1, 2)] {
        let value = assess(Some(invalid), "test");
        assert_eq!(value.reason, "memory_unavailable");
        assert!(value.total_bytes.is_none());
    }
    // Exact percentage and byte thresholds, without integer multiplication overflow.
    assert_eq!(assess(Some((10_000 * MIB, 500 * MIB)), "test").limit, 0);
    assert_eq!(assess(Some((10_000 * MIB, 512 * MIB)), "test").limit, 1);
    assert_eq!(assess(Some((10_000 * MIB, 2048 * MIB)), "test").limit, 2);
    assert_eq!(assess(Some((u64::MAX, u64::MAX)), "test").limit, 2);
    assert_eq!(assess(Some((100_000 * MIB, 4999 * MIB)), "test").limit, 0);
    assert_eq!(assess(Some((100_000 * MIB, 5000 * MIB)), "test").limit, 1);
    assert_eq!(assess(Some((100_000 * MIB, 14999 * MIB)), "test").limit, 1);
    assert_eq!(assess(Some((100_000 * MIB, 15000 * MIB)), "test").limit, 2);
}

#[test]
fn linux_parser_requires_available_memory_and_exact_units() {
    assert_eq!(
        parse_meminfo("MemTotal: 100 kB\nMemAvailable: 30 kB\n"),
        Some((102400, 30720))
    );
    for body in [
        "MemTotal: 100 kB\nMemFree: 30 kB",
        "MemTotal: 100 MB\nMemAvailable: 30 kB",
        "MemTotal: 100 kB\nMemAvailable: 30 kB\nMemAvailable: 30 kB",
        "MemTotal: 18446744073709551615 kB\nMemAvailable: 30 kB",
    ] {
        assert!(parse_meminfo(body).is_none());
    }
}

#[test]
fn native_memory_observation_is_explicit() {
    let observed = read_memory();
    if let Some((total, available)) = observed {
        assert!(total > 0 && available <= total);
    }
    println!(
        "native admission memory: {}",
        serde_json::to_string(&assess(observed, native_source())).unwrap()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pressure_blocks_new_claims_without_consuming_attempts_or_releasing_work() {
    let (_dir, store, project) = super::super::tests::store().await;
    let goal = store
        .create_continuous_goal(&project, "pressure", None, None, true)
        .await
        .unwrap();
    let a = store
        .create_continuous_task(&goal.id, "a", None, vec!["a.rs".into()], vec![])
        .await
        .unwrap();
    let b = store
        .create_continuous_task(&goal.id, "b", None, vec!["b.rs".into()], vec![])
        .await
        .unwrap();
    let memory = |available| assess(Some((16 * 1024 * MIB, available)), "test");
    assert!(store
        .claim_with_capacity(&a.id, "a", false, || memory(0))
        .await
        .unwrap_err()
        .contains("critical_memory_pressure"));
    assert_eq!(
        store
            .get_continuous_task(&a.id)
            .await
            .unwrap()
            .unwrap()
            .attempts,
        0
    );
    let first = store
        .claim_with_capacity(&a.id, "a", false, || memory(1024 * MIB))
        .await
        .unwrap();
    assert!(store
        .claim_with_capacity(&b.id, "b", false, || memory(1024 * MIB))
        .await
        .unwrap_err()
        .contains("memory_pressure"));
    assert!(store
        .claim_with_capacity(&b.id, "b", false, || assess(None, "test"))
        .await
        .unwrap_err()
        .contains("memory_unavailable"));
    let unchanged = store.get_continuous_task(&a.id).await.unwrap().unwrap();
    assert_eq!(unchanged.claim.unwrap(), first);
    assert_eq!(
        store
            .get_continuous_task(&b.id)
            .await
            .unwrap()
            .unwrap()
            .attempts,
        0
    );
    store
        .claim_with_capacity(&b.id, "b", false, || memory(8 * 1024 * MIB))
        .await
        .unwrap();
    let context = store.continuous_context(&project, 0).await.unwrap();
    let host = &context.effective_limits["hostAdmission"];
    assert_eq!(host["activeClaims"], 2);
    assert_eq!(host["memory"]["source"], "test-fixture");
    assert_eq!(host["memory"]["limit"], 2);
}
