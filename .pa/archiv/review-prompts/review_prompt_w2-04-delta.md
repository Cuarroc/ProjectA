# Delta review W2-04: role dispatch (ProjectA, Tauri 2, Rust + SQLite)

You reviewed the first round of this package (role dispatch derived from the
migration-14 team assignment: launch reservation/consumption check the role,
`bind_candidate` refuses reviewer/coordinator runs, supervisor checkpoints name
the dispatch role). This is the delta after that review. Check that the
accepted findings are fixed correctly and that the delta introduces no new
bug. Report numbered findings with severity, file:line, failing scenario and
fix; say explicitly if nothing is blocking.

## Dispositions of round 1 (full text below the diff)
- K1 accepted: an unassigned task dispatches as implementer only while some
  team of the frozen root policy permits `implementer`; checked at reservation
  and pre-spawn consumption. New red-first test.
- K2/G1 accepted: partial assignment row now fails closed (schema already
  NOT NULL, so untestable without breaking the schema).
- K3/G3: documented invariant; moving the check into the candidate write
  transaction is a follow-up (that file belongs to a parallel package).
- K4/G5, K5, K7/G2 rejected with evidence (existing immutability tests,
  `claim_owner NOT NULL`, `continuous_root_policies.root_goal_id` PRIMARY KEY
  with a single admission INSERT).
- K6 accepted as documentation; K8/G4 partly accepted (delta test covers
  consume path; unassigned candidate path already covered by
  `development_candidate_service_binds_only_owned_worktree_changes`).

Note: the default-implementer check now also requires a root policy row for
unassigned runs ("dispatch root policy unavailable" otherwise). Every run
records `policy_json` from its root at intent time, and admission requires
the root policy; say if you see a path where that breaks a legitimate launch.

## Delta diff (160a562..80fe4e0)
```diff
diff --git a/src-tauri/src/store/development_launches.rs b/src-tauri/src/store/development_launches.rs
index b1e472c..078e552 100644
--- a/src-tauri/src/store/development_launches.rs
+++ b/src-tauri/src/store/development_launches.rs
@@ -52,9 +52,17 @@ type RunRoleRow = (
 );
 
 /// Resolves and re-validates the dispatch role of a run. Unassigned tasks keep
-/// their pre-W2-04 meaning and dispatch as implementers. An assignment whose
+/// their pre-W2-04 meaning and dispatch as implementers, but only while some
+/// team of the frozen root policy permits that role. An assignment whose
 /// assignee is not the run owner, or whose team/role the frozen root policy
-/// does not permit, authorizes nothing.
+/// does not permit, authorizes nothing; a partial assignment row fails closed.
+///
+/// Invariant this relies on instead of a persisted copy: the only writer of
+/// `continuous_team_assignments` is `Store::assign_continuous_task`, which
+/// refuses once a task was claimed (`attempts != 0`; nothing resets attempts),
+/// see `team_assignments::tests::
+/// assignment_enforces_owner_and_survives_restart_without_reassigning_live_work`.
+/// `continuous_root_policies` is keyed by root and written once at admission.
 pub(super) async fn run_role(
     conn: &mut SqliteConnection,
     run_id: &str,
@@ -64,8 +72,21 @@ pub(super) async fn run_role(
     let Some((owner, team, role, assignee, policy)) = row else {
         return Err("unknown development run".into());
     };
-    let (Some(team), Some(role), Some(assignee)) = (team, role, assignee) else {
-        return Ok(DispatchRole::Implementer);
+    let policy = DevelopmentPolicy::parse(&policy.ok_or("dispatch root policy unavailable")?)?;
+    let permitted = |team: Option<&str>, role: &str| {
+        policy.teams.iter().any(|entry| {
+            team.is_none_or(|team| entry.id == team) && entry.roles.iter().any(|r| r == role)
+        })
+    };
+    let (team, role, assignee) = match (team, role, assignee) {
+        (None, None, None) => {
+            if !permitted(None, DispatchRole::Implementer.as_str()) {
+                return Err("unassigned task dispatches as implementer, which the frozen root policy does not permit".into());
+            }
+            return Ok(DispatchRole::Implementer);
+        }
+        (Some(team), Some(role), Some(assignee)) => (team, role, assignee),
+        _ => return Err("malformed team assignment row".into()),
     };
     let dispatch = DispatchRole::parse(&role)?;
     if assignee != owner {
@@ -74,12 +95,7 @@ pub(super) async fn run_role(
             dispatch.as_str()
         ));
     }
-    let policy = DevelopmentPolicy::parse(&policy.ok_or("dispatch root policy unavailable")?)?;
-    if !policy
-        .teams
-        .iter()
-        .any(|entry| entry.id == team && entry.roles.contains(&role))
-    {
+    if !permitted(Some(&team), &role) {
         return Err("team assignment conflicts with frozen root policy".into());
     }
     Ok(dispatch)
@@ -919,6 +935,39 @@ pub(super) mod tests {
             .unwrap();
     }
 
+    /// W2-04 review delta: the implicit implementer role of an unassigned task
+    /// is still a role the frozen root policy must permit, and the pre-spawn
+    /// consumption re-checks it like the reservation does.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn unassigned_dispatch_needs_an_implementer_role_up_to_the_spawn() {
+        let (_dir, store, run) = fixture().await;
+        let launch = store
+            .reserve_development_launch(&run, "owner", 1, "codex")
+            .await
+            .unwrap();
+        bind_test_route(&store, &run).await;
+        let mut review_only = DevelopmentPolicy::defaults();
+        review_only.teams[0].roles = vec!["reviewer".into()];
+        sqlx::query("UPDATE continuous_root_policies SET policy_json=? WHERE root_goal_id='goal'")
+            .bind(serde_json::to_string(&review_only).unwrap())
+            .execute(&store.pool)
+            .await
+            .unwrap();
+        let consumed = store
+            .consume_development_launch(&run, "owner", 1, &launch.worker_id, "session")
+            .await;
+        assert!(
+            consumed
+                .as_ref()
+                .is_err_and(|error| error.contains("does not permit")),
+            "an implementer the policy does not permit must not spawn: {consumed:?}"
+        );
+        assert_eq!(
+            store.development_launch(&run).await.unwrap().unwrap().state,
+            "reserved"
+        );
+    }
+
     #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
     async fn stale_fences_and_foreign_workers_cannot_consume_reservations() {
         let (_dir, store, run) = fixture().await;
diff --git a/src-tauri/src/store/supervisor.rs b/src-tauri/src/store/supervisor.rs
index 8ac3946..e90cd3e 100644
--- a/src-tauri/src/store/supervisor.rs
+++ b/src-tauri/src/store/supervisor.rs
@@ -260,7 +260,9 @@ async fn checkpoint(
         .bind(project).bind(root).fetch_all(&mut **tx).await.map_err(db)?;
     let (total_tasks,):(i64,)=sqlx::query_as("SELECT COUNT(*) FROM continuous_tasks t JOIN continuous_goals g ON g.id=t.goal_id WHERE g.project_id=? AND g.root_goal_id=?")
         .bind(project).bind(root).fetch_one(&mut **tx).await.map_err(db)?;
-    // W2-04: unassigned tasks dispatch as implementers, as at the launch boundary.
+    // W2-04: the role the task is assigned to dispatch in (unassigned tasks
+    // default to implementer). This is intent, not authority: the launch
+    // boundary (`development_launches::run_role`) re-validates owner and policy.
     let tasks:Vec<Value>=tasks.into_iter().map(|(id,status,owner,fence,attempts,revision,role)| {
         let (owner, truncated) = bounded_reference(owner);
         json!({"taskId":id,"status":status,"claimOwner":owner,"claimOwnerTruncated":truncated,"claimFence":fence,"attempts":attempts,"checkpointRevision":revision,"dispatchRole":role})
@@ -396,9 +398,10 @@ mod tests {
         assert_eq!(stored, owner);
     }
 
-    /// W2-04: a blocked root's checkpoint names the dispatch role of every
-    /// task, so reconciliation retries a reviewer as a reviewer. Unassigned
-    /// tasks dispatch as implementers, exactly like the launch boundary.
+    /// W2-04: a blocked root's checkpoint names the assigned dispatch role of
+    /// every task, so whoever reconciles it sees which tasks are review or
+    /// integration work. Unassigned tasks default to implementer, like the
+    /// launch boundary. (Nothing consumes the field automatically yet.)
     #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
     async fn checkpoint_records_the_dispatch_role_of_each_task() {
         let (_dir, store, project, root) = fixture().await;
diff --git a/src-tauri/src/workers/development.rs b/src-tauri/src/workers/development.rs
index 5023df1..07d2bd8 100644
--- a/src-tauri/src/workers/development.rs
+++ b/src-tauri/src/workers/development.rs
@@ -28,7 +28,10 @@ pub async fn bind_candidate(
     // checks the fence again after Git; no SQL connection is held by the probe.
     let context = store.agent_run_context(run, owner, fence).await?;
     // W2-04: the dispatched team role, not the caller, decides whether this
-    // run produces candidates. Reviewers and coordinators never do.
+    // run produces candidates. Reviewers and coordinators never do. Checked
+    // outside the candidate write transaction: the role of a claimed run is
+    // immutable (see `run_role`); moving the check into
+    // `bind_development_run_candidate` is a follow-up for the store lane.
     let role = store.development_run_role(run).await?;
     if !role.submits_candidate() {
         return Err(format!(
```

## Disposition file

# Disposition W2-04 role dispatch

Reviews: `.pa/review_w2-04_kimi-k3.md`, `.pa/review_w2-04_glm-5.2.md`
(prompt `.pa/review_prompt_w2-04.md`). Both verdicts: nothing blocking.

| # | Finding | Disposition |
|---|---------|-------------|
| K1 | Unassigned task dispatches as implementer without consulting the frozen policy | **Accepted.** `run_role` now requires some team of the frozen root policy to permit `implementer` for the implicit default. Red `unassigned_dispatch_needs_an_implementer_role_up_to_the_spawn`, then fix. |
| K2 / G1 | Partial-NULL assignment row falls through to implementer | **Accepted (defense in depth).** Migration 14 declares `team_id`, `role`, `assignee` NOT NULL (`team_assignments.rs` `apply_migration`), so the row cannot exist today; `run_role` now distinguishes "no row" (all NULL) from a partial row and fails closed with "malformed team assignment row". Not testable without breaking the schema; no test. |
| K3 / G3 | `bind_candidate` role check outside the candidate write transaction | **Accepted as documentation, fix deferred.** The role of a claimed run is immutable (only writer `assign_continuous_task` refuses after the first claim; nothing resets `attempts`). Moving the check into `bind_development_run_candidate` touches `store/development_runs.rs`, owned by the parallel W2-02 package. Invariant documented at `run_role` and at the call site; follow-up listed. |
| K4 / G5 | Immutability invariant not asserted by the new tests | **Rejected with evidence.** Already covered by `team_assignments::tests::assignment_enforces_owner_and_survives_restart_without_reassigning_live_work` (reassign after claim errors) and `assignment_and_claim_race_cannot_transfer_claimed_work`. Cross-referenced in the `run_role` doc comment. The raw-SQL mutations in the new tests deliberately simulate out-of-band state to prove the launch boundary fails closed. |
| K5 | `claim_owner` decoded as non-null String | **Rejected with evidence.** `development_runs.claim_owner TEXT NOT NULL` (`development_runs.rs` table DDL). |
| K6 | Checkpoint `dispatchRole` is raw assignment, not validated dispatch | **Accepted as documentation.** Comment now states it is the assigned role (intent), re-validated at the launch boundary; the test doc no longer claims reconciliation consumes it. |
| K7 / G2 | Policy version ignored; several policy rows per root | **Rejected with evidence.** `continuous_root_policies.root_goal_id` is the PRIMARY KEY and the only production writer is the admission INSERT (`continuous.rs`); the frozen policy per root cannot change or multiply. The UPDATEs in tests simulate drift to prove fail-closed behaviour. |
| K8 / G4 | Tests: no unassigned/default path, no consume-path refusal | **Partly accepted.** Consume-path refusal and the unassigned default against the policy are now covered by the delta test. The unassigned candidate path is already covered by `development_candidate_service_binds_only_owned_worktree_changes` (no assignment row, binding succeeds). |

Flagged by kimi-k3 as security-relevant follow-ups (tracked in the report):
reviewer attestation bound to the dispatch role (W2-01 follow-up 3) and
role-aware launch routes/credentials.
[INFO] Recording command outcome: git

[OK] Command outcome recorded
```

## Disposition file

# Disposition W2-04 role dispatch

Reviews: `.pa/review_w2-04_kimi-k3.md`, `.pa/review_w2-04_glm-5.2.md`
(prompt `.pa/review_prompt_w2-04.md`). Both verdicts: nothing blocking.

| # | Finding | Disposition |
|---|---------|-------------|
| K1 | Unassigned task dispatches as implementer without consulting the frozen policy | **Accepted.** `run_role` now requires some team of the frozen root policy to permit `implementer` for the implicit default. Red `unassigned_dispatch_needs_an_implementer_role_up_to_the_spawn`, then fix. |
| K2 / G1 | Partial-NULL assignment row falls through to implementer | **Accepted (defense in depth).** Migration 14 declares `team_id`, `role`, `assignee` NOT NULL (`team_assignments.rs` `apply_migration`), so the row cannot exist today; `run_role` now distinguishes "no row" (all NULL) from a partial row and fails closed with "malformed team assignment row". Not testable without breaking the schema; no test. |
| K3 / G3 | `bind_candidate` role check outside the candidate write transaction | **Accepted as documentation, fix deferred.** The role of a claimed run is immutable (only writer `assign_continuous_task` refuses after the first claim; nothing resets `attempts`). Moving the check into `bind_development_run_candidate` touches `store/development_runs.rs`, owned by the parallel W2-02 package. Invariant documented at `run_role` and at the call site; follow-up listed. |
| K4 / G5 | Immutability invariant not asserted by the new tests | **Rejected with evidence.** Already covered by `team_assignments::tests::assignment_enforces_owner_and_survives_restart_without_reassigning_live_work` (reassign after claim errors) and `assignment_and_claim_race_cannot_transfer_claimed_work`. Cross-referenced in the `run_role` doc comment. The raw-SQL mutations in the new tests deliberately simulate out-of-band state to prove the launch boundary fails closed. |
| K5 | `claim_owner` decoded as non-null String | **Rejected with evidence.** `development_runs.claim_owner TEXT NOT NULL` (`development_runs.rs` table DDL). |
| K6 | Checkpoint `dispatchRole` is raw assignment, not validated dispatch | **Accepted as documentation.** Comment now states it is the assigned role (intent), re-validated at the launch boundary; the test doc no longer claims reconciliation consumes it. |
| K7 / G2 | Policy version ignored; several policy rows per root | **Rejected with evidence.** `continuous_root_policies.root_goal_id` is the PRIMARY KEY and the only production writer is the admission INSERT (`continuous.rs`); the frozen policy per root cannot change or multiply. The UPDATEs in tests simulate drift to prove fail-closed behaviour. |
| K8 / G4 | Tests: no unassigned/default path, no consume-path refusal | **Partly accepted.** Consume-path refusal and the unassigned default against the policy are now covered by the delta test. The unassigned candidate path is already covered by `development_candidate_service_binds_only_owned_worktree_changes` (no assignment row, binding succeeds). |

Flagged by kimi-k3 as security-relevant follow-ups (tracked in the report):
reviewer attestation bound to the dispatch role (W2-01 follow-up 3) and
role-aware launch routes/credentials.
