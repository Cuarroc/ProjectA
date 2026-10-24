# AGENTS.md

Shared instructions for every agent working on ProjectA. ProjectA is a Tauri 2
agentic terminal: one implementation task, one agent, one git worktree. The
user is a beginner who cannot review code; the rules below exist so that green
means something.

## The ten core rules

Everything else in this file and in `docs/development/WORKFLOW.md` is
reference. Where a detail contradicts these ten, the ten win.

1. **One package = one branch = one agent = one worktree = one PR.** At most
   300 diff lines including tests (size M, `docs/PLAN.md` rule 7); bigger work
   is split before dispatch. A fix round forced by a review may take the
   package to at most 400 lines; the PR report records the overrun and the
   forcing finding IDs.
2. **Red test first for every bug** (red-first): a compiling, failing
   regression test, then the fix. Only pure documentation is exempt. A visual
   claim needs an inspected screenshot, a runtime claim a measurement.
3. **Green means `prepush` in your own worktree.** The hook prints the path and
   commit it checks; if they are not yours, nothing is verified. Never
   `--no-verify`, never mask an exit code.
4. **Push early, hand over early.** Commit *and push* after every green step;
   nothing stays only local (WIP commits are fine, the shared stash is not).
   Keep sessions short (well under ~150k tokens of context) and hand over with
   a note instead of running long.
5. **Reviews by risk, at most two rounds.** Tier A (seam, security,
   concurrency, PTY, database): two different families, both outside the author's.
   Tier B (other Rust/TS): two, one subscription reviewer and one OpenRouter
   reviewer, from different non-author families. E1 (Elias, 2026-10-20): while
   OpenRouter credit is <= 0, a second subscription family may replace OpenRouter;
   no purchase; free models never count. Tier C (docs, tests, snapshots,
   config without runtime effect): gates only; C+ (tests adding skip/timeout/retry
   or weakening assertions): one outside reviewer. Fix-round delta: one outside
   reviewer, two if tier-A files change. After round two Root decides merge,
   split or drop, records it in the PR report and informs the user.
6. **The four seams only serially:** `src-tauri/src/api.rs`, `main.rs`,
   `store.rs` (with `store/`), `bin/pa.rs`. Never two agents on one at once.
7. **The PR text is the report.** It opens with three German sentences for the
   user, then a `## Report` section: what changed, evidence (command + exit
   code), `NICHT ABGEDECKT`, review disposition. No mandatory report file, no
   committed review prompts. Code, commits and the technical report are in
   English; everything addressed to the user is in plain German.
8. **Merge only through the Mergify queue. A red `main` stops the queue:** fix
   `main` first, then continue with new work.
9. **No claim without observation.** Status, model names and limits only with
   date and command output; whoever takes a claim over re-checks it. Before
   every worker start, run the start check: observed model, remaining limit,
   free RAM, running cargo builds.
10. **Safety stays with the user.** Secret scan before every commit; secrets
    never go into files, logs or commits. Money, installs, releases and
    deleting require a valid concrete user authorization, and every cleanup
    starts with a backup. A release needs the user's yes, unless a standing
    written approval of the user covers it (e.g. patch releases), recorded in
    the coordinator's permission record; minor and major releases always need
    a fresh yes. Preserve already granted authorizations; do not ask
    again for routine execution within that scope. Bundle essential questions
    in normal chat and record decisions in `docs/PLAN.md`; no AskUser windows.

## Start with current evidence

Inside AgentsRoom, first read the project-memory note `lage-jetzt`; read
`STAND.md`, then `docs/PLAN.md` (the only plan: goals Z1–Z4 (M1–M5 are
historical), parked and cut work, decision inbox), then run
`bash scripts/sync.sh start`. Check
branch, worktrees and working changes. Preserve unrelated work. Historical
status is not live evidence: take the live state from `gh pr list` and
`git log origin/main`. Never launch the desktop app just to inspect it: its
queue can immediately dispatch real workers.

The start check (rule 9) before every worker: run
`npm run dev:start-check` (read-only, no money, no network). It prints one line
each for free RAM (`--min-free-gb`, default 1.5), running cargo builds
(`--max-cargo`, default 2), the provider limit (`--usage <file>`) and whether an
already started worker still writes output (`--observe-log <file>`). Exit 1 (a
limit violated), 3 (worker silent) or 2 (call error) is a hard stop: do not start
the worker. The model the harness actually reports stays a human observation, the
command cannot see it. Details: `scripts/dev/README.md`.

Use the DevHQ website (`npm run hq:live`) for the human cockpit. Agents use the
same backend through `pa hq runtime` and `pa hq context --project <id>`; do not
scrape HTML. If the running app lacks HQ v1, report that limitation.

Harness instruction/config recipes: `docs/setup/`; check with
`npm run dev:agent-check`. The `projecta-workflow` skill (`.agents/skills/`,
copy in `.claude/skills/`) summarizes this file, which wins on disagreement.
`npm run dev:doctor -- --json` is read-only; `npm run dev:setup` sets clone-local
hooks and creates `.pa/HQ-START.md`. None enables automation.

## Ownership and proof

Size means added + deleted lines against the PR merge-base, including tests,
support files and lockfiles. Rule 1 keeps 300 initially and 400 for review-forced
fixes. Existing exceptions: generated `docs/dev-hq/data.js|json` on coordinator
snapshot branches are excluded (user, 2026-10-16); named grants #1293/#1312 and
SLIM moves #1451/#1456/#1457/#1459 ended with their delivery, not a general waiver.
The 2026-10-20 documentation order additionally permits byte-identical archive
moves with block/ID/link proof; all non-move edits count toward 300/400.
Dependabot lockfile bumps follow the lane plan in `docs/setup/mergify.md`.
No other exclusion or higher cap follows from a checker's counting behavior.

Only one implementation lane may edit a seam at a time (rule 6). Claude Code
denies Write, Edit, MultiEdit, and NotebookEdit on a seam file unless
PA_SEAM_ALLOW lists its repo-relative path or glob. Declare file
ownership before parallel work. There is no cap on the number of implementers;
the limits are the serial lanes and the build slots below. Use `git -C <path>`
for other worktrees. Never use the shared stash; make a WIP commit instead.

A bug claim needs a compiling, failing regression test. Investigate the first
failure; never hide exit codes or bypass hooks. Check sibling cases after
fixing a bug and consider a lint/gate for the error class.

## Reviews and advisors

Tier by changed files; counts/families/E1/C+/fix-round delta: rule 5.
Accepted fix: bounded reviewed-head..new-head delta = LAST round; full re-review only after high; no third. file:line or unproven; Plan-ID row check; observe actual model.
Models/caps/credit exceptions: reference + private coordinator record only; no new paid services/keys/purchases without user approval; secrets never in files/logs/commands/PR.
The [full section](docs/development/AGENTS_REFERENCE.md#reviews-and-advisors) is binding.

## Bounded goals and approved adaptation

Root owns delivery priority and acceptance; Chief alone dispatches and replans
operations. While the Chief is unavailable (e.g. its provider is out of quota),
the coordinator (Root) may edit `docs/PLAN.md`. Each package has one execution owner. First reconcile prior orders,
actual native goals, running assignments and the canonical PLAN; stored rules,
delivered mail and expired leases are not evidence of execution or process end.

Each agent checks its own harness goal functions and confirms its own native
goal: result and benefit, parent goal, ticket and owner, scope and limits,
verifiable acceptance, dependencies and next step. Root's goal ends at its
bounded acceptance; Chief's coordination goal derives worker goals. Avoid
micro-goals and endless goals. A worker can complete at its checked handover;
the parent stays open until its own acceptance. Implemented, tested, reviewed,
accepted, merged and usable are distinct states.

Record actual create/get output or verified function unavailability plus a
documented ticket goal. Plan edits do not change native goals. Never complete
an unmet goal merely to create another. Record a blocker's cause or hypothesis,
evidence, impact, owner and next step; continue independent approved work,
without blind retries, status loops or invented work.
Re-check and update your own native goal at relevant changes and milestones;
complete only after fulfillment. If objective editing is unsupported, record
the change and tool limit in the ticket/handover; do not invent an API.

Within approved work, Chief may change method, order, slicing, assignment or
execution location. Record trigger and evidence, previous state, change,
remaining duties and acceptance, next step and owner in the ticket/PLAN.
Never weaken acceptance to finish. New product goals, scope, cost and permissions
remain the user's decisions; do not reopen granted approvals.

GOALS-C evaluates exactly three existing pending tasks, with ticket records of
defect or missed requirement (or no defect), confirmation, observed regressions
and only measured extra effort. Three tasks are a sample, not efficacy proof;
restrict use if overhead dominates. No extra QA bots, test agents or benchmarks.

## Development loop

The user-approved contract for continuous mode is
`docs/development/CONTINUOUS.md`; defaults are in `projecta.dev.json`.
Rust/SQLite owns runtime state. HQ is a host/proxy, not a second scheduler.
Capability configuration is not capability evidence. Do not claim a provider,
actual model, effort, billing source, or token measurement that has not been
observed.

Continuous mode stays disabled and its code is frozen until milestone M4: no
new migrations or features for it outside the M4 packages in `docs/PLAN.md`.
New ideas go to "Später" in `docs/PLAN.md`, not into M1–M4. Agents cannot
expand their own approval, credential, budget, or release policy. Never treat
an expired lease as proof that a worker process has stopped. Never reinstall
over active sessions or restore an old database after new writes have been
accepted.

## Checks

Sole list: scripts/ci/gates.sh; full local `bash scripts/ci/gates.sh lane prepush` before PR.
Generated docs/dev-hq/data.js|json, .pa/ACTIVITY.md: main only (hotspot-guard); every run's NICHT ABGEDECKT in PR text.
Test-First/Regression-For/No-Test trailers; never --no-verify.
The [full section](docs/development/AGENTS_REFERENCE.md#checks) is binding.

### Build slots

Worktrees: CARGO_TARGET_DIR (main target/warm slot), CARGO_BUILD_JOBS=1; never CARGO_PROFILE_*.
Check free RAM; at most 3 builds (2 when tight).
The [full section](docs/development/AGENTS_REFERENCE.md#build-slots) is binding.

## Pull requests and CI minutes

- Open one DRAFT PR per package; keep intermediate pushes in draft.
- Before pushing, run the full own-worktree `bash scripts/ci/gates.sh lane prepush`; verify the remote head with `git ls-remote`.
- WIP limit: at most 15 open agent PRs; at the limit, only finish, review and merge.
- The coordinator finishes, splits or closes a draft with no new commit for 48 h.
- Merge `main` only to resolve a real conflict; never rebase or force-push.
- Stacked PRs keep the predecessor branch as base; the coordinator retargets to `main` after it merges.

See [the full reference](docs/development/AGENTS_REFERENCE.md#pull-requests-and-ci-minutes).

## Routing: task type to profile (AP-6a)

- This is the routing contract; setup recipes are dated guidance, not dispatch authority. Profile IDs come from `src-tauri/resources/agent-defaults.json`; observe actual model, effort and access before use.
- An absent profile is "profile pending CLI check": do not dispatch until a CLI probe exists. Use the eligibility/reviewer table in the full reference; no fixed family preference or exclusion replaces the usage rule (2026-10-07).
- Pick the eligible provider with most headroom in `usage_overview`; at the user’s cap (coordinator’s private record), exclude it until its window resets. Record the pick and observed value in the dispatch note (rule 9).
- Reviewer family must differ from the author’s (rule 5); a vendor-hiding router such as Cursor `auto` requires proof of the actual vendor first.

See [the full reference](docs/development/AGENTS_REFERENCE.md#routing-task-type-to-profile-ap-6a).

## Merging (Mergify queue, since 2026-09-24)

- Merge only through the Mergify queue; a red `main` stops the queue.
- After `gh pr checks <n>` is green, the coordinator posts a standalone `@Mergifyio queue` comment.
- Only Root (Chief as deputy) sets `review-ok`, bound to the reviewed head; any push invalidates it.
- Required reviews come from families other than the author's (rule 5); workers and reviewers never queue themselves.
- Package branch PR bodies need a line starting with `## Report`.
- `do-not-merge` excludes even green PRs from the queue.
- Nobody merges manually; the emergency procedure is in the full reference below.

See [the full reference](docs/development/AGENTS_REFERENCE.md#merging-mergify-queue-since-2026-09-24).

## Record and learn

The PR text is the record of a package (rule 7). A subagent that cannot open
the PR returns the complete report text as its last message; the coordinator
puts it into the PR. Existing `.pa/report_*.md` files stay as history; old
specs and review prompts live in `.pa/archiv/`.

Before debugging: `npm run hq:lesson -- search "<symptom>"`. Report worked/failed
outcomes with `--run <runId>` (required; never invent a new ID for a retry);
add a missing lesson with symptom, cause, fix and evidence. An HQ bug must be
logged in `docs/dev-hq/BUGS.md` and queued; if offline, record the pending
queue action explicitly. Do not fabricate the queue entry.

Record dependency/architecture decisions in `docs/decisions.md` (what, why,
when to reverse). Hand over at session end with
`bash scripts/sync.sh note "<agent>" "<summary>"`. Keep secrets out of tracked
files, PR texts and logs; back up before deleting or switching anything off.

## Task operators

1 main/brief: PRÜFEN BELEGEN MESSEN RECHERCHIEREN ERFRAGEN ENTWERFEN VORSCHLAGEN ENTSCHEIDEN(named owner) UMSETZEN NACHBESSERN REVIEWEN(non-author family) INTEGRIEREN(coordinator only) PFLEGEN BERICHTEN ÜBERGEBEN BLOCKIERT MELDEN
Read-only: no commit; user: money/install/delete/release/security/scope; no new authority
OPERATOR AUTHORITY GOAL NON-GOALS BASE FILES/SEAM SIZE RED-FIRST ACCEPTANCE TIER/REVIEW REPORT OVERLAP
[Full section](docs/development/AGENTS_REFERENCE.md#task-operators) binds.

## Detailed operating reference

`docs/development/WORKFLOW.md` is the reference for architecture, release
procedures, provider properties and environment gotchas. It carries no rules of
its own: where it disagrees with this file, this file wins. Its provider table
is historical (current provider setup: `docs/setup/`). All paths and commands there are
relative to the repository root. The local Node requirement is 24 or newer.
The canonical architecture patterns live in
[`docs/architecture-rules.md`](docs/architecture-rules.md); reviews check them
and the drift gate `scripts/ci/architecture-drift.mjs` (package ARCH-G2)
enforces them.
