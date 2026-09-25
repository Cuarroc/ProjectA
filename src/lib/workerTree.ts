import type { Worker } from "../types";

/** A worker with everyone it spawned nested underneath. */
export interface WorkerNode {
  worker: Worker;
  children: WorkerNode[];
}

/** One flattened tree row: how deep the row sits under its coordinator. */
export interface WorkerTreeRow {
  worker: Worker;
  depth: number;
}

/**
 * Nests a project's workers under the coordinator that spawned them (`spawnedBy`, booked by the core
 * via `--on-behalf-of`). Two kinds of roots are the norm, not the exception:
 * workers the human started (`spawnedBy === null`) and workers whose
 * coordinator is not in the list at all. Both stay flat at depth 0 — the
 * tree never invents a parent.
 */
export function buildWorkerTree(workers: Worker[]): WorkerNode[] {
  const ids = new Set(workers.map((worker) => worker.id));
  const byParent = new Map<string, Worker[]>();
  const roots: Worker[] = [];
  for (const worker of workers) {
    const parent = worker.spawnedBy;
    if (parent !== null && parent !== worker.id && ids.has(parent)) {
      const siblings = byParent.get(parent);
      if (siblings === undefined) byParent.set(parent, [worker]);
      else siblings.push(worker);
    } else {
      roots.push(worker);
    }
  }

  // A cycle (A spawned B, B spawned A) would recurse forever; the visited set
  // turns it into a cut, and whatever the cut left unreachable joins the roots
  // flat rather than vanishing from the board.
  const seen = new Set<string>();
  const toNode = (worker: Worker): WorkerNode => {
    seen.add(worker.id);
    return {
      worker,
      children: (byParent.get(worker.id) ?? [])
        .filter((child) => !seen.has(child.id))
        .map(toNode),
    };
  };
  const nodes = roots.map(toNode);
  for (const worker of workers) {
    if (!seen.has(worker.id)) nodes.push(toNode(worker));
  }
  return nodes;
}

/** Depth-first flattening for a plain indented list. */
export function flattenWorkerTree(nodes: WorkerNode[], depth = 0): WorkerTreeRow[] {
  return nodes.flatMap((node) => [
    { worker: node.worker, depth },
    ...flattenWorkerTree(node.children, depth + 1),
  ]);
}

/**
 * Whether the tree would show any nesting at all — the only state in which it
 * is worth a strip above the board. A parent counts only when it is actually
 * in the list; coordinators the list does not carry leave their workers flat,
 * and that is the everyday case.
 */
export function hasWorkerHierarchy(workers: Worker[]): boolean {
  const ids = new Set(workers.map((worker) => worker.id));
  return workers.some(
    (worker) => worker.spawnedBy !== null && ids.has(worker.spawnedBy),
  );
}
