// German words of the profile budget fields. Moves into the dictionary (src/i18n) once the Einstellungen mount lands.
export const T = {
  group: (profileName: string) => `Budget: ${profileName}`,
  five: "5 h",
  seven: "7 T.",
  empty: "—",
  save: "Budget",
} as const;
