export type QuestionClass = "money" | "install" | "delete" | "other";

// Closed word lists, checked in order: money wins over install over delete.
// "kosten" and "entfernen" are left out on purpose: too broad.
const CLASSES: [Exclude<QuestionClass, "other">, string[]][] = [
  ["money", ["geld", "kaufen", "bezahlen", "abrechnen", "credit", "invoice"]],
  ["install", ["installieren", "install"]],
  ["delete", ["löschen", "loeschen", "delete"]],
];

/** View-only label so the needs lane can pin money, install and delete questions; grants nothing. */
export function classifyQuestion(text: string): QuestionClass {
  const lower = text.toLowerCase();
  return CLASSES.find(([, words]) => words.some((w) => lower.includes(w)))?.[0] ?? "other";
}
