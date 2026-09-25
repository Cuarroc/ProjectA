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
//! pa diagnosis
//! pa budget list
//! pa budget set --profile claude [--five-hour 90] [--seven-day off]
//! pa digest list --project pj-1
//! pa digest show --project pj-1 2026-08-27
//! pa stats --project pj-1 [--range week]
//! pa providers
//! pa usage [--limit 50]
//! pa hq runtime
//! pa hq agent context|candidate|evidence|read-evidence
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

#[path = "../db_restore.rs"]
mod db_restore;

/// Descriptor written by the app on startup.
const DESCRIPTOR_FILE: &str = "projecta-api.json";

/// Tauri bundle identifier; the app data directory is named after it.
const IDENTIFIER: &str = "com.projecta.app";

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
  pa hq agent candidate|evidence --input <json-file>
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
            None => {
                // The tree route is bound to a project path, so there is no
                // single request for everything: ask which projects exist,
                // then ask each of them for its tree.
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
            }
        },

        Command::Quota => {
            let quota = api.get("/api/quota", None)?;
            print!("{}", render_quota(&quota));
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
            // The page is Markdown that already ends in a newline; printing it
            // verbatim is what makes `pa digest show ... > file` useful.
            match page.get("markdown").and_then(Value::as_str) {
                Some(markdown) => print!("{markdown}"),
                None => println!("(no digest for {date})"),
            }
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

fn default_db_path() -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os(ENV_APP_DATA).filter(|path| !path.is_empty()) {
        return Ok(PathBuf::from(dir).join("projecta.db"));
    }
    Ok(app_data_dir()?.join(IDENTIFIER).join("projecta.db"))
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
/// Rejects non-regular files and files reported larger than the limit before
/// reading. This metadata check does not fence later file growth or replacement.
/// First line only: the rest of the file cannot reach the request head.
fn read_token_file(path: &str) -> Result<String, String> {
    const MAX_TOKEN_FILE: u64 = 4096;

    let meta = std::fs::metadata(path)
        .map_err(|e| format!("could not read the verdict token from {path}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("the verdict token file {path} is not a file"));
    }
    if meta.len() > MAX_TOKEN_FILE {
        return Err(format!(
            "the verdict token file {path} is {} bytes; a token is 32",
            meta.len()
        ));
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
    let contents = std::fs::read_to_string(path)
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
            let (sub, rest) = rest
                .split_first()
                .ok_or("worker needs a subcommand: spawn, list, status, send or merge")?;
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
                .ok_or("hq agent needs context, lessons, release, candidate or evidence")?;
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
                "candidate" | "evidence" | "checkpoint" => {
                    let flags = parse_flags(flags, &["--input"])?;
                    Ok(Command::HqAgent {
                        operation: operation.to_string(),
                        input: Some(required(&flags, "--input")?),
                    })
                }
                _ => Err("hq agent needs context, lessons, release, candidate --input or evidence --input".into()),
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
    Ok(app_data_dir()?.join(IDENTIFIER).join(DESCRIPTOR_FILE))
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

fn render_quota(quota: &Value) -> String {
    let Some(rows) = quota.as_array() else {
        return "no quota information\n".to_string();
    };
    if rows.is_empty() {
        return "no quota information\n".to_string();
    }

    let mut out = String::new();
    for row in rows {
        let reason = row
            .get("reason")
            .and_then(Value::as_str)
            .map(|reason| format!("  {reason}"))
            .unwrap_or_default();
        out.push_str(&format!(
            "{:<10}  {}{reason}\n",
            text(row, "profileId"),
            text(row, "state")
        ));
    }
    if rows
        .first()
        .and_then(|row| row.get("omniRouteOnline"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        out.push_str("omniroute  online\n");
    }
    out
}

/// Log path and panic flags only. The pack stays in the window so an agent
/// that can read `pa` cannot walk away with log excerpts.
fn render_diagnosis(body: &Value) -> String {
    let log_path = text(body, "logPath");
    let panic_current = body
        .get("panicCurrent")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let panic_previous = body
        .get("panicPrevious")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let panic = if panic_current || panic_previous {
        "panic marker present — open Diagnose in the window"
    } else {
        "no panic marker"
    };
    format!("{log_path}\n{panic}\n")
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

/// `YYYY-MM-DD HH:MM` in UTC, the same convention the digests use.
/// One project's statistics as a page of plain text.
///
/// Two things it refuses to do, both of them the reason the statistics tab
/// exists at all: it prints "not measured" where the OmniRoute ledger has no
/// rows rather than a row of zeroes, and it prints the completion figure with
/// the word "estimated" and its own arithmetic under it rather than alone.
fn render_stats(stats: &Value) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "{}  ({})\nrange      {}\n\n",
        text(stats, "projectName"),
        text(stats, "projectId"),
        text(stats, "range")
    ));

    let overview = stats.get("overview").unwrap_or(&Value::Null);
    out.push_str(&format!(
        "workers    {} active, {} archived, {} total\n",
        num(overview, "workersActive"),
        num(overview, "workersArchived"),
        num(overview, "workersTotal")
    ));
    let columns = label_counts(overview.get("byColumn"));
    if !columns.is_empty() {
        out.push_str(&format!("board      {columns}\n"));
    }
    let queue = label_counts(overview.get("queue"));
    out.push_str(&format!(
        "queue      {}\n",
        if queue.is_empty() {
            "empty".to_string()
        } else {
            queue
        }
    ));
    out.push_str(&format!(
        "attention  {} card(s) waiting on you\nlearnings  {} pending\n",
        num(overview, "needsAttention"),
        num(overview, "learningsPending")
    ));
    out.push_str(&format!(
        "activity   {} message(s), {} status event(s), {} review comment(s) in range\n",
        num(overview, "messages"),
        num(overview, "statusEvents"),
        num(overview, "diffComments")
    ));

    out.push('\n');
    match stats.get("tokens") {
        None | Some(Value::Null) => out.push_str(
            "tokens     not measured - the omniroute ledger has no rows for this window.\n\
             \x20          only agents routed through omniroute are counted at all;\n\
             \x20          a cli talking to its vendor directly spends tokens nothing here sees.\n",
        ),
        Some(tokens) => {
            out.push_str(&format!(
                "tokens     {} request(s), {} in / {} out (fleet-wide, not per project)\n",
                num(tokens, "requests"),
                num(tokens, "tokensIn"),
                num(tokens, "tokensOut")
            ));
            let priced = tokens.get("priced").and_then(Value::as_i64).unwrap_or(0);
            out.push_str(&format!(
                "           {}\n",
                if priced == 0 {
                    "no price on any row - omniroute's request log carries tokens only".to_string()
                } else {
                    format!(
                        "{:.4} USD over {priced} priced row(s)",
                        tokens.get("costUsd").and_then(Value::as_f64).unwrap_or(0.0)
                    )
                }
            ));
            for row in tokens
                .get("byProfile")
                .and_then(Value::as_array)
                .unwrap_or(&Vec::new())
            {
                let mine = row
                    .get("usedByProject")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                out.push_str(&format!(
                    "           {:<16} {:>7} req  {:>10} in  {:>10} out{}\n",
                    row.get("profileId")
                        .and_then(Value::as_str)
                        .unwrap_or("(unattributed)"),
                    num(row, "requests"),
                    num(row, "tokensIn"),
                    num(row, "tokensOut"),
                    if mine {
                        "  <- used by this project"
                    } else {
                        ""
                    }
                ));
            }
        }
    }

    let sessions = stats.get("sessions").unwrap_or(&Value::Null);
    out.push_str(&format!(
        "\nsessions   {} total, {} ended, {} still open\n",
        num(sessions, "total"),
        num(sessions, "ended"),
        num(sessions, "open")
    ));
    if sessions.get("ended").and_then(Value::as_i64).unwrap_or(0) > 0 {
        out.push_str(&format!(
            "           {} in total, median {}\n           {} non-zero exit(s), {} with no code at all\n",
            duration(sessions.get("totalSeconds").and_then(Value::as_i64).unwrap_or(0)),
            sessions
                .get("medianSeconds")
                .and_then(Value::as_i64)
                .map_or_else(|| "—".to_string(), duration),
            num(sessions, "failed"),
            num(sessions, "unknownExit")
        ));
    }

    let completion = stats.get("completion").unwrap_or(&Value::Null);
    match completion.get("percent").and_then(Value::as_f64) {
        None => out
            .push_str("\nestimate   nothing to estimate from - no workers and no queue entries\n"),
        Some(percent) => {
            out.push_str(&format!(
                "\nestimate   {percent:.0} % (estimated, not measured)\n"
            ));
            for part in completion
                .get("components")
                .and_then(Value::as_array)
                .unwrap_or(&Vec::new())
            {
                out.push_str(&format!(
                    "           {:<8} weight {:.2}  score {:.2}  {}\n",
                    text(part, "key"),
                    part.get("weight").and_then(Value::as_f64).unwrap_or(0.0),
                    part.get("score").and_then(Value::as_f64).unwrap_or(0.0),
                    text(part, "detail")
                ));
            }
        }
    }

    let timeline = stats
        .get("timeline")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if !timeline.is_empty() {
        out.push_str("\nday          messages  events\n");
        for day in timeline
            .iter()
            .rev()
            .take(14)
            .collect::<Vec<_>>()
            .iter()
            .rev()
        {
            out.push_str(&format!(
                "{:<12} {:>8}  {:>6}\n",
                text(day, "date"),
                num(day, "messages"),
                num(day, "statusEvents")
            ));
        }
    }
    out
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
mod tests {
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
        for line in include_str!("pa.rs").lines() {
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

    #[test]
    fn the_descriptor_can_be_pointed_somewhere_else() {
        // Reading the environment is process-wide, so this test owns both
        // override variables for its duration and puts them back. Sibling
        // tests must not touch them in parallel.
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
}
