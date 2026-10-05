import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BoardCard, Worker } from "../types";
import BoardView from "./BoardView";

const runLearningCritic = vi.fn(() => new Promise<number>(() => undefined));

vi.mock("../lib/ipc", () => ({
  runLearningCritic: () => runLearningCritic(),
  openExternal: vi.fn(),
  describeError: (cause: unknown) => String(cause),
}));

vi.mock("../lib/diff", () => ({
  useDiffSummary: () => ({ loading: false, error: null, summary: null }),
}));

const worker: Worker = {
  id: "worker-a",
  projectId: "project-a",
  task: "Finished task",
  profileId: "codex",
  branch: "nacht/worker-a",
  worktreePath: "/tmp/worker-a",
  sessionId: "session-a",
  status: "exited",
  kind: "worker",
  spawnedBy: null,
  pausedReason: null,
  createdAt: 1,
};

const card: BoardCard = {
  worker,
  column: "done",
  attentionReason: null,
  attentionCode: null,
  attentionGrade: null,
  prUrl: null,
  contextUsage: null,
  controlledBy: null,
  testStatus: null,
  testedAt: null,
};

const props = {
  cards: [card],
  coordinators: [],
  profiles: [],
  activeWorkerId: null,
  hasProject: true,
  testCommand: null,
  githubRemote: false,
  loading: false,
  error: null,
  busyWorkerId: null,
  onNew: vi.fn(),
  onOpen: vi.fn(),
  onOpenDiff: vi.fn(),
  onRespawn: vi.fn(),
  onMove: vi.fn(),
  onOpenCoordinator: vi.fn(),
  onRunTests: vi.fn(() => Promise.resolve()),
  onMerge: vi.fn(() => Promise.resolve()),
};

describe("BoardView", () => {
  it("F-8 keeps a running Learning critic visible when the board is revisited", () => {
    const mounted = render(<BoardView {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Learning" }));
    expect(screen.getByRole("button", { name: "Learning…" })).toBeDisabled();

    mounted.unmount();
    render(<BoardView {...props} />);

    expect(screen.getByRole("button", { name: "Learning…" })).toBeDisabled();
  });

  it("explains a budget-paused worker instead of letting it look merely exited", () => {
    const paused: BoardCard = {
      ...card,
      worker: { ...worker, sessionId: null, pausedReason: "Tagesbudget erschöpft" },
    };
    render(<BoardView {...props} cards={[paused]} />);
    expect(screen.getByText("Pausiert: Tagesbudget erschöpft")).toBeInTheDocument();
  });

  it("renders no paused hint for an ordinary worker", () => {
    const { container } = render(<BoardView {...props} />);
    expect(container.querySelectorAll(".info-line")).toHaveLength(0);
  });

  it("hides the hierarchy strip when nobody spawned anybody", () => {
    render(<BoardView {...props} />);
    expect(screen.queryByText(/Hierarchie/)).not.toBeInTheDocument();
  });

  it("nests a coordinator's workers in the hierarchy strip", () => {
    const boss: BoardCard = {
      ...card,
      worker: { ...worker, id: "boss", task: "Orchestrate", kind: "orchestrator" },
    };
    const child: BoardCard = {
      ...card,
      worker: { ...worker, id: "child", task: "Delegate task", spawnedBy: "boss" },
    };
    render(<BoardView {...props} cards={[boss, child]} />);
    expect(screen.getByText(/Hierarchie/)).toBeInTheDocument();
    // The coordinator sits on no card (coordinators never do) — its name
    // exists only in the tree; the child's name is on its card and the tree.
    expect(screen.getAllByText("Orchestrate")).toHaveLength(1);
    expect(screen.getAllByText("Delegate task")).toHaveLength(2);
  });
});

describe("BoardView placeholder states", () => {
  const columnTitles = (container: HTMLElement) =>
    Array.from(container.querySelectorAll(".board-column-title"), (node) => node.textContent);

  it("loading keeps the board frame and announces itself as busy", () => {
    const { container } = render(<BoardView {...props} cards={[]} loading />);
    expect(container.querySelector(".board")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Board wird geladen");
    expect(container.querySelectorAll(".board-column")).toHaveLength(5);
    expect(container.querySelectorAll(".board-skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("empty explains the board in one sentence and offers the one action", () => {
    const onNew = vi.fn();
    const { container } = render(<BoardView {...props} cards={[]} onNew={onNew} />);
    expect(screen.getByText(/Das Board zeigt, woran deine Worker arbeiten/)).toBeInTheDocument();
    expect(container.querySelector(".board")).toHaveAttribute("aria-busy", "false");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Neuer Worker" }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("failed says what happened and what to do with the raw text one click away", () => {
    render(<BoardView {...props} cards={[]} error="database is locked" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Was ist passiert?");
    expect(alert).toHaveTextContent("Was du tun kannst:");
    expect(alert).toHaveTextContent("alle paar Sekunden");
    expect(alert.querySelector("details pre")).toHaveTextContent("database is locked");
    expect(screen.queryByRole("button", { name: "Neuer Worker" })).not.toBeInTheDocument();
  });

  it("all three states draw the same five column heads as the loaded board", () => {
    const loaded = columnTitles(render(<BoardView {...props} />).container);
    expect(loaded).toHaveLength(5);
    for (const extra of [{ loading: true }, {}, { error: "boom" }]) {
      const { container, unmount } = render(<BoardView {...props} cards={[]} {...extra} />);
      expect(columnTitles(container)).toEqual(loaded);
      unmount();
    }
  });

  it("a silent refresh or a stale error never replaces cards that are there", () => {
    render(<BoardView {...props} loading error="boom" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Finished task")).toBeInTheDocument();
  });
});

describe("BoardView accessibility (ui-ux-pro-max audit)", () => {
  it("APP-4: the column menu trigger has a name a screen reader can say", () => {
    const active: BoardCard = { ...card, column: "working", worker: { ...worker, status: "running" } };
    render(<BoardView {...props} cards={[active]} />);
    expect(screen.getByRole("button", { name: "In Spalte verschieben" })).toBeInTheDocument();
  });

  it("APP-13 column menu takes focus and walks with the arrows and gives focus back", () => {
    const active: BoardCard = { ...card, column: "working", worker: { ...worker, status: "running" } };
    render(<BoardView {...props} cards={[active]} />);
    const trigger = screen.getByRole("button", { name: "In Spalte verschieben" });
    trigger.focus();
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "In Spalte verschieben" });
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    expect(menu.querySelector(".card-menu-title")).toHaveAttribute("role", "presentation");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});
