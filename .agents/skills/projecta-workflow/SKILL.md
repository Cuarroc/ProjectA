---
name: projecta-workflow
description: Working playbook for one implementation package in the ProjectA repo (Tauri 2 agentic terminal) — gates, red-first commit trailers, risk-tiered cross-vendor reviews, the PR text as report, Mergify rules, cargo build slots, advisors. Use when starting, committing, reviewing or opening a PR for any ProjectA package.
---

# ProjectA workflow (short playbook)

`AGENTS.md` at the repository root is the source of truth. This skill is a
checklist that points into it; where the two disagree, `AGENTS.md` wins. Setup
per provider: `docs/setup/README.md`. Check your machine with
`npm run dev:agent-check`.

## 1. Start

1. Read `STAND.md`, `docs/PLAN.md` (the only plan) and the ten core rules at
   the top of `AGENTS.md`, then run `bash scripts/sync.sh start`. Start check:
   `npm run dev:start-check` — exit 1, 2 or 3 stops the start — plus the model
   the harness actually reports, which the command cannot see.
2. Work in your own worktree and branch, created from the newest `origin/main`.
   Use `git -C <path>` for other worktrees.
3. Never `git stash` (the stash stack is shared by all worktrees) — use a WIP
   commit. Never `--no-verify`, never `--force` pushes.
4. Only one lane at a time may edit the seams `src-tauri/src/api.rs`, `main.rs`,
   `store.rs` + `store/`, `bin/pa.rs`. Declare ownership before touching them.
5. Reconcile previous orders, live assignments and actual native goals first.
   Root owns priority/acceptance, Chief alone dispatches; one execution owner.
   Confirm your own native goal with real create/get output, or record verified
   function unavailability plus the ticket goal. Include result/benefit, parent,
   ticket/owner, scope/limits, acceptance, dependencies and next step. A checked
   worker handover may finish its goal; the parent stays open. Plan text is not
   native evidence; never complete an unmet goal just to replace it.
   At relevant changes/milestones, re-check and update your native goal using
   supported functions; unsupported objective edits go in the ticket with the
   explicit tool limit. Complete only after actual fulfillment.
6. Approved adaptation may change method/order/slicing/owner/location, not
   requirements. Record trigger/evidence, previous state, change, remaining
   acceptance duties and next owner/step in the ticket/PLAN. Preserve granted
   authorizations; new scope/cost/permissions belong to the user. Blockers need
   cause/hypothesis, evidence, impact and next owner/step; continue independent
   approved work without blind retries or invented work.

## 2. Build and gates

- The gate list lives only in `scripts/ci/gates.sh`. Run
  `bash scripts/ci/gates.sh lane prepush` before pushing; `npm ci` first when
  `node_modules` is missing or stale.
- Every gate run ends with a `NICHT ABGEDECKT` block; put it in the PR text.
- Worktrees under `.claude/worktrees/` have no `target/`. Point cargo at a
  build slot: `export CARGO_TARGET_DIR=$HOME/cargo-targets/projecta-<a|b|c>`
  and `CARGO_BUILD_JOBS=1` (on the dev PC `$HOME` is `%USERPROFILE%`;
  slots elsewhere: point `CARGO_TARGET_DIR` there and set
  `PROJECTA_BUILD_SLOTS_ROOT` so `dev:agent-check` finds them). Build concurrency
  follows AGENTS.md rule 9 and Build slots; check current RAM/processes/slot first.
  **Never set `CARGO_PROFILE_*`** — it invalidates the whole cache.
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
  A bare Rust test name such as `Test-First: test_fn` is invalid: use
  `path::name`. Every referenced path must exist at the candidate HEAD.
- `Regression-For: <sha>` — for a regression of that commit.
- `No-Test: <reason>` — docs, config, or changes that cannot be tested; give
  the real reason.

Several pieces of evidence = several lines, never a list. Commit the failing
test first, then the fix.

### Test quality (adapted from mattpocock/skills `tdd`, MIT, © 2026 Matt Pocock)

- Test behaviour through the public interface (a test boundary), never internals: no mocks of your own modules, no private-method tests, no verifying through a side channel (e.g. querying the database instead of the interface). Mock only at system boundaries (providers, network, time, randomness; the Tauri browser mock).
- Expected values come from an independent source (a literal, a worked example, the spec), never recomputed the way the code computes them (tautological test).
- Work in vertical slices: one test → minimal code → green → commit with its trailer → next slice. No "all tests first, then all code".
- You pick the test boundaries yourself and list them in the PR report; do not ask the user. "Seam" in this sense is a test boundary, not one of the four serial seam files.
- Refactoring is not part of the red → green loop; it belongs to review/follow-up.
- Hard bug? Use the AgentsRoom skill `projecta-diagnosing-bugs` (tight red loop first).

## 4. Reviews by risk (at most two rounds)

- Tier A (seam, security, concurrency, PTY, database): two different model
  families, both outside the author's. Tier B (other Rust/TS): two different
  non-author families, one subscription reviewer and one OpenRouter reviewer.
  Tier C (docs, tests, snapshots, config without runtime effect): gates only;
  C+ (tests adding skip/timeout/retry or weakening assertions): one outside
  reviewer. Fix-round delta: one outside reviewer, two if tier-A files change.
  After round two Root decides merge, split or drop, records it in the PR
  report and informs the user. Review-forced fixes may reach 400 diff lines
  (initial dispatch: 300); record the overrun and forcing finding IDs.
  Current eligible reviewers and credit limits: coordinator's private record;
  follow AGENTS.md's recorded exceptions, never infer live availability.
- Every review checks `docs/PLAN.md` at the head: the PR's `Plan-ID:` row must
  state what is true after merge, and the PR must leave no other row, user
  section or decision inbox stale; cross-check against `gh`. A mismatch is a
  medium finding (high if the user section asks for something already done)
  and must be fixed in the same PR before `review-ok`.
- Use recursive prompting selectively for complex plans/dependencies, hard
  diagnosis or demanding designs. Keep requirements/acceptance, necessary
  subquestions, first solution, one neutral extra check (no defect is valid),
  concrete fixes, then integration/interface check. A second extra round needs
  a remaining concrete defect; stop at acceptance/no insight/unchanged blocker
  or time/quota/budget limit. It replaces neither review nor user approval.
  Record the three existing GOALS-C trials only, with confirmation, regressions
  and measured extra effort; sample, not proof. Restrict if overhead dominates.
  No extra QA, benchmark, agents/services or RLM runtime. See prompting.md.
- Keep review prompts out of the repo. Record every finding in the PR text
  (ID, source, severity, finding, disposition: accepted with commit / rejected
  with reason / follow-up).
- Evidence is bound to the candidate commit; a later change invalidates the
  affected evidence — re-run the review on the delta.

## 5. Advisors

Use two advisors from different vendors for hard decisions and final reviews;
current models and approved budgets are in the coordinator's private record.
Workers may call them for seam, security or architecture decisions, or after
more than 30 minutes stuck; otherwise go through the coordinator. Questions go
into the decision inbox. Advisors do not replace the independent reviews in
AGENTS.md; a family shared with the author never counts.

## 6. Report, PR, merge

1. The PR text is the report (`.github/pull_request_template.md`): three
   German sentences for the user, then `## Report` with what changed, evidence
   (command + exit code, gate lanes, `NICHT ABGEDECKT`), reviews + disposition,
   open points. If your harness cannot open the PR, return the report as text
   to the coordinator.
   Handover includes goal/output evidence, candidate/base, distinct delivery
   states, remaining limits and next owner/step; keep the parent's goal open.
2. Commit and push after every green step. Open **one PR per package** as
   **draft** (drafts get no CI); it is marked ready (`gh pr ready <n>`) only
   when the report, disposition and `NICHT ABGEDECKT` are in. Every push to a
   ready PR costs a CI run. Verify a push with `git ls-remote`, not with the
   push exit code. Package branches (`<vendor>/w<N>-…`, `df<N>`, `ki-<N>`,
   `hq2-`) need a `## Report` section in the PR body, or Mergify's merge
   protection stays red. A red `main` stops the queue.
3. Stacked package: it may start on an unmerged predecessor branch (DRAFT PR
   with that branch as base, no merge of `main` into it); the coordinator
   retargets it to `main` after the base merges. Review diff:
   `git diff <base-branch>...<head>`.
4. `main` is merged by the **Mergify** merge queue (`.mergify.yml`,
   `AGENTS.md` "Merging"). Do not merge `main` into your branch just to
   refresh it; only to resolve a real conflict — merge, never rebase or
   force-push. The queue requires the `review-ok` label on the PR head
   (`.mergify.yml` queue condition `label = review-ok`, CI-HARDEN-02); only Root
   (Chief as deputy) sets it, bound to the reviewed head SHA, only when the required review
   verdicts come from model families other than the author's; the setter must not count
   its own review as the independent one when it shares the author's family.
   Labels: `do-not-merge` keeps a PR out of the queue; `priority`
   (coordinator only) moves it to the front; `conflict` is set and cleared by
   Mergify. Merge authority follows AGENTS.md's ten core rules; use Mergify,
   never infer a manual bypass from this skill. Details: `docs/setup/mergify.md`.

## 7. Task operators

Use ONE stable German uppercase operator from `AGENTS.md` “Task operators” per brief.
Include its minimal header: OPERATOR, AUTHORITY, GOAL, NON-GOALS, BASE branch@SHA, FILES/SEAM, SIZE, RED-FIRST, ACCEPTANCE, TIER/REVIEW, REPORT, OVERLAP.
Rules 4 (push) and 7 (PR text = report) apply to UMSETZEN/NACHBESSERN/INTEGRIEREN; read-only operators report in the last message or an uncommitted report file and never commit.
REVIEWEN binds findings to a fixed head and file:line, never in the author's model family; INTEGRIEREN is coordinator-only and uses Mergify.
ENTSCHEIDEN is for the named owner only; money/install/delete/release/security/scope decisions belong to the user. ERFRAGEN answers are information, not approval.
Follow each operator's output and write/push/PR limits in the table; no operator expands authority. Keep PFLEGEN canonical; ÜBERGEBEN records WIP commit + push and checkpoint; BLOCKIERT MELDEN stops with reason, evidence and resume condition.
