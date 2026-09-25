# Review request W2-04b: reviewer role for verified reviews, candidate role at the store boundary (ProjectA, Tauri 2, Rust + SQLite)

You are an independent code reviewer from a different model vendor than the
author (Claude Code). Review the diff below for correctness and security
bugs. Report findings as a numbered list, each with: severity
(high/medium/low), file:line, what is wrong, a concrete failing scenario, and a
suggested fix. Say explicitly if you find nothing blocking. Do not restate the
diff.

## Background
- W2-01 (merged): `record_development_review` authenticates the reviewer with
  its own run credential (run, owner, fence). Both principals (reviewer run,
  reviewed/implementer run) are read from the store (`RunPrincipal`); the
  provider comes from the launch route receipt that only the trusted launch
  service writes. The attestation string is `verified: ...` only when both
  runs have receipts for different single-vendor providers; same vendor is
  refused; otherwise `unverified: <reason>`. `approval_eligible` stays 0 until
  a later signed verdict (W5-02d) signs (review id, candidate, disposition,
  labels, attestation).
- W2-02 (merged): `bind_candidate` is the single writer of
  `development_run_candidates`; entry points `bind_development_run_candidate`
  (worker path) and `invalidate_development_run_evidence_for_candidate`
  (future integration path, no production caller yet). Full commit IDs,
  monotonic observations, a rebind invalidates older evidence and reviews in
  the same transaction.
- W2-04 (merged): `run_role(conn, run_id)` in `store/development_launches.rs`
  derives the dispatch role of a run (coordinator/implementer/reviewer/
  integrator) from the migration-14 assignment; the assignment is immutable
  after the first claim. The candidate role check (reviewers/coordinators may
  not submit candidates) lived only in `workers/development.rs::bind_candidate`
  (scoped agent API), outside the store transaction.

## This package (W2-04b)
1. A `verified:` attestation additionally requires the reviewer run's
   dispatch role to be `reviewer`. `run_role` is called in the review writer
   transaction. Any `run_role` error (unknown role, malformed/partial row,
   assignee != run claim owner, team/role not permitted by the frozen root
   policy, root policy missing) refuses the review entirely (no row). A
   resolved non-reviewer role (including unassigned => implementer) is
   recorded as `unverified: reviewer run dispatches as <role>, not as reviewer`.
   The same-vendor refusal still applies before the role check.
2. The candidate role check moved into `bind_candidate` (inside the
   BEGIN IMMEDIATE writer transaction), so it covers the worker path and the
   integration path. The worker keeps its early check only to avoid running the
   repository probe; its comment now says so.
No schema change / no migration. The implementer (reviewed) run's role is not
checked at review time; it could only have bound a candidate through the store
check.

## Questions for you
1. Is refusing the review on role-resolution errors (vs. recording it
   unverified) the right fail-closed choice? Any legitimate reviewer that this
   now wrongly blocks?
2. Can a non-reviewer still end up with a `verified:` attestation (idempotent
   replay of an older row, TOCTOU between role read and insert, a run whose
   assignment was changed, the reviewed run being a reviewer itself)?
3. Does moving the role check into `bind_candidate` break an invariant of the
   integration path, or can a reviewer/coordinator run still obtain a bound
   candidate?
4. Anything in the tests that proves less than it claims (e.g. the PRAGMA
   ignore_check_constraints simulation of an unknown role)?

## Unchanged context: `run_role` (store/development_launches.rs)
```rust
type RunRoleRow = (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

/// Resolves and re-validates the dispatch role of a run. Unassigned tasks keep
/// their pre-W2-04 meaning and dispatch as implementers, but only while some
/// team of the frozen root policy permits that role. An assignment whose
/// assignee is not the run owner, or whose team/role the frozen root policy
/// does not permit, authorizes nothing; a partial assignment row fails closed.
///
/// Invariant this relies on instead of a persisted copy: the only writer of
/// `continuous_team_assignments` is `Store::assign_continuous_task`, which
/// refuses once a task was claimed (`attempts != 0`; nothing resets attempts),
/// see `team_assignments::tests::
/// assignment_enforces_owner_and_survives_restart_without_reassigning_live_work`.
/// The policy is read live from `continuous_root_policies` at each dispatch
/// boundary, not from a per-run snapshot; it is "frozen" because that table is
/// keyed by root and written once at admission. Tests that rewrite it simulate
/// out-of-band drift to prove the boundary fails closed.
pub(super) async fn run_role(
    conn: &mut SqliteConnection,
    run_id: &str,
) -> Result<DispatchRole, String> {
    let row: Option<RunRoleRow> = sqlx::query_as("SELECT r.claim_owner, a.team_id, a.role, a.assignee, p.policy_json FROM development_runs r JOIN continuous_tasks t ON t.id = r.task_id JOIN continuous_goals g ON g.id = t.goal_id LEFT JOIN continuous_root_policies p ON p.root_goal_id = g.root_goal_id LEFT JOIN continuous_team_assignments a ON a.task_id = t.id WHERE r.id = ?")
        .bind(run_id).fetch_optional(&mut *conn).await.map_err(db)?;
    let Some((owner, team, role, assignee, policy)) = row else {
        return Err("unknown development run".into());
    };
    let policy = DevelopmentPolicy::parse(&policy.ok_or("dispatch root policy unavailable")?)?;
    let permitted = |team: Option<&str>, role: &str| {
        policy.teams.iter().any(|entry| {
            team.is_none_or(|team| entry.id == team) && entry.roles.iter().any(|r| r == role)
        })
    };
    let (team, role, assignee) = match (team, role, assignee) {
        (None, None, None) => {
            if !permitted(None, DispatchRole::Implementer.as_str()) {
                return Err("unassigned task dispatches as implementer, which the frozen root policy does not permit".into());
            }
            return Ok(DispatchRole::Implementer);
        }
        (Some(team), Some(role), Some(assignee)) => (team, role, assignee),
        _ => return Err("malformed team assignment row".into()),
    };
    let dispatch = DispatchRole::parse(&role)?;
    if assignee != owner {
        return Err(format!(
            "development run owner is not the assigned {}",
            dispatch.as_str()
        ));
    }
    if !permitted(Some(&team), &role) {
        return Err("team assignment conflicts with frozen root policy".into());
    }
    Ok(dispatch)
}

```

## Context after the change: review writer (store/development_runs.rs)
```rust
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
        // W2-04b: a role the store cannot resolve (unknown, malformed, not
        // the run owner's, not permitted by the frozen root policy)
        // authorizes no review at all.
        let reviewer_role = run_role(&mut *tx, &reviewer_run).await?;
        let attestation = attest_reviewer(&reviewer, &implementer, reviewer_role)?;
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

## Context after the change: principal and attestation
```rust
/// Providers bound to exactly one model vendor. `opencode` and `ollama` route
/// to several vendors, so their name proves neither sameness nor difference.
const SINGLE_VENDOR_PROVIDERS: [&str; 3] = ["claude", "codex", "kimi"];

/// Who acted in a run, as the store observed it. The provider is read from
/// the route receipt that only the trusted launch service writes
/// (`bind_development_launch_route`); an agent holding a run credential
/// cannot set it. A later signed verdict (W5-02d) signs this label.
struct RunPrincipal {
    run_id: String,
    project_id: String,
    worker_id: Option<String>,
    provider: Option<String>,
}

impl RunPrincipal {
    async fn read(tx: &mut Transaction<'_, Sqlite>, run_id: &str) -> Result<Self, String> {
        let (project_id, worker_id, provider): (String, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT g.project_id, l.worker_id, CASE WHEN json_valid(l.route_json) THEN (CASE WHEN json_type(l.route_json, '$.selection.resolved.provider') = 'text' THEN json_extract(l.route_json, '$.selection.resolved.provider') END) END
             FROM development_runs r JOIN continuous_tasks t ON t.id = r.task_id JOIN continuous_goals g ON g.id = t.goal_id
             LEFT JOIN development_launches l ON l.run_id = r.id WHERE r.id = ?",
        )
        .bind(run_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(db("read review principal"))?;
        Ok(Self {
            run_id: run_id.to_string(),
            project_id,
            worker_id,
            provider,
        })
    }

    fn label(&self) -> String {
        format!(
            "run={} worker={} provider={}",
            self.run_id,
            self.worker_id.as_deref().unwrap_or("unlaunched"),
            self.provider.as_deref().unwrap_or("unavailable")
        )
    }
}

/// Refuse a provably dependent reviewer; label an unprovable one honestly.
/// `verified` means different model vendors, not different operators: one
/// launch service starts every run. A same-vendor reviewer is refused for
/// `changes_requested` too, so no same-vendor verdict enters the record.
/// `verified` also requires the reviewer run to be dispatched in the
/// `reviewer` role (W2-04b); another role is recorded, but unverified.
fn attest_reviewer(
    reviewer: &RunPrincipal,
    implementer: &RunPrincipal,
    reviewer_role: DispatchRole,
) -> Result<String, String> {
    let (Some(r), Some(i)) = (
        reviewer.provider.as_deref(),
        implementer.provider.as_deref(),
    ) else {
        return Ok(
            "unverified: provider unavailable without a launch route receipt for both runs"
                .to_string(),
        );
    };
    let single = |p: &str| SINGLE_VENDOR_PROVIDERS.contains(&p);
    if !single(r) || !single(i) {
        let router = if single(r) { i } else { r };
        return Ok(format!(
            "unverified: provider {router} does not identify one model vendor"
        ));
    }
    if r == i {
        return Err(format!("reviewer must be independent: reviewer and implementer resolve to the same provider {r}"));
    }
    if reviewer_role != DispatchRole::Reviewer {
        return Ok(format!(
            "unverified: reviewer run dispatches as {}, not as reviewer",
            reviewer_role.as_str()
        ));
    }
    Ok(format!(
        "verified: launch route receipts bind reviewer provider {r} and implementer provider {i}"
    ))
}

```

## Diff
```diff
diff --git a/src-tauri/src/store/development_runs.rs b/src-tauri/src/store/development_runs.rs
index db02145..77d8755 100644
--- a/src-tauri/src/store/development_runs.rs
+++ b/src-tauri/src/store/development_runs.rs
@@ -8,6 +8,7 @@ use serde::{Deserialize, Serialize};
 use serde_json::Value;
 use sqlx::{FromRow, Sqlite, Transaction};
 
+use super::development_launches::{run_role, DispatchRole};
 use super::{new_id, now_unix_secs, Store};
 
 #[path = "development_checkpoints.rs"]
@@ -752,7 +753,11 @@ impl Store {
         if reviewer.project_id != implementer.project_id {
             return Err("reviewer run belongs to another project".to_string());
         }
-        let attestation = attest_reviewer(&reviewer, &implementer)?;
+        // W2-04b: a role the store cannot resolve (unknown, malformed, not
+        // the run owner's, not permitted by the frozen root policy)
+        // authorizes no review at all.
+        let reviewer_role = run_role(&mut *tx, &reviewer_run).await?;
+        let attestation = attest_reviewer(&reviewer, &implementer, reviewer_role)?;
         let id = new_id("drr");
         sqlx::query("INSERT OR IGNORE INTO development_run_reviews(id, run_id, evidence_id, idempotency_key, candidate_commit, disposition, reviewer_identity, implementer_identity, source, observed_at, reviewer_attestation, approval_eligible, status) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, ?12)")
             .bind(&id).bind(&run_id).bind(&input.evidence_id).bind(&input.idempotency_key).bind(&input.candidate_commit).bind(input.disposition.as_str()).bind(reviewer.label()).bind(implementer.label()).bind(&input.source).bind(input.observed_at).bind(&attestation).bind(VALID_REVIEW)
@@ -984,6 +989,16 @@ async fn bind_candidate(
     source: &str,
     observed_at: i64,
 ) -> Result<u64, String> {
+    // W2-04b: the dispatch role decides inside the write transaction, for
+    // both entry points (worker and integration path). Reviewers and
+    // coordinators never own a candidate; an unresolvable role fails closed.
+    let role = run_role(&mut **tx, run_id).await?;
+    if !role.submits_candidate() {
+        return Err(format!(
+            "candidate refused: a {} run does not submit integration candidates",
+            role.as_str()
+        ));
+    }
     require_full_commit_id(candidate_commit)?;
     let bound: Option<(String, i64)> = sqlx::query_as(
         "SELECT candidate_commit, observed_at FROM development_run_candidates WHERE run_id = ?1",
@@ -1119,7 +1134,13 @@ impl RunPrincipal {
 /// `verified` means different model vendors, not different operators: one
 /// launch service starts every run. A same-vendor reviewer is refused for
 /// `changes_requested` too, so no same-vendor verdict enters the record.
-fn attest_reviewer(reviewer: &RunPrincipal, implementer: &RunPrincipal) -> Result<String, String> {
+/// `verified` also requires the reviewer run to be dispatched in the
+/// `reviewer` role (W2-04b); another role is recorded, but unverified.
+fn attest_reviewer(
+    reviewer: &RunPrincipal,
+    implementer: &RunPrincipal,
+    reviewer_role: DispatchRole,
+) -> Result<String, String> {
     let (Some(r), Some(i)) = (
         reviewer.provider.as_deref(),
         implementer.provider.as_deref(),
@@ -1139,6 +1160,12 @@ fn attest_reviewer(reviewer: &RunPrincipal, implementer: &RunPrincipal) -> Resul
     if r == i {
         return Err(format!("reviewer must be independent: reviewer and implementer resolve to the same provider {r}"));
     }
+    if reviewer_role != DispatchRole::Reviewer {
+        return Ok(format!(
+            "unverified: reviewer run dispatches as {}, not as reviewer",
+            reviewer_role.as_str()
+        ));
+    }
     Ok(format!(
         "verified: launch route receipts bind reviewer provider {r} and implementer provider {i}"
     ))
@@ -2044,6 +2071,13 @@ mod tests {
         run.id
     }
 
+    /// Stands in for `assign_continuous_task` (migration 14): the dispatch
+    /// role of a run comes from its task's team assignment (W2-04).
+    async fn assign(store: &Store, task: &str, role: &str, assignee: &str) {
+        sqlx::query("INSERT INTO continuous_team_assignments(task_id,team_id,role,assignee,revision,policy_version,observed_at) VALUES(?1,'development',?2,?3,1,1,1)")
+            .bind(task).bind(role).bind(assignee).execute(&store.pool).await.unwrap();
+    }
+
     fn review_input(key: &str, evidence_id: &str) -> ReviewInput {
         ReviewInput {
             idempotency_key: key.into(),
@@ -2075,6 +2109,7 @@ mod tests {
             .is_err());
         // A different provider, bound by the launch service, is verified.
         let reviewer = launched_run(&store, "task-r", "worker-r", 3, Some("codex")).await;
+        assign(&store, "task-r", "reviewer", "worker-r").await;
         let review = store
             .record_development_review(&reviewer, "worker-r", 3, review_input("codex", &saved.id))
             .await
@@ -2225,6 +2260,7 @@ mod tests {
             .await
             .unwrap();
         let reviewer = launched_run(&store, "task-r", "worker-r", 3, Some("codex")).await;
+        assign(&store, "task-r", "reviewer", "worker-r").await;
         let review = store
             .record_development_review(&reviewer, "worker-r", 3, review_input("exact", &test.id))
             .await
@@ -2318,4 +2354,162 @@ mod tests {
             .await
             .unwrap();
     }
+
+    /// W2-04b: a different vendor alone does not make a verified reviewer; the
+    /// reviewer run must also be dispatched in the `reviewer` role. A role the
+    /// store cannot resolve authorizes no review at all.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn verified_review_requires_the_reviewer_dispatch_role() {
+        let (_dir, store, _root, task) = fixture().await;
+        let implementer = launched_run(&store, &task, "worker-a", 7, Some("claude")).await;
+        store
+            .bind_development_run_candidate(&implementer, "worker-a", 7, COMMIT_A, "git", 6)
+            .await
+            .unwrap();
+        let saved = store
+            .record_development_evidence(&implementer, "worker-a", 7, evidence(COMMIT_A))
+            .await
+            .unwrap();
+        // Unassigned runs dispatch as implementers; a coordinator is no
+        // reviewer either. Both are recorded, but never as verified.
+        let unassigned = launched_run(&store, "task-u", "worker-u", 3, Some("codex")).await;
+        let coordinator = launched_run(&store, "task-c", "worker-c", 3, Some("codex")).await;
+        assign(&store, "task-c", "coordinator", "worker-c").await;
+        for (run, owner, role) in [
+            (&unassigned, "worker-u", "implementer"),
+            (&coordinator, "worker-c", "coordinator"),
+        ] {
+            let review = store
+                .record_development_review(run, owner, 3, review_input(role, &saved.id))
+                .await
+                .unwrap();
+            assert!(
+                review.reviewer_attestation.starts_with("unverified:")
+                    && review.reviewer_attestation.contains(role),
+                "a {role} run was attested as reviewer: {}",
+                review.reviewer_attestation
+            );
+        }
+        // The assigned reviewer of another vendor is verified.
+        let reviewer = launched_run(&store, "task-r", "worker-r", 3, Some("codex")).await;
+        assign(&store, "task-r", "reviewer", "worker-r").await;
+        let review = store
+            .record_development_review(
+                &reviewer,
+                "worker-r",
+                3,
+                review_input("reviewer", &saved.id),
+            )
+            .await
+            .unwrap();
+        assert!(
+            review.reviewer_attestation.starts_with("verified:"),
+            "{}",
+            review.reviewer_attestation
+        );
+        // Fail closed: a reviewer assignment for someone else, and a role the
+        // store does not know, authorize no review.
+        let foreign = launched_run(&store, "task-f", "worker-f", 3, Some("kimi")).await;
+        assign(&store, "task-f", "reviewer", "someone-else").await;
+        let refused = store
+            .record_development_review(&foreign, "worker-f", 3, review_input("foreign", &saved.id))
+            .await;
+        assert!(
+            refused
+                .as_ref()
+                .is_err_and(|e| e.contains("not the assigned reviewer")),
+            "{refused:?}"
+        );
+        let unknown = launched_run(&store, "task-q", "worker-q", 3, Some("kimi")).await;
+        {
+            // Only a corrupted row can carry an unknown role: bypass the CHECK
+            // on one connection to simulate it.
+            let mut conn = store.pool.acquire().await.unwrap();
+            sqlx::query("PRAGMA ignore_check_constraints = ON")
+                .execute(&mut *conn)
+                .await
+                .unwrap();
+            sqlx::query("INSERT INTO continuous_team_assignments(task_id,team_id,role,assignee,revision,policy_version,observed_at) VALUES('task-q','development','auditor','worker-q',1,1,1)")
+                .execute(&mut *conn).await.unwrap();
+            sqlx::query("PRAGMA ignore_check_constraints = OFF")
+                .execute(&mut *conn)
+                .await
+                .unwrap();
+        }
+        let refused = store
+            .record_development_review(&unknown, "worker-q", 3, review_input("unknown", &saved.id))
+            .await;
+        assert!(
+            refused
+                .as_ref()
+                .is_err_and(|e| e.contains("unknown dispatch role")),
+            "{refused:?}"
+        );
+        let keys: Vec<String> = store
+            .list_development_reviews(&implementer)
+            .await
+            .unwrap()
+            .into_iter()
+            .map(|review| review.idempotency_key)
+            .collect();
+        assert_eq!(keys.len(), 3, "{keys:?}");
+        assert!(!keys.iter().any(|key| key == "foreign" || key == "unknown"));
+    }
+
+    /// W2-04b: the store, not only the worker lane, refuses a candidate from a
+    /// run whose dispatch role does not submit candidates. Both writers of the
+    /// binding (worker and integration path) go through this boundary.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn candidate_role_is_enforced_at_the_store_boundary() {
+        let (_dir, store, _root, _task) = fixture().await;
+        for role in ["reviewer", "coordinator"] {
+            let task = format!("task-{role}");
+            let owner = format!("worker-{role}");
+            let run = launched_run(&store, &task, &owner, 3, None).await;
+            assign(&store, &task, role, &owner).await;
+            let bound = store
+                .bind_development_run_candidate(&run, &owner, 3, COMMIT_A, "git", 6)
+                .await;
+            assert!(
+                bound.as_ref().is_err_and(|e| e.contains(role)),
+                "a {role} run bound a candidate: {bound:?}"
+            );
+            let integrated = store
+                .invalidate_development_run_evidence_for_candidate(
+                    &run,
+                    &owner,
+                    3,
+                    COMMIT_A,
+                    "integrator",
+                    6,
+                )
+                .await;
+            assert!(
+                integrated.as_ref().is_err_and(|e| e.contains(role)),
+                "a {role} run was bound through the integration path: {integrated:?}"
+            );
+            let context = store.agent_run_context(&run, &owner, 3).await.unwrap();
+            assert!(context["candidate"].is_null(), "{role}");
+        }
+        // A foreign assignment fails closed even for a submitting role.
+        let foreign = launched_run(&store, "task-f", "worker-f", 3, None).await;
+        assign(&store, "task-f", "implementer", "someone-else").await;
+        assert!(store
+            .bind_development_run_candidate(&foreign, "worker-f", 3, COMMIT_A, "git", 6)
+            .await
+            .unwrap_err()
+            .contains("not the assigned implementer"));
+        // Integrators and (unassigned) implementers submit candidates.
+        let integrator = launched_run(&store, "task-i", "worker-i", 3, None).await;
+        assign(&store, "task-i", "integrator", "worker-i").await;
+        store
+            .bind_development_run_candidate(&integrator, "worker-i", 3, COMMIT_A, "git", 6)
+            .await
+            .unwrap();
+        let implementer = launched_run(&store, "task-1", "worker-a", 7, None).await;
+        store
+            .bind_development_run_candidate(&implementer, "worker-a", 7, COMMIT_A, "git", 6)
+            .await
+            .unwrap();
+    }
 }
diff --git a/src-tauri/src/workers/development.rs b/src-tauri/src/workers/development.rs
index 07d2bd8..0da61b8 100644
--- a/src-tauri/src/workers/development.rs
+++ b/src-tauri/src/workers/development.rs
@@ -28,10 +28,10 @@ pub async fn bind_candidate(
     // checks the fence again after Git; no SQL connection is held by the probe.
     let context = store.agent_run_context(run, owner, fence).await?;
     // W2-04: the dispatched team role, not the caller, decides whether this
-    // run produces candidates. Reviewers and coordinators never do. Checked
-    // outside the candidate write transaction: the role of a claimed run is
-    // immutable (see `run_role`); moving the check into
-    // `bind_development_run_candidate` is a follow-up for the store lane.
+    // run produces candidates. Reviewers and coordinators never do. The
+    // authoritative check is in the store's candidate write transaction
+    // (W2-04b, `bind_candidate`); this early copy only refuses before the Git
+    // probe runs on a worktree the run may not submit from.
     let role = store.development_run_role(run).await?;
     if !role.submits_candidate() {
         return Err(format!(
```
