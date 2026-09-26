# Disposition PR #27 (W1-21d) — review stage B

- Candidate: `1eddf1c` (PR head at review time) plus the delta named below.
- Author: Claude/Kimi lineage (ported); stage-A reviewer: Claude Sonnet
  (`.pa/review_w1-21d_sonnet.md`, `.pa/review_w1-21d_disposition.md`).
- Stage-B reviewer: NVIDIA Nemotron 3 Ultra 550B (`kilo run -m
  kilo/nvidia/nemotron-3-ultra-550b-a55b:free`, read-only), protocol
  unchanged in `.pa/review_pr27_nemotron-3-ultra.md`, prompt in
  `.pa/review_prompt_pr27.md`.
- Verdict of the reviewer: approve; M1 and M2 to fix before merge, M3
  theoretical. No high findings. The reviewer's line numbers do not match the
  files (it saw the diff only); its "Verified Fixes" table mislabels the
  stage-A finding numbers (F-4..F-8) — noted, no consequence.

## M1 — contrast gate checks the ring against Karte only (medium) — ACCEPTED (partly)

- Claim: the ring sits on `accent-tint`, not on `Karte`; the gate row may not
  match the rendered state.
- Check: half right. The search bar background is `--color-elevated` (= the
  gate's "Karte"), so the ring's *outer* neighbour is exactly what the row
  checks. But the ring is an inset 1px line on the button edge; its *inner*
  neighbour is the tint composed over the bar, which the gate did not cover.
  Measured with the repo's own maths: dark 4.15:1, light 6.13:1 — both above
  3:1, so the claim "could fail in one theme" does not hold today; the
  coverage gap is real.
- Change: second non-text row `accent-text / Tint auf Karte` in
  `scripts/contrast-check.mjs`. `npm run contrast` exit=0, 104 pairings
  (was 102). Not red-first-capable: the new row passes on the current
  palette, there is no failing state to demonstrate (probe: the value 4.15
  differs from the sibling row's 5.05, so the row is live, not vacuous).
  Commit carries `No-Test:` with this reason.

## M2 — no Alt+C test from the regex toggle's focus (medium) — REJECTED

- Claim: the shortcut test exercises Alt+R from the case button but not Alt+C
  from the regex button.
- Check: the handler sits on the `role="search"` container and dispatches on
  `event.code` only; the focus target does not enter the branch condition.
  The test already fires both keys from the input and Alt+R from a button
  (bubbling proof), and the layout-independence test fires both codes. A
  fourth combination adds no branch or path.
- Reason for rejecting: no uncovered code path; symmetric assertion would be
  redundant.

## M3 — late-result guard could apply "foo" results to "bar" (medium) — REJECTED

- Claim: results for an older valid query may arrive after a newer one and be
  shown under it.
- Check: read `@xterm/addon-search@0.15.0` (`lib/addon-search.js`, pinned by
  the lockfile). `_fireResults` runs synchronously inside
  `findNext`/`findPrevious`, computed from the addon's current
  `_highlightDecorations`; the only deferred path (`onWriteParsed` →
  `_highlightTimeout`) is cleared on every new search and re-searches with
  `_cachedSearchTerm`, i.e. the latest term. A report therefore always
  describes the most recent search; an out-of-order "foo" report cannot occur.
  The guard in `onDidChangeResults` exists for the empty/uncompilable case
  (F-8), where the addon's last search was still valid.
- Reason for rejecting: the feared ordering is excluded by the addon design;
  a test would need to invent behaviour the addon does not have.

## L1 — dependency array of `runSearch` not visible in the diff (low) — REJECTED

- Check: the array is unchanged context (`[searchQuery]`, used only for the
  default parameter); `runSearch` reads options via refs. Reviewer says
  itself "likely correct". Nothing to change.

## L2 — `searchResultsSub` disposal not visible in the diff (low) — REJECTED (verified)

- Check: `grep -n searchResultsSub src/components/TerminalView.tsx` shows the
  `.dispose()` in the effect cleanup (unchanged code from before this PR).

## L3 — no visual regression test for the ring (low) — REJECTED

- Check: four inspected screenshots (`docs/audits/assets/2026-09-25-w1-21d-suche/`)
  show the ring in the dark theme, and the numeric gate now covers both
  neighbours. The repo has no screenshot-diff infrastructure; adding one is a
  separate package, not a review fix.

## L4 — German strings inline (low) — REJECTED

- Check: the whole frontend uses inline German UI strings (no i18n layer);
  the reviewer concedes it may be intentional. Out of scope.

## Result

1 accepted (M1, partly, gate row), 6 rejected with reasons (M2, M3, L1-L4).
Product code unchanged; delta is `scripts/contrast-check.mjs` plus this
protocol. The delta invalidates only the contrast evidence:

```
npm run contrast   exit=0 (104 pairings; new row 4.15:1 dark / 6.13:1 light)
```

NICHT ABGEDECKT: unchanged from the PR text (real Tauri/WebView, Linux half of
the Rust suite, Alt+C/Alt+R collision with TUIs, Regex debounce follow-up F-3).
