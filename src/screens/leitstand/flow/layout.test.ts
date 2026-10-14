import { describe, expect, it } from "vitest";

import type { Worker } from "../../../types";
import { layoutFlow } from "./layout";

function worker(id: string, spawnedBy: string | null): Worker {
  return {
    id,
    projectId: "project-a",
    task: `Task ${id}`,
    profileId: "codex",
    branch: `pa/${id}`,
    worktreePath: `/tmp/${id}`,
    sessionId: null,
    status: "running",
    kind: "worker",
    spawnedBy,
    pausedReason: null,
    createdAt: 1,
  };
}

const at = (layout: ReturnType<typeof layoutFlow>, id: string) => {
  const node = layout.nodes.find((candidate) => candidate.id === id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return node;
};

describe("layoutFlow", () => {
  it("places a child below the worker that spawned it", () => {
    const layout = layoutFlow([worker("p", null), worker("c", "p")]);
    expect(layout.edges).toEqual([{ from: "p", to: "c" }]);
    expect(at(layout, "c").y).toBeGreaterThan(at(layout, "p").y);
    expect(at(layout, "c").depth).toBe(1);
  });

  it("draws no edge when the parent is absent", () => {
    const layout = layoutFlow([worker("w", "missing")]);
    expect(layout.nodes.map((node) => node.id)).toEqual(["w"]);
    expect(layout.edges).toEqual([]);
  });

  it("returns nothing for no workers", () => {
    expect(layoutFlow([])).toEqual({ nodes: [], edges: [] });
  });

  it("keeps siblings apart and is stable for the same input", () => {
    const workers = [
      worker("boss", null),
      worker("a", "boss"),
      worker("b", "boss"),
      worker("deep", "a"),
      worker("solo", "boss"),
      worker("self", "self"),
    ];
    const layout = layoutFlow(workers);
    expect(layoutFlow(workers)).toEqual(layout);
    expect(layout.nodes.map((node) => node.id).sort()).toEqual(
      ["a", "b", "boss", "deep", "self", "solo"],
    );
    const cells = layout.nodes.map((node) => `${node.x},${node.y}`);
    expect(new Set(cells).size).toBe(cells.length);
    for (const node of layout.nodes) {
      expect(Number.isInteger(node.x) && node.x >= 0).toBe(true);
    }
    expect(layout.edges).toHaveLength(4);
  });

  it("keeps every worker of a spawn cycle and draws an edge only where nested", () => {
    const layout = layoutFlow([worker("a", "b"), worker("b", "a")]);
    expect(layout.nodes.map((node) => node.id).sort()).toEqual(["a", "b"]);
    expect(layout.edges).toHaveLength(1);
    const [{ from, to }] = layout.edges;
    expect(at(layout, to).y).toBeGreaterThan(at(layout, from).y);
  });
});
