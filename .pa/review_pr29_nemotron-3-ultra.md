# Review: PR #29 — HQ Stylesheet Contrast Gate, Light Mode, Prefers-Contrast

## Summary

The candidate implements W1-10 requirements: extends the contrast gate to `docs/dev-hq/hq.css`, adds light mode via `@media (prefers-color-scheme: light)`, adds `@media (prefers-contrast: more)`, pins the workspace to dark, and adds a browser test. **One HIGH finding blocks acceptance; several MEDIUM findings need fixes.**

---

## HIGH

### 1. `--ink` token not overridden in light mode — text invisible on paper surfaces
**File:** `docs/dev-hq/hq.css:1198-1225` (light mode block)

The light mode `:root` block overrides `--ground`, `--paper`, `--fog`, `--bright`, `--link`, accent text tokens, `--ink-2`, `--ink-3`, hairlines, `--line`, `--well` — **but not `--ink`**.

`--ink` is used extensively on `.desk-section.paper` (background `--paper` = white in light mode):
- `.signal strong { color: var(--ink); }` (line ~2445)
- `.signal span { color: color-mix(in srgb, var(--ink) 70%, var(--paper)); }` (line ~2450)
- `.signal.act strong { color: color-mix(in srgb, var(--ember-deep) 80%, var(--ink)); }` (line ~2450)
- `.desk-section.paper .desk-head p { color: color-mix(in srgb, var(--ink) 70%, var(--paper)); }` (line ~2430)
- Focus ring fix: `.desk-section.paper :focus-visible { outline-color: var(--ink); }` (line 1186)

If `--ink` retains its dark-mode value (a light color for text on dark backgrounds), **all signal text, well text, and the paper-surface focus ring become invisible in light mode**. The browser test does not assert `--ink` in light mode (only `--paper`, `--link`, `--bright`, `--ink-2`).

**Fix:** Add `--ink: var(--fog);` (or an explicit dark color) to the light mode `:root` block. `--fog` in light mode is `#2b3944` (dark), which works for text on white `--paper`.

---

## MEDIUM

### 2. #0066CC ban only checked in dark mode
**File:** `scripts/contrast-check.mjs:1554-1563`

```javascript
for (const token of ["steel", "link"]) {
  const c = color(hqDarkVars, token);  // only dark vars
  ...
}
```

In light mode, `--link` becomes `var(--steel)` (line 1204). If `--steel` were changed to `#0066CC` only in the light mode block, the gate would not catch it. **Check both `hqDarkVars` and `hqLight` (merged) for the ban.**

### 3. `hqRuleValue` selector matching is fragile
**File:** `scripts/contrast-check.mjs:1506-1516`

- Exact string match after comma-split — breaks if selector formatting changes (whitespace, order of pseudo-classes).
- No specificity handling — last rule wins in source order, but CSS cascade uses specificity. The gate may read a value from a lower-specificity rule that is overridden in practice.
- Works for current selectors (`.summary-item small`, `.stat-bar-fill.FACT`, `.grip :focus-visible`, etc.) but is a maintenance hazard.

**Recommendation:** Document the limitation; consider a proper CSS parser for rule-bound pairings if the stylesheet grows.

### 4. Border color extraction assumes fixed shorthand order
**File:** `scripts/contrast-check.mjs:1517`

```javascript
const borderColor = (value) => value.replace(/^\S+\s+\S+\s+/, "");
```

Assumes `border: width style color`. CSS allows any order. Current HQ CSS uses `1px solid var(--hair-strong)` consistently, so it works today. **Add a comment documenting the assumption** or parse properly.

### 5. Browser test only verifies workspace pinning in light mode
**File:** `scripts/lib/hq-visual.browser.mjs:1683-1700`

The workspace pinning test creates only one page: `colorScheme: "light"`. It should also verify:
- Dark mode (default) — workspace stays dark
- `prefers-contrast: more` in both schemes — tokens remain pinned

Without this, a regression where the workspace follows the OS scheme in dark/contrast modes would not be caught.

### 6. `mediaSpan` doesn't handle nested at-rules
**File:** `scripts/contrast-check.mjs:1430-1438`

```javascript
function mediaSpan(src, at) {
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return [at, i + 1];
  }
  ...
}
```

If `@supports` or another `@media` appears inside the target block, the brace counting breaks. Not an issue today (no nesting in `hq.css`), but **add a comment** that this assumes no nested at-rules.

---

## LOW

### 7. Hardcoded RGB values in browser test assertions
**File:** `scripts/lib/hq-visual.browser.mjs:1655-1670`

```javascript
assert.equal(seen["dark"].bg, "rgb(28, 34, 40)");
assert.equal(seen["light"].bg, "rgb(232, 236, 238)");
assert.equal(seen["dark"].paper, "#dfe6ea");
assert.equal(seen["light"].paper, "#ffffff");
assert.equal(seen["dark"].link, "#7ba5c0");
assert.equal(seen["light"].link, "#3d6d8c");
assert.equal(seen[name].ring.ring, "rgb(18, 21, 26)", ...);
```

Brittle — any design tweak breaks the test. Acceptable for a regression gate, but **document that these are intentional snapshot values** tied to the W1-10 token definitions.

### 8. Gate doesn't verify coverage of all text/background pairings in `hq.css`
The `hqPairings` and `hqRuleBound` lists are manually maintained. No automated check that every `color:`/`background:`/`fill:`/`border-color:` in `hq.css` is represented. **Manual audit required** — but the current lists appear comprehensive for the visible diff.

### 9. `parseColorLiteral` doesn't handle `rgb()` with percentages or `hsl()`
**File:** `scripts/contrast-check.mjs:1339-1354`

Only handles `#rrggbb`, `#rgb`, `rgb(r,g,b)`, `rgba(...)`. CSS also allows `rgb(50% 50% 50%)`, `hsl(...)`, etc. Not used in HQ CSS today, but **add a comment** that unsupported formats will throw.

---

## What Works Well

- **Color arithmetic** (`mix2`, `colorValue`) correctly implements premultiplied alpha mixing per CSS Color 4 spec, including percentage sums ≠ 100 and single-percentage shorthand.
- **Four-mode matrix** (dark, light, dark+contrast, light+contrast) correctly merges contrast overrides atop each color scheme.
- **Opacity-on-text-container check** (lines 1546-1552) catches the stale-lesson-card blending issue.
- **Workspace pinning** in `workspace.css` correctly uses `color-scheme: dark` and re-declares all W1-10 tokens so the live desk stays dark.
- **Focus ring fix** (`.grip :focus-visible`, `.desk-section.paper :focus-visible { outline-color: var(--ink) }`) correctly addresses the `--bright` = `--paper` collision in dark mode.
- **Browser test structure** is sound: exercises all four schemes, captures screenshots, verifies token flips, focus ring visibility, hairline strengthening, and workspace pinning.

---

## Required Changes Before Merge

1. **Add `--ink: var(--fog);` to the light mode `:root` block in `hq.css`** (HIGH)
2. **Extend #0066CC ban check to light mode merged vars** in `contrast-check.mjs` (MEDIUM)
3. **Add workspace pinning assertions for dark and contrast modes** in `hq-visual.browser.mjs` (MEDIUM)
4. **Document fragility assumptions** in `hqRuleValue`, `borderColor`, `mediaSpan`, `parseColorLiteral` (MEDIUM/LOW)

---

## NICHT ABGEDECKT

Per AGENTS.md: the `#[cfg(unix)]` tests do not compile on Windows, `#[cfg(windows)]` tests do not compile on Linux (KNOWN_ISSUES KI-7). No single machine covers both halves. This review covers the candidate code only; the contrast gate and browser test must pass on both platforms in the merge queue.

---

**Disposition:** **DO NOT MERGE** until HIGH finding is fixed. MEDIUM findings should be addressed in the same PR or tracked as follow-ups with disposition recorded in `.pa/review_pr29_disposition.md`.
