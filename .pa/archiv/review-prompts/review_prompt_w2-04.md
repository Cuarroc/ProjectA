# Review request W2-04: role dispatch (ProjectA, Tauri 2, Rust + SQLite)

You are an independent code reviewer from a different model vendor than the
author (Claude Code). Review the diff below for correctness and security
bugs. Report findings as a numbered list, each with: severity
(high/medium/low), file:line, what is wrong, a concrete failing scenario, and a
suggested fix. Say explicitly if you find nothing blocking. Do not restate the
diff.

## Task (docs/PLAN.md, W2-04)
"Role dispatch · M · `supervisor.rs`, `store/development_launches.rs` ·
actually execute coordinator/worker/reviewer/integrator from the migration-14
assignments." Migration 14 added `continuous_team_assignments(task_id PK,
team_id, role IN (coordinator, implementer, reviewer, integrator), assignee,
revision, ...)`. Until now the assignment was only checked at claim time
(`team_assignments::check_claim`: assignee == claim owner, team/role permitted
by the frozen root policy, integrator capacity) and then ignored by the launch
path. `startsWorkers` / continuous activation stay behind their existing gates;
there is no production scheduler that calls `launch_worker` yet.

## Design of this slice
- `store/development_launches.rs`: `DispatchRole` enum and
  `run_role(conn, run_id)`. It joins run -> task -> goal -> root policy ->
  assignment. No assignment => `Implementer` (the pre-W2-04 meaning).
  Assignment present => the assignee must equal the run's `claim_owner`, and
  the frozen root policy must list the team with that role; otherwise an
  error. `Store::development_run_role` exposes it to trusted services.
- `reserve_development_launch` and `consume_development_launch` call
  `run_role` inside their writer transaction, after `require_admission`, so an
  assignment that does not authorize the owner yields no reservation and no
  process.
- `workers/development.rs::bind_candidate` (only production caller: the scoped
  agent API via main.rs) refuses reviewer and coordinator runs; implementer and
  integrator runs may submit integration candidates.
- `store/supervisor.rs`: the block checkpoint JSON gains `dispatchRole` per
  task (COALESCE(assignment.role, 'implementer')).
- No schema change. Rationale: `assign_continuous_task` refuses any change once
  the task has been claimed (`status='open' AND claim_owner IS NULL AND
  attempts=0`), so the role of an existing run is immutable and deriving it on
  read cannot drift.

## Deliberately out of scope (follow-ups)
- W2-01 follow-up: require the reviewer run's dispatch role == reviewer for a
  `verified:` review attestation (lives in `store/development_runs.rs`, which a
  parallel package owns right now).
- Role-aware route/provider selection (e.g. reviewer vendor != implementer
  vendor at launch), role -> token budget purpose, briefing field
  `dispatch.role`, coordinator-only planning endpoints, automatic dispatch.

## Questions for you
1. Can a run obtain a launch or submit a candidate in a role the assignment
   does not grant (races, NULL handling in the LEFT JOINs, legacy rows)?
2. Is the "immutable after first claim" argument sound, i.e. is it safe not to
   persist the role on the launch row?
3. Is defaulting unassigned tasks to implementer correct or a privilege gap?
4. Anything in the tests that proves less than it claims?

## Diff vs origin/main
```diff
diff --git a/src-tauri/src/store/development_launches.rs b/src-tauri/src/store/development_launches.rs
index 93f54fa..b1e472c 100644
--- a/src-tauri/src/store/development_launches.rs
+++ b/src-tauri/src/store/development_launches.rs
@@ -1,8 +1,89 @@
 //! Durable identity and single-use authorization before worktree/process creation.
 //! Existing reservations are never returned as permission to start again.
 use super::{new_id, now_unix_secs, Store};
+use crate::development_policy::DevelopmentPolicy;
 use serde::Serialize;
-use sqlx::{FromRow, Sqlite, Transaction};
+use sqlx::{FromRow, Sqlite, SqliteConnection, Transaction};
+
+/// The team role a run is dispatched in (W2-04). It is derived from the
+/// migration-14 assignment, which `team_assignments` locks at the first claim,
+/// so the role of a run cannot change after it exists and needs no second copy.
+#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
+#[serde(rename_all = "lowercase")]
+pub enum DispatchRole {
+    Coordinator,
+    Implementer,
+    Reviewer,
+    Integrator,
+}
+
+impl DispatchRole {
+    pub fn as_str(self) -> &'static str {
+        match self {
+            Self::Coordinator => "coordinator",
+            Self::Implementer => "implementer",
+            Self::Reviewer => "reviewer",
+            Self::Integrator => "integrator",
+        }
+    }
+
+    fn parse(value: &str) -> Result<Self, String> {
+        match value {
+            "coordinator" => Ok(Self::Coordinator),
+            "implementer" => Ok(Self::Implementer),
+            "reviewer" => Ok(Self::Reviewer),
+            "integrator" => Ok(Self::Integrator),
+            other => Err(format!("unknown dispatch role: {other}")),
+        }
+    }
+
+    /// Only roles that change the tree submit an integration candidate.
+    pub fn submits_candidate(self) -> bool {
+        matches!(self, Self::Implementer | Self::Integrator)
+    }
+}
+
+type RunRoleRow = (
+    String,
+    Option<String>,
+    Option<String>,
+    Option<String>,
+    Option<String>,
+);
+
+/// Resolves and re-validates the dispatch role of a run. Unassigned tasks keep
+/// their pre-W2-04 meaning and dispatch as implementers. An assignment whose
+/// assignee is not the run owner, or whose team/role the frozen root policy
+/// does not permit, authorizes nothing.
+pub(super) async fn run_role(
+    conn: &mut SqliteConnection,
+    run_id: &str,
+) -> Result<DispatchRole, String> {
+    let row: Option<RunRoleRow> = sqlx::query_as("SELECT r.claim_owner, a.team_id, a.role, a.assignee, p.policy_json FROM development_runs r JOIN continuous_tasks t ON t.id = r.task_id JOIN continuous_goals g ON g.id = t.goal_id LEFT JOIN continuous_root_policies p ON p.root_goal_id = g.root_goal_id LEFT JOIN continuous_team_assignments a ON a.task_id = t.id WHERE r.id = ?")
+        .bind(run_id).fetch_optional(&mut *conn).await.map_err(db)?;
+    let Some((owner, team, role, assignee, policy)) = row else {
+        return Err("unknown development run".into());
+    };
+    let (Some(team), Some(role), Some(assignee)) = (team, role, assignee) else {
+        return Ok(DispatchRole::Implementer);
+    };
+    let dispatch = DispatchRole::parse(&role)?;
+    if assignee != owner {
+        return Err(format!(
+            "development run owner is not the assigned {}",
+            dispatch.as_str()
+        ));
+    }
+    let policy = DevelopmentPolicy::parse(&policy.ok_or("dispatch root policy unavailable")?)?;
+    if !policy
+        .teams
+        .iter()
+        .any(|entry| entry.id == team && entry.roles.contains(&role))
+    {
+        return Err("team assignment conflicts with frozen root policy".into());
+    }
+    Ok(dispatch)
+}
 
 #[derive(Debug, Clone, Serialize, FromRow)]
 #[serde(rename_all = "camelCase")]
@@ -126,6 +207,7 @@ impl Store {
             return Err("stale or unauthorized development launch claim".into());
         }
         require_admission(&mut tx, run_id).await?;
+        run_role(&mut tx, run_id).await?;
         let (project_id, repo_path): (String, String) = sqlx::query_as("SELECT p.id, p.repo_path FROM development_runs r JOIN continuous_tasks t ON t.id = r.task_id JOIN continuous_goals g ON g.id = t.goal_id JOIN projects p ON p.id = g.project_id WHERE r.id = ?")
             .bind(run_id).fetch_one(&mut *tx).await.map_err(db)?;
         let worker_id = new_id("wk");
@@ -174,6 +256,7 @@ impl Store {
             .await
             .map_err(db)?;
         require_admission(&mut tx, run_id).await?;
+        run_role(&mut tx, run_id).await?;
         let receipt: Option<(Option<String>, Option<i64>)> = sqlx::query_as(
             "SELECT route_json, route_expires_at FROM development_launches WHERE run_id = ?",
         )
@@ -205,6 +288,13 @@ impl Store {
         Ok(())
     }
 
+    /// Trusted services ask this before acting on a run's behalf; the role is
+    /// never taken from worker input.
+    pub async fn development_run_role(&self, run_id: &str) -> Result<DispatchRole, String> {
+        let mut conn = self.pool.acquire().await.map_err(db)?;
+        run_role(&mut conn, run_id).await
+    }
+
     pub async fn development_launch(
         &self,
         run_id: &str,
@@ -781,6 +871,54 @@ pub(super) mod tests {
         assert_eq!(after.state, "spawning");
     }
 
+    /// W2-04: the team assignment decides who may be dispatched. A run whose
+    /// owner is not the assignee, or whose role the frozen root policy does
+    /// not permit, gets no launch reservation, whatever the claim table says.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn role_dispatch_refuses_launches_the_assignment_does_not_authorize() {
+        let (_dir, store, run) = fixture().await;
+        sqlx::query("INSERT INTO continuous_team_assignments(task_id,team_id,role,assignee,revision,policy_version,observed_at) VALUES('task','development','implementer','someone-else',1,1,1)")
+            .execute(&store.pool).await.unwrap();
+        let foreign = store
+            .reserve_development_launch(&run, "owner", 1, "codex")
+            .await;
+        assert!(
+            foreign
+                .as_ref()
+                .is_err_and(|error| error.contains("assigned")),
+            "owner outside the assignment must not be dispatched: {foreign:?}"
+        );
+        let mut narrow = DevelopmentPolicy::defaults();
+        narrow.teams[0].roles = vec!["implementer".into()];
+        sqlx::query("UPDATE continuous_root_policies SET policy_json=? WHERE root_goal_id='goal'")
+            .bind(serde_json::to_string(&narrow).unwrap())
+            .execute(&store.pool)
+            .await
+            .unwrap();
+        sqlx::query("UPDATE continuous_team_assignments SET role='reviewer',assignee='owner' WHERE task_id='task'")
+            .execute(&store.pool).await.unwrap();
+        let unpermitted = store
+            .reserve_development_launch(&run, "owner", 1, "codex")
+            .await;
+        assert!(
+            unpermitted
+                .as_ref()
+                .is_err_and(|error| error.contains("frozen root policy")),
+            "a role outside the frozen policy must not be dispatched: {unpermitted:?}"
+        );
+        assert!(store.development_launch(&run).await.unwrap().is_none());
+        sqlx::query(
+            "UPDATE continuous_team_assignments SET role='implementer' WHERE task_id='task'",
+        )
+        .execute(&store.pool)
+        .await
+        .unwrap();
+        store
+            .reserve_development_launch(&run, "owner", 1, "codex")
+            .await
+            .unwrap();
+    }
+
     #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
     async fn stale_fences_and_foreign_workers_cannot_consume_reservations() {
         let (_dir, store, run) = fixture().await;
diff --git a/src-tauri/src/store/supervisor.rs b/src-tauri/src/store/supervisor.rs
index 1a0c14b..8ac3946 100644
--- a/src-tauri/src/store/supervisor.rs
+++ b/src-tauri/src/store/supervisor.rs
@@ -6,7 +6,15 @@ use sqlx::{Sqlite, Transaction};
 use std::time::Duration;
 
 type ObservationRow = (i64, Option<i64>, Option<String>, Option<i64>, i64);
-type TaskCheckpointRow = (String, String, Option<String>, i64, i64, Option<i64>);
+type TaskCheckpointRow = (
+    String,
+    String,
+    Option<String>,
+    i64,
+    i64,
+    Option<i64>,
+    String,
+);
 type RunCheckpointRow = (String, String, String, Option<String>, Option<i64>);
 
 pub(crate) struct PolicySupervisor {
@@ -248,13 +256,14 @@ async fn checkpoint(
     now: i64,
     tokens: &super::development_budget::TokenBalance,
 ) -> Result<Value, String> {
-    let tasks:Vec<TaskCheckpointRow>=sqlx::query_as("SELECT t.id,t.status,t.claim_owner,t.claim_fence,t.attempts,(SELECT MAX(revision) FROM development_checkpoints c WHERE c.task_id=t.id) FROM continuous_tasks t JOIN continuous_goals g ON g.id=t.goal_id WHERE g.project_id=? AND g.root_goal_id=? ORDER BY t.created_at,t.id LIMIT 64")
+    let tasks:Vec<TaskCheckpointRow>=sqlx::query_as("SELECT t.id,t.status,t.claim_owner,t.claim_fence,t.attempts,(SELECT MAX(revision) FROM development_checkpoints c WHERE c.task_id=t.id),COALESCE((SELECT a.role FROM continuous_team_assignments a WHERE a.task_id=t.id),'implementer') FROM continuous_tasks t JOIN continuous_goals g ON g.id=t.goal_id WHERE g.project_id=? AND g.root_goal_id=? ORDER BY t.created_at,t.id LIMIT 64")
         .bind(project).bind(root).fetch_all(&mut **tx).await.map_err(db)?;
     let (total_tasks,):(i64,)=sqlx::query_as("SELECT COUNT(*) FROM continuous_tasks t JOIN continuous_goals g ON g.id=t.goal_id WHERE g.project_id=? AND g.root_goal_id=?")
         .bind(project).bind(root).fetch_one(&mut **tx).await.map_err(db)?;
-    let tasks:Vec<Value>=tasks.into_iter().map(|(id,status,owner,fence,attempts,revision)| {
+    // W2-04: unassigned tasks dispatch as implementers, as at the launch boundary.
+    let tasks:Vec<Value>=tasks.into_iter().map(|(id,status,owner,fence,attempts,revision,role)| {
         let (owner, truncated) = bounded_reference(owner);
-        json!({"taskId":id,"status":status,"claimOwner":owner,"claimOwnerTruncated":truncated,"claimFence":fence,"attempts":attempts,"checkpointRevision":revision})
+        json!({"taskId":id,"status":status,"claimOwner":owner,"claimOwnerTruncated":truncated,"claimFence":fence,"attempts":attempts,"checkpointRevision":revision,"dispatchRole":role})
     }).collect();
     let runs:Vec<RunCheckpointRow>=sqlx::query_as("SELECT r.id,r.task_id,r.status,r.worker_id,r.process_id FROM development_runs r JOIN continuous_tasks t ON t.id=r.task_id JOIN continuous_goals g ON g.id=t.goal_id WHERE g.project_id=? AND g.root_goal_id=? ORDER BY r.created_at,r.id LIMIT 128")
         .bind(project).bind(root).fetch_all(&mut **tx).await.map_err(db)?;
@@ -387,6 +396,57 @@ mod tests {
         assert_eq!(stored, owner);
     }
 
+    /// W2-04: a blocked root's checkpoint names the dispatch role of every
+    /// task, so reconciliation retries a reviewer as a reviewer. Unassigned
+    /// tasks dispatch as implementers, exactly like the launch boundary.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn checkpoint_records_the_dispatch_role_of_each_task() {
+        let (_dir, store, project, root) = fixture().await;
+        let reviewed = store
+            .create_continuous_task(&root, "review", None, vec!["src/a.rs".into()], vec![])
+            .await
+            .unwrap();
+        store
+            .create_continuous_task(&root, "implement", None, vec!["src/b.rs".into()], vec![])
+            .await
+            .unwrap();
+        store
+            .assign_continuous_task(
+                &reviewed.id,
+                crate::store::team_assignments::AssignmentRequest {
+                    team_id: "development".into(),
+                    role: "reviewer".into(),
+                    assignee: "carol".into(),
+                    expected_revision: 0,
+                },
+            )
+            .await
+            .unwrap();
+        sqlx::query("UPDATE continuous_goals SET deadline_at=1 WHERE id=?")
+            .bind(&root)
+            .execute(&store.pool)
+            .await
+            .unwrap();
+        store.supervise_continuous_project(&project).await.unwrap();
+        let mut tx = store.pool.begin().await.unwrap();
+        let snapshot = context(&mut tx, &project).await.unwrap();
+        let tasks = snapshot["blocks"][0]["tasks"].as_array().unwrap();
+        let role = |objective_task: &str| {
+            tasks
+                .iter()
+                .find(|task| task["taskId"] == objective_task)
+                .map(|task| task["dispatchRole"].clone())
+        };
+        assert_eq!(role(&reviewed.id), Some(json!("reviewer")));
+        assert_eq!(
+            tasks
+                .iter()
+                .filter(|task| task["dispatchRole"] == "implementer")
+                .count(),
+            1
+        );
+    }
+
     #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
     async fn racing_supervisors_commit_one_checkpoint() {
         let (_dir, store, project, root) = fixture().await;
diff --git a/src-tauri/src/workers.rs b/src-tauri/src/workers.rs
index 63f385e..23b3c4c 100644
--- a/src-tauri/src/workers.rs
+++ b/src-tauri/src/workers.rs
@@ -3438,6 +3438,108 @@ mod tests {
         assert_eq!(after["candidate"]["candidateCommit"], accepted);
     }
 
+    /// W2-04: the dispatched role drives what a run may do. Reviewers and
+    /// coordinators never submit integration candidates; implementers and
+    /// integrators do, for the same owned, backend-observed commit.
+    #[tokio::test]
+    async fn dispatch_role_decides_who_may_submit_an_integration_candidate() {
+        let fx = fixture("candidate-role").await;
+        let launch = reserved_launch(&fx).await;
+        let route = development_route::test_route(profiles::find_profile("claude").unwrap());
+        let descriptor = fx._dir.path().join("descriptor.json");
+        let context = development::LaunchContext {
+            run_id: &launch.run_id,
+            owner: "owner",
+            fence: 1,
+            worker_id: &launch.worker_id,
+            descriptor: &descriptor,
+            bind_credentials: &|_| Ok(()),
+            route: &route,
+        };
+        create_worker_impl(
+            &fx.store,
+            &FakeAgents::default(),
+            &fx.project_id,
+            "owned scope",
+            "claude",
+            None,
+            None,
+            Some(&context),
+        )
+        .await
+        .unwrap();
+        let path = Path::new(&launch.worktree_path);
+        let git = |args: &[&str]| {
+            let output = crate::proc::command("git")
+                .arg("-C")
+                .arg(path)
+                .args(args)
+                .output()
+                .unwrap();
+            assert!(
+                output.status.success(),
+                "{}",
+                String::from_utf8_lossy(&output.stderr)
+            );
+            String::from_utf8(output.stdout).unwrap().trim().to_string()
+        };
+        std::fs::create_dir_all(path.join("src")).unwrap();
+        std::fs::write(path.join("src/owned.rs"), "owned").unwrap();
+        git(&["add", "--", "src/owned.rs"]);
+        git(&[
+            "-c",
+            "core.hooksPath=",
+            "commit",
+            "--no-gpg-sign",
+            "-m",
+            "owned",
+        ]);
+        let commit = git(&["rev-parse", "HEAD"]);
+        let input = || crate::api::CandidateInput {
+            candidate_commit: commit.clone(),
+            source: "agent assertion".into(),
+            observed_at: 1,
+        };
+        let pool = sqlx::SqlitePool::connect(&format!(
+            "sqlite:{}",
+            fx._dir.path().join("projecta.db").display()
+        ))
+        .await
+        .unwrap();
+        sqlx::query("INSERT INTO continuous_team_assignments(task_id,team_id,role,assignee,revision,policy_version,observed_at) VALUES('task','development','reviewer','owner',1,1,1)")
+            .execute(&pool).await.unwrap();
+        for role in ["reviewer", "coordinator"] {
+            sqlx::query("UPDATE continuous_team_assignments SET role=? WHERE task_id='task'")
+                .bind(role)
+                .execute(&pool)
+                .await
+                .unwrap();
+            let refused =
+                development::bind_candidate(&fx.store, &launch.run_id, "owner", 1, input()).await;
+            assert!(
+                refused.as_ref().is_err_and(|error| error.contains(role)),
+                "a {role} run must not submit an integration candidate: {refused:?}"
+            );
+        }
+        let before = fx
+            .store
+            .agent_run_context(&launch.run_id, "owner", 1)
+            .await
+            .unwrap();
+        assert!(before["candidate"].is_null());
+        sqlx::query(
+            "UPDATE continuous_team_assignments SET role='integrator' WHERE task_id='task'",
+        )
+        .execute(&pool)
+        .await
+        .unwrap();
+        pool.close().await;
+        let binding = development::bind_candidate(&fx.store, &launch.run_id, "owner", 1, input())
+            .await
+            .unwrap();
+        assert_eq!(binding.candidate_commit, commit);
+    }
+
     #[tokio::test]
     async fn development_candidate_requires_backend_observed_worktree() {
         let fx = fixture("candidate-unlaunched").await;
diff --git a/src-tauri/src/workers/development.rs b/src-tauri/src/workers/development.rs
index fd5cbaa..5023df1 100644
--- a/src-tauri/src/workers/development.rs
+++ b/src-tauri/src/workers/development.rs
@@ -27,6 +27,15 @@ pub async fn bind_candidate(
     // Authenticate before touching paths. The transactional store write below
     // checks the fence again after Git; no SQL connection is held by the probe.
     let context = store.agent_run_context(run, owner, fence).await?;
+    // W2-04: the dispatched team role, not the caller, decides whether this
+    // run produces candidates. Reviewers and coordinators never do.
+    let role = store.development_run_role(run).await?;
+    if !role.submits_candidate() {
+        return Err(format!(
+            "candidate refused: a {} run does not submit integration candidates",
+            role.as_str()
+        ));
+    }
     let launch = store
         .development_launch(run)
         .await?
```
[INFO] Recording command outcome: git

[OK] Command outcome recorded
```
