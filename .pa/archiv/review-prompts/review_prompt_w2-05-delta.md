# Delta review W2-05: discovery scan and dispatch (ProjectA, Rust + SQLite)

You reviewed W2-05 before (`run_discovery_scan`: permit + deterministic scan +
`discovery_dispatched` journal event in one writer transaction; dispatch is
intent only). This is the delta after the review round. Check only whether the
fixes are correct and whether they introduce a new bug. Report findings as a
numbered list with severity, file:line, what is wrong, a failing scenario and a
fix; say explicitly if nothing is blocking.

Dispositions of round 1:
- K1 accepted: `json_extract` in the per-permit `dispatchState` query now runs
  only inside `CASE WHEN kind='discovery_dispatched' AND json_valid(detail)`;
  an unparsable newest dispatch record is reported as `{"state":"unreadable"}`
  instead of failing the whole project context. Red test first.
- K3 tests accepted: coverage for `dependencies_unreadable` and the 64-task
  truncation (direct SQL rows, bypassing the 8-task root budget).
- K5/G3 documented in comments.
- Rejected with evidence: K2 (assignment `task_id` is PRIMARY KEY), K4/G1
  (root budget caps tasks at 8 by default, deps deduplicated and project-local),
  G2 (would need a migration; not allowed in this package).

## Delta
```diff
diff --git a/src-tauri/src/store/discovery.rs b/src-tauri/src/store/discovery.rs
index bad45bb..7db645d 100644
--- a/src-tauri/src/store/discovery.rs
+++ b/src-tauri/src/store/discovery.rs
@@ -338,7 +338,10 @@ pub(super) async fn context(
         .bind(project).fetch_all(&mut **tx).await.map_err(db)?;
     let mut recent = Vec::with_capacity(permits.len());
     for permit in permits {
-        let (scanned,): (bool,) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM continuous_events WHERE project_id=? AND kind='discovery_dispatched' AND json_extract(detail,'$.permitId')=?)")
+        // CASE guarantees evaluation order: json_extract only ever sees valid
+        // JSON of this kind (other kinds store bare ids; review K1). The state
+        // lives in the journal, which nothing prunes (review K5).
+        let (scanned,): (bool,) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM continuous_events WHERE project_id=? AND CASE WHEN kind='discovery_dispatched' AND json_valid(detail) THEN json_extract(detail,'$.permitId')=? ELSE 0 END)")
             .bind(project).bind(&permit.id).fetch_one(&mut **tx).await.map_err(db)?;
         let mut entry = serde_json::to_value(&permit).map_err(|e| e.to_string())?;
         // A reserve-only permit (model-assisted discovery) has no store scan.
@@ -347,9 +350,11 @@ pub(super) async fn context(
     }
     let latest_dispatch: Option<String> = sqlx::query_scalar("SELECT detail FROM continuous_events WHERE project_id=? AND kind='discovery_dispatched' ORDER BY cursor DESC LIMIT 1")
         .bind(project).fetch_optional(&mut **tx).await.map_err(db)?;
-    let latest_dispatch = latest_dispatch
-        .map(|raw| serde_json::from_str::<serde_json::Value>(&raw).map_err(|e| e.to_string()))
-        .transpose()?;
+    // Project-wide newest scan; its `rootGoalId` names the root (review G3).
+    let latest_dispatch = latest_dispatch.map(|raw| {
+        serde_json::from_str::<serde_json::Value>(&raw)
+            .unwrap_or_else(|_| serde_json::json!({"state":"unreadable"}))
+    });
     Ok(serde_json::json!({"source":"rust/sqlite", "observedAt":now,
         "window":"UTC calendar day", "utcDay":day, "reservedToday":used,
         "latestAdmissionAt":latest, "clockRegressed":latest.is_some_and(|last| now < last),
@@ -673,6 +678,59 @@ mod tests {
         );
     }
 
+    /// Review K3: coverage for the unreadable-dependency skip and truncation.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn discovery_scan_reports_unreadable_dependencies_and_truncation() {
+        let (_dir, store, _project, goal) = fixture().await;
+        // Rows written directly: the task budget (8 per root) is not the
+        // subject here, the scan bound of 64 is.
+        for order in 0..=SCAN_LIMIT {
+            let deps = if order == 0 { "{corrupt" } else { "[]" };
+            sqlx::query("INSERT INTO continuous_tasks(id,goal_id,objective,owned_paths_json,dependencies_json,status,created_at,updated_at) VALUES(?,?,'t','[]',?,'open',?,?)")
+                .bind(format!("t{order:03}")).bind(&goal).bind(deps).bind(order).bind(order)
+                .execute(&store.pool).await.unwrap();
+        }
+        let scan = store
+            .scan_discovery_at(&goal, "bounded", now_unix_secs())
+            .await
+            .unwrap();
+        assert_eq!(scan.open_tasks, SCAN_LIMIT + 1);
+        assert!(scan.truncated);
+        assert_eq!(
+            scan.dispatched.len() + scan.skipped.len(),
+            SCAN_LIMIT as usize
+        );
+        assert_eq!(scan.skipped[0].task_id, "t000");
+        assert_eq!(scan.skipped[0].reason, "dependencies_unreadable");
+        assert_eq!(scan.dispatched.len(), 2);
+        assert!(scan
+            .skipped
+            .iter()
+            .all(|skip| skip.task_id != format!("t{SCAN_LIMIT:03}")));
+    }
+
+    /// Review K1: a malformed journal row must not take the whole project
+    /// context down; it reads as an unreadable, unrecorded dispatch.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn malformed_dispatch_journal_row_does_not_break_context() {
+        let (_dir, store, project, goal) = fixture().await;
+        store
+            .reserve_discovery_at(&goal, "reserve-only", now_unix_secs())
+            .await
+            .unwrap();
+        sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'discovery_dispatched','not json',1)")
+            .bind(&project)
+            .execute(&store.pool)
+            .await
+            .unwrap();
+        let snapshot = store.continuous_context(&project, 0).await.unwrap();
+        assert_eq!(
+            snapshot.discovery["recent"][0]["dispatchState"],
+            "unavailable"
+        );
+        assert_eq!(snapshot.discovery["latestDispatch"]["state"], "unreadable");
+    }
+
     #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
     async fn discovery_scan_refuses_roles_the_frozen_policy_does_not_permit() {
         let (_dir, store, _project, goal) = fixture().await;
```
