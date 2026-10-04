import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QueueEntry } from "../types";
import * as ipc from "../lib/ipc";
import { usePolledResource } from "../lib/usePolledResource";
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
    let resolveOlder: (rows: string[]) => void = () => undefined;
    let resolveNewer: (rows: string[]) => void = () => undefined;
    const load = vi
      .fn<() => Promise<string[]>>()
      .mockReturnValueOnce(
        new Promise<string[]>((resolve) => {
          resolveOlder = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<string[]>((resolve) => {
          resolveNewer = resolve;
        }),
      );
    const publish = vi.fn();
    const { result } = renderHook(() => usePolledResource("project-a"));
    const older = result.current();
    void load().then((rows) => {
      if (older?.current()) publish(rows);
      older?.finish();
    });

    act(() => {
      const newer = result.current(true);
      void load().then((rows) => {
        if (newer?.current()) publish(rows);
        newer?.finish();
      });
    });
    await act(async () => resolveNewer(["newer"]));
    expect(publish).toHaveBeenLastCalledWith(["newer"]);

    await act(async () => resolveOlder(["older"]));
    expect(publish).toHaveBeenCalledTimes(1);
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
