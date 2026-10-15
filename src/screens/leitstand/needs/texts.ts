// Words of the three decision rows in "Braucht dich". German is hard-wired here
// until the dictionary takes over (see src/i18n/hardcoded.test.ts).
export const T = {
  none: "Keine offene Entscheidung.",
  money: { title: "Geld", rule: "Geld ausgeben braucht deine Freigabe." },
  install: { title: "Installieren", rule: "Installieren braucht deine Freigabe." },
  delete: { title: "Löschen", rule: "Löschen braucht deine Freigabe." },
} as const;
