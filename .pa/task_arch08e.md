# ARCH-08e: Agent categories panel extraction

Status: entwurf

Mechanical split of approved ARCH-08 (docs/PLAN.md). Branch `claude/arch-08e-categories`.

- Move only the `learningError` span and the `ul.category-list` JSX of
  `src/components/SettingsView.tsx` into new `src/components/settings/CategoriesPanel.tsx`.
- Props: `categories`, `profiles`, `learning`, `learningError`, `handleCategoryChange`,
  `handleToggleLearning`.
- `CATEGORY_LABELS` and `LEARNING_CATEGORIES` move too (only this JSX uses them).
- Hooks, state and the category/learning handlers stay in `SettingsView`.
- Strings, classNames, DOM structure and branch conditions stay unchanged (employee hidden,
  Queen historical without toggle, no learning switch without critic, profile select
  disabled when historical/inactive/no profiles).
- Out of scope: other tabs, Rust/API/store, deps, gates, redesign, translation.
- Tier B; no runtime effect.
- Evidence: `npx tsc --noEmit`, existing SettingsView tests, `gates.sh lane prepush`.
