use super::*;
use crate::store::development_budget::{RunUsageBinding, TokenReservation};
use crate::store::now_unix_secs;
use sha2::{Digest, Sha256};

fn route(provider: &str, transport: &str) -> Value {
    json!({"selection":{"resolved":{"provider":provider,"profileId":provider}},
        "preparedInvocation":{"transport":transport}})
}

/// Field values from the direct Codex CLI 0.153 probe of 2026-09-11
/// (`.pa/provider-smokes/codex-file-2026-09-11T15-43-50-463Z.json`,
/// `reportedUsage`), in the event order that probe recorded.
const CODEX_SMOKE: &[u8] = b"{\"type\":\"thread.started\",\"thread_id\":\"smoke-thread\"}\n\
{\"type\":\"turn.started\"}\n\
{\"type\":\"item.completed\",\"item\":{\"id\":\"item_0\",\"type\":\"agent_message\",\"text\":\"PA_CODEX_OK\"}}\n\
{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":32171,\"cached_input_tokens\":17920,\"cache_write_input_tokens\":0,\"output_tokens\":203,\"reasoning_output_tokens\":74}}\n";

fn assert_never_unavailable(receipt: &Value) {
    let text = receipt.to_string();
    assert!(
        !text.contains("unavailable"),
        "a cost receipt must name its provenance: {text}"
    );
}

#[test]
fn codex_json_receipt_names_its_live_provenance() {
    let receipt = UsageReceipt::collect(&route("codex", CODEX_TRANSPORT), CODEX_SMOKE, Some(0));
    assert_eq!(receipt.tokens(), Some(32_374));
    assert_eq!(receipt.state(), "measured");
    let sha = format!("{:x}", Sha256::digest(CODEX_SMOKE));
    assert_eq!(
        receipt.ledger_source().unwrap(),
        format!("codex-exec-json-v1:sha256:{sha}")
    );
    let json = receipt.to_json(Some(1_700_000_000));
    assert_eq!(json["state"], "measured");
    assert_eq!(json["tokens"], 32_374);
    assert_eq!(json["reservation"], "settled");
    assert_eq!(json["provenance"]["collector"], CODEX_COLLECTOR);
    assert_eq!(json["provenance"]["measurement"], "live");
    assert_eq!(json["provenance"]["source"], "process-owned stdout");
    assert_eq!(json["provenance"]["sourceSha256"], sha);
    assert_eq!(json["provenance"]["observedAt"], 1_700_000_000);
    assert_never_unavailable(&json);
}

#[test]
fn rejected_and_partial_codex_captures_fail_closed_with_a_named_reason() {
    let truncated = &CODEX_SMOKE[..CODEX_SMOKE.len() - 1];
    let mut error = CODEX_SMOKE.to_vec();
    error.extend_from_slice(b"{\"type\":\"error\",\"message\":\"stream disconnected\"}\n");
    let mut flagged = CODEX_SMOKE.to_vec();
    flagged.extend_from_slice(b"{\"type\":\"item.completed\",\"is_error\":true,\"item\":{}}\n");
    let without_final = CODEX_SMOKE
        .split_inclusive(|b| *b == b'\n')
        .take(3)
        .flatten()
        .copied()
        .collect::<Vec<u8>>();
    let cases: [(&[u8], Option<i32>, &str); 7] = [
        (CODEX_SMOKE, Some(1), "process exit code is not zero"),
        (CODEX_SMOKE, None, "process exit code is not zero"),
        (b"", Some(0), "capture is empty"),
        (
            truncated,
            Some(0),
            "capture is truncated before a final newline",
        ),
        (&error, Some(0), "unexpected or out-of-order event"),
        (&flagged, Some(0), "provider reported an error event"),
        (&without_final, Some(0), "no final turn.completed event"),
    ];
    for (stdout, exit, reason) in cases {
        let receipt = UsageReceipt::collect(&route("codex", CODEX_TRANSPORT), stdout, exit);
        assert_eq!(receipt.tokens(), None, "{reason}");
        assert_eq!(receipt.ledger_source(), None, "{reason}");
        assert_eq!(receipt.state(), "rejected", "{reason}");
        let json = receipt.to_json(Some(5));
        assert_eq!(json["state"], "rejected");
        assert_eq!(json["reason"], reason);
        assert_eq!(json["reservation"], "retained");
        assert!(json.get("tokens").is_none());
        assert_eq!(json["provenance"]["collector"], CODEX_COLLECTOR);
        assert_eq!(json["provenance"]["measurement"], "none");
        assert_eq!(
            json["provenance"]["sourceSha256"],
            format!("{:x}", Sha256::digest(stdout))
        );
        assert_never_unavailable(&json);
    }
}

#[test]
fn adapters_without_a_collector_report_a_named_provenance() {
    let cases = [
        ("kimi", "interactive_pty", "context-window occupancy"),
        (
            "opencode",
            "interactive_pty",
            "no recorded OpenCode status-line bytes",
        ),
        ("claude", "interactive_pty", "account-wide rate windows"),
        ("ollama", "interactive_pty", "local Ollama"),
        ("codex", "interactive_pty", "native `codex exec --json`"),
        ("unknown", "unknown", "no trusted usage collector"),
    ];
    for (provider, transport, detail) in cases {
        let receipt = UsageReceipt::collect(&route(provider, transport), CODEX_SMOKE, Some(0));
        assert_eq!(receipt.tokens(), None, "{provider}");
        assert_eq!(receipt.state(), "not_reported", "{provider}");
        let json = receipt.to_json(Some(9));
        assert_eq!(json["state"], "not_reported");
        let reason = json["reason"].as_str().unwrap();
        assert!(reason.starts_with("not reported by adapter: "), "{reason}");
        assert!(reason.contains(detail), "{provider}: {reason}");
        assert_eq!(json["reservation"], "retained");
        assert!(json.get("tokens").is_none());
        assert_eq!(json["provenance"]["collector"], Value::Null);
        assert_eq!(json["provenance"]["measurement"], "none");
        assert_eq!(json["provenance"]["provider"], provider);
        assert_eq!(json["provenance"]["transport"], transport);
        assert_eq!(json["provenance"]["observedAt"], 9);
        assert_never_unavailable(&json);
    }
    // A route without a provider is not silently promoted to a collector.
    let missing = UsageReceipt::collect(&json!({}), CODEX_SMOKE, Some(0));
    assert_eq!(
        missing,
        UsageReceipt::NotReported {
            provider: "unknown".into(),
            transport: "unknown".into()
        }
    );
}

fn reservation(state: &str) -> TokenReservation {
    TokenReservation {
        id: "tr-1".into(),
        root_goal_id: "root".into(),
        goal_id: "root".into(),
        idempotency_key: "k".into(),
        purpose: "implementation".into(),
        run_id: Some("run".into()),
        reserved_tokens: 1000,
        state: state.into(),
        actual_tokens: (state == "settled").then_some(420),
        source: (state == "settled").then(|| "codex-exec-json-v1:sha256:ab".into()),
        observed_at: (state == "settled").then_some(77),
        created_at: 1,
        started_at: None,
        settled_at: None,
    }
}

fn launch(state: &str, provider: &str) -> DevelopmentLaunch {
    DevelopmentLaunch {
        run_id: "run".into(),
        worker_id: "wk".into(),
        project_id: "pj".into(),
        profile_id: provider.into(),
        repo_path: "repo".into(),
        worktree_path: "wt".into(),
        branch: "b".into(),
        session_id: Some("session".into()),
        state: state.into(),
        reserved_at: 1,
        spawning_at: Some(2),
        exited_at: state.starts_with("exited").then_some(33),
        exit_code: state.starts_with("exited").then_some(0),
        route_json: Some(route(provider, "interactive_pty").to_string()),
        route_expires_at: None,
        baseline_commit: None,
        process_instance: None,
        exit_reason: None,
    }
}

#[test]
fn every_run_cost_receipt_names_its_state_and_provenance() {
    let settled = run_receipt(Some(&reservation("settled")), None, None);
    assert_eq!(settled["state"], "measured");
    assert_eq!(settled["tokens"], 420);
    assert_eq!(settled["ledgerState"], "settled");
    assert_eq!(settled["reservedTokens"], 1000);
    assert_eq!(settled["provenance"]["measurement"], "live");
    assert_eq!(
        settled["provenance"]["source"],
        "codex-exec-json-v1:sha256:ab"
    );
    assert_eq!(settled["provenance"]["observedAt"], 77);

    let exited = launch("exited", "kimi");
    let pty = run_receipt(Some(&reservation("started")), Some(&exited), None);
    assert_eq!(pty["state"], "not_reported");
    assert!(pty["reason"]
        .as_str()
        .unwrap()
        .contains("context-window occupancy"));
    assert_eq!(pty["ledgerState"], "started");
    assert_eq!(pty["reservedTokens"], 1000);
    assert_eq!(pty["provenance"]["observedAt"], 33);

    let rejected = UsageReceipt::Rejected {
        reason: "capture is empty",
        source_sha256: "ff".into(),
    }
    .to_json(Some(40));
    let stored = run_receipt(
        Some(&reservation("started")),
        Some(&launch("exited", "codex")),
        Some(rejected),
    );
    assert_eq!(stored["state"], "rejected");
    assert_eq!(stored["reason"], "capture is empty");
    assert_eq!(stored["ledgerState"], "started");

    // Capture results written before this receipt format are named, not
    // passed through as a bare "unavailable".
    let legacy = run_receipt(
        Some(&reservation("started")),
        Some(&launch("exited", "codex")),
        Some(json!({"state":"unavailable"})),
    );
    assert_eq!(legacy["state"], "unclassified");

    let undelivered = run_receipt(
        Some(&reservation("started")),
        Some(&launch("exited_undelivered", "codex")),
        None,
    );
    assert_eq!(undelivered["state"], "not_reported");
    assert!(undelivered["reason"]
        .as_str()
        .unwrap()
        .contains("before its input was delivered"));

    let running = run_receipt(
        Some(&reservation("started")),
        Some(&launch("spawning", "kimi")),
        None,
    );
    assert_eq!(running["state"], "pending");
    assert_eq!(
        run_receipt(Some(&reservation("reserved")), None, None)["state"],
        "pending"
    );
    assert_eq!(
        run_receipt(Some(&reservation("cancelled")), None, None)["state"],
        "cancelled"
    );
    assert_eq!(run_receipt(None, None, None)["state"], "not_reserved");

    for receipt in [
        settled,
        pty,
        stored,
        legacy,
        undelivered,
        running,
        run_receipt(None, None, None),
    ] {
        assert!(receipt["reason"].is_string() || receipt["state"] == "measured");
        assert_never_unavailable(&receipt);
    }
}

/// DF-15b / KI-27: a reservation released because the provider exited before
/// its input was delivered is named as exactly that - never misread as a
/// cancellation before work started.
#[test]
fn a_released_undelivered_reservation_is_named_not_misread_as_unstarted() {
    let released = run_receipt(
        Some(&reservation("cancelled")),
        Some(&launch("exited_undelivered", "codex")),
        None,
    );
    assert_eq!(released["state"], "cancelled");
    assert_eq!(released["ledgerState"], "cancelled");
    let reason = released["reason"].as_str().unwrap();
    assert!(
        reason.contains("exited before its input was delivered"),
        "{reason}"
    );
    assert!(!reason.contains("before work started"), "{reason}");
    assert_never_unavailable(&released);
    // A plain pre-work cancellation keeps its own reason.
    let plain = run_receipt(Some(&reservation("cancelled")), None, None);
    assert!(plain["reason"]
        .as_str()
        .unwrap()
        .contains("before work started"));
}

/// Review round 1 (kimi-k3 K1/K2/K4, glm-5.2 G1-G3): provenance is never
/// stated stronger than the stored evidence.
#[test]
fn run_receipt_never_overstates_its_provenance() {
    // K2/G1: only a codex collector source is a live measurement.
    let mut manual = reservation("settled");
    manual.source = Some("trusted-provider-receipt".into());
    let receipt = run_receipt(Some(&manual), None, None);
    assert_eq!(receipt["state"], "measured");
    assert_eq!(receipt["provenance"]["measurement"], "trusted_receipt");
    assert_eq!(receipt["provenance"]["collector"], Value::Null);
    let codex = run_receipt(Some(&reservation("settled")), None, None);
    assert_eq!(codex["provenance"]["measurement"], "live");
    assert_eq!(codex["provenance"]["collector"], CODEX_COLLECTOR);
    // G3: a settled row without tokens or source is not a measurement.
    for (tokens, source) in [(None, Some("x")), (Some(1), None), (None, None)] {
        let mut broken = reservation("settled");
        broken.actual_tokens = tokens;
        broken.source = source.map(Into::into);
        let receipt = run_receipt(Some(&broken), None, None);
        assert_eq!(receipt["state"], "unclassified", "{receipt}");
        assert!(receipt.get("tokens").is_none());
    }
    // K1: an exited native Codex launch without a committed capture has a
    // collector; it is pending that capture, not "not reported by adapter".
    let mut native = launch("exited", "codex");
    native.route_json = Some(route("codex", CODEX_TRANSPORT).to_string());
    let receipt = run_receipt(Some(&reservation("started")), Some(&native), None);
    assert_eq!(receipt["state"], "pending", "{receipt}");
    assert!(receipt["reason"]
        .as_str()
        .unwrap()
        .contains("capture has not been committed"));
    // K4b: an unreadable stored receipt is named as such, not as legacy.
    let receipt = run_receipt(
        Some(&reservation("started")),
        Some(&native),
        Some(json!({"state":"unreadable"})),
    );
    assert_eq!(receipt["state"], "unclassified");
    assert!(receipt["reason"].as_str().unwrap().contains("unreadable"));
    // K4a: every receipt carries the ledger fields, even without a row.
    let none = run_receipt(None, None, None);
    assert_eq!(none["ledgerState"], Value::Null);
    assert_eq!(none["reservedTokens"], 0);
    // G2: an undelivered exit still names its adapter.
    let receipt = run_receipt(
        Some(&reservation("started")),
        Some(&launch("exited_undelivered", "kimi")),
        None,
    );
    assert_eq!(receipt["provenance"]["provider"], "kimi");
    assert_eq!(receipt["provenance"]["transport"], "interactive_pty");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn run_records_carry_a_cost_receipt_instead_of_unavailable() {
    let (_dir, store, project, root) = super::super::tests::fixture().await;
    let (reservation, run, worker) =
        super::super::usage_binding_tests::launched(&store, &root).await;
    // Root balance before any receipt names why nothing is measured yet.
    let snapshot = store.development_records_snapshot(&project).await.unwrap();
    assert_eq!(snapshot["runs"][0]["tokens"]["usageState"], "no_receipts");
    assert_eq!(snapshot["runs"][0]["usage"]["state"], "pending");
    sqlx::query("UPDATE development_launches SET route_json=? WHERE run_id=?")
        .bind(route("kimi", "interactive_pty").to_string())
        .bind(&run)
        .execute(&store.pool)
        .await
        .unwrap();
    store
        .record_development_process_exit(&worker, "session", Some(0))
        .await
        .unwrap();
    let snapshot = store.development_records_snapshot(&project).await.unwrap();
    let usage = &snapshot["runs"][0]["usage"];
    assert_eq!(usage["state"], "not_reported", "{usage}");
    assert!(usage["reason"]
        .as_str()
        .unwrap()
        .contains("context-window occupancy"));
    assert_eq!(usage["reservedTokens"], 1000);
    assert_eq!(usage["ledgerState"], "started");
    assert_never_unavailable(usage);
    assert_never_unavailable(&snapshot["runs"][0]["tokens"]);

    let observed = now_unix_secs();
    store
        .settle_development_run_tokens(
            &reservation,
            RunUsageBinding {
                run_id: &run,
                session_id: "session",
            },
            200,
            "trusted-provider-receipt",
            observed,
        )
        .await
        .unwrap();
    let snapshot = store.development_records_snapshot(&project).await.unwrap();
    let usage = &snapshot["runs"][0]["usage"];
    assert_eq!(usage["state"], "measured");
    assert_eq!(usage["tokens"], 200);
    assert_eq!(usage["provenance"]["source"], "trusted-provider-receipt");
    assert_eq!(usage["provenance"]["measurement"], "trusted_receipt");
    assert_eq!(usage["provenance"]["observedAt"], observed);
    assert_eq!(snapshot["runs"][0]["tokens"]["usageState"], "measured");
}

/// W2-04d: a reviewer run's receipt shows its review reservation, not
/// "not_reserved" — the ledger lookup is bound to the run, not to the
/// implementation purpose.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reviewer_run_receipt_shows_its_review_reservation() {
    let (_dir, store, project, root) = super::super::tests::fixture().await;
    let (run, fence) = super::super::tests::role_run(&store, &root, "reviewer").await;
    let launch = store
        .reserve_development_launch(&run, "owner", fence, "codex")
        .await
        .unwrap();
    store.bind_development_launch_route(&run,"owner",fence,&serde_json::json!({"selection":{"resolved":{"profileId":"codex"}},"expiresAt":now_unix_secs()+600})).await.unwrap();
    store
        .bind_development_launch_baseline(&run, "owner", fence, &"a".repeat(40))
        .await
        .unwrap();
    let reservation = store
        .reserve_development_tokens(
            &root,
            "review",
            crate::store::development_budget::BudgetPurpose::Review,
            1000,
            Some(&run),
        )
        .await
        .unwrap();
    store
        .consume_development_launch(&run, "owner", fence, &launch.worker_id, "session")
        .await
        .unwrap();
    store
        .record_development_process_exit(&launch.worker_id, "session", Some(0))
        .await
        .unwrap();
    let observed = now_unix_secs();
    store
        .settle_development_run_tokens(
            &reservation.id,
            RunUsageBinding {
                run_id: &run,
                session_id: "session",
            },
            200,
            "trusted-provider-receipt",
            observed,
        )
        .await
        .unwrap();
    let snapshot = store.development_records_snapshot(&project).await.unwrap();
    let usage = &snapshot["runs"][0]["usage"];
    assert_eq!(usage["state"], "measured", "{usage}");
    assert_eq!(usage["tokens"], 200);
    assert_eq!(usage["reservedTokens"], 1000);
    assert_eq!(usage["ledgerState"], "settled");
    assert_never_unavailable(usage);
}
