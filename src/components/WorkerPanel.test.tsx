import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentProfile, Worker } from "../types";
import WorkerPanel from "./WorkerPanel";

afterEach(cleanup);

function worker(status: Worker["status"], kind: Worker["kind"] = "worker"): Worker {
  return {
    id: "wk-1",
    projectId: "pj-1",
    task: "tidy the board",
    profileId: "claude",
    branch: "pa/wk-1",
    worktreePath: "/tmp/wk-1",
    sessionId: status === "running" ? "pty-1" : null,
    status,
    kind,
    spawnedBy: null,
    pausedReason: null,
    createdAt: 1,
  };
}

function renderPanel(w: Worker, handlers = { onRespawn: vi.fn(), onArchive: vi.fn() }, error: string | null = null) {
  render(
    <WorkerPanel
      workers={[w]}
      profiles={[] as AgentProfile[]}
      activeWorkerId={null}
      hasProject
      loading={false}
      error={error}
      busyWorkerId={null}
      onNew={vi.fn()}
      onOpen={vi.fn()}
      {...handlers}
    />,
  );
  return handlers;
}

describe("WorkerPanel archive and respawn", () => {
  it("offers no respawn for an archived worker and says it is final", () => {
    renderPanel(worker("archived"));
    expect(screen.queryByRole("button", { name: /respawn|neu starten/i })).toBeNull();
    expect(screen.getByText("Archiviert – endgültig gestoppt, Arbeitsbaum bleibt")).toBeTruthy();
  });

  it("still offers respawn for an exited worker", () => {
    const { onRespawn } = renderPanel(worker("exited"));
    fireEvent.click(screen.getByRole("button", { name: "Neu starten" }));
    expect(onRespawn).toHaveBeenCalledTimes(1);
  });

  it("asks before archiving and states that it is final", () => {
    const { onArchive } = renderPanel(worker("running"));
    fireEvent.click(screen.getByRole("button", { name: "Archivieren" }));
    expect(onArchive).not.toHaveBeenCalled();
    expect(screen.getByText(/endgültig/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(onArchive).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Archivieren" }));
    fireEvent.click(screen.getByRole("button", { name: "Ja, endgültig archivieren" }));
    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed attempt's error visible", () => {
    renderPanel(worker("exited"), undefined, "refused: nope");
    expect(screen.getByText("refused: nope")).toBeTruthy();
  });
});
