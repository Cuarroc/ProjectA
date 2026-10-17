// DS-X-14: the one catalogue of design components. `registry.coverage.test.ts`
// keeps it in step with the `export function` components under src/design.

export type ComponentFamily = "controls" | "data" | "fabrik" | "forms" | "gallery" | "hall" | "inputs" | "layout" | "state";

export interface ComponentEntry {
  /** The exported function name. */
  name: string;
  /** The directory under src/design that holds the file. */
  family: ComponentFamily;
  /** Props that change the look, with their values. */
  variants: readonly string[];
  /** Conditions the component draws differently, including missing data. */
  states: readonly string[];
  /** What keyboard and screen reader users get, or must supply. */
  a11y: string;
  /** Where the words on screen come from. */
  text: string;
}

export const COMPONENT_REGISTRY: readonly ComponentEntry[] = [
  {
    name: "Button", family: "controls",
    variants: ["\"primary\", \"secondary\", \"tint\", \"ghost\", \"danger\"; size sm, md, lg"], states: ["disabled"],
    a11y: "Native button, type=\"button\" by default; an icon-only button needs aria-label.",
    text: "Children from the caller.",
  },
  {
    name: "ButtonGroup", family: "controls",
    variants: [], states: [],
    a11y: "role=\"group\"; the caller names it with aria-label.",
    text: "Children are Buttons.",
  },
  {
    name: "Chip", family: "controls",
    variants: ["size sm, md"], states: [],
    a11y: "Static label, never focusable (tabIndex is dropped); use FilterChip to toggle.",
    text: "Children from the caller.",
  },
  {
    name: "FilterChip", family: "controls",
    variants: [], states: ["pressed, not pressed, count shown only when finite"],
    a11y: "Native button; pressed alone decides aria-pressed.",
    text: "Children from the caller; state words from states.ts.",
  },
  {
    name: "Segmented", family: "controls",
    variants: [], states: ["selected option; value outside the options falls back to the first"],
    a11y: "role=\"radiogroup\" with one tab stop; arrows, Home and End select; skipped during IME composition.",
    text: "Option labels from the caller.",
  },
  {
    name: "Switch", family: "controls",
    variants: [], states: ["on, off, disabled"],
    a11y: "role=\"switch\" with aria-checked; needs aria-label or aria-labelledby.",
    text: "The label is the caller's.",
  },
  {
    name: "Gallery", family: "gallery",
    variants: [], states: ["one page at a time; motion demo rests while motion is reduced"],
    a11y: "Pages are buttons in a named nav with aria-current; swatches print their contrast ratio as text.",
    text: "src/i18n/de.ts gallery.*; sample content carries the \"Beispieldaten\" label.",
  },
  {
    name: "DevNote", family: "data",
    variants: [], states: ["hidden outside the Dev channel"],
    a11y: "Plain paragraph; renders nothing in release builds.",
    text: "Children from the caller (planning notes only).",
  },
  {
    name: "HonestState", family: "data",
    variants: ["kind empty, offline, locked"], states: ["unknown kind draws as empty; text with a digit is dropped"],
    a11y: "Heading and hint as text; the action is a Button.",
    text: "src/i18n/de.ts honest.*; title and hint from the caller, never a number.",
  },
  {
    name: "KeyValue", family: "data",
    variants: ["box"], states: ["no items renders nothing"],
    a11y: "Term/definition list (dl, dt, dd).",
    text: "Labels and values from the caller.",
  },
  {
    name: "ProofChip", family: "data",
    variants: ["verdict tone yes, no, wip; tick pass, fail, wip, none"], states: ["unknown tick draws as none; link when href is given"],
    a11y: "Ticks are colour only, so \"Gates n/m\" and the verdict are text.",
    text: "src/i18n/de.ts proof.gates; verdict text from the caller.",
  },
  {
    name: "Table", family: "data",
    variants: ["column numeric"], states: ["no rows shows the empty node or nothing"],
    a11y: "Labelled, focusable scroll region; header cells have scope=\"col\".",
    text: "Headers and cells from the caller; use HonestState for empty.",
  },
  {
    name: "Orb", family: "fabrik",
    variants: ["state run, need, rev, ok, done, bad, unknown"], states: ["missing or unknown state draws as unknown"],
    a11y: "role=\"img\" named by label plus state word; the inner glyph is mandatory, colour is never alone.",
    text: "src/i18n/de.ts fabrik.orbName and state words via states.ts; label from the caller.",
  },
  {
    name: "Field", family: "forms",
    variants: [], states: ["hint shown, error shown (invalid), filled, focused as data attributes"],
    a11y: "Label tied to the control by id; aria-describedby lists hint and error, aria-invalid when there is an error; the error is text in role=\"alert\".",
    text: "Label, hint and error from the caller.",
  },
  {
    name: "Checkbox", family: "forms",
    variants: [], states: ["checked, unchecked, mixed, disabled"],
    a11y: "Native checkbox: Space and label click toggle; mixed sets indeterminate and aria-checked=\"mixed\".",
    text: "Label from the caller.",
  },
  {
    name: "Hall", family: "hall",
    variants: [], states: ["filled", "empty pieces: empty in words", "scene undefined: unread in words", "missing piece state: unknown pose and word"],
    a11y: "Labelled region; sprites are aria-hidden, every station, role, piece, gate and stamp is also text.",
    text: "src/i18n/de.ts hall.* and state words via StateMark; always shows hall.sample.",
  },
  {
    name: "Avatar", family: "inputs",
    variants: ["size sm, md, lg; tone owner, lead, sys, 1 to 6"], states: ["unknown tone draws the plain avatar"],
    a11y: "Decorative (aria-hidden) unless label is given; then role=\"img\".",
    text: "Initials and label from the caller.",
  },
  {
    name: "Input", family: "inputs",
    variants: ["mono, compact"], states: ["disabled, invalid"],
    a11y: "Needs a label, aria-label or aria-labelledby; mark errors with aria-invalid.",
    text: "Value and placeholder from the caller.",
  },
  {
    name: "Textarea", family: "inputs",
    variants: ["mono"], states: ["disabled, invalid"],
    a11y: "Needs a label, aria-label or aria-labelledby; mark errors with aria-invalid.",
    text: "Value and placeholder from the caller.",
  },
  {
    name: "Kbd", family: "inputs",
    variants: [], states: [],
    a11y: "Static text, never focusable.",
    text: "Children from the caller (key names).",
  },
  {
    name: "Lamp", family: "inputs",
    variants: ["state ok, off, warn, busy, bad, unknown"], states: ["missing or unknown state draws as unknown, never ok"],
    a11y: "Decorative unless label is given; warn, busy, bad and unknown differ by shape, not colour.",
    text: "Label from the caller; the word belongs next to it.",
  },
  {
    name: "Meter", family: "inputs",
    variants: ["tone neutral, accent, hot, lock, good"], states: ["value null or NaN is an empty named track, not 0; out of range is clamped"],
    a11y: "role=\"meter\" with aria-valuenow; role=\"img\" without a measurement; aria-label required.",
    text: "aria-label from the caller.",
  },
  {
    name: "Select", family: "inputs",
    variants: ["compact"], states: ["disabled, invalid"],
    a11y: "Native select keeps keyboard and typeahead; needs an accessible name.",
    text: "Options from the caller.",
  },
  {
    name: "Sheet", family: "layout",
    variants: [], states: ["open, closed"],
    a11y: "role=\"dialog\" aria-modal; focus moves in, Tab cycles, Esc or scrim click closes, focus returns.",
    text: "aria-label and children from the caller.",
  },
  {
    name: "Tabs", family: "layout",
    variants: [], states: ["selected tab; value matching no tab leaves the first as the tab stop"],
    a11y: "role=\"tablist\" with one tab stop; arrows, Home and End select; ids tie tabs to TabPanel.",
    text: "Tab labels from the caller.",
  },
  {
    name: "TabPanel", family: "layout",
    variants: [], states: ["active, hidden"],
    a11y: "role=\"tabpanel\" labelled by its tab; children render only while active.",
    text: "Children from the caller.",
  },
  {
    name: "ToastRegion", family: "layout",
    variants: ["tone info, ok, bad"], states: ["closes itself after ttl (6 s)"],
    a11y: "aria-live region; bad uses role=\"alert\", the others role=\"status\"; close button is named.",
    text: "src/i18n/de.ts action.close; text from the caller.",
  },
  {
    name: "StateGlyph", family: "state",
    variants: ["form run, need, rev, ok, done, bad"], states: ["missing or unknown form draws as unknown"],
    a11y: "aria-hidden shape only; print the word next to it.",
    text: "No text; the word comes from StateMark or the caller.",
  },
  {
    name: "StateMark", family: "state",
    variants: ["form run, need, rev, ok, done, bad"], states: ["missing or unknown form draws as unknown"],
    a11y: "Shape, word and colour together; colour is never the only signal.",
    text: "src/i18n/de.ts state.* via states.ts; label overrides the word.",
  },
];
