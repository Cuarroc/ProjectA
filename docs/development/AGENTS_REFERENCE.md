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
