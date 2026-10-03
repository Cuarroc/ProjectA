import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOrchestratorChat } from "./orchestratorChat";
import * as ipc from "./ipc";

vi.mock("./ipc", () => ({
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  listWorkerMessages: vi.fn(),
  sendToOrchestrator: vi.fn(),
}));

describe("useOrchestratorChat project switch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(ipc.sendToOrchestrator).mockResolvedValue({
      id: "orchestrator-1",
      projectId: "project-a",
      task: "Orchestrator",
      profileId: "profile-1",
      branch: "nacht/orchestrator",
      worktreePath: "/tmp/orchestrator",
      sessionId: "session-1",
      status: "running",
      kind: "orchestrator",
      spawnedBy: null,
      pausedReason: null,
      createdAt: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not load the previous project's history after a switch", async () => {
    vi.mocked(ipc.listWorkerMessages).mockReturnValue(new Promise(() => undefined));
    const { result, rerender } = renderHook(
      ({ project }) => useOrchestratorChat(project),
      { initialProps: { project: "project-a" } },
    );
    await act(async () => {
      await result.current.send("Status?");
    });
    expect(result.current.loading).toBe(true);
    vi.mocked(ipc.listWorkerMessages).mockClear();

    await act(async () => {
      rerender({ project: "project-b" });
    });

    expect(ipc.listWorkerMessages).not.toHaveBeenCalled();
    expect(result.current.orchestratorId).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
