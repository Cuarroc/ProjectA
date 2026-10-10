// Every UI word of the Leitstand cards. Moves into the dictionary (src/i18n)
// once V2-F6 is on main; until then German is hard-wired in this one file.
export const T = {
  agents: "Agenten",
  filterGroup: "Agenten nach Zustand filtern",
  all: "Alle",
  none: "Kein Agent in diesem Zustand.",
  showAll: "Alle zeigen",
  emptyTitle: "Noch kein Agent",
  emptyHint: "Sobald ein Agent läuft, erscheint hier seine Karte.",
  proofTitle: "Beweis nicht verbunden",
  open: "Öffnen",
  since: (age: string) => `seit ${age}`,
  openLabel: (name: string) => `${name} öffnen`,
  min: (n: number) => `${n} min`,
  hours: (n: number) => `${n} h`,
  days: (n: number) => `${n} T`,
  justNow: "gerade eben",
} as const;
