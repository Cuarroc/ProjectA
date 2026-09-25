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
    deleting are the user's call, and every cleanup starts with a backup.
    Questions for the user go into the decision inbox in `docs/PLAN.md`, not
    into the chat one by one.

## Start with current evidence

Read `STAND.md`, then `docs/PLAN.md` (the only plan: milestones M1–M4, parked
and cut work, decision inbox), then run `bash scripts/sync.sh start`. Check
branch, worktrees and working changes. Preserve unrelated work. Historical
status is not live evidence: take the live state from `gh pr list` and
`git log origin/main`. Never launch the desktop app just to inspect it: its
queue can immediately dispatch real workers.

The start check (rule 9) before every worker: the model the harness actually
reports, the provider limit, at least ~1.5 GB free RAM and at most two other
cargo builds. Stop hard when one of them fails; the package OPS-02 automates
this.

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

## Development loop

The user-approved contract for continuous mode is
`.pa/task_continuous_devhq.md`; defaults are in `projecta.dev.json`.
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

Lanes: `precommit`, `prepush`, `linux`, `windows`, `release`, `audit`. `ci.yml`,
`release.yml`, `audit.yml` and both git hooks call exactly these lanes — one
step per lane, no list left in the YAML. Drift is not checked, it is impossible.
Run the gates locally rather than waiting for CI; see `docs/ci-lokal.md`.

Every run ends with a `NICHT ABGEDECKT` block, and that block belongs in the PR
text: the `#[cfg(unix)]` tests do not compile on Windows, the `#[cfg(windows)]`
tests do not compile on Linux (`KNOWN_ISSUES` KI-7) — no single machine covers
both halves. "All gates green" without that block is a claim, not evidence.
Since the server was removed the Linux half comes from WSL2 with the clone on
ext4.

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
up-to-date" is off. Every non-draft PR to `main` with those checks green, no
conflict and no `do-not-merge` label is queued automatically, tested on top of
the current `main` and merged with a merge commit. Merge `main` into your
branch only to resolve a real conflict (Mergify labels those `conflict`):
merge, never rebase or force-push.

- `do-not-merge` label: keeps a green PR out of the queue.
- `priority` label (coordinator only) or a `hotfix/` branch: queued first. A
  hook or gate fix that protects everyone goes alone as a hotfix, never bundled
  into a large PR.
- **Package PRs carry their report in the PR text.** A branch is a package
  branch when it matches `^(claude|codex|kimi|opencode|glm)/(w<N>-|df<N>|ki-<N>|hq2-)`
  (case-insensitive), e.g. `claude/w2-07-credential-acl`. Its PR body must
  contain a line starting with `## Report`, or the `Mergify Merge Protections`
  check stays red. (The transition for pre-2026-09-25 PRs carrying a
  `.pa/report_*.md` ended with PR #175; the only such open PR was #176.)
  Docs/infra branches (`claude/plan-01-…`, `claude/ci-03-…`)
  are not packages but use the same PR shape.
- **Red `main`:** when a run on `main` fails, the queue stops. Until CI-04
  automates it, the coordinator puts `do-not-merge` on queued PRs, records the
  run ID in `KNOWN_ISSUES.md` and fixes `main` first.
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

## Detailed operating reference

`docs/development/WORKFLOW.md` is the reference for architecture, release
procedures, provider properties and environment gotchas. It carries no rules of
its own: where it disagrees with this file, this file wins. Its server/tunnel
material and its provider table are historical (server removed 2026-09-09;
current provider setup: `docs/setup/`). All paths and commands there are
relative to the repository root. The local Node requirement is 24 or newer.
