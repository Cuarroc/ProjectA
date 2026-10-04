import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QueueEntry } from "../types";
import * as ipc from "../lib/ipc";
import QueuePanel from "./QueuePanel";

vi.mock("../lib/ipc", () => ({
  listQueue: vi.fn(),
  enqueueTask: vi.fn(),
  cancelQueuedTask: vi.fn(),
  describeError: (cause: unknown) => String(cause),
}));

vi.mock("../lib/settings", () => ({
  loadMasterPrompt: () => "",
  isMasterPromptEnabled: () => false,
  composeWithMasterPrompt: (text: string) => text,
}));

vi.mock("../lib/useSharpening", () => ({
  useSharpening: () => ({
    phase: "idle",
    active: false,
    running: false,
    open: [],
    error: null,
    clearError: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
    answer: vi.fn(),
  }),
}));

const rowA: QueueEntry = {
  id: "entry-a",
  projectId: "project-a",
  rawText: "Task of project A",
  sharpenedText: null,
  profileId: null,
  status: "queued",
  priority: 3,
  workerId: null,
  createdAt: 1,
};

const rowB: QueueEntry = {
  ...rowA,
  id: "entry-b",
  rawText: "Newer task of project A",
  createdAt: 2,
};

const props = {
  profiles: [],
  profilesLoading: false,
  onFocusWorker: vi.fn(),
  onOpenQuestions: vi.fn(),
};

describe("QueuePanel project switch", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the newer same-project poll when an older request lands last", async () => {
    vi.useFakeTimers();
    let resolveOlder: (rows: QueueEntry[]) => void = () => undefined;
    let resolveNewer: (rows: QueueEntry[]) => void = () => undefined;
    vi.mocked(ipc.listQueue)
      .mockReturnValueOnce(
        new Promise<QueueEntry[]>((resolve) => {
          resolveOlder = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<QueueEntry[]>((resolve) => {
          resolveNewer = resolve;
        }),
      );

    render(<QueuePanel {...props} projectId="project-a" />);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    await act(async () => resolveNewer([rowB]));
    expect(screen.getByText("Newer task of project A")).toBeTruthy();

    await act(async () => resolveOlder([rowA]));
    expect(screen.getByText("Newer task of project A")).toBeTruthy();
  });

  it("drops the previous project's rows and draft when the read for the new one fails", async () => {
    vi.mocked(ipc.listQueue).mockResolvedValueOnce([rowA]);
    const { rerender } = render(<QueuePanel {...props} projectId="project-a" />);
    expect(await screen.findByText("Task of project A")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "half-typed draft" } });

    vi.mocked(ipc.listQueue).mockRejectedValue(new Error("boom"));
    rerender(<QueuePanel {...props} projectId="project-b" />);

    await waitFor(() => expect(ipc.listQueue).toHaveBeenCalledWith("project-b"));
    expect(screen.queryByText("Task of project A")).toBeNull();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });

  it("ignores a read of the previous project that resolves after the switch", async () => {
    let resolveA: (rows: QueueEntry[]) => void = () => undefined;
    vi.mocked(ipc.listQueue).mockImplementation((id?: string) =>
      id === "project-a"
        ? new Promise<QueueEntry[]>((resolve) => {
            resolveA = resolve;
          })
        : new Promise<QueueEntry[]>(() => undefined),
    );
    const { rerender } = render(<QueuePanel {...props} projectId="project-a" />);
    rerender(<QueuePanel {...props} projectId="project-b" />);
    resolveA([rowA]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText("Task of project A")).toBeNull();
  });

  it("does not publish an enqueue that completes after the project switch", async () => {
    vi.mocked(ipc.listQueue).mockResolvedValue([]);
    let resolveEnqueue: (row: QueueEntry) => void = () => undefined;
    vi.mocked(ipc.enqueueTask).mockReturnValue(
      new Promise<QueueEntry>((resolve) => {
        resolveEnqueue = resolve;
      }),
    );
    const { rerender } = render(<QueuePanel {...props} projectId="project-a" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Task of project A" } });
    fireEvent.click(screen.getByRole("button", { name: "Einreihen" }));
    await waitFor(() => expect(ipc.enqueueTask).toHaveBeenCalled());

    rerender(<QueuePanel {...props} projectId="project-b" />);
    await act(async () => resolveEnqueue(rowA));

    expect(screen.queryByText("Task of project A")).toBeNull();
  });
});
