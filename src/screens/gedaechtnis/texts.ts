// Every UI word of the Lektionen approval list. Moves into the dictionary (src/i18n)
// together with the other v2 screens; until then German is hard-wired in this one file.
export const T = {
  title: "Lektionen zur Freigabe",
  hint: "Was die Agenten aus ihren Läufen gelernt haben. Übernommen kommt es ins Playbook.",
  loading: "Lektionen werden geladen …",
  empty: "Keine offenen Lektionen.",
  noProject: "Kein Projekt gewählt.",
  loadFailed: "Die Lektionen konnten nicht geladen werden.",
  retry: "Erneut versuchen",
  approve: "Übernehmen",
  reject: "Verwerfen",
  working: "Einen Moment …",
  approved: "Ins Playbook übernommen.",
  rejected: "Verworfen.",
  approveFailed: "Die Lektion konnte nicht übernommen werden. Bitte noch einmal versuchen.",
  rejectFailed: "Die Lektion konnte nicht verworfen werden. Bitte noch einmal versuchen.",
  noPattern: "Ohne Muster",
} as const;
