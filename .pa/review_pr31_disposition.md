# PR #31 (CLEAN-01) - review disposition, stage B

Candidate: `1a06f9d` (single commit, +0/-43, six files, no seam file, under 300
lines, so one reviewer who is not the author is required).
Author: Claude (Sonnet 5). Reviewer, not a Claude model:

| Reviewer | Model | Transport | Raw answer |
|---|---|---|---|
| Kilo | `kilo/nvidia/nemotron-3-ultra-550b-a55b:free` | `kilo run`, prompt passed inline, run in an empty scratch directory (read-only, no repository in reach) | `.pa/review_pr31_kilo.md` |

Prompt: `.pa/review_prompt_pr31.md` (context, requirement, full
`git diff origin/main...HEAD`). Ollama and OpenCode were not used (weekly
limit). The answer is stored unchanged. Ids: K = Kilo.

Every claim was checked against the repository, not against the diff alone.
Evidence commands run in the PR worktree at `1a06f9d`:

- `git grep -E "isEmptySummary|saveOnboardingHints|MainView|\bLandingPage\b|@tauri-apps/plugin-process"`
  over all tracked files except `.pa/` and `package-lock.json`: one hit, a
  comment in `src/components/SettingsView.tsx` (see K6). Tests, fixtures and
  scripts are included in that search.
- `grep -c plugin-process package-lock.json`: 0.
- `npm run typecheck`: exit 0. `npm run lint`: exit 0.
  `npx vitest run`: exit 0, 66 files, 329 tests passed.

## Findings

| ID | Source | Sev | Finding | Disposition |
|---|---|---|---|---|
| K1 | Kilo | high | Deleting `LandingPage` may break `invoke("get_landing_page")` typing or a type-only import | **Rejected.** No reference anywhere: the search above covers `import type` and generic arguments, and no frontend code calls `get_landing_page` at all (it is only Rust/`pa`). `tsc --noEmit` is exit 0, which is exactly the check that sees type-only uses. |
| K2 | Kilo | high | Deleting `MainView` may break legacy annotations, tests or stories | **Rejected.** Same evidence: zero references incl. tests; typecheck, lint and vitest all exit 0. The type's own comment said it survived only for old comments. |
| K3 | Kilo | med | Tests may import `isEmptySummary` / `saveOnboardingHints` | **Rejected.** The search includes test files (`src/**/*.test.*`); vitest is 66/66 files green. |
| K4 | Kilo | med | A notice gate might compare `package-lock.json` with `THIRD_PARTY_NOTICES.md` | **Rejected, verified.** The reviewer concludes itself that both sides moved together. `scripts/ci/license-check.sh` runs `license-checker` on the production dependencies of the lock plus `cargo deny`; nothing in `scripts/`, `.github/` or `src-tauri/src` reads the notices file. The lock, `package.json` and the notices file all dropped the same package. The full licence gate runs in CI. |
| K5 | Kilo | med | Another lock entry might still depend on `@tauri-apps/plugin-process` | **Rejected, verified.** `grep -c plugin-process package-lock.json` is 0 (no root entry, no `node_modules/` entry, no dependent); `npm ci --dry-run` accepts the pair. |
| K6 | Kilo | low | Dangling comment / doc churn from the removed `MainView` block | **Rejected.** The reviewer itself calls it no bug; the removed block was self-contained. The only remaining textual mention of the package is the comment above `handleRelaunch` in `SettingsView.tsx`, which is still correct (it says why the code calls the plugin command directly instead of the npm package) and is left as is. |
| K7 | Kilo | low | `loadOnboardingHints` remains without a writer, hints can never be re-enabled | **Rejected.** `saveOnboardingHints` had no caller before this change either, so nothing could write the key already; behaviour is identical. The reader stays for the legacy-settings migration and is covered by `settings.legacy.test.ts` and the v1.2.4 fixture. Re-adding a UI writer is a feature, not part of a dead-code deletion. |

Accepted findings: none, so no code change follows this review and no
red-first commit is needed. The candidate (`1a06f9d`) stays as reviewed; this
commit only adds review artefacts under `.pa/`.
