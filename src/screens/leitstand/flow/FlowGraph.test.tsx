import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOTION_MODE_KEY } from "../../../design/motion/motionMode";
import type { Worker } from "../../../types";
import { FlowGraph, type FlowLabel } from "./FlowGraph";
import { layoutFlow } from "./layout";
import { T } from "./texts";

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

function setup(workers: Worker[], renderNode?: Parameters<typeof FlowGraph>[0]["renderNode"]) {
  const labels: Record<string, FlowLabel> = {};
  for (const w of workers) labels[w.id] = { task: w.task, branch: w.branch };
  return render(<FlowGraph layout={layoutFlow(workers)} labels={labels} renderNode={renderNode} />);
}

function reducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matches && query === "(prefers-reduced-motion: reduce)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("FlowGraph", () => {
  it("shows the task and the branch of each agent on its node", () => {
    reducedMotion(false);
    setup([worker("p", null), worker("c", "p")]);
    const node = screen.getByRole("group", { name: /Task c/ });
    expect(within(node).getByText("Task c")).toBeInTheDocument();
    expect(within(node).getByText("pa/c")).toBeInTheDocument();
  });

  it("draws an edge from the parent node to the child", () => {
    reducedMotion(false);
    localStorage.setItem(MOTION_MODE_KEY, "lively");
    const { container } = setup([worker("p", null), worker("c", "p")]);
    const edges = container.querySelectorAll("[data-flow-edge]");
    expect(edges).toHaveLength(1);
    expect(edges[0]?.getAttribute("data-from")).toBe("p");
    expect(edges[0]?.getAttribute("data-to")).toBe("c");
    expect(edges[0]?.textContent).toBe("Task p startete Task c");
    expect(edges[0]?.classList.contains("fl-edge--moving")).toBe(true);
  });

  it("does not animate edges when reduced motion is requested", () => {
    reducedMotion(true);
    localStorage.setItem(MOTION_MODE_KEY, "lively");
    const { container } = setup([worker("p", null), worker("c", "p")]);
    expect(container.querySelectorAll("[data-flow-edge]")).toHaveLength(1);
    expect(container.querySelector(".fl-edge--moving")).toBeNull();
  });

  it("animates edges only in lively and not in calm or off", () => {
    reducedMotion(false);
    const moving = () => setup([worker("p", null), worker("c", "p")]).container.querySelector(".fl-edge--moving");
    expect(moving()).toBeNull();
    cleanup();
    localStorage.setItem(MOTION_MODE_KEY, "lively");
    expect(moving()).not.toBeNull();
    cleanup();
    localStorage.setItem(MOTION_MODE_KEY, "off");
    expect(moving()).toBeNull();
  });

  it("replaces only the node interior when renderNode is passed", () => {
    reducedMotion(false);
    const { container } = setup([worker("p", null), worker("c", "p")], (node) => <i>slot {node.id}</i>);
    expect(screen.getByText("slot c")).toBeInTheDocument();
    expect(screen.queryByText("pa/c")).toBeNull();
    expect(container.querySelectorAll("[data-flow-edge]")).toHaveLength(1);
  });

  it("says so in words when there are no agents and invents no parent", () => {
    reducedMotion(false);
    const { container } = setup([]);
    expect(screen.getByText(T.empty)).toBeInTheDocument();
    expect(screen.queryByRole("group")).toBeNull();
    expect(container.querySelector("[data-flow-edge]")).toBeNull();
  });
});
