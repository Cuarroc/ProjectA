/** Existing German copy of the global stuck threshold. */
export const T = {
  label: "Stuck-Diagnose (Minuten)",
  placeholder: "Standard: 10",
  save: "Speichern",
  hintStart: "Wie lange ein laufender Worker",
  simultaneous: "gleichzeitig",
  hintEnd: "ohne Terminal-Ausgabe und ohne Änderung in seinem Worktree bleiben darf, bevor die Karte als „vermutlich festgefahren“ auf needs_you landet. Beides zusammen ist der Punkt: wer liest und denkt, schreibt nichts ins Terminal; wer kompiliert, schreibt keine Dateien. Ein leeres Feld nimmt den Standard.",
} as const;
