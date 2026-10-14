import type { Worker } from "../../../types";
import { buildWorkerTree, type WorkerNode } from "../../../lib/workerTree";

/** One worker on the flow grid: `x` is a column, `y` and `depth` the row under its coordinator. */
export interface FlowNode {
  id: string;
  x: number;
  y: number;
  depth: number;
}

/** A parent→child line, only for a child `buildWorkerTree` actually nested. */
export interface FlowEdge {
  from: string;
  to: string;
}

export interface FlowLayout {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * Grid positions for the live agent flow. Every leaf gets its own column in
 * tree order and a parent sits in the column of its first child, so no two
 * nodes share a cell and the same input always gives the same coordinates.
 * Cycle cutting and "a missing parent leaves the worker a root" come from
 * `buildWorkerTree`; the layout never invents a parent.
 */
export function layoutFlow(workers: Worker[]): FlowLayout {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  let nextColumn = 0;

  const place = ({ worker, children }: WorkerNode, depth: number): number => {
    const slot = nodes.push({ id: worker.id, x: 0, y: depth, depth }) - 1;
    let x = nextColumn;
    children.forEach((child, index) => {
      edges.push({ from: worker.id, to: child.worker.id });
      const childX = place(child, depth + 1);
      if (index === 0) x = childX;
    });
    if (children.length === 0) nextColumn += 1;
    nodes[slot].x = x;
    return x;
  };

  for (const root of buildWorkerTree(workers)) place(root, 0);
  return { nodes, edges };
}
