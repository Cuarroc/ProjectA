import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Worker } from "../types";
import WorkerPanel from "./WorkerPanel";

afterEach(cleanup);

function worker(status: Worker["status"]): Worker {
  return {
    id: "wk-1",
    projectId: "pj-1",
    task: "tidy the board",
    profileId: "claude",
    branch: "pa/wk-1",
    worktreePath: "/tmp/wk-1",
    sessionId: null,
    status,
    kind: "worker",
    spawnedBy: null,
    pausedReason: null,
    createdAt: 1,
  };
}

function renderPanel(w: Worker, error: string | null = null) {
  render(
    <WorkerPanel
      workers={[w]}
      profiles={[]}
      activeWorkerId={null}
      hasProject
      loading={false}
      error={error}
      busyWorkerId={null}
      onNew={vi.fn()}
      onOpen={vi.fn()}
      onRespawn={vi.fn()}
      onArchive={vi.fn()}
    />,
  );
}

describe("WorkerPanel plain texts", () => {
  it("shows the status in German, not the raw enum value", () => {
    renderPanel(worker("exited"));
    expect(screen.getByText("Beendet")).toBeTruthy();
    expect(screen.queryByText("exited")).toBeNull();
  });

  it("explains an error and keeps the original text as detail", () => {
    renderPanel(worker("exited"), "EACCES: permission denied");
    expect(screen.getByText(/Was ist passiert/)).toBeTruthy();
    expect(screen.getByText("EACCES: permission denied")).toBeTruthy();
  });
});
