# Review: PR #27 (W1-21d) — Case-sensitivity & Regex Toggles in Terminal Scrollback Search

## Summary
The implementation is solid and addresses the requirements well. The first review's findings (F-1..F-8) have been properly fixed. I found **3 medium** and **4 low** issues — no high-severity bugs.

---

## Medium Findings

### M1: Contrast gate may not match actual pressed-state rendering
**Files:** `scripts/contrast-check.mjs:52`, `src/styles.css:293-297`  
**Issue:** The gate checks `color-accent-text` vs `surfaces.Karte` (3:1). But the pressed toggle renders:
- `background: var(--color-accent-tint)` (semi-transparent overlay on `Karte`)
- `box-shadow: inset 0 0 0 1px var(--color-accent-text)` (the state indicator ring)

The ring sits on top of `accent-tint`, not directly on `Karte`. The comment acknowledges `accent-tint` on `elevated` ≈ 1.2:1, so the ring *is* the indicator. The gate should either:
- Check `accent-text` vs the composed `accent-tint`+`Karte` background, or
- Document why `Karte` alone is a safe conservative bound (it's not obviously conservative — if `accent-tint` darkens the background, contrast could be *lower* than vs `Karte` alone).

**Risk:** WCAG 1.4.11 non-text contrast could fail in one theme if the composed background differs significantly from `Karte`.

---

### M2: Missing test for Alt+C from button focus
**File:** `src/components/TerminalView.test.tsx:418-434`  
**Issue:** The test "Alt C und Alt R schalten die Suchoptionen per Tastatur um" verifies Alt+R from the case-toggle button (line 429), but **not Alt+C from the regex-toggle button**. The handler is attached to the `role="search"` container so it *should* work from any focused element, but the asymmetry means the Alt+C path from button focus is untested.

**Fix:** Add a symmetric assertion for `fireEvent.keyDown(regexToggle, { key: "c", code: "KeyC", altKey: true })`.

---

### M3: Late-result guard may misapply results after valid query change
**File:** `src/components/TerminalView.tsx:175-182`  
**Issue:** The `onDidChangeResults` guard checks the *current* query/regex state:
```ts
const query = searchQueryRef.current;
if (query === "" || !queryCompiles(query, useRegexRef.current)) return;
setSearchResult(result);
```
If the user types "foo" → results arrive → quickly types "bar" → "foo" results arrive late, the guard sees "bar" compiles and applies "foo" results to "bar". The addon-search library likely only emits for the latest search, but this isn't documented or tested.

**Risk:** Stale counter/highlights could appear under rapid typing. A test with two rapid valid queries would expose this.

---

## Low Findings

### L1: `runSearch` dependency array not visible in diff
**File:** `src/components/TerminalView.tsx:98-115`  
The `useCallback` dependency array is cut off in the diff. Since it only reads refs (stable), it's likely `[]` or `[searchAddonRef]` — both correct. But not verifiable from the provided diff alone.

### L2: `searchResultsSub` cleanup not shown
**File:** `src/components/TerminalView.tsx:174-182`  
The subscription is created in the addon-mount effect. Its disposal (`searchResultsSub.dispose()`) must be in that effect's cleanup function. The diff doesn't show it; confirm it exists in the unchanged portion.

### L3: No visual regression test for contrast ring
**File:** `scripts/contrast-check.mjs:52`  
The gate passes/fails on CI, but there's no screenshot test verifying the ring is visible and correctly styled in both themes. A Storybook/Playwright snapshot would catch CSS regressions the numeric gate misses (e.g., ring hidden by `overflow: hidden`).

### L4: German strings hardcoded in component
**File:** `src/components/TerminalView.tsx:213, 241, 251, 263`  
Strings like "Groß- und Kleinschreibung beachten", "Regulärer Ausdruck", "Ungültiger regulärer Ausdruck" are inline. The requirements state "The UI language is German", so this may be intentional. If i18n is added later, these will need extraction.

---

## Verified Fixes (from first review)
| Finding | Status | Evidence |
|---------|--------|----------|
| F-1: `event.code` for Alt keys | ✅ Fixed | Lines 198-206 use `event.code === "KeyC"/"KeyR"` |
| F-2: Regex error-path tests | ✅ Fixed | 4 tests cover invalid regex (lines 396-416, 451-468, 470-486, 488-504) |
| F-3: Regex debounce | ⏸ Deferred | Documented as follow-up |
| F-4: Contrast ring + gate row | ✅ Fixed | CSS ring (293-297) + gate (contrast-check.mjs:52) |
| F-5: Flex-wrap | ✅ Fixed | `flex-wrap: wrap` (styles.css:279) |
| F-6: Late-result guard | ✅ Fixed | `onDidChangeResults` guard (175-182) + 2 tests (506-533) |
| F-7: ARIA pressed/label | ✅ Fixed | `aria-pressed`, `aria-label`, `role="status"` (241-256, 262) |
| F-8: Control bytes to PTY | ✅ Fixed | `event.preventDefault()` on Alt combos (200, 203) |

---

## Test Quality Assessment
The test suite is **thorough** — 13 new tests covering:
- Toggle propagation to addon options
- Incremental re-search on toggle
- State persistence across close/reopen
- Invalid regex rejection + error hint
- Keyboard shortcuts (Alt+C/R) from input & button
- Layout independence via `event.code`
- Regex-off recovery from invalid pattern
- Enter/navigation buttons blocked on invalid regex
- Decoration/counter clearing on invalid regex
- Late-result guard for invalid regex & empty query
- Enter uses new options after toggle

**No vacuous passes detected** — each test asserts specific mock calls and DOM state.

---

## Final Verdict
**Approve with medium fixes** — M1 (contrast gate accuracy) and M2 (missing keyboard test) should be addressed before merge. M3 is a theoretical edge case; add a test if the addon's behavior isn't guaranteed.
