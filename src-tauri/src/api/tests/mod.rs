    #[test]
    fn frontend_error_log_redacts_the_route() {
        for token in ["0".repeat(32), format!("sk-{}", "x".repeat(24))] {
            let mut lines = Vec::new();
            super::FrontendErrorLog::default().write(
                std::time::Instant::now(),
                "failed",
                "at render",
                &format!("/token/{token}?private=value#fragment"),
                None,
                |line| lines.push(line),
            );
            assert_eq!(
                lines,
                [r#"ERROR message="failed" stack="at render" route="/token/[redacted]""#]
            );
        }
    }

    #[test]
    fn frontend_feedback_log_line_carries_context() {
        let mut lines = Vec::new();
        super::FrontendErrorLog::default().write(
            std::time::Instant::now(),
            "Button tat nichts",
            "Menü erwartet",
            "/leitstand?private=value",
            Some("sha=\"abc123\" recent=\"boom @ at render\""),
            |line| lines.push(line),
        );
        let expected = "FEEDBACK message=\"Button tat nichts\" expected=\"Menü erwartet\" route=\"/leitstand\" context=\"sha=\\\"abc123\\\" recent=\\\"boom @ at render\\\"\"";
        assert_eq!(lines, [expected]);
    }

    #[test]
    fn frontend_error_log_caps_raw_fields_before_redaction() {
        let raw = format!("sk-{}界tail", "x".repeat(8188));
        let mut lines = Vec::new();
        super::FrontendErrorLog::default().write(
            std::time::Instant::now(),
            &raw,
            &raw,
            &raw,
            None,
            |line| lines.push(line),
        );
        assert_eq!(
            lines,
            [r#"ERROR message="[redacted]" stack="[redacted]" route="[redacted]""#]
        );
    }

    #[test]
    fn frontend_error_log_masks_secrets() {
        // Synthetic shapes only: never use live credentials in fixtures.
        for token in ["0".repeat(32), format!("sk-{}", "x".repeat(24))] {
            let mut limiter = super::FrontendErrorLog::default();
            let mut lines = Vec::new();
            limiter.write(
                std::time::Instant::now(),
                &format!("failed token={token}"),
                &format!("at render (key={token})"),
                "/",
                None,
                |line| lines.push(line),
            );
            assert_eq!(
                lines,
                [
                    r#"ERROR message="failed token=[redacted]" stack="at render (key=[redacted])" route="/""#
                ]
            );
        }
    }

    #[test]
    fn frontend_error_log_releases_and_recovers_mutex() {
        let limiter = std::sync::Mutex::new(super::FrontendErrorLog::default());
        for poisoned in [false, true] {
            if poisoned {
                assert!(std::panic::catch_unwind(|| {
                    let _guard = limiter.lock().unwrap();
                    panic!("synthetic poison");
                })
                .is_err());
            }
            let mut lines = Vec::new();
            super::emit_frontend_error(
                &limiter,
                &format!("error {poisoned}"),
                "",
                "/",
                None,
                |line| {
                    assert!(!matches!(
                        limiter.try_lock(),
                        Err(std::sync::TryLockError::WouldBlock)
                    ));
                    lines.push(line);
                },
            );
            assert_eq!(lines.len(), 1);
        }
    }

    #[test]
    fn frontend_error_log_is_rate_limited() {
        use std::time::{Duration, Instant};
        let mut limiter = super::FrontendErrorLog::default();
        let mut lines = Vec::new();
        let start = Instant::now();
        let mut send = |ms, message: &str, frame: &str| {
            limiter.write(
                start + Duration::from_millis(ms),
                message,
                frame,
                "/?private=value#fragment",
                None,
                |line| lines.push(line),
            );
            lines.len()
        };
        assert_eq!(send(0, "repeat", "first"), 1);
        assert_eq!(send(9999, "repeat", "different"), 1);
        assert_eq!(send(10000, "repeat", "first"), 2);
        for i in 0..48 {
            assert_eq!(send(10000, &format!("error {i}"), ""), i + 3);
        }
        assert_eq!(send(59999, "overflow", ""), 50);
        // Only one slot expires: the summary consumes it, preserving the rolling cap.
        assert_eq!(send(60000, "later", ""), 51);
        assert_eq!(send(60001, "later", ""), 51);
        assert_eq!(send(70000, "later", ""), 52);
        assert_eq!(send(120000, "next", ""), 54);
        assert_eq!(
            lines[0],
            r#"ERROR message="repeat" stack="first" route="/""#
        );
        assert_eq!(lines[50], "ERROR suppressed 2 frontend errors");
        assert_eq!(lines[52], "ERROR suppressed 2 frontend errors");
    }
    #[test]
    fn frontend_feedback_budget_is_bounded_and_independent() {
        let mut limiter = super::FrontendErrorLog::default();
        let (mut lines, now) = (Vec::new(), std::time::Instant::now());
        for _ in 0..1000 {
            limiter.write(now, "feedback", "", "/", Some("ctx"), |l| lines.push(l));
        }
        assert_eq!(lines.len(), 10);
        for i in 0..50 {
            limiter.write(now, &i.to_string(), "", "/", None, |l| lines.push(l));
        }
        assert_eq!(lines.len(), 60);
        assert_eq!(limiter.recent.len(), 50);
        let later = now + std::time::Duration::from_secs(60);
        limiter.write(later, "feedback", "", "/", Some("ctx"), |l| lines.push(l));
        assert_eq!(lines.len(), 61);
    }

    #[test]
    fn frontend_feedback_is_not_rate_limited() {
        use std::time::{Duration, Instant};
        let mut limiter = super::FrontendErrorLog::default();
        let (mut lines, start) = (Vec::new(), Instant::now());
        let mut send = |ms, message: &str, feedback: Option<&str>| {
            limiter.write(
                start + Duration::from_millis(ms),
                message,
                "",
                "/",
                feedback,
                |line| lines.push(line),
            );
            lines.len()
        };
        // Same message as a recent error: the error is deduped, feedback is not.
        assert_eq!(send(0, "repeat", None), 1);
        assert_eq!(send(1, "repeat", None), 1);
        assert_eq!(send(2, "repeat", Some("ctx")), 2);
        // Filling the error window leaves the independent feedback budget available.
        for i in 0..49 {
            send(3, &format!("error {i}"), None);
        }
        assert_eq!(send(4, "overflow", None), 51);
        assert_eq!(send(5, "user feedback", Some("ctx")), 52);
        assert!(lines[1].starts_with("FEEDBACK message=\"repeat\""));
        assert!(lines[51].starts_with("FEEDBACK message=\"user feedback\""));
    }

    #[test]
    fn frontend_error_fields_escape_delimiters() {
        assert_eq!(
            super::frontend_error_field("a\\\" route=forged", 256),
            "a\\\\\\\" route=forged"
        );
        assert_eq!(super::frontend_error_field("\"", 1), "");
    }

    #[test]
    fn frontend_error_log_is_bounded() {
        for limit in [2048, 512, 256] {
            let bounded = super::frontend_error_field(&"界".repeat(3000), limit);
            assert!(bounded.len() <= limit);
            assert!(bounded.len() >= limit - 2);
        }
        assert_eq!(
            super::frontend_error_field("a\r\nb\t\u{2028}c", 256),
            "a  b  c"
        );
    }

    use super::*;

    /// `redact::looks_secret`/`mask_token_runs` mask exactly-32-character,
    /// lowercase-hex segments — the shape `new_token` produces. Since
    /// `new_token` is private to this module, `redact.rs`'s own tests can
    /// only check against a lookalike (`oneshot::random_hex`), not against
    /// this function. This test closes that gap: if `new_token` ever drifts
    /// to a different length or an uppercase/mixed alphabet,
    /// `redact::looks_secret` stops recognizing a real token, and this is
    /// the test that goes red.
    #[test]
    fn new_token_has_the_shape_redact_expects_to_mask() {
        let token = new_token().unwrap();
        assert_eq!(token.len(), 32, "{token}");
        assert!(
            token
                .chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)),
            "{token}"
        );
        assert!(crate::redact::looks_secret(&token), "{token}");
    }

    #[test]
    fn plan_read_before_import_is_explicitly_missing() {
        let fx = fixture("api-plan-missing");
        let token = fx.token();
        let (status, body) = call(
            fx.server.port(),
            "GET",
            "/api/hq/v1/plan?projectId=pj-1&planId=main",
            Some(&token),
            "",
        );
        assert_eq!(status, 404, "{body}");
        assert_eq!(body["error"], "unknown project or plan");
        assert_eq!(fx.backend.plan_reads.lock().unwrap().len(), 1);
    }

    #[test]
    fn plan_get_returns_projection_and_forwards_exact_revision() {
        let fx = fixture("api-plan-read");
        let token = fx.token();
        let (status, body) = call(
            fx.server.port(),
            "GET",
            "/api/hq/v1/plan?projectId=pj-1&planId=ready&revision=3",
            Some(&token),
            "",
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["contractVersion"], 1);
        assert_eq!(body["availability"], "available");
        assert_eq!(body["projectId"], "pj-1");
        assert_eq!(body["sourceRevision"], "digest-3");
        assert_eq!(body["projection"]["projectionRevision"], 3);
        assert_eq!(body["projection"]["sourcePath"], "docs/PLAN.md");
        assert_eq!(body["projection"]["packages"], json!([]));
        assert_eq!(
            fx.backend.plan_reads.lock().unwrap().as_slice(),
            &[("pj-1".into(), "ready".into(), Some(3))]
        );
        assert!(fx.backend.plan_imports.lock().unwrap().is_empty());
    }

    #[test]
    fn plan_routes_validate_inputs_and_preserve_import_envelope() {
        let fx = fixture("api-plan-contract");
        let token = fx.token();
        let auth = Some(token.as_str());
        let port = fx.server.port();
        for path in [
            "/api/hq/v1/plan?projectId=pj-1",
            "/api/hq/v1/plan?projectId=pj-1&planId=main&revision=0",
            "/api/hq/v1/plan?projectId=pj-1&planId=main&revision=x",
            "/api/hq/v1/plan?projectId=pj-1&planId=main&source=foo",
        ] {
            assert_eq!(call(port, "GET", path, auth, "").0, 400, "{path}");
        }
        assert!(fx.backend.plan_reads.lock().unwrap().is_empty());
        let (status, _) = call(
            port,
            "GET",
            "/api/hq/v1/plan?projectId=pj-1&planId=main&revision=99",
            auth,
            "",
        );
        assert_eq!(status, 404);
        for body in [
            r#"{"projectId":"pj-1","planId":"main","expectedProjectionRevision":0,"source":"x"}"#,
            r#"{"projectId":"pj-1","planId":"main","expectedProjectionRevision":"0"}"#,
            r#"{"projectId":"pj-1","planId":"main","expectedProjectionRevision":-1}"#,
            r#"{"projectId":"pj-1","planId":"main","expectedProjectionRevision":0,"rollbackReason":null}"#,
        ] {
            assert_eq!(
                call(port, "POST", "/api/hq/v1/plan/import", auth, body).0,
                400,
                "{body}"
            );
        }
        assert_eq!(
            call(
                port,
                "POST",
                "/api/hq/v1/plan/import?source=other.md",
                auth,
                r#"{"projectId":"pj-1","planId":"main","expectedProjectionRevision":0}"#
            )
            .0,
            400
        );
        assert!(fx.backend.plan_imports.lock().unwrap().is_empty());
        let (status, reply) = call(
            port,
            "POST",
            "/api/hq/v1/plan/import",
            auth,
            r#"{"projectId":"pj-1","planId":"main","expectedProjectionRevision":0}"#,
        );
        assert_eq!(status, 200, "{reply}");
        assert_eq!(reply["contractVersion"], 1);
        assert_eq!(reply["projection"]["planId"], "main");
        assert_eq!(fx.backend.plan_imports.lock().unwrap().len(), 1);
    }
    #[test]
    fn continuous_policy_refusals_are_conflicts_not_server_failures() {
        for message in [
            "continuous runtime adapters are unattested; resume is fail-closed",
            "continuous project is paused; claims refused",
            "continuous project is draining; claims refused",
            "continuous goal deadline has elapsed; task admission is closed",
            "a draft root has not been admitted; its descendants cannot be admitted",
            "an autonomous continuous root is already unresolved; use sourceGoalId for its replan",
            "team assignment revision conflict",
            "team assignment is locked after the first claim or goal closure",
            "continuous task is assigned to another owner",
        ] {
            assert_eq!(continuous_error(message.into()).status, 409, "{message}");
        }
        assert_eq!(continuous_error("database unavailable".into()).status, 500);
    }
    use crate::store::{KIND_WORKER, STATUS_RUNNING};
    use crate::testutil::TempDir;
    use std::io::Read;
    use std::sync::Mutex;

    // W2-04f, in `api/tests/`: a child of this module so it can use the fake
    // backend and `call`.
    mod planning_access_tests;
    // W1-03f-api: the delivery route, on a real store.
    mod delivery_route_tests;
    // M4-E2E-14: checkpoint -> abort -> resume over HTTP, store and a child.
    mod continuous_e2e_tests;
    // M4-R4-PROOF: project scope of goals, tasks, runs and records, real store.
    mod project_scope_tests;
    // M4-ROW3-A: resume stays closed on a real store.
    mod resume_closed_tests;

    /// The five ways a merge can fail, copied verbatim from
    /// `workers::merge_worker` (and from `gh` for the last one). They are here
    /// so both the fake backend and the [`error_status`] unit test speak the
    /// exact words the real backend speaks: if one of them is reworded over
    /// there without this file following, the route quietly falls back to 500,
    /// and these constants are where a reader looks to find out why.
    const MERGE_UNKNOWN: &str = "unknown worker: wk-nope";
    const MERGE_WRONG_COLUMN: &str = "worker wk-busy sits in 'working', not 'ready_to_merge': \
         only a card that is ready to merge can be merged";
    const MERGE_TEST_GATE: &str = "the test gate for wk-red is 'fail', not 'pass': \
         merging is blocked until the tests pass";
    const MERGE_STILL_RUNNING: &str = "worker wk-live still has a running agent; archive it \
         first so nothing writes to the branch while it is merged";
    const MERGE_GIT_FAILED: &str = "git merge failed: refusing to merge unrelated histories";

    /// What the fake recorded for one worker spawn:
    /// `(projectId, task, profileId, spawnedBy)`. Named so the tuple stays
    /// readable where it is matched on.
    type SpawnRecord = (String, String, String, Option<String>);
    type PlanImportRecord = (String, String, i64, Option<String>);

    /// A backend that answers from canned data and records what it was asked.
    #[derive(Default)]
    struct FakeBackend {
        plan_reads: Mutex<Vec<(String, String, Option<i64>)>>,
        plan_imports: Mutex<Vec<PlanImportRecord>>,
        native_claim: Option<(String, String, i64)>,
        native_store: Option<crate::store::Store>,
        /// M4-R19-08: `(run, result, sourceRef)` of every planning audit when
        /// no `native_store` writes the real trail.
        audited: Mutex<Vec<(String, String, String)>>,
        /// M4-R19-08: when set, `audit_planning` fails with this message.
        audit_error: Option<String>,
        /// W1-05b: when set, `cancel_queued_task` is the real store rule
        /// instead of the canned answers, so a test can watch the route and
        /// the rule agree end to end.
        queue_store: Option<crate::store::Store>,
        checkpoints: Mutex<HashMap<String, Value>>,
        reject_agent_run: std::sync::atomic::AtomicBool,
        stop_state: Mutex<(bool, String)>,
        stop_broken: std::sync::atomic::AtomicBool,
        env_stage: Mutex<crate::profiles::EnvIsolation>,
        created: Mutex<Vec<SpawnRecord>>,
        sent: Mutex<Vec<(String, String)>>,
        /// `(workerId, removeWorktree)` of every merge the API asked for.
        merged: Mutex<Vec<(String, bool)>>,
        /// `(projectId, text)` of every message aimed at an orchestrator.
        told: Mutex<Vec<(String, String)>>,
        /// `(projectId, urls)` - an empty url list is a plain scout.
        scouted: Mutex<Vec<(String, Vec<String>)>>,
        /// `(name, repoPath)` of every project the API registered.
        created_projects: Mutex<Vec<(String, String)>>,
        statuses: Mutex<Vec<(String, String)>>,
        recommendation_status_calls: std::sync::atomic::AtomicUsize,
        repos: Mutex<Vec<(String, String, bool)>>,
        links: Mutex<Vec<(String, String)>>,
        landings: Mutex<HashMap<String, Option<String>>>,
        /// `(learningId, text)` of every approval, and the ids of every
        /// rejection - the two halves of the human verdict.
        approved: Mutex<Vec<(String, String)>>,
        rejected: Mutex<Vec<String>>,
        /// Every question the API asked, as the route passed it on.
        asked: Mutex<Vec<AskRecord>>,
        /// `(questionId, answer, answeredBy)` of every answer. The third
        /// element is what the route made of the verdict header, which is the
        /// only place that decision is visible.
        answered: Mutex<Vec<(String, String, String)>>,
        /// The ids of every role variant the API approved and rejected.
        roles_approved: Mutex<Vec<String>>,
        roles_rejected: Mutex<Vec<String>>,
        /// Every budget write, as the route passed it on.
        budgets: Mutex<Vec<BudgetWrite>>,
        /// The row limit each `/api/usage` call arrived with, after the route
        /// applied its default and its cap.
        usage_limits: Mutex<Vec<u32>>,
        /// The window each `/api/projects/<id>/stats` call arrived with.
        stats_ranges: Mutex<Vec<crate::stats::StatsRange>>,
        /// W2-04f: what `agent_dispatch_role` answers for the fake's one run;
        /// `None` resolves nothing. Ignored when `native_store` is set.
        dispatch_role: Option<Result<crate::store::development_launches::DispatchRole, String>>,
        /// Every goal, task and assignment write that reached the backend, as
        /// `goal:<projectId>`, `task:<goalId>` and `assign:<taskId>`.
        planned: Mutex<Vec<String>>,
    }

    /// `(projectId, workerId, question, options)` of one `POST /api/questions`.
    type AskRecord = (String, Option<String>, String, Option<String>);

    /// `(profileId, fiveHourPct, sevenDayPct)` of one budget write, with both
    /// windows still three-valued: absent, cleared, or set.
    type BudgetWrite = (String, Option<Option<u8>>, Option<Option<u8>>);

    #[test]
    fn watchdog_reports_a_stalled_run_and_nothing_for_a_healthy_one() {
        use crate::status::StatusEngine;
        use std::time::Instant;
        let engine = StatusEngine::default();
        let (stalled, healthy) = (worker("wk-stalled"), worker("wk-healthy"));
        let (mut exited, blind) = (worker("wk-exited"), worker("wk-blind"));
        exited.status = crate::store::STATUS_EXITED.to_string();
        // No `checked_sub`: an `Instant` in the past panics on a machine that
        // booted a minute ago. The quiet moment is `base`, the read happens 15
        // minutes after it.
        let base = Instant::now();
        let at = base + Duration::from_secs(15 * 60);
        for w in [&stalled, &healthy, &exited, &blind] {
            engine.observe_worker(w);
        }
        for w in [&stalled, &healthy] {
            engine.note_git_activity_at(&w.id, "fp", base);
        }
        // Never probed: quiet output alone is not judged.
        engine.note_output_at(&blind.id, "z", base);
        engine.note_output_at(&stalled.id, "x", base);
        engine.note_output_at(&healthy.id, "y", at);
        let workers = [stalled, healthy.clone(), exited, blind];
        let now_ms = 1_000_000_000_u64;
        let stalled_after = Duration::from_secs(600);
        let found = watchdog_findings(&workers, &engine, now_ms, at, stalled_after);
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].run_id, "wk-stalled");
        assert_eq!(found[0].kind, "steht");
        assert!(
            found[0].sentence.starts_with("Steht seit 15 Minuten"),
            "{}",
            found[0].sentence
        );
        assert_eq!(found[0].since, now_ms - 15 * 60_000);
        assert!(watchdog_findings(&[healthy], &engine, now_ms, at, stalled_after).is_empty());
    }

    /// `watchdog_report` returns a bare `Vec<WatchdogFinding>`, so the wire
    /// value is a JSON array of these objects. `src/lib/ipc.ts` accepts exactly
    /// these five camelCase keys: a snake_case or renamed field would make the
    /// panel reject the whole read.
    #[test]
    fn watchdog_finding_serializes_to_the_camel_case_shape_ipc_accepts() {
        let finding = WatchdogFinding {
            run_id: "wk-1".to_string(),
            label: "Worker 1".to_string(),
            kind: "steht",
            sentence: "Steht seit 15 Minuten: keine Ausgabe, keine Änderung im Arbeitsbaum."
                .to_string(),
            since: 1_700_000_000_000,
        };
        let want = serde_json::json!({
            "runId": "wk-1",
            "label": "Worker 1",
            "kind": "steht",
            "sentence": "Steht seit 15 Minuten: keine Ausgabe, keine Änderung im Arbeitsbaum.",
            "since": 1_700_000_000_000_u64,
        });
        assert_eq!(serde_json::to_value(&finding).unwrap(), want);
        // The command's return value: an array, empty when nothing stands.
        assert_eq!(
            serde_json::to_value(vec![finding.clone(), finding]).unwrap(),
            serde_json::json!([want, want])
        );
        assert_eq!(
            serde_json::to_value(Vec::<WatchdogFinding>::new()).unwrap(),
            serde_json::json!([])
        );
    }

    #[test]
    fn watchdog_span_names_minutes_and_hours_in_singular_and_plural() {
        for (ms, want) in [
            (59_999, "0 Minuten"),
            (60_000, "1 Minute"),
            (59 * 60_000, "59 Minuten"),
            (60 * 60_000, "1 Stunde"),
            (61 * 60_000, "1 Stunde 1 Minute"),
            (125 * 60_000, "2 Stunden 5 Minuten"),
            (120 * 60_000, "2 Stunden"),
        ] {
            assert_eq!(watchdog_span(ms), want, "{ms} ms");
        }
    }

    fn worker(id: &str) -> Worker {
        Worker {
            id: id.to_string(),
            project_id: "pj-1".to_string(),
            task: "do the thing".to_string(),
            profile_id: "claude".to_string(),
            branch: format!("pa/{id}"),
            worktree_path: format!("C:/tmp/.projecta-worktrees/{id}"),
            session_id: Some("pty-1".to_string()),
            status: STATUS_RUNNING.to_string(),
            kind: KIND_WORKER.to_string(),
            pr_url: None,
            spawned_by: None,
            test_status: None,
            tested_at: None,
            paused_reason: None,
            created_at: 42,
        }
    }

    fn scout(id: &str) -> Worker {
        Worker {
            branch: String::new(),
            worktree_path: "C:/repos/a".to_string(),
            kind: crate::store::KIND_SCOUT.to_string(),
            ..worker(id)
        }
    }

    fn queen(id: &str) -> Worker {
        Worker {
            branch: String::new(),
            worktree_path: "C:/repos/a".to_string(),
            kind: KIND_QUEEN.to_string(),
            task: "Queen: Backend-API".to_string(),
            ..worker(id)
        }
    }

    fn recommendation(id: &str) -> Recommendation {
        Recommendation {
            id: id.to_string(),
            project_id: "pj-1".to_string(),
            title: "ratatui".to_string(),
            url: Some("https://github.com/ratatui/ratatui".to_string()),
            rationale: "Board im Terminal".to_string(),
            effort: Some("M".to_string()),
            status: crate::store::REC_NEW.to_string(),
            created_at: 42,
        }
    }

    fn learning(id: &str, status: &str) -> Learning {
        Learning {
            id: id.to_string(),
            project_id: "pj-1".to_string(),
            worker_id: "wk-1".to_string(),
            profile_id: "claude".to_string(),
            pattern_label: Some("Gates".to_string()),
            content: "Gates seriell laufen lassen".to_string(),
            status: status.to_string(),
            created_at: 42,
        }
    }

    /// An open worker question. The statuses that are not open are built from
    /// this one with a struct update, which is also how the core builds them.
    fn question_row(id: &str) -> Question {
        Question {
            id: id.to_string(),
            project_id: "pj-1".to_string(),
            worker_id: Some("wk-1".to_string()),
            scope: crate::store::QUESTION_WORKER.to_string(),
            question: "Postgres oder SQLite?".to_string(),
            answered_by: None,
            options_json: Some(r#"["Postgres","SQLite"]"#.to_string()),
            status: crate::store::QUESTION_OPEN.to_string(),
            answer: None,
            created_at: 42,
            answered_at: None,
            expires_at: Some(42 + 4 * 60 * 60),
        }
    }

    fn role_variant(id: &str, status: &str) -> RoleVariant {
        RoleVariant {
            id: id.to_string(),
            project_id: "pj-1".to_string(),
            name: "Test-Fixer".to_string(),
            base_profile_id: "claude".to_string(),
            pattern_label: "tests-fixen".to_string(),
            system_prompt_addition: "Lauf die Gates seriell.".to_string(),
            version: 1,
            status: status.to_string(),
            created_at: 42,
        }
    }

    fn board_state(id: &str) -> WorkerBoardState {
        WorkerBoardState {
            worker: worker(id),
            column: crate::status::COL_WORKING.to_string(),
            attention_reason: None,
            attention_code: None,
            attention_grade: None,
            attention_observed_at: None,
            pr_url: None,
            context_usage: None,
            // Phase 11 badge: this fixture has no coordinator to resolve.
            controlled_by: None,
            // Phase 12: this fixture's worker has never been through the gate.
            test_status: None,
            tested_at: None,
            observed_model: None,
        }
    }

    /// The three answers every creating route has to tell apart, chosen by the
    /// project id a test names. The wording is copied from the core: `pj-nope`
    /// is [`crate::workers::ERR_UNKNOWN`], `pj-aus` is
    /// [`crate::workers::ERR_REFUSED`] (a profile the user switched off), and
    /// `pj-git` is a worktree that would not check out - the app's own failure,
    /// which has to keep its 500.
    fn core_verdict(project_id: &str) -> Result<(), String> {
        match project_id {
            "pj-nope" => Err(format!(
                "{}project: {project_id}",
                crate::workers::ERR_UNKNOWN
            )),
            "pj-aus" => Err(format!(
                "{}agent profile 'claude' is switched off",
                crate::workers::ERR_REFUSED
            )),
            "pj-git" => Err("failed to add the worktree: git exited with 128".to_string()),
            _ => Ok(()),
        }
    }

    impl ControlBackend for FakeBackend {
        fn assign_continuous_task(
            &self,
            task_id: &str,
            request: crate::store::team_assignments::AssignmentRequest,
        ) -> Result<crate::store::team_assignments::TeamAssignment, String> {
            if request.expected_revision != 0 {
                return Err("team assignment revision conflict".into());
            }
            self.planned
                .lock()
                .unwrap()
                .push(format!("assign:{task_id}"));
            Ok(crate::store::team_assignments::TeamAssignment {
                task_id: task_id.into(),
                team_id: request.team_id,
                role: request.role,
                assignee: request.assignee,
                revision: 1,
                policy_version: 1,
                observed_at: 42,
            })
        }
        fn agent_record_delivery(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
            delivery: crate::workers::delivery_state::WorkerDelivery,
        ) -> Result<DeliveryReceipt, DeliveryError> {
            let store = self
                .native_store
                .as_ref()
                .ok_or_else(|| DeliveryError::Failed("delivery service unavailable".into()))?;
            tauri::async_runtime::block_on(record_delivery_receipt(
                store, run, owner, fence, delivery,
            ))
        }
        fn agent_dispatch_role(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
        ) -> Result<crate::store::development_launches::DispatchRole, String> {
            if let Some(store) = &self.native_store {
                // What `main.rs` does: authority first, then the W2-04 role.
                return tauri::async_runtime::block_on(async {
                    store.agent_run_context(run, owner, fence).await?;
                    store.development_run_role(run).await
                });
            }
            self.agent_run_context(run, owner, fence)?;
            self.dispatch_role
                .clone()
                .unwrap_or_else(|| Err("no dispatch role configured".into()))
        }
        fn audit_planning(&self, run: &str, result: &str, source_ref: &str) -> Result<(), String> {
            if let Some(error) = &self.audit_error {
                return Err(error.clone());
            }
            if let Some(store) = &self.native_store {
                return tauri::async_runtime::block_on(crate::api::planning_access::audit(
                    store, run, result, source_ref,
                ));
            }
            self.audited.lock().unwrap().push((
                run.to_string(),
                result.to_string(),
                source_ref.to_string(),
            ));
            Ok(())
        }
        fn agent_planning_scope(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
            kind: &str,
            target: &str,
        ) -> Result<(), String> {
            if let Some(store) = &self.native_store {
                return tauri::async_runtime::block_on(
                    store.agent_planning_scope(run, owner, fence, kind, target),
                );
            }
            self.agent_run_context(run, owner, fence)?;
            if target.contains("foreign") {
                Err("planning target is outside the run project".into())
            } else {
                Ok(())
            }
        }
        fn create_continuous_goal(
            &self,
            project_id: &str,
            objective: &str,
            _acceptance_criteria: Option<String>,
            source_goal_id: Option<String>,
            admit: bool,
        ) -> Result<ContinuousGoal, String> {
            self.planned
                .lock()
                .unwrap()
                .push(format!("goal:{project_id}"));
            Ok(ContinuousGoal {
                id: "cg-new".into(),
                project_id: project_id.into(),
                source_goal_id,
                root_goal_id: "cg-new".into(),
                objective: objective.into(),
                acceptance_criteria: None,
                status: "open".into(),
                deadline_at: 0,
                admitted: admit,
                created_at: 42,
                updated_at: 42,
            })
        }
        fn create_continuous_task(
            &self,
            goal_id: &str,
            objective: &str,
            profile_id: Option<String>,
            owned_paths: Vec<String>,
            dependencies: Vec<String>,
        ) -> Result<ContinuousTask, String> {
            self.planned.lock().unwrap().push(format!("task:{goal_id}"));
            Ok(ContinuousTask {
                assignment: None,
                id: "ct-new".into(),
                goal_id: goal_id.into(),
                objective: objective.into(),
                profile_id,
                owned_paths,
                dependencies,
                status: "open".into(),
                attempts: 0,
                escalations: 0,
                claim: None,
                created_at: 42,
                updated_at: 42,
            })
        }
        fn wait_continuous_changes(
            &self,
            project: &str,
            cursor: i64,
            wait_ms: u64,
        ) -> Result<Value, String> {
            let mut value = self.continuous_changes(project, cursor)?;
            value["requestedWaitMs"] = json!(wait_ms);
            Ok(value)
        }
        fn continuous_changes(&self, project: &str, cursor: i64) -> Result<Value, String> {
            Ok(
                json!({"apiVersion":1,"projectId":project,"cursor":cursor,"hasMore":false,"events":[]}),
            )
        }
        fn agent_record_page(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
            collection: &str,
            cursor: Option<&str>,
        ) -> Result<Value, String> {
            if let Some(store) = &self.native_store {
                return tauri::async_runtime::block_on(
                    store.agent_record_page(run, owner, fence, collection, cursor),
                );
            }
            self.agent_run_context(run, owner, fence)?;
            Ok(json!({"runId":run,"collection":collection,"cursor":cursor}))
        }
        fn agent_evidence(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
            id: &str,
        ) -> Result<Value, String> {
            match &self.native_store {
                Some(store) => {
                    tauri::async_runtime::block_on(store.agent_evidence(run, owner, fence, id))
                }
                None => Err("agent evidence retrieval unavailable".into()),
            }
        }
        fn agent_run_context(&self, run: &str, owner: &str, fence: i64) -> Result<Value, String> {
            if let Some(store) = &self.native_store {
                return tauri::async_runtime::block_on(store.agent_run_context(run, owner, fence));
            }
            let expected = self
                .native_claim
                .as_ref()
                .map(|(run, owner, fence)| (run.as_str(), owner.as_str(), *fence))
                .unwrap_or(("run-a", "worker-a", 7));
            if self
                .reject_agent_run
                .load(std::sync::atomic::Ordering::SeqCst)
                || (run, owner, fence) != expected
            {
                return Err("unknown or unauthorized development run".into());
            }
            Ok(json!({"apiVersion":1,"runId":run,"owner":owner,"fence":fence}))
        }
        fn agent_bind_candidate(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
            input: CandidateInput,
        ) -> Result<Value, String> {
            self.agent_run_context(run, owner, fence)?;
            Ok(json!({"runId":run,"candidateCommit":input.candidate_commit}))
        }
        fn agent_checkpoint_at(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
            revision: i64,
        ) -> Result<Value, String> {
            if let Some(store) = &self.native_store {
                return tauri::async_runtime::block_on(
                    store.agent_checkpoint_at(run, owner, fence, revision),
                );
            }
            self.agent_run_context(run, owner, fence)?;
            Ok(json!({"runId":run,"revision":revision}))
        }
        fn agent_checkpoint(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
            input: crate::store::development_runs::CheckpointInput,
        ) -> Result<Value, String> {
            if let Some(store) = &self.native_store {
                return tauri::async_runtime::block_on(
                    store.record_agent_checkpoint(run, owner, fence, input),
                );
            }
            self.agent_run_context(run, owner, fence)?;
            let mut saved = self.checkpoints.lock().unwrap();
            let raw = json!(input);
            if saved
                .get(&input.idempotency_key)
                .is_some_and(|existing| existing != &raw)
            {
                return Err("checkpoint idempotency key reused with different content".into());
            }
            saved.insert(input.idempotency_key.clone(), raw);
            Ok(json!({"runId":run,"content":input}))
        }
        fn agent_submit_evidence(
            &self,
            run: &str,
            owner: &str,
            fence: i64,
            input: crate::store::development_runs::EvidenceInput,
        ) -> Result<Value, String> {
            self.agent_run_context(run, owner, fence)?;
            Ok(json!({"runId":run,"idempotencyKey":input.idempotency_key}))
        }
        fn agent_submit_review(
            &self,
            reviewer_run: &str,
            owner: &str,
            fence: i64,
            input: crate::store::development_runs::ReviewInput,
        ) -> Result<Value, String> {
            if let Some(store) = &self.native_store {
                let review = tauri::async_runtime::block_on(store.record_development_review(
                    reviewer_run,
                    owner,
                    fence,
                    input,
                ))?;
                return serde_json::to_value(review).map_err(|e| e.to_string());
            }
            self.agent_run_context(reviewer_run, owner, fence)?;
            Ok(json!({"reviewerRunId":reviewer_run,"idempotencyKey":input.idempotency_key}))
        }
        fn development_records(&self, project_id: &str) -> Result<Value, String> {
            Ok(
                json!({"apiVersion": 1, "projectId": project_id, "runs": [], "executionEnabled": false}),
            )
        }
        fn development_plan(
            &self,
            project_id: &str,
            plan_id: &str,
            revision: Option<i64>,
        ) -> Result<Value, String> {
            self.plan_reads
                .lock()
                .unwrap()
                .push((project_id.into(), plan_id.into(), revision));
            if project_id == "pj-1" && plan_id == "ready" && revision == Some(3) {
                return Ok(json!({
                    "contractVersion":1,"availability":"available","generatedAt":42,
                    "projectId":project_id,"sourceRevision":"digest-3",
                    "projection":{
                        "projectId":project_id,"planId":plan_id,"sourcePath":"docs/PLAN.md",
                        "sourceRevision":"digest-3","projectionRevision":3,
                        "source":"plan text","rollbackReason":null,"importedAt":40,"packages":[]
                    }
                }));
            }
            if revision == Some(99) {
                return Err("unknown project, plan or projection revision".into());
            }
            Err("unknown project or plan".into())
        }
        fn import_development_plan(
            &self,
            project_id: &str,
            plan_id: &str,
            expected_projection_revision: i64,
            rollback_reason: Option<&str>,
        ) -> Result<Value, String> {
            self.plan_imports.lock().unwrap().push((
                project_id.into(),
                plan_id.into(),
                expected_projection_revision,
                rollback_reason.map(str::to_owned),
            ));
            Ok(
                json!({"contractVersion":1,"availability":"available","generatedAt":42,"projectId":project_id,"sourceRevision":"digest","projection":{"projectId":project_id,"planId":plan_id,"projectionRevision":1}}),
            )
        }
        fn control_continuous(
            &self,
            project_id: &str,
            action: &str,
        ) -> Result<crate::store::ContinuousControl, String> {
            // Sync call from the server's plain request thread, like the other
            // store-backed fakes here; `block_on` would panic inside a runtime.
            if let Some(store) = &self.native_store {
                return tauri::async_runtime::block_on(
                    store.control_continuous(project_id, action),
                );
            }
            // Deliberately not the store's wording: a route test that sees the
            // store's text proves the store was in the path.
            Err("fake backend without a store: resume is fail-closed".into())
        }
        /// Every id names a project except `pj-nope`, which names none - the
        /// same convention the digest, stats and landing-page fakes follow -
        /// and `pj-boom`, whose lookup fails.
        fn project_exists(&self, project_id: &str) -> Result<bool, String> {
            match project_id {
                "pj-boom" => Err("failed to read project: database is locked".to_string()),
                _ => Ok(project_id != "pj-nope"),
            }
        }

        fn create_worker(
            &self,
            project_id: &str,
            task: &str,
            profile_id: &str,
            spawned_by: Option<String>,
        ) -> Result<Worker, String> {
            core_verdict(project_id)?;
            self.created.lock().unwrap().push((
                project_id.to_string(),
                task.to_string(),
                profile_id.to_string(),
                spawned_by,
            ));
            Ok(worker("wk-new"))
        }

        fn list_workers(&self, project_id: Option<&str>) -> Result<Vec<Worker>, String> {
            // A small hierarchy: an orchestrator with a queen, the queen with
            // two employees, one worker started by the user, and one whose
            // controller is gone.
            match project_id {
                Some("pj-1") | None => Ok(vec![
                    worker("wk-1"),
                    Worker {
                        branch: String::new(),
                        worktree_path: "C:/repos/a".to_string(),
                        kind: KIND_ORCHESTRATOR.to_string(),
                        ..worker("wk-orch")
                    },
                    Worker {
                        spawned_by: Some("wk-orch".to_string()),
                        ..queen("wk-queen")
                    },
                    Worker {
                        spawned_by: Some("wk-queen".to_string()),
                        ..worker("wk-e1")
                    },
                    Worker {
                        spawned_by: Some("wk-queen".to_string()),
                        ..worker("wk-e2")
                    },
                    Worker {
                        spawned_by: Some("wk-gone".to_string()),
                        ..worker("wk-orphan")
                    },
                ]),
                Some(_) => Ok(Vec::new()),
            }
        }

        fn worker_state(&self, worker_id: &str) -> Result<Option<WorkerBoardState>, String> {
            Ok((worker_id == "wk-1").then(|| board_state("wk-1")))
        }

        fn send_to_worker(&self, worker_id: &str, text: &str) -> Result<(), String> {
            // Word for word what `ApiBackend::send_to_worker` says when the
            // store has no session for the id.
            if worker_id != "wk-1" {
                return Err(format!("worker {worker_id} has no running agent"));
            }
            self.sent
                .lock()
                .unwrap()
                .push((worker_id.to_string(), text.to_string()));
            Ok(())
        }

        fn send_to_orchestrator(&self, project_id: &str, text: &str) -> Result<Worker, String> {
            core_verdict(project_id)?;
            self.told
                .lock()
                .unwrap()
                .push((project_id.to_string(), text.to_string()));
            Ok(Worker {
                branch: String::new(),
                worktree_path: "C:/repos/a".to_string(),
                kind: KIND_ORCHESTRATOR.to_string(),
                ..worker("wk-orch")
            })
        }

        fn list_worker_messages(
            &self,
            worker_id: &str,
            limit: Option<usize>,
        ) -> Result<Vec<Message>, String> {
            let mut messages = Vec::new();
            let cap = limit.unwrap_or(200);
            for i in 0..cap {
                messages.push(Message {
                    id: format!("msg-{i}"),
                    worker_id: worker_id.to_string(),
                    role: crate::store::MSG_USER.to_string(),
                    content: format!("entry {i}"),
                    created_at: i as i64,
                });
            }
            Ok(messages)
        }

        fn board(&self, _project_id: Option<&str>) -> Result<Vec<WorkerBoardState>, String> {
            Ok(vec![board_state("wk-1")])
        }

        fn quota(&self) -> Result<Vec<QuotaStateRow>, String> {
            Ok(Vec::new())
        }

        fn emergency_stop_active(&self) -> Result<bool, String> {
            if self.stop_broken.load(std::sync::atomic::Ordering::SeqCst) {
                return Err("emergency stop state unreadable".into());
            }
            Ok(self.stop_state.lock().unwrap().0)
        }

        fn set_emergency_stop(&self, active: bool, actor: &str) -> Result<(), String> {
            *self.stop_state.lock().unwrap() = (active, actor.to_string());
            Ok(())
        }
        fn agent_env_isolation(&self) -> Result<crate::profiles::EnvIsolation, String> {
            Ok(*self.env_stage.lock().unwrap())
        }

        fn set_agent_env_isolation(
            &self,
            stage: crate::profiles::EnvIsolation,
        ) -> Result<(), String> {
            *self.env_stage.lock().unwrap() = stage;
            Ok(())
        }

        fn updater_state(&self) -> Result<UpdaterState, String> {
            Ok(UpdaterState::default())
        }

        fn providers(&self) -> Result<Vec<ProviderOverview>, String> {
            Ok(vec![ProviderOverview {
                id: "claude".to_string(),
                name: "Claude Code".to_string(),
                kind: crate::providers::KIND_SUBSCRIPTION.to_string(),
                connected: true,
                detail: Some("1.2.3".to_string()),
                quota_state: crate::store::QUOTA_BLOCKED.to_string(),
                blocked_until: Some(1_800_000_000),
                omni_route_online: false,
                usage: Some(crate::providers::ProviderUsage {
                    percent: Some(87),
                    used: Some("562,0 k Tokens".to_string()),
                    limit: Some("1,0 M Tokens".to_string()),
                    window_label: "5-Stunden-Fenster".to_string(),
                    resets_at: Some(1_787_793_000),
                    source: "hook".to_string(),
                    observed_at: 1_787_793_000,
                }),
                vault_error: None,
            }])
        }

        fn usage(&self, limit: u32) -> Result<UsageReport, String> {
            self.usage_limits.lock().unwrap().push(limit);
            Ok(UsageReport {
                online: true,
                authorized: true,
                events: vec![crate::store::UsageEvent {
                    id: "ue-1".to_string(),
                    ts: 1_787_910_158,
                    profile_id: None,
                    model: "gpt-5.6-sol".to_string(),
                    provider: "codex".to_string(),
                    tokens_in: 19,
                    tokens_out: 5,
                    cost_usd: None,
                    raw_json: "line".to_string(),
                }],
                today: crate::store::UsageTotals {
                    requests: 1,
                    tokens_in: 19,
                    tokens_out: 5,
                    cost_usd: 0.0,
                    priced: 0,
                },
                total: crate::store::UsageTotals {
                    requests: 2,
                    tokens_in: 119,
                    tokens_out: 15,
                    cost_usd: 0.0,
                    priced: 0,
                },
                reported_cost_usd: Some(42.5),
                history: Some(json!({ "totalCost": 42.5 })),
            })
        }

        fn list_digests(&self, project_id: &str) -> Result<Vec<String>, String> {
            if project_id == "pj-nope" {
                return Err(format!(
                    "{}project: {project_id}",
                    crate::workers::ERR_UNKNOWN
                ));
            }
            Ok(vec!["2026-08-27".to_string(), "2026-08-26".to_string()])
        }

        fn read_digest(&self, project_id: &str, date: &str) -> Result<Option<String>, String> {
            if project_id == "pj-nope" {
                return Err(format!(
                    "{}project: {project_id}",
                    crate::workers::ERR_UNKNOWN
                ));
            }
            Ok((date == "2026-08-27").then(|| "# 2026-08-27 - one\n".to_string()))
        }

        fn project_stats(
            &self,
            project_id: &str,
            range: crate::stats::StatsRange,
        ) -> Result<crate::stats::ProjectStats, String> {
            if project_id == "pj-nope" {
                return Err(format!(
                    "{}project: {project_id}",
                    crate::workers::ERR_UNKNOWN
                ));
            }
            self.stats_ranges.lock().unwrap().push(range);
            Ok(crate::stats::ProjectStats {
                project_id: project_id.to_string(),
                project_name: "one".to_string(),
                range: range.as_str().to_string(),
                since: range.since(1_787_745_600),
                generated_at: 1_787_745_600,
                overview: crate::stats::Overview {
                    workers_total: 2,
                    workers_active: 1,
                    workers_archived: 1,
                    by_column: Vec::new(),
                    by_kind: Vec::new(),
                    needs_attention: 0,
                    queue: Vec::new(),
                    queue_total: 0,
                    learnings_pending: 0,
                    messages: 4,
                    status_events: 3,
                    diff_comments: 0,
                    workers_created: 2,
                    range_scoped: Vec::new(),
                },
                // The honest gap, in the shape the route has to pass through.
                tokens: None,
                sessions: crate::stats::SessionStats {
                    total: 1,
                    open: 0,
                    ended: 1,
                    total_seconds: 120,
                    median_seconds: Some(120),
                    failed: 0,
                    unknown_exit: 0,
                    failure_ratio: Some(0.0),
                    recent: Vec::new(),
                },
                timeline: Vec::new(),
                completion: crate::stats::CompletionEstimate {
                    percent: Some(42.5),
                    components: Vec::new(),
                    workers: Vec::new(),
                    column_weights: Vec::new(),
                },
            })
        }

        fn list_budgets(&self) -> Result<Vec<BudgetLimits>, String> {
            Ok(vec![BudgetLimits {
                profile_id: "claude".to_string(),
                five_hour_pct: Some(90),
                seven_day_pct: None,
            }])
        }

        fn set_budget(
            &self,
            profile_id: &str,
            five_hour_pct: Option<Option<u8>>,
            seven_day_pct: Option<Option<u8>>,
        ) -> Result<BudgetLimits, String> {
            if profile_id == "nope" {
                return Err("unknown agent profile: nope".to_string());
            }
            self.budgets.lock().unwrap().push((
                profile_id.to_string(),
                five_hour_pct,
                seven_day_pct,
            ));
            Ok(BudgetLimits {
                profile_id: profile_id.to_string(),
                five_hour_pct: five_hour_pct.flatten(),
                seven_day_pct: seven_day_pct.flatten(),
            })
        }

        fn enqueue_task(
            &self,
            project_id: &str,
            raw_text: &str,
            profile_id: Option<String>,
            sharpen: bool,
            priority: Option<i32>,
            spawned_by: Option<String>,
        ) -> Result<QueueEntry, String> {
            core_verdict(project_id)?;
            Ok(QueueEntry {
                id: "tq-new".to_string(),
                project_id: project_id.to_string(),
                raw_text: raw_text.to_string(),
                sharpened_text: None,
                profile_id: profile_id.unwrap_or_else(|| DEFAULT_PROFILE.to_string()),
                status: if sharpen { "sharpening" } else { "ready" }.to_string(),
                priority: priority.unwrap_or(0),
                worker_id: None,
                error: None,
                spawned_by,
                created_at: 42,
            })
        }

        fn list_queue(&self, _project_id: Option<&str>) -> Result<Vec<QueueEntry>, String> {
            Ok(Vec::new())
        }

        fn cancel_queued_task(&self, id: &str) -> Result<(), String> {
            if let Some(store) = &self.queue_store {
                // What `main.rs` does: the store's rule, nothing in between.
                return tauri::async_runtime::block_on(store.cancel_queue_entry(id));
            }
            // The three answers `store::cancel_queue_entry` can give, in its
            // own words: an id that names nothing, an entry a claim has
            // already taken past queued or ready, and a store that fell over.
            match id {
                "tq-nope" => Err(format!(
                    "{}queued task: tq-nope",
                    crate::workers::ERR_UNKNOWN
                )),
                "tq-busy" => Err(format!(
                    "{}task tq-busy is dispatching, not queued or ready",
                    crate::workers::ERR_REFUSED
                )),
                "tq-boom" => Err("failed to cancel queued task: database is locked".into()),
                _ => Ok(()),
            }
        }

        fn create_scout(&self, project_id: &str) -> Result<Worker, String> {
            core_verdict(project_id)?;
            self.scouted
                .lock()
                .unwrap()
                .push((project_id.to_string(), Vec::new()));
            Ok(scout("wk-scout"))
        }

        fn triage_repos(&self, project_id: &str, urls: &[String]) -> Result<Worker, String> {
            core_verdict(project_id)?;
            self.scouted
                .lock()
                .unwrap()
                .push((project_id.to_string(), urls.to_vec()));
            Ok(scout("wk-triage"))
        }

        fn list_recommendations(
            &self,
            project_id: Option<&str>,
        ) -> Result<Vec<Recommendation>, String> {
            match project_id {
                Some("pj-1") | None => Ok(vec![recommendation("rc-1")]),
                Some(_) => Ok(Vec::new()),
            }
        }

        fn add_recommendation(
            &self,
            project_id: &str,
            title: &str,
            rationale: &str,
            url: Option<String>,
            effort: Option<String>,
        ) -> Result<Recommendation, String> {
            core_verdict(project_id)?;
            Ok(Recommendation {
                id: "rc-new".to_string(),
                project_id: project_id.to_string(),
                title: title.to_string(),
                url,
                rationale: rationale.to_string(),
                effort,
                status: crate::store::REC_NEW.to_string(),
                created_at: 42,
            })
        }

        fn set_recommendation_status(&self, id: &str, status: &str) -> Result<(), String> {
            self.recommendation_status_calls
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if status != crate::store::REC_ACCEPTED && status != crate::store::REC_DISMISSED {
                // The core's wording, from the same constants, so a change to
                // the vocabulary takes this fake with it.
                return Err(format!(
                    "unknown recommendation status: {status} (expected {} or {})",
                    crate::store::REC_ACCEPTED,
                    crate::store::REC_DISMISSED
                ));
            }
            // The same three answers the store can give, in its own words -
            // mirrored here like `accept_recommendation` one function down.
            match id {
                "rc-boom" => return Err("failed to update recommendation: disk full".to_string()),
                "rc-1" => {}
                _ => {
                    return Err(format!(
                        "{}recommendation: {id}",
                        crate::workers::ERR_UNKNOWN
                    ))
                }
            }
            self.statuses
                .lock()
                .unwrap()
                .push((id.to_string(), status.to_string()));
            Ok(())
        }

        fn accept_recommendation(&self, id: &str) -> Result<QueueEntry, String> {
            // The three answers `scout::accept_recommendation` can give, in its
            // own words: an id that names nothing, a row that was accepted
            // already, and a queue insert that failed.
            match id {
                "rc-done" => {
                    return Err(format!(
                        "{}recommendation {id} has already been accepted",
                        crate::workers::ERR_REFUSED
                    ))
                }
                "rc-boom" => return Err("failed to insert the queue entry: disk full".to_string()),
                "rc-1" => {}
                _ => {
                    return Err(format!(
                        "{}recommendation: {id}",
                        crate::workers::ERR_UNKNOWN
                    ))
                }
            }
            Ok(QueueEntry {
                id: "tq-from-rc".to_string(),
                project_id: "pj-1".to_string(),
                raw_text: "Integriere die Empfehlung \"ratatui\" in ProjectA.".to_string(),
                sharpened_text: None,
                profile_id: DEFAULT_PROFILE.to_string(),
                status: "ready".to_string(),
                priority: 0,
                worker_id: None,
                error: None,
                spawned_by: None,
                created_at: 42,
            })
        }

        fn list_learnings(
            &self,
            project_id: Option<&str>,
            status: Option<&str>,
        ) -> Result<Vec<Learning>, String> {
            if matches!(project_id, Some(other) if other != "pj-1") {
                return Ok(Vec::new());
            }
            Ok([learning("lr-1", "pending"), learning("lr-2", "approved")]
                .into_iter()
                .filter(|entry| status.is_none() || status == Some(entry.status.as_str()))
                .collect())
        }

        fn ask_question(
            &self,
            project_id: &str,
            worker_id: Option<&str>,
            question: &str,
            options: Option<&str>,
        ) -> Result<Question, String> {
            if project_id == "pj-nope" {
                return Err(format!("{}project: pj-nope", crate::workers::ERR_UNKNOWN));
            }
            if worker_id == Some("wk-other") {
                return Err(format!(
                    "{}worker wk-other belongs to project pj-2, not {project_id}",
                    crate::workers::ERR_REFUSED
                ));
            }
            self.asked.lock().unwrap().push((
                project_id.to_string(),
                worker_id.map(str::to_string),
                question.to_string(),
                options.map(str::to_string),
            ));
            Ok(Question {
                worker_id: worker_id.map(str::to_string),
                ..question_row("qs-new")
            })
        }

        fn answer_question(
            &self,
            id: &str,
            answer: &str,
            answered_by: &str,
        ) -> Result<Question, String> {
            match id {
                "qs-nope" => Err(format!("{}question: qs-nope", crate::workers::ERR_UNKNOWN)),
                // The row the core refuses a second answer on.
                "qs-done" => Err(format!(
                    "{}question qs-done is already answered",
                    crate::workers::ERR_REFUSED
                )),
                _ => {
                    self.answered.lock().unwrap().push((
                        id.to_string(),
                        answer.to_string(),
                        answered_by.to_string(),
                    ));
                    Ok(Question {
                        status: crate::store::QUESTION_ANSWERED.to_string(),
                        answer: Some(answer.to_string()),
                        answered_at: Some(99),
                        answered_by: Some(answered_by.to_string()),
                        ..question_row(id)
                    })
                }
            }
        }

        fn list_questions(
            &self,
            project_id: Option<&str>,
            status: Option<&str>,
        ) -> Result<Vec<Question>, String> {
            if matches!(project_id, Some(other) if other != "pj-1") {
                return Ok(Vec::new());
            }
            Ok([
                question_row("qs-1"),
                Question {
                    status: crate::store::QUESTION_ANSWERED.to_string(),
                    ..question_row("qs-2")
                },
            ]
            .into_iter()
            .filter(|entry| status.is_none() || status == Some(entry.status.as_str()))
            .collect())
        }

        fn approve_learning(&self, id: &str, text: &str) -> Result<(), String> {
            // lr-2 is the approved row of `list_learnings`: the core refuses a
            // second verdict on it, and the route has to carry that through.
            if id == "lr-2" {
                return Err(format!(
                    "{}learning lr-2 was already approved",
                    crate::workers::ERR_REFUSED
                ));
            }
            if id != "lr-1" {
                return Err(format!("unknown learning: {id}"));
            }
            self.approved
                .lock()
                .unwrap()
                .push((id.to_string(), text.to_string()));
            Ok(())
        }

        fn reject_learning(&self, id: &str) -> Result<(), String> {
            if id == "lr-2" {
                return Err(format!(
                    "{}learning lr-2 was already approved",
                    crate::workers::ERR_REFUSED
                ));
            }
            if id != "lr-1" {
                return Err(format!("unknown learning: {id}"));
            }
            self.rejected.lock().unwrap().push(id.to_string());
            Ok(())
        }

        fn list_role_variants(
            &self,
            project_id: Option<&str>,
            status: Option<&str>,
        ) -> Result<Vec<RoleVariant>, String> {
            if matches!(project_id, Some(other) if other != "pj-1") {
                return Ok(Vec::new());
            }
            Ok([
                role_variant("rv-1", "pending"),
                role_variant("rv-2", "approved"),
            ]
            .into_iter()
            .filter(|entry| status.is_none() || status == Some(entry.status.as_str()))
            .collect())
        }

        fn approve_role_variant(&self, id: &str) -> Result<(), String> {
            if id == "rv-2" {
                return Err(format!(
                    "{}role variant rv-2 was already approved",
                    crate::workers::ERR_REFUSED
                ));
            }
            if id != "rv-1" {
                return Err(format!("unknown role variant: {id}"));
            }
            self.roles_approved.lock().unwrap().push(id.to_string());
            Ok(())
        }

        fn reject_role_variant(&self, id: &str) -> Result<(), String> {
            if id == "rv-2" {
                return Err(format!(
                    "{}role variant rv-2 was already approved",
                    crate::workers::ERR_REFUSED
                ));
            }
            if id != "rv-1" {
                return Err(format!("unknown role variant: {id}"));
            }
            self.roles_rejected.lock().unwrap().push(id.to_string());
            Ok(())
        }

        fn get_activity(
            &self,
            project_id: Option<&str>,
            limit: u32,
        ) -> Result<Vec<ActivityEntry>, String> {
            let entry =
                |id: &str, project_id: &str, category: &str, created_at: i64| ActivityEntry {
                    id: id.to_string(),
                    created_at,
                    category: category.to_string(),
                    project_id: project_id.to_string(),
                    worker_id: Some("wk-1".to_string()),
                    worker_label: Some("do the thing".to_string()),
                    summary: format!("something happened in {id}"),
                };
            Ok([
                entry("ev-2", "pj-1", "message", 2),
                entry("ev-1", "pj-2", "worker", 1),
            ]
            .into_iter()
            .filter(|entry| project_id.is_none() || Some(entry.project_id.as_str()) == project_id)
            .take(limit as usize)
            .collect())
        }

        fn list_projects(&self) -> Result<Vec<ProjectOverview>, String> {
            Ok(vec![ProjectOverview {
                project: Project {
                    id: "pj-1".to_string(),
                    name: "ProjectA".to_string(),
                    repo_path: "C:/repos/a".to_string(),
                    landing_page_markdown: None,
                    max_workers: None,
                    test_command: None,
                    created_at: 42,
                },
                github_remote: true,
            }])
        }

        fn create_project(&self, name: &str, repo_path: &str) -> Result<ProjectOverview, String> {
            // The live backend probes git; this fake records the request so
            // the route test does not need a real repository.
            self.created_projects
                .lock()
                .unwrap()
                .push((name.to_string(), repo_path.to_string()));
            Ok(ProjectOverview {
                project: Project {
                    id: "pj-new".to_string(),
                    name: name.to_string(),
                    repo_path: repo_path.to_string(),
                    landing_page_markdown: None,
                    max_workers: None,
                    test_command: None,
                    created_at: 42,
                },
                github_remote: false,
            })
        }

        fn create_github_repo(
            &self,
            project_id: &str,
            name: &str,
            private: bool,
        ) -> Result<String, String> {
            core_verdict(project_id)?;
            self.repos
                .lock()
                .unwrap()
                .push((project_id.to_string(), name.to_string(), private));
            Ok("https://github.com/o/r".to_string())
        }

        fn link_github_remote(&self, project_id: &str, url: &str) -> Result<(), String> {
            // The three answers behind this route, in the words the real one
            // uses: the project lookup in `main.rs`, and `gh::link_github_remote`
            // refusing an origin it already has or failing at git itself.
            match project_id {
                "pj-nope" => {
                    return Err(format!(
                        "{}project: {project_id}",
                        crate::workers::ERR_UNKNOWN
                    ))
                }
                "pj-linked" => {
                    return Err(format!(
                        "{}remote 'origin' already exists",
                        crate::workers::ERR_REFUSED
                    ))
                }
                "pj-git" => {
                    return Err(
                        "git remote add origin failed: fatal: not a git repository".to_string()
                    )
                }
                _ => {}
            }
            self.links
                .lock()
                .unwrap()
                .push((project_id.to_string(), url.to_string()));
            Ok(())
        }

        fn merge_worker(&self, worker_id: &str, remove_worktree: bool) -> Result<Worker, String> {
            // The four ways `workers::merge_worker` refuses, in its own words,
            // plus one failure from git that is nobody's fault but the app's.
            match worker_id {
                "wk-nope" => return Err(MERGE_UNKNOWN.to_string()),
                "wk-busy" => return Err(MERGE_WRONG_COLUMN.to_string()),
                "wk-red" => return Err(MERGE_TEST_GATE.to_string()),
                "wk-live" => return Err(MERGE_STILL_RUNNING.to_string()),
                "wk-git" => return Err(MERGE_GIT_FAILED.to_string()),
                _ => {}
            }
            self.merged
                .lock()
                .unwrap()
                .push((worker_id.to_string(), remove_worktree));
            Ok(worker(worker_id))
        }

        fn get_landing_page(&self, project_id: &str) -> Result<Option<String>, String> {
            if project_id == "pj-nope" {
                return Err(format!("unknown project: {project_id}"));
            }
            Ok(self
                .landings
                .lock()
                .unwrap()
                .get(project_id)
                .cloned()
                .flatten())
        }

        fn set_landing_page(&self, project_id: &str, markdown: Option<&str>) -> Result<(), String> {
            if project_id == "pj-nope" {
                return Err(format!("unknown project: {project_id}"));
            }
            self.landings
                .lock()
                .unwrap()
                .insert(project_id.to_string(), markdown.map(str::to_string));
            Ok(())
        }
    }

    struct Fixture {
        server: ApiServer,
        backend: Arc<FakeBackend>,
        /// Last, so the server closes before its temporary directory is removed.
        _dir: TempDir,
    }

    impl Fixture {
        /// The token, read back the way the CLI reads it.
        fn token(&self) -> String {
            let raw =
                std::fs::read_to_string(self.server.descriptor_path()).expect("read descriptor");
            let descriptor: Value = serde_json::from_str(&raw).expect("parse descriptor");
            descriptor["token"].as_str().expect("token").to_string()
        }

        /// The verdict token, read the only way anything can read it: off the
        /// live server, the way the window's Tauri command does.
        fn verdict_token(&self) -> String {
            self.server.verdict_token().to_string()
        }
    }

    #[test]
    fn d4_routes_preserve_dispatch_and_fallback() {
        let fx = fixture("d4-routes");
        d4_routes::assert_contract(&fx.server.inner);
        assert_eq!(
            fx.backend.scouted.lock().unwrap()[0].1,
            vec!["https://example.com/a".to_string()]
        );
    }

    fn fixture(label: &str) -> Fixture {
        let dir = TempDir::new(label);
        let backend = Arc::new(FakeBackend::default());
        // Production gate, independent of this process's PROJECTA_APP_DATA:
        // F8 scratch is `scratch_fixture`, which calls `boot(..., true)`.
        let server = boot(
            Arc::clone(&backend) as Arc<dyn ControlBackend>,
            dir.path(),
            false,
        )
        .expect("start api");
        Fixture {
            server,
            backend,
            _dir: dir,
        }
    }

    #[cfg(windows)]
    pub(crate) fn native_server(dir: &Path, run: &str, owner: &str, fence: i64) -> ApiServer {
        let backend = FakeBackend {
            native_claim: Some((run.into(), owner.into(), fence)),
            ..Default::default()
        };
        boot(Arc::new(backend), dir, false).unwrap()
    }

    pub(crate) fn native_store_server(dir: &Path, store: crate::store::Store) -> ApiServer {
        let backend = FakeBackend {
            native_store: Some(store),
            ..Default::default()
        };
        boot(Arc::new(backend), dir, false).unwrap()
    }

    #[cfg(windows)]
    pub(crate) fn native_context_status(descriptor: &Descriptor) -> u16 {
        call(
            descriptor.port,
            "GET",
            "/api/hq/v1/agent/context",
            Some(&descriptor.token),
            "",
        )
        .0
    }
    #[test]
    fn hq_control_requires_api_auth_and_resume_refuses_without_human_token() {
        let fx = fixture("hq-contract");
        let body = r#"{"projectId":"pj-1","action":"resume"}"#;
        assert_eq!(
            call(fx.server.port(), "POST", "/api/hq/v1/control", None, body).0,
            401
        );
        assert_eq!(
            call(
                fx.server.port(),
                "POST",
                "/api/hq/v1/control",
                Some(&fx.token()),
                body
            )
            .0,
            409
        );
        assert_eq!(
            call(
                fx.server.port(),
                "GET",
                "/api/hq/v1/context?projectId=pj-1&cursor=-1",
                Some(&fx.token()),
                ""
            )
            .0,
            400
        );
    }

    #[test]
    fn hq_assignment_requires_auth_and_preserves_revision_contract() {
        let fx = fixture("hq-assignment");
        let path = "/api/hq/v1/tasks/ct-1/assignment";
        let body = json!({"teamId":"development","role":"reviewer","assignee":"alice","expectedRevision":0});
        assert_eq!(
            call(fx.server.port(), "POST", path, None, &body.to_string()).0,
            401
        );
        let (status, value) = call(
            fx.server.port(),
            "POST",
            path,
            Some(&fx.token()),
            &body.to_string(),
        );
        assert_eq!(status, 200);
        assert_eq!(value["assignment"]["taskId"], "ct-1");
        assert_eq!(value["assignment"]["assignee"], "alice");
        assert_eq!(value["assignment"]["role"], "reviewer");
        assert_eq!(value["assignment"]["revision"], 1);
        assert_eq!(value["approvalAuthority"], false);
        let mut stale = body.clone();
        stale["expectedRevision"] = json!(1);
        assert_eq!(
            call(
                fx.server.port(),
                "POST",
                path,
                Some(&fx.token()),
                &stale.to_string()
            )
            .0,
            409
        );
        let mut expanded = body.clone();
        expanded["approvalAuthority"] = json!(true);
        let mut missing = body.clone();
        missing.as_object_mut().unwrap().remove("expectedRevision");
        let mut wrong = body;
        wrong["expectedRevision"] = json!("0");
        for invalid in [expanded, missing, wrong] {
            assert_eq!(
                call(
                    fx.server.port(),
                    "POST",
                    path,
                    Some(&fx.token()),
                    &invalid.to_string()
                )
                .0,
                400
            );
        }
    }

    #[test]
    fn hq_changes_require_auth_project_and_valid_cursor() {
        let fx = fixture("hq-changes");
        let path = "/api/hq/v1/changes?projectId=pj-1&cursor=200";
        assert_eq!(call(fx.server.port(), "GET", path, None, "").0, 401);
        let (status, page) = call(fx.server.port(), "GET", path, Some(&fx.token()), "");
        assert_eq!(status, 200);
        assert_eq!(page["cursor"], 200);
        assert_eq!(page["projectId"], "pj-1");
        let wait_path = "/api/hq/v1/changes?projectId=pj-1&cursor=200&waitMs=25000";
        let (status, page) = call(fx.server.port(), "GET", wait_path, Some(&fx.token()), "");
        assert_eq!(status, 200);
        assert_eq!(page["requestedWaitMs"], 25000);
        let slots = fx
            .server
            .inner
            .journal_waits
            .clone()
            .try_acquire_many_owned(8)
            .unwrap();
        assert_eq!(
            call(fx.server.port(), "GET", wait_path, Some(&fx.token()), "").0,
            503
        );
        assert_eq!(
            call(fx.server.port(), "GET", path, Some(&fx.token()), "").0,
            200
        );
        drop(slots);
        assert_eq!(
            call(fx.server.port(), "GET", wait_path, Some(&fx.token()), "").0,
            200
        );
        for (path, expected) in [
            ("/api/hq/v1/changes?projectId=pj-1&waitMs=-1", 400),
            ("/api/hq/v1/changes?projectId=pj-1&waitMs=25001", 400),
            (
                "/api/hq/v1/changes?projectId=pj-1&waitMs=18446744073709551616",
                400,
            ),
            ("/api/hq/v1/context?projectId=pj-1&waitMs=1", 400),
            ("/api/hq/v1/changes", 400),
            ("/api/hq/v1/changes?projectId=pj-1&cursor=-1", 400),
            (
                "/api/hq/v1/changes?projectId=pj-1&cursor=9223372036854775808",
                400,
            ),
            ("/api/hq/v1/changes?projectId=pj-nope", 404),
        ] {
            assert_eq!(
                call(fx.server.port(), "GET", path, Some(&fx.token()), "").0,
                expected,
                "{path}"
            );
        }
    }

    #[test]
    fn hq_run_records_require_authentication_and_explicit_project() {
        let fx = fixture("hq-run-records");
        assert_eq!(
            call(
                fx.server.port(),
                "GET",
                "/api/hq/v1/runs?projectId=pj-1",
                None,
                ""
            )
            .0,
            401
        );
        assert_eq!(
            call(
                fx.server.port(),
                "GET",
                "/api/hq/v1/runs",
                Some(&fx.token()),
                ""
            )
            .0,
            400
        );
        let (status, body) = call(
            fx.server.port(),
            "GET",
            "/api/hq/v1/runs?projectId=pj-1",
            Some(&fx.token()),
            "",
        );
        assert_eq!(status, 200);
        assert_eq!(body["apiVersion"], 1);
        assert_eq!(body["executionEnabled"], false);
    }

    /// Isolated F8: the app process has `PROJECTA_APP_DATA`, so project
    /// registration does not need the verdict token.
    fn scratch_fixture(label: &str) -> Fixture {
        let dir = TempDir::new(label);
        let backend = Arc::new(FakeBackend::default());
        let server = boot(
            Arc::clone(&backend) as Arc<dyn ControlBackend>,
            dir.path(),
            true,
        )
        .expect("start api");
        Fixture {
            _dir: dir,
            server,
            backend,
        }
    }

    /// Send one raw request and return `(status, body)`.
    fn call(
        port: u16,
        method: &str,
        target: &str,
        token: Option<&str>,
        body: &str,
    ) -> (u16, Value) {
        call_with(port, method, target, token, None, body)
    }

    /// The same, with a verdict token beside the api token: what
    /// `pa --verdict-token` sends at the four review routes.
    fn call_with(
        port: u16,
        method: &str,
        target: &str,
        token: Option<&str>,
        verdict: Option<&str>,
        body: &str,
    ) -> (u16, Value) {
        let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
        let mut stream = TcpStream::connect(addr).expect("connect");
        stream.set_read_timeout(Some(IO_TIMEOUT)).expect("timeout");

        let auth = token.map_or(String::new(), |t| format!("{TOKEN_HEADER}: {t}\r\n"));
        let auth = match verdict {
            Some(verdict) => format!("{auth}{VERDICT_TOKEN_HEADER}: {verdict}\r\n"),
            None => auth,
        };
        let request = format!(
            "{method} {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n{auth}\
             Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(request.as_bytes()).expect("write");

        let mut raw = String::new();
        stream.read_to_string(&mut raw).expect("read");
        let (head, body) = raw.split_once("\r\n\r\n").expect("response body");
        let status: u16 = head
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|code| code.parse().ok())
            .expect("status code");
        let value = serde_json::from_str(body).unwrap_or(Value::Null);
        (status, value)
    }

    #[test]
    fn a_full_server_answers_503_without_spending_a_thread() {
        let inner = Arc::new(Inner {
            journal_waits: crate::http_util::connection_limiter_with(8),
            run_credentials: agent_access::RunCredentials::default(),
            backend: Arc::new(FakeBackend::default()),
            token: "token".to_string(),
            verdict_token: "verdict".to_string(),
            app_data: std::env::temp_dir(),
            allow_unproven_project_create: false,
        });
        let listener = TcpListener::bind(SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)))
            .expect("bind");
        let port = listener.local_addr().expect("local addr").port();
        let limiter = crate::http_util::connection_limiter_with(1);
        let slots = Arc::clone(&limiter);
        std::thread::spawn(move || accept_loop(listener, inner, limiter));

        // One client that never speaks fills the only slot; its handler
        // thread is parked on the read timeout.
        let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
        let idle = TcpStream::connect(addr).expect("connect");
        crate::http_util::wait_for_permits(&slots, 0);

        // The next connection is answered by the accept loop itself.
        let mut second = TcpStream::connect(addr).expect("connect past the limit");
        second.set_read_timeout(Some(IO_TIMEOUT)).expect("timeout");
        let mut response = String::new();
        second.read_to_string(&mut response).expect("read");
        assert!(response.starts_with("HTTP/1.1 503"), "{response}");

        // A freed slot serves the next request normally again.
        drop(idle);
        crate::http_util::wait_for_permits(&slots, 1);
        let (status, _) = call(port, "GET", "/api/health", None, "");
        assert_eq!(status, 401, "a handler thread answers again");
    }

    #[test]
    fn the_descriptor_holds_the_live_port_and_token() {
        let fx = fixture("api-descriptor");

        let raw = std::fs::read_to_string(fx.server.descriptor_path()).expect("read descriptor");
        let descriptor: Value = serde_json::from_str(&raw).expect("parse descriptor");

        assert_eq!(descriptor["port"], fx.server.port());
        assert_eq!(descriptor["token"], fx.token());
        assert_eq!(fx.token().len(), 32, "{}", fx.token());
        assert_ne!(fx.server.port(), 0);
        assert!(fx.server.descriptor_path().ends_with(DESCRIPTOR_FILE));
    }

    /// KI-19: the broad descriptor holds the key to the whole API, so on unix
    /// it is owner-only, also when a looser file was left behind by an older
    /// build or a crashed run.
    #[cfg(unix)]
    #[test]
    fn the_api_descriptor_is_owner_only_even_over_a_stale_loose_file() {
        use std::os::unix::fs::PermissionsExt;
        let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;

        let fx = fixture("api-descriptor-mode");
        assert_eq!(mode(fx.server.descriptor_path()), 0o600);

        let dir = TempDir::new("api-descriptor-stale");
        let stale = dir.path().join(DESCRIPTOR_FILE);
        std::fs::write(&stale, "{}").unwrap();
        std::fs::set_permissions(&stale, std::fs::Permissions::from_mode(0o666)).unwrap();
        let backend = Arc::new(FakeBackend::default());
        let server =
            start(Arc::clone(&backend) as Arc<dyn ControlBackend>, dir.path()).expect("start api");
        assert_eq!(mode(server.descriptor_path()), 0o600);
    }

    #[test]
    fn scoped_descriptor_files_are_unique_and_removed_on_revocation() {
        let fx = fixture("api-run-files");
        let first = fx
            .server
            .issue_run_descriptor_file("run-a", "worker-a", 7, 60)
            .unwrap();
        let second = fx
            .server
            .issue_run_descriptor_file("run-a", "worker-a", 7, 60)
            .unwrap();
        assert_ne!(first, second);
        assert_ne!(first, fx.server.descriptor_path());
        let descriptor: Descriptor =
            serde_json::from_slice(&std::fs::read(&first).unwrap()).unwrap();
        assert_ne!(descriptor.token, fx.server.token);
        assert_eq!(
            call(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/context",
                Some(&descriptor.token),
                ""
            )
            .0,
            200
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&first).unwrap().permissions().mode() & 0o777,
                0o600
            );
            // W2-07b parity with the Windows directory ACL.
            let access = fx
                .server
                .descriptor_path()
                .parent()
                .unwrap()
                .join("agent-access");
            assert_eq!(
                std::fs::metadata(&access).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        fx.server.revoke_run_credentials("run-a").unwrap();
        assert!(!first.exists());
        assert!(!second.exists());
        assert_eq!(
            call(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/context",
                Some(&descriptor.token),
                ""
            )
            .0,
            401
        );
    }

    /// W2-07: a crash skips `Drop`, so `revoke_all` never deleted the scoped
    /// descriptors of the dead process. Their tokens are no longer honoured,
    /// but they must not stay on disk either: the next boot sweeps them.
    #[test]
    fn orphaned_scoped_descriptor_files_are_swept_at_boot() {
        let dir = TempDir::new("api-run-orphans");
        let access = dir.path().join("agent-access");
        std::fs::create_dir_all(&access).unwrap();
        let orphan = access.join(format!("{}.json", "0123456789abcdef".repeat(2)));
        std::fs::write(&orphan, r#"{"port":1,"token":"placeholder"}"#).unwrap();
        let foreign = access.join("notes.txt");
        std::fs::write(&foreign, "not a descriptor").unwrap();
        let server = boot(
            Arc::new(FakeBackend::default()) as Arc<dyn ControlBackend>,
            dir.path(),
            false,
        )
        .expect("start api");
        assert!(
            !orphan.exists(),
            "a predecessor's scoped descriptor survived boot"
        );
        assert!(
            foreign.exists(),
            "only files named like a descriptor are ours"
        );
        // The fresh server's own descriptors are unaffected by the sweep.
        let fresh = server
            .issue_run_descriptor_file("run-a", "worker-a", 7, 60)
            .unwrap();
        assert!(fresh.exists());
    }

    #[test]
    fn exited_session_revokes_credentials_even_when_persistence_fails() {
        let fx = fixture("api-run-exit-failure");
        let issuer = fx.server.run_credential_issuer();
        let path = issuer
            .issue_run_descriptor_file("run-a", "worker-a", 7, 60)
            .unwrap();
        let descriptor: Descriptor =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        issuer.bind_session("run-a", "session-a").unwrap();
        assert!(issuer.bind_session("run-a", "session-b").is_err());
        let result = tauri::async_runtime::block_on(issuer.observe_exit("session-a", async {
            Err::<(), String>("injected database persistence failure".into())
        }));
        assert_eq!(result.unwrap_err(), "injected database persistence failure");
        assert!(!path.exists());
        assert_eq!(
            call(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/context",
                Some(&descriptor.token),
                ""
            )
            .0,
            401
        );
    }

    #[test]
    fn scoped_run_credentials_cannot_escape_their_run_or_gain_verdict_authority() {
        let fx = fixture("api-run-scope");
        assert!(fx
            .server
            .issue_run_descriptor("run-b", "worker-a", 7, 60)
            .is_err());
        assert!(fx
            .server
            .issue_run_descriptor("run-a", "worker-a", 8, 60)
            .is_err());
        assert!(fx
            .server
            .issue_run_descriptor("run-a", "worker-a", 7, 5401)
            .is_err());
        let descriptor = fx
            .server
            .issue_run_descriptor("run-a", "worker-a", 7, 60)
            .unwrap();
        for method in ["GET", "POST"] {
            assert_eq!(
                call(
                    descriptor.port,
                    method,
                    "/api/hq/v1/tasks/ct-1/assignment",
                    Some(&descriptor.token),
                    "{}"
                )
                .0,
                403
            );
        }
        let (status, context) = call(
            descriptor.port,
            "GET",
            "/api/hq/v1/agent/context",
            Some(&descriptor.token),
            "",
        );
        assert_eq!(status, 200);
        assert_eq!(context["runId"], "run-a");
        for (path, field) in [
            ("/api/hq/v1/agent/lessons", "lessons"),
            ("/api/hq/v1/agent/release", "delivery"),
        ] {
            let (status, value) = call(descriptor.port, "GET", path, Some(&descriptor.token), "");
            assert_eq!(status, 200, "{path}");
            assert_eq!(value["apiVersion"], 1);
            assert_eq!(value["runId"], "run-a");
            assert!(value.get(field).is_some(), "{path} missing {field}");
            assert_eq!(value["source"], "rust/sqlite");
        }
        let (_, lessons) = call(
            descriptor.port,
            "GET",
            "/api/hq/v1/agent/lessons",
            Some(&descriptor.token),
            "",
        );
        assert_eq!(lessons["instructionAuthority"], false);
        let (_, release) = call(
            descriptor.port,
            "GET",
            "/api/hq/v1/agent/release",
            Some(&descriptor.token),
            "",
        );
        assert_eq!(release["delivery"]["state"], "unavailable");
        assert_eq!(release["delivery"]["automaticDelivery"], false);
        let checkpoint = json!({"idempotencyKey":"cp-1","expectedRevision":0,"completed":[],"remaining":["Finish task"],"failedApproaches":[],"evidenceIds":[]});
        let (status, saved) = call(
            descriptor.port,
            "POST",
            "/api/hq/v1/agent/checkpoint",
            Some(&descriptor.token),
            &checkpoint.to_string(),
        );
        assert_eq!(status, 200);
        assert_eq!(saved["runId"], "run-a");
        let mut conflict = checkpoint.clone();
        conflict["remaining"] = json!(["Different content"]);
        assert_eq!(
            call(
                descriptor.port,
                "POST",
                "/api/hq/v1/agent/checkpoint",
                Some(&descriptor.token),
                &conflict.to_string()
            )
            .0,
            409
        );
        assert_eq!(
            call(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/checkpoint/1",
                Some(&descriptor.token),
                ""
            )
            .1["revision"],
            1
        );
        assert_eq!(
            call(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/checkpoint/0",
                Some(&descriptor.token),
                ""
            )
            .0,
            400
        );
        let mut injected = checkpoint.clone();
        injected["runId"] = json!("run-b");
        assert_eq!(
            call(
                descriptor.port,
                "POST",
                "/api/hq/v1/agent/checkpoint",
                Some(&descriptor.token),
                &injected.to_string()
            )
            .0,
            400
        );
        assert_eq!(
            call(
                descriptor.port,
                "POST",
                "/api/hq/v1/agent/checkpoint",
                None,
                &checkpoint.to_string()
            )
            .0,
            401
        );
        for (method, path) in [
            ("GET", "/api/hq/v1/runs?projectId=pj-1"),
            ("GET", "/api/hq/v1/changes?projectId=pj-1"),
            ("GET", "/api/hq/v1/changes?projectId=pj-1&waitMs=25000"),
            ("POST", "/api/workers"),
            ("POST", "/api/workers/a/merge"),
            ("POST", "/api/hq/v1/continuous/resume"),
            ("POST", "/api/hq/v1/agent/credentials"),
            ("GET", "/api/hq/v1/agent/context?runId=run-b"),
            ("GET", "/api/hq/v1/agent/records/evidence/start?runId=run-b"),
            ("GET", "/api/hq/v1/agent/records/credentials/start"),
            ("POST", "/api/hq/v1/agent/records/evidence/start"),
        ] {
            assert_eq!(
                call(descriptor.port, method, path, Some(&descriptor.token), "{}").0,
                403,
                "{path}"
            );
        }
        for collection in ["evidence", "reviews"] {
            let path = format!("/api/hq/v1/agent/records/{collection}/start");
            let (status, page) = call(descriptor.port, "GET", &path, Some(&descriptor.token), "");
            assert_eq!(status, 200);
            assert_eq!(page["runId"], "run-a");
            assert_eq!(page["collection"], collection);
            assert!(page["cursor"].is_null());
            assert_eq!(call(descriptor.port, "GET", &path, None, "").0, 401);
            assert_eq!(
                call(descriptor.port, "GET", &path, Some(&fx.token()), "").0,
                403
            );
        }
        assert_eq!(
            call_with(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/context",
                Some(&descriptor.token),
                Some(&fx.verdict_token()),
                ""
            )
            .0,
            403
        );
        assert_eq!(
            call(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/context",
                Some(&fx.token()),
                ""
            )
            .0,
            403
        );
        let input = r#"{"candidateCommit":"commit-a","source":"git","observedAt":1}"#;
        assert_eq!(
            call(
                descriptor.port,
                "POST",
                "/api/hq/v1/agent/candidate",
                Some(&descriptor.token),
                input
            )
            .0,
            200
        );
        let forged =
            r#"{"runId":"run-b","candidateCommit":"commit-a","source":"git","observedAt":1}"#;
        assert_eq!(
            call(
                descriptor.port,
                "POST",
                "/api/hq/v1/agent/candidate",
                Some(&descriptor.token),
                forged
            )
            .0,
            400
        );
        let evidence = r#"{"idempotencyKey":"test-1","source":"cargo","observedAt":1,"candidateCommit":"commit-a","measurement":{"state":"unavailable","reason":"not run"},"payload":{}}"#;
        assert_eq!(
            call(
                descriptor.port,
                "POST",
                "/api/hq/v1/agent/evidence",
                Some(&descriptor.token),
                evidence
            )
            .0,
            200
        );
        fx.backend
            .reject_agent_run
            .store(true, std::sync::atomic::Ordering::SeqCst);
        assert_eq!(
            call(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/context",
                Some(&descriptor.token),
                ""
            )
            .0,
            403
        );
        assert_eq!(
            call(
                descriptor.port,
                "POST",
                "/api/hq/v1/agent/evidence",
                Some(&descriptor.token),
                evidence
            )
            .0,
            403
        );
        for path in ["/api/hq/v1/agent/lessons", "/api/hq/v1/agent/release"] {
            assert_eq!(
                call(descriptor.port, "GET", path, Some(&descriptor.token), "").0,
                403,
                "{path}"
            );
        }
        fx.server.revoke_run_credentials("run-a").unwrap();
        assert_eq!(
            call(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/context",
                Some(&descriptor.token),
                ""
            )
            .0,
            401
        );
    }

    /// A real store behind the scoped review route: one implementer run with a
    /// bound candidate and evidence, one reviewer run and one bystander run in
    /// the same project, and a stranger run in another project. Returns the
    /// server, the run ids, the evidence id and a raw pool for reading what the
    /// store actually wrote.
    struct ReviewRoute {
        server: ApiServer,
        implementer: String,
        reviewer: String,
        bystander: String,
        stranger: String,
        evidence: String,
        pool: sqlx::SqlitePool,
        /// Last, so the directory outlives the server and the pool on drop.
        _dir: TempDir,
    }

    const REVIEW_COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";

    fn review_route() -> ReviewRoute {
        use crate::store::development_runs::{EvidenceInput, EvidenceMeasurement};
        let dir = TempDir::new("api-review-route");
        let db = dir.path().join("projecta.db");
        tauri::async_runtime::block_on(async {
            let store = crate::store::Store::open(&db).await.unwrap();
            let pool = sqlx::SqlitePool::connect(&format!("sqlite:{}", db.display()))
                .await
                .unwrap();
            for (name, goal) in [("review", "goal"), ("elsewhere", "goal-x")] {
                let project = store
                    .create_project(name, &dir.path().join(name).to_string_lossy())
                    .await
                    .unwrap();
                sqlx::query("INSERT INTO continuous_projects VALUES(?, 'enabled', 1)")
                    .bind(&project.id)
                    .execute(&pool)
                    .await
                    .unwrap();
                sqlx::query("INSERT INTO continuous_goals(id,project_id,root_goal_id,objective,status,deadline_at,admitted,created_at,updated_at) VALUES(?1,?2,?1,'goal','open',9999999999,1,1,1)")
                    .bind(goal).bind(&project.id).execute(&pool).await.unwrap();
                sqlx::query("INSERT INTO continuous_root_policies VALUES(?,?,'test',1)")
                    .bind(goal)
                    .bind(
                        serde_json::to_string(
                            &crate::development_policy::DevelopmentPolicy::defaults(),
                        )
                        .unwrap(),
                    )
                    .execute(&pool)
                    .await
                    .unwrap();
            }
            let mut runs = Vec::new();
            for (owner, goal) in [
                ("implementer", "goal"),
                ("reviewer", "goal"),
                ("bystander", "goal"),
                ("stranger", "goal-x"),
            ] {
                sqlx::query("INSERT INTO continuous_tasks(id,goal_id,objective,owned_paths_json,dependencies_json,status,claim_owner,claim_fence,created_at,updated_at) VALUES(?1,?2,?1,'[]','[]','running',?1,1,1,1)")
                    .bind(owner).bind(goal).execute(&pool).await.unwrap();
                runs.push(
                    store
                        .record_development_run_intent(owner, owner, 1)
                        .await
                        .unwrap()
                        .id,
                );
            }
            // The reviewer run is dispatched in the reviewer role (W2-04), so
            // the fixture stays valid once the store checks that role.
            sqlx::query("INSERT INTO continuous_team_assignments(task_id,team_id,role,assignee,revision,policy_version,observed_at) VALUES('reviewer','development','reviewer','reviewer',1,1,1)")
                .execute(&pool).await.unwrap();
            store
                .bind_development_run_candidate(&runs[0], "implementer", 1, REVIEW_COMMIT, "git", 1)
                .await
                .unwrap();
            let evidence = store
                .record_development_evidence(
                    &runs[0],
                    "implementer",
                    1,
                    EvidenceInput {
                        idempotency_key: "evidence-1".into(),
                        source: "cargo".into(),
                        observed_at: 1,
                        candidate_commit: REVIEW_COMMIT.into(),
                        measurement: EvidenceMeasurement::Unavailable {
                            reason: "not run".into(),
                        },
                        payload: json!({}),
                    },
                )
                .await
                .unwrap()
                .id;
            let backend = FakeBackend {
                native_store: Some(store),
                ..Default::default()
            };
            let server = boot(Arc::new(backend), &dir.path().join("api"), false).unwrap();
            ReviewRoute {
                server,
                implementer: runs[0].clone(),
                reviewer: runs[1].clone(),
                bystander: runs[2].clone(),
                stranger: runs[3].clone(),
                evidence,
                pool,
                _dir: dir,
            }
        })
    }

    fn review_body(evidence: &str, key: &str) -> Value {
        json!({
            "idempotencyKey": key,
            "evidenceId": evidence,
            "candidateCommit": REVIEW_COMMIT,
            "disposition": "approved",
            "source": "reviewer-session",
            "observedAt": 2,
        })
    }

    /// `(run_id, reviewer_identity)` of every stored review.
    fn stored_reviews(pool: &sqlx::SqlitePool) -> Vec<(String, String)> {
        tauri::async_runtime::block_on(
            sqlx::query_as(
                "SELECT run_id, reviewer_identity FROM development_run_reviews ORDER BY rowid",
            )
            .fetch_all(pool),
        )
        .unwrap()
    }

    /// W2-01b: the reviewer principal of `POST /api/hq/v1/agent/review` is the
    /// run the scoped credential was minted for. A body that names a run -
    /// the reviewer's own, a bystander's, or the implementer's - is refused
    /// like every other injected run field on the agent routes, and no review
    /// is written for anyone.
    #[test]
    fn review_route_takes_the_reviewer_run_from_the_credential_not_the_body() {
        let fx = review_route();
        let port = fx.server.port();
        let issue = |run: &str, owner: &str| {
            fx.server
                .issue_run_descriptor(run, owner, 1, 60)
                .unwrap()
                .token
        };
        let reviewer = issue(&fx.reviewer, "reviewer");
        let implementer = issue(&fx.implementer, "implementer");
        let path = "/api/hq/v1/agent/review";

        // (1) A valid credential that names a foreign reviewer run.
        for (token, named) in [
            (&reviewer, &fx.bystander),
            (&reviewer, &fx.reviewer),
            (&implementer, &fx.reviewer),
            (&implementer, &fx.bystander),
        ] {
            for field in ["reviewerRunId", "runId"] {
                let mut forged = review_body(&fx.evidence, "forged");
                forged[field] = json!(named);
                let (status, body) = call(port, "POST", path, Some(token), &forged.to_string());
                assert_eq!(status, 400, "{field}={named}: {body}");
            }
        }
        assert!(stored_reviews(&fx.pool).is_empty());

        // The implementer's own credential is not a reviewer principal.
        let (status, body) = call(
            port,
            "POST",
            path,
            Some(&implementer),
            &review_body(&fx.evidence, "self").to_string(),
        );
        assert_eq!(status, 403, "{body}");
        assert!(stored_reviews(&fx.pool).is_empty());

        // (2) Missing, unknown and broad credentials, as on the other routes.
        let clean = review_body(&fx.evidence, "review-1").to_string();
        assert_eq!(call(port, "POST", path, None, &clean).0, 401);
        assert_eq!(
            call(port, "POST", path, Some(&"0".repeat(32)), &clean).0,
            401
        );
        let broad = {
            let raw = std::fs::read_to_string(fx.server.descriptor_path()).unwrap();
            serde_json::from_str::<Value>(&raw).unwrap()["token"]
                .as_str()
                .unwrap()
                .to_string()
        };
        assert_eq!(call(port, "POST", path, Some(&broad), &clean).0, 403);
        let query = format!("{path}?runId={}", fx.bystander);
        assert_eq!(call(port, "POST", &query, Some(&reviewer), &clean).0, 403);
        assert!(stored_reviews(&fx.pool).is_empty());

        // (3) The normal case: the review is stored with the token's run as
        // reviewer and the evidence owner as the reviewed run.
        let (status, review) = call(port, "POST", path, Some(&reviewer), &clean);
        assert_eq!(status, 200, "{review}");
        assert_eq!(review["runId"], json!(fx.implementer));
        let principal = format!("run={} ", fx.reviewer);
        assert!(
            review["reviewerIdentity"]
                .as_str()
                .is_some_and(|identity| identity.starts_with(&principal)),
            "{review}"
        );
        let stored = stored_reviews(&fx.pool);
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].0, fx.implementer);
        assert!(stored[0].1.starts_with(&principal), "{stored:?}");

        // A revoked credential is dead like on every other scoped route.
        fx.server.revoke_run_credentials(&fx.reviewer).unwrap();
        let again = review_body(&fx.evidence, "review-2").to_string();
        assert_eq!(call(port, "POST", path, Some(&reviewer), &again).0, 401);
        assert_eq!(stored_reviews(&fx.pool).len(), 1);
    }

    /// The store's refusals of a well-formed review reach the caller through
    /// the route with their own status, and none of them writes a review:
    /// unknown evidence 404, a candidate other than the evidence's 409, a
    /// reviewer from another project 403. A replay of the same submission is
    /// idempotent; the same key with another payload is a conflict.
    #[test]
    fn review_route_maps_store_refusals_and_replays_at_the_seam() {
        let fx = review_route();
        let port = fx.server.port();
        let reviewer = fx
            .server
            .issue_run_descriptor(&fx.reviewer, "reviewer", 1, 60)
            .unwrap()
            .token;
        let stranger = fx
            .server
            .issue_run_descriptor(&fx.stranger, "stranger", 1, 60)
            .unwrap()
            .token;
        let path = "/api/hq/v1/agent/review";
        let post =
            |token: &str, body: &Value| call(port, "POST", path, Some(token), &body.to_string());

        let (status, body) = post(&reviewer, &review_body("dre-missing", "missing"));
        assert_eq!(status, 404, "{body}");
        let mut other_commit = review_body(&fx.evidence, "other-commit");
        other_commit["candidateCommit"] = json!("f".repeat(40));
        let (status, body) = post(&reviewer, &other_commit);
        assert_eq!(status, 409, "{body}");
        let (status, body) = post(&stranger, &review_body(&fx.evidence, "stranger"));
        assert_eq!(status, 403, "{body}");
        assert!(stored_reviews(&fx.pool).is_empty());

        let first = review_body(&fx.evidence, "replay");
        let (status, saved) = post(&reviewer, &first);
        assert_eq!(status, 200, "{saved}");
        let (status, replayed) = post(&reviewer, &first);
        assert_eq!(status, 200, "{replayed}");
        assert_eq!(replayed["id"], saved["id"]);
        let mut changed = first.clone();
        changed["disposition"] = json!("changesRequested");
        let (status, body) = post(&reviewer, &changed);
        assert_eq!(status, 409, "{body}");
        assert_eq!(stored_reviews(&fx.pool).len(), 1);
    }

    #[test]
    fn scoped_credentials_are_revoked_when_server_handle_drops() {
        let fx = fixture("api-run-teardown");
        let descriptor = fx
            .server
            .issue_run_descriptor("run-a", "worker-a", 7, 60)
            .unwrap();
        drop(fx);
        assert_eq!(
            call(
                descriptor.port,
                "GET",
                "/api/hq/v1/agent/context",
                Some(&descriptor.token),
                ""
            )
            .0,
            401
        );
    }

    /// F1-SI-1: a dying instance must not delete a successor's descriptor.
    /// The single-instance plugin releases the mutex on `RunEvent::Exit`
    /// before our Exit handler (and later `Drop`) run; the successor may
    /// already have written a new `projecta-api.json` at the same path.
    #[test]
    fn drop_does_not_delete_a_successor_descriptor() {
        let dir = TempDir::new("api-si1-successor");
        let backend = Arc::new(FakeBackend::default());
        let server =
            start(Arc::clone(&backend) as Arc<dyn ControlBackend>, dir.path()).expect("start api");
        let path = server.descriptor_path().to_path_buf();
        let successor = serde_json::json!({
            "port": 9,
            "token": "ffffffffffffffffffffffffffffffff",
        });
        std::fs::write(&path, successor.to_string()).expect("write successor");
        drop(server);
        let raw = std::fs::read_to_string(&path).expect("successor must survive drop");
        let parsed: Value = serde_json::from_str(&raw).expect("parse");
        assert_eq!(parsed["port"], 9);
        assert_eq!(parsed["token"], "ffffffffffffffffffffffffffffffff");
    }

    #[test]
    fn drop_deletes_our_own_descriptor() {
        let dir = TempDir::new("api-si1-ours");
        let backend = Arc::new(FakeBackend::default());
        let server =
            start(Arc::clone(&backend) as Arc<dyn ControlBackend>, dir.path()).expect("start api");
        let path = server.descriptor_path().to_path_buf();
        assert!(path.is_file(), "{}", path.display());
        drop(server);
        assert!(
            !path.exists(),
            "our descriptor must leave with us: {}",
            path.display()
        );
    }

    #[test]
    fn drop_tolerates_a_missing_descriptor() {
        let dir = TempDir::new("api-si1-missing");
        let backend = Arc::new(FakeBackend::default());
        let server =
            start(Arc::clone(&backend) as Arc<dyn ControlBackend>, dir.path()).expect("start api");
        let path = server.descriptor_path().to_path_buf();
        std::fs::remove_file(&path).expect("remove");
        drop(server);
    }

    #[test]
    fn drop_leaves_a_malformed_descriptor_alone() {
        let dir = TempDir::new("api-si1-malformed");
        let backend = Arc::new(FakeBackend::default());
        let server =
            start(Arc::clone(&backend) as Arc<dyn ControlBackend>, dir.path()).expect("start api");
        let path = server.descriptor_path().to_path_buf();
        std::fs::write(&path, "not-json{{{").expect("write garbage");
        drop(server);
        let raw = std::fs::read_to_string(&path).expect("malformed must survive");
        assert_eq!(raw, "not-json{{{");
    }

    #[test]
    fn two_servers_do_not_share_a_token() {
        let a = fixture("api-token-a");
        let b = fixture("api-token-b");
        assert_ne!(a.token(), b.token());
    }

    #[test]
    fn a_request_without_the_token_is_refused() {
        let fx = fixture("api-token-roundtrip");
        let port = fx.server.port();
        let token = fx.token();

        let (status, body) = call(port, "GET", "/api/health", None, "");
        assert_eq!(status, 401, "{body}");
        assert!(
            body["error"]
                .as_str()
                .unwrap_or_default()
                .contains(TOKEN_HEADER),
            "{body}"
        );

        let (status, body) = call(port, "GET", "/api/health", Some("not-the-token"), "");
        assert_eq!(status, 401, "{body}");

        let (status, body) = call(port, "GET", "/api/health", Some(&token), "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["ok"], true);
    }

    #[test]
    fn diagnosis_reports_the_log_path_and_never_the_pack() {
        let fx = fixture("api-diagnosis");
        let token = fx.token();
        let (status, body) = call(fx.server.port(), "GET", "/api/diagnosis", Some(&token), "");
        assert_eq!(status, 200, "{body}");
        let log_path = body["logPath"].as_str().expect("logPath");
        assert!(log_path.ends_with("projecta.log"), "{log_path}");
        assert_eq!(body["panicCurrent"], false);
        assert_eq!(body["panicPrevious"], false);
        assert!(body.get("logExcerpt").is_none());
        assert!(body.get("projects").is_none());
        assert!(body.get("token").is_none());
    }

    #[test]
    fn emergency_stop_route_sets_clears_and_reads_back() {
        let fx = fixture("api-emergency-stop");
        let token = fx.token();
        let port = fx.server.port();
        let (status, body) = call(port, "GET", "/api/emergency-stop", Some(&token), "");
        assert_eq!((status, &body["active"]), (200, &json!(false)), "{body}");
        let (status, body) = call(
            port,
            "POST",
            "/api/emergency-stop",
            Some(&token),
            r#"{"active":true}"#,
        );
        assert_eq!((status, &body["active"]), (200, &json!(true)), "{body}");
        assert_eq!(fx.backend.stop_state.lock().unwrap().1, "pa");
        let (_, body) = call(port, "GET", "/api/emergency-stop", Some(&token), "");
        assert_eq!(body["active"], true);
        let verdict = fx.verdict_token();
        let (status, body) = call_with(
            port,
            "POST",
            "/api/emergency-stop",
            Some(&token),
            Some(&verdict),
            r#"{"active":false}"#,
        );
        assert_eq!((status, &body["active"]), (200, &json!(false)), "{body}");
    }

    #[test]
    fn env_stage_reads_strict_without_a_row_and_stores_a_valid_put() {
        let fx = fixture("api-env-stage");
        let token = fx.token();
        let verdict = fx.verdict_token();
        let port = fx.server.port();
        let target = "/api/settings/env-isolation";
        let (status, body) = call(port, "GET", target, Some(&token), "");
        assert_eq!((status, &body["stage"]), (200, &json!("strict")), "{body}");

        let put = r#"{"stage":"allowlist"}"#;
        let (status, body) = call_with(port, "PUT", target, Some(&token), Some(&verdict), put);
        assert_eq!(
            (status, &body["stage"]),
            (200, &json!("allowlist")),
            "{body}"
        );
        let (_, body) = call(port, "GET", target, Some(&token), "");
        assert_eq!(body["stage"], "allowlist");
    }

    #[test]
    fn env_stage_rejects_an_invalid_stage_with_400_and_keeps_the_old_one() {
        let fx = fixture("api-env-stage-invalid");
        let token = fx.token();
        let verdict = fx.verdict_token();
        let port = fx.server.port();
        let target = "/api/settings/env-isolation";
        for bad in [
            r#"{"stage":"open"}"#,
            r#"{"stage":3}"#,
            "{}",
            r#"{"stage":"strict","x":1}"#,
        ] {
            let (status, body) = call_with(port, "PUT", target, Some(&token), Some(&verdict), bad);
            assert_eq!(status, 400, "{bad}: {body}");
        }
        assert_eq!(
            *fx.backend.env_stage.lock().unwrap(),
            crate::profiles::EnvIsolation::Strict
        );
    }

    #[test]
    fn env_stage_write_with_the_normal_token_is_403_and_changes_nothing() {
        let fx = fixture("api-env-stage-authority");
        let token = fx.token();
        let port = fx.server.port();
        let target = "/api/settings/env-isolation";
        let put = r#"{"stage":"inherit"}"#;
        let (status, body) = call(port, "PUT", target, Some(&token), put);
        assert_eq!(status, 403, "{body}");
        let (status, _) = call_with(port, "PUT", target, Some(&token), Some("wrong"), put);
        assert_eq!(status, 403);
        assert_eq!(
            *fx.backend.env_stage.lock().unwrap(),
            crate::profiles::EnvIsolation::Strict
        );
    }

    #[test]
    fn emergency_stop_release_requires_verdict_authority() {
        let fx = fixture("api-emergency-stop-release-authority");
        let token = fx.token();
        let port = fx.server.port();
        let target = "/api/emergency-stop";
        let release = r#"{"active":false}"#;
        assert_eq!(
            call(port, "POST", target, Some(&token), r#"{"active":true}"#).0,
            200
        );
        let (status, body) = call(port, "POST", target, Some(&token), release);
        assert_eq!(status, 403, "{body}");
        assert!(
            body["error"]
                .as_str()
                .is_some_and(|error| error.contains("releasing the emergency stop")),
            "{body}"
        );
        assert!(fx.backend.stop_state.lock().unwrap().0);

        let verdict = fx.verdict_token();
        let (status, body) = call_with(port, "POST", target, Some(&token), Some(&verdict), release);
        assert_eq!((status, &body["active"]), (200, &json!(false)), "{body}");
    }

    #[test]
    fn emergency_stop_route_rejects_bad_input_and_fails_closed() {
        let fx = fixture("api-emergency-stop-guard");
        let token = fx.token();
        let port = fx.server.port();
        let (status, _) = call(port, "GET", "/api/emergency-stop", None, "");
        assert_eq!(status, 401);
        let (status, _) = call(
            port,
            "POST",
            "/api/emergency-stop",
            None,
            r#"{"active":true}"#,
        );
        assert_eq!(status, 401);
        assert!(!fx.backend.stop_state.lock().unwrap().0);
        for bad in [r#"{}"#, r#"{"active":"yes"}"#, r#"{"active":true,"x":1}"#] {
            let (status, body) = call(port, "POST", "/api/emergency-stop", Some(&token), bad);
            assert_eq!(status, 400, "{bad}: {body}");
        }
        assert!(!fx.backend.stop_state.lock().unwrap().0);
        fx.backend
            .stop_broken
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let (status, body) = call(port, "GET", "/api/emergency-stop", Some(&token), "");
        assert_eq!(status, 500, "{body}");
        assert!(body.get("active").is_none());
    }

    #[test]
    fn an_unauthenticated_request_never_reaches_the_backend() {
        let fx = fixture("api-token-guard");
        let body = r#"{"projectId":"pj-1","task":"boom"}"#;

        let (status, _) = call(fx.server.port(), "POST", "/api/workers", None, body);
        assert_eq!(status, 401);
        assert!(fx.backend.created.lock().unwrap().is_empty());
    }

    #[test]
    fn creating_a_worker_passes_the_payload_through() {
        let fx = fixture("api-create");
        let stored = fx.token();
        let token = Some(stored.as_str());

        let (status, body) = call(
            fx.server.port(),
            "POST",
            "/api/workers",
            token,
            r#"{"projectId":"pj-1","task":"make the tests pass","profileId":"kimi"}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["id"], "wk-new");
        assert_eq!(body["kind"], KIND_WORKER);
        assert_eq!(
            fx.backend.created.lock().unwrap()[0],
            (
                "pj-1".to_string(),
                "make the tests pass".to_string(),
                "kimi".to_string(),
                None
            )
        );

        // The profile is optional and falls back to Claude; `spawnedBy` is the
        // caller's own bookkeeping and travels with the request.
        let (status, _) = call(
            fx.server.port(),
            "POST",
            "/api/workers",
            token,
            r#"{"projectId":"pj-1","task":"again"}"#,
        );
        assert_eq!(status, 200);
        assert_eq!(fx.backend.created.lock().unwrap()[1].2, DEFAULT_PROFILE);
        assert_eq!(fx.backend.created.lock().unwrap()[1].3, None);

        let (status, _) = call(
            fx.server.port(),
            "POST",
            "/api/workers",
            token,
            r#"{"projectId":"pj-1","task":"ordered","spawnedBy":"wk-queen"}"#,
        );
        assert_eq!(status, 200);
        assert_eq!(
            fx.backend.created.lock().unwrap()[2].3.as_deref(),
            Some("wk-queen")
        );
    }

    #[test]
    fn creating_a_worker_needs_a_project_and_a_task() {
        let fx = fixture("api-create-invalid");
        let stored = fx.token();
        let token = Some(stored.as_str());

        for body in [r#"{"task":"t"}"#, r#"{"projectId":"pj-1"}"#, "not json"] {
            let (status, reply) = call(fx.server.port(), "POST", "/api/workers", token, body);
            assert_eq!(status, 400, "{body}: {reply}");
        }
        assert!(fx.backend.created.lock().unwrap().is_empty());
    }

    #[test]
    fn workers_can_be_listed_filtered_and_read_one_at_a_time() {
        let fx = fixture("api-read");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/workers", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body[0]["id"], "wk-1");

        let (_, body) = call(port, "GET", "/api/workers?projectId=pj-other", token, "");
        assert_eq!(body.as_array().expect("array").len(), 0);

        let (status, body) = call(port, "GET", "/api/workers/wk-1/messages?limit=3", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body.as_array().expect("array").len(), 3);
        assert_eq!(body[0]["workerId"], "wk-1");
        assert_eq!(body[0]["role"], crate::store::MSG_USER);

        let (status, body) = call(port, "GET", "/api/workers/wk-1", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["worker"]["id"], "wk-1");
        assert_eq!(body["column"], crate::status::COL_WORKING);

        let (status, body) = call(port, "GET", "/api/workers/wk-nope", token, "");
        assert_eq!(status, 404, "{body}");

        let (status, body) = call(port, "GET", "/api/board?projectId=pj-1", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body[0]["worker"]["id"], "wk-1");

        let (status, body) = call(port, "GET", "/api/quota", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body.as_array().expect("array").len(), 0);
    }

    #[test]
    fn updater_state_is_available_from_the_control_api() {
        let fx = fixture("api-updater-state");
        let stored = fx.token();

        let (status, body) = call(
            fx.server.port(),
            "GET",
            "/api/updater",
            Some(stored.as_str()),
            "",
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["phase"], "idle");
    }

    #[test]
    fn updater_state_keeps_the_wire_shape_the_frontend_sends() {
        let wire = [
            json!({ "phase": "idle" }),
            json!({ "phase": "checking" }),
            json!({ "phase": "up-to-date", "version": "1.2.3" }),
            json!({ "phase": "available", "version": "2.0.0", "notes": null, "activeWorkers": 3 }),
            json!({ "phase": "installing", "version": "2.0.0" }),
            json!({ "phase": "ready", "version": "2.0.0" }),
            json!({ "phase": "error", "message": "offline" }),
        ];
        for value in wire {
            let state: UpdaterState =
                serde_json::from_value(value.clone()).expect("frontend payload deserializes");
            assert_eq!(serde_json::to_value(&state).expect("serializes"), value);
        }
    }

    #[test]
    fn the_usage_ledger_is_served_fleet_wide_with_a_capped_limit() {
        let fx = fixture("api-usage");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/usage", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["online"], true);
        assert_eq!(body["authorized"], true);
        assert_eq!(body["events"][0]["model"], "gpt-5.6-sol");
        assert_eq!(body["events"][0]["tokensIn"], 19);
        assert_eq!(
            body["events"][0]["costUsd"],
            Value::Null,
            "an unpriced row stays unpriced rather than becoming a zero"
        );
        assert_eq!(body["today"]["requests"], 1);
        assert_eq!(body["total"]["tokensIn"], 119);
        assert_eq!(body["reportedCostUsd"], 42.5);

        // The limit travels; an unreadable one is the default, and anything
        // over the cap is the cap.
        let (status, _) = call(port, "GET", "/api/usage?limit=3", token, "");
        assert_eq!(status, 200);
        let (status, _) = call(port, "GET", "/api/usage?limit=nope", token, "");
        assert_eq!(status, 200);
        let (status, _) = call(port, "GET", "/api/usage?limit=99999", token, "");
        assert_eq!(status, 200);
        let (status, _) = call(port, "GET", "/api/usage?limit=0", token, "");
        assert_eq!(status, 200);
        assert_eq!(
            *fx.backend.usage_limits.lock().unwrap(),
            vec![
                USAGE_LIMIT_DEFAULT,
                3,
                USAGE_LIMIT_DEFAULT,
                USAGE_LIMIT_MAX,
                1
            ]
        );

        // Read only, and behind the token like everything else on this port.
        let (status, _) = call(port, "POST", "/api/usage", token, "{}");
        assert_eq!(status, 405);
        let (status, _) = call(port, "GET", "/api/usage", None, "");
        assert_eq!(status, 401);
    }

    #[test]
    fn digests_are_listed_by_date_and_read_one_at_a_time() {
        let fx = fixture("api-digests");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/projects/pj-1/digests", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body[0], "2026-08-27");

        let (status, body) = call(
            port,
            "GET",
            "/api/projects/pj-1/digests/2026-08-27",
            token,
            "",
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["date"], "2026-08-27");
        assert!(body["markdown"]
            .as_str()
            .expect("markdown")
            .starts_with("# 2026-08-27"));

        // A day with no page, and a project that is not one: both 404.
        let (status, _) = call(
            port,
            "GET",
            "/api/projects/pj-1/digests/2026-08-01",
            token,
            "",
        );
        assert_eq!(status, 404);
        let (status, _) = call(port, "GET", "/api/projects/pj-nope/digests", token, "");
        assert_eq!(status, 404);
        let (status, _) = call(
            port,
            "GET",
            "/api/projects/pj-nope/digests/2026-08-27",
            token,
            "",
        );
        assert_eq!(status, 404);

        // The date becomes a file name, so a shape that is not a date is
        // refused by the route before the backend ever sees it.
        for bad in ["2026-8-1", "%2e%2e%2fetc", "nope"] {
            let (status, body) = call(
                port,
                "GET",
                &format!("/api/projects/pj-1/digests/{bad}"),
                token,
                "",
            );
            assert_eq!(status, 400, "{bad} -> {body}");
        }

        let (status, body) = call(port, "POST", "/api/projects/pj-1/digests", token, "{}");
        assert_eq!(status, 405, "{body}");
    }

    #[test]
    fn statistics_carry_their_window_and_say_when_a_number_is_not_measured() {
        let fx = fixture("api-stats");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        // No range at all is "everything", not an error.
        let (status, body) = call(port, "GET", "/api/projects/pj-1/stats", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["range"], "all");
        assert_eq!(body["since"], Value::Null);
        assert_eq!(body["overview"]["workersActive"], 1);
        assert_eq!(body["completion"]["percent"], 42.5);
        // The gap travels as `null` all the way to the client, which is what
        // lets the tab print "nicht gemessen" instead of a zero.
        assert_eq!(body["tokens"], Value::Null);

        let (status, body) = call(
            port,
            "GET",
            "/api/projects/pj-1/stats?range=week",
            token,
            "",
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["range"], "week");
        assert!(body["since"].as_i64().is_some());
        assert_eq!(
            *fx.backend.stats_ranges.lock().unwrap(),
            vec![
                crate::stats::StatsRange::All,
                crate::stats::StatsRange::Week
            ]
        );

        // A window that names nothing is refused rather than widened.
        let (status, body) = call(
            port,
            "GET",
            "/api/projects/pj-1/stats?range=gestern",
            token,
            "",
        );
        assert_eq!(status, 400, "{body}");
        // The refusal names every accepted window, aliases included.
        let text = body.to_string();
        assert!(text.contains("7d"), "{text}");
        assert!(text.contains("30d"), "{text}");

        // The aliases the refusal names are actually accepted.
        let (status, body) = call(port, "GET", "/api/projects/pj-1/stats?range=7d", token, "");
        assert_eq!(status, 200, "{body}");

        let (status, _) = call(port, "GET", "/api/projects/pj-nope/stats", token, "");
        assert_eq!(status, 404);

        let (status, body) = call(port, "POST", "/api/projects/pj-1/stats", token, "{}");
        assert_eq!(status, 405, "{body}");
    }

    #[test]
    fn budgets_are_listed_and_written_one_profile_at_a_time() {
        let fx = fixture("api-budgets");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/budgets", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body[0]["profileId"], "claude");
        assert_eq!(body[0]["fiveHourPct"], 90);
        assert!(body[0]["sevenDayPct"].is_null());

        // An absent window is left alone, an explicit null clears it.
        let (status, body) = call(
            port,
            "PUT",
            "/api/budgets",
            token,
            r#"{"profileId":"claude","fiveHourPct":80,"sevenDayPct":null}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["fiveHourPct"], 80);
        assert!(body["sevenDayPct"].is_null());
        assert_eq!(
            fx.backend.budgets.lock().unwrap().clone(),
            vec![("claude".to_string(), Some(Some(80)), Some(None))]
        );

        // Caller mistakes are 4xx, each named: no profile, no window, a
        // percentage out of range, and a profile that does not exist.
        for (body_text, expected) in [
            (r#"{"fiveHourPct":80}"#, 400),
            (r#"{"profileId":"claude"}"#, 400),
            (r#"{"profileId":"claude","fiveHourPct":0}"#, 400),
            (r#"{"profileId":"claude","fiveHourPct":101}"#, 400),
            (r#"{"profileId":"claude","fiveHourPct":"90"}"#, 400),
            (r#"{"profileId":"nope","fiveHourPct":90}"#, 404),
        ] {
            let (status, reply) = call(port, "PUT", "/api/budgets", token, body_text);
            assert_eq!(status, expected, "{body_text} -> {reply}");
            assert!(reply["error"].is_string(), "{reply}");
        }

        let (status, body) = call(port, "DELETE", "/api/budgets", token, "");
        assert_eq!(status, 405, "{body}");
    }

    #[test]
    fn the_providers_route_mirrors_the_overview() {
        let fx = fixture("api-providers");
        let stored = fx.token();
        let token = Some(stored.as_str());

        let (status, body) = call(fx.server.port(), "GET", "/api/providers", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body[0]["id"], "claude");
        assert_eq!(body[0]["kind"], crate::providers::KIND_SUBSCRIPTION);
        assert_eq!(body[0]["connected"], true);
        assert_eq!(body[0]["detail"], "1.2.3");
        assert_eq!(body[0]["quotaState"], crate::store::QUOTA_BLOCKED);
        assert_eq!(body[0]["blockedUntil"], 1_800_000_000_i64);
        assert_eq!(body[0]["omniRouteOnline"], false);
        assert_eq!(body[0]["usage"]["percent"], 87);
        assert_eq!(body[0]["usage"]["source"], "hook");
        assert!(body[0]["usage"]["used"].is_string());

        // Read only: there is no way to post a key through the control port.
        let (status, body) = call(fx.server.port(), "POST", "/api/providers", token, "{}");
        assert_eq!(status, 405, "{body}");
    }

    #[test]
    fn merging_a_worker_passes_the_worktree_flag_through() {
        let fx = fixture("api-merge");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let stored_verdict = fx.verdict_token();
        let verdict = Some(stored_verdict.as_str());
        let port = fx.server.port();

        // Ordinary API token cannot merge (F0-1).
        let (status, body) = call(port, "POST", "/api/workers/wk-1/merge", token, "");
        assert_eq!(status, 403, "{body}");
        assert!(fx.backend.merged.lock().unwrap().is_empty());

        let (status, body) = call_with(
            port,
            "POST",
            "/api/workers/wk-1/merge",
            token,
            Some("wrong-verdict"),
            "",
        );
        assert_eq!(status, 403, "{body}");
        assert!(fx.backend.merged.lock().unwrap().is_empty());

        // An empty body is the ordinary call: keep the worktree.
        let (status, body) = call_with(port, "POST", "/api/workers/wk-1/merge", token, verdict, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["id"], "wk-1");
        assert_eq!(
            fx.backend.merged.lock().unwrap()[0],
            ("wk-1".to_string(), false)
        );

        // Both spellings of the flag reach the backend.
        let (status, _) = call_with(
            port,
            "POST",
            "/api/workers/wk-2/merge",
            token,
            verdict,
            r#"{"removeWorktree":true}"#,
        );
        assert_eq!(status, 200);
        assert_eq!(
            fx.backend.merged.lock().unwrap()[1],
            ("wk-2".to_string(), true)
        );

        let (status, _) = call_with(
            port,
            "POST",
            "/api/workers/wk-3/merge",
            token,
            verdict,
            r#"{"remove_worktree":true}"#,
        );
        assert_eq!(status, 200);
        assert_eq!(
            fx.backend.merged.lock().unwrap()[2],
            ("wk-3".to_string(), true)
        );

        // Merging is a POST; anything else is named as the wrong verb.
        let (status, _) = call(port, "GET", "/api/workers/wk-1/merge", token, "");
        assert_eq!(status, 405);

        // And it is behind the token like every other route.
        let (status, _) = call(port, "POST", "/api/workers/wk-9/merge", None, "");
        assert_eq!(status, 401);
        assert_eq!(fx.backend.merged.lock().unwrap().len(), 3);
    }

    #[test]
    fn sending_text_reaches_the_worker() {
        let fx = fixture("api-send");
        let stored = fx.token();
        let token = Some(stored.as_str());

        let (status, body) = call(
            fx.server.port(),
            "POST",
            "/api/workers/wk-1/send",
            token,
            r#"{"text":"ja, weiter"}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["ok"], true);
        assert_eq!(
            fx.backend.sent.lock().unwrap()[0],
            ("wk-1".to_string(), "ja, weiter".to_string())
        );

        let (status, _) = call(
            fx.server.port(),
            "POST",
            "/api/workers/wk-1/send",
            token,
            "{}",
        );
        assert_eq!(status, 400);
    }

    #[test]
    fn telling_the_orchestrator_answers_with_it() {
        let fx = fixture("api-orchestrator-send");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(
            port,
            "POST",
            "/api/projects/pj-1/orchestrator/send",
            token,
            r#"{"text":"bau mir X"}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["id"], "wk-orch");
        assert_eq!(body["kind"], KIND_ORCHESTRATOR);
        assert_eq!(
            fx.backend.told.lock().unwrap()[0],
            ("pj-1".to_string(), "bau mir X".to_string())
        );

        // A missing field is a mistake; an empty one is a bare Enter.
        let (status, _) = call(
            port,
            "POST",
            "/api/projects/pj-1/orchestrator/send",
            token,
            "{}",
        );
        assert_eq!(status, 400);
        let (status, _) = call(
            port,
            "POST",
            "/api/projects/pj-1/orchestrator/send",
            token,
            r#"{"text":""}"#,
        );
        assert_eq!(status, 200);

        // Whatever the core says about an unknown project comes through.
        let (status, body) = call(
            port,
            "POST",
            "/api/projects/pj-nope/orchestrator/send",
            token,
            r#"{"text":"hallo"}"#,
        );
        // A mistyped project id is the caller's mistake, not the app's.
        assert_eq!(status, 404);
        assert_eq!(body["error"], "unknown project: pj-nope");

        let (status, _) = call(
            port,
            "GET",
            "/api/projects/pj-1/orchestrator/send",
            token,
            "",
        );
        assert_eq!(status, 405);
    }

    #[test]
    fn a_scout_and_a_triage_are_started_through_the_api() {
        let fx = fixture("api-scout");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "POST", "/api/scout", token, r#"{"projectId":"pj-1"}"#);
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["id"], "wk-scout");
        assert_eq!(body["kind"], crate::store::KIND_SCOUT);
        assert_eq!(body["branch"], "");

        let (status, body) = call(
            port,
            "POST",
            "/api/scout/triage",
            token,
            r#"{"projectId":"pj-1","urls":["https://github.com/a/b","  ","https://github.com/c/d"]}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["id"], "wk-triage");

        assert_eq!(
            *fx.backend.scouted.lock().unwrap(),
            vec![
                ("pj-1".to_string(), Vec::new()),
                (
                    "pj-1".to_string(),
                    vec![
                        "https://github.com/a/b".to_string(),
                        "https://github.com/c/d".to_string(),
                    ],
                ),
            ]
        );

        // A triage without any usable url never reaches the backend.
        for body in [
            r#"{"projectId":"pj-1"}"#,
            r#"{"projectId":"pj-1","urls":[]}"#,
            r#"{"projectId":"pj-1","urls":["  "]}"#,
            r#"{"urls":["https://x"]}"#,
        ] {
            let (status, reply) = call(port, "POST", "/api/scout/triage", token, body);
            assert_eq!(status, 400, "{body}: {reply}");
        }
        assert_eq!(fx.backend.scouted.lock().unwrap().len(), 2);
    }

    #[test]
    fn a_queen_is_no_longer_started_through_the_api() {
        let fx = fixture("api-queen");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(
            port,
            "POST",
            "/api/queens",
            token,
            r#"{"projectId":"pj-1","task":"Backend-API","spawnedBy":"wk-orch"}"#,
        );
        assert_eq!(status, 410, "{body}");
        assert!(
            body["error"]
                .as_str()
                .unwrap_or("")
                .contains("queen creation is retired"),
            "{body}"
        );

        let (status, _) = call(
            port,
            "POST",
            "/api/queens",
            token,
            r#"{"projectId":"pj-1","task":"Frontend","profileId":"kimi"}"#,
        );
        assert_eq!(status, 410);

        // The route is gone as a write target; missing fields are not a 400.
        for payload in [r#"{"task":"t"}"#, r#"{"projectId":"pj-1"}"#, "not json"] {
            let (status, reply) = call(port, "POST", "/api/queens", token, payload);
            assert_eq!(status, 410, "{payload}: {reply}");
        }

        let (status, _) = call(port, "GET", "/api/queens", token, "");
        assert_eq!(status, 405);
    }

    #[test]
    fn the_tree_nests_children_under_their_controllers() {
        let fx = fixture("api-tree");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/projects/pj-1/tree", token, "");
        assert_eq!(status, 200, "{body}");

        // The orchestrator is a root coordinator; the queen nests under it and
        // the two employees under the queen.
        let coordinators = body["coordinators"].as_array().expect("coordinators");
        assert_eq!(coordinators.len(), 1, "{body}");
        let orchestrator = &coordinators[0];
        assert_eq!(orchestrator["id"], "wk-orch");
        assert_eq!(orchestrator["kind"], KIND_ORCHESTRATOR);
        let queens = orchestrator["children"].as_array().expect("queens");
        assert_eq!(queens.len(), 1, "{body}");
        assert_eq!(queens[0]["id"], "wk-queen");
        assert_eq!(queens[0]["kind"], KIND_QUEEN);
        let employees = queens[0]["children"].as_array().expect("employees");
        assert_eq!(
            employees
                .iter()
                .map(|node| node["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["wk-e1", "wk-e2"]
        );

        // The user-started worker and the one whose controller is gone both
        // sit at the root: the tree never drops a worker.
        let workers = body["workers"].as_array().expect("workers");
        assert_eq!(
            workers
                .iter()
                .map(|node| node["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["wk-1", "wk-orphan"]
        );
        assert!(workers
            .iter()
            .all(|node| node["children"].as_array().expect("children").is_empty()));

        let (status, body) = call(port, "GET", "/api/projects/pj-other/tree", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["coordinators"].as_array().expect("empty").len(), 0);
        assert_eq!(body["workers"].as_array().expect("empty").len(), 0);

        let (status, _) = call(port, "POST", "/api/projects/pj-1/tree", token, "{}");
        assert_eq!(status, 405);
    }

    #[test]
    fn build_tree_shows_every_worker_exactly_once() {
        // A queen started by the user (no controller), her employee, and a
        // plain worker: two roots, one child.
        let queen = Worker {
            spawned_by: None,
            ..queen("wk-q")
        };
        let employee = Worker {
            spawned_by: Some("wk-q".to_string()),
            ..worker("wk-e")
        };
        let plain = worker("wk-w");

        let tree = build_tree(&[plain.clone(), queen.clone(), employee.clone()]);
        assert_eq!(tree.coordinators.len(), 1);
        assert_eq!(tree.coordinators[0].worker, queen);
        assert_eq!(
            tree.coordinators[0]
                .children
                .iter()
                .map(|node| node.worker.id.as_str())
                .collect::<Vec<_>>(),
            vec!["wk-e"]
        );
        assert_eq!(tree.workers.len(), 1);
        assert_eq!(tree.workers[0].worker, plain);

        assert_eq!(
            build_tree(&[]),
            ProjectTree {
                coordinators: Vec::new(),
                workers: Vec::new()
            }
        );
    }

    /// Every id the tree renders, roots first and each subtree depth first.
    /// A worker that appears twice - or not at all - shows up here.
    fn tree_ids(tree: &ProjectTree) -> Vec<&str> {
        fn walk<'a>(nodes: &'a [TreeNode], out: &mut Vec<&'a str>) {
            for node in nodes {
                out.push(node.worker.id.as_str());
                walk(&node.children, out);
            }
        }
        let mut out = Vec::new();
        walk(&tree.coordinators, &mut out);
        walk(&tree.workers, &mut out);
        out
    }

    /// A worker with a declared controller. `spawned_by` is whatever the
    /// caller said, so these tests may say anything, cycles included.
    fn spawned(id: &str, parent: &str) -> Worker {
        Worker {
            spawned_by: Some(parent.to_string()),
            ..worker(id)
        }
    }

    #[test]
    fn build_tree_makes_a_worker_that_named_itself_a_root() {
        // The shortest possible cycle: its own controller. It cannot nest
        // under itself, so it stands at the root - once, with no children.
        let selfie = spawned("wk-s", "wk-s");

        let tree = build_tree(std::slice::from_ref(&selfie));
        assert_eq!(tree_ids(&tree), vec!["wk-s"]);
        assert!(tree.coordinators.is_empty());
        assert_eq!(tree.workers[0].worker, selfie);
        assert!(tree.workers[0].children.is_empty());
    }

    #[test]
    fn build_tree_keeps_both_halves_of_a_two_worker_cycle() {
        // A and B name each other: neither is a root by the usual rule, and
        // before the cycle was handled both fell out of the tree entirely.
        let a = spawned("wk-a", "wk-b");
        let b = spawned("wk-b", "wk-a");

        let tree = build_tree(&[a.clone(), b.clone()]);
        assert_eq!(tree_ids(&tree), vec!["wk-a", "wk-b"]);
        assert!(tree.coordinators.is_empty());
        assert_eq!(tree.workers.len(), 1);
        assert_eq!(tree.workers[0].worker, a, "the smaller id becomes the root");
        assert_eq!(tree.workers[0].children.len(), 1);
        assert_eq!(tree.workers[0].children[0].worker, b);
        assert!(tree.workers[0].children[0].children.is_empty());
    }

    #[test]
    fn build_tree_keeps_a_three_worker_cycle_and_the_child_hanging_off_it() {
        // wk-a <- wk-c <- wk-b <- wk-a, and wk-d an ordinary employee of
        // wk-c. All four are rendered, each exactly once.
        let a = spawned("wk-a", "wk-b");
        let b = spawned("wk-b", "wk-c");
        let c = spawned("wk-c", "wk-a");
        let d = spawned("wk-d", "wk-c");

        let tree = build_tree(&[a.clone(), b, c.clone(), d]);
        let mut ids = tree_ids(&tree);
        assert_eq!(ids.len(), 4, "{ids:?}");
        ids.sort_unstable();
        assert_eq!(ids, vec!["wk-a", "wk-b", "wk-c", "wk-d"]);

        // The ring hangs off its root; the child sits where its own
        // `spawned_by` puts it, not at the root.
        assert_eq!(tree.workers.len(), 1);
        let root = &tree.workers[0];
        assert_eq!(root.worker, a);
        assert_eq!(root.children.len(), 1);
        let under_a = &root.children[0];
        assert_eq!(under_a.worker, c);
        assert_eq!(
            under_a
                .children
                .iter()
                .map(|node| node.worker.id.as_str())
                .collect::<Vec<_>>(),
            vec!["wk-b", "wk-d"]
        );
        assert!(under_a.children[0].children.is_empty());
        assert!(under_a.children[1].children.is_empty());
    }

    #[test]
    fn build_tree_leaves_the_healthy_hierarchy_alone_beside_a_cycle() {
        let queen = queen("wk-q");
        let employee = spawned("wk-e", "wk-q");
        let plain = worker("wk-w");
        let healthy = [queen.clone(), employee.clone(), plain.clone()];
        let a = spawned("wk-a", "wk-b");
        let b = spawned("wk-b", "wk-a");

        let alone = build_tree(&healthy);
        let beside = build_tree(&[queen, employee, plain, a.clone(), b]);

        // The queen's subtree and the plain worker are byte-for-byte what
        // they are without the cycle; the cycle only adds a root of its own.
        assert_eq!(beside.coordinators, alone.coordinators);
        assert_eq!(beside.workers[0], alone.workers[0]);
        assert_eq!(alone.workers.len(), 1);
        assert_eq!(beside.workers.len(), 2);
        assert_eq!(beside.workers[1].worker, a);
        assert_eq!(
            tree_ids(&beside),
            vec!["wk-q", "wk-e", "wk-w", "wk-a", "wk-b"]
        );
    }

    #[test]
    fn build_tree_picks_the_same_cycle_root_every_time() {
        let a = spawned("wk-a", "wk-b");
        let b = spawned("wk-b", "wk-a");

        // Same input twice: same tree, down to the order of the roots.
        assert_eq!(
            build_tree(&[a.clone(), b.clone()]),
            build_tree(&[a.clone(), b.clone()])
        );
        // And the order the rows arrive in does not decide the root either.
        assert_eq!(build_tree(&[b, a]).workers[0].worker.id, "wk-a");

        // `created_at` outranks the id: the worker that existed first is the
        // one the ring hangs from, whatever the ids sort like.
        let old = Worker {
            created_at: 1,
            ..spawned("wk-z", "wk-y")
        };
        let young = Worker {
            created_at: 99,
            ..spawned("wk-y", "wk-z")
        };
        for input in [[old.clone(), young.clone()], [young.clone(), old.clone()]] {
            let tree = build_tree(&input);
            assert_eq!(tree.workers.len(), 1);
            assert_eq!(tree.workers[0].worker, old);
            assert_eq!(tree_ids(&tree), vec!["wk-z", "wk-y"]);
        }
    }

    #[test]
    fn build_tree_files_a_promoted_cycle_root_under_its_kind() {
        // A queen and her employee name each other. Promoting the queen to a
        // root must still sort her into `coordinators` - a ring is no reason
        // for a coordinator to show up among the plain employees.
        let queen = Worker {
            created_at: 1,
            spawned_by: Some("wk-e".to_string()),
            ..queen("wk-q")
        };
        let employee = Worker {
            created_at: 2,
            ..spawned("wk-e", "wk-q")
        };

        let tree = build_tree(&[queen.clone(), employee.clone()]);
        assert_eq!(tree_ids(&tree), vec!["wk-q", "wk-e"]);
        assert!(tree.workers.is_empty(), "the queen is not a plain worker");
        assert_eq!(tree.coordinators.len(), 1);
        assert_eq!(tree.coordinators[0].worker, queen);
        assert_eq!(tree.coordinators[0].children.len(), 1);
        assert_eq!(tree.coordinators[0].children[0].worker, employee);
    }

    #[test]
    fn build_tree_gives_every_cycle_a_root_of_its_own() {
        // Two rings that do not touch. Walking the first one must not swallow
        // the second, and the second must not be left without a root.
        let a = spawned("wk-a", "wk-b");
        let b = spawned("wk-b", "wk-a");
        let c = spawned("wk-c", "wk-d");
        let d = spawned("wk-d", "wk-c");

        let tree = build_tree(&[b, d, a, c]);
        assert_eq!(tree_ids(&tree), vec!["wk-a", "wk-b", "wk-c", "wk-d"]);
        assert_eq!(
            tree.workers
                .iter()
                .map(|node| node.worker.id.as_str())
                .collect::<Vec<_>>(),
            vec!["wk-a", "wk-c"]
        );
    }

    #[test]
    fn build_tree_does_not_promote_an_older_descendant_of_a_three_worker_cycle() {
        // The descendant predates every ring member, but root selection is only
        // allowed to consider the ring itself. Otherwise it would be detached
        // from the controller named in `spawned_by`.
        let old_descendant = Worker {
            created_at: 0,
            ..spawned("wk-child", "wk-c")
        };
        let a = Worker {
            created_at: 10,
            ..spawned("wk-a", "wk-b")
        };
        let b = Worker {
            created_at: 20,
            ..spawned("wk-b", "wk-c")
        };
        let c = Worker {
            created_at: 30,
            ..spawned("wk-c", "wk-a")
        };

        for input in [
            [old_descendant.clone(), c.clone(), b.clone(), a.clone()],
            [b.clone(), a.clone(), old_descendant.clone(), c.clone()],
        ] {
            let tree = build_tree(&input);
            assert_eq!(tree.workers.len(), 1);
            assert_eq!(tree.workers[0].worker.id, "wk-a");
            let mut ids = tree_ids(&tree);
            ids.sort_unstable();
            assert_eq!(ids, vec!["wk-a", "wk-b", "wk-c", "wk-child"]);
            let under_c = &tree.workers[0].children[0].children;
            assert!(under_c.iter().any(|node| node.worker == old_descendant));
        }
    }

    #[test]
    fn build_tree_keeps_children_of_a_self_referencing_root() {
        // Treating the self-link as a root must not discard ordinary workers
        // that named that root as their controller.
        let selfie = spawned("wk-self", "wk-self");
        let child = spawned("wk-child", "wk-self");
        let grandchild = spawned("wk-grandchild", "wk-child");

        let tree = build_tree(&[grandchild.clone(), child.clone(), selfie.clone()]);
        assert_eq!(
            tree_ids(&tree),
            vec!["wk-self", "wk-child", "wk-grandchild"]
        );
        assert_eq!(tree.workers.len(), 1);
        assert_eq!(tree.workers[0].worker, selfie);
        assert_eq!(tree.workers[0].children[0].worker, child);
        assert_eq!(tree.workers[0].children[0].children[0].worker, grandchild);
    }

    #[test]
    fn recommendation_status_unknown_id_is_not_a_bad_request() {
        let fx = fixture("api-rec-status-unknown");
        let token = fx.token();
        let (status, body) = call(
            fx.server.port(),
            "POST",
            "/api/recommendations/rc-nope/status",
            Some(&token),
            r#"{"status":"dismissed"}"#,
        );
        assert_eq!(status, 404, "{body}");
        assert_eq!(
            fx.backend
                .recommendation_status_calls
                .load(std::sync::atomic::Ordering::SeqCst),
            1
        );
    }

    #[test]
    fn recommendation_status_store_failure_is_not_a_bad_request() {
        let fx = fixture("api-rec-status-store");
        let token = fx.token();
        let (status, body) = call(
            fx.server.port(),
            "POST",
            "/api/recommendations/rc-boom/status",
            Some(&token),
            r#"{"status":"dismissed"}"#,
        );
        assert_eq!(status, 500, "{body}");
        assert_eq!(
            fx.backend
                .recommendation_status_calls
                .load(std::sync::atomic::Ordering::SeqCst),
            1
        );
    }

    #[test]
    fn recommendation_status_invalid_input_never_calls_the_backend() {
        let fx = fixture("api-rec-status-invalid");
        let token = fx.token();
        for (request, expected_error) in [
            (
                r#"{"status":"maybe"}"#,
                "unknown recommendation status: maybe (expected accepted or dismissed)",
            ),
            ("{}", "status is required"),
            (r#"{"status":42}"#, "status is required"),
            (r#"{"status":null}"#, "status is required"),
        ] {
            let (status, body) = call(
                fx.server.port(),
                "POST",
                "/api/recommendations/rc-1/status",
                Some(&token),
                request,
            );
            assert_eq!(status, 400, "{request}: {body}");
            assert_eq!(body, json!({"error": expected_error}), "{request}");
            assert_eq!(
                fx.backend
                    .recommendation_status_calls
                    .load(std::sync::atomic::Ordering::SeqCst),
                0,
                "{request}"
            );
        }
        assert!(fx.backend.statuses.lock().unwrap().is_empty());
    }

    #[test]
    fn recommendation_status_both_valid_values_keep_the_success_contract() {
        let fx = fixture("api-rec-status-valid");
        let token = fx.token();
        for word in ["accepted", "dismissed"] {
            let request = json!({"status": word}).to_string();
            let (status, body) = call(
                fx.server.port(),
                "POST",
                "/api/recommendations/rc-1/status",
                Some(&token),
                &request,
            );
            assert_eq!(status, 200, "{body}");
            assert_eq!(body, json!({"ok": true}));
        }
        assert_eq!(
            fx.backend
                .recommendation_status_calls
                .load(std::sync::atomic::Ordering::SeqCst),
            2
        );
        assert_eq!(fx.backend.statuses.lock().unwrap().len(), 2);
    }

    #[test]
    fn recommendations_are_listed_added_accepted_and_dismissed() {
        let fx = fixture("api-recommendations");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/recommendations", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body[0]["id"], "rc-1");
        assert_eq!(body[0]["status"], "new");
        assert_eq!(body[0]["effort"], "M");

        let (_, body) = call(
            port,
            "GET",
            "/api/recommendations?projectId=pj-other",
            token,
            "",
        );
        assert_eq!(body.as_array().expect("array").len(), 0);

        let (status, body) = call(
            port,
            "POST",
            "/api/recommendations",
            token,
            r#"{"projectId":"pj-1","title":"notify","rationale":"Dateiwaechter","effort":"S"}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["id"], "rc-new");
        assert_eq!(body["title"], "notify");
        assert_eq!(body["url"], Value::Null);
        assert_eq!(body["effort"], "S");

        // title and rationale are the two the caller cannot leave out.
        for body in [
            r#"{"projectId":"pj-1","title":"t"}"#,
            r#"{"projectId":"pj-1","rationale":"r"}"#,
            r#"{"title":"t","rationale":"r"}"#,
        ] {
            let (status, reply) = call(port, "POST", "/api/recommendations", token, body);
            assert_eq!(status, 400, "{body}: {reply}");
        }

        let (status, body) = call(port, "POST", "/api/recommendations/rc-1/accept", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["id"], "tq-from-rc");
        assert_eq!(body["status"], "ready");

        let (status, body) = call(
            port,
            "POST",
            "/api/recommendations/rc-nope/accept",
            token,
            "",
        );
        assert_eq!(status, 404, "{body}");

        let (status, body) = call(
            port,
            "POST",
            "/api/recommendations/rc-1/status",
            token,
            r#"{"status":"dismissed"}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["ok"], true);
        assert_eq!(
            *fx.backend.statuses.lock().unwrap(),
            vec![("rc-1".to_string(), "dismissed".to_string())]
        );

        let (status, _) = call(
            port,
            "POST",
            "/api/recommendations/rc-1/status",
            token,
            r#"{"status":"maybe"}"#,
        );
        assert_eq!(status, 400);
        let (status, _) = call(
            port,
            "POST",
            "/api/recommendations/rc-1/status",
            token,
            "{}",
        );
        assert_eq!(status, 400);
        assert_eq!(fx.backend.statuses.lock().unwrap().len(), 1);
    }

    #[test]
    fn learnings_are_listed_filtered_approved_and_rejected() {
        let fx = fixture("api-learnings");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/learnings", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body.as_array().expect("array").len(), 2);
        assert_eq!(body[0]["id"], "lr-1");
        assert_eq!(body[0]["patternLabel"], "Gates");
        assert_eq!(body[0]["workerId"], "wk-1");

        // Both filters travel, alone and together.
        let (_, body) = call(port, "GET", "/api/learnings?status=pending", token, "");
        assert_eq!(body.as_array().expect("array").len(), 1);
        assert_eq!(body[0]["id"], "lr-1");
        let (_, body) = call(port, "GET", "/api/learnings?projectId=pj-other", token, "");
        assert_eq!(body.as_array().expect("array").len(), 0);
        let (_, body) = call(
            port,
            "GET",
            "/api/learnings?projectId=pj-1&status=approved",
            token,
            "",
        );
        assert_eq!(body[0]["id"], "lr-2");

        // The per-project route is the same list, scoped by the path.
        let (status, body) = call(port, "GET", "/api/projects/pj-1/learnings", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body.as_array().expect("array").len(), 2);
        let (_, body) = call(
            port,
            "GET",
            "/api/projects/pj-1/learnings?status=pending",
            token,
            "",
        );
        assert_eq!(body.as_array().expect("array").len(), 1);
        let (_, body) = call(port, "GET", "/api/projects/pj-other/learnings", token, "");
        assert_eq!(body.as_array().expect("array").len(), 0);

        // The verdict routes want the second token as well; the rest of this
        // test is about what happens once it is there.
        let stored_verdict = fx.verdict_token();
        let verdict = Some(stored_verdict.as_str());

        let (status, body) = call_with(
            port,
            "POST",
            "/api/learnings/lr-1/approve",
            token,
            verdict,
            r#"{"text":"Gates seriell"}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["ok"], true);
        assert_eq!(
            *fx.backend.approved.lock().unwrap(),
            vec![("lr-1".to_string(), "Gates seriell".to_string())]
        );

        // Missing, empty and blank text are all refused before the backend.
        for body in ["", "{}", r#"{"text":""}"#, r#"{"text":"   "}"#] {
            let (status, reply) = call_with(
                port,
                "POST",
                "/api/learnings/lr-1/approve",
                token,
                verdict,
                body,
            );
            assert_eq!(status, 400, "{body}: {reply}");
            assert!(
                reply["error"]
                    .as_str()
                    .is_some_and(|err| err.contains("text")),
                "{reply}"
            );
        }
        assert_eq!(fx.backend.approved.lock().unwrap().len(), 1);

        let (status, body) = call_with(
            port,
            "POST",
            "/api/learnings/lr-nope/approve",
            token,
            verdict,
            r#"{"text":"x"}"#,
        );
        assert_eq!(status, 400, "{body}");

        let (status, body) = call_with(
            port,
            "POST",
            "/api/learnings/lr-1/reject",
            token,
            verdict,
            "",
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["ok"], true);
        assert_eq!(
            *fx.backend.rejected.lock().unwrap(),
            vec!["lr-1".to_string()]
        );

        let (status, _) = call_with(
            port,
            "POST",
            "/api/learnings/lr-nope/reject",
            token,
            verdict,
            "",
        );
        assert_eq!(status, 400);

        // A collection reached with the wrong verb says so.
        let (status, _) = call(port, "POST", "/api/learnings", token, "{}");
        assert_eq!(status, 405);
    }

    /// The four routes an agent must not be able to reach with the token it
    /// can read out of `projecta-api.json`.
    const VERDICT_ROUTES: [(&str, &str); 4] = [
        ("/api/learnings/lr-1/approve", r#"{"text":"x"}"#),
        ("/api/learnings/lr-1/reject", ""),
        ("/api/roles/rv-1/approve", ""),
        ("/api/roles/rv-1/reject", ""),
    ];

    /// Setup trust is desktop-only: the API has no route that could mint a
    /// grant, not even for a caller holding BOTH tokens — the Tauri command
    /// `approve_setup_trust` has no HTTP counterpart at all.
    #[test]
    fn no_api_route_mints_setup_trust() {
        let fx = fixture("api-no-setup-trust");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let verdict = fx.verdict_token();
        let port = fx.server.port();
        for target in [
            "/api/setup-trust",
            "/api/workers/wk-1/setup-trust",
            "/api/workers/wk-1/setup-trust/approve",
            "/api/projects/pj-1/setup-trust",
        ] {
            let (status, body) =
                call_with(port, "POST", target, token, Some(verdict.as_str()), "{}");
            assert_eq!(status, 404, "{target}: {body}");
        }
    }

    #[test]
    fn a_verdict_needs_the_second_token_the_descriptor_does_not_carry() {
        let fx = fixture("api-verdict-token");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        // What an agent has: the descriptor. It holds the api token and
        // nothing else, so the verdict token cannot be read out of it.
        let raw = std::fs::read_to_string(fx.server.descriptor_path()).expect("read descriptor");
        let descriptor: Value = serde_json::from_str(&raw).expect("parse descriptor");
        assert!(descriptor.get("verdictToken").is_none(), "{descriptor}");
        let stored_verdict = fx.verdict_token();
        assert_eq!(stored_verdict.len(), 32, "{stored_verdict}");
        assert_ne!(stored_verdict, stored);
        assert!(!raw.contains(&stored_verdict), "{raw}");

        for (target, body) in VERDICT_ROUTES {
            // The api token alone is what every agent has, and it is not
            // enough for any of the four.
            let (status, reply) = call(port, "POST", target, token, body);
            assert_eq!(status, 403, "{target}: {reply}");
            assert!(
                reply["error"]
                    .as_str()
                    .is_some_and(|err| err.contains(VERDICT_TOKEN_HEADER)),
                "{target}: {reply}"
            );

            // A guessed one is no better than none.
            let (status, reply) =
                call_with(port, "POST", target, token, Some("not-the-token"), body);
            assert_eq!(status, 403, "{target}: {reply}");

            // And the api token still has to be right: a verdict token does
            // not stand in for it.
            let (status, reply) = call_with(
                port,
                "POST",
                target,
                Some("not-the-token"),
                Some(stored_verdict.as_str()),
                body,
            );
            assert_eq!(status, 401, "{target}: {reply}");

            // With both, the verdict goes through.
            let (status, reply) = call_with(
                port,
                "POST",
                target,
                token,
                Some(stored_verdict.as_str()),
                body,
            );
            assert_eq!(status, 200, "{target}: {reply}");
        }

        // Every route reached the backend exactly once - the refusals above
        // stopped before it.
        assert_eq!(fx.backend.approved.lock().unwrap().len(), 1);
        assert_eq!(fx.backend.rejected.lock().unwrap().len(), 1);
        assert_eq!(fx.backend.roles_approved.lock().unwrap().len(), 1);
        assert_eq!(fx.backend.roles_rejected.lock().unwrap().len(), 1);
    }

    // -- questions (Phase 21) ----------------------------------------------

    #[test]
    fn asking_a_question_reaches_the_core_and_comes_back_whole() {
        let fx = fixture("api-question-ask");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, reply) = call(
            port,
            "POST",
            "/api/questions",
            token,
            r#"{"projectId":"pj-1","workerId":"wk-1","question":"Postgres oder SQLite?","options":"Postgres,SQLite"}"#,
        );
        assert_eq!(status, 200, "{reply}");
        assert_eq!(reply["id"], "qs-new");
        assert_eq!(reply["scope"], "worker");
        assert_eq!(reply["optionsJson"], r#"["Postgres","SQLite"]"#);
        assert_eq!(reply["status"], "open");
        assert_eq!(
            *fx.backend.asked.lock().unwrap(),
            vec![(
                "pj-1".to_string(),
                Some("wk-1".to_string()),
                "Postgres oder SQLite?".to_string(),
                Some("Postgres,SQLite".to_string()),
            )]
        );

        // No worker is a preflight question, not a mistake.
        let (status, reply) = call(
            port,
            "POST",
            "/api/questions",
            token,
            r#"{"projectId":"pj-1","question":"Welche DB?"}"#,
        );
        assert_eq!(status, 200, "{reply}");
        assert_eq!(reply["workerId"], Value::Null);
        assert_eq!(fx.backend.asked.lock().unwrap().len(), 2);
    }

    #[test]
    fn a_question_route_says_whose_mistake_it_was() {
        let fx = fixture("api-question-status");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        // 400: the request itself is unusable.
        for body in [
            r#"{"workerId":"wk-1","question":"was?"}"#,
            r#"{"projectId":"pj-1"}"#,
            r#"{"projectId":"pj-1","question":"   "}"#,
        ] {
            let (status, reply) = call(port, "POST", "/api/questions", token, body);
            assert_eq!(status, 400, "{body}: {reply}");
        }

        // 404: an id that names nothing.
        let (status, reply) = call(
            port,
            "POST",
            "/api/questions",
            token,
            r#"{"projectId":"pj-nope","question":"was?"}"#,
        );
        assert_eq!(status, 404, "{reply}");

        // 409: everything exists, the combination does not.
        let (status, reply) = call(
            port,
            "POST",
            "/api/questions",
            token,
            r#"{"projectId":"pj-1","workerId":"wk-other","question":"was?"}"#,
        );
        assert_eq!(status, 409, "{reply}");

        assert!(
            fx.backend.asked.lock().unwrap().is_empty(),
            "not one of those reached the core"
        );
    }

    /// The decision the user took over Q1's open question: answering stays
    /// open to everybody, but "a person decided this" has to be earned.
    #[test]
    fn an_answer_is_evidence_of_a_person_only_when_it_carries_the_token() {
        let fx = fixture("api-question-answered-by");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let verdict = fx.verdict_token();
        let port = fx.server.port();

        // Without the header: accepted, and filed as what it is.
        let (status, reply) = call(
            port,
            "POST",
            "/api/questions/qs-1/answer",
            token,
            r#"{"answer":"SQLite"}"#,
        );
        assert_eq!(status, 200, "{reply}");
        assert_eq!(reply["answeredBy"], "unverified");

        // With it: the same answer, now on the record as a person's.
        let (status, reply) = call_with(
            port,
            "POST",
            "/api/questions/qs-2/answer",
            token,
            Some(verdict.as_str()),
            r#"{"answer":"SQLite"}"#,
        );
        assert_eq!(status, 200, "{reply}");
        assert_eq!(reply["answeredBy"], "human");

        // A token that is wrong is not the same as no token. Somebody sent it
        // to prove something, and filing that as "unverified" would swallow a
        // typo in the one place it matters.
        let (status, reply) = call_with(
            port,
            "POST",
            "/api/questions/qs-3/answer",
            token,
            Some("nicht-das-token"),
            r#"{"answer":"SQLite"}"#,
        );
        assert_eq!(status, 403, "{reply}");

        let answered = fx.backend.answered.lock().unwrap().clone();
        assert_eq!(
            answered,
            vec![
                (
                    "qs-1".to_string(),
                    "SQLite".to_string(),
                    crate::store::ANSWERED_BY_UNVERIFIED.to_string()
                ),
                (
                    "qs-2".to_string(),
                    "SQLite".to_string(),
                    crate::store::ANSWERED_BY_HUMAN.to_string()
                ),
            ],
            "the refused call must not have reached the core"
        );
    }

    #[test]
    fn answering_a_question_types_it_at_the_core() {
        let fx = fixture("api-question-answer");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, reply) = call(
            port,
            "POST",
            "/api/questions/qs-1/answer",
            token,
            r#"{"answer":"SQLite"}"#,
        );
        assert_eq!(status, 200, "{reply}");
        assert_eq!(reply["status"], "answered");
        assert_eq!(reply["answer"], "SQLite");
        // No verdict header on this call, so the row must not claim a person.
        assert_eq!(
            *fx.backend.answered.lock().unwrap(),
            vec![(
                "qs-1".to_string(),
                "SQLite".to_string(),
                crate::store::ANSWERED_BY_UNVERIFIED.to_string()
            )]
        );
        assert_eq!(reply["answeredBy"], "unverified");

        // An empty answer is a decision too - "go on" - so only the field has
        // to be there, exactly as on `worker send`.
        let (status, reply) = call(
            port,
            "POST",
            "/api/questions/qs-1/answer",
            token,
            r#"{"answer":""}"#,
        );
        assert_eq!(status, 200, "{reply}");

        let (status, reply) = call(port, "POST", "/api/questions/qs-1/answer", token, "{}");
        assert_eq!(status, 400, "{reply}");

        let (status, reply) = call(
            port,
            "POST",
            "/api/questions/qs-nope/answer",
            token,
            r#"{"answer":"x"}"#,
        );
        assert_eq!(status, 404, "{reply}");

        // Somebody already decided this one: too late, not wrong.
        let (status, reply) = call(
            port,
            "POST",
            "/api/questions/qs-done/answer",
            token,
            r#"{"answer":"x"}"#,
        );
        assert_eq!(status, 409, "{reply}");
    }

    #[test]
    fn listing_questions_filters_by_project_and_status() {
        let fx = fixture("api-question-list");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, reply) = call(port, "GET", "/api/questions", token, "");
        assert_eq!(status, 200, "{reply}");
        assert_eq!(reply.as_array().expect("a list").len(), 2);

        let (_, reply) = call(port, "GET", "/api/questions?status=open", token, "");
        let open = reply.as_array().expect("a list");
        assert_eq!(open.len(), 1);
        assert_eq!(open[0]["id"], "qs-1");

        let (_, reply) = call(port, "GET", "/api/questions?projectId=pj-2", token, "");
        assert!(reply.as_array().expect("a list").is_empty());
    }

    #[test]
    fn the_question_routes_refuse_the_wrong_verb() {
        let fx = fixture("api-question-verb");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, _) = call(port, "DELETE", "/api/questions", token, "");
        assert_eq!(status, 405);
        let (status, _) = call(port, "GET", "/api/questions/qs-1/answer", token, "");
        assert_eq!(status, 405);
    }

    #[test]
    fn two_servers_do_not_share_a_verdict_token() {
        let a = fixture("api-verdict-a");
        let b = fixture("api-verdict-b");
        assert_ne!(a.verdict_token(), b.verdict_token());
    }

    #[test]
    fn a_second_verdict_on_a_decided_row_is_a_conflict() {
        let fx = fixture("api-verdict-twice");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let stored_verdict = fx.verdict_token();
        let verdict = Some(stored_verdict.as_str());
        let port = fx.server.port();

        // lr-2 and rv-2 are the rows that already carry a verdict. The core
        // refuses them with the shared `refused: ` prefix, and that is a 409:
        // the request is well formed, it just arrives too late.
        for (target, body) in [
            ("/api/learnings/lr-2/approve", r#"{"text":"x"}"#),
            ("/api/learnings/lr-2/reject", ""),
            ("/api/roles/rv-2/approve", ""),
            ("/api/roles/rv-2/reject", ""),
        ] {
            let (status, reply) = call_with(port, "POST", target, token, verdict, body);
            assert_eq!(status, 409, "{target}: {reply}");
            assert!(
                reply["error"]
                    .as_str()
                    .is_some_and(|err| err.starts_with(crate::workers::ERR_REFUSED)),
                "{target}: {reply}"
            );
        }

        assert!(fx.backend.approved.lock().unwrap().is_empty());
        assert!(fx.backend.roles_approved.lock().unwrap().is_empty());
    }

    #[test]
    fn role_variants_are_listed_filtered_approved_and_rejected() {
        let fx = fixture("api-roles");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/roles", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body.as_array().expect("array").len(), 2);
        assert_eq!(body[0]["id"], "rv-1");
        // The camelCase contract, as the frontend reads it.
        assert_eq!(body[0]["baseProfileId"], "claude");
        assert_eq!(body[0]["patternLabel"], "tests-fixen");
        assert_eq!(body[0]["systemPromptAddition"], "Lauf die Gates seriell.");
        assert_eq!(body[0]["version"], 1);

        // Both filters travel, alone and together.
        let (_, body) = call(port, "GET", "/api/roles?status=pending", token, "");
        assert_eq!(body.as_array().expect("array").len(), 1);
        assert_eq!(body[0]["id"], "rv-1");
        let (_, body) = call(port, "GET", "/api/roles?projectId=pj-other", token, "");
        assert_eq!(body.as_array().expect("array").len(), 0);
        let (_, body) = call(
            port,
            "GET",
            "/api/roles?projectId=pj-1&status=approved",
            token,
            "",
        );
        assert_eq!(body[0]["id"], "rv-2");

        // The per-project route is the same list, scoped by the path.
        let (status, body) = call(port, "GET", "/api/projects/pj-1/roles", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body.as_array().expect("array").len(), 2);
        let (_, body) = call(
            port,
            "GET",
            "/api/projects/pj-1/roles?status=pending",
            token,
            "",
        );
        assert_eq!(body.as_array().expect("array").len(), 1);
        let (_, body) = call(port, "GET", "/api/projects/pj-other/roles", token, "");
        assert_eq!(body.as_array().expect("array").len(), 0);

        // Both verdicts take no body at all.
        let stored_verdict = fx.verdict_token();
        let verdict = Some(stored_verdict.as_str());

        let (status, body) = call_with(port, "POST", "/api/roles/rv-1/approve", token, verdict, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["ok"], true);
        assert_eq!(
            *fx.backend.roles_approved.lock().unwrap(),
            vec!["rv-1".to_string()]
        );

        let (status, body) = call_with(port, "POST", "/api/roles/rv-1/reject", token, verdict, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(
            *fx.backend.roles_rejected.lock().unwrap(),
            vec!["rv-1".to_string()]
        );

        let (status, _) = call_with(
            port,
            "POST",
            "/api/roles/rv-nope/approve",
            token,
            verdict,
            "",
        );
        assert_eq!(status, 400);
        let (status, _) = call_with(
            port,
            "POST",
            "/api/roles/rv-nope/reject",
            token,
            verdict,
            "",
        );
        assert_eq!(status, 400);

        // A collection reached with the wrong verb says so.
        let (status, _) = call(port, "POST", "/api/roles", token, "{}");
        assert_eq!(status, 405);
    }

    #[test]
    fn the_activity_feed_is_listed_filtered_and_capped() {
        let fx = fixture("api-activity");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/activity", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body.as_array().expect("array").len(), 2);
        // The camelCase contract, as the frontend reads it.
        assert_eq!(body[0]["id"], "ev-2");
        assert_eq!(body[0]["category"], "message");
        assert_eq!(body[0]["workerLabel"], "do the thing");
        assert_eq!(body[0]["createdAt"], 2);

        let (_, body) = call(port, "GET", "/api/activity?projectId=pj-2", token, "");
        assert_eq!(body.as_array().expect("array").len(), 1);
        assert_eq!(body[0]["id"], "ev-1");

        // The limit travels; an unreadable one is the default, not an error.
        let (_, body) = call(port, "GET", "/api/activity?limit=1", token, "");
        assert_eq!(body.as_array().expect("array").len(), 1);
        let (status, _) = call(port, "GET", "/api/activity?limit=nope", token, "");
        assert_eq!(status, 200);

        // A collection reached with the wrong verb says so.
        let (status, _) = call(port, "POST", "/api/activity", token, "{}");
        assert_eq!(status, 405);
    }

    #[test]
    fn unknown_routes_and_wrong_verbs_are_named() {
        let fx = fixture("api-routes");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        // A path nothing serves is a 404, and so is a path that only looks
        // like one of the known ones.
        for target in ["/nope", "/api/workers/wk-1/nope", "/api/projects/pj-1"] {
            let (status, body) = call(port, "GET", target, token, "");
            assert_eq!(status, 404, "{target}: {body}");
        }

        // Every shape `route` answers is in the 405 list, so a wrong verb is
        // never reported as a wrong path. `send` between `messages` and
        // `merge` is the one that used to be missing.
        for (method, target) in [
            ("DELETE", "/api/board"),
            ("POST", "/api/health"),
            ("POST", "/api/diagnosis"),
            ("DELETE", "/api/emergency-stop"),
            ("GET", "/api/workers/wk-1/send"),
            ("DELETE", "/api/workers/wk-1"),
            ("DELETE", "/api/workers/wk-1/messages"),
            ("GET", "/api/queue/tq-1/cancel"),
            ("GET", "/api/scout/triage"),
            ("GET", "/api/recommendations/rc-1/accept"),
            ("GET", "/api/recommendations/rc-1/status"),
            ("GET", "/api/learnings/lr-1/approve"),
            ("GET", "/api/learnings/lr-1/reject"),
            ("GET", "/api/roles/rv-1/approve"),
            ("GET", "/api/roles/rv-1/reject"),
        ] {
            let (status, body) = call(port, method, target, token, "");
            assert_eq!(status, 405, "{method} {target}: {body}");
        }
    }

    #[test]
    fn the_project_listing_carries_the_github_remote_flag() {
        let fx = fixture("api-projects");
        let stored = fx.token();
        let token = Some(stored.as_str());

        let (status, body) = call(fx.server.port(), "GET", "/api/projects", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body[0]["id"], "pj-1");
        assert_eq!(body[0]["name"], "ProjectA");
        assert_eq!(body[0]["repoPath"], "C:/repos/a");
        // Additive: the new field sits next to the ones that were always there.
        assert_eq!(body[0]["githubRemote"], true);

        let (status, _) = call(fx.server.port(), "PUT", "/api/projects", token, "");
        assert_eq!(status, 405);
    }

    #[test]
    fn a_project_is_created_through_the_api() {
        let fx = fixture("api-project-create");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let verdict = fx.verdict_token();
        let port = fx.server.port();
        let body = r#"{"name":"Golden","repoPath":"C:/scratch/golden"}"#;

        let (status, reply) = call(port, "POST", "/api/projects", token, body);
        assert_eq!(status, 403, "{reply}");
        assert!(
            reply["error"]
                .as_str()
                .is_some_and(|err| err.contains(VERDICT_TOKEN_HEADER)),
            "{reply}"
        );
        let (status, reply) = call_with(
            port,
            "POST",
            "/api/projects",
            token,
            Some("not-the-token"),
            body,
        );
        assert_eq!(status, 403, "{reply}");
        assert_eq!(reply["error"], "invalid verdict token");
        assert_eq!(fx.backend.created_projects.lock().unwrap().len(), 0);

        let (status, body) = call_with(
            port,
            "POST",
            "/api/projects",
            token,
            Some(verdict.as_str()),
            body,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["id"], "pj-new");
        assert_eq!(body["name"], "Golden");
        assert_eq!(body["repoPath"], "C:/scratch/golden");
        assert_eq!(body["githubRemote"], false);
        assert_eq!(
            *fx.backend.created_projects.lock().unwrap(),
            vec![("Golden".to_string(), "C:/scratch/golden".to_string())]
        );

        for payload in [
            "{}",
            r#"{"name":"Golden"}"#,
            r#"{"repoPath":"C:/scratch/golden"}"#,
            r#"{"name":"","repoPath":"C:/scratch/golden"}"#,
            r#"{"name":"   ","repoPath":"C:/scratch/golden"}"#,
            r#"{"name":"Golden","repo_path":"C:/scratch/golden"}"#,
            "not json",
        ] {
            let (status, reply) = call_with(
                port,
                "POST",
                "/api/projects",
                token,
                Some(verdict.as_str()),
                payload,
            );
            assert_eq!(status, 400, "{payload}: {reply}");
        }
        assert_eq!(fx.backend.created_projects.lock().unwrap().len(), 1);

        let (status, _) = call(port, "DELETE", "/api/projects", token, "");
        assert_eq!(status, 405);
    }

    #[test]
    fn isolated_app_data_may_create_a_project_without_a_verdict() {
        let fx = scratch_fixture("api-project-create-scratch");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let (status, body) = call(
            fx.server.port(),
            "POST",
            "/api/projects",
            token,
            r#"{"name":"Golden","repoPath":"C:/scratch/golden"}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["id"], "pj-new");
        assert_eq!(fx.backend.created_projects.lock().unwrap().len(), 1);
    }

    #[test]
    fn a_github_repository_is_created_through_the_api() {
        let fx = fixture("api-github-create");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(
            port,
            "POST",
            "/api/projects/pj-1/github/create",
            token,
            r#"{"name":"my-repo","private":false}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body, Value::String("https://github.com/o/r".to_string()));
        assert_eq!(
            *fx.backend.repos.lock().unwrap(),
            vec![("pj-1".to_string(), "my-repo".to_string(), false)]
        );

        // `private` defaults to true when it is omitted.
        let (status, _) = call(
            port,
            "POST",
            "/api/projects/pj-1/github/create",
            token,
            r#"{"name":"other"}"#,
        );
        assert_eq!(status, 200);
        assert!(fx.backend.repos.lock().unwrap()[1].2);

        // A repository needs a name.
        for body in ["{}", r#"{"private":true}"#, "not json"] {
            let (status, reply) = call(
                port,
                "POST",
                "/api/projects/pj-1/github/create",
                token,
                body,
            );
            assert_eq!(status, 400, "{body}: {reply}");
        }
        assert_eq!(fx.backend.repos.lock().unwrap().len(), 2);

        let (status, _) = call(
            port,
            "DELETE",
            "/api/projects/pj-1/github/create",
            token,
            "",
        );
        assert_eq!(status, 405);
    }

    #[test]
    fn a_github_remote_is_linked_through_the_api() {
        let fx = fixture("api-github-link");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(
            port,
            "POST",
            "/api/projects/pj-1/github/link",
            token,
            r#"{"url":"https://github.com/o/r.git"}"#,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["ok"], true);
        assert_eq!(
            *fx.backend.links.lock().unwrap(),
            vec![("pj-1".to_string(), "https://github.com/o/r.git".to_string())]
        );

        for body in ["{}", r#"{"name":"r"}"#] {
            let (status, reply) = call(port, "POST", "/api/projects/pj-1/github/link", token, body);
            assert_eq!(status, 400, "{body}: {reply}");
        }
        assert_eq!(fx.backend.links.lock().unwrap().len(), 1);

        let (status, _) = call(port, "DELETE", "/api/projects/pj-1/github/link", token, "");
        assert_eq!(status, 405);
    }

    /// The listing routes filter by project id, and a filter answers an id
    /// that names nothing with an empty collection - which reads like a
    /// project nobody has done any work in yet. Each one asks whether the
    /// project exists first, exactly as `/api/workers/<id>/messages` asks
    /// about its worker.
    #[test]
    fn a_listing_route_refuses_an_unknown_project() {
        let fx = fixture("api-list-unknown-project");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        for target in [
            "/api/workers?projectId=pj-nope",
            "/api/board?projectId=pj-nope",
            "/api/queue?projectId=pj-nope",
            "/api/recommendations?projectId=pj-nope",
            "/api/learnings?projectId=pj-nope",
            "/api/questions?projectId=pj-nope",
            "/api/roles?projectId=pj-nope",
            "/api/activity?projectId=pj-nope",
            "/api/projects/pj-nope/tree",
            "/api/projects/pj-nope/learnings",
            "/api/projects/pj-nope/roles",
        ] {
            let (status, body) = call(port, "GET", target, token, "");
            assert_eq!(status, 404, "{target}: {body}");
            assert_eq!(body["error"], "unknown project: pj-nope", "{target}");
        }

        // A project that exists and simply has nothing filed under it is an
        // ordinary empty answer - the case the 404 has to stay clear of.
        let (status, body) = call(port, "GET", "/api/workers?projectId=pj-other", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body.as_array().expect("a list").len(), 0);

        // No project named at all is the fleet-wide form, which asks nothing.
        let (status, body) = call(port, "GET", "/api/workers", token, "");
        assert_eq!(status, 200, "{body}");
        assert!(!body.as_array().expect("a list").is_empty());

        // A lookup that fails is the app's own problem, not a wrong id.
        let (status, body) = call(port, "GET", "/api/queue?projectId=pj-boom", token, "");
        assert_eq!(status, 500, "{body}");
    }

    /// Both routes used to answer 400 for every failure, including the ones the
    /// app itself is responsible for - the mirror image of the 500-for-all the
    /// creating routes had. They read the core's vocabulary now.
    ///
    /// The url stays a 400 from the route: it is the one part of the request
    /// this file can judge on its own, and it judges it before the core is
    /// asked, exactly as the digest date and the stats range are judged.
    #[test]
    fn linking_and_accepting_say_whose_fault_the_failure_was() {
        let fx = fixture("api-status-4xx");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        for (project, url, expected) in [
            ("pj-nope", "https://github.com/o/r.git", 404),
            ("pj-linked", "https://github.com/o/r.git", 409),
            ("pj-git", "https://github.com/o/r.git", 500),
            ("pj-1", "https://gitlab.com/o/r.git", 400),
            ("pj-1", "https://github.com/o/r.git", 200),
        ] {
            let (status, body) = call(
                port,
                "POST",
                &format!("/api/projects/{project}/github/link"),
                token,
                &format!(r#"{{"url":"{url}"}}"#),
            );
            assert_eq!(status, expected, "{project} {url}: {body}");
        }
        // Only the one that got through reached the backend.
        assert_eq!(fx.backend.links.lock().unwrap().len(), 1);

        // The repository name on the neighbouring create route is the same
        // kind of judgement, made in the same place and for the same reason.
        let (status, body) = call(
            port,
            "POST",
            "/api/projects/pj-1/github/create",
            token,
            r#"{"name":"not a name!"}"#,
        );
        assert_eq!(status, 400, "{body}");
        assert!(fx.backend.repos.lock().unwrap().is_empty());

        for (id, expected) in [
            ("rc-nope", 404),
            ("rc-done", 409),
            ("rc-boom", 500),
            ("rc-1", 200),
        ] {
            let (status, body) = call(
                port,
                "POST",
                &format!("/api/recommendations/{id}/accept"),
                token,
                "",
            );
            assert_eq!(status, expected, "{id}: {body}");
        }
    }

    /// The cancel route answered 400 for every failure too - the member of
    /// the class the rounds above could not reach, because telling a wrong id
    /// from a wrong moment had to happen in `store.rs` first (see the module
    /// head). It reads the core's vocabulary now, like `accept` above.
    #[test]
    fn cancelling_a_queued_task_says_whose_fault_the_failure_was() {
        let fx = fixture("api-queue-cancel");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        // The body carries the core's own sentence, so a caller that reads it
        // learns the same thing the status says.
        for (id, expected, says) in [
            ("tq-nope", 404, "unknown queued task: tq-nope"),
            ("tq-busy", 409, "refused: task tq-busy is dispatching"),
            ("tq-boom", 500, "failed to cancel queued task"),
            ("tq-1", 200, "\"ok\":true"),
        ] {
            let (status, body) = call(port, "POST", &format!("/api/queue/{id}/cancel"), token, "");
            assert_eq!(status, expected, "{id}: {body}");
            assert!(body.to_string().contains(says), "{id}: {body}");
        }
    }

    /// A server whose cancel route runs the real store rule over a real
    /// database, with the five dispatched tasks a PC can be left with.
    struct DispatchedRoute {
        server: ApiServer,
        store: crate::store::Store,
        /// Last, so the directory outlives the server and the pool on drop.
        _dir: TempDir,
    }

    impl DispatchedRoute {
        fn token(&self) -> String {
            let raw =
                std::fs::read_to_string(self.server.descriptor_path()).expect("read descriptor");
            let descriptor: Value = serde_json::from_str(&raw).expect("parse descriptor");
            descriptor["token"].as_str().expect("token").to_string()
        }

        /// The queue row's status, or `None` once it is gone.
        fn queue_status(&self, id: &str) -> Option<String> {
            tauri::async_runtime::block_on(self.store.list_queue(None))
                .unwrap()
                .into_iter()
                .find(|entry| entry.id == id)
                .map(|entry| entry.status)
        }
    }

    /// `tq-proven` ended and was seen to end. `tq-crashed` has a session the
    /// app never saw end, `tq-live` is bound to a running agent, `tq-bare`
    /// has no session row at all, `tq-running` is nothing but a worker row
    /// still marked running: four ways to be `dispatched` without proof.
    fn dispatched_route() -> DispatchedRoute {
        use crate::store::{WorkerRow, QUEUE_READY, STATUS_EXITED};
        let dir = TempDir::new("api-dispatched-cancel");
        let store = tauri::async_runtime::block_on(async {
            let store = crate::store::Store::open(&dir.path().join("projecta.db"))
                .await
                .unwrap();
            let project = store.create_project("one", "C:/repos/one").await.unwrap();
            for (tq, wk) in [
                ("tq-proven", "wk-proven"),
                ("tq-crashed", "wk-crashed"),
                ("tq-live", "wk-live"),
                ("tq-bare", "wk-bare"),
                ("tq-running", "wk-running"),
            ] {
                store
                    .insert_queue_entry(&QueueEntry {
                        id: tq.into(),
                        project_id: project.id.clone(),
                        raw_text: "do it".into(),
                        sharpened_text: None,
                        profile_id: "claude".into(),
                        status: QUEUE_READY.into(),
                        priority: 0,
                        worker_id: None,
                        error: None,
                        spawned_by: None,
                        created_at: 42,
                    })
                    .await
                    .unwrap();
                store
                    .insert_worker(&WorkerRow {
                        id: wk.into(),
                        project_id: project.id.clone(),
                        task: "do it".into(),
                        profile_id: "claude".into(),
                        branch: String::new(),
                        worktree_path: String::new(),
                        status: STATUS_RUNNING.into(),
                        kind: KIND_WORKER.into(),
                        pr_url: None,
                        spawned_by: None,
                        test_status: None,
                        tested_at: None,
                        role_variant_id: None,
                        paused_reason: None,
                        created_at: 1,
                    })
                    .await
                    .unwrap();
                assert!(store.claim_queue_entry(tq).await.unwrap());
                store.mark_queue_dispatched(tq, wk, 8).await.unwrap();
            }
            store.bind_session("wk-proven", "s-proven").await;
            store
                .mark_session_exited("s-proven", Some(0))
                .await
                .unwrap();
            store.bind_session("wk-crashed", "s-crashed").await;
            store.take_session("wk-crashed");
            store
                .set_worker_status("wk-crashed", STATUS_EXITED)
                .await
                .unwrap();
            store.bind_session("wk-live", "s-live").await;
            store
                .set_worker_status("wk-bare", STATUS_EXITED)
                .await
                .unwrap();
            store
        });
        let backend = FakeBackend {
            queue_store: Some(store.clone()),
            ..Default::default()
        };
        let server = boot(Arc::new(backend), &dir.path().join("api"), false).unwrap();
        DispatchedRoute {
            server,
            store,
            _dir: dir,
        }
    }

    /// W1-05b, api half: the cancel route hands a `dispatched` task to the
    /// store's rule and says what the rule said. A proven process end is a
    /// plain 200; everything else is a 409 that names what is missing and
    /// leaves the row exactly where it was - a task must never vanish from
    /// the queue while an agent behind it may still be alive.
    #[test]
    fn a_dispatched_task_is_cancelled_over_http_only_on_a_proven_process_end() {
        let route = dispatched_route();
        let stored = route.token();
        let token = Some(stored.as_str());
        let port = route.server.port();
        let cancel = |id: &str| call(port, "POST", &format!("/api/queue/{id}/cancel"), token, "");

        for (id, why) in [
            ("tq-live", "worker wk-live still has a live session"),
            (
                "tq-crashed",
                "1 session(s) of worker wk-crashed never reported an exit",
            ),
            ("tq-bare", "worker wk-bare has no recorded session"),
            ("tq-running", "worker wk-running is still running"),
        ] {
            let (status, body) = cancel(id);
            assert_eq!(status, 409, "{id}: {body}");
            let error = body["error"].as_str().unwrap_or_default();
            assert!(error.starts_with("refused: "), "{id}: {body}");
            assert!(error.contains(why), "{id}: {body}");
            assert!(error.contains("process end is proven"), "{id}: {body}");
            assert_eq!(
                route.queue_status(id).as_deref(),
                Some("dispatched"),
                "{id} must stay dispatched after a refusal"
            );
        }

        let (status, body) = cancel("tq-proven");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["ok"], true, "{body}");
        assert_eq!(route.queue_status("tq-proven"), None);
        // Only that row went: the refused ones are untouched by the success.
        for id in ["tq-live", "tq-crashed", "tq-bare", "tq-running"] {
            assert_eq!(
                route.queue_status(id).as_deref(),
                Some("dispatched"),
                "{id} must survive the cancel of tq-proven"
            );
        }

        // Cancelling again is not a refusal but an id that names nothing.
        let (status, body) = cancel("tq-proven");
        assert_eq!(status, 404, "{body}");
        assert!(
            body["error"]
                .as_str()
                .unwrap_or_default()
                .starts_with("unknown queued task: tq-proven"),
            "{body}"
        );
    }

    #[test]
    fn a_landing_page_round_trips_through_the_api() {
        let fx = fixture("api-landing-page");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        // Nothing written yet: the field is null, not missing.
        let (status, body) = call(port, "GET", "/api/projects/pj-1/landing-page", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["markdown"], Value::Null);

        // Storing keeps the content verbatim, newline and all.
        let markdown = "# One\n\nSome *content*.\n";
        let payload = serde_json::json!({ "markdown": markdown }).to_string();
        let (status, body) = call(
            port,
            "POST",
            "/api/projects/pj-1/landing-page",
            token,
            &payload,
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["ok"], true);
        assert_eq!(
            fx.backend
                .landings
                .lock()
                .unwrap()
                .get("pj-1")
                .cloned()
                .flatten(),
            Some(markdown.to_string())
        );

        let (status, body) = call(port, "GET", "/api/projects/pj-1/landing-page", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["markdown"], markdown);

        // Null clears; an unknown project is a 404 on both verbs.
        for (method, target, payload) in [
            ("GET", "/api/projects/pj-nope/landing-page", ""),
            (
                "POST",
                "/api/projects/pj-nope/landing-page",
                r#"{"markdown":"x"}"#,
            ),
        ] {
            let (status, reply) = call(port, method, target, token, payload);
            assert_eq!(status, 404, "{reply}");
            assert!(reply["error"].as_str().unwrap().contains("unknown project"));
        }

        let (status, _) = call(
            port,
            "POST",
            "/api/projects/pj-1/landing-page",
            token,
            "null",
        );
        assert_eq!(status, 200);
        let (status, reply) = call(
            port,
            "POST",
            "/api/projects/pj-1/landing-page",
            token,
            "not json",
        );
        assert_eq!(status, 400, "{reply}");

        let (status, _) = call(port, "DELETE", "/api/projects/pj-1/landing-page", token, "");
        assert_eq!(status, 405);
    }

    #[test]
    fn the_request_line_is_split_into_path_query_and_headers() {
        let head = "get /api/workers?projectId=pj%2D1&flag HTTP/1.1\r\n\
                    Host: 127.0.0.1\r\nX-ProjectA-Token: abc";
        let request = parse_request(head, "{}".to_string()).expect("parse");

        assert_eq!(request.method, "GET");
        assert_eq!(request.path, "/api/workers");
        assert_eq!(request.query["projectId"], "pj-1");
        assert_eq!(request.query["flag"], "");
        assert_eq!(request.headers[TOKEN_HEADER], "abc");
        assert_eq!(request.segments(), vec!["api", "workers"]);
    }

    #[test]
    fn percent_escapes_survive_the_path() {
        assert_eq!(percent_decode("wk%2D1"), "wk-1");
        assert_eq!(percent_decode("a+b"), "a+b");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    /// The escapes the old byte-indexed `&str` slice panicked on. Every one of
    /// them reaches `percent_decode` through `parse_request`, which runs before
    /// the token is looked at.
    #[test]
    fn a_broken_escape_is_passed_through_instead_of_panicking() {
        // Three and four byte characters straight after the `%`: the old
        // `raw[i + 1..i + 3]` cut them in half.
        assert_eq!(percent_decode("%\u{20ac}"), "%\u{20ac}");
        assert_eq!(percent_decode("a=%\u{20ac}&b=1"), "a=%\u{20ac}&b=1");
        assert_eq!(percent_decode("%\u{1f980}"), "%\u{1f980}");
        // Two bytes was always short enough to survive; it still does.
        assert_eq!(percent_decode("%\u{e4}"), "%\u{e4}");
        // The replacement character `String::from_utf8_lossy` leaves where the
        // request head carried an invalid byte is three bytes wide - the same
        // trap, reachable by sending any byte that is not UTF-8.
        let lossy = String::from_utf8_lossy(&[b'%', 0xff]).into_owned();
        assert_eq!(lossy, "%\u{fffd}");
        assert_eq!(percent_decode(&lossy), lossy);
        // Escapes running off the end of the input.
        assert_eq!(percent_decode("wk-1%"), "wk-1%");
        assert_eq!(percent_decode("wk-1%2"), "wk-1%2");
        // A sign is not a hex digit, whatever `u8::from_str_radix` thought.
        assert_eq!(percent_decode("%+f"), "%+f");
        // A broken escape does not stop the ones behind it from decoding.
        assert_eq!(percent_decode("%\u{20ac}%2D"), "%\u{20ac}-");
    }

    /// The panic was reachable over the socket, unauthenticated: no token, and
    /// the connection still has to answer rather than die mid-request.
    #[test]
    fn a_multibyte_escape_in_the_query_does_not_kill_the_connection() {
        let fx = fixture("api-percent-panic");
        let stored = fx.token();
        let port = fx.server.port();

        let (status, _) = call(port, "GET", "/api/health?a=%\u{20ac}", None, "");
        assert_eq!(status, 401, "the query is decoded before the token is read");

        let (status, body) = call(port, "GET", "/api/health?a=%\u{20ac}", Some(&stored), "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["ok"], true);
    }

    #[test]
    fn the_token_is_thirty_two_random_hex_characters() {
        // 128 bits, lower case hex, never twice the same. What a test cannot
        // see is *where* the bits came from - see the note on `new_token`.
        let mut seen = std::collections::HashSet::new();
        for _ in 0..256 {
            let token = new_token().expect("draw a token");
            assert_eq!(token.len(), 32, "{token}");
            assert!(
                token
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f')),
                "{token}"
            );
            assert!(seen.insert(token.clone()), "{token} came up twice");
        }
    }

    /// A `send` at an id with no session is something the caller can act on,
    /// so it must not arrive as the app's own failure.
    #[test]
    fn a_send_that_finds_no_agent_is_not_a_server_error() {
        let fx = fixture("api-send-no-agent");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(
            port,
            "POST",
            "/api/workers/wk-tippfehler/send",
            token,
            r#"{"text":"hallo"}"#,
        );
        assert_eq!(status, 409, "{body}");
        // The text is the core's, unchanged; only the status is new.
        assert_eq!(body["error"], "worker wk-tippfehler has no running agent");
        assert!(fx.backend.sent.lock().unwrap().is_empty());

        // And the status line has to name it, or the client reads "500".
        assert_eq!(Response::error(409, "x").reason(), "Conflict");
    }

    #[test]
    fn a_refused_merge_says_whose_turn_it_is() {
        let fx = fixture("api-merge-refused");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let stored_verdict = fx.verdict_token();
        let verdict = Some(stored_verdict.as_str());
        let port = fx.server.port();

        for (worker_id, expected) in [
            ("wk-nope", 404),
            ("wk-busy", 409),
            ("wk-red", 409),
            ("wk-live", 409),
            // Git failing mid-merge is not the caller's doing.
            ("wk-git", 500),
        ] {
            let target = format!("/api/workers/{worker_id}/merge");
            let (status, body) = call_with(port, "POST", &target, token, verdict, "");
            assert_eq!(status, expected, "{worker_id}: {body}");
            assert!(body["error"].is_string(), "{worker_id}: {body}");
        }
        assert!(fx.backend.merged.lock().unwrap().is_empty());
    }

    #[test]
    fn merge_status_separates_the_gate_from_the_app() {
        assert_eq!(error_status(MERGE_UNKNOWN, StatusPolicy::Merge), 404);
        assert_eq!(error_status(MERGE_WRONG_COLUMN, StatusPolicy::Merge), 409);
        assert_eq!(error_status(MERGE_TEST_GATE, StatusPolicy::Merge), 409);
        assert_eq!(
            error_status("merge blocked (blocked); dirty: x", StatusPolicy::Merge),
            409
        );
        assert_eq!(error_status(MERGE_GIT_FAILED, StatusPolicy::Merge), 500);
        assert_eq!(error_status("database is locked", StatusPolicy::Merge), 500);
        // A worker whose project has gone missing is an inconsistency in the
        // store, not a wrong id from the caller - which is why `unknown
        // project` is a 404 on the landing-page routes, where the caller named
        // the project, and a 500 here, where the worker did.
        assert_eq!(
            error_status("unknown project: pj-1", StatusPolicy::Merge),
            500
        );
    }

    /// Every route that creates something starts by looking up the project,
    /// and until this test all three outcomes of that lookup left as a 500 - so
    /// `pa` told a script to retry a project id that will never exist.
    #[test]
    fn the_creating_routes_pass_the_cores_verdict_through() {
        let fx = fixture("api-core-verdict");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        // `{}` stands in for the project id, so one table covers the routes
        // whose id sits in the path as well as those that carry it in a body.
        // `/api/queens` is 410 for every payload (Rev 9) and never reaches the core.
        let routes: &[(&str, &str, &str)] = &[
            (
                "/api/workers",
                r#"{"projectId":"{}","task":"Board bauen"}"#,
                "",
            ),
            (
                "/api/queue",
                r#"{"projectId":"{}","rawText":"Board bauen"}"#,
                "",
            ),
            ("/api/scout", r#"{"projectId":"{}"}"#, ""),
            (
                "/api/scout/triage",
                r#"{"projectId":"{}","urls":["https://example.invalid/repo"]}"#,
                "",
            ),
            (
                "/api/recommendations",
                r#"{"projectId":"{}","title":"ratatui","rationale":"Board im Terminal"}"#,
                "",
            ),
            (
                "/api/projects/{}/orchestrator/send",
                r#"{"text":"hallo"}"#,
                "path",
            ),
            (
                "/api/projects/{}/github/create",
                r#"{"name":"my-repo"}"#,
                "path",
            ),
        ];

        for (route, body, id_in) in routes {
            for (project_id, expected) in [("pj-nope", 404), ("pj-aus", 409), ("pj-git", 500)] {
                let (target, body) = if *id_in == "path" {
                    (route.replace("{}", project_id), body.to_string())
                } else {
                    (route.to_string(), body.replace("{}", project_id))
                };
                let (status, reply) = call(port, "POST", &target, token, &body);
                assert_eq!(status, expected, "{target} {project_id}: {reply}");
                // The core's sentence is passed through untouched; only the
                // status in front of it is new.
                assert!(reply["error"].is_string(), "{target}: {reply}");
            }
        }

        // Nothing was created along the way - a refused route must not leave a
        // row behind, or the status would be the only honest part of the reply.
        assert!(fx.backend.created.lock().unwrap().is_empty());
        assert!(fx.backend.scouted.lock().unwrap().is_empty());
        assert!(fx.backend.told.lock().unwrap().is_empty());
        assert!(fx.backend.repos.lock().unwrap().is_empty());
    }

    #[test]
    fn core_status_reads_the_opening_and_nothing_else() {
        assert_eq!(
            error_status("unknown project: pj-1", StatusPolicy::Core),
            404
        );
        assert_eq!(
            error_status("unknown agent profile: kimi", StatusPolicy::Core),
            404
        );
        assert_eq!(
            error_status(
                "refused: profile 'kimi' is switched off",
                StatusPolicy::Core
            ),
            409
        );
        assert_eq!(
            error_status(
                "failed to add the worktree: git exited 128",
                StatusPolicy::Core
            ),
            500
        );
        // W1-05b: a dispatched task without a proven process end is a refusal,
        // a pinned delete that matched nothing is the store's own failure.
        assert_eq!(
            error_status(
                "refused: task tq-1 is dispatched and worker wk-1 is still running; it can be \
                 cancelled only once its process end is proven",
                StatusPolicy::Core
            ),
            409
        );
        assert_eq!(
            error_status(
                "failed to cancel dispatched task tq-1: the pinned delete matched 0 rows",
                StatusPolicy::Core
            ),
            500
        );
        // The prefix has to open the message. A sentence that merely mentions
        // it somewhere is the app talking about itself, not about the caller.
        assert_eq!(
            error_status("the store is unknown territory", StatusPolicy::Core),
            500
        );
        assert_eq!(
            error_status("git refused: nothing to commit", StatusPolicy::Core),
            500
        );
        // Both constants are what `crate::workers` mints, not a copy of them.
        assert_eq!(
            error_status(
                &format!("{}worker: wk-1", crate::workers::ERR_UNKNOWN),
                StatusPolicy::Core
            ),
            404
        );
        assert_eq!(
            error_status(
                &format!("{}the gate is red", crate::workers::ERR_REFUSED),
                StatusPolicy::Core
            ),
            409
        );
    }

    /// One row per message shape, one column per route family: (text, merge,
    /// verdict, core). The three families disagree on purpose - an `unknown
    /// project` is the caller's typo on a core route, a store inconsistency on
    /// the merge route, and one more unusable input on a verdict route.
    #[test]
    fn error_status_pins_every_pattern_per_policy() {
        let table: &[(&str, u16, u16, u16)] = &[
            ("unknown worker: wk-1", 404, 400, 404),
            ("unknown project: pj-1", 500, 400, 404),
            ("unknown agent profile: kimi", 500, 400, 404),
            ("refused: profile 'kimi' is switched off", 500, 409, 409),
            ("refused: worker wk-1 sits in 'working'", 409, 409, 409),
            ("wk-1 sits in 'working', not 'ready'", 409, 400, 500),
            ("the test gate for wk-1 is 'fail'", 409, 400, 500),
            ("wk-1 still has a running agent", 409, 400, 500),
            ("merge blocked (blocked); dirty: x", 409, 400, 500),
            ("git merge failed: unrelated histories", 500, 400, 500),
            ("note: unknown worker wk-1, see log", 500, 400, 500),
            ("recheck the test gate for wk-1", 500, 400, 500),
            ("the store is unknown territory", 500, 400, 500),
            ("git refused: nothing to commit", 500, 400, 500),
            ("database is locked", 500, 400, 500),
            ("", 500, 400, 500),
        ];
        for (text, merge, verdict, core) in table {
            let got = [
                StatusPolicy::Merge,
                StatusPolicy::Verdict,
                StatusPolicy::Core,
            ]
            .map(|policy| error_status(text, policy));
            assert_eq!(got, [*merge, *verdict, *core], "{text}");
        }
    }

    /// Every development-plan reason keeps the status it had before the plan
    /// routes moved into the shared classifier.
    #[test]
    fn error_status_plan_policy_pins_every_development_plan_reason() {
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
            ("projectId is required", 400),
            ("planId is required", 400),
            ("revision must be a positive integer", 400),
            ("expectedProjectionRevision must be non-negative", 400),
            ("database unavailable", 500),
            ("unknown worker: wk-1", 500),
            ("refused: profile 'kimi' is switched off", 500),
            ("", 500),
        ] {
            assert_eq!(error_status(reason, StatusPolicy::Plan), status, "{reason}");
        }
    }

    #[test]
    fn messages_for_an_unknown_worker_are_a_404_not_an_empty_list() {
        let fx = fixture("api-messages-unknown");
        let stored = fx.token();
        let token = Some(stored.as_str());
        let port = fx.server.port();

        let (status, body) = call(port, "GET", "/api/workers/wk-1/messages?limit=2", token, "");
        assert_eq!(status, 200, "{body}");
        assert_eq!(body.as_array().expect("array").len(), 2);

        // A typo used to read as "this worker has not said anything yet".
        let (status, body) = call(
            port,
            "GET",
            "/api/workers/wk-tippfehler/messages",
            token,
            "",
        );
        assert_eq!(status, 404, "{body}");
        assert_eq!(body["error"], "unknown worker: wk-tippfehler");
    }

    fn scan_fixture(label: &str) -> TempDir {
        let dir = TempDir::new(label);
        crate::testutil::init_repo(dir.path());
        std::fs::create_dir_all(dir.path().join("scripts/ci")).unwrap();
        std::fs::write(dir.path().join("scripts/ci/gates.sh"), "#!/bin/sh\n").unwrap();
        std::fs::write(dir.path().join(".mergify.yml"), "queue_rules: []\n").unwrap();
        std::fs::write(
            dir.path().join("AGENTS.md"),
            "6. **Seams only serially:** `src/api.rs`, `src/main.rs`.\n",
        )
        .unwrap();
        dir
    }

    #[test]
    fn scan_setup_repo_returns_the_main_branch_and_gate_flags_as_json() {
        let dir = scan_fixture("scan-setup-ok");
        let scan = scan_setup_repo_at(dir.path().to_str().unwrap()).expect("scan");
        let json = serde_json::to_value(&scan).unwrap();
        assert_eq!(json["mainBranch"], "main");
        assert_eq!(json["hasGatesSh"], true);
        assert_eq!(json["hasMergify"], true);
        assert_eq!(json["hasAgentsMd"], true);
        assert_eq!(json["seamFiles"], json!(["src/api.rs", "src/main.rs"]));
        let mut keys: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "freeRamBytes",
                "hasAgentsMd",
                "hasGatesSh",
                "hasMergify",
                "mainBranch",
                "seamFiles"
            ]
        );
    }

    #[test]
    fn scan_setup_repo_rejects_files_missing_relative_and_empty_paths() {
        let dir = scan_fixture("scan-setup-bad");
        let file = dir.path().join("AGENTS.md");
        let missing = dir.path().join("nope");
        let relative = Path::new("scan-setup-relative");
        for bad in [
            file.as_path(),
            missing.as_path(),
            relative,
            Path::new(""),
            Path::new("  "),
        ] {
            let err = scan_setup_repo_at(bad.to_str().unwrap()).expect_err("must refuse");
            assert!(!err.contains(dir.path().to_str().unwrap()), "{err}");
        }
    }

    #[test]
    fn scan_setup_repo_judges_the_canonical_path_so_dotdot_cannot_escape() {
        let dir = scan_fixture("scan-setup-dotdot");
        let plain = dir.path().join("plain");
        std::fs::create_dir_all(dir.path().join("sub")).unwrap();
        std::fs::create_dir_all(&plain).unwrap();
        let root = dir.path().to_str().unwrap();
        // A subfolder is not a repository root, and `..` out of the repository
        // lands in a folder the app does not know.
        let sub = format!("{root}/sub");
        let escape = format!("{root}/sub/../plain");
        for bad in [&sub, &escape] {
            let err = scan_setup_repo_at(bad).expect_err("must refuse");
            assert!(!err.contains(root), "{err}");
        }
        // `..` that comes back to the root is the root.
        assert!(scan_setup_repo_at(&format!("{root}/sub/..")).is_ok());
    }

    /// Replace `rel` of the fixture by a link to `target`.
    #[cfg(unix)]
    fn relink(root: &Path, rel: &str, target: &Path) {
        let link = root.join(rel);
        if link.is_dir() {
            std::fs::remove_dir_all(&link).unwrap();
        } else {
            std::fs::remove_file(&link).unwrap();
        }
        std::os::unix::fs::symlink(target, &link).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn scan_setup_repo_does_not_follow_links_out_of_the_root() {
        let outside = scan_fixture("scan-setup-outside");
        let out = outside.path();
        // The bait must be there, or "not present" would prove nothing.
        assert!(std::fs::read_to_string(out.join("AGENTS.md"))
            .unwrap()
            .contains("src/api.rs"));
        assert!(out.join(".mergify.yml").is_file());
        assert!(out.join("scripts/ci/gates.sh").is_file());
        for rel in ["AGENTS.md", ".mergify.yml", "scripts"] {
            let dir = scan_fixture("scan-setup-link");
            relink(dir.path(), rel, &out.join(rel));
            let scan = scan_setup_repo_at(dir.path().to_str().unwrap()).expect(rel);
            let seen = match rel {
                "AGENTS.md" => scan.has_agents_md || !scan.seam_files.is_empty(),
                ".mergify.yml" => scan.has_mergify,
                _ => scan.has_gates_sh,
            };
            assert!(!seen, "{rel} outside the root must count as not present");
        }
    }

    #[cfg(unix)]
    #[test]
    fn scan_setup_repo_refuses_a_dot_git_link_that_points_outside_the_root() {
        let outside = scan_fixture("scan-setup-outside-git");
        let dir = scan_fixture("scan-setup-link-git");
        // The outside `.git` is a real repository, so only containment refuses.
        assert!(outside.path().join(".git").is_dir());
        crate::worktree::ensure_git_repo(outside.path().to_str().unwrap()).expect("bait is a repo");
        relink(dir.path(), ".git", &outside.path().join(".git"));
        let err = scan_setup_repo_at(dir.path().to_str().unwrap()).expect_err("must refuse");
        assert!(!err.contains(outside.path().to_str().unwrap()), "{err}");
    }

    // Windows strips a trailing blank from a folder name.
    #[cfg(unix)]
    #[test]
    fn scan_setup_repo_scans_the_path_as_given_not_trimmed() {
        let dir = TempDir::new("scan-setup-space");
        // Legal on Unix: a folder name that ends in a blank.
        let repo = crate::testutil::init_repo(&dir.path().join("repo "));
        let given = format!("{}", repo.display());
        assert!(given.ends_with(' '));
        scan_setup_repo_at(&given).expect("the folder with the blank is the one picked");
        assert!(scan_setup_repo_at(&format!("  {given}")).is_err());
    }

    #[test]
    fn scan_within_gives_up_on_a_scan_that_outlives_its_limit() {
        use std::time::Duration;
        let slow = || {
            std::thread::sleep(Duration::from_millis(600));
            Ok(1)
        };
        let err = tauri::async_runtime::block_on(scan_within(Duration::from_millis(50), slow))
            .expect_err("must time out");
        assert_eq!(err, "the repository scan took too long");
        let quick = tauri::async_runtime::block_on(scan_within(Duration::from_secs(5), || Ok(7)));
        assert_eq!(quick, Ok(7));
    }
