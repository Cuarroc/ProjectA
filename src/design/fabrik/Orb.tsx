import { de } from "../../i18n/de";
import { StateGlyph } from "../state/StateMark";
import { STATE_UNKNOWN_FORM, STATE_UNKNOWN_WORD, STATE_WORDS, type StateForm } from "../state/states";
import "./fabrik.css";

export type OrbState = StateForm | typeof STATE_UNKNOWN_FORM;

/** A work orb on a Fabrik lane: state fill, mandatory inner glyph, name = label + state word. */
export function Orb({ state, label }: { state: OrbState | undefined; label: string }) {
  // Runtime values can be missing or newer than this map; the type does not say so.
  const form = state !== undefined && Object.hasOwn(STATE_WORDS, state) ? (state as StateForm) : undefined;
  const word = form ? STATE_WORDS[form] : STATE_UNKNOWN_WORD;
  // One pass with a function: a `$` or `{state}` inside the label stays literal.
  const name = de["fabrik.orbName"].replace(/\{(label|state)\}/g, (_, key: string) => (key === "label" ? label : word));
  return (
    <span className={`g-orb g-orb--${form ?? STATE_UNKNOWN_FORM}`} role="img" aria-label={name}>
      <StateGlyph form={form} />
    </span>
  );
}
