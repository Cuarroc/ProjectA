export const sharpenTexts = {
  action: "Schärfen",
  phase: {
    idle: "",
    thinking: "Schärft …",
    waiting: "Wartet auf dich …",
    finishing: "Baut Prompt …",
  },
  oneQuestion: "Eine Rückfrage wartet. ",
  questions: (count: number) => `${count} Rückfragen warten. `,
  openQuestions: "→ Rückfragen öffnen",
  cancel: "Schärfung abbrechen",
  title: "Den Entwurf vom Prompt-Master schärfen lassen — sendet nicht. Bei einer " +
    "vagen Aufgabe kommen erst Rückfragen zurück, die in der Ansicht „Achtung“ landen.",
} as const;
