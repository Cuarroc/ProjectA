import { STATE_UNKNOWN_FORM, type StateForm } from "./states";

// Decision D4: the Fabrik speaks six words, all of them aliases of a state
// form, so there is no second vocabulary. The keys are ASCII ids of the German
// words läuft, wartet, zurück, bewiesen, unbekannt and Tor. `done` has no
// Fabrik word.
export const FABRIK_WORD_FORM = {
  laeuft: "run",
  wartet: "rev",
  zurueck: "bad",
  bewiesen: "ok",
  unbekannt: STATE_UNKNOWN_FORM,
  tor: "need",
} as const satisfies Record<string, StateForm | typeof STATE_UNKNOWN_FORM>;

export type FabrikWord = keyof typeof FABRIK_WORD_FORM;

/** Words the Fabrik does not use give `undefined`, never a guessed form. */
export function formForFabrikWord(word: string): (typeof FABRIK_WORD_FORM)[FabrikWord] | undefined {
  return Object.hasOwn(FABRIK_WORD_FORM, word) ? FABRIK_WORD_FORM[word as FabrikWord] : undefined;
}
