import type { AgentCategoryConfig } from "../../../types";

// Every UI word of the categories panel; German is hard-wired here until the dictionary move.
export const T = {
  labels: {
    worker: "Worker",
    queen: "Queen",
    employee: "Employee",
    scout: "Scout",
    orchestrator: "Orchestrator",
  } satisfies Record<AgentCategoryConfig["id"], string>,
  historical: "Historisch",
  historicalName: "Queen historisch",
  profilePlaceholder: "Default Profile …",
  // Short visible switch words keep the description column wide; the aria-labels below repeat the category so every switch and select is unique on the page.
  activeWord: "Aktiv",
  learningWord: "Lernen",
  active: (name: string) => `Aktiv für ${name}`,
  learning: (name: string) => `Lernen für ${name}`,
  profile: (name: string) => `Default Profile für ${name}`,
};
