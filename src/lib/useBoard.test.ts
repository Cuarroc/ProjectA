import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBoard } from "./useBoard";
import * as ipc from "./ipc";
import type { BoardCard, WorkerStatusEvent } from "../types";

vi.mock("./ipc", () => ({
  describeError: (cause: unknown) => String(cause),
  getBoardState: vi.fn(),
  onWorkerStatus: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useBoard", () => {
  beforeEach(() => {
    vi.mocked(ipc.getBoardState).mockReset();
    vi.mocked(ipc.onWorkerStatus).mockReset();
    vi.mocked(ipc.onWorkerStatus).mockResolvedValue(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears the initial spinner when a silent refresh supersedes it", async () => {
    const initial = deferred<Awaited<ReturnType<typeof ipc.getBoardState>>>();
    const refresh = deferred<Awaited<ReturnType<typeof ipc.getBoardState>>>();
    vi.mocked(ipc.getBoardState)
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(refresh.promise);

    const { result } = renderHook(() => useBoard("project-a", true));
    await waitFor(() => expect(result.current.loading).toBe(true));

    act(() => result.current.refresh());
    await act(async () => {
      refresh.resolve({ cards: [], coordinators: [] });
      await refresh.promise;
    });

    expect(result.current.loading).toBe(false);

    await act(async () => {
      initial.resolve({ cards: [], coordinators: [] });
      await initial.promise;
    });
  });

  it("reports worker ids from board snapshots and status events", async () => {
    const seen = vi.fn();
    let statusHandler: ((payload: WorkerStatusEvent) => void) | null = null;
    const card: BoardCard = {
      worker: {
        id: "worker-from-board",
        projectId: "project-a",
        task: "queued work",
        profileId: "codex",
        branch: "codex/queued-work",
        worktreePath: "/tmp/queued-work",
        sessionId: "session-a",
        status: "running",
        kind: "worker",
        spawnedBy: null,
        pausedReason: null,
        createdAt: 1,
      },
      column: "working",
      attentionReason: null,
      attentionCode: null,
      attentionGrade: null,
      prUrl: null,
      contextUsage: null,
      controlledBy: null,
      testStatus: null,
      testedAt: null,
    };
    vi.mocked(ipc.getBoardState).mockResolvedValue({ cards: [card], coordinators: [] });
    vi.mocked(ipc.onWorkerStatus).mockImplementation(async (handler) => {
      statusHandler = handler;
      return () => undefined;
    });

    renderHook(() => useBoard("project-a", true, seen));
    await waitFor(() => expect(seen).toHaveBeenCalledWith("worker-from-board"));

    act(() =>
      statusHandler?.({
        workerId: "worker-from-event",
        column: "working",
        attentionReason: null,
        attentionCode: null,
        attentionGrade: null,
        attentionObservedAt: null,
      }),
    );
    expect(seen).toHaveBeenCalledWith("worker-from-event");
  });
});
