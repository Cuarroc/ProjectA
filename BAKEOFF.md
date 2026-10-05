# Board states bake-off

Scope: `BoardView` empty, loading and load-failed states, using existing tokens only.

## Three directions

1. **Centered card.** One quiet elevated surface in the middle of the board with a
   title, one sentence and one button. Reuses `.empty-state`, `.empty-action`,
   `ErrorNote`. Calm and familiar, but a spinner-less loading card would make the
   layout jump when the five columns appear.
2. **Ghost board.** Always draw the five columns; put the message inside the first
   column. No jump at all, but the empty and error messages get squeezed into a 212 px
   column and read as a column item rather than a state, which is poor for a beginner.
3. **Illustrated onboarding.** Large icon, steps, several actions. Friendly, but the
   repo has no illustration language, the brief allows one next action, and new
   artwork means new tokens.

## Pick: mix of 1 and 2, by state

- **Empty and error** use direction 1: a centered card, because each is a message
  plus one action and nothing should compete with it.
- **Loading** uses the ghost board of direction 2: the same five column heads with
  pulsing placeholder cards, so the real board replaces it without shifting. It is
  `role="status" aria-busy="true"` with a screen-reader line; the placeholders are
  `aria-hidden`. The pulse stops under `prefers-reduced-motion`.

Why: it follows the existing visual language (`.empty-state`, `.error-note`, board
columns), needs no new token or dependency, and each state gets the shape that suits
it. Light and dark follow from tokens (`--bg-elevated`, `--border`, `--fg`, `--fg-muted`);
hint text is set to full opacity inside the card so it keeps its contrast.

## Behaviour notes

- Empty: the action is the existing `onNew` (opens the new-worker dialog).
- Error: `ErrorNote` supplies "Was ist passiert? / Was du tun kannst:" and the raw
  text. The retry button calls the existing `board.refresh`, passed through a new
  optional `onRetry` prop (one line in `App.tsx`; the brief's "touch only" list
  does not cover it, but a retry that BoardView cannot reach is not a retry). The
  hint that the board retries by itself stays.
- Focus: buttons use the global `:focus-visible` ring.

## Evidence

`bakeoff-shots/<state>-<width>-<theme>.png`, made by `e2e/bakeoff-shots.spec.ts`
(mock data only). Contrast and test commands are in the commit message / final report.
