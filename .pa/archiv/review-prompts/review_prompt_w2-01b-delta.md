# Delta-Review W2-01b (Runde 2)

Du bist ein anbieterfremder Reviewer (Autor: Claude Code, Anthropic). Repo ProjectA,
Rust loopback-HTTP-API. Runde 1 lieferte die Befunde unten; der Autor hat sie so
disponiert. Pruefe (a) ob die angenommenen Befunde im Delta korrekt behoben sind,
(b) ob die Ablehnungen tragen (insbesondere R1: Rollenpolitik bleibt im Store,
Route speichert nicht-Reviewer-Runs als `unverified`, wie der Store es entscheidet),
(c) ob das Delta neue Fehler einfuehrt. Format: Tabelle ID/Schwere/Datei:Zeile/Befund/
Vorschlag, dann Gesamturteil "freigeben", "freigeben mit Auflagen" oder "nicht
freigeben". Erfinde keine Befunde.

## Dispositionen Runde 1

# W2-01b Review-Dispositionen

Reviews: `.pa/review_w2-01b_kimi-k3.md`, `.pa/review_w2-01b_glm-5.2.md`
(Runde 1, Kandidat `745a473`, Prompt `.pa/review_prompt_w2-01b.md`).
Beide Urteile: "freigeben mit Auflagen". Kein Befund der Schwere "hoch".
Jeder Befund wurde am Baum geprueft.

| ID | Quelle | Schwere | Befund | Disposition |
|----|--------|---------|--------|-------------|
| R1 | kimi-k3 | mittel | Die Route erzwingt keine Reviewer-Rolle; ein Bystander-Run desselben Projekts kann eine Disposition schreiben. Auflage: nur mit der Rollenpruefung (W2-04b) ausliefern. | **Abgelehnt als Routen-Aenderung, als Doku angenommen.** Wer ein `verified`-Review geben darf, entscheidet der Store (W2-04b, PR #112): dort wird ein Run ohne Reviewer-Rolle *gespeichert, aber `unverified`*, nicht abgewiesen. Eine zweite, strengere Rollenpolitik an der Route wuerde von der Store-Politik abweichen (zwei Wahrheiten), und `store/` ist fuer dieses Paket gesperrt. Kein Review traegt Freigabe-Autoritaet (`approval_eligible` bleibt 0). Mit PR #112 gemergt lokal geprueft: beide Routentests gruen. Doku-Satz in `CONTINUOUS.md` ergaenzt. Ob unverifizierte Fremd-Reviews ueberhaupt gespeichert werden sollen, steht als Frage im Bericht. |
| R2 | kimi-k3 | niedrig | Fixture ohne Launch-Records liefert 200; die dokumentierte Same-Vendor-403 gilt nur mit Belegen. | **Angenommen (Doku).** Stimmt: `attest_reviewer` gibt ohne Belege `unverified:` zurueck (fail-closed fuer `verified`, nicht fuer das Speichern). `CONTINUOUS.md` praezisiert. |
| R3 | kimi-k3 | niedrig | 404/409/Replay nur als String-Unit-Test, nicht ueber HTTP. | **Angenommen.** Neuer Test `review_route_maps_store_refusals_and_replays_at_the_seam` (unbekannte Evidenz 404, fremder Kandidat 409, fremdes Projekt 403, Replay 200 mit gleicher ID, gleicher Schluessel mit anderer Disposition 409, keine Fremd-Zeile). |
| R4 | kimi-k3 | niedrig | Kuenftige Rollen-Fehler des Stores brauchen einen Arm in `agent_error`. | **Zur Kenntnis.** PR #112 lehnt nicht wegen der Rolle ab (s. R1); seine Rollen-*Aufloesungs*fehler sind Datenintegritaetsfehler (`malformed team assignment row`, `unknown dispatch role`) und bleiben bewusst 500, `unknown development run` 404, `... conflicts ...` 409 ueber `continuous_error`. Typisierte Fehler: Folgearbeit. |
| R5 | kimi-k3 | niedrig | 404 vs. 403 erlaubt Existenz-Sondierung fremder Evidenz-IDs. | **Abgelehnt.** Loopback-API, lokale Prozesse, Evidenz-IDs zufaellig; die Reihenfolge liegt im Store (gesperrt). Gleicher Befund wie G2. |
| R6 | kimi-k3 | niedrig | Kommentar-Nummerierung (1)→(3)→(2). | **Angenommen**, korrigiert. |
| G1 | glm-5.2 | niedrig | `"evidenceId is required"` → 400 haengt an `continuous_error`. | **Abgelehnt, belegt.** `continuous_error` bildet `contains("is required")` auf 400 ab (`api.rs`, Funktion `continuous_error`); der Unit-Test haelt genau das fest. |
| G2 | glm-5.2 | niedrig | Evidenz-Existenz (404) vor Projektpruefung (403) legt Existenz offen. | **Abgelehnt.** Wie R5. |
| G3 | glm-5.2 | niedrig | Same-Vendor- und Cross-Project-403 nicht ueber HTTP getestet. | **Teilweise angenommen.** Cross-Project-403 jetzt ueber HTTP im neuen Test. Same-Vendor braucht Launch-Receipts (`development_launches.route_json`), die nur der Launch-Service schreibt; der Store-Test `reviewer_principal_comes_from_launch_records_not_caller_labels` deckt die Regel ab, die Route reicht nur den String weiter (Unit-Test der Abbildung). |
| G4 | glm-5.2 | niedrig | `deny_unknown_fields` auf `ReviewInput` im Material nicht sichtbar. | **Abgelehnt, belegt.** `store/development_runs.rs`: `#[serde(rename_all = "camelCase", deny_unknown_fields)] pub struct ReviewInput`; der Forging-Test waere sonst rot. |

Zaehlung: 10 Befunde; angenommen 3 (R3, R6, R2 als Doku), teilweise 1 (G3),
Doku statt Codeaenderung 1 (R1), zur Kenntnis 1 (R4), abgelehnt mit Beleg 4
(R5, G1, G2, G4).


## Delta-Diff (745a473..0f61519)
```diff
diff --git a/docs/development/CONTINUOUS.md b/docs/development/CONTINUOUS.md
index 9c7bbd2..0da32b2 100644
--- a/docs/development/CONTINUOUS.md
+++ b/docs/development/CONTINUOUS.md
@@ -163,12 +163,16 @@ A reviewer run submits its disposition with `POST /api/hq/v1/agent/review`:
 The reviewer is always the run of the scoped credential; the reviewed run is the
 owner of the named evidence. The body carries no identity: `reviewerRunId`,
 `runId` or any other unknown field is refused with HTTP 400 and nothing is written.
-A run reviewing its own candidate, a same-vendor reviewer and a reviewer from
-another project get 403; unknown evidence 404; evidence that is stale or not for
-that candidate, and a reused key with a different payload, 409. The stored review
-records both principals and the attestation from launch records; it grants no
-approval authority (`approvalEligible` stays false). There is no `pa` command for
-this route yet.
+A run reviewing its own candidate, a reviewer from another project, and a reviewer
+whose launch route receipt resolves to the same single model vendor as the
+implementer's get 403; unknown evidence 404; evidence that is stale or not for
+that candidate, and a reused key with a different payload, 409. Without launch
+receipts for both runs the vendor cannot be compared: the review is stored with an
+`unverified:` attestation instead of being refused. The stored review records both
+principals and that attestation; it grants no approval authority
+(`approvalEligible` stays false). Which runs may give a `verified` review (the
+reviewer dispatch role) is decided by the store, not by this route. There is no
+`pa` command for this route yet.
 
 A missing or invalid projecta.dev.json refuses new goal roots; existing roots
 retain their frozen policy. `pa hq tasks checkpoint <id> --status retry --owner
diff --git a/src-tauri/src/api.rs b/src-tauri/src/api.rs
index 82e2247..d306d66 100644
--- a/src-tauri/src/api.rs
+++ b/src-tauri/src/api.rs
@@ -4645,13 +4645,15 @@ pub(crate) mod tests {
 
     /// A real store behind the scoped review route: one implementer run with a
     /// bound candidate and evidence, one reviewer run and one bystander run in
-    /// the same project. Returns the server, the three run ids, the evidence id
-    /// and a raw pool for reading what the store actually wrote.
+    /// the same project, and a stranger run in another project. Returns the
+    /// server, the run ids, the evidence id and a raw pool for reading what the
+    /// store actually wrote.
     struct ReviewRoute {
         server: ApiServer,
         implementer: String,
         reviewer: String,
         bystander: String,
+        stranger: String,
         evidence: String,
         pool: sqlx::SqlitePool,
         /// Last, so the directory outlives the server and the pool on drop.
@@ -4666,34 +4668,42 @@ pub(crate) mod tests {
         let db = dir.path().join("projecta.db");
         tauri::async_runtime::block_on(async {
             let store = crate::store::Store::open(&db).await.unwrap();
-            let project = store
-                .create_project("review", &dir.path().to_string_lossy())
-                .await
-                .unwrap();
             let pool = sqlx::SqlitePool::connect(&format!("sqlite:{}", db.display()))
                 .await
                 .unwrap();
-            sqlx::query("INSERT INTO continuous_projects VALUES(?, 'enabled', 1)")
-                .bind(&project.id)
-                .execute(&pool)
-                .await
-                .unwrap();
-            sqlx::query("INSERT INTO continuous_goals(id,project_id,root_goal_id,objective,status,deadline_at,admitted,created_at,updated_at) VALUES('goal',?,'goal','goal','open',9999999999,1,1,1)")
-                .bind(&project.id).execute(&pool).await.unwrap();
-            sqlx::query("INSERT INTO continuous_root_policies VALUES('goal',?,'test',1)")
-                .bind(
-                    serde_json::to_string(
-                        &crate::development_policy::DevelopmentPolicy::defaults(),
+            for (name, goal) in [("review", "goal"), ("elsewhere", "goal-x")] {
+                let project = store
+                    .create_project(name, &dir.path().join(name).to_string_lossy())
+                    .await
+                    .unwrap();
+                sqlx::query("INSERT INTO continuous_projects VALUES(?, 'enabled', 1)")
+                    .bind(&project.id)
+                    .execute(&pool)
+                    .await
+                    .unwrap();
+                sqlx::query("INSERT INTO continuous_goals(id,project_id,root_goal_id,objective,status,deadline_at,admitted,created_at,updated_at) VALUES(?1,?2,?1,'goal','open',9999999999,1,1,1)")
+                    .bind(goal).bind(&project.id).execute(&pool).await.unwrap();
+                sqlx::query("INSERT INTO continuous_root_policies VALUES(?,?,'test',1)")
+                    .bind(goal)
+                    .bind(
+                        serde_json::to_string(
+                            &crate::development_policy::DevelopmentPolicy::defaults(),
+                        )
+                        .unwrap(),
                     )
-                    .unwrap(),
-                )
-                .execute(&pool)
-                .await
-                .unwrap();
+                    .execute(&pool)
+                    .await
+                    .unwrap();
+            }
             let mut runs = Vec::new();
-            for owner in ["implementer", "reviewer", "bystander"] {
-                sqlx::query("INSERT INTO continuous_tasks(id,goal_id,objective,owned_paths_json,dependencies_json,status,claim_owner,claim_fence,created_at,updated_at) VALUES(?1,'goal',?1,'[]','[]','running',?1,1,1,1)")
-                    .bind(owner).execute(&pool).await.unwrap();
+            for (owner, goal) in [
+                ("implementer", "goal"),
+                ("reviewer", "goal"),
+                ("bystander", "goal"),
+                ("stranger", "goal-x"),
+            ] {
+                sqlx::query("INSERT INTO continuous_tasks(id,goal_id,objective,owned_paths_json,dependencies_json,status,claim_owner,claim_fence,created_at,updated_at) VALUES(?1,?2,?1,'[]','[]','running',?1,1,1,1)")
+                    .bind(owner).bind(goal).execute(&pool).await.unwrap();
                 runs.push(
                     store
                         .record_development_run_intent(owner, owner, 1)
@@ -4739,6 +4749,7 @@ pub(crate) mod tests {
                 implementer: runs[0].clone(),
                 reviewer: runs[1].clone(),
                 bystander: runs[2].clone(),
+                stranger: runs[3].clone(),
                 evidence,
                 pool,
                 _dir: dir,
@@ -4814,7 +4825,7 @@ pub(crate) mod tests {
         assert_eq!(status, 403, "{body}");
         assert!(stored_reviews(&fx.pool).is_empty());
 
-        // (3) Missing, unknown and broad credentials, as on the other routes.
+        // (2) Missing, unknown and broad credentials, as on the other routes.
         let clean = review_body(&fx.evidence, "review-1").to_string();
         assert_eq!(call(port, "POST", path, None, &clean).0, 401);
         assert_eq!(
@@ -4833,7 +4844,7 @@ pub(crate) mod tests {
         assert_eq!(call(port, "POST", &query, Some(&reviewer), &clean).0, 403);
         assert!(stored_reviews(&fx.pool).is_empty());
 
-        // (2) The normal case: the review is stored with the token's run as
+        // (3) The normal case: the review is stored with the token's run as
         // reviewer and the evidence owner as the reviewed run.
         let (status, review) = call(port, "POST", path, Some(&reviewer), &clean);
         assert_eq!(status, 200, "{review}");
@@ -4857,6 +4868,52 @@ pub(crate) mod tests {
         assert_eq!(stored_reviews(&fx.pool).len(), 1);
     }
 
+    /// The store's refusals of a well-formed review reach the caller through
+    /// the route with their own status, and none of them writes a review:
+    /// unknown evidence 404, a candidate other than the evidence's 409, a
+    /// reviewer from another project 403. A replay of the same submission is
+    /// idempotent; the same key with another payload is a conflict.
+    #[test]
+    fn review_route_maps_store_refusals_and_replays_at_the_seam() {
+        let fx = review_route();
+        let port = fx.server.port();
+        let reviewer = fx
+            .server
+            .issue_run_descriptor(&fx.reviewer, "reviewer", 1, 60)
+            .unwrap()
+            .token;
+        let stranger = fx
+            .server
+            .issue_run_descriptor(&fx.stranger, "stranger", 1, 60)
+            .unwrap()
+            .token;
+        let path = "/api/hq/v1/agent/review";
+        let post =
+            |token: &str, body: &Value| call(port, "POST", path, Some(token), &body.to_string());
+
+        let (status, body) = post(&reviewer, &review_body("dre-missing", "missing"));
+        assert_eq!(status, 404, "{body}");
+        let mut other_commit = review_body(&fx.evidence, "other-commit");
+        other_commit["candidateCommit"] = json!("f".repeat(40));
+        let (status, body) = post(&reviewer, &other_commit);
+        assert_eq!(status, 409, "{body}");
+        let (status, body) = post(&stranger, &review_body(&fx.evidence, "stranger"));
+        assert_eq!(status, 403, "{body}");
+        assert!(stored_reviews(&fx.pool).is_empty());
+
+        let first = review_body(&fx.evidence, "replay");
+        let (status, saved) = post(&reviewer, &first);
+        assert_eq!(status, 200, "{saved}");
+        let (status, replayed) = post(&reviewer, &first);
+        assert_eq!(status, 200, "{replayed}");
+        assert_eq!(replayed["id"], saved["id"]);
+        let mut changed = first.clone();
+        changed["disposition"] = json!("changesRequested");
+        let (status, body) = post(&reviewer, &changed);
+        assert_eq!(status, 409, "{body}");
+        assert_eq!(stored_reviews(&fx.pool).len(), 1);
+    }
+
     #[test]
     fn scoped_credentials_are_revoked_when_server_handle_drops() {
         let fx = fixture("api-run-teardown");

```

## Unveraendert: Route in agent_access.rs
```rust
// W2-01b: the reviewer principal is the run this credential was minted
        // for. `ReviewInput` denies unknown fields, so a body naming a run
        // (`reviewerRunId`, `runId`, ...) is refused with 400 like every other
        // injected run field on these routes - never silently ignored, so a
        // confused or forging caller learns its claim did not count. The
        // reviewed run is the owner of the named evidence, derived by the store.
        ("POST", ["api", "hq", "v1", "agent", "review"]) => {
            let input = match serde_json::from_str::<crate::store::development_runs::ReviewInput>(
                &request.body,
            ) {
                Ok(input) => input,
                Err(_) => return Response::error(400, "invalid review input"),
            };
            backend.agent_submit_review(&grant.run_id, &grant.owner, grant.fence, input)
        }
        
```
