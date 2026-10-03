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
});
