import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DevelopmentPlanPackage } from "../../../types";
import { layoutPlan } from "./planGraph";
import { PlanGraph } from "./PlanGraph";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const pkg = (packageId: string, dependencyIds: string[] = [], extra: Partial<DevelopmentPlanPackage> = {}): DevelopmentPlanPackage => ({
  projectId: "p1", planId: "main", packageId, parentId: null, sourcePath: "plan.md", sourceRevision: "abcdef0123",
  sourceLine: 1, title: `Title ${packageId}`, dependencyIds, acceptance: "", removed: false, noNewDispatch: false, ...extra,
});
const response = (packages: DevelopmentPlanPackage[], projectionRevision = 7) => ({
  contractVersion: 1, availability: "available", generatedAt: 1, projectId: "p1", sourceRevision: "abcdef0123",
  projection: { projectId: "p1", planId: "main", sourcePath: "docs/plan.md", sourceRevision: "abcdef0123", projectionRevision,
    source: "import", rollbackReason: null, importedAt: 1, packages },
});
const ids = (nodes: { id: string }[]) => nodes.map((n) => n.id);

describe("layoutPlan", () => {
  it("levels follow the longest dependency chain", () => {
    const l = layoutPlan([pkg("d", ["b", "c"]), pkg("c", ["a"]), pkg("b", ["c"]), pkg("a"), pkg("e")]);
    expect(l.levels.map(ids)).toEqual([["a", "e"], ["c"], ["b"], ["d"]]);
  });

  it("an unknown dependency is reported and does not raise the level", () => {
    const l = layoutPlan([pkg("a", ["ghost"]), pkg("b", ["a", "gone"])]);
    expect(l.levels.map(ids)).toEqual([["a"], ["b"]]);
    expect(l.levels[0][0].unknown).toEqual(["ghost"]);
    expect(l.levels[1][0].unknown).toEqual(["gone"]);
  });

  it("a dependency cycle terminates and marks every member", () => {
    const l = layoutPlan([pkg("a", ["c"]), pkg("b", ["a"]), pkg("c", ["b"]), pkg("s", ["s"]), pkg("x", ["a"])]);
    expect(ids(l.cycle)).toEqual(["a", "b", "c", "s"]);
    expect(l.levels.map(ids)).toEqual([["x"]]);
  });

  it("the critical path is the longest chain with a stable tie break", () => {
    const l = layoutPlan([pkg("n", ["y"]), pkg("y"), pkg("m", ["z"]), pkg("z"), pkg("solo")]);
    expect(l.critical).toEqual(["z", "m"]);
    expect(layoutPlan([pkg("d", ["c", "b"]), pkg("c"), pkg("b")]).critical).toEqual(["b", "d"]);
    expect(layoutPlan([pkg("only"), pkg("other")]).critical).toEqual([]);
  });

  it("removed packages are not drawn and only counted", () => {
    const l = layoutPlan([pkg("a"), pkg("t", [], { removed: true })]);
    expect(l.levels.map(ids)).toEqual([["a"]]);
    expect(l.removed).toBe(1);
  });
});

describe("PlanGraph", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("renders one column per level with its chips and the source line", async () => {
    mocks.invoke.mockResolvedValue(response([
      pkg("a"), pkg("b", ["a", "ghost"], { noNewDispatch: true }), pkg("t", [], { removed: true }),
    ]));
    render(<PlanGraph projectId="p1" />);
    const first = within(await screen.findByRole("region", { name: "Ebene 0" }));
    expect(first.getByText("Title a")).toBeInTheDocument();
    expect(first.getAllByText("kritischer Pfad")).toHaveLength(1);
    const second = within(screen.getByRole("region", { name: "Ebene 1" }));
    expect(second.getByText("kein neuer Start")).toBeInTheDocument();
    expect(second.getByText("Unbekannter Vorgänger: ghost")).toBeInTheDocument();
    expect(screen.getByText(/docs\/plan\.md.*abcdef0.*7/)).toBeInTheDocument();
    expect(screen.getByText(/1 Paket entfernt/)).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith("get_development_plan", { projectId: "p1", planId: "main", revision: null });
  });

  it("an unimported plan shows Plan noch nicht eingelesen and no column", async () => {
    mocks.invoke.mockRejectedValue("unknown project or plan");
    render(<PlanGraph projectId="p1" />);
    expect(await screen.findByText("Plan noch nicht eingelesen")).toBeInTheDocument();
    expect(screen.getByText(/pa hq plan-import/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Ebene/ })).toBeNull();
  });

  it("another read error shows Plan nicht lesbar", async () => {
    mocks.invoke.mockRejectedValue(new Error("db locked"));
    render(<PlanGraph projectId="p1" />);
    expect(await screen.findByText("Plan nicht lesbar")).toBeInTheDocument();
    expect(screen.queryByText("Plan noch nicht eingelesen")).toBeNull();
  });

  it("forecast says zu wenig Daten and decisions are not connected", async () => {
    mocks.invoke.mockResolvedValue(response([pkg("a")]));
    render(<PlanGraph projectId="p1" />);
    await screen.findByRole("region", { name: "Ebene 0" });
    expect(within(screen.getByRole("region", { name: "Vorhersage" })).getByText("zu wenig Daten")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Entscheidungen" })).getByText("noch nicht verbunden")).toBeInTheDocument();
  });

  it("only get_development_plan is invoked and never import_development_plan", async () => {
    mocks.invoke.mockResolvedValue(response([pkg("a")]));
    render(<PlanGraph projectId="p1" />);
    await screen.findByRole("region", { name: "Ebene 0" });
    expect(mocks.invoke.mock.calls.map((c) => c[0])).toEqual(["get_development_plan"]);
  });

  it("ignores a late reply after the project round trip", async () => {
    const pending: Array<(v: unknown) => void> = [];
    mocks.invoke.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const { rerender } = render(<PlanGraph projectId="p1" />);
    rerender(<PlanGraph projectId="p2" />);
    rerender(<PlanGraph projectId="p1" />);
    expect(pending).toHaveLength(3);
    await act(async () => pending[0](response([pkg("stale")])));
    expect(screen.queryByText("Title stale")).toBeNull();
    await act(async () => pending[2](response([pkg("fresh")])));
    expect(await screen.findByText("Title fresh")).toBeInTheDocument();
    await act(async () => pending[1](response([pkg("other")])));
    expect(screen.queryByText("Title other")).toBeNull();
  });
});
