import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBoard } from "./useBoard";
import * as ipc from "./ipc";

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
});
