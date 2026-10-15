import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { getBudgets, getQuotaState, listAgentProfiles } from "../../../lib/ipc";
import type { AgentProfile, BoardCard, Budget, QuotaState } from "../../../types";
import { FlowTab } from "./FlowTab";

vi.mock("../../../lib/ipc", () => ({ listAgentProfiles: vi.fn(), getQuotaState: vi.fn(), getBudgets: vi.fn() }));

const profile = (id: string, name: string, fallback: string | null = null): AgentProfile =>
  ({ id, name, command: id, args: [], env: {}, fallback, enabled: true });
const quota = (profileId: string, state: QuotaState["state"]): QuotaState =>
  ({ profileId, state, blockedUntil: null, reason: null, omniRouteOnline: false });
const budget = (profileId: string, fiveHourPct: number | null, sevenDayPct: number | null): Budget =>
  ({ profileId, fiveHourPct, sevenDayPct });
const cards = [{
  worker: { id: "w1", projectId: "p1", task: "Fix the start block", profileId: "claude", branch: "claude/w1", worktreePath: "wt", sessionId: null, status: "running", kind: "worker", spawnedBy: null, pausedReason: null, createdAt: 1 },
  column: "working",
}] as unknown as BoardCard[];
const withCard = (extra: Record<string, unknown>) => [{ ...cards[0], ...extra }] as unknown as BoardCard[];
const PROFILES = [profile("claude", "Claude Code", "local"), profile("local", "Lokal")];
const node = async () => screen.findByRole("group", { name: "Fix the start block" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listAgentProfiles).mockResolvedValue(PROFILES);
  vi.mocked(getQuotaState).mockResolvedValue([]);
  vi.mocked(getBudgets).mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

it("shows the fallback name on a blocked profile", async () => {
  vi.mocked(getQuotaState).mockResolvedValue([quota("claude", "blocked")]);
  render(<FlowTab cards={cards} />);
  const flowNode = await node();
  expect(await within(flowNode).findByText("Failover: Lokal")).toBeInTheDocument();
  expect(within(flowNode).getByText("zu wenig Daten")).toBeInTheDocument();
  expect(within(flowNode).queryByRole("meter")).toBeNull();
  expect(within(flowNode).getByText("Fix the start block")).toBeInTheDocument();
  expect(within(flowNode).getByRole("img", { name: "Läuft" })).toBeInTheDocument();
});

it("draws the meter of the tighter window and names no failover while the profile is open", async () => {
  vi.mocked(getQuotaState).mockResolvedValue([quota("claude", "ok")]);
  vi.mocked(getBudgets).mockResolvedValue([budget("claude", 30, 80)]);
  render(<FlowTab cards={cards} />);
  const meter = await within(await node()).findByRole("meter");
  expect(meter).toHaveAttribute("aria-valuenow", "80");
  expect(meter.getAttribute("aria-label")).toContain("Claude Code");
  expect(screen.queryByText(/Failover/)).toBeNull();
});

it("keeps the node unmeasured when the quota reads fail", async () => {
  for (const read of [listAgentProfiles, getQuotaState, getBudgets]) vi.mocked(read).mockRejectedValue(new Error("down"));
  render(<FlowTab cards={cards} />);
  const flowNode = await node();
  expect(await within(flowNode).findByText("zu wenig Daten")).toBeInTheDocument();
  expect(within(flowNode).queryByRole("meter")).toBeNull();
  expect(within(flowNode).queryByText(/Failover/)).toBeNull();
  expect(within(flowNode).getByText("Fix the start block")).toBeInTheDocument();
});

it("reads the quota again every five seconds with one interval", async () => {
  vi.useFakeTimers();
  const { unmount } = render(<FlowTab cards={cards} />);
  const reads = () => vi.mocked(getBudgets).mock.calls.length;
  await act(async () => {});
  expect(reads()).toBe(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(reads()).toBe(2);
  unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(reads()).toBe(2);
});

// COMP-4-3: the node wears the card's proof strip, read from the same card fields.
it("shows an unconnected red-first badge on the node", async () => {
  render(<FlowTab cards={withCard({ testStatus: "pass", prUrl: "https://github.com/o/r/pull/7" })} />);
  const strip = within(await node()).getByRole("group", { name: "Beweis" });
  expect(within(strip).getAllByText("noch nicht verbunden")).toHaveLength(3);
  expect(within(strip).getByRole("link", { name: "öffnen" })).toHaveAttribute("href", "https://github.com/o/r/pull/7");
  expect(within(strip).queryByText("bestanden")).toBeNull();
});

it("lifts the node lamp to done when the test passed", async () => {
  render(<FlowTab cards={withCard({ column: "done", testStatus: "pass" })} />);
  // The ok lamp is the plain atom; it must not be the red "ohne Beweis" one.
  const lamp = within(await node()).getByRole("img", { name: "Fertig" });
  expect(lamp).not.toHaveClass("g-lamp--bad");
  expect(within(await node()).queryByRole("img", { name: "ohne Beweis" })).toBeNull();
});
