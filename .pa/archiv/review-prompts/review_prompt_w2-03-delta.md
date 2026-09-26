# Delta review W2-03a round 2: fixes for round-1 findings (ProjectA, Tauri 2, Rust + SQLite)

You are an independent code reviewer from a different model vendor than the
author (Claude Code). This is a delta round: review ONLY the diff below, which
fixes findings from round 1. Check that each fix is correct and complete and
that it introduces no new bug. Report findings as a numbered list with
severity (high/medium/low), file:line, what is wrong, a concrete failing
scenario and a suggested fix. Say explicitly if you find nothing blocking.

## Context (from round 1)
`UsageReceipt` classifies an exited provider process as measured (only
native `codex exec --json`, collector `codex-exec-json-v1`), rejected (named
parser reason) or not_reported (no trusted collector for the adapter). Each
run in the development records snapshot gets a cost receipt via
`run_receipt(reservation, launch, stored capture usage)`. The ledger settles
only trusted receipts; unknown usage keeps the whole reservation.

Round-1 findings and the disposition:
- K1 (medium): an exited native Codex launch without a committed capture was
  shown as `not_reported` with a self-contradicting reason. Fix: shared
  `has_collector`; such a run is `pending`.
- K2/G1 (medium): every settled reservation was labelled
  `measurement: "live"`. Fix: `live` plus `collector` only for a
  `codex-exec-json-v1:sha256:` source, otherwise `trusted_receipt`.
- G3 (low): settled row with NULL tokens/source would read measured. Fix:
  `unclassified`.
- K3 (low): the legacy replay match cannot prove the same capture bytes.
  Disposition: documentation only. The ledger replay in `settle_bound`
  requires equal `actual_tokens`, `source` (contains the capture sha256) and
  `observed_at` on an already settled row, else it returns "token settlement
  conflicts or work has not started", so different bytes fail closed.
- K4a/K4b/G2 (low): ledger fields on not_reserved, own reason for unreadable
  stored receipts, provider/transport on undelivered exits.

## Delta diff

```diff
diff --git a/src-tauri/src/store/development_usage_receipt.rs b/src-tauri/src/store/development_usage_receipt.rs
index 60b4c3a..0c892d3 100644
--- a/src-tauri/src/store/development_usage_receipt.rs
+++ b/src-tauri/src/store/development_usage_receipt.rs
@@ -32,7 +32,7 @@ impl UsageReceipt {
     /// process-owned stdout. Only native Codex JSON has a trusted collector.
     pub(in crate::store) fn collect(route: &Value, stdout: &[u8], exit_code: Option<i32>) -> Self {
         let (provider, transport) = route_adapter(route);
-        if provider != "codex" || transport != CODEX_TRANSPORT {
+        if !has_collector(provider, transport) {
             return Self::NotReported {
                 provider: provider.into(),
                 transport: transport.into(),
@@ -103,6 +103,11 @@ impl UsageReceipt {
     }
 }
 
+/// Only native Codex JSON has a trusted per-run collector.
+fn has_collector(provider: &str, transport: &str) -> bool {
+    provider == "codex" && transport == CODEX_TRANSPORT
+}
+
 fn route_adapter(route: &Value) -> (&str, &str) {
     (
         route["selection"]["resolved"]["provider"]
@@ -118,6 +123,9 @@ fn route_adapter(route: &Value) -> (&str, &str) {
 /// names the missing source instead of claiming usage is unknowable.
 fn not_reported_reason(provider: &str, transport: &str) -> String {
     let detail = match provider {
+        "codex" if transport == CODEX_TRANSPORT => {
+            "native Codex JSON has a collector; this receipt is a classification error".into()
+        }
         "codex" => format!(
             "Codex reports usage only through native `codex exec --json`; this run used {transport}"
         ),
@@ -145,12 +153,11 @@ pub(in crate::store) fn run_receipt(
 ) -> Value {
     let Some(reservation) = reservation else {
         return json!({"state":"not_reserved",
-            "reason":"run holds no implementation token reservation"});
+            "reason":"run holds no implementation token reservation",
+            "ledgerState":null,"reservedTokens":0});
     };
     let mut receipt = match reservation.state.as_str() {
-        "settled" => json!({"state":"measured","tokens":reservation.actual_tokens,
-            "provenance":{"measurement":"live","source":reservation.source,
-                "observedAt":reservation.observed_at}}),
+        "settled" => settled_receipt(reservation),
         "cancelled" => json!({"state":"cancelled",
             "reason":"reservation cancelled before work started"}),
         "reserved" => json!({"state":"pending",
@@ -162,34 +169,55 @@ pub(in crate::store) fn run_receipt(
     receipt
 }
 
+/// A settled row is a trusted receipt, but only the Codex collector's own
+/// source is a live stdout measurement; a row missing its tokens or source
+/// is not presented as a measurement at all.
+fn settled_receipt(reservation: &TokenReservation) -> Value {
+    let (Some(tokens), Some(source)) = (reservation.actual_tokens, &reservation.source) else {
+        return json!({"state":"unclassified",
+            "reason":"settled ledger row lacks its tokens or source"});
+    };
+    let live = source.starts_with(&format!("{CODEX_COLLECTOR}:sha256:"));
+    json!({"state":"measured","tokens":tokens,
+        "provenance":{"collector": if live { Some(CODEX_COLLECTOR) } else { None },
+            "measurement": if live { "live" } else { "trusted_receipt" },
+            "source":source,"observedAt":reservation.observed_at}})
+}
+
 fn started_receipt(launch: Option<&DevelopmentLaunch>, capture_usage: Option<Value>) -> Value {
     if let Some(usage) = capture_usage {
         return match usage["state"].as_str() {
             Some("rejected" | "not_reported") => usage,
             Some("measured") => json!({"state":"unclassified",
                 "reason":"capture reported usage but the ledger has not settled it"}),
+            Some("unreadable") => json!({"state":"unclassified",
+                "reason":"stored capture receipt is unreadable"}),
             _ => json!({"state":"unclassified",
                 "reason":"capture recorded before usage provenance; collector outcome was not retained"}),
         };
     }
+    let route: Value = launch
+        .and_then(|launch| launch.route_json.as_deref())
+        .and_then(|raw| serde_json::from_str(raw).ok())
+        .unwrap_or(Value::Null);
+    let (provider, transport) = route_adapter(&route);
     match launch {
         Some(launch) if launch.state == "exited_undelivered" => json!({"state":"not_reported",
             "reason":"not reported by adapter: provider exited before its input was delivered",
             "reservation":"retained",
-            "provenance":{"collector":null,"measurement":"none","observedAt":launch.exited_at}}),
-        Some(launch) if launch.state == "exited" => {
-            let route: Value = launch
-                .route_json
-                .as_deref()
-                .and_then(|raw| serde_json::from_str(raw).ok())
-                .unwrap_or(Value::Null);
-            let (provider, transport) = route_adapter(&route);
-            UsageReceipt::NotReported {
-                provider: provider.into(),
-                transport: transport.into(),
-            }
-            .to_json(launch.exited_at)
+            "provenance":{"collector":null,"measurement":"none","provider":provider,
+                "transport":transport,"observedAt":launch.exited_at}}),
+        // The one adapter with a collector is waiting for its capture, not
+        // lacking a collector.
+        Some(launch) if launch.state == "exited" && has_collector(provider, transport) => {
+            json!({"state":"pending",
+                "reason":"native Codex capture has not been committed to its collector; reservation retained"})
+        }
+        Some(launch) if launch.state == "exited" => UsageReceipt::NotReported {
+            provider: provider.into(),
+            transport: transport.into(),
         }
+        .to_json(launch.exited_at),
         _ => json!({"state":"pending",
             "reason":"run is still executing; final usage not yet observable"}),
     }
diff --git a/src-tauri/src/store/development_usage_receipt_tests.rs b/src-tauri/src/store/development_usage_receipt_tests.rs
index db20872..3cb4974 100644
--- a/src-tauri/src/store/development_usage_receipt_tests.rs
+++ b/src-tauri/src/store/development_usage_receipt_tests.rs
@@ -266,6 +266,61 @@ fn every_run_cost_receipt_names_its_state_and_provenance() {
     }
 }
 
+/// Review round 1 (kimi-k3 K1/K2/K4, glm-5.2 G1-G3): provenance is never
+/// stated stronger than the stored evidence.
+#[test]
+fn run_receipt_never_overstates_its_provenance() {
+    // K2/G1: only a codex collector source is a live measurement.
+    let mut manual = reservation("settled");
+    manual.source = Some("trusted-provider-receipt".into());
+    let receipt = run_receipt(Some(&manual), None, None);
+    assert_eq!(receipt["state"], "measured");
+    assert_eq!(receipt["provenance"]["measurement"], "trusted_receipt");
+    assert_eq!(receipt["provenance"]["collector"], Value::Null);
+    let codex = run_receipt(Some(&reservation("settled")), None, None);
+    assert_eq!(codex["provenance"]["measurement"], "live");
+    assert_eq!(codex["provenance"]["collector"], CODEX_COLLECTOR);
+    // G3: a settled row without tokens or source is not a measurement.
+    for (tokens, source) in [(None, Some("x")), (Some(1), None)] {
+        let mut broken = reservation("settled");
+        broken.actual_tokens = tokens;
+        broken.source = source.map(Into::into);
+        let receipt = run_receipt(Some(&broken), None, None);
+        assert_eq!(receipt["state"], "unclassified", "{receipt}");
+        assert!(receipt.get("tokens").is_none());
+    }
+    // K1: an exited native Codex launch without a committed capture has a
+    // collector; it is pending that capture, not "not reported by adapter".
+    let mut native = launch("exited", "codex");
+    native.route_json = Some(route("codex", CODEX_TRANSPORT).to_string());
+    let receipt = run_receipt(Some(&reservation("started")), Some(&native), None);
+    assert_eq!(receipt["state"], "pending", "{receipt}");
+    assert!(receipt["reason"]
+        .as_str()
+        .unwrap()
+        .contains("capture has not been committed"));
+    // K4b: an unreadable stored receipt is named as such, not as legacy.
+    let receipt = run_receipt(
+        Some(&reservation("started")),
+        Some(&native),
+        Some(json!({"state":"unreadable"})),
+    );
+    assert_eq!(receipt["state"], "unclassified");
+    assert!(receipt["reason"].as_str().unwrap().contains("unreadable"));
+    // K4a: every receipt carries the ledger fields, even without a row.
+    let none = run_receipt(None, None, None);
+    assert_eq!(none["ledgerState"], Value::Null);
+    assert_eq!(none["reservedTokens"], 0);
+    // G2: an undelivered exit still names its adapter.
+    let receipt = run_receipt(
+        Some(&reservation("started")),
+        Some(&launch("exited_undelivered", "kimi")),
+        None,
+    );
+    assert_eq!(receipt["provenance"]["provider"], "kimi");
+    assert_eq!(receipt["provenance"]["transport"], "interactive_pty");
+}
+
 #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
 async fn run_records_carry_a_cost_receipt_instead_of_unavailable() {
     let (_dir, store, project, root) = super::super::tests::fixture().await;
@@ -316,6 +371,7 @@ async fn run_records_carry_a_cost_receipt_instead_of_unavailable() {
     assert_eq!(usage["state"], "measured");
     assert_eq!(usage["tokens"], 200);
     assert_eq!(usage["provenance"]["source"], "trusted-provider-receipt");
+    assert_eq!(usage["provenance"]["measurement"], "trusted_receipt");
     assert_eq!(usage["provenance"]["observedAt"], observed);
     assert_eq!(snapshot["runs"][0]["tokens"]["usageState"], "measured");
 }
diff --git a/src-tauri/src/store/native_completion.rs b/src-tauri/src/store/native_completion.rs
index 8c45a63..ee8efcb 100644
--- a/src-tauri/src/store/native_completion.rs
+++ b/src-tauri/src/store/native_completion.rs
@@ -193,8 +193,12 @@ impl Store {
             .fetch_one(&mut *tx)
             .await
             .map_err(db)?;
-            // A body committed before usage provenance (W2-03) for this same
-            // capture replays unchanged; it is never rewritten.
+            // A body committed before usage provenance (W2-03) replays
+            // unchanged and is never rewritten. The old body carries no
+            // capture digest, so this matches on binding, host, receipt,
+            // exit and parsed token total only (review K3). The ledger
+            // replay below still compares the stored capture digest and
+            // fails closed on different bytes.
             let legacy = json!({"version":1,"state":"native_cleanup_confirmed","host":host,
                 "receipt":metadata,"observedAt":observed_at,
                 "usage": match usage { Some(tokens)=>json!({"state":"measured","tokens":tokens}), None=>json!({"state":"unavailable"}) }}).to_string();
```
