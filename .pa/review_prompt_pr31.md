# Review request PR #31 (CLEAN-01): delete proven-dead code

You are an independent reviewer (not the author; the author is a Claude model).
Review the COMPLETE candidate below for correctness bugs, gaps against the
requirements, and regressions. Be concrete: cite file and line, say what breaks
and when. Rate each finding high/medium/low. Do not restate the diff. If
something is fine, say nothing about it. Answer in English or German. This is a
READ-ONLY review: do not modify any files.

## Context

Repo: ProjectA, a Tauri 2 "agentic terminal" (Rust backend in src-tauri/, React
+ TypeScript frontend in src/, public GitHub repo, Apache/MIT-style license
policy). You only see this prompt, not the repository.

## Package requirement

CLEAN-01: remove code that is provably unreferenced, changing no behaviour.
1. Drop the npm dependency `@tauri-apps/plugin-process` (package.json,
   package-lock.json, docs/THIRD_PARTY_NOTICES.md). The only relaunch call in
   the frontend is `invoke("plugin:process|restart")` in
   src/components/SettingsView.tsx, which talks to the Rust plugin directly and
   never imported the npm package. The Rust side (`tauri-plugin-process` in
   Cargo.toml, `.plugin(tauri_plugin_process::init())` in main.rs and the
   capability `process:allow-restart` in src-tauri/capabilities/default.json)
   stays untouched on purpose.
2. Delete four exports that a repo-wide search finds nowhere else:
   `isEmptySummary` (src/lib/diff.ts), `saveOnboardingHints`
   (src/lib/settings.ts; its reader `loadOnboardingHints` stays), the legacy
   `MainView` type and the `LandingPage` interface (src/types.ts). Rust
   `get_landing_page` and the `pa project landing-page` commands are separate
   and untouched.
The commit carries `No-Test: pure deletion`; lint, typecheck, vitest and the
frontend build are expected to stay green.

Hunt for: something that still needs the deleted code (dynamic imports, string
lookups, docs/tests/scripts that read the removed lines, a licence/notice gate
that compares package-lock.json with THIRD_PARTY_NOTICES.md), an inconsistent
package.json / package-lock.json pair (the lock's root "dependencies" block and
the node_modules entry must both be gone, and no other package may depend on
the removed one), a notice file that no longer matches the lock, and any
leftover comment or doc that still refers to a removed symbol.

## Diff (git diff origin/main...HEAD, single commit 1a06f9d)

```diff
diff --git a/docs/THIRD_PARTY_NOTICES.md b/docs/THIRD_PARTY_NOTICES.md
index 5e69377..45410ef 100644
--- a/docs/THIRD_PARTY_NOTICES.md
+++ b/docs/THIRD_PARTY_NOTICES.md
@@ -63,7 +63,6 @@ why the pack is absent and ships no third-party content.
 | Package | License |
 |---|---|
 | @tauri-apps/api@2.11.1 | Apache-2.0 OR MIT |
-| @tauri-apps/plugin-process@2.3.1 | MIT OR Apache-2.0 |
 | @tauri-apps/plugin-updater@2.11.0 | MIT OR Apache-2.0 |
 | @xterm/addon-canvas@0.7.0 | MIT |
 | @xterm/addon-fit@0.10.0 | MIT |
diff --git a/package-lock.json b/package-lock.json
index 82e7cba..96258fc 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -9,7 +9,6 @@
       "version": "1.4.1",
       "dependencies": {
         "@tauri-apps/api": "^2.1.1",
-        "@tauri-apps/plugin-process": "^2.3.1",
         "@tauri-apps/plugin-updater": "^2.10.1",
         "@xterm/addon-canvas": "^0.7.0",
         "@xterm/addon-fit": "~0.10.0",
@@ -1901,15 +1900,6 @@
         "node": ">= 10"
       }
     },
-    "node_modules/@tauri-apps/plugin-process": {
-      "version": "2.3.1",
-      "resolved": "https://registry.npmjs.org/@tauri-apps/plugin-process/-/plugin-process-2.3.1.tgz",
-      "integrity": "sha512-nCa4fGVaDL/B9ai03VyPOjfAHRHSBz5v6F/ObsB73r/dA3MHHhZtldaDMIc0V/pnUw9ehzr2iEG+XkSEyC0JJA==",
-      "license": "MIT OR Apache-2.0",
-      "dependencies": {
-        "@tauri-apps/api": "^2.8.0"
-      }
-    },
     "node_modules/@tauri-apps/plugin-updater": {
       "version": "2.11.0",
       "resolved": "https://registry.npmjs.org/@tauri-apps/plugin-updater/-/plugin-updater-2.11.0.tgz",
diff --git a/package.json b/package.json
index ea93db1..c0a2d0e 100644
--- a/package.json
+++ b/package.json
@@ -44,7 +44,6 @@
   },
   "dependencies": {
     "@tauri-apps/api": "^2.1.1",
-    "@tauri-apps/plugin-process": "^2.3.1",
     "@tauri-apps/plugin-updater": "^2.10.1",
     "@xterm/addon-canvas": "^0.7.0",
     "@xterm/addon-fit": "~0.10.0",
diff --git a/src/lib/diff.ts b/src/lib/diff.ts
index 42a7392..93a5ea4 100644
--- a/src/lib/diff.ts
+++ b/src/lib/diff.ts
@@ -21,10 +21,6 @@ export function summarizeDiff(diff: WorkerDiff): DiffSummary {
   return { baseBranch: diff.baseBranch, files: diff.files.length, additions, deletions };
 }
 
-export function isEmptySummary(summary: DiffSummary): boolean {
-  return summary.files === 0;
-}
-
 interface CacheEntry {
   summary: DiffSummary;
   at: number;
diff --git a/src/lib/settings.ts b/src/lib/settings.ts
index 296afe6..64a816f 100644
--- a/src/lib/settings.ts
+++ b/src/lib/settings.ts
@@ -48,10 +48,6 @@ export function loadOnboardingHints(): boolean {
   return readString(KEYS.onboarding) !== "0";
 }
 
-export function saveOnboardingHints(show: boolean): void {
-  writeString(KEYS.onboarding, show ? null : "0");
-}
-
 /**
  * The default port for the web interface, or `null` when none was stored.
  * Anything that does not parse stays unstored rather than lying about.
diff --git a/src/types.ts b/src/types.ts
index c65a090..277c1d0 100644
--- a/src/types.ts
+++ b/src/types.ts
@@ -572,24 +572,6 @@ export interface WorkerStatusEvent {
   attentionObservedAt: number | null;
 }
 
-/**
- * Legacy main-area ids. F2 routes through `AppGoal` in `lib/goals.ts`;
- * these names remain only for older comments and tests that have not moved.
- */
-export type MainView =
-  | "dialog"
-  | "board"
-  /** The decisions the fleet is waiting on; see {@link Question}. */
-  | "fragen"
-  | "workers"
-  | "usage"
-  | "statistik"
-  | "design"
-  | "activity"
-  | "settings"
-  /** P2-H: log path, diagnosis pack, Warum-view. */
-  | "diagnose";
-
 /**
  * The fixed set of agent categories the settings manage. A category is a role
  * an agent can take; the profile is just how one of them gets started.
@@ -608,11 +590,6 @@ export interface AgentCategoryConfig {
   defaultProfileId: string | null;
 }
 
-/** Payload of `get_landing_page`; the markdown behind the design studio. */
-export interface LandingPage {
-  markdown: string | null;
-}
-
 /** Usage information for one provider, as reported by `get_provider_overview`. */
 export interface ProviderUsage {
   /** 0..100, or `null` when no percentage is available. */
```
