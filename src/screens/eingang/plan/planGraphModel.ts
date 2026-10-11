import type { DevelopmentPlanPackage } from "../../../types";

/** `unknown`: dependency ids that name no package at all, `removedDeps`: ids of tombstoned packages; neither raises the Ebene. */
export interface PlanNode { id: string; title: string; dependencyIds: string[]; noNewDispatch: boolean; unknown: string[]; removedDeps: string[] }

/** `levels[n]` = Ebene n (sorted by id); `cycle` has no Ebene; `critical` = longest chain, empty below two packages. */
export interface PlanLayout { levels: PlanNode[][]; cycle: PlanNode[]; critical: string[]; removed: number }

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Pure layout of a plan projection: Ebenen, cycles and the critical path. Tombstones are counted, never placed. */
export function layoutPlan(packages: readonly DevelopmentPlanPackage[]): PlanLayout {
  const live = new Map(packages.filter((p) => !p.removed).map((p) => [p.packageId, p]));
  const dead = new Set(packages.filter((p) => p.removed).map((p) => p.packageId));
  const edges = new Map([...live].map(([id, p]) => [id, [...new Set(p.dependencyIds)].filter((d) => live.has(d))]));
  const known = (id: string) => edges.get(id)!;
  const nodes = new Map<string, PlanNode>([...live].map(([id, p]) => [id, {
    id, title: p.title, dependencyIds: p.dependencyIds, noNewDispatch: p.noNewDispatch,
    unknown: [...new Set(p.dependencyIds)].filter((d) => !live.has(d) && !dead.has(d)),
    removedDeps: [...new Set(p.dependencyIds)].filter((d) => !live.has(d) && dead.has(d)),
  }]));
  // A package is on a cycle when it can reach itself along its dependencies.
  const onCycle = (id: string) => {
    const seen = new Set<string>();
    const stack = [...known(id)];
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
    levels,
    cycle: [...cyclic].sort(byId).map((id) => nodes.get(id)!),
    critical,
    removed: packages.length - live.size,
  };
}
