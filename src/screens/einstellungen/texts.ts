// Every UI word of the Einstellungen screen. Moves into the dictionary (src/i18n)
// once V2-F6 is on main; until then German is hard-wired in this one file.
export const T = {
  title: "Einstellungen",
  tabs: "Einstellungen-Bereiche",
  appearance: "Darstellung",
  appearanceHint: "Hell, Dunkel oder dem System folgen; darunter der Glas-Stil.",
  preview: "Neue Oberfläche (Vorschau)",
  version: "Version & Updates",
  versionOff: "Nur in der Desktop-App verfügbar.",
  check: "Nach Updates suchen",
  checking: "Suche läuft …",
  upToDate: "ProjectA ist aktuell.",
  available: (v: string) => `Version ${v} ist verfügbar. Installieren geht in den klassischen Einstellungen.`,
  stop: "Not-Aus",
  more: "Weitere Einstellungen",
  moreHint: "Bis diese Seite alles kann, liegen die übrigen Einstellungen in der klassischen Ansicht.",
  moreOpen: "Klassische Einstellungen öffnen",
  tabHint: "Dieser Bereich ist in der neuen Oberfläche noch nicht verbunden.",
} as const;
