// German words of the Organigramm tab. Moves into the dictionary (src/i18n) once
// the Team mount lands.
export const T = {
  team: "Team",
  you: "Du",
  direct: "Direkt bei dir",
  loading: "Wird gelesen …",
  offline: "Team nicht lesbar",
  offlineHint: "Der Kern antwortet gerade nicht.",
  empty: "Noch kein Agent im Team",
  emptyHint: "Sobald ein Agent läuft, erscheint er hier unter seinem Koordinator.",
  noAgents: "Noch keine Agenten",
  departments: "Abteilungen",
  departmentsOffline: "Abteilungen noch nicht verbunden",
  departmentsPackage: "V2-B18 (noch nicht gebaut)",
  budgetUnreadable: "Budgetgrenze nicht lesbar",
  budgetNone: "keine Budgetgrenze",
  noLimit: "keine Grenze",
  windows: (five: string, seven: string) => `5 Stunden: ${five}, 7 Tage: ${seven}`,
  percent: (n: number) => `${n} %`,
  kind: { worker: "Agent", orchestrator: "Orchestrator", queen: "Queen", scout: "Scout" },
} as const;
