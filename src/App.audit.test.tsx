import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { AttentionSource } from "./lib/attentionInbox";
import type { AgentProfile, Project, PtyExitPayload, Worker } from "./types";
import * as ipc from "./lib/ipc";

const attentionBlockers = vi.hoisted(() => ({
  current: [] as AttentionSource[],
}));

const projectA: Project = {
  id: "project-a",
  name: "Project A",
  repoPath: "/tmp/a",
  createdAt: 1,
  githubRemote: false,
  maxWorkers: null,
  testCommand: null,
};

const projectB: Project = { ...projectA, id: "project-b", name: "Project B", repoPath: "/tmp/b" };

function worker(id: string, projectId: string, sessionId: string | null = null): Worker {
  return {
    id,
    projectId,
    task: id,
    profileId: "enabled",
    branch: `nacht/${id}`,
    worktreePath: `/tmp/${id}`,
    sessionId,
    status: sessionId === null ? "exited" : "running",
    kind: "worker",
    spawnedBy: null,
    pausedReason: null,
    createdAt: 1,
  };
}

const profiles: AgentProfile[] = [
  {
    id: "enabled",
    name: "Enabled",
    command: "agent",
    args: [],
    env: {},
    fallback: null,
    enabled: true,
  },
  {
    id: "disabled",
    name: "Disabled",
    command: "agent",
    args: [],
    env: {},
    fallback: null,
    enabled: false,
  },
];

vi.mock("./lib/ipc", () => ({
  archiveWorker: vi.fn(),
  createOrchestrator: vi.fn(),
  createProject: vi.fn(),
  createWorker: vi.fn(),
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  // App fragt beim Mount nach einem Panic aus dem vorigen Lauf (P2-H) und
  // springt bei einem Treffer auf die Diagnose. Ohne diesen Mock stirbt
  // AppContent schon vor dem ersten Render und jeder Audit-Fall hier wird rot,
  // ohne dass sein eigentlicher Gegenstand je geprueft wurde.
  getPanicNotice: vi.fn(() => Promise.resolve({ current: null, previous: null })),
  killPty: vi.fn(),
  listAgentProfiles: vi.fn(),
  listProjects: vi.fn(),
  listWorkers: vi.fn(),
  onPtyExit: vi.fn(),
  removeProject: vi.fn(),
  mergeWorker: vi.fn(),
  respawnWorker: vi.fn(),
  runWorkerTests: vi.fn(),
  sendToOrchestrator: vi.fn(),
  setProjectMaxWorkers: vi.fn(),
  setProjectTestCommand: vi.fn(),
  setWorkerColumnOverride: vi.fn(),
  spawnPty: vi.fn(),
}));

vi.mock("./lib/useBoard", () => ({
  useBoard: () => ({
    cards: [],
    coordinators: [],
    attentionByWorker: {},
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock("./lib/useQuestions", () => ({
  useQuestions: () => ({
    open: [],
    history: [],
    loading: false,
    error: null,
    scope: "project",
    setScope: vi.fn(),
    refresh: vi.fn(),
    answer: vi.fn(),
  }),
}));

vi.mock("./lib/useAttentionBlockers", () => ({
  useAttentionBlockers: () => ({
    blockers: attentionBlockers.current,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock("./lib/orchestratorChat", () => ({
  useOrchestratorChat: () => ({
    orchestratorId: null,
    messages: [],
    sending: false,
    error: null,
    disabled: false,
    send: vi.fn(),
    clearError: vi.fn(),
  }),
}));

vi.mock("./components/Sidebar", () => ({
  default: (props: { children: ReactNode; onSelect: (id: string) => void }) => (
    <aside>
      <button type="button" onClick={() => props.onSelect("project-b")}>
        select project b
      </button>
      {props.children}
    </aside>
  ),
}));

vi.mock("./components/QueuePanel", () => ({
  default: (props: { onFocusWorker: (id: string) => void }) => (
    <button type="button" onClick={() => props.onFocusWorker("worker-a")}>
      focus queued worker
    </button>
  ),
}));

vi.mock("./components/ViewBar", () => ({
  default: (props: { onNewWorker: () => void; onChange: (goal: string) => void }) => (
    <>
      <button type="button" onClick={props.onNewWorker}>
        new worker
      </button>
      <button type="button" onClick={() => props.onChange("attention")}>
        open attention
      </button>
    </>
  ),
}));

vi.mock("./components/WorkerPanel", () => ({
  default: (props: { workers: Worker[] }) => (
    <div data-testid="workers">{props.workers.map((entry) => entry.id).join(",")}</div>
  ),
}));

vi.mock("./components/NewWorkerDialog", () => ({
  default: (props: { profiles: AgentProfile[] }) => (
    <div data-testid="new-worker-profiles">
      {props.profiles.map((profile) => profile.id).join(",")}
    </div>
  ),
}));

vi.mock("./components/ActivityView", () => ({ default: () => null }));
vi.mock("./components/BoardRail", () => ({ default: () => null }));
vi.mock("./components/BoardView", () => ({ default: () => null }));
vi.mock("./components/CommandChat", () => ({ default: () => null }));
vi.mock("./components/ConversationView", () => ({ default: () => null }));
vi.mock("./components/DesignStudio", () => ({ default: () => null }));
vi.mock("./components/DiffView", () => ({ default: () => null }));
vi.mock("./components/HistoryView", () => ({ default: () => null }));
vi.mock("./components/InsightsView", () => ({ default: () => null }));
vi.mock("./components/DiagnosticsPanel", () => ({ default: () => null }));
vi.mock("./components/LearningsPanel", () => ({ default: () => null }));
vi.mock("./components/ProfilePicker", () => ({ default: () => null }));
vi.mock("./components/ProviderDialog", () => ({ default: () => null }));
vi.mock("./components/AttentionInbox", () => ({
  default: (props: { blockers?: AttentionSource[] }) => (
    <div data-testid="attention-blockers">
      {(props.blockers ?? [])
        .map((blocker) => ("code" in blocker ? blocker.code : "recommendation"))
        .join(",")}
    </div>
  ),
}));
vi.mock("./components/QuestionsView", () => ({ default: () => null }));
vi.mock("./components/RecommendationsPanel", () => ({ default: () => null }));
vi.mock("./components/SessionRestorePanel", () => ({ default: () => null }));
vi.mock("./components/SettingsView", () => ({ default: () => null }));
vi.mock("./components/StatisticsView", () => ({ default: () => null }));
vi.mock("./components/StatusBar", () => ({ default: () => null }));
vi.mock("./components/TabBar", () => ({ default: () => null }));
vi.mock("./components/TerminalView", () => ({ default: () => null }));
vi.mock("./components/UsageView", () => ({ default: () => null }));
vi.mock("./components/WebInterfacePanel", () => ({ default: () => null }));

describe("App audit regressions", () => {
  beforeEach(() => {
    localStorage.clear();
    attentionBlockers.current = [];
    vi.clearAllMocks();
    vi.mocked(ipc.listProjects).mockResolvedValue([projectA, projectB]);
    vi.mocked(ipc.listAgentProfiles).mockResolvedValue(profiles);
    vi.mocked(ipc.listWorkers).mockResolvedValue([]);
    vi.mocked(ipc.onPtyExit).mockResolvedValue(vi.fn());
  });

  it("does not let a late queue worker load replace the selected project's workers", async () => {
    let resolveLate: (workers: Worker[]) => void = () => undefined;
    const late = new Promise<Worker[]>((resolve) => {
      resolveLate = resolve;
    });
    vi.mocked(ipc.listWorkers).mockImplementation((projectId) => {
      const callsForA = vi.mocked(ipc.listWorkers).mock.calls.filter(([id]) => id === "project-a").length;
      if (projectId === "project-a" && callsForA > 1) return late;
      if (projectId === "project-b") return Promise.resolve([worker("worker-b", "project-b")]);
      return Promise.resolve([]);
    });

    render(<App />);
    await waitFor(() => expect(ipc.listWorkers).toHaveBeenCalledWith("project-a"));
    fireEvent.click(screen.getByRole("button", { name: "focus queued worker" }));
    fireEvent.click(screen.getByRole("button", { name: "select project b" }));
    await waitFor(() => expect(ipc.listWorkers).toHaveBeenCalledWith("project-b"));

    await act(async () => {
      resolveLate([worker("worker-a", "project-a", "session-a")]);
      await late;
    });

    await waitFor(() => expect(screen.getByTestId("workers")).toHaveTextContent("worker-b"));
    expect(screen.getByTestId("workers")).not.toHaveTextContent("worker-a");
  });

  it("unsubscribes a PTY exit listener when the session exits normally", async () => {
    const unlisten = vi.fn();
    const handlers: Array<(payload: PtyExitPayload) => void> = [];
    vi.mocked(ipc.listWorkers).mockResolvedValue([worker("worker-a", "project-a", "session-a")]);
    vi.mocked(ipc.onPtyExit).mockImplementation(async (_sessionId, handler) => {
      handlers.push(handler);
      return unlisten;
    });

    render(<App />);
    await waitFor(() => expect(ipc.onPtyExit).toHaveBeenCalledWith("session-a", expect.any(Function)));
    const exit = handlers[0];
    if (!exit) throw new Error("exit handler was not registered");
    act(() => exit({ code: 0 }));

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("does not offer disabled profiles when creating a worker", async () => {
    render(<App />);
    await waitFor(() => expect(ipc.listAgentProfiles).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "new worker" }));

    expect(screen.getByTestId("new-worker-profiles")).toHaveTextContent("enabled");
    expect(screen.getByTestId("new-worker-profiles")).not.toHaveTextContent("disabled");
  });

  it("passes F4 readiness blockers into the shared Attention inbox", async () => {
    attentionBlockers.current = [
      {
        kind: "blocker",
        workerId: "worker-a",
        projectId: "project-a",
        code: "tests_stale",
        message: "Tests passen nicht zum Merge-Baum",
        nextStep: "Tests erneut ausführen",
        observedAt: 42,
      },
    ];

    render(<App />);
    await waitFor(() => expect(ipc.listProjects).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "open attention" }));

    expect(screen.getByTestId("attention-blockers")).toHaveTextContent("tests_stale");
  });
});
