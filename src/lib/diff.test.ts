import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DiffComment, WorkerDiff } from "../types";
import {
  cacheDiffSummary,
  commentLineOf,
  fileLabel,
  summarizeDiff,
  useDiffSummary,
  useWorkerDiff,
} from "./diff";
import * as ipc from "./ipc";

vi.mock("./ipc", () => ({
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  getWorkerDiff: vi.fn(),
}));

function diffOf(additions: number, deletions: number, baseBranch = "main"): WorkerDiff {
  return {
    baseBranch,
    stat: "",
    code: null,
    files: [{ path: "a.ts", oldPath: null, additions, deletions, binary: false, hunks: [] }],
  };
}

function note(id: string): DiffComment {
  return {
    id,
    workerId: "w",
    file: "a.ts",
    line: 1,
    body: "x",
    sentToAgent: false,
    createdAt: 0,
    disposition: "open",
  };
}

describe("summarizeDiff", () => {
  it("aggregates file, addition, and deletion counts", () => {
    const diff: WorkerDiff = {
      baseBranch: "main",
      stat: "2 files changed, 10 insertions(+), 5 deletions(-)",
      code: null,
      files: [
        {
          path: "src/first.ts",
          oldPath: null,
          additions: 7,
          deletions: 1,
          binary: false,
          hunks: [],
        },
        {
          path: "src/second.ts",
          oldPath: null,
          additions: 3,
          deletions: 4,
          binary: false,
          hunks: [],
        },
      ],
    };

    expect(summarizeDiff(diff)).toEqual({
      baseBranch: "main",
      files: 2,
      additions: 10,
      deletions: 5,
    });
  });

  it("reports zeros for a diff without files", () => {
    expect(summarizeDiff({ baseBranch: "dev", stat: "", code: null, files: [] })).toEqual({
      baseBranch: "dev",
      files: 0,
      additions: 0,
      deletions: 0,
    });
  });
});

describe("fileLabel and commentLineOf", () => {
  it("shows the origin of a renamed file", () => {
    expect(fileLabel("b.ts", null)).toBe("b.ts");
    expect(fileLabel("b.ts", "a.ts")).toBe("a.ts → b.ts");
  });

  it("pins a comment to the new line, falling back to the old one", () => {
    expect(commentLineOf({ newLine: 4, oldLine: 9 })).toBe(4);
    expect(commentLineOf({ newLine: null, oldLine: 9 })).toBe(9);
    expect(commentLineOf({ newLine: 0, oldLine: 9 })).toBe(0);
    expect(commentLineOf({ newLine: null, oldLine: null })).toBeNull();
  });
});

describe("useDiffSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fetch until enabled", () => {
    const { result } = renderHook(() => useDiffSummary("w-idle", false));
    expect(ipc.getWorkerDiff).not.toHaveBeenCalled();
    expect(result.current).toEqual({ summary: null, loading: false, error: null });
  });

  it("fetches once, then serves a re-enable from the cache", async () => {
    vi.mocked(ipc.getWorkerDiff).mockResolvedValue(diffOf(3, 2));
    const first = renderHook(() => useDiffSummary("w-cache", true));
    await vi.waitFor(() => expect(first.result.current.summary?.additions).toBe(3));
    expect(first.result.current.loading).toBe(false);
    first.unmount();

    const second = renderHook(() => useDiffSummary("w-cache", true));
    expect(second.result.current.summary?.deletions).toBe(2);
    expect(ipc.getWorkerDiff).toHaveBeenCalledTimes(1);
  });

  it("refetches once the cached entry is older than the TTL", async () => {
    cacheDiffSummary("w-ttl", { baseBranch: "main", files: 1, additions: 1, deletions: 1 });
    vi.advanceTimersByTime(31_000);
    vi.mocked(ipc.getWorkerDiff).mockResolvedValue(diffOf(8, 0));
    const { result } = renderHook(() => useDiffSummary("w-ttl", true));
    await vi.waitFor(() => expect(result.current.summary?.additions).toBe(8));
    expect(ipc.getWorkerDiff).toHaveBeenCalledTimes(1);
  });

  it("surfaces a fetch failure and stops loading", async () => {
    vi.mocked(ipc.getWorkerDiff).mockRejectedValue(new Error("no worktree"));
    const { result } = renderHook(() => useDiffSummary("w-fail", true));
    await vi.waitFor(() => expect(result.current.error).toBe("no worktree"));
    expect(result.current.loading).toBe(false);
    expect(result.current.summary).toBeNull();
  });

  it("ignores a reply for a worker it has already left", async () => {
    let resolve!: (value: WorkerDiff) => void;
    vi.mocked(ipc.getWorkerDiff).mockReturnValue(new Promise((r) => (resolve = r)));
    const { result, unmount } = renderHook(() => useDiffSummary("w-stale", true));
    unmount();
    resolve(diffOf(1, 1));
    await vi.advanceTimersByTimeAsync(0);
    expect(result.current.summary).toBeNull();
  });
});

describe("useWorkerDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the diff together with its comments", async () => {
    vi.mocked(ipc.getWorkerDiff).mockResolvedValue(diffOf(1, 0));
    const loadComments = vi.fn().mockResolvedValue([note("c1")]);
    const { result } = renderHook(() => useWorkerDiff("w1", loadComments));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.diff?.baseBranch).toBe("main");
    expect(result.current.comments.map((c) => c.id)).toEqual(["c1"]);
    expect(result.current.error).toBeNull();
  });

  it("keeps the diff when only the comments fail to load", async () => {
    vi.mocked(ipc.getWorkerDiff).mockResolvedValue(diffOf(1, 0));
    const loadComments = vi.fn().mockRejectedValue(new Error("comments down"));
    const { result } = renderHook(() => useWorkerDiff("w2", loadComments));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.diff).not.toBeNull();
    expect(result.current.comments).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("reports a diff failure as the error", async () => {
    vi.mocked(ipc.getWorkerDiff).mockRejectedValue(new Error("git failed"));
    const { result } = renderHook(() => useWorkerDiff("w3", vi.fn().mockResolvedValue([])));
    await waitFor(() => expect(result.current.error).toBe("git failed"));
    expect(result.current.loading).toBe(false);
    expect(result.current.diff).toBeNull();
  });

  it("refresh refetches without raising the spinner, and setComments edits the list", async () => {
    vi.mocked(ipc.getWorkerDiff)
      .mockResolvedValueOnce(diffOf(1, 0))
      .mockResolvedValueOnce(diffOf(5, 0));
    const { result } = renderHook(() => useWorkerDiff("w4", vi.fn().mockResolvedValue([])));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const pending = result.current.refresh();
      expect(result.current.loading).toBe(false);
      await pending;
    });
    expect(result.current.diff?.files[0].additions).toBe(5);

    act(() => result.current.setComments([note("c9")]));
    act(() => result.current.setComments((prev) => [...prev, note("c10")]));
    expect(result.current.comments.map((c) => c.id)).toEqual(["c9", "c10"]);
  });

  it("drops a slow response for a worker the user already left", async () => {
    let resolveFirst!: (value: WorkerDiff) => void;
    vi.mocked(ipc.getWorkerDiff).mockImplementation((id: string) =>
      id === "old" ? new Promise((r) => (resolveFirst = r)) : Promise.resolve(diffOf(2, 2, "new-base")),
    );
    const loadComments = vi.fn().mockResolvedValue([]);
    const { result, rerender } = renderHook(({ id }) => useWorkerDiff(id, loadComments), {
      initialProps: { id: "old" },
    });
    rerender({ id: "new" });
    await waitFor(() => expect(result.current.diff?.baseBranch).toBe("new-base"));
    await act(async () => {
      resolveFirst(diffOf(9, 9, "old-base"));
    });
    expect(result.current.diff?.baseBranch).toBe("new-base");
  });
});
