import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import InsightsView from "./InsightsView";

vi.mock("./UsageView", () => ({
  default: () => <div>usage-panel</div>,
}));
vi.mock("./StatisticsView", () => ({
  default: () => <div>statistik-panel</div>,
}));
vi.mock("./ActivityView", () => ({
  default: () => <div>activity-panel</div>,
}));
vi.mock("../lib/ipc", () => ({
  describeError: (e: unknown) => String(e),
  getResourceSnapshot: vi.fn(() =>
    Promise.resolve({
      observedAt: 1_700_000_000,
      cpuPermille: 25,
      ramProcessBytes: 1024 * 1024,
      ramTotalBytes: 8 * 1024 * 1024 * 1024,
      diskAppBytes: 4096,
      diskFreeBytes: 1024 * 1024 * 1024,
      tokensIn: 11,
      tokensOut: 22,
    }),
  ),
}));

describe("InsightsView", () => {
  it("bundles usage, statistics and activity on one surface", () => {
    render(
      <InsightsView profiles={[]} cards={[]} workers={[]} projectId="pj-1" />,
    );
    expect(screen.getByTestId("insights")).toBeInTheDocument();
    expect(screen.getByText("usage-panel")).toBeInTheDocument();
    expect(screen.getByText("statistik-panel")).toBeInTheDocument();
    expect(screen.getByText("activity-panel")).toBeInTheDocument();
    expect(screen.getByText(/aktives Projekt/)).toBeInTheDocument();
  });

  it("shows the F5 resource baseline before any limit", async () => {
    render(
      <InsightsView profiles={[]} cards={[]} workers={[]} projectId="pj-1" />,
    );
    expect(await screen.findByTestId("insights-resources")).toBeInTheDocument();
    // The baseline resolves asynchronously after the container exists —
    // a synchronous getByText here raced the state update and flaked.
    expect(await screen.findByText("11 ein / 22 aus")).toBeInTheDocument();
    expect(screen.getByText("2.5 %")).toBeInTheDocument();
  });
});
