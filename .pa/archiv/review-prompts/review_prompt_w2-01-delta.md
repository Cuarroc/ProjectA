# Delta-Review W2-01 (Runde 2)

Du bist ein anbieterfremder Reviewer (Autor: Claude Code, Anthropic). Repo
ProjectA, Rust/SQLite-Store (sqlx). Runde 1 lieferte die Befunde unten; der
Autor hat sie so disponiert. Pruefe (a) ob die angenommenen Befunde im Delta
korrekt behoben sind, (b) ob die Ablehnungen tragen, (c) ob das Delta neue
Fehler einfuehrt. Format: Tabelle ID/Schwere/Datei:Zeile/Befund/Vorschlag,
dann Gesamturteil "freigeben", "freigeben mit Auflagen" oder "nicht
freigeben". Erfinde keine Befunde.

## Dispositionen Runde 1

# W2-01 Review-Dispositionen

Reviews: `.pa/review_w2-01_kimi-k3.md`, `.pa/review_w2-01_glm-5.2.md`
(Runde 1, Kandidat `61ac634`). Delta-Runde: `.pa/review_w2-01-delta_*.md`
(Kandidat `beaf96e`). Jeder Befund wurde am Code geprueft.

| ID | Quelle | Schwere | Befund | Disposition |
|----|--------|---------|--------|-------------|
| K1 | kimi-k3 | hoch | Die Belegform `$.selection.resolved.provider` ist nicht gegen den echten Schreiber festgenagelt; die Testhilfe baute das JSON von Hand. | **Angenommen.** `launched_run` serialisiert jetzt die echten Typen `RouteDecision`/`ResolvedRoute` unter `"selection"`, genau wie `DevelopmentRoute::receipt` (`workers/development_route.rs:247`). Ein umbenanntes Feld bricht `reviewer_principal_comes_from_launch_records_not_caller_labels` (erwartet `verified:`). Commit `beaf96e`. |
| K2 | kimi-k3 | hoch | Mehrere Launch-Zeilen je Run machen den Anbieter nichtdeterministisch; abgelaufene Belege. | **Abgelehnt, belegt.** `development_launches.run_id` ist `PRIMARY KEY` (`development_launches.rs:44`), `route_json` wird einmalig gebunden (`route_json IS NULL`-Guard, `development_launches.rs:101`). Ablauf: `route_expires_at` begrenzt nur den Spawn; wer gestartet wurde, bleibt eine historische Tatsache. Bewusst so. |
| K3 | kimi-k3 | mittel | API-Semantik gekippt (Parameter heisst jetzt Reviewer-Run); Fehlerlabel noch `runId`. | **Teilweise angenommen.** Label heisst jetzt `reviewerRunId` (`beaf96e`). Eine Tauri-/HTTP-Route fuer Reviews existiert nicht (`record_development_review` hat nur Testaufrufer; grep ueber `src-tauri/src`, `src`, `scripts`); sie entsteht als Folgearbeit in `api.rs` und muss dort `reviewerRunId` heissen. |
| K4 | kimi-k3 | mittel | `verified` beweist Anbieter-, nicht Operator-Unabhaengigkeit; `worker_id`-Gleichheit pruefen. | **Doku angenommen, Pruefung abgelehnt.** `worker_id` ist `UNIQUE` und je Run genau eine Launch-Zeile; zwei verschiedene Runs koennen nie denselben `worker_id` haben, die Pruefung waere tot. Die Einschraenkung steht jetzt im Kommentar von `attest_reviewer`. Operator-Unabhaengigkeit ist W5-02d/W5-02e. |
| K5 | kimi-k3 | niedrig | Gleicher Anbieter wird auch fuer `changes_requested` abgelehnt; als Politik dokumentieren. | **Angenommen** (Kommentar an `attest_reviewer`, `beaf96e`). |
| K6 | kimi-k3 | niedrig | Testluecken: fremdes Projekt, gemischter Beleg. | **Angenommen.** Neuer Test `reviewer_principal_edge_cases_fail_closed` (gemischter Beleg → `unverified:`, fremdes Projekt → Fehler, fremder Reviewer erbt keinen Idempotenz-Schluessel). |
| G1 | glm-5.2 | niedrig | `json_valid`/`json_extract` brauchen JSON1. | **Abgelehnt, belegt.** Der Store nutzt JSON1 bereits in Produktion (`json_each` in `agent_run_context`, `json_extract`/`json_set` in anderen Modulen und Tests); der ganze Store-Testlauf ist gruen. |
| G2 | glm-5.2 | niedrig | `SINGLE_VENDOR_PROVIDERS` ist hart kodiert und muss gepflegt werden. | **Zur Kenntnis, keine Aenderung.** Ein neuer Anbieter faellt sicher auf `unverified:`; das ist die gewollte Richtung. Folgearbeit im Report. |

Zaehlung Runde 1: 8 Befunde, davon 4 angenommen (K1, K5, K6, K3 teilweise),
1 nur als Doku angenommen (K4), 3 abgelehnt mit Beleg bzw. ohne Aenderung
(K2, G1, G2).

## Delta-Diff (61ac634..beaf96e)

```diff
```

## Gesamtdiff development_runs.rs gegen origin/main

```diff
diff --git a/src-tauri/src/store/development_runs.rs b/src-tauri/src/store/development_runs.rs
index 9831bbc..57e1833 100644
--- a/src-tauri/src/store/development_runs.rs
+++ b/src-tauri/src/store/development_runs.rs
@@ -114,9 +114,9 @@ impl ReviewDisposition {
     }
 }
 
-/// A review names the evidence that attests the candidate it reviewed. The
-/// reviewer and implementer identities are separate input fields so a caller
-/// cannot imply independence from a display label or provider family.
+/// A review names the evidence that attests the candidate it reviewed. It
+/// carries no reviewer or implementer identity: a caller could claim any label,
+/// so both principals are derived from the store (see `RunPrincipal`).
 #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
 #[serde(rename_all = "camelCase", deny_unknown_fields)]
 pub struct ReviewInput {
@@ -124,8 +124,6 @@ pub struct ReviewInput {
     pub evidence_id: String,
     pub candidate_commit: String,
     pub disposition: ReviewDisposition,
-    pub reviewer_identity: String,
-    pub implementer_identity: String,
     pub source: String,
     pub observed_at: i64,
 }
@@ -143,10 +141,12 @@ pub struct DevelopmentReview {
     pub implementer_identity: String,
     pub source: String,
     pub observed_at: i64,
-    /// Caller-supplied labels are recorded for audit, but do not attest an
-    /// independent reviewer principal.
+    /// `verified: ...` only when launch route receipts prove different
+    /// single-vendor providers; otherwise `unverified: <reason>`. Rows written
+    /// before W2-01 keep their `unavailable: ...` text.
     pub reviewer_attestation: String,
-    /// Kept false until a trusted reviewer-principal verifier exists.
+    /// Kept false until verdicts are signed with a key no agent can read
+    /// (W5-02d); a verified principal alone does not grant approval.
     pub approval_eligible: bool,
     pub status: String,
     pub invalidated_at: Option<i64>,
@@ -600,7 +600,8 @@ impl Store {
             "apiVersion": 1,
             "approvalAuthority": {
                 "state": "unavailable",
-                "detail": "trusted reviewer principal is not implemented",
+                "detail": "reviewer principals come from launch route receipts; approval needs signed verdicts, which are not implemented",
+                "reviewerPrincipal": "launch-route-receipt",
             },
             "executionEnabled": false,
             "sourceTimestamp": source_timestamp,
@@ -702,14 +703,17 @@ impl Store {
         Ok(evidence)
     }
 
+    /// `reviewer_run`, `owner` and `fence` authenticate the reviewer's own run;
+    /// the reviewed run is the one owning `input.evidence_id`. Both principals
+    /// are read from the store, never from the caller (see `RunPrincipal`).
     pub async fn record_development_review(
         &self,
-        run_id: &str,
+        reviewer_run: &str,
         owner: &str,
         fence: i64,
         input: ReviewInput,
     ) -> Result<DevelopmentReview, String> {
-        let run_id = required(run_id, "runId")?;
+        let reviewer_run = required(reviewer_run, "reviewerRunId")?;
         let owner = required(owner, "owner")?;
         if fence < 1 {
             return Err("fence must be positive".to_string());
@@ -720,20 +724,31 @@ impl Store {
             .begin_with("BEGIN IMMEDIATE")
             .await
             .map_err(db("begin development review"))?;
-        require_run_authority(&mut tx, &run_id, &owner, fence).await?;
-        require_bound_candidate(&mut tx, &run_id, &input.candidate_commit).await?;
+        require_run_authority(&mut tx, &reviewer_run, &owner, fence).await?;
         let evidence: EvidenceRow = sqlx::query_as("SELECT id, run_id, idempotency_key, source, observed_at, candidate_commit, measurement_json, payload_json, invalidated_at, invalidated_by_commit FROM development_run_evidence WHERE id = ?1")
             .bind(&input.evidence_id).fetch_optional(&mut *tx).await.map_err(db("read review evidence"))?
             .ok_or_else(|| "review evidence does not exist".to_string())?;
-        if evidence.run_id != run_id
-            || evidence.candidate_commit != input.candidate_commit
-            || evidence.invalidated_at.is_some()
+        let run_id = evidence.run_id.clone();
+        if run_id == reviewer_run {
+            return Err(
+                "reviewer must be independent from the implementer: a run cannot review its own candidate"
+                    .to_string(),
+            );
+        }
+        require_bound_candidate(&mut tx, &run_id, &input.candidate_commit).await?;
+        if evidence.candidate_commit != input.candidate_commit || evidence.invalidated_at.is_some()
         {
             return Err("review evidence is not valid for this run and candidate".to_string());
         }
+        let reviewer = RunPrincipal::read(&mut tx, &reviewer_run).await?;
+        let implementer = RunPrincipal::read(&mut tx, &run_id).await?;
+        if reviewer.project_id != implementer.project_id {
+            return Err("reviewer run belongs to another project".to_string());
+        }
+        let attestation = attest_reviewer(&reviewer, &implementer)?;
         let id = new_id("drr");
         sqlx::query("INSERT OR IGNORE INTO development_run_reviews(id, run_id, evidence_id, idempotency_key, candidate_commit, disposition, reviewer_identity, implementer_identity, source, observed_at, reviewer_attestation, approval_eligible, status) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, ?12)")
-            .bind(&id).bind(&run_id).bind(&input.evidence_id).bind(&input.idempotency_key).bind(&input.candidate_commit).bind(input.disposition.as_str()).bind(&input.reviewer_identity).bind(&input.implementer_identity).bind(&input.source).bind(input.observed_at).bind("unavailable: trusted reviewer principal is not implemented").bind(VALID_REVIEW)
+            .bind(&id).bind(&run_id).bind(&input.evidence_id).bind(&input.idempotency_key).bind(&input.candidate_commit).bind(input.disposition.as_str()).bind(reviewer.label()).bind(implementer.label()).bind(&input.source).bind(input.observed_at).bind(&attestation).bind(VALID_REVIEW)
             .execute(&mut *tx).await.map_err(db("write development review"))?;
         let review: DevelopmentReview = sqlx::query_as("SELECT id, run_id, evidence_id, idempotency_key, candidate_commit, disposition, reviewer_identity, implementer_identity, source, observed_at, reviewer_attestation, approval_eligible, status, invalidated_at, invalidated_by_commit FROM development_run_reviews WHERE idempotency_key = ?1")
             .bind(&input.idempotency_key).fetch_one(&mut *tx).await.map_err(db("read stored development review"))?;
@@ -741,8 +756,8 @@ impl Store {
             || review.evidence_id != input.evidence_id
             || review.candidate_commit != input.candidate_commit
             || review.disposition != input.disposition.as_str()
-            || review.reviewer_identity != input.reviewer_identity
-            || review.implementer_identity != input.implementer_identity
+            || review.reviewer_identity != reviewer.label()
+            || review.implementer_identity != implementer.label()
             || review.source != input.source
             || review.observed_at != input.observed_at
         {
@@ -1011,16 +1026,84 @@ fn validate_review(input: &ReviewInput) -> Result<(), String> {
     required(&input.idempotency_key, "idempotencyKey")?;
     required(&input.evidence_id, "evidenceId")?;
     required(&input.candidate_commit, "candidateCommit")?;
-    let reviewer = required(&input.reviewer_identity, "reviewerIdentity")?;
-    let implementer = required(&input.implementer_identity, "implementerIdentity")?;
     required(&input.source, "source")?;
-    if reviewer == implementer {
-        return Err("reviewerIdentity must be independent from implementerIdentity".to_string());
-    }
     validate_observed_at(input.observed_at)?;
     Ok(())
 }
 
+/// Providers bound to exactly one model vendor. `opencode` and `ollama` route
+/// to several vendors, so their name proves neither sameness nor difference.
+const SINGLE_VENDOR_PROVIDERS: [&str; 3] = ["claude", "codex", "kimi"];
+
+/// Who acted in a run, as the store observed it. The provider is read from
+/// the route receipt that only the trusted launch service writes
+/// (`bind_development_launch_route`); an agent holding a run credential
+/// cannot set it. A later signed verdict (W5-02d) signs this label.
+struct RunPrincipal {
+    run_id: String,
+    project_id: String,
+    worker_id: Option<String>,
+    provider: Option<String>,
+}
+
+impl RunPrincipal {
+    async fn read(tx: &mut Transaction<'_, Sqlite>, run_id: &str) -> Result<Self, String> {
+        let (project_id, worker_id, provider): (String, Option<String>, Option<String>) = sqlx::query_as(
+            "SELECT g.project_id, l.worker_id, CASE WHEN json_valid(l.route_json) THEN (CASE WHEN json_type(l.route_json, '$.selection.resolved.provider') = 'text' THEN json_extract(l.route_json, '$.selection.resolved.provider') END) END
+             FROM development_runs r JOIN continuous_tasks t ON t.id = r.task_id JOIN continuous_goals g ON g.id = t.goal_id
+             LEFT JOIN development_launches l ON l.run_id = r.id WHERE r.id = ?",
+        )
+        .bind(run_id)
+        .fetch_one(&mut **tx)
+        .await
+        .map_err(db("read review principal"))?;
+        Ok(Self {
+            run_id: run_id.to_string(),
+            project_id,
+            worker_id,
+            provider,
+        })
+    }
+
+    fn label(&self) -> String {
+        format!(
+            "run={} worker={} provider={}",
+            self.run_id,
+            self.worker_id.as_deref().unwrap_or("unlaunched"),
+            self.provider.as_deref().unwrap_or("unavailable")
+        )
+    }
+}
+
+/// Refuse a provably dependent reviewer; label an unprovable one honestly.
+/// `verified` means different model vendors, not different operators: one
+/// launch service starts every run. A same-vendor reviewer is refused for
+/// `changes_requested` too, so no same-vendor verdict enters the record.
+fn attest_reviewer(reviewer: &RunPrincipal, implementer: &RunPrincipal) -> Result<String, String> {
+    let (Some(r), Some(i)) = (
+        reviewer.provider.as_deref(),
+        implementer.provider.as_deref(),
+    ) else {
+        return Ok(
+            "unverified: provider unavailable without a launch route receipt for both runs"
+                .to_string(),
+        );
+    };
+    let single = |p: &str| SINGLE_VENDOR_PROVIDERS.contains(&p);
+    if !single(r) || !single(i) {
+        let router = if single(r) { i } else { r };
+        return Ok(format!(
+            "unverified: provider {router} does not identify one model vendor"
+        ));
+    }
+    if r == i {
+        return Err(format!("reviewer must be independent: reviewer and implementer resolve to the same provider {r}"));
+    }
+    Ok(format!(
+        "verified: launch route receipts bind reviewer provider {r} and implementer provider {i}"
+    ))
+}
+
 fn validate_observed_at(observed_at: i64) -> Result<(), String> {
     if observed_at < 1 {
         return Err("observedAt must be positive".to_string());
@@ -1380,13 +1463,12 @@ mod tests {
             evidence_id: saved.id,
             candidate_commit: "commit-a".into(),
             disposition: ReviewDisposition::Approved,
-            reviewer_identity: "reviewer-b".into(),
-            implementer_identity: "worker-a".into(),
             source: "review-service".into(),
             observed_at: 8,
         };
+        let reviewer = launched_run(&store, "task-r", "worker-r", 3, None).await;
         let saved_review = store
-            .record_development_review(&run.id, "worker-a", 7, review)
+            .record_development_review(&reviewer, "worker-r", 3, review)
             .await
             .unwrap();
         assert_eq!(saved_review.status, VALID_REVIEW);
@@ -1404,13 +1486,16 @@ mod tests {
         assert_eq!(snapshot["apiVersion"], 1);
         assert_eq!(snapshot["approvalAuthority"]["state"], "unavailable");
         assert_eq!(snapshot["executionEnabled"], false);
-        assert_eq!(snapshot["runs"].as_array().unwrap().len(), 1);
-        assert_eq!(
-            snapshot["runs"][0]["candidate"]["candidateCommit"],
-            "commit-b"
-        );
-        assert_eq!(snapshot["runs"][0]["candidate"]["source"], "git");
-        assert_eq!(snapshot["runs"][0]["candidate"]["observedAt"], 9);
+        // The implementer run plus the reviewer's own run.
+        let runs = snapshot["runs"].as_array().unwrap();
+        assert_eq!(runs.len(), 2);
+        let implementer = runs
+            .iter()
+            .find(|record| record["run"]["id"] == run.id.as_str())
+            .unwrap();
+        assert_eq!(implementer["candidate"]["candidateCommit"], "commit-b");
+        assert_eq!(implementer["candidate"]["source"], "git");
+        assert_eq!(implementer["candidate"]["observedAt"], 9);
         let briefing = store
             .agent_run_context(&run.id, "worker-a", 7)
             .await
@@ -1681,19 +1766,18 @@ mod tests {
             .record_development_evidence(&run.id, "worker-a", 7, evidence("commit-a"))
             .await
             .unwrap();
+        let reviewer = launched_run(&store, "task-r", "worker-r", 3, None).await;
         for n in 0..40 {
             let review = ReviewInput {
                 idempotency_key: format!("page-review-{n}"),
                 evidence_id: saved.id.clone(),
                 candidate_commit: "commit-a".into(),
                 disposition: ReviewDisposition::Approved,
-                reviewer_identity: "reviewer-b".into(),
-                implementer_identity: "worker-a".into(),
                 source: "review-service".into(),
                 observed_at: 8,
             };
             store
-                .record_development_review(&run.id, "worker-a", 7, review)
+                .record_development_review(&reviewer, "worker-r", 3, review)
                 .await
                 .unwrap();
         }
@@ -1833,8 +1917,6 @@ mod tests {
             evidence_id: saved.id,
             candidate_commit: "commit-a".into(),
             disposition: ReviewDisposition::Approved,
-            reviewer_identity: "worker-a".into(),
-            implementer_identity: "worker-a".into(),
             source: "review-service".into(),
             observed_at: 8,
         };
@@ -1844,4 +1926,215 @@ mod tests {
             .unwrap_err()
             .contains("independent"));
     }
+
+    /// Stands in for the trusted launch service: the provider comes from the
+    /// route receipt it bound, never from the review caller.
+    async fn launched_run(
+        store: &Store,
+        task: &str,
+        owner: &str,
+        fence: i64,
+        provider: Option<&str>,
+    ) -> String {
+        if task != "task-1" {
+            sqlx::query("INSERT INTO continuous_tasks(id, goal_id, objective, owned_paths_json, dependencies_json, status, claim_owner, claim_fence, created_at, updated_at) VALUES(?1, 'goal-root', 'review', '[]', '[]', 'running', ?2, ?3, 1, 1)")
+                .bind(task).bind(owner).bind(fence).execute(&store.pool).await.unwrap();
+        }
+        let run = store
+            .record_development_run_intent(task, owner, fence)
+            .await
+            .unwrap();
+        if let Some(provider) = provider {
+            // Serialize the real route types, as `DevelopmentRoute::receipt`
+            // does (`"selection": decision`), so a renamed field breaks here.
+            use crate::development_policy::{
+                Observation, ResolvedRoute, RouteDecision, RouteRequest,
+            };
+            let gone = || Observation::Unavailable {
+                reason: "test".into(),
+            };
+            let decision = RouteDecision {
+                requested: RouteRequest {
+                    requested_model: None,
+                    required_capabilities: Default::default(),
+                    effort: None,
+                    minimum_context_tokens: 0,
+                    requires_verified_tool_adapter: false,
+                },
+                resolved: Some(ResolvedRoute {
+                    profile_id: provider.into(),
+                    provider: serde_json::from_value(serde_json::json!(provider)).unwrap(),
+                    configured_model: gone(),
+                    resolved_model: gone(),
+                    effort: gone(),
+                    context_tokens: Observation::Unavailable {
+                        reason: "test".into(),
+                    },
+                    quota_remaining_percent: Observation::Unavailable {
+                        reason: "test".into(),
+                    },
+                    estimated_task_tokens: Observation::Unavailable {
+                        reason: "test".into(),
+                    },
+                    evidence_id: "test".into(),
+                    observed_at: 1,
+                }),
+                failure: None,
+            };
+            let route = serde_json::json!({"schemaVersion": 1, "selection": decision});
+            sqlx::query("INSERT INTO development_launches(run_id, worker_id, project_id, profile_id, repo_path, worktree_path, branch, state, reserved_at, route_json, route_expires_at) VALUES(?1, ?2, 'project', ?3, 'repo', ?4, 'branch', 'reserved', 1, ?5, 9999999999)")
+                .bind(&run.id).bind(format!("worker-{}", run.id)).bind(provider).bind(format!("wt-{}", run.id)).bind(route.to_string())
+                .execute(&store.pool).await.unwrap();
+        }
+        run.id
+    }
+
+    fn review_input(key: &str, evidence_id: &str) -> ReviewInput {
+        ReviewInput {
+            idempotency_key: key.into(),
+            evidence_id: evidence_id.into(),
+            candidate_commit: "commit-a".into(),
+            disposition: ReviewDisposition::Approved,
+            source: "review-service".into(),
+            observed_at: 8,
+        }
+    }
+
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn reviewer_principal_comes_from_launch_records_not_caller_labels() {
+        let (_dir, store, _root, task) = fixture().await;
+        let implementer = launched_run(&store, &task, "worker-a", 7, Some("claude")).await;
+        store
+            .bind_development_run_candidate(&implementer, "worker-a", 7, "commit-a", "git", 6)
+            .await
+            .unwrap();
+        let saved = store
+            .record_development_evidence(&implementer, "worker-a", 7, evidence("commit-a"))
+            .await
+            .unwrap();
+        // The implementer's own credential cannot record a review of itself,
+        // whatever reviewer label it claims.
+        assert!(store
+            .record_development_review(&implementer, "worker-a", 7, review_input("self", &saved.id))
+            .await
+            .is_err());
+        // A different provider, bound by the launch service, is verified.
+        let reviewer = launched_run(&store, "task-r", "worker-r", 3, Some("codex")).await;
+        let review = store
+            .record_development_review(&reviewer, "worker-r", 3, review_input("codex", &saved.id))
+            .await
+            .unwrap();
+        assert_eq!(review.run_id, implementer);
+        assert!(
+            review.reviewer_attestation.starts_with("verified:"),
+            "{}",
+            review.reviewer_attestation
+        );
+        assert!(
+            review.reviewer_identity.contains(&reviewer)
+                && review.reviewer_identity.contains("provider=codex")
+        );
+        assert!(
+            review.implementer_identity.contains(&implementer)
+                && review.implementer_identity.contains("provider=claude")
+        );
+        // Approval still requires a signed verdict, which does not exist yet.
+        assert!(!review.approval_eligible);
+        // The same provider under another run is not an independent reviewer.
+        let same = launched_run(&store, "task-s", "worker-s", 4, Some("claude")).await;
+        assert!(store
+            .record_development_review(&same, "worker-s", 4, review_input("same", &saved.id))
+            .await
+            .unwrap_err()
+            .contains("same provider"));
+        // Without a route receipt, or behind a multi-vendor router, the
+        // principal is recorded but honestly labelled unverified.
+        let unrouted = launched_run(&store, "task-u", "worker-u", 5, None).await;
+        let review = store
+            .record_development_review(
+                &unrouted,
+                "worker-u",
+                5,
+                review_input("unrouted", &saved.id),
+            )
+            .await
+            .unwrap();
+        assert!(
+            review.reviewer_attestation.starts_with("unverified:"),
+            "{}",
+            review.reviewer_attestation
+        );
+        let routed = launched_run(&store, "task-o", "worker-o", 6, Some("ollama")).await;
+        let review = store
+            .record_development_review(&routed, "worker-o", 6, review_input("ollama", &saved.id))
+            .await
+            .unwrap();
+        assert!(
+            review.reviewer_attestation.starts_with("unverified:"),
+            "{}",
+            review.reviewer_attestation
+        );
+        // A reviewer credential that does not match its run is refused.
+        assert!(store
+            .record_development_review(&reviewer, "worker-a", 3, review_input("forged", &saved.id))
+            .await
+            .is_err());
+        let snapshot = store.development_records_snapshot("project").await.unwrap();
+        assert_eq!(snapshot["approvalAuthority"]["state"], "unavailable");
+        assert_eq!(
+            snapshot["approvalAuthority"]["reviewerPrincipal"],
+            "launch-route-receipt"
+        );
+    }
+
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn reviewer_principal_edge_cases_fail_closed() {
+        let (_dir, store, _root, task) = fixture().await;
+        // The implementer has no route receipt; a routed reviewer alone
+        // proves nothing about independence.
+        let implementer = launched_run(&store, &task, "worker-a", 7, None).await;
+        store
+            .bind_development_run_candidate(&implementer, "worker-a", 7, "commit-a", "git", 6)
+            .await
+            .unwrap();
+        let saved = store
+            .record_development_evidence(&implementer, "worker-a", 7, evidence("commit-a"))
+            .await
+            .unwrap();
+        let reviewer = launched_run(&store, "task-r", "worker-r", 3, Some("codex")).await;
+        let review = store
+            .record_development_review(&reviewer, "worker-r", 3, review_input("mixed", &saved.id))
+            .await
+            .unwrap();
+        assert!(
+            review.reviewer_attestation.starts_with("unverified:"),
+            "{}",
+            review.reviewer_attestation
+        );
+        // A run of another project cannot review this candidate.
+        sqlx::query("INSERT INTO continuous_goals(id, project_id, root_goal_id, objective, status, deadline_at, admitted, created_at, updated_at) VALUES('goal-x', 'other-project', 'goal-root', 'goal', 'open', 9999999999, 1, 1, 1)")
+            .execute(&store.pool).await.unwrap();
+        let foreign = launched_run(&store, "task-x", "worker-x", 2, Some("kimi")).await;
+        sqlx::query("UPDATE continuous_tasks SET goal_id = 'goal-x' WHERE id = 'task-x'")
+            .execute(&store.pool)
+            .await
+            .unwrap();
+        assert!(store
+            .record_development_review(&foreign, "worker-x", 2, review_input("foreign", &saved.id))
+            .await
+            .unwrap_err()
+            .contains("another project"));
+        // A retry by the same reviewer returns its review; another reviewer
+        // reusing the idempotency key does not inherit it.
+        assert!(store
+            .record_development_review(&reviewer, "worker-r", 3, review_input("mixed", &saved.id))
+            .await
+            .is_ok());
+        let other = launched_run(&store, "task-k", "worker-k", 4, Some("kimi")).await;
+        assert!(store
+            .record_development_review(&other, "worker-k", 4, review_input("mixed", &saved.id))
+            .await
+            .unwrap_err()
+            .contains("idempotency"));
+    }
 }
```
