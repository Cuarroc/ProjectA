import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import UsageView from "./UsageView";
import type { AgentProfile, Budget, QuotaState, UsageReport } from "../types";
const reads = vi.hoisted(() => ({
  getQuotaState: vi.fn<() => Promise<QuotaState[]>>(() => new Promise(() => undefined)),
  getBudgets: vi.fn<() => Promise<Budget[]>>(() => Promise.resolve([])),
  getOmniRouteUsage: vi.fn<() => Promise<UsageReport>>(() => Promise.reject(new Error("usage unavailable"))),
}));

vi.mock("../lib/ipc", () => ({
  describeError: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  ...reads,
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
  afterEach(() => vi.useRealTimers());

  it("F-12 does not claim OmniRoute is offline before quota state is known", () => {
    render(<UsageView profiles={[]} cards={[]} workers={[]} />);

    expect(screen.queryByText("OmniRoute offline")).not.toBeInTheDocument();
    expect(screen.getByText(/wird geprüft|unbekannt/i)).toBeInTheDocument();
  });

  it("keeps the last good budgets and usage when a refresh fails", async () => {
    vi.useFakeTimers();
    const profile: AgentProfile = { id: "codex", name: "Codex", command: "codex", args: [], env: {}, fallback: null, enabled: true };
    const totals = { requests: 2, tokensIn: 100, tokensOut: 50, costUsd: 0, priced: 0 };
    const usage: UsageReport = { online: true, authorized: true, events: [], today: totals, total: totals, reportedCostUsd: 1.25 };
    reads.getQuotaState.mockResolvedValue([]);
    reads.getBudgets.mockResolvedValueOnce([{ profileId: "codex", fiveHourPct: 50, sevenDayPct: 80 }])
      .mockRejectedValueOnce(new Error("budget unavailable"));
    reads.getOmniRouteUsage.mockResolvedValueOnce(usage).mockRejectedValueOnce(new Error("usage unavailable"));
    render(<UsageView profiles={[profile]} cards={[]} workers={[]} />);
    await act(async () => undefined);
    const budget = () =>
      screen.getByTitle("Budget-Schwellen: 5-Stunden- und 7-Tage-Fenster");
    expect(budget().textContent).toBe("Budget 5h 50 % · 7d 80 %");
    expect(screen.getByText("1.2500 $ seit Beginn")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(budget().textContent).toBe("Budget 5h 50 % · 7d 80 %");
    expect(screen.getByText("1.2500 $ seit Beginn")).toBeInTheDocument();
  });
});
