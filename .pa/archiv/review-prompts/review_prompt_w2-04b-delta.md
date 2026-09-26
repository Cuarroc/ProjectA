# Delta review request W2-04b (round 2): review-finding fixes (ProjectA, Tauri 2, Rust + SQLite)

You are an independent code reviewer from a different model vendor than the
author (Claude Code). In round 1 you (and a second reviewer) reviewed W2-04b:
a `verified:` review attestation now requires the reviewer run's dispatch role
`reviewer` (role-resolution errors refuse the review), and the candidate role
check moved into the store's `bind_candidate` writer transaction.

Round-1 findings and dispositions:
- K1/G1 (medium, accepted): the idempotent replay did not compare
  `reviewer_attestation`, so a row written under an older rule could be
  returned as `verified:`. Fix: after the payload comparison, a mismatch
  between the stored and the freshly derived attestation refuses the replay
  with "stored review attestation is stale".
- K2 (low, documented): a replay after store drift errors instead of
  returning the stored row. Kept fail-closed; the doc comment now says a retry
  is not a lookup.
- K3 (low, accepted, test only): the unknown-role test first asserts that a
  plain insert of role `auditor` hits the schema CHECK.
- K4 (low, rejected): role check before commit-ID validation is deliberate.

Check only the delta below: are the fixes correct and complete, and do they
introduce a new bug (e.g. a legitimate replay now refused, an attestation that
is not deterministic for an unchanged store, error text leaking something)?
Report findings as a numbered list with severity, file:line, failing scenario
and fix, or say explicitly that nothing is blocking.

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
        // A replay returns the stored verdict only while the store still
        // derives the same attestation; a row written under an older rule is
        // not handed back as if it were current.
        if review.reviewer_attestation != attestation {
            return Err(format!(
                "stored review attestation is stale: recorded \"{}\", the store now derives \"{attestation}\"",
                review.reviewer_attestation
            ));
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
index 77d8755..501b2b7 100644
--- a/src-tauri/src/store/development_runs.rs
+++ b/src-tauri/src/store/development_runs.rs
@@ -712,6 +712,9 @@ impl Store {
     /// `reviewer_run`, `owner` and `fence` authenticate the reviewer's own run;
     /// the reviewed run is the one owning `input.evidence_id`. Both principals
     /// are read from the store, never from the caller (see `RunPrincipal`).
+    /// A replay with the same idempotency key re-derives principal, role and
+    /// attestation first, so it fails closed like a new review when the store
+    /// no longer authorizes the reviewer; a retry is not a lookup.
     pub async fn record_development_review(
         &self,
         reviewer_run: &str,
@@ -778,6 +781,15 @@ impl Store {
                     .to_string(),
             );
         }
+        // A replay returns the stored verdict only while the store still
+        // derives the same attestation; a row written under an older rule is
+        // not handed back as if it were current.
+        if review.reviewer_attestation != attestation {
+            return Err(format!(
+                "stored review attestation is stale: recorded \"{}\", the store now derives \"{attestation}\"",
+                review.reviewer_attestation
+            ));
+        }
         tx.commit().await.map_err(db("commit development review"))?;
         Ok(review)
     }
@@ -2421,9 +2433,12 @@ mod tests {
             "{refused:?}"
         );
         let unknown = launched_run(&store, "task-q", "worker-q", 3, Some("kimi")).await;
+        // Only a corrupted row can carry an unknown role: the schema refuses
+        // one on a plain write ...
+        assert!(sqlx::query("INSERT INTO continuous_team_assignments(task_id,team_id,role,assignee,revision,policy_version,observed_at) VALUES('task-q','development','auditor','worker-q',1,1,1)")
+            .execute(&store.pool).await.unwrap_err().to_string().contains("CHECK"));
         {
-            // Only a corrupted row can carry an unknown role: bypass the CHECK
-            // on one connection to simulate it.
+            // ... so bypass the CHECK on one connection to simulate it.
             let mut conn = store.pool.acquire().await.unwrap();
             sqlx::query("PRAGMA ignore_check_constraints = ON")
                 .execute(&mut *conn)
@@ -2456,6 +2471,53 @@ mod tests {
         assert!(!keys.iter().any(|key| key == "foreign" || key == "unknown"));
     }
 
+    /// W2-04b review K1/G1: a replay returns the stored review only while its
+    /// attestation is still what the store derives now. A row written under an
+    /// older rule (here: `verified` for a non-reviewer run) is not handed back
+    /// as verified.
+    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
+    async fn replayed_review_cannot_keep_a_stale_verified_attestation() {
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
+        let unassigned = launched_run(&store, "task-u", "worker-u", 3, Some("codex")).await;
+        let first = store
+            .record_development_review(&unassigned, "worker-u", 3, review_input("old", &saved.id))
+            .await
+            .unwrap();
+        assert!(first.reviewer_attestation.starts_with("unverified:"));
+        // Simulate the row a pre-W2-04b store wrote for the same request.
+        sqlx::query("UPDATE development_run_reviews SET reviewer_attestation = 'verified: launch route receipts bind reviewer provider codex and implementer provider claude' WHERE id = ?")
+            .bind(&first.id).execute(&store.pool).await.unwrap();
+        let replay = store
+            .record_development_review(&unassigned, "worker-u", 3, review_input("old", &saved.id))
+            .await;
+        assert!(
+            replay.as_ref().is_err_and(|e| e.contains("attestation")),
+            "a stale verified attestation was replayed: {replay:?}"
+        );
+        // An unchanged row still replays idempotently.
+        let reviewer = launched_run(&store, "task-r", "worker-r", 3, Some("codex")).await;
+        assign(&store, "task-r", "reviewer", "worker-r").await;
+        let recorded = store
+            .record_development_review(&reviewer, "worker-r", 3, review_input("new", &saved.id))
+            .await
+            .unwrap();
+        let replayed = store
+            .record_development_review(&reviewer, "worker-r", 3, review_input("new", &saved.id))
+            .await
+            .unwrap();
+        assert_eq!(recorded.id, replayed.id);
+        assert!(replayed.reviewer_attestation.starts_with("verified:"));
+    }
+
     /// W2-04b: the store, not only the worker lane, refuses a candidate from a
     /// run whose dispatch role does not submit candidates. Both writers of the
     /// binding (worker and integration path) go through this boundary.
```
