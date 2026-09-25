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

describe("BoardView accessibility (ui-ux-pro-max audit)", () => {
  it("APP-4: the column menu trigger has a name a screen reader can say", () => {
    const active: BoardCard = { ...card, column: "working", worker: { ...worker, status: "running" } };
    render(<BoardView {...props} cards={[active]} />);
    expect(screen.getByRole("button", { name: "Move to column" })).toBeInTheDocument();
  });

  it("APP-13 column menu takes focus and walks with the arrows and gives focus back", () => {
    const active: BoardCard = { ...card, column: "working", worker: { ...worker, status: "running" } };
    render(<BoardView {...props} cards={[active]} />);
    const trigger = screen.getByRole("button", { name: "Move to column" });
    trigger.focus();
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Move to column" });
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
