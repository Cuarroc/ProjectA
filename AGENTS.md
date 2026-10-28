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
10. **Safety by three tiers.** Secret scan before every commit; no
    secrets in files, logs or commits. Tier 1 (reversible): act freely.
    Tier 2 (deleting, force-push, server changes): Root acts unasked
    only with a verified restore path to the exact pre-change state despite
    concurrent remote changes, a log entry (time, action, reason, restore
    path) and restore material kept 24 h; unproven recovery is tier 3. Tier 3
    (the user's explicit yes only): money and paid services, installs,
    rights/security changes, rotating or revoking secrets, public releases
    and `v*` release tags. A standing approval in the
    coordinator's permission record may cover patch releases; minor and
    major always need a fresh yes. Preserve granted authorizations; do not
    ask again within that scope. Questions: normal chat, bundled; decisions:
    `docs/PLAN.md`; no AskUser windows.

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

Root priority/acceptance; the Stabschef alone dispatches and keeps docs/PLAN.md (Chief = user's independent Projektassistent, no dispatcher); one execution owner; the PM cuts packages and refills below five suitable prepared ones. Reconcile orders/native goals/PLAN first; blocker cause/evidence/owner/next step. Never weaken acceptance; user scope/cost/permissions.
Binding: [reference](docs/development/AGENTS_REFERENCE.md#bounded-goals-and-approved-adaptation).

## Development loop

CONTINUOUS.md; projecta.dev.json; frozen until M4; lease is not process-stop proof.
Binding: [reference](docs/development/AGENTS_REFERENCE.md#development-loop).

## Checks

Sole list: scripts/ci/gates.sh; full local `bash scripts/ci/gates.sh lane prepush` before PR.
Generated docs/dev-hq/data.js|json, .pa/ACTIVITY.md: main only (hotspot-guard); every run's NICHT ABGEDECKT in PR text.
Test-First/Regression-For/No-Test trailers; never --no-verify.
The [full section](docs/development/AGENTS_REFERENCE.md#checks) is binding.

### Build slots

Worktrees: CARGO_TARGET_DIR (main target/warm slot), CARGO_BUILD_JOBS=1; never CARGO_PROFILE_*.
Free RAM: CLI checks from 1.5 GB, builds/gates from 4 GB; else heavy work: server or wait. At most 3 builds on the PC (2 when tight).
The [full section](docs/development/AGENTS_REFERENCE.md#build-slots) is binding.

## Pull requests and CI minutes

DRAFT; own prepush; git ls-remote; at most 15 open agent PRs; draft age 48 h.
Binding: [reference](docs/development/AGENTS_REFERENCE.md#pull-requests-and-ci-minutes).

## Routing: task type to profile (AP-6a)

agent-defaults.json; observe model/effort/access; usage_overview; reviewer rule 5.
Binding: [reference](docs/development/AGENTS_REFERENCE.md#routing-task-type-to-profile-ap-6a).

## Merging (Mergify queue, since 2026-09-24)

Mergify; red main stops queue; @Mergifyio queue; review-ok; ## Report; do-not-merge.
Binding: [reference](docs/development/AGENTS_REFERENCE.md#merging-mergify-queue-since-2026-09-24).

## Record and learn

PR text=record (rule 7); npm run hq:lesson -- search BEFORE debugging; --run <runId>; decisions: docs/decisions.md; no tracked secrets; restore path before deleting (rule 10).
Binding: [reference](docs/development/AGENTS_REFERENCE.md#record-and-learn).

## Task operators

1 main/brief: PRÜFEN BELEGEN MESSEN RECHERCHIEREN ERFRAGEN ENTWERFEN VORSCHLAGEN ENTSCHEIDEN(named owner) UMSETZEN NACHBESSERN REVIEWEN(non-author family) INTEGRIEREN(coordinator only) PFLEGEN BERICHTEN ÜBERGEBEN BLOCKIERT MELDEN
Read-only: no commit; user: tier 3 (rule 10) and product scope; no new authority
OPERATOR AUTHORITY GOAL NON-GOALS BASE FILES/SEAM SIZE RED-FIRST ACCEPTANCE TIER/REVIEW REPORT OVERLAP
[Full section](docs/development/AGENTS_REFERENCE.md#task-operators) binds.

## Detailed operating reference

WORKFLOW.md; architecture-rules.md.
Binding: [reference](docs/development/AGENTS_REFERENCE.md#detailed-operating-reference).
