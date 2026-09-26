I'll review this PR for correctness bugs, gaps, and regressions. Let me analyze each change systematically.

## Review Findings

### High Severity

**1. `LandingPage` interface deletion may break `invoke("get_landing_page")` type safety** (src/types.ts:590-595 in original)
- The comment explicitly states: "Payload of `get_landing_page`; the markdown behind the design studio."
- The requirement says "Rust `get_landing_page` and the `pa project landing-page` commands are separate and untouched" — meaning the Rust command **still exists**.
- If any frontend code calls `invoke<LandingPage>("get_landing_page")` or uses `LandingPage` as a response type, **TypeScript compilation will fail**. A "repo-wide search" for the symbol name won't catch type-only imports like `import type { LandingPage }` or generic type arguments in `invoke<>`.

**2. `MainView` type deletion may break existing type annotations** (src/types.ts:572-590 in original)
- This was a widely-used union type for main-area routing. Even if "F2 routes through `AppGoal`", legacy components, tests, or storybook files may still annotate props/state with `MainView`.
- Type-only imports (`import type { MainView }`) are invisible to simple symbol searches.

### Medium Severity

**3. `isEmptySummary` and `saveOnboardingHints` — verify no test files import them**
- Both are value exports (not types). Vitest/test files may import them directly. The requirement says "repo-wide search finds nowhere else" but test files are often excluded from casual greps.

**4. THIRD_PARTY_NOTICES.md gate risk**
- The requirement mentions "a licence/notice gate that compares package-lock.json with THIRD_PARTY_NOTICES.md". If such a CI check exists, it will now fail because the lockfile no longer contains `@tauri-apps/plugin-process` but the notice file *also* no longer contains it — wait, both are removed, so they *match*. However, if the gate expects *every* dependency in package.json to have a notice entry, and `@tauri-apps/plugin-process` is gone from package.json, the gate should pass. But if the gate works by "every notice entry must exist in lockfile", it passes. **Verify the gate logic direction.**

**5. package-lock.json — transitive dependents check**
- The diff shows the root `dependencies` block and `node_modules/@tauri-apps/plugin-process` entry are removed. **Must verify no other package in the lockfile has `@tauri-apps/plugin-process` in its `dependencies` or `optionalDependencies`.** The diff only shows the removed sections, not a full scan.

### Low Severity

**6. Dangling comment references in removed `MainView` block**
- The deleted comment references `AppGoal` in `lib/goals.ts` and `{@link Question}`. If those symbols don't exist or moved, it's harmless (comment is gone). But if `Question` is a real type elsewhere, the `@link` was valid documentation — now lost. Not a bug, just doc churn.

**7. `loadOnboardingHints` reader remains without writer**
- `saveOnboardingHints` is deleted but `loadOnboardingHints` stays. This is intentional per requirements, but it means the onboarding hint can never be *set* to `true` again (only read, defaulting to `true` via `!== "0"`). If the app expects to re-enable hints programmatically, that path is gone. Confirm this is desired.

---

## Summary

| Finding | Severity | Location |
|---------|----------|----------|
| `LandingPage` interface used by `invoke("get_landing_page")` | **High** | src/types.ts (deleted) |
| `MainView` type used in legacy components/tests | **High** | src/types.ts (deleted) |
| Test imports of `isEmptySummary` / `saveOnboardingHints` | **Medium** | src/lib/diff.ts, src/lib/settings.ts |
| CI licence/notice gate logic | **Medium** | CI config (not in diff) |
| Transitive dependents in package-lock.json | **Medium** | package-lock.json (full scan needed) |
| Orphaned `loadOnboardingHints` without writer | **Low** | src/lib/settings.ts |

---

## Recommendation

**Do not approve until:**
1. Run `tsc --noEmit` (typecheck) — will catch #1 and #2 immediately
2. Run `vitest run` — will catch #3
3. Search full package-lock.json for `"@tauri-apps/plugin-process"` — confirm zero occurrences
4. Verify CI licence gate passes with both files in sync

The commit message `No-Test: pure deletion` is risky for type exports — TypeScript *is* the test for types.
