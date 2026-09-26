# Review-Auftrag W2-02 (ProjectA, Tauri 2: Rust + SQLite)

Du bist unabhaengiger Code-Reviewer (anderer Anbieter als der Autor, Claude
Code). Pruefe den Diff unten auf Korrektheit, Sicherheitsluecken und
fehlende Faelle. Antworte auf Deutsch mit: Urteil (freigeben / freigeben mit
Auflagen / ablehnen), dann nummerierte Befunde mit Schwere (hoch/mittel/niedrig),
Datei:Zeile, Begruendung und Vorschlag. Keine Stilfragen ohne Wirkung.

## Paket (docs/PLAN.md)

"W2-02 Review-/Test-Dispositionen an den Integrationskandidaten binden · M ·
Lane store.rs · Invalidierung bei jeder betroffenen Aenderung · nach W2-01."
Aus dem W5-Plan (Invariante I3): "Beleg an genau diesen Head-SHA gebunden
(W2-02; jeder neue Commit entwertet alte Belege)".

## Ausgangslage (origin/main, nach W2-01 / PR #92)

`src-tauri/src/store/development_runs.rs`:
- `development_run_candidates(run_id PK, candidate_commit, source, observed_at)`:
  der aktuelle Kandidat eines Continuous-Runs.
- `development_run_evidence` (Test-/Messbelege) und `development_run_reviews`
  (Review-Dispositionen approved/changes_requested) tragen je
  `candidate_commit`; Schreiben verlangt Gleichheit mit dem gebundenen
  Kandidaten (`require_bound_candidate`), Reviews verlangen gueltige Evidence
  desselben Commits.
- `bind_candidate` (einziger Schreiber der Bindung; aufgerufen von
  `bind_development_run_candidate` — Worker-Pfad, prueft vorher per Git volle
  SHA, HEAD-Gleichheit und Pfadbesitz in `workers/candidate_scope.rs` — und
  von `invalidate_development_run_evidence_for_candidate` — kuenftiger
  Integrationspfad, "does not claim to observe Git itself") invalidiert beim
  Wechsel auf einen anderen Commit in derselben Transaktion alle Evidence und
  Reviews anderer Commits (sticky: Rueckkehr zum alten Commit belebt nichts).
- Luecken: (1) Der Store nahm jede nichtleere Zeichenkette als Kandidat an.
  `HEAD`, ein Ref oder eine Abkuerzung bleiben als String gleich, waehrend der
  Code darunter wechselt -> keine Neubindung, keine Invalidierung, alte
  Dispositionen bleiben gueltig. (2) Eine aeltere Beobachtung (observedAt
  kleiner als die gebundene) eines anderen Commits konnte die Bindung auf einen
  bereits ersetzten Kandidaten zuruecksetzen; neue Belege/Reviews haengen dann
  am ueberholten Kandidaten.

## Design (kleinste korrekte Aenderung)

In `bind_candidate` (also fuer beide Einstiegspunkte):
- `require_full_commit_id`: 40 oder 64 Zeichen, nur `0-9a-f` (Git gibt
  Objekt-IDs klein aus). Grossschreibung wird abgelehnt statt normalisiert.
- Monotonie: anderer Commit mit `observed_at < gebundenes observed_at` ->
  Fehler "stale candidate observation". Gleicher Commit bleibt idempotenter
  Replay (Ok(0), Provenienz unveraendert), unabhaengig vom Zeitpunkt. Gleiche
  Sekunde mit anderem Commit ist erlaubt (Worker bindet mit `now_unix_secs()`).
- Keine Schema-Aenderung, keine Migration. Evidence/Review-Eingaben muessen
  weiterhin exakt dem gebundenen Kandidaten entsprechen und sind damit implizit
  volle IDs. Alt-Zeilen mit Nicht-Hex-Kandidaten (nur aus Tests; der einzige
  Produktionsschreiber prueft schon volle SHA) werden beim naechsten Rebind
  ersetzt.
- Testfixtures verwenden volle IDs (`COMMIT_A`/`COMMIT_B`) statt
  "commit-a"/"commit-b".

Bewusst NICHT im Paket: Merge-Basis/Merge-Tree als eigene Identitaet (ein
Integrator, der auf einen bewegten main mergt, erzeugt einen neuen Commit und
bindet ihn ueber den Integrationspfad -> alle alten Dispositionen verfallen);
vertrauenswuerdige Test-Quelle (Evidence ist weiterhin Agentenangabe);
`api.rs`-Route fuer Reviews (andere Nahtstelle).

## Nachweis

- Rot `f632f11`: `cargo test --bin projecta store::development_` -> 70 passed,
  1 failed (`dispositions_bind_to_the_exact_current_candidate`, HEAD wurde
  gebunden), exit 101.
- Gruen `96dc42c`: `cargo test --bin projecta store::` -> 180 passed, 0 failed;
  `workers::development` -> 26 passed.

## Diff gegen origin/main

```diff
diff --git a/src-tauri/src/store/development_events.rs b/src-tauri/src/store/development_events.rs
index b9be93e..ee568a5 100644
--- a/src-tauri/src/store/development_events.rs
+++ b/src-tauri/src/store/development_events.rs
@@ -48,6 +48,9 @@ mod tests {
     use crate::{development_policy::DevelopmentPolicy, testutil::TempDir};
     use serde_json::{json, Value};
 
+    const COMMIT_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
+    const COMMIT_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
+
     async fn fixture() -> (TempDir, Store, String, String) {
         let dir = TempDir::new("development-events");
         let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
@@ -304,14 +307,14 @@ mod tests {
             .unwrap();
         assert_eq!(events(&store, &project).await.len(), 1);
         store
-            .bind_development_run_candidate(&run, "owner", 1, "commit-a", "private-source", 7)
+            .bind_development_run_candidate(&run, "owner", 1, COMMIT_A, "private-source", 7)
             .await
             .unwrap();
         let input = EvidenceInput {
             idempotency_key: "key".into(),
             source: "private-source".into(),
             observed_at: 7,
-            candidate_commit: "commit-a".into(),
+            candidate_commit: COMMIT_A.into(),
             measurement: EvidenceMeasurement::Measured {
                 value: json!({"private":"measurement"}),
             },
@@ -328,7 +331,7 @@ mod tests {
         let review = ReviewInput {
             idempotency_key: "review".into(),
             evidence_id: saved.id,
-            candidate_commit: "commit-a".into(),
+            candidate_commit: COMMIT_A.into(),
             disposition: ReviewDisposition::Approved,
             source: "private-source".into(),
             observed_at: 8,
@@ -350,7 +353,7 @@ mod tests {
             .unwrap();
         assert_eq!(events(&store, &project).await.len(), 5);
         store
-            .bind_development_run_candidate(&run, "owner", 1, "commit-b", "git", 9)
+            .bind_development_run_candidate(&run, "owner", 1, COMMIT_B, "git", 9)
             .await
             .unwrap();
         let all = events(&store, &project).await;
diff --git a/src-tauri/src/store/development_run_contention_tests.rs b/src-tauri/src/store/development_run_contention_tests.rs
index cbdf873..2aaef72 100644
--- a/src-tauri/src/store/development_run_contention_tests.rs
+++ b/src-tauri/src/store/development_run_contention_tests.rs
@@ -50,7 +50,7 @@ async fn sibling_run_writers_wait_without_losing_authority_or_evidence() {
             &run.id,
             "worker-a",
             7,
-            "candidate",
+            tests::COMMIT_A,
             "test",
             now_unix_secs(),
         ),
@@ -66,7 +66,7 @@ async fn sibling_run_writers_wait_without_losing_authority_or_evidence() {
                 idempotency_key: "proof".into(),
                 source: "test".into(),
                 observed_at: now_unix_secs(),
-                candidate_commit: "candidate".into(),
+                candidate_commit: tests::COMMIT_A.into(),
                 measurement: EvidenceMeasurement::Measured {
                     value: serde_json::json!(true),
                 },
diff --git a/src-tauri/src/store/development_runs.rs b/src-tauri/src/store/development_runs.rs
index 1583650..2fe5be5 100644
--- a/src-tauri/src/store/development_runs.rs
+++ b/src-tauri/src/store/development_runs.rs
@@ -612,6 +612,8 @@ impl Store {
     /// Bind the candidate before accepting evidence. Rebinding a different
     /// commit invalidates every older candidate-bound record in the same
     /// transaction; callers cannot defer invalidation to a best-effort step.
+    /// The candidate is named by its full commit ID, and an observation older
+    /// than the bound one cannot rebind (see `bind_candidate`).
     pub async fn bind_development_run_candidate(
         &self,
         run_id: &str,
@@ -974,19 +976,26 @@ async fn bind_candidate(
     source: &str,
     observed_at: i64,
 ) -> Result<u64, String> {
-    let bound: Option<(String,)> =
-        sqlx::query_as("SELECT candidate_commit FROM development_run_candidates WHERE run_id = ?1")
-            .bind(run_id)
-            .fetch_optional(&mut **tx)
-            .await
-            .map_err(db("read candidate binding"))?;
+    require_full_commit_id(candidate_commit)?;
+    let bound: Option<(String, i64)> = sqlx::query_as(
+        "SELECT candidate_commit, observed_at FROM development_run_candidates WHERE run_id = ?1",
+    )
+    .bind(run_id)
+    .fetch_optional(&mut **tx)
+    .await
+    .map_err(db("read candidate binding"))?;
     match bound {
         None => {
             sqlx::query("INSERT INTO development_run_candidates(run_id, candidate_commit, source, observed_at) VALUES(?1, ?2, ?3, ?4)")
                 .bind(run_id).bind(candidate_commit).bind(source).bind(observed_at).execute(&mut **tx).await.map_err(db("write candidate binding"))?;
             Ok(0)
         }
-        Some((bound,)) if bound == candidate_commit => Ok(0),
+        Some((bound, _)) if bound == candidate_commit => Ok(0),
+        // An older observation of another commit must not move the binding
+        // back to a candidate that was already replaced.
+        Some((_, bound_at)) if observed_at < bound_at => Err(format!(
+            "stale candidate observation: observedAt {observed_at} is older than the bound candidate ({bound_at})"
+        )),
         Some(_) => {
             sqlx::query("UPDATE development_run_candidates SET candidate_commit = ?1, source = ?2, observed_at = ?3 WHERE run_id = ?4")
                 .bind(candidate_commit).bind(source).bind(observed_at).bind(run_id).execute(&mut **tx).await.map_err(db("update candidate binding"))?;
@@ -1008,6 +1017,23 @@ fn required(value: &str, field: &str) -> Result<String, String> {
     }
 }
 
+/// Evidence and reviews are bound to the candidate by string equality, so the
+/// candidate must be named by its immutable object ID. A ref (`HEAD`), an
+/// abbreviation or another spelling could name changed code without a
+/// rebind, which would keep old dispositions valid. Git prints object IDs in
+/// lower case: SHA-1 has 40 digits, SHA-256 has 64.
+fn require_full_commit_id(commit: &str) -> Result<(), String> {
+    if matches!(commit.len(), 40 | 64)
+        && commit
+            .bytes()
+            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
+    {
+        Ok(())
+    } else {
+        Err("candidateCommit must be a full Git commit ID in lower case".to_string())
+    }
+}
+
 fn validate_evidence(input: &EvidenceInput) -> Result<(), String> {
     required(&input.idempotency_key, "idempotencyKey")?;
     required(&input.source, "source")?;
@@ -1130,6 +1156,10 @@ mod tests {
     use crate::development_policy::DevelopmentPolicy;
     use crate::testutil::TempDir;
 
+    /// Full commit IDs: a candidate is bound by its exact Git object name.
+    pub(super) const COMMIT_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
+    pub(super) const COMMIT_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
+
     pub(super) async fn fixture() -> (TempDir, Store, String, String) {
         let dir = TempDir::new("development-runs");
         let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
@@ -1442,19 +1472,19 @@ mod tests {
             .await
             .unwrap();
         store
-            .bind_development_run_candidate(&run.id, "worker-a", 7, "commit-a", "git", 6)
+            .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_A, "git", 6)
             .await
             .unwrap();
         let saved = store
-            .record_development_evidence(&run.id, "worker-a", 7, evidence("commit-a"))
+            .record_development_evidence(&run.id, "worker-a", 7, evidence(COMMIT_A))
             .await
             .unwrap();
-        assert_eq!(saved.candidate_commit, "commit-a");
+        assert_eq!(saved.candidate_commit, COMMIT_A);
         assert!(store
-            .record_development_evidence(&run.id, "worker-a", 7, evidence("commit-a"))
+            .record_development_evidence(&run.id, "worker-a", 7, evidence(COMMIT_A))
             .await
             .is_ok());
-        let mut mismatch = evidence("commit-a");
+        let mut mismatch = evidence(COMMIT_A);
         mismatch.payload = serde_json::json!({"command": "other"});
         assert!(store
             .record_development_evidence(&run.id, "worker-a", 7, mismatch)
@@ -1463,7 +1493,7 @@ mod tests {
         let review = ReviewInput {
             idempotency_key: "review-key".into(),
             evidence_id: saved.id,
-            candidate_commit: "commit-a".into(),
+            candidate_commit: COMMIT_A.into(),
             disposition: ReviewDisposition::Approved,
             source: "review-service".into(),
             observed_at: 8,
@@ -1478,7 +1508,7 @@ mod tests {
         assert!(saved_review.reviewer_attestation.contains("unavailable"));
         assert_eq!(
             store
-                .bind_development_run_candidate(&run.id, "worker-a", 7, "commit-b", "git", 9)
+                .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_B, "git", 9)
                 .await
                 .unwrap()
                 .invalidated_records,
@@ -1495,7 +1525,7 @@ mod tests {
             .iter()
             .find(|record| record["run"]["id"] == run.id.as_str())
             .unwrap();
-        assert_eq!(implementer["candidate"]["candidateCommit"], "commit-b");
+        assert_eq!(implementer["candidate"]["candidateCommit"], COMMIT_B);
         assert_eq!(implementer["candidate"]["source"], "git");
         assert_eq!(implementer["candidate"]["observedAt"], 9);
         let briefing = store
@@ -1503,7 +1533,7 @@ mod tests {
             .await
             .unwrap();
         assert_eq!(briefing["reviews"][0]["status"], "invalidated");
-        assert_eq!(briefing["reviews"][0]["invalidatedByCommit"], "commit-b");
+        assert_eq!(briefing["reviews"][0]["invalidatedByCommit"], COMMIT_B);
     }
 
     #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
@@ -1516,11 +1546,11 @@ mod tests {
         let before = store.development_records_snapshot("project").await.unwrap();
         assert!(before["runs"][0]["candidate"].is_null());
         store
-            .bind_development_run_candidate(&run.id, "worker-a", 7, "commit-a", "git", 6)
+            .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_A, "git", 6)
             .await
             .unwrap();
         let after = store.development_records_snapshot("project").await.unwrap();
-        assert_eq!(after["runs"][0]["candidate"]["candidateCommit"], "commit-a");
+        assert_eq!(after["runs"][0]["candidate"]["candidateCommit"], COMMIT_A);
         assert!(after["runs"][0]["evidence"].as_array().unwrap().is_empty());
     }
 
@@ -1532,11 +1562,11 @@ mod tests {
             .await
             .unwrap();
         store
-            .bind_development_run_candidate(&run.id, "worker-a", 7, "commit-a", "git", 6)
+            .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_A, "git", 6)
             .await
             .unwrap();
         store
-            .record_development_evidence(&run.id, "worker-a", 7, evidence("commit-a"))
+            .record_development_evidence(&run.id, "worker-a", 7, evidence(COMMIT_A))
             .await
             .unwrap();
         let context = store
@@ -1544,8 +1574,8 @@ mod tests {
             .await
             .unwrap();
         assert_eq!(context["task"]["objective"], "task");
-        assert_eq!(context["candidate"]["candidateCommit"], "commit-a");
-        assert_eq!(context["evidence"][0]["candidateCommit"], "commit-a");
+        assert_eq!(context["candidate"]["candidateCommit"], COMMIT_A);
+        assert_eq!(context["evidence"][0]["candidateCommit"], COMMIT_A);
         assert!(context["evidence"][0].get("payload").is_none());
         let id = context["evidence"][0]["id"].as_str().unwrap();
         assert_eq!(
@@ -1570,7 +1600,7 @@ mod tests {
             .await
             .is_err());
         assert!(store
-            .record_development_evidence(&run.id, "worker-a", 7, evidence("commit-a"))
+            .record_development_evidence(&run.id, "worker-a", 7, evidence(COMMIT_A))
             .await
             .is_err());
     }
@@ -1583,11 +1613,11 @@ mod tests {
             .await
             .unwrap();
         store
-            .bind_development_run_candidate(&run.id, "worker-a", 7, "commit-a", "original-git", 6)
+            .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_A, "original-git", 6)
             .await
             .unwrap();
         let replay = store
-            .bind_development_run_candidate(&run.id, "worker-a", 7, "commit-a", "replayed-git", 8)
+            .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_A, "replayed-git", 8)
             .await
             .unwrap();
         let context = store
@@ -1610,11 +1640,11 @@ mod tests {
                 .await
                 .unwrap();
             store
-                .bind_development_run_candidate(&run.id, "worker-a", 7, "commit-a", "git", 6)
+                .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_A, "git", 6)
                 .await
                 .unwrap();
             let saved = store
-                .record_development_evidence(&run.id, "worker-a", 7, evidence("commit-a"))
+                .record_development_evidence(&run.id, "worker-a", 7, evidence(COMMIT_A))
                 .await
                 .unwrap();
             if completed {
@@ -1646,13 +1676,13 @@ mod tests {
                 .agent_evidence(&run.id, "worker-a", 7, &saved.id)
                 .await
                 .is_ok());
-            let mut input = evidence("commit-a");
+            let mut input = evidence(COMMIT_A);
             input.idempotency_key = "after-terminal".into();
             let write = store
                 .record_development_evidence(&run.id, "worker-a", 7, input)
                 .await;
             let rebind = store
-                .bind_development_run_candidate(&run.id, "worker-a", 7, "commit-b", "git", 8)
+                .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_B, "git", 8)
                 .await;
             assert!(
                 rebind.is_err(),
@@ -1670,12 +1700,12 @@ mod tests {
             .await
             .unwrap();
         store
-            .bind_development_run_candidate(&run.id, "worker-a", 7, "commit-a", "git", 6)
+            .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_A, "git", 6)
             .await
             .unwrap();
         let mut first_id = String::new();
         for n in 0..40 {
-            let mut input = evidence("commit-a");
+            let mut input = evidence(COMMIT_A);
             input.idempotency_key = format!("bounded-{n}");
             input.observed_at = 7 + n;
             let saved = store
@@ -1704,7 +1734,7 @@ mod tests {
         assert_eq!(page["total"], 40);
         let cursor = page["nextCursor"].as_str().unwrap();
         // A backdated arrival must not shift an already-started traversal.
-        let mut late = evidence("commit-a");
+        let mut late = evidence(COMMIT_A);
         late.idempotency_key = "late".into();
         late.observed_at = 1;
         store
@@ -1761,11 +1791,11 @@ mod tests {
             .await
             .unwrap();
         store
-            .bind_development_run_candidate(&run.id, "worker-a", 7, "commit-a", "git", 6)
+            .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_A, "git", 6)
             .await
             .unwrap();
         let saved = store
-            .record_development_evidence(&run.id, "worker-a", 7, evidence("commit-a"))
+            .record_development_evidence(&run.id, "worker-a", 7, evidence(COMMIT_A))
             .await
             .unwrap();
         let reviewer = launched_run(&store, "task-r", "worker-r", 3, None).await;
@@ -1773,7 +1803,7 @@ mod tests {
             let review = ReviewInput {
                 idempotency_key: format!("page-review-{n}"),
                 evidence_id: saved.id.clone(),
-                candidate_commit: "commit-a".into(),
+                candidate_commit: COMMIT_A.into(),
                 disposition: ReviewDisposition::Approved,
                 source: "review-service".into(),
                 observed_at: 8,
@@ -1819,7 +1849,7 @@ mod tests {
         store.pool.close().await;
         let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
         store
-            .bind_development_run_candidate(&run.id, "worker-a", 7, "commit-b", "git", 9)
+            .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_B, "git", 9)
             .await
             .unwrap();
         let tail = store
@@ -1828,13 +1858,14 @@ mod tests {
             .unwrap();
         assert_eq!(tail["items"].as_array().unwrap().len(), 8);
         assert!(tail["nextCursor"].is_null());
-        assert!(tail["items"]
-            .as_array()
-            .unwrap()
-            .iter()
-            .all(
-                |item| item["status"] == "invalidated" && item["invalidatedByCommit"] == "commit-b"
-            ));
+        assert!(
+            tail["items"]
+                .as_array()
+                .unwrap()
+                .iter()
+                .all(|item| item["status"] == "invalidated"
+                    && item["invalidatedByCommit"] == COMMIT_B)
+        );
         let ids: std::collections::BTreeSet<_> = page["items"]
             .as_array()
             .unwrap()
@@ -1850,7 +1881,7 @@ mod tests {
                 .unwrap()["total"],
             1
         );
-        let mut next = evidence("commit-b");
+        let mut next = evidence(COMMIT_B);
         next.idempotency_key = "after-migration".into();
         next.observed_at = 10;
         store
@@ -1903,10 +1934,10 @@ mod tests {
             .await
             .unwrap();
         store
-            .bind_development_run_candidate(&run.id, "worker-a", 7, "commit-a", "git", 6)
+            .bind_development_run_candidate(&run.id, "worker-a", 7, COMMIT_A, "git", 6)
             .await
             .unwrap();
-        let mut unavailable = evidence("commit-a");
+        let mut unavailable = evidence(COMMIT_A);
         unavailable.measurement = EvidenceMeasurement::Unavailable {
             reason: "provider returned no token telemetry".into(),
         };
@@ -1917,7 +1948,7 @@ mod tests {
         let same_identity = ReviewInput {
             idempotency_key: "review-key".into(),
             evidence_id: saved.id,
-            candidate_commit: "commit-a".into(),
+            candidate_commit: COMMIT_A.into(),
             disposition: ReviewDisposition::Approved,
             source: "review-service".into(),
             observed_at: 8,
@@ -1995,7 +2026,7 @@ mod tests {
         ReviewInput {
             idempotency_key: key.into(),
             evidence_id: evidence_id.into(),
-            candidate_commit: "commit-a".into(),
+            candidate_commit: COMMIT_A.into(),
             disposition: ReviewDisposition::Approved,
             source: "review-service".into(),
             observed_at: 8,
@@ -2007,11 +2038,11 @@ mod tests {
         let (_dir, store, _root, task) = fixture().await;
         let implementer = launched_run(&store, &task, "worker-a", 7, Some("claude")).await;
         store
-            .bind_development_run_candidate(&implementer, "worker-a", 7, "commit-a", "git", 6)
+            .bind_development_run_candidate(&implementer, "worker-a", 7, COMMIT_A, "git", 6)
             .await
             .unwrap();
         let saved = store
-            .record_development_evidence(&implementer, "worker-a", 7, evidence("commit-a"))
+            .record_development_evidence(&implementer, "worker-a", 7, evidence(COMMIT_A))
             .await
             .unwrap();
         // The implementer's own credential cannot record a review of itself,
@@ -2096,11 +2127,11 @@ mod tests {
         // proves nothing about independence.
         let implementer = launched_run(&store, &task, "worker-a", 7, None).await;
         store
-            .bind_development_run_candidate(&implementer, "worker-a", 7, "commit-a", "git", 6)
+            .bind_development_run_candidate(&implementer, "worker-a", 7, COMMIT_A, "git", 6)
             .await
             .unwrap();
         let saved = store
-            .record_development_evidence(&implementer, "worker-a", 7, evidence("commit-a"))
+            .record_development_evidence(&implementer, "worker-a", 7, evidence(COMMIT_A))
             .await
             .unwrap();
         let reviewer = launched_run(&store, "task-r", "worker-r", 3, Some("codex")).await;
@@ -2139,4 +2170,101 @@ mod tests {
             .unwrap_err()
             .contains("idempotency"));
     }
+
+    /// W2-02: review and test dispositions count only for the exact candidate
+    /// they name. A name that can move without a rebind (a ref, an
+    /// abbreviation) would keep them valid for changed code, and a stale
+    /// observation must not rebind an older candidate.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn dispositions_bind_to_the_exact_current_candidate() {
+        let (_dir, store, _root, task) = fixture().await;
+        let run = launched_run(&store, &task, "worker-a", 7, Some("claude")).await;
+        for moving in [
+            "HEAD",
+            "refs/heads/main",
+            "aaaaaaa",
+            &COMMIT_A.to_uppercase(),
+        ] {
+            assert!(
+                store
+                    .bind_development_run_candidate(&run, "worker-a", 7, moving, "git", 5)
+                    .await
+                    .unwrap_err()
+                    .contains("full Git commit ID"),
+                "bound a candidate by a movable or ambiguous name: {moving}"
+            );
+        }
+        store
+            .bind_development_run_candidate(&run, "worker-a", 7, COMMIT_A, "git", 6)
+            .await
+            .unwrap();
+        let test = store
+            .record_development_evidence(&run, "worker-a", 7, evidence(COMMIT_A))
+            .await
+            .unwrap();
+        let reviewer = launched_run(&store, "task-r", "worker-r", 3, Some("codex")).await;
+        let review = store
+            .record_development_review(&reviewer, "worker-r", 3, review_input("exact", &test.id))
+            .await
+            .unwrap();
+        assert!(review.reviewer_attestation.starts_with("verified:"));
+        // The integration path reports a change by name, too.
+        assert!(store
+            .invalidate_development_run_evidence_for_candidate(
+                &run,
+                "worker-a",
+                7,
+                "HEAD",
+                "integrator",
+                8
+            )
+            .await
+            .unwrap_err()
+            .contains("full Git commit ID"));
+        assert_eq!(
+            store
+                .bind_development_run_candidate(&run, "worker-a", 7, COMMIT_B, "git", 9)
+                .await
+                .unwrap()
+                .invalidated_records,
+            2
+        );
+        // An observation older than the bound one cannot move the binding
+        // back, neither through the worker nor through the integration path.
+        assert!(store
+            .bind_development_run_candidate(&run, "worker-a", 7, COMMIT_A, "git", 7)
+            .await
+            .unwrap_err()
+            .contains("stale"));
+        assert!(store
+            .invalidate_development_run_evidence_for_candidate(
+                &run,
+                "worker-a",
+                7,
+                COMMIT_A,
+                "integrator",
+                8
+            )
+            .await
+            .unwrap_err()
+            .contains("stale"));
+        let context = store.agent_run_context(&run, "worker-a", 7).await.unwrap();
+        assert_eq!(context["candidate"]["candidateCommit"], COMMIT_B);
+        assert_eq!(context["candidate"]["observedAt"], 9);
+        // Returning to the old commit later does not revive its dispositions.
+        store
+            .bind_development_run_candidate(&run, "worker-a", 7, COMMIT_A, "git", 10)
+            .await
+            .unwrap();
+        let reviews = store.list_development_reviews(&run).await.unwrap();
+        assert_eq!(reviews[0].status, INVALIDATED_REVIEW);
+        assert_eq!(reviews[0].invalidated_by_commit.as_deref(), Some(COMMIT_B));
+        let evidence = store.list_development_evidence(&run).await.unwrap();
+        assert_eq!(evidence[0].invalidated_by_commit.as_deref(), Some(COMMIT_B));
+        assert!(store
+            .record_development_review(&reviewer, "worker-r", 3, review_input("revived", &test.id))
+            .await
+            .unwrap_err()
+            .contains("not valid"));
+    }
 }
```
