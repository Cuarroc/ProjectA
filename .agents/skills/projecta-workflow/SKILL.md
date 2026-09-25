---
name: projecta-workflow
description: Working playbook for one implementation package in the ProjectA repo (Tauri 2 agentic terminal) — gates, red-first commit trailers, cross-vendor reviews with disposition, report file, PR and Mergify rules, cargo build slots, advisors. Use when starting, committing, reviewing or opening a PR for any ProjectA package.
---

# ProjectA workflow (short playbook)

`AGENTS.md` at the repository root is the source of truth. This skill is a
checklist that points into it; where the two disagree, `AGENTS.md` wins. Setup
per provider: `docs/setup/README.md`. Check your machine with
`npm run dev:agent-check`.

## 1. Start

1. Read `STAND.md`, then `AGENTS.md`, then run `bash scripts/sync.sh start`.
2. Work in your own worktree and branch, created from the newest `origin/main`.
   Use `git -C <path>` for other worktrees.
3. Never `git stash` (the stash stack is shared by all worktrees) — use a WIP
   commit. Never `--no-verify`, never `--force` pushes.
4. Only one lane at a time may edit the seams `src-tauri/src/api.rs`, `main.rs`,
   `store.rs`, `bin/pa.rs`. Declare ownership before touching them.

## 2. Build and gates

- The gate list lives only in `scripts/ci/gates.sh`. Run
  `bash scripts/ci/gates.sh lane prepush` before pushing; `npm ci` first when
  `node_modules` is missing or stale.
- Every gate run ends with a `NICHT ABGEDECKT` block; put it in the PR text.
- Worktrees under `.claude/worktrees/` have no `target/`. Point cargo at a
  build slot: `export CARGO_TARGET_DIR=$HOME/cargo-targets/projecta-<a|b|c>`
  and `CARGO_BUILD_JOBS=1` or `2` (on the dev PC `$HOME` is `C:/Users/<user>`;
  slots elsewhere: point `CARGO_TARGET_DIR` there and set
  `PROJECTA_BUILD_SLOTS_ROOT` so `dev:agent-check` finds them). At most 2–3
  builds at once; check free RAM first. **Never set `CARGO_PROFILE_*`** — it invalidates the whole cache.
- Read exit codes unmasked: `| tail` swallows the status.

## 3. Red first — commit trailers

Every commit that changes source (`src/`, `src-tauri/`, `scripts/`,
`.github/workflows/`, `package.json`, …) needs one trailer line
(`scripts/lib/test-first.sh`):

- `Test-First: <path>::<testname>` — the test is red on the PR base and green
  on the head (CI job `red-first`). For `.mjs` tests always name the test:
  `Test-First: scripts/lib/foo.test.mjs::exact test name`. A path-only `.mjs`
  trailer runs the whole file, which is already green on the base when the
  file only gains tests — red-first then rejects it. Rust:
  `Test-First: src-tauri/src/x.rs::test_fn` or the fully qualified test path.
- `Regression-For: <sha>` — for a regression of that commit.
- `No-Test: <reason>` — docs, config, or changes that cannot be tested; give
  the real reason.

Several pieces of evidence = several lines, never a list. Commit the failing
test first, then the fix.

## 4. Reviews and disposition

- Plans and changes over 300 lines or touching a seam need two reviews from
  other vendors before merge. Everyday pair: `kimi-k3:cloud` + `glm-5.2:cloud`
  via Ollama Cloud and `.pa/review_transport.py` (setup and command:
  `docs/setup/ollama-reviewers.md`).
- Output: `.pa/review_<label>_<model>.md`. Record every finding in
  `.pa/review_<label>_disposition.md` (ID, source, severity, finding,
  disposition: accepted with commit / rejected with reason / follow-up).
- Evidence is bound to the candidate commit; a later change invalidates the
  affected evidence — re-run the review on the delta.

## 5. Advisors (subscriptions only, no OpenRouter)

For hard decisions and final reviews use the advisor pair: **Fable 5.1**
(Claude subagent, max effort) + **GPT-6 Astra** (Codex CLI,
`codex exec -c model_reasoning_effort=high …`; the global default stays
medium). Workers may call the advisors themselves for seam, security or
architecture decisions and when stuck for more than 30 minutes; otherwise go
through the coordinator. Questions the advisors raise go to the coordinator,
who asks the user.

## 6. Report, PR, merge

1. Write the report `.pa/report_<id>.md`: what changed per file, evidence
   (test names, gate lanes, `NICHT ABGEDECKT`), reviews + disposition, open
   points. If your harness blocks writes to `.pa/report_*`, return the report
   as text to the coordinator — do not work around the block.
2. Push once and open **one PR per package at the end**. Open it as **draft**
   while report, disposition or the `NICHT ABGEDECKT` block is missing (drafts
   get no CI); mark it ready (`gh pr ready <n>`) only when all are in. Every
   push to a ready PR costs a CI run (the Windows lane only for Windows-relevant changes). Verify a push with `git ls-remote`,
   not with the push exit code. Package branches
   (`<vendor>/w<N>-…`, `df<N>`, `ki-<N>`, `hq2-`) must add or change a `.pa/report_*.md`
   or Mergify's merge protection stays red.
3. `main` is merged by the **Mergify** merge queue (`.mergify.yml`,
   `AGENTS.md` "Merging"). Do not merge `main` into your branch just to
   refresh it; only to resolve a real conflict — merge, never rebase or
   force-push. Labels: `do-not-merge` keeps a PR out of the queue; `priority`
   (coordinator only) moves it to the front; `conflict` is set and cleared by
   Mergify. Workers never merge by hand; only the coordinator may, as an
   emergency exception when the queue hangs or Mergify is down.
   Details: `docs/setup/mergify.md`.
