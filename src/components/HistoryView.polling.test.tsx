import { act, render } from "@testing-library/react";
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
});
