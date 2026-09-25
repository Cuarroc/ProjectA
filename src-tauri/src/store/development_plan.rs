//! Immutable imported plan projections; importing alone grants no runtime authority.
use super::{now_unix_secs, Store};
use crate::development_plan::{parse_plan, PlanPackage};
use serde::{Deserialize, Serialize};
use sqlx::{Sqlite, Transaction};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredPlanPackage {
    #[serde(flatten)]
    pub package: PlanPackage,
    pub removed: bool,
    pub no_new_dispatch: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredPlanProjection {
    pub project_id: String,
    pub plan_id: String,
    pub source_path: String,
    pub source_revision: String,
    pub projection_revision: i64,
    pub source: String,
    pub rollback_reason: Option<String>,
    pub imported_at: i64,
    pub packages: Vec<StoredPlanPackage>,
}

impl Store {
    pub async fn import_project_development_plan(
        &self,
        project: &str,
        plan: &str,
        expected_projection_revision: i64,
        rollback_reason: Option<&str>,
    ) -> Result<StoredPlanProjection, String> {
        const SOURCE_PATH: &str = "docs/PLAN.md";
        let registered = self
            .get_project(project)
            .await
            .map_err(|error| format!("plan source {SOURCE_PATH}: {error}"))?
            .ok_or_else(|| format!("plan source {SOURCE_PATH}: unknown project"))?;
        let repo_path = registered.repo_path;
        if repo_path.trim().is_empty() {
            return Err(format!(
                "plan source {SOURCE_PATH}: project_root_unavailable: registered path is empty"
            ));
        }
        if !std::path::Path::new(&repo_path).is_absolute() {
            return Err(format!(
                "plan source {SOURCE_PATH}: project_root_unavailable: registered path must be absolute"
            ));
        }
        let (source, _digest) = tokio::task::spawn_blocking(move || {
            let root = std::path::Path::new(&repo_path)
                .canonicalize()
                .map_err(|error| {
                    format!("plan source {SOURCE_PATH}: project_root_unavailable: {error}")
                })?;
            if !root.is_dir() {
                return Err(format!(
                    "plan source {SOURCE_PATH}: project_root_unavailable: registered path is not a directory"
                ));
            }
            super::development_runs::guidance::read(&root, SOURCE_PATH)
                .map_err(|reason| format!("plan source {SOURCE_PATH}: {reason}"))
        })
        .await
        .map_err(|error| format!("plan source {SOURCE_PATH}: reader task failed: {error}"))??;
        self.import_development_plan(
            project,
            plan,
            SOURCE_PATH,
            &source,
            expected_projection_revision,
            rollback_reason,
        )
        .await
    }

    pub async fn import_development_plan(
        &self,
        project: &str,
        plan: &str,
        path: &str,
        source: &str,
        expected_projection_revision: i64,
        rollback_reason: Option<&str>,
    ) -> Result<StoredPlanProjection, String> {
        let parsed = parse_plan(project, plan, path, source).map_err(|e| {
            format!(
                "invalid plan source {}:{}: {}",
                e.source_path, e.source_line, e.reason
            )
        })?;
        // Source validation precedes the lock; a current-source no-op preserves its original reason.
        let next = expected_projection_revision
            .checked_add(1)
            .filter(|revision| *revision > 0)
            .ok_or(
                "expectedProjectionRevision must be non-negative and below the maximum integer",
            )?;
        let mut tx = self.pool.begin().await.map_err(db)?;
        // A write lock precedes every CAS read, including the first import of a plan.
        let project_write = sqlx::query("UPDATE projects SET id=id WHERE id=?")
            .bind(project)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        if project_write.rows_affected() != 1 {
            return Err("unknown project".into());
        }
        let current: Option<(String, i64)> = sqlx::query_as(
            "SELECT source_path,revision FROM development_plans WHERE project_id=? AND plan_id=?",
        )
        .bind(project)
        .bind(plan)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?;
        let actual = current.as_ref().map_or(0, |(_, revision)| *revision);
        if actual != expected_projection_revision {
            return Err(format!("plan projection revision conflict: expected {expected_projection_revision}, current {actual}"));
        }
        if current.as_ref().is_some_and(|(bound, _)| bound != path) {
            return Err("plan source path is already bound to another path".into());
        }
        let previous = if actual > 0 {
            Some(read_at(&mut tx, project, plan, actual).await?)
        } else {
            None
        };
        if let Some(prior) = &previous {
            if prior.source_revision == parsed.source_revision {
                return Ok(prior.clone());
            }
        }
        let historic: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM development_plan_revisions WHERE project_id=? AND plan_id=? AND source_revision=?")
            .bind(project).bind(plan).bind(&parsed.source_revision)
            .fetch_one(&mut *tx).await.map_err(db)?;
        let reason = rollback_reason
            .map(str::trim)
            .filter(|reason| !reason.is_empty());
        if historic.0 > 0 && reason.is_none() {
            return Err("reimport of historic source requires a nonempty rollback reason".into());
        }
        let mut packages: Vec<_> = parsed
            .packages
            .into_iter()
            .map(|package| StoredPlanPackage {
                package,
                removed: false,
                no_new_dispatch: false,
            })
            .collect();
        if let Some(prior) = previous {
            for mut old in prior.packages {
                if !packages
                    .iter()
                    .any(|new| new.package.package_id == old.package.package_id)
                {
                    old.removed = true;
                    old.no_new_dispatch = true;
                    packages.push(old);
                }
            }
        }
        let projection = StoredPlanProjection {
            project_id: project.into(),
            plan_id: plan.into(),
            source_path: path.into(),
            source_revision: parsed.source_revision,
            projection_revision: next,
            source: source.into(),
            rollback_reason: reason.map(str::to_owned),
            imported_at: now_unix_secs(),
            packages,
        };
        let encoded =
            serde_json::to_string(&projection).map_err(|e| format!("plan encoding: {e}"))?;
        if actual == 0 {
            sqlx::query("INSERT INTO development_plans(project_id,plan_id,source_path,revision) VALUES(?,?,?,?)")
                .bind(project).bind(plan).bind(path).bind(next).execute(&mut *tx).await.map_err(db)?;
        } else {
            let updated = sqlx::query("UPDATE development_plans SET revision=? WHERE project_id=? AND plan_id=? AND revision=?")
                .bind(next).bind(project).bind(plan).bind(actual).execute(&mut *tx).await.map_err(db)?;
            if updated.rows_affected() != 1 {
                return Err("plan projection revision conflict: current row changed".into());
            }
        }
        sqlx::query("INSERT INTO development_plan_revisions(project_id,plan_id,revision,source_revision,projection_json) VALUES(?,?,?,?,?)")
            .bind(project).bind(plan).bind(next).bind(&projection.source_revision).bind(encoded)
            .execute(&mut *tx).await.map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(projection)
    }

    pub async fn development_plan_current(
        &self,
        project: &str,
        plan: &str,
    ) -> Result<StoredPlanProjection, String> {
        let mut tx = self.pool.begin().await.map_err(db)?;
        let current: Option<(i64,)> = sqlx::query_as(
            "SELECT d.revision FROM development_plans d JOIN projects p ON p.id=d.project_id WHERE d.project_id=? AND d.plan_id=?",
        )
        .bind(project)
        .bind(plan)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?;
        let (revision,) = current.ok_or("unknown project or plan")?;
        read_at(&mut tx, project, plan, revision).await
    }

    pub async fn development_plan_at(
        &self,
        project: &str,
        plan: &str,
        revision: i64,
    ) -> Result<StoredPlanProjection, String> {
        let mut tx = self.pool.begin().await.map_err(db)?;
        read_at(&mut tx, project, plan, revision).await
    }
}

async fn read_at(
    tx: &mut Transaction<'_, Sqlite>,
    project: &str,
    plan: &str,
    revision: i64,
) -> Result<StoredPlanProjection, String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT r.projection_json FROM development_plan_revisions r JOIN projects p ON p.id=r.project_id WHERE r.project_id=? AND r.plan_id=? AND r.revision=?")
        .bind(project).bind(plan).bind(revision).fetch_optional(&mut **tx).await.map_err(db)?;
    serde_json::from_str(&row.ok_or("unknown project, plan or projection revision")?.0)
        .map_err(|e| format!("invalid stored plan projection: {e}"))
}

pub(super) async fn apply_migration(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    sqlx::query("CREATE TABLE development_plans(project_id TEXT NOT NULL REFERENCES projects(id),plan_id TEXT NOT NULL,source_path TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),PRIMARY KEY(project_id,plan_id))")
        .execute(&mut **tx).await.map_err(db)?;
    sqlx::query("CREATE TABLE development_plan_revisions(project_id TEXT NOT NULL,plan_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),source_revision TEXT NOT NULL,projection_json TEXT NOT NULL,PRIMARY KEY(project_id,plan_id,revision),FOREIGN KEY(project_id,plan_id) REFERENCES development_plans(project_id,plan_id))")
        .execute(&mut **tx).await.map_err(db)?;
    Ok(())
}

fn db(error: sqlx::Error) -> String {
    format!("plan storage: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;
    use std::collections::BTreeSet;
    use std::sync::Arc;
    use tokio::sync::Barrier;

    const SOURCE: &str = "| ID | Paket / Agent / Scope | Nach | Konkretes Ergebnis und Abnahme |\n| --- | --- | --- | --- |\n| A | First | — | Pass |\n| B | Second | A | Pass |";
    const HEADER: &str = "| ID | Paket / Agent / Scope | Nach | Konkretes Ergebnis und Abnahme |\n| --- | --- | --- | --- |\n";
    fn source(rows: &str) -> String {
        format!("{HEADER}{rows}")
    }
    fn keys(value: &serde_json::Value) -> BTreeSet<&str> {
        value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect()
    }
    async fn fixture(name: &str) -> (TempDir, Store, String) {
        let dir = TempDir::new(name);
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let project = store
            .create_project(name, &dir.path().to_string_lossy())
            .await
            .unwrap();
        (dir, store, project.id)
    }

    fn write_project_plan(dir: &TempDir, bytes: &[u8]) {
        std::fs::create_dir_all(dir.path().join("docs")).unwrap();
        std::fs::write(dir.path().join("docs/PLAN.md"), bytes).unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn project_file_import_preserves_cas_noop_and_exact_source() {
        let (dir, store, project) = fixture("plan-file-import").await;
        write_project_plan(&dir, SOURCE.as_bytes());
        let first = store
            .import_project_development_plan(&project, "main", 0, None)
            .await
            .unwrap();
        assert_eq!(first.source_path, "docs/PLAN.md");
        assert_eq!(first.source, SOURCE);
        assert_eq!(first.projection_revision, 1);
        assert_eq!(
            store
                .import_project_development_plan(&project, "main", 1, None)
                .await
                .unwrap(),
            first
        );
        let changed = source("| A | Changed | — | New pass |");
        write_project_plan(&dir, changed.as_bytes());
        let second = store
            .import_project_development_plan(&project, "main", 1, None)
            .await
            .unwrap();
        assert_eq!(second.source, changed);
        assert_eq!(second.projection_revision, 2);
        assert_ne!(second.source_revision, first.source_revision);
        assert!(store
            .import_project_development_plan(&project, "main", 1, None)
            .await
            .unwrap_err()
            .contains("conflict"));
        assert_eq!(
            store
                .development_plan_current(&project, "main")
                .await
                .unwrap(),
            second
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn unavailable_project_file_never_changes_projection() {
        let (dir, store, project) = fixture("plan-file-unavailable").await;
        let path = "docs/PLAN.md";
        let unknown = store
            .import_project_development_plan("unknown", "main", 0, None)
            .await
            .unwrap_err();
        assert!(
            unknown.contains(path) && unknown.contains("unknown project"),
            "{unknown}"
        );
        assert!(store
            .import_project_development_plan(&project, "main", 0, None)
            .await
            .unwrap_err()
            .contains("missing"));
        write_project_plan(&dir, SOURCE.as_bytes());
        let first = store
            .import_project_development_plan(&project, "main", 0, None)
            .await
            .unwrap();
        std::fs::remove_file(dir.path().join(path)).unwrap();
        let missing = store
            .import_project_development_plan(&project, "main", 1, None)
            .await
            .unwrap_err();
        assert!(
            missing.contains(path) && missing.contains("missing"),
            "{missing}"
        );
        assert_eq!(
            store
                .development_plan_current(&project, "main")
                .await
                .unwrap(),
            first
        );
        for (invalid, reason) in [
            (vec![0xff], "invalid_utf8"),
            (vec![b'x'; 262_145], "oversized"),
        ] {
            write_project_plan(&dir, &invalid);
            let error = store
                .import_project_development_plan(&project, "main", 1, None)
                .await
                .unwrap_err();
            assert!(error.contains(path) && error.contains(reason), "{error}");
            assert_eq!(
                store
                    .development_plan_current(&project, "main")
                    .await
                    .unwrap(),
                first
            );
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn project_file_import_accepts_exact_reader_limit() {
        let (dir, store, project) = fixture("plan-file-exact-limit").await;
        let mut exact = SOURCE.to_string();
        exact.push('\n');
        exact.push_str(&" ".repeat(262_144 - exact.len()));
        assert_eq!(exact.len(), 262_144);
        write_project_plan(&dir, exact.as_bytes());
        let imported = store
            .import_project_development_plan(&project, "main", 0, None)
            .await
            .unwrap();
        assert_eq!(imported.source, exact);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn unavailable_root_and_nonregular_project_plan_are_explicit() {
        let dir = TempDir::new("plan-file-invalid-root");
        let store = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        let missing_root = dir.path().join("missing-root");
        let project = store
            .create_project("missing-root", &missing_root.to_string_lossy())
            .await
            .unwrap();
        let error = store
            .import_project_development_plan(&project.id, "main", 0, None)
            .await
            .unwrap_err();
        assert!(
            error.contains("docs/PLAN.md") && error.contains("project_root_unavailable"),
            "{error}"
        );

        let project = store.create_project("empty-root", "").await.unwrap();
        let error = store
            .import_project_development_plan(&project.id, "main", 0, None)
            .await
            .unwrap_err();
        assert!(error.contains("project_root_unavailable"), "{error}");
        let project = store
            .create_project("relative-root", "relative-root")
            .await
            .unwrap();
        let error = store
            .import_project_development_plan(&project.id, "main", 0, None)
            .await
            .unwrap_err();
        assert!(
            error.contains("project_root_unavailable") && error.contains("absolute"),
            "{error}"
        );
        let root_file = dir.path().join("registered-file");
        std::fs::write(&root_file, "not a repository").unwrap();
        let project = store
            .create_project("file-root", &root_file.to_string_lossy())
            .await
            .unwrap();
        let error = store
            .import_project_development_plan(&project.id, "main", 0, None)
            .await
            .unwrap_err();
        assert!(error.contains("project_root_unavailable"), "{error}");

        std::fs::create_dir_all(dir.path().join("docs/PLAN.md")).unwrap();
        let project = store
            .create_project("nonregular-plan", &dir.path().to_string_lossy())
            .await
            .unwrap();
        let error = store
            .import_project_development_plan(&project.id, "main", 0, None)
            .await
            .unwrap_err();
        assert!(
            error.contains("docs/PLAN.md") && error.contains("not_regular_file"),
            "{error}"
        );
    }

    #[cfg(any(windows, target_os = "linux"))]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn external_project_plan_symlink_cannot_replace_current_projection() {
        let (dir, store, project) = fixture("plan-file-external-link").await;
        write_project_plan(&dir, SOURCE.as_bytes());
        let first = store
            .import_project_development_plan(&project, "main", 0, None)
            .await
            .unwrap();
        let other = TempDir::new("plan-file-outside");
        let outside = other.path().join("PLAN.md");
        std::fs::write(&outside, source("| A | Outside | — | Reject |")).unwrap();
        let link = dir.path().join("docs/PLAN.md");
        std::fs::remove_file(&link).unwrap();
        #[cfg(target_os = "linux")]
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        #[cfg(windows)]
        if let Err(error) = std::os::windows::fs::symlink_file(&outside, &link) {
            if error.raw_os_error() == Some(1314) {
                eprintln!("skipped: Windows symlink privilege unavailable: {error}");
                return;
            }
            panic!("failed to create test symlink: {error}");
        }
        let error = store
            .import_project_development_plan(&project, "main", 1, None)
            .await
            .unwrap_err();
        assert!(
            error.contains("docs/PLAN.md") && error.contains("outside_project"),
            "{error}"
        );
        assert_eq!(
            store
                .development_plan_current(&project, "main")
                .await
                .unwrap(),
            first
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn import_is_durable_and_removed_package_is_retained() {
        let dir = TempDir::new("development-plan");
        let db = dir.path().join("projecta.db");
        let store = Store::open(&db).await.unwrap();
        let project = store
            .create_project("plan", &dir.path().to_string_lossy())
            .await
            .unwrap();
        let first = store
            .import_development_plan(&project.id, "plan", "docs/PLAN.md", SOURCE, 0, None)
            .await
            .unwrap();
        assert_eq!(first.projection_revision, 1);
        assert_eq!(first.packages.len(), 2);
        store.pool.close().await;
        let store = Store::open(&db).await.unwrap();
        assert_eq!(
            store
                .development_plan_at(&project.id, "plan", 1)
                .await
                .unwrap(),
            first
        );
        assert_eq!(
            store
                .development_plan_current(&project.id, "plan")
                .await
                .unwrap(),
            first
        );
        let json = serde_json::to_value(&first).unwrap();
        assert_eq!(
            keys(&json),
            BTreeSet::from([
                "importedAt",
                "packages",
                "planId",
                "projectId",
                "projectionRevision",
                "rollbackReason",
                "source",
                "sourcePath",
                "sourceRevision",
            ])
        );
        assert_eq!(
            keys(&json["packages"][0]),
            BTreeSet::from([
                "acceptance",
                "dependencyIds",
                "noNewDispatch",
                "packageId",
                "parentId",
                "planId",
                "projectId",
                "removed",
                "sourceLine",
                "sourcePath",
                "sourceRevision",
                "title",
            ])
        );
        assert_eq!(json["projectId"], project.id);
        assert_eq!(json["projectionRevision"], 1);
        assert_eq!(json["packages"][0]["packageId"], "A");
        assert_eq!(json["packages"][0]["sourceLine"], 3);
        assert_eq!(json["packages"][0]["noNewDispatch"], false);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cas_noop_tombstones_and_rollback_keep_every_revision() {
        let (dir, store, project) = fixture("plan-history").await;
        let import = |text: String, expected, reason| {
            let store = &store;
            let project = &project;
            async move {
                store
                    .import_development_plan(
                        project,
                        "main",
                        "docs/PLAN.md",
                        &text,
                        expected,
                        reason,
                    )
                    .await
            }
        };
        let first = import(SOURCE.into(), 0, None).await.unwrap();
        assert_eq!(import(SOURCE.into(), 1, None).await.unwrap(), first);
        assert_eq!(
            import(SOURCE.into(), 1, Some("ignored on no-op"))
                .await
                .unwrap(),
            first
        );
        assert!(import(SOURCE.into(), 0, None)
            .await
            .unwrap_err()
            .contains("conflict"));
        assert!(store
            .import_development_plan(&project, "main", "other.md", SOURCE, 1, None)
            .await
            .unwrap_err()
            .contains("path"));
        let changed = source("| A | Renamed | — | New pass |");
        let second = import(changed, 1, None).await.unwrap();
        assert_eq!(second.projection_revision, 2);
        let removed = second
            .packages
            .iter()
            .find(|p| p.package.package_id == "B")
            .unwrap();
        assert!(removed.removed && removed.no_new_dispatch);
        assert_eq!(removed.package.source_revision, first.source_revision);
        assert_eq!(removed.package.source_line, 4);
        assert_eq!(
            store
                .development_plan_at(&project, "main", 1)
                .await
                .unwrap(),
            first
        );
        assert!(import(SOURCE.into(), 2, None)
            .await
            .unwrap_err()
            .contains("rollback reason"));
        assert!(import(SOURCE.into(), 2, Some("  "))
            .await
            .unwrap_err()
            .contains("rollback reason"));
        assert!(import(SOURCE.into(), 1, Some("restore"))
            .await
            .unwrap_err()
            .contains("conflict"));
        let third = import(SOURCE.into(), 2, Some("restore after review"))
            .await
            .unwrap();
        assert_eq!(third.projection_revision, 3);
        assert_eq!(
            third.rollback_reason.as_deref(),
            Some("restore after review")
        );
        assert!(
            !third
                .packages
                .iter()
                .find(|p| p.package.package_id == "B")
                .unwrap()
                .removed
        );
        assert_eq!(
            store
                .development_plan_at(&project, "main", 2)
                .await
                .unwrap(),
            second
        );
        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM development_plan_revisions WHERE project_id=?")
                .bind(&project)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(count, 3);
        assert!(store
            .development_plan_at(&project, "main", 4)
            .await
            .is_err());
        store.pool.close().await;
        let reopened = Store::open(&dir.path().join("projecta.db")).await.unwrap();
        for (revision, expected) in [(1, first), (2, second), (3, third.clone())] {
            assert_eq!(
                reopened
                    .development_plan_at(&project, "main", revision)
                    .await
                    .unwrap(),
                expected
            );
        }
        assert_eq!(
            reopened
                .development_plan_current(&project, "main")
                .await
                .unwrap(),
            third
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn suppressed_revision_update_cannot_append_history() {
        let (_dir, store, project) = fixture("plan-suppressed-update").await;
        let first = store
            .import_development_plan(&project, "main", "docs/PLAN.md", SOURCE, 0, None)
            .await
            .unwrap();
        sqlx::query("CREATE TRIGGER suppress_plan_revision BEFORE UPDATE ON development_plans BEGIN SELECT RAISE(IGNORE); END")
            .execute(&store.pool).await.unwrap();
        let changed = source("| A | Changed | — | New pass |");
        assert!(store
            .import_development_plan(&project, "main", "docs/PLAN.md", &changed, 1, None)
            .await
            .unwrap_err()
            .contains("conflict"));
        assert_eq!(
            store
                .development_plan_current(&project, "main")
                .await
                .unwrap(),
            first
        );
        assert!(store
            .development_plan_at(&project, "main", 2)
            .await
            .is_err());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn invalid_and_unknown_inputs_never_create_history() {
        let (_dir, store, project) = fixture("plan-invalid").await;
        assert!(store
            .import_development_plan(&project, "main", "docs/PLAN.md", "bad source", 0, None)
            .await
            .unwrap_err()
            .contains("invalid plan source"));
        assert!(store
            .import_development_plan("missing", "main", "docs/PLAN.md", SOURCE, 0, None)
            .await
            .unwrap_err()
            .contains("unknown project"));
        assert!(store
            .import_development_plan(&project, "main", "docs/PLAN.md", SOURCE, -1, None)
            .await
            .unwrap_err()
            .contains("expectedProjectionRevision"));
        assert!(store
            .import_development_plan(&project, "main", "docs/PLAN.md", SOURCE, i64::MAX, None)
            .await
            .unwrap_err()
            .contains("expectedProjectionRevision"));
        assert!(store
            .import_development_plan(&project, "main", "docs/PLAN.md", SOURCE, 1, None)
            .await
            .unwrap_err()
            .contains("conflict"));
        assert!(store
            .development_plan_current(&project, "main")
            .await
            .is_err());
        assert!(store
            .development_plan_at(&project, "main", 1)
            .await
            .is_err());
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM development_plan_revisions")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn plans_are_project_scoped_and_concurrent_cas_has_one_winner() {
        let (_dir, store, project) = fixture("plan-concurrent").await;
        let other = store.create_project("other", "other-path").await.unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let race = |text: String| {
            let store = store.clone();
            let project = project.clone();
            let barrier = barrier.clone();
            tokio::spawn(async move {
                barrier.wait().await;
                store
                    .import_development_plan(&project, "main", "docs/PLAN.md", &text, 0, None)
                    .await
            })
        };
        let a = race(SOURCE.into());
        let b = race(source("| A | Rival | — | Different pass |"));
        barrier.wait().await;
        let (a, b) = tokio::join!(a, b);
        let (a, b) = (a.unwrap(), b.unwrap());
        assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
        let winner = a.as_ref().ok().or(b.as_ref().ok()).unwrap();
        let loser = a.as_ref().err().or(b.as_ref().err()).unwrap();
        assert!(loser.contains("conflict"), "{loser}");
        assert_eq!(
            store
                .development_plan_current(&project, "main")
                .await
                .unwrap(),
            *winner
        );
        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM development_plan_revisions WHERE project_id=?")
                .bind(&project)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(count, 1);
        assert!(store
            .development_plan_current(&other.id, "main")
            .await
            .is_err());
        let other_first = store
            .import_development_plan(&other.id, "main", "docs/PLAN.md", SOURCE, 0, None)
            .await
            .unwrap();
        assert_eq!(other_first.projection_revision, 1);
        assert_ne!(other_first.project_id, project);
    }
}
