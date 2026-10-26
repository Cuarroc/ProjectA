export const fileTexts = {
  group: "Geänderte Dateien",
  file: (label: string) => `Datei ${label}`,
  review: (label: string, explanation: string) => `Prüfstufe ${label}: ${explanation}`,
  binary: "bin",
  comments: (count: number) => `${count} Kommentar(e)`,
};
