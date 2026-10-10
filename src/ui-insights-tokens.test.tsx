import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import InsightsView from "./components/InsightsView";
import UsageView from "./components/UsageView";
import type { AgentProfile, Budget, QuotaState, UsageReport } from "./types";

const css = readFileSync(resolve(__dirname, "styles.css"), "utf8").replace(/\r\n/g, "\n");

const reads = vi.hoisted(() => ({
  getQuotaState: vi.fn<() => Promise<QuotaState[]>>(() => Promise.resolve([])),
  getBudgets: vi.fn<() => Promise<Budget[]>>(() => Promise.resolve([])),
  getOmniRouteUsage: vi.fn<() => Promise<UsageReport>>(() =>
    Promise.resolve({
      online: true,
      authorized: true,
      events: [
        {
          id: "evt-1",
          ts: 1_700_000_000,
          provider: "test",
          model: "m",
          tokensIn: 1,
          tokensOut: 2,
          costUsd: null,
          profileId: null,
          rawJson: "{}",
        },
      ],
      today: { requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, priced: 0 },
      total: { requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, priced: 0 },
      reportedCostUsd: null,
    }),
  ),
  getResourceSnapshot: vi.fn(() =>
    Promise.resolve({
      observedAt: 0,
      cpuPermille: null,
      ramProcessBytes: null,
      ramTotalBytes: null,
      diskAppBytes: null,
      diskFreeBytes: null,
      tokensIn: 0,
      tokensOut: 0,
    }),
  ),
}));

vi.mock("./lib/ipc", () => ({
  describeError: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  getQuotaState: reads.getQuotaState,
  getBudgets: reads.getBudgets,
  getOmniRouteUsage: reads.getOmniRouteUsage,
  getResourceSnapshot: reads.getResourceSnapshot,
}));

vi.mock("./lib/providers", () => ({
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

vi.mock("./components/StatisticsView", () => ({
  default: () => null,
}));

vi.mock("./components/ActivityView", () => ({
  default: () => null,
}));

function ruleBody(selector: string): string {
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
  );
  const match = css.match(re);
  expect(match, `missing rule ${selector}`).not.toBeNull();
  return match![1];
}

describe("V161-UI-P13a insights tokens", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("usage-view wraps with auto-fit minmax so Insights fits a 1024 viewport", () => {
    const body = ruleBody(".usage-view");
    expect(body).toMatch(
      /grid-template-columns:\s*repeat\(\s*auto-fit\s*,\s*minmax\(\s*min\(\s*320px\s*,\s*100%\s*\)\s*,\s*1fr\s*\)\s*\)/,
    );
    expect(body).not.toMatch(/minmax\(\s*min\(\s*280px/);
  });

  it("usage-view does not paint gap tracks with the border colour", () => {
    const view = ruleBody(".usage-view");
    expect(view).not.toMatch(/background:\s*var\(--border\)/);
    expect(view).toMatch(/background:\s*var\(--bg\)/);
    const section = ruleBody(".usage-section");
    expect(section).toMatch(/border-right:\s*1px\s+solid\s+var\(--border\)/);
    expect(section).toMatch(/border-bottom:\s*1px\s+solid\s+var\(--border\)/);
  });

  it("insights-quiet uses muted foreground without opacity", () => {
    const body = ruleBody(".insights-quiet");
    expect(body).toMatch(/color:\s*var\(--fg-muted\)/);
    expect(body).not.toMatch(/opacity\s*:/);
  });

  it("peer headings insights-heading and diagnose-panel h2 resolve --text-lg", () => {
    expect(ruleBody(".insights-heading")).toMatch(/font-size:\s*var\(--text-lg\)/);
    expect(ruleBody(".diagnose-panel h2")).toMatch(/font-size:\s*var\(--text-lg\)/);
    expect(ruleBody(".insights-heading")).not.toMatch(/calc\(/);
  });

  it("diagnose-path uses only --font-mono", () => {
    const body = ruleBody(".diagnose-path");
    expect(body).toMatch(/font-family:\s*var\(--font-mono\)/);
    expect(body).not.toMatch(/ui-monospace/);
  });

  it("UsageView shows nicht gemessen instead of em dash for missing budget and cost", async () => {
    const profile: AgentProfile = {
      id: "codex",
      name: "Codex",
      command: "codex",
      args: [],
      env: {},
      fallback: null,
      enabled: true,
    };
    reads.getBudgets.mockResolvedValueOnce([
      { profileId: "codex", fiveHourPct: null, sevenDayPct: null },
    ]);
    render(<UsageView profiles={[profile]} cards={[]} workers={[]} />);
    await act(async () => undefined);
    expect(screen.getByText(/Budget 5h/)).toBeInTheDocument();
    expect(screen.getAllByText("nicht gemessen").length).toBeGreaterThanOrEqual(2);
    // Placeholder cells only — prose em dashes in German copy stay.
    expect(screen.queryByText("— $")).not.toBeInTheDocument();
    expect(screen.queryByText(/^—$/)).not.toBeInTheDocument();
  });

  it("mutes only missing budget values not the measured sibling", async () => {
    const profile: AgentProfile = {
      id: "codex",
      name: "Codex",
      command: "codex",
      args: [],
      env: {},
      fallback: null,
      enabled: true,
    };
    reads.getBudgets.mockResolvedValueOnce([
      { profileId: "codex", fiveHourPct: 50, sevenDayPct: null },
    ]);
    render(<UsageView profiles={[profile]} cards={[]} workers={[]} />);
    await act(async () => undefined);
    const budget = screen.getByTitle("Budget-Schwellen: 5-Stunden- und 7-Tage-Fenster");
    expect(budget.textContent).toContain("50 %");
    expect(budget.textContent).toContain("nicht gemessen");
    expect(budget.classList.contains("insights-quiet")).toBe(false);
    const quietBits = budget.querySelectorAll(".insights-quiet");
    expect(quietBits).toHaveLength(1);
    expect(quietBits[0]?.textContent).toBe("nicht gemessen");
  });

  it("nicht gemessen uses quiet text on Insights resources", async () => {
    render(
      <InsightsView profiles={[]} cards={[]} workers={[]} projectId={null} />,
    );
    await act(async () => undefined);
    const quiet = await screen.findAllByText("nicht gemessen");
    expect(quiet.length).toBeGreaterThan(0);
    for (const node of quiet) {
      expect(node.classList.contains("insights-quiet")).toBe(true);
    }
  });
});
