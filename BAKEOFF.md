# Board states: design notes

Throwaway experiment (branch never merges). Scope: `BoardView.tsx`, its CSS in
`styles.css`, its tests. Only existing tokens and classes.

## Three directions, one pick

- **A. Centred text, polished.** Keep today's `.empty-state` look: heading,
  sentence, button; spinner for loading; red text for errors.
  *Against:* the screen is a different shape from the board, so every cards
  arrival is a jump (the brief forbids it for loading); an error is a red line.
- **B. One calm card per state** (like `.bootstrap-card`). Same footprint for
  all three. *Against:* consistent with the boot screen, but still swaps a card
  for five columns when the cards land; nothing says what the board will show.
- **C. Same frame, three fillings.** Loading, empty and failed all draw the five
  real column heads; only the bodies differ: skeleton cards (loading), a card
  on top (empty, failed). *Against:* column heads are English (`lib/board.ts`,
  out of scope); on a narrow window the right columns are clipped.

**Pick: C.** It is the only one that meets "no layout jump": the frame is the
final geometry, so cards arriving, or the first worker landing in "Working",
changes only column bodies. The heads double as the answer to "what does this
board show?" for a beginner. Honesty detail: counts read `–` while unknown
(loading, failed) and `0` only when the core really said empty.

## Decisions

- Empty: one sentence plus the one action the app has (`onNew`, same label
  "Neuer Worker" as the toolbar).
- Loading: `aria-busy` on the board, `role="status"` text, skeleton pulse
  (opacity only, off under `prefers-reduced-motion`).
- Failed: `role="alert"`, "Was ist passiert? / Was du tun kannst:" as in
  `ErrorNote`, raw text behind `<details>`, the × state mark so red is not the
  only signal. Retry: the app already retries by itself every 5 s
  (`useBoard`), and the text says so. `useBoard.refresh` is not exposed to
  `BoardView`; a manual button needs `onRetry={board.refresh}` in `App.tsx`,
  which is outside the allowed files, so it is not built.
- Colour pairs are all ones `scripts/contrast-check.mjs` already gates
  (text/secondary on card, danger on card, on-accent on accent).
