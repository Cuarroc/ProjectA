/**
 * Rev-9 product goals. The shell maps each goal onto existing surfaces;
 * this module is the only list the ViewBar is allowed to render.
 */

export const APP_GOALS = [
  "work",
  "attention",
  "agents",
  "review",
  "insights",
  "settings",
] as const;

export type AppGoal = (typeof APP_GOALS)[number];

/** Key of a goal's visible name in `src/i18n/de.ts`; the ids above stay internal. */
export function goalLabelKey(goal: AppGoal): `goal.${AppGoal}` {
  return `goal.${goal}`;
}

export const GOAL_TITLES: Record<AppGoal, string> = {
  work: "Orchestrator-Dialog, Board und Backlog",
  attention: "Fragen, Fehler, Quota-Blocks, Empfehlungen, Merge-Blocker",
  agents: "Terminals und Sessionzustand",
  review: "Diff, Tests, Readiness und Merge",
  insights: "Kosten, Usage, Aktivität",
  settings: "Presets, Routing, Diagnose und App-Einstellungen",
};

/** Labels that must not appear as a top-level goal. */
export const RETIRED_NAV_LABELS = [
  "Dialog",
  "Board",
  "Fragen",
  "Workers",
  "Design",
  "Usage",
  "Statistik",
  "Aktivität",
  "Diagnose",
] as const;
