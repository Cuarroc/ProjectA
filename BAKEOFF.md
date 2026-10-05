# UI bake-off: board states (empty, loading, error)

Scope: `src/components/BoardView.tsx`, its rules in `src/styles.css`, its unit
tests, and one Playwright spec that renders the evidence. No new dependency, no
new token, no backend call.

## What the code already offers

- **Empty:** the only next action is `onNew` (opens the existing "Neuer
  Worker" dialog).
- **Loading:** `loading` is true only for the first fetch of a project
  (`useBoard`); polls stay silent.
- **Error:** there is no retry handler on `BoardView`. `useBoard` polls every
  5 s on its own, so the board does retry. `App` has a `board.refresh`, but
  passing it in would mean editing `App.tsx`, which this brief excludes. A
  follow-up could add an `onRetry` prop and a button.
- **Visual language:** a flat content surface, muted text, one accent button
  (`.empty-action`), state colours as foreground plus tint (`--state-*`),
  `ErrorNote` for "Was ist passiert? / Was du tun kannst", and a global
  `:focus-visible` ring. The crash surface (`ErrorBoundary`) is deliberately
  "quiet, no red".

## Three directions

**A: Ghost board everywhere.** All three states keep the five-column grid and
put a message card on top of it.
+ No layout change between any of the states.
− Empty columns behind an error suggest that data exists. A card on top of the
  column rules is busy, and it is a new pattern (overlay) the app does not use.

**B: One centred note for all three.** This refines today's `.empty-state`:
title, sentence, action. Loading becomes a spinner.
+ The smallest change, and it matches `ErrorBoundary` and `BootstrapScreen`.
− Loading → board jumps from a centred block to a full grid. "Keine Worker"
  still does not explain what the board *is*. The spinner is the one motion the
  motion rules avoid for content.

**C: Each state shaped by what comes next.**
- *Loading* is the board itself: real column heads plus one quiet placeholder
  card per column. The cards land exactly where the placeholders sit, so
  nothing jumps. A small floating pill says "Board wird geladen …"
  (`role="status"`, `aria-busy` on the board). It is positioned absolutely, so
  it costs no row.
- *Empty* is a centred, left-aligned note: a title, one sentence, and the five
  phases as a path of chips in their own state colours, so a beginner learns
  the board's grammar before the first worker exists. One primary button calls
  the existing `onNew`.
- *Error* is the same note shape with the existing `ErrorNote` inside: plain
  "Was ist passiert / Was du tun kannst". The raw text sits behind "Originaltext
  anzeigen". Below it, one quiet line with a slow dot: "ProjectA versucht es
  alle paar Sekunden von selbst erneut." That is honest about the automatic
  retry, which is the retry that exists. Red only on the raw error text, never
  on the panel.
+ It fixes B's jump and teaches more than A, using only existing tokens and
  components.
− It is three slightly different layouts instead of one. Placeholder cards
  imply "cards are coming" even when the project turns out empty (this is
  accepted: the empty state replaces them within one fetch).

**Pick: C.** The brief weighs "no layout jump" and "beginner-friendly" highest.
C is the only direction that satisfies both: loading looks like the board, and
empty explains the board. It stays inside the existing language: the flat
surface, `.empty-action`, `--state-*` tints, `ErrorNote`, and the quiet error
surface of `ErrorBoundary`.

## Details

- **Copy (German, du-form like the rest of the app):** "Noch keine Worker in
  diesem Projekt" / "Hier siehst du jeden Worker dieses Projekts und in welcher
  Phase seine Aufgabe gerade steht." / "Ersten Worker starten". The button's
  name differs on purpose from the toolbar's "Neuer Worker", so the two
  controls never read as duplicates to a screen reader.
- **Accessibility:** the phase list is an `<ol>` with an `aria-label`, and the
  arrows are CSS-generated text in a tertiary colour. The skeleton is
  `aria-hidden` and the status pill is `role="status"`. `ErrorNote` carries
  `role="alert"`. The focus ring is the global `:focus-visible` rule on the
  button and on the `<summary>`.
- **Motion:** an opacity pulse on the skeleton and on the retry dot, switched
  off under `prefers-reduced-motion`. Nothing moves through space.
- **Themes:** only tokens are used, so light and dark follow
  `prefers-color-scheme`. `node scripts/contrast-check.mjs` passed (exit 0,
  352 pairings, including every state tint).

## Evidence

- `bakeoff-shots/<state>-<width>-<theme>.png`: 12 images, rendered by
  `BAKEOFF_SHOTS=1 npx playwright test e2e/bakeoff-board-states.spec.ts`.
  They use mock IPC from the existing browser mock, with fixture data only.
- Unit tests: `src/components/BoardView.test.tsx`, "BoardView states without
  cards".
