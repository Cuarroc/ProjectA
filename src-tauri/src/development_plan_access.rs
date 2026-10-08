//! Read/import access shared by the local HTTP API and Tauri IPC.
use crate::store::{development_plan::StoredPlanProjection, now_unix_secs, Store};
use serde_json::{json, Value};

fn required_id<'a>(value: &'a str, field: &str) -> Result<&'a str, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(format!("{field} is required"))
    } else {
        Ok(trimmed)
    }
}

fn envelope(projection: StoredPlanProjection) -> Value {
    json!({
        "contractVersion": 1,
        "availability": "available",
        "generatedAt": now_unix_secs(),
        "projectId": projection.project_id,
        "sourceRevision": projection.source_revision,
        "projection": projection,
    })
}

pub async fn read(
    store: &Store,
    project_id: &str,
    plan_id: &str,
    revision: Option<i64>,
) -> Result<Value, String> {
    let project_id = required_id(project_id, "projectId")?;
    let plan_id = required_id(plan_id, "planId")?;
    let projection = match revision {
        Some(revision) if revision > 0 => {
            store
                .development_plan_at(project_id, plan_id, revision)
                .await?
        }
        Some(_) => return Err("revision must be a positive integer".into()),
        None => store.development_plan_current(project_id, plan_id).await?,
    };
    Ok(envelope(projection))
}

pub async fn import(
    store: &Store,
    project_id: &str,
    plan_id: &str,
    expected_projection_revision: i64,
    rollback_reason: Option<&str>,
) -> Result<Value, String> {
    let project_id = required_id(project_id, "projectId")?;
    let plan_id = required_id(plan_id, "planId")?;
    if !(0..i64::MAX).contains(&expected_projection_revision) {
        return Err(
            "expectedProjectionRevision must be non-negative and below the maximum integer".into(),
        );
    }
    let projection = store
        .import_project_development_plan(
            project_id,
            plan_id,
            expected_projection_revision,
            rollback_reason,
        )
        .await?;
    Ok(envelope(projection))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    const SOURCE: &str = "| ID | Paket / Agent / Scope | Nach | Konkretes Ergebnis und Abnahme |\n| --- | --- | --- | --- |\n| A | First | — | Pass |";

    #[tokio::test]
    async fn shared_access_imports_and_reads_exact_revisions_without_partial_writes() {
        let dir = TempDir::new("plan-access");
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let project = store
            .create_project("plan-access", &dir.path().to_string_lossy())
            .await
            .unwrap();
        assert_eq!(
            read(&store, &project.id, "main", None).await.unwrap_err(),
            "unknown project or plan"
        );
        std::fs::create_dir_all(dir.path().join("docs")).unwrap();
        std::fs::write(dir.path().join("docs/PLAN.md"), "invalid source").unwrap();
        assert_eq!(
            crate::api::error_status(
                &import(&store, &project.id, "main", 0, None)
                    .await
                    .unwrap_err(),
                crate::api::StatusPolicy::Plan
            ),
            422
        );
        assert_eq!(
            read(&store, &project.id, "main", None).await.unwrap_err(),
            "unknown project or plan"
        );
        std::fs::write(dir.path().join("docs/PLAN.md"), SOURCE).unwrap();
        let first = import(&store, &project.id, "main", 0, None).await.unwrap();
        assert_eq!(first["contractVersion"], 1);
        assert_eq!(first["availability"], "available");
        assert_eq!(first["projectId"], project.id);
        assert_eq!(first["projection"]["source"], SOURCE);
        assert_eq!(first["projection"]["projectionRevision"], 1);
        assert_eq!(
            read(&store, &project.id, "main", None).await.unwrap()["sourceRevision"],
            first["sourceRevision"]
        );
        assert_eq!(
            crate::api::error_status(
                &import(&store, &project.id, "main", 0, None)
                    .await
                    .unwrap_err(),
                crate::api::StatusPolicy::Plan
            ),
            409
        );
        let changed = SOURCE.replace("First", "Changed");
        std::fs::write(dir.path().join("docs/PLAN.md"), changed).unwrap();
        let second = import(&store, &project.id, "main", 1, None).await.unwrap();
        assert_eq!(second["projection"]["projectionRevision"], 2);
        assert_eq!(
            read(&store, &project.id, "main", Some(1)).await.unwrap()["sourceRevision"],
            first["sourceRevision"]
        );
        assert_eq!(
            read(&store, &project.id, "main", None).await.unwrap()["sourceRevision"],
            second["sourceRevision"]
        );
    }
}
