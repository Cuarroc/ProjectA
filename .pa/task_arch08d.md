# ARCH-08d: Updates tab extraction

Status: entwurf

Mechanical split of approved ARCH-08 (docs/PLAN.md). Branch `claude/arch-08d-updates-tab`.

- Move only the `tab === "updates"` JSX branch of `src/components/SettingsView.tsx` into
  new `src/components/settings/UpdatesTab.tsx`.
- Props passed unchanged: `appVersion`, `versionFailed`, `updateState`, `relaunchFailed`,
  `handleCheckUpdates`, `handleInstallUpdate`, `handleRelaunch`.
- Hooks, state and the check/install/relaunch handlers stay in `SettingsView`.
- Strings, classNames, DOM structure and branch conditions stay byte-for-byte
  (checking disables the button, `activeWorkers > 0` hides install, ready + `relaunchFailed`
  shows the manual restart hint).
- Out of scope: other tabs, Rust/API/store, deps, gates, redesign, translation.
- Tier A (update/relaunch safety conditions move through props); no runtime effect.
- Evidence: `npx tsc --noEmit`, existing SettingsView tests, `gates.sh lane prepush`.
