import { describe, expect, it } from "vitest";

import type { Worker } from "../types";
import { buildWorkerTree, flattenWorkerTree, hasWorkerHierarchy } from "./workerTree";

function worker(id: string, spawnedBy: string | null, kind: Worker["kind"] = "worker"): Worker {
  return {
    id,
    projectId: "project-a",
    task: `Task ${id}`,
    profileId: "codex",
    branch: `pa/${id}`,
    worktreePath: `/tmp/${id}`,
    sessionId: null,
    status: "running",
    kind,
    spawnedBy,
    pausedReason: null,
    createdAt: 1,
  };
}

describe("buildWorkerTree", () => {
  it("keeps human-started workers flat", () => {
    const tree = buildWorkerTree([worker("a", null), worker("b", null)]);
    expect(tree.map((node) => node.worker.id)).toEqual(["a", "b"]);
    expect(tree.every((node) => node.children.length === 0)).toBe(true);
  });

  it("nests workers under the coordinator that spawned them", () => {
    const tree = buildWorkerTree([
      worker("boss", null, "orchestrator"),
      worker("a", "boss"),
      worker("b", "boss"),
      worker("grand", "a"),
    ]);
    expect(tree).toHaveLength(1);
    const [boss] = tree;
    expect(boss.worker.id).toBe("boss");
    expect(boss.children.map((node) => node.worker.id)).toEqual(["a", "b"]);
    expect(boss.children[0].children.map((node) => node.worker.id)).toEqual(["grand"]);
  });

  it("keeps workers flat when their coordinator is not in the list (the everyday case)", () => {
    const tree = buildWorkerTree([worker("a", "gone"), worker("b", "gone")]);
    expect(tree.map((node) => node.worker.id)).toEqual(["a", "b"]);
    expect(tree.every((node) => node.children.length === 0)).toBe(true);
  });

  it("treats a self-parent as a root", () => {
    const tree = buildWorkerTree([worker("a", "a")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(0);
  });

  it("cuts cycles instead of recursing forever, and nobody vanishes", () => {
    const tree = buildWorkerTree([worker("a", "b"), worker("b", "a")]);
    const flat = flattenWorkerTree(tree);
    expect(flat.map((row) => row.worker.id).sort()).toEqual(["a", "b"]);
    expect(flat.filter((row) => row.depth === 0)).toHaveLength(1);
  });
});

describe("flattenWorkerTree", () => {
  it("reports the depth of each row", () => {
    const tree = buildWorkerTree([
      worker("boss", null, "orchestrator"),
      worker("a", "boss"),
      worker("grand", "a"),
      worker("other", null),
    ]);
    const flat = flattenWorkerTree(tree);
    expect(flat.map((row) => [row.worker.id, row.depth])).toEqual([
      ["boss", 0],
      ["a", 1],
      ["grand", 2],
      ["other", 0],
    ]);
  });
});

describe("hasWorkerHierarchy", () => {
  it("is false without nesting — the strip would say nothing", () => {
    expect(hasWorkerHierarchy([worker("a", null), worker("b", "gone")])).toBe(false);
  });

  it("is true once a listed coordinator has a child", () => {
    expect(hasWorkerHierarchy([worker("boss", null, "orchestrator"), worker("a", "boss")])).toBe(
      true,
    );
  });
});
