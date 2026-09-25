# Review request W2-05: discovery scan and dispatch (ProjectA, Tauri 2, Rust + SQLite)

You are an independent code reviewer from a different model vendor than the
author (Claude Code). Review the diff below for correctness and security
bugs. Report findings as a numbered list, each with: severity
(high/medium/low), file:line, what is wrong, a concrete failing scenario, and a
suggested fix. Say explicitly if you find nothing blocking. Do not restate the
diff.

## Task (docs/PLAN.md, W2-05)
"Discovery: real scan and dispatch · M · `store/discovery.rs` · within the
reserved admission (migration 15) · after W2-04." Before this change
`store/discovery.rs` only reserved permits (`continuous_discovery`, project +
UTC day, capped by the frozen root policy `discoveryRunsPerDay`, operation key
unique per project, clock regression pauses admission). Context reported
`executionState: "unavailable"`; there was no scan and no dispatch.
W2-04 (merged) added `DispatchRole` and `run_role(conn, run_id)` in
`store/development_launches.rs`: no assignment => implementer if some team of
the frozen root policy permits implementer; assignment => assignee must equal
the run's claim owner and the policy must permit team+role; partial row fails
closed. Constraints for W2-05: no new migration, `startsWorkers` and the
activation gates stay untouched (no automatic worker start).

## Design
- `Store::run_discovery_scan(goal, key)` (trusted coordinator only, no caller
  yet, no agent endpoint) opens one writer transaction, reserves the permit via
  the unchanged admission logic (`reserve_in`, refactored out of
  `reserve_discovery_at`), runs `scan_root`, writes one `discovery_dispatched`
  event into `continuous_events` (JSON detail with permitId, dispatched,
  skipped), and commits. A failed scan rolls back the permit too.
- `scan_root`: open, unclaimed tasks of goals in the permit's root that are
  open, admitted and before deadline; ordered by `created_at, id`; limit 64
  with `openTasks`/`truncated`. Per task in order: attempts >= max ->
  `attempts_exhausted`; dependency JSON unreadable -> `dependencies_unreadable`;
  a dependency not `completed` -> `dependencies_pending`; role via
  `resolve_role(None, team, role, assignee, policy)` error -> `role_refused`;
  no free worker slot (max_workers - running tasks of the project) ->
  `worker_capacity_exhausted`; integrator and no free integration slot
  (max_integration - running integrator tasks across all projects, same query
  as the claim) -> `integration_capacity_exhausted`; else dispatched.
- `resolve_role` is the W2-04 body extracted from `run_role`; `owner: None`
  skips the assignee==owner check because no run exists yet (the dispatch
  target is the assignee; `check_claim` enforces assignee == owner at claim).
  `run_role` passes `Some(owner)` and is otherwise unchanged.
- Dispatch is intent only: no claim, attempt, run, launch, token or process.
  The claim (`claim_continuous_task`) and launch
  (`reserve/consume_development_launch`) re-validate everything.
- Context: each of the two recent permits gets `dispatchState`
  (`recorded` if a `discovery_dispatched` event with its permitId exists,
  else `unavailable`), plus `latestDispatch` (the newest event detail).
  `executionState` stays `unavailable`.

## Deliberately out of scope
- A caller / automatic dispatch behind `startsWorkers` (W2-06).
- Pre-goal discovery and model-assisted discovery (token reservation, route).
- Host memory-pressure capacity (sampled only at claim time).

## Questions for you
1. Can a dispatch record ever claim or authorize more than the claim/launch
   boundaries allow? Is anything presented as authority that is not?
2. Is the atomicity (permit + scan + event) correct, including the refactor of
   `reserve_discovery_at` and the `&mut **tx` changes?
3. Is `resolve_role(None, ...)` a safe weakening, or does any existing caller
   now skip the owner check?
4. Capacity accounting and determinism: off-by-one, double-counting of
   integrators, ordering, truncation.

## Diff vs origin/main
```diff
diff --git a/docs/development/CONTINUOUS.md b/docs/development/CONTINUOUS.md
index 21f8499..7d76917 100644
--- a/docs/development/CONTINUOUS.md
+++ b/docs/development/CONTINUOUS.md
@@ -450,8 +450,22 @@ state. These are admission records; execution and usage explicitly remain
 unavailable. Reservation and journal notification commit together. The module
 cannot start a process, settle tokens, create a goal or enable continuous mode.
 Model-assisted discovery still requires the root's separate token reservation
-and a verified provider route. Actual scan/dispatch and pre-goal discovery remain
-open work; this admitted-root service alone does not fulfill discovery acceptance.
+and a verified provider route.
+
+W2-05 adds the deterministic store scan: `run_discovery_scan(goal, operation_key)`
+reserves the permit and scans in one writer transaction. It reads up to 64 open,
+unclaimed tasks of the admitted root in creation order and dispatches each ready
+one to its W2-04 role (assignment, or implementer when unassigned, both checked
+against the frozen root policy) within the free per-project worker slots and the
+global integration lane. Others are skipped with a stable reason:
+`attempts_exhausted`, `dependencies_pending`, `dependencies_unreadable`,
+`role_refused`, `worker_capacity_exhausted`, `integration_capacity_exhausted`.
+The result is a `discovery_dispatched` journal event committed with the permit;
+a failed scan keeps no slot. Context adds `dispatchState` per recent permit and
+`latestDispatch`. A dispatch is intent: nothing is claimed, launched or spawned,
+`executionState` stays unavailable, and claim and launch re-validate everything.
+Automatic dispatch behind `startsWorkers` (W2-06) and pre-goal discovery remain
+open; no caller runs the scan yet.
 
 ## Task guidance
 
diff --git a/src-tauri/src/store/development_launches.rs b/src-tauri/src/store/development_launches.rs
index 4ed2d00..dcd0bc2 100644
--- a/src-tauri/src/store/development_launches.rs
+++ b/src-tauri/src/store/development_launches.rs
@@ -75,6 +75,19 @@ pub(super) async fn run_role(
     let Some((owner, team, role, assignee, policy)) = row else {
         return Err("unknown development run".into());
     };
+    resolve_role(Some(&owner), team, role, assignee, policy)
+}
+
+/// The W2-04 decision on already-read rows. `owner` is the run's claim owner;
+/// discovery dispatch (W2-05) passes `None` because no run exists yet and the
+/// dispatch target is the assignee itself — the claim re-checks the owner.
+pub(super) fn resolve_role(
+    owner: Option<&str>,
+    team: Option<String>,
+    role: Option<String>,
+    assignee: Option<String>,
+    policy: Option<String>,
+) -> Result<DispatchRole, String> {
     let policy = DevelopmentPolicy::parse(&policy.ok_or("dispatch root policy unavailable")?)?;
     let permitted = |team: Option<&str>, role: &str| {
         policy.teams.iter().any(|entry| {
@@ -92,7 +105,7 @@ pub(super) async fn run_role(
         _ => return Err("malformed team assignment row".into()),
     };
     let dispatch = DispatchRole::parse(&role)?;
-    if assignee != owner {
+    if owner.is_some_and(|owner| owner != assignee) {
         return Err(format!(
             "development run owner is not the assigned {}",
             dispatch.as_str()
diff --git a/src-tauri/src/store/discovery.rs b/src-tauri/src/store/discovery.rs
index bd743fd..bad45bb 100644
--- a/src-tauri/src/store/discovery.rs
+++ b/src-tauri/src/store/discovery.rs
@@ -1,10 +1,12 @@
-//! Admission records for bounded discovery; a permit is not execution evidence.
+//! Admission records for bounded discovery and the deterministic scan that
+//! dispatches within them; neither a permit nor a dispatch is execution evidence.
+use super::development_launches::DispatchRole;
 use super::{new_id, now_unix_secs, Store};
 use crate::development_policy::DevelopmentPolicy;
 use serde::Serialize;
 use sqlx::{FromRow, Sqlite, Transaction};
 
-#[derive(Debug, Serialize, FromRow)]
+#[derive(Debug, Clone, Serialize, FromRow)]
 #[serde(rename_all = "camelCase")]
 pub struct DiscoveryPermit {
     pub id: String,
@@ -15,6 +17,39 @@ pub struct DiscoveryPermit {
     pub admitted_at: i64,
 }
 
+/// One open task the scan hands to a team role. This is dispatch intent, not
+/// a claim, launch or process: the claim and launch boundaries re-validate it.
+#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
+#[serde(rename_all = "camelCase")]
+pub struct DiscoveryDispatch {
+    pub task_id: String,
+    pub goal_id: String,
+    pub dispatch_role: DispatchRole,
+    pub team_id: Option<String>,
+    pub assignee: Option<String>,
+}
+
+/// An open task the scan did not dispatch, with a stable reason label.
+#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
+#[serde(rename_all = "camelCase")]
+pub struct DiscoverySkip {
+    pub task_id: String,
+    pub reason: String,
+    /// The pending dependency or the role refusal; display only.
+    pub detail: Option<String>,
+}
+
+/// Result of one admitted deterministic scan, committed with its permit.
+#[derive(Debug, Clone, Serialize)]
+#[serde(rename_all = "camelCase")]
+pub struct DiscoveryScan {
+    pub permit: DiscoveryPermit,
+    pub dispatched: Vec<DiscoveryDispatch>,
+    pub skipped: Vec<DiscoverySkip>,
+    pub open_tasks: i64,
+    pub truncated: bool,
+}
+
 pub(super) async fn apply_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
     sqlx::query("CREATE TABLE continuous_discovery (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, root_goal_id TEXT NOT NULL, operation_key TEXT NOT NULL, utc_day INTEGER NOT NULL, admitted_at INTEGER NOT NULL, UNIQUE(project_id,operation_key))")
         .execute(&mut **tx).await.map_err(db)?;
@@ -46,81 +81,251 @@ impl Store {
             .await
     }
 
+    /// Trusted coordinator only (W2-05). Reserves a permit and runs the
+    /// deterministic store scan in one writer transaction: the permit, the
+    /// dispatch record and its journal event commit together or not at all.
+    /// The scan reads the admitted root's open tasks and hands each ready one
+    /// to its W2-04 dispatch role within the frozen worker and integration
+    /// capacity. It never claims, reserves a launch, spawns, spends tokens or
+    /// creates goals; `startsWorkers` and the activation gates stay closed, and
+    /// the claim and launch boundaries re-validate every dispatch.
+    #[allow(dead_code)] // Coordinator dispatch is still gated.
+    pub async fn run_discovery_scan(
+        &self,
+        goal: &str,
+        operation_key: &str,
+    ) -> Result<DiscoveryScan, String> {
+        self.scan_discovery_at(goal, operation_key, now_unix_secs())
+            .await
+    }
+
+    async fn scan_discovery_at(
+        &self,
+        goal: &str,
+        operation_key: &str,
+        now: i64,
+    ) -> Result<DiscoveryScan, String> {
+        let mut tx = self.pool.begin().await.map_err(db)?;
+        let (permit, encoded) = reserve_in(&mut tx, goal, operation_key, now).await?;
+        let scan = scan_root(&mut tx, permit, &encoded, now).await?;
+        let detail = serde_json::json!({"version":1, "permitId":scan.permit.id,
+            "rootGoalId":scan.permit.root_goal_id, "operationKey":scan.permit.operation_key,
+            "observedAt":now, "openTasks":scan.open_tasks, "truncated":scan.truncated,
+            "dispatched":scan.dispatched, "skipped":scan.skipped,
+            "authority":"intent; claim and launch re-validate"});
+        sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'discovery_dispatched',?,?)")
+            .bind(&scan.permit.project_id).bind(detail.to_string()).bind(now).execute(&mut *tx).await.map_err(db)?;
+        tx.commit().await.map_err(db)?;
+        Ok(scan)
+    }
+
     async fn reserve_discovery_at(
         &self,
         goal: &str,
         operation_key: &str,
         now: i64,
     ) -> Result<DiscoveryPermit, String> {
-        if operation_key.trim() != operation_key
-            || operation_key.is_empty()
-            || operation_key.len() > 128
-            || operation_key.chars().any(char::is_control)
-            || now < 0
-        {
-            return Err("invalid discovery operation key or clock".into());
-        }
         let mut tx = self.pool.begin().await.map_err(db)?;
-        // Acquire the SQLite writer before every eligibility/count read.
-        sqlx::query("UPDATE continuous_goals SET updated_at=updated_at WHERE id=?")
-            .bind(goal)
-            .execute(&mut *tx)
-            .await
-            .map_err(db)?;
-        let row: Option<(String,String,String)> = sqlx::query_as("SELECT g.project_id,g.root_goal_id,p.policy_json FROM continuous_goals g JOIN continuous_goals root ON root.id=g.root_goal_id JOIN continuous_root_policies p ON p.root_goal_id=g.root_goal_id JOIN continuous_projects c ON c.project_id=g.project_id WHERE g.id=? AND g.admitted=1 AND root.admitted=1 AND g.status='open' AND root.status='open' AND g.deadline_at>? AND root.deadline_at>? AND c.status='enabled'")
-            .bind(goal).bind(now).bind(now).fetch_optional(&mut *tx).await.map_err(db)?;
-        let (project, root, encoded) =
-            row.ok_or("discovery requires an enabled project and live admitted root")?;
-        let policy = DevelopmentPolicy::parse(&encoded)?;
-        let limit = i64::from(policy.continuous.discovery_runs_per_day);
-        let (duplicate, latest): (bool,Option<i64>) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM continuous_discovery WHERE project_id=? AND operation_key=?), (SELECT MAX(admitted_at) FROM continuous_discovery WHERE project_id=?)")
-            .bind(&project).bind(operation_key).bind(&project).fetch_one(&mut *tx).await.map_err(db)?;
-        if duplicate {
-            return Err(
-                "discovery operation already reserved; reconcile instead of restarting".into(),
-            );
-        }
-        if latest.is_some_and(|latest| now < latest) {
-            return Err("discovery clock moved backwards; admission paused".into());
-        }
-        let day = now.div_euclid(86_400);
-        let (used,): (i64,) = sqlx::query_as(
-            "SELECT COUNT(*) FROM continuous_discovery WHERE project_id=? AND utc_day=?",
-        )
-        .bind(&project)
-        .bind(day)
-        .fetch_one(&mut *tx)
+        let (permit, _) = reserve_in(&mut tx, goal, operation_key, now).await?;
+        tx.commit().await.map_err(db)?;
+        Ok(permit)
+    }
+}
+
+/// At most this many open tasks are classified per scan; the rest is reported
+/// as truncated and waits for the next admitted scan.
+const SCAN_LIMIT: i64 = 64;
+
+type ScanRow = (
+    String,
+    String,
+    i64,
+    String,
+    Option<String>,
+    Option<String>,
+    Option<String>,
+);
+
+/// Deterministic classification of the root's open, unclaimed tasks in
+/// creation order. Mirrors the claim's own checks (attempt budget, completed
+/// dependencies, per-project worker cap, global integration cap) and the
+/// W2-04 role resolution; the claim stays the authority and checks again.
+async fn scan_root(
+    tx: &mut Transaction<'_, Sqlite>,
+    permit: DiscoveryPermit,
+    encoded: &str,
+    now: i64,
+) -> Result<DiscoveryScan, String> {
+    let policy = DevelopmentPolicy::parse(encoded)?;
+    const OPEN: &str = "FROM continuous_tasks t JOIN continuous_goals g ON g.id=t.goal_id LEFT JOIN continuous_team_assignments a ON a.task_id=t.id WHERE g.project_id=? AND g.root_goal_id=? AND g.status='open' AND g.admitted=1 AND g.deadline_at>? AND t.status='open' AND t.claim_owner IS NULL";
+    let (open_tasks,): (i64,) = sqlx::query_as(&format!("SELECT COUNT(*) {OPEN}"))
+        .bind(&permit.project_id)
+        .bind(&permit.root_goal_id)
+        .bind(now)
+        .fetch_one(&mut **tx)
         .await
         .map_err(db)?;
-        if used >= limit {
-            return Err("discovery daily capacity exhausted".into());
+    let rows: Vec<ScanRow> = sqlx::query_as(&format!("SELECT t.id,t.goal_id,t.attempts,t.dependencies_json,a.team_id,a.role,a.assignee {OPEN} ORDER BY t.created_at,t.id LIMIT ?"))
+        .bind(&permit.project_id).bind(&permit.root_goal_id).bind(now).bind(SCAN_LIMIT)
+        .fetch_all(&mut **tx).await.map_err(db)?;
+    let (running,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM continuous_tasks t JOIN continuous_goals g ON g.id=t.goal_id WHERE g.project_id=? AND t.status='running'")
+        .bind(&permit.project_id).fetch_one(&mut **tx).await.map_err(db)?;
+    // Same query as `team_assignments::check_claim`: integration is one lane
+    // across all projects.
+    let (integrating,):(i64,)=sqlx::query_as("SELECT COUNT(*) FROM continuous_team_assignments a JOIN continuous_tasks t ON t.id=a.task_id WHERE a.role='integrator' AND t.status='running'")
+        .fetch_one(&mut **tx).await.map_err(db)?;
+    let mut workers = (i64::from(policy.continuous.max_workers) - running).max(0);
+    let mut integration = (i64::from(policy.continuous.max_integration) - integrating).max(0);
+    let max_attempts = i64::from(policy.continuous.max_attempts_per_task);
+    let mut dispatched = Vec::new();
+    let mut skipped = Vec::new();
+    for (task_id, goal_id, attempts, dependencies, team, role, assignee) in rows {
+        let skip = |reason: &str, detail: Option<String>| DiscoverySkip {
+            task_id: task_id.clone(),
+            reason: reason.into(),
+            detail,
+        };
+        if attempts >= max_attempts {
+            skipped.push(skip("attempts_exhausted", None));
+            continue;
         }
-        let permit = DiscoveryPermit {
-            id: new_id("ds"),
-            project_id: project,
-            root_goal_id: root,
-            operation_key: operation_key.into(),
-            utc_day: day,
-            admitted_at: now,
+        let Ok(dependencies) = serde_json::from_str::<Vec<String>>(&dependencies) else {
+            skipped.push(skip("dependencies_unreadable", None));
+            continue;
         };
-        sqlx::query("INSERT INTO continuous_discovery VALUES(?,?,?,?,?,?)")
-            .bind(&permit.id)
-            .bind(&permit.project_id)
-            .bind(&permit.root_goal_id)
-            .bind(&permit.operation_key)
-            .bind(day)
-            .bind(now)
-            .execute(&mut *tx)
-            .await
-            .map_err(db)?;
-        sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'discovery_reserved',?,?)")
-            .bind(&permit.project_id).bind(&permit.id).bind(now).execute(&mut *tx).await.map_err(db)?;
-        tx.commit().await.map_err(db)?;
-        Ok(permit)
+        let mut pending = None;
+        for dependency in dependencies {
+            let status: Option<String> =
+                sqlx::query_scalar("SELECT status FROM continuous_tasks WHERE id=?")
+                    .bind(&dependency)
+                    .fetch_optional(&mut **tx)
+                    .await
+                    .map_err(db)?;
+            if status.as_deref() != Some("completed") {
+                pending = Some(dependency);
+                break;
+            }
+        }
+        if let Some(dependency) = pending {
+            skipped.push(skip("dependencies_pending", Some(dependency)));
+            continue;
+        }
+        let dispatch_role = match super::development_launches::resolve_role(
+            None,
+            team.clone(),
+            role,
+            assignee.clone(),
+            Some(encoded.to_string()),
+        ) {
+            Ok(role) => role,
+            Err(error) => {
+                skipped.push(skip("role_refused", Some(error)));
+                continue;
+            }
+        };
+        if workers == 0 {
+            skipped.push(skip("worker_capacity_exhausted", None));
+            continue;
+        }
+        if dispatch_role == DispatchRole::Integrator {
+            if integration == 0 {
+                skipped.push(skip("integration_capacity_exhausted", None));
+                continue;
+            }
+            integration -= 1;
+        }
+        workers -= 1;
+        dispatched.push(DiscoveryDispatch {
+            task_id,
+            goal_id,
+            dispatch_role,
+            team_id: team,
+            assignee,
+        });
     }
+    Ok(DiscoveryScan {
+        permit,
+        dispatched,
+        skipped,
+        open_tasks,
+        truncated: open_tasks > SCAN_LIMIT,
+    })
+}
+
+/// Admission inside the caller's transaction; returns the permit and the
+/// frozen root policy it was admitted under.
+async fn reserve_in(
+    tx: &mut Transaction<'_, Sqlite>,
+    goal: &str,
+    operation_key: &str,
+    now: i64,
+) -> Result<(DiscoveryPermit, String), String> {
+    if operation_key.trim() != operation_key
+        || operation_key.is_empty()
+        || operation_key.len() > 128
+        || operation_key.chars().any(char::is_control)
+        || now < 0
+    {
+        return Err("invalid discovery operation key or clock".into());
+    }
+    // Acquire the SQLite writer before every eligibility/count read.
+    sqlx::query("UPDATE continuous_goals SET updated_at=updated_at WHERE id=?")
+        .bind(goal)
+        .execute(&mut **tx)
+        .await
+        .map_err(db)?;
+    let row: Option<(String,String,String)> = sqlx::query_as("SELECT g.project_id,g.root_goal_id,p.policy_json FROM continuous_goals g JOIN continuous_goals root ON root.id=g.root_goal_id JOIN continuous_root_policies p ON p.root_goal_id=g.root_goal_id JOIN continuous_projects c ON c.project_id=g.project_id WHERE g.id=? AND g.admitted=1 AND root.admitted=1 AND g.status='open' AND root.status='open' AND g.deadline_at>? AND root.deadline_at>? AND c.status='enabled'")
+            .bind(goal).bind(now).bind(now).fetch_optional(&mut **tx).await.map_err(db)?;
+    let (project, root, encoded) =
+        row.ok_or("discovery requires an enabled project and live admitted root")?;
+    let policy = DevelopmentPolicy::parse(&encoded)?;
+    let limit = i64::from(policy.continuous.discovery_runs_per_day);
+    let (duplicate, latest): (bool,Option<i64>) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM continuous_discovery WHERE project_id=? AND operation_key=?), (SELECT MAX(admitted_at) FROM continuous_discovery WHERE project_id=?)")
+            .bind(&project).bind(operation_key).bind(&project).fetch_one(&mut **tx).await.map_err(db)?;
+    if duplicate {
+        return Err("discovery operation already reserved; reconcile instead of restarting".into());
+    }
+    if latest.is_some_and(|latest| now < latest) {
+        return Err("discovery clock moved backwards; admission paused".into());
+    }
+    let day = now.div_euclid(86_400);
+    let (used,): (i64,) = sqlx::query_as(
+        "SELECT COUNT(*) FROM continuous_discovery WHERE project_id=? AND utc_day=?",
+    )
+    .bind(&project)
+    .bind(day)
+    .fetch_one(&mut **tx)
+    .await
+    .map_err(db)?;
+    if used >= limit {
+        return Err("discovery daily capacity exhausted".into());
+    }
+    let permit = DiscoveryPermit {
+        id: new_id("ds"),
+        project_id: project,
+        root_goal_id: root,
+        operation_key: operation_key.into(),
+        utc_day: day,
+        admitted_at: now,
+    };
+    sqlx::query("INSERT INTO continuous_discovery VALUES(?,?,?,?,?,?)")
+        .bind(&permit.id)
+        .bind(&permit.project_id)
+        .bind(&permit.root_goal_id)
+        .bind(&permit.operation_key)
+        .bind(day)
+        .bind(now)
+        .execute(&mut **tx)
+        .await
+        .map_err(db)?;
+    sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'discovery_reserved',?,?)")
+            .bind(&permit.project_id).bind(&permit.id).bind(now).execute(&mut **tx).await.map_err(db)?;
+    Ok((permit, encoded))
 }
 
 /// Snapshot-only metadata. Unknown execution/usage is never presented as zero.
+/// A recorded dispatch is intent, not execution: `executionState` stays
+/// unavailable until a worker actually runs (W2-06, behind `startsWorkers`).
 pub(super) async fn context(
     tx: &mut Transaction<'_, Sqlite>,
     project: &str,
@@ -129,12 +334,27 @@ pub(super) async fn context(
     let day = now.div_euclid(86_400);
     let (used, latest): (i64,Option<i64>) = sqlx::query_as("SELECT COUNT(CASE WHEN utc_day=? THEN 1 END),MAX(admitted_at) FROM continuous_discovery WHERE project_id=?")
         .bind(day).bind(project).fetch_one(&mut **tx).await.map_err(db)?;
-    let recent: Vec<DiscoveryPermit> = sqlx::query_as("SELECT * FROM continuous_discovery WHERE project_id=? ORDER BY admitted_at DESC,id DESC LIMIT 2")
+    let permits: Vec<DiscoveryPermit> = sqlx::query_as("SELECT * FROM continuous_discovery WHERE project_id=? ORDER BY admitted_at DESC,id DESC LIMIT 2")
         .bind(project).fetch_all(&mut **tx).await.map_err(db)?;
+    let mut recent = Vec::with_capacity(permits.len());
+    for permit in permits {
+        let (scanned,): (bool,) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM continuous_events WHERE project_id=? AND kind='discovery_dispatched' AND json_extract(detail,'$.permitId')=?)")
+            .bind(project).bind(&permit.id).fetch_one(&mut **tx).await.map_err(db)?;
+        let mut entry = serde_json::to_value(&permit).map_err(|e| e.to_string())?;
+        // A reserve-only permit (model-assisted discovery) has no store scan.
+        entry["dispatchState"] = if scanned { "recorded" } else { "unavailable" }.into();
+        recent.push(entry);
+    }
+    let latest_dispatch: Option<String> = sqlx::query_scalar("SELECT detail FROM continuous_events WHERE project_id=? AND kind='discovery_dispatched' ORDER BY cursor DESC LIMIT 1")
+        .bind(project).fetch_optional(&mut **tx).await.map_err(db)?;
+    let latest_dispatch = latest_dispatch
+        .map(|raw| serde_json::from_str::<serde_json::Value>(&raw).map_err(|e| e.to_string()))
+        .transpose()?;
     Ok(serde_json::json!({"source":"rust/sqlite", "observedAt":now,
         "window":"UTC calendar day", "utcDay":day, "reservedToday":used,
         "latestAdmissionAt":latest, "clockRegressed":latest.is_some_and(|last| now < last),
-        "recent":recent, "executionState":"unavailable", "usageState":"unavailable"}))
+        "recent":recent, "latestDispatch":latest_dispatch,
+        "executionState":"unavailable", "usageState":"unavailable"}))
 }
 
 #[cfg(test)]
@@ -312,4 +532,243 @@ mod tests {
             0
         );
     }
+
+    /// Creates an open task with a fixed creation order so scans are deterministic.
+    async fn task(store: &Store, goal: &str, name: &str, deps: Vec<String>, order: i64) -> String {
+        let task = store
+            .create_continuous_task(goal, name, None, vec![format!("src/{name}.rs")], deps)
+            .await
+            .unwrap();
+        sqlx::query("UPDATE continuous_tasks SET created_at=? WHERE id=?")
+            .bind(order)
+            .bind(&task.id)
+            .execute(&store.pool)
+            .await
+            .unwrap();
+        task.id
+    }
+
+    async fn assign(store: &Store, task: &str, role: &str, assignee: &str) {
+        store
+            .assign_continuous_task(
+                task,
+                crate::store::team_assignments::AssignmentRequest {
+                    team_id: "development".into(),
+                    role: role.into(),
+                    assignee: assignee.into(),
+                    expected_revision: 0,
+                },
+            )
+            .await
+            .unwrap();
+    }
+
+    fn reasons(scan: &DiscoveryScan) -> Vec<(String, String)> {
+        scan.skipped
+            .iter()
+            .map(|skip| (skip.task_id.clone(), skip.reason.clone()))
+            .collect()
+    }
+
+    async fn count(store: &Store, sql: &str) -> i64 {
+        sqlx::query_scalar(sql)
+            .fetch_one(&store.pool)
+            .await
+            .unwrap()
+    }
+
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn discovery_scan_dispatches_ready_tasks_through_permit_and_role_check() {
+        let (_dir, store, project, goal) = fixture().await;
+        let implement = task(&store, &goal, "implement", vec![], 1).await;
+        let review = task(&store, &goal, "review", vec![], 2).await;
+        assign(&store, &review, "reviewer", "rev-1").await;
+        let blocked = task(&store, &goal, "blocked", vec![implement.clone()], 3).await;
+        let exhausted = task(&store, &goal, "exhausted", vec![], 4).await;
+        sqlx::query("UPDATE continuous_tasks SET attempts=3 WHERE id=?")
+            .bind(&exhausted)
+            .execute(&store.pool)
+            .await
+            .unwrap();
+        let overflow = task(&store, &goal, "overflow", vec![], 5).await;
+
+        let scan = store
+            .scan_discovery_at(&goal, "scan-1", now_unix_secs())
+            .await
+            .unwrap();
+
+        assert_eq!(scan.permit.operation_key, "scan-1");
+        assert_eq!(scan.open_tasks, 5);
+        assert!(!scan.truncated);
+        assert_eq!(
+            scan.dispatched,
+            vec![
+                DiscoveryDispatch {
+                    task_id: implement.clone(),
+                    goal_id: goal.clone(),
+                    dispatch_role: DispatchRole::Implementer,
+                    team_id: None,
+                    assignee: None,
+                },
+                DiscoveryDispatch {
+                    task_id: review.clone(),
+                    goal_id: goal.clone(),
+                    dispatch_role: DispatchRole::Reviewer,
+                    team_id: Some("development".into()),
+                    assignee: Some("rev-1".into()),
+                },
+            ]
+        );
+        assert_eq!(
+            reasons(&scan),
+            vec![
+                (blocked, "dependencies_pending".to_string()),
+                (exhausted, "attempts_exhausted".to_string()),
+                (overflow, "worker_capacity_exhausted".to_string()),
+            ]
+        );
+        // Dispatch is intent only: no claim, attempt, run, launch or process.
+        assert_eq!(
+            count(
+                &store,
+                "SELECT COUNT(*) FROM continuous_tasks WHERE status<>'open' OR claim_owner IS NOT NULL"
+            )
+            .await,
+            0
+        );
+        assert_eq!(
+            count(
+                &store,
+                "SELECT COALESCE(SUM(attempts),0) FROM continuous_tasks"
+            )
+            .await,
+            3
+        );
+        assert_eq!(
+            count(&store, "SELECT COUNT(*) FROM development_runs").await,
+            0
+        );
+        assert_eq!(
+            count(&store, "SELECT COUNT(*) FROM development_launches").await,
+            0
+        );
+
+        let snapshot = store.continuous_context(&project, 0).await.unwrap();
+        let discovery = &snapshot.discovery;
+        assert_eq!(discovery["reservedToday"], 1);
+        assert_eq!(discovery["executionState"], "unavailable");
+        assert_eq!(discovery["recent"][0]["dispatchState"], "recorded");
+        assert_eq!(discovery["latestDispatch"]["permitId"], scan.permit.id);
+        assert_eq!(
+            discovery["latestDispatch"]["dispatched"][1]["dispatchRole"],
+            "reviewer"
+        );
+        assert_eq!(
+            snapshot
+                .events
+                .iter()
+                .filter(|e| e.kind == "discovery_dispatched")
+                .count(),
+            1
+        );
+    }
+
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn discovery_scan_refuses_roles_the_frozen_policy_does_not_permit() {
+        let (_dir, store, _project, goal) = fixture().await;
+        let coordinate = task(&store, &goal, "coordinate", vec![], 1).await;
+        assign(&store, &coordinate, "coordinator", "coord").await;
+        let unassigned = task(&store, &goal, "unassigned", vec![], 2).await;
+        let first = task(&store, &goal, "integrate-a", vec![], 3).await;
+        assign(&store, &first, "integrator", "int-a").await;
+        let second = task(&store, &goal, "integrate-b", vec![], 4).await;
+        assign(&store, &second, "integrator", "int-b").await;
+        // Out-of-band drift of the frozen policy must fail closed, as in W2-04.
+        let mut policy = DevelopmentPolicy::defaults();
+        policy.teams[0].roles = vec!["reviewer".into(), "integrator".into()];
+        sqlx::query("UPDATE continuous_root_policies SET policy_json=?")
+            .bind(serde_json::to_string(&policy).unwrap())
+            .execute(&store.pool)
+            .await
+            .unwrap();
+
+        let scan = store
+            .scan_discovery_at(&goal, "scan-roles", now_unix_secs())
+            .await
+            .unwrap();
+
+        assert_eq!(scan.dispatched.len(), 1);
+        assert_eq!(scan.dispatched[0].task_id, first);
+        assert_eq!(scan.dispatched[0].dispatch_role, DispatchRole::Integrator);
+        assert_eq!(
+            reasons(&scan),
+            vec![
+                (coordinate, "role_refused".to_string()),
+                (unassigned, "role_refused".to_string()),
+                (second, "integration_capacity_exhausted".to_string()),
+            ]
+        );
+    }
+
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn discovery_scan_commits_atomically_with_its_permit_and_counts_running_work() {
+        let (_dir, store, project, goal) = fixture().await;
+        let running = task(&store, &goal, "running", vec![], 1).await;
+        sqlx::query("UPDATE continuous_tasks SET status='running',claim_owner='w',claim_fence=1,attempts=1 WHERE id=?")
+            .bind(&running)
+            .execute(&store.pool)
+            .await
+            .unwrap();
+        let ready = task(&store, &goal, "ready", vec![], 2).await;
+        let waiting = task(&store, &goal, "waiting", vec![], 3).await;
+        let now = now_unix_secs();
+
+        sqlx::query("CREATE TRIGGER fail_discovery_dispatch BEFORE INSERT ON continuous_events WHEN NEW.kind='discovery_dispatched' BEGIN SELECT RAISE(ABORT,'injected dispatch failure'); END").execute(&store.pool).await.unwrap();
+        assert!(store.scan_discovery_at(&goal, "atomic", now).await.is_err());
+        assert_eq!(
+            count(&store, "SELECT COUNT(*) FROM continuous_discovery").await,
+            0,
+            "a failed scan must not keep its permit"
+        );
+        sqlx::query("DROP TRIGGER fail_discovery_dispatch")
+            .execute(&store.pool)
+            .await
+            .unwrap();
+
+        let scan = store.scan_discovery_at(&goal, "atomic", now).await.unwrap();
+        assert_eq!(scan.open_tasks, 2);
+        assert_eq!(scan.dispatched.len(), 1);
+        assert_eq!(scan.dispatched[0].task_id, ready);
+        assert_eq!(
+            reasons(&scan),
+            vec![(waiting, "worker_capacity_exhausted".to_string())]
+        );
+        assert!(store
+            .scan_discovery_at(&goal, "atomic", now)
+            .await
+            .unwrap_err()
+            .contains("already reserved"));
+        store.scan_discovery_at(&goal, "second", now).await.unwrap();
+        assert!(store
+            .scan_discovery_at(&goal, "third", now)
+            .await
+            .unwrap_err()
+            .contains("capacity exhausted"));
+        assert_eq!(
+            count(
+                &store,
+                "SELECT COUNT(*) FROM continuous_events WHERE kind='discovery_dispatched'"
+            )
+            .await,
+            2
+        );
+        assert_eq!(
+            store
+                .continuous_context(&project, 0)
+                .await
+                .unwrap()
+                .discovery["reservedToday"],
+            2
+        );
+    }
 }
```
