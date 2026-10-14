// Every UI word of the Verlauf chat. Moves into the dictionary (src/i18n) once the
// Leitstand is mounted; until then German is hard-wired in this one file.
export const T = {
  title: "Verlauf",
  list: "Nachrichten mit dem Orchestrator",
  inputLabel: "Nachricht an den Orchestrator",
  recipient: "Empfänger: Orchestrator des gewählten Projekts.",
  firstSendHint: "Der erste Versand kann den Orchestrator starten.",
  placeholder: "Sag dem Orchestrator, was als Nächstes passieren soll …",
  noProject: "Kein Projekt aktiv",
  noProjectHint: "Wähle ein Projekt, um mit seinem Orchestrator zu sprechen.",
  loading: "Verlauf wird geladen …",
  empty: "Noch keine Nachrichten",
  emptyHint: "Sag unten, was als Nächstes passieren soll. Der Orchestrator verteilt die Arbeit auf Agenten.",
  send: "Senden",
  sending: "Sendet …",
  keys: "Enter sendet, Shift+Enter macht eine neue Zeile.",
  errorTitle: "Das hat nicht geklappt",
  errorHide: "Ausblenden",
  errorRetry: "Erneut lesen",
} as const;
