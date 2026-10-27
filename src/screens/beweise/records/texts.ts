/** Passive display copy shared with the later recorded-observations region. */
export const T = {
  region: "Aufgezeichnete Beobachtungen",
  loading: "Beobachtungen werden geladen …",
  readError: "Beobachtungen konnten nicht gelesen werden",
  emptyProject: "Keine aufgezeichneten Beobachtungen in diesem Projekt",
  noWorker: "Keine aufgezeichneten Beobachtungen für diesen Worker",
  reload: "Beobachtungen neu laden",
  candidate: "Kandidat",
  evidence: "Belege",
  reviews: "Reviews",
  measurement: "Messwert",
  source: "Quelle",
  observedAt: "Beobachtet am",
  unavailable: "Nicht verfügbar",
  unverified: "Ungeprüft",
  approvalUnavailable: "Freigabe nicht verfügbar",
  sources: { git: "Git", "test-gate": "Aufgezeichnete Testquelle", unverified: "Ungeprüfte Quelle" },
  states: {
    intent: "Absicht erfasst", launched: "Start erfasst", reconciling: "Abgleich erfasst",
    completed: "Beendet", failed: "Fehler erfasst",
  },
  associations: { current: "Dem Kandidaten zugeordnet", stale: "Veraltet", unassigned: "Nicht zugeordnet" },
} as const;
