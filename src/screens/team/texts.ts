// Every UI word of Team › Personas. Moves into the dictionary (src/i18n)
// once V2-F6 is on main; until then German is hard-wired in this one file.
export const T = {
  title: "Agenten",
  lead: "Personas und Vorlagen: fertige Rollen mit Modell, Werkzeugen und Rechten.",
  filterGroup: "Nach Anbieter filtern",
  all: "Alle",
  gallery: "Personas",
  noModel: "Modell nicht angegeben",
  disabled: "Deaktiviert",
  notConnected: "noch nicht verbunden",
  facts: { failover: "Failover", rights: "Rechte", autonomy: "Autonomie", mcp: "MCP-Server" },
  emptyTitle: "Noch keine Persona",
  emptyHint: "Sobald der Kern Agentenprofile meldet, erscheint hier je eines als Karte.",
  noneInFilter: "Keine Persona bei diesem Anbieter.",
  showAll: "Alle zeigen",
  loading: "Personas werden geladen …",
  errorTitle: "Personas konnten nicht geladen werden",
  retry: "Erneut laden",
} as const;
