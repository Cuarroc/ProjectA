// German words of the Agent-starten sheet. Moves into the dictionary (src/i18n) once
// the Leitstand mount lands.
export const T = {
  group: "Persona und Weg",
  loading: "Wird gelesen …",
  profilesOffline: "Personas nicht lesbar",
  profilesOfflineHint: "Der Kern antwortet gerade nicht.",
  retry: "Erneut versuchen",
  profilesEmpty: "Keine Persona eingeschaltet",
  profilesEmptyHint: "Schalte unter Personas mindestens eine ein.",
  modelUnpinned: "Modell wird beim Start beobachtet",
  modelRequest: (model: string) => `Modellvorgabe: ${model}`,
  quotaFree: "frei",
  quotaUnknown: "unbekannt",
  failover: (name: string) => `Failover: ${name}`,
  place: "Ort",
  placeOffline: "Ort noch nicht verbunden",
  placeNote: "V2-B5 Kern gemergt, nicht verdrahtet",
  effort: "Aufwand",
  effortOffline: "Aufwand noch nicht verbunden",
  mcp: "MCP",
  mcpOffline: "MCP noch nicht verbunden",
  mcpNote: "V2-B19",
} as const;
