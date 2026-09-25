import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import UsageView from "./UsageView";
import * as ipc from "../lib/ipc";

vi.mock("../lib/ipc", () => ({
  describeError: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  getQuotaState: vi.fn(),
  getBudgets: vi.fn(),
  getOmniRouteUsage: vi.fn(),
}));

vi.mock("../lib/providers", () => ({
  isRoutedProfile: () => false,
  FREE_TIER_POLL_MS: 30_000,
  formatProviderResetsAt: () => null,
  freeTierRemainingText: () => null,
  useFreeTierSummary: () => ({
    summary: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

describe("UsageView claims audit", () => {
  it("C-4 does not claim missing authorization or zero totals when usage cannot be read", async () => {
    vi.mocked(ipc.getQuotaState).mockResolvedValue([]);
    vi.mocked(ipc.getBudgets).mockResolvedValue([]);
    vi.mocked(ipc.getOmniRouteUsage).mockRejectedValue(new Error("usage unavailable"));

    render(<UsageView profiles={[]} cards={[]} workers={[]} />);

    await waitFor(() => expect(ipc.getOmniRouteUsage).toHaveBeenCalled());
    expect(
      screen.queryByText(/Kein Management-Token für OmniRoute hinterlegt/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/0 Anfragen · 0 ein \/ 0 aus Tokens/)).not.toBeInTheDocument();
  });
});
