# Review W2-01b: scoped review route (reviewer from credential)

Du bist ein anbieterfremder Reviewer (Autor: Claude Code, Anthropic). Repo ProjectA,
Tauri 2 / Rust, loopback-HTTP-API (`src-tauri/src/api.rs`, `src-tauri/src/api/agent_access.rs`),
SQLite-Store (sqlx). Sicherheitsrelevant: Autorisierung an einer Nahtstelle.

## Auftrag des Pakets
Die HTTP-Route, ueber die ein Reviewer-Run seine Review-Disposition einreicht, darf die
`reviewerRunId` nicht aus dem Request-Body uebernehmen, sondern muss sie aus dem
authentifizierten Scoped-Run-Credential (Agent-Token -> Run/Owner/Fence) ableiten. Ein
Body-Feld, das einen Run nennt, wird abgelehnt oder ignoriert (Idiom der Nachbarrouten).
Die Route existierte vorher nicht; sie ist neu angelegt: `POST /api/hq/v1/agent/review`.
`store/` darf nicht angefasst werden (dort ergaenzt ein paralleles Paket die Reviewer-Rollenpruefung).

## Designentscheidungen
- Ablehnen statt ignorieren: `ReviewInput` hat `deny_unknown_fields`; ein `reviewerRunId`/`runId`
  im Body -> 400, nichts wird geschrieben. Gleiches Idiom wie checkpoint/candidate (Tests dort
  injizieren `runId` und erwarten 400).
- Reviewer-Principal = `grant.run_id/owner/fence`; der begutachtete Run = Eigentuemer der Evidenz
  (vom Store abgeleitet).
- Store-Ablehnungen bekommen eigene Status: Selbstreview/gleicher Anbieter/fremdes Projekt 403,
  unbekannte Evidenz 404, veraltete/unpassende Evidenz 409 (vorher waeren sie 400 bzw. 500 geworden).
- Kein `pa`-CLI-Kommando (bin/pa.rs ist eine andere Nahtstelle) -> Folgearbeit.

## Pruefauftrag
Pruefe insbesondere: Kann ein Aufrufer mit gueltigem Token ein Review fuer/als einen fremden Run
erzeugen? Stimmen die Status (401/403) mit den Nachbarrouten? Fehlerabbildung korrekt/vollstaendig
(Reihenfolge der Pruefungen in agent_error, `contains("unauthorized")` davor)? Tests aussagekraeftig?
Doku korrekt? Format: Tabelle ID/Schwere(hoch/mittel/niedrig)/Datei:Zeile/Befund/Vorschlag, dann
Gesamturteil "freigeben", "freigeben mit Auflagen" oder "nicht freigeben". Erfinde keine Befunde;
was du nicht aus dem Material belegen kannst, kennzeichne als Vermutung.

## Diff (origin/main 3216bbf..HEAD)
```diff
diff --git a/docs/development/CONTINUOUS.md b/docs/development/CONTINUOUS.md
index 7d76917..9c7bbd2 100644
--- a/docs/development/CONTINUOUS.md
+++ b/docs/development/CONTINUOUS.md
@@ -158,6 +158,18 @@ returns the original persisted source/time. Reuse an evidence key only for the
 same submission. Unknown top-level input fields are rejected. Terminal runs reject writes
 with HTTP 409; postmortem reads still require the current task owner/fence.
 
+A reviewer run submits its disposition with `POST /api/hq/v1/agent/review`:
+`{"idempotencyKey":"<stable-review-id>","evidenceId":"<implementer-evidence-id>","candidateCommit":"<commit>","disposition":"approved"|"changesRequested","source":"<observation-source>","observedAt":<unix-seconds>}`.
+The reviewer is always the run of the scoped credential; the reviewed run is the
+owner of the named evidence. The body carries no identity: `reviewerRunId`,
+`runId` or any other unknown field is refused with HTTP 400 and nothing is written.
+A run reviewing its own candidate, a same-vendor reviewer and a reviewer from
+another project get 403; unknown evidence 404; evidence that is stale or not for
+that candidate, and a reused key with a different payload, 409. The stored review
+records both principals and the attestation from launch records; it grants no
+approval authority (`approvalEligible` stays false). There is no `pa` command for
+this route yet.
+
 A missing or invalid projecta.dev.json refuses new goal roots; existing roots
 retain their frozen policy. `pa hq tasks checkpoint <id> --status retry --owner
 <owner> --fence <n>` requires a resolved failed run for that claim. It keeps file
diff --git a/src-tauri/src/api.rs b/src-tauri/src/api.rs
index 8ef999f..82e2247 100644
--- a/src-tauri/src/api.rs
+++ b/src-tauri/src/api.rs
@@ -276,6 +276,18 @@ pub trait ControlBackend: Send + Sync {
     ) -> Result<Value, String> {
         Err("agent evidence service unavailable".into())
     }
+    /// Record a review disposition. `reviewer_run`, `owner` and `fence` come
+    /// from the scoped run credential, never from the request body: the
+    /// credential *is* the reviewer principal (W2-01b).
+    fn agent_submit_review(
+        &self,
+        _reviewer_run: &str,
+        _owner: &str,
+        _fence: i64,
+        _input: crate::store::development_runs::ReviewInput,
+    ) -> Result<Value, String> {
+        Err("agent review service unavailable".into())
+    }
     /// Whether `project_id` names a project.
     ///
     /// Asked by every route that *lists* something for one project, before the
@@ -3016,6 +3028,25 @@ pub(crate) mod tests {
             self.agent_run_context(run, owner, fence)?;
             Ok(json!({"runId":run,"idempotencyKey":input.idempotency_key}))
         }
+        fn agent_submit_review(
+            &self,
+            reviewer_run: &str,
+            owner: &str,
+            fence: i64,
+            input: crate::store::development_runs::ReviewInput,
+        ) -> Result<Value, String> {
+            if let Some(store) = &self.native_store {
+                let review = tauri::async_runtime::block_on(store.record_development_review(
+                    reviewer_run,
+                    owner,
+                    fence,
+                    input,
+                ))?;
+                return serde_json::to_value(review).map_err(|e| e.to_string());
+            }
+            self.agent_run_context(reviewer_run, owner, fence)?;
+            Ok(json!({"reviewerRunId":reviewer_run,"idempotencyKey":input.idempotency_key}))
+        }
         fn development_records(&self, project_id: &str) -> Result<Value, String> {
             Ok(
                 json!({"apiVersion": 1, "projectId": project_id, "runs": [], "executionEnabled": false}),
@@ -4612,6 +4643,220 @@ pub(crate) mod tests {
         );
     }
 
+    /// A real store behind the scoped review route: one implementer run with a
+    /// bound candidate and evidence, one reviewer run and one bystander run in
+    /// the same project. Returns the server, the three run ids, the evidence id
+    /// and a raw pool for reading what the store actually wrote.
+    struct ReviewRoute {
+        server: ApiServer,
+        implementer: String,
+        reviewer: String,
+        bystander: String,
+        evidence: String,
+        pool: sqlx::SqlitePool,
+        /// Last, so the directory outlives the server and the pool on drop.
+        _dir: TempDir,
+    }
+
+    const REVIEW_COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";
+
+    fn review_route() -> ReviewRoute {
+        use crate::store::development_runs::{EvidenceInput, EvidenceMeasurement};
+        let dir = TempDir::new("api-review-route");
+        let db = dir.path().join("projecta.db");
+        tauri::async_runtime::block_on(async {
+            let store = crate::store::Store::open(&db).await.unwrap();
+            let project = store
+                .create_project("review", &dir.path().to_string_lossy())
+                .await
+                .unwrap();
+            let pool = sqlx::SqlitePool::connect(&format!("sqlite:{}", db.display()))
+                .await
+                .unwrap();
+            sqlx::query("INSERT INTO continuous_projects VALUES(?, 'enabled', 1)")
+                .bind(&project.id)
+                .execute(&pool)
+                .await
+                .unwrap();
+            sqlx::query("INSERT INTO continuous_goals(id,project_id,root_goal_id,objective,status,deadline_at,admitted,created_at,updated_at) VALUES('goal',?,'goal','goal','open',9999999999,1,1,1)")
+                .bind(&project.id).execute(&pool).await.unwrap();
+            sqlx::query("INSERT INTO continuous_root_policies VALUES('goal',?,'test',1)")
+                .bind(
+                    serde_json::to_string(
+                        &crate::development_policy::DevelopmentPolicy::defaults(),
+                    )
+                    .unwrap(),
+                )
+                .execute(&pool)
+                .await
+                .unwrap();
+            let mut runs = Vec::new();
+            for owner in ["implementer", "reviewer", "bystander"] {
+                sqlx::query("INSERT INTO continuous_tasks(id,goal_id,objective,owned_paths_json,dependencies_json,status,claim_owner,claim_fence,created_at,updated_at) VALUES(?1,'goal',?1,'[]','[]','running',?1,1,1,1)")
+                    .bind(owner).execute(&pool).await.unwrap();
+                runs.push(
+                    store
+                        .record_development_run_intent(owner, owner, 1)
+                        .await
+                        .unwrap()
+                        .id,
+                );
+            }
+            // The reviewer run is dispatched in the reviewer role (W2-04), so
+            // the fixture stays valid once the store checks that role.
+            sqlx::query("INSERT INTO continuous_team_assignments(task_id,team_id,role,assignee,revision,policy_version,observed_at) VALUES('reviewer','development','reviewer','reviewer',1,1,1)")
+                .execute(&pool).await.unwrap();
+            store
+                .bind_development_run_candidate(&runs[0], "implementer", 1, REVIEW_COMMIT, "git", 1)
+                .await
+                .unwrap();
+            let evidence = store
+                .record_development_evidence(
+                    &runs[0],
+                    "implementer",
+                    1,
+                    EvidenceInput {
+                        idempotency_key: "evidence-1".into(),
+                        source: "cargo".into(),
+                        observed_at: 1,
+                        candidate_commit: REVIEW_COMMIT.into(),
+                        measurement: EvidenceMeasurement::Unavailable {
+                            reason: "not run".into(),
+                        },
+                        payload: json!({}),
+                    },
+                )
+                .await
+                .unwrap()
+                .id;
+            let backend = FakeBackend {
+                native_store: Some(store),
+                ..Default::default()
+            };
+            let server = boot(Arc::new(backend), &dir.path().join("api"), false).unwrap();
+            ReviewRoute {
+                server,
+                implementer: runs[0].clone(),
+                reviewer: runs[1].clone(),
+                bystander: runs[2].clone(),
+                evidence,
+                pool,
+                _dir: dir,
+            }
+        })
+    }
+
+    fn review_body(evidence: &str, key: &str) -> Value {
+        json!({
+            "idempotencyKey": key,
+            "evidenceId": evidence,
+            "candidateCommit": REVIEW_COMMIT,
+            "disposition": "approved",
+            "source": "reviewer-session",
+            "observedAt": 2,
+        })
+    }
+
+    /// `(run_id, reviewer_identity)` of every stored review.
+    fn stored_reviews(pool: &sqlx::SqlitePool) -> Vec<(String, String)> {
+        tauri::async_runtime::block_on(
+            sqlx::query_as(
+                "SELECT run_id, reviewer_identity FROM development_run_reviews ORDER BY rowid",
+            )
+            .fetch_all(pool),
+        )
+        .unwrap()
+    }
+
+    /// W2-01b: the reviewer principal of `POST /api/hq/v1/agent/review` is the
+    /// run the scoped credential was minted for. A body that names a run -
+    /// the reviewer's own, a bystander's, or the implementer's - is refused
+    /// like every other injected run field on the agent routes, and no review
+    /// is written for anyone.
+    #[test]
+    fn review_route_takes_the_reviewer_run_from_the_credential_not_the_body() {
+        let fx = review_route();
+        let port = fx.server.port();
+        let issue = |run: &str, owner: &str| {
+            fx.server
+                .issue_run_descriptor(run, owner, 1, 60)
+                .unwrap()
+                .token
+        };
+        let reviewer = issue(&fx.reviewer, "reviewer");
+        let implementer = issue(&fx.implementer, "implementer");
+        let path = "/api/hq/v1/agent/review";
+
+        // (1) A valid credential that names a foreign reviewer run.
+        for (token, named) in [
+            (&reviewer, &fx.bystander),
+            (&reviewer, &fx.reviewer),
+            (&implementer, &fx.reviewer),
+            (&implementer, &fx.bystander),
+        ] {
+            for field in ["reviewerRunId", "runId"] {
+                let mut forged = review_body(&fx.evidence, "forged");
+                forged[field] = json!(named);
+                let (status, body) = call(port, "POST", path, Some(token), &forged.to_string());
+                assert_eq!(status, 400, "{field}={named}: {body}");
+            }
+        }
+        assert!(stored_reviews(&fx.pool).is_empty());
+
+        // The implementer's own credential is not a reviewer principal.
+        let (status, body) = call(
+            port,
+            "POST",
+            path,
+            Some(&implementer),
+            &review_body(&fx.evidence, "self").to_string(),
+        );
+        assert_eq!(status, 403, "{body}");
+        assert!(stored_reviews(&fx.pool).is_empty());
+
+        // (3) Missing, unknown and broad credentials, as on the other routes.
+        let clean = review_body(&fx.evidence, "review-1").to_string();
+        assert_eq!(call(port, "POST", path, None, &clean).0, 401);
+        assert_eq!(
+            call(port, "POST", path, Some(&"0".repeat(32)), &clean).0,
+            401
+        );
+        let broad = {
+            let raw = std::fs::read_to_string(fx.server.descriptor_path()).unwrap();
+            serde_json::from_str::<Value>(&raw).unwrap()["token"]
+                .as_str()
+                .unwrap()
+                .to_string()
+        };
+        assert_eq!(call(port, "POST", path, Some(&broad), &clean).0, 403);
+        let query = format!("{path}?runId={}", fx.bystander);
+        assert_eq!(call(port, "POST", &query, Some(&reviewer), &clean).0, 403);
+        assert!(stored_reviews(&fx.pool).is_empty());
+
+        // (2) The normal case: the review is stored with the token's run as
+        // reviewer and the evidence owner as the reviewed run.
+        let (status, review) = call(port, "POST", path, Some(&reviewer), &clean);
+        assert_eq!(status, 200, "{review}");
+        assert_eq!(review["runId"], json!(fx.implementer));
+        let principal = format!("run={} ", fx.reviewer);
+        assert!(
+            review["reviewerIdentity"]
+                .as_str()
+                .is_some_and(|identity| identity.starts_with(&principal)),
+            "{review}"
+        );
+        let stored = stored_reviews(&fx.pool);
+        assert_eq!(stored.len(), 1);
+        assert_eq!(stored[0].0, fx.implementer);
+        assert!(stored[0].1.starts_with(&principal), "{stored:?}");
+
+        // A revoked credential is dead like on every other scoped route.
+        fx.server.revoke_run_credentials(&fx.reviewer).unwrap();
+        let again = review_body(&fx.evidence, "review-2").to_string();
+        assert_eq!(call(port, "POST", path, Some(&reviewer), &again).0, 401);
+        assert_eq!(stored_reviews(&fx.pool).len(), 1);
+    }
+
     #[test]
     fn scoped_credentials_are_revoked_when_server_handle_drops() {
         let fx = fixture("api-run-teardown");
diff --git a/src-tauri/src/api/agent_access.rs b/src-tauri/src/api/agent_access.rs
index b52a763..d97345c 100644
--- a/src-tauri/src/api/agent_access.rs
+++ b/src-tauri/src/api/agent_access.rs
@@ -429,6 +429,21 @@ pub(super) fn handle_run(inner: &Inner, request: &Request, grant: RunGrant) -> R
             };
             backend.agent_submit_evidence(&grant.run_id, &grant.owner, grant.fence, input)
         }
+        // W2-01b: the reviewer principal is the run this credential was minted
+        // for. `ReviewInput` denies unknown fields, so a body naming a run
+        // (`reviewerRunId`, `runId`, ...) is refused with 400 like every other
+        // injected run field on these routes - never silently ignored, so a
+        // confused or forging caller learns its claim did not count. The
+        // reviewed run is the owner of the named evidence, derived by the store.
+        ("POST", ["api", "hq", "v1", "agent", "review"]) => {
+            let input = match serde_json::from_str::<crate::store::development_runs::ReviewInput>(
+                &request.body,
+            ) {
+                Ok(input) => input,
+                Err(_) => return Response::error(400, "invalid review input"),
+            };
+            backend.agent_submit_review(&grant.run_id, &grant.owner, grant.fence, input)
+        }
         _ => return Response::error(403, "route is outside this run credential scope"),
     };
     match result {
@@ -441,7 +456,19 @@ pub(super) fn handle_run(inner: &Inner, request: &Request, grant: RunGrant) -> R
 }
 
 fn agent_error(error: String) -> Response {
+    // A well-formed review this credential's run may not give: its own
+    // candidate, the same model vendor, another project. Retrying cannot
+    // change the principal, so it is a refusal (403), not a bad request.
+    if error.starts_with("reviewer must be independent")
+        || error == "reviewer run belongs to another project"
+    {
+        return Response::error(403, error);
+    }
+    if error == "review evidence does not exist" {
+        return Response::error(404, error);
+    }
     if error.contains("idempotency key was reused")
+        || error == "review evidence is not valid for the reviewed run and candidate"
         || error.starts_with("checkpoint idempotency key reused")
         || error.starts_with("checkpoint revision changed")
         || error.starts_with("checkpoint evidence is missing")
@@ -510,6 +537,28 @@ mod tests {
         }
         assert_eq!(agent_error("database pool unavailable".into()).status, 500);
     }
+    /// The store's review refusals, verbatim from `record_development_review`.
+    #[test]
+    fn review_refusals_are_not_bad_requests_or_server_failures() {
+        for error in [
+            "reviewer must be independent from the implementer: a run cannot review its own candidate",
+            "reviewer must be independent: reviewer and implementer resolve to the same provider claude",
+            "reviewer run belongs to another project",
+        ] {
+            assert_eq!(agent_error(error.into()).status, 403, "{error}");
+        }
+        assert_eq!(
+            agent_error("review evidence does not exist".into()).status,
+            404
+        );
+        for error in [
+            "review evidence is not valid for the reviewed run and candidate",
+            "development review idempotency key was reused with a different payload",
+        ] {
+            assert_eq!(agent_error(error.into()).status, 409, "{error}");
+        }
+        assert_eq!(agent_error("evidenceId is required".into()).status, 400);
+    }
     #[test]
     fn expired_and_previous_process_credentials_are_rejected() {
         let credentials = RunCredentials::default();
diff --git a/src-tauri/src/main.rs b/src-tauri/src/main.rs
index 1c1b5e0..5ed9b07 100644
--- a/src-tauri/src/main.rs
+++ b/src-tauri/src/main.rs
@@ -2439,6 +2439,21 @@ impl ControlBackend for ApiBackend {
         )?;
         serde_json::to_value(result).map_err(|e| e.to_string())
     }
+    fn agent_submit_review(
+        &self,
+        reviewer_run: &str,
+        owner: &str,
+        fence: i64,
+        input: store::development_runs::ReviewInput,
+    ) -> Result<Value, String> {
+        let result = tauri::async_runtime::block_on(self.store.record_development_review(
+            reviewer_run,
+            owner,
+            fence,
+            input,
+        ))?;
+        serde_json::to_value(result).map_err(|e| e.to_string())
+    }
     fn project_exists(&self, project_id: &str) -> Result<bool, String> {
         Ok(tauri::async_runtime::block_on(self.store.get_project(project_id))?.is_some())
     }

```

## Kontext (unveraendert): Token-Pruefung in api.rs
```rust
fn handle(inner: &Inner, request: &Request) -> Response {
    match request.headers.get(TOKEN_HEADER) {
        Some(token) if token_eq(token, &inner.token) => {}
        Some(token) => match inner.run_credentials.lookup(token) {
            Some(grant) => return agent_access::handle_run(inner, request, grant),
            None => return Response::error(401, "invalid api token"),
        },
        None => return Response::error(401, format!("missing {TOKEN_HEADER} header")),
    }

```

## Kontext: Kopf von handle_run (agent_access.rs, nach dem Diff)
```rust
pub(super) fn handle_run(inner: &Inner, request: &Request, grant: RunGrant) -> Response {
    if request.headers.contains_key(VERDICT_TOKEN_HEADER) || !request.query.is_empty() {
        return Response::error(
            403,
            "run credentials cannot carry verdict authority or override scope",
        );
    }
    let segments = request.segments();
    let path: Vec<&str> = segments.iter().map(String::as_str).collect();
    let backend = inner.backend.as_ref();
  
```

## Kontext: agent_error (nach dem Diff)
```rust
fn agent_error(error: String) -> Response {
    // A well-formed review this credential's run may not give: its own
    // candidate, the same model vendor, another project. Retrying cannot
    // change the principal, so it is a refusal (403), not a bad request.
    if error.starts_with("reviewer must be independent")
        || error == "reviewer run belongs to another project"
    {
        return Response::error(403, error);
    }
    if error == "review evidence does not exist" {
        return Response::error(404, error);
    }
    if error.contains("idempotency key was reused")
        || error == "review evidence is not valid for the reviewed run and candidate"
        || error.starts_with("checkpoint idempotency key reused")
        || error.starts_with("checkpoint revision changed")
        || error.starts_with("checkpoint evidence is missing")
        || error.contains("development run is not active")
        || error.contains("candidate does not match")
        || error.contains("candidate must be bound")
        || error.starts_with("candidate scope check failed:")
    {
        Response::error(409, error)
    } else if error.contains("cannot be in the future")
        || error.starts_with("invalid record cursor")
        || error.starts_with("invalid or mismatched record cursor")
        || error.contains("cannot use a null value")
        || error.starts_with("checkpoint exceeds")
    {
        Response::error(400, error)
    } else {
        continuous_error(error)
    }
}


```

## Kontext (unveraendert): Store
```rust
pub struct ReviewInput {
    pub idempotency_key: String,
    pub evidence_id: String,
    pub candidate_commit: String,
    pub disposition: ReviewDisposition,
    pub source: String,
    pub observed_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]

    pub async fn record_development_review(
        &self,
        reviewer_run: &str,
        owner: &str,
        fence: i64,
        input: ReviewInput,
    ) -> Result<DevelopmentReview, String> {
        let reviewer_run = required(reviewer_run, "reviewerRunId")?;
        let owner = required(owner, "owner")?;
        if fence < 1 {
            return Err("fence must be positive".to_string());
        }
        validate_review(&input)?;
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(db("begin development review"))?;
        require_run_authority(&mut tx, &reviewer_run, &owner, fence).await?;
        let evidence: EvidenceRow = sqlx::query_as("SELECT id, run_id, idempotency_key, source, observed_at, candidate_commit, measurement_json, payload_json, invalidated_at, invalidated_by_commit FROM development_run_evidence WHERE id = ?1")
            .bind(&input.evidence_id).fetch_optional(&mut *tx).await.map_err(db("read review evidence"))?
            .ok_or_else(|| "review evidence does not exist".to_string())?;
        let run_id = evidence.run_id.clone();
        if run_id == reviewer_run {
            return Err(
                "reviewer must be independent from the implementer: a run cannot review its own candidate"
                    .to_string(),
            );
        }
        require_bound_candidate(&mut tx, &run_id, &input.candidate_commit).await?;
        if evidence.candidate_commit != input.candidate_commit || evidence.invalidated_at.is_some()
        {
            return Err(
                "review evidence is not valid for the reviewed run and candidate".to_string(),
            );
        }
        let reviewer = RunPrincipal::read(&mut tx, &reviewer_run).await?;
        let implementer = RunPrincipal::read(&mut tx, &run_id).await?;
        if reviewer.project_id != implementer.project_id {
            return Err("reviewer run belongs to another project".to_string());
        }
        let attestation = attest_reviewer(&reviewer, &implementer)?;
        let id = new_id("drr");
        sqlx::query("INSERT OR IGNORE INTO development_run_reviews(id, run_id, evidence_id, idempotency_key, candidate_commit, disposition, reviewer_identity, implementer_identity, source, observed_at, reviewer_attestation, approval_eligible, status) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, ?12)")
            .bind(&id).bind(&run_id).bind(&input.evidence_id).bind(&input.idempotency_key).bind(&input.candidate_commit).bind(input.disposition.as_str()).bind(reviewer.label()).bind(implementer.label()).bind(&input.source).bind(input.observed_at).bind(&attestation).bind(VALID_REVIEW)
            .execute(&mut *tx).await.map_err(db("write development review"))?;
        let review: DevelopmentReview = sqlx::query_as("SELECT id, run_id, evidence_id, idempotency_key, candidate_commit, disposition, reviewer_identity, implementer_identity, source, observed_at, reviewer_attestation, approval_eligible, status, invalidated_at, invalidated_by_commit FROM development_run_reviews WHERE idempotency_key = ?1")
            .bind(&input.idempotency_key).fetch_one(&mut *tx).await.map_err(db("read stored development review"))?;
        if review.run_id != run_id
            || review.evidence_id != input.evidence_id
            || review.candidate_commit != input.candidate_commit
            || review.disposition != input.disposition.as_str()
            || review.reviewer_identity != reviewer.label()
            || review.implementer_identity != implementer.label()
            || review.source != input.source
            || review.observed_at != input.observed_at
        {
            return Err(
                "development review idempotency key was reused with a different payload"
                    .to_string(),
            );
        }
        tx.commit().await.map_err(db("commit development review"))?;
        Ok(review)
    }

```
