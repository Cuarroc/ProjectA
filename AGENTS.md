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
   is split before dispatch.
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
   concurrency, PTY, database): two reviewers from other vendors. Tier B (other
   Rust/TS code): one reviewer who is not the author's model family. Tier C
   (docs, tests, snapshots, config without runtime effect): no external review,
   the gates suffice. After round two the user decides: merge, split or drop.
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
    starts with a backup. Preserve already granted authorizations; do not ask
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

Setup per provider (which instruction file each harness reads, config names,
reviewer models) lives in `docs/setup/`; check a machine with
`npm run dev:agent-check`. The repo skill `projecta-workflow`
(`.agents/skills/`, copy in `.claude/skills/`) is a short checklist of this
file; where they disagree, this file wins. `npm run dev:doctor -- --json` is
read-only; `npm run dev:setup` sets clone-local hooks and creates
`.pa/HQ-START.md`. None of these enables automation.

## Ownership and proof

Only one implementation lane may edit a seam at a time (rule 6). Declare file
ownership before parallel work. There is no cap on the number of implementers;
the limits are the serial lanes and the build slots below. Use `git -C <path>`
for other worktrees. Never use the shared stash; make a WIP commit instead.

A bug claim needs a compiling, failing regression test. Investigate the first
failure; never hide exit codes or bypass hooks. Check sibling cases after
fixing a bug and consider a lint/gate for the error class.

## Reviews and advisors

The tier (rule 5) follows the changed files: any seam, security-relevant code,
concurrency, PTY or database/migration change makes it tier A. Never let the
author's model family judge its own candidate. Record every finding and its
disposition (accepted with commit, rejected with reason, follow-up) in the PR
text. A second round only when round one had a high-severity finding; after
round two the user decides. Evidence is bound to the actual candidate; later
changes invalidate the affected evidence, so review the delta again. A finding
without `file:line` counts as unproven.

Use recursive prompting selectively for complex plans, dependencies, hard
diagnosis or designs with checkable criteria (user order 2026-10-08), following
`docs/development/prompting.md`. Preserve requirements and acceptance; ask only
necessary subquestions, make a first solution, then one neutral extra check
("no defect" is valid). Correct concrete defects and check the integrated result
including interfaces. A second extra round needs a concrete remaining defect.
Stop when acceptance is met, no new insight appears, the blocker is unchanged,
or a time/quota/budget limit is reached. Self-check replaces neither independent
review nor user approval; do not add an RLM runtime, agents or services for it.

- **Everyday pair:** Kimi K3 (`kimi-k3:cloud`) + GLM 5.2 (`glm-5.2:cloud`) on
  Ollama Cloud through `.pa/review_transport.py`. Setup, call and prompt rules:
  `docs/setup/ollama-reviewers.md`. Keep review prompts out of the repo; they
  are reproducible from the commit.
- **Advisor pair** for hard decisions and final reviews: Fable 5.1 (Claude
  subagent) + GPT-6 Astra (Codex CLI, `-c model_reasoning_effort=high` per
  call; the global default stays `medium`). A worker may call the advisors
  itself for seam, security or architecture decisions, or when stuck for more
  than 30 minutes; otherwise it goes through the coordinator. Questions an
  advisor raises go to the coordinator, who puts them into the decision inbox.
  Advisors do not replace the required reviews: when the author is a Claude
  model, Fable 5.1 does not count as an independent reviewer.
- Subscriptions only: no OpenRouter, no API keys, no extra paid spending.

## Bounded goals and approved adaptation

Root owns delivery priority and acceptance; Chief alone dispatches and replans
operations. Each package has one execution owner. First reconcile prior orders,
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
remain Elias' decisions; do not reopen granted approvals.

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

The gate list lives in exactly one place: `scripts/ci/gates.sh`. Until
2026-09-09 it stood five times over — both hooks, `ci.yml`, `release.yml` and as
prose here — and it drifted (`pre-push` ran `cargo test`, CI ran
`cargo nextest run --profile ci`). A sixth copy in this file would be the same
mistake, so this section names commands, not gates:

```sh
bash scripts/ci/doctor.sh              # what can this machine prove?
bash scripts/ci/gates.sh --list        # the list, always current
bash scripts/ci/gates.sh lane prepush  # the full local lane
bash scripts/ci/gates.sh --from clippy lane linux   # resume after a failure
```

Generated and shared files are written on `main` only: a branch must not
commit `docs/dev-hq/data.js|json` or `.pa/ACTIVITY.md` (gate `hotspot-guard`;
PRs merge without our local merge driver, so each such change conflicts with
every other PR). `sync.sh note` writes to the untracked `.pa/ACTIVITY.local.md`
on a branch (summary goes into the PR text), `post-merge` regenerates the
snapshot on `main` only, and the coordinator refreshes it in one small PR from a
`<vendor>/hq-snapshot-*` branch (`npm run hq`, commit just the two files).

Lanes: `precommit`, `prepush`, `linux`, `windows`, `release`, `audit`. `ci.yml`,
`release.yml`, `audit.yml` and both git hooks call exactly these lanes — one
step per lane, no list left in the YAML. Drift is not checked, it is impossible.
Run the gates locally rather than waiting for CI; see `docs/ci-lokal.md`.

Every run ends with a `NICHT ABGEDECKT` block, and that block belongs in the PR
text: the `#[cfg(unix)]` tests do not compile on Windows, the `#[cfg(windows)]`
tests do not compile on Linux (`KNOWN_ISSUES` KI-7) — no single machine covers
both halves. "All gates green" without that block is a claim, not evidence.
The Linux half comes from WSL2 with the clone on ext4.
Heavy builds/workers and the Linux lane also run on the project server via
the pa-orch queue (see `STAND.md`); its future is an open user decision (E15).

Rust tests are inline modules. App/CLI tests remain in their binary targets;
the shared native capture tests run once in the `projecta_capture` library.
Use appropriate Test-First/Regression-For/No-Test trailers; never
`--no-verify`.

### Build slots

Worktrees under `.claude/worktrees/` have no `target/`. Point cargo at the main
checkout's `target/` or at a warm slot
`%USERPROFILE%/cargo-targets/projecta-{a,b,c}` via `CARGO_TARGET_DIR`, and set
`CARGO_BUILD_JOBS=1`. Never set `CARGO_PROFILE_*` variables: they invalidate
the whole dependency cache. The machine has 16 GB RAM: check free memory before
every cargo or gate run and run at most three builds at once (two when memory is tight). Details:
`docs/setup/claude-code.md` ("Worktrees und Build-Slots").

## Pull requests and CI minutes

CI money target: 0 €. If CI becomes the bottleneck, at most 20 € a month, and
only after the user approves it.

- Run the full `bash scripts/ci/gates.sh lane prepush` locally before the PR.
  Push after every green step (rule 4); verify a push with `git ls-remote`, not
  with the push exit code.
- One PR per package, opened as a **draft** (`gh pr create --draft`). Drafts
  get no CI; a push to a ready PR runs the linux lane and red-first (since
  CI-03, PR #149, the Windows lane on a PR is a stub — its verdict comes from
  the merge queue and the weekly run). The coordinator marks a PR ready once
  the `## Report` section, the review disposition and the `NICHT ABGEDECKT`
  block are in the PR text.
- The PR template (`.github/pull_request_template.md`) gives the shape: three
  German sentences for the user, then `## Report`.
- A spec file (`.pa/task_<id>.md`) only for M packages from `docs/PLAN.md`;
  for everything else the task lives in the PR text.
- Do not merge `main` into your branch without a reason (see Merging); do not
  press "update branch".

## Merging (Mergify queue, since 2026-09-24)

`main` is merged through the Mergify merge queue (`.mergify.yml`); the long
form is `docs/setup/mergify.md`. Required checks are `gates (linux)`,
`gates (windows)`, `red-first` and `Mergify Merge Protections`; "strict
up-to-date" is off. A non-draft PR to `main` with those checks green, no
conflict and no `do-not-merge` label is *eligible* for the queue; the queue
tests it on top of the current `main` and merges it with a merge commit.
**Enqueue explicitly:** observed on 2026-10-04, eligible PRs were not picked
up on their own - each of the last 14 merged PRs (#240-#266) and the open
#274/#275 carry an explicit `@Mergifyio queue` comment. So once
`gh pr checks <n>` is green, the coordinator comments `@Mergifyio queue` on
the PR. Why automatic enqueueing does not take effect is unresolved (only
hypotheses); the queue run on `main` is still checked by Mergify. Merge
`main` into your branch only to resolve a real conflict (Mergify labels
those `conflict`): merge, never rebase or force-push.

- `review-ok` label: a PR enters the queue only with it. The orchestrator
  pipeline sets it after the review disposition is complete and no high
  finding is open; reviewers never queue themselves. Removing it (or adding
  `do-not-merge`) takes a PR out. No branch type is exempt.
- `do-not-merge` label: keeps a green PR out of the queue.
- `priority` label (coordinator only) or a `hotfix/` branch: queued first. A
  hook or gate fix that protects everyone goes alone as a hotfix, never bundled
  into a large PR.
- **Package PRs carry their report in the PR text.** A branch is a package
  branch when it matches `^(claude|codex|kimi|opencode|glm)/(w<N>-|df<N>|ki-<N>|hq2-)`
  (case-insensitive), e.g. `claude/w2-07-credential-acl`. Its PR body must
  contain a line starting with `## Report`, or the `Mergify Merge Protections`
  check stays red. There is no transition: a `.pa/report_*.md` file no longer
  satisfies the check, so an open package PR must add the section.
  Docs/infra branches (`claude/plan-01-…`, `claude/ci-03-…`)
  are not packages but use the same PR shape.
- **Red `main`:** the queue stops (until CI-04 automates it); the coordinator puts `do-not-merge` on
  queued PRs, records the run ID in `KNOWN_ISSUES.md` and fixes `main` first.
- `gates (windows)` never runs its lane on an ordinary PR (CI-03): it reports a
  stub success; the first Windows verdict is the merge-queue run. Never merge
  past the queue (merge button, admin merge): the PR is untested on Windows.
  Want it earlier? Run the `ci` workflow by hand on your branch.
- Never rename a job in `ci.yml` without updating branch protection and
  `.mergify.yml` (`scripts/ci/ci-shape.sh`).
- Lane-plan details (which docs skip `gates (linux)`, `HEAVY_DOCS`, light push
  to `main`, Dependabot, `PA_PREPUSH=light`, red-first steps, batch size):
  `docs/setup/mergify.md` ("Lane-Plan im Detail"); classify a file with
  `bash scripts/ci/lane-plan.sh --classify <file>`.
- **Nobody merges by hand.** Emergency exception: when the queue hangs or
  Mergify is down, the coordinator may merge a finished PR with
  `gh pr merge --merge --match-head-commit <sha>`, bound to the head SHA whose
  checks are green. Since CI-03 those checks include no Windows run: before
  such a merge, run the `ci` workflow by hand on the branch
  (`workflow_dispatch`, both lanes in full) and bind the merge to that green
  head.

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

Each brief names ONE main operator below, using its stable German uppercase token.

| Operator | Meaning | May write / push / PR? | Required output |
|---|---|---|---|
| PRÜFEN | Read-only check | Report only / no / no | Verdict per item |
| BELEGEN | Reproducible proof | Report only / no / no | Command, exit code, SHA |
| MESSEN | Measure | Report only / no / no | Numbers with method and units |
| RECHERCHIEREN | Research | Report only / no / no | Dated sources; hypotheses marked |
| ERFRAGEN | Ask the owner or the user's assistant | Report only / no / no | Answer as information, never approval |
| ENTWERFEN | Draft only; no sending | Draft only / no / no | Unsent draft |
| VORSCHLAGEN | Recommend without deciding | Report only / no / no | 2–3 options and recommendation |
| ENTSCHEIDEN | Named owner decides | Decision record only / no / no | Decision, authority and rationale |
| UMSETZEN | Implement one package | Yes / yes / draft | Branch, red-first evidence, prepush, draft PR |
| NACHBESSERN | Fix review findings on the same PR | Yes / yes / same PR | Fix evidence and disposition table |
| REVIEWEN | Review a fixed head | Report only / no / no | Head SHA; findings with file:line; verdict |
| INTEGRIEREN | Coordinator integrates | Authorized integration only / yes / manage | Ready, labels and Mergify queue evidence |
| PFLEGEN | Owner maintains docs, plan or memory | Owned scope / yes / draft if repo changes | Current canonical record; no second truth |
| BERICHTEN | Report status | Report only / no / no | ≤6 lines; named stage, source and time |
| ÜBERGEBEN | Hand over unfinished work | WIP only / yes / existing or draft | WIP commit + push; checkpoint and next owner/step |
| BLOCKIERT MELDEN | Stop and report blocker | Report only / no / no | Reason, evidence and resume condition |

Rules 4 (push) and 7 (PR text = report) apply to UMSETZEN/NACHBESSERN/INTEGRIEREN.
Read-only operators report in their last message or an uncommitted report file; never commit.
REVIEWEN must never use the author's model family. INTEGRIEREN is coordinator-only.
ENTSCHEIDEN belongs only to the named owner; money/install/delete/release/security/scope
decisions belong to the user. No operator expands existing authority or the ten core rules.

Minimal brief header (one line per field; state “none” where inapplicable):
```text
OPERATOR: <one token>
AUTHORITY: <owner and authorization>
GOAL: <result and benefit>
NON-GOALS: <excluded work>
BASE: <branch@SHA>
FILES/SEAM: <owned files and serial seam>
SIZE: <diff-line budget>
RED-FIRST: <test/evidence or justified No-Test>
ACCEPTANCE: <verifiable checks>
TIER/REVIEW: <risk tier and reviewer requirements>
REPORT: <PR text, last message or report file>
OVERLAP: <other assignments and resolution>
```

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
