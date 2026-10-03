# ARCH-08f: Profiles panel extraction

Status: entwurf

Mechanical split of approved ARCH-08 (docs/PLAN.md). Branch `claude/arch-08f-profiles`.

- Move only the `div.profile-field` JSX (hints, errors, empty state, profile list) of
  `src/components/SettingsView.tsx` into new `src/components/settings/ProfilesPanel.tsx`.
- Props: `profileList`, `profileError`, `budgetError`, `profileBusyId`, `budgetBusyId`,
  `budgetOf`, `handleToggleProfile`, `handleBudgetChange`, `handleSaveBudget`.
- `ProfileBudgetFields` import moves to the panel.
- Hooks, state, effects, optimistic updates, budget parsing/saving stay in `SettingsView`.
- Strings, classNames, DOM structure and error order stay unchanged.
- Out of scope: other tabs, Rust/API/store, deps, gates, redesign, translation.
- Tier B; no runtime effect.
- Evidence: `npx tsc --noEmit`, existing SettingsView tests, `gates.sh lane prepush`.
