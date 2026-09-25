use super::*;
use crate::store::development_launches::tests::{bind_test_route, fixture};
use crate::{
    process_capture::{managed, protocol},
    pty::PtyManager,
};

async fn prepared_fixture(
    alias: bool,
) -> (
    crate::testutil::TempDir,
    Store,
    CaptureOwner,
    protocol::Prepared,
    PtyManager,
    std::path::PathBuf,
    String,
) {
    prepared_fixture_with_resources(alias, None).await
}

async fn prepared_fixture_with_resources(
    alias: bool,
    resources: Option<(PtyManager, std::path::PathBuf, Vec<String>)>,
) -> (
    crate::testutil::TempDir,
    Store,
    CaptureOwner,
    protocol::Prepared,
    PtyManager,
    std::path::PathBuf,
    String,
) {
    let host = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("pa-capture-host.exe");
    let host_hash = digest(&std::fs::read(&host).unwrap());
    let provider = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap())
        .join("System32")
        .join("sort.exe");
    let (dir, store, run_id) = fixture().await;
    let provider = if alias {
        let copied = dir.path().join("codex.exe");
        std::fs::copy(&provider, &copied).unwrap();
        copied
    } else {
        provider
    };
    let timeout_ms = if resources.is_some() { 40000 } else { 20000 };
    let (manager, provider, args) =
        resources.unwrap_or_else(|| (PtyManager::default(), provider, vec![]));
    let provider_hash = digest(&std::fs::read(&provider).unwrap());
    let session = manager.reserve_session().unwrap();
    let reserved = store
        .reserve_development_launch(&run_id, "owner", 1, "codex")
        .await
        .unwrap();
    bind_test_route(&store, &run_id).await;
    store
        .consume_development_launch(&run_id, "owner", 1, &reserved.worker_id, &session)
        .await
        .unwrap();
    let input = b"z\r\na\r\n";
    let delivery = store
        .begin_development_delivery(&run_id, "owner", 1, &session, input)
        .await
        .unwrap();
    let binding = Binding {
        run_id: run_id.clone(),
        session_id: session.clone(),
        process_instance: delivery.process_instance,
        capability: "f".repeat(64),
        route_sha256: delivery.route_sha256,
    };
    let launch = Launch {
        executable: provider.to_string_lossy().into_owned(),
        executable_sha256: provider_hash,
        args,
        cwd: dir.path().to_string_lossy().into_owned(),
        environment: vec![],
        input_bytes: input.len(),
        input_sha256: delivery.input_sha256,
        output_limit: 1000,
        timeout_ms,
    };
    let owner = store
        .reserve_native_capture_owner(binding.clone(), launch.clone(), "owner", 1)
        .await
        .unwrap();
    let (mut header, tail) = protocol::launch_parts(binding, launch, input).unwrap();
    header.extend(tail);
    let prepared = protocol::prepare_buffer(&header).unwrap();
    (dir, store, owner, prepared, manager, host, host_hash)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires cargo build --bin pa-capture-host and native Windows execution"]
async fn real_native_host_commits_checkpoints_before_registry_and_final_handler_retire() {
    let (_dir, store, owner, prepared, manager, host, host_hash) = prepared_fixture(false).await;
    let run_id = owner.binding.run_id.clone();
    let session = owner.binding.session_id.clone();
    let runtime = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || {
        managed::run(&manager,&store,&owner,(&host,&host_hash),prepared,&runtime,|settled| {
            let managed::Settled::Completed(reply) = settled else { panic!("sort input was delivered") };
            assert_eq!(reply.capture.stdout,b"a\r\nz\r\n");
            assert!(reply.capture.stderr.is_empty());
            assert_eq!(manager.live_session_ids().unwrap(),vec![session]);
            assert!(manager.install_when_idle(|| panic!("final handler still running")).is_err());
            let (count,state): (i64,String) = runtime.block_on(sqlx::query_as("SELECT (SELECT count(*) FROM development_capture_checkpoints WHERE run_id=?),state FROM development_capture_owners WHERE run_id=?").bind(&run_id).bind(&run_id).fetch_one(&store.pool)).unwrap();
            assert_eq!(count,4);
            assert_eq!(state,"closed");
            let (launch_state,exit_code,result_json,budget_state):(String,i64,String,String)=runtime.block_on(sqlx::query_as("SELECT l.state,l.exit_code,c.result_json,b.state FROM development_launches l JOIN development_capture_results c ON c.run_id=l.run_id JOIN development_token_reservations b ON b.run_id=l.run_id WHERE l.run_id=?").bind(&run_id).fetch_one(&store.pool)).unwrap();
            assert_eq!(launch_state,"exited");
            assert_eq!(exit_code,0);
            assert_eq!(budget_state,"started");
            let result:Value=serde_json::from_str(&result_json).unwrap();
            assert_eq!(result["state"],"native_cleanup_confirmed");
            assert_eq!(result["usage"]["state"],"not_reported");
            // Native sort proves completion/lifetime, never AI provider usage.
            Ok(())
        }).unwrap();
        assert!(manager.live_session_ids().unwrap().is_empty());
    }).await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires built capture host; isolated native process and local credential server"]
async fn real_native_job_revokes_credentials_before_retirement_or_reconciliation() {
    for case in 0..5 {
        let (dir, store, owner, prepared, manager, host, mut host_hash) =
            prepared_fixture(false).await;
        let run = owner.binding.run_id.clone();
        let session = owner.binding.session_id.clone();
        let worker: String =
            sqlx::query_scalar("SELECT worker_id FROM development_launches WHERE run_id=?")
                .bind(&run)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        sqlx::query("INSERT INTO workers(id,project_id,task,profile_id,branch,worktree_path,status,kind,created_at) SELECT worker_id,project_id,'native fixture','codex','fixture','fixture','running','worker',unixepoch() FROM development_launches WHERE run_id=?")
            .bind(&run).execute(&store.pool).await.unwrap();
        store.bind_session_in_memory(&worker, &session).unwrap();
        store.record_session_start(&worker, &session).await;
        let server = crate::api::tests::native_server(&dir.path().join("api"), &run, "owner", 1);
        let issuer = server.run_credential_issuer();
        let descriptor_path = issuer
            .issue_run_descriptor_file(&run, "owner", 1, 60)
            .unwrap();
        let descriptor: crate::api::Descriptor =
            serde_json::from_slice(&std::fs::read(&descriptor_path).unwrap()).unwrap();
        issuer.bind_session(&run, &session).unwrap();
        assert_eq!(crate::api::tests::native_context_status(&descriptor), 200);
        match case {
            1 => host_hash = "0".repeat(64),
            2 => manager.kill(&session).unwrap(),
            3 => {
                sqlx::query("CREATE TRIGGER reject_worker_close BEFORE UPDATE OF status ON workers BEGIN SELECT RAISE(ABORT,'fixture worker close'); END").execute(&store.pool).await.unwrap();
            }
            4 => {
                sqlx::query("CREATE TRIGGER reject_capture BEFORE INSERT ON development_capture_results BEGIN SELECT RAISE(ABORT,'fixture capture write'); END").execute(&store.pool).await.unwrap();
            }
            _ => {}
        }
        let runtime = tokio::runtime::Handle::current();
        tokio::task::spawn_blocking(move || {
            let job = crate::workers::native_launch::NativeJob::fixture(store.clone(), owner, prepared);
            let result = job.execute(&manager, (&host, &host_hash), &runtime, &issuer);
            assert_eq!(result.is_ok(), case == 0, "case {case}: {result:?}");
            assert!(!descriptor_path.exists(), "case {case}");
            assert_eq!(crate::api::tests::native_context_status(&descriptor), 401);
            let ids = manager.live_session_ids().unwrap();
            assert_eq!(ids.is_empty(), case == 0);
            let (status, ended, exit): (String, Option<i64>, Option<i64>) = runtime.block_on(sqlx::query_as("SELECT w.status,s.ended_at,s.exit_code FROM workers w JOIN sessions s ON s.worker_id=w.id WHERE s.id=?").bind(&session).fetch_one(&store.pool)).unwrap();
            assert_eq!(ended.is_some(), case == 0);
            assert_eq!(exit, if case == 0 { Some(0) } else { None });
            assert_eq!(status, if case == 0 { "exited" } else { "running" });
            assert_eq!(store.session_for_worker(&worker).is_none(), case == 0);
            let run_status: String = runtime.block_on(sqlx::query_scalar("SELECT status FROM development_runs WHERE id=?").bind(&run).fetch_one(&store.pool)).unwrap();
            assert_eq!(run_status, "reconciling");
            drop(server);
        }).await.unwrap();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires built capture host and native Windows resource dispatcher"]
async fn real_native_runner_dispatches_owned_job_and_joins_completion() {
    native_runner_completion_fixture(false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires built Windows capture host; failed session finalization"]
async fn real_native_runner_retains_failed_completion_during_drain() {
    native_runner_completion_fixture(true).await;
}

async fn native_runner_completion_fixture(fail: bool) {
    use crate::workers::{
        native_launch::{NativeJob, NativeRunner},
        native_runner::{Configuration, WindowsNativeRunner},
    };
    let (dir, store, owner, prepared, manager, host, host_sha256) = prepared_fixture(true).await;
    let run = owner.binding.run_id.clone();
    let session = owner.binding.session_id.clone();
    let worker: String =
        sqlx::query_scalar("SELECT worker_id FROM development_launches WHERE run_id=?")
            .bind(&run)
            .fetch_one(&store.pool)
            .await
            .unwrap();
    sqlx::query("INSERT INTO workers(id,project_id,task,profile_id,branch,worktree_path,status,kind,created_at) SELECT worker_id,project_id,'native fixture','codex','fixture','fixture','running','worker',unixepoch() FROM development_launches WHERE run_id=?")
        .bind(&run).execute(&store.pool).await.unwrap();
    store.bind_session_in_memory(&worker, &session).unwrap();
    store.record_session_start(&worker, &session).await;
    if fail {
        sqlx::query("CREATE TRIGGER reject_worker_close BEFORE UPDATE OF status ON workers BEGIN SELECT RAISE(ABORT,'fixture close failure'); END")
            .execute(&store.pool).await.unwrap();
    }
    let server = crate::api::tests::native_server(&dir.path().join("api"), &run, "owner", 1);
    let issuer = server.run_credential_issuer();
    let descriptor_path = issuer
        .issue_run_descriptor_file(&run, "owner", 1, 60)
        .unwrap();
    let descriptor: crate::api::Descriptor =
        serde_json::from_slice(&std::fs::read(&descriptor_path).unwrap()).unwrap();
    issuer.bind_session(&run, &session).unwrap();
    assert_eq!(crate::api::tests::native_context_status(&descriptor), 200);
    let provider = std::path::PathBuf::from(&prepared.launch().executable);
    let runner = WindowsNativeRunner::new(
        Configuration {
            provider: provider.clone(),
            provider_sha256: prepared.launch().executable_sha256.clone(),
            host,
            host_sha256,
            environment: vec![],
            timeout_ms: 20000,
            output_limit: 1000,
        },
        manager.clone(),
        issuer,
        tokio::runtime::Handle::current(),
    )
    .unwrap();
    tokio::task::spawn_blocking(move || {
        assert!(manager
            .install_when_idle(|| panic!("reserved job"))
            .is_err());
        runner
            .start(NativeJob::fixture(store.clone(), owner, prepared))
            .unwrap();
        let completion = runner
            .wait_completion(std::time::Duration::from_secs(15))
            .unwrap()
            .expect("completion event");
        assert_eq!(completion.session_id, session);
        assert_eq!(completion.result.is_err(), fail);
        assert!(runner
            .wait_completion(std::time::Duration::ZERO)
            .unwrap()
            .is_none());
        assert_eq!(manager.live_session_ids().unwrap().is_empty(), !fail);
        assert_eq!(store.session_for_worker(&worker).is_none(), !fail);
        assert!(!descriptor_path.exists());
        assert_eq!(crate::api::tests::native_context_status(&descriptor), 401);
        for _ in 0..2 {
            let drained = runner.drain(std::time::Duration::ZERO).unwrap();
            assert!(drained.running.is_empty());
            assert!(drained.completions.is_empty());
            assert_eq!(
                drained.unresolved,
                if fail { vec![session.clone()] } else { vec![] }
            );
        }
        // Resource configuration does not keep an idle binary locked forever.
        std::fs::remove_file(&provider).unwrap();
        drop(server);
        drop(dir);
    })
    .await
    .unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires built Windows capture host; real concurrent processes"]
async fn real_native_runner_bounds_capacity_and_accepts_out_of_order_completion() {
    use crate::workers::{
        native_launch::{NativeJob, NativeRunner},
        native_runner::{Configuration, WindowsNativeRunner},
    };
    let resources = crate::testutil::TempDir::new("native-concurrency");
    let host = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("pa-capture-host.exe");
    let host_sha256 = digest(&std::fs::read(&host).unwrap());
    let provider = resources.path().join("codex.exe");
    std::fs::copy(&host, &provider).unwrap();
    let manager = PtyManager::default();
    let mut fixtures = Vec::new();
    for index in 0..5 {
        let args = vec![if index == 0 {
            "--fixture-long-running"
        } else {
            "--fixture-live-output"
        }
        .into()];
        let fixture =
            prepared_fixture_with_resources(false, Some((manager.clone(), provider.clone(), args)))
                .await;
        let (_, store, owner, _, _, _, _) = &fixture;
        let run = &owner.binding.run_id;
        let session = &owner.binding.session_id;
        sqlx::query("INSERT INTO workers(id,project_id,task,profile_id,branch,worktree_path,status,kind,created_at) SELECT worker_id,project_id,'concurrent fixture','codex','fixture','fixture','running','worker',unixepoch() FROM development_launches WHERE run_id=?")
            .bind(run).execute(&store.pool).await.unwrap();
        let worker: String =
            sqlx::query_scalar("SELECT worker_id FROM development_launches WHERE run_id=?")
                .bind(run)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        store.bind_session_in_memory(&worker, session).unwrap();
        store.record_session_start(&worker, session).await;
        if index != 0 {
            std::fs::write(fixture.0.path().join("capture-ack.txt"), b"observed").unwrap();
        }
        fixtures.push(fixture);
    }
    let server = crate::api::tests::native_server(
        &resources.path().join("api"),
        &fixtures[0].2.binding.run_id,
        "owner",
        1,
    );
    let runner = WindowsNativeRunner::new(
        Configuration {
            provider,
            provider_sha256: host_sha256.clone(),
            host,
            host_sha256,
            environment: vec![],
            timeout_ms: 40000,
            output_limit: 1000,
        },
        manager.clone(),
        server.run_credential_issuer(),
        tokio::runtime::Handle::current(),
    )
    .unwrap();
    let runtime = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || {
        let mut directories = Vec::new();
        let mut jobs = Vec::new();
        let mut observations = Vec::new();
        for (dir, store, owner, prepared, _, _, _) in fixtures {
            observations.push((
                store.clone(),
                owner.binding.run_id.clone(),
                owner.binding.session_id.clone(),
            ));
            jobs.push(NativeJob::fixture(store, owner, prepared));
            directories.push(dir);
        }
        runner.start(jobs.remove(0)).unwrap();
        // Wait for actual input-delivery evidence before admitting the fast job.
        // The first child sleeps 31 seconds; fixture construction happened first.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            let count: i64 = runtime
                .block_on(
                    sqlx::query_scalar(
                        "SELECT count(*) FROM development_capture_checkpoints WHERE run_id=?",
                    )
                    .bind(&observations[0].1)
                    .fetch_one(&observations[0].0.pool),
                )
                .unwrap();
            if count >= 3 {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "first process never delivered input"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        runner.start(jobs.remove(0)).unwrap();
        let refused = runner.start(jobs.remove(0)).unwrap_err();
        assert!(refused.contains("capacity"), "{refused}");
        let count: i64 = runtime
            .block_on(
                sqlx::query_scalar(
                    "SELECT count(*) FROM development_capture_checkpoints WHERE run_id=?",
                )
                .bind(&observations[2].1)
                .fetch_one(&observations[2].0.pool),
            )
            .unwrap();
        assert_eq!(count, 0, "refused job executed");
        assert!(manager
            .live_session_ids()
            .unwrap()
            .contains(&observations[2].2));
        let second = runner
            .wait_completion(std::time::Duration::from_secs(10))
            .unwrap()
            .unwrap();
        assert_eq!(second.session_id, observations[1].2);
        second.result.unwrap();
        assert!(manager
            .live_session_ids()
            .unwrap()
            .contains(&observations[0].2));
        assert!(manager
            .install_when_idle(|| panic!("first job is active"))
            .is_err());
        runner.start(jobs.remove(0)).unwrap();
        let fourth = runner
            .wait_completion(std::time::Duration::from_secs(10))
            .unwrap()
            .unwrap();
        assert_eq!(fourth.session_id, observations[3].2);
        fourth.result.unwrap();
        let pending = runner.drain(std::time::Duration::ZERO).unwrap();
        assert_eq!(pending.running, vec![observations[0].2.clone()]);
        assert!(pending.completions.is_empty());
        assert!(pending.unresolved.is_empty());
        let refused = runner.start(jobs.remove(0)).unwrap_err();
        assert!(refused.contains("admission is closed"), "{refused}");
        let count: i64 = runtime
            .block_on(
                sqlx::query_scalar(
                    "SELECT count(*) FROM development_capture_checkpoints WHERE run_id=?",
                )
                .bind(&observations[4].1)
                .fetch_one(&observations[4].0.pool),
            )
            .unwrap();
        assert_eq!(count, 0, "closed admission launched a process");
        let mut drained = runner.drain(std::time::Duration::from_secs(40)).unwrap();
        assert!(drained.running.is_empty());
        assert!(drained.unresolved.is_empty());
        assert_eq!(drained.completions.len(), 1);
        let first = drained.completions.remove(0);
        assert_eq!(first.session_id, observations[0].2);
        first.result.unwrap();
        assert!(runner
            .wait_completion(std::time::Duration::ZERO)
            .unwrap()
            .is_none());
        // Refused ownership stays reserved: production handoff reconciles it.
        // This test explicitly removes only the reservation which never started.
        assert_eq!(
            manager
                .live_session_ids()
                .unwrap()
                .into_iter()
                .collect::<std::collections::BTreeSet<_>>(),
            [observations[2].2.clone(), observations[4].2.clone()]
                .into_iter()
                .collect()
        );
        manager.cancel_reservation(&observations[2].2);
        manager.cancel_reservation(&observations[4].2);
        assert!(manager.live_session_ids().unwrap().is_empty());
        drop(server);
        drop(directories);
        drop(resources);
    })
    .await
    .unwrap();
}
