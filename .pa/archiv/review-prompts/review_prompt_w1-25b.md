# Review-Auftrag W1-25b (ProjectA, Rust/sqlx 0.8.6/SQLite 3.46, WAL, busy_timeout 5 s)

Du bist ein unabhängiger, strenger Code-Reviewer. Antworte auf Deutsch. Liste Befunde nummeriert mit Schweregrad (blocker/major/minor/nit), Datei:Zeile, Begründung und konkretem Vorschlag. Keine Lobreden. Prüfe besonders, ob die Schlussfolgerungen des Autors stimmen.

## Hintergrund
PR #77 (W1-25) fand: Store-Schreiber mit deferred `BEGIN`, die erst lesen (SELECT) und dann schreiben, scheitern bei einem fremden Schreiber sofort mit `(code: 5) database is locked`. SQLite ruft den Busy-Handler in `btreeBeginTrans` nur bei `inTransaction==TRANS_NONE` auf, nicht beim Upgrade Lesen→Schreiben. Fix dort: `begin_write` (BEGIN IMMEDIATE) + `settle(tx, outcome, label)` (explizites Commit/Rollback statt Drop, weil ein gedroppter sqlx-Transaction-Rollback nur asynchron eingereiht wird).
Ein Review nannte ~13 weitere Stellen (Liste unten) mit „demselben Muster“; W1-25b sollte sie umstellen und je Modulgruppe einen roten Test (fremder Schreiber → heute busy) liefern.

## Was der Autor gemessen hat
Neue Tests (Datei unten) lassen eine zweite rohe Verbindung `BEGIN IMMEDIATE` 300 ms halten und verlangen, dass der Store-Aufruf wartet. Gegen den UNVERÄNDERTEN Produktcode:
- GRÜN (warten korrekt): reserve/consume launch, begin_development_delivery, record_development_process_exit, reserve/start/settle/cancel tokens, reserve_discovery_scan, assign_continuous_task, record_agent_checkpoint, reserve_native_capture_owner, acknowledge_native_checkpoint, commit_native_completion, finish_native_session.
  Begründung des Autors: Alle diese Pfade beginnen (nach ggf. `PRAGMA synchronous`, das keine Lesetransaktion öffnet) mit einem schreibenden (Dummy-)UPDATE/INSERT aus TRANS_NONE → Busy-Handler greift.
- ROT: `Store::release_claimed_queue_entries` (store.rs, beim App-Start aufgerufen, NICHT auf der Liste): deferred BEGIN → SELECT → UPDATE. Ausgabe:
```
releasing claimed queue entries must wait for the foreign writer, failed busy after 929.906µs: failed to release claimed task: error returned from database: (code: 5) database is locked
```
Fix: `begin_with("BEGIN IMMEDIATE")`. Danach grün.

## Entscheidung des Autors, die du bewerten sollst
Er stellt die Listen-Stellen NICHT auf `begin_write`/`settle` um. Gründe: (a) kein gemessener Defekt, kein roter Test möglich (Beweismaßstab des Repos: Bugfix nur mit rotem Test); (b) der Drop-statt-settle-Effekt (Sperre hält nach Err-Rückgabe kurz weiter, bis der Worker-Thread den eingereihten ROLLBACK ausführt) führt bei Schreibern, die zuerst schreiben, nur zu kurzem Warten, nicht zu Fehlern, und der einzige lesende Erstzugriff ist behoben; (c) ~250–300 Zeilen Produkt-Diff an einer Nahtstelle ohne Beleg. Zusätzlich (Nachforderung Koordination): alle 150 `#[tokio::test]` in store.rs/store/*.rs → `multi_thread, worker_threads = 2` (reine Attributänderung).
Frage an dich: Ist das haltbar? Gibt es eine Stelle der Liste, die doch lesend beginnt (z. B. versteckt in Hilfsfunktionen)? Gibt es weitere Lese-dann-Schreib-Transaktionen im Store, die der Autor übersehen hat? Ist der Test aussagekräftig (Timing-Schwelle HOLD-50 ms, multi_thread-Runtime, Race beim Signal „lock held“)?

## Produkt-Diff
```diff
diff --git a/src-tauri/src/store.rs b/src-tauri/src/store.rs
index c31c4f9..76020ad 100644
--- a/src-tauri/src/store.rs
+++ b/src-tauri/src/store.rs
@@ -46,6 +46,9 @@ mod journal_watch;
 pub(crate) mod supervisor;
 #[path = "store/team_assignments.rs"]
 pub mod team_assignments;
+#[cfg(test)]
+#[path = "store/write_lock_tests.rs"]
+mod write_lock_tests;
 pub use continuous::{
     ContinuousClaim, ContinuousContext, ContinuousControl, ContinuousGoal, ContinuousTask,
 };
@@ -2586,9 +2589,12 @@ impl Store {
     /// Returns how many claims were resolved. Each attribution consumes its
     /// worker, so two leftover claims can never point at the same one.
     pub async fn release_claimed_queue_entries(&self) -> Result<usize, String> {
+        // Take the writer lock first: a deferred BEGIN would read, and SQLite
+        // skips the busy handler on the later read-to-write upgrade, failing
+        // `database is locked` at once instead of waiting busy_timeout.
         let mut tx = self
             .pool
-            .begin()
+            .begin_with("BEGIN IMMEDIATE")
             .await
             .map_err(|e| format!("failed to begin claim release: {e}"))?;
         let claimed: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
@@ -4044,7 +4050,7 @@ pub(crate) mod tests {
 
     // -- schema versioning & the migration contract (Phase A) ---------------
 
     async fn a_fresh_database_is_created_at_the_current_schema_version() {
         let dir = TempDir::new("store-fresh-version");
         let store = Store::open(&dir.path().join("projecta.db"))
@@ -4058,7 +4064,7 @@ pub(crate) mod tests {
         assert_eq!(store.list_projects().await.unwrap().len(), 1);
     }
 
     async fn a_pre_contract_database_is_adopted_without_a_schema_re_run() {
         let dir = TempDir::new("store-adopt-pre-contract");
         let path = dir.path().join("projecta.db");
@@ -4131,7 +4137,7 @@ pub(crate) mod tests {
         assert_eq!(payload, "keep me");
     }
 
     async fn reopening_a_migrated_database_changes_nothing() {
         let dir = TempDir::new("store-reopen-idempotent");
         let path = dir.path().join("projecta.db");
@@ -4163,7 +4169,7 @@ pub(crate) mod tests {
         assert_eq!(backup_count(), backups_after_first_open);
     }
 
     async fn a_database_from_a_newer_build_is_refused() {
         let dir = TempDir::new("store-too-new");
         let path = dir.path().join("projecta.db");
@@ -4185,7 +4191,7 @@ pub(crate) mod tests {
         assert!(err.contains("newer than this build"), "{err}");
     }
 
     async fn backup_includes_committed_wal_while_an_old_reader_prevents_checkpoint() {
         let dir = TempDir::new("store-backup-wal-contention");
         let path = dir.path().join("projecta.db");
@@ -4225,7 +4231,7 @@ pub(crate) mod tests {
         reader.rollback().await.unwrap();
     }
 
     async fn pre_migration_backups_are_complete_copies_and_kept_to_five() {
         let dir = TempDir::new("store-backup-prune");
         let path = dir.path().join("projecta.db");
@@ -4263,7 +4269,7 @@ pub(crate) mod tests {
         assert_eq!(std::fs::read(&bak).expect("bak still readable"), bak_before);
     }
 
     async fn restore_leaves_bak_bytes_unchanged() {
         let dir = TempDir::new("store-restore-bak");
         let live = dir.path().join("projecta.db");
@@ -4309,7 +4315,7 @@ pub(crate) mod tests {
         );
     }
```

## Neue Testdatei src-tauri/src/store/write_lock_tests.rs
```rust
//! Store writers against a foreign SQLite writer (W1-25b).
//!
//! SQLite runs the busy handler only while a connection holds no
//! transaction yet (`btreeBeginTrans`: the retry loop requires
//! `inTransaction == TRANS_NONE`). A deferred `BEGIN` whose first statement
//! reads and whose later statement writes therefore fails with
//! `(code: 5) database is locked` at once instead of waiting `busy_timeout`.
//! Each test lets a second connection hold the writer lock for [`HOLD`] and
//! requires the store call to wait for it.
use super::development_budget::BudgetPurpose;
use super::development_launches::tests::{bind_test_route, fixture};
use super::development_runs::CheckpointInput;
use super::team_assignments::AssignmentRequest;
use super::*;
use crate::testutil::TempDir;
use std::time::{Duration, Instant};

const HOLD: Duration = Duration::from_millis(300);

/// Takes SQLite's writer lock on a second, foreign connection - as another
/// process or a not yet rolled back pooled connection would - and releases
/// it after [`HOLD`].
async fn foreign_writer(dir: &TempDir) -> tokio::task::JoinHandle<()> {
    use sqlx::Connection as _;
    let options = SqliteConnectOptions::new()
        .filename(dir.path().join("projecta.db"))
        .busy_timeout(Duration::from_secs(5));
    let (locked_tx, locked_rx) = tokio::sync::oneshot::channel();
    let holder = tokio::spawn(async move {
        let mut conn = sqlx::sqlite::SqliteConnection::connect_with(&options)
            .await
            .expect("open foreign connection");
        sqlx::query("BEGIN IMMEDIATE")
            .execute(&mut conn)
            .await
            .expect("take the writer lock");
        locked_tx.send(()).expect("signal lock held");
        tokio::time::sleep(HOLD).await;
        sqlx::query("ROLLBACK")
            .execute(&mut conn)
            .await
            .expect("release the writer lock");
    });
    locked_rx.await.expect("foreign writer holds the lock");
    holder
}

/// Runs `call` while a foreign writer holds the lock; the call must wait
/// for it instead of failing busy. Returns the call's result.
pub(in crate::store) async fn waits<T>(
    what: &str,
    dir: &TempDir,
    call: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let holder = foreign_writer(dir).await;
    let started = Instant::now();
    let result = tokio::time::timeout(Duration::from_secs(20), call)
        .await
        .expect("store call must not hang");
    let elapsed = started.elapsed();
    holder.await.expect("foreign writer task");
    if let Err(error) = &result {
        assert!(
            !error.contains("database is locked"),
            "{what} must wait for the foreign writer, failed busy after {elapsed:?}: {error}"
        );
    }
    assert!(
        elapsed >= HOLD - Duration::from_millis(50),
        "{what} must have waited for the lock, took {elapsed:?}: {:?}",
        result.as_ref().err()
    );
    result
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn releasing_claimed_queue_entries_waits_for_a_foreign_writer() {
    let dir = TempDir::new("write-lock-queue");
    let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
    let project = store
        .create_project("queue", &dir.path().join("repo").to_string_lossy())
        .await
        .unwrap();
    sqlx::query("INSERT INTO task_queue (id, project_id, raw_text, status, created_at) VALUES ('q1', ?, 'task', ?, 1)")
        .bind(&project.id)
        .bind(QUEUE_DISPATCHING)
        .execute(&store.pool)
        .await
        .unwrap();
    let released = waits(
        "releasing claimed queue entries",
        &dir,
        store.release_claimed_queue_entries(),
    )
    .await;
    assert_eq!(released, Ok(1));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn development_launch_writers_wait_for_a_foreign_writer() {
    let (dir, store, run) = fixture().await;
    let launch = waits(
        "a launch reservation",
        &dir,
        store.reserve_development_launch(&run, "owner", 1, "codex"),
    )
    .await
    .unwrap();
    bind_test_route(&store, &run).await;
    waits(
        "a launch consumption",
        &dir,
        store.consume_development_launch(&run, "owner", 1, &launch.worker_id, "session"),
    )
    .await
    .unwrap();
    waits(
        "a delivery",
        &dir,
        store.begin_development_delivery(&run, "owner", 1, "session", b"task"),
    )
    .await
    .unwrap();
    let exited = waits(
        "a process exit",
        &dir,
        store.record_development_process_exit(&launch.worker_id, "session", Some(0)),
    )
    .await;
    assert_eq!(exited, Ok(Some(run)));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn token_budget_writers_wait_for_a_foreign_writer() {
    let (dir, store, _run) = fixture().await;
    let started = waits(
        "a token reservation",
        &dir,
        store.reserve_development_tokens("goal", "plan", BudgetPurpose::Planning, 10, None),
    )
    .await
    .unwrap();
    waits(
        "a token start",
        &dir,
        store.start_development_tokens(&started.id),
    )
    .await
    .unwrap();
    waits(
        "a token settlement",
        &dir,
        store.settle_development_tokens(&started.id, 5, "receipt", now_unix_secs()),
    )
    .await
    .unwrap();
    let cancelled = store
        .reserve_development_tokens("goal", "cancel", BudgetPurpose::Review, 10, None)
        .await
        .unwrap();
    waits(
        "a token cancellation",
        &dir,
        store.cancel_development_tokens(&cancelled.id),
    )
    .await
    .unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_discovery_reservation_waits_for_a_foreign_writer() {
    let (dir, store, _run) = fixture().await;
    waits(
        "a discovery reservation",
        &dir,
        store.reserve_discovery_scan("goal", "scan"),
    )
    .await
    .unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_team_assignment_waits_for_a_foreign_writer() {
    let (dir, store, _run) = fixture().await;
    sqlx::query("INSERT INTO continuous_tasks(id, goal_id, objective, owned_paths_json, dependencies_json, status, created_at, updated_at) VALUES('open-task', 'goal', 'task', '[]', '[]', 'open', 1, 1)")
        .execute(&store.pool)
        .await
        .unwrap();
    let request = AssignmentRequest {
        team_id: "development".into(),
        role: "implementer".into(),
        assignee: "agent".into(),
        expected_revision: 0,
    };
    waits(
        "a team assignment",
        &dir,
        store.assign_continuous_task("open-task", request),
    )
    .await
    .unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_agent_checkpoint_waits_for_a_foreign_writer() {
    let (dir, store, run) = fixture().await;
    let input = CheckpointInput {
        idempotency_key: "first".into(),
        expected_revision: 0,
        completed: vec!["step".into()],
        remaining: vec![],
        failed_approaches: vec![],
        evidence_ids: vec![],
    };
    waits(
        "an agent checkpoint",
        &dir,
        store.record_agent_checkpoint(&run, "owner", 1, input),
    )
    .await
    .unwrap();
}
```

## Neue Tests in bestehenden Modulen
```diff
diff --git a/src-tauri/src/store/development_capture_tests.rs b/src-tauri/src/store/development_capture_tests.rs
index 7fe2141..ad59a65 100644
--- a/src-tauri/src/store/development_capture_tests.rs
+++ b/src-tauri/src/store/development_capture_tests.rs
@@ -4,7 +4,7 @@ use crate::store::development_launches::tests::{bind_test_route, fixture};
 use crate::testutil::TempDir;
 use std::sync::mpsc;
 
 async fn populated_schema17_upgrade_preserves_delivery_without_fabricating_native_proof() {
     let (dir, store, binding, _launch) = ready().await;
     for statement in [
@@ -32,7 +32,7 @@ async fn populated_schema17_upgrade_preserves_delivery_without_fabricating_nativ
     assert_eq!(count, 0);
 }
 
 async fn waiting_checkpoint_rechecks_expiry_and_close_after_acquiring_sqlite_writer() {
     for mutation in [
         "UPDATE development_capture_owners SET deadline_ms=0",
@@ -70,7 +70,7 @@ async fn waiting_checkpoint_rechecks_expiry_and_close_after_acquiring_sqlite_wri
     }
 }
 
 async fn native_checkpoint_rejects_foreign_response_binding_before_any_write() {
     let (_dir, store, binding, launch) = ready().await;
     let owner = store
@@ -163,7 +163,7 @@ async fn accept(store: &Store, owner: &CaptureOwner, stage: Stage, payload: Valu
     assert_eq!(gate.poll().unwrap(), Some(stage));
 }
 
 async fn checkpoint_commit_precedes_ack_and_provisional_receipt_survives_restart_without_secrets() {
     let (dir, store, binding, launch) = ready().await;
     let owner = store
@@ -248,7 +248,7 @@ async fn checkpoint_commit_precedes_ack_and_provisional_receipt_survives_restart
     assert_eq!(status, "intent");
 }
 
 async fn checkpoint_owner_and_stage_races_have_exactly_one_winner() {
     let (_dir, store, binding, launch) = ready().await;
     let second: Launch = serde_json::from_value(serde_json::to_value(&launch).unwrap()).unwrap();
@@ -267,7 +267,7 @@ async fn checkpoint_owner_and_stage_races_have_exactly_one_winner() {
     assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
 }
 
 async fn late_closed_reassigned_and_rebound_checkpoint_writes_are_rejected() {
     for mutation in [
         "UPDATE development_capture_owners SET deadline_ms=0",
@@ -299,7 +299,7 @@ async fn late_closed_reassigned_and_rebound_checkpoint_writes_are_rejected() {
     }
 }
 
 async fn dropped_response_does_not_cancel_commit_and_close_is_a_write_barrier() {
     let (_dir, store, binding, launch) = ready().await;
     let owner = store
@@ -328,3 +328,25 @@ async fn dropped_response_does_not_cancel_commit_and_close_is_a_write_barrier()
         .unwrap();
     assert_eq!(count, 1);
 }
+
+async fn native_capture_writers_wait_for_a_foreign_writer() {
+    use crate::store::write_lock_tests::waits;
+    let (dir, store, binding, launch) = ready().await;
+    let owner = waits(
+        "a capture owner reservation",
+        &dir,
+        store.reserve_native_capture_owner(binding, launch, "owner", 1),
+    )
+    .await
+    .unwrap();
+    let (request, mut gate) = request(&owner.binding, Stage::Launch, launch_payload(&owner));
+    waits(
+        "a native checkpoint",
+        &dir,
+        store.acknowledge_native_checkpoint(&owner, request),
+    )
+    .await
+    .unwrap();
+    assert_eq!(gate.poll().unwrap(), Some(Stage::Launch));
+}
diff --git a/src-tauri/src/store/native_completion.rs b/src-tauri/src/store/native_completion.rs
index 9998a32..3dbbaf4 100644
--- a/src-tauri/src/store/native_completion.rs
+++ b/src-tauri/src/store/native_completion.rs
@@ -310,7 +310,7 @@ mod tests {
         worker
     }
 
     async fn native_session_failure_rolls_back_both_rows_and_preserves_binding_for_retry() {
         let (_dir, store, owner, reply, now) = fixture("native_codex_exec_json", USAGE, 0).await;
         let worker = session_fixture(&store, &owner).await;
@@ -354,7 +354,7 @@ mod tests {
         assert_eq!(count, 1);
     }
 
     async fn native_session_cannot_be_rebound_between_validation_and_commit() {
         let (_dir, store, owner, reply, now) = fixture("native_codex_exec_json", USAGE, 0).await;
         let worker = session_fixture(&store, &owner).await;
@@ -385,7 +385,7 @@ mod tests {
         );
     }
 
     async fn native_session_rejects_stale_missing_rebound_or_conflicting_completion() {
         for case in 0..6 {
             let (_dir, store, owner, reply, now) =
@@ -445,7 +445,7 @@ mod tests {
         }
     }
 
     async fn native_session_preserves_archival_and_nonzero_exit() {
         let (_dir, store, owner, reply, now) =
             fixture("native_codex_exec_json", b"failed", u32::MAX).await;
@@ -461,6 +461,26 @@ mod tests {
         assert_eq!(status, "archived");
         assert_eq!(exit, -1);
     }
+    async fn native_completion_writers_wait_for_a_foreign_writer() {
+        use crate::store::write_lock_tests::waits;
+        let (dir, store, owner, reply, now) = fixture("native_codex_exec_json", USAGE, 0).await;
+        session_fixture(&store, &owner).await;
+        waits(
+            "a native completion",
+            &dir,
+            commit(&store, &owner, &reply, now),
+        )
+        .await
+        .unwrap();
+        waits(
+            "a native session finish",
+            &dir,
+            store.finish_native_session(&owner),
+        )
+        .await
+        .unwrap();
+    }
     async fn commit(
         store: &Store,
         owner: &CaptureOwner,
@@ -475,7 +495,7 @@ mod tests {
         sqlx::query_as("SELECT l.state,b.state,(SELECT count(*) FROM development_capture_results) FROM development_launches l JOIN development_token_reservations b ON b.run_id=l.run_id")
             .fetch_one(&store.pool).await.unwrap()
     }
     async fn native_completion_ignores_cancelled_reservation_history() {
         let (_dir, store, owner, reply, now) = fixture("native_codex_exec_json", USAGE, 0).await;
         sqlx::query("UPDATE development_token_reservations SET state='cancelled'")
@@ -493,7 +513,7 @@ mod tests {
         .unwrap();
         assert_eq!(actual, 15);
     }
     async fn native_completion_settles_once_and_preserves_reconciliation() {
         let (_dir, store, owner, reply, now) = fixture("native_codex_exec_json", USAGE, 0).await;
         commit(&store, &owner, &reply, now).await.unwrap();
@@ -517,7 +537,7 @@ mod tests {
             .unwrap();
         assert!(commit(&store, &owner, &reply, now).await.is_err());
     }
     async fn native_completion_unknown_usage_retains_reserved_capacity() {
         for (transport, stdout, exit) in [
             ("interactive_pty", USAGE, 0),
@@ -538,7 +558,7 @@ mod tests {
             );
         }
     }
     async fn native_completion_settlement_failure_rolls_back_exit_and_result() {
         let (_dir, store, owner, reply, now) = fixture("native_codex_exec_json", USAGE, 0).await;
         sqlx::query("CREATE TRIGGER fail_settlement BEFORE UPDATE OF actual_tokens ON development_token_reservations BEGIN SELECT RAISE(ABORT,'injected settlement failure'); END").execute(&store.pool).await.unwrap();
@@ -551,7 +571,7 @@ mod tests {
             ("spawning".into(), "started".into(), 0)
         );
     }
     async fn native_completion_rechecks_every_binding_after_writer_wait() {
         for mutation in [
             "UPDATE development_launches SET session_id='other'",
@@ -582,7 +602,7 @@ mod tests {
             );
         }
     }
     async fn populated_schema18_upgrade_never_invents_final_native_proof() {
         let (dir, store, owner, _reply, _now) = fixture("native_codex_exec_json", USAGE, 0).await;
         sqlx::query("DROP TABLE development_capture_results")
```

## Die Stellen der Liste (Ausschnitte bis zum ersten commit(), Zeilennummern vom Stand vor W1-25b)
```rust
===== development_budget.rs:162
154:         run: Option<&str>,
155:     ) -> Result<TokenReservation, String> {
156:         if key.trim().is_empty() || key.len() > 128 || !(1..=200_000).contains(&tokens) {
157:             return Err("invalid token reservation key or amount".into());
158:         }
159:         if (purpose == BudgetPurpose::Implementation) != run.is_some() {
160:             return Err("implementation token reservations require exactly one run binding".into());
161:         }
162:         let mut tx = self.pool.begin().await.map_err(db)?;
163:         // Serialize before any reads, including idempotency and root totals.
164:         sqlx::query("UPDATE continuous_goals SET updated_at=updated_at WHERE id=?")
165:             .bind(goal)
166:             .execute(&mut *tx)
167:             .await
168:             .map_err(db)?;
169:         let (root,): (String,) =
170:             sqlx::query_as("SELECT root_goal_id FROM continuous_goals WHERE id=?")
171:                 .bind(goal)
172:                 .fetch_one(&mut *tx)
173:                 .await
174:                 .map_err(db)?;
175:         let previous: Option<TokenReservation> = sqlx::query_as("SELECT * FROM development_token_reservations WHERE root_goal_id=? AND idempotency_key=?")
176:             .bind(&root).bind(key).fetch_optional(&mut *tx).await.map_err(db)?;
177:         if let Some(previous) = previous {
178:             if previous.goal_id != goal
179:                 || previous.purpose != purpose.name()
180:                 || previous.run_id.as_deref() != run
181:                 || previous.reserved_tokens != tokens
182:             {
183:                 return Err("token reservation idempotency conflict".into());
184:             }
185:             tx.commit().await.map_err(db)?;
===== development_budget.rs:228
220:             .map_err(db)?;
221:         tx.commit().await.map_err(db)?;
===== development_budget.rs:245
237:             return Err("worker budget must start with its launch".into());
238:         }
239:         start(&mut tx, id).await?;
240:         tx.commit().await.map_err(db)
===== development_budget.rs:290
282:         &self,
283:         id: &str,
284:         actual: i64,
285:         source: &str,
286:         observed_at: i64,
287:         binding: Option<RunUsageBinding<'_>>,
288:         capture: Option<CaptureLaunchIdentity<'_>>,
289:     ) -> Result<(), String> {
290:         let mut tx = self.pool.begin().await.map_err(db)?;
291:         settle_bound(&mut tx, id, actual, source, observed_at, binding, capture).await?;
292:         tx.commit().await.map_err(db)
===== development_capture.rs:60
52:         binding: Binding,
53:         launch: Launch,
54:         owner: &str,
55:         fence: i64,
56:     ) -> Result<CaptureOwner, String> {
57:         let launch_sha256 = launch.digest()?;
58:         binding.validate()?;
59:         let capability_sha256 = digest(binding.capability.as_bytes());
60:         let mut tx = self.pool.begin().await.map_err(db)?;
61:         ensure_full(&mut tx).await?;
62:         let changed = sqlx::query("INSERT INTO development_capture_owners(run_id,capability_sha256,launch_sha256,claim_owner,claim_fence,deadline_ms,state,created_at) SELECT d.run_id,?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER)+?,'open',unixepoch() FROM development_deliveries d JOIN development_launches l ON l.run_id=d.run_id JOIN development_runs r ON r.id=l.run_id JOIN continuous_tasks t ON t.id=r.task_id WHERE d.run_id=? AND d.session_id=? AND d.process_instance=? AND d.route_sha256=? AND d.input_sha256=? AND d.input_bytes=? AND d.state='started' AND l.session_id=d.session_id AND l.process_instance=d.process_instance AND l.state='spawning' AND r.status IN ('intent','launched') AND r.claim_owner=? AND r.claim_fence=? AND t.status='running' AND t.claim_owner=? AND t.claim_fence=? ON CONFLICT(run_id) DO NOTHING")
63:             .bind(&capability_sha256).bind(&launch_sha256).bind(owner).bind(fence)
64:             .bind((launch.timeout_ms + 10_000) as i64)
65:             .bind(&binding.run_id).bind(&binding.session_id).bind(&binding.process_instance).bind(&binding.route_sha256)
66:             .bind(&launch.input_sha256).bind(launch.input_bytes as i64).bind(owner).bind(fence).bind(owner).bind(fence)
67:             .execute(&mut *tx).await.map_err(db)?;
68:         if changed.rows_affected() != 1 {
69:             return Err("native capture owner consumed, stale or unauthorized".into());
70:         }
71:         check_route(&mut tx, &binding).await?;
72:         tx.commit().await.map_err(db)?;
===== development_capture.rs:109
101:         }
102:         let stage = match request.stage {
103:             Stage::Launch => 0,
104:             Stage::Process => 1,
105:             Stage::Input => 2,
106:             Stage::Receipt => 3,
107:         };
108:         let evidence = owner.evidence(request)?;
109:         let mut tx = self.pool.begin().await.map_err(db)?;
110:         ensure_full(&mut tx).await?;
111:         // One writer transition fences duplicates, out-of-order requests, closed
112:         // owners, expired actors and reassigned tasks, including after lock wait.
113:         let changed = sqlx::query("UPDATE development_capture_owners SET next_stage=next_stage+1 WHERE run_id=? AND capability_sha256=? AND launch_sha256=? AND claim_owner=? AND claim_fence=? AND next_stage=? AND state='open' AND deadline_ms>CAST(unixepoch('subsec')*1000 AS INTEGER) AND EXISTS (SELECT 1 FROM development_deliveries d JOIN development_launches l ON l.run_id=d.run_id JOIN development_runs r ON r.id=l.run_id JOIN continuous_tasks t ON t.id=r.task_id WHERE d.run_id=development_capture_owners.run_id AND d.session_id=? AND d.process_instance=? AND d.route_sha256=? AND d.input_sha256=? AND d.input_bytes=? AND l.session_id=d.session_id AND l.process_instance=d.process_instance AND r.status IN ('intent','launched') AND r.claim_owner=? AND r.claim_fence=? AND t.status='running' AND t.claim_owner=? AND t.claim_fence=?)")
114:             .bind(&owner.binding.run_id).bind(&owner.capability_sha256).bind(&owner.launch_sha256).bind(&owner.owner).bind(owner.fence).bind(stage)
115:             .bind(&owner.binding.session_id).bind(&owner.binding.process_instance).bind(&owner.binding.route_sha256)
116:             .bind(&owner.launch.input_sha256).bind(owner.launch.input_bytes as i64).bind(&owner.owner).bind(owner.fence).bind(&owner.owner).bind(owner.fence)
117:             .execute(&mut *tx).await.map_err(db)?;
118:         if changed.rows_affected() != 1 {
119:             return Err("native checkpoint stale, closed, expired or out of order".into());
120:         }
121:         check_route(&mut tx, &owner.binding).await?;
122:         if stage == 3 {
123:             let previous: String = sqlx::query_scalar("SELECT evidence_json FROM development_capture_checkpoints WHERE run_id=? AND stage=1")
124:                 .bind(&owner.binding.run_id).fetch_one(&mut *tx).await.map_err(db)?;
125:             let previous: Identity =
126:                 serde_json::from_str(&previous).map_err(|_| "invalid stored process identity")?;
127:             let current: Identity = serde_json::from_value(evidence["identity"].clone())
128:                 .map_err(|_| "invalid receipt identity")?;
129:             if !previous.same_process(&current) {
130:                 return Err("native receipt process changed".into());
131:             }
132:         }
133:         sqlx::query("INSERT INTO development_capture_checkpoints(run_id,stage,evidence_json,observed_at) VALUES(?,?,?,unixepoch())")
134:             .bind(&owner.binding.run_id).bind(stage).bind(evidence.to_string()).execute(&mut *tx).await.map_err(db)?;
135:         tx.commit().await.map_err(db)
===== development_checkpoints.rs:106
98:                 list.len() > 32
99:                     || list
100:                         .iter()
101:                         .any(|text| text.trim().is_empty() || text.len() > 2048)
102:             })
103:         {
104:             return Err("checkpoint exceeds revision, list or 16KiB content limits".into());
105:         }
106:         let mut tx = self.pool.begin().await.map_err(db("begin checkpoint"))?;
107:         // Acquire SQLite's writer lock before checking the expected revision.
108:         sqlx::query("UPDATE development_runs SET updated_at = updated_at WHERE id = ?")
109:             .bind(run)
110:             .execute(&mut *tx)
111:             .await
112:             .map_err(db("serialize checkpoint"))?;
113:         require_active_run_authority(&mut tx, run, owner, fence).await?;
114:         let run_record = run_by_id(&mut tx, run)
115:             .await?
116:             .ok_or("unknown development run")?;
117:         let existing: Option<(i64, String, i64)> = sqlx::query_as("SELECT revision, input_json, recorded_at FROM development_checkpoints WHERE run_id = ? AND idempotency_key = ?")
118:             .bind(run).bind(&input.idempotency_key).fetch_optional(&mut *tx).await.map_err(db("read checkpoint replay"))?;
119:         if let Some((revision, old, time)) = existing {
120:             if old != raw {
121:                 return Err("checkpoint idempotency key reused with different content".into());
122:             }
123:             return record(&run_record.task_id, revision, run, &old, time);
124:         }
125:         let (revision,): (i64,) = sqlx::query_as(
126:             "SELECT COALESCE(MAX(revision), 0) FROM development_checkpoints WHERE task_id = ?",
127:         )
128:         .bind(&run_record.task_id)
129:         .fetch_one(&mut *tx)
130:         .await
131:         .map_err(db("read checkpoint revision"))?;
132:         if revision != input.expected_revision {
133:             return Err("checkpoint revision changed; refresh task context".into());
134:         }
135:         for id in &input.evidence_ids {
136:             let (valid,): (bool,) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM development_run_evidence WHERE id = ? AND run_id = ? AND invalidated_at IS NULL)")
137:                 .bind(id).bind(run).fetch_one(&mut *tx).await.map_err(db("validate checkpoint evidence"))?;
138:             if !valid {
139:                 return Err(
140:                     "checkpoint evidence is missing, stale or belongs to another run".into(),
141:                 );
142:             }
143:         }
144:         let now = now_unix_secs();
145:         sqlx::query("INSERT INTO development_checkpoints(task_id, revision, run_id, input_json, idempotency_key, recorded_at) VALUES(?, ?, ?, ?, ?, ?)")
146:             .bind(&run_record.task_id).bind(revision + 1).bind(run).bind(&raw).bind(&input.idempotency_key).bind(now)
147:             .execute(&mut *tx).await.map_err(db("save checkpoint"))?;
148:         let (project,): (String,) =
149:             sqlx::query_as("SELECT project_id FROM continuous_goals WHERE id = ?")
150:                 .bind(&run_record.root_goal_id)
151:                 .fetch_one(&mut *tx)
152:                 .await
153:                 .map_err(db("read checkpoint project"))?;
154:         let result = record(&run_record.task_id, revision + 1, run, &raw, now)?;
155:         let detail =
156:             serde_json::json!({"taskId":run_record.task_id,"runId":run,"revision":revision+1})
157:                 .to_string();
158:         sqlx::query("INSERT INTO continuous_events(project_id, kind, detail, created_at) VALUES(?, 'run_checkpoint', ?, ?)")
159:             .bind(project).bind(detail).bind(now).execute(&mut *tx).await.map_err(db("publish checkpoint cursor"))?;
160:         tx.commit().await.map_err(db("commit checkpoint"))?;
===== development_delivery.rs:49
41:         owner: &str,
42:         fence: i64,
43:         session: &str,
44:         input: &[u8],
45:     ) -> Result<DevelopmentDelivery, String> {
46:         if input.len() > 1_048_576 {
47:             return Err("development input exceeds capture limit".into());
48:         }
49:         let mut tx = self.pool.begin().await.map_err(db)?;
50:         let synchronous: i64 = sqlx::query_scalar("PRAGMA synchronous")
51:             .fetch_one(&mut *tx)
52:             .await
53:             .map_err(db)?;
54:         if synchronous < 2 {
55:             return Err("durable delivery requires SQLite FULL synchronization".into());
56:         }
57:         // Obtain the writer before observing the immutable route and identity.
58:         sqlx::query("UPDATE development_runs SET updated_at=updated_at WHERE id=?")
59:             .bind(run)
60:             .execute(&mut *tx)
61:             .await
62:             .map_err(db)?;
63:         let route: String = sqlx::query_scalar(
64:             "SELECT route_json FROM development_launches WHERE run_id=? AND route_json IS NOT NULL",
65:         )
66:         .bind(run)
67:         .fetch_optional(&mut *tx)
68:         .await
69:         .map_err(db)?
70:         .ok_or("delivery route unavailable")?;
71:         let inserted = sqlx::query("INSERT INTO development_deliveries(run_id,session_id,process_instance,route_sha256,input_sha256,input_bytes,state,started_at) SELECT l.run_id,l.session_id,l.process_instance,?,?,?,'started',? FROM development_launches l JOIN development_runs r ON r.id=l.run_id JOIN continuous_tasks t ON t.id=r.task_id WHERE l.run_id=? AND l.session_id=? AND l.state='spawning' AND l.process_instance IS NOT NULL AND r.status IN ('intent','launched') AND r.claim_owner=? AND r.claim_fence=? AND t.status='running' AND t.claim_owner=? AND t.claim_fence=? ON CONFLICT(run_id) DO NOTHING")
72:             .bind(format!("{:x}",Sha256::digest(route.as_bytes())))
73:             .bind(format!("{:x}",Sha256::digest(input))).bind(input.len() as i64).bind(now_unix_secs())
74:             .bind(run).bind(session).bind(owner).bind(fence).bind(owner).bind(fence)
75:             .execute(&mut *tx).await.map_err(db)?;
76:         if inserted.rows_affected() != 1 {
77:             return Err(
78:                 "delivery consumed, stale or unauthorized; reconcile without redelivery".into(),
79:             );
80:         }
81:         let receipt = sqlx::query_as("SELECT * FROM development_deliveries WHERE run_id=?")
82:             .bind(run)
83:             .fetch_one(&mut *tx)
84:             .await
85:             .map_err(db)?;
86:         tx.commit().await.map_err(db)?;
===== development_launches.rs:120
112:         run_id: &str,
113:         owner: &str,
114:         fence: i64,
115:         profile_id: &str,
116:     ) -> Result<DevelopmentLaunch, String> {
117:         if profile_id.trim().is_empty() {
118:             return Err("profileId is required".into());
119:         }
120:         let mut tx = self.pool.begin().await.map_err(db)?;
121:         // Acquire the writer before reading. Two coordinators cannot both
122:         // observe absence and upgrade competing deferred read transactions.
123:         let changed = sqlx::query("UPDATE development_runs SET updated_at = updated_at WHERE id = ? AND status = 'intent' AND claim_owner = ? AND claim_fence = ? AND EXISTS (SELECT 1 FROM continuous_tasks t WHERE t.id = development_runs.task_id AND t.status = 'running' AND t.claim_owner = ? AND t.claim_fence = ?)")
124:             .bind(run_id).bind(owner).bind(fence).bind(owner).bind(fence).execute(&mut *tx).await.map_err(db)?;
125:         if changed.rows_affected() != 1 {
126:             return Err("stale or unauthorized development launch claim".into());
127:         }
128:         require_admission(&mut tx, run_id).await?;
129:         let (project_id, repo_path): (String, String) = sqlx::query_as("SELECT p.id, p.repo_path FROM development_runs r JOIN continuous_tasks t ON t.id = r.task_id JOIN continuous_goals g ON g.id = t.goal_id JOIN projects p ON p.id = g.project_id WHERE r.id = ?")
130:             .bind(run_id).fetch_one(&mut *tx).await.map_err(db)?;
131:         let worker_id = new_id("wk");
132:         let worktree_path = crate::worktree::worktree_path(&repo_path, &worker_id)?
133:             .to_string_lossy()
134:             .into_owned();
135:         let branch = crate::worktree::branch_for(&worker_id);
136:         let inserted = sqlx::query("INSERT INTO development_launches(run_id, worker_id, project_id, profile_id, repo_path, worktree_path, branch, state, reserved_at) VALUES(?, ?, ?, ?, ?, ?, ?, 'reserved', ?) ON CONFLICT(run_id) DO NOTHING")
137:             .bind(run_id).bind(&worker_id).bind(project_id).bind(profile_id).bind(repo_path).bind(worktree_path).bind(branch).bind(now_unix_secs())
138:             .execute(&mut *tx).await.map_err(db)?;
139:         if inserted.rows_affected() != 1 {
140:             return Err("development launch already reserved; reconcile before retry".into());
141:         }
142:         sqlx::query("UPDATE development_runs SET worker_id = ? WHERE id = ?")
143:             .bind(worker_id)
144:             .bind(run_id)
145:             .execute(&mut *tx)
146:             .await
147:             .map_err(db)?;
148:         let launch = sqlx::query_as("SELECT * FROM development_launches WHERE run_id = ?")
149:             .bind(run_id)
150:             .fetch_one(&mut *tx)
151:             .await
152:             .map_err(db)?;
153:         tx.commit().await.map_err(db)?;
===== development_launches.rs:170
162:         owner: &str,
163:         fence: i64,
164:         worker_id: &str,
165:         session_id: &str,
166:     ) -> Result<(), String> {
167:         if session_id.trim().is_empty() {
168:             return Err("sessionId is required".into());
169:         }
170:         let mut tx = self.pool.begin().await.map_err(db)?;
171:         sqlx::query("UPDATE development_runs SET updated_at = updated_at WHERE id = ?")
172:             .bind(run_id)
173:             .execute(&mut *tx)
174:             .await
175:             .map_err(db)?;
176:         require_admission(&mut tx, run_id).await?;
177:         let receipt: Option<(Option<String>, Option<i64>)> = sqlx::query_as(
178:             "SELECT route_json, route_expires_at FROM development_launches WHERE run_id = ?",
179:         )
180:         .bind(run_id)
181:         .fetch_optional(&mut *tx)
182:         .await
183:         .map_err(db)?;
184:         if !matches!(receipt, Some((Some(_), Some(expiry))) if expiry > now_unix_secs()) {
185:             return Err("development route missing or expired before process creation".into());
186:         }
187:         let baseline: Option<String> =
188:             sqlx::query_scalar("SELECT baseline_commit FROM development_launches WHERE run_id = ?")
189:                 .bind(run_id)
190:                 .fetch_one(&mut *tx)
191:                 .await
192:                 .map_err(db)?;
193:         if baseline.is_none() {
194:             return Err("development worktree baseline missing before process creation".into());
195:         }
196:         super::development_budget::consume_worker(&mut tx, run_id).await?;
197:         let changed = sqlx::query("UPDATE development_launches SET state = 'spawning', session_id = ?, spawning_at = ?, process_instance = ? WHERE run_id = ? AND worker_id = ? AND state = 'reserved' AND route_json IS NOT NULL AND route_expires_at > ? AND EXISTS (SELECT 1 FROM development_runs r JOIN continuous_tasks t ON t.id = r.task_id WHERE r.id = development_launches.run_id AND r.status = 'intent' AND r.claim_owner = ? AND r.claim_fence = ? AND t.status = 'running' AND t.claim_owner = ? AND t.claim_fence = ?)")
198:             .bind(session_id).bind(now_unix_secs()).bind(new_id("process")).bind(run_id).bind(worker_id).bind(now_unix_secs()).bind(owner).bind(fence).bind(owner).bind(fence).execute(&mut *tx).await.map_err(db)?;
199:         if changed.rows_affected() != 1 {
200:             return Err(
201:                 "development launch consumed, stale or unauthorized; reconcile before retry".into(),
202:             );
203:         }
204:         tx.commit().await.map_err(db)?;
===== development_launches.rs:255
247:     /// Only the native exit hook submits this observation. A process exit is
248:     /// evidence for reconciliation, not proof that the task was accepted.
249:     pub async fn record_development_process_exit(
250:         &self,
251:         worker_id: &str,
252:         session_id: &str,
253:         code: Option<i32>,
254:     ) -> Result<Option<String>, String> {
255:         let mut tx = self.pool.begin().await.map_err(db)?;
256:         let row: Option<(String,)> = sqlx::query_as("UPDATE development_launches SET state = 'exited', exited_at = ?, exit_code = ? WHERE worker_id = ? AND session_id = ? AND state = 'spawning' RETURNING run_id")
257:             .bind(now_unix_secs()).bind(code).bind(worker_id).bind(session_id).fetch_optional(&mut *tx).await.map_err(db)?;
258:         if let Some((run_id,)) = &row {
259:             sqlx::query("UPDATE development_runs SET status = 'reconciling', terminal_detail = ?, updated_at = ? WHERE id = ? AND status IN ('intent','launched','reconciling')")
260:                 .bind(format!("native PTY exit observed; exit code {code:?}; task acceptance pending"))
261:                 .bind(now_unix_secs()).bind(run_id).execute(&mut *tx).await.map_err(db)?;
262:         }
263:         tx.commit().await.map_err(db)?;
===== discovery.rs:63
55:         if operation_key.trim() != operation_key
56:             || operation_key.is_empty()
57:             || operation_key.len() > 128
58:             || operation_key.chars().any(char::is_control)
59:             || now < 0
60:         {
61:             return Err("invalid discovery operation key or clock".into());
62:         }
63:         let mut tx = self.pool.begin().await.map_err(db)?;
64:         // Acquire the SQLite writer before every eligibility/count read.
65:         sqlx::query("UPDATE continuous_goals SET updated_at=updated_at WHERE id=?")
66:             .bind(goal)
67:             .execute(&mut *tx)
68:             .await
69:             .map_err(db)?;
70:         let row: Option<(String,String,String)> = sqlx::query_as("SELECT g.project_id,g.root_goal_id,p.policy_json FROM continuous_goals g JOIN continuous_goals root ON root.id=g.root_goal_id JOIN continuous_root_policies p ON p.root_goal_id=g.root_goal_id JOIN continuous_projects c ON c.project_id=g.project_id WHERE g.id=? AND g.admitted=1 AND root.admitted=1 AND g.status='open' AND root.status='open' AND g.deadline_at>? AND root.deadline_at>? AND c.status='enabled'")
71:             .bind(goal).bind(now).bind(now).fetch_optional(&mut *tx).await.map_err(db)?;
72:         let (project, root, encoded) =
73:             row.ok_or("discovery requires an enabled project and live admitted root")?;
74:         let policy = DevelopmentPolicy::parse(&encoded)?;
75:         let limit = i64::from(policy.continuous.discovery_runs_per_day);
76:         let (duplicate, latest): (bool,Option<i64>) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM continuous_discovery WHERE project_id=? AND operation_key=?), (SELECT MAX(admitted_at) FROM continuous_discovery WHERE project_id=?)")
77:             .bind(&project).bind(operation_key).bind(&project).fetch_one(&mut *tx).await.map_err(db)?;
78:         if duplicate {
79:             return Err(
80:                 "discovery operation already reserved; reconcile instead of restarting".into(),
81:             );
82:         }
83:         if latest.is_some_and(|latest| now < latest) {
84:             return Err("discovery clock moved backwards; admission paused".into());
85:         }
86:         let day = now.div_euclid(86_400);
87:         let (used,): (i64,) = sqlx::query_as(
88:             "SELECT COUNT(*) FROM continuous_discovery WHERE project_id=? AND utc_day=?",
89:         )
90:         .bind(&project)
91:         .bind(day)
92:         .fetch_one(&mut *tx)
93:         .await
94:         .map_err(db)?;
95:         if used >= limit {
96:             return Err("discovery daily capacity exhausted".into());
97:         }
98:         let permit = DiscoveryPermit {
99:             id: new_id("ds"),
100:             project_id: project,
101:             root_goal_id: root,
102:             operation_key: operation_key.into(),
103:             utc_day: day,
104:             admitted_at: now,
105:         };
106:         sqlx::query("INSERT INTO continuous_discovery VALUES(?,?,?,?,?,?)")
107:             .bind(&permit.id)
108:             .bind(&permit.project_id)
109:             .bind(&permit.root_goal_id)
110:             .bind(&permit.operation_key)
111:             .bind(day)
112:             .bind(now)
113:             .execute(&mut *tx)
114:             .await
115:             .map_err(db)?;
116:         sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'discovery_reserved',?,?)")
117:             .bind(&permit.project_id).bind(&permit.id).bind(now).execute(&mut *tx).await.map_err(db)?;
118:         tx.commit().await.map_err(db)?;
===== native_completion.rs:36
28:         self.finish_native_session_observed(owner, || {}).await
29:     }
30: 
31:     async fn finish_native_session_observed(
32:         &self,
33:         owner: &CaptureOwner,
34:         after_claim: impl FnOnce(),
35:     ) -> Result<(), String> {
36:         let mut tx = self.pool.begin().await.map_err(db)?;
37:         ensure_full(&mut tx).await?;
38:         let changed = sqlx::query("UPDATE development_capture_owners SET state=state WHERE run_id=? AND capability_sha256=? AND launch_sha256=? AND claim_owner=? AND claim_fence=? AND state='closed' AND next_stage=4")
39:             .bind(&owner.binding.run_id).bind(&owner.capability_sha256).bind(&owner.launch_sha256)
40:             .bind(&owner.owner).bind(owner.fence).execute(&mut *tx).await.map_err(db)?;
41:         if changed.rows_affected() != 1 {
42:             return Err("native session owner incomplete or changed".into());
43:         }
44:         let row: Option<(String, i32)> = sqlx::query_as("SELECT l.worker_id,l.exit_code FROM development_launches l JOIN development_capture_results c ON c.run_id=l.run_id JOIN development_runs r ON r.id=l.run_id JOIN continuous_tasks t ON t.id=r.task_id JOIN sessions s ON s.id=l.session_id AND s.worker_id=l.worker_id JOIN workers w ON w.id=l.worker_id AND w.project_id=l.project_id WHERE l.run_id=? AND l.session_id=? AND l.process_instance=? AND l.state='exited' AND l.exit_code IS NOT NULL AND r.status='reconciling' AND r.claim_owner=? AND r.claim_fence=? AND t.claim_owner=? AND t.claim_fence=? AND t.status='running' AND (s.ended_at IS NULL OR s.exit_code=l.exit_code)")
45:             .bind(&owner.binding.run_id).bind(&owner.binding.session_id).bind(&owner.binding.process_instance)
46:             .bind(&owner.owner).bind(owner.fence).bind(&owner.owner).bind(owner.fence)
47:             .fetch_optional(&mut *tx).await.map_err(db)?;
48:         let (worker, exit_code) = row.ok_or("native session completion binding unavailable")?;
49:         let _closing = {
50:             let mut bindings = self
51:                 .sessions
52:                 .lock()
53:                 .map_err(|_| "native session map unavailable")?;
54:             if bindings
55:                 .by_worker
56:                 .get(&worker)
57:                 .is_some_and(|session| session != &owner.binding.session_id)
58:             {
59:                 return Err("native worker rebound before completion".into());
60:             }
61:             if bindings
62:                 .by_session
63:                 .get(&owner.binding.session_id)
64:                 .is_some_and(|bound_worker| bound_worker != &worker)
65:             {
66:                 return Err("native session rebound to another worker".into());
67:             }
68:             if bindings.native_closing.contains_key(&worker) {
69:                 return Err("native session finalization already in progress".into());
70:             }
71:             bindings
72:                 .native_closing
73:                 .insert(worker.clone(), owner.binding.session_id.clone());
74:             ClosingBinding {
75:                 bindings: self.sessions.clone(),
76:                 worker: worker.clone(),
77:             }
78:         };
79:         after_claim();
80:         let changed = sqlx::query("UPDATE sessions SET ended_at=unixepoch(),exit_code=? WHERE id=? AND worker_id=? AND ended_at IS NULL")
81:             .bind(exit_code).bind(&owner.binding.session_id).bind(&worker)
82:             .execute(&mut *tx).await.map_err(db)?;
83:         sqlx::query("UPDATE workers SET status=? WHERE id=? AND status=?")
84:             .bind(crate::store::STATUS_EXITED)
85:             .bind(&worker)
86:             .bind(crate::store::STATUS_RUNNING)
87:             .execute(&mut *tx)
88:             .await
89:             .map_err(db)?;
90:         if changed.rows_affected() == 1 {
91:             sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) SELECT project_id,'development_session_closed',json_object('version',1,'runId',run_id),unixepoch() FROM development_launches WHERE run_id=?")
92:                 .bind(&owner.binding.run_id).execute(&mut *tx).await.map_err(db)?;
93:         }
94:         tx.commit().await.map_err(db)?;
===== native_completion.rs:136
128:         owner: &CaptureOwner,
129:         reply: &host_reply::Reply,
130:         host: Value,
131:         observed_at: i64,
132:     ) -> Result<(), String> {
133:         let bytes = serde_json::to_vec(reply).map_err(|_| "invalid final reply")?;
134:         host_reply::decode(&bytes, &owner.binding, &owner.launch)?;
135:         let metadata = owner.receipt_metadata(reply);
136:         let mut tx = self.pool.begin().await.map_err(db)?;
137:         ensure_full(&mut tx).await?;
138:         // Acquire the writer before reading any authority, including on replay.
139:         let changed = sqlx::query("UPDATE development_capture_owners SET state=state WHERE run_id=? AND capability_sha256=? AND launch_sha256=? AND claim_owner=? AND claim_fence=? AND state='closed' AND next_stage=4 AND created_at<=? AND ?>0 AND ?<=unixepoch()+5")
140:             .bind(&owner.binding.run_id).bind(&owner.capability_sha256).bind(&owner.launch_sha256)
141:             .bind(&owner.owner).bind(owner.fence).bind(observed_at).bind(observed_at).bind(observed_at)
142:             .execute(&mut *tx).await.map_err(db)?;
143:         if changed.rows_affected() != 1 {
144:             return Err("native completion owner incomplete or stale".into());
145:         }
146:         let route: Option<String> = sqlx::query_scalar("SELECT l.route_json FROM development_launches l JOIN development_deliveries d ON d.run_id=l.run_id JOIN development_runs r ON r.id=l.run_id JOIN continuous_tasks t ON t.id=r.task_id WHERE l.run_id=? AND l.session_id=? AND l.process_instance=? AND l.state IN ('spawning','exited') AND d.session_id=l.session_id AND d.process_instance=l.process_instance AND d.route_sha256=? AND d.input_sha256=? AND d.input_bytes=? AND r.status IN ('intent','launched','reconciling') AND r.claim_owner=? AND r.claim_fence=? AND t.status='running' AND t.claim_owner=? AND t.claim_fence=?")
147:             .bind(&owner.binding.run_id).bind(&owner.binding.session_id).bind(&owner.binding.process_instance)
148:             .bind(&owner.binding.route_sha256).bind(&owner.launch.input_sha256).bind(owner.launch.input_bytes as i64)
149:             .bind(&owner.owner).bind(owner.fence).bind(&owner.owner).bind(owner.fence)
150:             .fetch_optional(&mut *tx).await.map_err(db)?;
151:         let route = route.ok_or("native completion launch binding changed")?;
152:         if digest(route.as_bytes()) != owner.binding.route_sha256 {
153:             return Err("native completion route changed".into());
154:         }
155:         let receipt: String = sqlx::query_scalar(
156:             "SELECT evidence_json FROM development_capture_checkpoints WHERE run_id=? AND stage=3",
157:         )
158:         .bind(&owner.binding.run_id)
159:         .fetch_one(&mut *tx)
160:         .await
161:         .map_err(db)?;
162:         if serde_json::from_str::<Value>(&receipt).map_err(|_| "invalid stored receipt")?
163:             != metadata
164:         {
165:             return Err("native completion differs from acknowledged receipt".into());
166:         }
167:         let resolved: Value = serde_json::from_str(&route).map_err(|_| "invalid stored route")?;
168:         let exit_code = reply.capture.exit_code as i32; // Preserve the Windows DWORD bit pattern.
169:         let usage = if resolved["selection"]["resolved"]["provider"] == "codex"
170:             && resolved["preparedInvocation"]["transport"] == "native_codex_exec_json"
171:         {
172:             development_budget::codex_usage::complete_usage(&reply.capture.stdout, Some(exit_code))
173:                 .ok()
174:         } else {
175:             None
176:         };
177:         let result = json!({"version":1,"state":"native_cleanup_confirmed","host":host,
178:             "receipt":metadata,"observedAt":observed_at,
179:             "usage": match usage { Some(tokens)=>json!({"state":"measured","tokens":tokens}), None=>json!({"state":"unavailable"}) }}).to_string();
180:         let previous: Option<String> = sqlx::query_scalar(
181:             "SELECT result_json FROM development_capture_results WHERE run_id=?",
182:         )
183:         .bind(&owner.binding.run_id)
184:         .fetch_optional(&mut *tx)
185:         .await
186:         .map_err(db)?;
187:         if let Some(previous) = previous {
188:             let same_exit: bool = sqlx::query_scalar(
189:                 "SELECT state='exited' AND exit_code IS ? FROM development_launches WHERE run_id=?",
190:             )
191:             .bind(exit_code)
192:             .bind(&owner.binding.run_id)
193:             .fetch_one(&mut *tx)
194:             .await
195:             .map_err(db)?;
196:             if previous != result || !same_exit {
===== team_assignments.rs:43
35:         let team_id = label(&request.team_id, "teamId")?;
36:         let role = label(&request.role, "role")?;
37:         let assignee = label(&request.assignee, "assignee")?;
38:         let revision = request
39:             .expected_revision
40:             .checked_add(1)
41:             .filter(|value| *value > 0)
42:             .ok_or("expectedRevision must be non-negative and below the maximum integer")?;
43:         let mut tx = self.pool.begin().await.map_err(db)?;
44:         // Serialize against both competing assignments and claims before reads.
45:         sqlx::query("UPDATE continuous_tasks SET updated_at=updated_at WHERE id=?")
46:             .bind(task)
47:             .execute(&mut *tx)
48:             .await
49:             .map_err(db)?;
50:         let row:Option<AssignmentAdmissionRow>=sqlx::query_as("SELECT g.project_id,p.policy_json,g.status,g.deadline_at,t.status,t.claim_owner,t.attempts FROM continuous_tasks t JOIN continuous_goals g ON g.id=t.goal_id JOIN projects project ON project.id=g.project_id JOIN continuous_root_policies p ON p.root_goal_id=g.root_goal_id WHERE t.id=?")
51:             .bind(task).fetch_optional(&mut *tx).await.map_err(db)?;
52:         let Some((project, encoded, goal_status, deadline, status, owner, attempts)) = row else {
53:             return Err("unknown continuous task or root policy".into());
54:         };
55:         let policy = DevelopmentPolicy::parse(&encoded)?;
56:         if !policy
57:             .teams
58:             .iter()
59:             .any(|team| team.id == team_id && team.roles.contains(&role))
60:         {
61:             return Err("teamId and role must be permitted by the frozen root policy".into());
62:         }
63:         let prior = read(&mut tx, task).await?;
64:         // Retry of the already committed request remains read-only after claim.
65:         if let Some(prior) = &prior {
66:             if prior.revision == revision
67:                 && prior.team_id == team_id
68:                 && prior.role == role
69:                 && prior.assignee == assignee
70:             {
71:                 return Ok(prior.clone());
72:             }
73:         }
74:         if prior.as_ref().map_or(0, |value| value.revision) != request.expected_revision {
75:             return Err("team assignment revision conflict".into());
76:         }
77:         if goal_status != "open" || status != "open" || owner.is_some() || attempts != 0 {
78:             return Err("team assignment is locked after the first claim or goal closure".into());
79:         }
80:         let now = now_unix_secs();
81:         if deadline > 0 && now >= deadline {
82:             return Err("continuous goal deadline has elapsed; assignment refused".into());
83:         }
84:         let assignment = TeamAssignment {
85:             task_id: task.into(),
86:             team_id,
87:             role,
88:             assignee,
89:             revision,
90:             policy_version: i64::from(policy.schema_version),
91:             observed_at: now,
92:         };
93:         sqlx::query("INSERT INTO continuous_team_assignments(task_id,team_id,role,assignee,revision,policy_version,observed_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET team_id=excluded.team_id,role=excluded.role,assignee=excluded.assignee,revision=excluded.revision,policy_version=excluded.policy_version,observed_at=excluded.observed_at")
94:             .bind(task).bind(&assignment.team_id).bind(&assignment.role).bind(&assignment.assignee).bind(revision).bind(assignment.policy_version).bind(now).execute(&mut *tx).await.map_err(db)?;
95:         sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'team_assignment',?,?)")
96:             .bind(project).bind(serde_json::json!({"version":1,"taskId":task,"revision":revision}).to_string()).bind(now).execute(&mut *tx).await.map_err(db)?;
97:         tx.commit().await.map_err(db)?;
===== team_assignments.rs:105
97:         tx.commit().await.map_err(db)?;
```

## Hilfsfunktionen
```rust
    Ok(())
}

async fn lock(tx: &mut Transaction<'_, Sqlite>, id: &str) -> Result<(), String> {
    sqlx::query("UPDATE development_token_reservations SET created_at=created_at WHERE id=?")
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(db)?;
    Ok(())
}
async fn start(tx: &mut Transaction<'_, Sqlite>, id: &str) -> Result<(), String> {
    let row: TokenReservation =
        sqlx::query_as("SELECT * FROM development_token_reservations WHERE id=?")
            .bind(id)
            .fetch_one(&mut **tx)
            .await
            .map_err(db)?;
    let (eligible,): (bool,) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM continuous_goals g JOIN continuous_goals root ON root.id=g.root_goal_id JOIN continuous_projects p ON p.project_id=g.project_id WHERE g.id=? AND g.status='open' AND root.status='open' AND g.admitted=1 AND root.admitted=1 AND g.deadline_at>? AND root.deadline_at>? AND p.status='enabled')")
        .bind(&row.goal_id).bind(now_unix_secs()).bind(now_unix_secs()).fetch_one(&mut **tx).await.map_err(db)?;
    if !eligible || balance(tx, &row.root_goal_id).await?.exceeded {
        return Err("token work admission paused, closed, expired or exhausted".into());
    }
    let changed=sqlx::query("UPDATE development_token_reservations SET state='started',started_at=? WHERE id=? AND state='reserved'")
        .bind(now_unix_secs()).bind(id).execute(&mut **tx).await.map_err(db)?;
    if changed.rows_affected() != 1 {
        return Err("token reservation already consumed; reconcile before retry".into());
    }
    event(tx, &row.root_goal_id, id).await
}

pub(super) async fn consume_worker(
    tx: &mut Transaction<'_, Sqlite>,
    run: &str,
) -> Result<(), String> {
    let (id,): (String,) = sqlx::query_as("SELECT id FROM development_token_reservations WHERE run_id=? AND purpose='implementation' AND state='reserved'")
        .bind(run).fetch_optional(&mut **tx).await.map_err(db)?.ok_or("development launch has no reserved token budget")?;
    start(tx, &id).await
}

#[cfg(test)]
    }
    Ok(())
}

async fn ensure_full(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    let synchronous: i64 = sqlx::query_scalar("PRAGMA synchronous")
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?;
    if synchronous < 2 {
        return Err("durable checkpoints require SQLite FULL synchronization".into());
    }
    Ok(())
}

impl CaptureOwner {
```
