// German words of the Wartungsmodus panel. Moves into the dictionary (src/i18n) once the panel is routed.
export const T = {
  label: "Wartungsmodus",
  active: "Aktiv",
  hint: "Hält neue Arbeit an und sperrt Schreibzugriffe, damit ein Backup sicher ist.",
  start: "Wartungsmodus starten",
  leave: "Wartungsmodus beenden",
  title: "Wartungsmodus starten?",
  body: "Läuft noch ein Worker, wird der Start abgelehnt. Wirklich starten?",
  confirm: "Ja, Wartungsmodus starten",
  cancel: "Abbrechen",
} as const;
