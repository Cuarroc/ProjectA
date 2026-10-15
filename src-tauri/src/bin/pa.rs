//! `pa` - the ProjectA bridge.
//!
//! A running ProjectA publishes a token-guarded JSON API on a loopback port and
//! writes the port and the token to `<app data dir>/projecta-api.json`. This
//! binary is the other end of that: it reads the descriptor, makes one request,
//! prints the answer as plain text, and exits.
//!
//! ```text
//! pa worker spawn --project pj-1 --task "make the tests pass" [--profile claude]
//! pa worker spawn --project pj-1 --task "fix the flake" --on-behalf-of wk-queen
//! pa worker list [--project pj-1]
//! pa worker status wk-1
//! pa worker send wk-1 "ja, weiter"
//! pa worker done
//! pa worker blocked --reason "tests fail on Windows"
//! pa worker merge wk-1 [--remove-worktree]
//! pa tell --project pj-1 "bau mir das Login"
//! pa queen spawn --project pj-1 --task "Backend-API"   (retired, Rev 9)
//! pa queue add --project pj-1 --task "zieh das nach" [--priority 5] [--on-behalf-of wk-queen]
//! pa queue list [--project pj-1]
//! pa queue cancel tq-1
//! pa board [--project pj-1]
//! pa tree [--project pj-1]
//! pa activity [--project pj-1] [--limit 50]
//! pa quota
//! pa quota list
//! pa estop [status|on|off]
//! pa diagnosis
//! pa budget list
//! pa budget set --profile claude [--five-hour 90] [--seven-day off]
//! pa digest list --project pj-1
//! pa digest show --project pj-1 2026-08-27
//! pa stats --project pj-1 [--range week]
//! pa providers
//! pa usage [--limit 50]
//! pa hq runtime
//! pa hq agent context|candidate|evidence|review|read-evidence
//! pa hq changes --project <projectId> [--cursor <n>] [--wait-ms <0..25000>]
//! pa hq runs --project pj-1
//! pa hq plan --project pj-1 --plan main [--revision 1]
//! pa hq plan-import --project pj-1 --plan main --expected-revision 0 [--rollback-reason TEXT]
//! pa hq context --project pj-1 [--cursor 0]
//! pa hq goals list|create --project pj-1
//! pa hq tasks create|claim|checkpoint <id>
//! pa hq tasks assignment <taskId>
//! pa hq tasks assign <taskId> --team <id> --role <role> --assignee <owner> --expected-revision <n>
//! pa hq control --project pj-1 --action pause|drain|cancel|resume
//! pa db restore [--from <bak>] [--dest <db>] --yes
//! pa scout triage --project pj-1 https://github.com/o/r ...
//! pa github create --project pj-1 [--name <n>] [--public]
//! pa github link --project pj-1 https://github.com/o/r
//! pa project create --name Golden --path C:/scratch [--verdict-token <token>]
//! pa project landing-page --project pj-1
//! pa project set-landing-page --project pj-1 --file page.md
//! pa recommendations list [--project pj-1]
//! pa recommendations accept rc-1
//! pa recommendations dismiss rc-1
//! pa learnings list [--project pj-1] [--status pending]
//! pa learnings approve lr-1 [--text "..."] --verdict-token <token>
//! pa learnings reject lr-1 --verdict-token <token>
//! pa roles list [--project pj-1] [--status pending]
//! pa roles approve rv-1 --verdict-token <token>
//! pa roles reject rv-1 --verdict-token <token>
//! pa ask --project pj-1 --worker wk-1 --question "Postgres oder SQLite?" [--options "A,B,C"]
//! pa answer <questionId> "SQLite" [--verdict-token <token>]
//! pa questions list [--project pj-1] [--status open]
//! ```
//!
//! The four verdict commands are the only ones that want a second token, and
//! they want it because approving a learning writes into the project's
//! PLAYBOOK.md, which every later agent is prompted with. The api token cannot
//! keep an agent out of that: it is in a file every agent may read. The verdict
//! token is in no file at all - the app hands it to its own window, and to
//! whoever the user gives it to here. Without it the app answers 403, which is
//! the intended answer for an agent that tried.
//!
//! How it gets here matters as much as that it does (F-SEC-5). `--verdict-token
//! <value>` puts it in argv, where every process of this user can read it while
//! the call runs and where the shell writes it down for good;
//! `PA_VERDICT_TOKEN` puts it in the environment, which is readable the same
//! way. So the flag also takes `-` (one line from a pipe on standard input) and
//! `@<path>` (the first line of a file):
//!
//! - `-` keeps the token out of argv *and* out of the shell history - as long as
//!   the shell does not put it there on the way in. `printf %s "$TOKEN" | pa …`
//!   reads from an environment variable the shell already holds; `echo <token> |`
//!   or a here-string writes it back into the history.
//! - `@<path>` trades the token in argv for a path. The file itself is the copy,
//!   and it is the caller's to place and to keep private; `pa` refuses one that
//!   other users can read (Unix only - Windows has no equivalent bit here).
//!
//! The rule behind both is the one `providers.rs` states for the OpenRouter key:
//! "`argv` is world-readable on the machine (`/proc/<pid>/cmdline`, `ps aux`),
//! the child's standard input is not." That code *writes* into curl's standard
//! input and `--config -` is curl's own flag; `pa` is the first place here that
//! *reads* a secret this way. A named source that cannot be read is an error,
//! not a quiet fallback to "no token".
//!
//! It exists for the orchestrator agents: they are told to plan work and to run
//! everything else through `pa`, which keeps them out of the codebase and out of
//! each other's worktrees.
//!
//! `PROJECTA_API_FILE` overrides where the descriptor is looked for, which is
//! how you point `pa` at a development build. `PROJECTA_APP_DATA` points at
//! the app-data directory itself (the folder that holds `projecta-api.json`),
//! for isolated F8 runs that must not open the production database.
//!
//! Deliberately dependency-free apart from `serde_json`: this talks to
//! `127.0.0.1` and reads one JSON document, and a `TcpStream` does that.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpStream};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

#[path = "../build_identifier.rs"]
mod build_identifier;
#[path = "../db_restore.rs"]
mod db_restore;
#[path = "../fs_replace.rs"]
mod fs_replace;
#[path = "pa/render_stats.rs"]
mod render_stats;
use render_stats::render_stats;
#[path = "pa/render_ops.rs"]
mod render_ops;
use render_ops::{render_diagnosis, render_emergency_stop, render_quota};

/// Descriptor written by the app on startup.
const DESCRIPTOR_FILE: &str = "projecta-api.json";

/// The bundle identifier this build carries; the app data directory is named
/// after it. Embedded by the build and shared with the app: the Dev build
/// gets `com.projecta.dev`, everything else falls back to the stable one.
use build_identifier::IDENTIFIER;

/// Header carrying the shared token.
const TOKEN_HEADER: &str = "x-projecta-token";

/// Header carrying the verdict token, which the four review routes want on top
/// of [`TOKEN_HEADER`].
const VERDICT_TOKEN_HEADER: &str = "x-verdict-token";

/// Where the verdict token may come from instead of `--verdict-token`.
const ENV_VERDICT_TOKEN: &str = "PA_VERDICT_TOKEN";

/// Points `pa` at a descriptor somewhere else.
const ENV_DESCRIPTOR: &str = "PROJECTA_API_FILE";

/// Points `pa` at an isolated app-data directory (same contract as the app).
const ENV_APP_DATA: &str = "PROJECTA_APP_DATA";

/// Creating a worker checks out a git worktree and starts an agent, which is
/// not instant on a cold repository.
const IO_TIMEOUT: Duration = Duration::from_secs(30);

/// Same product contract as `workers::ERR_QUEEN_RETIRED`, without the HTTP
/// prefix: the CLI never posts.
const QUEEN_SPAWN_RETIRED: &str = "queen creation is retired; existing queens remain readable";

const USAGE: &str = "\
pa - the ProjectA bridge

USAGE
  pa worker spawn --project <projectId> --task <task> [--profile <profileId>] [--on-behalf-of <workerId>]
  pa worker list [--project <projectId>]
  pa worker status <workerId>
  pa worker send <workerId> <text>
  pa worker done
  pa worker blocked --reason <text>
  pa worker merge <workerId> [--remove-worktree] [--verdict-token <token>]
  pa tell --project <projectId> <text>
  pa queen spawn --project <projectId> --task <domain>   (retired, Rev 9)
  pa queue add --project <projectId> --task <task> [--profile <profileId>] [--priority <n>] [--sharpen] [--on-behalf-of <workerId>]
  pa queue list [--project <projectId>]
  pa queue cancel <queueId>
  pa scout triage --project <projectId> <url>...
  pa github create --project <projectId> [--name <name>] [--public]
  pa github link --project <projectId> <url>
  pa project create --name <name> --path <repo> [--verdict-token <token>]
  pa project landing-page --project <projectId>
  pa project set-landing-page --project <projectId> --file <path>
  pa recommendations list [--project <projectId>]
  pa recommendations accept <recommendationId>
  pa recommendations dismiss <recommendationId>
  pa learnings list [--project <projectId>] [--status <status>]
  pa learnings approve <learningId> [--text <text>] [--verdict-token <token>]
  pa learnings reject <learningId> [--verdict-token <token>]
  pa roles list [--project <projectId>] [--status <pending|approved|rejected>]
  pa roles approve <roleVariantId> [--verdict-token <token>]
  pa roles reject <roleVariantId> [--verdict-token <token>]
  pa ask --project <projectId> [--worker <workerId>] --question <text> [--options <A,B,C>]
  pa answer <questionId> <text> [--verdict-token <token>]
  pa questions list [--project <projectId>] [--status <open|answered|expired|refused>]
  pa board [--project <projectId>]
  pa tree [--project <projectId>]
  pa activity [--project <projectId>] [--limit <n>]
  pa quota
  pa quota list
  pa estop [status|on|off] [--verdict-token <token> with off]
  pa diagnosis
  pa budget list
  pa budget set --profile <profileId> [--five-hour <1-100|off>] [--seven-day <1-100|off>]
  pa digest list --project <projectId>
  pa digest show --project <projectId> <YYYY-MM-DD>
  pa stats --project <projectId> [--range <today|week|month|all|7d|30d>]
  pa providers
  pa usage [--limit <n>]
  pa hq runtime
  (All hq agent commands below require a scoped PROJECTA_API_FILE.)
  pa hq agent context
  pa hq agent lessons
  pa hq agent release
  pa hq agent checkpoint --input <json-file>
  pa hq agent read-checkpoint --revision <positive-integer>
  pa hq agent read-evidence --id <evidence-id>
  pa hq agent list-evidence [--cursor <nextCursor>]
  pa hq agent list-reviews [--cursor <nextCursor>]
  pa hq agent candidate|evidence|review --input <json-file>
  pa hq runs --project <projectId>
  pa hq plan --project <projectId> --plan <planId> [--revision <positive-integer>]
  pa hq plan-import --project <projectId> --plan <planId> --expected-revision <non-negative-integer> [--rollback-reason <text>]
  pa hq context --project <projectId> [--cursor <n>]
  pa hq changes --project <projectId> [--cursor <n>] [--wait-ms <0..25000>]
  pa hq goals list --project <projectId>
  pa hq goals create --project <projectId> --objective <text> [--acceptance <text>] [--source-goal <id>] [--admit]
  pa hq tasks create <goalId> --objective <text> --owned <path,path> [--profile <profileId>] [--depends <taskId,taskId>]
  pa hq tasks claim <taskId> --owner <id> [--escalation]
  pa hq tasks assignment <taskId>
  pa hq tasks assign <taskId> --team <id> --role <role> --assignee <owner> --expected-revision <n>
  pa hq tasks checkpoint <taskId> --owner <id> --fence <n> [--status <running|completed|cancelled|failed|retry>] [--detail <text>]
  pa hq control --project <projectId> --action <pause|drain|resume|cancel>
  pa db restore [--from <bak>] [--dest <db>] --yes

NOTES
  --profile defaults to claude.
  `github create` creates the repository on GitHub and pushes the project;
  it is private unless --public is given, and the repository name defaults
  to the project's name.
  `github link` points an existing GitHub repository at the project as origin.
  `project create` registers a git work tree the same way the New Project
  dialog does and prints the new id. The path has to already be a repository.
  In production it needs --verdict-token (or PA_VERDICT_TOKEN): the API token
  is in a file every agent may read. Isolated F8 runs (`PROJECTA_APP_DATA`)
  omit it.
  `project landing-page` prints the project's Markdown landing page;
  `set-landing-page` stores the content of the given file as that page.
  `worker send` hands the text to the delivery guard, which waits for the
  agent's readiness marker before it writes and presses Enter. Success means
  the guard took the text, not that the agent already has it - the worker's
  history says which. Pass \"\" to press Enter on its own.
  `worker merge` merges a card that is ready to merge: a pull request where
  the project has a GitHub remote, a local merge into the base branch where
  it has none. It is a human verdict and needs --verdict-token (or
  PA_VERDICT_TOKEN). The worker has to be archived or exited first, and with
  a test command configured its gate has to be green and bound to the merge
  tree. --remove-worktree deletes the checkout once the merge is in; without
  it the worktree stays. Merging is a human decision - no agent is told this
  command exists.
  `tell` says the text to the project's orchestrator and prints its id; it
  starts the orchestrator if the project has none running, so it is also how
  a conversation begins.
  `quota` prints the live quota rows. `diagnosis` prints the log file path
  and whether a panic marker is waiting; the pack itself stays in the window.
  `budget list` shows the percentage ceilings per agent profile; `budget set`
  writes one. The percentages are read against the provider's own rate-limit
  windows (five hours and seven days), and a profile that reaches its ceiling
  is blocked like any other quota block: the dispatcher skips it and its
  running agents are stopped, with the worktrees left where they are. `off`
  removes a ceiling; a window that is not named is left as it was.
  `digest list` prints the days this project has a daily digest for, newest
  first; `show` prints one of them. The pages are written once an hour for
  the day that is already over and live in <repo>/.pa/memory/digests/, which
  is gitignored - they are reading material for the vault, not repository
  artefacts.
  `stats` takes the project id as --project or as a bare argument. It
  prints one project's numbers: workers per board column, queue,
  sessions, activity per day and a *derived* completion estimate whose
  weighting is printed beside it. --range defaults to all. Two figures are
  deliberately not invented: token usage says \"not measured\" unless the
  OmniRoute ledger has rows for the window - an agent that talks to its
  vendor directly spends tokens nothing here can count - and the completion
  figure is always labelled as an estimate, never as \"done to X %\".
  `providers` lists what this machine can reach - installed, signed in,
  answering locally or keyed - beside what each provider is saying about
  quota. It never prints a key.
  `usage` prints what OmniRoute has routed: the last requests it logged, the
  totals for today and for everything stored, and the router's own lifetime
  cost. --limit defaults to 50 and is capped at 500. Two honest gaps are
  printed as such rather than filled in: the per-request log carries tokens
  but no price, so a row's cost is \"—\" and the dollars come from OmniRoute's
  own total; and the log carries no session or client, so a request cannot be
  traced back to the worker that made it. Without a management token in the
  vault the ledger does not fill at all and the command says so.
  `db restore` copies a `.pre-migration-*.bak` over the live database and
  never talks to HTTP. Quit ProjectA first. --yes is required. --from
  defaults to the newest bak next to the dest; --dest defaults to the
  app-data `projecta.db` (`PROJECTA_APP_DATA` wins).
  `scout triage` starts one research agent that judges every url given and
  writes one recommendation per repository - including the ones it advises
  against.
  `recommendations accept` queues the integration work and prints the queue
  entry it made; `dismiss` marks the recommendation rejected and queues
  nothing.
  `learnings list` shows what finished runs taught this project; --status
  narrows it to pending, approved or rejected. `approve` writes the learning
  into the project's PLAYBOOK.md - with --text the wording you give it, and
  without it the text as stored. Approving and rejecting are human decisions;
  no agent is told these two commands exist.
  `roles list` shows the specialised roles this project distilled out of its
  approved learnings; --status narrows it to pending, approved or rejected.
  A role is only ever proposed - `approve` is what makes one usable, and it
  retires the version it replaces. Approving and rejecting are human
  decisions; no agent is told these two commands exist.
  The four verdict commands need --verdict-token, or PA_VERDICT_TOKEN in the
  environment. That token is deliberately not in projecta-api.json: an approve
  ends up in the project's PLAYBOOK.md and from there in every later agent's
  prompt, so it stays with the human. The app shows it in its own window;
  hand it to this command line yourself. Without it ProjectA answers 403, and
  a row that already carries a verdict answers 409.
  Everywhere --verdict-token appears above it takes three spellings, and two of
  them keep the token out of argv, where any other process of this user can read
  it while the call runs:
    --verdict-token -            one line from a pipe on standard input; a
                                 terminal is refused rather than prompted, so
                                 the token is never echoed to the screen
    --verdict-token @<path>      the first line of a file; refused if other
                                 users can read it (Unix; not checked on
                                 Windows)
    --verdict-token <token>      the token itself - convenient, and visible in
                                 ps/procfs while the call runs
  The token stays out of the shell history only if the shell keeps it out:
    printf %s \"$TOKEN\" | pa learnings approve lr-1 --verdict-token -
    pa learnings approve lr-1 --verdict-token @\"$XDG_RUNTIME_DIR/pa.token\"
  An echo of the literal token or a here-string writes it back into the history.
  PA_VERDICT_TOKEN has the same exposure as the third spelling and is always the
  token itself - the three spellings belong to the flag. Prefer - or @<path> when
  the machine has other users or agents on it. A named source that is empty,
  unreadable or too permissive is an error, not a silent \"no token\".
  `ask` hands a blocking decision back to the human. It does NOT wait: the
  question is recorded, the worker\'s card goes to needs_you, and the answer
  arrives later as input in that worker\'s terminal - so ask, say that you
  are waiting for the decision, and end your turn. Only for decisions you
  cannot sensibly proceed without; never for small change. A worker may have
  three questions open at a time, and the fourth is answered on the spot with
  \"entscheide selbst\"; a question nobody answers within four hours is
  answered the same way. Without --worker the question is a preflight one:
  it belongs to a prompt that is being sharpened, not to a running agent.
  `answer` closes one open question, prints it, and types the answer into
  the worker\'s terminal. `questions list` shows what is waiting and what was
  decided; --status narrows it to open, answered, expired or refused.
  --on-behalf-of books the new agent under the worker that ordered it,
  which is what hangs it into that worker's branch of the hierarchy.
  `queue add` takes --on-behalf-of too, so a coordinator that is at the
  worker limit and has to queue instead of spawn keeps its booking.
  `queue add --priority` is a whole number and 0 when it is not given; the
  dispatcher takes the highest first and queued order decides the rest.
  `tree` prints that hierarchy: every coordinator with its agents nested
  underneath, and the workers nobody claimed after them.
  `activity` prints the fleet-wide event feed, newest first: spawns, status
  changes, messages, queued tasks, recommendations, learnings and role
  proposals. --limit defaults to 50 and is capped at 200.
  ProjectA must be running: pa talks to the port named in projecta-api.json.
  PROJECTA_API_FILE overrides where that file is looked for.
  PROJECTA_APP_DATA points at the app-data folder (isolated F8 / scratch runs).";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Err(err) = run(&args) {
        eprintln!("pa: {err}");
        std::process::exit(1);
    }
}

fn run(args: &[String]) -> Result<(), String> {
    let command = parse_args(args)?;
    if command == Command::Help {
        println!("{USAGE}");
        return Ok(());
    }

    // Retired / offline before the descriptor is opened: no HTTP, no API file.
    if matches!(command, Command::QueenSpawn { .. }) {
        return Err(QUEEN_SPAWN_RETIRED.to_string());
    }
    if let Command::DbRestore { from, dest, yes } = command {
        return run_db_restore(from, dest, yes);
    }

    let api = Api::load()?;
    match command {
        Command::Help => unreachable!("handled above"),

        Command::HqRuntime => print_json(&api.get("/api/hq/v1/runtime", None)?),
        Command::HqAgent { operation, input } => {
            let path = format!("/api/hq/v1/agent/{operation}");
            let value = match input {
                None => api.get(&path, None)?,
                Some(file) => {
                    let raw = std::fs::read_to_string(&file)
                        .map_err(|e| format!("cannot read input {file}: {e}"))?;
                    let body: Value = serde_json::from_str(&raw)
                        .map_err(|e| format!("invalid JSON input: {e}"))?;
                    api.post(&path, body)?
                }
            };
            print_json(&value);
        }
        Command::HqRuns { project_id } => {
            print_json(&api.get("/api/hq/v1/runs", Some(&project_id))?)
        }
        Command::HqPlan { .. } | Command::HqPlanImport { .. } => {
            print_json(&request_plan_command(&api, &command)?);
        }
        Command::HqContext {
            project_id,
            cursor,
            changes_only,
            wait_ms,
        } => {
            if let Some(wait_ms) = wait_ms.filter(|value| *value > 0) {
                require_journal_wait(&api.get("/api/hq/v1/runtime", None)?, wait_ms)?;
            }
            let cursor = cursor.map(|value| value.to_string());
            let wait_ms = wait_ms.map(|value| value.to_string());
            print_json(&api.get_filtered(
                if changes_only {
                    "/api/hq/v1/changes"
                } else {
                    "/api/hq/v1/context"
                },
                &[
                    ("projectId", Some(project_id.as_str())),
                    ("cursor", cursor.as_deref()),
                    ("waitMs", wait_ms.as_deref()),
                ],
            )?);
        }
        Command::HqGoalsList { project_id } => {
            print_json(&api.get("/api/hq/v1/goals", Some(&project_id))?)
        }
        Command::HqGoalCreate {
            project_id,
            objective,
            acceptance_criteria,
            source_goal_id,
            admit,
        } => {
            let mut body = json!({ "projectId": project_id, "objective": objective });
            if let Some(value) = acceptance_criteria {
                body["acceptanceCriteria"] = Value::String(value);
            }
            if let Some(value) = source_goal_id {
                body["sourceGoalId"] = Value::String(value);
            }
            if admit {
                body["admit"] = Value::Bool(true);
            }
            print_json(&api.post("/api/hq/v1/goals", body)?);
        }
        Command::HqTaskCreate {
            goal_id,
            objective,
            profile_id,
            owned_paths,
            dependencies,
        } => {
            let mut body = json!({ "objective": objective, "ownedPaths": owned_paths, "dependencies": dependencies });
            if let Some(value) = profile_id {
                body["profileId"] = Value::String(value);
            }
            print_json(&api.post(
                &format!("/api/hq/v1/goals/{}/tasks", encode(&goal_id)),
                body,
            )?);
        }
        Command::HqTaskAssignment { task_id, body } => {
            let path = format!("/api/hq/v1/tasks/{}/assignment", encode(&task_id));
            print_json(&match body {
                Some(body) => api.post(&path, body)?,
                None => api.get(&path, None)?,
            });
        }
        Command::HqTaskClaim {
            task_id,
            owner,
            escalation,
        } => print_json(&api.post(
            &format!("/api/hq/v1/tasks/{}/claim", encode(&task_id)),
            json!({ "owner": owner, "escalation": escalation }),
        )?),
        Command::HqTaskCheckpoint {
            task_id,
            owner,
            fence,
            status,
            detail,
        } => {
            let mut body = json!({ "owner": owner, "fence": fence });
            if let Some(value) = status {
                body["status"] = Value::String(value);
            }
            if let Some(value) = detail {
                body["detail"] = Value::String(value);
            }
            print_json(&api.post(
                &format!("/api/hq/v1/tasks/{}/checkpoint", encode(&task_id)),
                body,
            )?);
        }
        Command::HqControl { project_id, action } => print_json(&api.post(
            "/api/hq/v1/control",
            json!({ "projectId": project_id, "action": action }),
        )?),

        Command::WorkerSpawn {
            project_id,
            task,
            profile_id,
            spawned_by,
        } => {
            let mut body = json!({ "projectId": project_id, "task": task });
            if let Some(profile_id) = profile_id {
                body["profileId"] = Value::String(profile_id);
            }
            if let Some(spawned_by) = spawned_by {
                body["spawnedBy"] = Value::String(spawned_by);
            }
            let worker = api.post("/api/workers", body)?;
            print!("{}", render_worker(&worker));
        }

        Command::QueenSpawn { .. } => return Err(QUEEN_SPAWN_RETIRED.to_string()),

        Command::WorkerList { project_id } => {
            let workers = api.get("/api/workers", project_id.as_deref())?;
            print!("{}", render_worker_list(&workers));
        }

        Command::WorkerStatus { worker_id } => {
            let state = api.get(&format!("/api/workers/{}", encode(&worker_id)), None)?;
            print!("{}", render_worker_state(&state));
        }

        Command::WorkerSend { worker_id, text } => {
            let path = format!("/api/workers/{}/send", encode(&worker_id));
            api.post(&path, json!({ "text": text }))?;
            println!("sent to {worker_id}");
        }

        Command::WorkerDone => {
            let delivery = api.post("/api/hq/v1/agent/delivery", json!({ "outcome": "done" }))?;
            print!("{}", render_worker_delivery(&delivery));
        }

        Command::WorkerBlocked { reason } => {
            let delivery = api.post(
                "/api/hq/v1/agent/delivery",
                json!({ "outcome": "blocked", "reason": reason }),
            )?;
            print!("{}", render_worker_delivery(&delivery));
        }

        Command::WorkerMerge {
            worker_id,
            remove_worktree,
            verdict_token: token,
        } => {
            let path = format!("/api/workers/{}/merge", encode(&worker_id));
            let worker = api.post_verdict(
                &path,
                json!({ "removeWorktree": remove_worktree }),
                verdict_token(token)?,
            )?;
            print!("{}", render_worker(&worker));
        }

        Command::Tell {
            project_id,
            text: message,
        } => {
            let path = format!("/api/projects/{}/orchestrator/send", encode(&project_id));
            let orchestrator = api.post(&path, json!({ "text": message }))?;
            // The orchestrator's id is the one thing the caller cannot guess,
            // and it is what every follow-up command needs.
            println!("sent to {}", text(&orchestrator, "id"));
        }

        Command::QueueAdd {
            project_id,
            task,
            profile_id,
            sharpen,
            priority,
            spawned_by,
        } => {
            let mut body = json!({ "projectId": project_id, "rawText": task, "sharpen": sharpen });
            if let Some(profile_id) = profile_id {
                body["profileId"] = Value::String(profile_id);
            }
            if let Some(priority) = priority {
                body["priority"] = json!(priority);
            }
            // Same field and the same silence as `worker spawn`: nobody named
            // means nobody booked, so the key stays out rather than going null.
            if let Some(spawned_by) = spawned_by {
                body["spawnedBy"] = Value::String(spawned_by);
            }
            let entry = api.post("/api/queue", body)?;
            print!("{}", render_queue_entry(&entry));
        }

        Command::QueueList { project_id } => {
            let entries = api.get("/api/queue", project_id.as_deref())?;
            print!("{}", render_queue_list(&entries));
        }

        Command::QueueCancel { id } => {
            api.post(&format!("/api/queue/{}/cancel", encode(&id)), json!({}))?;
            println!("cancelled {id}");
        }

        Command::ScoutTriage { project_id, urls } => {
            let worker = api.post(
                "/api/scout/triage",
                json!({ "projectId": project_id, "urls": urls }),
            )?;
            print!("{}", render_worker(&worker));
        }

        Command::GithubCreate {
            project_id,
            name,
            public,
        } => {
            // The repository name defaults to the project's name, which only
            // the app knows - so a plain `pa github create` asks once.
            let name = match name {
                Some(name) => name,
                None => {
                    let projects = api.get("/api/projects", None)?;
                    projects
                        .as_array()
                        .and_then(|rows| {
                            rows.iter().find(|row| {
                                row.get("id").and_then(Value::as_str) == Some(project_id.as_str())
                            })
                        })
                        .and_then(|row| row.get("name"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .ok_or_else(|| format!("unknown project: {project_id}"))?
                }
            };
            let repo_url = api.post(
                &format!("/api/projects/{}/github/create", encode(&project_id)),
                json!({ "name": name, "private": !public }),
            )?;
            if let Some(url) = repo_url.as_str() {
                println!("{url}");
            } else {
                println!("{repo_url}");
            }
        }

        Command::GithubLink { project_id, url } => {
            api.post(
                &format!("/api/projects/{}/github/link", encode(&project_id)),
                json!({ "url": url }),
            )?;
            println!("linked {url}");
        }

        Command::ProjectCreate {
            name,
            repo_path,
            verdict_token: token,
        } => {
            let project = api.post_verdict(
                "/api/projects",
                json!({ "name": name, "repoPath": repo_path }),
                verdict_token(token)?,
            )?;
            print!("{}", render_project(&project));
        }

        Command::ProjectLandingPage { project_id } => {
            let page = api.get(
                &format!("/api/projects/{}/landing-page", encode(&project_id)),
                None,
            )?;
            match page.get("markdown").and_then(Value::as_str) {
                Some(markdown) => print!("{markdown}"),
                None => println!("(no landing page yet)"),
            }
        }

        Command::ProjectSetLandingPage { project_id, file } => {
            let markdown = std::fs::read_to_string(&file)
                .map_err(|e| format!("failed to read {file}: {e}"))?;
            api.post(
                &format!("/api/projects/{}/landing-page", encode(&project_id)),
                json!({ "markdown": markdown }),
            )?;
            println!("landing page of {project_id} updated");
        }

        Command::RecommendationsList { project_id } => {
            let recommendations = api.get("/api/recommendations", project_id.as_deref())?;
            print!("{}", render_recommendation_list(&recommendations));
        }

        Command::RecommendationsAccept { id } => {
            // Accepting queues the integration work, so what comes back is a
            // queue entry - print it the way `queue add` prints its own.
            let entry = api.post(
                &format!("/api/recommendations/{}/accept", encode(&id)),
                json!({}),
            )?;
            print!("{}", render_queue_entry(&entry));
        }

        Command::RecommendationsDismiss { id } => {
            api.post(
                &format!("/api/recommendations/{}/status", encode(&id)),
                json!({ "status": "dismissed" }),
            )?;
            println!("dismissed {id}");
        }

        Command::LearningsList { project_id, status } => {
            let learnings = api.get_filtered(
                "/api/learnings",
                &[
                    ("projectId", project_id.as_deref()),
                    ("status", status.as_deref()),
                ],
            )?;
            print!("{}", render_learning_list(&learnings));
        }

        Command::LearningsApprove {
            id,
            text,
            verdict_token: token,
        } => {
            // Without --text the stored wording is what gets approved, and the
            // only place to read it is the list: there is no single-learning
            // route, and inventing one for a convenience flag is not worth it.
            let text = match text {
                Some(text) => text,
                None => stored_learning_text(&api, &id)?,
            };
            api.post_verdict(
                &format!("/api/learnings/{}/approve", encode(&id)),
                json!({ "text": text }),
                verdict_token(token)?,
            )?;
            println!("approved {id}");
        }

        Command::LearningsReject {
            id,
            verdict_token: token,
        } => {
            api.post_verdict(
                &format!("/api/learnings/{}/reject", encode(&id)),
                json!({}),
                verdict_token(token)?,
            )?;
            println!("rejected {id}");
        }

        Command::RolesList { project_id, status } => {
            let roles = api.get_filtered(
                "/api/roles",
                &[
                    ("projectId", project_id.as_deref()),
                    ("status", status.as_deref()),
                ],
            )?;
            print!("{}", render_role_list(&roles));
        }

        Command::RolesApprove {
            id,
            verdict_token: token,
        } => {
            api.post_verdict(
                &format!("/api/roles/{}/approve", encode(&id)),
                json!({}),
                verdict_token(token)?,
            )?;
            println!("approved {id}");
        }

        Command::RolesReject {
            id,
            verdict_token: token,
        } => {
            api.post_verdict(
                &format!("/api/roles/{}/reject", encode(&id)),
                json!({}),
                verdict_token(token)?,
            )?;
            println!("rejected {id}");
        }

        Command::Ask {
            project_id,
            worker_id,
            question,
            options,
        } => {
            let mut body = json!({ "projectId": project_id, "question": question });
            if let Some(worker_id) = worker_id {
                body["workerId"] = Value::String(worker_id);
            }
            if let Some(options) = options {
                body["options"] = Value::String(options);
            }
            let question = api.post("/api/questions", body)?;
            print!("{}", render_question(&question));
        }

        Command::Answer {
            id,
            text,
            verdict_token: token,
        } => {
            let path = format!("/api/questions/{}/answer", encode(&id));
            let question =
                api.post_verdict(&path, json!({ "answer": text }), verdict_token(token)?)?;
            print!("{}", render_question(&question));
        }

        Command::QuestionsList { project_id, status } => {
            let questions = api.get_filtered(
                "/api/questions",
                &[
                    ("projectId", project_id.as_deref()),
                    ("status", status.as_deref()),
                ],
            )?;
            print!("{}", render_question_list(&questions));
        }

        Command::Board { project_id } => {
            let board = api.get("/api/board", project_id.as_deref())?;
            print!("{}", render_board(&board));
        }

        Command::Activity { project_id, limit } => {
            let limit_text = limit.map(|value| value.to_string());
            let feed = api.get_filtered(
                "/api/activity",
                &[
                    ("projectId", project_id.as_deref()),
                    ("limit", limit_text.as_deref()),
                ],
            )?;
            print!("{}", render_activity(&feed));
        }

        Command::Tree { project_id } => match project_id {
            Some(project_id) => {
                let tree = api.get(&format!("/api/projects/{}/tree", encode(&project_id)), None)?;
                print!("{}", render_tree(&tree));
            }
            None => print_all_trees(&api)?,
        },

        Command::Quota => {
            let quota = api.get("/api/quota", None)?;
            print!("{}", render_quota(&quota));
        }

        Command::EmergencyStop {
            action,
            verdict_token: token,
        } => {
            // Fail closed: a failed read is an error, never "not active".
            let body = request_emergency_stop(&api, action, token)?;
            print!("{}", render_emergency_stop(&body)?);
        }

        Command::Diagnosis => {
            let body = api.get("/api/diagnosis", None)?;
            print!("{}", render_diagnosis(&body));
        }

        Command::DigestList { project_id } => {
            let dates = api.get(
                &format!("/api/projects/{}/digests", encode(&project_id)),
                None,
            )?;
            print!("{}", render_digest_list(&dates));
        }

        Command::DigestShow { project_id, date } => {
            let page = api.get(
                &format!(
                    "/api/projects/{}/digests/{}",
                    encode(&project_id),
                    encode(&date)
                ),
                None,
            )?;
            print!("{}", render_digest_show(&page, &date));
        }

        Command::BudgetList => {
            let budgets = api.get("/api/budgets", None)?;
            print!("{}", render_budgets(&budgets));
        }

        Command::BudgetSet {
            profile_id,
            five_hour,
            seven_day,
        } => {
            // Only the windows the caller named are sent. An absent key means
            // "leave it", and `null` means "remove it" - the same three-valued
            // shape the route reads.
            let mut body = json!({ "profileId": profile_id });
            if let Some(percent) = five_hour {
                body["fiveHourPct"] = percent.map_or(Value::Null, |p| json!(p));
            }
            if let Some(percent) = seven_day {
                body["sevenDayPct"] = percent.map_or(Value::Null, |p| json!(p));
            }
            let stored = api.put("/api/budgets", body)?;
            print!("{}", render_budgets(&json!([stored])));
        }

        Command::Providers => {
            let providers = api.get("/api/providers", None)?;
            print!("{}", render_providers(&providers));
        }

        Command::Usage { limit } => {
            let limit = limit.map(|limit| limit.to_string());
            let report = api.get_filtered("/api/usage", &[("limit", limit.as_deref())])?;
            print!("{}", render_usage_report(&report));
        }

        Command::Stats { project_id, range } => {
            let stats = api.get_filtered(
                &format!("/api/projects/{}/stats", encode(&project_id)),
                &[("range", range.as_deref())],
            )?;
            print!("{}", render_stats(&stats));
        }

        Command::DbRestore { .. } => unreachable!("handled before Api::load"),
    }
    Ok(())
}

/// Prints every project's tree. The tree route is bound to a project path, so
/// there is no single request for everything: ask which projects exist, then
/// ask each of them for its tree.
fn print_all_trees(api: &Api) -> Result<(), String> {
    let projects = api.get("/api/projects", None)?;
    let rows: Vec<Value> = projects.as_array().cloned().unwrap_or_default();
    if rows.is_empty() {
        println!("no projects");
    }
    for (index, project) in rows.iter().enumerate() {
        let id = text(project, "id");
        let tree = api.get(&format!("/api/projects/{}/tree", encode(&id)), None)?;
        if index > 0 {
            println!();
        }
        println!("{} ({id})", text(project, "name"));
        print!("{}", render_tree(&tree));
    }
    Ok(())
}

/// The page is Markdown that already ends in a newline; printing it verbatim
/// is what makes `pa digest show ... > file` useful.
fn render_digest_show(page: &Value, date: &str) -> String {
    match page.get("markdown").and_then(Value::as_str) {
        Some(markdown) => markdown.to_string(),
        None => format!("(no digest for {date})\n"),
    }
}

// -- arguments -------------------------------------------------------------

fn parse_db_restore(args: &[&str]) -> Result<Command, String> {
    let mut yes = false;
    let mut rest = Vec::new();
    for arg in args {
        if *arg == "--yes" {
            yes = true;
        } else {
            rest.push(*arg);
        }
    }
    let flags = parse_flags(&rest, &["--from", "--dest"])?;
    Ok(Command::DbRestore {
        from: flags.value("--from"),
        dest: flags.value("--dest"),
        yes,
    })
}

fn run_db_restore(from: Option<String>, dest: Option<String>, yes: bool) -> Result<(), String> {
    if !yes {
        return Err("refused: pass --yes to restore a pre-migration backup".to_string());
    }
    let dest = match dest {
        Some(path) => PathBuf::from(path),
        None => default_db_path()?,
    };
    if dest
        .parent()
        .map(|dir| dir.join(DESCRIPTOR_FILE))
        .is_some_and(|p| p.is_file())
    {
        return Err(format!(
            "refused: {} exists — quit ProjectA before restoring",
            dest.parent().unwrap().join(DESCRIPTOR_FILE).display()
        ));
    }
    let from = match from {
        Some(path) => PathBuf::from(path),
        None => db_restore::list_pre_migration_backups(&dest)?
            .pop()
            .ok_or_else(|| format!("no pre-migration backup next to {}", dest.display()))?,
    };
    let restored = db_restore::restore_from_pre_migration_backup(&from, &dest)?;
    println!("restored {} from {}", restored.display(), from.display());
    Ok(())
}

/// `<base>/<identifier>/<file>` — the one place a build identifier becomes a
/// data path, so the DB and the descriptor can never disagree.
fn data_path_in(base: &std::path::Path, identifier: &str, file: &str) -> PathBuf {
    base.join(identifier).join(file)
}

fn default_db_path() -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os(ENV_APP_DATA).filter(|path| !path.is_empty()) {
        return Ok(PathBuf::from(dir).join("projecta.db"));
    }
    Ok(data_path_in(&app_data_dir()?, IDENTIFIER, "projecta.db"))
}

/// One invocation of `pa`.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Command {
    HqAgent {
        operation: String,
        input: Option<String>,
    },
    Help,
    HqRuntime,
    HqRuns {
        project_id: String,
    },
    HqPlan {
        project_id: String,
        plan_id: String,
        revision: Option<i64>,
    },
    HqPlanImport {
        project_id: String,
        plan_id: String,
        expected_projection_revision: i64,
        rollback_reason: Option<String>,
    },
    HqContext {
        project_id: String,
        cursor: Option<i64>,
        changes_only: bool,
        wait_ms: Option<u64>,
    },
    HqGoalsList {
        project_id: String,
    },
    HqGoalCreate {
        project_id: String,
        objective: String,
        acceptance_criteria: Option<String>,
        source_goal_id: Option<String>,
        admit: bool,
    },
    HqTaskCreate {
        goal_id: String,
        objective: String,
        profile_id: Option<String>,
        owned_paths: Vec<String>,
        dependencies: Vec<String>,
    },
    HqTaskAssignment {
        task_id: String,
        body: Option<Value>,
    },
    HqTaskClaim {
        task_id: String,
        owner: String,
        escalation: bool,
    },
    HqTaskCheckpoint {
        task_id: String,
        owner: String,
        fence: i64,
        status: Option<String>,
        detail: Option<String>,
    },
    HqControl {
        project_id: String,
        action: String,
    },
    WorkerSpawn {
        project_id: String,
        task: String,
        profile_id: Option<String>,
        spawned_by: Option<String>,
    },
    QueenSpawn {
        project_id: String,
        task: String,
        profile_id: Option<String>,
        spawned_by: Option<String>,
    },
    WorkerList {
        project_id: Option<String>,
    },
    WorkerStatus {
        worker_id: String,
    },
    WorkerSend {
        worker_id: String,
        text: String,
    },
    WorkerDone,
    WorkerBlocked {
        reason: String,
    },
    WorkerMerge {
        worker_id: String,
        remove_worktree: bool,
        verdict_token: Option<String>,
    },
    Tell {
        project_id: String,
        text: String,
    },
    QueueAdd {
        project_id: String,
        task: String,
        profile_id: Option<String>,
        sharpen: bool,
        priority: Option<i32>,
        spawned_by: Option<String>,
    },
    QueueList {
        project_id: Option<String>,
    },
    QueueCancel {
        id: String,
    },
    ScoutTriage {
        project_id: String,
        urls: Vec<String>,
    },
    GithubCreate {
        project_id: String,
        name: Option<String>,
        public: bool,
    },
    GithubLink {
        project_id: String,
        url: String,
    },
    ProjectCreate {
        name: String,
        repo_path: String,
        verdict_token: Option<String>,
    },
    ProjectLandingPage {
        project_id: String,
    },
    ProjectSetLandingPage {
        project_id: String,
        file: String,
    },
    RecommendationsList {
        project_id: Option<String>,
    },
    RecommendationsAccept {
        id: String,
    },
    RecommendationsDismiss {
        id: String,
    },
    LearningsList {
        project_id: Option<String>,
        status: Option<String>,
    },
    LearningsApprove {
        id: String,
        /// The wording that goes into the playbook. `None` means "whatever is
        /// stored", which the command looks up before sending.
        text: Option<String>,
        /// `--verdict-token`, as it was typed. `None` here still leaves the
        /// environment, which [`verdict_token`] falls back to.
        verdict_token: Option<String>,
    },
    LearningsReject {
        id: String,
        verdict_token: Option<String>,
    },
    RolesList {
        project_id: Option<String>,
        status: Option<String>,
    },
    RolesApprove {
        id: String,
        verdict_token: Option<String>,
    },
    RolesReject {
        id: String,
        verdict_token: Option<String>,
    },
    Ask {
        project_id: String,
        /// `None` is a preflight question: asked while a prompt is being
        /// sharpened, before there is a worker to ask it.
        worker_id: Option<String>,
        question: String,
        options: Option<String>,
    },
    Answer {
        id: String,
        text: String,
        /// Optional here, unlike on the four verdict commands. Answering needs
        /// no permission; the token only lets a person at a terminal be
        /// recorded as one. Without it the row says `unverified`, which is the
        /// truth rather than an accusation.
        verdict_token: Option<String>,
    },
    QuestionsList {
        project_id: Option<String>,
        status: Option<String>,
    },
    Board {
        project_id: Option<String>,
    },
    Activity {
        project_id: Option<String>,
        limit: Option<u32>,
    },
    Tree {
        project_id: Option<String>,
    },
    Quota,
    EmergencyStop {
        action: StopAction,
        verdict_token: Option<String>,
    },
    DigestList {
        project_id: String,
    },
    DigestShow {
        project_id: String,
        date: String,
    },
    BudgetList,
    BudgetSet {
        profile_id: String,
        /// `None` leaves the window alone, `Some(None)` removes its ceiling.
        five_hour: Option<Option<u8>>,
        seven_day: Option<Option<u8>>,
    },
    Providers,
    Usage {
        limit: Option<u32>,
    },
    Stats {
        project_id: String,
        /// `None` sends no `range` at all, which the route reads as `all`.
        range: Option<String>,
    },
    Diagnosis,
    DbRestore {
        from: Option<String>,
        dest: Option<String>,
        yes: bool,
    },
}

/// Spelled out once: `stats` answers with it when it cannot find exactly one
/// project id on the line.
const STATS_USAGE: &str =
    "usage: pa stats --project <projectId> [--range <today|week|month|all|7d|30d>]";

/// The four verdict usages, spelled out once each. [`verdict_id`] answers with
/// one of them whenever the line does not start with exactly one id.
const LEARNINGS_APPROVE_USAGE: &str =
    "usage: pa learnings approve <learningId> [--text <text>] [--verdict-token <token>]";
const LEARNINGS_REJECT_USAGE: &str =
    "usage: pa learnings reject <learningId> [--verdict-token <token>]";
const ROLES_APPROVE_USAGE: &str =
    "usage: pa roles approve <roleVariantId> [--verdict-token <token>]";
const ROLES_REJECT_USAGE: &str = "usage: pa roles reject <roleVariantId> [--verdict-token <token>]";

/// Spelled out once: `answer` wants an id and something to answer with.
const ANSWER_USAGE: &str = "usage: pa answer <questionId> <text> [--verdict-token <token>]";

/// The `<id>` every verdict command starts with, and the flags behind it.
///
/// One bare argument, in first place. None, two, or a flag where the id
/// belongs are the same mistake - the line was written wrong - so they get the
/// same answer: the whole usage line, which shows how it is written right.
fn verdict_id<'a, 'b>(
    rest: &'b [&'a str],
    usage: &'static str,
) -> Result<(&'a str, &'b [&'a str]), String> {
    let (id, flags) = rest.split_first().ok_or(usage)?;
    if id.starts_with("--") || flags.first().is_some_and(|arg| !arg.starts_with("--")) {
        return Err(usage.to_string());
    }
    Ok((id, flags))
}

/// Lift `--verdict-token <value>` out of a free-text argument list.
///
/// `pa answer` rejoins everything after the id into one answer, so a flag left
/// in place would be typed into the agent's terminal as part of the decision.
/// A flag with no value after it is an error rather than a silent `None`: it
/// was written in order to prove something.
fn take_verdict_token(rest: Vec<&str>) -> Result<(Vec<&str>, Option<String>), String> {
    let Some(at) = rest.iter().position(|arg| *arg == "--verdict-token") else {
        return Ok((rest, None));
    };
    let value = rest
        .get(at + 1)
        .filter(|value| !value.starts_with("--"))
        .ok_or("--verdict-token needs a value")?;
    let token = (*value).to_string();
    let mut kept = rest;
    kept.drain(at..=at + 1);
    Ok((kept, Some(token)))
}

/// Resolve the verdict token from what the flag said, or from the environment.
///
/// The token is the only line between an agent and the playbook, and taking it
/// from argv puts it where every process of this user can read it
/// (`/proc/<pid>/cmdline`) and where the shell writes it down for good
/// (`~/.bash_history`, PowerShell's `ConsoleHost_history.txt`). The environment
/// is no better: `PA_VERDICT_TOKEN` is readable in `/proc/<pid>/environ`. So the
/// flag also takes two sources that leave both empty (F-SEC-5):
///
/// - `-` reads one line from the pipe on standard input.
/// - `@<path>` reads the first line of a file.
///
/// This is *not* the same mechanism as the OpenRouter key's `--config -`
/// (`providers.rs`): there ProjectA *writes* into curl's standard input, and
/// `--config -` is curl's own flag. What the two share is the rule behind them,
/// which that code states outright - "`argv` is world-readable on the machine
/// (`/proc/<pid>/cmdline`, `ps aux`), the child's standard input is not". `pa`
/// is the first place in this repository that reads a secret that way, and it
/// reads *one line*, where curl consumes the whole stream.
///
/// The token stays an `Option<String>` rather than becoming a typed
/// `ReadStdin` variant on every command: resolving it in `parse_args` would make
/// parsing do IO, and the parser is what the tests use to pin down every
/// command line. So the spelling is resolved here, once, at the point of use.
///
/// Fallible on purpose: a source that was named and cannot be read is an error,
/// not a silent `None`. `None` would send no header and earn a 403 whose message
/// is about the wrong thing. An *absent* flag with an empty environment stays
/// `None`, which is the app's business to refuse.
fn verdict_token(flag: Option<String>) -> Result<Option<String>, String> {
    let raw = match flag {
        Some(spec) => Some(read_verdict_token(
            &spec,
            &mut std::io::stdin().lock(),
            std::io::IsTerminal::is_terminal(&std::io::stdin()),
        )?),
        // The environment is always the token itself: the three spellings
        // belong to the flag. `PA_VERDICT_TOKEN=@/path` would otherwise look
        // like it worked and send `@/path` as the header.
        None => std::env::var(ENV_VERDICT_TOKEN).ok(),
    };
    let Some(token) = raw else { return Ok(None) };
    let token = token.trim();
    if token.is_empty() {
        // Only an *absent* source is silence. A named one that is empty is a
        // typo, and a 403 would blame the app for it.
        return Ok(None);
    }
    // Whatever is returned here goes into a request header verbatim
    // (`Api::send`), and the other side splits its head on newlines. A value
    // carrying whitespace would therefore either be cut short or open a second
    // header line of its own - so it is refused here, by shape, without ever
    // echoing the value.
    if token.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(
            "the verdict token contains whitespace or control characters; it is 32 hex characters"
                .to_string(),
        );
    }
    Ok(Some(token.to_string()))
}

/// Resolve one of the three spellings of the flag's value.
///
/// `input` and `stdin_is_terminal` are parameters rather than
/// `std::io::stdin()` read inside: a test that reads the real standard input
/// hangs forever under a terminal, which is where `cargo test` runs. The
/// production caller passes the locked handle and asks the same question.
fn read_verdict_token(
    spec: &str,
    input: &mut impl std::io::BufRead,
    stdin_is_terminal: bool,
) -> Result<String, String> {
    // Trimmed first, so `" -"` means what it looks like rather than becoming a
    // literal token of one dash.
    let spec = spec.trim();
    if spec == "-" {
        // A terminal here would sit and wait with the token echoing onto the
        // screen - and in this product the screen is an agent's terminal, which
        // is recorded. The audit asked for a no-echo prompt; refusing with the
        // pipe in the message is the same protection without a second way to
        // type a secret.
        if stdin_is_terminal {
            return Err(
                "--verdict-token - expects the token on standard input, not from a terminal: \
                 printf %s \"$TOKEN\" | pa ..."
                    .to_string(),
            );
        }
        let mut line = String::new();
        input
            .read_line(&mut line)
            .map_err(|e| format!("could not read the verdict token from standard input: {e}"))?;
        if line.trim().is_empty() {
            return Err(
                "the verdict token was to come from standard input, which was empty".to_string(),
            );
        }
        return Ok(line);
    }
    if let Some(path) = spec.strip_prefix('@') {
        // A token mistyped with the `@` in front of it must not come back in an
        // error message: 32 hex characters is what this project mints
        // (`api::new_token`), and the CLI's error text does not pass through
        // `redact` here, so the check below has to catch it itself.
        if path.len() == 32 && path.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(
                "--verdict-token @<path> wants a file; that looks like the token itself - \
                 write it without the @"
                    .to_string(),
            );
        }
        let token = read_token_file(path)?;
        if token.trim().is_empty() {
            return Err(format!("the verdict token file {path} is empty"));
        }
        return Ok(token);
    }
    Ok(spec.to_string())
}

/// The first line of a token file, with the two checks a secret file deserves.
///
/// Rejects non-regular files and files larger than the limit.
/// First line only: the rest of the file cannot reach the request head.
fn read_token_file(path: &str) -> Result<String, String> {
    const MAX_TOKEN_FILE: u64 = 4096;

    // Refuse by name before opening: opening a FIFO would block. The handle's
    // metadata below stays authoritative against a swap after this check.
    let early = std::fs::metadata(path)
        .map_err(|e| format!("could not read the verdict token from {path}: {e}"))?;
    if !early.is_file() {
        return Err(format!("the verdict token file {path} is not a file"));
    }
    let file = std::fs::File::open(path)
        .map_err(|e| format!("could not read the verdict token from {path}: {e}"))?;
    let meta = file
        .metadata()
        .map_err(|e| format!("could not read the verdict token from {path}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("the verdict token file {path} is not a file"));
    }
    // The file is what the documentation recommends as the safe place, so the
    // recommendation is enforced instead of hoped for: a token file other users
    // can read is a worse exposure than argv, because it lasts. Windows has no
    // equivalent bit here; the usage text says so rather than promising it.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = meta.permissions().mode();
        if mode & 0o077 != 0 {
            return Err(format!(
                "the verdict token file {path} is readable by other users (mode {:o}); chmod 600 it",
                mode & 0o777
            ));
        }
    }
    use std::io::Read;
    let mut bytes = Vec::new();
    file.take(MAX_TOKEN_FILE + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("could not read the verdict token from {path}: {e}"))?;
    if bytes.len() as u64 > MAX_TOKEN_FILE {
        return Err(format!(
            "the verdict token file {path} exceeds the {MAX_TOKEN_FILE}-byte limit"
        ));
    }
    let contents = String::from_utf8(bytes)
        .map_err(|e| format!("could not read the verdict token from {path}: {e}"))?;
    Ok(contents.lines().next().unwrap_or_default().to_string())
}

/// Parse a command line. Everything a caller can get wrong is an error with a
/// name in it: this is read by agents, and a silent default would be worse than
/// a refusal.
fn parse_args(args: &[String]) -> Result<Command, String> {
    let mut args = args.iter().map(String::as_str);
    let Some(verb) = args.next() else {
        return Ok(Command::Help);
    };
    let rest: Vec<&str> = args.collect();

    match verb {
        "help" | "-h" | "--help" => Ok(Command::Help),

        "hq" => parse_hq(&rest),

        "worker" => {
            let (sub, rest) = rest.split_first().ok_or(
                "worker needs a subcommand: spawn, list, status, send, done, blocked or merge",
            )?;
            match *sub {
                "spawn" => {
                    let flags = parse_flags(
                        rest,
                        &["--project", "--task", "--profile", "--on-behalf-of"],
                    )?;
                    Ok(Command::WorkerSpawn {
                        project_id: required(&flags, "--project")?,
                        task: required(&flags, "--task")?,
                        profile_id: flags.value("--profile"),
                        spawned_by: flags.value("--on-behalf-of"),
                    })
                }
                "list" => {
                    let flags = parse_flags(rest, &["--project"])?;
                    Ok(Command::WorkerList {
                        project_id: flags.value("--project"),
                    })
                }
                "status" => {
                    let [worker_id] = rest[..] else {
                        return Err("usage: pa worker status <workerId>".to_string());
                    };
                    Ok(Command::WorkerStatus {
                        worker_id: worker_id.to_string(),
                    })
                }
                "send" => {
                    let (worker_id, text) = rest
                        .split_first()
                        .filter(|(_, text)| !text.is_empty())
                        .ok_or("usage: pa worker send <workerId> <text>")?;
                    Ok(Command::WorkerSend {
                        worker_id: (*worker_id).to_string(),
                        // Shells split unquoted text into several arguments;
                        // rejoining them is friendlier than insisting on quotes.
                        text: text.join(" "),
                    })
                }
                "done" => {
                    if !rest.is_empty() {
                        return Err("usage: pa worker done".to_string());
                    }
                    Ok(Command::WorkerDone)
                }
                "blocked" => {
                    let flags = parse_flags(rest, &["--reason"])?;
                    let reason = flags
                        .value("--reason")
                        .filter(|reason| !reason.trim().is_empty())
                        .ok_or("usage: pa worker blocked --reason <text>")?;
                    Ok(Command::WorkerBlocked { reason })
                }
                "merge" => {
                    // `--remove-worktree` is a switch; `--verdict-token` is the
                    // human proof. What is left over is the worker id.
                    let rest: Vec<&str> = rest.to_vec();
                    let (rest, token) = take_verdict_token(rest)?;
                    let mut remove_worktree = false;
                    let mut ids: Vec<&str> = Vec::new();
                    for arg in rest {
                        if arg == "--remove-worktree" {
                            remove_worktree = true;
                        } else {
                            ids.push(arg);
                        }
                    }
                    let [worker_id] = ids[..] else {
                        return Err(
                            "usage: pa worker merge <workerId> [--remove-worktree] [--verdict-token <token>]"
                                .to_string(),
                        );
                    };
                    Ok(Command::WorkerMerge {
                        worker_id: worker_id.to_string(),
                        remove_worktree,
                        verdict_token: token,
                    })
                }
                other => Err(format!("unknown worker subcommand: {other}")),
            }
        }

        "queen" => {
            let (sub, rest) = rest
                .split_first()
                .ok_or("queen needs a subcommand: spawn")?;
            match *sub {
                "spawn" => {
                    let flags = parse_flags(
                        rest,
                        &["--project", "--task", "--profile", "--on-behalf-of"],
                    )?;
                    Ok(Command::QueenSpawn {
                        project_id: required(&flags, "--project")?,
                        task: required(&flags, "--task")?,
                        profile_id: flags.value("--profile"),
                        spawned_by: flags.value("--on-behalf-of"),
                    })
                }
                other => Err(format!("unknown queen subcommand: {other}")),
            }
        }

        "tell" => {
            let (flags, text) = parse_tell_args(&rest)?;
            Ok(Command::Tell {
                project_id: required(&flags, "--project")?,
                text,
            })
        }

        "queue" => {
            let (sub, rest) = rest
                .split_first()
                .ok_or("queue needs a subcommand: add, list or cancel")?;
            match *sub {
                "add" => {
                    let (flags, sharpen) = parse_queue_add_flags(rest)?;
                    let priority = flags
                        .value("--priority")
                        .map(|value| {
                            value
                                .parse::<i32>()
                                .map_err(|_| "--priority must be an integer".to_string())
                        })
                        .transpose()?;
                    Ok(Command::QueueAdd {
                        project_id: required(&flags, "--project")?,
                        task: required(&flags, "--task")?,
                        profile_id: flags.value("--profile"),
                        sharpen,
                        priority,
                        spawned_by: flags.value("--on-behalf-of"),
                    })
                }
                "list" => {
                    let flags = parse_flags(rest, &["--project"])?;
                    Ok(Command::QueueList {
                        project_id: flags.value("--project"),
                    })
                }
                "cancel" => {
                    let [id] = rest[..] else {
                        return Err("usage: pa queue cancel <queueId>".to_string());
                    };
                    Ok(Command::QueueCancel { id: id.to_string() })
                }
                other => Err(format!("unknown queue subcommand: {other}")),
            }
        }

        "scout" => {
            let (sub, rest) = rest
                .split_first()
                .ok_or("scout needs a subcommand: triage")?;
            match *sub {
                "triage" => {
                    let (flags, urls) = parse_triage_args(rest)?;
                    Ok(Command::ScoutTriage {
                        project_id: required(&flags, "--project")?,
                        urls,
                    })
                }
                other => Err(format!("unknown scout subcommand: {other}")),
            }
        }

        "github" => {
            let (sub, rest) = rest
                .split_first()
                .ok_or("github needs a subcommand: create or link")?;
            match *sub {
                "create" => {
                    // `--public` is a switch with no value; peel it off like
                    // queue add does with `--sharpen`.
                    let (flags, public) = parse_github_create_flags(rest)?;
                    Ok(Command::GithubCreate {
                        project_id: required(&flags, "--project")?,
                        name: flags.value("--name"),
                        public,
                    })
                }
                "link" => {
                    // Exactly one positional argument: the url. Mirrors the
                    // triage walker, minus the list.
                    let mut flagged: Vec<&str> = Vec::new();
                    let mut urls: Vec<&str> = Vec::new();
                    let mut args = rest.iter().peekable();
                    while let Some(arg) = args.next() {
                        if !arg.starts_with("--") {
                            urls.push(arg);
                            continue;
                        }
                        flagged.push(*arg);
                        if !arg.contains('=') {
                            let value =
                                args.next().ok_or_else(|| format!("{arg} needs a value"))?;
                            flagged.push(*value);
                        }
                    }
                    let [url] = urls[..] else {
                        return Err("usage: pa github link --project <projectId> <url>".to_string());
                    };
                    let flags = parse_flags(&flagged, &["--project"])?;
                    Ok(Command::GithubLink {
                        project_id: required(&flags, "--project")?,
                        url: (*url).to_string(),
                    })
                }
                other => Err(format!("unknown github subcommand: {other}")),
            }
        }

        "project" => {
            let (sub, rest) = rest
                .split_first()
                .ok_or("project needs a subcommand: create, landing-page or set-landing-page")?;
            match *sub {
                "create" => {
                    let flags = parse_flags(rest, &["--name", "--path", "--verdict-token"])?;
                    Ok(Command::ProjectCreate {
                        name: required(&flags, "--name")?,
                        repo_path: required(&flags, "--path")?,
                        verdict_token: flags.value("--verdict-token"),
                    })
                }
                "landing-page" => {
                    let flags = parse_flags(rest, &["--project"])?;
                    Ok(Command::ProjectLandingPage {
                        project_id: required(&flags, "--project")?,
                    })
                }
                "set-landing-page" => {
                    let flags = parse_flags(rest, &["--project", "--file"])?;
                    Ok(Command::ProjectSetLandingPage {
                        project_id: required(&flags, "--project")?,
                        file: required(&flags, "--file")?,
                    })
                }
                other => Err(format!("unknown project subcommand: {other}")),
            }
        }

        "recommendations" => {
            let (sub, rest) = rest
                .split_first()
                .ok_or("recommendations needs a subcommand: list, accept or dismiss")?;
            match *sub {
                "list" => {
                    let flags = parse_flags(rest, &["--project"])?;
                    Ok(Command::RecommendationsList {
                        project_id: flags.value("--project"),
                    })
                }
                "accept" => {
                    let [id] = rest[..] else {
                        return Err(
                            "usage: pa recommendations accept <recommendationId>".to_string()
                        );
                    };
                    Ok(Command::RecommendationsAccept { id: id.to_string() })
                }
                "dismiss" => {
                    let [id] = rest[..] else {
                        return Err(
                            "usage: pa recommendations dismiss <recommendationId>".to_string()
                        );
                    };
                    Ok(Command::RecommendationsDismiss { id: id.to_string() })
                }
                other => Err(format!("unknown recommendations subcommand: {other}")),
            }
        }

        "learnings" => {
            let (sub, rest) = rest
                .split_first()
                .ok_or("learnings needs a subcommand: list, approve or reject")?;
            match *sub {
                "list" => {
                    let flags = parse_flags(rest, &["--project", "--status"])?;
                    Ok(Command::LearningsList {
                        project_id: flags.value("--project"),
                        status: flags.value("--status"),
                    })
                }
                "approve" => {
                    let (id, rest) = verdict_id(rest, LEARNINGS_APPROVE_USAGE)?;
                    let flags = parse_flags(rest, &["--text", "--verdict-token"])?;
                    Ok(Command::LearningsApprove {
                        id: id.to_string(),
                        text: flags.value("--text"),
                        verdict_token: flags.value("--verdict-token"),
                    })
                }
                "reject" => {
                    let (id, rest) = verdict_id(rest, LEARNINGS_REJECT_USAGE)?;
                    let flags = parse_flags(rest, &["--verdict-token"])?;
                    Ok(Command::LearningsReject {
                        id: id.to_string(),
                        verdict_token: flags.value("--verdict-token"),
                    })
                }
                other => Err(format!("unknown learnings subcommand: {other}")),
            }
        }

        "ask" => {
            let flags = parse_flags(&rest, &["--project", "--worker", "--question", "--options"])?;
            Ok(Command::Ask {
                project_id: required(&flags, "--project")?,
                worker_id: flags.value("--worker"),
                question: required(&flags, "--question")?,
                options: flags.value("--options"),
            })
        }

        "answer" => {
            // `<id> <text>`, with the text rejoined the way `worker send`
            // rejoins it: shells split unquoted text, and insisting on quotes
            // would only produce answers that lost their tail.
            // The token is lifted out before the rest is rejoined, or it
            // would end up inside the answer. Only the first occurrence: an
            // answer that genuinely contains the words `--verdict-token`
            // would lose them, which is a trade this takes knowingly - the
            // alternative is that a person cannot prove they answered.
            let (rest, token) = take_verdict_token(rest)?;
            let (id, text) = rest
                .split_first()
                .filter(|(id, text)| !id.starts_with("--") && !text.is_empty())
                .ok_or(ANSWER_USAGE)?;
            Ok(Command::Answer {
                id: (*id).to_string(),
                text: text.join(" "),
                verdict_token: token,
            })
        }

        "questions" => {
            let (sub, rest) = rest
                .split_first()
                .ok_or("questions needs a subcommand: list")?;
            match *sub {
                "list" => {
                    let flags = parse_flags(rest, &["--project", "--status"])?;
                    Ok(Command::QuestionsList {
                        project_id: flags.value("--project"),
                        status: flags.value("--status"),
                    })
                }
                other => Err(format!("unknown questions subcommand: {other}")),
            }
        }

        "roles" => {
            let (sub, rest) = rest
                .split_first()
                .ok_or("roles needs a subcommand: list, approve or reject")?;
            match *sub {
                "list" => {
                    let flags = parse_flags(rest, &["--project", "--status"])?;
                    Ok(Command::RolesList {
                        project_id: flags.value("--project"),
                        status: flags.value("--status"),
                    })
                }
                "approve" => {
                    let (id, rest) = verdict_id(rest, ROLES_APPROVE_USAGE)?;
                    let flags = parse_flags(rest, &["--verdict-token"])?;
                    Ok(Command::RolesApprove {
                        id: id.to_string(),
                        verdict_token: flags.value("--verdict-token"),
                    })
                }
                "reject" => {
                    let (id, rest) = verdict_id(rest, ROLES_REJECT_USAGE)?;
                    let flags = parse_flags(rest, &["--verdict-token"])?;
                    Ok(Command::RolesReject {
                        id: id.to_string(),
                        verdict_token: flags.value("--verdict-token"),
                    })
                }
                other => Err(format!("unknown roles subcommand: {other}")),
            }
        }

        "board" => {
            let flags = parse_flags(&rest, &["--project"])?;
            Ok(Command::Board {
                project_id: flags.value("--project"),
            })
        }

        "activity" => {
            let flags = parse_flags(&rest, &["--project", "--limit"])?;
            let limit = flags
                .value("--limit")
                .map(|value| {
                    value
                        .parse::<u32>()
                        .map_err(|_| "--limit must be a positive integer".to_string())
                })
                .transpose()?;
            Ok(Command::Activity {
                project_id: flags.value("--project"),
                limit,
            })
        }

        "tree" => {
            let flags = parse_flags(&rest, &["--project"])?;
            Ok(Command::Tree {
                project_id: flags.value("--project"),
            })
        }

        "estop" => {
            let (rest, token) = take_verdict_token(rest.to_vec())?;
            match rest.as_slice() {
                [] | ["status"] if token.is_none() => Ok(Command::EmergencyStop {
                    action: StopAction::Status,
                    verdict_token: None,
                }),
                ["on"] if token.is_none() => Ok(Command::EmergencyStop {
                    action: StopAction::On,
                    verdict_token: None,
                }),
                ["off"] => Ok(Command::EmergencyStop {
                    action: StopAction::Off,
                    verdict_token: token,
                }),
                [other, ..] => Err(format!("estop takes on, off or status, got {other}")),
                _ => Err("--verdict-token is only valid with estop off".to_string()),
            }
        }

        "quota" => match rest.as_slice() {
            [] => Ok(Command::Quota),
            ["list"] => Ok(Command::Quota),
            ["list", extra] => Err(format!("quota takes no arguments, got {extra}")),
            [extra, ..] => Err(format!("quota takes no arguments, got {extra}")),
        },

        "diagnosis" => match rest.as_slice() {
            [] => Ok(Command::Diagnosis),
            [extra, ..] => Err(format!("diagnosis takes no arguments, got {extra}")),
        },

        "digest" => {
            let (sub, rest) = rest
                .split_first()
                .ok_or("digest needs a subcommand: list or show")?;
            match *sub {
                "list" => {
                    let flags = parse_flags(rest, &["--project"])?;
                    Ok(Command::DigestList {
                        project_id: required(&flags, "--project")?,
                    })
                }
                "show" => {
                    // One positional date beside the project flag, the same
                    // shape `github link` uses for its url.
                    let mut flagged: Vec<&str> = Vec::new();
                    let mut dates: Vec<&str> = Vec::new();
                    let mut args = rest.iter().peekable();
                    while let Some(arg) = args.next() {
                        if !arg.starts_with("--") {
                            dates.push(arg);
                            continue;
                        }
                        flagged.push(*arg);
                        if !arg.contains('=') {
                            let value =
                                args.next().ok_or_else(|| format!("{arg} needs a value"))?;
                            flagged.push(*value);
                        }
                    }
                    let [date] = dates[..] else {
                        return Err(
                            "usage: pa digest show --project <projectId> <YYYY-MM-DD>".to_string()
                        );
                    };
                    let flags = parse_flags(&flagged, &["--project"])?;
                    Ok(Command::DigestShow {
                        project_id: required(&flags, "--project")?,
                        date: (*date).to_string(),
                    })
                }
                other => Err(format!("unknown digest subcommand: {other}")),
            }
        }

        "budget" => {
            let (sub, rest) = rest
                .split_first()
                .ok_or("budget needs a subcommand: list or set")?;
            match *sub {
                "list" => {
                    if let Some(extra) = rest.first() {
                        return Err(format!("budget list takes no arguments, got {extra}"));
                    }
                    Ok(Command::BudgetList)
                }
                "set" => {
                    let flags = parse_flags(rest, &["--profile", "--five-hour", "--seven-day"])?;
                    let five_hour = parse_budget_flag(&flags, "--five-hour")?;
                    let seven_day = parse_budget_flag(&flags, "--seven-day")?;
                    if five_hour.is_none() && seven_day.is_none() {
                        return Err(
                            "budget set needs --five-hour or --seven-day (a percentage, or off)"
                                .to_string(),
                        );
                    }
                    Ok(Command::BudgetSet {
                        profile_id: required(&flags, "--profile")?,
                        five_hour,
                        seven_day,
                    })
                }
                other => Err(format!("unknown budget subcommand: {other}")),
            }
        }

        "providers" => {
            if let Some(extra) = rest.first() {
                return Err(format!("providers takes no arguments, got {extra}"));
            }
            Ok(Command::Providers)
        }

        "usage" => {
            let flags = parse_flags(&rest, &["--limit"])?;
            let limit = flags
                .value("--limit")
                .map(|value| {
                    value
                        .parse::<u32>()
                        .map_err(|_| "--limit must be a positive integer".to_string())
                })
                .transpose()?;
            Ok(Command::Usage { limit })
        }

        "db" => {
            let (sub, rest) = rest.split_first().ok_or("db needs a subcommand: restore")?;
            match *sub {
                "restore" => parse_db_restore(rest),
                other => Err(format!("unknown db subcommand: {other}")),
            }
        }

        "stats" => {
            // One positional project id beside an optional flag, the same
            // shape `digest show` uses for its date.
            let mut flagged: Vec<&str> = Vec::new();
            let mut ids: Vec<&str> = Vec::new();
            let mut args = rest.iter().peekable();
            while let Some(arg) = args.next() {
                if !arg.starts_with("--") {
                    ids.push(arg);
                    continue;
                }
                flagged.push(*arg);
                if !arg.contains('=') {
                    let value = args.next().ok_or_else(|| format!("{arg} needs a value"))?;
                    flagged.push(*value);
                }
            }
            let flags = parse_flags(&flagged, &["--range", "--project"])?;
            // A bare project id is accepted beside `--project`, because the
            // plan for this command writes it that way and both are
            // unambiguous - there is nothing else on the line.
            let project_id = match ids[..] {
                [] => required(&flags, "--project").map_err(|_| STATS_USAGE.to_string())?,
                [id] => (*id).to_string(),
                _ => return Err(STATS_USAGE.to_string()),
            };
            let range = flags.value("--range");
            if let Some(range) = range.as_deref() {
                if !["today", "week", "month", "all", "7d", "30d"].contains(&range) {
                    return Err(format!(
                        "--range must be today, week, month, all, 7d or 30d, got {range}"
                    ));
                }
            }
            Ok(Command::Stats { project_id, range })
        }

        other => Err(format!("unknown command: {other}\n\n{USAGE}")),
    }
}

fn require_journal_wait(runtime: &Value, wait_ms: u64) -> Result<(), String> {
    let capability = &runtime["capabilities"]["journalChangesWait"];
    if capability["supported"] != true
        || capability["maxWaitMs"]
            .as_u64()
            .is_none_or(|limit| limit < wait_ms)
    {
        return Err("the running app does not advertise the requested journal wait; update the app or use changes without --wait-ms".into());
    }
    Ok(())
}

fn parse_hq(rest: &[&str]) -> Result<Command, String> {
    let (sub, rest) = rest.split_first().ok_or("hq needs a subcommand")?;
    match *sub {
        "agent" => {
            let (operation, flags) = rest
                .split_first()
                .ok_or("hq agent needs context, lessons, release, candidate, evidence or review")?;
            match *operation {
                "lessons" | "release" if flags.is_empty() => Ok(Command::HqAgent {
                    operation: operation.to_string(),
                    input: None,
                }),
                "list-evidence" | "list-reviews" => {
                    let flags = parse_flags(flags, &["--cursor"])?;
                    let cursor = flags.value("--cursor").unwrap_or_else(|| "start".into());
                    if cursor.len() > 1024
                        || cursor.is_empty()
                        || !cursor
                            .bytes()
                            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
                    {
                        return Err("--cursor must be the returned record cursor".into());
                    }
                    Ok(Command::HqAgent {
                        operation: format!(
                            "records/{}/{}",
                            operation.strip_prefix("list-").unwrap(),
                            cursor
                        ),
                        input: None,
                    })
                }
                "read-checkpoint" => {
                    let flags = parse_flags(flags, &["--revision"])?;
                    let revision = required(&flags, "--revision")?
                        .parse::<i64>()
                        .map_err(|_| "--revision must be a positive integer")?;
                    if revision < 1 {
                        return Err("--revision must be a positive integer".into());
                    }
                    Ok(Command::HqAgent {
                        operation: format!("checkpoint/{revision}"),
                        input: None,
                    })
                }
                "read-evidence" => {
                    let flags = parse_flags(flags, &["--id"])?;
                    Ok(Command::HqAgent {
                        operation: format!("evidence/{}", encode(&required(&flags, "--id")?)),
                        input: None,
                    })
                }
                "context" if flags.is_empty() => Ok(Command::HqAgent {
                    operation: operation.to_string(),
                    input: None,
                }),
                "candidate" | "evidence" | "checkpoint" | "review" => {
                    let flags = parse_flags(flags, &["--input"])?;
                    Ok(Command::HqAgent {
                        operation: operation.to_string(),
                        input: Some(required(&flags, "--input")?),
                    })
                }
                _ => Err("hq agent needs context, lessons, release, candidate --input, evidence --input or review --input".into()),
            }
        }
        "runs" => {
            let flags = parse_flags(rest, &["--project"])?;
            Ok(Command::HqRuns {
                project_id: required(&flags, "--project")?,
            })
        }
        "plan" => {
            let flags = parse_flags(rest, &["--project", "--plan", "--revision"])?;
            let revision = flags
                .value("--revision")
                .map(|raw| {
                    raw.parse::<i64>()
                        .ok()
                        .filter(|value| *value > 0)
                        .ok_or_else(|| "--revision must be a positive integer".to_string())
                })
                .transpose()?;
            Ok(Command::HqPlan {
                project_id: required(&flags, "--project")?,
                plan_id: required(&flags, "--plan")?,
                revision,
            })
        }
        "plan-import" => {
            let flags = parse_flags(
                rest,
                &[
                    "--project",
                    "--plan",
                    "--expected-revision",
                    "--rollback-reason",
                ],
            )?;
            let expected_projection_revision = required(&flags, "--expected-revision")?
                .parse::<i64>()
                .ok()
                .filter(|value| (0..i64::MAX).contains(value))
                .ok_or_else(|| {
                    "--expected-revision must be non-negative and below the maximum integer"
                        .to_string()
                })?;
            Ok(Command::HqPlanImport {
                project_id: required(&flags, "--project")?,
                plan_id: required(&flags, "--plan")?,
                expected_projection_revision,
                rollback_reason: flags.value("--rollback-reason"),
            })
        }
        "runtime" => {
            if rest.is_empty() {
                Ok(Command::HqRuntime)
            } else {
                Err("usage: pa hq runtime".to_string())
            }
        }
        "context" | "changes" => {
            let flags = parse_flags(rest, &["--project", "--cursor", "--wait-ms"])?;
            let wait_ms = flags
                .value("--wait-ms")
                .map(|value| {
                    value
                        .parse::<u64>()
                        .map_err(|_| "--wait-ms must be between 0 and 25000".to_string())
                })
                .transpose()?;
            if wait_ms.is_some_and(|value| value > 25_000)
                || (*sub == "context" && wait_ms.is_some())
            {
                return Err("--wait-ms is supported only by changes, between 0 and 25000".into());
            }
            let cursor = flags
                .value("--cursor")
                .map(|value| {
                    value
                        .parse::<i64>()
                        .map_err(|_| "--cursor must be an integer".to_string())
                })
                .transpose()?;
            if cursor.is_some_and(|value| value < 0) {
                return Err("--cursor must be non-negative".into());
            }
            Ok(Command::HqContext {
                project_id: required(&flags, "--project")?,
                cursor,
                changes_only: *sub == "changes",
                wait_ms,
            })
        }
        "goals" => {
            let (action, rest) = rest.split_first().ok_or("hq goals needs list or create")?;
            match *action {
                "list" => {
                    let flags = parse_flags(rest, &["--project"])?;
                    Ok(Command::HqGoalsList {
                        project_id: required(&flags, "--project")?,
                    })
                }
                "create" => {
                    let admit = rest.contains(&"--admit");
                    let flags: Vec<&str> = rest
                        .iter()
                        .copied()
                        .filter(|value| *value != "--admit")
                        .collect();
                    let flags = parse_flags(
                        &flags,
                        &["--project", "--objective", "--acceptance", "--source-goal"],
                    )?;
                    Ok(Command::HqGoalCreate {
                        project_id: required(&flags, "--project")?,
                        objective: required(&flags, "--objective")?,
                        acceptance_criteria: flags.value("--acceptance"),
                        source_goal_id: flags.value("--source-goal"),
                        admit,
                    })
                }
                other => Err(format!("unknown hq goals subcommand: {other}")),
            }
        }
        "tasks" => {
            let (action, rest) = rest
                .split_first()
                .ok_or("hq tasks needs create, assignment, assign, claim or checkpoint")?;
            match *action {
                "assignment" => {
                    if rest.len() != 1 {
                        return Err("usage: pa hq tasks assignment <taskId>".into());
                    }
                    Ok(Command::HqTaskAssignment {
                        task_id: rest[0].into(),
                        body: None,
                    })
                }
                "assign" => {
                    let (task_id,rest)=rest.split_first().ok_or("usage: pa hq tasks assign <taskId> --team <id> --role <role> --assignee <id> --expected-revision <n>")?;
                    let flags = parse_flags(
                        rest,
                        &["--team", "--role", "--assignee", "--expected-revision"],
                    )?;
                    let revision = required(&flags, "--expected-revision")?
                        .parse::<i64>()
                        .map_err(|_| "--expected-revision must be an integer")?;
                    if revision < 0 || revision == i64::MAX {
                        return Err("--expected-revision must be non-negative and below the maximum integer".into());
                    }
                    Ok(Command::HqTaskAssignment {
                        task_id: (*task_id).into(),
                        body: Some(
                            json!({"teamId":required(&flags,"--team")?,"role":required(&flags,"--role")?,"assignee":required(&flags,"--assignee")?,"expectedRevision":revision}),
                        ),
                    })
                }
                "create" => {
                    let (goal_id, flags) = rest.split_first().ok_or(
                        "usage: pa hq tasks create <goalId> --objective <text> --owned <path,path>",
                    )?;
                    let flags =
                        parse_flags(flags, &["--objective", "--owned", "--profile", "--depends"])?;
                    Ok(Command::HqTaskCreate {
                        goal_id: (*goal_id).to_string(),
                        objective: required(&flags, "--objective")?,
                        profile_id: flags.value("--profile"),
                        owned_paths: csv(required(&flags, "--owned")?),
                        dependencies: flags.value("--depends").map(csv).unwrap_or_default(),
                    })
                }
                "claim" => {
                    let (task_id, rest) = rest
                        .split_first()
                        .ok_or("usage: pa hq tasks claim <taskId> --owner <id> [--escalation]")?;
                    let escalation = rest.contains(&"--escalation");
                    let flags: Vec<&str> = rest
                        .iter()
                        .copied()
                        .filter(|value| *value != "--escalation")
                        .collect();
                    let flags = parse_flags(&flags, &["--owner"])?;
                    Ok(Command::HqTaskClaim {
                        task_id: (*task_id).to_string(),
                        owner: required(&flags, "--owner")?,
                        escalation,
                    })
                }
                "checkpoint" => {
                    let (task_id, rest) = rest
                        .split_first()
                        .ok_or("usage: pa hq tasks checkpoint <taskId> --owner <id> --fence <n>")?;
                    let flags = parse_flags(rest, &["--owner", "--fence", "--status", "--detail"])?;
                    let fence = required(&flags, "--fence")?
                        .parse::<i64>()
                        .map_err(|_| "--fence must be an integer".to_string())?;
                    Ok(Command::HqTaskCheckpoint {
                        task_id: (*task_id).to_string(),
                        owner: required(&flags, "--owner")?,
                        fence,
                        status: flags.value("--status"),
                        detail: flags.value("--detail"),
                    })
                }
                other => Err(format!("unknown hq tasks subcommand: {other}")),
            }
        }
        "control" => {
            let flags = parse_flags(rest, &["--project", "--action"])?;
            Ok(Command::HqControl {
                project_id: required(&flags, "--project")?,
                action: required(&flags, "--action")?,
            })
        }
        other => Err(format!("unknown hq subcommand: {other}")),
    }
}

fn csv(value: String) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

/// `--name value` pairs, in the order they were given. Each name appears at
/// most once: `parse_flags` refuses a repeated option rather than picking one.
#[derive(Debug, Default)]
struct Flags(Vec<(String, String)>);

impl Flags {
    fn value(&self, name: &str) -> Option<String> {
        self.0
            .iter()
            .find(|(flag, _)| flag == name)
            .map(|(_, value)| value.clone())
    }
}

fn required(flags: &Flags, name: &str) -> Result<String, String> {
    flags
        .value(name)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{name} is required"))
}

/// Read `--name value` pairs, accepting only the flags a subcommand knows.
fn parse_flags(args: &[&str], allowed: &[&str]) -> Result<Flags, String> {
    let mut flags = Flags::default();
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        if !arg.starts_with("--") {
            return Err(format!("unexpected argument: {arg}"));
        }
        // `--name=value` and `--name value` are both common enough to expect.
        let (name, value) = match arg.split_once('=') {
            Some((name, value)) => (name.to_string(), value.to_string()),
            None => {
                let value = args.next().ok_or_else(|| format!("{arg} needs a value"))?;
                // A flag where a value belongs is a typo, not a value:
                // `--project --typo` would otherwise go out as a real
                // request, find nothing and read like an empty result.
                // `--project=--typo` is the way to mean it.
                if value.starts_with("--") {
                    return Err(format!(
                        "{arg} needs a value, got the flag {value}; write {arg}={value} if that is the value"
                    ));
                }
                ((*arg).to_string(), (*value).to_string())
            }
        };
        if !allowed.contains(&name.as_str()) {
            return Err(format!("unknown option: {name}"));
        }
        // The same option twice is a caller who thinks one of the two is in
        // effect. Which one it would be is not something to guess at.
        if flags.0.iter().any(|(seen, _)| *seen == name) {
            return Err(format!("{name} given twice"));
        }
        flags.0.push((name, value));
    }
    Ok(flags)
}

/// Queue add is the one command with a true switch. Keep the generic parser
/// strict, and peel `--sharpen` off before it sees the value flags.
fn parse_queue_add_flags(args: &[&str]) -> Result<(Flags, bool), String> {
    let mut without_sharpen = Vec::new();
    let mut sharpen = false;
    for arg in args {
        if *arg == "--sharpen" {
            sharpen = true;
        } else {
            without_sharpen.push(*arg);
        }
    }
    Ok((
        parse_flags(
            &without_sharpen,
            &[
                "--project",
                "--task",
                "--profile",
                "--priority",
                "--on-behalf-of",
            ],
        )?,
        sharpen,
    ))
}

/// `github create` has a switch of its own, and no other flags than these.
fn parse_github_create_flags(args: &[&str]) -> Result<(Flags, bool), String> {
    let mut remaining = Vec::new();
    let mut public = false;
    for arg in args {
        if *arg == "--public" {
            public = true;
        } else {
            remaining.push(*arg);
        }
    }
    Ok((parse_flags(&remaining, &["--project", "--name"])?, public))
}

/// `tell` has the same shape as `scout triage` - flags, then positional
/// arguments - with one difference: what follows is a sentence rather than a
/// list, so the words are rejoined the way `worker send` rejoins them.
fn parse_tell_args(args: &[&str]) -> Result<(Flags, String), String> {
    let mut flagged: Vec<&str> = Vec::new();
    let mut words: Vec<&str> = Vec::new();
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        if !arg.starts_with("--") {
            words.push(*arg);
            continue;
        }
        flagged.push(*arg);
        if !arg.contains('=') {
            let value = args.next().ok_or_else(|| format!("{arg} needs a value"))?;
            flagged.push(*value);
        }
    }
    if words.is_empty() {
        return Err("usage: pa tell --project <projectId> <text>".to_string());
    }
    Ok((parse_flags(&flagged, &["--project"])?, words.join(" ")))
}

/// Triage is the one command with positional arguments after its flags: the
/// repository urls. Everything that is not a flag or a flag's value is a url.
fn parse_triage_args(args: &[&str]) -> Result<(Flags, Vec<String>), String> {
    let mut flagged: Vec<&str> = Vec::new();
    let mut urls: Vec<String> = Vec::new();
    let mut args = args.iter().peekable();
    while let Some(arg) = args.next() {
        if !arg.starts_with("--") {
            urls.push((*arg).to_string());
            continue;
        }
        flagged.push(*arg);
        // `--project=pj-1` carries its value; `--project pj-1` does not, and
        // that next argument is a value rather than a url.
        if !arg.contains('=') {
            let value = args.next().ok_or_else(|| format!("{arg} needs a value"))?;
            flagged.push(*value);
        }
    }
    if urls.is_empty() {
        return Err("usage: pa scout triage --project <projectId> <url>...".to_string());
    }
    Ok((parse_flags(&flagged, &["--project"])?, urls))
}

// -- the api ---------------------------------------------------------------

/// A connection's worth of knowledge: where the app listens and what it wants
/// to hear.
struct Api {
    port: u16,
    token: String,
}

impl Api {
    fn load() -> Result<Self, String> {
        let path = descriptor_path()?;
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| format!("cannot read {}: {e}\nis ProjectA running?", path.display()))?;
        let descriptor: Value = serde_json::from_str(&raw)
            .map_err(|e| format!("{} is not readable: {e}", path.display()))?;
        let port = descriptor
            .get("port")
            .and_then(Value::as_u64)
            .filter(|port| *port > 0 && *port <= u64::from(u16::MAX))
            .ok_or_else(|| format!("{} has no port", path.display()))?;
        let token = descriptor
            .get("token")
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
            .ok_or_else(|| format!("{} has no token", path.display()))?;

        Ok(Self {
            port: port as u16,
            token: token.to_string(),
        })
    }

    fn get(&self, path: &str, project_id: Option<&str>) -> Result<Value, String> {
        let target = match project_id {
            Some(project_id) => format!("{path}?projectId={}", encode(project_id)),
            None => path.to_string(),
        };
        self.request("GET", &target, None)
    }

    /// A GET with any set of optional query parameters. `get` covers the one
    /// filter almost every route has; this covers the routes with two.
    fn get_filtered(&self, path: &str, params: &[(&str, Option<&str>)]) -> Result<Value, String> {
        let query: Vec<String> = params
            .iter()
            .filter_map(|(name, value)| value.map(|value| format!("{name}={}", encode(value))))
            .collect();
        let target = if query.is_empty() {
            path.to_string()
        } else {
            format!("{path}?{}", query.join("&"))
        };
        self.request("GET", &target, None)
    }

    fn post(&self, path: &str, body: Value) -> Result<Value, String> {
        self.request("POST", path, Some(body.to_string()))
    }

    /// A POST that also carries the verdict token, when there is one to carry.
    ///
    /// A missing token is sent as a request without the header rather than
    /// refused here: what comes back is the app's own 403, which names the
    /// header and says who the token belongs to.
    fn post_verdict(
        &self,
        path: &str,
        body: Value,
        verdict_token: Option<String>,
    ) -> Result<Value, String> {
        self.send("POST", path, Some(body.to_string()), verdict_token)
    }

    /// A replacing write. `/api/budgets` is the only one so far: sending the
    /// same ceilings twice has to mean the same thing both times.
    fn put(&self, path: &str, body: Value) -> Result<Value, String> {
        self.request("PUT", path, Some(body.to_string()))
    }

    fn request(&self, method: &str, target: &str, body: Option<String>) -> Result<Value, String> {
        self.send(method, target, body, None)
    }

    fn send(
        &self,
        method: &str,
        target: &str,
        body: Option<String>,
        verdict_token: Option<String>,
    ) -> Result<Value, String> {
        let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, self.port));
        let mut stream = TcpStream::connect(addr)
            .map_err(|e| format!("cannot reach ProjectA on 127.0.0.1:{}: {e}", self.port))?;
        stream
            .set_read_timeout(Some(IO_TIMEOUT))
            .and_then(|()| stream.set_write_timeout(Some(IO_TIMEOUT)))
            .map_err(|e| format!("cannot set a timeout: {e}"))?;

        let body = body.unwrap_or_default();
        let verdict = verdict_token
            .map(|token| format!("{VERDICT_TOKEN_HEADER}: {token}\r\n"))
            .unwrap_or_default();
        let request = format!(
            "{method} {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n{TOKEN_HEADER}: {}\r\n{verdict}\
             Content-Type: application/json\r\nContent-Length: {}\r\n\
             Connection: close\r\n\r\n{body}",
            self.token,
            body.len()
        );
        stream
            .write_all(request.as_bytes())
            .map_err(|e| format!("cannot send the request: {e}"))?;

        let mut raw = Vec::new();
        stream
            .read_to_end(&mut raw)
            .map_err(|e| format!("cannot read the reply: {e}"))?;
        let raw = String::from_utf8_lossy(&raw).into_owned();
        let (head, body) = raw.split_once("\r\n\r\n").ok_or("the reply was not http")?;
        let status = head
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|code| code.parse::<u16>().ok())
            .ok_or("the reply had no status")?;

        let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
        if status >= 400 {
            let message = value
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("the request was refused");
            return Err(message.to_string());
        }
        Ok(value)
    }
}

fn request_plan_command(api: &Api, command: &Command) -> Result<Value, String> {
    match command {
        Command::HqPlan {
            project_id,
            plan_id,
            revision,
        } => {
            let revision = revision.map(|value| value.to_string());
            api.get_filtered(
                "/api/hq/v1/plan",
                &[
                    ("projectId", Some(project_id)),
                    ("planId", Some(plan_id)),
                    ("revision", revision.as_deref()),
                ],
            )
        }
        Command::HqPlanImport {
            project_id,
            plan_id,
            expected_projection_revision,
            rollback_reason,
        } => {
            let mut body = json!({
                "projectId": project_id,
                "planId": plan_id,
                "expectedProjectionRevision": expected_projection_revision,
            });
            if let Some(reason) = rollback_reason {
                body["rollbackReason"] = Value::String(reason.clone());
            }
            api.post("/api/hq/v1/plan/import", body)
        }
        _ => unreachable!("only plan commands use this request"),
    }
}

/// Where the descriptor is: the override, or the app data directory Tauri uses.
fn descriptor_path() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os(ENV_DESCRIPTOR) {
        return Ok(PathBuf::from(path));
    }
    if let Some(dir) = std::env::var_os(ENV_APP_DATA).filter(|path| !path.is_empty()) {
        return Ok(PathBuf::from(dir).join(DESCRIPTOR_FILE));
    }
    Ok(data_path_in(&app_data_dir()?, IDENTIFIER, DESCRIPTOR_FILE))
}

/// The same directory `AppHandle::path().app_data_dir()` resolves to, minus the
/// identifier - which is the one thing a second binary cannot ask Tauri for.
fn app_data_dir() -> Result<PathBuf, String> {
    #[cfg(windows)]
    let dir = std::env::var_os("APPDATA").map(PathBuf::from);

    #[cfg(target_os = "macos")]
    let dir = std::env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
    });

    #[cfg(all(unix, not(target_os = "macos")))]
    let dir = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
        });

    dir.ok_or_else(|| format!("cannot find the application data directory; set {ENV_DESCRIPTOR}"))
}

/// Percent-encode everything that is not unreserved. Worker and project ids
/// never need it, but a url built by string concatenation should not be the
/// place where that assumption is tested.
fn encode(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for byte in raw.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

// -- output ----------------------------------------------------------------

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("-")
        .to_string()
}

fn print_json(value: &Value) {
    println!("{value}");
}

fn render_project(project: &Value) -> String {
    let mut out = String::new();
    for (label, key) in [("id", "id"), ("name", "name"), ("repo", "repoPath")] {
        let value = text(project, key);
        out.push_str(&format!(
            "{label:<9}{}\n",
            if value.is_empty() { "-" } else { &value }
        ));
    }
    out
}

fn render_worker(worker: &Value) -> String {
    let mut out = String::new();
    for (label, key) in [
        ("id", "id"),
        ("project", "projectId"),
        ("kind", "kind"),
        ("profile", "profileId"),
        ("status", "status"),
        ("branch", "branch"),
        ("worktree", "worktreePath"),
        ("task", "task"),
    ] {
        let value = text(worker, key);
        out.push_str(&format!(
            "{label:<9}{}\n",
            if value.is_empty() { "-" } else { &value }
        ));
    }
    out
}

fn render_worker_delivery(delivery: &Value) -> String {
    let outcome = match delivery.get("status").and_then(Value::as_str) {
        Some("completed") => "done",
        Some("failed") => "blocked",
        Some(status) => status,
        None => "unknown",
    };
    let prefix = if delivery
        .get("repeated")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        "delivery already recorded"
    } else {
        "delivery recorded"
    };
    format!("{prefix}: {outcome} (run {})\n", text(delivery, "runId"))
}

fn render_worker_list(workers: &Value) -> String {
    let Some(workers) = workers.as_array() else {
        return "no workers\n".to_string();
    };
    if workers.is_empty() {
        return "no workers\n".to_string();
    }
    let width = workers
        .iter()
        .map(|worker| text(worker, "id").len())
        .max()
        .unwrap_or(2);

    let mut out = String::new();
    for worker in workers {
        out.push_str(&format!(
            "{:<width$}  {:<9}  {:<12}  {:<8}  {}\n",
            text(worker, "id"),
            text(worker, "status"),
            text(worker, "kind"),
            text(worker, "profileId"),
            text(worker, "task"),
            width = width
        ));
    }
    out
}

fn render_queue_entry(entry: &Value) -> String {
    let mut out = String::new();
    for (label, key) in [
        ("id", "id"),
        ("project", "projectId"),
        ("status", "status"),
        ("profile", "profileId"),
        ("priority", "priority"),
        ("task", "rawText"),
    ] {
        let value = entry.get(key).map_or_else(
            || "-".to_string(),
            |value| match value {
                Value::String(value) => value.clone(),
                _ => value.to_string(),
            },
        );
        out.push_str(&format!("{label:<9}{value}\n"));
    }
    out
}

fn render_queue_list(entries: &Value) -> String {
    let Some(entries) = entries.as_array() else {
        return "no queued tasks\n".to_string();
    };
    if entries.is_empty() {
        return "no queued tasks\n".to_string();
    }
    let mut out = String::new();
    for entry in entries {
        out.push_str(&format!(
            "{:<18}  {:<11}  {:<8}  {}\n",
            text(entry, "id"),
            text(entry, "status"),
            text(entry, "profileId"),
            text(entry, "rawText")
        ));
    }
    out
}

/// The text a learning already carries, for `approve` without `--text`.
fn stored_learning_text(api: &Api, id: &str) -> Result<String, String> {
    let learnings = api.get("/api/learnings", None)?;
    learnings
        .as_array()
        .and_then(|rows| {
            rows.iter()
                .find(|row| row.get("id").and_then(Value::as_str) == Some(id))
        })
        .and_then(|row| row.get("content"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("unknown learning: {id}"))
}

/// One line per learning: enough to pick one out, not enough to read it. The
/// full text is in the app - and a playbook bullet is a paragraph, not a title.
fn render_learning_list(learnings: &Value) -> String {
    let Some(learnings) = learnings.as_array() else {
        return "no learnings\n".to_string();
    };
    if learnings.is_empty() {
        return "no learnings\n".to_string();
    }
    let mut out = String::new();
    for learning in learnings {
        out.push_str(&format!(
            "{:<20}  {:<9}  {:<14}  {}\n",
            text(learning, "id"),
            text(learning, "status"),
            text(learning, "patternLabel"),
            shorten(&text(learning, "content"), 72)
        ));
    }
    out
}

/// One question, as the thing an agent has to read after `pa ask` and after
/// `pa answer`.
///
/// The status line comes first and is the whole point: `pa ask` answers with
/// an *open* question most of the time, but a worker that has too many already
/// gets one back that is already decided, and an agent that only read the id
/// would sit and wait for an answer it is holding.
fn render_question(question: &Value) -> String {
    let mut out = format!(
        "{:<12}{}\n{:<12}{}\n",
        "question",
        text(question, "id"),
        "status",
        text(question, "status")
    );
    // `workerId` and `optionsJson` are absent on whole shapes of question - a
    // preflight one has no worker, most have no options - so they are left out
    // rather than printed as the "-" `text` would hand back. A line that is
    // there is a line that says something.
    for (label, key) in [
        ("project", "projectId"),
        ("worker", "workerId"),
        ("scope", "scope"),
    ] {
        if let Some(value) = question.get(key).and_then(Value::as_str) {
            out.push_str(&format!("{label:<12}{value}\n"));
        }
    }
    out.push_str(&format!("{:<12}{}\n", "asked", text(question, "question")));
    if let Some(options) = question.get("optionsJson").and_then(Value::as_str) {
        out.push_str(&format!("{:<12}{options}\n", "options"));
    }
    match question.get("answer").and_then(Value::as_str) {
        Some(answer) => out.push_str(&format!("{:<12}{answer}\n", "answer")),
        // Said out loud rather than left off: this is the case the agent has
        // to act on, and "no line" is easy to read past.
        None => out.push_str(&format!(
            "{:<12}noch offen - die Antwort kommt in dein Terminal\n",
            "answer"
        )),
    }
    out
}

/// One line per question: what it is, whose it is, and what came of it.
fn render_question_list(questions: &Value) -> String {
    let Some(questions) = questions.as_array().filter(|list| !list.is_empty()) else {
        return "no questions\n".to_string();
    };
    let mut out = String::new();
    for question in questions {
        out.push_str(&format!(
            "{:<20}  {:<9}  {:<20}  {}\n",
            text(question, "id"),
            text(question, "status"),
            text(question, "workerId"),
            shorten(&text(question, "question"), 60)
        ));
    }
    out
}

/// One line, cut to `max` characters with an ellipsis when it was longer.
fn shorten(content: &str, max: usize) -> String {
    let single = content.split_whitespace().collect::<Vec<_>>().join(" ");
    if single.chars().count() <= max {
        return single;
    }
    let kept: String = single.chars().take(max.saturating_sub(1)).collect();
    format!("{kept}\u{2026}")
}

/// Two lines per role: what it is, and what it was distilled from. The system
/// prompt itself stays in the app - it is a paragraph, and this is a list.
fn render_role_list(roles: &Value) -> String {
    let Some(roles) = roles.as_array() else {
        return "no roles\n".to_string();
    };
    if roles.is_empty() {
        return "no roles\n".to_string();
    }
    let mut out = String::new();
    for role in roles {
        let version = format!(
            "v{}",
            role.get("version").and_then(Value::as_i64).unwrap_or(1)
        );
        out.push_str(&format!(
            "{:<20}  {:<9}  {:<4}  {}\n",
            text(role, "id"),
            text(role, "status"),
            version,
            text(role, "name")
        ));
        out.push_str(&format!(
            "{:<20}  {}  ({})\n",
            "",
            text(role, "patternLabel"),
            text(role, "baseProfileId")
        ));
    }
    out
}

fn render_recommendation_list(recommendations: &Value) -> String {
    let Some(recommendations) = recommendations.as_array() else {
        return "no recommendations
"
        .to_string();
    };
    if recommendations.is_empty() {
        return "no recommendations
"
        .to_string();
    }
    let mut out = String::new();
    for rec in recommendations {
        out.push_str(&format!(
            "{:<20}  {:<9}  {:<6}  {}
",
            text(rec, "id"),
            text(rec, "status"),
            text(rec, "effort"),
            text(rec, "title")
        ));
        out.push_str(&format!(
            "{:<20}  {}
",
            "",
            text(rec, "rationale")
        ));
        if let Some(url) = rec.get("url").and_then(Value::as_str) {
            out.push_str(&format!(
                "{:<20}  {url}
",
                ""
            ));
        }
    }
    out
}

fn render_worker_state(state: &Value) -> String {
    let worker = state.get("worker").cloned().unwrap_or(Value::Null);
    let mut out = render_worker(&worker);
    out.push_str(&format!("{:<9}{}\n", "column", text(state, "column")));
    if let Some(reason) = state.get("attentionReason").and_then(Value::as_str) {
        out.push_str(&format!("{:<9}{reason}\n", "reason"));
    }
    if let Some(pr_url) = state.get("prUrl").and_then(Value::as_str) {
        out.push_str(&format!("{:<9}{pr_url}\n", "pr"));
    }
    if let Some(usage) = state.get("contextUsage").filter(|usage| !usage.is_null()) {
        let used = usage.get("used").and_then(Value::as_u64).unwrap_or(0);
        let total = usage.get("total").and_then(Value::as_u64).unwrap_or(0);
        let percent = (used * 100).checked_div(total).unwrap_or(0);
        out.push_str(&format!(
            "{:<9}{used}/{total} tokens ({percent}%)\n",
            "context"
        ));
    }
    out
}

fn render_board(board: &Value) -> String {
    let Some(states) = board.as_array() else {
        return "no workers\n".to_string();
    };
    if states.is_empty() {
        return "no workers\n".to_string();
    }

    // Fixed order, so the same board always reads the same way.
    const COLUMNS: [&str; 5] = [
        "working",
        "needs_you",
        "in_review",
        "ready_to_merge",
        "done",
    ];

    let mut out = String::new();
    for column in COLUMNS {
        let rows: Vec<&Value> = states
            .iter()
            .filter(|state| text(state, "column") == column)
            .collect();
        if rows.is_empty() {
            continue;
        }
        out.push_str(&format!("{column} ({})\n", rows.len()));
        for state in rows {
            let worker = state.get("worker").cloned().unwrap_or(Value::Null);
            let reason = state
                .get("attentionReason")
                .and_then(Value::as_str)
                .map(|reason| format!("  <- {reason}"))
                .unwrap_or_default();
            out.push_str(&format!(
                "  {}  {}{reason}\n",
                text(&worker, "id"),
                text(&worker, "task")
            ));
        }
    }
    out
}

/// One project's hierarchy as indented lines: coordinators with their agents
/// underneath, then the employees nobody claimed. Pure, so the shape of a tree
/// can be asserted without a running app.
fn render_tree(tree: &Value) -> String {
    fn walk(nodes: Option<&Value>, depth: usize, out: &mut String) {
        let Some(nodes) = nodes.and_then(Value::as_array) else {
            return;
        };
        for node in nodes {
            out.push_str(&format!(
                "{}{}  {}  {}  {}\n",
                "  ".repeat(depth),
                text(node, "id"),
                text(node, "kind"),
                text(node, "status"),
                text(node, "task")
            ));
            walk(node.get("children"), depth + 1, out);
        }
    }

    let mut out = String::new();
    walk(tree.get("coordinators"), 0, &mut out);
    walk(tree.get("workers"), 0, &mut out);
    if out.is_empty() {
        // An empty project should read as an answer, not as a failed call.
        return "no agents\n".to_string();
    }
    out
}

/// One line per feed entry: how long ago, what kind of event, which worker,
/// and the one-line summary. Pure, so the shape can be asserted without a
/// running app.
fn render_activity(feed: &Value) -> String {
    let Some(entries) = feed.as_array() else {
        return "no activity\n".to_string();
    };
    if entries.is_empty() {
        return "no activity\n".to_string();
    }
    let mut out = String::new();
    for entry in entries {
        let when = entry
            .get("createdAt")
            .and_then(Value::as_i64)
            .map(age)
            .unwrap_or_else(|| "-".to_string());
        // The label is the worker's shortened task when there is one; the
        // worker id is the fallback, and a project-level event has neither.
        let who = match text(entry, "workerLabel").as_str() {
            "" | "-" => text(entry, "workerId"),
            label => label.to_string(),
        };
        out.push_str(&format!(
            "{:>6}  {:<14}  {:<24}  {}\n",
            when,
            text(entry, "category"),
            shorten(&who, 24),
            text(entry, "summary")
        ));
    }
    out
}

/// How long ago a Unix-second timestamp is, as "42s", "5m", "3h" or "12d".
/// The feed is read by glancing, so a relative age beats a wall-clock string.
fn age(unix_seconds: i64) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0i64, |d| d.as_secs() as i64);
    let seconds = now.saturating_sub(unix_seconds).max(0);
    if seconds < 60 {
        format!("{seconds}s")
    } else if seconds < 3600 {
        format!("{}m", seconds / 60)
    } else if seconds < 86_400 {
        format!("{}h", seconds / 3600)
    } else {
        format!("{}d", seconds / 86_400)
    }
}

fn render_digest_list(dates: &Value) -> String {
    let Some(rows) = dates.as_array().filter(|rows| !rows.is_empty()) else {
        return "no digests\n".to_string();
    };
    let mut out = String::new();
    for row in rows {
        if let Some(date) = row.as_str() {
            out.push_str(date);
            out.push('\n');
        }
    }
    out
}

/// One `--five-hour` / `--seven-day` value: absent, `off`, or a percentage.
fn parse_budget_flag(flags: &Flags, name: &str) -> Result<Option<Option<u8>>, String> {
    let Some(raw) = flags.value(name) else {
        return Ok(None);
    };
    let raw = raw.trim().to_ascii_lowercase();
    if raw == "off" || raw == "none" {
        return Ok(Some(None));
    }
    let percent: u8 = raw
        .parse()
        .ok()
        .filter(|percent| (1..=100).contains(percent))
        .ok_or_else(|| format!("{name} must be a whole percentage between 1 and 100, or off"))?;
    Ok(Some(Some(percent)))
}

/// A ceiling as a column, or an em dash where there is none.
fn budget_cell(row: &Value, key: &str) -> String {
    row.get(key)
        .and_then(Value::as_u64)
        .map_or_else(|| "\u{2014}".to_string(), |percent| format!("{percent}%"))
}

fn render_budgets(budgets: &Value) -> String {
    let Some(rows) = budgets.as_array().filter(|rows| !rows.is_empty()) else {
        return "no budgets set\n".to_string();
    };
    let mut out = String::from("profile     5h     7d\n");
    for row in rows {
        out.push_str(&format!(
            "{:<10}  {:<5}  {}\n",
            text(row, "profileId"),
            budget_cell(row, "fiveHourPct"),
            budget_cell(row, "sevenDayPct")
        ));
    }
    out
}

/// What `pa estop` can do. `Status` is the default and changes nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StopAction {
    Status,
    On,
    Off,
}

fn request_emergency_stop(
    api: &Api,
    action: StopAction,
    token: Option<String>,
) -> Result<Value, String> {
    match action {
        StopAction::Status => api.get("/api/emergency-stop", None),
        StopAction::On => api.post("/api/emergency-stop", json!({ "active": true })),
        StopAction::Off => api.post_verdict(
            "/api/emergency-stop",
            json!({ "active": false }),
            verdict_token(token)?,
        ),
    }
}

/// One line per provider: what it is, whether it was found, what it is
/// saying about quota, and the latest usage snapshot. Deliberately never a
/// key - the API does not serve them and this would be the wrong place to
/// print one if it did.
fn render_providers(providers: &Value) -> String {
    let Some(rows) = providers.as_array().filter(|rows| !rows.is_empty()) else {
        return "no providers\n".to_string();
    };

    let usage_texts: Vec<String> = rows
        .iter()
        .map(|row| render_usage(row.get("usage").unwrap_or(&Value::Null)))
        .collect();
    let usage_width = usage_texts
        .iter()
        .map(|s| s.chars().count())
        .max()
        .unwrap_or(3)
        .max(5);

    let mut out = String::new();
    for (row, usage) in rows.iter().zip(usage_texts.iter()) {
        let connected = row
            .get("connected")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let detail = row
            .get("detail")
            .and_then(Value::as_str)
            .map(|detail| format!("  {detail}"))
            .unwrap_or_default();
        out.push_str(&format!(
            "{:<12}{:<14}{:<14}{:<12}{:<usage_width$}{detail}\n",
            text(row, "id"),
            text(row, "kind"),
            if connected { "connected" } else { "not found" },
            text(row, "quotaState"),
            usage,
            usage_width = usage_width,
        ));
    }
    out
}

/// Compact rendering of one `ProviderUsage` value, or "—" when unknown.
fn render_usage(usage: &Value) -> String {
    if usage.is_null() {
        return "—".to_string();
    }
    let percent = usage.get("percent").and_then(Value::as_u64);
    let resets_at = usage.get("resetsAt").and_then(Value::as_i64);
    let window_label = usage
        .get("windowLabel")
        .and_then(Value::as_str)
        .unwrap_or("");

    if let Some(p) = percent {
        let mut out = format!("{p}%");
        if let Some(ts) = resets_at {
            if let Some(remaining) = human_duration_until(ts) {
                out.push_str(&format!(" ({remaining})"));
            } else if !window_label.is_empty() {
                out.push_str(&format!(" ({window_label})"));
            }
        } else if !window_label.is_empty() {
            out.push_str(&format!(" ({window_label})"));
        }
        return out;
    }

    // A known amount without a percentage is not unknown: it shows the
    // amount, with the reset time or the window label as the qualifier.
    if let Some(used) = usage.get("used").and_then(Value::as_str) {
        let mut out = used.to_string();
        if let Some(ts) = resets_at {
            if let Some(remaining) = human_duration_until(ts) {
                out.push_str(&format!(" ({remaining})"));
                return out;
            }
        }
        if !window_label.is_empty() {
            out.push_str(&format!(" ({window_label})"));
        }
        return out;
    }

    if !window_label.is_empty() {
        return window_label.to_string();
    }
    "—".to_string()
}

/// The OmniRoute ledger: the state of the feed, the totals, then the rows.
///
/// Two columns are `—` on purpose. A row's cost is unknown because the log
/// prices nothing, and the profile is unknown because the log carries no
/// session - so the report says so instead of printing a zero and a guess.
fn render_usage_report(report: &Value) -> String {
    let mut out = String::new();

    let online = report
        .get("online")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let authorized = report
        .get("authorized")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    out.push_str(&format!(
        "omniroute  {}, management api {}\n",
        if online { "online" } else { "offline" },
        if authorized { "open" } else { "closed" }
    ));
    if !authorized {
        out.push_str(
            "           no management token, or the router refused it - \
             the ledger is not filling\n",
        );
    }

    out.push_str(&format!(
        "today      {}\ntotal      {}\n",
        render_usage_totals(report.get("today")),
        render_usage_totals(report.get("total"))
    ));
    if let Some(cost) = report.get("reportedCostUsd").and_then(Value::as_f64) {
        out.push_str(&format!(
            "reported   {cost:.4} USD lifetime, by omniroute itself\n"
        ));
    }

    let Some(events) = report
        .get("events")
        .and_then(Value::as_array)
        .filter(|events| !events.is_empty())
    else {
        out.push_str("\nno usage events stored yet\n");
        return out;
    };

    out.push('\n');
    for event in events {
        let cost = event
            .get("costUsd")
            .and_then(Value::as_f64)
            .map_or_else(|| "—".to_string(), |cost| format!("{cost:.4}"));
        let profile = event
            .get("profileId")
            .and_then(Value::as_str)
            .unwrap_or("—");
        out.push_str(&format!(
            "{}  {:<24}  {:<12}  {:>9} in  {:>7} out  {:>9} USD  {profile}\n",
            iso_minute(event.get("ts").and_then(Value::as_i64).unwrap_or(0)),
            shorten(&text(event, "model"), 24),
            shorten(&text(event, "provider"), 12),
            event.get("tokensIn").and_then(Value::as_i64).unwrap_or(0),
            event.get("tokensOut").and_then(Value::as_i64).unwrap_or(0),
            cost
        ));
    }
    out
}

fn render_usage_totals(totals: Option<&Value>) -> String {
    let Some(totals) = totals else {
        return "—".to_string();
    };
    let number = |key: &str| totals.get(key).and_then(Value::as_i64).unwrap_or(0);
    let priced = number("priced");
    let cost = if priced == 0 {
        // Not "0.0000 USD": nothing was priced, which is not the same as free.
        "no priced rows".to_string()
    } else {
        format!(
            "{:.4} USD over {priced} priced row(s)",
            totals.get("costUsd").and_then(Value::as_f64).unwrap_or(0.0)
        )
    };
    format!(
        "{} request(s), {} in / {} out tokens, {cost}",
        number("requests"),
        number("tokensIn"),
        number("tokensOut")
    )
}

/// A whole number of the response, or `0` where the field is missing.
fn num(value: &Value, key: &str) -> i64 {
    value.get(key).and_then(Value::as_i64).unwrap_or(0)
}

/// `key=count` pairs of a `[{key, count}]` array, joined for one line.
fn label_counts(rows: Option<&Value>) -> String {
    rows.and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter(|row| row.get("count").and_then(Value::as_i64).unwrap_or(0) > 0)
                .map(|row| format!("{} {}", num(row, "count"), text(row, "key")))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default()
}

/// Seconds as the largest unit that stays readable.
fn duration(seconds: i64) -> String {
    match seconds {
        s if s < 60 => format!("{s} s"),
        s if s < 3600 => format!("{} min", s / 60),
        s => format!("{} h {} min", s / 3600, (s % 3600) / 60),
    }
}

/// `YYYY-MM-DD HH:MM` in UTC, the same convention the digests use.
fn iso_minute(unix_seconds: i64) -> String {
    let day = unix_seconds.div_euclid(86_400);
    let rest = unix_seconds.rem_euclid(86_400);
    // Hinnant's civil_from_days, the same arithmetic as `digest::utc_date` -
    // pa is its own binary and shares no module with the app.
    let z = day + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02}",
        rest / 3600,
        (rest % 3600) / 60
    )
}

fn human_duration_until(unix_seconds: i64) -> Option<String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0i64, |d| d.as_secs() as i64);
    let seconds = unix_seconds.saturating_sub(now);
    if seconds <= 0 {
        return None;
    }
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    if hours > 0 {
        Some(format!("{hours}h"))
    } else if minutes > 0 {
        Some(format!("{minutes}m"))
    } else {
        Some(format!("{seconds}s"))
    }
}

#[cfg(test)]
#[rustfmt::skip]
#[path = "pa/tests.rs"]
mod tests;
