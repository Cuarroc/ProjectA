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

/** True when an old view is housed under this route (others still show the shell placeholder). */
export function hasLegacyPanel(path: string): boolean {
  return Object.values(GOAL_ROUTE).includes(base(path));
}

/** Goal to show for a route; the current one is kept while it already belongs there. */
export function goalForPath(path: string, current: AppGoal): AppGoal {
  if (GOAL_ROUTE[current] === base(path)) return current;
  const goal = (Object.keys(GOAL_ROUTE) as AppGoal[]).find((g) => GOAL_ROUTE[g] === base(path));
  return goal ?? current;
}

/** Hash to write after the old UI changed goal itself, or null when the route already fits. */
export function hashForGoal(goal: AppGoal, path: string): string | null {
  return GOAL_ROUTE[goal] === base(path) ? null : `#${GOAL_ROUTE[goal]}`;
}
