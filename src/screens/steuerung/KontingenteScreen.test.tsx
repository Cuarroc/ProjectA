import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { invoke } from "@tauri-apps/api/core";
import type { QuotaState } from "../../types";
import { KontingenteScreen } from "./KontingenteScreen";
import { formatFreeAt, providerInitials, windowSlot } from "./kontingente";

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

it("anchors the window patterns so look-alike labels stay unmapped", () => {
  for (const label of ["Wochenende", "Monatsende", "15-Stunden-Fenster", "17-Tage-Fenster"]) expect(windowSlot(label)).toBeNull();
  expect(windowSlot("Woche")).toBe("week");
  expect(windowSlot("5h")).toBe("five");
});

it("never gives two providers the same avatar initials", async () => {
  const names = [["claude", "Claude Code"], ["codex", "Codex CLI"], ["copilot", "Copilot"], ["opencode", "OpenCode"], ["omniroute", "OmniRoute"], ["openrouter", "OpenRouter"], ["ollama", "Ollama"]];
  const ps = names.map(([id, name]) => provider(id, name) as never);
  const all = [...providerInitials(ps).values()];
  expect(new Set(all).size).toBe(ps.length);
  feed(ps);
  const { container } = render(<KontingenteScreen />);
  await screen.findByRole("article", { name: "Copilot" });
  const shown = [...container.querySelectorAll(".kt-head .g-ava")].map((a) => a.textContent);
  expect(shown).toHaveLength(ps.length);
  expect(new Set(shown).size).toBe(ps.length);
});

const localAt = (dayOffset: number, h: number, m: number) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return Math.floor(d.getTime() / 1000);
};

it("writes the free-again time as 24-hour German time instead of 12-hour English", async () => {
  const until = localAt(1, 17, 5);
  const q: QuotaState = { profileId: "codex", state: "blocked", blockedUntil: until, reason: "Wochenlimit", omniRouteOnline: true };
  feed([provider("codex", "Codex", { quotaState: "blocked", blockedUntil: until })], [q]);
  render(<KontingenteScreen />);
  const note = (await card("Codex")).getByText(/^Wochenlimit — frei/);
  expect(note.textContent).toMatch(/ — frei \d{2}\.\d{2}\. 17:05$/);
  expect(note.textContent).not.toMatch(/[AP]M/i);
});

it("explains a block the provider reports even when the quota feed is not blocked", async () => {
  const until = localAt(1, 9, 30);
  const q: QuotaState = { profileId: "codex", state: "ok", blockedUntil: null, reason: null, omniRouteOnline: true };
  feed([provider("codex", "Codex", { quotaState: "blocked", blockedUntil: until, detail: "Wochenlimit erreicht" })], [q]);
  render(<KontingenteScreen />);
  const c = await card("Codex");
  expect(c.getByText("Blockiert")).toBeInTheDocument();
  expect(c.getByText(/^Wochenlimit erreicht — frei \d{2}\.\d{2}\. 09:30$/)).toBeInTheDocument();
  expect(c.getByRole("button", { name: "Jetzt prüfen" })).toBeInTheDocument();
});

it("shows the blocked label and reset time of a blocked provider", async () => {
  const until = now() + 2 * 3600;
  const q: QuotaState = { profileId: "codex", state: "blocked", blockedUntil: until, reason: "Wochenlimit", omniRouteOnline: true };
  feed([provider("codex", "Codex", { quotaState: "blocked", blockedUntil: until })], [q]);
  render(<KontingenteScreen />);
  const c = await card("Codex");
  expect(c.getByText(`Wochenlimit — frei ${formatFreeAt(until)}`)).toBeInTheDocument();
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
