# AGENTS reference

Reference sections from [AGENTS.md](../../AGENTS.md). Its ten core rules take
precedence. All paths and commands below are relative to the repository root.

## Pull requests and CI minutes

CI spending: only within the limit the user approved (private record); if CI
becomes the bottleneck, ask the user.

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
- **Stacked packages:** a package may start on top of an unmerged predecessor
  branch: its DRAFT PR has that branch as base and `main` is not merged into
  it. The coordinator retargets it to `main` after the base merges. Review
  diffs of a stacked PR use `git diff <base-branch>...<head>`.
- **WIP limit:** at most 15 open agent PRs (acceptance of the PR-backlog
  package AP-1). At the limit there is no new implementation dispatch, only
  finishing, review and merging. Count with `gh pr list --state open`.
- **Draft age:** a draft without a new commit for 48 h is finished, split or
  closed by the coordinator. Closing keeps the branch, so nothing is lost.
  Drafts get no CI, so an old draft has no evidence.
- **Bundling:** before every dispatch the coordinator runs
  `gh pr list --state all --search "<keyword>"` for an existing similar
  package. Fixes with the same cause (retry, focus, ...) go into one package.
- **File ownership:** `.github/CODEOWNERS` maps the four seams (rule 6) and
  `.github/` plus `scripts/ci/` to the user. It documents ownership and
  requests a review; the rulesets do not require code-owner approval (checked
  2026-10-14: `require_code_owner_review: false`), so it blocks no merge.
  Rule 6 still governs who edits a seam.

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
the PR. That dated observation does not prove today's auto-enqueue behavior;
keep explicit enqueueing until fresh evidence resolves it. Merge
`main` into your branch only to resolve a real conflict (Mergify labels
those `conflict`): merge, never rebase or force-push.

- `review-ok` label: a PR enters the queue only with it. Only Root (the
  orchestrator; the Chief as its deputy) sets it, bound to the head SHA that
  was reviewed (a later push voids it), after the review disposition is
  complete and no high finding is open. The setter's own model family does
  not matter; the review does: the required verdicts must come from model
  families other than the author's (rule 5) and be bound to that head SHA. A
  setter that shares the author's family must not count its own review as
  the independent one. Workers and reviewers never set it or queue
  themselves. Removing it (or adding `do-not-merge`) takes a PR out. No branch
  type is exempt.
- `do-not-merge` label: keeps a green PR out of the queue.
- `priority` label (coordinator only) or a `hotfix/` branch: queued first. A
  hook or gate fix that protects everyone goes alone as a hotfix, never bundled
  into a large PR.
- **Package PRs carry their report in the PR text.** A branch is a package
  branch when it matches `^(claude|codex|kimi|opencode|glm|cursor)/(w<N>-|df<N>|ki-<N>|hq2-|dr-|z<N>-)`
  (case-insensitive), e.g. `claude/w2-07-credential-acl`. Its PR body must
  contain a line starting with `## Report`, or the `Mergify Merge Protections`
  check stays red. There is no transition: a `.pa/report_*.md` file no longer
  satisfies the check, so an open package PR must add the section.
  Docs/infra branches (`claude/plan-01-…`, `claude/ci-03-…`)
  are not packages but use the same PR shape.
- **Red `main`:** CI-04 has an implementation, not proof of effective operation; the coordinator verifies the stop and puts `do-not-merge` on
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

[Back to AGENTS.md](../../AGENTS.md)
## Reviews and advisors

The tier (rule 5) follows the changed files: any seam, security-relevant code,
concurrency, PTY or database/migration change makes it tier A. Counts,
non-author families, E1, C+ and fix-round delta requirements follow rule 5.
Record every finding and disposition (accepted with commit, rejected with reason,
follow-up) in the PR. Every accepted fix, at any severity, requires bounded
verification of exactly `<reviewed-head>..<new-head>`: closure of the accepted
findings and new defects in the delta. This IS round two and the last round.
A full candidate re-review in round two is allowed only after a high finding.
Root then records merge/split/drop and informs the user; no third round.
Evidence binds to the candidate; later changes invalidate affected evidence.
A finding without `file:line` counts as unproven.

Dated user order 2026-10-20, documentation mission until DOC-9 acceptance:
central orchestration uses Claude; delegated implementation is ordered to use
GPT-6.1/high or GPT-6 Astra. Source: [PLAN](../PLAN.md), DOC-CTRL1 mission
record (DOC-8), and [decision index](../decisions.md) (DOC-2).
Observe the actual model per job via its own `turn_context`, never a profile claim.
Rule 5 is NOT suspended: each package receives cross-family reviews via the
approved Ollama credit path plus a separate GPT observer. The 2026-10-20 user
approval covers existing credit for `glm-5.3`, `glm-5.3-flash` and
`deepseek-v4.1-flash`; private bounds apply, no purchase or auto-reload.
It supersedes the older block until 2026-11-01; no current balance is asserted.

Every review checks `docs/PLAN.md` at the head: the PR's own row (identified by `Plan-ID:`) states what is true after merge, and changes in the PR leave no other row, the user section or decision inbox stale; cross-check against `gh`. A mismatch is a medium finding, or high if the user section asks for something already done, and must be fixed in the same PR before `review-ok` (user order 2026-10-15: the plan must never be stale).

Use recursive prompting selectively for complex plans, dependencies, hard
diagnosis or designs with checkable criteria (user order 2026-10-08), following
`docs/development/prompting.md`. Preserve requirements and acceptance; ask only
necessary subquestions, make a first solution, then one neutral extra check
("no defect" is valid). Correct concrete defects and check the integrated result
including interfaces. A second extra round needs a concrete remaining defect.
Stop when acceptance is met, no new insight appears, the blocker is unchanged,
or a time/quota/budget limit is reached. Self-check replaces neither independent
review nor user approval; do not add an RLM runtime, agents or services for it.

- **Everyday reviewers:** two reviewers from families other than the author's
  for tiers A and B, one for C+, none for C (rule 5). Keep prompts outside the repo; they
  are reproducible from the commit. Which reviewer models are currently usable,
  and how they are called, is the coordinator's private record.
- **Advisors** for hard decisions and final reviews: two advisors from different
  vendors. A worker may call the advisors itself for seam, security or
  architecture decisions, or when stuck for more than 30 minutes; otherwise it
  goes through the coordinator. Questions an advisor raises go to the
  coordinator, who puts them into the decision inbox. Advisors do not replace
  the required reviews: a model of the author's own family never counts as an
  independent reviewer. Current advisor models: the coordinator's private record.
- Paid usage only within budgets the user approved in the coordinator's private
  permission record; no new paid services, keys or purchases without the
  user's explicit yes. Secrets never go into files, logs, commands or PR text.

### Subscriptions first — recorded credit exceptions

Subscriptions remain the default. The included Anthropic API-credit exception
(decision 2026-10-09) allows a dedicated ProjectA Console workspace/key with a
spend limit, no payment method, purchased credits or auto-reload; exhaustion
returns work to subscriptions. Keys stay in the user's vault/secret store,
never in files, logs, commands or PR text.

The 2026-10-14 OpenRouter exception supersedes the 2026-10-09 ban: existing
credit only, no purchase or auto-reload. Reviews use the coordinator's external
PC script; keys stay in the user's environment/vault, never files, logs,
commands or PR text. The privately recorded floor applies; free feedback never
counts. Missing eligible families mean waiting, not fewer reviews. Rule 5's E1
ends when credit returns or the user changes it; no live balance is asserted.

## Routing: task type to profile (AP-6a)

This section is the routing contract; setup pages contain dated recipes, not
dispatch authority. Profile ids come from `src-tauri/resources/agent-defaults.json`;
observe model/effort and access before use. A profile not in the repo is marked
"profile pending CLI check": do not dispatch to it until a CLI probe exists.
The choice among eligible families is only the usage rule below the table;
no family is preferred or excluded by a fixed rule (user decision 2026-10-07).

| Task type | Eligible profile families | Reviewer rule |
|---|---|---|
| Seam / security / PTY / DB implementation (tier A) | `codex`, `claude`, `kimi`; Cursor: profile pending CLI check | two reviewers, each from a family other than the author's |
| Other Rust (tier B) | `codex`, `claude`, `kimi`, `opencode` | two different non-author families: subscription + OpenRouter, or two subscription families under E1 (rule 5) |
| Frontend TS (tier B) | `codex`, `claude`, `kimi`, `opencode`; Cursor: profile pending CLI check | two different non-author families: subscription + OpenRouter, or two subscription families under E1 (rule 5) |
| Scripts / CI (tier B; tier C if no runtime effect) | `codex`, `claude`, `kimi`, `opencode` | tier B as above; tier C none, the gates suffice |
| Docs (tier C) | `codex`, `claude`, `kimi`, `opencode` | none, the gates suffice |
| Read-only inventory / research | `opencode-glm-53-flash`, `ollama-coder`, `codex`, `claude`, `kimi`; Grok: profile pending CLI check | none (report only) |
| Review tier A | coordinator's recorded pair, `codex`, `claude`; OpenRouter: `z-ai/glm-5.3`, `google/gemini-3.8-flash`, `moonshotai/kimi-k3` within the credit exception; Cursor: profile pending CLI check | two different non-author families; free feedback never counts; E1 changes tier B only |
| Review tier B | subscription reviewer + OpenRouter (`z-ai/glm-5.3`, `google/gemini-3.8-flash`, `moonshotai/kimi-k3`) within the credit exception; or two subscription families under E1 (rule 5) while credit is <= 0, no purchase | two different non-author families; free feedback never counts |

Pick among the eligible providers by `usage_overview`: the one with the most
headroom wins; a provider at the user's cap drops out until its window resets
(caps live in the coordinator's private record). Record the pick and the
observed value in the dispatch note (rule 9: no claim without observation).
The reviewer family must differ from the author's (rule 5); a router that
hides the vendor (Cursor `auto`) first needs the actual vendor proven.
