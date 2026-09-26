# Review-Auftrag (Stufe B): W2-04d — dispatch roles mapped to token budget purposes

- Paket: W2-04d (ProjectA, Tauri 2 agentic terminal, Rust/SQLite store)
- Kandidat: HEAD of branch `claude/w2-04d` (PR #15, stage B review; base `origin/main`)
- Autor-Instanz: Kimi k3 (du bist ein unabhängiger Reviewer eines anderen Anbieters)
- Quelle des Pakets: Report W2-04, Folge 4 — "Map roles to token budget
  purposes. Today the budget ledger allows a run only for `implementation`."
- Vorgabe: keine neue Migration, wenn vermeidbar.

## Kontext (nicht im Diff, aber nötig zum Urteil)

- `DispatchRole` (coordinator/implementer/reviewer/integrator) wird in
  `store/development_launches.rs::run_role` aus der Migration-14-Teamzuweisung
  abgeleitet und gegen die eingefrorene Root-Policy geprüft. Die Rolle eines
  Runs kann sich nach dem ersten Claim nicht mehr ändern.
- Die Tabelle `development_token_reservations` hat
  `CHECK(purpose IN ('planning','context','discovery','implementation','review','verification'))`
  — alle Zwecke existieren schon, daher keine Migration.
- `balance()`: `review`/`verification` sind "protected" und dürfen die
  Verification-Reserve (40 000 von 200 000 Tokens) aufbrauchen; alle anderen
  Zwecke teilen sich den Rest.
- `reserve_development_tokens` serialisiert über ein Schreibsperren-Update auf
  der Goal-Zeile; ein Run gehört zu genau einem Task/Goal.
- `consume_worker` läuft innerhalb von `consume_development_launch`, das
  `run_role` bereits erneut geprüft hat.

## Gewähltes Mapping (Kernfrage dieses Reviews)

coordinator → planning, implementer → implementation, reviewer → review,
integrator → verification.

## Regeln, gegen die geprüft wird (Auszug AGENTS.md)

- Beweismaßstab: Behauptungen nur mit Test-/Lauf-Beleg; fail-closed bei
  Sicherheitsgrenzen; keine Umgehung von Gates.
- Nahtstelle store/: genau ein Lane-Inhaber; Ledger-Writer werden nur von
  vertrauenswürdigen Diensten aufgerufen.
- Keine Secrets, keine neuen Abhängigkeiten ohne erlaubte Lizenz.

## Leitfragen

1. Ist das Rollen→Zweck-Mapping sinnvoll und fail-closed? Insbesondere:
   integrator → verification (geschützte Reserve) und coordinator → planning
   (ungeschützter Anteil) sind Ermessensentscheidungen — ist das vertretbar?
2. Die neue Invariante in `reserve_development_tokens`: Run-gebundene
   Reservierung nur für den gemappten Zweck, ein Run hält höchstens eine
   nicht-stornierte Reservierung (Code-Check statt Unique-Index, weil keine
   Migration). Ist der Check rassefest (Serialisierung über die Goal-Zeile)?
3. `consume_worker` und die Receipt-Abfrage `for_run` filtern nicht mehr auf
   `purpose='implementation'`. Bleibt die Eindeutigkeit gewahrt? Kann ein
   Worker dadurch fremdes Budget verbrauchen?
4. Idempotenz: Replay mit gleichem Schlüssel liefert die alte Zeile, bevor
   der Ein-Reservierung-pro-Run-Check greift. Ist die Reihenfolge korrekt?
5. Testabdeckung: fehlt ein kritischer Fall (z. B. Stornierung und
   Neu-Reservierung, Zweck-Mismatch beim Coordinator)?

## Ausgabeformat

Pro Befund: ID (fortlaufend), Schwere (hoch/mittel/niedrig), Datei:Zeile,
Begründung. Danach ein Urteil: freigeben / freigeben mit Auflagen / ablehnen.

## Vollständiger Diff (git diff origin/main...HEAD, nur src-tauri/)

```diff
diff --git a/src-tauri/src/store/development_budget.rs b/src-tauri/src/store/development_budget.rs
index 4003f9c..da8889a 100644
--- a/src-tauri/src/store/development_budget.rs
+++ b/src-tauri/src/store/development_budget.rs
@@ -1,6 +1,7 @@
 //! Root-wide token accounting. Only trusted services call the writers; agents
 //! cannot settle their own usage or manufacture an allowance through HTTP.
 //! Unknown usage retains the entire reservation across exits and restarts.
+use super::development_launches::{run_role, DispatchRole};
 use super::{new_id, now_unix_secs, Store};
 use crate::development_policy::{DevelopmentPolicy, TokenPolicy};
 use serde::{Deserialize, Serialize};
@@ -35,6 +36,17 @@ impl BudgetPurpose {
     fn protected(self) -> bool {
         matches!(self, Self::Review | Self::Verification)
     }
+    /// W2-04d: the one budget purpose a run dispatched in this role may hold.
+    /// Review and integration draw from the protected verification reserve;
+    /// coordination and implementation share the unprotected remainder.
+    pub fn for_dispatch_role(role: DispatchRole) -> Self {
+        match role {
+            DispatchRole::Coordinator => Self::Planning,
+            DispatchRole::Implementer => Self::Implementation,
+            DispatchRole::Reviewer => Self::Review,
+            DispatchRole::Integrator => Self::Verification,
+        }
+    }
 }
 
 #[derive(Debug, Clone, Serialize, FromRow)]
@@ -150,6 +162,10 @@ async fn event(tx: &mut Transaction<'_, Sqlite>, root: &str, detail: &str) -> Re
 
 impl Store {
     /// An allocation estimate is held, never reported as measured consumption.
+    /// A run-bound reservation is allowed only for the purpose the run's
+    /// dispatch role maps to (W2-04d, `BudgetPurpose::for_dispatch_role`), and
+    /// a run holds at most one non-cancelled reservation; implementation work
+    /// is never unbound.
     pub async fn reserve_development_tokens(
         &self,
         goal: &str,
@@ -161,7 +177,7 @@ impl Store {
         if key.trim().is_empty() || key.len() > 128 || !(1..=200_000).contains(&tokens) {
             return Err("invalid token reservation key or amount".into());
         }
-        if (purpose == BudgetPurpose::Implementation) != run.is_some() {
+        if purpose == BudgetPurpose::Implementation && run.is_none() {
             return Err("implementation token reservations require exactly one run binding".into());
         }
         let mut tx = self.pool.begin().await.map_err(db)?;
@@ -201,6 +217,24 @@ impl Store {
             if !valid {
                 return Err("token reservation run is stale or belongs to another goal".into());
             }
+            // The role is resolved inside this writer transaction, like the
+            // launch boundary does; the budget purpose must be the one the
+            // role maps to, never a caller-chosen one.
+            let role = run_role(&mut tx, run).await?;
+            let required = BudgetPurpose::for_dispatch_role(role);
+            if purpose != required {
+                return Err(format!(
+                    "run dispatches as {}, which holds {} budget, not {}",
+                    role.as_str(),
+                    required.name(),
+                    purpose.name()
+                ));
+            }
+            let (taken,): (bool,) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM development_token_reservations WHERE run_id=? AND state != 'cancelled')")
+                .bind(run).fetch_one(&mut *tx).await.map_err(db)?;
+            if taken {
+                return Err("development run already holds a token reservation".into());
+            }
         }
         let totals = balance(&mut tx, &root).await?;
         if totals.allowance.is_none() {
@@ -393,12 +427,21 @@ async fn start(tx: &mut Transaction<'_, Sqlite>, id: &str) -> Result<(), String>
     event(tx, &row.root_goal_id, id).await
 }
 
+/// A run holds at most one non-cancelled reservation (enforced in
+/// `reserve_development_tokens`), so the run-bound row is unique whatever
+/// purpose its dispatch role maps to.
 pub(super) async fn consume_worker(
     tx: &mut Transaction<'_, Sqlite>,
     run: &str,
 ) -> Result<(), String> {
-    let (id,): (String,) = sqlx::query_as("SELECT id FROM development_token_reservations WHERE run_id=? AND purpose='implementation' AND state='reserved'")
-        .bind(run).fetch_optional(&mut **tx).await.map_err(db)?.ok_or("development launch has no reserved token budget")?;
+    let (id,): (String,) = sqlx::query_as(
+        "SELECT id FROM development_token_reservations WHERE run_id=? AND state='reserved'",
+    )
+    .bind(run)
+    .fetch_optional(&mut **tx)
+    .await
+    .map_err(db)?
+    .ok_or("development launch has no reserved token budget")?;
     start(tx, &id).await
 }
 
@@ -745,4 +788,253 @@ mod tests {
             .unwrap();
         assert!(balance(&mut tx, &root).await.unwrap().allowance.is_none());
     }
+
+    /// W2-04d fixture: a run whose task carries a migration-14 team assignment
+    /// for `role`, claimed by the assignee. The default policy team
+    /// "development" permits all four dispatch roles. The owned path is
+    /// unique per role so several role runs can coexist under one root.
+    pub(super) async fn role_run(store: &Store, root: &str, role: &str) -> (String, i64) {
+        let task = store
+            .create_continuous_task(
+                root,
+                "role task",
+                None,
+                vec![format!("src/{role}.rs")],
+                vec![],
+            )
+            .await
+            .unwrap();
+        store
+            .assign_continuous_task(
+                &task.id,
+                crate::store::team_assignments::AssignmentRequest {
+                    team_id: "development".into(),
+                    role: role.into(),
+                    assignee: "owner".into(),
+                    expected_revision: 0,
+                },
+            )
+            .await
+            .unwrap();
+        let claim = store
+            .claim_continuous_task(&task.id, "owner", false)
+            .await
+            .unwrap();
+        let run = store
+            .record_development_run_intent(&task.id, "owner", claim.fence)
+            .await
+            .unwrap();
+        (run.id, claim.fence)
+    }
+
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn reviewer_run_reserves_review_budget_and_the_launch_consumes_it() {
+        let (_dir, store, _project, root) = fixture().await;
+        let (run, fence) = role_run(&store, &root, "reviewer").await;
+        let launch = store
+            .reserve_development_launch(&run, "owner", fence, "codex")
+            .await
+            .unwrap();
+        store.bind_development_launch_route(&run,"owner",fence,&serde_json::json!({"selection":{"resolved":{"profileId":"codex"}},"expiresAt":now_unix_secs()+600})).await.unwrap();
+        store
+            .bind_development_launch_baseline(&run, "owner", fence, &"a".repeat(40))
+            .await
+            .unwrap();
+        let reservation = store
+            .reserve_development_tokens(&root, "review", BudgetPurpose::Review, 10_000, Some(&run))
+            .await
+            .unwrap();
+        assert!(
+            store
+                .start_development_tokens(&reservation.id)
+                .await
+                .is_err(),
+            "worker budget starts with its launch, never by hand"
+        );
+        store
+            .consume_development_launch(&run, "owner", fence, &launch.worker_id, "session")
+            .await
+            .unwrap();
+        assert_eq!(totals(&store, &root).await.unresolved_operations, 1);
+        store
+            .record_development_process_exit(&launch.worker_id, "session", Some(0))
+            .await
+            .unwrap();
+        store
+            .settle_development_run_tokens(
+                &reservation.id,
+                RunUsageBinding {
+                    run_id: &run,
+                    session_id: "session",
+                },
+                500,
+                "final-receipt",
+                now_unix_secs(),
+            )
+            .await
+            .unwrap();
+        assert_eq!(totals(&store, &root).await.measured_tokens, 500);
+    }
+
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn run_budget_purpose_must_match_the_dispatch_role() {
+        let (_dir, store, _project, root) = fixture().await;
+        let (reviewer, _fence) = role_run(&store, &root, "reviewer").await;
+        for purpose in [
+            BudgetPurpose::Planning,
+            BudgetPurpose::Context,
+            BudgetPurpose::Discovery,
+            BudgetPurpose::Implementation,
+            BudgetPurpose::Verification,
+        ] {
+            assert!(
+                store
+                    .reserve_development_tokens(
+                        &root,
+                        &format!("mismatch-{}", purpose.name()),
+                        purpose,
+                        1000,
+                        Some(&reviewer)
+                    )
+                    .await
+                    .is_err(),
+                "a reviewer run must not reserve {purpose:?} budget"
+            );
+        }
+        let (implementer, _fence) = role_run(&store, &root, "implementer").await;
+        assert!(store
+            .reserve_development_tokens(
+                &root,
+                "wrong-review",
+                BudgetPurpose::Review,
+                1000,
+                Some(&implementer)
+            )
+            .await
+            .is_err());
+        assert!(store
+            .reserve_development_tokens(
+                &root,
+                "right",
+                BudgetPurpose::Implementation,
+                1000,
+                Some(&implementer)
+            )
+            .await
+            .is_ok());
+    }
+
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn coordinator_and_integrator_runs_bind_planning_and_verification() {
+        let (_dir, store, _project, root) = fixture().await;
+        let (coordinator, _fence) = role_run(&store, &root, "coordinator").await;
+        store
+            .reserve_development_tokens(
+                &root,
+                "planning",
+                BudgetPurpose::Planning,
+                50_000,
+                Some(&coordinator),
+            )
+            .await
+            .unwrap();
+        let (integrator, _fence) = role_run(&store, &root, "integrator").await;
+        store
+            .reserve_development_tokens(
+                &root,
+                "verification",
+                BudgetPurpose::Verification,
+                10_000,
+                Some(&integrator),
+            )
+            .await
+            .unwrap();
+        let balance = totals(&store, &root).await;
+        assert_eq!(balance.reserved_tokens, 60_000);
+        assert_eq!(balance.verification_remaining, 30_000);
+        assert_eq!(balance.implementation_available, 110_000);
+    }
+
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn a_run_holds_exactly_one_token_reservation() {
+        let (_dir, store, _project, root) = fixture().await;
+        let (run, _fence) = role_run(&store, &root, "reviewer").await;
+        let first = store
+            .reserve_development_tokens(&root, "review", BudgetPurpose::Review, 1000, Some(&run))
+            .await
+            .unwrap();
+        assert_eq!(
+            first.id,
+            store
+                .reserve_development_tokens(
+                    &root,
+                    "review",
+                    BudgetPurpose::Review,
+                    1000,
+                    Some(&run)
+                )
+                .await
+                .unwrap()
+                .id,
+            "idempotent replay returns the existing row"
+        );
+        assert!(store
+            .reserve_development_tokens(
+                &root,
+                "review-again",
+                BudgetPurpose::Review,
+                1000,
+                Some(&run)
+            )
+            .await
+            .is_err());
+    }
+
+    /// W2-04d review (glm-5.2 Befund 2, qwen ID 5): a cancelled reservation
+    /// frees the run; the next reservation and every run-bound reader ignore
+    /// the cancelled row.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn cancelled_run_reservation_frees_the_run_for_a_new_one() {
+        let (_dir, store, _project, root) = fixture().await;
+        let (run, _fence) = role_run(&store, &root, "reviewer").await;
+        let first = store
+            .reserve_development_tokens(&root, "review", BudgetPurpose::Review, 1000, Some(&run))
+            .await
+            .unwrap();
+        store.cancel_development_tokens(&first.id).await.unwrap();
+        let second = store
+            .reserve_development_tokens(
+                &root,
+                "review-new",
+                BudgetPurpose::Review,
+                2000,
+                Some(&run),
+            )
+            .await
+            .unwrap();
+        assert_ne!(first.id, second.id);
+        let mut tx = store.pool.begin().await.unwrap();
+        consume_worker(&mut tx, &run).await.unwrap();
+        tx.commit().await.unwrap();
+        let states: Vec<(String, String)> = sqlx::query_as(
+            "SELECT id, state FROM development_token_reservations WHERE run_id=? ORDER BY rowid",
+        )
+        .bind(&run)
+        .fetch_all(&store.pool)
+        .await
+        .unwrap();
+        assert_eq!(
+            states,
+            vec![
+                (first.id.clone(), "cancelled".to_string()),
+                (second.id.clone(), "started".to_string())
+            ],
+            "the launch consumes the live reservation, never the cancelled one"
+        );
+        let mut tx = store.pool.begin().await.unwrap();
+        let receipt = usage_receipt::for_run(&mut tx, &run, None).await.unwrap();
+        tx.commit().await.unwrap();
+        assert_eq!(receipt["reservedTokens"], 2000);
+        assert_eq!(receipt["ledgerState"], "started");
+    }
 }
diff --git a/src-tauri/src/store/development_usage_receipt.rs b/src-tauri/src/store/development_usage_receipt.rs
index 0a823f3..5e4e1ab 100644
--- a/src-tauri/src/store/development_usage_receipt.rs
+++ b/src-tauri/src/store/development_usage_receipt.rs
@@ -224,13 +224,14 @@ fn started_receipt(launch: Option<&DevelopmentLaunch>, capture_usage: Option<Val
     }
 }
 
-/// Reads the run's implementation reservation and stored capture receipt.
+/// Reads the run's token reservation (exactly one per run, whatever purpose
+/// its dispatch role maps to) and stored capture receipt.
 pub(in crate::store) async fn for_run(
     tx: &mut Transaction<'_, Sqlite>,
     run_id: &str,
     launch: Option<&DevelopmentLaunch>,
 ) -> Result<Value, String> {
-    let reservation: Option<TokenReservation> = sqlx::query_as("SELECT * FROM development_token_reservations WHERE run_id=? AND purpose='implementation' ORDER BY state='cancelled', created_at DESC, id DESC LIMIT 1")
+    let reservation: Option<TokenReservation> = sqlx::query_as("SELECT * FROM development_token_reservations WHERE run_id=? ORDER BY state='cancelled', created_at DESC, id DESC LIMIT 1")
         .bind(run_id).fetch_optional(&mut **tx).await.map_err(super::db)?;
     let usage: Option<Option<String>> = sqlx::query_scalar(
         "SELECT json_extract(result_json,'$.usage') FROM development_capture_results WHERE run_id=?",
diff --git a/src-tauri/src/store/development_usage_receipt_tests.rs b/src-tauri/src/store/development_usage_receipt_tests.rs
index 47afbdb..3d3ce07 100644
--- a/src-tauri/src/store/development_usage_receipt_tests.rs
+++ b/src-tauri/src/store/development_usage_receipt_tests.rs
@@ -375,3 +375,60 @@ async fn run_records_carry_a_cost_receipt_instead_of_unavailable() {
     assert_eq!(usage["provenance"]["observedAt"], observed);
     assert_eq!(snapshot["runs"][0]["tokens"]["usageState"], "measured");
 }
+
+/// W2-04d: a reviewer run's receipt shows its review reservation, not
+/// "not_reserved" — the ledger lookup is bound to the run, not to the
+/// implementation purpose.
+#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+async fn reviewer_run_receipt_shows_its_review_reservation() {
+    let (_dir, store, project, root) = super::super::tests::fixture().await;
+    let (run, fence) = super::super::tests::role_run(&store, &root, "reviewer").await;
+    let launch = store
+        .reserve_development_launch(&run, "owner", fence, "codex")
+        .await
+        .unwrap();
+    store.bind_development_launch_route(&run,"owner",fence,&serde_json::json!({"selection":{"resolved":{"profileId":"codex"}},"expiresAt":now_unix_secs()+600})).await.unwrap();
+    store
+        .bind_development_launch_baseline(&run, "owner", fence, &"a".repeat(40))
+        .await
+        .unwrap();
+    let reservation = store
+        .reserve_development_tokens(
+            &root,
+            "review",
+            crate::store::development_budget::BudgetPurpose::Review,
+            1000,
+            Some(&run),
+        )
+        .await
+        .unwrap();
+    store
+        .consume_development_launch(&run, "owner", fence, &launch.worker_id, "session")
+        .await
+        .unwrap();
+    store
+        .record_development_process_exit(&launch.worker_id, "session", Some(0))
+        .await
+        .unwrap();
+    let observed = now_unix_secs();
+    store
+        .settle_development_run_tokens(
+            &reservation.id,
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
+    assert_eq!(usage["state"], "measured", "{usage}");
+    assert_eq!(usage["tokens"], 200);
+    assert_eq!(usage["reservedTokens"], 1000);
+    assert_eq!(usage["ledgerState"], "settled");
+    assert_never_unavailable(usage);
+}
```
