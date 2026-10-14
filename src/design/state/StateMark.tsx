import { STATE_UNKNOWN_FORM, STATE_UNKNOWN_WORD, STATE_WORDS, type StateForm } from "./states";
import "./state.css";

/** Runtime values can be missing or newer than this map; the type does not say so. */
function knownStateForm(form: StateForm | undefined): form is StateForm {
  return form !== undefined && Object.hasOwn(STATE_WORDS, form);
}

/** The shape alone, for lists and chips that print the word themselves. */
export function StateGlyph({ form }: { form: StateForm | undefined }) {
  const shape = knownStateForm(form) ? form : STATE_UNKNOWN_FORM;
  return <span className={`g-glyph g-glyph--${shape}`} aria-hidden="true" />;
}

/** Shape, word and color together: the color is never the only signal. */
export function StateMark({ form, label }: { form: StateForm | undefined; label?: string }) {
  if (knownStateForm(form)) {
    return <span className={`g-st g-st--${form}`}>{label ?? STATE_WORDS[form]}</span>;
  }
  return <span className={`g-st g-st--${STATE_UNKNOWN_FORM}`}>{label ?? STATE_UNKNOWN_WORD}</span>;
}
