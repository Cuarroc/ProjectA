# AGENTS.md

Shared instructions for every agent working on ProjectA. ProjectA is a Tauri 2
agentic terminal: one implementation task, one agent, one git worktree.

## Start with current evidence

Read `STAND.md`, then `docs/PLAN.md` (waves, packages and open work),
then run `bash scripts/sync.sh start`. Check branch, worktrees, working changes
and `.pa/ACTIVITY.md`. Preserve unrelated work. Historical status is not live
evidence. Never launch the desktop app just to inspect it: its queue can
immediately dispatch real workers.

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

Only one implementation lane may edit `src-tauri/src/api.rs`, `main.rs`,
`store.rs` (with `store/`), or `bin/pa.rs` at a time. Declare file ownership
before parallel work. There is no cap on the number of implementers; the
limits are these serial lanes and the build slots below. Use `git -C <path>`
for other worktrees. Never use the shared stash; make a WIP commit instead.

A bug claim needs a compiling, failing regression test. A visual claim needs an
inspected screenshot. Runtime claims need measured evidence. Investigate the
first failure; never hide exit codes or bypass hooks. Check sibling cases after
fixing a bug and consider a lint/gate for the error class.

## Reviews and advisors

Plans and changes over 300 lines or touching a seam need two reviews by other
AI vendors before merge; anything else needs one reviewer who is not the
author. Never let the author's model family judge its own candidate. Record
every finding and its disposition in `.pa/review_<label>_disposition.md`.
Evidence is bound to the actual candidate; later changes invalidate the
affected evidence, so review the delta again.

- **Everyday pair:** Kimi K3 (`kimi-k3:cloud`) + GLM 5.2 (`glm-5.2:cloud`) on
  Ollama Cloud through `.pa/review_transport.py`. Setup, call and prompt rules:
  `docs/setup/ollama-reviewers.md`. The reviewers read only the prompt file,
  never this file.
- **Advisor pair** for hard decisions and final reviews: Fable 5.1 (Claude
  subagent) + GPT-6 Astra (Codex CLI, `-c model_reasoning_effort=high` per
  call; the global default stays `medium`). A worker may call the advisors
  itself for seam, security or architecture decisions, or when stuck for more
  than 30 minutes; otherwise it goes through the coordinator. Questions an
  advisor raises go to the coordinator, who asks the user. Advisors do not
  replace the required reviews above: when the author is a Claude model,
  Fable 5.1 does not count as an independent reviewer.
- Subscriptions only: no OpenRouter, no API keys, no extra paid spending.

## Development loop

The user-approved contract for continuous mode is
`.pa/task_continuous_devhq.md`; defaults are in `projecta.dev.json`.
Rust/SQLite owns runtime state. HQ is a host/proxy, not a second scheduler.
Capability configuration is not capability evidence. Do not claim a provider,
actual model, effort, billing source, or token measurement that has not been
observed.

Continuous mode remains disabled until its acceptance gates pass. Agents cannot
expand their own approval, credential, budget, or release policy. Never treat an
expired lease as proof that a worker process has stopped. Never reinstall over
active sessions or restore an old database after new writes have been accepted.

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

Lanes: `precommit`, `prepush`, `linux`, `windows`, `release`, `audit`. `ci.yml`,
`release.yml`, `audit.yml` and both git hooks call exactly these lanes — one
step per lane, no list left in the YAML. Drift is not checked, it is impossible.
Run the gates locally rather than waiting for CI; see `docs/ci-lokal.md`.

Every run ends with a `NICHT ABGEDECKT` block, and that block belongs in the PR
text or `.pa/ACTIVITY.md`: the `#[cfg(unix)]` tests do not compile on Windows,
the `#[cfg(windows)]` tests do not compile on Linux (`KNOWN_ISSUES` KI-7) — no
single machine covers both halves. "All gates green" without that block is a
claim, not evidence. Since the server was removed the Linux half comes from WSL2
with the clone on ext4.

Rust tests are inline modules. App/CLI tests remain in their binary targets;
the shared native capture tests run once in the `projecta_capture` library.
CI gates run on pushes to `main`, on non-draft PRs and on merge-queue runs;
installer builds run on release tags. Use appropriate
Test-First/Regression-For/No-Test trailers; never `--no-verify`.

### Build slots

Worktrees under `.claude/worktrees/` have no `target/`. Point cargo at the main
checkout's `target/` or at a warm slot
`%USERPROFILE%/cargo-targets/projecta-{a,b,c}` via `CARGO_TARGET_DIR`, and set
`CARGO_BUILD_JOBS=1`. Never set `CARGO_PROFILE_*` variables: they invalidate
the whole dependency cache. The machine has 16 GB RAM: check free memory before
every cargo or gate run and run at most three builds at once (two when memory is tight). Details:
`docs/setup/claude-code.md` ("Worktrees und Build-Slots").

## Pull requests and CI minutes

Actions minutes are scarce: few runs, each one likely to pass.

- Run the full `bash scripts/ci/gates.sh lane prepush` locally once before
  the PR, then push once at the end. Verify the push with `git ls-remote`, not
  with the push exit code.
- One PR per package, opened as a **draft** (`gh pr create --draft`). Drafts
  get no CI. The coordinator marks it ready once report, review disposition
  and the `NICHT ABGEDECKT` block are in; every later push to a ready PR costs
  a full run.
- Do not merge `main` into your branch without a reason (see Merging); do not
  press "update branch".

## Merging (Mergify queue, since 2026-09-24)

`main` is merged through the Mergify merge queue (`.mergify.yml`); the long
form is `docs/setup/mergify.md`. Required checks are `gates (linux)`,
`gates (windows)`, `red-first` and `Mergify Merge Protections`; "strict
up-to-date" is off. Every non-draft PR to `main` with those checks green, no
conflict and no `do-not-merge` label is queued automatically, tested on top of
the current `main` and merged with a merge commit. Merge `main` into your
branch only to resolve a real conflict (Mergify labels those `conflict`):
merge, never rebase or force-push.

- `do-not-merge` label: keeps a green PR out of the queue.
- `priority` label (coordinator only) or a `hotfix/` branch: queued first.
- Package branches must ship their report. A branch is a package branch when
  it matches `^(claude|codex|kimi|opencode|glm)/(w<N>-|df<N>|ki-<N>|hq2-)`
  (case-insensitive), e.g. `claude/w2-07-credential-acl`, `codex/df09a-...`,
  `claude/ki-23-...`. Such a PR must add or change a `.pa/report_*.md`, or the
  `Mergify Merge Protections` check stays red. Docs/infra branches
  (`claude/masterplan`, `claude/ci-01-...`) are not packages.
- Never rename a job in `ci.yml` without updating branch protection and
  `.mergify.yml` (`scripts/ci/ci-shape.sh` checks that the two agree).
- Lane plan (`scripts/ci/lane-plan.sh`, CI-01/CI-02): the jobs always report,
  but may skip their lane and log why.
  - `gates (windows)` never runs its lane on an ordinary PR (CI-03): the job
    reports success from an Ubuntu runner and logs the Windows inputs the PR
    changed. The first Windows verdict is the merge-queue run - a Windows
    failure there removes the PR from the queue. Want it earlier? Run the
    `ci` workflow by hand on your branch (`workflow_dispatch` runs both
    lanes in full).
    Never merge past the queue (GitHub merge button, admin merge): the PR's
    `gates (windows)` is a stub, so such a merge reaches `main` untested on
    Windows - the push to `main` then runs the full lane, after the fact.
  - `gates (linux)` on a PR skips only for docs no gate reads: `.md` at the
    root, under `docs/` or `.pa/`, except `STAND.md`, `.pa/task_*`,
    `.pa/report_f0*.md`, `docs/PLAN.md`, `docs/agents-json.md`, `docs/dev-hq/*`,
    `include_str!` targets and any doc named literally in test/gate code.
    Check a file with `bash scripts/ci/lane-plan.sh --classify <file>`.
    A gate that starts reading docs via a directory listing or a variable-
    built path must be added to `HEAVY_DOCS` in `lane-plan.sh` — the listing
    search cannot see those readers.
  - Merge-queue runs, the weekly Monday run and `workflow_dispatch` on `main`
    run both lanes in full.
  - A push to `main` is light: its code was fully tested in the queue, and
    the plan verifies that — the push head must be exactly one merge commit
    from `mergify[bot]` on top of the push's predecessor, otherwise the lane
    runs in full. It runs in full also when a cache key input changed
    (`Cargo.toml`, `Cargo.lock`, toolchain files, `.cargo/`; for linux also
    `package-lock.json`), to refresh the cache PRs restore.
- `red-first` is computed inside `gates (linux)` (steps `red-first - plan`
  and `red-first - proof against merge base`); the `red-first` job only
  reports their outcome. Look there for details (CI-03).
- The queue tests one batch at a time (`max_parallel_checks: 1`); two or
  more waiting PRs are tested together (up to 4).
- Dependabot commits that only touch dependency manifests need no
  Test-First/No-Test trailer (`red-first.sh`); anything else they touch does.
- Local: `PA_PREPUSH=light git push` runs the `branchpush` lane (no clippy,
  no Rust suite) for branch pushes; pushes to `main` stay full.
- **Nobody merges by hand.** Emergency exception: when the queue hangs or
  Mergify is down, the coordinator may merge a finished PR with
  `gh pr merge --merge --match-head-commit <sha>`, bound to the head SHA whose
  checks are green. Since CI-03 those checks include no Windows run: before
  such a merge, run the `ci` workflow by hand on the branch
  (`workflow_dispatch`, both lanes in full) and bind the merge to that green
  head.

## Record and learn

Every package ends with `.pa/report_<package>.md`: what changed, red→green
commits with exit codes, gates and `NICHT ABGEDECKT`, reviews with
disposition, follow-ups. A subagent whose harness may not write that file
returns the complete report as its last message; the coordinator commits it.

Before debugging: `npm run hq:lesson -- search "<symptom>"`. Report worked/failed
outcomes with `--run <runId>` (required; never invent a new ID for a retry);
add a missing lesson with symptom, cause, fix and evidence. An HQ bug must be
logged in `docs/dev-hq/BUGS.md` and queued; if offline, record the pending
queue action explicitly. Do not fabricate the queue entry.

Specs/reports belong in `.pa/`. Follow-up packages taken from a report need no
spec of their own: the report is their source. Record dependency/architecture
decisions in `docs/decisions.md` (what, why, when to reverse). At session end
run `bash scripts/sync.sh note "<agent>" "<summary>"` and update status when
justified. Keep secrets out of tracked files and reports.

## Detailed operating reference

`docs/development/WORKFLOW.md` preserves the full shared operational rules,
architecture, release procedures, environment gotchas and documentation roles.
All paths and commands there are relative to the repository root. Consult the
relevant section when working on those systems; it remains authoritative for
rules not summarized here. Its server/tunnel material and its provider table
are historical (server removed 2026-09-09; current provider setup:
`docs/setup/`). The local Node requirement is 24 or newer.
