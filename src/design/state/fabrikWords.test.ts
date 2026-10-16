import { expect, it } from "vitest";
import { FABRIK_WORD_FORM, formForFabrikWord } from "./fabrikWords";
import { STATE_FORMS, STATE_UNKNOWN_FORM } from "./states";

it("maps each Fabrik word to exactly one StateForm", () => {
  // läuft, wartet, zurück, bewiesen, unbekannt, Tor (decision D4)
  expect(FABRIK_WORD_FORM).toEqual({
    laeuft: "run",
    wartet: "rev",
    zurueck: "bad",
    bewiesen: "ok",
    unbekannt: STATE_UNKNOWN_FORM,
    tor: "need",
  });
  const forms = Object.values(FABRIK_WORD_FORM);
  expect(new Set(forms).size).toBe(forms.length);
  for (const form of forms) expect([...STATE_FORMS, STATE_UNKNOWN_FORM]).toContain(form);
  for (const [word, form] of Object.entries(FABRIK_WORD_FORM)) expect(formForFabrikWord(word)).toBe(form);
});

it("gives no form for a word the Fabrik does not use", () => {
  for (const word of ["fertig", "", "toString", "constructor"]) expect(formForFabrikWord(word)).toBeUndefined();
});
