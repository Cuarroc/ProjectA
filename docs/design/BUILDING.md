# Building with the design system

Short rules for anyone (human or agent) who adds or changes UI in ProjectA. Each rule names the file that
holds the truth and, where one exists, the test that fails when it is broken. Voice and wording:
[voice.md](voice.md).

## 1. Use an existing block first

- The catalogue is `src/design/registry.ts`: one entry per exported component (family, variants, states,
  accessibility, text source). `src/design/registry.coverage.test.ts` fails when a component is missing or an
  entry points at nothing. Read it before you write markup.
- See the blocks drawn: Einstellungen › Version › „Designsystem ansehen“ opens `#/designsystem`
  (`src/design/gallery/Gallery.tsx`). It shows real components with sample data only.
- A new block needs a registry entry in the same change, and a gallery page when the gallery has stories for its family.

| Job | Block (family folder under `src/design/`) |
|---|---|
| Act, choose, toggle, filter | `controls/`: `Button`, `ButtonGroup`, `Chip`, `FilterChip`, `Segmented`, `Switch` |
| Enter or pick a value | `inputs/`: `Input`, `Textarea`, `Select`; `forms/`: `Field` (label, hint, error by id), `Checkbox`, `RadioGroup`, `SwitchField` |
| Show a measure or identity | `inputs/`: `Lamp`, `Meter`, `Avatar`, `Kbd` |
| Show a state | `state/`: `StateMark`, `StateGlyph`; `fabrik/`: `Orb` |
| Show data, proof, "nothing here" | `data/`: `Table`, `KeyValue`, `ProofChip`, `HonestState`, `DevNote` |
| Navigate, overlay, notify | `layout/`: `Tabs`, `TabPanel`, `Sheet`, `ToastRegion` |
| Lists and labels | `surface/`: `ListRow`, `Separator`, `Badge` |
| The Halle | `hall/` |

If two blocks nearly fit, extend one (a variant) instead of adding a third.

## 2. Tokens only, no raw colours

- Colours, type, spacing, radius, heights, layers and focus come from `src/design/tokens.css` (`--g-*`). Write
  `var(--g-ink)`, not `#1a1a1a`, `rgb(...)` or a pixel value that has a scale step (`--g-space-*`, `--g-t-*`).
- Materials come from `src/design/glass.css` (`.g-chrome`, `.g-glass`). A material nested in a material drops
  the blur (`glass-nesting.test.ts`).
- Both themes must work. `node scripts/contrast-check.mjs` checks the text pairs (WCAG AA, 4.5:1); run it after
  touching a colour. Scale values are pinned by `tokens-scale.test.ts` and `tokens-theme.test.ts`.
- Breakpoints are the constant in `src/design/breakpoints.ts`, not new media-query numbers.

## 3. All text through the dictionary

- Every word the user reads lives in `src/i18n/de.ts` and is read with `useT()` / `t()`. No German literal in a
  component. `src/i18n/hardcoded.test.ts` fails on new offenders; a file named exactly `texts.ts` is a
  transitional dictionary module, not a place for new components' words.
- Non-visible names (`aria-label`, `title`) are text too and follow the same rule.
- How the words sound: [voice.md](voice.md).

## 4. State words come from `states.ts`

- A state is one of six forms (`run`, `need`, `rev`, `ok`, `done`, `bad`) plus the neutral unknown, defined in
  `src/design/state/states.ts`; the words are `state.*` in `de.ts`. The Fabrik aliases (D4 in
  `docs/decisions.md`) live next to it in `src/design/state/fabrikWords.ts`.
- Do not write a second status map or status word in a screen. Map your value to a `StateForm` and render
  `StateMark`. A shape and a word always accompany colour; colour alone never carries a state.
- Unknown is shown as unknown (neutral mark, no value), never as green or 0 %.

## 5. Motion

- Durations and curves are tokens in `src/design/motion.css`; read them from script via
  `src/design/motion/tokens.ts`. No literal `ms` or `cubic-bezier` in a component rule.
- Animate `transform` and `opacity` only, never layout properties; `motion.test.ts` fails on a new one (two
  existing Meter animations are the only allowed exceptions).
- **Reduced motion always wins.** The OS setting (`prefers-reduced-motion: reduce`) overrides the user's mode
  (Ruhig, Lebendig, Aus; `src/design/motion/motionMode.ts`, `<html data-motion>`) and forces resting
  positions. A new animation needs its reduced branch in `motion.css` in the same change.
- Use `useExitTransition` (`src/design/motion/`) to keep a closing
  node mounted; it unmounts at once under reduced motion.
- Ambient motion follows `--g-ambient-play`: paused in Ruhig, running only in Lebendig.

## 6. Copy the pattern, do not install

- Take the idea or the small piece you need and write it in this tree against our tokens. Do not add a UI
  kit, icon package or font package to `package.json` for one block.
- Anything copied in (an icon path, a font) must be under a licence on the allowlist and be recorded in
  `docs/THIRD_PARTY_NOTICES.md`. The allowlist is `ALLOWED_LICENSES` in `scripts/lib/license-check.mjs`
  (MIT, Apache-2.0, BSD-2/3-Clause, ISC, MPL-2.0, Zlib, Unicode, CC0, 0BSD, BSL-1.0, OFL-1.1); `bash
  scripts/ci/license-check.sh` enforces it for packages. A licence outside the list is reported, never
  used.
- New dependencies need the user's approval (AGENTS.md rule 10).

## 7. Before you hand over

- `npx vitest run src/design` and `npx tsc --noEmit` (or the full `bash scripts/ci/gates.sh lane prepush`).
- A visual claim needs a screenshot you looked at, light and dark, with the motion mode named.
