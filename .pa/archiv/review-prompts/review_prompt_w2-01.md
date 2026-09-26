diff --git a/src-tauri/src/store/development_events.rs b/src-tauri/src/store/development_events.rs
index d6960c8..b9be93e 100644
--- a/src-tauri/src/store/development_events.rs
+++ b/src-tauri/src/store/development_events.rs
@@ -330,26 +330,31 @@ mod tests {
             evidence_id: saved.id,
             candidate_commit: "commit-a".into(),
             disposition: ReviewDisposition::Approved,
-            reviewer_identity: "private-reviewer".into(),
-            implementer_identity: "owner".into(),
             source: "private-source".into(),
             observed_at: 8,
         };
+        // A review is written with the reviewer's own run credential.
+        sqlx::query("INSERT INTO continuous_tasks(id,goal_id,objective,owned_paths_json,dependencies_json,status,claim_owner,claim_fence,created_at,updated_at) VALUES('review','goal','review','[]','[]','running','reviewer',1,1,1)").execute(&store.pool).await.unwrap();
+        let reviewer = store
+            .record_development_run_intent("review", "reviewer", 1)
+            .await
+            .unwrap()
+            .id;
         store
-            .record_development_review(&run, "owner", 1, review.clone())
+            .record_development_review(&reviewer, "reviewer", 1, review.clone())
             .await
             .unwrap();
         store
-            .record_development_review(&run, "owner", 1, review)
+            .record_development_review(&reviewer, "reviewer", 1, review)
             .await
             .unwrap();
-        assert_eq!(events(&store, &project).await.len(), 4);
+        assert_eq!(events(&store, &project).await.len(), 5);
         store
             .bind_development_run_candidate(&run, "owner", 1, "commit-b", "git", 9)
             .await
             .unwrap();
         let all = events(&store, &project).await;
-        assert_eq!(all.len(), 7);
+        assert_eq!(all.len(), 8);
         for kind in [
             "development_candidate",
             "development_evidence",
diff --git a/src-tauri/src/store/development_runs.rs b/src-tauri/src/store/development_runs.rs
index 9831bbc..a99a10e 100644
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
+        let reviewer_run = required(reviewer_run, "runId")?;
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
@@ -1011,16 +1026,81 @@ fn validate_review(input: &ReviewInput) -> Result<(), String> {
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
@@ -1380,13 +1460,12 @@ mod tests {
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
@@ -1404,13 +1483,16 @@ mod tests {
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
@@ -1681,19 +1763,18 @@ mod tests {
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
@@ -1833,8 +1914,6 @@ mod tests {
             evidence_id: saved.id,
             candidate_commit: "commit-a".into(),
             disposition: ReviewDisposition::Approved,
-            reviewer_identity: "worker-a".into(),
-            implementer_identity: "worker-a".into(),
             source: "review-service".into(),
             observed_at: 8,
         };
@@ -1844,4 +1923,128 @@ mod tests {
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
+            let route = serde_json::json!({"selection":{"resolved":{"profileId":provider,"provider":provider}}});
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
 }
