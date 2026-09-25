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

/// Status mapping for the bounded set of plan Store errors. Unknown errors stay 500.
pub fn error_status(reason: &str) -> u16 {
    if reason.starts_with("unknown project")
        || reason.starts_with("plan source docs/PLAN.md: unknown project")
        || reason.starts_with("plan source docs/PLAN.md: missing")
        || reason.starts_with("plan source docs/PLAN.md: project_root_unavailable")
    {
        404
    } else if reason.contains("projection revision conflict")
        || reason.contains("already bound")
        || reason.contains("nonempty rollback reason")
    {
        409
    } else if reason.starts_with("invalid plan source")
        || reason.starts_with("plan source docs/PLAN.md: outside_project")
        || reason.starts_with("plan source docs/PLAN.md: not_regular_file")
        || reason.starts_with("plan source docs/PLAN.md: oversized")
        || reason.starts_with("plan source docs/PLAN.md: invalid_utf8")
        || reason.starts_with("plan source docs/PLAN.md: unreadable")
        || reason.starts_with("plan source docs/PLAN.md: file_identity_unavailable")
    {
        422
    } else if reason.starts_with("projectId is required")
        || reason.starts_with("planId is required")
        || reason.starts_with("revision must")
        || reason.starts_with("expectedProjectionRevision must")
    {
        400
    } else {
        500
    }
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
            error_status(
                &import(&store, &project.id, "main", 0, None)
                    .await
                    .unwrap_err()
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
            error_status(
                &import(&store, &project.id, "main", 0, None)
                    .await
                    .unwrap_err()
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

    #[test]
    fn plan_errors_have_distinct_http_statuses() {
        for (reason, status) in [
            ("unknown project", 404),
            ("unknown project or plan", 404),
            ("unknown project, plan or projection revision", 404),
            ("plan source docs/PLAN.md: unknown project", 404),
            ("plan source docs/PLAN.md: missing", 404),
            (
                "plan source docs/PLAN.md: project_root_unavailable: registered path is empty",
                404,
            ),
            ("plan projection revision conflict", 409),
            ("plan source path is already bound to another path", 409),
            (
                "reimport of historic source requires a nonempty rollback reason",
                409,
            ),
            ("invalid plan source docs/PLAN.md:1: bad table", 422),
            ("plan source docs/PLAN.md: invalid_utf8", 422),
            ("plan source docs/PLAN.md: outside_project", 422),
            ("plan source docs/PLAN.md: not_regular_file", 422),
            ("plan source docs/PLAN.md: oversized", 422),
            ("plan source docs/PLAN.md: unreadable", 422),
            ("plan source docs/PLAN.md: file_identity_unavailable", 422),
            ("plan source docs/PLAN.md: reader task failed: panic", 500),
            ("revision must be a positive integer", 400),
            ("database unavailable", 500),
        ] {
            assert_eq!(error_status(reason), status, "{reason}");
        }
    }
}
