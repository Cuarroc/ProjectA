import type { DevelopmentPlanPackage } from "../../../types";

export interface PlanNode {
  id: string;
  title: string;
  dependencyIds: string[];
  noNewDispatch: boolean;
  /** Dependency ids that name no live package; they never raise the level. */
  unknown: string[];
}

export interface PlanLayout {
  /** Index = Ebene; each column sorted by package id. */
  levels: PlanNode[][];
  /** Packages on a dependency cycle (they have no Ebene), sorted by id. */
  cycle: PlanNode[];
  /** Longest dependency chain, first predecessor first; empty without a chain of two. */
  critical: string[];
  removed: number;
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Pure layout of a plan projection: Ebenen, cycles and the critical path. Tombstones are counted, never placed. */
export function layoutPlan(packages: readonly DevelopmentPlanPackage[]): PlanLayout {
  const live = new Map(packages.filter((p) => !p.removed).map((p) => [p.packageId, p]));
  const known = (id: string) => [...new Set(live.get(id)!.dependencyIds)].filter((d) => live.has(d));
  const nodes = new Map<string, PlanNode>();
  for (const [id, p] of live) {
    nodes.set(id, {
      id, title: p.title, dependencyIds: p.dependencyIds, noNewDispatch: p.noNewDispatch,
      unknown: [...new Set(p.dependencyIds)].filter((d) => !live.has(d)),
    });
  }
  // A package is on a cycle when it can reach itself along its dependencies.
  const onCycle = (id: string) => {
    const seen = new Set<string>();
    const stack = known(id);
    while (stack.length) {
      const next = stack.pop()!;
      if (next === id) return true;
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(...known(next));
      }
    }
    return false;
  };
  const cyclic = new Set([...live.keys()].filter(onCycle));
  // Cycle members are skipped, so the recursion only walks the acyclic rest and always ends.
  const level = new Map<string, number>();
  const levelOf = (id: string): number => {
    let n = level.get(id);
    if (n === undefined) {
      n = Math.max(-1, ...known(id).filter((d) => !cyclic.has(d)).map(levelOf)) + 1;
      level.set(id, n);
    }
    return n;
  };
  const free = [...live.keys()].filter((id) => !cyclic.has(id)).sort(byId);
  const levels: PlanNode[][] = [];
  for (const id of free) (levels[levelOf(id)] ??= []).push(nodes.get(id)!);

  let end = free[0];
  for (const id of free) if (levelOf(id) > levelOf(end)) end = id;
  const critical: string[] = [];
  if (end !== undefined && levelOf(end) > 0) {
    for (let at: string | undefined = end; at !== undefined; ) {
      critical.unshift(at);
      at = known(at).filter((d) => !cyclic.has(d) && levelOf(d) === levelOf(at!) - 1).sort(byId)[0];
    }
  }
  return {
    levels: Array.from(levels, (col) => col ?? []),
    cycle: [...cyclic].sort(byId).map((id) => nodes.get(id)!),
    critical,
    removed: packages.length - live.size,
  };
}
