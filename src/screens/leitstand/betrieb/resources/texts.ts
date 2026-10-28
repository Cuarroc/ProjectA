export const T = {
  appData: "App-Daten-Verzeichnis",
  atLeast: (size: string) => `mindestens ${size}`,
  completenessUnknown: (size: string) => `${size} (Vollständigkeit unbekannt)`,
} as const;
