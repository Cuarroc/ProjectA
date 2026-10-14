export type QuestionClass = "money" | "install" | "delete" | "other";

// Closed word lists, checked in order: money wins over install over delete.
// "kosten" and "entfernen" are left out on purpose: too broad. Regexes, not string
// literals, because the i18n ratchet (hardcoded.test.ts) flags umlauts in strings.
const CLASSES: [Exclude<QuestionClass, "other">, RegExp][] = [
  ["money", /geld|kaufen|bezahlen|abrechnen|credit|invoice/i],
  ["install", /install/i], // covers "installieren" too
  ["delete", /löschen|loeschen|delete/i],
];

/** View-only label so the needs lane can pin money, install and delete questions; grants nothing. */
export function classifyQuestion(text: string): QuestionClass {
  return CLASSES.find(([, re]) => re.test(text))?.[0] ?? "other";
}
