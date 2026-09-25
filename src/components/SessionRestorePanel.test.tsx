import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Worker } from "../types";
import SessionRestorePanel from "./SessionRestorePanel";

const getSessionRestore = vi.fn();
const respawnWorker = vi.fn();

vi.mock("../lib/ipc", () => ({
  getSessionRestore: (...args: unknown[]) => getSessionRestore(...args),
  respawnWorker: (...args: unknown[]) => respawnWorker(...args),
  describeError: (cause: unknown) => String(cause),
}));

function exitedWorker(): Worker {
  return {
    id: "wk-1",
    projectId: "pj-1",
    task: "survive a crash",
    profileId: "claude",
    branch: "pa/wk-1",
    worktreePath: "/tmp/wk-1",
    sessionId: null,
    status: "exited",
    kind: "worker",
    spawnedBy: null,
    pausedReason: null,
    createdAt: 1,
  };
}

describe("SessionRestorePanel", () => {
  it("shows the persisted buffer and does not auto-spawn", async () => {
    const onRespawn = vi.fn();
    getSessionRestore.mockResolvedValue({
      liveSession: false,
      workspace: "present",
      scrollback: "hello from the crashed agent",
      draft: "unsent reply",
      lastConfirmed: "app_crash",
    });

    render(<SessionRestorePanel worker={exitedWorker()} onRespawn={onRespawn} />);

    expect(await screen.findByText("hello from the crashed agent")).toBeInTheDocument();
    expect(screen.getByText("unsent reply")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Kein Live-PTY/);
    expect(screen.getByLabelText("Gespeicherter Scrollback")).toBeInTheDocument();
    expect(onRespawn).not.toHaveBeenCalled();
    expect(respawnWorker).not.toHaveBeenCalled();
    await waitFor(() => expect(getSessionRestore).toHaveBeenCalledWith("wk-1"));
  });
});
