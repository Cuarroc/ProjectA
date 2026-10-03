/** Plain-German labels and error explanations for people who do not read code. */

const STATUS_LABELS: Record<string, string> = {
  running: "Läuft",
  exited: "Beendet",
  archived: "Archiviert",
};

/** German name of a worker status; an unknown value is shown as it is. */
export function workerStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export interface ErrorExplanation {
  what: string;
  todo: string;
  raw: string;
}

const RULES: Array<{ test: RegExp; what: string; todo: string }> = [
  {
    test: /ECONNREFUSED|ENOTFOUND|network|timed? ?out|ETIMEDOUT|fetch failed/i,
    what: "Ein Dienst war nicht erreichbar.",
    todo: "Prüfe die Internetverbindung und versuche es in einer Minute noch einmal.",
  },
  {
    test: /EACCES|EPERM|permission denied|forbidden|unauthorized/i,
    what: "Dir fehlt die Berechtigung für diese Aktion.",
    todo: "Prüfe die Rechte der Datei oder des Ordners und melde dich bei Bedarf neu an.",
  },
  {
    test: /ENOENT|not found|no such file/i,
    what: "Eine Datei, ein Ordner oder ein Eintrag wurde nicht gefunden.",
    todo: "Lade die Ansicht neu; vielleicht wurde er inzwischen gelöscht oder verschoben.",
  },
  {
    test: /locked|busy|already running|in use/i,
    what: "Die Sache ist gerade belegt.",
    todo: "Warte kurz, bis die laufende Aktion fertig ist, und versuche es dann erneut.",
  },
];

/** What happened and what to do, in plain German; the original text rides along. */
export function explainError(message: string): ErrorExplanation {
  const rule = RULES.find((r) => r.test.test(message));
  return {
    what: rule?.what ?? "Es ist ein Fehler aufgetreten.",
    todo:
      rule?.todo ??
      "Versuche es noch einmal. Hilft das nicht, kopiere den Originaltext unten und gib ihn weiter.",
    raw: message,
  };
}
