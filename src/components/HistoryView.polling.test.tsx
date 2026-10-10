import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listWorkerMessages: vi.fn(),
}));

vi.mock("../lib/ipc", () => ({
  listWorkerMessages: mocks.listWorkerMessages,
}));

import HistoryView from "./HistoryView";

describe("HistoryView polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.listWorkerMessages.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps at most one message request in flight", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    mocks.listWorkerMessages.mockReturnValue(pending);

    const view = render(<HistoryView workerId="worker-1" />);
    expect(mocks.listWorkerMessages).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(mocks.listWorkerMessages).toHaveBeenCalledTimes(1);
    view.unmount();
    finish();
  });

  it("ignores a late reply for the previous worker after a worker switch", async () => {
    let lateReply!: (value: unknown[]) => void;
    mocks.listWorkerMessages.mockImplementation((id: string) =>
      id === "worker-1"
        ? new Promise((resolve) => {
            lateReply = resolve;
          })
        : Promise.resolve([
            { id: "m2", workerId: "worker-2", role: "assistant", content: "new worker text", createdAt: 2 },
          ]),
    );

    const view = render(<HistoryView workerId="worker-1" />);
    view.rerender(<HistoryView workerId="worker-2" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("new worker text")).toBeTruthy();

    await act(async () => {
      lateReply([
        { id: "m1", workerId: "worker-1", role: "assistant", content: "old worker text", createdAt: 1 },
      ]);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.queryByText("old worker text")).toBeNull();
    expect(screen.getByText("new worker text")).toBeTruthy();
    view.unmount();
  });

  it("shows a load hint when listWorkerMessages rejects with no messages", async () => {
    mocks.listWorkerMessages.mockRejectedValue(new Error("ipc down"));

    const view = render(<HistoryView workerId="worker-1" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const hint = screen.getByRole("status");
    expect(hint.textContent).toContain("Verlauf konnte nicht geladen werden");
    view.unmount();
  });

  it("a failed later poll keeps the earlier messages", async () => {
    mocks.listWorkerMessages
      .mockResolvedValueOnce([
        { id: "m1", workerId: "worker-1", role: "agent", content: "kept text", createdAt: 1 },
      ])
      .mockRejectedValue(new Error("ipc down"));

    const view = render(<HistoryView workerId="worker-1" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("kept text")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(mocks.listWorkerMessages).toHaveBeenCalledTimes(2);
    expect(screen.getByText("kept text")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    view.unmount();
  });

  it("a later successful poll clears the load hint", async () => {
    mocks.listWorkerMessages
      .mockRejectedValueOnce(new Error("ipc down"))
      .mockResolvedValueOnce([
        { id: "m1", workerId: "worker-1", role: "agent", content: "recovered text", createdAt: 1 },
      ]);

    const view = render(<HistoryView workerId="worker-1" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const hint = screen.getByRole("status");
    expect(hint.textContent).toContain("Verlauf konnte nicht geladen werden");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(mocks.listWorkerMessages).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("recovered text")).toBeTruthy();
    view.unmount();
  });
});
