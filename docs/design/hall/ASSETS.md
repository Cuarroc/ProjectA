# Probe hall: style and art contract (DS-H-00)

Binding contract for every probe hall package (DS-H-01 to DS-H-07): sprites,
tiles, figures, layout and motion are checked against this file. A package that
needs a rule changed edits this file in its own PR and says so in its report;
nothing here is overridden silently. Sources per section: [Sources](#sources).

The hall is one scene on **synthetic data** (decision DS-FABRIK-ZIEL,
[`docs/decisions.md`](../../decisions.md)). It is not wired to real data,
adds no IPC and touches no seam file.

## 1. Raster

- **Tiles:** 16 × 16 art pixels. Floor, wall, door and band are tiles.
- **Figures:** 32 × 32 art pixels per frame, one size for every role. A
  frame covers exactly 2 × 2 tiles; the feet stand in the bottom four rows,
  centred horizontally, so every figure meets the floor grid the same way.
- **Things:** work pieces 16 × 16; stations, gate and props are whole
  multiples of 16 (e.g. 32 × 32).
- **View:** fixed top-down, floors seen from above, walls drawn front-on, roof
  left off; one light source from the top left, shadow one tone darker to the
  bottom right. Style is described neutrally ("16-bit top-down tile style").
- **Pixels:** hard edges only. No anti-aliasing, no semi-transparent pixels;
  palette index 0 is the only transparent colour.
- **Display:** integer scale only, so one art pixel is a whole number of
  device pixels at 100, 125 and 150 % Windows scaling (`usePixelScale`,
  DS-H-01); `image-rendering: pixelated`; positions in whole art pixels, no
  fractional transform. Layout positions are whole tiles.
- **No text in rasters.** Names, state words, numbers and labels are HTML in
  Inter with the existing type tokens (D1). No pixel font.

## 2. Palette bound to tokens

Every palette index names one token of
[`src/design/tokens.css`](../../../src/design/tokens.css). The generator
(DS-H-01) resolves each token for the light theme (`:root`) and the dark theme
(`:root[data-theme="dark"]`) and writes one atlas per theme. Sprite sources
contain palette indices only, never a colour literal. A token qualifies only if
it is an opaque hex colour in both themes.

| Index | Use in the art | Token |
|---|---|---|
| 0 | transparent | none |
| 1 | outline (every edge against the floor) | `--g-ink` |
| 2 | dark shade | `--g-ink2` |
| 3 | mid shade, metal | `--g-muted` |
| 4 | light shade | `--g-faint` |
| 5 | floor, paper, light surface | `--g-ground` |
| 6 | role colour Planung | `--g-av1` |
| 7 | role colour Umsetzung | `--g-av2` |
| 8 | role colour Prüfung | `--g-av4` |
| 9 | role colour Betrieb | `--g-av5` |
| 10 | warm tone (wood, crates; follows the theme) | `--g-av3` |
| 11 | neutral cloth, crates | `--g-av6` |
| 12 | cool wall tint | `--g-amb1` |
| 13 | green tint (plants, mats) | `--g-amb2` |
| 14 | warm floor tint | `--g-amb3` |
| 15 | skin (faces, hands; the same colour in both themes, 3:1 against floor and ink) | `--g-px-skin` |

- **State colours stay out of the rasters.** `--g-run`, `--g-need`,
  `--g-rev`, `--g-ok`, `--g-done`, `--g-bad` and `--g-accent` are never palette
  entries. State is drawn by the existing HTML marks
  ([`StateMark`](../../../src/design/state/StateMark.tsx), the orb from
  DS-X-04) next to the sprite: form + word + colour (D4). Selection and focus
  are HTML too (`--g-focus`). No colour literal (e.g. `#0066CC`) anywhere in
  hall code.
- A station type is not a state: a test station is never tinted as an error.
- A figure frame uses at most 8 non-transparent indices.
- **Contrast:** the outline makes the silhouette; `--g-ink` against the floor
  token must reach at least 3:1 in both themes. DS-H-01 adds that pair to
  [`scripts/contrast-check.mjs`](../../../scripts/contrast-check.mjs) if it is
  missing.
- **Extending:** a missing tone becomes a new `--g-px-*` token in
  `tokens.css` (light and dark, contrast-checked) in the package that needs it,
  plus a row here. Never a literal, never an imported palette.

## 3. Provenance and licence

- **Original only.** Every raster is drawn pixel by pixel as text in the repo
  by an agent or a person. No third-party packs (not even CC0), no tracing, no
  conversion of an existing image.
- **No image-generator output in the repo,** not even as a reference file,
  and no raster traced from one.
- **No protected names or buildings:** no brand, franchise, character, place
  or real-person names in rasters, file names, ids, comments, commits or PR
  texts; no copies of known buildings, signs or logos. Palette, proportions,
  frames and layout are our own.
- **Licence:** MIT, like the code ([`LICENSE`](../../../LICENSE)); anyone may
  reuse the art. Whether purely agent-drawn rasters are protected by copyright
  is unverified (no legal advice).
- **Atlases are build output:** the committed PNG must equal the generator's
  output for the committed sources (DS-H-01 test); nobody edits a PNG by hand.
- **Third-party art** would need a new user decision first, then an entry in
  [`docs/THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) and its licence
  text next to the file.

**Provenance file:** `src/design/hall/sprites/provenance.json`, a JSON array
with one object per raster source file:

```json
{
  "file": "src/design/hall/figures/plan.px.ts",
  "package": "DS-H-03",
  "date": "2026-10-16",
  "drawnBy": "agent:claude",
  "method": "hand-placed text raster",
  "references": "none",
  "license": "MIT"
}
```

`drawnBy` is `human` or `agent:<model family>` (family only; never an agent
id, account, name or e-mail). `references` is `none` or a neutral description
without names or links. DS-H-01 tests that every raster source has exactly one
entry, every entry's file exists and `license` is `MIT`.

## 4. Naming

- Sprite ids: ASCII, lowercase, `<kind>-<name>[-<pose>]-<frame>`, kind one of
  `tile`, `fig`, `piece`, `station`, `gate`, `prop`. Examples:
  `tile-floor-0`, `fig-plan-run-1`, `piece-crate-0`.
- Role ids: `plan`, `build`, `check`, `ops`. Their UI words "Planung",
  "Umsetzung", "Prüfung", "Betrieb" live in `src/i18n/de.ts` (DS-H-03).
- Pose ids: the six `StateForm` values `run`, `need`, `rev`, `ok`, `done`,
  `bad`, plus `unknown` and the stance `ready`. No other pose ids.
- Raster sources: `src/design/hall/<sheet>/<name>.px.ts`, exporting `frames`
  in the format of `src/design/hall/sprites/format.ts` (DS-H-01);
  `node scripts/dev/build-sprites.mjs` writes the atlases next to that file.
- Atlases: `hall-<sheet>-<theme>.png` with sheet `figures`, `tiles` or
  `things` and theme `light` or `dark`; one frame map `hall-<sheet>.json` per
  sheet, shared by both themes.

## 5. Size budget

| Item | Budget |
|---|---|
| Frames per role | at most 12 (§6); at most 2 per pose |
| Figures atlas | 48 frames, 256 × 192 px, 192 KiB decoded per theme |
| Tiles atlas | at most 128 × 128 px (64 tiles), 64 KiB decoded |
| Things atlas | at most 128 × 128 px, 64 KiB decoded |
| One PNG file | at most 24 KiB; indexed colour (PNG type 3) in the palette order of §2 |
| All hall atlases, one theme | at most 320 KiB decoded; only the active theme loads |
| Animated figures at once in Ruhig | at most 12; the others show frame 0 |
| Extra memory / idle CPU vs. the list without scene | about 20 MiB / about 1 percentage point (proposals, **unmeasured**; DS-H-07 measures) |

Decoded size = width × height × 4 bytes. Text rasters count as diff lines
(rule 1): a pose frame is stored as a delta against the role's `ready` frame,
not as a second full 32-line raster. The floor is one static background
without `will-change`; no `backdrop-filter` on or over the scene, no glass per
figure, no canvas or WebGL per figure, no JS timer per figure, no React render
per animation frame.

## 6. Roles and poses

Four role figures: **Planung** (`plan`), **Umsetzung** (`build`), **Prüfung**
(`check`), **Betrieb** (`ops`). They differ by silhouette and prop as well as
colour, and the role is always also text at the operable element. Figures are
decorative (`aria-hidden`). The check figure never implies a provider family;
that is data, shown as text when observed.

Each pose comes from exactly one `StateForm` or `unknown`
([`states.ts`](../../../src/design/state/states.ts)); there is no seventh
form. Words come from `src/i18n/de.ts`, aliases from D4.

| Pose | Source | Word | D4 alias | Figure | Frames |
|---|---|---|---|---|---|
| `run` | `run` | Läuft | läuft | works at its station, hands on the work piece | 2 |
| `need` | `need` | Braucht dich | Tor | stands at the gate and points to it | 2 |
| `rev` | `rev` | In Prüfung | wartet | stands by the handover tray, hands down | 1 |
| `ok` | `ok` | Bereit zum Mergen | bewiesen | holds the stamped work piece | 2 |
| `done` | `done` | Erledigt | none | steps back from the station, relaxed | 1 |
| `bad` | `bad` | Fehler | zurück | turns to the return path, one hand raised | 2 |
| `unknown` | `STATE_UNKNOWN_FORM` | Unbekannt | unbekannt | stands neutral, empty hands; never the work pose | 1 |
| `ready` | no run observed | none | none | profile configured, idle off the band | 1 |

`ready` ("Bereit") is a stance, not a state mark: it is chosen only when no run
exists, carries no `StateMark`, no state word and no state colour, and never
appears while a run is observed. 4 roles × 12 frames = 48 frames. Frame 0 of
every pose is its rest frame and carries the full meaning on its own.
DS-H-03 tests: `every state form and unknown maps to exactly one pose`,
`unknown never shows the working pose`, `role is also text`.

## 7. Motion

Modes from DS-X-03 (D2): `useMotion()` in
[`motionMode.ts`](../../../src/design/motion/motionMode.ts) gives `calm`
(Ruhig, default), `lively` (Lebendig) and `off` (Aus). The OS reduced-motion
setting always wins (`reduced`).

| Pose | Ruhig | Lebendig | Aus / OS reduced |
|---|---|---|---|
| `run` | short work sequence with rest phases | limited repeated work pose | frame 0 |
| `need` | still | one pointing gesture per observed change | frame 0 |
| `ok`, `bad` | one gesture per observed change (stamp, signal) | same gesture, once | frame 0 |
| `rev`, `done`, `unknown`, `ready` | still | still | frame 0 |

- CSS `steps()` on the atlas strip, durations only from the `--g-dur-*`
  tokens in [`motion.css`](../../../src/design/motion.css); one shared clock.
- No loop ever shows waiting or unknown as working. A work piece moves only on
  an observed transition; motion never claims progress.
- **Pause when hidden:** a hidden document (`visibilitychange`) or a scene off
  screen pauses every hall animation.
- **"Quelle verloren → pausieren":** when the source is lost, the hall shows the
  last known state with its age in words and pauses all animation; nothing
  replays a success.
- Not-Aus: "angefordert" stays visible until the stop is observed
  ("bestätigt"); a stopped animation proves no stopped worker.
- No camera moves, no automatic camera on new events; a selection survives
  data updates. Nothing flashes more than three times per second. Figures stay
  at their stations; no walking back and forth.

## 8. Honesty

- The hall shows only what the app can observe (board columns, reason codes,
  test status, PR link). Anything not connected shows as unknown or "nicht
  verbunden", never guessed.
- **Synthetic data is labelled.** The probe uses fixed fixtures in code
  (`src/design/hall/fixtures.ts`); every view and every screenshot or video of
  them shows the visible text label **"Beispieldaten"**. Fixtures use obviously
  synthetic ids and names: no real agent ids, PR numbers, branches, people or
  providers. Stations are fixed examples and say "Beispiel".
- The work pose needs an observed running agent; a configured profile is
  `ready`. Empty, unread and unknown halls say so in words.
- A stamp stands for concrete valid evidence; stale evidence shows a voided
  stamp, and a refetch plays no success again.
- No gamification in the probe: no points, levels, streaks or rewards.

## 9. Acceptance cases for DS-H-07

Step 1, on the server (E-3), via the gallery page and `scripts/dev/shot.mjs`
with `--motion` and `--dpr`; every image is looked at (rule 2):

| Case | Evidence |
|---|---|
| Ruhig, Lebendig, Aus × hell, dunkel | six screenshots |
| Motion | one short video (about 10–20 s) each of Ruhig and Lebendig |
| OS reduced motion with Lebendig chosen | screenshot identical to Aus |
| Empty hall, unread hall | words, no figure in the work pose |
| Scale 125 % and 150 % (`--dpr 1.25`, `--dpr 1.5`) | every art pixel the same whole width, no blur |
| Label | "Beispieldaten" visible in every shot and the video |

Step 2, only after the user's yes: the user views the hall in the app on the PC
(D6 gallery); agents never launch the desktop app for this. Memory and CPU
follow the blueprint method: same version, window and scale; synthetic sets of
1, 8, 30 and many work pieces; list without scene vs. Ruhig vs. Lebendig vs.
Aus; after warm-up record process memory (WebView2 processes included) and
CPU; at least 20 tab switches and inspector open/close; data update, source
lost, window hidden; median, spread and limits in writing. The §5 numbers are
the proposed pass line; the user decides.

## 10. Later consumers

The workflow view (DS-WF-0, user decision 2026-10-16) reuses tiles, palette,
naming and motion rules from this file: a conveyor band with branch points
plus the Fahrplan list as an equal view, and no figures for helper sub-agents.
It starts only after the user accepts the probe (DS-H-07) and shows observable
data only. It adds nothing to the probe.

## Sources

| Section | Decision |
|---|---|
| 1 Raster | DS-FABRIK-ZIEL and the DS-BLUEPRINT-CUT report §3.4 (2026-10-16, outside the repo); D1 Inter |
| 2 Palette | D3, D4 (`docs/decisions.md`, 2026-10-15); tool route of DS-FABRIK-ZIEL |
| 3 Provenance, licence | E-2 (user, 2026-10-16) in DS-FABRIK-ZIEL |
| 4 Naming | D4; E-2 (no protected names) |
| 5 Size budget | blueprint §12 and DS-BLUEPRINT-CUT §4.2 (proposals, unmeasured) |
| 6 Roles, poses | D4 (six forms + unknown); DS-BLUEPRINT-CUT §3.2 |
| 7 Motion | D2, DS-X-03 (#1606); DS-BLUEPRINT-CUT §3.1 and §4.3 |
| 8 Honesty | DS-FABRIK-ZIEL (synthetic data); blueprint §7.2 and §10 |
| 9 Acceptance | E-3 (user, 2026-10-16) in DS-FABRIK-ZIEL |
| 10 Later consumers | DS-WF-0 (user, 2026-10-16) |
