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

lage-jetzt; STAND.md; docs/PLAN.md only plan; bash scripts/sync.sh start; live gh pr list/git log origin/main; never launch desktop app to inspect; npm run dev:start-check exit 1/2/3: no start; observe actual model.
Binding: [reference](docs/development/AGENTS_REFERENCE.md#start-with-current-evidence).

## Ownership and proof

Size: added+deleted vs merge-base including tests; 300/400; named exceptions only. One lane/seam; PA_SEAM_ALLOW; no shared stash; WIP commit. Bug claim: failing regression test; never hide exit codes/bypass hooks.
Binding: [reference](docs/development/AGENTS_REFERENCE.md#ownership-and-proof).

## Reviews and advisors

Tier by changed files; counts/families/E1/C+/fix-round delta: rule 5.
Accepted fix: bounded reviewed-head..new-head delta = LAST round; full re-review only after high; no third. file:line or unproven; Plan-ID row check; observe actual model.
Models/caps/credit exceptions: reference + private coordinator record only; no new paid services/keys/purchases without user approval; secrets never in files/logs/commands/PR.
The [full section](docs/development/AGENTS_REFERENCE.md#reviews-and-advisors) is binding.

## Bounded goals and approved adaptation

Root priority/acceptance; Chief alone dispatches; one execution owner. Reconcile orders/native goals/PLAN first; blocker cause/evidence/owner/next step. Never weaken acceptance; user scope/cost/permissions.
Binding: [reference](docs/development/AGENTS_REFERENCE.md#bounded-goals-and-approved-adaptation).

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

PR text=record (rule 7); npm run hq:lesson -- search BEFORE debugging; --run <runId>; decisions: docs/decisions.md; no tracked secrets; backup before deleting.
Binding: [reference](docs/development/AGENTS_REFERENCE.md#record-and-learn).

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
