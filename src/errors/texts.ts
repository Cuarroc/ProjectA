export const texts = {
  failed: "Etwas ist schiefgelaufen.",
  reload: "Neu laden",
  readFailed: "Das konnte gerade nicht gelesen werden. Bitte später noch einmal versuchen.",
  actionFailed: "Die Aktion ist fehlgeschlagen. Bitte noch einmal versuchen.",
  details: "Technische Details",
  timeout: "Die Antwort hat zu lange gedauert. Bitte später noch einmal versuchen.",
  unreachable: "Der Dienst ist gerade nicht erreichbar.",
  busy: "Die Daten sind gerade gesperrt. Bitte gleich noch einmal versuchen.",
} as const;

/** Known error classes: a pattern on the raw backend text and the German sentence for it. */
const KNOWN: readonly (readonly [RegExp, string])[] = [
  [/time(d)?[ -]?out/i, texts.timeout],
  [/connection (refused|reset)|failed to fetch|network (error|unreachable)|unreachable|offline/i, texts.unreachable],
  [/database is locked|resource busy|temporarily unavailable/i, texts.busy],
];

export interface UserError {
  /** The sentence shown as the main message. Never the raw backend text. */
  text: string;
  /** The raw text for a details element or the log; `null` when there is none. */
  detail: string | null;
}

/**
 * Translate a raw IPC error string for display: a known class gets its German
 * sentence, anything else the generic `fallback`. The raw text is returned
 * separately so it can go into a disclosure, never into the main message.
 */
export function userError(raw: string | null | undefined, fallback: string = texts.readFailed): UserError {
  const detail = raw?.trim() ? raw.trim() : null;
  if (detail === null) return { text: fallback, detail };
  const known = KNOWN.find(([pattern]) => pattern.test(detail));
  return { text: known ? known[1] : fallback, detail };
}
