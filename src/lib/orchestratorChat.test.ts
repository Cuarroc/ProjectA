import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatMessageTime, useOrchestratorChat } from "./orchestratorChat";
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

  it("reload does nothing while the orchestrator is still unknown", () => {
    const { result } = renderHook(() => useOrchestratorChat("project-a", null));

    act(() => {
      result.current.reload();
    });

    expect(ipc.listWorkerMessages).not.toHaveBeenCalled();
    expect(result.current.orchestratorId).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeNull();
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

describe("formatMessageTime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("formatMessageTime renders German 24-hour time even when the host locale is en-US", () => {
    const original = Date.prototype.toLocaleTimeString;
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(function (
      this: Date,
      _locale,
      options,
    ) {
      return original.call(this, "en-US", options);
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 11, 20, 0, 0));
    const unix = (date: Date) => Math.floor(date.getTime() / 1000);

    expect(formatMessageTime(unix(new Date(2026, 9, 11, 17, 5, 0)))).toBe("17:05");
    expect(formatMessageTime(unix(new Date(2026, 9, 10, 5, 31, 0)))).toBe("10.10. 05:31");
    expect(formatMessageTime(0)).toBe("");
  });
});
