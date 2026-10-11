// German words of the Plan graph. Moves into the dictionary (src/i18n) once
// the Eingang mount lands.
export const T = {
  /** Message of the core for a plan that was never imported (store/development_plan.rs). */
  unimportedMarker: "unknown project or plan",
  loading: "Wird gelesen …",
  level: (n: number) => `Ebene ${n}`,
  cycle: "Kreis",
  cycleHint: "Diese Pakete hängen im Kreis voneinander ab und haben keine Ebene.",
  critical: "kritischer Pfad",
  noDispatch: "kein neuer Start",
  after: (ids: readonly string[]) => `Nach: ${ids.join(", ")}`,
  unknown: (ids: readonly string[]) => `Unbekannter Vorgänger: ${ids.join(", ")}`,
  removed: (n: number) => `${n} ${n === 1 ? "Paket" : "Pakete"} entfernt, nicht gezeigt.`,
  source: (path: string, rev: string, projection: number) => `${path} · Stand ${rev} · Fassung ${projection}`,
  empty: "Der Plan enthält kein Paket",
  unimported: "Plan noch nicht eingelesen",
  unimportedHint: "Lies den Plan mit pa hq plan-import ein.",
  unreadable: "Plan nicht lesbar",
  unreadableHint: "Der Kern antwortet gerade nicht.",
  forecast: "Vorhersage",
  forecastTitle: "zu wenig Daten",
  forecastHint: "Eine Vorhersage braucht mehrere Wochen echten Durchsatz.",
  decisions: "Entscheidungen",
  decisionsTitle: "noch nicht verbunden",
  decisionsHint: "Die Oberfläche bekommt diese Angabe noch nicht vom Kern.",
} as const;
