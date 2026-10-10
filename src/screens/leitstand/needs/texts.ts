// German texts of the "Braucht dich" area. Moves into the shared dictionary
// (src/i18n) after V2-F6 (#1012).
export const T = {
  title: "Braucht dich",
  none: "nichts offen",
  open: (n: number) => `${n} offen`,
  emptyTitle: "Nichts offen",
  emptyHint: "Kein Agent wartet auf eine Antwort von dir.",
  offlineHint: "Die Fragen der Agenten lassen sich gerade nicht lesen.",
  loading: "Fragen werden gelesen …",
  answerLabel: "Antwort",
  placeholder: "Antwort, sie landet im Terminal des Agenten",
  placeholderPreflight: "Antwort, sie geht an die Prompt-Schärfung zurück",
  send: "Antworten",
  sending: "Sendet …",
  keys: "Enter antwortet · Esc leert das Feld",
  direct: "Die Antwort geht direkt ins Terminal.",
  noAgent: "Agent nicht mehr da",
  preflight: "Vorabfrage, noch kein Agent",
  answered: (text: string) => `Beantwortet: ${text}`,
  justNow: "gerade eben",
  minutes: (m: number) => `vor ${m} min`,
  hours: (h: number) => `vor ${h} h`,
} as const;
