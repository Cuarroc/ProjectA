//! Durable team coordination; assignments never grant approval authority.
use super::{now_unix_secs, Store};
use crate::development_policy::DevelopmentPolicy;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Sqlite, SqliteConnection, Transaction};
type AssignmentAdmissionRow = (String, String, String, i64, String, Option<String>, i64);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TeamAssignment {
    pub task_id: String,
    pub team_id: String,
    pub role: String,
    pub assignee: String,
    pub revision: i64,
    pub policy_version: i64,
    pub observed_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssignmentRequest {
    pub team_id: String,
    pub role: String,
    pub assignee: String,
    pub expected_revision: i64,
}

impl Store {
    pub async fn assign_continuous_task(
        &self,
        task: &str,
        request: AssignmentRequest,
    ) -> Result<TeamAssignment, String> {
        let team_id = label(&request.team_id, "teamId")?;
        let role = label(&request.role, "role")?;
        let assignee = label(&request.assignee, "assignee")?;
        let revision = request
            .expected_revision
            .checked_add(1)
            .filter(|value| *value > 0)
            .ok_or("expectedRevision must be non-negative and below the maximum integer")?;
        let mut tx = self.pool.begin().await.map_err(db)?;
        // Serialize against both competing assignments and claims before reads.
        sqlx::query("UPDATE continuous_tasks SET updated_at=updated_at WHERE id=?")
            .bind(task)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        let row:Option<AssignmentAdmissionRow>=sqlx::query_as("SELECT g.project_id,p.policy_json,g.status,g.deadline_at,t.status,t.claim_owner,t.attempts FROM continuous_tasks t JOIN continuous_goals g ON g.id=t.goal_id JOIN projects project ON project.id=g.project_id JOIN continuous_root_policies p ON p.root_goal_id=g.root_goal_id WHERE t.id=?")
            .bind(task).fetch_optional(&mut *tx).await.map_err(db)?;
        let Some((project, encoded, goal_status, deadline, status, owner, attempts)) = row else {
            return Err("unknown continuous task or root policy".into());
        };
        let policy = DevelopmentPolicy::parse(&encoded)?;
        if !policy
            .teams
            .iter()
            .any(|team| team.id == team_id && team.roles.contains(&role))
        {
            return Err("teamId and role must be permitted by the frozen root policy".into());
        }
        let prior = read(&mut tx, task).await?;
        // Retry of the already committed request remains read-only after claim.
        if let Some(prior) = &prior {
            if prior.revision == revision
                && prior.team_id == team_id
                && prior.role == role
                && prior.assignee == assignee
            {
                return Ok(prior.clone());
            }
        }
        if prior.as_ref().map_or(0, |value| value.revision) != request.expected_revision {
            return Err("team assignment revision conflict".into());
        }
        if goal_status != "open" || status != "open" || owner.is_some() || attempts != 0 {
            return Err("team assignment is locked after the first claim or goal closure".into());
        }
        let now = now_unix_secs();
        if deadline > 0 && now >= deadline {
            return Err("continuous goal deadline has elapsed; assignment refused".into());
        }
        let assignment = TeamAssignment {
            task_id: task.into(),
            team_id,
            role,
            assignee,
            revision,
            policy_version: i64::from(policy.schema_version),
            observed_at: now,
        };
        sqlx::query("INSERT INTO continuous_team_assignments(task_id,team_id,role,assignee,revision,policy_version,observed_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET team_id=excluded.team_id,role=excluded.role,assignee=excluded.assignee,revision=excluded.revision,policy_version=excluded.policy_version,observed_at=excluded.observed_at")
            .bind(task).bind(&assignment.team_id).bind(&assignment.role).bind(&assignment.assignee).bind(revision).bind(assignment.policy_version).bind(now).execute(&mut *tx).await.map_err(db)?;
        sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) VALUES(?,'team_assignment',?,?)")
            .bind(project).bind(serde_json::json!({"version":1,"taskId":task,"revision":revision}).to_string()).bind(now).execute(&mut *tx).await.map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(assignment)
    }

    pub async fn continuous_task_assignment(
        &self,
        task: &str,
    ) -> Result<Option<TeamAssignment>, String> {
        let mut tx = self.pool.begin().await.map_err(db)?;
        let (exists,):(bool,)=sqlx::query_as("SELECT EXISTS(SELECT 1 FROM continuous_tasks t JOIN continuous_goals g ON g.id=t.goal_id JOIN projects p ON p.id=g.project_id WHERE t.id=?)")
            .bind(task).fetch_one(&mut *tx).await.map_err(db)?;
        if !exists {
            return Err("unknown continuous task".into());
        }
        read(&mut tx, task).await
    }
}

pub(super) async fn apply_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    sqlx::query("CREATE TABLE continuous_team_assignments(task_id TEXT PRIMARY KEY,team_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('coordinator','implementer','reviewer','integrator')),assignee TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),policy_version INTEGER NOT NULL,observed_at INTEGER NOT NULL)")
        .execute(&mut **tx).await.map_err(db)?;
    Ok(())
}

pub(super) async fn read(
    tx: &mut SqliteConnection,
    task: &str,
) -> Result<Option<TeamAssignment>, String> {
    sqlx::query_as("SELECT task_id,team_id,role,assignee,revision,policy_version,observed_at FROM continuous_team_assignments WHERE task_id=?")
        .bind(task).fetch_optional(&mut *tx).await.map_err(db)
}

pub(super) async fn check_claim(
    tx: &mut SqliteConnection,
    task: &str,
    owner: &str,
    policy: &DevelopmentPolicy,
) -> Result<(), String> {
    if let Some(assignment) = read(tx, task).await? {
        if assignment.assignee != owner {
            return Err("continuous task is assigned to another owner".into());
        }
        if !policy
            .teams
            .iter()
            .any(|team| team.id == assignment.team_id && team.roles.contains(&assignment.role))
        {
            return Err("team assignment conflicts with frozen root policy".into());
        }
        if assignment.role == "integrator" {
            let (active,):(i64,)=sqlx::query_as("SELECT COUNT(*) FROM continuous_team_assignments a JOIN continuous_tasks t ON t.id=a.task_id WHERE a.role='integrator' AND t.status='running'")
                .fetch_one(&mut *tx).await.map_err(db)?;
            if active >= i64::from(policy.continuous.max_integration) {
                return Err("continuous integration capacity exhausted".into());
            }
        }
    }
    Ok(())
}

fn label(value: &str, field: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 128 || value.chars().any(char::is_control) {
        Err(format!(
            "{field} must be 1..128 characters without control characters"
        ))
    } else {
        Ok(value.into())
    }
}
fn db(error: sqlx::Error) -> String {
    format!("team assignment storage: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    async fn fixture() -> (TempDir, Store, String, String) {
        let dir = TempDir::new("team-assignments");
        std::fs::write(
            dir.path().join("projecta.dev.json"),
            serde_json::to_string(&DevelopmentPolicy::defaults()).unwrap(),
        )
        .unwrap();
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let project = store
            .create_project("team", &dir.path().to_string_lossy())
            .await
            .unwrap();
        let goal = store
            .create_continuous_goal(&project.id, "goal", None, None, true)
            .await
            .unwrap();
        sqlx::query("INSERT INTO continuous_projects VALUES(?,'enabled',1)")
            .bind(&project.id)
            .execute(&store.pool)
            .await
            .unwrap();
        (dir, store, project.id, goal.id)
    }

    fn request(assignee: &str, role: &str, revision: i64) -> AssignmentRequest {
        AssignmentRequest {
            team_id: "development".into(),
            role: role.into(),
            assignee: assignee.into(),
            expected_revision: revision,
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn assignment_enforces_owner_and_survives_restart_without_reassigning_live_work() {
        let (dir, store, project, goal) = fixture().await;
        let task = store
            .create_continuous_task(&goal, "implement", None, vec!["src/a.rs".into()], vec![])
            .await
            .unwrap();
        let assigned = store
            .assign_continuous_task(&task.id, request("alice", "implementer", 0))
            .await
            .unwrap();
        assert_eq!(assigned.revision, 1);
        assert!(store
            .claim_continuous_task(&task.id, "bob", false)
            .await
            .unwrap_err()
            .contains("assigned"));
        let claim = store
            .claim_continuous_task(&task.id, "alice", false)
            .await
            .unwrap();
        assert!(store
            .assign_continuous_task(&task.id, request("bob", "implementer", 1))
            .await
            .is_err());
        assert_eq!(
            store
                .assign_continuous_task(&task.id, request("alice", "implementer", 0))
                .await
                .unwrap(),
            assigned
        );
        store.pool.close().await;
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let context = store.continuous_context(&project, 0).await.unwrap();
        assert_eq!(context.tasks[0].assignment, Some(assigned.clone()));
        assert_eq!(
            store.continuous_task_assignment(&task.id).await.unwrap(),
            Some(assigned.clone())
        );
        let run = store
            .record_development_run_intent(&task.id, "alice", claim.fence)
            .await
            .unwrap();
        let briefing = store
            .agent_run_context(&run.id, "alice", claim.fence)
            .await
            .unwrap();
        assert_eq!(
            briefing["task"]["assignment"],
            serde_json::to_value(assigned).unwrap()
        );
        assert_eq!(briefing["approvalAuthority"]["state"], "unavailable");
        assert_eq!(context.tasks[0].claim.as_ref().unwrap().fence, claim.fence);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn assignment_races_and_journal_failures_preserve_revision() {
        let (_dir, store, project, goal) = fixture().await;
        let task = store
            .create_continuous_task(&goal, "work", None, vec!["src/a.rs".into()], vec![])
            .await
            .unwrap();
        let other = store.clone();
        let other_task = task.id.clone();
        let first = tokio::spawn(async move {
            other
                .assign_continuous_task(&other_task, request("alice", "implementer", 0))
                .await
        });
        let second = store
            .assign_continuous_task(&task.id, request("bob", "implementer", 0))
            .await;
        let first = first.await.unwrap();
        assert_ne!(first.is_ok(), second.is_ok());
        let winner = first.or(second).unwrap();
        let before = store.continuous_changes(&project, 0).await.unwrap();
        sqlx::query("CREATE TRIGGER reject_assignment BEFORE INSERT ON continuous_events WHEN NEW.kind='team_assignment' BEGIN SELECT RAISE(ABORT,'injected assignment journal failure'); END")
            .execute(&store.pool).await.unwrap();
        assert!(store
            .assign_continuous_task(&task.id, request("carol", "reviewer", 1))
            .await
            .unwrap_err()
            .contains("injected assignment journal failure"));
        assert_eq!(
            store.continuous_task_assignment(&task.id).await.unwrap(),
            Some(winner)
        );
        let after = store.continuous_changes(&project, 0).await.unwrap();
        // `sourceTimestamp` is an observation clock, so a retry that crosses
        // a second must not make otherwise identical journal state look
        // different. Compare the durable cursor/events and require the clock
        // to move forward instead of asserting a wall-clock snapshot.
        for key in [
            "apiVersion",
            "projectId",
            "cursor",
            "limit",
            "hasMore",
            "events",
            "source",
        ] {
            assert_eq!(after[key], before[key], "journal field changed: {key}");
        }
        assert!(
            after["sourceTimestamp"].as_i64().unwrap()
                >= before["sourceTimestamp"].as_i64().unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn frozen_team_policy_and_integration_capacity_survive_configuration_edits() {
        let (dir, store, _project, goal) = fixture().await;
        let first = store
            .create_continuous_task(
                &goal,
                "integrate one",
                None,
                vec!["src/a.rs".into()],
                vec![],
            )
            .await
            .unwrap();
        let second = store
            .create_continuous_task(
                &goal,
                "integrate two",
                None,
                vec!["src/b.rs".into()],
                vec![],
            )
            .await
            .unwrap();
        let mut changed = DevelopmentPolicy::defaults();
        changed.teams[0].id = "replacement-team".into();
        std::fs::write(
            dir.path().join("projecta.dev.json"),
            serde_json::to_string(&changed).unwrap(),
        )
        .unwrap();
        let mut invalid = request("alice", "integrator", 0);
        invalid.team_id = "replacement-team".into();
        assert!(store
            .assign_continuous_task(&first.id, invalid)
            .await
            .unwrap_err()
            .contains("frozen root policy"));
        store
            .assign_continuous_task(&first.id, request("alice", "integrator", 0))
            .await
            .unwrap();
        store
            .assign_continuous_task(&second.id, request("bob", "integrator", 0))
            .await
            .unwrap();
        store
            .claim_continuous_task(&first.id, "alice", false)
            .await
            .unwrap();
        assert!(store
            .claim_continuous_task(&second.id, "bob", false)
            .await
            .unwrap_err()
            .contains("integration capacity exhausted"));
        let (attempts,): (i64,) =
            sqlx::query_as("SELECT attempts FROM continuous_tasks WHERE id=?")
                .bind(&second.id)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(attempts, 0);
        let other_project = store
            .create_project("another project", &dir.path().to_string_lossy())
            .await
            .unwrap();
        let other_goal = store
            .create_continuous_goal(&other_project.id, "other goal", None, None, true)
            .await
            .unwrap();
        sqlx::query("INSERT INTO continuous_projects VALUES(?,'enabled',1)")
            .bind(&other_project.id)
            .execute(&store.pool)
            .await
            .unwrap();
        let other_task = store
            .create_continuous_task(
                &other_goal.id,
                "other integration",
                None,
                vec!["src/c.rs".into()],
                vec![],
            )
            .await
            .unwrap();
        let mut other_request = request("carol", "integrator", 0);
        other_request.team_id = "replacement-team".into();
        store
            .assign_continuous_task(&other_task.id, other_request)
            .await
            .unwrap();
        assert!(store
            .claim_continuous_task(&other_task.id, "carol", false)
            .await
            .unwrap_err()
            .contains("integration capacity exhausted"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn assignment_and_claim_race_cannot_transfer_claimed_work() {
        let (_dir, store, _project, goal) = fixture().await;
        let task = store
            .create_continuous_task(&goal, "work", None, vec!["src/a.rs".into()], vec![])
            .await
            .unwrap();
        store
            .assign_continuous_task(&task.id, request("alice", "implementer", 0))
            .await
            .unwrap();
        let other = store.clone();
        let other_task = task.id.clone();
        let claim = tokio::spawn(async move {
            other
                .claim_continuous_task(&other_task, "alice", false)
                .await
        });
        let reassign = store
            .assign_continuous_task(&task.id, request("bob", "reviewer", 1))
            .await;
        let claim = claim.await.unwrap();
        assert_ne!(claim.is_ok(), reassign.is_ok());
        let assignment = store
            .continuous_task_assignment(&task.id)
            .await
            .unwrap()
            .unwrap();
        if claim.is_ok() {
            assert_eq!(assignment.assignee, "alice");
            assert_eq!(assignment.revision, 1)
        } else {
            assert_eq!(assignment.assignee, "bob");
            assert_eq!(assignment.revision, 2)
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn assignment_rejects_unbounded_labels_and_invalid_revisions_without_writes() {
        let (_dir, store, project, goal) = fixture().await;
        let task = store
            .create_continuous_task(&goal, "work", None, vec!["src/a.rs".into()], vec![])
            .await
            .unwrap();
        let before = store.continuous_changes(&project, 0).await.unwrap();
        for value in [
            request("", "implementer", 0),
            request(&"x".repeat(129), "implementer", 0),
            request("bad\nowner", "implementer", 0),
            request("alice", "administrator", 0),
            request("alice", "implementer", -1),
            request("alice", "implementer", i64::MAX),
        ] {
            assert!(store.assign_continuous_task(&task.id, value).await.is_err());
        }
        assert!(store
            .continuous_task_assignment(&task.id)
            .await
            .unwrap()
            .is_none());
        let after = store.continuous_changes(&project, 0).await.unwrap();
        // Wie oben: `sourceTimestamp` ist eine Lesetuhr, kein Journal-Zustand;
        // ein Sekundensprung zwischen den Reads darf nicht als Schreibzugriff
        // aussehen. Verglichen werden die dauerhaften Felder.
        for key in [
            "apiVersion",
            "projectId",
            "cursor",
            "limit",
            "hasMore",
            "events",
            "source",
        ] {
            assert_eq!(after[key], before[key], "journal field changed: {key}");
        }
    }
}
