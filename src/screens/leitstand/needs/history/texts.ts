/** Closed-history copy; local dictionary until the shared catalog absorbs it. */
export const HISTORY_TEXT = {
  expired: "Abgelaufen: {text}",
  refused: "Abgewiesen: {text}",
  human: "von einem Menschen beantwortet",
  unverified: "beantwortet, Herkunft ungeprüft",
  nobody: "niemand hat entschieden",
  unknownOrigin: "Herkunft nicht gespeichert",
  missingAnswer: "Keine Antwort gespeichert",
  recordedAnswer: "Antwort gespeichert: {text}",
  project: "Projekt",
  worker: "Agent: {id}",
  closed: "Geschlossen",
  created: "Erstellt",
} as const;
