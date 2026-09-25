import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import UsageView from "./UsageView";

vi.mock("../lib/ipc", () => ({
  describeError: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  getQuotaState: vi.fn(() => new Promise(() => undefined)),
  getBudgets: vi.fn(() => Promise.resolve([])),
  getOmniRouteUsage: vi.fn(() => Promise.reject(new Error("usage unavailable"))),
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

describe("UsageView", () => {
  it("F-12 does not claim OmniRoute is offline before quota state is known", () => {
    render(<UsageView profiles={[]} cards={[]} workers={[]} />);

    expect(screen.queryByText("OmniRoute offline")).not.toBeInTheDocument();
    expect(screen.getByText(/wird geprüft|unbekannt/i)).toBeInTheDocument();
  });
});
