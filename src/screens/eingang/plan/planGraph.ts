import type { DevelopmentPlanPackage } from "../../../types";

export interface PlanNode {
  id: string;
  title: string;
  dependencyIds: string[];
  noNewDispatch: boolean;
  unknown: string[];
}

export interface PlanLayout {
  levels: PlanNode[][];
  cycle: PlanNode[];
  critical: string[];
  removed: number;
}

/** Stub: the red-first commit compiles but computes nothing. */
export function layoutPlan(_packages: readonly DevelopmentPlanPackage[]): PlanLayout {
  return { levels: [], cycle: [], critical: [], removed: 0 };
}
