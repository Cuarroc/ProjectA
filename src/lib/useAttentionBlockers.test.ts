import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAttentionBlockers } from "./useAttentionBlockers";
import * as ipc from "./ipc";
import type { Worker, WorkerReadiness } from "../types";

vi.mock("./ipc", () => ({
  describeError: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  getWorkerReadiness: vi.fn(),
}));

const worker: Worker = {
  id: "worker-a",
  projectId: "project-a",
  task: "Review me",
  profileId: "codex",
  branch: "cursor/worker-a",
  worktreePath: "/repo/worker-a",
  sessionId: null,
  status: "exited",
  kind: "worker",
  spawnedBy: null,
  pausedReason: null,
  createdAt: 1,
};

const readiness: WorkerReadiness = {
  lifecycle: "exited",
  readiness: "blocked",
  blockers: [
    {
      code: "tests_stale",
      message: "Tests passen nicht zum Merge-Baum",
      nextStep: "Tests erneut ausführen",
    },
  ],
  checkedAt: 42,
  ahead: 1,
  behind: 0,
  code: null,
};

describe("useAttentionBlockers", () => {
  beforeEach(() => {
    vi.mocked(ipc.getWorkerReadiness).mockReset();
  });

  it("projects the F4 engine blockers without inventing a second vocabulary", async () => {
    vi.mocked(ipc.getWorkerReadiness).mockResolvedValue(readiness);

    const { result } = renderHook(() => useAttentionBlockers("project-a", [worker]));

    await waitFor(() =>
      expect(result.current.blockers).toEqual([
        {
          kind: "blocker",
          workerId: "worker-a",
          projectId: "project-a",
          code: "tests_stale",
          message: "Tests passen nicht zum Merge-Baum",
          nextStep: "Tests erneut ausführen",
          observedAt: 42,
        },
      ]),
    );
    expect(ipc.getWorkerReadiness).toHaveBeenCalledWith("worker-a");
  });
});
