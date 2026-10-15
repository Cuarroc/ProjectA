// V2-F9: how the old goals sit under the Glass routes (docs/plan/v2.0/ia.md section 4).
import type { AppGoal } from "../../lib/goals";

/** Route an old goal lives under; Work, Attention and Agents share the Leitstand. */
export const GOAL_ROUTE: Record<AppGoal, string> = {
  work: "/leitstand",
  attention: "/leitstand",
  agents: "/leitstand",
  review: "/beweise",
  insights: "/steuerung",
  settings: "/einstellungen",
};

const base = (path: string) => `/${path.split("/")[1] ?? ""}`;

export const trim = (path: string) => path.replace(/\/+$/, "");

export const TOOLS_PATH = "/leitstand/werkzeuge";
export const isTools = (path: string) => trim(path) === TOOLS_PATH;

export const isTerminal = (path: string) => trim(path.split("?")[0]) === "/leitstand/terminal";

export const isVerlauf = (path: string) => trim(path.split("?")[0]) === "/leitstand/verlauf";

/** The new Leitstand owns `/leitstand` (V2-S01a), `/leitstand/betrieb` (V2-S01b) and `/leitstand/fluss` (COMP-3-3); the rest below it stays the old view. */
export const isNewLeitstand = (path: string) => ["/leitstand", "/leitstand/betrieb", "/leitstand/fluss"].includes(trim(path));

/** The new Steuerung (V2-S05a) owns `/steuerung` and its tabs: Kontingente plus two honest placeholders. */
export const isNewSteuerung = (path: string) => base(trim(path)) === "/steuerung";

/** The Ersteinrichtung (V2-S11-M) owns exactly `/start`; it has no sidebar entry and no old view. */
export const isStart = (path: string) => trim(path) === "/start";

/** The new Einstellungen (V2-S10a) owns exactly `/einstellungen`; its classic button opens the old Settings below it. */
export const SETTINGS_PATH = "/einstellungen";
export const SETTINGS_CLASSIC_PATH = "/einstellungen/klassisch";
export const isNewEinstellungen = (path: string) => trim(path) === SETTINGS_PATH;

/** True when an old view is housed under this route (others still show the shell placeholder). */
export function hasLegacyPanel(path: string): boolean {
  return Object.values(GOAL_ROUTE).includes(base(path));
}

/** Keep the legacy viewer wherever the shell displays the legacy panel, or with D1 off. */
export function shouldMountLegacyTerminal(path: string | undefined): boolean {
  return path === undefined || (hasLegacyPanel(path)
    && !isNewLeitstand(path) && !isNewSteuerung(path) && !isNewEinstellungen(path)
    && !isStart(path) && !isTerminal(path) && !isVerlauf(path));
}

/** Goal to show for a route; the current one is kept while it already belongs there. */
export function goalForPath(path: string, current: AppGoal): AppGoal {
  if (isTools(path) || isTerminal(path)) return current;
  if (GOAL_ROUTE[current] === base(path)) return current;
  const goal = (Object.keys(GOAL_ROUTE) as AppGoal[]).find((g) => GOAL_ROUTE[g] === base(path));
  return goal ?? current;
}

/** Hash to write after the old UI changed goal itself, or null when the route already fits. */
export function hashForGoal(goal: AppGoal, path: string): string | null {
  return GOAL_ROUTE[goal] === base(path) ? null : `#${GOAL_ROUTE[goal]}`;
}
