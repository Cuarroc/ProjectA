//! Transactional, metadata-only invalidation notices for runtime records.

use sqlx::{Sqlite, Transaction};

pub(super) async fn apply_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    // Centralize freshness for manual producers as well as the triggers below.
    // Keep commit/run identity unchanged; a notice is not a candidate attestation.
    sqlx::query("CREATE TRIGGER IF NOT EXISTS continuous_journal_snapshot AFTER INSERT ON continuous_events BEGIN INSERT INTO continuous_context_snapshots(project_id,source_timestamp) VALUES(NEW.project_id,NEW.created_at) ON CONFLICT(project_id) DO UPDATE SET source_timestamp=excluded.source_timestamp; END")
        .execute(&mut **tx).await.map_err(|e| format!("install journal snapshot stamp: {e}"))?;
    // These identifiers and expressions are compile-time constants, never caller input.
    // Notices request a fresh authorized read; they are not replayable row payloads.
    for (table, kind, run, record, columns) in [
        ("development_runs", "development_run", "NEW.id", "NEW.id",
         "task_id root_goal_id claim_owner claim_fence policy_json status worker_id process_id intent_at launched_at reconciled_at terminal_at terminal_detail"),
        ("development_run_candidates", "development_candidate", "NEW.run_id", "NEW.run_id",
         "candidate_commit source observed_at"),
        ("development_run_evidence", "development_evidence", "NEW.run_id", "NEW.id",
         "run_id idempotency_key source observed_at candidate_commit measurement_json payload_json invalidated_at invalidated_by_commit"),
        ("development_run_reviews", "development_review", "NEW.run_id", "NEW.id",
         "run_id evidence_id idempotency_key candidate_commit disposition reviewer_identity implementer_identity source observed_at reviewer_attestation approval_eligible status invalidated_at invalidated_by_commit"),
        ("development_launches", "development_launch", "NEW.run_id", "NEW.run_id",
         "worker_id project_id profile_id repo_path worktree_path branch session_id state reserved_at spawning_at exited_at exit_code route_json route_expires_at"),
    ] {
        let project = format!("SELECT g.project_id FROM development_runs r JOIN continuous_tasks t ON t.id=r.task_id JOIN continuous_goals g ON g.id=t.goal_id WHERE r.id={run}");
        let changed = columns.split_whitespace().map(|column| format!("OLD.{column} IS NOT NEW.{column}")).collect::<Vec<_>>().join(" OR ");
        for action in ["insert", "update"] {
            let when = if action == "update" { format!("WHEN {changed}") } else { String::new() };
            let statement = format!(
                "CREATE TRIGGER IF NOT EXISTS {table}_journal_{action} AFTER {action} ON {table} {when} BEGIN
                 SELECT CASE WHEN ({project}) IS NULL THEN RAISE(ABORT,'development event project unavailable') END;
                 INSERT INTO continuous_events(project_id,kind,detail,created_at)
                   VALUES(({project}),'{kind}',json_object('version',1,'action','{action}','runId',{run},'recordId',{record}),unixepoch());
                 END"
            );
            sqlx::query(&statement).execute(&mut **tx).await.map_err(|e| format!("install runtime journal trigger: {e}"))?;
        }
    }
    // Earlier runtime changes were not journaled. A marker requires a fresh
    // snapshot, without pretending that historical transitions were observed.
    sqlx::query("INSERT INTO continuous_events(project_id,kind,detail,created_at) SELECT DISTINCT g.project_id,'runtime_resync','{\"version\":1,\"schemaVersion\":12,\"reason\":\"runtime journal coverage expanded\"}',unixepoch() FROM development_runs r JOIN continuous_tasks t ON t.id=r.task_id JOIN continuous_goals g ON g.id=t.goal_id")
        .execute(&mut **tx).await.map_err(|e| format!("record runtime journal boundary: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::{development_runs::*, Store};
    use crate::{development_policy::DevelopmentPolicy, testutil::TempDir};
    use serde_json::{json, Value};

    const COMMIT_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const COMMIT_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    async fn fixture() -> (TempDir, Store, String, String) {
        let dir = TempDir::new("development-events");
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let project = store
            .create_project("events", &dir.path().to_string_lossy())
            .await
            .unwrap();
        sqlx::query("INSERT INTO continuous_projects VALUES(?, 'enabled', 1)")
            .bind(&project.id)
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO continuous_goals(id,project_id,root_goal_id,objective,status,deadline_at,admitted,created_at,updated_at) VALUES('goal',?,'goal','goal','open',9999999999,1,1,1)").bind(&project.id).execute(&store.pool).await.unwrap();
        sqlx::query("INSERT INTO continuous_root_policies VALUES('goal',?,'test',1)")
            .bind(serde_json::to_string(&DevelopmentPolicy::defaults()).unwrap())
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO continuous_tasks(id,goal_id,objective,owned_paths_json,dependencies_json,status,claim_owner,claim_fence,created_at,updated_at) VALUES('task','goal','task','[]','[]','running','owner',1,1,1)").execute(&store.pool).await.unwrap();
        let run = store
            .record_development_run_intent("task", "owner", 1)
            .await
            .unwrap();
        (dir, store, project.id, run.id)
    }

    async fn events(store: &Store, project: &str) -> Vec<(String, Value)> {
        store.continuous_changes(project, 0).await.unwrap()["events"]
            .as_array()
            .unwrap()
            .iter()
            .map(|event| {
                (
                    event["kind"].as_str().unwrap().into(),
                    serde_json::from_str(event["detail"].as_str().unwrap())
                        .unwrap_or_else(|_| event["detail"].clone()),
                )
            })
            .collect()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn manual_checkpoint_and_budget_events_refresh_snapshot_identity_safely() {
        let (_dir, store, project, run) = fixture().await;
        for kind in ["run_checkpoint", "token_budget"] {
            sqlx::query("UPDATE continuous_context_snapshots SET source_timestamp=1,commit_sha='bound-commit',run_id=? WHERE project_id=?")
                .bind(&run).bind(&project).execute(&store.pool).await.unwrap();
            if kind == "run_checkpoint" {
                store
                    .record_agent_checkpoint(
                        &run,
                        "owner",
                        1,
                        CheckpointInput {
                            idempotency_key: "checkpoint".into(),
                            expected_revision: 0,
                            completed: vec![],
                            remaining: vec!["work".into()],
                            failed_approaches: vec![],
                            evidence_ids: vec![],
                        },
                    )
                    .await
                    .unwrap();
            } else {
                store
                    .reserve_development_tokens(
                        "goal",
                        "budget",
                        super::super::development_budget::BudgetPurpose::Implementation,
                        1000,
                        Some(&run),
                    )
                    .await
                    .unwrap();
            }
            let snapshot: (i64,String,String) = sqlx::query_as("SELECT source_timestamp,commit_sha,run_id FROM continuous_context_snapshots WHERE project_id=?")
                .bind(&project).fetch_one(&store.pool).await.unwrap();
            let marker: (i64,i64) = sqlx::query_as("SELECT COUNT(*),MAX(created_at) FROM continuous_events WHERE project_id=? AND kind=?")
                .bind(&project).bind(kind).fetch_one(&store.pool).await.unwrap();
            assert_eq!(marker.0, 1);
            assert!(marker.1 > 1);
            assert_eq!(snapshot, (marker.1, "bound-commit".into(), run.clone()));
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn launch_journal_covers_route_spawn_exit_and_rejects_duplicate_effects() {
        let (_dir, store, project, run) = fixture().await;
        let launch = store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .unwrap();
        assert!(store
            .reserve_development_launch(&run, "owner", 1, "codex")
            .await
            .is_err());
        store.bind_development_launch_route(&run,"owner",1,&json!({"selection":{"resolved":{"profileId":"codex"}},"expiresAt":super::super::now_unix_secs()+600,"private":"route"})).await.unwrap();
        store
            .bind_development_launch_baseline(&run, "owner", 1, &"a".repeat(40))
            .await
            .unwrap();
        store
            .reserve_development_tokens(
                "goal",
                "allocation",
                super::super::development_budget::BudgetPurpose::Implementation,
                1000,
                Some(&run),
            )
            .await
            .unwrap();
        store
            .consume_development_launch(&run, "owner", 1, &launch.worker_id, "private-session")
            .await
            .unwrap();
        assert!(store
            .consume_development_launch(&run, "owner", 1, &launch.worker_id, "other-session")
            .await
            .is_err());
        store
            .mark_development_run_launched(&run, "owner", 1, Some(&launch.worker_id), None)
            .await
            .unwrap();
        store
            .record_development_process_exit(&launch.worker_id, "private-session", Some(0))
            .await
            .unwrap();
        let before = events(&store, &project).await;
        assert!(store
            .record_development_process_exit(&launch.worker_id, "private-session", Some(0))
            .await
            .unwrap()
            .is_none());
        assert_eq!(events(&store, &project).await, before);
        assert_eq!(
            before
                .iter()
                .filter(|(kind, _)| kind == "development_launch")
                .count(),
            5
        );
        assert_eq!(
            before
                .iter()
                .filter(|(kind, _)| kind == "development_run")
                .count(),
            4
        );
        assert_eq!(
            before
                .iter()
                .filter(|(kind, _)| kind == "token_budget")
                .count(),
            2
        );
        assert!(!serde_json::to_string(&before).unwrap().contains("private"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn migration_marks_existing_runtime_once_and_preserves_events_after_reopen() {
        let (dir, store, project, run) = fixture().await;
        let triggers: Vec<(String,)> = sqlx::query_as(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE '%_journal_%'",
        )
        .fetch_all(&store.pool)
        .await
        .unwrap();
        assert_eq!(triggers.len(), 11);
        for (name,) in triggers {
            sqlx::query(&format!("DROP TRIGGER {name}"))
                .execute(&store.pool)
                .await
                .unwrap();
        }
        sqlx::query("DELETE FROM continuous_events")
            .execute(&store.pool)
            .await
            .unwrap();
        for statement in [
            "DROP TABLE development_identity_observations",
            "DROP TABLE development_execution_identities",
            "DROP TABLE development_plan_revisions",
            "DROP TABLE development_plans",
            "DROP TABLE development_capture_results",
            "DROP TABLE development_capture_checkpoints",
            "DROP TABLE development_capture_owners",
            "DROP TABLE development_deliveries",
            "DROP INDEX development_process_instance_unique",
            "ALTER TABLE development_launches DROP COLUMN process_instance",
            "DROP TRIGGER development_launch_baseline_journal",
            "ALTER TABLE development_launches DROP COLUMN baseline_commit",
            "DROP TABLE continuous_supervisor_blocks",
            "DROP TABLE continuous_supervisor",
            "DROP TABLE continuous_team_assignments",
            "DROP TABLE continuous_discovery",
        ] {
            sqlx::query(statement).execute(&store.pool).await.unwrap();
        }
        sqlx::query("PRAGMA user_version=11")
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query("UPDATE continuous_context_snapshots SET source_timestamp=1")
            .execute(&store.pool)
            .await
            .unwrap();
        store.pool.close().await;
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let notices = events(&store, &project).await;
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].0, "runtime_resync");
        assert_eq!(notices[0].1["schemaVersion"], 12);
        let snapshot: (i64,) = sqlx::query_as(
            "SELECT source_timestamp FROM continuous_context_snapshots WHERE project_id=?",
        )
        .bind(&project)
        .fetch_one(&store.pool)
        .await
        .unwrap();
        let marker: (i64,) = sqlx::query_as(
            "SELECT created_at FROM continuous_events WHERE project_id=? AND kind='runtime_resync'",
        )
        .bind(&project)
        .fetch_one(&store.pool)
        .await
        .unwrap();
        assert_eq!(snapshot.0, marker.0);
        store
            .fail_development_run(&run, "owner", 1, "private-failure")
            .await
            .unwrap();
        let notices = events(&store, &project).await;
        assert_eq!(notices.len(), 2);
        assert_eq!(notices[1].0, "development_run");
        store.pool.close().await;
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        assert_eq!(events(&store, &project).await, notices);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn runtime_journal_tracks_committed_changes_without_payloads_or_retry_noise() {
        let (_dir, store, project, run) = fixture().await;
        assert_eq!(
            events(&store, &project).await,
            vec![(
                "development_run".into(),
                json!({"version":1,"action":"insert","runId":run,"recordId":run})
            )]
        );
        store
            .record_development_run_intent("task", "owner", 1)
            .await
            .unwrap();
        sqlx::query("UPDATE development_runs SET updated_at=updated_at+1")
            .execute(&store.pool)
            .await
            .unwrap();
        assert_eq!(events(&store, &project).await.len(), 1);
        store
            .bind_development_run_candidate(&run, "owner", 1, COMMIT_A, "private-source", 7)
            .await
            .unwrap();
        let input = EvidenceInput {
            idempotency_key: "key".into(),
            source: "private-source".into(),
            observed_at: 7,
            candidate_commit: COMMIT_A.into(),
            measurement: EvidenceMeasurement::Measured {
                value: json!({"private":"measurement"}),
            },
            payload: json!({"private":"payload"}),
        };
        let saved = store
            .record_development_evidence(&run, "owner", 1, input.clone())
            .await
            .unwrap();
        store
            .record_development_evidence(&run, "owner", 1, input)
            .await
            .unwrap();
        let review = ReviewInput {
            idempotency_key: "review".into(),
            evidence_id: saved.id,
            candidate_commit: COMMIT_A.into(),
            disposition: ReviewDisposition::Approved,
            source: "private-source".into(),
            observed_at: 8,
        };
        // A review is written with the reviewer's own run credential.
        sqlx::query("INSERT INTO continuous_tasks(id,goal_id,objective,owned_paths_json,dependencies_json,status,claim_owner,claim_fence,created_at,updated_at) VALUES('review','goal','review','[]','[]','running','reviewer',1,1,1)").execute(&store.pool).await.unwrap();
        let reviewer = store
            .record_development_run_intent("review", "reviewer", 1)
            .await
            .unwrap()
            .id;
        store
            .record_development_review(&reviewer, "reviewer", 1, review.clone())
            .await
            .unwrap();
        store
            .record_development_review(&reviewer, "reviewer", 1, review)
            .await
            .unwrap();
        assert_eq!(events(&store, &project).await.len(), 5);
        store
            .bind_development_run_candidate(&run, "owner", 1, COMMIT_B, "git", 9)
            .await
            .unwrap();
        let all = events(&store, &project).await;
        assert_eq!(all.len(), 8);
        for kind in [
            "development_candidate",
            "development_evidence",
            "development_review",
        ] {
            assert_eq!(
                all.iter()
                    .filter(|(k, v)| k == kind && v["action"] == "update")
                    .count(),
                1
            );
        }
        assert!(!serde_json::to_string(&all).unwrap().contains("private"));
        let other = store.create_project("other", "other").await.unwrap();
        assert!(events(&store, &other.id).await.is_empty());
        let mut tx = store.pool.begin().await.unwrap();
        sqlx::query("UPDATE development_runs SET status='failed'")
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.rollback().await.unwrap();
        assert_eq!(events(&store, &project).await, all);
        sqlx::query("CREATE TRIGGER reject_event BEFORE INSERT ON continuous_events BEGIN SELECT RAISE(ABORT,'journal unavailable'); END").execute(&store.pool).await.unwrap();
        assert!(store
            .fail_development_run(&run, "owner", 1, "failure")
            .await
            .is_err());
        assert_eq!(
            store
                .get_development_run(&run)
                .await
                .unwrap()
                .unwrap()
                .status,
            "intent"
        );
    }
}
