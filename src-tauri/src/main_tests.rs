    #[tokio::test]
    async fn stalled_download_times_out_with_an_error() {
        let stalled = std::future::pending::<Result<Vec<u8>, String>>();
        let outcome = tokio::time::timeout(
            Duration::from_secs(5),
            crate::bounded_download(stalled, Duration::from_millis(20)),
        )
        .await
        .expect("bounded_download must return on its own");
        assert!(outcome.unwrap_err().contains("timed out"));
    }

    #[tokio::test]
    async fn finished_download_passes_bytes_and_errors_through() {
        let ok = async { Ok::<_, String>(vec![1, 2]) };
        assert_eq!(
            crate::bounded_download(ok, Duration::from_secs(5)).await,
            Ok(vec![1, 2])
        );
        let failed = async { Err::<Vec<u8>, _>("boom".to_string()) };
        assert_eq!(
            crate::bounded_download(failed, Duration::from_secs(5)).await,
            Err("boom".to_string())
        );
    }

    use super::{Duration, PtyManager};
    use std::path::PathBuf;

    #[test]
    fn deferred_modules_are_private_without_blanket_dead_code_suppression() {
        const SOURCE: &str = include_str!("main.rs");
        let code = &SOURCE[..SOURCE.find("mod tests").expect("this module exists")];
        let lines: Vec<&str> = code.lines().collect();

        for module in [
            "delivery_recovery",
            "development_plan",
            "development_policy",
        ] {
            let suffix = format!("mod {module};");
            let declaration = lines
                .iter()
                .position(|line| line.trim_end().ends_with(&suffix))
                .unwrap_or_else(|| panic!("{module} module declaration exists"));
            assert_eq!(
                lines[declaration].trim(),
                suffix,
                "{module} must stay private so dead_code analysis reaches it"
            );
            let preceding = lines[..declaration]
                .iter()
                .rev()
                .find(|line| !line.trim().is_empty())
                .expect("module declaration has a preceding line")
                .trim();
            assert!(
                !preceding.contains("allow(dead_code)"),
                "{module} has a module-wide dead_code suppression; annotate only the known deferred items"
            );
        }
    }

    /// The stats-range refusal names every window it accepts, aliases
    /// included - and the aliases it names are really accepted. Third and
    /// last sibling of the same lie: `pa.rs:157/978/1607` and `api.rs:1618`
    /// were fixed first (dual reviews `.pa/review_pa_stats_r1/r2.md`,
    /// `.pa/review_api_stats_r1/r2.md`), and Rev 4 of the spec put this one
    /// into the B.2 window. Double assertion like `api.rs`: the refusal names
    /// the aliases, and the aliases parse.
    #[test]
    fn the_stats_range_refusal_names_the_aliases_it_accepts() {
        let refusal = super::parse_stats_range(Some("nope")).unwrap_err();
        assert!(refusal.contains("7d"), "{refusal}");
        assert!(refusal.contains("30d"), "{refusal}");

        assert!(super::parse_stats_range(Some("7d")).is_ok(), "{refusal}");
        assert!(super::parse_stats_range(Some("30d")).is_ok(), "{refusal}");
    }

    /// F-CORE-3 B.2 (T8): `send_to_worker` delivers through the submit guard,
    /// never as a blind `write("{text}\r")` - the blind write is the second
    /// delivery path the audit found, and it lands in a blocking dialog or a
    /// busy prompt without anyone noticing. Same scan style as the proc.rs
    /// source scans: the body slice keeps the needle from matching the other
    /// write paths in this file.
    #[test]
    fn send_to_worker_contains_no_blind_write() {
        const SOURCE: &str = include_str!("main.rs");
        // Scan only the code above this module - otherwise the needles find
        // this test's own string literals and read garbage.
        let code = &SOURCE[..SOURCE.find("mod tests").expect("this module exists")];
        let start = code
            .find("fn send_to_worker(")
            .expect("send_to_worker exists");
        let body = &code[start..];
        let end = body[1..]
            .find("\n    fn ")
            .map(|at| at + 1)
            .expect("a following method closes the body");
        let body = &body[..end];
        assert!(
            !body.contains(".write("),
            "send_to_worker must not type into the PTY itself - a blind \
             write(\"{{text}}\\r\") lands in dialogs and busy prompts; deliver \
             through the submit guard (start_task_delivery):\n{body}"
        );
        assert!(
            body.contains("deliver_to_worker"),
            "send_to_worker no longer goes through the guard seam - fix the \
             scan or restore the delivery"
        );
    }

    /// A store failure while reading the readiness marker must travel, not
    /// turn into "this worker has no marker". Without a marker the guard
    /// falls back to the silence heuristic and writes after
    /// `READY_MAX_WAIT`; a database hiccup would then type into a busy
    /// prompt - exactly the NT-17 class this seam was built to close. Only
    /// a profile that defines no marker may yield `None`.
    #[test]
    fn the_readiness_marker_lookup_does_not_swallow_store_errors() {
        const SOURCE: &str = include_str!("main.rs");
        let code = &SOURCE[..SOURCE.find("mod tests").expect("this module exists")];
        let start = code
            .find("fn send_to_worker(")
            .expect("send_to_worker exists");
        let body = &code[start..];
        let end = body[1..]
            .find("\n    fn ")
            .map(|at| at + 1)
            .expect("a following method closes the body");
        let body = &body[..end];
        assert!(
            !body.contains(".ok()"),
            "the readiness-marker lookup drops the store error with .ok() - \
             a failed read then looks like a profile without a marker and \
             the guard writes into a busy prompt after READY_MAX_WAIT; \
             propagate with ? instead:\n{body}"
        );
    }

    // -- F-CORE-3 B.2: the send_to_worker delivery seam ----------------------

    /// A recorded `start_task_delivery` call: (worker, session, text,
    /// readiness marker).
    type Delivery = (String, String, String, Option<String>);

    /// An `AgentControl` that records what the seam asks of it and holds the
    /// outcome callback back, so the test can play the guard and fire the
    /// verdict itself - the Typist pattern from questions.rs.
    #[derive(Default)]
    struct Typist {
        writes: std::sync::Mutex<Vec<(String, String)>>,
        deliveries: std::sync::Mutex<Vec<Delivery>>,
        outcomes: std::sync::Mutex<Vec<Option<super::DeliveryCallback>>>,
    }

    impl Typist {
        fn writes(&self) -> Vec<(String, String)> {
            self.writes.lock().unwrap().clone()
        }

        fn deliveries(&self) -> Vec<Delivery> {
            self.deliveries.lock().unwrap().clone()
        }

        /// Fire the guard verdict the fake kept back, like the real guard
        /// does from its thread once delivery is proven or gave up.
        fn confirm(&self, outcome: super::DeliveryOutcome) {
            let callback = self.outcomes.lock().unwrap()[0]
                .take()
                .expect("a pending delivery outcome");
            callback(outcome);
        }
    }

    impl super::AgentControl for Typist {
        fn spawn(
            &self,
            _worker_id: &str,
            _profile: &crate::profiles::AgentProfile,
            _cwd: &std::path::Path,
            _env: &[(String, String)],
        ) -> Result<String, String> {
            unreachable!("send_to_worker never spawns an agent")
        }

        fn write(&self, session_id: &str, text: &str) -> Result<(), String> {
            self.writes
                .lock()
                .unwrap()
                .push((session_id.to_string(), text.to_string()));
            Ok(())
        }

        fn start_task_delivery(
            &self,
            worker_id: &str,
            session_id: &str,
            task: &str,
            readiness_marker: Option<&str>,
            on_outcome: Option<super::DeliveryCallback>,
        ) -> Result<(), String> {
            self.deliveries.lock().unwrap().push((
                worker_id.to_string(),
                session_id.to_string(),
                task.to_string(),
                readiness_marker.map(str::to_string),
            ));
            self.outcomes.lock().unwrap().push(on_outcome);
            Ok(())
        }

        fn kill(&self, _session_id: &str) {}
    }

    async fn roles(store: &super::Store, worker_id: &str) -> Vec<(String, String)> {
        store
            .list_messages(worker_id, None)
            .await
            .expect("messages")
            .into_iter()
            .map(|m| (m.role, m.content))
            .collect()
    }

    /// Poll the log until `found` holds: the outcome callback logs
    /// fire-and-forget through `workers::log_message`, the same way the
    /// questions.rs tests wait for it.
    async fn wait_for_log(
        store: &super::Store,
        worker_id: &str,
        what: &str,
        found: impl Fn(&[(String, String)]) -> bool,
    ) -> Vec<(String, String)> {
        for _ in 0..200 {
            let log = roles(store, worker_id).await;
            if found(&log) {
                return log;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        panic!("{worker_id} never logged {what}");
    }

    async fn seam_fixture(label: &str) -> (crate::testutil::TempDir, super::Store) {
        let dir = crate::testutil::TempDir::new(label);
        let store = super::Store::open(&dir.path().join("projecta.db"))
            .await
            .expect("open store");
        (dir, store)
    }

    #[tokio::test]
    async fn direct_terminal_profile_follows_the_global_env_stage() {
        use crate::profiles::EnvIsolation;
        let (_dir, store) = seam_fixture("direct-pty-env-stage").await;
        let id = crate::profiles::load_profiles().remove(0).id;
        let strict = super::direct_pty_profile(&store, &id).await.unwrap();
        assert_eq!(strict.env_policy.isolation, EnvIsolation::Strict);
        store
            .set_agent_env_isolation(EnvIsolation::Inherit)
            .await
            .unwrap();
        let inherit = super::direct_pty_profile(&store, &id).await.unwrap();
        assert_eq!(inherit.env_policy.isolation, EnvIsolation::Inherit);
        assert!(super::direct_pty_profile(&store, "no-such").await.is_err());
    }

    #[tokio::test]
    async fn set_budget_command_null_removes_existing_ceiling() {
        let (_dir, store) = seam_fixture("set-budget-null").await;
        let profile_id = crate::profiles::load_profiles()
            .into_iter()
            .next()
            .expect("at least one bundled profile")
            .id;
        crate::budget::update_limits(&store, &profile_id, Some(Some(80)), Some(Some(70)))
            .await
            .expect("seed five-hour ceiling");

        // Parse the exact wire body the desktop command receives. The Tauri mock
        // IPC applies the capability ACL, which rejects the command on Windows
        // ("set_budget not allowed. Plugin not found"), so the command's parse
        // step is exercised directly on every platform.
        let args = super::parse_set_budget_args(&tauri::ipc::InvokeBody::Json(serde_json::json!({
            "profileId": profile_id,
            "fiveHourPct": null,
        })))
        .expect("set_budget arguments parse");
        crate::budget::update_limits(
            &store,
            &args.profile_id,
            args.five_hour_pct,
            args.seven_day_pct,
        )
        .await
        .expect("set_budget update succeeds");

        assert_eq!(
            store
                .get_setting(&format!("budget.{profile_id}.five_hour_pct"))
                .await
                .expect("read five-hour ceiling"),
            None,
            "an explicit JSON null must remove the stored ceiling"
        );
        assert_eq!(
            store
                .get_setting(&format!("budget.{profile_id}.seven_day_pct"))
                .await
                .expect("read seven-day ceiling"),
            Some("70".to_string()),
            "an omitted field must leave its stored ceiling unchanged"
        );
    }

    #[tokio::test]
    async fn maintenance_is_refused_while_a_session_is_active() {
        let (_dir, store) = seam_fixture("maintenance-busy").await;
        let pty = PtyManager::default();
        let id = pty.reserve_session().unwrap();
        let error = super::enter_database_maintenance(&pty, &store, Duration::from_millis(120))
            .await
            .expect_err("an active session must refuse maintenance");
        assert!(error.contains(&id), "{error}");
        assert!(!store.is_maintenance_active());
        store.create_project("still-writes", "/w").await.unwrap();
        pty.cancel_reservation(&id);
        assert!(pty.reserve_session().is_ok());
    }

    #[tokio::test]
    async fn maintenance_refusal_uses_shared_error_vocabulary() {
        let (_dir, store) = seam_fixture("maintenance-refusal-vocabulary").await;
        let pty = PtyManager::default();
        let id = pty.reserve_session().unwrap();
        let error = super::enter_database_maintenance(&pty, &store, Duration::ZERO)
            .await
            .expect_err("an active session must refuse maintenance");
        assert!(error.starts_with(crate::errors::ERR_REFUSED), "{error}");
        pty.cancel_reservation(&id);
    }

    #[tokio::test]
    async fn drained_maintenance_freezes_launches_and_writes_until_leave() {
        let (_dir, store) = seam_fixture("maintenance-frozen").await;
        let pty = PtyManager::default();
        let id = pty.reserve_session().unwrap();
        let finisher = pty.clone();
        let finishing = id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            finisher.cancel_reservation(&finishing);
        });
        super::enter_database_maintenance(&pty, &store, Duration::from_secs(5))
            .await
            .expect("the session drains in time");
        assert!(store.is_maintenance_active());
        assert!(pty.reserve_session().is_err());
        assert!(pty.install_when_idle(|| Ok(())).is_err());
        assert!(
            super::enter_database_maintenance(&pty, &store, Duration::ZERO)
                .await
                .is_err()
        );
        tokio::time::timeout(Duration::from_secs(8), store.create_project("frozen", "/f"))
            .await
            .expect("bounded wait")
            .expect_err("writes are refused during maintenance");
    }

    /// Enter a single-flight install already under store/PTY maintenance.
    async fn begin_install_under_maintenance<'a>(
        state: &'a crate::update_cancel::UpdateCancel,
        pty: &PtyManager,
        store: &super::Store,
    ) -> crate::update_cancel::Install<'a> {
        crate::update_cancel::enter_or_abort(
            state.begin().expect("begin install"),
            super::enter_database_maintenance(pty, store, Duration::from_secs(1)),
        )
        .await
        .expect("enter maintenance through cancel glue")
    }

    #[tokio::test]
    async fn cancel_with_completed_previous_journal_thaws_app() {
        use crate::delivery_recovery::*;
        use crate::update_cancel::{self, CancelResult};

        let (dir, store) = seam_fixture("cancel-previous-journal").await;
        let pty = PtyManager::default();
        super::enter_database_maintenance(&pty, &store, Duration::from_secs(1))
            .await
            .unwrap();
        let database = dir.path().join("projecta.db");
        let exe = dir.path().join("app");
        std::fs::write(&exe, b"binary").unwrap();
        let journal_store =
            JournalStore::new(dir.path().join("update-recovery.json"), &database).unwrap();
        let mut journal = produce_journal(
            &pty,
            &store,
            journal_store.clone(),
            &Announced {
                exe: &exe,
                database: &database,
                version: "1.6.0",
                bytes: b"installer",
                manifest: "{}",
            },
        )
        .await
        .unwrap();
        journal.begin_install().unwrap();
        assert!(journal_store.installer_started());
        journal.begin_validation().unwrap();
        let RecoveryAction::ValidateCandidate { candidate, nonce } = journal.next_action() else {
            panic!("candidate validation expected");
        };
        journal
            .accept_handshake(&InstanceHandshake {
                binary: candidate.binary,
                database: candidate.database,
                nonce,
                process: ProcessIdentity {
                    process_id: 4242,
                    started_at_unix_millis: 1,
                },
                validation: ValidationProof {
                    validation: ValidationAssertion::CandidateReady,
                    health: HealthAssertion::Healthy,
                    validation_evidence_id: "validated".into(),
                    health_evidence_id: "healthy".into(),
                },
            })
            .unwrap();
        assert!(journal_store.installer_started());
        journal
            .resume_writes(WriteResumption {
                evidence_id: "resumed".into(),
            })
            .unwrap();
        assert_eq!(
            journal_store.load().unwrap().phase(),
            UpdatePhase::Installed
        );
        assert!(journal_store.load().unwrap().can_accept_writes());
        super::leave_database_maintenance(&pty, &store)
            .await
            .unwrap();

        let state = update_cancel::UpdateCancel::default();
        let install = begin_install_under_maintenance(&state, &pty, &store).await;
        let body = async {
            // Cancel the next flight during download, before it can replace the old journal.
            let result = install
                .download(std::future::pending::<std::result::Result<(), String>>())
                .await;
            super::finish_install_flight(install, result, &journal_store, &pty, &store).await
        };
        let (result, cancelled) = tokio::time::timeout(Duration::from_secs(8), async {
            tokio::join!(body, state.cancel())
        })
        .await
        .expect("cancel and finish must return");
        assert!(result.unwrap_err().contains("cancelled"));
        assert!(
            !store.is_maintenance_active(),
            "completed old journal must not keep the app frozen"
        );
        assert!(!pty.is_maintenance_active());
        store
            .create_project("after", "/a")
            .await
            .expect("writes accepted");
        let id = pty.reserve_session().expect("launches accepted");
        pty.cancel_reservation(&id);
        state
            .begin()
            .expect("flight slot free")
            .finish_unstarted()
            .unwrap();
        assert_eq!(cancelled, Ok(CancelResult::Cancelled));

        let retry = begin_install_under_maintenance(&state, &pty, &store).await;
        let next = produce_journal(
            &pty,
            &store,
            journal_store,
            &Announced {
                exe: &exe,
                database: &database,
                version: "1.6.1",
                bytes: b"next installer",
                manifest: "{}",
            },
        )
        .await
        .expect("a cancelled download must allow the next update journal");
        assert_eq!(next.journal().phase(), UpdatePhase::BackupVerified);
        retry
            .finish(super::leave_database_maintenance(&pty, &store))
            .await
            .unwrap();
    }

    /// R821-M2: TooLate must keep the real store/PTY freeze, not only the
    /// single-flight slot (`cancel_after_installer_started_is_too_late_and_keeps_freeze`).
    #[tokio::test]
    async fn too_late_after_installer_started_keeps_maintenance_freeze() {
        use crate::update_cancel::{self, CancelResult};
        use std::future::ready;

        let (_dir, store) = seam_fixture("too-late-real-freeze").await;
        let pty = PtyManager::default();
        let state = update_cancel::UpdateCancel::default();
        let install = begin_install_under_maintenance(&state, &pty, &store).await;
        install
            .download(ready(Ok(())))
            .await
            .expect("download marks Installing");
        assert_eq!(
            state.cancel().await.expect("cancel while Installing"),
            CancelResult::TooLate
        );
        update_cancel::finish_flight(
            install,
            Ok(()),
            true,
            super::leave_database_maintenance(&pty, &store),
        )
        .await
        .expect("installer-started finish keeps the freeze");
        assert!(
            store.is_maintenance_active(),
            "store freeze must survive TooLate"
        );
        assert!(
            pty.reserve_session().is_err(),
            "PTY launches must stay refused after TooLate"
        );
        assert!(
            pty.install_when_idle(|| Ok(())).is_err(),
            "install_when_idle must stay refused after TooLate"
        );
        tokio::time::timeout(Duration::from_secs(8), store.create_project("frozen", "/f"))
            .await
            .expect("bounded wait")
            .expect_err("writes must stay refused after TooLate");
        let begin_err = state
            .begin()
            .map(|_| ())
            .expect_err("single-flight slot must stay occupied after TooLate");
        assert!(
            begin_err.starts_with(crate::errors::ERR_REFUSED),
            "{begin_err}"
        );
    }

    /// Negative control for R821-M2: a body error before the installer starts
    /// must fully thaw store/PTY maintenance and free the single-flight slot.
    #[tokio::test]
    async fn body_error_before_installer_started_releases_maintenance_freeze() {
        use crate::update_cancel;

        let (_dir, store) = seam_fixture("pre-installer-thaw").await;
        let pty = PtyManager::default();
        let state = update_cancel::UpdateCancel::default();
        let install = begin_install_under_maintenance(&state, &pty, &store).await;
        assert!(store.is_maintenance_active());
        let err = update_cancel::finish_flight(
            install,
            Err("download failed".into()),
            false,
            super::leave_database_maintenance(&pty, &store),
        )
        .await
        .expect_err("body error before installer must surface");
        assert!(
            err.contains("download failed"),
            "surfaced error must carry the body text: {err}"
        );
        assert!(
            !store.is_maintenance_active(),
            "freeze must release when the installer never started"
        );
        let id = pty
            .reserve_session()
            .expect("PTY launches must work again after thaw");
        pty.cancel_reservation(&id);
        tokio::time::timeout(Duration::from_secs(8), store.create_project("after", "/a"))
            .await
            .expect("bounded wait")
            .expect("writes must work again after thaw");
        state
            .begin()
            .expect("single-flight slot must be free after thaw")
            .finish_unstarted()
            .expect("release probe install");
    }

    /// Off-diagonal: body error with installer_started=true keeps freeze and slot
    /// (finish_flight only thaws when both body fails and installer never started).
    #[tokio::test]
    async fn body_error_after_installer_started_keeps_maintenance_freeze() {
        use crate::update_cancel;

        let (_dir, store) = seam_fixture("post-installer-body-err").await;
        let pty = PtyManager::default();
        let state = update_cancel::UpdateCancel::default();
        let install = begin_install_under_maintenance(&state, &pty, &store).await;
        let err = update_cancel::finish_flight(
            install,
            Err("download failed".into()),
            true,
            super::leave_database_maintenance(&pty, &store),
        )
        .await
        .expect_err("body error must surface even when installer started");
        assert!(
            err.contains("download failed"),
            "surfaced error must carry the body text: {err}"
        );
        assert!(
            store.is_maintenance_active(),
            "freeze must stay when installer_started is true"
        );
        assert!(
            pty.reserve_session().is_err(),
            "PTY launches must stay refused after installer-started body error"
        );
        assert!(
            state.begin().is_err(),
            "single-flight slot must stay occupied after installer-started body error"
        );
    }

    #[tokio::test]
    async fn leaving_maintenance_restores_launches_and_writes() {
        let (_dir, store) = seam_fixture("maintenance-leave").await;
        let pty = PtyManager::default();
        super::enter_database_maintenance(&pty, &store, Duration::from_secs(1))
            .await
            .unwrap();
        super::leave_database_maintenance(&pty, &store)
            .await
            .unwrap();
        assert!(!store.is_maintenance_active());
        store.create_project("after", "/a").await.unwrap();
        let id = pty.reserve_session().unwrap();
        pty.cancel_reservation(&id);
        assert!(pty.install_when_idle(|| Ok(())).is_ok());
    }

    /// B.2 behavior at the seam: the text travels through
    /// `start_task_delivery` with the profile's readiness marker, and no raw
    /// `write("{text}\r")` reaches the terminal.
    #[tokio::test]
    async fn a_send_to_worker_text_is_delivered_through_the_guard() {
        let (_dir, store) = seam_fixture("send-through-guard").await;
        let typist = Typist::default();

        super::deliver_to_worker(
            &typist,
            &store,
            "wk-1",
            "pty-wk-1",
            "baue das Formular",
            Some("Ask anything"),
        )
        .expect("delivery starts");

        assert_eq!(
            typist.deliveries(),
            vec![(
                "wk-1".to_string(),
                "pty-wk-1".to_string(),
                "baue das Formular".to_string(),
                Some("Ask anything".to_string())
            )],
            "the text must reach the guard with the profile's readiness marker"
        );
        assert!(
            typist.writes().is_empty(),
            "no blind write may reach the terminal: {:?}",
            typist.writes()
        );
    }

    /// The C-2 principle at this seam: `Ok(())` means no more than "the
    /// guard thread is running" - the MSG_USER turn is written by the outcome
    /// callback once the guard proves the delivery.
    #[tokio::test]
    async fn the_sent_text_is_logged_as_a_user_turn_only_after_proven_delivery() {
        let (_dir, store) = seam_fixture("log-after-delivery").await;
        let typist = Typist::default();

        super::deliver_to_worker(&typist, &store, "wk-1", "pty-wk-1", "mach weiter", None)
            .expect("delivery starts");
        assert!(
            roles(&store, "wk-1").await.is_empty(),
            "the guard start is not a delivery - nothing may be logged yet"
        );

        typist.confirm(super::DeliveryOutcome::Delivered);
        let log = wait_for_log(&store, "wk-1", "the user turn", |log| !log.is_empty()).await;
        assert_eq!(
            log,
            vec![(
                crate::store::MSG_USER.to_string(),
                "mach weiter".to_string()
            )]
        );
    }

    /// The Auffangnetz: an escalation persists the undelivered text as
    /// MSG_SYSTEM with the concrete next step, instead of a user turn that
    /// never happened.
    #[tokio::test]
    async fn an_escalation_persists_the_undelivered_text_with_the_next_step() {
        let (_dir, store) = seam_fixture("escalation-net").await;
        let typist = Typist::default();

        super::deliver_to_worker(&typist, &store, "wk-1", "pty-wk-1", "mach weiter", None)
            .expect("delivery starts");
        typist.confirm(super::DeliveryOutcome::Escalated);

        let log = wait_for_log(&store, "wk-1", "the escalation note", |log| !log.is_empty()).await;
        assert_eq!(log.len(), 1, "exactly one note, no phantom user turn");
        let (role, content) = &log[0];
        assert_eq!(role, crate::store::MSG_SYSTEM);
        assert!(
            content.contains("mach weiter"),
            "the note carries the undelivered text: {content}"
        );
        assert!(
            content.contains("nicht zugestellt") && content.contains("nachreichen"),
            "the note names the next step: {content}"
        );
    }

    /// C-5: an escalation before any write means the readiness marker never
    /// appeared and nothing was typed - "manual Enter required" would send
    /// the user pressing Enter into an empty prompt.
    #[test]
    fn an_escalation_before_any_write_reports_the_missing_marker() {
        let mut narrative = super::GuardNarrative::default();
        assert_eq!(
            narrative.detail(&super::SubmitGuardEvent::Escalated),
            "readiness marker never appeared; task not written"
        );
    }

    /// W1-03d (review B2): a waiting delivery names how many are ahead.
    #[test]
    fn a_queued_delivery_names_the_deliveries_ahead() {
        let mut narrative = super::GuardNarrative::default();
        assert_eq!(
            narrative.detail(&super::SubmitGuardEvent::Queued { ahead: 1 }),
            "queued behind 1 earlier delivery to this session"
        );
        assert_eq!(
            narrative.detail(&super::SubmitGuardEvent::Queued { ahead: 3 }),
            "queued behind 3 earlier deliveries to this session"
        );
    }

    /// W1-03d: a delivery stopped by an earlier task in the input line
    /// wrote nothing, but its readiness marker was never the problem - the
    /// escalation names the line, not the marker.
    #[test]
    fn a_blocked_delivery_escalates_without_blaming_the_readiness_marker() {
        let mut narrative = super::GuardNarrative::default();
        narrative.detail(&super::SubmitGuardEvent::InputBlocked);
        let text = narrative.detail(&super::SubmitGuardEvent::Escalated);
        assert!(text.contains("earlier task"), "{text}");
        assert!(!text.contains("readiness marker"), "{text}");
    }

    /// Reviews GLM-5.3 X2 / DeepSeek X1: a delivery whose session was killed
    /// names the session, not a readiness marker it never waited for.
    #[test]
    fn a_delivery_to_an_ended_session_does_not_blame_the_readiness_marker() {
        let mut narrative = super::GuardNarrative::default();
        narrative.detail(&super::SubmitGuardEvent::SessionEnded);
        let text = narrative.detail(&super::SubmitGuardEvent::Escalated);
        assert!(text.contains("session ended"), "{text}");
        assert!(!text.contains("readiness marker"), "{text}");
    }

    /// The write went out but no echo came back: here a manual Enter is
    /// exactly the right next step.
    #[test]
    fn an_escalation_after_the_write_reports_the_missing_echo() {
        let mut narrative = super::GuardNarrative::default();
        narrative.detail(&super::SubmitGuardEvent::Wrote { write: 1 });
        assert_eq!(
            narrative.detail(&super::SubmitGuardEvent::Escalated),
            "task never echoed; manual Enter required"
        );
    }

    #[test]
    fn an_escalation_after_the_final_enter_retry_reports_unanswered_retries() {
        let mut narrative = super::GuardNarrative::default();
        narrative.detail(&super::SubmitGuardEvent::Wrote { write: 1 });
        narrative.detail(&super::SubmitGuardEvent::Enter { attempt: 0 });
        assert_eq!(
            narrative.detail(&super::SubmitGuardEvent::Enter { attempt: 2 }),
            "enter retry 2 after 30s without output",
            "the retry text is unchanged"
        );
        narrative.detail(&super::SubmitGuardEvent::Enter { attempt: 3 });
        assert_eq!(
            narrative.detail(&super::SubmitGuardEvent::Escalated),
            "enter retries unanswered; the task sits on the agent's prompt"
        );
    }

    /// The ANSWER_MARKER_CAP escalation (A.5): Enter went out and the retries
    /// never ran out, yet no answer marker confirmed the agent reacted - its
    /// own, distinguishable text.
    #[test]
    fn an_escalation_after_enter_without_exhausted_retries_reports_the_answer_marker_cap() {
        let mut narrative = super::GuardNarrative::default();
        narrative.detail(&super::SubmitGuardEvent::Wrote { write: 1 });
        narrative.detail(&super::SubmitGuardEvent::Enter { attempt: 0 });
        assert_eq!(
            narrative.detail(&super::SubmitGuardEvent::Escalated),
            "answer marker never appeared; delivery not confirmed"
        );
    }

    /// "task delivery confirmed" is reserved for a marker-confirmed delivery
    /// (ConfirmDelivery); the byte-based Delivered event must not claim it.
    #[test]
    fn the_byte_progress_delivery_does_not_claim_confirmation() {
        let mut narrative = super::GuardNarrative::default();
        let text = narrative.detail(&super::SubmitGuardEvent::Delivered);
        assert!(
            !text.contains("confirmed"),
            "byte progress is not a confirmed delivery: {text}"
        );
    }

    /// R1290-C1: a Dev app whose `pa` and hooks were built for the stable
    /// identifier (or the reverse) would share the stable database. The app
    /// refuses to pick a data directory instead of drifting silently.
    #[test]
    fn mismatched_build_identifier_is_refused() {
        assert_eq!(
            super::check_build_identifier("com.projecta.dev", "com.projecta.dev"),
            Ok(())
        );
        let err = super::check_build_identifier("com.projecta.dev", "com.projecta.app")
            .expect_err("a mismatch must be refused");
        assert!(
            err.contains("com.projecta.dev") && err.contains("com.projecta.app"),
            "the error names both identifiers: {err}"
        );
    }

    #[test]
    fn projecta_app_data_overrides_tauris_app_data_dir() {
        // Mutates PROJECTA_APP_DATA process-wide; the lock keeps it from
        // interleaving with the other test that owns the variable.
        let _guard = crate::testutil::ENV_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tauri = PathBuf::from("C:/Users/someone/AppData/Roaming/com.projecta.app");
        assert_eq!(super::resolve_app_data_dir(tauri.clone()), tauri);
        let previous = std::env::var_os(super::ENV_APP_DATA);
        std::env::set_var(super::ENV_APP_DATA, "D:/scratch/projecta-f8");
        let isolated = super::resolve_app_data_dir(tauri.clone());
        std::env::set_var(super::ENV_APP_DATA, "");
        let empty_means_default = super::resolve_app_data_dir(tauri.clone());
        match previous {
            Some(value) => std::env::set_var(super::ENV_APP_DATA, value),
            None => std::env::remove_var(super::ENV_APP_DATA),
        }
        assert_eq!(isolated, PathBuf::from("D:/scratch/projecta-f8"));
        assert_eq!(empty_means_default, tauri);
    }

    /// W3-02f: update recovery precedes the database and the dispatcher
    /// (source order, like the tests around it).
    #[test]
    fn update_recovery_runs_before_the_database_and_the_dispatcher() {
        const SOURCE: &str = include_str!("main.rs");
        let code = &SOURCE[..SOURCE.find("mod tests").expect("this module exists")];
        let at = |needle: &str| code.find(needle).expect("needle moved - fix the test");
        let recovery = at("delivery_recovery::recover_startup(&dir)");
        assert!(recovery < at("init_store(&handle, &dir)?"));
        assert!(recovery < at("queue::start("));
    }

    /// KI-23, review finding B1 (kimi-k3): the startup claim release must not
    /// race the dispatcher. A claim the dispatcher takes while the release
    /// runs is `dispatching` too, and the release cannot tell it from a claim
    /// the last process left behind - it would hand it back to `ready` or
    /// attribute it to a worker about to be retired. So the dispatcher starts
    /// only once `reattach_workers_and_resolve_claims` has returned. Startup
    /// needs a Tauri app, so the order is asserted on the source, like the
    /// single-instance guard below.
    #[test]
    fn the_dispatcher_starts_only_after_the_startup_claims_are_resolved() {
        const SOURCE: &str = include_str!("main.rs");
        let code = &SOURCE[..SOURCE.find("mod tests").expect("this module exists")];
        let setup = code
            .find(".setup(|app| {")
            .expect("main() no longer builds the app with a setup closure");
        let resolved = setup
            + code[setup..]
                .find("reattach_workers_and_resolve_claims(")
                .expect("setup no longer resolves the startup claims");
        // `queue::start(` has exactly one call site in main.rs; the needle
        // takes the first one, so a second call (or the spelling in prose)
        // added above the setup would trip this for the wrong reason.
        let dispatcher = code
            .find("queue::start(")
            .expect("`queue::start(` moved or was renamed - fix the needle");
        assert!(
            resolved < dispatcher,
            "the queue dispatcher starts before the startup claim release; a claim \
             it takes meanwhile is indistinguishable from a leftover one"
        );
    }

    /// The whole value of the single-instance guard is its position, and
    /// nothing about a builder chain makes position a compile error. Plugins
    /// are initialised in registration order at the end of `Builder::build`;
    /// the setup closure runs later still. A guard that is not the first
    /// plugin lets the redundant process build the `main` window and a second
    /// WebView2 before it stands down, and a guard moved into the setup
    /// closure would additionally sit behind the process, opener and updater
    /// plugins. So the order is asserted on the source, the same way the
    /// manage table below is.
    #[test]
    fn the_single_instance_guard_is_the_first_plugin_on_the_builder() {
        const SOURCE: &str = include_str!("main.rs");
        // Scan only the code above this module - otherwise the needles find
        // this test's own string literals and read garbage.
        let code = &SOURCE[..SOURCE.find("mod tests").expect("this module exists")];

        let registration = code
            .find(".plugin(tauri_plugin_single_instance::init")
            .expect(
                "the single-instance guard is gone from main.rs - without it a second \
             launch is a second dispatcher on the same queue",
            );
        let first_plugin = code
            .find(".plugin(")
            .expect("main() no longer registers any plugin at all");
        assert_eq!(
            first_plugin, registration,
            "another plugin is registered before the single-instance guard; the \
             redundant process would run that plugin's setup before standing down"
        );

        let setup = code
            .find(".setup(|app| {")
            .expect("main() no longer builds the app with a setup closure");
        assert!(
            registration < setup,
            "the single-instance guard was moved into (or behind) the setup \
             closure, where the redundant process has already built its window"
        );

        // Each of these is something the redundant process must not reach.
        for (what, needle) in [
            ("resolved the app data directory", "app_data_dir(&handle)"),
            ("opened the database", "init_store(&handle, &dir)"),
            ("published the api descriptor", "api::start(backend, &dir)"),
            ("started the queue dispatcher", "queue::start("),
        ] {
            let at = code.find(needle).unwrap_or_else(|| {
                panic!(
                    "`{needle}` moved or was renamed: this test can no longer prove \
                     the single-instance guard comes first - fix the needle"
                )
            });
            assert!(
                registration < at,
                "the single-instance guard is registered after main() {what} \
                 (`{needle}`); a second launch would get that far before exiting"
            );
        }
    }

    /// The registration sits behind `#[cfg(desktop)]`, and `desktop` is a cfg
    /// `tauri-build` emits - not one cargo knows about. If it ever stopped
    /// arriving, the block would compile away to nothing and the guard would
    /// be silently gone while the source test above still passed.
    // Asserting a constant is exactly the point here, and clippy is right that
    // it could be a `const _: () = assert!(..)`. It deliberately is not: a
    // missing `desktop` cfg is a build-configuration regression to diagnose by
    // name, not a reason to make the crate refuse to compile at all - which is
    // what a const assertion would do on any target where `desktop` is
    // legitimately absent.
    #[allow(clippy::assertions_on_constants)]
    #[test]
    fn the_desktop_cfg_that_gates_the_guard_is_actually_set() {
        assert!(
            cfg!(desktop),
            "`desktop` is not set on this build, so the single-instance guard was \
             compiled out - check that tauri-build still emits the cfg"
        );
    }

    /// The guard must stand a redundant process down, never a legitimate one.
    /// The updater relaunches the app while the old process can still exist,
    /// and the property that keeps that alive is the plugin's: it releases its
    /// mutex and destroys its window on `RunEvent::Exit`, and a second
    /// instance is only turned away when it finds *both*. A lock file, a bare
    /// named mutex or a pid check next to it would fail closed instead - the
    /// successor would find a stale lock and refuse to start. So the guard has
    /// to stay the plugin alone, and nothing may re-destroy its handles from
    /// our own exit path either (the plugin's exit hook already runs, before
    /// the run handler; a second `destroy` would close a closed handle).
    #[test]
    fn nothing_guards_startup_beside_the_plugin() {
        const SOURCE: &str = include_str!("main.rs");
        let code = &SOURCE[..SOURCE.find("mod tests").expect("this module exists")];

        for (needle, why) in [
            (
                "CreateMutex",
                "a hand-rolled mutex has no window to fail open against",
            ),
            (
                "single_instance::destroy",
                "the plugin destroys its own handles on exit; doing it again \
                 closes a closed handle",
            ),
            (
                ".lock\"",
                "a lock file outlives a killed process and would refuse the \
                 updater's relaunch",
            ),
        ] {
            assert!(
                !code.contains(needle),
                "main.rs grew a second startup guard (`{needle}`): {why}"
            );
        }

        assert!(
            code.contains("forget_descriptor_if_ours"),
            "Exit must delete the API descriptor by port+token, not by path"
        );
        assert!(
            !code.contains("remove_file(server.descriptor_path())"),
            "unconditional descriptor delete is F1-SI-1: a successor's file would vanish"
        );
    }

    /// Tauri checks state registration when a command is invoked, never at
    /// compile time - so a `State<T>` parameter whose `T` was never given to
    /// `.manage()` passes every gate and fails only in the running window.
    /// That is exactly how 25a2053 silently broke the provider dialog and the
    /// free-tier panel for weeks. This test scans the source instead: every
    /// state type a command asks for must have its manage line, and a state
    /// type this table does not know fails loudly so the table (and the
    /// manage call) grow together with the code.
    #[test]
    fn every_command_state_type_is_managed() {
        assert_command_state_types_are_managed(
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        );
    }

    #[test]
    #[should_panic(expected = "command state type `Foo` is not in the evidence table")]
    fn command_state_guard_rejects_unmanaged_state_in_command_modules() {
        let dir = crate::testutil::TempDir::new("command-state-guard");
        std::fs::write(
            dir.path().join("main.rs"),
            "fn command(store: State<'_, Store>) {}\napp.manage(store);\nmod tests {}",
        )
        .unwrap();
        std::fs::write(
            dir.path().join("future_cmds.rs"),
            "fn moved_command(state: State<'_, Foo>) {}",
        )
        .unwrap();
        assert_command_state_types_are_managed(dir.path());
    }

    fn assert_command_state_types_are_managed(source_dir: &std::path::Path) {
        let source = std::fs::read_to_string(source_dir.join("main.rs")).expect("read main.rs");

        // Which manage line proves which type. Textual on purpose: the
        // variables are constructed a few lines above their manage call, and
        // renaming either side should force a person through this table.
        let evidence: &[(&str, &str)] = &[
            ("Arc<KeyVault>", "app.manage(vault)"),
            ("Arc<QuotaTracker>", "app.manage(quota)"),
            ("Arc<StatusEngine>", "app.manage(engine)"),
            ("Arc<Mutex<api::UpdaterState>>", "app.manage(updater_state)"),
            ("HookReceiver", "app.manage(receiver)"),
            (
                "Mutex<WebInterfaceState>",
                ".manage(Mutex::new(WebInterfaceState::default()))",
            ),
            ("PtyManager", ".manage(PtyManager::default())"),
            (
                "update_cancel::UpdateCancel",
                ".manage(update_cancel::UpdateCancel::default())",
            ),
            (
                "tokio::sync::Mutex<()>",
                ".manage(tokio::sync::Mutex::new(()))",
            ),
            ("Store", "app.manage(store)"),
            ("PanicNotice", "app.manage(panic_notice)"),
            (
                "workers::activation::Activation",
                ".manage(workers::activation::Activation::default())",
            ),
            (
                "HeldSchedulerPermit",
                ".manage(HeldSchedulerPermit::default())",
            ),
        ];

        // Exclude test modules so fixture strings cannot become state types.
        // Discover command modules instead of maintaining a second file list
        // that silently loses coverage whenever commands move out of main.rs.
        let code = &source[..source.find("mod tests").expect("this module exists")];
        let mut command_code = code.to_owned();
        for entry in std::fs::read_dir(source_dir).expect("read source directory") {
            let path = entry.expect("read source entry").path();
            if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with("_cmds.rs"))
            {
                let module = std::fs::read_to_string(&path)
                    .unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
                command_code.push('\n');
                command_code.push_str(module.split("mod tests").next().unwrap());
            }
        }
        let marker: String = ["State<'", "_, "].concat();
        let marker = marker.as_str();

        let mut wanted = std::collections::BTreeSet::new();
        let mut rest = command_code.as_str();
        while let Some(at) = rest.find(marker) {
            rest = &rest[at + marker.len()..];
            let mut depth = 1usize;
            let mut end = 0usize;
            for (i, ch) in rest.char_indices() {
                match ch {
                    '<' => depth += 1,
                    '>' => {
                        depth -= 1;
                        if depth == 0 {
                            end = i;
                            break;
                        }
                    }
                    _ => {}
                }
            }
            wanted.insert(rest[..end].to_string());
        }
        assert!(
            !wanted.is_empty(),
            "the scan found no State parameters at all - the marker rotted"
        );

        for ty in &wanted {
            let (_, proof) = evidence
                .iter()
                .find(|(known, _)| known == ty)
                .unwrap_or_else(|| {
                    panic!(
                        "command state type `{ty}` is not in the evidence table: \
                         add its `.manage()` call in setup AND its row here"
                    )
                });
            // Line-based on purpose: a commented-out manage call still
            // *contains* the evidence string, and a dead line must not count.
            let live = code
                .lines()
                .any(|line| line.trim_start().starts_with(proof));
            assert!(
                live,
                "state type `{ty}` has no live `{proof}` line in main.rs - \
                 commands taking it will fail at runtime with 'state not managed'"
            );
        }
    }

    /// W5-04d: the trait defaults of `ControlBackend` refuse, so a real
    /// backend that does not override them answers `POST/GET
    /// /api/emergency-stop` with 500 and leaves `pa` without a stop.
    #[test]
    fn api_backend_implements_the_emergency_stop() {
        const SOURCE: &str = include_str!("main.rs");
        let body = SOURCE
            .split("impl ControlBackend for ApiBackend")
            .nth(1)
            .expect("backend impl")
            .split("\n}\n")
            .next()
            .expect("impl boundary");
        for method in [
            "fn emergency_stop_active(",
            "fn set_emergency_stop(",
            "apply_emergency_stop(",
        ] {
            assert!(
                body.contains(method),
                "ApiBackend must implement `{method}` (trait default refuses)"
            );
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn shared_emergency_stop_path_sets_and_clears() {
        let (_dir, store) = seam_fixture("estop-shared").await;
        let manager = super::PtyManager::default();
        let gate = tokio::sync::Mutex::new(());
        super::apply_emergency_stop(&store, &manager, &gate, true, "pa")
            .await
            .expect("raise");
        assert!(store.emergency_stop_active().await.expect("state"));
        super::apply_emergency_stop(&store, &manager, &gate, false, "pa")
            .await
            .expect("clear");
        assert!(!store.emergency_stop_active().await.expect("state"));
    }

    #[test]
    fn emergency_stop_changes_are_serialized() {
        const SOURCE: &str = include_str!("main.rs");
        let command = SOURCE
            .split("async fn apply_emergency_stop")
            .nth(1)
            .expect("set command")
            .split("// -- task queue")
            .next()
            .expect("command boundary");
        assert!(
            command.contains("gate.lock().await"),
            "raising and clearing the stop must not overlap"
        );
    }
