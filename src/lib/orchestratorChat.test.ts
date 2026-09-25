import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOrchestratorChat } from "./orchestratorChat";
import * as ipc from "./ipc";

vi.mock("./ipc", () => ({
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  listWorkerMessages: vi.fn(),
  sendToOrchestrator: vi.fn(),
}));

describe("useOrchestratorChat audit regressions", () => {
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

  it("loads existing history before claiming that there are no messages", () => {
    // The hook cannot discover the orchestrator from the project id alone —
    // find-or-create belongs to the send path — so the caller (App) passes the
    // orchestrator row it already sees in its worker list.
    renderHook(() => useOrchestratorChat("project-a", "orchestrator-1"));

    expect(ipc.listWorkerMessages).toHaveBeenCalledWith("orchestrator-1", expect.any(Number));
  });

  it("reports a polling failure instead of silently freezing the thread", async () => {
    vi.mocked(ipc.listWorkerMessages)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("database unavailable"));
    const { result } = renderHook(() => useOrchestratorChat("project-a"));

    await act(async () => {
      await result.current.send("Status?");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(result.current.error).toBe("database unavailable");
  });
});
