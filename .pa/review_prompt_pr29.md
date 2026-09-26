# Review request PR #29 (W1-10): HQ stylesheet - contrast gate, light mode, prefers-contrast

You are an independent reviewer (not the author; the author is a Claude model).
Review the COMPLETE candidate below for correctness bugs, gaps against the
requirements, and regressions. Be concrete: cite file and line, say what
breaks and when. Rate each finding high/medium/low. Do not restate the diff.
If something is fine, say nothing about it. Answer in English or German.
This is a READ-ONLY review: do not modify any files, do not run commands
that write anything.

## Context

Repo: ProjectA, a Tauri 2 "agentic terminal" (public GitHub repo). The Dev HQ
is a local live web page (`docs/dev-hq/`, static pages `index.html`,
`lessons.html`, and `live.html` with its own always-dark `.hq-workspace`
scope in `workspace.css`). `docs/dev-hq/hq.css` is its stylesheet. The repo
gate `scripts/contrast-check.mjs` (`npm run contrast`) computes WCAG contrast
ratios from the CSS and fails on any pairing below 4.5:1 (text) or 3:1
(non-text). Before this change it only covered the app stylesheet
`src/styles.css`.

## Package requirement (from the plan)

W1-10: "extend `scripts/contrast-check.mjs` to `docs/dev-hq/hq.css`, light
mode, `prefers-contrast`". Acceptance: gate red -> green, screenshots
light/dark inspected. The HQ accent stays the desaturated steel blue; the
generic #0066CC is banned as accent.

What the candidate does:
- `hq.css`: text roles moved onto tokens; light mode via
  `@media (prefers-color-scheme: light)` flipping `:root`; a
  `@media (prefers-contrast: more)` block raising muted text levels and
  hairlines.
- `workspace.css`: the always-dark live desk pins the new tokens so it stays
  dark under an OS light scheme.
- `contrast-check.mjs`: a small CSS evaluator (var() resolution,
  `color-mix(in srgb, ...)`, `transparent`, alpha composition), token
  pairings in four modes (dark, light, each with prefers-contrast), plus
  "rule-bound" pairings that read the colour straight out of the rule that
  paints it, plus an opacity-on-text-container check, plus the #0066CC ban.
- `hq-visual.browser.mjs`: a Playwright test asserting computed colours and
  tokens per colour scheme and the pinned live workspace.

Things worth checking hard:
1. Is the gate's colour arithmetic right (color-mix percentage handling incl.
   sums != 100 and single percentages, premultiplied alpha, relative
   luminance, composition of translucent backgrounds over the page)?
2. Can the gate pass while the real CSS fails (parser blind spots: media
   blocks, selector matching in `hqRuleValue`, `:root` blocks, comments,
   last-rule-wins vs. specificity, `prefers-contrast` applied in modes where
   it should not be)? Can it fail spuriously?
3. Do `hq.css` and `workspace.css` actually behave as the comments claim
   (token flips in light mode, workspace pinning, focus ring on paper
   surfaces, forced-contrast overrides)? Any text/background pairing in
   `hq.css` that the gate does not cover and that is below AA?
4. Is the browser test deterministic (hardcoded rgb values, ordering,
   waits), and does it actually prove what its assertions say?

## Diff (git diff origin/main...HEAD, complete candidate)

```diff
diff --git a/docs/dev-hq/hq.css b/docs/dev-hq/hq.css
index 51af29a..63a1aa0 100644
--- a/docs/dev-hq/hq.css
+++ b/docs/dev-hq/hq.css
@@ -17,6 +17,22 @@
   --forest: #3d6b4f;
   --ember: #c46a2a;
   --ochre: #8a7040;
+  /* W1-10 contrast tokens. The base eight mix surfaces and decorations; text
+     roles go through these so every pairing stays AA in both color schemes.
+     --bright: strongest text on --ground (was: --paper in two roles).
+     --chip-ink: text on solid accent chips. --link/--*-text: the accents as
+     text on --ground. --ember-deep/--ochre-deep: the accents on light
+     surfaces (paper well) and as chip backgrounds. */
+  --bright: #dfe6ea;
+  --chip-ink: #f2f7f9;
+  --link: #7ba5c0;
+  --ochre-text: #b9a06f;
+  --ember-text: #dd8746;
+  --forest-text: #71a681;
+  --ember-deep: #8f4d1e;
+  --ochre-deep: #66522b;
+  --ok-text: #9bc5a6;
+  --err-text: #f0a17b;
   --line: color-mix(in srgb, var(--fog) 18%, transparent);
   --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
 
@@ -57,13 +73,13 @@ body {
   padding: 0.5rem 0.9rem;
   border: 1px solid var(--fog);
   background: var(--ground);
-  color: var(--paper);
+  color: var(--bright);
   text-decoration: none;
 }
 
 .skip-link:focus-visible {
   top: 0.75rem;
-  outline: 2px solid var(--paper);
+  outline: 2px solid var(--bright);
   outline-offset: 3px;
 }
 
@@ -99,7 +115,7 @@ body {
   width: 2.25rem;
   height: 2.25rem;
   margin-top: 0.1rem;
-  color: var(--paper);
+  color: var(--chip-ink);
   background: var(--steel);
   font-size: var(--step-0);
   font-weight: 700;
@@ -108,7 +124,7 @@ body {
 
 .hq-kicker {
   margin: 0 0 0.1rem;
-  color: color-mix(in srgb, var(--fog) 58%, var(--ground));
+  color: var(--ink-3);
   font-size: 10px;
   letter-spacing: 0.12em;
   line-height: 1.2;
@@ -116,7 +132,7 @@ body {
 
 .hq-bar h1 {
   margin: 0;
-  color: var(--paper);
+  color: var(--bright);
   font-size: var(--step-4);
   font-weight: 560;
   line-height: 1.1;
@@ -125,7 +141,7 @@ body {
 .hq-description {
   max-width: 44ch;
   margin: 0.25rem 0 0;
-  color: color-mix(in srgb, var(--fog) 78%, var(--ground));
+  color: var(--ink-2);
   font-size: var(--step-0);
 }
 
@@ -134,7 +150,7 @@ body {
   align-items: center;
   gap: 0.45rem;
   padding-top: 0.2rem;
-  color: color-mix(in srgb, var(--fog) 75%, var(--ground));
+  color: var(--ink-2);
   font-size: var(--step-0);
   text-align: right;
 }
@@ -173,14 +189,14 @@ body {
 }
 
 .hq-nav a:hover {
-  color: var(--steel);
+  color: var(--link);
 }
 
 .hq-nav a:focus-visible,
 .matrix-cell:focus-visible,
 .mini-dag-link:focus-visible,
 .outbound a:focus-visible {
-  outline: 2px solid var(--paper);
+  outline: 2px solid var(--bright);
   outline-offset: 3px;
 }
 
@@ -195,7 +211,7 @@ body {
   bottom: -0.95rem;
   left: 0;
   height: 2px;
-  background: var(--steel);
+  background: var(--link);
   content: "";
 }
 
@@ -278,7 +294,7 @@ body {
   border: 1px solid color-mix(in srgb, var(--fog) 28%, transparent);
   border-radius: 2px;
   background: var(--ground);
-  color: var(--paper);
+  color: var(--bright);
   font: inherit;
 }
 
@@ -287,7 +303,7 @@ body {
   border: 1px solid color-mix(in srgb, var(--steel) 65%, var(--fog));
   border-radius: 2px;
   background: color-mix(in srgb, var(--steel) 28%, var(--ground));
-  color: var(--paper);
+  color: var(--bright);
   font: inherit;
   cursor: pointer;
   transition: background 160ms ease, transform 160ms ease;
@@ -302,7 +318,7 @@ body {
 .live-action-row input:focus-visible,
 .live-action-row select:focus-visible,
 .verdict-details input:focus-visible {
-  outline: 2px solid var(--paper);
+  outline: 2px solid var(--bright);
   outline-offset: 3px;
 }
 
@@ -311,10 +327,10 @@ body {
   font-size: var(--step-0);
 }
 
-.live-status.ok { color: #9bc5a6; }
-.live-status.pending { color: var(--ochre); }
+.live-status.ok { color: var(--ok-text); }
+.live-status.pending { color: var(--ochre-text); }
 .live-status.error,
-.live-error { color: #f0a17b; }
+.live-error { color: var(--err-text); }
 
 .live-error {
   margin: 0 0 1rem;
@@ -342,20 +358,20 @@ body {
 
 .analysis-head h2 {
   margin: 0.1rem 0 0.2rem;
-  color: var(--paper);
+  color: var(--bright);
   font-size: var(--step-2);
 }
 
 .analysis-head .muted,
 .analysis-head time {
   margin: 0;
-  color: color-mix(in srgb, var(--fog) 72%, var(--ground));
+  color: var(--ink-2);
   font-size: var(--step-0);
 }
 
 .eyebrow {
   margin: 0;
-  color: var(--ochre);
+  color: var(--ochre-text);
   font-size: 10px;
   letter-spacing: 0.14em;
 }
@@ -378,7 +394,7 @@ body {
 
 .analysis-metric strong {
   overflow: hidden;
-  color: var(--paper);
+  color: var(--bright);
   font-size: clamp(1.15rem, 2vw, 1.7rem);
   font-weight: 560;
   text-overflow: ellipsis;
@@ -392,7 +408,7 @@ body {
 }
 
 .analysis-metric small {
-  color: color-mix(in srgb, var(--fog) 62%, var(--ground));
+  color: var(--ink-3);
 }
 
 .analysis-progress {
@@ -405,12 +421,12 @@ body {
 .analysis-progress span {
   display: block;
   height: 100%;
-  background: var(--steel);
+  background: var(--link);
 }
 
 .analysis-basis {
   margin: 0.6rem 0 0;
-  color: color-mix(in srgb, var(--fog) 62%, var(--ground));
+  color: var(--ink-3);
   font-size: 11px;
 }
 
@@ -434,7 +450,7 @@ body {
 .live-card h2,
 .live-actions h2 {
   margin: 0 0 0.75rem;
-  color: var(--paper);
+  color: var(--bright);
   font-size: var(--step-2);
 }
 
@@ -465,13 +481,13 @@ body {
   white-space: nowrap;
 }
 
-.live-row strong { color: var(--paper); }
-.live-row span { color: color-mix(in srgb, var(--fog) 72%, var(--ground)); font-size: var(--step-0); }
+.live-row strong { color: var(--bright); }
+.live-row span { color: var(--ink-2); font-size: var(--step-0); }
 
 .live-badge {
   flex: 0 0 auto;
   padding: 0.2rem 0.4rem;
-  color: var(--paper) !important;
+  color: var(--chip-ink) !important;
   font-size: 11px !important;
   letter-spacing: 0.04em;
   text-transform: uppercase;
@@ -479,8 +495,8 @@ body {
 
 .live-badge.working { background: var(--steel); }
 .live-badge.needs_you,
-.live-badge.ready_to_merge { background: var(--ember); }
-.live-badge.in_review { background: var(--ochre); }
+.live-badge.ready_to_merge { background: var(--ember-deep); }
+.live-badge.in_review { background: var(--ochre-deep); }
 .live-badge.done,
 .live-badge.exited { background: var(--forest); }
 
@@ -493,7 +509,7 @@ body {
   font-size: var(--step-0);
 }
 
-.activity-row time { color: var(--ochre); }
+.activity-row time { color: var(--ochre-text); }
 
 .live-actions {
   margin-top: 1rem;
@@ -534,7 +550,7 @@ body {
 
 .chart-table summary {
   cursor: pointer;
-  color: var(--steel);
+  color: var(--link);
 }
 
 .chart-table table {
@@ -567,7 +583,7 @@ body {
 
 .team-group h3 {
   margin: 0.35rem 0 0;
-  color: var(--ochre);
+  color: var(--ochre-text);
   font-size: 10px;
   font-weight: 600;
   letter-spacing: 0.14em;
@@ -597,7 +613,7 @@ body {
 .team-form label {
   display: grid;
   gap: 0.3rem;
-  color: color-mix(in srgb, var(--fog) 80%, var(--ground));
+  color: var(--ink-2);
   font-size: var(--step-0);
 }
 
@@ -609,10 +625,10 @@ body {
 .team-form textarea,
 .team-form select {
   padding: 0.55rem 0.65rem;
-  border: 1px solid color-mix(in srgb, var(--fog) 28%, transparent);
+  border: 1px solid var(--hair-strong);
   border-radius: 2px;
   background: var(--ground);
-  color: var(--paper);
+  color: var(--bright);
   font: inherit;
 }
 
@@ -626,7 +642,7 @@ body {
 .team-form input:focus-visible,
 .team-form textarea:focus-visible,
 .team-form select:focus-visible {
-  outline: 2px solid var(--paper);
+  outline: 2px solid var(--bright);
   outline-offset: 3px;
 }
 
@@ -647,13 +663,13 @@ body {
   border: 1px solid color-mix(in srgb, var(--fog) 22%, transparent);
   border-radius: 2px;
   background: color-mix(in srgb, var(--ground) 70%, transparent);
-  color: var(--paper);
+  color: var(--bright);
   font: inherit;
   font-size: var(--step-0);
 }
 
 .fleet-filter:focus-visible {
-  outline: 2px solid var(--paper);
+  outline: 2px solid var(--bright);
   outline-offset: 3px;
 }
 
@@ -670,7 +686,7 @@ body {
 }
 
 .fleet-row:focus-visible {
-  outline: 2px solid var(--paper);
+  outline: 2px solid var(--bright);
   outline-offset: 3px;
 }
 
@@ -708,7 +724,7 @@ body {
 }
 
 .detail-fact span {
-  color: color-mix(in srgb, var(--fog) 60%, var(--ground));
+  color: var(--ink-3);
   font-size: 10px;
   letter-spacing: 0.08em;
   text-transform: uppercase;
@@ -716,7 +732,7 @@ body {
 
 .detail-fact strong {
   overflow: hidden;
-  color: var(--paper);
+  color: var(--bright);
   font-size: var(--step-0);
   font-weight: 560;
   text-overflow: ellipsis;
@@ -742,7 +758,7 @@ body {
 
 .detail-msg span {
   margin-right: 0.5rem;
-  color: var(--ochre);
+  color: var(--ochre-text);
   font-size: 10px;
   letter-spacing: 0.1em;
   text-transform: uppercase;
@@ -812,7 +828,7 @@ code {
 .meta {
   margin: 0 0 0.35rem;
   font-size: var(--step-0);
-  color: color-mix(in srgb, var(--fog) 78%, var(--ground));
+  color: var(--ink-2);
 }
 
 .chip {
@@ -846,7 +862,7 @@ code {
 .summary-item strong {
   grid-row: span 2;
   align-self: center;
-  color: var(--paper);
+  color: var(--bright);
   font-size: var(--step-3);
   font-weight: 560;
   line-height: 1;
@@ -858,7 +874,7 @@ code {
 }
 
 .summary-item small {
-  color: color-mix(in srgb, var(--fog) 58%, var(--ground));
+  color: var(--ink-2);
   font-size: 10px;
 }
 
@@ -873,14 +889,14 @@ code {
 
 .section-title h2 {
   margin: 0 0 0.35rem;
-  color: var(--paper);
+  color: var(--bright);
   font-size: var(--step-2);
   font-weight: 560;
 }
 
 .section-title p {
   margin: 0 0 0.35rem;
-  color: color-mix(in srgb, var(--fog) 62%, var(--ground));
+  color: var(--ink-3);
   font-size: var(--step-0);
 }
 
@@ -924,21 +940,21 @@ code {
 }
 
 .signal-list strong {
-  color: var(--paper);
+  color: var(--bright);
   font-size: var(--step-0);
   font-weight: 560;
 }
 
 .signal-list div span {
   overflow: hidden;
-  color: color-mix(in srgb, var(--fog) 65%, var(--ground));
+  color: var(--ink-3);
   font-size: 11px;
   text-overflow: ellipsis;
   white-space: nowrap;
 }
 
 .signal-list em {
-  color: color-mix(in srgb, var(--fog) 58%, var(--ground));
+  color: var(--ink-3);
   font-size: 10px;
   font-style: normal;
   text-transform: uppercase;
@@ -956,25 +972,25 @@ code {
 }
 
 .muted {
-  color: color-mix(in srgb, var(--fog) 58%, var(--ground));
+  color: var(--ink-3);
 }
 
 .brief-copy {
   max-width: 52ch;
   margin: 0.75rem 0;
-  color: color-mix(in srgb, var(--fog) 78%, var(--ground));
+  color: var(--ink-2);
   font-size: var(--step-0);
 }
 
 .text-link {
-  color: var(--paper);
+  color: var(--bright);
   font-size: var(--step-0);
   text-decoration-color: color-mix(in srgb, var(--steel) 75%, transparent);
   text-underline-offset: 0.2em;
 }
 
 .text-link:hover {
-  color: var(--steel);
+  color: var(--link);
 }
 
 /* Paper well — next-grip only */
@@ -1011,7 +1027,7 @@ code {
 .lane-figure figcaption {
   margin: 0 0 0.4rem;
   font-size: var(--step-0);
-  color: color-mix(in srgb, var(--fog) 72%, var(--ground));
+  color: var(--ink-2);
 }
 
 #lane {
@@ -1029,7 +1045,7 @@ code {
 }
 
 .lane-label {
-  fill: color-mix(in srgb, var(--fog) 70%, var(--ground));
+  fill: var(--ink-2);
   font-size: 11px;
   font-family: Recursive, ui-sans-serif, system-ui, sans-serif;
   letter-spacing: 0.04em;
@@ -1075,8 +1091,8 @@ code {
 
 /* Ember — serial lock only */
 .lock {
-  color: var(--ember);
-  fill: var(--ember);
+  color: var(--ember-text);
+  fill: var(--ember-text);
   animation: hq-lock 180ms ease-out;
 }
 
@@ -1088,7 +1104,7 @@ code {
 
 .lock-label,
 .lock-owner {
-  fill: var(--ember);
+  fill: var(--ember-text);
   font-size: 10px;
   font-family: Recursive, ui-monospace, monospace;
 }
@@ -1117,7 +1133,7 @@ code {
 }
 
 .spec-table th {
-  color: color-mix(in srgb, var(--fog) 75%, var(--ground));
+  color: var(--ink-2);
   font-weight: 500;
 }
 
@@ -1132,11 +1148,11 @@ code {
 }
 
 .readiness.ready {
-  color: var(--forest);
+  color: var(--forest-text);
 }
 
 .readiness.locked {
-  color: var(--ember);
+  color: var(--ember-text);
 }
 
 .spec-table .path,
@@ -1176,7 +1192,7 @@ code {
 .dag-figure figcaption {
   margin: 0 0 0.4rem;
   font-size: var(--step-0);
-  color: color-mix(in srgb, var(--fog) 72%, var(--ground));
+  color: var(--ink-2);
 }
 
 .dag-svg {
@@ -1251,7 +1267,7 @@ code {
   align-items: center;
   gap: 0.65rem 1rem;
   margin: -0.55rem 0 1.25rem;
-  color: color-mix(in srgb, var(--fog) 72%, var(--ground));
+  color: var(--ink-2);
   font-size: var(--step-0);
 }
 
@@ -1283,7 +1299,7 @@ code {
 }
 
 .legend-note {
-  color: color-mix(in srgb, var(--fog) 52%, var(--ground));
+  color: var(--ink-3);
 }
 
 .package-table-wrap {
@@ -1298,15 +1314,15 @@ code {
 }
 
 .package-state.done {
-  color: var(--steel);
+  color: var(--link);
 }
 
 .package-state.active {
-  color: var(--ember);
+  color: var(--ember-text);
 }
 
 .package-state.waiting {
-  color: color-mix(in srgb, var(--fog) 66%, var(--ground));
+  color: var(--ink-3);
 }
 
 .dag-svg.mini .dag-label {
@@ -1355,14 +1371,14 @@ code {
   margin: 0 0 1rem;
   padding: 0.7rem 0.85rem;
   border: 1px solid var(--line);
-  color: color-mix(in srgb, var(--fog) 82%, var(--ground));
+  color: var(--ink-2);
   font-size: var(--step-0);
 }
 
 .proof-intro strong,
 .next-lead strong,
 .source-callout strong {
-  color: var(--paper);
+  color: var(--bright);
   font-weight: 600;
 }
 
@@ -1378,15 +1394,15 @@ code {
 .finding .cite {
   grid-column: 1 / -1;
   font-family: Recursive, ui-monospace, monospace;
-  color: color-mix(in srgb, var(--fog) 70%, var(--ground));
+  color: var(--ink-3);
 }
 
 .finding.fact .finding-klass {
-  color: var(--steel);
+  color: var(--link);
 }
 
 .finding.claim .finding-klass {
-  color: var(--ochre);
+  color: var(--ochre-text);
 }
 
 .next-timeline {
@@ -1401,7 +1417,7 @@ code {
 }
 
 .next-node:first-child .next-mark {
-  color: var(--forest);
+  color: var(--forest-text);
   font-weight: 600;
 }
 
@@ -1416,7 +1432,7 @@ code {
 }
 
 .next-node.locked .next-mark {
-  color: var(--ember);
+  color: var(--ember-text);
 }
 
 .next-mark,
@@ -1431,7 +1447,7 @@ code {
 .next-why {
   margin: 0 0 0.25rem;
   font-size: var(--step-0);
-  color: color-mix(in srgb, var(--fog) 88%, var(--ground));
+  color: var(--ink-2);
 }
 
 .outbound {
@@ -1442,7 +1458,7 @@ code {
 }
 
 .outbound a {
-  color: var(--steel);
+  color: var(--link);
 }
 
 .unproven {
@@ -1708,7 +1724,7 @@ code {
   align-items: center;
   gap: 0.6rem 0.9rem;
   cursor: pointer;
-  color: var(--paper);
+  color: var(--bright);
   list-style: none;
 }
 
@@ -1716,7 +1732,7 @@ code {
 
 .setup-summary::before {
   content: "▸";
-  color: var(--ochre);
+  color: var(--ochre-text);
   transition: transform 160ms var(--ease-out);
 }
 
@@ -1734,12 +1750,12 @@ code {
   font-size: 10px;
   letter-spacing: 0.1em;
   text-transform: uppercase;
-  color: var(--paper);
+  color: var(--chip-ink);
 }
 
 .setup-pill.ok { background: var(--forest); }
-.setup-pill.warn { background: var(--ochre); }
-.setup-pill.fail { background: var(--ember); }
+.setup-pill.warn { background: var(--ochre-deep); }
+.setup-pill.fail { background: var(--ember-deep); }
 
 .setup-list {
   display: grid;
@@ -1766,8 +1782,8 @@ code {
   min-width: 0;
 }
 
-.setup-row strong { color: var(--paper); font-weight: 560; }
-.setup-row span { color: color-mix(in srgb, var(--fog) 72%, var(--ground)); }
+.setup-row strong { color: var(--bright); font-weight: 560; }
+.setup-row span { color: var(--ink-2); }
 
 .setup-state {
   width: 0.6rem;
@@ -1797,7 +1813,7 @@ code {
   padding: 0.3rem 0.45rem;
   border-left: 2px solid var(--ochre);
   background: color-mix(in srgb, var(--ground) 55%, transparent);
-  color: var(--paper);
+  color: var(--bright);
   font-size: 12px;
 }
 
@@ -1805,7 +1821,7 @@ code {
   margin: 0.5rem 0 0;
   padding: 0.6rem 0.75rem;
   border: 1px dashed color-mix(in srgb, var(--fog) 25%, transparent);
-  color: var(--paper);
+  color: var(--bright);
   font-size: 12px;
   font-family: Recursive, ui-monospace, monospace;
 }
@@ -1844,7 +1860,7 @@ code {
   justify-content: space-between;
   gap: 0.5rem;
   margin: 0 0 0.5rem;
-  color: var(--ochre);
+  color: var(--ochre-text);
   font-size: 10px;
   font-weight: 600;
   letter-spacing: 0.14em;
@@ -1852,7 +1868,7 @@ code {
 }
 
 .stat-title em {
-  color: var(--paper);
+  color: var(--bright);
   font-style: normal;
   font-size: var(--step-1);
   letter-spacing: 0;
@@ -1860,7 +1876,7 @@ code {
 
 .stat-foot {
   margin: 0.4rem 0 0;
-  color: color-mix(in srgb, var(--fog) 62%, var(--ground));
+  color: var(--ink-3);
   font-size: 11px;
 }
 
@@ -1878,7 +1894,7 @@ code {
 
 .stat-tile strong {
   overflow: hidden;
-  color: var(--paper);
+  color: var(--bright);
   font-size: clamp(1.1rem, 1.8vw, 1.5rem);
   font-weight: 560;
   font-variant-numeric: tabular-nums;
@@ -1892,7 +1908,7 @@ code {
   color: var(--fog);
 }
 
-.stat-tile small { color: color-mix(in srgb, var(--fog) 62%, var(--ground)); }
+.stat-tile small { color: var(--ink-3); }
 
 .spark {
   display: block;
@@ -1900,11 +1916,11 @@ code {
   height: auto;
 }
 
-.spark-bar { fill: var(--steel); }
+.spark-bar { fill: var(--link); }
 .spark-bar.empty { fill: color-mix(in srgb, var(--fog) 14%, transparent); }
 
 .spark-axis {
-  fill: color-mix(in srgb, var(--fog) 62%, var(--ground));
+  fill: var(--ink-3);
   font-size: 9px;
   font-family: Recursive, ui-monospace, monospace;
 }
@@ -1939,16 +1955,18 @@ code {
 .stat-bar-fill {
   display: block;
   height: 100%;
-  background: var(--steel);
+  background: var(--link);
 }
 
-.stat-bar-fill.FACT, .stat-bar-fill.startable, .stat-bar-fill.done { background: var(--forest); }
-.stat-bar-fill.CLAIM, .stat-bar-fill.in_review { background: var(--ochre); }
-.stat-bar-fill.locked, .stat-bar-fill.needs_you, .stat-bar-fill.ready_to_merge { background: var(--ember); }
+/* The fill is the only carrier of the bucket, so it must hold 3:1 on the
+   track: the text-role accents do, the raw decoration accents do not. */
+.stat-bar-fill.FACT, .stat-bar-fill.startable, .stat-bar-fill.done { background: var(--forest-text); }
+.stat-bar-fill.CLAIM, .stat-bar-fill.in_review { background: var(--ochre-text); }
+.stat-bar-fill.locked, .stat-bar-fill.needs_you, .stat-bar-fill.ready_to_merge { background: var(--ember-text); }
 
 .stat-bar-value {
   text-align: right;
-  color: var(--paper);
+  color: var(--bright);
   font-variant-numeric: tabular-nums;
 }
 
@@ -1980,7 +1998,7 @@ code {
 }
 
 .lesson-tag em {
-  color: var(--ochre);
+  color: var(--ochre-text);
   font-style: normal;
 }
 
@@ -1988,7 +2006,7 @@ code {
 .lesson-tag.active {
   border-color: var(--steel);
   background: color-mix(in srgb, var(--steel) 22%, transparent);
-  color: var(--paper);
+  color: var(--bright);
 }
 
 .lesson-row {
@@ -2009,13 +2027,13 @@ code {
 }
 
 .lesson-head strong {
-  color: var(--paper);
+  color: var(--bright);
   font-weight: 560;
 }
 
 .lesson-meta {
   flex: 0 0 auto;
-  color: color-mix(in srgb, var(--fog) 62%, var(--ground));
+  color: var(--ink-3);
   font-size: 11px;
 }
 
@@ -2027,7 +2045,7 @@ code {
 }
 
 .lesson-row p em {
-  color: var(--ochre);
+  color: var(--ochre-text);
   font-size: 10px;
   font-style: normal;
   letter-spacing: 0.12em;
@@ -2036,7 +2054,7 @@ code {
 }
 
 .lesson-row code {
-  color: var(--paper);
+  color: var(--bright);
 }
 
 .lesson-foot {
@@ -2057,7 +2075,7 @@ code {
 .lesson-taglist span {
   padding: 0.1rem 0.4rem;
   background: color-mix(in srgb, var(--steel) 22%, transparent);
-  color: var(--paper);
+  color: var(--bright);
   font-size: 10px;
   letter-spacing: 0.06em;
 }
@@ -2069,7 +2087,7 @@ code {
 
 .lesson-add summary {
   cursor: pointer;
-  color: var(--paper);
+  color: var(--bright);
 }
 
 .lesson-add .team-form {
@@ -2117,7 +2135,7 @@ code {
   padding: 0.45rem 0.6rem;
   border: 1px solid color-mix(in srgb, var(--fog) 22%, transparent);
   background: color-mix(in srgb, var(--ground) 70%, transparent);
-  color: var(--paper);
+  color: var(--bright);
   font: inherit;
   font-size: var(--step-0);
 }
@@ -2129,19 +2147,23 @@ code {
   font-size: 10px;
   letter-spacing: 0.1em;
   text-transform: uppercase;
-  color: var(--paper);
+  /* tinted badges sit on a scheme-tinted ground, so their text flips with
+     the scheme; the three solid variants pin --chip-ink instead. */
+  color: var(--bright);
   background: color-mix(in srgb, var(--fog) 25%, transparent);
 }
 
-.lesson-badge.proven { background: var(--forest); }
-.lesson-badge.recurring { background: var(--steel); }
-.lesson-badge.disputed { background: var(--ember); }
+.lesson-badge.proven { background: var(--forest); color: var(--chip-ink); }
+.lesson-badge.recurring { background: var(--steel); color: var(--chip-ink); }
+.lesson-badge.disputed { background: var(--ember-deep); color: var(--chip-ink); }
 .lesson-badge.stale { background: color-mix(in srgb, var(--ochre) 70%, var(--ground)); }
 .lesson-badge.new { background: color-mix(in srgb, var(--fog) 30%, var(--ground)); }
 
 .lesson-row.badge-proven { border-left-color: var(--forest); }
 .lesson-row.badge-disputed { border-left-color: var(--ember); }
-.lesson-row.badge-stale { border-left-color: color-mix(in srgb, var(--fog) 35%, transparent); opacity: 0.85; }
+/* No opacity here: it would blend every text colour of the card toward the
+   page and the gate cannot measure that. The stale mark is the rail alone. */
+.lesson-row.badge-stale { border-left-color: color-mix(in srgb, var(--fog) 35%, transparent); }
 
 .lesson-conf {
   position: relative;
@@ -2165,18 +2187,18 @@ code {
 .lesson-conf b {
   position: relative;
   font-weight: 560;
-  color: var(--paper);
+  color: var(--bright);
   white-space: nowrap;
 }
 
 .lesson-id {
-  color: color-mix(in srgb, var(--fog) 62%, var(--ground));
+  color: var(--ink-3);
 }
 
 .lesson-row mark {
   padding: 0 0.1em;
   background: color-mix(in srgb, var(--ochre) 45%, transparent);
-  color: var(--paper);
+  color: var(--bright);
 }
 
 .lesson-actions {
@@ -2190,7 +2212,7 @@ code {
 
 .lesson-history {
   font-size: 11px;
-  color: color-mix(in srgb, var(--fog) 72%, var(--ground));
+  color: var(--ink-2);
 }
 
 .lesson-history summary { cursor: pointer; }
@@ -2233,14 +2255,14 @@ code {
 }
 
 .known-fix strong {
-  color: var(--paper);
+  color: var(--bright);
   font-weight: 560;
   white-space: normal !important;
 }
 
 .known-fix code {
   grid-column: 2;
-  color: var(--paper);
+  color: var(--bright);
 }
 
 .known-fix .hq-button { grid-row: 1 / span 2; }
@@ -2270,9 +2292,12 @@ code {
 
 :root {
   --hair: color-mix(in srgb, var(--fog) 14%, transparent);
-  --hair-strong: color-mix(in srgb, var(--fog) 26%, transparent);
-  --ink-2: color-mix(in srgb, var(--fog) 68%, var(--ground));
-  --ink-3: color-mix(in srgb, var(--fog) 50%, var(--ground));
+  /* 45% is the threshold where the line reaches 3:1 on --ground. */
+  --hair-strong: color-mix(in srgb, var(--fog) 45%, transparent);
+  /* --ink-2/--ink-3: the two permitted muted text levels; both stay >= 4.5:1
+     on --ground. Lower percentages than these fail the contrast gate. */
+  --ink-2: color-mix(in srgb, var(--fog) 75%, var(--ground));
+  --ink-3: color-mix(in srgb, var(--fog) 62%, var(--ground));
   --well: color-mix(in srgb, var(--paper) 3.5%, transparent);
 }
 
@@ -2310,7 +2335,7 @@ code {
 .hq-button.subtle:hover {
   border-color: var(--fog);
   background: color-mix(in srgb, var(--fog) 8%, transparent);
-  color: var(--paper);
+  color: var(--bright);
 }
 
 #live-keys { min-width: 2.4rem; padding-inline: 0.5rem; }
@@ -2321,7 +2346,7 @@ code {
   font-size: var(--step-0);
 }
 
-.keys-help b { color: var(--paper); font-weight: 560; margin-right: 0.5rem; }
+.keys-help b { color: var(--bright); font-weight: 560; margin-right: 0.5rem; }
 
 .keys-help kbd {
   display: inline-block;
@@ -2330,7 +2355,7 @@ code {
   border: 1px solid var(--hair-strong);
   border-bottom-width: 2px;
   border-radius: 3px;
-  color: var(--paper);
+  color: var(--bright);
   font-family: Recursive, ui-monospace, monospace;
   font-size: 11px;
   text-align: center;
@@ -2353,7 +2378,7 @@ code {
 }
 
 .desk-num {
-  color: var(--ochre);
+  color: var(--ochre-text);
   font-family: Recursive, ui-monospace, monospace;
   font-variation-settings: "MONO" 1;
   font-size: var(--step-0);
@@ -2362,7 +2387,7 @@ code {
 
 .desk-head h2 {
   margin: 0;
-  color: var(--paper);
+  color: var(--bright);
   font-size: var(--step-3);
   font-weight: 480;
   letter-spacing: -0.005em;
@@ -2387,7 +2412,7 @@ code {
 
 .desk-section.paper .desk-head h2 { color: var(--ink); }
 .desk-section.paper .desk-head p { color: color-mix(in srgb, var(--ink) 70%, var(--paper)); }
-.desk-section.paper .desk-num { color: var(--ember); }
+.desk-section.paper .desk-num { color: var(--ember-deep); }
 
 .signals {
   margin: 0;
@@ -2407,7 +2432,7 @@ code {
 .signal:first-child { border-top: 0; }
 
 .signal-index {
-  color: color-mix(in srgb, var(--ink) 45%, transparent);
+  color: color-mix(in srgb, var(--ink) 62%, transparent);
   font-family: Recursive, ui-monospace, monospace;
   font-variation-settings: "MONO" 1;
   font-size: var(--step-0);
@@ -2420,14 +2445,14 @@ code {
   font-weight: 700;
 }
 
-.signal.act .signal-level { color: var(--ember); }
+.signal.act .signal-level { color: var(--ember-deep); }
 .signal.watch .signal-level { color: color-mix(in srgb, var(--ochre) 80%, var(--ink)); }
-.signal.note .signal-level { color: color-mix(in srgb, var(--ink) 55%, transparent); }
+.signal.note .signal-level { color: color-mix(in srgb, var(--ink) 70%, transparent); }
 
 .signal > div { display: grid; gap: 0.1rem; min-width: 0; }
 .signal strong { font-weight: 560; color: var(--ink); }
-.signal.act strong { color: color-mix(in srgb, var(--ember) 75%, var(--ink)); }
-.signal span:not(.signal-index):not(.signal-level) { color: color-mix(in srgb, var(--ink) 68%, var(--paper)); font-size: var(--step-0); }
+.signal.act strong { color: color-mix(in srgb, var(--ember-deep) 80%, var(--ink)); }
+.signal span:not(.signal-index):not(.signal-level) { color: color-mix(in srgb, var(--ink) 70%, var(--paper)); font-size: var(--step-0); }
 
 .desk-section.paper .hq-button.subtle {
   border-color: color-mix(in srgb, var(--ink) 30%, transparent);
@@ -2454,7 +2479,7 @@ code {
 
 .figure-label {
   margin: 0.6rem 0 0.35rem;
-  color: var(--ochre);
+  color: var(--ochre-text);
   font-size: 10px;
   font-weight: 600;
   letter-spacing: 0.14em;
@@ -2471,7 +2496,7 @@ code {
 
 .figure-value strong {
   overflow: hidden;
-  color: var(--paper);
+  color: var(--bright);
   font-size: clamp(1.8rem, 3.2vw, 2.6rem);
   font-weight: 300;
   font-variant-numeric: tabular-nums;
@@ -2506,7 +2531,7 @@ code {
   height: auto;
 }
 
-.heat-cell { fill: var(--steel); }
+.heat-cell { fill: var(--link); }
 .heat-axis { fill: var(--ink-3); font-size: 8px; font-family: Recursive, ui-monospace, monospace; }
 
 /* Insights: stats + analysis lose their boxes */
@@ -2579,14 +2604,14 @@ code {
 .live-card h2,
 .live-actions h2 {
   margin: 0 0 0.6rem;
-  color: var(--ochre);
+  color: var(--ochre-text);
   font-size: 10px;
   font-weight: 600;
   letter-spacing: 0.14em;
   text-transform: uppercase;
 }
 
-.live-actions .desk-head h2 { font-size: var(--step-3); font-weight: 480; letter-spacing: -0.005em; text-transform: none; color: var(--paper); }
+.live-actions .desk-head h2 { font-size: var(--step-3); font-weight: 480; letter-spacing: -0.005em; text-transform: none; color: var(--bright); }
 
 .live-list { gap: 0; }
 
@@ -2613,11 +2638,11 @@ code {
 }
 
 .live-badge.working { background: transparent; color: var(--fog) !important; box-shadow: inset 0 0 0 1px var(--hair-strong); }
-.live-badge.in_review { background: transparent; color: var(--ochre) !important; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ochre) 55%, transparent); }
+.live-badge.in_review { background: transparent; color: var(--ochre-text) !important; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ochre) 55%, transparent); }
 .live-badge.done,
-.live-badge.exited { background: transparent; color: color-mix(in srgb, var(--forest) 70%, var(--fog)) !important; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--forest) 55%, transparent); }
+.live-badge.exited { background: transparent; color: color-mix(in srgb, var(--forest-text) 70%, var(--fog)) !important; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--forest) 55%, transparent); }
 .live-badge.needs_you,
-.live-badge.ready_to_merge { background: var(--ember); color: var(--paper) !important; }
+.live-badge.ready_to_merge { background: var(--ember-deep); color: var(--chip-ink) !important; }
 
 .fleet-filter {
   margin: 0 0 0.5rem;
@@ -2628,7 +2653,7 @@ code {
   padding-inline: 0.1rem;
 }
 
-.fleet-filter:focus-visible { border-bottom-color: var(--paper); }
+.fleet-filter:focus-visible { border-bottom-color: var(--bright); }
 
 .activity-row { border-bottom: 0; border-top: 1px solid var(--hair); padding: 0.45rem 0.1rem; }
 .activity-row:first-child { border-top: 0; }
@@ -2686,7 +2711,7 @@ code {
 
 .live-action-row input:focus-visible,
 .live-action-row select:focus-visible,
-.verdict-details input:focus-visible { border-bottom-color: var(--paper); }
+.verdict-details input:focus-visible { border-bottom-color: var(--bright); }
 
 /* Entrance: sections rise, not every card */
 .live-ready .live-card { animation: none; }
@@ -2739,3 +2764,65 @@ code {
   white-space: normal;
   text-overflow: clip;
 }
+
+/* W1-10: --bright equals --paper in the dark scheme, so the generic focus
+   ring vanishes on the paper surfaces. Last in the cascade on purpose: it
+   has to beat the per-control ring rules above at equal specificity. */
+.grip :focus-visible,
+.desk-section.paper :focus-visible {
+  outline-color: var(--ink);
+}
+
+/* ---------------------------------------------------------------------- */
+/* W1-10: Light mode. The desk follows prefers-color-scheme. Roles flip at  */
+/* the token layer: --ground becomes the light page, --fog the dark body    */
+/* ink, --bright the strongest text, and --paper stays the well surface     */
+/* (a white card on the gray page, so the ink/paper mixes inside the well   */
+/* keep working unchanged). The accent stays the desaturated steel blue —   */
+/* as text it is the darker --steel itself, never #0066CC.                  */
+/* ---------------------------------------------------------------------- */
+
+@media (prefers-color-scheme: light) {
+  :root {
+    --ground: #e8ecee;
+    --paper: #ffffff;
+    --fog: #2b3944;
+    --bright: #10171d;
+    --link: var(--steel);
+    --ochre-text: #77602f;
+    --ember-text: var(--ember-deep);
+    --forest-text: var(--forest);
+    --ok-text: var(--forest);
+    --err-text: #a03a20;
+    /* fog is dark here, so the muted levels mix further up, not down. */
+    --ink-2: color-mix(in srgb, var(--fog) 88%, var(--ground));
+    --ink-3: color-mix(in srgb, var(--fog) 76%, var(--ground));
+    --hair: color-mix(in srgb, var(--fog) 30%, transparent);
+    --hair-strong: color-mix(in srgb, var(--fog) 60%, transparent);
+    --line: color-mix(in srgb, var(--fog) 35%, transparent);
+    --well: color-mix(in srgb, var(--ink) 4%, transparent);
+  }
+
+  /* The well is white on a light gray page; give it the hairline the dark
+     scheme gets from the brightness difference alone. */
+  .desk-section.paper,
+  .grip {
+    border: 1px solid var(--hair-strong);
+  }
+}
+
+/* ---------------------------------------------------------------------- */
+/* prefers-contrast: more — muted text steps up toward full ink, hairlines  */
+/* become unambiguous. Values are mixes of the mode tokens, so one block    */
+/* serves both color schemes.                                               */
+/* ---------------------------------------------------------------------- */
+
+@media (prefers-contrast: more) {
+  :root {
+    --ink-2: color-mix(in srgb, var(--fog) 92%, var(--ground));
+    --ink-3: color-mix(in srgb, var(--fog) 82%, var(--ground));
+    --hair: color-mix(in srgb, var(--fog) 45%, transparent);
+    --hair-strong: color-mix(in srgb, var(--fog) 75%, transparent);
+    --line: color-mix(in srgb, var(--fog) 45%, transparent);
+  }
+}
diff --git a/docs/dev-hq/workspace.css b/docs/dev-hq/workspace.css
index 3e06f39..c6e4c45 100644
--- a/docs/dev-hq/workspace.css
+++ b/docs/dev-hq/workspace.css
@@ -4,6 +4,14 @@
   --steel: #9acbd8; --forest: #82d5b4; --ember: #f59185; --ochre: #e4bd74;
   --ink-2: #acbabd; --ink-3: #acbabd; --hair: #35464d; --hair-strong: #527079;
   --line: #35464d; --surface: #131b20; --raised: #1b272d;
+  /* W1-10 tokens pinned as well: hq.css flips :root with the OS scheme, but
+     the workspace stays dark in every mode, so the text roles must not
+     follow the flip. The deep accents collapse onto the light workspace
+     accents; --chip-ink is dark because the chips here are light. */
+  --bright: var(--paper); --chip-ink: #0b1013; --link: var(--steel);
+  --ochre-text: var(--ochre); --ember-text: var(--ember); --forest-text: var(--forest);
+  --ember-deep: var(--ember); --ochre-deep: var(--ochre);
+  --ok-text: var(--forest); --err-text: var(--ember);
   height: 100dvh; overflow: hidden; font: 14px/1.5 'Segoe UI', system-ui, sans-serif;
   font-variant-numeric: tabular-nums; color-scheme: dark;
 }
diff --git a/scripts/contrast-check.mjs b/scripts/contrast-check.mjs
index 02266b0..792899b 100644
--- a/scripts/contrast-check.mjs
+++ b/scripts/contrast-check.mjs
@@ -9,12 +9,21 @@
 //
 // Alpha-Werte werden zuerst gegen ihre tatsächliche Grundfläche komponiert;
 // Zustands-Tints liegen auf Inhalt beziehungsweise auf der erhobenen Fläche.
+//
+// W1-10: the same gate now covers docs/dev-hq/hq.css (the Dev HQ stylesheet).
+// HQ colors live in :root tokens and are derived almost entirely through
+// color-mix(), so the evaluator below understands `transparent` and
+// `color-mix(in srgb, …)` in addition to hex/rgb. HQ is checked in up to four
+// modes: dark (default), light (prefers-color-scheme: light) and each of them
+// with prefers-contrast: more overrides applied.
 
 import { readFileSync } from "node:fs";
 import { dirname, join } from "node:path";
 import { fileURLToPath } from "node:url";
 
-const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "styles.css"), "utf8");
+const here = dirname(fileURLToPath(import.meta.url));
+const css = readFileSync(join(here, "..", "src", "styles.css"), "utf8");
+const hqCss = readFileSync(join(here, "..", "docs", "dev-hq", "hq.css"), "utf8");
 
 const lightStart = css.indexOf("@media (prefers-color-scheme: light)");
 if (lightStart < 0) {
@@ -26,32 +35,106 @@ const lightVarsBlock = css.slice(lightStart, css.indexOf("\n}", css.indexOf(":ro
 
 function parseVars(block) {
   const v = {};
-  for (const m of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) v[m[1]] = m[2].trim();
+  // Strip comments first: prose like "--bright: text role" inside a comment
+  // would otherwise parse as a token and swallow the real declaration.
+  const clean = block.replace(/\/\*[\s\S]*?\*\//g, "");
+  for (const m of clean.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) v[m[1]] = m[2].trim();
   return v;
 }
-const dark = parseVars(darkVarsBlock);
-const light = { ...dark, ...parseVars(lightVarsBlock) };
 
+// resolve() substitutes every var(--x) inside a value, recursively, so the
+// result is a plain CSS color expression (hex, rgb(), transparent or
+// color-mix()). A missing token or a var() cycle is a hard error.
 function resolve(vars, value, depth = 0) {
-  if (value === undefined) return undefined;
-  if (depth > 8) throw new Error("var()-Zyklus bei " + value);
-  const m = value.match(/^var\(--([\w-]+)\)$/);
-  return m ? resolve(vars, vars[m[1]], depth + 1) : value;
+  if (value === undefined) throw new Error("Token fehlt");
+  if (depth > 10) throw new Error("var()-Zyklus bei " + value);
+  const m = value.match(/var\(--([\w-]+)\)/);
+  if (!m) return value.trim();
+  const inner = resolve(vars, vars[m[1]], depth + 1);
+  return resolve(vars, value.replace(m[0], inner), depth + 1);
 }
 
-function color(vars, name) {
-  const raw = resolve(vars, vars[name]);
-  if (!raw) throw new Error("Token fehlt: --" + name);
+// split "a, b" at the top level, ignoring commas inside parentheses
+function splitTopLevel(input) {
+  const parts = [];
+  let depth = 0;
+  let start = 0;
+  for (let i = 0; i < input.length; i++) {
+    const ch = input[i];
+    if (ch === "(") depth++;
+    else if (ch === ")") depth--;
+    else if (ch === "," && depth === 0) {
+      parts.push(input.slice(start, i));
+      start = i + 1;
+    }
+  }
+  parts.push(input.slice(start));
+  return parts.map((p) => p.trim());
+}
+
+function parseColorLiteral(raw) {
+  if (raw === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
   let m = raw.match(/^#([0-9a-f]{6})$/i);
   if (m) {
     const n = parseInt(m[1], 16);
     return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 };
   }
+  m = raw.match(/^#([0-9a-f]{3})$/i);
+  if (m) {
+    const n = parseInt(m[1], 16);
+    return { r: ((n >> 8) & 15) * 17, g: ((n >> 4) & 15) * 17, b: (n & 15) * 17, a: 1 };
+  }
   m = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
   if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
-  throw new Error(`--${name}: "${raw}" nicht lesbar`);
+  return undefined;
 }
 
+// CSS color-mix(in srgb, A [p%], B [p%]): channels are mixed premultiplied in
+// gamma-encoded srgb space; if the percentages sum to less than 100 the result
+// alpha is scaled down accordingly.
+function mix2(a, wa, b, wb) {
+  if (wa === undefined && wb === undefined) [wa, wb] = [50, 50];
+  else if (wa === undefined) wa = 100 - wb;
+  else if (wb === undefined) wb = 100 - wa;
+  const sum = wa + wb;
+  if (sum <= 0) return { r: 0, g: 0, b: 0, a: 0 };
+  const alphaMul = Math.min(sum / 100, 1);
+  const w1 = wa / sum;
+  const w2 = wb / sum;
+  const alpha = (a.a * w1 + b.a * w2) * alphaMul;
+  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
+  const chan = (x, y) => ((a.a * w1 * x + b.a * w2 * y) * alphaMul) / alpha;
+  return { r: chan(a.r, b.r), g: chan(a.g, b.g), b: chan(a.b, b.b), a: alpha };
+}
+
+function colorValue(vars, raw, depth = 0) {
+  if (depth > 10) throw new Error("color-mix zu tief verschachtelt: " + raw);
+  const lit = parseColorLiteral(raw);
+  if (lit) return lit;
+  const m = raw.match(/^color-mix\(\s*in srgb\s*,\s*(.*)\)$/s);
+  if (!m) throw new Error(`"${raw}" nicht lesbar`);
+  const parts = splitTopLevel(m[1]);
+  if (parts.length !== 2) throw new Error(`color-mix braucht 2 Farben: "${raw}"`);
+  const parsed = parts.map((p) => {
+    const pm = p.match(/^(.*?)\s+([\d.]+)%$/s);
+    return pm
+      ? { c: colorValue(vars, pm[1].trim(), depth + 1), w: +pm[2] }
+      : { c: colorValue(vars, p, depth + 1), w: undefined };
+  });
+  return mix2(parsed[0].c, parsed[0].w, parsed[1].c, parsed[1].w);
+}
+
+// color(vars, name) resolves the token --name to an rgba tuple; colorExpr(vars,
+// cssText) does the same for an arbitrary expression used in the pairing lists.
+function color(vars, name) {
+  try {
+    return colorValue(vars, resolve(vars, vars[name]));
+  } catch (err) {
+    throw new Error(`--${name}: ${err.message}`);
+  }
+}
+const colorExpr = (vars, expr) => colorValue(vars, resolve(vars, expr));
+
 const over = (fg, bg) => ({
   r: fg.a * fg.r + (1 - fg.a) * bg.r,
   g: fg.a * fg.g + (1 - fg.a) * bg.g,
@@ -76,6 +159,13 @@ function check(mode, label, fg, bg, min = 4.5) {
   rows.push(`${mode}  ${label.padEnd(44)} ${r.toFixed(2).padStart(6)}:1  ${ok ? "ok" : "FÄLLT DURCH"}`);
 }
 
+// ---------------------------------------------------------------------------
+// App stylesheet (src/styles.css)
+// ---------------------------------------------------------------------------
+
+const dark = parseVars(darkVarsBlock);
+const light = { ...dark, ...parseVars(lightVarsBlock) };
+
 for (const [mode, vars] of [["hell  ", light], ["dunkel", dark]]) {
   const c = (n) => color(vars, n);
   const surfaces = {
@@ -115,6 +205,174 @@ for (const [mode, vars] of [["hell  ", light], ["dunkel", dark]]) {
     check(mode, `code-${role} / Inhalt`, c(`code-${role}`), surfaces.Inhalt);
 }
 
+// ---------------------------------------------------------------------------
+// Dev HQ stylesheet (docs/dev-hq/hq.css)
+// ---------------------------------------------------------------------------
+
+// Extract the span of an @media block (from its index to the matching closing
+// brace) so top-level tokens and media overrides can be parsed separately.
+function mediaSpan(src, at) {
+  const open = src.indexOf("{", at);
+  let depth = 0;
+  for (let i = open; i < src.length; i++) {
+    if (src[i] === "{") depth++;
+    else if (src[i] === "}" && --depth === 0) return [at, i + 1];
+  }
+  throw new Error("@media-Block nicht geschlossen ab Index " + at);
+}
+
+function rootVarsIn(src) {
+  const v = {};
+  for (const m of src.matchAll(/:root\s*\{([^}]*)\}/g)) Object.assign(v, parseVars(m[1]));
+  return v;
+}
+
+const hqLightAt = hqCss.indexOf("@media (prefers-color-scheme: light)");
+const hqContrastAt = hqCss.indexOf("@media (prefers-contrast: more)");
+let hqTopLevel = hqCss;
+let hqLightVars = null;
+let hqContrastVars = null;
+for (const [at, set] of [
+  [hqLightAt, (s) => (hqLightVars = rootVarsIn(s))],
+  [hqContrastAt, (s) => (hqContrastVars = rootVarsIn(s))],
+]) {
+  if (at < 0) continue;
+  const [from, to] = mediaSpan(hqCss, at);
+  set(hqCss.slice(from, to));
+  hqTopLevel = hqTopLevel.replace(hqCss.slice(from, to), "");
+}
+const hqDarkVars = rootVarsIn(hqTopLevel);
+
+// Pairings cover how hq.css uses the tokens: body/heading/muted text on
+// --ground, ink on the --paper well, accents in their text roles, solid and
+// tinted chips/badges, status colors and SVG labels. Text needs 4.5:1, the
+// focus outline, strong hairlines and chart fills 3:1 (non-text).
+const hqPairings = [
+  ["hq body text / Grund", "var(--fog)", "var(--ground)"],
+  ["hq headings / Grund", "var(--bright)", "var(--ground)"],
+  ["hq ink-2 (muted) / Grund", "var(--ink-2)", "var(--ground)"],
+  ["hq ink-3 (faint) / Grund", "var(--ink-3)", "var(--ground)"],
+  ["hq links / Grund", "var(--link)", "var(--ground)"],
+  ["hq ochre-Text / Grund", "var(--ochre-text)", "var(--ground)"],
+  ["hq ember-Text / Grund", "var(--ember-text)", "var(--ground)"],
+  ["hq forest-Text / Grund", "var(--forest-text)", "var(--ground)"],
+  ["hq well text / Papier", "var(--ink)", "var(--paper)"],
+  ["hq well secondary 70% / Papier", "color-mix(in srgb, var(--ink) 70%, var(--paper))", "var(--paper)"],
+  ["hq well label 70% ink+ochre / Papier", "color-mix(in srgb, var(--ink) 70%, var(--ochre))", "var(--paper)"],
+  ["hq grip label 62% ink+ochre / Papier", "color-mix(in srgb, var(--ink) 62%, var(--ochre))", "var(--paper)"],
+  ["hq signal act / Papier", "var(--ember-deep)", "var(--paper)"],
+  ["hq signal act strong / Papier", "color-mix(in srgb, var(--ember-deep) 80%, var(--ink))", "var(--paper)"],
+  ["hq signal watch / Papier", "color-mix(in srgb, var(--ochre) 80%, var(--ink))", "var(--paper)"],
+  ["hq signal note 70% / Papier", "color-mix(in srgb, var(--ink) 70%, transparent)", "var(--paper)"],
+  ["hq signal index 62% / Papier", "color-mix(in srgb, var(--ink) 62%, transparent)", "var(--paper)"],
+  ["hq chip text / steel", "var(--chip-ink)", "var(--steel)"],
+  ["hq chip text / ember-deep", "var(--chip-ink)", "var(--ember-deep)"],
+  ["hq chip text / ochre-deep", "var(--chip-ink)", "var(--ochre-deep)"],
+  ["hq chip text / forest", "var(--chip-ink)", "var(--forest)"],
+  ["hq badge text / base tint", "var(--bright)", "color-mix(in srgb, var(--fog) 25%, var(--ground))"],
+  ["hq badge text / new tint", "var(--bright)", "color-mix(in srgb, var(--fog) 30%, var(--ground))"],
+  ["hq badge text / stale tint", "var(--bright)", "color-mix(in srgb, var(--ochre) 70%, var(--ground))"],
+  ["hq badge done text / Grund", "color-mix(in srgb, var(--forest-text) 70%, var(--fog))", "var(--ground)"],
+  ["hq status ok / Grund", "var(--ok-text)", "var(--ground)"],
+  ["hq status error / Grund", "var(--err-text)", "var(--ground)"],
+  ["hq status pending / Grund", "var(--ochre-text)", "var(--ground)"],
+  ["hq svg label / dag", "var(--fog)", "color-mix(in srgb, var(--ground) 90%, var(--steel))"],
+  ["hq focus outline / Grund (Nicht-Text)", "var(--bright)", "var(--ground)", 3],
+  ["hq hairline strong / Grund (Nicht-Text)", "var(--hair-strong)", "var(--ground)", 3],
+  ["hq chart fill / track (Nicht-Text)", "var(--link)", "color-mix(in srgb, var(--fog) 12%, var(--ground))", 3],
+];
+
+// Rule-bound pairings read the colour straight out of the rule that paints it
+// (last matching rule wins), so the gate cannot drift from a stylesheet that
+// swaps a token for a literal. `bg` may be translucent; it is composed over
+// --ground, the page surface every HQ rule sits on.
+const hqPlain = hqCss.replace(/\/\*[\s\S]*?\*\//g, "");
+function hqRuleValue(selector, prop, fallback) {
+  let found;
+  for (const m of hqPlain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
+    if (!m[1].split(",").some((sel) => sel.trim() === selector)) continue;
+    const d = m[2].match(new RegExp(String.raw`(?:^|;|\s)${prop}\s*:\s*([^;]+)`));
+    if (d) found = d[1].trim().replace(/\s*!important$/, "");
+  }
+  if (found === undefined && fallback !== undefined) return fallback;
+  if (found === undefined) throw new Error(`hq.css: keine Regel "${selector}" mit ${prop}`);
+  return found;
+}
+const borderColor = (value) => value.replace(/^\S+\s+\S+\s+/, "");
+const hqRuleBound = [
+  // The 10px note on the summary tiles sits on the steel-tinted tile.
+  ["hq summary note / Kachel", () => hqRuleValue(".summary-item small", "color"), () => hqRuleValue(".summary-item", "background")],
+  // Progress bars: the fills are the only carrier of the bucket.
+  ...["FACT", "CLAIM", "locked"].map((k) => [
+    `hq stat-bar ${k} / Spur (Nicht-Text)`,
+    () => hqRuleValue(`.stat-bar-fill.${k}`, "background"),
+    () => hqRuleValue(".stat-bar-track", "background"),
+    3,
+  ]),
+  ["hq team-form field border / Grund (Nicht-Text)", () => borderColor(hqRuleValue(".team-form input", "border")), () => "var(--ground)", 3],
+  // Focus ring on the paper surfaces: --bright equals --paper in dark mode, so
+  // without its own rule the generic ring (--bright) is measured here.
+  ...[".grip :focus-visible", ".desk-section.paper :focus-visible"].map((sel) => [
+    `hq focus ring ${sel} / Papier (Nicht-Text)`,
+    () => hqRuleValue(sel, "outline-color", "var(--bright)"),
+    () => "var(--paper)",
+    3,
+  ]),
+  // SVG lane: real label pairs (label on the lane, node label on its fill).
+  ["hq lane-label / Lane", () => hqRuleValue(".lane-label", "fill"), () => hqRuleValue("#lane", "background")],
+  ["hq lane-node-label / serial-Knoten", () => hqRuleValue(".lane-node-label", "fill"), () => hqRuleValue(".lane-node.serial rect", "fill")],
+  ["hq lane-node-label / parallel-Knoten", () => hqRuleValue(".lane-node-label", "fill"), () => hqRuleValue(".lane-node.parallel rect", "fill")],
+];
+
+// A translucent text container blends every text colour toward the page and
+// no pairing above sees it (the stale lesson card hit 3,8:1 this way). Fills
+// and strokes on SVG shapes are not text; everything else must stay opaque.
+for (const m of hqPlain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
+  const o = m[2].match(/(?:^|;|\s)opacity\s*:\s*([\d.]+)/);
+  if (!o || +o[1] <= 0 || +o[1] >= 1) continue;
+  const sel = m[1].trim().replace(/\s+/g, " ");
+  if (/(^|\s)(rect|circle|path|line)$|\.dag-edge/.test(sel)) continue;
+  fails.push(`hq: opacity ${o[1]} auf "${sel}" mischt den Text zur Seite hin — Kontrast unmessbar`);
+}
+
+// The HQ accent is the desaturated steel blue; the generic #0066CC is
+// explicitly banned as an accent (W1-10).
+const bannedAccent = "#0066cc";
+for (const token of ["steel", "link"]) {
+  const c = color(hqDarkVars, token);
+  const hex = (v) => v.toString(16).padStart(2, "0");
+  if (`#${hex(Math.round(c.r))}${hex(Math.round(c.g))}${hex(Math.round(c.b))}` === bannedAccent) {
+    fails.push(`hq: --${token} ist #0066CC — als Akzent verboten (W1-10)`);
+  }
+}
+
+const hqModes = [["hq dunkel", hqDarkVars]];
+if (hqLightVars) {
+  const hqLight = { ...hqDarkVars, ...hqLightVars };
+  hqModes.push(["hq hell ", hqLight]);
+  if (hqContrastVars) {
+    hqModes.push(["hq hell+", { ...hqLight, ...hqContrastVars }]);
+  }
+} else {
+  fails.push("hq: kein @media (prefers-color-scheme: light)-Block gefunden");
+}
+if (hqContrastVars) {
+  hqModes.push(["hq dunkel+", { ...hqDarkVars, ...hqContrastVars }]);
+} else {
+  fails.push("hq: kein @media (prefers-contrast: more)-Block gefunden");
+}
+
+for (const [mode, vars] of hqModes) {
+  for (const [label, fgExpr, bgExpr, min] of hqPairings) {
+    check(mode, label, colorExpr(vars, fgExpr), colorExpr(vars, bgExpr), min);
+  }
+  const ground = colorExpr(vars, "var(--ground)");
+  for (const [label, fg, bg, min] of hqRuleBound) {
+    const bgc = colorExpr(vars, bg());
+    check(mode, label, colorExpr(vars, fg()), bgc.a < 1 ? over(bgc, ground) : bgc, min);
+  }
+}
+
 console.log(rows.join("\n"));
 if (fails.length) {
   console.log(`\nNICHT BESTANDEN — ${fails.length} Paarung(en):`);
diff --git a/scripts/lib/hq-visual.browser.mjs b/scripts/lib/hq-visual.browser.mjs
index 3962c05..9fbe5ac 100644
--- a/scripts/lib/hq-visual.browser.mjs
+++ b/scripts/lib/hq-visual.browser.mjs
@@ -677,3 +677,102 @@ test("the desk: ranked signals in the paper well, whole-project estimates with b
   await page.screenshot({ path: join(shotDir, "desk-v3.png"), fullPage: true });
   await page.close();
 });
+
+test("W1-10 color schemes: dark, light and prefers-contrast render with their tokens", async () => {
+  const schemes = [
+    ["dark", { colorScheme: "dark" }],
+    ["light", { colorScheme: "light" }],
+    ["dark-more-contrast", { colorScheme: "dark", contrast: "more" }],
+    ["light-more-contrast", { colorScheme: "light", contrast: "more" }],
+  ];
+  const seen = {};
+  for (const [name, media] of schemes) {
+    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ...media });
+    // live.html carries the .hq-workspace palette (own scope, dark-only), so
+    // the hq.css scheme evidence comes from the static pages.
+    await page.goto(`http://127.0.0.1:${hqPort}/index.html`);
+    await page.waitForSelector(".hq-bar h1", { timeout: 10000 });
+    seen[name] = await page.evaluate(() => {
+      const body = getComputedStyle(document.body);
+      const root = getComputedStyle(document.documentElement);
+      return {
+        bg: body.backgroundColor,
+        fg: body.color,
+        paper: root.getPropertyValue("--paper").trim(),
+        bright: root.getPropertyValue("--bright").trim(),
+        link: root.getPropertyValue("--link").trim(),
+        ink2: root.getPropertyValue("--ink-2").trim(),
+      };
+    });
+    // Focus ring on the paper well: --bright equals --paper in dark mode, so
+    // the ring of a control inside .grip must come from --ink instead
+    // (review finding, PR #184). A probe link stands in for any control.
+    await page.waitForSelector(".grip", { timeout: 10000 });
+    await page.keyboard.press("Shift");
+    seen[name].ring = await page.evaluate(() => {
+      const probe = document.createElement("a");
+      probe.id = "probe";
+      probe.href = "#probe";
+      probe.textContent = "probe";
+      document.querySelector(".grip").append(probe);
+      probe.focus();
+      return { visible: probe.matches(":focus-visible"), ring: getComputedStyle(probe).outlineColor, paper: getComputedStyle(document.querySelector(".grip")).backgroundColor };
+    });
+    await (await page.$(".grip")).screenshot({ path: join(shotDir, `scheme-${name}-grip-focus.png`) });
+    await page.evaluate(() => document.getElementById("probe")?.remove());
+    await page.screenshot({ path: join(shotDir, `scheme-${name}-now.png`), fullPage: true });
+    await page.goto(`http://127.0.0.1:${hqPort}/lessons.html`);
+    await page.waitForSelector(".lesson-row", { timeout: 10000 });
+    seen[name].hair = await page.$eval(".lesson-row", (n) => getComputedStyle(n).borderTopColor);
+    await page.screenshot({ path: join(shotDir, `scheme-${name}-lessons.png`), fullPage: false });
+    await page.close();
+  }
+
+  // The token flip lands in the rendered page: dark ground/body ink …
+  assert.equal(seen["dark"].bg, "rgb(28, 34, 40)");
+  assert.equal(seen["dark"].fg, "rgb(197, 206, 212)");
+  // … light ground/body ink …
+  assert.equal(seen["light"].bg, "rgb(232, 236, 238)");
+  assert.equal(seen["light"].fg, "rgb(43, 57, 68)");
+  // … the well surface and the accent flip at the token layer …
+  assert.equal(seen["dark"].paper, "#dfe6ea");
+  assert.equal(seen["light"].paper, "#ffffff");
+  assert.equal(seen["dark"].link, "#7ba5c0");
+  assert.equal(seen["light"].link, "#3d6d8c");
+  // … the focus ring inside the paper well never collapses onto the paper …
+  for (const name of Object.keys(seen)) {
+    assert.ok(seen[name].ring.visible, `${name}: probe must match :focus-visible`);
+    assert.notEqual(seen[name].ring.ring, seen[name].ring.paper, `${name}: focus ring on paper`);
+    assert.equal(seen[name].ring.ring, "rgb(18, 21, 26)", `${name}: ring is --ink`);
+  }
+  // … and forced contrast strengthens the hairline and the muted text level
+  // in both schemes.
+  assert.notEqual(seen["dark-more-contrast"].hair, seen["dark"].hair);
+  assert.notEqual(seen["light-more-contrast"].hair, seen["light"].hair);
+  assert.notEqual(seen["dark-more-contrast"].ink2, seen["dark"].ink2);
+  assert.notEqual(seen["light-more-contrast"].ink2, seen["light"].ink2);
+  assert.equal(seen["dark-more-contrast"].bg, seen["dark"].bg);
+  assert.equal(seen["light-more-contrast"].bg, seen["light"].bg);
+
+  // The live desk keeps its own dark palette in every OS scheme: the
+  // .hq-workspace scope pins the W1-10 tokens as well (review finding:
+  // otherwise the light flip leaks dark text onto the dark workspace).
+  const wsPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
+  await wsPage.goto(`http://127.0.0.1:${hqPort}/live.html`);
+  await wsPage.waitForSelector(".live-status.ok", { timeout: 20000 });
+  const ws = await wsPage.evaluate(() => {
+    const s = getComputedStyle(document.body);
+    return {
+      bg: s.backgroundColor,
+      bright: s.getPropertyValue("--bright").trim(),
+      emberDeep: s.getPropertyValue("--ember-deep").trim(),
+      chipInk: s.getPropertyValue("--chip-ink").trim(),
+    };
+  });
+  assert.equal(ws.bg, "rgb(11, 16, 19)");
+  assert.equal(ws.bright, "#e6ece9");
+  assert.equal(ws.emberDeep, "#f59185");
+  assert.equal(ws.chipInk, "#0b1013");
+  await wsPage.screenshot({ path: join(shotDir, "scheme-light-live-workspace-pinned.png"), fullPage: false });
+  await wsPage.close();
+});

```
