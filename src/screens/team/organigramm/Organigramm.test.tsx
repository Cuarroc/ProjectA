import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkerKind } from "../../../types";
import { KindBadge, Organigramm } from "./Organigramm";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getIdentifier: async () => "com.projecta.app" }));

const worker = (id: string, extra: Record<string, unknown> = {}) => ({
  id, projectId: "p1", task: `Task ${id}`, profileId: "pa", branch: `b-${id}`, worktreePath: "w",
  sessionId: null, status: "running", kind: "worker", spawnedBy: null, pausedReason: null, createdAt: 1, ...extra,
});
const card = (id: string, by: string | null, extra: Record<string, unknown> = {}) => ({
  worker: worker(id, extra), column: "working", attentionReason: null, attentionCode: null,
  controlledBy: by ? { workerId: by, kind: "queen", label: by } : null,
});
const coordinator = (id: string) => ({ workerId: id, kind: "queen", label: id, status: "running", sessionId: null });
const board = {
  cards: [
    card("a1", "Alpha"), card("a2", "Alpha", { profileId: "pb" }), card("b1", "Beta", { profileId: "pc" }),
    card("o1", null), card("o2", "Gone"), card("Alpha", null, { kind: "queen" }),
  ],
  coordinators: [coordinator("Alpha"), coordinator("Beta")],
};
const profiles = [{ id: "pa", name: "Persona A" }, { id: "pb", name: "Persona B" }];
const budgets = [
  { profileId: "pa", fiveHourPct: 80, sevenDayPct: 40 },
  { profileId: "pb", fiveHourPct: 50, sevenDayPct: null },
];

function backend(over: Record<string, unknown> = {}) {
  const answers: Record<string, unknown> = { get_board_state: board, list_agent_profiles: profiles, get_budgets: budgets, ...over };
  mocks.invoke.mockImplementation(async (cmd: string) => {
    if (!(cmd in answers)) throw new Error(`unexpected ${cmd}`);
    const a = answers[cmd];
    if (a instanceof Error) throw a;
    return a;
  });
}
const nodeOf = (title: string) => screen.getByRole("heading", { name: title }).closest("li")!;

describe("Organigramm", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("agents hang under the coordinator that controls them", async () => {
    backend();
    render(<Organigramm projectId="p1" />);
    const alpha = within(await waitFor(() => nodeOf("Alpha")));
    expect(alpha.getByText("Task a1")).toBeInTheDocument();
    expect(alpha.getByText("Task a2")).toBeInTheDocument();
    expect(alpha.queryByText("Task b1")).toBeNull();
    expect(within(nodeOf("Beta")).getByText("Task b1")).toBeInTheDocument();
    expect(within(nodeOf("Du")).getByRole("heading", { name: "Alpha" })).toBeInTheDocument();
  });

  it("an agent without a known controller hangs under Direkt bei dir", async () => {
    backend();
    render(<Organigramm projectId="p1" />);
    const direct = within(await waitFor(() => nodeOf("Direkt bei dir")));
    expect(direct.getByText("Task o1")).toBeInTheDocument();
    expect(direct.getByText("Task o2")).toBeInTheDocument();
  });

  it("coordinator cards are not drawn as agents", async () => {
    backend();
    render(<Organigramm projectId="p1" />);
    await waitFor(() => nodeOf("Alpha"));
    expect(screen.queryByText("Task Alpha")).toBeNull();
  });

  it("budget windows read as percent or keine Grenze and an absent profile has keine Budgetgrenze", async () => {
    backend();
    render(<Organigramm projectId="p1" />);
    const alpha = within(await waitFor(() => nodeOf("Alpha")));
    expect(alpha.getByText("5 Stunden: 80 %, 7 Tage: 40 %")).toBeInTheDocument();
    expect(alpha.getByText("5 Stunden: 50 %, 7 Tage: keine Grenze")).toBeInTheDocument();
    expect(alpha.getByText("Persona A")).toBeInTheDocument();
    expect(within(nodeOf("Beta")).getByText("keine Budgetgrenze")).toBeInTheDocument();
  });

  it("a failed budget read shows no number and keeps the tree", async () => {
    backend({ get_budgets: new Error("down") });
    render(<Organigramm projectId="p1" />);
    const alpha = within(await waitFor(() => nodeOf("Alpha")));
    expect(alpha.getAllByText("Budgetgrenze nicht lesbar")).toHaveLength(2);
    expect(screen.queryByText(/%/)).toBeNull();
    expect(alpha.getByText("Task a1")).toBeInTheDocument();
  });

  it("a failed profile read or an unknown profile falls back to the raw id", async () => {
    backend({ list_agent_profiles: new Error("down") });
    render(<Organigramm projectId="p1" />);
    const alpha = within(await waitFor(() => nodeOf("Alpha")));
    expect(alpha.getByText("pa")).toBeInTheDocument();
    expect(alpha.getByText("pb")).toBeInTheDocument();
  });

  it("a failed board read shows Team nicht lesbar", async () => {
    backend({ get_board_state: new Error("down") });
    render(<Organigramm projectId="p1" />);
    expect(await screen.findByText("Team nicht lesbar")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Du" })).toBeNull();
  });

  it("an empty team says so in words", async () => {
    backend({ get_board_state: { cards: [], coordinators: [] } });
    render(<Organigramm projectId="p1" />);
    expect(await screen.findByText("Noch kein Agent im Team")).toBeInTheDocument();
  });

  it("coordinator kinds read in German and an English word never reaches the screen", async () => {
    backend({
      get_board_state: {
        cards: [],
        coordinators: [
          { workerId: "q", kind: "queen", label: "Nord", status: "running", sessionId: null },
          { workerId: "s", kind: "scout", label: "Sued", status: "running", sessionId: null },
          { workerId: "o", kind: "orchestrator", label: "Mitte", status: "running", sessionId: null },
        ],
      },
    });
    const { container } = render(<Organigramm projectId="p1" />);
    expect(await screen.findByText("♛ Königin")).toBeInTheDocument();
    expect(screen.getByText("🔍 Späher")).toBeInTheDocument();
    expect(screen.getByText("◆ Orchestrator")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Queen|Scout/);
  });

  it("the kind badge is hidden when the label already is the kind name", async () => {
    backend({
      get_board_state: {
        cards: [],
        coordinators: [{ workerId: "q", kind: "queen", label: "Königin", status: "running", sessionId: null }],
      },
    });
    render(<Organigramm projectId="p1" />);
    expect(await screen.findByRole("heading", { name: "Königin" })).toBeInTheDocument();
    expect(screen.queryByText(/♛/)).toBeNull();
  });

  it("an unknown coordinator kind from the backend shows its name without a badge", async () => {
    // The ipc layer folds an unknown kind into "worker"; the component must also survive one that slips through.
    const { container } = render(<KindBadge kind={"wizard" as WorkerKind} label="Merlin" />);
    expect(container).toBeEmptyDOMElement();
    backend({
      get_board_state: {
        cards: [],
        coordinators: [{ workerId: "x", kind: "wizard", label: "Merlin", status: "running", sessionId: null }],
      },
    });
    render(<Organigramm projectId="p1" />);
    expect(await screen.findByRole("heading", { name: "Merlin" })).toBeInTheDocument();
  });

  it("coordinator and Direkt bei dir sit one heading level below Du", async () => {
    backend();
    render(<Organigramm projectId="p1" />);
    await waitFor(() => nodeOf("Du"));
    expect(screen.getByRole("heading", { name: "Du", level: 3 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Alpha", level: 4 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Direkt bei dir", level: 4 })).toBeInTheDocument();
  });

  it("departments stay honest without an internal package note", async () => {
    backend();
    render(<Organigramm projectId="p1" />);
    const section = within(await screen.findByRole("region", { name: "Abteilungen" }));
    expect(section.getByText("Abteilungen noch nicht verbunden")).toBeInTheDocument();
    expect(section.queryByText(/V2-/)).toBeNull();
  });

  it("only the three read commands are invoked and never set_budget", async () => {
    backend();
    render(<Organigramm projectId="p1" />);
    await waitFor(() => nodeOf("Alpha"));
    const cmds = new Set(mocks.invoke.mock.calls.map((c) => c[0]));
    expect(cmds).toEqual(new Set(["get_board_state", "list_agent_profiles", "get_budgets"]));
  });

  it("a late reply of an earlier visit to the same project is ignored (p1 -> p2 -> p1)", async () => {
    const pending: Array<(v: unknown) => void> = [];
    mocks.invoke.mockImplementation((cmd: string) => {
      if (cmd === "get_board_state") return new Promise((resolve) => pending.push(resolve));
      return Promise.resolve(cmd === "get_budgets" ? budgets : profiles);
    });
    const { rerender } = render(<Organigramm projectId="p1" />);
    rerender(<Organigramm projectId="p2" />);
    rerender(<Organigramm projectId="p1" />);
    await waitFor(() => expect(pending).toHaveLength(3));
    pending[2]!({ cards: [card("fresh", null)], coordinators: [] });
    expect(await screen.findByText("Task fresh")).toBeInTheDocument();
    pending[0]!({ cards: [card("stale", null)], coordinators: [] });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Task stale")).toBeNull();
    expect(screen.getByText("Task fresh")).toBeInTheDocument();
  });

  it("retries a failed team read without changing the project", async () => {
    let boardCall = 0;
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_board_state") {
        boardCall += 1;
        if (boardCall === 1) throw new Error("down");
        return board;
      }
      return cmd === "list_agent_profiles" ? profiles : budgets;
    });
    render(<Organigramm projectId="p1" />);
    expect(await screen.findByText("Team nicht lesbar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Neu lesen" }));
    expect(await screen.findByText("Task a1")).toBeInTheDocument();
  });

  it("recovers an unreadable budget through a manual organigram reread", async () => {
    let budgetCall = 0;
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_budgets") {
        budgetCall += 1;
        if (budgetCall === 1) throw new Error("down");
        return budgets;
      }
      return cmd === "get_board_state" ? board : profiles;
    });
    render(<Organigramm projectId="p1" />);
    const alpha = within(await waitFor(() => nodeOf("Alpha")));
    expect(alpha.getAllByText("Budgetgrenze nicht lesbar")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Neu lesen" }));
    await waitFor(() => expect(alpha.getByText("5 Stunden: 80 %, 7 Tage: 40 %")).toBeInTheDocument());
    expect(alpha.queryByText("Budgetgrenze nicht lesbar")).toBeNull();
  });

  it("ignores an old organigram reread after a project round trip", async () => {
    const pending: Array<(v: unknown) => void> = [];
    mocks.invoke.mockImplementation((cmd: string) => {
      if (cmd === "get_board_state") return new Promise((resolve) => pending.push(resolve));
      return Promise.resolve(cmd === "get_budgets" ? budgets : profiles);
    });
    const { rerender } = render(<Organigramm projectId="p1" />);
    await waitFor(() => expect(pending).toHaveLength(1));
    pending[0]!({ cards: [card("initial", null)], coordinators: [] });
    expect(await screen.findByText("Task initial")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Neu lesen" }));
    await waitFor(() => expect(pending).toHaveLength(2));
    rerender(<Organigramm projectId="p2" />);
    await waitFor(() => expect(pending).toHaveLength(3));
    pending[2]!({ cards: [card("p2agent", null)], coordinators: [] });
    expect(await screen.findByText("Task p2agent")).toBeInTheDocument();
    rerender(<Organigramm projectId="p1" />);
    await waitFor(() => expect(pending).toHaveLength(4));
    pending[3]!({ cards: [card("fresh", null)], coordinators: [] });
    expect(await screen.findByText("Task fresh")).toBeInTheDocument();
    pending[1]!({ cards: [card("stale", null)], coordinators: [] });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Task stale")).toBeNull();
    expect(screen.queryByText("Task initial")).toBeNull();
    expect(screen.getByText("Task fresh")).toBeInTheDocument();
  });
});
