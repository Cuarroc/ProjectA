# Review request W2-06: supervisor producer audit and runtime notifications (ProjectA, Tauri 2, Rust + SQLite)

You are an independent code reviewer from a different model vendor than the
author (Claude Code). Review the diff below for correctness and security
bugs. Report findings as a numbered list, each with: severity
(high/medium/low), file:line, what is wrong, a concrete failing scenario, and a
suggested fix. Say explicitly if you find nothing blocking. Do not restate the
diff.

## Task (docs/PLAN.md, W2-06)
"Supervisor: producer audit and runtime notifications · M · `supervisor.rs`,
lane main.rs · `startsWorkers` stays behind the gate · after W1-22."
Candidate commit: `6bbe416` on branch `claude/w2-06-supervisor-audit`
(red `d4d3afb`, green `69368f2`, docs `6bbe416`).

Context: ProjectA's continuous mode has a durable policy supervisor
(`src-tauri/src/store/supervisor.rs`). A background tokio task (`start`)
periodically reconciles enabled/draining projects: it reads a page of
`continuous_events` journal entries under a writer transaction, evaluates
roots against the frozen root policy, blocks exhausted goals, writes
checkpoints and journal events, and advances a cursor. Continuous execution
itself is still disabled; the supervisor can never launch, claim, merge or
release work.

## Design of this change

Producer audit:
- Supervisor state now has exactly two Rust writers, both in
  `store/supervisor.rs`, both gated by `SupervisorAuthority` — a unit-struct
  token with a private field that only `start()` constructs, so no other code
  can call `supervise_project` or `supervisor_error`. (SQLite itself has no
  writer identity; a raw SQL insert is not prevented, it is audited.)
- Every supervisor journal entry now names `producer: "policy_supervisor"`
  and an authority stamp. Block checkpoints carry `blockedBy`: the
  supervisor's own blocks read
  `{"producer":"policy_supervisor","authority":"frozen_root_policy"}`; a root
  another producer already blocked (today: token settlement in
  `development_budget`, surfaced as reason `already_blocked`) reads
  `{"producer":"unattested","authority":null}` — the supervisor does not
  invent that cause.
- The previously silent error write (`supervisor_error`) now leaves one
  `supervisor_health` event per transition (`degraded` / `recovered`),
  without error text. The observer error is recorded inside the same
  reconciliation transaction, so a persisting failure cannot flap between
  degraded and recovered.
- Attestation: while draining its journal page, the supervisor checks each
  `supervisor_*` event. A `supervisor_blocked` event is attested only by a
  stored checkpoint row with the same project, root, reason and timestamp;
  health and audit events need the producer stamp and a known action/finding.
  An unattested event produces exactly one `supervisor_audit` event
  (`finding: unattested_supervisor_event`, `eventCursor`) in the same
  transaction and changes no goal. This is a shape check, not a signature.

Runtime notifications:
- Each commit returns its notices (`SupervisorNotice::Blocked/Degraded/
  Recovered/Audit`); the background task hands them to a `Notifier`
  (`Arc<dyn Fn(&SupervisorNotice) + Send + Sync>`) which `main.rs` wires to
  `app.emit("supervisor:notification", notice)`. `src/lib/ipc.ts` gets
  `SupervisorNotification` + `onSupervisorNotification`. No-op passes and
  rolled-back transactions emit nothing. Payloads hold ids and fixed codes
  only — never error text.
- `supervisor_error` now uses an `INSERT ... ON CONFLICT DO UPDATE SET
  cursor=cursor RETURNING last_error IS NOT NULL` statement to read the
  previous degraded state under the writer lock before updating.

## Deliberately out of scope
- `startsWorkers` and the activation gates: untouched, still disabled.
- Inbox rendering of the notifications (frontend listener exists, nothing
  renders it yet).
- Detecting a stalled supervisor task (no pass at all is not detected).
- Cryptographic attestation of journal events.

## Rules the change is held against (from AGENTS.md)
- Rust/SQLite owns runtime state; no second scheduler.
- Capability configuration is not capability evidence; no provider, billing
  or token claims without observation.
- Agents cannot expand their own approval, credential, budget or release
  policy; the supervisor must not acquire new authority.
- No secrets in payloads or journal entries.

## Questions for you
1. Authority gate: can any code path other than `start()`'s task now write
   supervisor state (cursor, error, checkpoints, supervisor_* events)? Is
   `SupervisorAuthority` actually unforgeable, and are both writers gated?
2. Transaction atomicity: are cursor advance, block checkpoint, journal
   events, health transition and observer-error recording all-or-nothing?
   Does the `supervisor_error` upsert/RETURNING pattern correctly detect the
   previous degraded state under the writer lock?
3. Notification discipline: can a notice ever be emitted for a rolled-back
   or no-op transaction? Can a repeat failure or repeat block emit a
   duplicate notice or journal event? Can error text leak into a notice or
   a `supervisor_health` event?
4. Attestation: does the `attested` check have false negatives (auditing
   legitimate events, e.g. clock or timestamp mismatches, paging across the
   audited event) or false positives (accepting forged events that matter)?
   Could the audit insert itself be re-attested forever (audit loop)?
5. The `blockedBy` mapping: is `reason == "already_blocked"` a correct and
   complete discriminator for "blocked by another producer"?

## Diff vs origin/main
```diff
diff --git a/docs/development/CONTINUOUS.md b/docs/development/CONTINUOUS.md
index 7d76917..d2e70d4 100644
--- a/docs/development/CONTINUOUS.md
+++ b/docs/development/CONTINUOUS.md
@@ -231,8 +231,8 @@ consumer's successfully applied state; retry after an interrupted response.
 
 This reads the existing `continuous_events` journal. It does not claim every
 runtime table already emits events or install a background subscriber. Full
-state remains available from `hq context`; journal-producer coverage and runtime
-notifications still need integration before supervisor activation. Run-scoped
+state remains available from `hq context`. Supervisor runtime notifications and
+its producer audit are described under "Durable policy supervisor". Run-scoped
 credentials cannot access this project-wide route.
 
 ## Evidence and review pages
@@ -357,6 +357,41 @@ still reconciles and acknowledges successful checks. Notifications are wake hint
 The `policyLimitSupervisor` capability explicitly reports `startsWorkers: false`.
 Continuous execution, provider acceptance and automatic delivery remain disabled.
 
+### Producer audit and runtime notifications (W2-06)
+
+Supervisor state has exactly two Rust writers, both in `store/supervisor.rs`
+and both requiring a `SupervisorAuthority` that only the background task holds:
+`supervise_project` (cursor, observation, block checkpoints and the
+`supervisor_blocked`, `supervisor_health` and `supervisor_audit` events) and
+`supervisor_error` (last error). Other code cannot construct the authority, so it
+cannot write supervisor state. SQLite itself has no writer identity: a raw SQL
+insert is not prevented, it is audited (below).
+
+Every supervisor journal entry names its producer (`policy_supervisor`) and its
+authority. Block checkpoints carry `blockedBy`: the supervisor's own blocks read
+`{"producer":"policy_supervisor","authority":"frozen_root_policy"}`. A root that
+another producer already blocked, today token settlement in
+`development_budget`, reads `{"producer":"unattested","authority":null}`; the
+supervisor does not invent that cause. Health changes that used to be silent
+now leave one `supervisor_health` event (`action` `degraded` or `recovered`) per
+transition, without the error text. A persisting failure writes nothing more.
+
+While draining its page the supervisor attests each `supervisor_*` event. A
+`supervisor_blocked` event is attested only by a stored checkpoint with the same
+project, root, reason and timestamp; health and audit events need the producer
+stamp and a known action. An unattested event leads to one `supervisor_audit`
+event (`finding: unattested_supervisor_event`, `eventCursor`) in the same
+transaction and changes no goal. The shape check is not a signature: a forged
+event with a matching stamp is not detected.
+
+After each commit the app emits the Tauri event `supervisor:notification`
+(`onSupervisorNotification` in `src/lib/ipc.ts`) once per change: `blocked`
+(project, root, reason code), `degraded`, `recovered` or `audit` (finding,
+event cursor). A reconciliation that changes nothing emits nothing; a rolled
+back transaction emits nothing. Payloads hold ids and fixed codes only; error
+text and checkpoints stay behind the authorized context read. The inbox does not
+render them yet, and a stalled supervisor task (no pass at all) is not detected.
+
 ## Team assignments
 
 `pa hq tasks assign <taskId> --team development --role implementer --assignee
diff --git a/src-tauri/src/main.rs b/src-tauri/src/main.rs
index 24b7201..038d3d3 100644
--- a/src-tauri/src/main.rs
+++ b/src-tauri/src/main.rs
@@ -3433,7 +3433,13 @@ fn main() {
             // would fail, which is why it is the first thing done with `dir`.
             learnings::set_data_dir(&dir);
             let store = init_store(&handle, &dir)?;
-            let policy_supervisor = tauri::async_runtime::block_on(store::supervisor::start(store.clone()));
+            // W2-06: committed supervisor changes reach the window as runtime
+            // notifications; the payload holds ids and reason codes only.
+            let notice_app = handle.clone();
+            let notifier: store::supervisor::Notifier = Arc::new(move |notice| {
+                let _ = notice_app.emit("supervisor:notification", notice);
+            });
+            let policy_supervisor = tauri::async_runtime::block_on(store::supervisor::start(store.clone(), Some(notifier)));
             app.manage(policy_supervisor);
             let engine = init_status(&handle, &store);
             init_exit_hook(&handle, &store, &engine);
diff --git a/src-tauri/src/store/supervisor.rs b/src-tauri/src/store/supervisor.rs
index e90cd3e..a869f37 100644
--- a/src-tauri/src/store/supervisor.rs
+++ b/src-tauri/src/store/supervisor.rs
@@ -1,8 +1,19 @@
 //! Durable policy supervision. It cannot launch, reclaim, merge or release work.
+//!
+//! W2-06 producer audit. The writers of supervisor state are exactly:
+//! - `Store::supervise_project`: cursor, observation, root block checkpoints,
+//!   `supervisor_blocked`, `supervisor_health` and `supervisor_audit` events;
+//! - `Store::supervisor_error`: last error and `supervisor_health`.
+//!
+//! Both require a [`SupervisorAuthority`], which only [`start`] issues. Goal
+//! blocks by other producers (token settlement in `development_budget`) are
+//! recorded as `unattested` in the checkpoint's `blockedBy`, never invented.
 use super::{now_unix_secs, Store};
 use crate::development_policy::DevelopmentPolicy;
+use serde::Serialize;
 use serde_json::{json, Value};
 use sqlx::{Sqlite, Transaction};
+use std::sync::Arc;
 use std::time::Duration;
 
 type ObservationRow = (i64, Option<i64>, Option<String>, Option<i64>, i64);
@@ -17,6 +28,60 @@ type TaskCheckpointRow = (
 );
 type RunCheckpointRow = (String, String, String, Option<String>, Option<i64>);
 
+/// The only producer identity allowed to write supervisor state. It has no
+/// constructor outside this module, so no other code can write that state.
+pub(crate) struct SupervisorAuthority {
+    _private: (),
+}
+
+/// A user-facing change of supervisor state. It carries identifiers and fixed
+/// reason codes only, never error text, so it cannot leak secrets or paths.
+#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
+#[serde(
+    tag = "kind",
+    rename_all = "camelCase",
+    rename_all_fields = "camelCase"
+)]
+pub(crate) enum SupervisorNotice {
+    Blocked {
+        project_id: String,
+        root_goal_id: String,
+        reason: String,
+        observed_at: i64,
+    },
+    Degraded {
+        project_id: String,
+        observed_at: i64,
+    },
+    Recovered {
+        project_id: String,
+        observed_at: i64,
+    },
+    Audit {
+        project_id: String,
+        finding: String,
+        event_cursor: i64,
+        observed_at: i64,
+    },
+}
+
+/// Receives notices after their transaction has committed.
+pub(crate) type Notifier = Arc<dyn Fn(&SupervisorNotice) + Send + Sync>;
+
+/// One committed reconciliation and the notices it produced.
+pub(crate) struct Supervision {
+    pub result: Value,
+    pub notices: Vec<SupervisorNotice>,
+}
+
+fn notify(notifier: &Option<Notifier>, notices: &[SupervisorNotice]) {
+    if let Some(notifier) = notifier {
+        for notice in notices {
+            notifier(notice);
+        }
+    }
+}
+
 pub(crate) struct PolicySupervisor {
     task: tokio::task::JoinHandle<()>,
 }
@@ -28,7 +93,8 @@ impl Drop for PolicySupervisor {
 
 /// Installed once by the app. Existing activation gates still own control state;
 /// this task only enforces limits in enabled/draining projects, never enables one.
-pub(crate) async fn start(store: Store) -> PolicySupervisor {
+pub(crate) async fn start(store: Store, notifier: Option<Notifier>) -> PolicySupervisor {
+    let authority = SupervisorAuthority { _private: () };
     let task = tokio::spawn(async move {
         while !store.pool.is_closed() {
             match store.supervisor_projects().await {
@@ -47,17 +113,19 @@ pub(crate) async fn start(store: Store) -> PolicySupervisor {
                         }
                         let mut more = false;
                         for project in projects {
-                            let result = reconcile(&store, &project, &health).await;
-                            match result {
-                                Ok(result) => more |= result["hasMore"] == true,
+                            match reconcile(&store, &authority, &project, &health).await {
+                                Ok(done) => {
+                                    more |= done.result["hasMore"] == true;
+                                    notify(&notifier, &done.notices);
+                                }
                                 Err(error) => {
-                                    if let Err(record_error) =
-                                        store.supervisor_error(&project, &error).await
+                                    match store.supervisor_error(&authority, &project, &error).await
                                     {
-                                        crate::logf!(
+                                        Ok(notice) => notify(&notifier, notice.as_slice()),
+                                        Err(record_error) => crate::logf!(
                                             "supervisor",
                                             "cannot record failure: {record_error}"
-                                        );
+                                        ),
                                     }
                                 }
                             }
@@ -75,10 +143,13 @@ pub(crate) async fn start(store: Store) -> PolicySupervisor {
                     },
                     Err(error) => {
                         for project in projects {
-                            if let Err(record_error) =
-                                reconcile(&store, &project, &Err(error.clone())).await
+                            match reconcile(&store, &authority, &project, &Err(error.clone())).await
                             {
-                                crate::logf!("supervisor", "cannot record failure: {record_error}");
+                                Ok(done) => notify(&notifier, &done.notices),
+                                Err(record_error) => crate::logf!(
+                                    "supervisor",
+                                    "cannot record failure: {record_error}"
+                                ),
                             }
                         }
                     }
@@ -99,17 +170,16 @@ pub(crate) async fn start(store: Store) -> PolicySupervisor {
 
 async fn reconcile(
     store: &Store,
+    authority: &SupervisorAuthority,
     project: &str,
     health: &Result<i64, String>,
-) -> Result<Value, String> {
+) -> Result<Supervision, String> {
     // Notifications are wake hints, never authority to suppress policy checks.
-    let result = store.supervise_continuous_project(project).await?;
-    if result["state"] != "disabled" {
-        if let Err(error) = health {
-            store.supervisor_error(project, error).await?;
-        }
-    }
-    Ok(result)
+    // A disabled project is untouched, so its observer error is not recorded.
+    let observer_error = health.as_ref().err().map(String::as_str);
+    store
+        .supervise_project(authority, project, observer_error)
+        .await
 }
 
 pub(super) async fn apply_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
@@ -158,16 +228,38 @@ impl Store {
         Ok(rows.into_iter().map(|(id,)| id).collect())
     }
 
-    pub(crate) async fn supervisor_error(&self, project: &str, error: &str) -> Result<(), String> {
+    pub(crate) async fn supervisor_error(
+        &self,
+        _authority: &SupervisorAuthority,
+        project: &str,
+        error: &str,
+    ) -> Result<Option<SupervisorNotice>, String> {
         let error: String = error.chars().take(1000).collect();
-        sqlx::query("INSERT INTO continuous_supervisor(project_id,last_error,error_at) VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET last_error=excluded.last_error,error_at=excluded.error_at")
-            .bind(project).bind(error).bind(now_unix_secs()).execute(&self.pool).await.map_err(db)?;
-        Ok(())
+        let now = now_unix_secs();
+        let mut tx = self.pool.begin().await.map_err(db)?;
+        // The upsert takes the writer lock before the previous state is read.
+        let (was_degraded,): (bool,) = sqlx::query_as("INSERT INTO continuous_supervisor(project_id,last_error,error_at) VALUES(?,NULL,NULL) ON CONFLICT(project_id) DO UPDATE SET cursor=cursor RETURNING last_error IS NOT NULL")
+            .bind(project).fetch_one(&mut *tx).await.map_err(db)?;
+        sqlx::query("UPDATE continuous_supervisor SET last_error=?,error_at=? WHERE project_id=?")
+            .bind(error)
+            .bind(now)
+            .bind(project)
+            .execute(&mut *tx)
+            .await
+            .map_err(db)?;
+        let notice = health_transition(&mut tx, project, was_degraded, true, now).await?;
+        tx.commit().await.map_err(db)?;
+        Ok(notice)
     }
 
     /// Current state is evaluated under the same writer transaction that advances
     /// the cursor. Replaying notices can neither repeat effects nor release claims.
-    pub async fn supervise_continuous_project(&self, project: &str) -> Result<Value, String> {
+    pub(crate) async fn supervise_project(
+        &self,
+        _authority: &SupervisorAuthority,
+        project: &str,
+        observer_error: Option<&str>,
+    ) -> Result<Supervision, String> {
         self.require_project(project).await?;
         let now = now_unix_secs();
         let mut tx = self.pool.begin().await.map_err(db)?;
@@ -181,17 +273,36 @@ impl Store {
             .bind(project).fetch_one(&mut *tx).await.map_err(db)?;
         if !enabled {
             tx.rollback().await.map_err(db)?;
-            return Ok(json!({"state":"disabled","hasMore":false,"blockedRoots":[]}));
+            return Ok(Supervision {
+                result: json!({"state":"disabled","hasMore":false,"blockedRoots":[]}),
+                notices: Vec::new(),
+            });
         }
-        let (old_cursor,): (i64,) =
-            sqlx::query_as("SELECT cursor FROM continuous_supervisor WHERE project_id=?")
-                .bind(project)
-                .fetch_one(&mut *tx)
-                .await
-                .map_err(db)?;
+        let (old_cursor, was_degraded): (i64, bool) = sqlx::query_as(
+            "SELECT cursor,last_error IS NOT NULL FROM continuous_supervisor WHERE project_id=?",
+        )
+        .bind(project)
+        .fetch_one(&mut *tx)
+        .await
+        .map_err(db)?;
         let (events, has_more) =
             super::continuous::read_event_page(&mut tx, project, old_cursor).await?;
         let cursor = events.last().map_or(old_cursor, |event| event.cursor);
+        let mut notices = Vec::new();
+        // W2-06: supervisor kinds in the journal must come from this module.
+        for event in &events {
+            if attested(&mut tx, project, event).await? {
+                continue;
+            }
+            sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'supervisor_audit',?,?)")
+                .bind(project).bind(json!({"version":1,"producer":PRODUCER,"authority":"journal_attestation","finding":UNATTESTED,"eventCursor":event.cursor}).to_string()).bind(now).execute(&mut *tx).await.map_err(db)?;
+            notices.push(SupervisorNotice::Audit {
+                project_id: project.to_string(),
+                finding: UNATTESTED.to_string(),
+                event_cursor: event.cursor,
+                observed_at: now,
+            });
+        }
         let roots:Vec<(String,i64,String,Option<String>)>=sqlx::query_as("SELECT g.id,g.deadline_at,g.status,p.policy_json FROM continuous_goals g LEFT JOIN continuous_root_policies p ON p.root_goal_id=g.id WHERE g.project_id=? AND g.id=g.root_goal_id AND g.admitted=1 AND g.status IN ('open','awaiting_review','blocked') ORDER BY g.id")
             .bind(project).fetch_all(&mut *tx).await.map_err(db)?;
         let mut blocked = Vec::new();
@@ -235,16 +346,95 @@ impl Store {
             sqlx::query("UPDATE continuous_goals SET status='blocked',updated_at=? WHERE project_id=? AND root_goal_id=? AND status IN ('open','awaiting_review')")
                 .bind(now).bind(project).bind(&root).execute(&mut *tx).await.map_err(db)?;
             sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'supervisor_blocked',?,?)")
-                .bind(project).bind(json!({"version":1,"rootGoalId":root,"reason":reason,"checkpointSource":"continuous_supervisor_blocks"}).to_string()).bind(now).execute(&mut *tx).await.map_err(db)?;
+                .bind(project).bind(json!({"version":1,"producer":PRODUCER,"authority":"frozen_root_policy","rootGoalId":root,"reason":reason,"checkpointSource":"continuous_supervisor_blocks"}).to_string()).bind(now).execute(&mut *tx).await.map_err(db)?;
+            notices.push(SupervisorNotice::Blocked {
+                project_id: project.to_string(),
+                root_goal_id: root.clone(),
+                reason: reason.to_string(),
+                observed_at: now,
+            });
             blocked.push(root);
         }
-        sqlx::query("UPDATE continuous_supervisor SET cursor=?,observed_at=?,last_error=NULL,error_at=NULL,policy_version=1 WHERE project_id=?")
-            .bind(cursor).bind(now).bind(project).execute(&mut *tx).await.map_err(db)?;
+        // An observer failure is recorded here, in the same transaction, so a
+        // persisting failure does not flap between recovered and degraded.
+        let error: Option<String> = observer_error.map(|e| e.chars().take(1000).collect());
+        let degraded = error.is_some();
+        sqlx::query("UPDATE continuous_supervisor SET cursor=?,observed_at=?,last_error=?,error_at=?,policy_version=1 WHERE project_id=?")
+            .bind(cursor).bind(now).bind(error).bind(degraded.then_some(now)).bind(project).execute(&mut *tx).await.map_err(db)?;
+        notices.extend(health_transition(&mut tx, project, was_degraded, degraded, now).await?);
         tx.commit().await.map_err(db)?;
-        Ok(
-            json!({"state":"recorded","cursor":cursor,"hasMore":has_more,"blockedRoots":blocked,"observedAt":now}),
-        )
+        Ok(Supervision {
+            result: json!({"state":"recorded","cursor":cursor,"hasMore":has_more,"blockedRoots":blocked,"observedAt":now}),
+            notices,
+        })
+    }
+}
+
+const PRODUCER: &str = "policy_supervisor";
+const UNATTESTED: &str = "unattested_supervisor_event";
+
+/// One journal entry and one notice per health change; none for a repeat.
+/// The entry carries no error text: that stays in the authorized context read.
+async fn health_transition(
+    tx: &mut Transaction<'_, Sqlite>,
+    project: &str,
+    was_degraded: bool,
+    degraded: bool,
+    now: i64,
+) -> Result<Option<SupervisorNotice>, String> {
+    let (action, notice) = match (was_degraded, degraded) {
+        (false, true) => (
+            "degraded",
+            SupervisorNotice::Degraded {
+                project_id: project.to_string(),
+                observed_at: now,
+            },
+        ),
+        (true, false) => (
+            "recovered",
+            SupervisorNotice::Recovered {
+                project_id: project.to_string(),
+                observed_at: now,
+            },
+        ),
+        _ => return Ok(None),
+    };
+    sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'supervisor_health',?,?)")
+        .bind(project).bind(json!({"version":1,"producer":PRODUCER,"authority":"supervisor_observation","action":action}).to_string()).bind(now).execute(&mut **tx).await.map_err(db)?;
+    Ok(Some(notice))
+}
+
+/// Whether a journal event of a supervisor kind was produced by this module.
+/// A block event needs its stored checkpoint (same project, root, reason and
+/// time); health and audit events need the producer stamp and a known value.
+/// This is a shape check, not a signature: SQLite has no writer identity.
+async fn attested(
+    tx: &mut Transaction<'_, Sqlite>,
+    project: &str,
+    event: &super::continuous::ContinuousEvent,
+) -> Result<bool, String> {
+    if !event.kind.starts_with("supervisor_") {
+        return Ok(true);
     }
+    let detail: Value = serde_json::from_str(&event.detail).unwrap_or(Value::Null);
+    let stamped = detail["producer"] == PRODUCER;
+    Ok(match event.kind.as_str() {
+        "supervisor_blocked" => {
+            let (Some(root), Some(reason)) =
+                (detail["rootGoalId"].as_str(), detail["reason"].as_str())
+            else {
+                return Ok(false);
+            };
+            let (found,): (bool,) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM continuous_supervisor_blocks WHERE root_goal_id=? AND project_id=? AND reason=? AND observed_at=?)")
+                .bind(root).bind(project).bind(reason).bind(event.created_at).fetch_one(&mut **tx).await.map_err(db)?;
+            found
+        }
+        "supervisor_health" => {
+            stamped && matches!(detail["action"].as_str(), Some("degraded" | "recovered"))
+        }
+        "supervisor_audit" => stamped && detail["finding"] == UNATTESTED,
+        _ => false,
+    })
 }
 
 async fn checkpoint(
@@ -256,6 +446,13 @@ async fn checkpoint(
     now: i64,
     tokens: &super::development_budget::TokenBalance,
 ) -> Result<Value, String> {
+    // W2-06: who blocked the root. This supervisor under the frozen policy, or
+    // another producer (token settlement) whose cause is not recorded here.
+    let blocked_by = if reason == "already_blocked" {
+        json!({"producer":"unattested","authority":null})
+    } else {
+        json!({"producer":PRODUCER,"authority":"frozen_root_policy"})
+    };
     let tasks:Vec<TaskCheckpointRow>=sqlx::query_as("SELECT t.id,t.status,t.claim_owner,t.claim_fence,t.attempts,(SELECT MAX(revision) FROM development_checkpoints c WHERE c.task_id=t.id),COALESCE((SELECT a.role FROM continuous_team_assignments a WHERE a.task_id=t.id),'implementer') FROM continuous_tasks t JOIN continuous_goals g ON g.id=t.goal_id WHERE g.project_id=? AND g.root_goal_id=? ORDER BY t.created_at,t.id LIMIT 64")
         .bind(project).bind(root).fetch_all(&mut **tx).await.map_err(db)?;
     let (total_tasks,):(i64,)=sqlx::query_as("SELECT COUNT(*) FROM continuous_tasks t JOIN continuous_goals g ON g.id=t.goal_id WHERE g.project_id=? AND g.root_goal_id=?")
@@ -276,7 +473,7 @@ async fn checkpoint(
         json!({"runId":id,"taskId":task,"status":status,"workerId":worker,"workerIdTruncated":truncated,"processId":process})
     }).collect();
     Ok(
-        json!({"schemaVersion":1,"policyVersion":1,"source":"rust/sqlite","rootGoalId":root,"projectId":project,"reason":reason,"observedAt":now,"eventCursor":cursor,"tasks":tasks,"taskCount":total_tasks,"tasksTruncated":total_tasks>64,"runs":runs,"runCount":total_runs,"runsTruncated":total_runs>128,"tokens":tokens,"ownershipRetained":true,"nextAction":"reconcile runs and read referenced task checkpoints before any retry"}),
+        json!({"schemaVersion":1,"policyVersion":1,"source":"rust/sqlite","rootGoalId":root,"projectId":project,"reason":reason,"blockedBy":blocked_by,"observedAt":now,"eventCursor":cursor,"tasks":tasks,"taskCount":total_tasks,"tasksTruncated":total_tasks>64,"runs":runs,"runCount":total_runs,"runsTruncated":total_runs>128,"tokens":tokens,"ownershipRetained":true,"nextAction":"reconcile runs and read referenced task checkpoints before any retry"}),
     )
 }
 
@@ -297,6 +494,38 @@ mod tests {
     use super::*;
     use crate::{development_policy::DevelopmentPolicy, testutil::TempDir};
     use serde_json::json;
+    use std::sync::Mutex;
+
+    const AUTHORITY: SupervisorAuthority = SupervisorAuthority { _private: () };
+
+    async fn supervise(store: &Store, project: &str) -> Result<Value, String> {
+        Ok(store
+            .supervise_project(&AUTHORITY, project, None)
+            .await?
+            .result)
+    }
+
+    async fn journal(store: &Store, project: &str, kind: &str) -> Vec<(i64, Value)> {
+        let rows: Vec<(i64, String)> = sqlx::query_as(
+            "SELECT cursor,detail FROM continuous_events WHERE project_id=? AND kind=? ORDER BY cursor",
+        )
+        .bind(project)
+        .bind(kind)
+        .fetch_all(&store.pool)
+        .await
+        .unwrap();
+        rows.into_iter()
+            .map(|(cursor, detail)| (cursor, serde_json::from_str(&detail).unwrap()))
+            .collect()
+    }
+
+    async fn expire(store: &Store, root: &str) {
+        sqlx::query("UPDATE continuous_goals SET deadline_at=1 WHERE id=?")
+            .bind(root)
+            .execute(&store.pool)
+            .await
+            .unwrap();
+    }
 
     async fn fixture() -> (TempDir, Store, String, String) {
         let dir = TempDir::new("policy-supervisor");
@@ -332,11 +561,17 @@ mod tests {
             .unwrap();
         let health = Err("injected observer failure".into());
         assert_eq!(
-            reconcile(&store, &project, &health).await.unwrap()["blockedRoots"],
+            reconcile(&store, &AUTHORITY, &project, &health)
+                .await
+                .unwrap()
+                .result["blockedRoots"],
             json!([root])
         );
         assert_eq!(
-            reconcile(&store, &project, &health).await.unwrap()["blockedRoots"],
+            reconcile(&store, &AUTHORITY, &project, &health)
+                .await
+                .unwrap()
+                .result["blockedRoots"],
             json!([])
         );
         let mut tx = store.pool.begin().await.unwrap();
@@ -374,7 +609,7 @@ mod tests {
             .execute(&store.pool)
             .await
             .unwrap();
-        store.supervise_continuous_project(&project).await.unwrap();
+        supervise(&store, &project).await.unwrap();
         let mut tx = store.pool.begin().await.unwrap();
         let snapshot = context(&mut tx, &project).await.unwrap();
         let block = &snapshot["blocks"][0];
@@ -430,7 +665,7 @@ mod tests {
             .execute(&store.pool)
             .await
             .unwrap();
-        store.supervise_continuous_project(&project).await.unwrap();
+        supervise(&store, &project).await.unwrap();
         let mut tx = store.pool.begin().await.unwrap();
         let snapshot = context(&mut tx, &project).await.unwrap();
         let tasks = snapshot["blocks"][0]["tasks"].as_array().unwrap();
@@ -460,9 +695,8 @@ mod tests {
             .unwrap();
         let other = store.clone();
         let other_project = project.clone();
-        let first =
-            tokio::spawn(async move { other.supervise_continuous_project(&other_project).await });
-        let second = store.supervise_continuous_project(&project).await.unwrap();
+        let first = tokio::spawn(async move { supervise(&other, &other_project).await });
+        let second = supervise(&store, &project).await.unwrap();
         let first = first.await.unwrap().unwrap();
         assert_eq!(
             first["blockedRoots"].as_array().unwrap().len()
@@ -478,7 +712,7 @@ mod tests {
     async fn failed_journal_write_rolls_back_checkpoint_goal_and_cursor() {
         let (_dir, store, project, root) = fixture().await;
         // Establish an acknowledged cursor before the failed transaction.
-        store.supervise_continuous_project(&project).await.unwrap();
+        supervise(&store, &project).await.unwrap();
         let before: (i64, Option<i64>) = sqlx::query_as(
             "SELECT cursor,observed_at FROM continuous_supervisor WHERE project_id=?",
         )
@@ -493,12 +727,12 @@ mod tests {
             .unwrap();
         sqlx::query("CREATE TRIGGER fail_supervisor BEFORE INSERT ON continuous_events WHEN NEW.kind='supervisor_blocked' BEGIN SELECT RAISE(ABORT,'injected journal failure'); END")
             .execute(&store.pool).await.unwrap();
-        let error = store
-            .supervise_continuous_project(&project)
-            .await
-            .unwrap_err();
+        let error = supervise(&store, &project).await.unwrap_err();
         assert!(error.contains("injected journal failure"));
-        store.supervisor_error(&project, &error).await.unwrap();
+        store
+            .supervisor_error(&AUTHORITY, &project, &error)
+            .await
+            .unwrap();
         let after: (i64, Option<i64>, Option<String>) = sqlx::query_as(
             "SELECT cursor,observed_at,last_error FROM continuous_supervisor WHERE project_id=?",
         )
@@ -524,7 +758,7 @@ mod tests {
             .await
             .unwrap();
         assert_eq!(
-            store.supervise_continuous_project(&project).await.unwrap()["blockedRoots"],
+            supervise(&store, &project).await.unwrap()["blockedRoots"],
             json!([root])
         );
         let mut tx = store.pool.begin().await.unwrap();
@@ -548,7 +782,7 @@ mod tests {
             .await
             .unwrap();
         assert_eq!(
-            store.supervise_continuous_project(&project).await.unwrap()["state"],
+            supervise(&store, &project).await.unwrap()["state"],
             "disabled"
         );
         let (observations,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM continuous_supervisor")
@@ -560,7 +794,7 @@ mod tests {
             .execute(&store.pool)
             .await
             .unwrap();
-        let guard = start(store.clone()).await;
+        let guard = start(store.clone(), None).await;
         tokio::time::timeout(Duration::from_secs(10), async {
             loop {
                 let (status,): (String,) =
@@ -609,15 +843,15 @@ mod tests {
         sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'foreign','hidden',1)")
             .bind(&other.id).execute(&mut *tx).await.unwrap();
         tx.commit().await.unwrap();
-        let first = store.supervise_continuous_project(&project).await.unwrap();
+        let first = supervise(&store, &project).await.unwrap();
         assert_eq!(first["hasMore"], true);
         assert_eq!(first["blockedRoots"], json!([]));
         store.pool.close().await;
         let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
-        let second = store.supervise_continuous_project(&project).await.unwrap();
+        let second = supervise(&store, &project).await.unwrap();
         assert!(second["cursor"].as_i64().unwrap() > first["cursor"].as_i64().unwrap());
         assert_eq!(second["hasMore"], true);
-        let third = store.supervise_continuous_project(&project).await.unwrap();
+        let third = supervise(&store, &project).await.unwrap();
         assert_eq!(third["hasMore"], false);
         let (last,): (i64,) =
             sqlx::query_as("SELECT MAX(cursor) FROM continuous_events WHERE project_id=?")
@@ -633,7 +867,7 @@ mod tests {
             .await
             .unwrap();
         assert_eq!(
-            store.supervise_continuous_project(&project).await.unwrap()["blockedRoots"],
+            supervise(&store, &project).await.unwrap()["blockedRoots"],
             json!([root])
         );
         let (reason,): (String,) =
@@ -669,7 +903,7 @@ mod tests {
             .execute(&store.pool)
             .await
             .unwrap();
-        let result = store.supervise_continuous_project(&project).await.unwrap();
+        let result = supervise(&store, &project).await.unwrap();
         assert_eq!(result["blockedRoots"], json!([root]));
         let goals = store.list_continuous_goals(&project).await.unwrap();
         assert!(goals.iter().all(|goal| goal.status == "blocked"));
@@ -700,15 +934,252 @@ mod tests {
             .create_continuous_goal(&project, "replacement", None, None, true)
             .await
             .is_err());
-        let again = store.supervise_continuous_project(&project).await.unwrap();
+        let again = supervise(&store, &project).await.unwrap();
         assert_eq!(again["blockedRoots"], json!([]));
         store.pool.close().await;
         let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
-        let resumed = reopened
-            .supervise_continuous_project(&project)
-            .await
-            .unwrap();
+        let resumed = supervise(&reopened, &project).await.unwrap();
         assert_eq!(resumed["blockedRoots"], json!([]));
         assert_eq!(resumed["cursor"], again["cursor"]);
     }
+
+    /// W2-06: a block is one user-facing state change, so exactly one notice;
+    /// a reconciliation that changes nothing produces none.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn block_notifies_exactly_once_and_noop_is_silent() {
+        let (_dir, store, project, root) = fixture().await;
+        let quiet = store
+            .supervise_project(&AUTHORITY, &project, None)
+            .await
+            .unwrap();
+        assert_eq!(quiet.notices, vec![]);
+        expire(&store, &root).await;
+        let blocked = store
+            .supervise_project(&AUTHORITY, &project, None)
+            .await
+            .unwrap();
+        assert_eq!(blocked.notices.len(), 1, "{:?}", blocked.notices);
+        assert!(matches!(
+            &blocked.notices[0],
+            SupervisorNotice::Blocked { project_id, root_goal_id, reason, .. }
+                if project_id == &project && root_goal_id == &root && reason == "deadline_exhausted"
+        ));
+        let again = store
+            .supervise_project(&AUTHORITY, &project, None)
+            .await
+            .unwrap();
+        assert_eq!(again.notices, vec![]);
+    }
+
+    /// W2-06: the error write was silent. Health transitions now leave one
+    /// journal audit entry and one notice each; repeats are no-ops. Neither the
+    /// notice nor the journal entry carries the error text.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn health_transitions_are_audited_and_notified_once_without_error_text() {
+        let (_dir, store, project, _root) = fixture().await;
+        let secret = "db failed at C:\\Users\\me\\vault sk-abcdefghijklmnop";
+        let first = store
+            .supervisor_error(&AUTHORITY, &project, secret)
+            .await
+            .unwrap();
+        assert!(
+            matches!(first, Some(SupervisorNotice::Degraded { .. })),
+            "{first:?}"
+        );
+        let repeat = store
+            .supervisor_error(&AUTHORITY, &project, "another failure")
+            .await
+            .unwrap();
+        assert_eq!(repeat, None);
+        let health = journal(&store, &project, "supervisor_health").await;
+        assert_eq!(health.len(), 1);
+        assert_eq!(health[0].1["action"], "degraded");
+        assert_eq!(health[0].1["producer"], "policy_supervisor");
+        assert!(health[0].1["authority"].is_string());
+        let serialized = serde_json::to_string(&first).unwrap();
+        for leaked in [&serialized, &health[0].1.to_string()] {
+            assert!(!leaked.contains("sk-"), "{leaked}");
+            assert!(!leaked.contains("vault"), "{leaked}");
+        }
+        let recovered = store
+            .supervise_project(&AUTHORITY, &project, None)
+            .await
+            .unwrap();
+        assert_eq!(recovered.notices.len(), 1, "{:?}", recovered.notices);
+        assert!(matches!(
+            recovered.notices[0],
+            SupervisorNotice::Recovered { .. }
+        ));
+        let steady = store
+            .supervise_project(&AUTHORITY, &project, None)
+            .await
+            .unwrap();
+        assert_eq!(steady.notices, vec![]);
+        let health = journal(&store, &project, "supervisor_health").await;
+        assert_eq!(
+            health
+                .iter()
+                .map(|(_, d)| d["action"].clone())
+                .collect::<Vec<_>>(),
+            vec![json!("degraded"), json!("recovered")]
+        );
+    }
+
+    /// W2-06: a persisting observer failure must not flap between recovered
+    /// and degraded on every pass (each flap would write journal events and
+    /// wake the supervisor again).
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn persisting_observer_failure_degrades_once() {
+        let (_dir, store, project, _root) = fixture().await;
+        let failing = Err("observer down".to_string());
+        let mut notices = Vec::new();
+        for _ in 0..3 {
+            notices.extend(
+                reconcile(&store, &AUTHORITY, &project, &failing)
+                    .await
+                    .unwrap()
+                    .notices,
+            );
+        }
+        assert_eq!(notices.len(), 1, "{notices:?}");
+        assert!(matches!(notices[0], SupervisorNotice::Degraded { .. }));
+        assert_eq!(
+            journal(&store, &project, "supervisor_health").await.len(),
+            1
+        );
+        let healed = reconcile(&store, &AUTHORITY, &project, &Ok(1))
+            .await
+            .unwrap();
+        assert!(matches!(
+            healed.notices[..],
+            [SupervisorNotice::Recovered { .. }]
+        ));
+    }
+
+    /// W2-06: a `supervisor_*` journal event that no supervisor transaction
+    /// produced is audited exactly once and changes no goal state.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn unattested_supervisor_event_is_audited_once_and_changes_nothing() {
+        let (_dir, store, project, root) = fixture().await;
+        supervise(&store, &project).await.unwrap();
+        let forged = json!({"version":1,"rootGoalId":root,"reason":"deadline_exhausted","checkpointSource":"continuous_supervisor_blocks"});
+        let (cursor,): (i64,) = sqlx::query_as("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'supervisor_blocked',?,1) RETURNING cursor")
+            .bind(&project).bind(forged.to_string()).fetch_one(&store.pool).await.unwrap();
+        let done = store
+            .supervise_project(&AUTHORITY, &project, None)
+            .await
+            .unwrap();
+        assert_eq!(done.result["blockedRoots"], json!([]));
+        assert_eq!(done.notices.len(), 1, "{:?}", done.notices);
+        assert!(matches!(
+            &done.notices[0],
+            SupervisorNotice::Audit { finding, event_cursor, .. }
+                if finding == "unattested_supervisor_event" && *event_cursor == cursor
+        ));
+        let audits = journal(&store, &project, "supervisor_audit").await;
+        assert_eq!(audits.len(), 1);
+        assert_eq!(audits[0].1["eventCursor"], cursor);
+        assert_eq!(audits[0].1["producer"], "policy_supervisor");
+        let (status,): (String,) = sqlx::query_as("SELECT status FROM continuous_goals WHERE id=?")
+            .bind(&root)
+            .fetch_one(&store.pool)
+            .await
+            .unwrap();
+        assert_eq!(status, "open");
+        let again = store
+            .supervise_project(&AUTHORITY, &project, None)
+            .await
+            .unwrap();
+        assert_eq!(again.notices, vec![]);
+        assert_eq!(journal(&store, &project, "supervisor_audit").await.len(), 1);
+    }
+
+    /// W2-06: the supervisor's own events are attested on the next pass.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn own_supervisor_events_are_attested() {
+        let (_dir, store, project, root) = fixture().await;
+        store
+            .supervisor_error(&AUTHORITY, &project, "transient")
+            .await
+            .unwrap();
+        expire(&store, &root).await;
+        supervise(&store, &project).await.unwrap();
+        let next = store
+            .supervise_project(&AUTHORITY, &project, None)
+            .await
+            .unwrap();
+        assert_eq!(next.notices, vec![]);
+        assert_eq!(journal(&store, &project, "supervisor_audit").await, vec![]);
+    }
+
+    /// W2-06: every block names who blocked the root and with what authority.
+    /// A goal blocked by another producer (token settlement) is recorded as
+    /// unattested rather than credited to the supervisor.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn blocks_record_producer_and_authority() {
+        // One unresolved root per project, so each case gets its own fixture.
+        async fn blocked_by(external: bool) -> (Value, Vec<(i64, Value)>) {
+            let (_dir, store, project, root) = fixture().await;
+            let change = if external {
+                "UPDATE continuous_goals SET status='blocked' WHERE id=?"
+            } else {
+                "UPDATE continuous_goals SET deadline_at=1 WHERE id=?"
+            };
+            sqlx::query(change)
+                .bind(&root)
+                .execute(&store.pool)
+                .await
+                .unwrap();
+            supervise(&store, &project).await.unwrap();
+            let mut tx = store.pool.begin().await.unwrap();
+            let snapshot = context(&mut tx, &project).await.unwrap();
+            tx.rollback().await.unwrap();
+            let events = journal(&store, &project, "supervisor_blocked").await;
+            (snapshot["blocks"][0]["blockedBy"].clone(), events)
+        }
+        let (own, own_events) = blocked_by(false).await;
+        assert_eq!(
+            own,
+            json!({"producer":"policy_supervisor","authority":"frozen_root_policy"})
+        );
+        let (external, external_events) = blocked_by(true).await;
+        assert_eq!(external, json!({"producer":"unattested","authority":null}));
+        for events in [own_events, external_events] {
+            assert_eq!(events.len(), 1);
+            assert_eq!(events[0].1["producer"], "policy_supervisor");
+            assert!(events[0].1["authority"].is_string());
+        }
+    }
+
+    /// W2-06: the background task hands committed notices to its notifier.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn background_supervisor_delivers_one_notice_per_block() {
+        let (_dir, store, project, root) = fixture().await;
+        expire(&store, &root).await;
+        let seen = Arc::new(Mutex::new(Vec::<SupervisorNotice>::new()));
+        let sink = seen.clone();
+        let guard = start(
+            store.clone(),
+            Some(Arc::new(move |notice: &SupervisorNotice| {
+                sink.lock().unwrap().push(notice.clone())
+            })),
+        )
+        .await;
+        tokio::time::timeout(Duration::from_secs(10), async {
+            while seen.lock().unwrap().is_empty() {
+                tokio::time::sleep(Duration::from_millis(20)).await;
+            }
+        })
+        .await
+        .unwrap();
+        tokio::time::sleep(Duration::from_millis(300)).await;
+        drop(guard);
+        let seen = seen.lock().unwrap().clone();
+        assert_eq!(seen.len(), 1, "{seen:?}");
+        assert!(matches!(
+            &seen[0],
+            SupervisorNotice::Blocked { project_id, .. } if project_id == &project
+        ));
+        store.pool.close().await;
+    }
 }
diff --git a/src/lib/ipc.ts b/src/lib/ipc.ts
index 707c59a..2996853 100644
--- a/src/lib/ipc.ts
+++ b/src/lib/ipc.ts
@@ -2207,6 +2207,32 @@ export function onWorkerStatus(
   });
 }
 
+/**
+ * W2-06: one committed change of the continuous policy supervisor. Ids and
+ * fixed reason codes only; details (error text, checkpoints) stay behind the
+ * authorized project context read.
+ */
+export type SupervisorNotification =
+  | { kind: "blocked"; projectId: string; rootGoalId: string; reason: string; observedAt: number }
+  | { kind: "degraded"; projectId: string; observedAt: number }
+  | { kind: "recovered"; projectId: string; observedAt: number }
+  | {
+      kind: "audit";
+      projectId: string;
+      finding: string;
+      eventCursor: number;
+      observedAt: number;
+    };
+
+/** Fires once per supervisor state change (block, degraded/recovered health, audit finding). */
+export function onSupervisorNotification(
+  handler: (payload: SupervisorNotification) => void,
+): Promise<UnlistenFn> {
+  return listen<SupervisorNotification>("supervisor:notification", (event) =>
+    handler(event.payload),
+  );
+}
+
 /**
  * Hands a URL to the OS through the opener plugin (registered in main.rs,
  * scoped to http(s) in capabilities/default.json - see
```
