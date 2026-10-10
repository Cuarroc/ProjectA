import { STATE_WORDS, type StateForm } from "./states";
import "./state.css";

/** The shape alone, for lists and chips that print the word themselves. */
export function StateGlyph({ form }: { form: StateForm }) {
  return <span className={`g-glyph g-glyph--${form}`} aria-hidden="true" />;
}

/** Shape, word and color together: the color is never the only signal. */
export function StateMark({ form, label }: { form: StateForm; label?: string }) {
  return <span className={`g-st g-st--${form}`}>{label ?? STATE_WORDS[form]}</span>;
}
