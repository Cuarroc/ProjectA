import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { invoke } from "@tauri-apps/api/core";
import { blockedLabel, formatBlockedUntil } from "../../lib/quota";
import type { QuotaState } from "../../types";
import { KontingenteScreen } from "./KontingenteScreen";
import { windowSlot } from "./kontingente";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const now = () => Math.floor(Date.now() / 1000);
const provider = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, kind: "subscription", connected: true, detail: null, quotaState: "ok", blockedUntil: null,
  omniRouteOnline: true, usage: null, vaultError: null, ...extra,
});
const usage = (windowLabel: string, percent: number | null, extra: Record<string, unknown> = {}) => ({
  percent, used: null, limit: null, windowLabel, resetsAt: now() + 3 * 3600, source: "api", observedAt: now(), ...extra,
});

function feed(providers: unknown[], quotas: unknown[] = []) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === "get_quota_state" ? quotas : providers));
}
const card = async (name: string) => within(await screen.findByRole("article", { name }));

beforeEach(() => vi.mocked(invoke).mockReset());

it("maps a window label to its slot and leaves unknown labels unmapped", () => {
  expect(windowSlot("5-Stunden-Fenster")).toBe("five");
  expect(windowSlot("7-Tage-Fenster")).toBe("week");
  expect(windowSlot("Monats-Fenster")).toBe("month");
  expect(windowSlot("Tagesfenster")).toBeNull();
});

it("shows the blocked label and reset time of a blocked provider", async () => {
  const until = now() + 2 * 3600;
  const q: QuotaState = { profileId: "codex", state: "blocked", blockedUntil: until, reason: "Wochenlimit", omniRouteOnline: true };
  feed([provider("codex", "Codex", { quotaState: "blocked", blockedUntil: until })], [q]);
  render(<KontingenteScreen />);
  const c = await card("Codex");
  expect(c.getByText(blockedLabel(q))).toBeInTheDocument();
  expect(blockedLabel(q)).toContain(formatBlockedUntil(until)!);
});

it("shows a measured window as a meter and the others as honest not-connected without digits", async () => {
  feed([provider("claude", "Claude Code", { usage: usage("5-Stunden-Fenster", 38) })]);
  render(<KontingenteScreen />);
  const c = await card("Claude Code");
  const meter = c.getByRole("meter", { name: /5 h/ });
  expect(meter).toHaveAttribute("aria-valuenow", "38");
  expect(c.getAllByRole("meter")).toHaveLength(1);
  for (const slot of ["Woche", "Monat"]) {
    const row = c.getByText(slot).closest(".kt-bar") as HTMLElement;
    expect(within(row).getByText("noch nicht verbunden")).toBeInTheDocument();
    expect(row.textContent).not.toMatch(/\d/);
  }
});

it("keeps an unmapped window under its own label instead of dropping it", async () => {
  feed([provider("oc", "OpenCode", { usage: usage("Tagesfenster", 11) })]);
  render(<KontingenteScreen />);
  const c = await card("OpenCode");
  expect(c.getByRole("meter", { name: /Tagesfenster/ })).toHaveAttribute("aria-valuenow", "11");
});

it("refreshes the overview on 'Jetzt prüfen' and marks the placeholders for rules and log", async () => {
  feed([provider("codex", "Codex", { quotaState: "blocked" })]);
  render(<KontingenteScreen />);
  const c = await card("Codex");
  const before = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "get_provider_overview").length;
  fireEvent.click(c.getByRole("button", { name: "Jetzt prüfen" }));
  await waitFor(() => expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "get_provider_overview").length).toBe(before + 1));
  for (const name of ["Failover-Regeln", "Failover-Protokoll"]) {
    const section = screen.getByRole("region", { name });
    expect(within(section).getByText("noch nicht verbunden")).toBeInTheDocument();
  }
});

it("says so when no provider is known", async () => {
  feed([]);
  render(<KontingenteScreen />);
  expect(await screen.findByText("Noch kein Anbieter")).toBeInTheDocument();
});
