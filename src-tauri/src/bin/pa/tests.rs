    use std::collections::BTreeSet;

    use super::*;

    fn parse(line: &str) -> Result<Command, String> {
        let args: Vec<String> = line.split_whitespace().map(str::to_string).collect();
        parse_args(&args)
    }

    #[test]
    fn no_arguments_ask_for_help() {
        assert_eq!(parse_args(&[]), Ok(Command::Help));
        assert_eq!(parse("help"), Ok(Command::Help));
        assert_eq!(parse("--help"), Ok(Command::Help));
        assert_eq!(parse("-h"), Ok(Command::Help));
    }
    #[test]
    fn hq_plan_commands_require_valid_ids_and_revisions() {
        assert!(parse("hq plan --project pj-1 --plan main").is_ok());
        assert!(parse("hq plan --project pj-1 --plan main --revision 2").is_ok());
        assert!(parse("hq plan-import --project pj-1 --plan main --expected-revision 0 --rollback-reason rollback").is_ok());
        assert!(parse_hq(&["plan", "--project", " ", "--plan", "main"]).is_err());
        assert!(parse_hq(&[
            "plan-import",
            "--project",
            "pj-1",
            "--plan",
            " ",
            "--expected-revision",
            "0"
        ])
        .is_err());
        for line in [
            "hq plan --project pj-1",
            "hq plan --project pj-1 --plan main --revision 0",
            "hq plan --project pj-1 --plan main --revision 9223372036854775808",
            "hq plan --project pj-1 --plan main --revision 2 --revision 3",
            "hq plan --project pj-1 --plan main --source file.md",
            "hq plan-import --project pj-1 --plan main",
            "hq plan-import --project pj-1 --plan main --expected-revision -1",
            "hq plan-import --project pj-1 --plan main --expected-revision 9223372036854775807",
            "hq plan-import --project pj-1 --plan main --expected-revision 0 --source file.md",
        ] {
            assert!(parse(line).is_err(), "{line}");
        }
    }

    #[test]
    fn hq_parser_preserves_source_goal_and_refuses_unknown_settings() {
        assert_eq!(
            parse("hq tasks assignment ct-1"),
            Ok(Command::HqTaskAssignment {
                task_id: "ct-1".into(),
                body: None
            })
        );
        assert_eq!(parse("hq tasks assign ct-1 --team development --role reviewer --assignee alice --expected-revision 3"),Ok(Command::HqTaskAssignment{task_id:"ct-1".into(),body:Some(json!({"teamId":"development","role":"reviewer","assignee":"alice","expectedRevision":3}))}));
        for input in ["hq tasks assignment ct-1 --role reviewer","hq tasks assign ct-1 --team development","hq tasks assign ct-1 --team development --role reviewer --assignee alice --expected-revision -1","hq tasks assign ct-1 --team development --role reviewer --assignee alice --expected-revision 9223372036854775807"] {
            assert!(parse(input).is_err(),"{input}");
        }
        for runtime in [
            json!({}),
            json!({"capabilities":{"journalChangesWait":{"supported":false,"maxWaitMs":25000}}}),
            json!({"capabilities":{"journalChangesWait":{"supported":true,"maxWaitMs":100}}}),
        ] {
            assert!(require_journal_wait(&runtime, 25000).is_err());
        }
        assert!(require_journal_wait(
            &json!({"capabilities":{"journalChangesWait":{"supported":true,"maxWaitMs":25000}}}),
            25000
        )
        .is_ok());
        assert!(matches!(
            parse("hq changes --project pj-1 --wait-ms 25000").unwrap(),
            Command::HqContext {
                wait_ms: Some(25000),
                ..
            }
        ));
        for line in [
            "hq context --project pj-1 --wait-ms 1",
            "hq changes --project pj-1 --wait-ms -1",
            "hq changes --project pj-1 --wait-ms 25001",
            "hq changes --project pj-1 --wait-ms 18446744073709551616",
        ] {
            assert!(parse(line).is_err(), "{line}");
        }
        assert!(matches!(
            parse("hq changes --project pj-1 --cursor 200").unwrap(),
            Command::HqContext {
                changes_only: true,
                cursor: Some(200),
                ..
            }
        ));
        assert!(matches!(
            parse("hq context --project pj-1").unwrap(),
            Command::HqContext {
                changes_only: false,
                ..
            }
        ));
        assert!(parse("hq changes --project pj-1 --cursor -1").is_err());
        assert!(parse("hq changes --project pj-1 --cursor 9223372036854775808").is_err());
        assert!(parse("hq changes").is_err());
        assert!(
            matches!(parse("hq agent list-evidence").unwrap(), Command::HqAgent { operation, input: None } if operation == "records/evidence/start")
        );
        assert!(
            matches!(parse("hq agent list-reviews --cursor abc_123").unwrap(), Command::HqAgent { operation, input: None } if operation == "records/reviews/abc_123")
        );
        assert!(parse("hq agent list-evidence --cursor ../foreign").is_err());
        assert!(parse("hq agent list-evidence --run foreign").is_err());
        assert!(matches!(
            parse("hq agent context").unwrap(),
            Command::HqAgent { input: None, .. }
        ));
        assert!(matches!(
            parse("hq agent evidence --input evidence.json").unwrap(),
            Command::HqAgent { input: Some(_), .. }
        ));
        assert!(parse("hq agent context --project foreign").is_err());
        assert!(parse("hq agent evidence --run foreign --input evidence.json").is_err());
        assert!(parse("hq agent evidence").is_err());
        assert!(
            matches!(parse("hq agent checkpoint --input checkpoint.json").unwrap(), Command::HqAgent { operation, input: Some(_) } if operation == "checkpoint")
        );
        assert!(parse("hq agent checkpoint --input cp.json --run foreign").is_err());
        assert!(parse("hq agent checkpoint").is_err());
        assert!(
            matches!(parse("hq agent read-checkpoint --revision 2").unwrap(), Command::HqAgent { operation, input: None } if operation == "checkpoint/2")
        );
        assert!(parse("hq agent read-checkpoint --revision 0").is_err());
        assert!(matches!(parse("hq runtime").unwrap(), Command::HqRuntime));
        assert!(
            matches!(parse("hq agent lessons").unwrap(), Command::HqAgent { operation, input: None } if operation == "lessons")
        );
        assert!(
            matches!(parse("hq agent release").unwrap(), Command::HqAgent { operation, input: None } if operation == "release")
        );
        assert!(
            matches!(parse("hq runs --project pj-1").unwrap(), Command::HqRuns { project_id } if project_id == "pj-1")
        );
        assert!(parse("hq runs").is_err());
        assert!(
            matches!(parse("hq goals create --project pj-1 --objective bounded --source-goal cg-1 --admit").unwrap(), Command::HqGoalCreate { source_goal_id: Some(id), admit: true, .. } if id == "cg-1")
        );
        assert!(parse("hq runtime --force").is_err());
        assert!(parse("hq context --project pj-1 --cursor nonsense").is_err());
        assert!(parse("hq goals create --project pj-1 --objective bounded --paid true").is_err());
    }

    #[test]
    fn hq_agent_review_accepts_only_scoped_input() {
        assert!(USAGE.contains("pa hq agent candidate|evidence|review --input <json-file>"));
        assert!(matches!(
            parse("hq agent review --input review.json").unwrap(),
            Command::HqAgent { operation, input: Some(file) }
                if operation == "review" && file == "review.json"
        ));
        assert!(parse("hq agent review").is_err());
        assert!(parse("hq agent review --run foreign --input review.json").is_err());
    }

    #[test]
    fn merge_takes_a_worker_id_and_an_optional_switch() {
        assert_eq!(
            parse("worker merge wk-1"),
            Ok(Command::WorkerMerge {
                worker_id: "wk-1".to_string(),
                remove_worktree: false,
                verdict_token: None,
            })
        );
        assert_eq!(
            parse("worker merge wk-1 --remove-worktree"),
            Ok(Command::WorkerMerge {
                worker_id: "wk-1".to_string(),
                remove_worktree: true,
                verdict_token: None,
            })
        );
        // The switch may come first; it is peeled off wherever it stands.
        assert_eq!(
            parse("worker merge --remove-worktree wk-1"),
            Ok(Command::WorkerMerge {
                worker_id: "wk-1".to_string(),
                remove_worktree: true,
                verdict_token: None,
            })
        );

        // A missing id, or a second one, is an error with the usage line in it.
        for line in [
            "worker merge",
            "worker merge --remove-worktree",
            "worker merge wk-1 wk-2",
        ] {
            let err = parse(line).expect_err(line);
            assert!(err.contains("usage: pa worker merge"), "{line}: {err}");
        }

        assert_eq!(
            parse("worker merge wk-1 --verdict-token vt-1"),
            Ok(Command::WorkerMerge {
                worker_id: "wk-1".to_string(),
                remove_worktree: false,
                verdict_token: Some("vt-1".to_string()),
            })
        );
        assert_eq!(
            parse("worker merge --verdict-token vt-1 wk-1 --remove-worktree"),
            Ok(Command::WorkerMerge {
                worker_id: "wk-1".to_string(),
                remove_worktree: true,
                verdict_token: Some("vt-1".to_string()),
            })
        );
    }

    #[test]
    fn spawn_needs_a_project_and_a_task() {
        assert_eq!(
            parse("worker spawn --project pj-1 --task fix-it --profile kimi"),
            Ok(Command::WorkerSpawn {
                project_id: "pj-1".to_string(),
                task: "fix-it".to_string(),
                profile_id: Some("kimi".to_string()),
                spawned_by: None,
            })
        );

        // The profile is optional; the app picks the default.
        assert_eq!(
            parse("worker spawn --project pj-1 --task fix-it"),
            Ok(Command::WorkerSpawn {
                project_id: "pj-1".to_string(),
                task: "fix-it".to_string(),
                profile_id: None,
                spawned_by: None,
            })
        );

        assert_eq!(
            parse("worker spawn --task fix-it"),
            Err("--project is required".to_string())
        );
        assert_eq!(
            parse("worker spawn --project pj-1"),
            Err("--task is required".to_string())
        );
    }

    #[test]
    fn flags_take_a_value_in_either_form() {
        let joined = parse("worker spawn --project=pj-1 --task=fix-it");
        assert_eq!(
            joined,
            Ok(Command::WorkerSpawn {
                project_id: "pj-1".to_string(),
                task: "fix-it".to_string(),
                profile_id: None,
                spawned_by: None,
            })
        );

        assert_eq!(
            parse("worker spawn --project"),
            Err("--project needs a value".to_string())
        );
        assert_eq!(
            parse("worker spawn --nope x"),
            Err("unknown option: --nope".to_string())
        );
        assert_eq!(
            parse("worker list pj-1"),
            Err("unexpected argument: pj-1".to_string())
        );
    }

    #[test]
    fn a_flag_where_a_value_belongs_is_refused() {
        // Without this the typo becomes the project id: the request goes out,
        // finds nothing, prints "no workers" and exits 0.
        assert_eq!(
            parse("worker list --project --typo"),
            Err("--project needs a value, got the flag --typo; \
                 write --project=--typo if that is the value"
                .to_string())
        );

        // Every parser that collects flags for `parse_flags` inherits it.
        for line in [
            "worker spawn --project --task fix-it",
            "queue add --project --task fix-it",
            "tell --project --typo weiter",
            "scout triage --project --typo https://github.com/a/b",
            "github link --project --typo https://github.com/o/r",
            "learnings approve lr-1 --text --typo",
            "activity --limit --typo",
        ] {
            let err = parse(line).expect_err(line);
            assert!(err.contains("needs a value, got the flag"), "{line}: {err}");
        }

        // The `=` form is the escape hatch and stays one: a value that starts
        // with two dashes is deliberate there.
        assert_eq!(
            parse("worker list --project=--typo"),
            Ok(Command::WorkerList {
                project_id: Some("--typo".to_string())
            })
        );
    }

    #[test]
    fn the_same_option_twice_is_refused() {
        // Silently sending the first of the two is the opposite of what the
        // second one asked for.
        assert_eq!(
            parse("worker list --project pj-alt --project pj-neu"),
            Err("--project given twice".to_string())
        );
        // Mixing the two forms is the same mistake.
        assert_eq!(
            parse("worker spawn --project=pj-alt --project pj-neu --task fix-it"),
            Err("--project given twice".to_string())
        );
        assert_eq!(
            parse("queue add --project pj-1 --task fix-it --priority 1 --priority 2"),
            Err("--priority given twice".to_string())
        );
        assert_eq!(
            parse("learnings list --status pending --status approved"),
            Err("--status given twice".to_string())
        );
    }

    #[test]
    fn listing_and_the_board_filter_by_project() {
        assert_eq!(
            parse("worker list"),
            Ok(Command::WorkerList { project_id: None })
        );
        assert_eq!(
            parse("worker list --project pj-1"),
            Ok(Command::WorkerList {
                project_id: Some("pj-1".to_string())
            })
        );
        assert_eq!(parse("board"), Ok(Command::Board { project_id: None }));
        assert_eq!(parse("diagnosis"), Ok(Command::Diagnosis));
        assert_eq!(
            parse("diagnosis extra"),
            Err("diagnosis takes no arguments, got extra".to_string())
        );
        assert_eq!(
            parse("board --project pj-1"),
            Ok(Command::Board {
                project_id: Some("pj-1".to_string())
            })
        );
        assert_eq!(
            parse("estop"),
            Ok(Command::EmergencyStop {
                action: StopAction::Status,
                verdict_token: None,
            })
        );
        assert_eq!(
            parse("estop on"),
            Ok(Command::EmergencyStop {
                action: StopAction::On,
                verdict_token: None,
            })
        );
        assert_eq!(
            parse("estop off"),
            Ok(Command::EmergencyStop {
                action: StopAction::Off,
                verdict_token: None,
            })
        );
        assert_eq!(
            parse("estop off --verdict-token vt-1"),
            Ok(Command::EmergencyStop {
                action: StopAction::Off,
                verdict_token: Some("vt-1".to_string()),
            })
        );
        assert!(parse("estop on --verdict-token vt-1").is_err());
        assert_eq!(
            parse("estop maybe"),
            Err("estop takes on, off or status, got maybe".to_string())
        );
        assert!(render_emergency_stop(&json!({"active": true}))
            .unwrap()
            .contains("ACTIVE"));
        assert!(render_emergency_stop(&json!({"active": false}))
            .unwrap()
            .contains("off"));
        assert!(render_emergency_stop(&json!({})).is_err());
        assert!(render_emergency_stop(&json!({"active": "no"})).is_err());
        assert_eq!(parse("quota"), Ok(Command::Quota));
        assert_eq!(parse("quota list"), Ok(Command::Quota));
        assert_eq!(
            parse("quota --project pj-1"),
            Err("quota takes no arguments, got --project".to_string())
        );
        assert_eq!(
            parse("quota list extra"),
            Err("quota takes no arguments, got extra".to_string())
        );
    }

    #[test]
    fn usage_takes_an_optional_limit() {
        assert_eq!(parse("usage"), Ok(Command::Usage { limit: None }));
        assert_eq!(
            parse("usage --limit 5"),
            Ok(Command::Usage { limit: Some(5) })
        );
        assert_eq!(
            parse("usage --limit lots"),
            Err("--limit must be a positive integer".to_string())
        );
        assert!(USAGE.contains("pa usage [--limit <n>]"), "{USAGE}");
    }

    #[test]
    fn a_usage_report_prints_its_gaps_rather_than_filling_them() {
        let report = json!({
            "online": true,
            "authorized": true,
            "events": [{
                "id": "ue-1",
                "ts": 1_787_910_158_i64,
                "profileId": null,
                "model": "gpt-5.6-sol",
                "provider": "codex",
                "tokensIn": 19,
                "tokensOut": 5,
                "costUsd": null,
                "rawJson": "line"
            }],
            "today": { "requests": 1, "tokensIn": 19, "tokensOut": 5, "costUsd": 0.0, "priced": 0 },
            "total": { "requests": 2, "tokensIn": 119, "tokensOut": 15, "costUsd": 0.0, "priced": 0 },
            "reportedCostUsd": 42.123456,
            "history": {}
        });
        let out = render_usage_report(&report);
        assert!(
            out.contains("omniroute  online, management api open"),
            "{out}"
        );
        assert!(out.contains("2026-08-28 09:42"), "{out}");
        assert!(out.contains("gpt-5.6-sol"), "{out}");
        assert!(out.contains("19 in"), "{out}");
        // The two honest gaps.
        assert!(
            out.contains("no priced rows"),
            "an unpriced ledger must not read as a free one: {out}"
        );
        assert!(
            out.trim_end().ends_with('\u{2014}'),
            "the profile is unknown: {out}"
        );
        assert!(out.contains("42.1235 USD lifetime"), "{out}");
    }

    #[test]
    fn a_closed_management_api_says_why_the_ledger_is_empty() {
        let report = json!({
            "online": true,
            "authorized": false,
            "events": [],
            "today": { "requests": 0, "tokensIn": 0, "tokensOut": 0, "costUsd": 0.0, "priced": 0 },
            "total": { "requests": 0, "tokensIn": 0, "tokensOut": 0, "costUsd": 0.0, "priced": 0 },
            "reportedCostUsd": null,
            "history": null
        });
        let out = render_usage_report(&report);
        assert!(out.contains("management api closed"), "{out}");
        assert!(out.contains("no management token"), "{out}");
        assert!(out.contains("no usage events stored yet"), "{out}");
        assert!(
            !out.contains("lifetime"),
            "there is no figure to report: {out}"
        );
    }

    #[test]
    fn utc_minutes_are_formatted_like_the_digests_name_their_days() {
        assert_eq!(iso_minute(0), "1970-01-01 00:00");
        assert_eq!(iso_minute(1_787_910_158), "2026-08-28 09:42");
        assert_eq!(iso_minute(86_399), "1970-01-01 23:59");
    }

    #[test]
    fn status_and_send_take_a_worker_id() {
        assert_eq!(
            parse("worker status wk-1"),
            Ok(Command::WorkerStatus {
                worker_id: "wk-1".to_string()
            })
        );
        assert!(parse("worker status").is_err());
        assert!(parse("worker status wk-1 wk-2").is_err());

        // Everything after the id is the text, rejoined with single spaces.
        assert_eq!(
            parse("worker send wk-1 ja weiter"),
            Ok(Command::WorkerSend {
                worker_id: "wk-1".to_string(),
                text: "ja weiter".to_string(),
            })
        );
        assert_eq!(
            parse_args(&[
                "worker".to_string(),
                "send".to_string(),
                "wk-1".to_string(),
                String::new(),
            ]),
            Ok(Command::WorkerSend {
                worker_id: "wk-1".to_string(),
                text: String::new(),
            })
        );
        assert!(parse("worker send wk-1").is_err());
    }

    #[test]
    fn tell_takes_a_project_and_a_sentence() {
        assert_eq!(
            parse("tell --project pj-1 bau mir das Login"),
            Ok(Command::Tell {
                project_id: "pj-1".to_string(),
                text: "bau mir das Login".to_string(),
            })
        );

        // The text may come before the flag, and `--project=` works too.
        assert_eq!(
            parse("tell weiter --project=pj-1"),
            Ok(Command::Tell {
                project_id: "pj-1".to_string(),
                text: "weiter".to_string(),
            })
        );

        assert_eq!(
            parse("tell --project pj-1"),
            Err("usage: pa tell --project <projectId> <text>".to_string())
        );
        assert_eq!(
            parse("tell weiter"),
            Err("--project is required".to_string())
        );
        assert_eq!(
            parse("tell --nope x weiter"),
            Err("unknown option: --nope".to_string())
        );
    }

    #[test]
    fn triage_takes_a_project_and_a_list_of_urls() {
        assert_eq!(
            parse("scout triage --project pj-1 https://github.com/a/b https://github.com/c/d"),
            Ok(Command::ScoutTriage {
                project_id: "pj-1".to_string(),
                urls: vec![
                    "https://github.com/a/b".to_string(),
                    "https://github.com/c/d".to_string(),
                ],
            })
        );

        // The urls may come before the flag, and `--project=` works too.
        assert_eq!(
            parse("scout triage https://github.com/a/b --project=pj-1"),
            Ok(Command::ScoutTriage {
                project_id: "pj-1".to_string(),
                urls: vec!["https://github.com/a/b".to_string()],
            })
        );

        assert_eq!(
            parse("scout triage --project pj-1"),
            Err("usage: pa scout triage --project <projectId> <url>...".to_string())
        );
        assert_eq!(
            parse("scout triage https://github.com/a/b"),
            Err("--project is required".to_string())
        );
        assert_eq!(
            parse("scout triage --project"),
            Err("--project needs a value".to_string())
        );
        assert_eq!(
            parse("scout triage --nope x https://github.com/a/b"),
            Err("unknown option: --nope".to_string())
        );
        assert!(parse("scout").unwrap_err().contains("subcommand"));
        assert!(parse("scout nope x")
            .unwrap_err()
            .contains("unknown scout subcommand: nope"));
    }

    #[test]
    fn recommendations_list_filters_by_project() {
        assert_eq!(
            parse("recommendations list"),
            Ok(Command::RecommendationsList { project_id: None })
        );
        assert_eq!(
            parse("recommendations list --project pj-1"),
            Ok(Command::RecommendationsList {
                project_id: Some("pj-1".to_string())
            })
        );
        assert!(parse("recommendations").unwrap_err().contains("subcommand"));
        assert!(parse("recommendations nope")
            .unwrap_err()
            .contains("unknown recommendations subcommand: nope"));
    }

    #[test]
    fn recommendations_are_accepted_and_dismissed_by_id() {
        assert_eq!(
            parse("recommendations accept rc-1"),
            Ok(Command::RecommendationsAccept {
                id: "rc-1".to_string()
            })
        );
        assert_eq!(
            parse("recommendations dismiss rc-1"),
            Ok(Command::RecommendationsDismiss {
                id: "rc-1".to_string()
            })
        );

        // Exactly one id, like `queue cancel`: none and two are both refusals.
        assert_eq!(
            parse("recommendations accept"),
            Err("usage: pa recommendations accept <recommendationId>".to_string())
        );
        assert_eq!(
            parse("recommendations accept rc-1 rc-2"),
            Err("usage: pa recommendations accept <recommendationId>".to_string())
        );
        assert_eq!(
            parse("recommendations dismiss"),
            Err("usage: pa recommendations dismiss <recommendationId>".to_string())
        );
        assert_eq!(
            parse("recommendations dismiss rc-1 rc-2"),
            Err("usage: pa recommendations dismiss <recommendationId>".to_string())
        );
    }

    #[test]
    fn queue_add_can_be_booked_under_the_worker_that_ordered_it() {
        assert_eq!(
            parse("queue add --project pj-1 --task fix-it --on-behalf-of wk-queen"),
            Ok(Command::QueueAdd {
                project_id: "pj-1".to_string(),
                task: "fix-it".to_string(),
                profile_id: None,
                sharpen: false,
                priority: None,
                spawned_by: Some("wk-queen".to_string()),
            })
        );
        // Nobody named means nobody booked: the field stays away entirely.
        assert_eq!(
            parse("queue add --project pj-1 --task fix-it --profile kimi --sharpen"),
            Ok(Command::QueueAdd {
                project_id: "pj-1".to_string(),
                task: "fix-it".to_string(),
                profile_id: Some("kimi".to_string()),
                sharpen: true,
                priority: None,
                spawned_by: None,
            })
        );
        assert_eq!(
            parse("queue add --project pj-1 --task fix-it --on-behalf-of"),
            Err("--on-behalf-of needs a value".to_string())
        );
    }

    #[test]
    fn learnings_list_takes_both_filters() {
        assert_eq!(
            parse("learnings list"),
            Ok(Command::LearningsList {
                project_id: None,
                status: None
            })
        );
        assert_eq!(
            parse("learnings list --project pj-1 --status pending"),
            Ok(Command::LearningsList {
                project_id: Some("pj-1".to_string()),
                status: Some("pending".to_string()),
            })
        );
        assert!(parse("learnings").unwrap_err().contains("subcommand"));
        assert!(parse("learnings nope")
            .unwrap_err()
            .contains("unknown learnings subcommand: nope"));
        assert!(parse("learnings list --nope x")
            .unwrap_err()
            .contains("unknown option"));
    }

    #[test]
    fn learnings_are_approved_with_or_without_text_and_rejected_by_id() {
        assert_eq!(
            parse("learnings approve lr-1"),
            Ok(Command::LearningsApprove {
                id: "lr-1".to_string(),
                text: None,
                verdict_token: None,
            })
        );
        // The text is one argument, spaces and all - `parse` here splits on
        // whitespace, so a multi word value is built the way a shell hands it
        // over rather than typed into the line.
        let args: Vec<String> = ["learnings", "approve", "lr-1", "--text", "so ist es besser"]
            .iter()
            .map(|arg| (*arg).to_string())
            .collect();
        assert_eq!(
            parse_args(&args),
            Ok(Command::LearningsApprove {
                id: "lr-1".to_string(),
                text: Some("so ist es besser".to_string()),
                verdict_token: None,
            })
        );
        assert_eq!(
            parse("learnings reject lr-1"),
            Ok(Command::LearningsReject {
                id: "lr-1".to_string(),
                verdict_token: None,
            })
        );

        assert_eq!(
            parse("learnings approve"),
            Err(LEARNINGS_APPROVE_USAGE.to_string())
        );
        assert_eq!(
            parse("learnings approve --text x"),
            Err(LEARNINGS_APPROVE_USAGE.to_string())
        );
        assert_eq!(
            parse("learnings reject"),
            Err(LEARNINGS_REJECT_USAGE.to_string())
        );
        assert_eq!(
            parse("learnings reject lr-1 lr-2"),
            Err(LEARNINGS_REJECT_USAGE.to_string())
        );
    }

    #[test]
    fn every_verdict_takes_the_verdict_token_on_the_line() {
        assert_eq!(
            parse("learnings approve lr-1 --verdict-token vt-1"),
            Ok(Command::LearningsApprove {
                id: "lr-1".to_string(),
                text: None,
                verdict_token: Some("vt-1".to_string()),
            })
        );
        // Beside --text, in either order.
        assert_eq!(
            parse("learnings approve lr-1 --verdict-token vt-1 --text kurz"),
            Ok(Command::LearningsApprove {
                id: "lr-1".to_string(),
                text: Some("kurz".to_string()),
                verdict_token: Some("vt-1".to_string()),
            })
        );
        assert_eq!(
            parse("learnings reject lr-1 --verdict-token=vt-1"),
            Ok(Command::LearningsReject {
                id: "lr-1".to_string(),
                verdict_token: Some("vt-1".to_string()),
            })
        );
        assert_eq!(
            parse("roles approve rv-1 --verdict-token vt-1"),
            Ok(Command::RolesApprove {
                id: "rv-1".to_string(),
                verdict_token: Some("vt-1".to_string()),
            })
        );
        assert_eq!(
            parse("roles reject rv-1 --verdict-token vt-1"),
            Ok(Command::RolesReject {
                id: "rv-1".to_string(),
                verdict_token: Some("vt-1".to_string()),
            })
        );
        assert_eq!(
            parse("worker merge wk-1 --verdict-token vt-1"),
            Ok(Command::WorkerMerge {
                worker_id: "wk-1".to_string(),
                remove_worktree: false,
                verdict_token: Some("vt-1".to_string()),
            })
        );

        // The generic parser's rules hold here too: a value is required, the
        // flag may not be doubled, and it is a verdict flag only.
        assert!(parse("roles approve rv-1 --verdict-token")
            .unwrap_err()
            .contains("--verdict-token needs a value"));
        assert!(
            parse("roles approve rv-1 --verdict-token a --verdict-token b")
                .unwrap_err()
                .contains("--verdict-token given twice")
        );
        assert!(parse("roles list --verdict-token vt-1")
            .unwrap_err()
            .contains("unknown option"));
    }

    /// Answer one request with `{"ok": true}` and hand the raw request back.
    ///
    /// The header assembly is the part of `pa` nothing else can see: the
    /// parser tests stop at the `Command`, and the api tests start at a
    /// request that already exists. This is the seam between them.
    fn capture(request: impl FnOnce(Api) + Send + 'static) -> String {
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let client = std::thread::spawn(move || {
            request(Api {
                port,
                token: "api-token".to_string(),
            })
        });

        let (mut stream, _) = listener.accept().expect("accept");
        let mut raw = Vec::new();
        let mut buffer = [0u8; 1024];
        loop {
            let read = stream.read(&mut buffer).expect("read");
            if read == 0 {
                break;
            }
            raw.extend_from_slice(&buffer[..read]);
            // Wait for the declared body too; waiting for a close would deadlock.
            if let Some(head_end) = raw.windows(4).position(|window| window == b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&raw[..head_end]);
                let length = head
                    .lines()
                    .find_map(|line| line.strip_prefix("Content-Length: ")?.parse::<usize>().ok())
                    .expect("content length");
                if raw.len() >= head_end + 4 + length {
                    break;
                }
            }
        }
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 13\r\n\
                  Connection: close\r\n\r\n{\"ok\": true}\n",
            )
            .expect("write");
        drop(stream);
        client.join().expect("client");
        String::from_utf8_lossy(&raw).into_owned()
    }

    fn reply(
        status: u16,
        body: &'static str,
        request: impl FnOnce(Api) -> Result<Value, String> + Send + 'static,
    ) -> (String, Result<Value, String>) {
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let client = std::thread::spawn(move || {
            request(Api {
                port,
                token: "run-token".to_string(),
            })
        });

        let (mut stream, _) = listener.accept().expect("accept");
        let mut raw = Vec::new();
        let mut buffer = [0u8; 1024];
        loop {
            let read = stream.read(&mut buffer).expect("read");
            raw.extend_from_slice(&buffer[..read]);
            let Some(head_end) = raw.windows(4).position(|window| window == b"\r\n\r\n") else {
                continue;
            };
            let head = String::from_utf8_lossy(&raw[..head_end]);
            let length = head
                .lines()
                .find_map(|line| line.strip_prefix("Content-Length: ")?.parse::<usize>().ok())
                .expect("content length");
            if raw.len() >= head_end + 4 + length {
                break;
            }
        }
        let response = format!(
            "HTTP/1.1 {status} TEST\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).expect("write");
        drop(stream);
        (
            String::from_utf8_lossy(&raw).into_owned(),
            client.join().expect("client"),
        )
    }

    #[test]
    fn wrong_run_or_fence_is_refused_by_worker_delivery() {
        for refusal in ["unknown development run", "stale development run fence"] {
            let body = Box::leak(format!(r#"{{"error":"{refusal}"}}"#).into_boxed_str());
            let (request, result) = reply(409, body, |api| {
                api.post("/api/hq/v1/agent/delivery", json!({ "outcome": "done" }))
            });
            assert_eq!(result, Err(refusal.to_string()));
            assert!(
                request.starts_with("POST /api/hq/v1/agent/delivery HTTP/1.1"),
                "{request}"
            );
            let (_, body) = request.split_once("\r\n\r\n").unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(body).unwrap(),
                json!({ "outcome": "done" })
            );
        }
    }

    #[test]
    fn repeated_worker_done_renders_as_a_noop() {
        assert_eq!(format!("{:?}", parse("worker done")), "Ok(WorkerDone)");
        let rendered = render_worker_delivery(&json!({
            "apiVersion": 1,
            "runId": "run-1",
            "status": "completed",
            "repeated": true,
        }));
        assert_eq!(rendered, "delivery already recorded: done (run run-1)\n");
    }

    #[test]
    fn worker_blocked_without_reason_is_a_usage_error() {
        assert_eq!(
            parse("worker blocked --reason tests-fail"),
            Ok(Command::WorkerBlocked {
                reason: "tests-fail".to_string()
            })
        );
        assert_eq!(
            parse("worker blocked"),
            Err("usage: pa worker blocked --reason <text>".to_string())
        );
    }

    #[test]
    fn hq_plan_http_mapping_encodes_ids_and_preserves_body() {
        let get = capture(|api| {
            let command = parse("hq plan --project pj&1 --plan main/one --revision 2").unwrap();
            assert_eq!(request_plan_command(&api, &command).unwrap()["ok"], true);
        });
        assert!(
            get.starts_with(
                "GET /api/hq/v1/plan?projectId=pj%261&planId=main%2Fone&revision=2 HTTP/1.1"
            ),
            "{get}"
        );
        let post = capture(|api| {
            let command =
                parse("hq plan-import --project pj-1 --plan main --expected-revision 0").unwrap();
            assert_eq!(request_plan_command(&api, &command).unwrap()["ok"], true);
        });
        assert!(
            post.starts_with("POST /api/hq/v1/plan/import HTTP/1.1"),
            "{post}"
        );
        let (_, body) = post.split_once("\r\n\r\n").unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(body).unwrap(),
            json!({
                "projectId": "pj-1", "planId": "main", "expectedProjectionRevision": 0
            })
        );
        let reason = capture(|api| {
            let command = Command::HqPlanImport {
                project_id: "pj-1".into(),
                plan_id: "main".into(),
                expected_projection_revision: 1,
                rollback_reason: Some("restore old".into()),
            };
            request_plan_command(&api, &command).unwrap();
        });
        let (_, body) = reason.split_once("\r\n\r\n").unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(body).unwrap()["rollbackReason"],
            "restore old"
        );
    }

    #[test]
    fn a_verdict_carries_both_tokens_and_an_ordinary_request_only_one() {
        let head = capture(|api| {
            api.post_verdict(
                "/api/learnings/lr-1/approve",
                json!({ "text": "kurz" }),
                Some("vt-1".to_string()),
            )
            .expect("approve");
        });
        assert!(
            head.contains("POST /api/learnings/lr-1/approve HTTP/1.1"),
            "{head}"
        );
        assert!(
            head.contains(&format!("{TOKEN_HEADER}: api-token")),
            "{head}"
        );
        assert!(
            head.contains(&format!("{VERDICT_TOKEN_HEADER}: vt-1")),
            "{head}"
        );

        // Without a token the header simply is not there, and the app answers
        // the 403 - `pa` does not invent one of its own.
        let head = capture(|api| {
            let _ = api.post_verdict("/api/roles/rv-1/reject", json!({}), None);
        });
        assert!(
            head.contains(&format!("{TOKEN_HEADER}: api-token")),
            "{head}"
        );
        assert!(!head.contains(VERDICT_TOKEN_HEADER), "{head}");

        // And no other request grows the header.
        let head = capture(|api| {
            let _ = api.get("/api/learnings", Some("pj-1"));
        });
        assert!(!head.contains(VERDICT_TOKEN_HEADER), "{head}");
    }

    /// F-SEC-5: the verdict token is the only line between an agent and the
    /// playbook, and `pa` took it only from argv or the environment - both
    /// readable by every process of this user (`/proc/<pid>/cmdline`,
    /// `/proc/<pid>/environ`) and both persisted by the shell's history.
    ///
    /// The reader is a parameter, so this test can feed it. The first version of
    /// this test read the real standard input and a reviewer measured what that
    /// costs: under a terminal - which is where `cargo test` runs for a human -
    /// it waits forever.
    #[test]
    fn the_verdict_token_can_come_from_stdin_or_a_file_instead_of_argv() {
        // `-`: one line from the pipe, and only the first one.
        let mut piped = &b"vt-from-stdin\nnot-this\n"[..];
        assert_eq!(
            read_verdict_token("-", &mut piped, false).expect("stdin"),
            "vt-from-stdin\n"
        );
        // A trailing newline is not required.
        let mut bare = &b"vt-bare"[..];
        assert_eq!(
            read_verdict_token("-", &mut bare, false).expect("stdin without newline"),
            "vt-bare"
        );
        // Padding around the sentinel means the sentinel, not a literal dash.
        let mut padded = &b"vt-padded\n"[..];
        assert_eq!(
            read_verdict_token(" - ", &mut padded, false).expect("padded sentinel"),
            "vt-padded\n"
        );
        // Empty standard input is an error naming the source, not a silent None.
        let mut empty = &b""[..];
        let err = read_verdict_token("-", &mut empty, false).expect_err("empty stdin");
        assert!(err.contains("standard input"), "{err}");
        // A terminal is refused instead of prompting: the token would otherwise
        // echo onto a screen this product records.
        let mut unused = &b"vt-never-read\n"[..];
        let err = read_verdict_token("-", &mut unused, true).expect_err("terminal");
        assert!(err.contains("printf"), "{err}");
        assert_eq!(unused, &b"vt-never-read\n"[..], "stdin was not touched");

        // `pa` is its own binary and has no test-util crate; the neighbouring
        // db-restore test builds its directory the same way.
        let dir = std::env::temp_dir().join(format!(
            "pa-verdict-token-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("token");
        write_private(&path, "vt-from-file\nsecond line\n");

        // `@<path>`: argv carries the path, never the token - and only the first
        // line, so a second line cannot become a second request header.
        let spec = format!("@{}", path.display());
        assert_eq!(
            verdict_token(Some(spec.clone())).expect("read"),
            Some("vt-from-file".to_string())
        );

        // A file that is not there is an error naming it, not a silent `None`:
        // the flag was written in order to prove something.
        let missing = format!("@{}", dir.join("nope").display());
        let err = verdict_token(Some(missing)).expect_err("missing file");
        assert!(err.contains("nope"), "{err}");

        // A file that exists but holds nothing is the same kind of error.
        let empty_file = dir.join("empty");
        write_private(&empty_file, "   \n");
        let err =
            verdict_token(Some(format!("@{}", empty_file.display()))).expect_err("empty file");
        assert!(err.contains("empty"), "{err}");

        // A token mistyped with an `@` in front does not come back in the
        // error text: the CLI's error text does not pass through `redact`
        // here, so this is verified directly against the raw error string.
        let looks_like_a_token = "0123456789abcdef0123456789abcdef";
        let err = verdict_token(Some(format!("@{looks_like_a_token}"))).expect_err("token as path");
        assert!(!err.contains(looks_like_a_token), "{err}");
        assert!(err.contains("without the @"), "{err}");

        // An ordinary value is still itself.
        assert_eq!(
            verdict_token(Some("vt-1".to_string())).expect("literal"),
            Some("vt-1".to_string())
        );

        // Whatever the source, a value that would break the request head is
        // refused by shape - never echoed.
        let err = verdict_token(Some("vt-1 x".to_string())).expect_err("whitespace");
        assert!(err.contains("32 hex"), "{err}");
        assert!(!err.contains("vt-1"), "{err}");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_oversized_verdict_token_file_has_a_named_error() {
        let dir = std::env::temp_dir().join(format!(
            "pa-verdict-token-large-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("token");
        write_private(&path, &"x".repeat(4097));

        let err = read_token_file(path.to_str().expect("utf-8 path")).expect_err("too large");
        assert!(err.contains("exceeds the 4096-byte limit"), "{err}");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A path that is not a regular file is refused by name before it is opened:
    /// opening a FIFO would block, and opening a directory fails differently per OS.
    #[test]
    fn a_non_regular_verdict_token_path_is_refused_by_name() {
        let dir = std::env::temp_dir().join(format!(
            "pa-verdict-token-dir-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("mkdir");

        let err = read_token_file(dir.to_str().expect("utf-8 path")).expect_err("a directory");
        assert!(err.contains("is not a file"), "{err}");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_normal_verdict_token_file_trims_its_trailing_newline() {
        let dir = std::env::temp_dir().join(format!(
            "pa-verdict-token-normal-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("token");
        write_private(&path, "0123456789abcdef0123456789abcdef\n");

        assert_eq!(
            read_token_file(path.to_str().expect("utf-8 path")).expect("read"),
            "0123456789abcdef0123456789abcdef"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The other half of what F-SEC-5 asks for: the token read from a source
    /// outside argv really does reach the request as the header, and it is
    /// nowhere in this process's own command line.
    #[test]
    fn a_token_from_standard_input_reaches_the_header_and_not_argv() {
        let mut piped = &b"vt-secret\n"[..];
        let token = verdict_token(Some(
            read_verdict_token("-", &mut piped, false).expect("stdin"),
        ))
        .expect("resolve")
        .expect("some token");
        assert_eq!(token, "vt-secret");

        let sent = token.clone();
        let head = capture(move |api| {
            api.post_verdict(
                "/api/learnings/lr-1/approve",
                json!({ "text": "kurz" }),
                Some(sent),
            )
            .expect("approve");
        });
        assert!(
            head.contains(&format!("{VERDICT_TOKEN_HEADER}: vt-secret")),
            "{head}"
        );
        assert!(
            !std::env::args().any(|arg| arg.contains("vt-secret")),
            "the token must not be in argv"
        );
    }

    /// A token file other users can read is refused: the documentation points at
    /// the file as the safe place, so the file has to be one.
    #[cfg(unix)]
    #[test]
    fn a_world_readable_token_file_is_refused() {
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir().join(format!(
            "pa-verdict-mode-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("token");
        std::fs::write(&path, "vt-open\n").expect("write");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).expect("chmod");

        let err = verdict_token(Some(format!("@{}", path.display()))).expect_err("mode 644");
        assert!(err.contains("other users"), "{err}");
        assert!(err.contains("644"), "{err}");
        assert!(!err.contains("vt-open"), "{err}");

        // The same file, private, is accepted.
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).expect("chmod");
        assert_eq!(
            verdict_token(Some(format!("@{}", path.display()))).expect("mode 600"),
            Some("vt-open".to_string())
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Write a token file the way the usage text tells the user to.
    fn write_private(path: &std::path::Path, contents: &str) {
        std::fs::write(path, contents).expect("write");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).expect("chmod");
        }
    }

    #[test]
    fn the_verdict_token_falls_back_to_the_environment() {
        // Reading the environment is process-wide, so this test owns the
        // variable for its duration and puts it back.
        let previous = std::env::var_os(ENV_VERDICT_TOKEN);
        std::env::remove_var(ENV_VERDICT_TOKEN);
        assert_eq!(verdict_token(None).expect("no token"), None);
        assert_eq!(
            verdict_token(Some("vt-flag".to_string())).expect("flag"),
            Some("vt-flag".to_string())
        );

        std::env::set_var(ENV_VERDICT_TOKEN, "vt-env");
        assert_eq!(
            verdict_token(None).expect("env"),
            Some("vt-env".to_string())
        );
        // The flag is the one the user typed for this call; it wins.
        assert_eq!(
            verdict_token(Some("vt-flag".to_string())).expect("flag wins"),
            Some("vt-flag".to_string())
        );

        // An empty or blank value is nothing, not a token: it would go out as
        // a header the app can only refuse, with a worse error than none.
        std::env::set_var(ENV_VERDICT_TOKEN, "   ");
        let blank = verdict_token(None).expect("blank env");

        match previous {
            Some(value) => std::env::set_var(ENV_VERDICT_TOKEN, value),
            None => std::env::remove_var(ENV_VERDICT_TOKEN),
        }
        assert_eq!(blank, None);
    }

    #[test]
    fn the_usage_names_the_learning_commands() {
        assert!(
            USAGE.contains("pa learnings list [--project <projectId>] [--status <status>]"),
            "{USAGE}"
        );
        assert!(
            USAGE.contains("pa learnings approve <learningId> [--text <text>]"),
            "{USAGE}"
        );
        assert!(
            USAGE.contains("pa learnings reject <learningId>"),
            "{USAGE}"
        );
    }

    #[test]
    fn the_usage_names_the_recommendation_commands() {
        assert!(
            USAGE.contains("pa recommendations accept <recommendationId>"),
            "{USAGE}"
        );
        assert!(
            USAGE.contains("pa recommendations dismiss <recommendationId>"),
            "{USAGE}"
        );
        assert!(
            USAGE.contains("pa queue add --project <projectId> --task <task> [--profile <profileId>] [--priority <n>] [--sharpen] [--on-behalf-of <workerId>]"),
            "{USAGE}"
        );
    }

    #[test]
    fn github_create_defaults_to_a_private_named_by_the_project() {
        assert_eq!(
            parse("github create --project pj-1"),
            Ok(Command::GithubCreate {
                project_id: "pj-1".to_string(),
                name: None,
                public: false,
            })
        );
        // Both flag forms work, and the switch travels on its own.
        assert_eq!(
            parse("github create --project=pj-1 --name=repo --public"),
            Ok(Command::GithubCreate {
                project_id: "pj-1".to_string(),
                name: Some("repo".to_string()),
                public: true,
            })
        );
        assert_eq!(
            parse("github create --name repo --project pj-1"),
            Ok(Command::GithubCreate {
                project_id: "pj-1".to_string(),
                name: Some("repo".to_string()),
                public: false,
            })
        );

        assert_eq!(
            parse("github create"),
            Err("--project is required".to_string())
        );
        assert!(parse("github nope x")
            .unwrap_err()
            .contains("unknown github subcommand: nope"));
        assert_eq!(
            parse("github create --project pj-1 --nope x"),
            Err("unknown option: --nope".to_string())
        );
        assert_eq!(
            parse("github create fix-it"),
            Err("unexpected argument: fix-it".to_string())
        );
    }

    #[test]
    fn github_link_takes_exactly_one_url() {
        assert_eq!(
            parse("github link --project pj-1 https://github.com/o/r.git"),
            Ok(Command::GithubLink {
                project_id: "pj-1".to_string(),
                url: "https://github.com/o/r.git".to_string(),
            })
        );
        // The url may come first; `--project=` works too.
        assert_eq!(
            parse("github link git@github.com:o/r.git --project pj-1"),
            Ok(Command::GithubLink {
                project_id: "pj-1".to_string(),
                url: "git@github.com:o/r.git".to_string(),
            })
        );

        assert_eq!(
            parse("github link --project pj-1"),
            Err("usage: pa github link --project <projectId> <url>".to_string())
        );
        assert_eq!(
            parse("github link --project pj-1 a b"),
            Err("usage: pa github link --project <projectId> <url>".to_string())
        );
        assert_eq!(
            parse("github link a b --project pj-1"),
            Err("usage: pa github link --project <projectId> <url>".to_string())
        );
        assert_eq!(
            parse("github link --project"),
            Err("--project needs a value".to_string())
        );
        assert!(parse("github").unwrap_err().contains("subcommand"));
        assert!(parse("github nope")
            .unwrap_err()
            .contains("unknown github subcommand: nope"));
    }

    #[test]
    fn the_usage_names_the_github_commands() {
        assert!(
            USAGE.contains("pa github create --project <projectId> [--name <name>] [--public]"),
            "{USAGE}"
        );
        assert!(
            USAGE.contains("pa github link --project <projectId> <url>"),
            "{USAGE}"
        );
    }

    #[test]
    fn project_landing_page_commands_parse() {
        assert_eq!(
            parse("project create --name Golden --path C:/scratch"),
            Ok(Command::ProjectCreate {
                name: "Golden".to_string(),
                repo_path: "C:/scratch".to_string(),
                verdict_token: None,
            })
        );
        assert_eq!(
            parse("project create --name=Golden --path=C:/scratch"),
            Ok(Command::ProjectCreate {
                name: "Golden".to_string(),
                repo_path: "C:/scratch".to_string(),
                verdict_token: None,
            })
        );
        assert_eq!(
            parse("project create --name Golden --path C:/scratch --verdict-token vt-1"),
            Ok(Command::ProjectCreate {
                name: "Golden".to_string(),
                repo_path: "C:/scratch".to_string(),
                verdict_token: Some("vt-1".to_string()),
            })
        );
        assert_eq!(
            parse("project create --name Golden"),
            Err("--path is required".to_string())
        );
        assert_eq!(
            parse("project create --path C:/scratch"),
            Err("--name is required".to_string())
        );
        assert_eq!(
            parse("project landing-page --project pj-1"),
            Ok(Command::ProjectLandingPage {
                project_id: "pj-1".to_string(),
            })
        );
        assert_eq!(
            parse("project set-landing-page --project=pj-1 --file page.md"),
            Ok(Command::ProjectSetLandingPage {
                project_id: "pj-1".to_string(),
                file: "page.md".to_string(),
            })
        );

        assert_eq!(
            parse("project landing-page"),
            Err("--project is required".to_string())
        );
        assert_eq!(
            parse("project set-landing-page --project pj-1"),
            Err("--file is required".to_string())
        );
        assert!(parse("project").unwrap_err().contains("subcommand"));
        assert!(parse("project").unwrap_err().contains("create"));
        assert!(parse("project nope")
            .unwrap_err()
            .contains("unknown project subcommand: nope"));
    }

    #[test]
    fn the_usage_names_the_landing_page_commands() {
        assert!(
            USAGE.contains(
                "pa project create --name <name> --path <repo> [--verdict-token <token>]"
            ),
            "{USAGE}"
        );
        assert!(
            USAGE.contains("pa project landing-page --project <projectId>"),
            "{USAGE}"
        );
        assert!(
            USAGE.contains("pa project set-landing-page --project <projectId> --file <path>"),
            "{USAGE}"
        );
    }

    #[test]
    fn a_created_project_renders_id_name_and_path() {
        let rendered = render_project(&json!({
            "id": "pj-new",
            "name": "Golden",
            "repoPath": "C:/scratch"
        }));
        assert_eq!(
            rendered,
            "id       pj-new\nname     Golden\nrepo     C:/scratch\n"
        );
    }

    #[test]
    fn spawning_can_be_booked_under_the_worker_that_ordered_it() {
        assert_eq!(
            parse("worker spawn --project pj-1 --task fix-it --on-behalf-of wk-queen"),
            Ok(Command::WorkerSpawn {
                project_id: "pj-1".to_string(),
                task: "fix-it".to_string(),
                profile_id: None,
                spawned_by: Some("wk-queen".to_string()),
            })
        );
        // Nobody named means nobody booked: the field stays away entirely.
        assert_eq!(
            parse("worker spawn --project pj-1 --task fix-it --profile kimi"),
            Ok(Command::WorkerSpawn {
                project_id: "pj-1".to_string(),
                task: "fix-it".to_string(),
                profile_id: Some("kimi".to_string()),
                spawned_by: None,
            })
        );
        assert_eq!(
            parse("worker spawn --project pj-1 --task fix-it --on-behalf-of"),
            Err("--on-behalf-of needs a value".to_string())
        );
    }

    #[test]
    fn queen_spawn_needs_a_project_and_a_domain() {
        assert_eq!(
            parse("queen spawn --project pj-1 --task Backend-API"),
            Ok(Command::QueenSpawn {
                project_id: "pj-1".to_string(),
                task: "Backend-API".to_string(),
                profile_id: None,
                spawned_by: None,
            })
        );
        assert_eq!(
            parse("queen spawn --project=pj-1 --task=Backend-API --profile kimi --on-behalf-of wk-orch"),
            Ok(Command::QueenSpawn {
                project_id: "pj-1".to_string(),
                task: "Backend-API".to_string(),
                profile_id: Some("kimi".to_string()),
                spawned_by: Some("wk-orch".to_string()),
            })
        );

        assert_eq!(
            parse("queen spawn --task Backend-API"),
            Err("--project is required".to_string())
        );
        assert_eq!(
            parse("queen spawn --project pj-1"),
            Err("--task is required".to_string())
        );
        assert_eq!(
            parse("queen"),
            Err("queen needs a subcommand: spawn".to_string())
        );
        assert!(parse("queen nope x")
            .unwrap_err()
            .contains("unknown queen subcommand: nope"));
    }

    #[test]
    fn queen_spawn_is_retired_without_touching_http() {
        let cmd = parse("queen spawn --project pj-1 --task Backend-API").unwrap();
        assert!(matches!(cmd, Command::QueenSpawn { .. }));
        assert!(QUEEN_SPAWN_RETIRED.contains("retired"));
        assert!(USAGE.contains("(retired, Rev 9)"));

        // A missing descriptor would fail Api::load. Retired must not get that far.
        let err = run(&[
            "queen".into(),
            "spawn".into(),
            "--project".into(),
            "pj-1".into(),
            "--task".into(),
            "Backend-API".into(),
        ])
        .unwrap_err();
        assert_eq!(err, QUEEN_SPAWN_RETIRED);
        assert!(!err.contains("cannot read"), "{err}");
        assert!(!err.contains("ProjectA running"), "{err}");
    }

    #[test]
    fn db_restore_is_offline_and_needs_yes() {
        assert_eq!(
            parse("db restore --from x.bak --dest y.db"),
            Ok(Command::DbRestore {
                from: Some("x.bak".into()),
                dest: Some("y.db".into()),
                yes: false,
            })
        );
        let err = run(&[
            "db".into(),
            "restore".into(),
            "--from".into(),
            "x.bak".into(),
        ])
        .unwrap_err();
        assert!(err.contains("--yes"), "{err}");
        assert!(!err.contains("cannot read"), "{err}");
        assert!(!err.contains("ProjectA running"), "{err}");

        let dir = std::env::temp_dir().join(format!(
            "pa-db-restore-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("projecta.db");
        let bak = dir.join("projecta.db.pre-migration-1.bak");
        std::fs::write(&bak, b"snapshot").unwrap();
        std::fs::write(&dest, b"live").unwrap();
        let err = run(&[
            "db".into(),
            "restore".into(),
            "--from".into(),
            bak.to_string_lossy().into_owned(),
            "--dest".into(),
            dest.to_string_lossy().into_owned(),
            "--yes".into(),
        ]);
        err.expect("offline restore");
        assert_eq!(std::fs::read(&dest).unwrap(), b"snapshot");
        assert_eq!(std::fs::read(&bak).unwrap(), b"snapshot");

        std::fs::write(dir.join(DESCRIPTOR_FILE), "{}").unwrap();
        let err = run(&[
            "db".into(),
            "restore".into(),
            "--from".into(),
            bak.to_string_lossy().into_owned(),
            "--dest".into(),
            dest.to_string_lossy().into_owned(),
            "--yes".into(),
        ])
        .unwrap_err();
        assert!(err.contains("quit ProjectA"), "{err}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_tree_filters_by_project() {
        assert_eq!(parse("tree"), Ok(Command::Tree { project_id: None }));
        assert_eq!(
            parse("tree --project pj-1"),
            Ok(Command::Tree {
                project_id: Some("pj-1".to_string())
            })
        );
        assert_eq!(
            parse("tree pj-1"),
            Err("unexpected argument: pj-1".to_string())
        );
    }

    #[test]
    fn the_tree_nests_children_under_their_parent() {
        let tree = json!({
            "coordinators": [{
                "id": "wk-orch", "kind": "orchestrator", "status": "running",
                "task": "plan the release",
                "children": [{
                    "id": "wk-queen", "kind": "queen", "status": "running",
                    "task": "Backend-API",
                    "children": [
                        { "id": "wk-first", "kind": "worker", "status": "running",
                          "task": "write the endpoint", "children": [] },
                        { "id": "wk-second", "kind": "worker", "status": "done",
                          "task": "write the tests", "children": [] },
                    ],
                }],
            }],
            "workers": [
                { "id": "wk-loose", "kind": "worker", "status": "running",
                  "task": "nobody claimed me", "children": [] },
            ],
        });
        let rendered = render_tree(&tree);

        let indent = |id: &str| {
            let lines: Vec<&str> = rendered.lines().filter(|line| line.contains(id)).collect();
            assert_eq!(
                lines.len(),
                1,
                "{id} is not printed exactly once: {rendered}"
            );
            lines[0].len() - lines[0].trim_start().len()
        };

        assert_eq!(indent("wk-orch"), 0, "{rendered}");
        assert_eq!(indent("wk-queen"), 2, "{rendered}");
        assert_eq!(indent("wk-first"), 4, "{rendered}");
        assert_eq!(indent("wk-second"), 4, "{rendered}");
        // The employee nobody claimed is a root of its own, after the trees.
        assert_eq!(indent("wk-loose"), 0, "{rendered}");
        assert!(
            rendered.find("wk-orch") < rendered.find("wk-loose"),
            "{rendered}"
        );

        assert!(rendered.contains("Backend-API"), "{rendered}");
        assert!(rendered.contains("done"), "{rendered}");
        assert_eq!(rendered.lines().count(), 5, "{rendered}");
    }

    #[test]
    fn a_project_without_agents_says_so() {
        assert_eq!(
            render_tree(&json!({ "coordinators": [], "workers": [] })),
            "no agents\n"
        );
        assert_eq!(render_tree(&json!({})), "no agents\n");
    }

    #[test]
    fn the_usage_names_the_hierarchy_commands() {
        assert!(
            USAGE.contains(
                "pa worker spawn --project <projectId> --task <task> [--profile <profileId>] [--on-behalf-of <workerId>]"
            ),
            "{USAGE}"
        );
        assert!(
            USAGE.contains("pa queen spawn --project <projectId> --task <domain>"),
            "{USAGE}"
        );
        assert!(USAGE.contains("pa tree [--project <projectId>]"), "{USAGE}");
    }

    #[test]
    fn learnings_render_one_line_each_and_shorten_long_content() {
        let long = "wort ".repeat(40);
        let learnings = json!([
            {
                "id": "lr-1",
                "status": "pending",
                "patternLabel": "Gates",
                "content": "Gates\n  seriell   laufen lassen"
            },
            { "id": "lr-2", "status": "approved", "content": long },
        ]);
        let rendered = render_learning_list(&learnings);
        let lines: Vec<&str> = rendered.lines().collect();
        assert_eq!(lines.len(), 2, "{rendered}");
        assert!(lines[0].contains("lr-1"), "{rendered}");
        assert!(lines[0].contains("pending"), "{rendered}");
        assert!(lines[0].contains("Gates"), "{rendered}");
        // Multi line content is folded, not wrapped.
        assert!(
            lines[0].ends_with("Gates seriell laufen lassen"),
            "{rendered}"
        );
        // A missing label reads like every other missing field here.
        assert!(lines[1].contains("approved"), "{rendered}");
        assert!(lines[1].ends_with('\u{2026}'), "{rendered}");

        assert_eq!(render_learning_list(&json!([])), "no learnings\n");
        assert_eq!(render_learning_list(&json!(null)), "no learnings\n");
    }

    #[test]
    fn recommendations_render_with_their_rationale() {
        let recommendations = json!([
            {
                "id": "rc-1",
                "status": "new",
                "effort": "M",
                "title": "ratatui",
                "rationale": "Board im Terminal",
                "url": "https://github.com/ratatui/ratatui",
            },
            { "id": "rc-2", "status": "dismissed", "title": "nope", "rationale": "passt nicht",
              "effort": Value::Null, "url": Value::Null },
        ]);
        let rendered = render_recommendation_list(&recommendations);

        assert!(rendered.contains("rc-1"), "{rendered}");
        assert!(rendered.contains("ratatui"), "{rendered}");
        assert!(rendered.contains("Board im Terminal"), "{rendered}");
        assert!(
            rendered.contains("https://github.com/ratatui/ratatui"),
            "{rendered}"
        );
        assert!(rendered.contains("dismissed"), "{rendered}");
        // A missing url adds no line of its own.
        assert_eq!(rendered.lines().count(), 5, "{rendered}");
        assert_eq!(
            render_recommendation_list(&json!([])),
            "no recommendations\n"
        );
    }

    #[test]
    fn roles_list_takes_both_filters() {
        assert_eq!(
            parse("roles list"),
            Ok(Command::RolesList {
                project_id: None,
                status: None
            })
        );
        assert_eq!(
            parse("roles list --project pj-1 --status pending"),
            Ok(Command::RolesList {
                project_id: Some("pj-1".to_string()),
                status: Some("pending".to_string()),
            })
        );
        assert!(parse("roles").unwrap_err().contains("subcommand"));
        assert!(parse("roles nope")
            .unwrap_err()
            .contains("unknown roles subcommand: nope"));
        assert!(parse("roles list --nope x")
            .unwrap_err()
            .contains("unknown option"));
    }

    #[test]
    fn roles_are_approved_and_rejected_by_id() {
        assert_eq!(
            parse("roles approve rv-1"),
            Ok(Command::RolesApprove {
                id: "rv-1".to_string(),
                verdict_token: None,
            })
        );
        assert_eq!(
            parse("roles reject rv-1"),
            Ok(Command::RolesReject {
                id: "rv-1".to_string(),
                verdict_token: None,
            })
        );

        // Exactly one id: none and two are both refusals.
        assert_eq!(parse("roles approve"), Err(ROLES_APPROVE_USAGE.to_string()));
        assert_eq!(
            parse("roles approve rv-1 rv-2"),
            Err(ROLES_APPROVE_USAGE.to_string())
        );
        assert_eq!(parse("roles reject"), Err(ROLES_REJECT_USAGE.to_string()));
        assert_eq!(
            parse("roles approve --verdict-token vt-1"),
            Err(ROLES_APPROVE_USAGE.to_string())
        );
    }

    #[test]
    fn roles_render_two_lines_each() {
        let roles = json!([
            {
                "id": "rv-1",
                "status": "pending",
                "version": 1,
                "name": "Test-Fixer",
                "patternLabel": "tests-fixen",
                "baseProfileId": "claude",
            },
            {
                "id": "rv-2",
                "status": "approved",
                "version": 2,
                "name": "Gate-Runner",
                "patternLabel": "gates",
                "baseProfileId": "claude",
            },
        ]);
        let rendered = render_role_list(&roles);
        assert_eq!(rendered.lines().count(), 4, "{rendered}");
        assert!(rendered.contains("rv-1"), "{rendered}");
        assert!(rendered.contains("v1"), "{rendered}");
        assert!(rendered.contains("v2"), "{rendered}");
        assert!(rendered.contains("Test-Fixer"), "{rendered}");
        assert!(rendered.contains("tests-fixen"), "{rendered}");
        assert!(rendered.contains("(claude)"), "{rendered}");

        assert_eq!(render_role_list(&json!([])), "no roles\n");
        assert_eq!(render_role_list(&json!(null)), "no roles\n");
    }

    #[test]
    fn activity_filters_by_project_and_limits() {
        assert_eq!(
            parse("activity"),
            Ok(Command::Activity {
                project_id: None,
                limit: None,
            })
        );
        assert_eq!(
            parse("activity --project pj-1 --limit 10"),
            Ok(Command::Activity {
                project_id: Some("pj-1".to_string()),
                limit: Some(10),
            })
        );
        // The `--flag=value` form works here too.
        assert_eq!(
            parse("activity --limit=5"),
            Ok(Command::Activity {
                project_id: None,
                limit: Some(5),
            })
        );
        assert_eq!(
            parse("activity --limit nope"),
            Err("--limit must be a positive integer".to_string())
        );
        assert_eq!(
            parse("activity pj-1"),
            Err("unexpected argument: pj-1".to_string())
        );
        assert!(parse("activity --nope x")
            .unwrap_err()
            .contains("unknown option"));
    }

    #[test]
    fn activity_renders_one_line_per_entry() {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0i64, |d| d.as_secs() as i64);
        let feed = json!([
            { "id": "ev-2", "createdAt": now - 300, "category": "status",
              "projectId": "pj-1", "workerId": "wk-1",
              "workerLabel": "fix the flaky test", "summary": "stalled: no output" },
            { "id": "rc-1", "createdAt": now - 7200, "category": "recommendation",
              "projectId": "pj-1", "workerId": Value::Null, "workerLabel": Value::Null,
              "summary": "ratatui" },
        ]);
        let rendered = render_activity(&feed);
        let lines: Vec<&str> = rendered.lines().collect();
        assert_eq!(lines.len(), 2, "{rendered}");
        assert!(lines[0].contains("5m"), "{rendered}");
        assert!(lines[0].contains("status"), "{rendered}");
        assert!(lines[0].contains("fix the flaky test"), "{rendered}");
        assert!(lines[0].contains("stalled: no output"), "{rendered}");
        assert!(lines[1].contains("2h"), "{rendered}");
        // A project-level entry has no worker column to print.
        assert!(lines[1].contains("recommendation"), "{rendered}");

        assert_eq!(render_activity(&json!([])), "no activity\n");
        assert_eq!(render_activity(&json!(null)), "no activity\n");
    }

    // -- questions (Phase 21) ----------------------------------------------

    #[test]
    fn ask_takes_a_worker_or_leaves_it_out() {
        assert_eq!(
            parse("ask --project pj-1 --worker wk-1 --question warum? --options A,B"),
            Ok(Command::Ask {
                project_id: "pj-1".to_string(),
                worker_id: Some("wk-1".to_string()),
                question: "warum?".to_string(),
                options: Some("A,B".to_string()),
            })
        );
        // No worker: a preflight question, which is a shape and not a mistake.
        assert_eq!(
            parse("ask --project pj-1 --question warum?"),
            Ok(Command::Ask {
                project_id: "pj-1".to_string(),
                worker_id: None,
                question: "warum?".to_string(),
                options: None,
            })
        );
        // The two flags that carry the whole meaning are not optional.
        assert!(parse("ask --project pj-1").is_err());
        assert!(parse("ask --question warum?").is_err());
    }

    /// The answer is free text that gets rejoined, so a flag inside it has to
    /// come out before the join or it is typed at the agent as part of the
    /// decision.
    #[test]
    fn answer_lifts_the_verdict_token_out_of_the_answer() {
        assert_eq!(
            parse("answer qs-1 nimm SQLite --verdict-token geheim"),
            Ok(Command::Answer {
                id: "qs-1".to_string(),
                text: "nimm SQLite".to_string(),
                verdict_token: Some("geheim".to_string()),
            })
        );
        // It may also sit in front of the text, because somebody will type it
        // there and the id is found by position either way.
        assert_eq!(
            parse("answer qs-1 --verdict-token geheim nimm SQLite"),
            Ok(Command::Answer {
                id: "qs-1".to_string(),
                text: "nimm SQLite".to_string(),
                verdict_token: Some("geheim".to_string()),
            })
        );
        // A flag written without a value was written to prove something, and
        // swallowing it would file the answer as unverified without saying so.
        assert_eq!(
            parse("answer qs-1 ja --verdict-token"),
            Err("--verdict-token needs a value".to_string())
        );
        assert_eq!(
            parse("answer qs-1 ja --verdict-token --status"),
            Err("--verdict-token needs a value".to_string())
        );
        // And an answer that needs no proof still parses as it always did.
        assert_eq!(
            parse("answer qs-1 ja"),
            Ok(Command::Answer {
                id: "qs-1".to_string(),
                text: "ja".to_string(),
                verdict_token: None,
            })
        );
    }

    #[test]
    fn answer_rejoins_the_text_it_was_given() {
        assert_eq!(
            parse("answer qs-1 nimm SQLite"),
            Ok(Command::Answer {
                id: "qs-1".to_string(),
                text: "nimm SQLite".to_string(),
                verdict_token: None,
            })
        );
        // An id with nothing behind it is not an empty answer, it is a line
        // that was written wrong - and the usage says how to write it right.
        assert_eq!(parse("answer qs-1"), Err(ANSWER_USAGE.to_string()));
        assert_eq!(parse("answer"), Err(ANSWER_USAGE.to_string()));
        assert_eq!(parse("answer --status open"), Err(ANSWER_USAGE.to_string()));
    }

    #[test]
    fn questions_list_filters_both_ways() {
        assert_eq!(
            parse("questions list"),
            Ok(Command::QuestionsList {
                project_id: None,
                status: None
            })
        );
        assert_eq!(
            parse("questions list --project pj-1 --status open"),
            Ok(Command::QuestionsList {
                project_id: Some("pj-1".to_string()),
                status: Some("open".to_string()),
            })
        );
        assert!(parse("questions").is_err());
        assert!(parse("questions show").is_err());
    }

    #[test]
    fn a_question_prints_its_status_before_anything_else() {
        let open = json!({
            "id": "qs-1",
            "projectId": "pj-1",
            "workerId": "wk-1",
            "scope": "worker",
            "question": "Postgres oder SQLite?",
            "optionsJson": "[\"Postgres\",\"SQLite\"]",
            "status": "open",
            "answer": Value::Null,
            "createdAt": 42,
            "answeredAt": Value::Null,
            "expiresAt": 14442
        });
        let out = render_question(&open);
        let lines: Vec<&str> = out.lines().collect();
        assert!(lines[0].contains("qs-1"), "{out}");
        assert!(lines[1].starts_with("status"), "{out}");
        assert!(lines[1].contains("open"), "{out}");
        assert!(out.contains("Postgres oder SQLite?"), "{out}");
        // The agent has to be told it is *not* holding an answer.
        assert!(out.contains("noch offen"), "{out}");

        // The budget refusal comes back from `ask` already decided, and the
        // agent has to read the answer out of it rather than wait.
        let refused = json!({
            "id": "qs-2",
            "projectId": "pj-1",
            "workerId": "wk-1",
            "scope": "worker",
            "question": "Und noch eine?",
            "optionsJson": Value::Null,
            "status": "refused",
            "answer": "zu viele offene Fragen \u{2014} entscheide selbst und dokumentiere die Annahme",
            "createdAt": 42,
            "answeredAt": 42,
            "expiresAt": Value::Null
        });
        let out = render_question(&refused);
        assert!(out.contains("refused"), "{out}");
        assert!(out.contains("zu viele offene Fragen"), "{out}");
        assert!(!out.contains("noch offen"), "{out}");
        assert!(!out.contains("options"), "no options were offered: {out}");
    }

    #[test]
    fn a_question_list_says_so_when_there_is_nothing() {
        assert_eq!(render_question_list(&json!([])), "no questions\n");
        assert_eq!(render_question_list(&Value::Null), "no questions\n");

        let out = render_question_list(&json!([
            { "id": "qs-1", "status": "open", "workerId": "wk-1",
              "question": "Postgres oder SQLite?" },
            { "id": "qs-2", "status": "expired", "workerId": Value::Null,
              "question": "Welche DB?" },
        ]));
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines.len(), 2, "{out}");
        assert!(
            lines[0].contains("qs-1") && lines[0].contains("open"),
            "{out}"
        );
        assert!(lines[1].contains("expired"), "{out}");
    }

    #[test]
    fn the_usage_names_the_question_commands() {
        assert!(
            USAGE.contains(
                "pa ask --project <projectId> [--worker <workerId>] --question <text> [--options <A,B,C>]"
            ),
            "{USAGE}"
        );
        assert!(USAGE.contains("pa answer <questionId> <text>"), "{USAGE}");
        assert!(
            USAGE.contains("pa questions list [--project <projectId>]"),
            "{USAGE}"
        );
        // The rule the agents are given lives in the prompts, but the CLI has
        // to say it too: this is the help an agent reads when it guesses.
        assert!(USAGE.contains("does NOT wait"), "{USAGE}");
        assert!(USAGE.contains("never for small change"), "{USAGE}");
    }

    #[test]
    fn the_usage_names_the_activity_command() {
        assert!(
            USAGE.contains("pa activity [--project <projectId>] [--limit <n>]"),
            "{USAGE}"
        );
    }

    /// The command sketch at the top of this file: everything between the
    /// fences of the ```text block in the module comment, without the `//!`.
    fn module_sketch() -> String {
        let mut out = String::new();
        let mut inside = false;
        for line in include_str!("../pa.rs").lines() {
            let line = line.trim_start().trim_start_matches("//!").trim();
            if !inside {
                inside = line.ends_with("```text");
                continue;
            }
            if line == "```" {
                break;
            }
            out.push_str(line);
            out.push('\n');
        }
        out
    }

    /// Every `pa ...` line of a help text as the command it names: the verb
    /// and, where there is one, its subcommand.
    fn commands(help: &str) -> BTreeSet<String> {
        let mut out = BTreeSet::new();
        for line in help.lines() {
            let Some(rest) = line.trim().strip_prefix("pa ") else {
                continue;
            };
            let command: Vec<&str> = rest
                .split_whitespace()
                .take_while(|word| !word.starts_with(['-', '<', '[', '"']))
                .take(2)
                .collect();
            if !command.is_empty() {
                out.insert(command.join(" "));
            }
        }
        out
    }

    /// Two lists of commands are two chances to forget one. They are only
    /// worth having if they agree with each other and with the parser.
    #[test]
    fn the_two_help_texts_name_the_same_commands() {
        let sketch = commands(&module_sketch());
        let usage = commands(USAGE);
        assert!(
            !sketch.is_empty(),
            "the module comment sketch was not found"
        );
        assert_eq!(sketch, usage, "module comment {sketch:?}\nUSAGE {usage:?}");

        // And what they agree on is what the parser answers to: a documented
        // command may complain about missing arguments, but never about
        // itself. (`help` is the one verb that needs no line of its own.)
        for command in &usage {
            if let Err(err) = parse(command) {
                assert!(
                    !err.starts_with("unknown"),
                    "{command} is in both help texts but not in the parser: {err}"
                );
            }
        }
    }

    #[test]
    fn stats_takes_the_project_either_way_and_refuses_a_window_it_cannot_send() {
        assert_eq!(
            parse("stats pj-1"),
            Ok(Command::Stats {
                project_id: "pj-1".to_string(),
                range: None
            })
        );
        assert_eq!(
            parse("stats --project pj-1 --range week"),
            Ok(Command::Stats {
                project_id: "pj-1".to_string(),
                range: Some("week".to_string())
            })
        );
        assert_eq!(parse("stats"), Err(STATS_USAGE.to_string()));
        assert_eq!(parse("stats pj-1 pj-2"), Err(STATS_USAGE.to_string()));
        // A window the core would refuse anyway is refused here, before the
        // round trip, and with all six accepted names spelled out.
        let err = parse("stats pj-1 --range gestern").expect_err("no such window");
        assert!(err.contains("today, week, month, all, 7d or 30d"), "{err}");
        assert!(
            USAGE
                .contains("pa stats --project <projectId> [--range <today|week|month|all|7d|30d>]"),
            "{USAGE}"
        );
        assert!(
            STATS_USAGE.contains("[--range <today|week|month|all|7d|30d>]"),
            "{STATS_USAGE}"
        );
    }

    #[test]
    fn a_project_without_a_ledger_is_printed_as_not_measured() {
        let stats = json!({
            "projectId": "pj-1", "projectName": "one", "range": "week",
            "since": 1_787_140_800, "generatedAt": 1_787_745_600,
            "overview": {
                "workersTotal": 3, "workersActive": 2, "workersArchived": 1,
                "byColumn": [{ "key": "working", "count": 2 }, { "key": "done", "count": 0 }],
                "byKind": [{ "key": "worker", "count": 2 }],
                "needsAttention": 1,
                "queue": [{ "key": "queued", "count": 4 }],
                "queueTotal": 4, "learningsPending": 2,
                "messages": 40, "statusEvents": 12, "diffComments": 3,
                "workersCreated": 3, "rangeScoped": ["messages"]
            },
            "tokens": Value::Null,
            "sessions": {
                "total": 3, "open": 1, "ended": 2, "totalSeconds": 5400,
                "medianSeconds": 2700, "failed": 1, "unknownExit": 0,
                "failureRatio": 0.5, "recent": []
            },
            "timeline": [{ "date": "2026-08-27", "day": 1_787_702_400, "messages": 40, "statusEvents": 12 }],
            "completion": {
                "percent": 42.4,
                "components": [{ "key": "workers", "weight": 1.0, "score": 0.42,
                                 "detail": "1,3 von 3 Workern (Spalten-Gewichte)" }],
                "workers": [], "columnWeights": []
            }
        });

        let out = render_stats(&stats);
        assert!(out.contains("one  (pj-1)"), "{out}");
        assert!(out.contains("2 active, 1 archived, 3 total"), "{out}");
        // An empty column is left off the one-liner rather than printed as 0.
        assert!(out.contains("2 working"), "{out}");
        assert!(!out.contains("0 done"), "{out}");
        assert!(out.contains("4 queued"), "{out}");
        // The two honest gaps.
        assert!(out.contains("tokens     not measured"), "{out}");
        assert!(out.contains("estimated, not measured"), "{out}");
        assert!(out.contains("42 %"), "{out}");
        assert!(out.contains("1 h 30 min"), "{out}");
        assert!(out.contains("median 45 min"), "{out}");
        assert!(out.contains("2026-08-27"), "{out}");
    }

    #[test]
    fn a_ledger_with_rows_is_printed_with_its_attribution_spelled_out() {
        let stats = json!({
            "projectId": "pj-1", "projectName": "one", "range": "all",
            "since": Value::Null, "generatedAt": 1_787_745_600,
            "overview": { "workersActive": 1, "queue": [] },
            "tokens": {
                "requests": 9, "tokensIn": 1000, "tokensOut": 200,
                "costUsd": 0.0, "priced": 0,
                "byProfile": [
                    { "profileId": "claude", "requests": 7, "tokensIn": 900,
                      "tokensOut": 150, "usedByProject": true },
                    { "profileId": Value::Null, "requests": 2, "tokensIn": 100,
                      "tokensOut": 50, "usedByProject": false }
                ],
                "projectProfiles": ["claude"]
            },
            "sessions": { "total": 0, "open": 0, "ended": 0 },
            "timeline": [],
            "completion": { "percent": Value::Null, "components": [] }
        });

        let out = render_stats(&stats);
        assert!(out.contains("9 request(s)"), "{out}");
        // Never a 0.0000 USD where nothing was priced.
        assert!(out.contains("no price on any row"), "{out}");
        assert!(!out.contains("0.0000 USD"), "{out}");
        assert!(out.contains("fleet-wide, not per project"), "{out}");
        assert!(
            out.contains("claude") && out.contains("used by this project"),
            "{out}"
        );
        assert!(out.contains("(unattributed)"), "{out}");
        assert!(out.contains("nothing to estimate from"), "{out}");
    }

    #[test]
    fn unknown_verbs_are_named() {
        assert!(parse("nope").unwrap_err().contains("unknown command: nope"));
        assert!(parse("worker").unwrap_err().contains("subcommand"));
        assert!(parse("worker nope")
            .unwrap_err()
            .contains("unknown worker subcommand: nope"));
    }

    #[test]
    fn ids_are_url_safe_by_construction() {
        assert_eq!(encode("wk-17f2a-3"), "wk-17f2a-3");
        assert_eq!(encode("a b"), "a%20b");
        assert_eq!(encode("a/b"), "a%2Fb");
    }

    /// Tests that mutate the process-wide environment hold this lock for their
    /// duration: cargo runs tests in parallel threads, and two mutators
    /// interleaving would flake both.
    static ENV_OVERRIDE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn the_descriptor_can_be_pointed_somewhere_else() {
        // Reading the environment is process-wide, so this test owns both
        // override variables for its duration and puts them back.
        let _guard = ENV_OVERRIDE_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let previous_file = std::env::var_os(ENV_DESCRIPTOR);
        let previous_dir = std::env::var_os(ENV_APP_DATA);
        std::env::set_var(ENV_DESCRIPTOR, "C:/tmp/elsewhere.json");
        std::env::remove_var(ENV_APP_DATA);
        let file_override = descriptor_path().expect("descriptor path");
        std::env::remove_var(ENV_DESCRIPTOR);
        std::env::set_var(ENV_APP_DATA, "D:/scratch/projecta-f8");
        let dir_override = descriptor_path().expect("descriptor path");
        match previous_dir {
            Some(value) => std::env::set_var(ENV_APP_DATA, value),
            None => std::env::remove_var(ENV_APP_DATA),
        }
        match previous_file {
            Some(value) => std::env::set_var(ENV_DESCRIPTOR, value),
            None => std::env::remove_var(ENV_DESCRIPTOR),
        }
        assert_eq!(file_override, PathBuf::from("C:/tmp/elsewhere.json"));
        assert_eq!(
            dir_override,
            PathBuf::from("D:/scratch/projecta-f8").join(DESCRIPTOR_FILE)
        );
    }

    /// Dev-build isolation (docs/setup/dev-build.md, row 1): the Dev build's
    /// `pa.exe` must not open the stable app's database or descriptor. The
    /// identifier comes from the build, shared with the app through
    /// `build_identifier`, never a hard-coded constant in this file.
    #[test]
    fn dev_identifier_selects_dev_data_dir() {
        assert_eq!(
            build_identifier::resolve_build_identifier(Some("com.projecta.dev")),
            "com.projecta.dev"
        );
        assert_eq!(
            build_identifier::resolve_build_identifier(None),
            "com.projecta.app"
        );
        let base = PathBuf::from("data-root");
        assert_eq!(
            data_path_in(
                &base,
                build_identifier::resolve_build_identifier(Some("com.projecta.dev")),
                "projecta.db"
            ),
            base.join("com.projecta.dev").join("projecta.db")
        );
        let source = include_str!("../pa.rs");
        assert!(
            !source.contains("const IDENTIFIER: &str = \"com.projecta.app\""),
            "IDENTIFIER must come from the build, not a hard-coded constant"
        );
    }

    /// Dev-build isolation (docs/setup/dev-build.md, row 1), the behaviour
    /// half: the resolved database path ends with the embedded build
    /// identifier, so a Dev build's `pa.exe` opens the Dev database, never
    /// the stable one. (R1290-C3: a source-text assertion here was satisfied
    /// by its own assertion message.)
    #[test]
    fn dev_identifier_resolves_the_database_under_the_build_identifier() {
        // `default_db_path` reads PROJECTA_APP_DATA process-wide: own it for
        // the duration of the call and put it back.
        let _guard = ENV_OVERRIDE_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let previous_dir = std::env::var_os(ENV_APP_DATA);
        std::env::remove_var(ENV_APP_DATA);
        let resolved = default_db_path();
        match previous_dir {
            Some(value) => std::env::set_var(ENV_APP_DATA, value),
            None => std::env::remove_var(ENV_APP_DATA),
        }
        let db = resolved.expect("the platform app-data base is available");
        assert_eq!(
            db.file_name().and_then(|name| name.to_str()),
            Some("projecta.db")
        );
        assert_eq!(
            db.parent()
                .and_then(|dir| dir.file_name())
                .and_then(|name| name.to_str()),
            Some(build_identifier::IDENTIFIER),
            "the database lives under the embedded build identifier: {}",
            db.display()
        );
    }

    #[test]
    fn a_worker_renders_as_labelled_lines() {
        let worker = json!({
            "id": "wk-1",
            "projectId": "pj-1",
            "kind": "worker",
            "profileId": "claude",
            "status": "running",
            "branch": "pa/wk-1",
            "worktreePath": "C:/tmp/wk-1",
            "task": "make the tests pass",
        });
        let rendered = render_worker(&worker);
        assert!(rendered.starts_with("id       wk-1\n"), "{rendered}");
        assert!(
            rendered.contains("task     make the tests pass\n"),
            "{rendered}"
        );
    }

    #[test]
    fn the_board_groups_by_column_and_names_the_reason() {
        let board = json!([
            {
                "worker": { "id": "wk-1", "task": "one" },
                "column": "needs_you",
                "attentionReason": "Claude needs your permission",
            },
            { "worker": { "id": "wk-2", "task": "two" }, "column": "working" },
        ]);
        let rendered = render_board(&board);

        // Working comes first whatever order the app sent.
        let working = rendered.find("working (1)").expect("working column");
        let needs_you = rendered.find("needs_you (1)").expect("needs_you column");
        assert!(working < needs_you, "{rendered}");
        assert!(
            rendered.contains("wk-1  one  <- Claude needs your permission"),
            "{rendered}"
        );
        assert_eq!(render_board(&json!([])), "no workers\n");
    }

    #[test]
    fn quota_rows_carry_the_reason_and_the_router() {
        let quota = json!([
            { "profileId": "claude", "state": "blocked", "reason": "5-hour limit reached",
              "omniRouteOnline": true },
            { "profileId": "kimi", "state": "ok", "reason": Value::Null,
              "omniRouteOnline": true },
        ]);
        let rendered = render_quota(&quota);
        assert!(
            rendered.contains("claude      blocked  5-hour limit reached\n"),
            "{rendered}"
        );
        assert!(rendered.contains("kimi        ok\n"), "{rendered}");
        assert!(rendered.contains("omniroute  online\n"), "{rendered}");
        assert_eq!(render_quota(&json!([])), "no quota information\n");
    }

    #[test]
    fn diagnosis_prints_log_path_and_panic_flag_only() {
        assert_eq!(
            render_diagnosis(&json!({"logPath": "/l/app.log", "panicPrevious": true})),
            "/l/app.log\npanic marker present — open Diagnose in the window\n"
        );
        assert_eq!(
            render_diagnosis(&json!({"logPath": "/l/app.log", "pack": "secret"})),
            "/l/app.log\nno panic marker\n"
        );
    }

    #[test]
    fn digest_takes_a_project_and_show_takes_a_date() {
        assert_eq!(
            parse("digest list --project pj-1"),
            Ok(Command::DigestList {
                project_id: "pj-1".to_string()
            })
        );
        assert_eq!(
            parse("digest show --project pj-1 2026-08-27"),
            Ok(Command::DigestShow {
                project_id: "pj-1".to_string(),
                date: "2026-08-27".to_string(),
            })
        );
        // The date may come first; the flag walker does not care about order.
        assert_eq!(
            parse("digest show 2026-08-27 --project pj-1"),
            Ok(Command::DigestShow {
                project_id: "pj-1".to_string(),
                date: "2026-08-27".to_string(),
            })
        );

        assert!(parse("digest list").unwrap_err().contains("--project"));
        assert!(parse("digest show --project pj-1")
            .unwrap_err()
            .contains("usage: pa digest show"));
        assert!(parse("digest show --project pj-1 a b")
            .unwrap_err()
            .contains("usage: pa digest show"));
        assert!(parse("digest nope")
            .unwrap_err()
            .contains("unknown digest subcommand: nope"));
    }

    #[test]
    fn a_digest_list_is_one_date_per_line() {
        let dates = json!(["2026-08-27", "2026-08-26"]);
        assert_eq!(render_digest_list(&dates), "2026-08-27\n2026-08-26\n");
        assert_eq!(render_digest_list(&json!([])), "no digests\n");
        assert_eq!(render_digest_list(&json!({})), "no digests\n");
    }

    #[test]
    fn a_digest_page_prints_verbatim_or_names_the_missing_date() {
        let page = json!({ "markdown": "# Digest\n" });
        assert_eq!(render_digest_show(&page, "2026-08-27"), "# Digest\n");
        assert_eq!(
            render_digest_show(&json!({}), "2026-08-27"),
            "(no digest for 2026-08-27)\n"
        );
    }

    #[test]
    fn budget_set_names_the_windows_it_changes() {
        assert_eq!(parse("budget list"), Ok(Command::BudgetList));
        assert_eq!(
            parse("budget list --project pj-1").unwrap_err(),
            "budget list takes no arguments, got --project"
        );

        assert_eq!(
            parse("budget set --profile claude --five-hour 90"),
            Ok(Command::BudgetSet {
                profile_id: "claude".to_string(),
                five_hour: Some(Some(90)),
                seven_day: None,
            })
        );
        // `off` is how a ceiling is removed; the other window stays untouched.
        assert_eq!(
            parse("budget set --profile claude --seven-day off"),
            Ok(Command::BudgetSet {
                profile_id: "claude".to_string(),
                five_hour: None,
                seven_day: Some(None),
            })
        );

        // Naming no window at all would be a request with nothing in it.
        assert!(parse("budget set --profile claude")
            .unwrap_err()
            .contains("--five-hour or --seven-day"));
        assert!(parse("budget set --five-hour 90")
            .unwrap_err()
            .contains("--profile is required"));
        for bad in ["0", "101", "ninety", "-5"] {
            assert!(
                parse(&format!("budget set --profile claude --five-hour={bad}"))
                    .unwrap_err()
                    .contains("--five-hour"),
                "{bad} was accepted"
            );
        }
        assert!(parse("budget nope")
            .unwrap_err()
            .contains("unknown budget subcommand: nope"));
    }

    #[test]
    fn budgets_render_one_row_per_profile_and_a_dash_for_no_ceiling() {
        let budgets = json!([
            { "profileId": "claude", "fiveHourPct": 90, "sevenDayPct": 80 },
            { "profileId": "kimi", "fiveHourPct": Value::Null, "sevenDayPct": 70 },
        ]);
        let rendered = render_budgets(&budgets);
        assert!(rendered.contains("claude      90%    80%\n"), "{rendered}");
        assert!(
            rendered.contains("kimi        \u{2014}      70%\n"),
            "{rendered}"
        );
        assert_eq!(render_budgets(&json!([])), "no budgets set\n");
        assert_eq!(render_budgets(&json!({})), "no budgets set\n");
    }

    #[test]
    fn providers_takes_no_arguments() {
        assert_eq!(parse("providers"), Ok(Command::Providers));
        assert_eq!(
            parse("providers --project pj-1"),
            Err("providers takes no arguments, got --project".to_string())
        );
    }

    #[test]
    fn provider_rows_say_what_was_found_without_saying_the_key() {
        let providers = json!([
            { "id": "claude", "name": "Claude Code", "kind": "subscription", "connected": true,
              "detail": "1.2.3 \u{b7} signed in", "quotaState": "blocked",
              "blockedUntil": 1_800_000_000_i64, "omniRouteOnline": false,
              "usage": { "percent": 87, "used": "562,0 k Tokens", "limit": "1,0 M Tokens",
                         "windowLabel": "5-Stunden-Fenster", "resetsAt": 1_800_000_000_i64,
                         "source": "hook", "observedAt": 1_800_000_000_i64 } },
            { "id": "kimi", "name": "Kimi CLI", "kind": "subscription", "connected": false,
              "detail": Value::Null, "quotaState": "unknown", "blockedUntil": Value::Null,
              "omniRouteOnline": false, "usage": Value::Null },
            { "id": "openrouter", "name": "OpenRouter", "kind": "api_key", "connected": true,
              "detail": "key stored", "quotaState": "unknown", "blockedUntil": Value::Null,
              "omniRouteOnline": false,
              "usage": { "percent": Value::Null, "used": "$3.71", "limit": Value::Null,
                         "windowLabel": "OpenRouter", "resetsAt": Value::Null,
                         "source": "api", "observedAt": 1 } },
        ]);
        let rendered = render_providers(&providers);

        assert!(rendered.contains("claude"), "{rendered}");
        assert!(rendered.contains("subscription"), "{rendered}");
        assert!(rendered.contains("connected"), "{rendered}");
        assert!(rendered.contains("blocked"), "{rendered}");
        assert!(rendered.contains("87%"), "{rendered}");
        assert!(rendered.contains("1.2.3"), "{rendered}");

        assert!(rendered.contains("kimi"), "{rendered}");
        assert!(rendered.contains("not found"), "{rendered}");
        assert!(rendered.contains("unknown"), "{rendered}");
        assert!(rendered.contains("—"), "{rendered}");

        assert!(rendered.contains("openrouter"), "{rendered}");
        assert!(rendered.contains("api_key"), "{rendered}");
        // A known amount without a percentage renders the amount, not a dash.
        assert!(rendered.contains("$3.71 (OpenRouter)"), "{rendered}");
        assert!(rendered.contains("key stored"), "{rendered}");
        assert!(
            !rendered.contains("sk-"),
            "a key must never be printed: {rendered}"
        );

        assert_eq!(render_providers(&json!([])), "no providers\n");
        assert_eq!(render_providers(&json!({})), "no providers\n");
    }

    #[test]
    fn a_context_window_is_reported_as_a_percentage() {
        let state = json!({
            "worker": { "id": "wk-1" },
            "column": "working",
            "contextUsage": { "used": 45_000, "total": 200_000 },
        });
        assert!(
            render_worker_state(&state).contains("context  45000/200000 tokens (22%)"),
            "{}",
            render_worker_state(&state)
        );
    }
