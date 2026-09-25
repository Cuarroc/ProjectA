import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useQuotaState } from "./quota";
import * as ipc from "./ipc";

vi.mock("./ipc", () => ({
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  getQuotaState: vi.fn(),
}));

describe("useQuotaState audit regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not report OmniRoute offline before the first response", () => {
    vi.mocked(ipc.getQuotaState).mockReturnValue(new Promise(() => undefined));

    const { result } = renderHook(() => useQuotaState());

    expect(result.current.loading).toBe(true);
    expect(result.current.omniRouteOnline).not.toBe(false);
  });

  it("does not turn a quota read failure into an offline report", async () => {
    vi.mocked(ipc.getQuotaState).mockRejectedValue(new Error("router state unavailable"));

    const { result } = renderHook(() => useQuotaState());
    await waitFor(() => expect(result.current.error).toBe("router state unavailable"));

    expect(result.current.omniRouteOnline).not.toBe(false);
  });
});
