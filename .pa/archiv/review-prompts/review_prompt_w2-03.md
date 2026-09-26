# Review request W2-03a: usage receipts with provenance per run (ProjectA, Tauri 2, Rust + SQLite)

You are an independent code reviewer from a different model vendor than the
author (Claude Code). Review the diff below for correctness and security
bugs. Report findings as a numbered list, each with: severity
(high/medium/low), file:line, what is wrong, a concrete failing scenario, and a
suggested fix. Say explicitly if you find nothing blocking. Do not restate the
diff.

## Background
- A root goal has a token ledger (`development_token_reservations`). Trusted
  services reserve before model work; a worker run's implementation
  reservation starts with its launch and is settled only by a trusted
  provider receipt bound to the run and its exact exited session. Unknown
  usage keeps the whole reservation forever; a process exit never means zero.
- The only trusted per-run collector is native `codex exec --json`: the app
  owns stdout and the exit handle (`native_completion.rs`,
  `commit_native_completion`). Before this change, its capture result stored
  `usage: {"state":"measured","tokens":N}` or a bare `{"state":"unavailable"}`,
  and the root balance reported `usageState: "unavailable"`.
- Task (docs/PLAN.md W2-03): "Usage-/Billing-Collectors je Adapter ...
  Abnahme: kein 'unavailable' mehr im Kostenbeleg". Where an adapter has no
  evidenced format, the collector must not be built speculatively; instead an
  honest, named provenance ("not reported by adapter") is required.
- Evidence per adapter: Codex JSON usage fields come from a real CLI smoke
  (input 32171, cached 17920, cache_write 0, output 203, reasoning 74). Kimi's
  PTY status line (raw fixture) only shows `context: 5% (42.7k/1M)`, i.e.
  context-window occupancy, not billed usage. OpenCode: only a prose note
  ("$0.00 spent, 17,336 tokens") without raw bytes. Claude: the statusLine
  hook gives account-wide 5h/7d rate-window percentages, not per-run tokens.
  PTY output is agent-controlled and must never settle the ledger.

## What this change does (W2-03a; Kimi/OpenCode collectors are W2-03b)
1. `UsageReceipt` (new `store/development_usage_receipt.rs`): `collect(route,
   stdout, exit)` returns Measured (codex native only), Rejected (named
   parser reason) or NotReported (provider/transport with a named reason).
   `to_json` adds provenance: collector, measurement live/none, source,
   sourceSha256, observedAt.
2. `complete_usage` returns a named `&'static str` reason per refusal instead
   of one generic string; acceptance rules are unchanged.
3. `commit_native_completion` stores the receipt under `usage`, adds
   `usageState` to the completion event, and uses the receipt's ledger
   source for settlement. On replay, a body in the exact pre-change
   serialization for the same capture is accepted and kept unchanged; any
   other difference is still a conflict.
4. `development_records_snapshot` adds `usage` per run via `run_receipt`
   (pure) / `for_run` (reads the run's implementation reservation and the
   stored capture `usage`).
5. Root `usageState`: `no_allowance` / `no_receipts` / `partial` / `measured`.

Please look in particular at: whether any path can now settle the ledger that
could not before; replay determinism of the capture result (the stored JSON
string is compared byte-for-byte); the legacy-replay acceptance; whether
`run_receipt` can present something as measured that is not; and whether
reasons/provenance could mislead (e.g. "live").

## Diff

```diff
diff --git a/docs/development/CONTINUOUS.md b/docs/development/CONTINUOUS.md
index 7d76917..1bbe4c4 100644
--- a/docs/development/CONTINUOUS.md
+++ b/docs/development/CONTINUOUS.md
@@ -433,6 +433,45 @@ allocations block the root; actual overruns are recorded without hiding usage.
 These writers are not exposed to agent credentials. Provider receipt collection,
 supervisor integration and streaming enforcement still gate autonomous operation.
 
+`usageState` names why a root has no complete measurement: `no_allowance`
+(frozen root without `tokens`), `no_receipts`, `partial` or `measured`.
+
+### Per-run cost receipt and its provenance
+
+Every run in the development records snapshot carries `usage`, its cost
+receipt. It never says a bare `unavailable`; each state names its provenance:
+
+- `measured`: the ledger settled a trusted provider receipt. `tokens`, and
+  `provenance` with `measurement: "live"`, `source` and `observedAt`.
+- `rejected`: a collector exists but refused the capture, with a named
+  `reason` (for example `capture is truncated before a final newline`). The
+  reservation is retained; nothing settles.
+- `not_reported`: no trusted collector exists for the adapter and transport.
+  `reason` starts with `not reported by adapter:` and says what is missing;
+  `provenance` names provider and transport. The reservation is retained.
+- `pending` (not launched or still running), `cancelled`, `not_reserved`,
+  and `unclassified` for capture results recorded before this format.
+
+Each receipt also carries `ledgerState` and `reservedTokens`. Only `measured`
+settles; any other state keeps the entire reservation, as above.
+
+Collectors per adapter (W2-03a):
+
+| Adapter | Source | Collector |
+|---|---|---|
+| Codex, native `codex exec --json` | final `turn.completed` usage from process-owned stdout | `codex-exec-json-v1`, input plus output; cached and reasoning counts are checked subsets; nonzero cache-write counts are rejected |
+| Codex over the interactive PTY | none | `not_reported` |
+| Kimi | the PTY status line shows `context: N% (X/1M)`, i.e. context-window occupancy, not billed usage | `not_reported` |
+| OpenCode | no recorded status-line bytes exist yet (only a prose smoke note) | `not_reported`; needs a `PROJECTA_PTY_TRACE_DIR` probe |
+| Claude | the `statusLine` hook reports account-wide rate windows (live quota), not per-run tokens | `not_reported` |
+| Ollama | no per-run collector | `not_reported` |
+
+The native capture result stores the same receipt under `usage`, and the
+`development_capture_completed` event carries its `usageState`. A capture
+result committed before this format still replays unchanged: the stored
+legacy body is kept, never rewritten. A legacy `unavailable` body shows as
+`unclassified` in the run receipt.
+
 ## Discovery admission
 
 Migration 15 persists scan reservations per project and UTC calendar day. The
diff --git a/src-tauri/src/store/development_budget.rs b/src-tauri/src/store/development_budget.rs
index 58642ed..4003f9c 100644
--- a/src-tauri/src/store/development_budget.rs
+++ b/src-tauri/src/store/development_budget.rs
@@ -8,6 +8,8 @@ use sqlx::{FromRow, Sqlite, Transaction};
 
 #[path = "development_codex_usage.rs"]
 pub(super) mod codex_usage;
+#[path = "development_usage_receipt.rs"]
+pub(super) mod usage_receipt;
 
 #[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
 #[serde(rename_all = "snake_case")]
@@ -119,8 +121,11 @@ pub(super) async fn balance(
     Ok(TokenBalance {
         root_goal_id: root.into(),
         exhausted: policy.tokens.is_some() && measured >= maximum,
-        usage_state: if policy.tokens.is_none() || receipts == 0 {
-            "unavailable"
+        // Each state names why coverage is incomplete; never a bare gap.
+        usage_state: if policy.tokens.is_none() {
+            "no_allowance"
+        } else if receipts == 0 {
+            "no_receipts"
         } else if reserved > 0 {
             "partial"
         } else {
diff --git a/src-tauri/src/store/development_codex_usage.rs b/src-tauri/src/store/development_codex_usage.rs
index 69953aa..00b7671 100644
--- a/src-tauri/src/store/development_codex_usage.rs
+++ b/src-tauri/src/store/development_codex_usage.rs
@@ -1,6 +1,7 @@
 //! Ingestion for one completed native `codex exec --json` invocation. Callers
 //! must own stdout and the process exit handle; never pass worker-authored files
 //! or PTY text. This does not itself establish a trusted capture transport.
+use super::usage_receipt::CODEX_COLLECTOR;
 use super::{CaptureLaunchIdentity, RunUsageBinding, Store};
 use serde_json::Value;
 use sha2::{Digest, Sha256};
@@ -27,8 +28,9 @@ impl Store {
         {
             return Err("Codex usage does not match its exited provider launch".into());
         }
-        let tokens = complete_usage(stdout, exit_code)?;
-        let source = format!("codex-exec-json-v1:sha256:{:x}", Sha256::digest(stdout));
+        let tokens = complete_usage(stdout, exit_code)
+            .map_err(|reason| format!("Codex usage rejected: {reason}"))?;
+        let source = format!("{CODEX_COLLECTOR}:sha256:{:x}", Sha256::digest(stdout));
         self.settle_tokens_bound(
             reservation,
             tokens,
@@ -47,26 +49,32 @@ impl Store {
     }
 }
 
+/// Final usage of one complete capture, or the named reason it was refused.
+/// Any refusal keeps the whole reservation; nothing is ever settled as zero.
 pub(in crate::store) fn complete_usage(
     stdout: &[u8],
     exit_code: Option<i32>,
-) -> Result<i64, String> {
-    let invalid =
-        || "Codex usage unavailable: incomplete, conflicting or unsupported capture".to_string();
-    if exit_code != Some(0)
-        || stdout.is_empty()
-        || stdout.len() > 1_048_576
-        || !stdout.ends_with(b"\n")
-    {
-        return Err(invalid());
+) -> Result<i64, &'static str> {
+    const COUNT: &str = "usage count is missing, negative or not an integer";
+    if exit_code != Some(0) {
+        return Err("process exit code is not zero");
     }
-    let text = std::str::from_utf8(stdout).map_err(|_| invalid())?;
+    if stdout.is_empty() {
+        return Err("capture is empty");
+    }
+    if stdout.len() > 1_048_576 {
+        return Err("capture exceeds 1 MiB");
+    }
+    if !stdout.ends_with(b"\n") {
+        return Err("capture is truncated before a final newline");
+    }
+    let text = std::str::from_utf8(stdout).map_err(|_| "capture is not UTF-8")?;
     let mut stage = 0;
     let mut total = None;
     for line in text.lines().filter(|line| !line.trim().is_empty()) {
-        let event: Value = serde_json::from_str(line).map_err(|_| invalid())?;
+        let event: Value = serde_json::from_str(line).map_err(|_| "capture line is not JSON")?;
         if event.get("is_error").is_some_and(|v| v != false) {
-            return Err(invalid());
+            return Err("provider reported an error event");
         }
         match (stage, event["type"].as_str()) {
             (0, Some("thread.started"))
@@ -77,7 +85,7 @@ pub(in crate::store) fn complete_usage(
             (1, Some("turn.started")) => stage = 2,
             (2, Some("item.started" | "item.updated" | "item.completed")) => {
                 if !event["item"].is_object() {
-                    return Err(invalid());
+                    return Err("item event without an item object");
                 }
             }
             (2, Some("turn.completed")) => {
@@ -87,16 +95,16 @@ pub(in crate::store) fn complete_usage(
                     .get("cache_write_input_tokens")
                     .is_some_and(|v| v.as_i64() != Some(0))
                 {
-                    return Err(invalid());
+                    return Err("nonzero cache-write tokens are unsupported");
                 }
                 let input = usage["input_tokens"]
                     .as_i64()
                     .filter(|v| *v >= 0)
-                    .ok_or_else(invalid)?;
+                    .ok_or(COUNT)?;
                 let output = usage["output_tokens"]
                     .as_i64()
                     .filter(|v| *v >= 0)
-                    .ok_or_else(invalid)?;
+                    .ok_or(COUNT)?;
                 // Cached input and reasoning output are subsets, not extra spend.
                 for (key, upper) in [
                     ("cached_input_tokens", input),
@@ -104,20 +112,24 @@ pub(in crate::store) fn complete_usage(
                 ] {
                     if let Some(value) = usage.get(key) {
                         if !value.as_i64().is_some_and(|v| v >= 0 && v <= upper) {
-                            return Err(invalid());
+                            return Err(
+                                "cached or reasoning count is invalid or exceeds its total",
+                            );
                         }
                     }
                 }
                 total = input.checked_add(output).filter(|v| *v <= 1_000_000_000);
                 if total.is_none() {
-                    return Err(invalid());
+                    return Err("usage total exceeds the ledger limit");
                 }
                 stage = 3;
             }
-            _ => return Err(invalid()),
+            _ => return Err("unexpected or out-of-order event"),
         }
     }
-    total.filter(|_| stage == 3).ok_or_else(invalid)
+    total
+        .filter(|_| stage == 3)
+        .ok_or("no final turn.completed event")
 }
 
 #[cfg(test)]
diff --git a/src-tauri/src/store/development_codex_usage_tests.rs b/src-tauri/src/store/development_codex_usage_tests.rs
index 0bcf420..0f3c3b2 100644
--- a/src-tauri/src/store/development_codex_usage_tests.rs
+++ b/src-tauri/src/store/development_codex_usage_tests.rs
@@ -118,6 +118,62 @@ fn unavailable_or_impossible_counts_never_become_zero() {
     assert!(complete_usage(&vec![b'\n'; 1_048_577], Some(0)).is_err());
 }
 
+#[test]
+fn every_rejection_names_its_reason() {
+    let valid = stream(serde_json::json!({"input_tokens":3,"output_tokens":1}));
+    let mut failed = valid.clone();
+    failed.extend_from_slice(b"{\"type\":\"turn.failed\"}\n");
+    let cases: Vec<(Vec<u8>, Option<i32>, &str)> = vec![
+        (valid.clone(), Some(2), "process exit code is not zero"),
+        (Vec::new(), Some(0), "capture is empty"),
+        (vec![b'\n'; 1_048_577], Some(0), "capture exceeds 1 MiB"),
+        (
+            valid[..valid.len() - 1].to_vec(),
+            Some(0),
+            "capture is truncated before a final newline",
+        ),
+        (b"\xff\n".to_vec(), Some(0), "capture is not UTF-8"),
+        (b"{not json\n".to_vec(), Some(0), "capture line is not JSON"),
+        (failed, Some(0), "unexpected or out-of-order event"),
+        (
+            b"{\"type\":\"thread.started\",\"thread_id\":\"t\"}\n{\"type\":\"turn.started\"}\n{\"type\":\"item.started\",\"item\":null}\n".to_vec(),
+            Some(0),
+            "item event without an item object",
+        ),
+        (
+            stream(
+                serde_json::json!({"input_tokens":3,"output_tokens":1,"cache_write_input_tokens":2}),
+            ),
+            Some(0),
+            "nonzero cache-write tokens are unsupported",
+        ),
+        (
+            stream(serde_json::json!({"input_tokens":-3,"output_tokens":1})),
+            Some(0),
+            "usage count is missing, negative or not an integer",
+        ),
+        (
+            stream(serde_json::json!({"input_tokens":3,"output_tokens":1,"cached_input_tokens":4})),
+            Some(0),
+            "cached or reasoning count is invalid or exceeds its total",
+        ),
+        (
+            stream(serde_json::json!({"input_tokens":1_000_000_000,"output_tokens":1})),
+            Some(0),
+            "usage total exceeds the ledger limit",
+        ),
+        (
+            b"{\"type\":\"thread.started\",\"thread_id\":\"t\"}\n{\"type\":\"turn.started\"}\n"
+                .to_vec(),
+            Some(0),
+            "no final turn.completed event",
+        ),
+    ];
+    for (stdout, exit, reason) in cases {
+        assert_eq!(complete_usage(&stdout, exit), Err(reason));
+    }
+}
+
 #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
 async fn trusted_capture_settles_only_its_exited_codex_run() {
     let (_dir, store, _, root) = super::super::tests::fixture().await;
diff --git a/src-tauri/src/store/development_runs.rs b/src-tauri/src/store/development_runs.rs
index 1fd7031..2fed368 100644
--- a/src-tauri/src/store/development_runs.rs
+++ b/src-tauri/src/store/development_runs.rs
@@ -586,12 +586,21 @@ impl Store {
             // budget. This is a ledger balance, not inferred provider usage;
             // unknown receipts remain represented by `usageState`.
             let tokens = super::development_budget::balance(&mut tx, &run.root_goal_id).await?;
+            // The run's own cost receipt: a value with provenance, or a
+            // named reason why none exists (W2-03).
+            let usage = super::development_budget::usage_receipt::for_run(
+                &mut tx,
+                &run.id,
+                launch.as_ref(),
+            )
+            .await?;
             records.push(serde_json::json!({
                 "run": run,
                 "taskCheckpoint": checkpoint,
                 "launch": launch,
                 "executionIdentity": execution_identity,
                 "tokens": tokens,
+                "usage": usage,
                 "candidate": candidate,
                 "evidence": evidence,
                 "reviews": reviews,
diff --git a/src-tauri/src/store/development_usage_receipt.rs b/src-tauri/src/store/development_usage_receipt.rs
new file mode 100644
index 0000000..60b4c3a
--- /dev/null
+++ b/src-tauri/src/store/development_usage_receipt.rs
@@ -0,0 +1,222 @@
+//! Usage receipts with provenance for one development run: the value, the
+//! collector and source it came from, when it was observed and whether it is
+//! a live provider report. A run without a trusted collector carries a named
+//! `not_reported` provenance, never a silent gap. Only `measured` receipts
+//! settle the ledger; every other state keeps the whole reservation.
+use super::TokenReservation;
+use crate::store::development_launches::DevelopmentLaunch;
+use serde_json::{json, Value};
+use sha2::{Digest, Sha256};
+use sqlx::{Sqlite, Transaction};
+
+/// Versioned name of the only trusted per-run collector (native Codex JSON).
+pub(in crate::store) const CODEX_COLLECTOR: &str = "codex-exec-json-v1";
+pub(in crate::store) const CODEX_TRANSPORT: &str = "native_codex_exec_json";
+
+/// Collector outcome for one exited provider process.
+#[derive(Debug, Clone, PartialEq, Eq)]
+pub(in crate::store) enum UsageReceipt {
+    /// Final provider-reported usage, read live from process-owned stdout.
+    Measured { tokens: i64, source_sha256: String },
+    /// The collector refused the capture; the reservation is retained.
+    Rejected {
+        reason: &'static str,
+        source_sha256: String,
+    },
+    /// No trusted collector exists for this adapter and transport.
+    NotReported { provider: String, transport: String },
+}
+
+impl UsageReceipt {
+    /// Classify one exited provider process from its stored route and its
+    /// process-owned stdout. Only native Codex JSON has a trusted collector.
+    pub(in crate::store) fn collect(route: &Value, stdout: &[u8], exit_code: Option<i32>) -> Self {
+        let (provider, transport) = route_adapter(route);
+        if provider != "codex" || transport != CODEX_TRANSPORT {
+            return Self::NotReported {
+                provider: provider.into(),
+                transport: transport.into(),
+            };
+        }
+        let source_sha256 = format!("{:x}", Sha256::digest(stdout));
+        match super::codex_usage::complete_usage(stdout, exit_code) {
+            Ok(tokens) => Self::Measured {
+                tokens,
+                source_sha256,
+            },
+            Err(reason) => Self::Rejected {
+                reason,
+                source_sha256,
+            },
+        }
+    }
+
+    pub(in crate::store) fn tokens(&self) -> Option<i64> {
+        match self {
+            Self::Measured { tokens, .. } => Some(*tokens),
+            _ => None,
+        }
+    }
+
+    pub(in crate::store) fn state(&self) -> &'static str {
+        match self {
+            Self::Measured { .. } => "measured",
+            Self::Rejected { .. } => "rejected",
+            Self::NotReported { .. } => "not_reported",
+        }
+    }
+
+    /// Ledger `source` for a measured receipt: collector plus capture digest.
+    pub(in crate::store) fn ledger_source(&self) -> Option<String> {
+        match self {
+            Self::Measured { source_sha256, .. } => {
+                Some(format!("{CODEX_COLLECTOR}:sha256:{source_sha256}"))
+            }
+            _ => None,
+        }
+    }
+
+    pub(in crate::store) fn to_json(&self, observed_at: Option<i64>) -> Value {
+        match self {
+            Self::Measured {
+                tokens,
+                source_sha256,
+            } => json!({"state":"measured","tokens":tokens,"reservation":"settled",
+                "provenance":{"collector":CODEX_COLLECTOR,"measurement":"live",
+                    "source":"process-owned stdout","sourceSha256":source_sha256,
+                    "observedAt":observed_at}}),
+            Self::Rejected {
+                reason,
+                source_sha256,
+            } => json!({"state":"rejected","reason":reason,"reservation":"retained",
+                "provenance":{"collector":CODEX_COLLECTOR,"measurement":"none",
+                    "source":"process-owned stdout","sourceSha256":source_sha256,
+                    "observedAt":observed_at}}),
+            Self::NotReported {
+                provider,
+                transport,
+            } => json!({"state":"not_reported",
+                "reason":not_reported_reason(provider, transport),"reservation":"retained",
+                "provenance":{"collector":null,"measurement":"none","provider":provider,
+                    "transport":transport,"observedAt":observed_at}}),
+        }
+    }
+}
+
+fn route_adapter(route: &Value) -> (&str, &str) {
+    (
+        route["selection"]["resolved"]["provider"]
+            .as_str()
+            .unwrap_or("unknown"),
+        route["preparedInvocation"]["transport"]
+            .as_str()
+            .unwrap_or("unknown"),
+    )
+}
+
+/// Why an adapter has no trusted collector, as observed so far. Each text
+/// names the missing source instead of claiming usage is unknowable.
+fn not_reported_reason(provider: &str, transport: &str) -> String {
+    let detail = match provider {
+        "codex" => format!(
+            "Codex reports usage only through native `codex exec --json`; this run used {transport}"
+        ),
+        "kimi" => "Kimi's PTY status line shows context-window occupancy \
+            (`context: N% (X/1M)`), not billed usage"
+            .into(),
+        "opencode" => "no recorded OpenCode status-line bytes exist to parse; \
+            a PTY trace probe is missing"
+            .into(),
+        "claude" => "Claude's statusLine hook reports account-wide rate windows \
+            (live quota), not per-run tokens"
+            .into(),
+        "ollama" => "no per-run usage collector exists for local Ollama".into(),
+        _ => format!("no trusted usage collector for provider {provider} over {transport}"),
+    };
+    format!("not reported by adapter: {detail}")
+}
+
+/// The per-run cost receipt of the run read model. Pure, so every state is
+/// testable without a database.
+pub(in crate::store) fn run_receipt(
+    reservation: Option<&TokenReservation>,
+    launch: Option<&DevelopmentLaunch>,
+    capture_usage: Option<Value>,
+) -> Value {
+    let Some(reservation) = reservation else {
+        return json!({"state":"not_reserved",
+            "reason":"run holds no implementation token reservation"});
+    };
+    let mut receipt = match reservation.state.as_str() {
+        "settled" => json!({"state":"measured","tokens":reservation.actual_tokens,
+            "provenance":{"measurement":"live","source":reservation.source,
+                "observedAt":reservation.observed_at}}),
+        "cancelled" => json!({"state":"cancelled",
+            "reason":"reservation cancelled before work started"}),
+        "reserved" => json!({"state":"pending",
+            "reason":"run has not launched; reservation held"}),
+        _ => started_receipt(launch, capture_usage),
+    };
+    receipt["ledgerState"] = reservation.state.clone().into();
+    receipt["reservedTokens"] = reservation.reserved_tokens.into();
+    receipt
+}
+
+fn started_receipt(launch: Option<&DevelopmentLaunch>, capture_usage: Option<Value>) -> Value {
+    if let Some(usage) = capture_usage {
+        return match usage["state"].as_str() {
+            Some("rejected" | "not_reported") => usage,
+            Some("measured") => json!({"state":"unclassified",
+                "reason":"capture reported usage but the ledger has not settled it"}),
+            _ => json!({"state":"unclassified",
+                "reason":"capture recorded before usage provenance; collector outcome was not retained"}),
+        };
+    }
+    match launch {
+        Some(launch) if launch.state == "exited_undelivered" => json!({"state":"not_reported",
+            "reason":"not reported by adapter: provider exited before its input was delivered",
+            "reservation":"retained",
+            "provenance":{"collector":null,"measurement":"none","observedAt":launch.exited_at}}),
+        Some(launch) if launch.state == "exited" => {
+            let route: Value = launch
+                .route_json
+                .as_deref()
+                .and_then(|raw| serde_json::from_str(raw).ok())
+                .unwrap_or(Value::Null);
+            let (provider, transport) = route_adapter(&route);
+            UsageReceipt::NotReported {
+                provider: provider.into(),
+                transport: transport.into(),
+            }
+            .to_json(launch.exited_at)
+        }
+        _ => json!({"state":"pending",
+            "reason":"run is still executing; final usage not yet observable"}),
+    }
+}
+
+/// Reads the run's implementation reservation and stored capture receipt.
+pub(in crate::store) async fn for_run(
+    tx: &mut Transaction<'_, Sqlite>,
+    run_id: &str,
+    launch: Option<&DevelopmentLaunch>,
+) -> Result<Value, String> {
+    let reservation: Option<TokenReservation> = sqlx::query_as("SELECT * FROM development_token_reservations WHERE run_id=? AND purpose='implementation' ORDER BY state='cancelled', created_at DESC, id DESC LIMIT 1")
+        .bind(run_id).fetch_optional(&mut **tx).await.map_err(super::db)?;
+    let usage: Option<Option<String>> = sqlx::query_scalar(
+        "SELECT json_extract(result_json,'$.usage') FROM development_capture_results WHERE run_id=?",
+    )
+    .bind(run_id)
+    .fetch_optional(&mut **tx)
+    .await
+    .map_err(super::db)?;
+    // An unreadable stored receipt is shown as unclassified, never dropped.
+    let usage = usage
+        .flatten()
+        .map(|raw| serde_json::from_str(&raw).unwrap_or_else(|_| json!({"state":"unreadable"})));
+    Ok(run_receipt(reservation.as_ref(), launch, usage))
+}
+
+#[cfg(test)]
+#[path = "development_usage_receipt_tests.rs"]
+mod tests;
diff --git a/src-tauri/src/store/development_usage_receipt_tests.rs b/src-tauri/src/store/development_usage_receipt_tests.rs
new file mode 100644
index 0000000..db20872
--- /dev/null
+++ b/src-tauri/src/store/development_usage_receipt_tests.rs
@@ -0,0 +1,321 @@
+use super::*;
+use crate::store::development_budget::{RunUsageBinding, TokenReservation};
+use crate::store::now_unix_secs;
+use sha2::{Digest, Sha256};
+
+fn route(provider: &str, transport: &str) -> Value {
+    json!({"selection":{"resolved":{"provider":provider,"profileId":provider}},
+        "preparedInvocation":{"transport":transport}})
+}
+
+/// Field values from the direct Codex CLI 0.153 probe of 2026-09-11
+/// (`.pa/provider-smokes/codex-file-2026-09-11T15-43-50-463Z.json`,
+/// `reportedUsage`), in the event order that probe recorded.
+const CODEX_SMOKE: &[u8] = b"{\"type\":\"thread.started\",\"thread_id\":\"smoke-thread\"}\n\
+{\"type\":\"turn.started\"}\n\
+{\"type\":\"item.completed\",\"item\":{\"id\":\"item_0\",\"type\":\"agent_message\",\"text\":\"PA_CODEX_OK\"}}\n\
+{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":32171,\"cached_input_tokens\":17920,\"cache_write_input_tokens\":0,\"output_tokens\":203,\"reasoning_output_tokens\":74}}\n";
+
+fn assert_never_unavailable(receipt: &Value) {
+    let text = receipt.to_string();
+    assert!(
+        !text.contains("unavailable"),
+        "a cost receipt must name its provenance: {text}"
+    );
+}
+
+#[test]
+fn codex_json_receipt_names_its_live_provenance() {
+    let receipt = UsageReceipt::collect(&route("codex", CODEX_TRANSPORT), CODEX_SMOKE, Some(0));
+    assert_eq!(receipt.tokens(), Some(32_374));
+    assert_eq!(receipt.state(), "measured");
+    let sha = format!("{:x}", Sha256::digest(CODEX_SMOKE));
+    assert_eq!(
+        receipt.ledger_source().unwrap(),
+        format!("codex-exec-json-v1:sha256:{sha}")
+    );
+    let json = receipt.to_json(Some(1_700_000_000));
+    assert_eq!(json["state"], "measured");
+    assert_eq!(json["tokens"], 32_374);
+    assert_eq!(json["reservation"], "settled");
+    assert_eq!(json["provenance"]["collector"], CODEX_COLLECTOR);
+    assert_eq!(json["provenance"]["measurement"], "live");
+    assert_eq!(json["provenance"]["source"], "process-owned stdout");
+    assert_eq!(json["provenance"]["sourceSha256"], sha);
+    assert_eq!(json["provenance"]["observedAt"], 1_700_000_000);
+    assert_never_unavailable(&json);
+}
+
+#[test]
+fn rejected_and_partial_codex_captures_fail_closed_with_a_named_reason() {
+    let truncated = &CODEX_SMOKE[..CODEX_SMOKE.len() - 1];
+    let mut error = CODEX_SMOKE.to_vec();
+    error.extend_from_slice(b"{\"type\":\"error\",\"message\":\"stream disconnected\"}\n");
+    let mut flagged = CODEX_SMOKE.to_vec();
+    flagged.extend_from_slice(b"{\"type\":\"item.completed\",\"is_error\":true,\"item\":{}}\n");
+    let without_final = CODEX_SMOKE
+        .split_inclusive(|b| *b == b'\n')
+        .take(3)
+        .flatten()
+        .copied()
+        .collect::<Vec<u8>>();
+    let cases: [(&[u8], Option<i32>, &str); 7] = [
+        (CODEX_SMOKE, Some(1), "process exit code is not zero"),
+        (CODEX_SMOKE, None, "process exit code is not zero"),
+        (b"", Some(0), "capture is empty"),
+        (
+            truncated,
+            Some(0),
+            "capture is truncated before a final newline",
+        ),
+        (&error, Some(0), "unexpected or out-of-order event"),
+        (&flagged, Some(0), "provider reported an error event"),
+        (&without_final, Some(0), "no final turn.completed event"),
+    ];
+    for (stdout, exit, reason) in cases {
+        let receipt = UsageReceipt::collect(&route("codex", CODEX_TRANSPORT), stdout, exit);
+        assert_eq!(receipt.tokens(), None, "{reason}");
+        assert_eq!(receipt.ledger_source(), None, "{reason}");
+        assert_eq!(receipt.state(), "rejected", "{reason}");
+        let json = receipt.to_json(Some(5));
+        assert_eq!(json["state"], "rejected");
+        assert_eq!(json["reason"], reason);
+        assert_eq!(json["reservation"], "retained");
+        assert!(json.get("tokens").is_none());
+        assert_eq!(json["provenance"]["collector"], CODEX_COLLECTOR);
+        assert_eq!(json["provenance"]["measurement"], "none");
+        assert_eq!(
+            json["provenance"]["sourceSha256"],
+            format!("{:x}", Sha256::digest(stdout))
+        );
+        assert_never_unavailable(&json);
+    }
+}
+
+#[test]
+fn adapters_without_a_collector_report_a_named_provenance() {
+    let cases = [
+        ("kimi", "interactive_pty", "context-window occupancy"),
+        (
+            "opencode",
+            "interactive_pty",
+            "no recorded OpenCode status-line bytes",
+        ),
+        ("claude", "interactive_pty", "account-wide rate windows"),
+        ("ollama", "interactive_pty", "local Ollama"),
+        ("codex", "interactive_pty", "native `codex exec --json`"),
+        ("unknown", "unknown", "no trusted usage collector"),
+    ];
+    for (provider, transport, detail) in cases {
+        let receipt = UsageReceipt::collect(&route(provider, transport), CODEX_SMOKE, Some(0));
+        assert_eq!(receipt.tokens(), None, "{provider}");
+        assert_eq!(receipt.state(), "not_reported", "{provider}");
+        let json = receipt.to_json(Some(9));
+        assert_eq!(json["state"], "not_reported");
+        let reason = json["reason"].as_str().unwrap();
+        assert!(reason.starts_with("not reported by adapter: "), "{reason}");
+        assert!(reason.contains(detail), "{provider}: {reason}");
+        assert_eq!(json["reservation"], "retained");
+        assert!(json.get("tokens").is_none());
+        assert_eq!(json["provenance"]["collector"], Value::Null);
+        assert_eq!(json["provenance"]["measurement"], "none");
+        assert_eq!(json["provenance"]["provider"], provider);
+        assert_eq!(json["provenance"]["transport"], transport);
+        assert_eq!(json["provenance"]["observedAt"], 9);
+        assert_never_unavailable(&json);
+    }
+    // A route without a provider is not silently promoted to a collector.
+    let missing = UsageReceipt::collect(&json!({}), CODEX_SMOKE, Some(0));
+    assert_eq!(
+        missing,
+        UsageReceipt::NotReported {
+            provider: "unknown".into(),
+            transport: "unknown".into()
+        }
+    );
+}
+
+fn reservation(state: &str) -> TokenReservation {
+    TokenReservation {
+        id: "tr-1".into(),
+        root_goal_id: "root".into(),
+        goal_id: "root".into(),
+        idempotency_key: "k".into(),
+        purpose: "implementation".into(),
+        run_id: Some("run".into()),
+        reserved_tokens: 1000,
+        state: state.into(),
+        actual_tokens: (state == "settled").then_some(420),
+        source: (state == "settled").then(|| "codex-exec-json-v1:sha256:ab".into()),
+        observed_at: (state == "settled").then_some(77),
+        created_at: 1,
+        started_at: None,
+        settled_at: None,
+    }
+}
+
+fn launch(state: &str, provider: &str) -> DevelopmentLaunch {
+    DevelopmentLaunch {
+        run_id: "run".into(),
+        worker_id: "wk".into(),
+        project_id: "pj".into(),
+        profile_id: provider.into(),
+        repo_path: "repo".into(),
+        worktree_path: "wt".into(),
+        branch: "b".into(),
+        session_id: Some("session".into()),
+        state: state.into(),
+        reserved_at: 1,
+        spawning_at: Some(2),
+        exited_at: state.starts_with("exited").then_some(33),
+        exit_code: state.starts_with("exited").then_some(0),
+        route_json: Some(route(provider, "interactive_pty").to_string()),
+        route_expires_at: None,
+        baseline_commit: None,
+        process_instance: None,
+        exit_reason: None,
+    }
+}
+
+#[test]
+fn every_run_cost_receipt_names_its_state_and_provenance() {
+    let settled = run_receipt(Some(&reservation("settled")), None, None);
+    assert_eq!(settled["state"], "measured");
+    assert_eq!(settled["tokens"], 420);
+    assert_eq!(settled["ledgerState"], "settled");
+    assert_eq!(settled["reservedTokens"], 1000);
+    assert_eq!(settled["provenance"]["measurement"], "live");
+    assert_eq!(
+        settled["provenance"]["source"],
+        "codex-exec-json-v1:sha256:ab"
+    );
+    assert_eq!(settled["provenance"]["observedAt"], 77);
+
+    let exited = launch("exited", "kimi");
+    let pty = run_receipt(Some(&reservation("started")), Some(&exited), None);
+    assert_eq!(pty["state"], "not_reported");
+    assert!(pty["reason"]
+        .as_str()
+        .unwrap()
+        .contains("context-window occupancy"));
+    assert_eq!(pty["ledgerState"], "started");
+    assert_eq!(pty["reservedTokens"], 1000);
+    assert_eq!(pty["provenance"]["observedAt"], 33);
+
+    let rejected = UsageReceipt::Rejected {
+        reason: "capture is empty",
+        source_sha256: "ff".into(),
+    }
+    .to_json(Some(40));
+    let stored = run_receipt(
+        Some(&reservation("started")),
+        Some(&launch("exited", "codex")),
+        Some(rejected),
+    );
+    assert_eq!(stored["state"], "rejected");
+    assert_eq!(stored["reason"], "capture is empty");
+    assert_eq!(stored["ledgerState"], "started");
+
+    // Capture results written before this receipt format are named, not
+    // passed through as a bare "unavailable".
+    let legacy = run_receipt(
+        Some(&reservation("started")),
+        Some(&launch("exited", "codex")),
+        Some(json!({"state":"unavailable"})),
+    );
+    assert_eq!(legacy["state"], "unclassified");
+
+    let undelivered = run_receipt(
+        Some(&reservation("started")),
+        Some(&launch("exited_undelivered", "codex")),
+        None,
+    );
+    assert_eq!(undelivered["state"], "not_reported");
+    assert!(undelivered["reason"]
+        .as_str()
+        .unwrap()
+        .contains("before its input was delivered"));
+
+    let running = run_receipt(
+        Some(&reservation("started")),
+        Some(&launch("spawning", "kimi")),
+        None,
+    );
+    assert_eq!(running["state"], "pending");
+    assert_eq!(
+        run_receipt(Some(&reservation("reserved")), None, None)["state"],
+        "pending"
+    );
+    assert_eq!(
+        run_receipt(Some(&reservation("cancelled")), None, None)["state"],
+        "cancelled"
+    );
+    assert_eq!(run_receipt(None, None, None)["state"], "not_reserved");
+
+    for receipt in [
+        settled,
+        pty,
+        stored,
+        legacy,
+        undelivered,
+        running,
+        run_receipt(None, None, None),
+    ] {
+        assert!(receipt["reason"].is_string() || receipt["state"] == "measured");
+        assert_never_unavailable(&receipt);
+    }
+}
+
+#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+async fn run_records_carry_a_cost_receipt_instead_of_unavailable() {
+    let (_dir, store, project, root) = super::super::tests::fixture().await;
+    let (reservation, run, worker) =
+        super::super::usage_binding_tests::launched(&store, &root).await;
+    // Root balance before any receipt names why nothing is measured yet.
+    let snapshot = store.development_records_snapshot(&project).await.unwrap();
+    assert_eq!(snapshot["runs"][0]["tokens"]["usageState"], "no_receipts");
+    assert_eq!(snapshot["runs"][0]["usage"]["state"], "pending");
+    sqlx::query("UPDATE development_launches SET route_json=? WHERE run_id=?")
+        .bind(route("kimi", "interactive_pty").to_string())
+        .bind(&run)
+        .execute(&store.pool)
+        .await
+        .unwrap();
+    store
+        .record_development_process_exit(&worker, "session", Some(0))
+        .await
+        .unwrap();
+    let snapshot = store.development_records_snapshot(&project).await.unwrap();
+    let usage = &snapshot["runs"][0]["usage"];
+    assert_eq!(usage["state"], "not_reported", "{usage}");
+    assert!(usage["reason"]
+        .as_str()
+        .unwrap()
+        .contains("context-window occupancy"));
+    assert_eq!(usage["reservedTokens"], 1000);
+    assert_eq!(usage["ledgerState"], "started");
+    assert_never_unavailable(usage);
+    assert_never_unavailable(&snapshot["runs"][0]["tokens"]);
+
+    let observed = now_unix_secs();
+    store
+        .settle_development_run_tokens(
+            &reservation,
+            RunUsageBinding {
+                run_id: &run,
+                session_id: "session",
+            },
+            200,
+            "trusted-provider-receipt",
+            observed,
+        )
+        .await
+        .unwrap();
+    let snapshot = store.development_records_snapshot(&project).await.unwrap();
+    let usage = &snapshot["runs"][0]["usage"];
+    assert_eq!(usage["state"], "measured");
+    assert_eq!(usage["tokens"], 200);
+    assert_eq!(usage["provenance"]["source"], "trusted-provider-receipt");
+    assert_eq!(usage["provenance"]["observedAt"], observed);
+    assert_eq!(snapshot["runs"][0]["tokens"]["usageState"], "measured");
+}
diff --git a/src-tauri/src/store/native_completion.rs b/src-tauri/src/store/native_completion.rs
index f458390..8c45a63 100644
--- a/src-tauri/src/store/native_completion.rs
+++ b/src-tauri/src/store/native_completion.rs
@@ -1,6 +1,7 @@
 //! Final native authority is an opaque value returned only after host cleanup.
 //! Provisional checkpoint JSON is never accepted as that authority.
 use super::*;
+use crate::store::development_budget::usage_receipt::UsageReceipt;
 use crate::store::development_budget::{self, CaptureLaunchIdentity, RunUsageBinding};
 
 struct ClosingBinding {
@@ -168,17 +169,14 @@ impl Store {
         }
         let resolved: Value = serde_json::from_str(&route).map_err(|_| "invalid stored route")?;
         let exit_code = reply.capture.exit_code as i32; // Preserve the Windows DWORD bit pattern.
-        let usage = if resolved["selection"]["resolved"]["provider"] == "codex"
-            && resolved["preparedInvocation"]["transport"] == "native_codex_exec_json"
-        {
-            development_budget::codex_usage::complete_usage(&reply.capture.stdout, Some(exit_code))
-                .ok()
-        } else {
-            None
-        };
-        let result = json!({"version":1,"state":"native_cleanup_confirmed","host":host,
+                                                        // The cost receipt always names its provenance: measured, rejected by
+                                                        // the collector, or not reported by an adapter without one.
+        let receipt = UsageReceipt::collect(&resolved, &reply.capture.stdout, Some(exit_code));
+        let usage = receipt.tokens();
+        let mut result = json!({"version":1,"state":"native_cleanup_confirmed","host":host,
             "receipt":metadata,"observedAt":observed_at,
-            "usage": match usage { Some(tokens)=>json!({"state":"measured","tokens":tokens}), None=>json!({"state":"unavailable"}) }}).to_string();
+            "usage": receipt.to_json(Some(observed_at))})
+        .to_string();
         let previous: Option<String> = sqlx::query_scalar(
             "SELECT result_json FROM development_capture_results WHERE run_id=?",
         )
@@ -195,6 +193,14 @@ impl Store {
             .fetch_one(&mut *tx)
             .await
             .map_err(db)?;
+            // A body committed before usage provenance (W2-03) for this same
+            // capture replays unchanged; it is never rewritten.
+            let legacy = json!({"version":1,"state":"native_cleanup_confirmed","host":host,
+                "receipt":metadata,"observedAt":observed_at,
+                "usage": match usage { Some(tokens)=>json!({"state":"measured","tokens":tokens}), None=>json!({"state":"unavailable"}) }}).to_string();
+            if previous == legacy {
+                result = legacy;
+            }
             if previous != result || !same_exit {
                 return Err("native completion conflicts with prior result".into());
             }
@@ -211,8 +217,8 @@ impl Store {
                 .map_err(db)?;
             sqlx::query("INSERT INTO development_capture_results(run_id,result_json,observed_at) VALUES(?,?,?)")
                 .bind(&owner.binding.run_id).bind(&result).bind(observed_at).execute(&mut *tx).await.map_err(db)?;
-            sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) SELECT project_id,'development_capture_completed',json_object('version',1,'runId',run_id,'usageAvailable',?),unixepoch() FROM development_launches WHERE run_id=?")
-                .bind(usage.is_some()).bind(&owner.binding.run_id).execute(&mut *tx).await.map_err(db)?;
+            sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) SELECT project_id,'development_capture_completed',json_object('version',1,'runId',run_id,'usageAvailable',?,'usageState',?),unixepoch() FROM development_launches WHERE run_id=?")
+                .bind(usage.is_some()).bind(receipt.state()).bind(&owner.binding.run_id).execute(&mut *tx).await.map_err(db)?;
         }
         crate::store::development_identity::append_native_unknown(
             &mut tx,
@@ -224,10 +230,9 @@ impl Store {
         if let Some(tokens) = usage {
             let reservation:String=sqlx::query_scalar("SELECT id FROM development_token_reservations WHERE run_id=? AND purpose='implementation' AND state!='cancelled'")
                 .bind(&owner.binding.run_id).fetch_one(&mut *tx).await.map_err(db)?;
-            let source = format!(
-                "codex-exec-json-v1:sha256:{}",
-                digest(&reply.capture.stdout)
-            );
+            let source = receipt
+                .ledger_source()
+                .ok_or("measured usage without a ledger source")?;
             development_budget::settle_bound(
                 &mut tx,
                 &reservation,
@@ -863,6 +868,26 @@ mod tests {
                 .await
                 .unwrap();
         assert_eq!(measured, 15);
+        let result: String =
+            sqlx::query_scalar("SELECT result_json FROM development_capture_results")
+                .fetch_one(&store.pool)
+                .await
+                .unwrap();
+        let usage = &serde_json::from_str::<Value>(&result).unwrap()["usage"];
+        assert_eq!(usage["state"], "measured");
+        assert_eq!(usage["tokens"], 15);
+        assert_eq!(usage["provenance"]["collector"], "codex-exec-json-v1");
+        assert_eq!(usage["provenance"]["measurement"], "live");
+        assert_eq!(usage["provenance"]["sourceSha256"], digest(USAGE));
+        let source: String =
+            sqlx::query_scalar("SELECT source FROM development_token_reservations")
+                .fetch_one(&store.pool)
+                .await
+                .unwrap();
+        assert_eq!(
+            source,
+            format!("codex-exec-json-v1:sha256:{}", digest(USAGE))
+        );
         let run: String = sqlx::query_scalar("SELECT status FROM development_runs")
             .fetch_one(&store.pool)
             .await
@@ -876,11 +901,81 @@ mod tests {
         assert!(commit(&store, &owner, &reply, now).await.is_err());
     }
     #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn pre_provenance_capture_results_replay_unchanged() {
+        for (stdout, legacy_usage) in [
+            (USAGE, json!({"state":"measured","tokens":15})),
+            (b"partial".as_slice(), json!({"state":"unavailable"})),
+        ] {
+            let (_dir, store, owner, reply, now) =
+                fixture("native_codex_exec_json", stdout, 0).await;
+            commit(&store, &owner, &reply, now).await.unwrap();
+            // Rewrite the stored body into the exact pre-W2-03 serialization.
+            let stored: String =
+                sqlx::query_scalar("SELECT result_json FROM development_capture_results")
+                    .fetch_one(&store.pool)
+                    .await
+                    .unwrap();
+            let mut legacy: Value = serde_json::from_str(&stored).unwrap();
+            legacy["usage"] = legacy_usage.clone();
+            let legacy = legacy.to_string();
+            sqlx::query("UPDATE development_capture_results SET result_json=?")
+                .bind(&legacy)
+                .execute(&store.pool)
+                .await
+                .unwrap();
+            sqlx::query("DROP TRIGGER development_identity_observation_no_delete")
+                .execute(&store.pool)
+                .await
+                .unwrap();
+            sqlx::query("DELETE FROM development_identity_observations WHERE sequence=2")
+                .execute(&store.pool)
+                .await
+                .unwrap();
+            commit(&store, &owner, &reply, now).await.unwrap();
+            let after: String =
+                sqlx::query_scalar("SELECT result_json FROM development_capture_results")
+                    .fetch_one(&store.pool)
+                    .await
+                    .unwrap();
+            assert_eq!(after, legacy, "a legacy body is never rewritten");
+            // Any other legacy usage for this capture is still a conflict.
+            let mut forged: Value = serde_json::from_str(&legacy).unwrap();
+            forged["usage"] = json!({"state":"measured","tokens":16});
+            sqlx::query("UPDATE development_capture_results SET result_json=?")
+                .bind(forged.to_string())
+                .execute(&store.pool)
+                .await
+                .unwrap();
+            assert!(commit(&store, &owner, &reply, now)
+                .await
+                .unwrap_err()
+                .contains("conflicts with prior result"));
+        }
+    }
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
     async fn native_completion_unknown_usage_retains_reserved_capacity() {
-        for (transport, stdout, exit) in [
-            ("interactive_pty", USAGE, 0),
-            ("native_codex_exec_json", USAGE, 1),
-            ("native_codex_exec_json", b"partial".as_slice(), 0),
+        for (transport, stdout, exit, receipt, reason) in [
+            (
+                "interactive_pty",
+                USAGE,
+                0,
+                "not_reported",
+                "not reported by adapter: Codex reports usage only through native `codex exec --json`; this run used interactive_pty",
+            ),
+            (
+                "native_codex_exec_json",
+                USAGE,
+                1,
+                "rejected",
+                "process exit code is not zero",
+            ),
+            (
+                "native_codex_exec_json",
+                b"partial".as_slice(),
+                0,
+                "rejected",
+                "capture is truncated before a final newline",
+            ),
         ] {
             let (_dir, store, owner, reply, now) = fixture(transport, stdout, exit).await;
             commit(&store, &owner, &reply, now).await.unwrap();
@@ -890,9 +985,18 @@ mod tests {
                     .fetch_one(&store.pool)
                     .await
                     .unwrap();
+            let usage = &serde_json::from_str::<Value>(&result).unwrap()["usage"];
+            // The cost receipt names why nothing settled; never a bare gap.
+            assert_eq!(usage["state"], receipt);
+            assert_eq!(usage["reason"], reason);
+            assert_eq!(usage["reservation"], "retained");
+            assert_eq!(usage["provenance"]["observedAt"], now);
+            assert!(!usage.to_string().contains("unavailable"), "{usage}");
+            let event: String = sqlx::query_scalar("SELECT detail FROM continuous_events WHERE kind='development_capture_completed'")
+                .fetch_one(&store.pool).await.unwrap();
             assert_eq!(
-                serde_json::from_str::<Value>(&result).unwrap()["usage"]["state"],
-                "unavailable"
+                serde_json::from_str::<Value>(&event).unwrap()["usageState"],
+                receipt
             );
         }
     }
diff --git a/src-tauri/src/store/native_managed_tests.rs b/src-tauri/src/store/native_managed_tests.rs
index c0d34a2..12da348 100644
--- a/src-tauri/src/store/native_managed_tests.rs
+++ b/src-tauri/src/store/native_managed_tests.rs
@@ -120,7 +120,7 @@ async fn real_native_host_commits_checkpoints_before_registry_and_final_handler_
             assert_eq!(budget_state,"started");
             let result:Value=serde_json::from_str(&result_json).unwrap();
             assert_eq!(result["state"],"native_cleanup_confirmed");
-            assert_eq!(result["usage"]["state"],"unavailable");
+            assert_eq!(result["usage"]["state"],"not_reported");
             // Native sort proves completion/lifetime, never AI provider usage.
             Ok(())
         }).unwrap();
diff --git a/src-tauri/src/workers.rs b/src-tauri/src/workers.rs
index c021fb6..446aec9 100644
--- a/src-tauri/src/workers.rs
+++ b/src-tauri/src/workers.rs
@@ -3763,7 +3763,8 @@ mod tests {
         assert_eq!(exit, 2);
         assert_eq!(checkpoints, 4);
         let result: serde_json::Value = serde_json::from_str(&result).unwrap();
-        assert_eq!(result["usage"]["state"], "unavailable");
+        assert_eq!(result["usage"]["state"], "rejected");
+        assert_eq!(result["usage"]["reason"], "process exit code is not zero");
         let budget: String =
             sqlx::query_scalar("SELECT state FROM development_token_reservations WHERE run_id=?")
                 .bind(&run_id)
```
