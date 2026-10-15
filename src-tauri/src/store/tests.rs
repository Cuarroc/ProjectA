    use super::*;
    use crate::testutil::TempDir;
    use std::path::Path;

    async fn store() -> (TempDir, Store) {
        let dir = TempDir::new("store");
        let store = Store::open(&dir.path().join("projecta.db"))
            .await
            .expect("open store");
        (dir, store)
    }

    // -- schema versioning & the migration contract (Phase A) ---------------

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_fresh_database_is_created_at_the_current_schema_version() {
        let dir = TempDir::new("store-fresh-version");
        let store = Store::open(&dir.path().join("projecta.db"))
            .await
            .expect("open store");
        assert_eq!(store.user_version().await.unwrap(), target_schema_version());
        // The baseline really ran, and the database is usable.
        assert!(store.table_exists("projects").await.unwrap());
        assert!(store.table_exists("questions").await.unwrap());
        store.create_project("one", "C:/repos/one").await.unwrap();
        assert_eq!(store.list_projects().await.unwrap().len(), 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_pre_contract_database_is_adopted_without_a_schema_re_run() {
        let dir = TempDir::new("store-adopt-pre-contract");
        let path = dir.path().join("projecta.db");
        {
            // What every database in the field looks like: tables written by
            // `CREATE TABLE IF NOT EXISTS` runs and no `user_version`. The
            // stub deliberately lacks every column the baseline would add, so
            // a re-run would be visible. `workers` is there too - a field
            // database has one - so the numbered steps have their table.
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(
                    SqliteConnectOptions::new()
                        .filename(&path)
                        .create_if_missing(true),
                )
                .await
                .expect("connect stub");
            sqlx::query("CREATE TABLE projects (id TEXT PRIMARY KEY, payload TEXT)")
                .execute(&pool)
                .await
                .expect("create stub table");
            sqlx::query("CREATE TABLE workers (id TEXT PRIMARY KEY, payload TEXT)")
                .execute(&pool)
                .await
                .expect("create stub workers table");
            // Migration 24 guards queue transitions; this baseline table
            // exists in field databases too, without re-running baseline.
            sqlx::query("CREATE TABLE task_queue (id TEXT PRIMARY KEY, status TEXT)")
                .execute(&pool)
                .await
                .expect("create stub queue table");
            sqlx::query("INSERT INTO projects (id, payload) VALUES ('pj-1', 'keep me')")
                .execute(&pool)
                .await
                .expect("insert stub row");
            pool.close().await;
        }

        let store = Store::open(&path).await.expect("open store");
        assert_eq!(store.user_version().await.unwrap(), target_schema_version());

        // Adopted, not rebuilt: the version moved and the row stayed, but the
        // baseline did NOT run - the stub table is exactly as it was.
        let columns: Vec<(i64, String)> = sqlx::query_as("PRAGMA table_info(projects)")
            .fetch_all(&store.pool)
            .await
            .unwrap();
        assert_eq!(
            columns
                .iter()
                .map(|(_, name)| name.as_str())
                .collect::<Vec<_>>(),
            vec!["id", "payload"],
            "adoption must not re-run the baseline"
        );
        // ... while the numbered steps after the baseline did run, on their
        // own table: the stub's `workers` grew exactly the migrated column.
        let columns: Vec<(i64, String)> = sqlx::query_as("PRAGMA table_info(workers)")
            .fetch_all(&store.pool)
            .await
            .unwrap();
        assert_eq!(
            columns
                .iter()
                .map(|(_, name)| name.as_str())
                .collect::<Vec<_>>(),
            vec!["id", "payload", "merge_state"],
            "the pending migration steps must run on an adopted database"
        );
        let (payload,): (String,) =
            sqlx::query_as("SELECT payload FROM projects WHERE id = 'pj-1'")
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(payload, "keep me");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn reopening_a_migrated_database_changes_nothing() {
        let dir = TempDir::new("store-reopen-idempotent");
        let path = dir.path().join("projecta.db");
        let backup_count = || {
            std::fs::read_dir(dir.path())
                .unwrap()
                .filter_map(|entry| entry.ok())
                .filter(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .contains(".pre-migration-")
                })
                .count()
        };
        let backups_after_first_open;
        {
            let store = Store::open(&path).await.expect("open store");
            store.create_project("one", "C:/repos/one").await.unwrap();
            assert_eq!(store.user_version().await.unwrap(), target_schema_version());
            // The first open may migrate and back up; that is its job.
            backups_after_first_open = backup_count();
        }

        let store = Store::open(&path).await.expect("reopen store");
        assert_eq!(store.user_version().await.unwrap(), target_schema_version());
        assert_eq!(store.list_projects().await.unwrap().len(), 1);
        // Nothing migrated on the second open, so nothing was backed up either.
        assert_eq!(backup_count(), backups_after_first_open);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_database_from_a_newer_build_is_refused() {
        let dir = TempDir::new("store-too-new");
        let path = dir.path().join("projecta.db");
        {
            let store = Store::open(&path).await.expect("open store");
            sqlx::query(&format!(
                "PRAGMA user_version = {}",
                target_schema_version() + 1
            ))
            .execute(&store.pool)
            .await
            .expect("bump version");
        }

        let err = match Store::open(&path).await {
            Ok(_) => panic!("a newer database must be refused"),
            Err(err) => err,
        };
        assert!(err.contains("newer than this build"), "{err}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn backup_includes_committed_wal_while_an_old_reader_prevents_checkpoint() {
        let dir = TempDir::new("store-backup-wal-contention");
        let path = dir.path().join("projecta.db");
        let store = Store::open(&path).await.unwrap();
        store.create_project("before", "C:/before").await.unwrap();
        let mut reader = store.pool.begin().await.unwrap();
        let _: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM projects")
            .fetch_one(&mut *reader)
            .await
            .unwrap();
        store.create_project("after", "C:/after").await.unwrap();
        let (_, frames, checkpointed): (i64, i64, i64) =
            sqlx::query_as("PRAGMA wal_checkpoint(PASSIVE)")
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert!(
            frames > checkpointed,
            "the reader must pin committed WAL frames"
        );
        let backup = store.backup_database_at(&path, 42).await.unwrap();
        let copy = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&backup)
                    .read_only(true),
            )
            .await
            .unwrap();
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM projects")
            .fetch_one(&copy)
            .await
            .unwrap();
        assert_eq!(count, 2, "backup must include the commit still in WAL");
        copy.close().await;
        reader.rollback().await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn pre_migration_backups_are_complete_copies_and_kept_to_five() {
        let dir = TempDir::new("store-backup-prune");
        let path = dir.path().join("projecta.db");
        let store = Store::open(&path).await.expect("open store");
        let project = store.create_project("one", "C:/repos/one").await.unwrap();

        for ts in 1..=7u128 {
            store.backup_database_at(&path, ts).await.expect("backup");
        }

        let mut names: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains(".pre-migration-"))
            .collect();
        names.sort();
        assert_eq!(names.len(), 5, "only the five newest survive: {names:?}");
        assert!(names[0].ends_with("-3.bak"), "{names:?}");
        assert!(names[4].ends_with("-7.bak"), "{names:?}");

        // Restore probe: copy the newest bak onto a fresh dest with the same
        // file name in another directory. Opening the bak path itself would
        // migrate it in place (F0-7).
        let bak = dir.path().join(&names[4]);
        let bak_before = std::fs::read(&bak).expect("bak before restore");
        let restored_dir = dir.path().join("restored");
        std::fs::create_dir_all(&restored_dir).unwrap();
        let restored = restored_dir.join("projecta.db");
        Store::restore_from_pre_migration_backup(&bak, &restored).expect("restore bak");
        let copy = Store::open(&restored).await.expect("open restored copy");
        let projects = copy.list_projects().await.unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].id, project.id);
        assert_eq!(std::fs::read(&bak).expect("bak still readable"), bak_before);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn restore_leaves_bak_bytes_unchanged() {
        let dir = TempDir::new("store-restore-bak");
        let live = dir.path().join("projecta.db");
        crate::testutil::copy_db_fixture(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("testdata/db/v1.1.1-projecta.db")
                .as_path(),
            &live,
        );
        let bak_hash_before;
        let bak_path;
        {
            let _store = Store::open(&live).await.expect("migrate fixture");
            let backups = Store::list_pre_migration_backups(&live).expect("list");
            assert_eq!(backups.len(), 1, "{backups:?}");
            bak_path = backups[0].clone();
            bak_hash_before = std::fs::read(&bak_path).expect("read bak");
        }
        let dest_dir = dir.path().join("recovered");
        std::fs::create_dir_all(&dest_dir).unwrap();
        let dest = dest_dir.join("projecta.db");
        Store::restore_from_pre_migration_backup(&bak_path, &dest).expect("restore");
        let bak_hash_after = std::fs::read(&bak_path).expect("read bak after");
        assert_eq!(bak_hash_before, bak_hash_after);
        assert_eq!(std::fs::read(&dest).expect("dest"), bak_hash_before);

        let extras: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains(".bak.pre-migration-"))
            .collect();
        assert!(extras.is_empty(), "bak was migrated in place: {extras:?}");

        let recovered = Store::open(&dest).await.expect("open recovered");
        assert_eq!(
            recovered.user_version().await.unwrap(),
            target_schema_version()
        );
        assert_eq!(
            std::fs::read(&bak_path).expect("bak after open dest"),
            bak_hash_before
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_version_bump_inside_a_transaction_rolls_back_with_it() {
        let (_dir, store) = store().await;
        let before = store.user_version().await.unwrap();

        let mut tx = store.pool.begin().await.expect("begin");
        sqlx::query("CREATE TABLE rollback_probe (id INTEGER)")
            .execute(&mut *tx)
            .await
            .expect("create probe table");
        sqlx::query(&format!("PRAGMA user_version = {}", before + 10))
            .execute(&mut *tx)
            .await
            .expect("bump version");
        tx.rollback().await.expect("rollback");

        // The property every migration step relies on: if a step fails, its
        // schema change and its version bump vanish together, and the next
        // start re-enters from the last good version.
        assert_eq!(store.user_version().await.unwrap(), before);
        assert!(!store.table_exists("rollback_probe").await.unwrap());
    }

    // -- F0-Abnahme: three generation fixtures (`.pa/task_f0_db_fixtures.md`)

    const GENERATION_TABLES: [&str; 10] = [
        "projects",
        "workers",
        "task_queue",
        "sessions",
        "questions",
        "messages",
        "usage_events",
        "recommendations",
        "diff_comments",
        "status_events",
    ];

    /// Umlaute, Em-Dash and newlines — the deprecation path in F0 §4 hangs
    /// on these surviving a migration byte-for-byte.
    const GENERATION_LANDING_PAGE: &str =
        "# Übersicht — nächster Schritt\n\nÄgypten, Österreich und eine Straße.\n";

    fn generation_fixture_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("testdata")
            .join("db")
    }

    fn generation_fixture_path(tag: &str) -> PathBuf {
        generation_fixture_dir().join(format!("{tag}-projecta.db"))
    }

    fn generation_sidecar_path(tag: &str) -> PathBuf {
        generation_fixture_dir().join(format!("{tag}-projecta.json"))
    }

    fn load_generation_sidecar(tag: &str) -> serde_json::Value {
        let path = generation_sidecar_path(tag);
        let text = std::fs::read_to_string(&path).unwrap_or_else(|err| {
            panic!(
                "missing generation sidecar {}: {err} — run \
                 `cargo test generate_three_generation_fixtures -- --ignored`",
                path.display()
            )
        });
        serde_json::from_str(&text).expect("sidecar is JSON")
    }

    async fn table_count(store: &Store, table: &str) -> i64 {
        let (count,): (i64,) = sqlx::query_as(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(&store.pool)
            .await
            .unwrap_or_else(|err| panic!("count {table}: {err}"));
        count
    }

    fn pre_migration_backup_count(dir: &Path) -> usize {
        std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".pre-migration-")
            })
            .count()
    }

    async fn seed_generation_inventory(store: &Store) -> serde_json::Value {
        let alpha = store
            .create_project("Alpha", "C:/fixtures/alpha")
            .await
            .unwrap();
        let beta = store
            .create_project("Beta", "C:/fixtures/beta")
            .await
            .unwrap();
        store
            .set_landing_page(&alpha.id, Some(GENERATION_LANDING_PAGE))
            .await
            .unwrap();
        store
            .set_project_test_command(&alpha.id, Some("cargo test --quiet"))
            .await
            .unwrap();

        let worker_pr = WorkerRow {
            id: "wk-pr".to_string(),
            project_id: alpha.id.clone(),
            task: "Öffne den Pull Request".to_string(),
            profile_id: "claude".to_string(),
            branch: "pa/wk-pr".to_string(),
            worktree_path: "C:/fixtures/alpha/.projecta-worktrees/wk-pr".to_string(),
            status: STATUS_EXITED.to_string(),
            kind: KIND_WORKER.to_string(),
            pr_url: Some("https://github.com/example/alpha/pull/7".to_string()),
            spawned_by: None,
            test_status: None,
            tested_at: None,
            role_variant_id: None,
            paused_reason: None,
            created_at: 1_704_067_200,
        };
        let worker_tested = WorkerRow {
            id: "wk-tested".to_string(),
            project_id: alpha.id.clone(),
            task: "Tests grün halten".to_string(),
            profile_id: "codex".to_string(),
            branch: "pa/wk-tested".to_string(),
            worktree_path: "C:/fixtures/alpha/.projecta-worktrees/wk-tested".to_string(),
            status: STATUS_ARCHIVED.to_string(),
            kind: KIND_WORKER.to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: Some(TEST_PASS.to_string()),
            tested_at: Some(1_704_067_260),
            role_variant_id: None,
            paused_reason: None,
            created_at: 1_704_067_210,
        };
        let worker_paused = WorkerRow {
            id: "wk-paused".to_string(),
            project_id: beta.id.clone(),
            task: "Warten auf Kontingent".to_string(),
            profile_id: "claude".to_string(),
            branch: "pa/wk-paused".to_string(),
            worktree_path: "C:/fixtures/beta/.projecta-worktrees/wk-paused".to_string(),
            status: STATUS_RUNNING.to_string(),
            kind: KIND_WORKER.to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: None,
            tested_at: None,
            role_variant_id: None,
            paused_reason: Some("budget_reached".to_string()),
            created_at: 1_704_067_220,
        };
        store.insert_worker(&worker_pr).await.unwrap();
        store.insert_worker(&worker_tested).await.unwrap();
        store.insert_worker(&worker_paused).await.unwrap();

        store
            .insert_queue_entry(&QueueEntry {
                id: "tq-one".to_string(),
                project_id: alpha.id.clone(),
                raw_text: "Erste Queue-Aufgabe".to_string(),
                sharpened_text: Some("Erste geschärfte Aufgabe".to_string()),
                profile_id: "claude".to_string(),
                status: "queued".to_string(),
                priority: 0,
                worker_id: None,
                error: None,
                spawned_by: None,
                created_at: 1_704_067_230,
            })
            .await
            .unwrap();
        store
            .insert_queue_entry(&QueueEntry {
                id: "tq-two".to_string(),
                project_id: beta.id.clone(),
                raw_text: "Zweite Queue-Aufgabe".to_string(),
                sharpened_text: None,
                profile_id: "codex".to_string(),
                status: "queued".to_string(),
                priority: 1,
                worker_id: None,
                error: None,
                spawned_by: None,
                created_at: 1_704_067_240,
            })
            .await
            .unwrap();

        store.bind_session("wk-pr", "sess-one").await;

        store
            .insert_question(&Question {
                id: "q-one".to_string(),
                project_id: alpha.id.clone(),
                worker_id: Some("wk-pr".to_string()),
                scope: QUESTION_WORKER.to_string(),
                question: "Welche Farbe?".to_string(),
                options_json: Some(r#"["rot","blau"]"#.to_string()),
                status: QUESTION_OPEN.to_string(),
                answer: None,
                created_at: 1_704_067_250,
                answered_at: None,
                answered_by: None,
                expires_at: None,
            })
            .await
            .unwrap();

        store
            .insert_recommendation(&Recommendation {
                id: "rec-one".to_string(),
                project_id: alpha.id.clone(),
                title: "README kürzen".to_string(),
                url: Some("https://example.org/readme".to_string()),
                rationale: "Zu lang — der Einstieg verschwindet.".to_string(),
                effort: Some("S".to_string()),
                status: REC_NEW.to_string(),
                created_at: 1_704_067_270,
            })
            .await
            .unwrap();

        let mut counts = serde_json::Map::new();
        for table in GENERATION_TABLES {
            counts.insert(
                table.to_string(),
                serde_json::json!(table_count(store, table).await),
            );
        }

        let row = store.get_worker_row("wk-pr").await.unwrap().unwrap();
        serde_json::json!({
            "counts": counts,
            "landing_page_project_id": alpha.id,
            "landing_page_markdown": GENERATION_LANDING_PAGE,
            "worker": {
                "id": row.id,
                "project_id": row.project_id,
                "task": row.task,
                "profile_id": row.profile_id,
                "branch": row.branch,
                "worktree_path": row.worktree_path,
                "status": row.status,
                "kind": row.kind,
                "pr_url": row.pr_url,
                "spawned_by": row.spawned_by,
                "test_status": row.test_status,
                "tested_at": row.tested_at,
                "role_variant_id": row.role_variant_id,
                "paused_reason": row.paused_reason,
                "created_at": row.created_at,
            }
        })
    }

    async fn checkpoint_and_close(store: Store, path: &Path) {
        sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&store.pool)
            .await
            .expect("checkpoint");
        store.pool.close().await;
        let _ = path;
    }

    /// Stamp a copy as an older generation without going through
    /// [`Store::open`] — that would migrate it.
    async fn stamp_as_older_generation(path: &Path, user_version: i64) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::new().filename(path))
            .await
            .expect("connect fixture copy");
        let columns: Vec<(i64, String)> = sqlx::query_as("PRAGMA table_info(workers)")
            .fetch_all(&pool)
            .await
            .expect("table_info");
        if columns.iter().any(|(_, name)| name == "merge_state") {
            sqlx::query("ALTER TABLE workers DROP COLUMN merge_state")
                .execute(&pool)
                .await
                .expect("drop merge_state so the fixture predates step 2");
        }
        sqlx::query(&format!("PRAGMA user_version = {user_version}"))
            .execute(&pool)
            .await
            .expect("stamp user_version");
        sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&pool)
            .await
            .expect("checkpoint stamped fixture");
        pool.close().await;
    }

    fn write_generation_sidecar(
        tag: &str,
        user_version_on_disk: i64,
        expect_backup: bool,
        inventory: &serde_json::Value,
    ) {
        let mut sidecar = inventory.clone();
        sidecar["tag"] = serde_json::json!(tag);
        sidecar["user_version_on_disk"] = serde_json::json!(user_version_on_disk);
        sidecar["expect_backup"] = serde_json::json!(expect_backup);
        std::fs::create_dir_all(generation_fixture_dir()).expect("testdata/db");
        std::fs::write(
            generation_sidecar_path(tag),
            serde_json::to_string_pretty(&sidecar).expect("sidecar json") + "\n",
        )
        .expect("write sidecar");
    }

    /// Run on a checkout of the named tag (or on current, then stamp older
    /// copies). Writes `src-tauri/testdata/db/<tag>-projecta.db` plus sidecar.
    ///
    /// ```text
    /// cargo test generate_three_generation_fixtures -- --ignored --nocapture
    /// ```
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "writes testdata/db fixtures; run by hand when regenerating"]
    async fn generate_three_generation_fixtures() {
        let dir = TempDir::new("store-generation-seed");
        let path = dir.path().join("projecta.db");
        let store = Store::open(&path).await.expect("open seed store");
        let inventory = seed_generation_inventory(&store).await;
        checkpoint_and_close(store, &path).await;

        std::fs::create_dir_all(generation_fixture_dir()).expect("testdata/db");
        std::fs::copy(&path, generation_fixture_path("v1.2.4")).expect("copy v1.2.4");
        write_generation_sidecar("v1.2.4", 2, false, &inventory);

        for (tag, version, expect_backup) in [("v1.1.1", 1_i64, true), ("v1.0.0", 0, true)] {
            let dest = generation_fixture_path(tag);
            std::fs::copy(&path, &dest).expect("copy older generation");
            stamp_as_older_generation(&dest, version).await;
            write_generation_sidecar(tag, version, expect_backup, &inventory);
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn three_generation_fixtures_open_without_data_loss() {
        for tag in ["v1.0.0", "v1.1.1", "v1.2.4"] {
            let sidecar = load_generation_sidecar(tag);
            let source = generation_fixture_path(tag);
            assert!(
                source.is_file(),
                "missing fixture {} — run `cargo test generate_three_generation_fixtures -- --ignored`",
                source.display()
            );

            let dir = TempDir::new(&format!("store-generation-{tag}"));
            let path = dir.path().join("projecta.db");
            crate::testutil::copy_db_fixture(&source, &path);

            let on_disk: i64 = sidecar["user_version_on_disk"].as_i64().unwrap();
            let before_open = {
                let pool = SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect_with(SqliteConnectOptions::new().filename(&path))
                    .await
                    .expect("peek fixture");
                let (version,): (i64,) = sqlx::query_as("PRAGMA user_version")
                    .fetch_one(&pool)
                    .await
                    .expect("read on-disk version");
                pool.close().await;
                version
            };
            assert_eq!(before_open, on_disk, "{tag}: fixture user_version");

            let store = Store::open(&path).await.expect("open generation fixture");
            assert_eq!(
                store.user_version().await.unwrap(),
                target_schema_version(),
                "{tag}: migrated to target"
            );

            for table in GENERATION_TABLES {
                let expected = sidecar["counts"][table].as_i64().unwrap();
                assert_eq!(
                    table_count(&store, table).await,
                    expected,
                    "{tag}: {table} row count"
                );
            }

            let landing_id = sidecar["landing_page_project_id"].as_str().unwrap();
            assert_eq!(
                store.get_landing_page(landing_id).await.unwrap().as_deref(),
                Some(sidecar["landing_page_markdown"].as_str().unwrap()),
                "{tag}: landing_page_markdown"
            );

            let expected = &sidecar["worker"];
            let row = store
                .get_worker_row(expected["id"].as_str().unwrap())
                .await
                .unwrap()
                .expect("canonical worker");
            assert_eq!(row.project_id, expected["project_id"].as_str().unwrap());
            assert_eq!(row.task, expected["task"].as_str().unwrap());
            assert_eq!(row.profile_id, expected["profile_id"].as_str().unwrap());
            assert_eq!(row.branch, expected["branch"].as_str().unwrap());
            assert_eq!(
                row.worktree_path,
                expected["worktree_path"].as_str().unwrap()
            );
            assert_eq!(row.status, expected["status"].as_str().unwrap());
            assert_eq!(row.kind, expected["kind"].as_str().unwrap());
            assert_eq!(row.pr_url.as_deref(), expected["pr_url"].as_str());
            assert_eq!(
                row.paused_reason.as_deref(),
                expected["paused_reason"].as_str()
            );
            assert_eq!(row.created_at, expected["created_at"].as_i64().unwrap());

            let columns: Vec<(i64, String, String, i64, Option<String>, i64)> =
                sqlx::query_as("PRAGMA table_info(workers)")
                    .fetch_all(&store.pool)
                    .await
                    .unwrap();
            assert!(
                columns
                    .iter()
                    .any(|(_, name, _, _, _, _)| name == "merge_state"),
                "{tag}: merge_state column present after open"
            );
            assert_eq!(
                store.merge_state_for_worker(&row.id).await.unwrap(),
                None,
                "{tag}: merge_state stays NULL"
            );

            let (integrity,): (String,) = sqlx::query_as("PRAGMA integrity_check")
                .fetch_one(&store.pool)
                .await
                .unwrap();
            assert_eq!(integrity, "ok", "{tag}: integrity_check");

            let expect_backup = sidecar["expect_backup"].as_bool().unwrap();
            let backups = pre_migration_backup_count(dir.path());
            if expect_backup {
                assert_eq!(backups, 1, "{tag}: exactly one pre-migration backup");
                let bak = std::fs::read_dir(dir.path())
                    .unwrap()
                    .filter_map(|entry| entry.ok())
                    .map(|entry| entry.path())
                    .find(|path| {
                        path.file_name()
                            .is_some_and(|name| name.to_string_lossy().contains(".pre-migration-"))
                    })
                    .expect("backup path");
                // Open the copy in a fresh directory: Store::open would
                // otherwise migrate the .bak in place and write another
                // pre-migration file next to the fixture under test.
                let bak_dir = TempDir::new(&format!("store-generation-{tag}-bak"));
                let bak_copy = bak_dir.path().join("projecta.db");
                crate::testutil::copy_db_fixture(&bak, &bak_copy);
                let bak_store = Store::open(&bak_copy).await.expect("open backup");
                for table in GENERATION_TABLES {
                    assert_eq!(
                        table_count(&bak_store, table).await,
                        sidecar["counts"][table].as_i64().unwrap(),
                        "{tag}: backup {table}"
                    );
                }
            } else {
                assert_eq!(backups, 0, "{tag}: 2→2 takes the early exit, no backup");
            }

            let backups_after_first = backups;
            drop(store);
            let store = Store::open(&path).await.expect("reopen fixture");
            assert_eq!(store.user_version().await.unwrap(), target_schema_version());
            assert_eq!(
                pre_migration_backup_count(dir.path()),
                backups_after_first,
                "{tag}: second open is a no-op"
            );
            for table in GENERATION_TABLES {
                assert_eq!(
                    table_count(&store, table).await,
                    sidecar["counts"][table].as_i64().unwrap(),
                    "{tag}: idempotent {table}"
                );
            }
        }
    }

    /// Manual migration probe against a copy of the real database
    /// (docs/archive/plaene-2026-09/SANIERUNGSPLAN.md §2.2.4): copies the file named in
    /// `PA_PROD_DB_COPY` (plus its WAL files, if present) into a temp dir and
    /// runs the full migration contract on that copy. The env path is only
    /// ever *read* - never opened by SQLite. Run with:
    /// `PA_PROD_DB_COPY=<path> cargo test production_database -- --ignored --nocapture`
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "needs PA_PROD_DB_COPY pointing at a copy of the real projecta.db"]
    async fn a_copy_of_the_production_database_migrates_cleanly() {
        let source = std::env::var("PA_PROD_DB_COPY")
            .expect("PA_PROD_DB_COPY must name a copy of the real projecta.db");
        let dir = TempDir::new("store-prod-copy");
        let path = dir.path().join("projecta.db");
        std::fs::copy(&source, &path).expect("copy the database");
        for suffix in ["-wal", "-shm"] {
            if Path::new(&format!("{source}{suffix}")).is_file() {
                std::fs::copy(
                    format!("{source}{suffix}"),
                    dir.path().join(format!("projecta.db{suffix}")),
                )
                .expect("copy the WAL sidecar");
            }
        }

        let before: (i64,) = {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(SqliteConnectOptions::new().filename(&path))
                .await
                .expect("connect copy");
            let version = sqlx::query_as("PRAGMA user_version")
                .fetch_one(&pool)
                .await
                .expect("read version");
            pool.close().await;
            version
        };

        let store = Store::open(&path).await.expect("open production copy");
        let after = store.user_version().await.unwrap();
        assert_eq!(after, target_schema_version());
        for table in [
            "projects",
            "workers",
            "task_queue",
            "usage_events",
            "sessions",
            "questions",
        ] {
            assert!(store.table_exists(table).await.unwrap(), "{table} missing");
        }
        let projects = store.list_projects().await.unwrap().len();
        let workers = store.list_workers(None).await.unwrap().len();
        eprintln!(
            "production copy: user_version {} -> {after}, {projects} projects, {workers} workers",
            before.0
        );
        assert!(projects > 0, "the real database has projects");
    }

    fn worker_row(project_id: &str, id: &str) -> WorkerRow {
        WorkerRow {
            id: id.to_string(),
            project_id: project_id.to_string(),
            task: "do the thing".to_string(),
            profile_id: "claude".to_string(),
            branch: format!("pa/{id}"),
            worktree_path: format!("C:/tmp/.projecta-worktrees/{id}"),
            status: STATUS_RUNNING.to_string(),
            kind: KIND_WORKER.to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: None,
            tested_at: None,
            role_variant_id: None,
            paused_reason: None,
            created_at: 42,
        }
    }

    /// Phase 16: `workers.role_variant_id` round-trips both ways. (It used to
    /// also prove repair-on-open for pre-Phase-16 databases; that behavior
    /// ended with the migration contract - adoption is covered above.)
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_role_variant_column_round_trips() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();

        store
            .insert_worker(&WorkerRow {
                role_variant_id: Some("rv-1".to_string()),
                ..worker_row(&project.id, "wk-1")
            })
            .await
            .unwrap();
        store
            .insert_worker(&worker_row(&project.id, "wk-2"))
            .await
            .unwrap();

        let with = store.get_worker_row("wk-1").await.unwrap().unwrap();
        assert_eq!(with.role_variant_id.as_deref(), Some("rv-1"));
        let without = store.get_worker_row("wk-2").await.unwrap().unwrap();
        assert_eq!(without.role_variant_id, None);
        assert!(store.get_worker_row("wk-nope").await.unwrap().is_none());

        // The board rows still come back whole; the column is simply not part
        // of what a `Worker` shows.
        assert_eq!(
            store.list_workers(Some(&project.id)).await.unwrap().len(),
            2
        );
    }

    /// All four shapes a repository can have, because the pair of manifests is
    /// exactly what the detection decides on.
    #[test]
    fn the_test_command_follows_the_manifests_in_the_repository() {
        let dir = TempDir::new("store-detect-test-command");
        let empty = dir.path().join("empty");
        let node = dir.path().join("node");
        let rust = dir.path().join("rust");
        let both = dir.path().join("both");
        for path in [&empty, &node, &rust, &both] {
            std::fs::create_dir_all(path).expect("create repo dir");
        }
        for path in [&node, &both] {
            std::fs::write(path.join("package.json"), "{}").expect("write package.json");
        }
        for path in [&rust, &both] {
            std::fs::write(path.join("Cargo.toml"), "[package]").expect("write Cargo.toml");
        }

        assert_eq!(detect_test_command(&empty), None);
        assert_eq!(detect_test_command(&node).as_deref(), Some("npm test"));
        assert_eq!(
            detect_test_command(&rust).as_deref(),
            Some("cargo test --quiet")
        );
        assert_eq!(
            detect_test_command(&both).as_deref(),
            Some("npm test && cargo test --quiet")
        );
    }

    /// Phase 12: the test-gate columns (`projects.test_command`,
    /// `workers.test_status`, `workers.tested_at`) and the queue's own
    /// `spawned_by` round-trip. (Repair-on-open for pre-Phase-12 databases
    /// ended with the migration contract.)
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_test_gate_columns_round_trip() {
        let (_dir, store) = store().await;
        // A repository path that does not exist carries no manifest, so a
        // project registered against it gets no gate.
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        assert_eq!(project.test_command, None);

        store
            .set_project_test_command(&project.id, Some("npm test"))
            .await
            .unwrap();
        assert_eq!(
            store
                .get_project(&project.id)
                .await
                .unwrap()
                .unwrap()
                .test_command
                .as_deref(),
            Some("npm test")
        );
        assert_eq!(
            store.list_projects().await.unwrap()[0]
                .test_command
                .as_deref(),
            Some("npm test")
        );
        store
            .set_project_test_command(&project.id, None)
            .await
            .unwrap();
        assert_eq!(
            store
                .get_project(&project.id)
                .await
                .unwrap()
                .unwrap()
                .test_command,
            None
        );
        assert!(store
            .set_project_test_command("pj-nope", Some("npm test"))
            .await
            .is_err());

        store
            .insert_worker(&worker_row(&project.id, "wk-1"))
            .await
            .unwrap();
        let fresh = store.get_worker("wk-1").await.unwrap().unwrap();
        assert_eq!(fresh.test_status, None);
        assert_eq!(fresh.tested_at, None);

        store
            .set_worker_test_status("wk-1", Some(TEST_RUNNING), None)
            .await
            .unwrap();
        let running = store.get_worker("wk-1").await.unwrap().unwrap();
        assert_eq!(running.test_status.as_deref(), Some(TEST_RUNNING));
        assert_eq!(running.tested_at, None);

        store
            .set_worker_test_status("wk-1", Some(TEST_PASS), Some(1_700_000_000))
            .await
            .unwrap();
        let passed = store
            .list_workers(Some(&project.id))
            .await
            .unwrap()
            .remove(0);
        assert_eq!(passed.test_status.as_deref(), Some(TEST_PASS));
        assert_eq!(passed.tested_at, Some(1_700_000_000));
        assert!(store
            .set_worker_test_status("wk-nope", Some(TEST_FAIL), None)
            .await
            .is_err());

        let entry = QueueEntry {
            id: "tq-1".to_string(),
            project_id: project.id.clone(),
            raw_text: "do it".to_string(),
            sharpened_text: None,
            profile_id: "claude".to_string(),
            status: QUEUE_READY.to_string(),
            priority: 0,
            worker_id: None,
            error: None,
            spawned_by: Some("wk-queen".to_string()),
            created_at: 42,
        };
        store.insert_queue_entry(&entry).await.unwrap();
        assert_eq!(
            store.list_queue(Some(&project.id)).await.unwrap()[0]
                .spawned_by
                .as_deref(),
            Some("wk-queen")
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn projects_round_trip() {
        let (_dir, store) = store().await;
        assert!(store.list_projects().await.unwrap().is_empty());

        let project = store
            .create_project("ProjectA", "C:/repos/a")
            .await
            .unwrap();
        assert_eq!(store.list_projects().await.unwrap(), vec![project.clone()]);
        assert_eq!(
            store.get_project(&project.id).await.unwrap(),
            Some(project.clone())
        );
        assert_eq!(store.get_project("nope").await.unwrap(), None);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn skill_packs_round_trip_and_default_to_all_when_unset() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        let unset = store.get_project_skill_packs(&project.id).await.unwrap();
        assert_eq!(unset, None);
        assert_eq!(
            crate::skills::resolve_enabled(
                &["taste-skill".to_string(), "minimalist-skill".to_string()],
                unset.as_deref(),
            ),
            vec!["taste-skill".to_string(), "minimalist-skill".to_string()]
        );

        let selected = vec!["taste-skill".to_string()];
        store
            .set_project_skill_packs(&project.id, &selected)
            .await
            .unwrap();
        assert_eq!(
            store.get_project_skill_packs(&project.id).await.unwrap(),
            Some(selected)
        );
        store
            .set_project_skill_packs(&project.id, &[])
            .await
            .unwrap();
        assert_eq!(
            store.get_project_skill_packs(&project.id).await.unwrap(),
            None
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn landing_pages_round_trip() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        assert_eq!(store.get_landing_page(&project.id).await.unwrap(), None);
        assert_eq!(
            store
                .get_project(&project.id)
                .await
                .unwrap()
                .unwrap()
                .landing_page_markdown,
            None
        );

        let markdown = "# One\n\nSome *content*.\n";
        store
            .set_landing_page(&project.id, Some(markdown))
            .await
            .unwrap();
        assert_eq!(
            store.get_landing_page(&project.id).await.unwrap(),
            Some(markdown.to_string())
        );
        assert_eq!(
            store
                .get_project(&project.id)
                .await
                .unwrap()
                .unwrap()
                .landing_page_markdown
                .as_deref(),
            Some(markdown)
        );

        store.set_landing_page(&project.id, None).await.unwrap();
        assert_eq!(store.get_landing_page(&project.id).await.unwrap(), None);

        for err in [
            store
                .get_landing_page("pj-nope")
                .await
                .expect_err("unknown project"),
            store
                .set_landing_page("pj-nope", Some("x"))
                .await
                .expect_err("unknown project"),
        ] {
            assert!(err.contains("unknown project"), "{err}");
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn workers_round_trip_and_filter_by_project() {
        let (_dir, store) = store().await;
        let one = store.create_project("one", "C:/repos/one").await.unwrap();
        let two = store.create_project("two", "C:/repos/two").await.unwrap();

        store
            .insert_worker(&worker_row(&one.id, "wk-1"))
            .await
            .unwrap();
        store
            .insert_worker(&worker_row(&one.id, "wk-2"))
            .await
            .unwrap();
        store
            .insert_worker(&worker_row(&two.id, "wk-3"))
            .await
            .unwrap();

        assert_eq!(store.list_workers(None).await.unwrap().len(), 3);
        let first = store.list_workers(Some(&one.id)).await.unwrap();
        assert_eq!(
            first.iter().map(|w| w.id.as_str()).collect::<Vec<_>>(),
            vec!["wk-1", "wk-2"]
        );
        assert!(first.iter().all(|w| w.session_id.is_none()));

        let worker = store.get_worker("wk-1").await.unwrap().unwrap();
        assert_eq!(worker.branch, "pa/wk-1");
        assert_eq!(worker.status, STATUS_RUNNING);

        store
            .set_worker_status("wk-1", STATUS_ARCHIVED)
            .await
            .unwrap();
        assert_eq!(
            store.get_worker("wk-1").await.unwrap().unwrap().status,
            STATUS_ARCHIVED
        );

        store.delete_worker("wk-1").await.unwrap();
        assert!(store.get_worker("wk-1").await.unwrap().is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn removing_a_project_archives_its_workers() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        store
            .insert_worker(&worker_row(&project.id, "wk-1"))
            .await
            .unwrap();

        store.remove_project(&project.id).await.unwrap();

        assert!(store.get_project(&project.id).await.unwrap().is_none());
        assert_eq!(
            store.get_worker("wk-1").await.unwrap().unwrap().status,
            STATUS_ARCHIVED
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn session_mapping_is_reported_on_workers() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        store
            .insert_worker(&worker_row(&project.id, "wk-1"))
            .await
            .unwrap();

        store.bind_session("wk-1", "pty-1").await;
        assert_eq!(
            store.get_worker("wk-1").await.unwrap().unwrap().session_id,
            Some("pty-1".to_string())
        );

        assert_eq!(store.take_session("wk-1"), Some("pty-1".to_string()));
        assert!(store
            .get_worker("wk-1")
            .await
            .unwrap()
            .unwrap()
            .session_id
            .is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_pull_request_url_round_trips_and_can_be_cleared() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        store
            .insert_worker(&worker_row(&project.id, "wk-1"))
            .await
            .unwrap();
        assert!(store
            .get_worker("wk-1")
            .await
            .unwrap()
            .unwrap()
            .pr_url
            .is_none());

        let url = "https://github.com/o/r/pull/7";
        store.set_worker_pr_url("wk-1", Some(url)).await.unwrap();
        assert_eq!(
            store
                .get_worker("wk-1")
                .await
                .unwrap()
                .unwrap()
                .pr_url
                .as_deref(),
            Some(url)
        );

        store.set_worker_pr_url("wk-1", None).await.unwrap();
        assert!(store
            .get_worker("wk-1")
            .await
            .unwrap()
            .unwrap()
            .pr_url
            .is_none());
    }

    /// Phase 9: the hierarchy bookkeeping (`workers.spawned_by`) and the
    /// per-project employee cap (`projects.max_workers`) round-trip.
    /// (Repair-on-open for pre-Phase-9 databases ended with the migration
    /// contract.)
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_hierarchy_columns_round_trip() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        assert_eq!(project.max_workers, None);

        // NULL means "started by the human or the UI".
        store
            .insert_worker(&worker_row(&project.id, "wk-1"))
            .await
            .unwrap();
        assert!(store
            .get_worker("wk-1")
            .await
            .unwrap()
            .unwrap()
            .spawned_by
            .is_none());

        let mut child = worker_row(&project.id, "wk-2");
        child.spawned_by = Some("wk-queen".to_string());
        store.insert_worker(&child).await.unwrap();
        let stored = store.get_worker("wk-2").await.unwrap().unwrap();
        assert_eq!(stored.spawned_by.as_deref(), Some("wk-queen"));
        assert_eq!(
            store
                .list_workers(Some(&project.id))
                .await
                .unwrap()
                .iter()
                .map(|w| w.spawned_by.as_deref())
                .collect::<Vec<_>>(),
            vec![None, Some("wk-queen")]
        );

        store
            .set_project_max_workers(&project.id, Some(2))
            .await
            .unwrap();
        assert_eq!(
            store
                .get_project(&project.id)
                .await
                .unwrap()
                .unwrap()
                .max_workers,
            Some(2)
        );
        store
            .set_project_max_workers(&project.id, None)
            .await
            .unwrap();
        assert_eq!(
            store
                .get_project(&project.id)
                .await
                .unwrap()
                .unwrap()
                .max_workers,
            None
        );
        let err = store
            .set_project_max_workers("pj-nope", Some(2))
            .await
            .expect_err("unknown project");
        assert!(err.contains("unknown project"), "{err}");
    }

    /// A negative employee cap is refused at the store boundary and the
    /// previously stored cap survives (callers inherit this check).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_negative_max_workers_is_rejected_and_keeps_the_old_value() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        store
            .set_project_max_workers(&project.id, Some(2))
            .await
            .unwrap();
        let err = store
            .set_project_max_workers(&project.id, Some(-1))
            .await
            .expect_err("negative cap");
        assert!(err.contains("invalid max workers"), "{err}");
        let stored = store.get_project(&project.id).await.unwrap().unwrap();
        assert_eq!(stored.max_workers, Some(2));
        store
            .set_project_max_workers(&project.id, Some(0))
            .await
            .unwrap();
    }

    /// `workers.pr_url`, the status-event `source` and the `messages` table
    /// are all part of the frozen baseline and round-trip on it. (The
    /// repair-on-open simulation for pre-contract databases ended with the
    /// migration contract.)
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn pull_request_column_event_source_and_messages_round_trip() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        store
            .insert_worker(&worker_row(&project.id, "wk-1"))
            .await
            .unwrap();
        assert!(store
            .get_worker("wk-1")
            .await
            .unwrap()
            .unwrap()
            .pr_url
            .is_none());

        store
            .record_status_event("wk-1", "x", "y", SRC_LIFECYCLE)
            .await
            .unwrap();
        let events: Vec<StatusEvent> = sqlx::query_as(
            "SELECT id, worker_id, kind, detail, source, created_at FROM status_events",
        )
        .fetch_all(&store.pool)
        .await
        .unwrap();
        assert_eq!(events[0].source, SRC_LIFECYCLE);

        store
            .insert_message("wk-1", MSG_USER, "hello")
            .await
            .unwrap();
        assert_eq!(store.list_messages("wk-1", None).await.unwrap().len(), 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn pty_exit_marks_only_running_workers() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        store
            .insert_worker(&worker_row(&project.id, "wk-1"))
            .await
            .unwrap();
        store.bind_session("wk-1", "pty-1").await;

        store.mark_session_exited("pty-1", None).await.unwrap();
        let worker = store.get_worker("wk-1").await.unwrap().unwrap();
        assert_eq!(worker.status, STATUS_EXITED);
        assert!(worker.session_id.is_none());

        // An unknown session, and an already archived worker, are both no-ops.
        store
            .mark_session_exited("pty-unknown", None)
            .await
            .unwrap();
        store
            .set_worker_status("wk-1", STATUS_ARCHIVED)
            .await
            .unwrap();
        store.bind_session("wk-1", "pty-2").await;
        store.mark_session_exited("pty-2", None).await.unwrap();
        assert_eq!(
            store.get_worker("wk-1").await.unwrap().unwrap().status,
            STATUS_ARCHIVED
        );
    }

    /// The binding is kept in both directions, so an unbind or a rebind must
    /// forget both halves - a lingering reverse entry is a worker the exit
    /// hook would still find and flip.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn unbinding_and_rebinding_forgets_the_session_in_both_directions() {
        let (_dir, store) = store().await;

        store.bind_session("wk-1", "pty-1").await;
        assert_eq!(store.worker_for_session("pty-1").as_deref(), Some("wk-1"));
        assert_eq!(store.session_for_worker("wk-1").as_deref(), Some("pty-1"));

        assert_eq!(store.take_session("wk-1").as_deref(), Some("pty-1"));
        assert_eq!(
            store.worker_for_session("pty-1"),
            None,
            "a taken session must not find its worker any more"
        );
        assert_eq!(store.session_for_worker("wk-1"), None);

        // A respawn rebinds the same worker: the stale reverse half goes too.
        store.bind_session_in_memory("wk-1", "pty-2").unwrap();
        store.bind_session_in_memory("wk-1", "pty-3").unwrap();
        assert_eq!(
            store.worker_for_session("pty-2"),
            None,
            "the replaced binding must not linger"
        );
        assert_eq!(store.worker_for_session("pty-3").as_deref(), Some("wk-1"));
        assert_eq!(store.session_for_worker("wk-1").as_deref(), Some("pty-3"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_session_is_written_down_once_and_closed_once() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        store
            .insert_worker(&worker_row(&project.id, "wk-1"))
            .await
            .unwrap();

        store.bind_session("wk-1", "pty-1").await;
        let open = store.list_sessions(&project.id, None).await.unwrap();
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].worker_id, "wk-1");
        assert_eq!(open[0].ended_at, None, "a live session has no end yet");
        assert_eq!(open[0].exit_code, None);

        store.mark_session_exited("pty-1", Some(3)).await.unwrap();
        let closed = store.list_sessions(&project.id, None).await.unwrap();
        assert_eq!(closed[0].exit_code, Some(3));
        let ended_at = closed[0].ended_at.expect("an end");

        // The exit hook can fire twice for one session - an archive that
        // killed the terminal and then the child's own exit. The second report
        // must not move a duration that is already final.
        store.mark_session_exited("pty-1", Some(0)).await.unwrap();
        let again = store.list_sessions(&project.id, None).await.unwrap();
        assert_eq!(again[0].exit_code, Some(3));
        assert_eq!(again[0].ended_at, Some(ended_at));

        // Another project's sessions are not this project's.
        let two = store.create_project("two", "C:/repos/two").await.unwrap();
        assert!(store.list_sessions(&two.id, None).await.unwrap().is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn submit_guard_events_are_durable_and_scoped_to_the_worker() {
        let (_dir, store) = store().await;
        store
            .record_status_event("wk-1", "submit_guard", "initial task submitted", SRC_GUARD)
            .await
            .unwrap();
        store
            .record_status_event("wk-2", "submit_guard", "retry 1", SRC_GUARD)
            .await
            .unwrap();

        let events: Vec<StatusEvent> = sqlx::query_as(
            "SELECT id, worker_id, kind, detail, source, created_at FROM status_events WHERE worker_id = ?1 ORDER BY created_at, id",
        )
        .bind("wk-1")
        .fetch_all(&store.pool)
        .await
        .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].worker_id, "wk-1");
        assert_eq!(events[0].kind, "submit_guard");
        assert_eq!(events[0].detail, "initial task submitted");
        assert_eq!(events[0].source, SRC_GUARD);
    }

    pub(crate) async fn break_queue_inserts_for_test(store: &Store) {
        sqlx::query(
            "CREATE TRIGGER fail_queue_insert BEFORE INSERT ON task_queue \
             BEGIN SELECT RAISE(FAIL, 'forced queue failure'); END",
        )
        .execute(&store.pool)
        .await
        .expect("create failing queue trigger");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn messages_round_trip_and_limit_returns_the_youngest_ascending() {
        let (_dir, store) = store().await;
        store
            .insert_message("wk-1", MSG_USER, "first")
            .await
            .unwrap();
        let second = store
            .insert_message("wk-1", MSG_USER, "second")
            .await
            .unwrap();
        let third = store
            .insert_message("wk-1", MSG_AGENT, "third")
            .await
            .unwrap();
        store
            .insert_message("wk-2", MSG_SYSTEM, "other")
            .await
            .unwrap();

        let all = store.list_messages("wk-1", None).await.unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].content, "first");
        assert_eq!(all[1].content, "second");
        assert_eq!(all[2].content, "third");

        let limited = store.list_messages("wk-1", Some(2)).await.unwrap();
        assert_eq!(limited.len(), 2);
        assert_eq!(limited[0], second);
        assert_eq!(limited[1], third);
        assert_eq!(limited[0].created_at, second.created_at);

        let empty = store.list_messages("wk-1", Some(0)).await.unwrap();
        assert!(empty.is_empty());

        // The limit is bound rather than interpolated, so a caller asking for
        // more than SQLite can represent gets a page instead of an error.
        let huge = store.list_messages("wk-1", Some(usize::MAX)).await.unwrap();
        assert_eq!(huge.len(), 3);

        let other = store.list_messages("wk-2", None).await.unwrap();
        assert_eq!(other.len(), 1);
        assert_eq!(other[0].role, MSG_SYSTEM);
    }

    // -- agent quota (Phase 3.6) -------------------------------------------

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn agent_quota_rows_round_trip_and_upsert() {
        let (_dir, store) = store().await;
        assert!(store.list_agent_quota().await.unwrap().is_empty());
        assert_eq!(store.get_agent_quota("claude").await.unwrap(), None);

        let blocked = AgentQuota {
            profile_id: "claude".to_string(),
            state: QUOTA_BLOCKED.to_string(),
            blocked_until: None,
            reason: Some("Claude usage limit reached.".to_string()),
            updated_at: 100,
        };
        store.set_agent_quota(&blocked).await.unwrap();
        assert_eq!(
            store.get_agent_quota("claude").await.unwrap(),
            Some(blocked.clone())
        );

        // The primary key means a second write updates rather than duplicates.
        let recovered = AgentQuota {
            state: QUOTA_OK.to_string(),
            reason: None,
            blocked_until: Some(1_800_000_000),
            updated_at: 200,
            ..blocked.clone()
        };
        store.set_agent_quota(&recovered).await.unwrap();
        let rows = store.list_agent_quota().await.unwrap();
        assert_eq!(rows, vec![recovered.clone()]);
        assert!(!rows[0].is_blocked());
        assert_eq!(rows[0].blocked_until, Some(1_800_000_000));

        store
            .set_agent_quota(&AgentQuota::unknown("kimi"))
            .await
            .unwrap();
        let rows = store.list_agent_quota().await.unwrap();
        assert_eq!(
            rows.iter()
                .map(|r| r.profile_id.as_str())
                .collect::<Vec<_>>(),
            vec!["claude", "kimi"]
        );
        assert_eq!(rows[1].state, QUOTA_UNKNOWN);

        store.clear_agent_quota("claude").await.unwrap();
        assert_eq!(store.get_agent_quota("claude").await.unwrap(), None);
    }

    /// The quota row is reset by the status engine, but "blocked, then working
    /// again" has to survive as a plain sequence of writes too.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_profile_can_be_blocked_and_reset_to_ok() {
        let (_dir, store) = store().await;
        let mut row = AgentQuota::unknown("claude");
        row.state = QUOTA_BLOCKED.to_string();
        row.reason = Some("credit balance is too low".to_string());
        store.set_agent_quota(&row).await.unwrap();
        assert!(store
            .get_agent_quota("claude")
            .await
            .unwrap()
            .unwrap()
            .is_blocked());

        row.state = QUOTA_OK.to_string();
        row.reason = None;
        row.blocked_until = None;
        store.set_agent_quota(&row).await.unwrap();
        let back = store.get_agent_quota("claude").await.unwrap().unwrap();
        assert_eq!(back.state, QUOTA_OK);
        assert!(back.reason.is_none());
        assert!(back.blocked_until.is_none());
    }

    /// The `agent_quota` table is part of the frozen baseline.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_quota_table_round_trips() {
        let (_dir, store) = store().await;
        assert!(store.list_agent_quota().await.unwrap().is_empty());
        store
            .set_agent_quota(&AgentQuota::unknown("claude"))
            .await
            .unwrap();
        assert!(store.get_agent_quota("claude").await.unwrap().is_some());
    }

    /// `sent_to_agent` is `false` on a fresh comment and round-trips as such.
    /// (The "migrated rather than replaced" repair-on-open half ended with
    /// the migration contract.)
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_diff_comment_round_trips_as_not_sent() {
        let (_dir, store) = store().await;
        let existing = DiffComment {
            id: "dc-1".to_string(),
            worker_id: "wk-1".to_string(),
            file: "src/main.rs".to_string(),
            line: 12,
            body: "tidy this".to_string(),
            sent_to_agent: false,
            created_at: 1,
            disposition: COMMENT_OPEN.to_string(),
        };
        store.insert_diff_comment(&existing).await.unwrap();
        assert_eq!(
            store.list_diff_comments("wk-1").await.unwrap(),
            vec![existing]
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn comment_disposition_defaults_to_open_and_round_trips() {
        let (_dir, store) = store().await;
        let comment = DiffComment {
            id: "dc-1".to_string(),
            worker_id: "wk-1".to_string(),
            file: "src/main.rs".to_string(),
            line: 12,
            body: "tidy this".to_string(),
            sent_to_agent: false,
            created_at: 1,
            disposition: COMMENT_OPEN.to_string(),
        };
        store.insert_diff_comment(&comment).await.unwrap();
        assert_eq!(store.count_open_diff_comments("wk-1").await.unwrap(), 1);
        assert_eq!(
            store
                .get_diff_comment("dc-1")
                .await
                .unwrap()
                .unwrap()
                .disposition,
            COMMENT_OPEN
        );
        store
            .set_diff_comment_disposition("dc-1", COMMENT_DONE)
            .await
            .unwrap();
        assert_eq!(store.count_open_diff_comments("wk-1").await.unwrap(), 0);
        assert_eq!(
            store
                .get_diff_comment("dc-1")
                .await
                .unwrap()
                .unwrap()
                .disposition,
            COMMENT_DONE
        );
        store
            .set_diff_comment_disposition("dc-1", COMMENT_OPEN)
            .await
            .unwrap();
        assert_eq!(store.count_open_diff_comments("wk-1").await.unwrap(), 1);
        let err = store
            .set_diff_comment_disposition("dc-1", "ready")
            .await
            .unwrap_err();
        assert!(err.contains("unknown comment disposition"), "{err}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn review_evidence_round_trips_and_legacy_pass_is_not_copied() {
        let (_dir, store) = store().await;
        let project = store.create_project("P", "C:/tmp/p").await.unwrap();
        let row = WorkerRow {
            id: "wk-1".to_string(),
            project_id: project.id.clone(),
            task: "task".to_string(),
            profile_id: "claude".to_string(),
            branch: "pa/wk-1".to_string(),
            worktree_path: "C:/tmp/p/wk-1".to_string(),
            status: STATUS_EXITED.to_string(),
            kind: KIND_WORKER.to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: Some(TEST_PASS.to_string()),
            tested_at: Some(1_700_000_000),
            role_variant_id: None,
            paused_reason: None,
            created_at: 1,
        };
        store.insert_worker(&row).await.unwrap();
        assert!(
            store.get_review_evidence("wk-1").await.unwrap().is_none(),
            "a pass without SHA must not become evidence"
        );

        let evidence = ReviewEvidence {
            worker_id: "wk-1".to_string(),
            worker_head_sha: "aaa".into(),
            base_tip_sha: "bbb".into(),
            merge_tree_oid: "ccc".into(),
            verification_policy_hash: Some("policy".into()),
            test_passed: Some(1),
            tested_at: Some(2),
            acceptance_hash: Some("acc".into()),
            reviewed_by: Some("human".into()),
            approval_source: Some(APPROVAL_DESKTOP.into()),
            approval_decision: Some(DECISION_APPROVED.into()),
            approved_at: Some(3),
            worktree_prune_offered: 0,
        };
        store.put_review_evidence(&evidence).await.unwrap();
        let got = store.get_review_evidence("wk-1").await.unwrap().unwrap();
        assert_eq!(got, evidence);
        store
            .set_worktree_prune_offered("wk-1", true)
            .await
            .unwrap();
        let got = store.get_review_evidence("wk-1").await.unwrap().unwrap();
        assert_eq!(got.worktree_prune_offered, 1);
        assert_eq!(
            got.approval_record().unwrap().approval_source,
            crate::readiness::ApprovalSource::Desktop
        );
    }

    /// Review-F4-r16 (Opus, Fix-6-Nachweis): Löschen oder Ändern des
    /// Setup-Kommandos muss den gespeicherten Grant verfallen lassen — sonst
    /// gilt nach Löschen + erneutem Setzen desselben Kommandos die alte
    /// Freigabe ohne erneuten Blick. Ein unverändertes erneutes Speichern
    /// (Settings-Blur) darf den Grant dagegen NICHT wegräumen.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn changing_or_clearing_the_setup_command_voids_the_stored_trust() {
        let (_dir, store) = store().await;
        let project = store.create_project("P", "C:/tmp/p").await.unwrap();
        store
            .set_setup_command(&project.id, Some("npm ci"))
            .await
            .unwrap();
        let grant = SetupTrust {
            project_id: project.id.clone(),
            repo_identity: "r".into(),
            command_normalized: "npm ci".into(),
            base_sha: "b".into(),
            inputs_hash: "i".into(),
            granted_at: 10,
        };
        store.put_setup_trust(&grant).await.unwrap();

        // Idempotent re-save keeps the grant.
        store
            .set_setup_command(&project.id, Some("npm ci"))
            .await
            .unwrap();
        assert!(store.get_setup_trust(&project.id).await.unwrap().is_some());

        // Clearing voids it.
        store.set_setup_command(&project.id, None).await.unwrap();
        assert!(store.get_setup_trust(&project.id).await.unwrap().is_none());

        // Re-setting the same command does not resurrect it.
        store
            .set_setup_command(&project.id, Some("npm ci"))
            .await
            .unwrap();
        assert!(store.get_setup_trust(&project.id).await.unwrap().is_none());
    }

    /// Review-F4-r15 (k3 Fund 1): ein Whitespace-only Setup-Kommando
    /// normalisiert zu `""` und würde die Trust-Strecke in eine Sackgasse
    /// führen (die ipc-Guard verwirft den View, das Gate verweigert
    /// permanent). Der Kern behandelt es wie Löschen — ohne sich auf
    /// Caller-Disziplin zu verlassen (SettingsView trimmed bereits UI-seitig).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_whitespace_only_setup_command_is_cleared_not_stored() {
        let (_dir, store) = store().await;
        let project = store.create_project("P", "C:/tmp/p").await.unwrap();
        store
            .set_setup_command(&project.id, Some("npm ci"))
            .await
            .unwrap();
        store
            .set_setup_command(&project.id, Some("   "))
            .await
            .unwrap();
        assert_eq!(store.get_setup_command(&project.id).await.unwrap(), None);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn setup_trust_is_replaced_when_the_script_hash_changes() {
        let (_dir, store) = store().await;
        let project = store.create_project("P", "C:/tmp/p").await.unwrap();
        store
            .set_setup_command(&project.id, Some("npm run setup"))
            .await
            .unwrap();
        assert_eq!(
            store
                .get_setup_command(&project.id)
                .await
                .unwrap()
                .as_deref(),
            Some("npm run setup")
        );
        let first = SetupTrust {
            project_id: project.id.clone(),
            repo_identity: "example.git".into(),
            command_normalized: crate::readiness::normalize_command("npm run setup"),
            base_sha: "base1".into(),
            inputs_hash: crate::readiness::inputs_hash(&[("scripts/lifecycle.sh", b"old")]),
            granted_at: 10,
        };
        store.put_setup_trust(&first).await.unwrap();
        let stored = store.get_setup_trust(&project.id).await.unwrap().unwrap();
        assert_eq!(stored, first);

        let second = SetupTrust {
            inputs_hash: crate::readiness::inputs_hash(&[("scripts/lifecycle.sh", b"new")]),
            granted_at: 11,
            ..first.clone()
        };
        store.put_setup_trust(&second).await.unwrap();
        let stored = store.get_setup_trust(&project.id).await.unwrap().unwrap();
        assert_eq!(stored.inputs_hash, second.inputs_hash);
        assert_ne!(
            crate::readiness::trust_status(Some(&first.grant()), &second.grant()),
            crate::readiness::TrustStatus::Granted
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn diff_comments_round_trip_and_are_scoped_to_one_worker() {
        let (_dir, store) = store().await;
        assert!(store.list_diff_comments("wk-1").await.unwrap().is_empty());

        let mut one = DiffComment {
            id: "dc-1".to_string(),
            worker_id: "wk-1".to_string(),
            file: "src/main.rs".to_string(),
            line: 12,
            body: "tidy this".to_string(),
            sent_to_agent: false,
            created_at: 1,
            disposition: COMMENT_OPEN.to_string(),
        };
        let two = DiffComment {
            id: "dc-2".to_string(),
            worker_id: "wk-2".to_string(),
            line: 3,
            created_at: 2,
            ..one.clone()
        };
        store.insert_diff_comment(&one).await.unwrap();
        store.insert_diff_comment(&two).await.unwrap();

        assert_eq!(
            store.list_diff_comments("wk-1").await.unwrap(),
            vec![one.clone()]
        );
        assert_eq!(store.get_diff_comment("dc-2").await.unwrap(), Some(two));
        assert_eq!(store.get_diff_comment("dc-nope").await.unwrap(), None);

        store.set_diff_comment_sent(&one.id).await.unwrap();
        one.sent_to_agent = true;
        assert_eq!(store.get_diff_comment("dc-1").await.unwrap(), Some(one));

        store.delete_diff_comment("dc-1").await.unwrap();
        assert!(store.list_diff_comments("wk-1").await.unwrap().is_empty());
        // Deleting what is not there is not an error; the row is gone either way.
        store.delete_diff_comment("dc-1").await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_blocked_quota_row_round_trips_its_reason_and_deadline() {
        let (_dir, store) = store().await;
        store
            .set_agent_quota(&AgentQuota {
                profile_id: "claude".to_string(),
                state: QUOTA_BLOCKED.to_string(),
                blocked_until: Some(7),
                reason: Some("rate limit".to_string()),
                updated_at: 1,
            })
            .await
            .unwrap();
        let back = store.get_agent_quota("claude").await.unwrap().unwrap();
        assert_eq!(back.reason.as_deref(), Some("rate limit"));
        assert_eq!(back.blocked_until, Some(7));
    }

    // -- learnings and settings (Phase 14) ---------------------------------

    fn learning(id: &str, project_id: &str, content: &str) -> Learning {
        Learning {
            id: id.to_string(),
            project_id: project_id.to_string(),
            worker_id: "wk-1".to_string(),
            profile_id: "claude".to_string(),
            pattern_label: Some("Gates".to_string()),
            content: content.to_string(),
            status: LEARNING_PENDING.to_string(),
            created_at: 1,
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn learnings_round_trip_and_are_scoped_by_project_and_status() {
        let (_dir, store) = store().await;
        assert!(store.list_learnings(None, None).await.unwrap().is_empty());

        let one = learning("lr-1", "pj-1", "Immer erst cargo test, dann clippy");
        let two = Learning {
            pattern_label: None,
            ..learning("lr-2", "pj-1", "Keine CARGO_PROFILE_-Variablen setzen")
        };
        let other = learning("lr-3", "pj-2", "Frontend-Strings bleiben deutsch");
        for entry in [&one, &two, &other] {
            store.insert_learning(entry).await.unwrap();
        }

        assert_eq!(
            store.list_learnings(Some("pj-1"), None).await.unwrap(),
            vec![one.clone(), two.clone()]
        );
        assert_eq!(store.list_learnings(None, None).await.unwrap().len(), 3);
        assert_eq!(
            store.list_learnings(Some("pj-nope"), None).await.unwrap(),
            Vec::new()
        );

        assert_eq!(store.get_learning("lr-1").await.unwrap(), Some(one.clone()));
        assert_eq!(store.get_learning("lr-nope").await.unwrap(), None);
        // An absent pattern label survives the round trip as absent.
        assert_eq!(
            store
                .get_learning("lr-2")
                .await
                .unwrap()
                .unwrap()
                .pattern_label,
            None
        );

        store
            .set_learning_status("lr-1", LEARNING_APPROVED)
            .await
            .unwrap();
        store
            .set_learning_status("lr-3", LEARNING_REJECTED)
            .await
            .unwrap();
        assert_eq!(
            store
                .list_learnings(None, Some(LEARNING_PENDING))
                .await
                .unwrap()
                .iter()
                .map(|entry| entry.id.clone())
                .collect::<Vec<_>>(),
            vec!["lr-2".to_string()]
        );
        assert_eq!(
            store
                .list_learnings(Some("pj-1"), Some(LEARNING_APPROVED))
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(store
            .list_learnings(Some("pj-2"), Some(LEARNING_APPROVED))
            .await
            .unwrap()
            .is_empty());

        store
            .set_learning_content("lr-2", "Umformuliert vom Menschen")
            .await
            .unwrap();
        assert_eq!(
            store.get_learning("lr-2").await.unwrap().unwrap().content,
            "Umformuliert vom Menschen"
        );

        let err = store
            .set_learning_status("lr-nope", LEARNING_REJECTED)
            .await
            .unwrap_err();
        assert!(err.contains("unknown learning"), "{err}");
        let err = store
            .set_learning_content("lr-nope", "x")
            .await
            .unwrap_err();
        assert!(err.contains("unknown learning"), "{err}");
    }

    // -- role variants (Phase 15) ------------------------------------------

    fn variant(id: &str, project_id: &str, version: i64, status: &str) -> RoleVariant {
        RoleVariant {
            id: id.to_string(),
            project_id: project_id.to_string(),
            name: "Test-Fixer".to_string(),
            base_profile_id: "claude".to_string(),
            pattern_label: "tests-fixen".to_string(),
            system_prompt_addition: "Lauf die Gates seriell.".to_string(),
            version,
            status: status.to_string(),
            created_at: 1,
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn role_variants_round_trip_and_are_scoped_by_project_and_status() {
        let (_dir, store) = store().await;
        assert!(store
            .list_role_variants(None, None)
            .await
            .unwrap()
            .is_empty());

        let one = variant("rv-1", "pj-1", 1, ROLE_PENDING);
        let two = RoleVariant {
            created_at: 2,
            ..variant("rv-2", "pj-1", 2, ROLE_APPROVED)
        };
        let other = variant("rv-3", "pj-2", 1, ROLE_PENDING);
        for entry in [&one, &two, &other] {
            store.insert_role_variant(entry).await.unwrap();
        }

        assert_eq!(
            store.list_role_variants(Some("pj-1"), None).await.unwrap(),
            vec![one.clone(), two.clone()]
        );
        assert_eq!(store.list_role_variants(None, None).await.unwrap().len(), 3);
        assert_eq!(
            store
                .list_role_variants(Some("pj-nope"), None)
                .await
                .unwrap(),
            Vec::new()
        );
        assert_eq!(
            store
                .list_role_variants(None, Some(ROLE_PENDING))
                .await
                .unwrap()
                .iter()
                .map(|entry| entry.id.clone())
                .collect::<Vec<_>>(),
            vec!["rv-1".to_string(), "rv-3".to_string()]
        );
        assert_eq!(
            store
                .list_role_variants(Some("pj-1"), Some(ROLE_APPROVED))
                .await
                .unwrap(),
            vec![two.clone()]
        );

        assert_eq!(store.get_role_variant("rv-1").await.unwrap(), Some(one));
        assert_eq!(store.get_role_variant("rv-nope").await.unwrap(), None);

        store
            .set_role_variant_status("rv-1", ROLE_REJECTED)
            .await
            .unwrap();
        assert_eq!(
            store
                .get_role_variant("rv-1")
                .await
                .unwrap()
                .unwrap()
                .status,
            ROLE_REJECTED
        );
        let err = store
            .set_role_variant_status("rv-nope", ROLE_REJECTED)
            .await
            .unwrap_err();
        assert!(err.contains("unknown role variant"), "{err}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn approved_learnings_are_counted_per_project_pattern_and_profile() {
        let (_dir, store) = store().await;
        let approved =
            |id: &str, project_id: &str, pattern: Option<&str>, profile: &str| Learning {
                pattern_label: pattern.map(str::to_string),
                profile_id: profile.to_string(),
                status: LEARNING_APPROVED.to_string(),
                ..learning(id, project_id, "egal")
            };
        for entry in [
            approved("lr-1", "pj-1", Some("gates"), "claude"),
            approved("lr-2", "pj-1", Some("gates"), "claude"),
            // Pending does not count.
            Learning {
                status: LEARNING_PENDING.to_string(),
                ..approved("lr-3", "pj-1", Some("gates"), "claude")
            },
            // Another profile, another pattern, another project, no pattern.
            approved("lr-4", "pj-1", Some("gates"), "codex"),
            approved("lr-5", "pj-1", Some("frontend"), "claude"),
            approved("lr-6", "pj-2", Some("gates"), "claude"),
            approved("lr-7", "pj-1", None, "claude"),
        ] {
            store.insert_learning(&entry).await.unwrap();
        }

        assert_eq!(
            store
                .count_approved_learnings("pj-1", "gates", "claude")
                .await
                .unwrap(),
            2
        );
        assert_eq!(
            store
                .count_approved_learnings("pj-1", "nichts", "claude")
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_approved_variant_for_a_key_is_the_highest_version() {
        let (_dir, store) = store().await;
        for entry in [
            variant("rv-1", "pj-1", 1, ROLE_APPROVED),
            variant("rv-2", "pj-1", 2, ROLE_APPROVED),
            variant("rv-3", "pj-1", 3, ROLE_PENDING),
            // Same pattern, other profile: a different key entirely.
            RoleVariant {
                base_profile_id: "codex".to_string(),
                ..variant("rv-4", "pj-1", 9, ROLE_APPROVED)
            },
        ] {
            store.insert_role_variant(&entry).await.unwrap();
        }

        let approved = store
            .approved_variant_for("pj-1", "tests-fixen", "claude")
            .await
            .unwrap()
            .expect("an approved variant");
        assert_eq!(approved.id, "rv-2");

        // The latest ignores the status, which is what the duplicate guard and
        // the version counter both need.
        let latest = store
            .latest_variant_for("pj-1", "tests-fixen", "claude")
            .await
            .unwrap()
            .expect("a variant");
        assert_eq!(latest.id, "rv-3");
        assert_eq!(latest.version, 3);

        assert_eq!(
            store
                .approved_variant_for("pj-1", "nichts", "claude")
                .await
                .unwrap(),
            None
        );
        assert_eq!(
            store
                .latest_variant_for("pj-2", "tests-fixen", "claude")
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn settings_insert_overwrite_and_miss() {
        let (_dir, store) = store().await;
        assert_eq!(store.get_setting("learning.worker").await.unwrap(), None);

        store.set_setting("learning.worker", "0").await.unwrap();
        assert_eq!(
            store
                .get_setting("learning.worker")
                .await
                .unwrap()
                .as_deref(),
            Some("0")
        );

        store.set_setting("learning.worker", "1").await.unwrap();
        assert_eq!(
            store
                .get_setting("learning.worker")
                .await
                .unwrap()
                .as_deref(),
            Some("1")
        );
        // Keys are independent: writing one never invents another.
        assert_eq!(store.get_setting("learning.queen").await.unwrap(), None);
    }

    #[test]
    fn settings_storage_methods_live_in_store_settings_module() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let module = std::fs::read_to_string(root.join("src/store/settings.rs"))
            .expect("settings persistence module exists");
        let store =
            std::fs::read_to_string(root.join("src/store.rs")).expect("store module exists");
        for method in [
            "get_setting",
            "set_setting",
            "agent_env_isolation",
            "set_agent_env_isolation",
            "list_settings",
            "delete_setting",
        ] {
            assert!(
                module.contains(&format!("fn {method}(")),
                "{method} belongs in settings.rs"
            );
            assert!(
                !store.contains(&format!("fn {method}(")),
                "{method} moved out of store.rs"
            );
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn list_settings_treats_percent_and_underscore_prefixes_literally_and_sorts() {
        let (_dir, store) = store().await;
        for key in ["_z", "%z", "_a", "%a", "xa", "ya"] {
            store.set_setting(key, key).await.unwrap();
        }

        assert_eq!(
            store.list_settings("%").await.unwrap(),
            vec![("%a".into(), "%a".into()), ("%z".into(), "%z".into())]
        );
        assert_eq!(
            store.list_settings("_").await.unwrap(),
            vec![("_a".into(), "_a".into()), ("_z".into(), "_z".into())]
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn deleted_setting_stays_absent_after_database_reopen() {
        let dir = TempDir::new("store-deleted-setting");
        let path = dir.path().join("projecta.db");
        let store = Store::open(&path).await.expect("open store");
        store.set_setting("remove.me", "value").await.unwrap();
        store.delete_setting("remove.me").await.unwrap();
        store.pool.close().await;

        let reopened = Store::open(&path).await.expect("reopen store");
        assert_eq!(reopened.get_setting("remove.me").await.unwrap(), None);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn missing_agent_env_isolation_defaults_to_strict() {
        let (_dir, store) = store().await;
        assert_eq!(
            store.agent_env_isolation().await.unwrap(),
            crate::profiles::EnvIsolation::Strict
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn agent_env_isolation_values_survive_database_reopen() {
        use crate::profiles::EnvIsolation;

        for isolation in [
            EnvIsolation::Inherit,
            EnvIsolation::Allowlist,
            EnvIsolation::Strict,
        ] {
            let dir = TempDir::new("store-agent-env-isolation");
            let path = dir.path().join("projecta.db");
            let store = Store::open(&path).await.expect("open store");
            store.set_agent_env_isolation(isolation).await.unwrap();
            store.pool.close().await;

            let reopened = Store::open(&path).await.expect("reopen store");
            assert_eq!(reopened.agent_env_isolation().await.unwrap(), isolation);
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn invalid_agent_env_isolation_is_rejected_without_overwriting_last_valid_value() {
        use crate::profiles::{EnvIsolation, InvalidEnvIsolationValue};

        let (_dir, store) = store().await;
        store
            .set_agent_env_isolation(EnvIsolation::Allowlist)
            .await
            .unwrap();

        assert_eq!(
            "permissive".parse::<EnvIsolation>(),
            Err(InvalidEnvIsolationValue("permissive".to_string()))
        );
        assert_eq!(
            store.agent_env_isolation().await.unwrap(),
            EnvIsolation::Allowlist
        );
    }

    // -- recommendations (Phase 7.1) ---------------------------------------

    fn recommendation(id: &str, project_id: &str, title: &str) -> Recommendation {
        Recommendation {
            id: id.to_string(),
            project_id: project_id.to_string(),
            title: title.to_string(),
            url: Some("https://github.com/ratatui/ratatui".to_string()),
            rationale: "Board im Terminal".to_string(),
            effort: Some("M".to_string()),
            status: REC_NEW.to_string(),
            created_at: 1,
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn recommendations_round_trip_and_are_scoped_to_a_project() {
        let (_dir, store) = store().await;
        assert!(store.list_recommendations(None).await.unwrap().is_empty());

        let one = recommendation("rc-1", "pj-1", "ratatui");
        let two = Recommendation {
            id: "rc-2".to_string(),
            url: None,
            effort: None,
            created_at: 2,
            ..recommendation("rc-2", "pj-1", "notify")
        };
        let other = recommendation("rc-3", "pj-2", "sqlx");
        for rec in [&one, &two, &other] {
            assert!(store.insert_recommendation(rec).await.unwrap());
        }

        assert_eq!(
            store.list_recommendations(Some("pj-1")).await.unwrap(),
            vec![one.clone(), two.clone()]
        );
        assert_eq!(store.list_recommendations(None).await.unwrap().len(), 3);
        assert_eq!(
            store.list_recommendations(Some("pj-nope")).await.unwrap(),
            Vec::new()
        );
        assert_eq!(
            store.get_recommendation("rc-1").await.unwrap(),
            Some(one.clone())
        );
        assert_eq!(store.get_recommendation("rc-nope").await.unwrap(), None);
        // The optional columns really are optional.
        assert_eq!(
            store.get_recommendation("rc-2").await.unwrap().unwrap().url,
            None
        );

        store
            .set_recommendation_status("rc-1", REC_ACCEPTED)
            .await
            .unwrap();
        assert_eq!(
            store
                .get_recommendation("rc-1")
                .await
                .unwrap()
                .unwrap()
                .status,
            REC_ACCEPTED
        );
        store
            .set_recommendation_status("rc-1", REC_DISMISSED)
            .await
            .unwrap();
        assert_eq!(
            store
                .get_recommendation("rc-1")
                .await
                .unwrap()
                .unwrap()
                .status,
            REC_DISMISSED
        );

        let err = store
            .set_recommendation_status("rc-nope", REC_DISMISSED)
            .await
            .expect_err("unknown id");
        assert!(err.contains("unknown recommendation"), "{err}");
    }

    /// Ingest re-reads the whole scout file every pass, so the same row is
    /// offered over and over. It must never overwrite what is already there.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn inserting_a_known_recommendation_changes_nothing() {
        let (_dir, store) = store().await;
        let rec = recommendation("rc-1", "pj-1", "ratatui");
        assert!(store.insert_recommendation(&rec).await.unwrap());
        store
            .set_recommendation_status("rc-1", REC_DISMISSED)
            .await
            .unwrap();

        // The same id again, as `new`, with a different title.
        let again = Recommendation {
            title: "something else".to_string(),
            ..rec.clone()
        };
        assert!(!store.insert_recommendation(&again).await.unwrap());

        let stored = store.get_recommendation("rc-1").await.unwrap().unwrap();
        assert_eq!(stored.status, REC_DISMISSED);
        assert_eq!(stored.title, "ratatui");
        assert_eq!(store.list_recommendations(None).await.unwrap().len(), 1);
    }

    /// A recommendation round-trips with every column intact. (The "gains
    /// the table and columns" repair-on-open simulation ended with the
    /// migration contract.)
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_recommendation_round_trips_with_defaults() {
        let (_dir, store) = store().await;
        assert!(store.list_recommendations(None).await.unwrap().is_empty());
        let rec = recommendation("rc-1", "pj-1", "ratatui");
        store.insert_recommendation(&rec).await.unwrap();
        let stored = store.get_recommendation("rc-1").await.unwrap().unwrap();
        assert_eq!(stored, rec);
        assert_eq!(stored.status, REC_NEW);
    }

    #[test]
    fn ids_are_unique_and_prefixed() {
        let a = new_id("wk");
        let b = new_id("wk");
        assert!(a.starts_with("wk-"));
        assert_ne!(a, b);
    }

    // -- activity feed (Phase 16) ------------------------------------------

    /// One row per source table across two projects; the feed must union all
    /// of them, newest first, with the project filter following the workers
    /// join for the worker-bound tables.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_activity_feed_unions_every_source_newest_first() {
        let (_dir, store) = store().await;
        assert!(store.get_activity(None, 50).await.unwrap().is_empty());

        let one = store.create_project("one", "C:/repos/one").await.unwrap();
        let two = store.create_project("two", "C:/repos/two").await.unwrap();

        let mut w1 = worker_row(&one.id, "wk-1");
        w1.task = "fix the flaky test".to_string();
        w1.created_at = 100;
        store.insert_worker(&w1).await.unwrap();
        // The other project's only footprint: it must survive the unfiltered
        // feed and vanish from the filtered one.
        let mut w2 = worker_row(&two.id, "wk-2");
        w2.created_at = 900;
        store.insert_worker(&w2).await.unwrap();

        // Timestamps are pinned by hand so the ordering assertions do not
        // depend on the wall clock.
        sqlx::query(
            "INSERT INTO status_events (id, worker_id, kind, detail, source, created_at)
             VALUES ('ev-1', 'wk-1', 'stalled', 'no output for a while', 'guard', 200)",
        )
        .execute(&store.pool)
        .await
        .expect("insert status event");
        let long_message = "x".repeat(300);
        sqlx::query(
            "INSERT INTO messages (id, worker_id, role, content, created_at)
             VALUES ('msg-1', 'wk-1', 'user', ?1, 300)",
        )
        .bind(&long_message)
        .execute(&store.pool)
        .await
        .expect("insert message");
        store
            .insert_queue_entry(&QueueEntry {
                id: "tq-1".to_string(),
                project_id: one.id.clone(),
                raw_text: "do the next thing".to_string(),
                sharpened_text: None,
                profile_id: "claude".to_string(),
                status: QUEUE_QUEUED.to_string(),
                priority: 0,
                worker_id: None,
                error: None,
                spawned_by: None,
                created_at: 400,
            })
            .await
            .unwrap();
        store
            .insert_recommendation(&Recommendation {
                created_at: 500,
                ..recommendation("rc-1", &one.id, "ratatui")
            })
            .await
            .unwrap();
        store
            .insert_learning(&Learning {
                created_at: 600,
                ..learning("lr-1", &one.id, "Gates seriell laufen lassen")
            })
            .await
            .unwrap();
        store
            .insert_role_variant(&RoleVariant {
                created_at: 700,
                ..variant("rv-1", &one.id, 1, ROLE_PENDING)
            })
            .await
            .unwrap();

        let feed = store.get_activity(None, 50).await.unwrap();
        let ids: Vec<&str> = feed.iter().map(|entry| entry.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["wk-2", "rv-1", "lr-1", "rc-1", "tq-1", "msg-1", "ev-1", "wk-1"],
            "{ids:?}"
        );
        let categories: Vec<&str> = feed.iter().map(|entry| entry.category.as_str()).collect();
        assert_eq!(
            categories,
            vec![
                "worker",
                "role",
                "learning",
                "recommendation",
                "queue",
                "message",
                "status",
                "worker"
            ]
        );

        // Worker-bound rows name their worker and carry its task as label;
        // project-level rows carry neither.
        let event = feed.iter().find(|entry| entry.id == "ev-1").unwrap();
        assert_eq!(event.worker_id.as_deref(), Some("wk-1"));
        assert_eq!(event.worker_label.as_deref(), Some("fix the flaky test"));
        assert_eq!(event.summary, "stalled: no output for a while");
        let rec = feed.iter().find(|entry| entry.id == "rc-1").unwrap();
        assert_eq!(rec.worker_id, None);
        assert_eq!(rec.worker_label, None);
        assert_eq!(rec.summary, "ratatui");

        // The project filter must follow the workers join for status events
        // and messages, which carry no project column of their own.
        let scoped = store.get_activity(Some(&one.id), 50).await.unwrap();
        assert_eq!(scoped.len(), 7);
        assert!(scoped.iter().all(|entry| entry.project_id == one.id));
        assert!(store.get_activity(Some(&two.id), 50).await.unwrap().len() == 1);
        assert!(store
            .get_activity(Some("pj-nope"), 50)
            .await
            .unwrap()
            .is_empty());

        // The limit cuts from the newest end.
        let top = store.get_activity(None, 2).await.unwrap();
        assert_eq!(top[0].id, "wk-2");
        assert_eq!(top[1].id, "rv-1");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_activity_feed_shortens_message_content() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        store
            .insert_worker(&worker_row(&project.id, "wk-1"))
            .await
            .unwrap();

        let long_message = format!("start {}", "x".repeat(300));
        sqlx::query(
            "INSERT INTO messages (id, worker_id, role, content, created_at)
             VALUES ('msg-1', 'wk-1', 'agent', ?1, 300)",
        )
        .bind(&long_message)
        .execute(&store.pool)
        .await
        .expect("insert message");

        let feed = store.get_activity(None, 50).await.unwrap();
        let entry = feed.iter().find(|entry| entry.id == "msg-1").unwrap();
        // "agent: " plus exactly 140 characters of content - the feed is a
        // list of lines, not a transcript.
        assert_eq!(
            entry.summary,
            format!("agent: start {}", "x".repeat(134)),
            "{}",
            entry.summary
        );
        // A short message comes through untouched.
        store
            .insert_message("wk-1", MSG_USER, "ja, weiter")
            .await
            .unwrap();
        let feed = store.get_activity(None, 50).await.unwrap();
        let entry = feed
            .iter()
            .find(|entry| entry.summary.starts_with("user:"))
            .unwrap();
        assert_eq!(entry.summary, "user: ja, weiter");
    }

    // -- the OmniRoute usage ledger (Phase 19 T3) --------------------------

    fn usage_event(id: &str, ts: i64) -> UsageEvent {
        UsageEvent {
            id: id.to_string(),
            ts,
            profile_id: None,
            model: "gpt-5.6-sol".to_string(),
            provider: "codex".to_string(),
            tokens_in: 100,
            tokens_out: 10,
            cost_usd: None,
            raw_json: format!("{{\"id\":\"{id}\"}}"),
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_usage_event_survives_a_round_trip() {
        let (_dir, store) = store().await;
        let mut event = usage_event("ue-1", 1_700_000_000);
        event.profile_id = Some("claude-omni".to_string());
        event.cost_usd = Some(0.25);
        assert!(store.insert_usage_event(&event).await.unwrap());

        let rows = store.list_usage_events(None, None).await.unwrap();
        assert_eq!(rows, vec![event]);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_same_usage_row_is_only_stored_once() {
        let (_dir, store) = store().await;
        let event = usage_event("ue-1", 1_700_000_000);
        assert!(
            store.insert_usage_event(&event).await.unwrap(),
            "first write"
        );
        // The poller re-reads a ring buffer, so this is the ordinary case.
        assert!(
            !store.insert_usage_event(&event).await.unwrap(),
            "the second write is a duplicate, not an error"
        );
        assert_eq!(store.list_usage_events(None, None).await.unwrap().len(), 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_ledger_lists_newest_first_and_honours_since_and_limit() {
        let (_dir, store) = store().await;
        for (id, ts) in [("a", 100), ("b", 200), ("c", 300)] {
            store
                .insert_usage_event(&usage_event(id, ts))
                .await
                .unwrap();
        }

        let ids: Vec<String> = store
            .list_usage_events(None, None)
            .await
            .unwrap()
            .into_iter()
            .map(|event| event.id)
            .collect();
        assert_eq!(ids, ["c", "b", "a"]);

        let ids: Vec<String> = store
            .list_usage_events(Some(200), None)
            .await
            .unwrap()
            .into_iter()
            .map(|event| event.id)
            .collect();
        assert_eq!(ids, ["c", "b"], "since is inclusive");

        let ids: Vec<String> = store
            .list_usage_events(None, Some(1))
            .await
            .unwrap()
            .into_iter()
            .map(|event| event.id)
            .collect();
        assert_eq!(ids, ["c"]);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn usage_totals_count_only_the_rows_that_carried_a_price() {
        let (_dir, store) = store().await;
        let empty = store.usage_totals(None).await.unwrap();
        assert_eq!(empty, UsageTotals::default(), "an empty ledger totals zero");

        let mut priced = usage_event("a", 100);
        priced.cost_usd = Some(1.5);
        store.insert_usage_event(&priced).await.unwrap();
        store
            .insert_usage_event(&usage_event("b", 200))
            .await
            .unwrap();

        let all = store.usage_totals(None).await.unwrap();
        assert_eq!(all.requests, 2);
        assert_eq!(all.tokens_in, 200);
        assert_eq!(all.tokens_out, 20);
        assert!((all.cost_usd - 1.5).abs() < f64::EPSILON);
        assert_eq!(all.priced, 1, "only one of the two rows was priced");

        let today = store.usage_totals(Some(200)).await.unwrap();
        assert_eq!(today.requests, 1);
        assert_eq!(
            today.priced, 0,
            "the unpriced row is counted, its cost is not"
        );
        assert_eq!(today.cost_usd, 0.0);
    }

    // -- questions (Phase 21) ----------------------------------------------

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_questions_table_ships_with_the_schema() {
        let (_dir, store) = store().await;
        assert!(store.table_exists("questions").await.unwrap());
    }

    /// An open worker question, with every column filled the way
    /// [`crate::questions::ask`] fills it.
    fn open_question(id: &str, worker_id: Option<&str>) -> Question {
        Question {
            id: id.to_string(),
            answered_by: None,
            project_id: "pj-1".to_string(),
            worker_id: worker_id.map(str::to_string),
            scope: match worker_id {
                Some(_) => QUESTION_WORKER.to_string(),
                None => QUESTION_PREFLIGHT.to_string(),
            },
            question: "Postgres oder SQLite?".to_string(),
            options_json: Some("[\"Postgres\",\"SQLite\"]".to_string()),
            status: QUESTION_OPEN.to_string(),
            answer: None,
            created_at: 1000,
            answered_at: None,
            expires_at: Some(1000 + 4 * 60 * 60),
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_question_survives_the_round_trip() {
        let (_dir, store) = store().await;
        let question = open_question("qs-1", Some("wk-1"));
        store.insert_question(&question).await.unwrap();

        let read = store.get_question("qs-1").await.unwrap().expect("stored");
        assert_eq!(read, question, "every column comes back as it went in");
        assert_eq!(store.get_question("qs-nope").await.unwrap(), None);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_preflight_question_keeps_a_null_worker() {
        let (_dir, store) = store().await;
        store
            .insert_question(&open_question("qs-1", None))
            .await
            .unwrap();

        let read = store.get_question("qs-1").await.unwrap().expect("stored");
        assert_eq!(read.worker_id, None);
        assert_eq!(read.scope, QUESTION_PREFLIGHT);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn listing_narrows_by_project_and_status() {
        let (_dir, store) = store().await;
        store
            .insert_question(&open_question("qs-1", Some("wk-1")))
            .await
            .unwrap();
        let mut other = open_question("qs-2", Some("wk-2"));
        other.project_id = "pj-2".to_string();
        store.insert_question(&other).await.unwrap();
        let mut done = open_question("qs-3", Some("wk-1"));
        done.status = QUESTION_ANSWERED.to_string();
        store.insert_question(&done).await.unwrap();

        let all = store.list_questions(None, None).await.unwrap();
        assert_eq!(all.len(), 3);
        let mine = store.list_questions(Some("pj-1"), None).await.unwrap();
        assert_eq!(ids(&mine), vec!["qs-1", "qs-3"]);
        let open = store
            .list_questions(Some("pj-1"), Some(QUESTION_OPEN))
            .await
            .unwrap();
        assert_eq!(ids(&open), vec!["qs-1"]);
        let open_anywhere = store
            .list_questions(None, Some(QUESTION_OPEN))
            .await
            .unwrap();
        assert_eq!(ids(&open_anywhere), vec!["qs-1", "qs-2"]);
    }

    fn ids(questions: &[Question]) -> Vec<&str> {
        questions.iter().map(|q| q.id.as_str()).collect()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn only_open_questions_count_against_a_worker() {
        let (_dir, store) = store().await;
        store
            .insert_question(&open_question("qs-1", Some("wk-1")))
            .await
            .unwrap();
        store
            .insert_question(&open_question("qs-2", Some("wk-1")))
            .await
            .unwrap();
        let mut answered = open_question("qs-3", Some("wk-1"));
        answered.status = QUESTION_ANSWERED.to_string();
        store.insert_question(&answered).await.unwrap();
        store
            .insert_question(&open_question("qs-4", Some("wk-2")))
            .await
            .unwrap();

        assert_eq!(store.count_open_questions("wk-1").await.unwrap(), 2);
        assert_eq!(store.count_open_questions("wk-2").await.unwrap(), 1);
        assert_eq!(store.count_open_questions("wk-nope").await.unwrap(), 0);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_question_can_only_be_closed_once() {
        let (_dir, store) = store().await;
        store
            .insert_question(&open_question("qs-1", Some("wk-1")))
            .await
            .unwrap();

        assert!(store
            .close_question(
                "qs-1",
                QUESTION_ANSWERED,
                "SQLite",
                2000,
                Some(ANSWERED_BY_HUMAN)
            )
            .await
            .unwrap());
        // The second caller lost the race and is told so rather than
        // overwriting the answer that is already on record.
        assert!(!store
            .close_question("qs-1", QUESTION_EXPIRED, "abgelaufen", 3000, None)
            .await
            .unwrap());

        let read = store.get_question("qs-1").await.unwrap().expect("stored");
        assert_eq!(read.status, QUESTION_ANSWERED);
        assert_eq!(read.answer.as_deref(), Some("SQLite"));
        assert_eq!(read.answered_at, Some(2000));
        assert_eq!(read.question, "Postgres oder SQLite?", "the question stays");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn expired_lists_only_open_rows_past_their_deadline() {
        let (_dir, store) = store().await;
        store
            .insert_question(&open_question("qs-due", Some("wk-1")))
            .await
            .unwrap();
        let mut later = open_question("qs-later", Some("wk-1"));
        later.expires_at = Some(999_999);
        store.insert_question(&later).await.unwrap();
        let mut answered = open_question("qs-answered", Some("wk-1"));
        answered.status = QUESTION_ANSWERED.to_string();
        store.insert_question(&answered).await.unwrap();
        let mut endless = open_question("qs-endless", Some("wk-1"));
        endless.expires_at = None;
        store.insert_question(&endless).await.unwrap();

        let due = store.list_expired_questions(50_000).await.unwrap();
        assert_eq!(ids(&due), vec!["qs-due"]);
        // On the second, not after it: a deadline that has arrived has passed.
        let exact = store
            .list_expired_questions(1000 + 4 * 60 * 60)
            .await
            .unwrap();
        assert_eq!(ids(&exact), vec!["qs-due"]);
        assert!(store.list_expired_questions(999).await.unwrap().is_empty());
    }

    // -- task queue (Phase 7) ---------------------------------------------

    #[tokio::test]
    async fn cancelling_says_whether_the_task_is_unknown_or_past_cancelling() {
        let (_dir, store) = store().await;
        let project = store.create_project("one", "C:/repos/one").await.unwrap();
        let entry = QueueEntry {
            id: "tq-1".to_string(),
            project_id: project.id.clone(),
            raw_text: "do it".to_string(),
            sharpened_text: None,
            profile_id: "claude".to_string(),
            status: QUEUE_READY.to_string(),
            priority: 0,
            worker_id: None,
            error: None,
            spawned_by: None,
            created_at: 42,
        };
        store.insert_queue_entry(&entry).await.unwrap();

        // A claim has the entry, so the cancel is refused and the row stays.
        assert!(store.claim_queue_entry("tq-1").await.unwrap());
        let err = store.cancel_queue_entry("tq-1").await.unwrap_err();
        assert!(err.starts_with(crate::errors::ERR_REFUSED), "{err}");
        assert_eq!(
            store.list_queue(Some(&project.id)).await.unwrap()[0].status,
            QUEUE_DISPATCHING
        );

        let err = store.cancel_queue_entry("tq-nope").await.unwrap_err();
        assert!(err.starts_with(crate::errors::ERR_UNKNOWN), "{err}");

        // A ready entry goes; a second cancel finds no row left to name.
        store
            .insert_queue_entry(&QueueEntry {
                id: "tq-2".to_string(),
                ..entry
            })
            .await
            .unwrap();
        store.cancel_queue_entry("tq-2").await.unwrap();
        let err = store.cancel_queue_entry("tq-2").await.unwrap_err();
        assert!(err.starts_with(crate::errors::ERR_UNKNOWN), "{err}");
    }
