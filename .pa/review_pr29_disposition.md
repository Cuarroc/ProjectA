# Review disposition PR #29 (W1-10, HQ stylesheet)

Reviewer: Nemotron 3 Ultra 550B (Kilo, free model, read-only; plan agent).
Author family: Claude — the reviewer is a different family. One reviewer
(candidate is a port of an already triple-reviewed change; stage B).
Prompt: `.pa/review_prompt_pr29.md`, verbatim answer:
`.pa/review_pr29_nemotron-3-ultra.md`. Reviewed candidate: `3d6b943`.
Delta after the review: `1032013` (red) + `4185400` (green) — the delta
touches only the gate script and the browser test.

| # | Sev. | Finding | Disposition |
|---|------|---------|-------------|
| 1 | high | `--ink` not overridden in light mode, text invisible on paper | **Rejected — false premise.** `--ink` is `#12151a` (dark) in the base `:root` (`hq.css:14`) and is deliberately not flipped: it is the ink *on* `--paper`, and `--paper` is the surface that flips (`#dfe6ea` → `#ffffff`). Dark ink on white is the intended result. Evidence: the browser test asserts the paper-well focus ring is `rgb(18, 21, 26)` (`--ink`) in all four schemes, and the gate measures ink/paper pairings in all four modes (14.5:1 dark; light higher). The proposed fix `--ink: var(--fog)` would change the ink to `#2b3944` and lower the contrast for no gain. |
| 2 | med | #0066CC ban only checked with the dark token set | **Accepted, fixed.** Real hole: `--steel: #0066cc` inside the light or contrast block passed. Red `1032013` (`node --test scripts/lib/contrast-gate.test.mjs` exit 1, 2 of 3 fail), green `4185400` (exit 0, 3 of 3; `npm run contrast` exit 0). The ban now runs per mode. |
| 3 | med | `hqRuleValue`: exact selector match, last rule wins, no specificity | **Rejected (known, documented limit).** The code comment already states "last matching rule wins"; every rule-bound selector is a single-rule literal today. Failure mode is loud, not silent: a selector that stops matching throws `keine Regel …` and fails the gate. A full CSS cascade engine is out of scope for W1-10. |
| 4 | med | `borderColor` assumes `width style color` order | **Rejected.** A different order yields an unparsable colour string → `colorValue` throws `nicht lesbar` → gate fails loudly. No silent pass. |
| 5 | med | Workspace pin only tested in light mode | **Accepted, fixed** (test hardening; the code was already right). `4185400`: all four schemes, plus `--ink-2`, `--hair-strong`, `--line` (the tokens the contrast block overrides on `:root`). Mutation evidence: removing the `--ink-2` pin in `workspace.css` → test fails with `dark: --ink-2` (actual `color-mix(in srgb, #c5ced4 75%, #1c2228)`, expected `#acbabd`); file restored. |
| 6 | med | `mediaSpan` breaks on nested at-rules | **Rejected — wrong.** The function counts brace depth, so balanced nested blocks are handled; only an unbalanced block throws (`@media-Block nicht geschlossen`). Not a defect. |
| 7 | low | Hardcoded rgb/hex in browser test are brittle | **Rejected.** Pinning the rendered tokens is the purpose of the test; a design change must update them consciously. |
| 8 | low | Pairing lists are manual, no exhaustive coverage check | **Rejected for this package / known limit.** Already in the PR's NICHT ABGEDECKT and backlog (W1-12: `.lesson-badge.stale`, `.snapshot.dot`, `.matrix-cell` border). The opacity-on-text check and the rule-bound pairings cover the classes found in earlier review rounds. |
| 9 | low | `parseColorLiteral` lacks `rgb(%)`/`hsl()` | **Rejected.** Unsupported syntax throws (`nicht lesbar`), so it cannot pass silently; HQ CSS uses none. |

Reviewer's "Required changes before merge": (1) `--ink` fix — rejected (#1); (2) ban in
all modes — done (#2); (3) workspace pin assertions — done (#5); (4) documenting
fragility assumptions — rejected (#3, #4, #6, #9: fail-loud, no silent pass).

Note on the mutation run: the first full-suite mutation run showed 10
timeouts on `.live-status.ok` (machine load; the unmutated full run before
had 15/15 pass). The mutation was therefore re-run for the scheme test
alone, which gave the intended assertion failure above.
