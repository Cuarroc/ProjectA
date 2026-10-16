import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { invoke } from "@tauri-apps/api/core";
import type { Provider, ProviderUsage, QuotaState } from "../../types";
import { KontingenteScreen, QuotaWindows } from "./KontingenteScreen";
import { blockedNote, formatFreeAt, providerInitials, windowSlot } from "./kontingente";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getIdentifier: async () => "com.projecta.app" }));

const now = () => Math.floor(Date.now() / 1000);
const provider = (id: string, name: string, extra: Partial<Provider> = {}): Provider => ({
  id, name, kind: "subscription", connected: true, detail: null, quotaState: "ok", blockedUntil: null,
  omniRouteOnline: true, usage: null, vaultError: null, ...extra,
});
const usage = (windowLabel: string, percent: number | null, extra: Partial<ProviderUsage> = {}): ProviderUsage => ({
  percent, used: null, limit: null, windowLabel, resetsAt: now() + 3 * 3600, source: "api", observedAt: now(), ...extra,
});

function feed(providers: unknown[], quotas: unknown[] = []) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === "get_quota_state" ? quotas : providers));
}
const card = async (name: string) => within(await screen.findByRole("article", { name }));

beforeEach(() => { vi.mocked(invoke).mockReset(); });

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
    expect(within(section).queryByText(/V2-/)).toBeNull();
  }
});

it("says so when no provider is known", async () => {
  feed([]);
  render(<KontingenteScreen />);
  expect(await screen.findByText("Noch kein Anbieter")).toBeInTheDocument();
});

it("shows a non-blocked provider's detail as its note and nothing when it has none", async () => {
  const ok = provider("claude", "Claude Code", { detail: "Anmeldung läuft ab" }) as never;
  const bare = provider("codex", "Codex") as never;
  expect(blockedNote(ok, undefined)).toBe("Anmeldung läuft ab");
  expect(blockedNote(bare, undefined)).toBeNull();
  feed([ok, bare]);
  render(<KontingenteScreen />);
  const c = await card("Claude Code");
  expect(c.getByText("Anmeldung läuft ab")).toHaveClass("kt-note");
  expect((await card("Codex")).queryByText(/frei/i)).toBeNull();
});

it("returns no free-again time for an expired instant or NaN", () => {
  const at = new Date(2026, 9, 10, 12, 0, 0);
  const secs = (d: Date) => Math.floor(d.getTime() / 1000);
  expect(formatFreeAt(secs(at) - 60, at)).toBeNull();
  expect(formatFreeAt(secs(at), at)).toBeNull();
  expect(formatFreeAt(Number.NaN, at)).toBeNull();
  expect(formatFreeAt(secs(at) + 60, at)).toBe("12:01");
});

it("shows only the reason on a blocked card whose reset time has passed", async () => {
  const q: QuotaState = { profileId: "codex", state: "blocked", blockedUntil: now() - 600, reason: "Wochenlimit", omniRouteOnline: true };
  feed([provider("codex", "Codex", { quotaState: "blocked", blockedUntil: now() - 600 })], [q]);
  render(<KontingenteScreen />);
  const c = await card("Codex");
  expect(c.getByText("Wochenlimit")).toHaveClass("kt-note");
  expect(c.queryByText(/frei/i)).toBeNull();
});

it("maps non-ASCII window labels only when the whole word is a window name", () => {
  expect(windowSlot("Wöchentlich")).toBeNull();
  expect(windowSlot("Monatsübersicht")).toBeNull();
  expect(windowSlot("ÄMonat")).toBeNull();
  expect(windowSlot("Monat")).toBe("month");
});

it("keeps the initials fallback in the same capitalised style when every candidate is taken", () => {
  const twins = ["ab", "Ab", "aB"].map((id) => ({ id, name: "Ab" }));
  const [first, second, third] = [...providerInitials(twins).values()];
  expect([first, second]).toEqual(["Ab", "AB"]);
  expect(third).toMatch(/^[A-Z]/);
  expect(new Set([first, second, third]).size).toBe(3);
});


it("groups all unknown quota windows into one readable note", async () => {
  feed([provider("unknown", "Anbieter ohne Messwerte", { quotaState: "unknown" })]);
  render(<KontingenteScreen />);
  const c = await card("Anbieter ohne Messwerte");
  const note = c.getByRole("note", { name: "Unbekannte Kontingentfenster" });
  expect(note).toHaveTextContent("5 h, Woche, Monat");
  expect(within(note).getByText("noch nicht verbunden")).toBeInTheDocument();
  expect(c.getAllByRole("note")).toHaveLength(1);
  expect(c.getAllByText("noch nicht verbunden")).toHaveLength(1);
  expect(c.queryByRole("meter")).toBeNull();
  expect(note).not.toHaveTextContent(/0\s*%/);
});

it("a quota state the app does not know shows the unknown lamp and word", async () => {
  feed([provider("later", "Neuer Zustand", { quotaState: "paused" as never })]);
  render(<KontingenteScreen />);
  const article = await screen.findByRole("article", { name: "Neuer Zustand" });
  // While the quota read is pending (or failed) the card shows "unknown" anyway; assert only the loaded state.
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  expect(within(article).getByText("Unbekannt")).toBeInTheDocument();
  expect(article.querySelector(".kt-head .g-lamp")).toHaveClass("g-lamp--unknown");
});

it("keeps measured quota windows and names only the missing windows", async () => {
  feed([provider("zero", "Gemessene Null", { usage: usage("5-Stunden-Fenster", 0) })]);
  render(<KontingenteScreen />);
  const c = await card("Gemessene Null");
  expect(c.getByRole("meter", { name: "5 h: 0 Prozent verbraucht" })).toHaveAttribute("aria-valuenow", "0");
  const note = c.getByRole("note", { name: "Unbekannte Kontingentfenster" });
  expect(note).toHaveTextContent("Woche, Monat");
  expect(note).not.toHaveTextContent("5 h");
  expect(c.getAllByText("noch nicht verbunden")).toHaveLength(1);
});


it("renders fully measured windows including zero without a missing note", () => {
  render(<QuotaWindows rows={[
    { key: "five", label: "5 h", percent: 0, resetsAt: now() + 10800 },
    { key: "week", label: "Woche", percent: 38, resetsAt: null },
    { key: "month", label: "Monat", percent: 98, resetsAt: null },
  ]} />);
  expect(screen.getAllByRole("meter").map((m) => m.getAttribute("aria-valuenow"))).toEqual(["0", "38", "98"]);
  expect(screen.queryByRole("note")).toBeNull();
  expect(screen.getByText("Reset in 3 h")).toBeInTheDocument();
});

it("keeps a custom missing window and its reset in the grouped note", async () => {
  feed([provider("custom", "Anbieter mit einem besonders langen sichtbaren Anzeigenamen", { usage: usage("Tagesfenster", null) })]);
  render(<KontingenteScreen />);
  const c = await card("Anbieter mit einem besonders langen sichtbaren Anzeigenamen");
  const note = c.getByRole("note", { name: "Unbekannte Kontingentfenster" });
  expect(note).toHaveTextContent("5 h, Woche, Monat, Tagesfenster (Reset in 3 h)");
  expect(within(note).getByText("kein Prozentwert gemeldet")).toBeInTheDocument();
  expect(c.queryByRole("meter")).toBeNull();
});

it("keeps overview load errors visible without invented measurements", async () => {
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd === "get_provider_overview") throw "Anbieter konnten nicht geladen werden";
    return [];
  });
  render(<KontingenteScreen />);
  expect(await screen.findByText("Anbieter konnten nicht geladen werden")).toBeInTheDocument();
  expect(screen.queryByRole("meter")).toBeNull();
});


it("does not show an empty provider inventory after an overview failure", async () => {
  let fail = true;
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd === "get_provider_overview" && fail) throw new Error("Anbieter konnten nicht geladen werden");
    if (cmd === "get_provider_overview" || cmd === "get_quota_state") return [];
    throw new Error(`Unexpected command: ${cmd}`);
  });
  render(<KontingenteScreen />);
  expect(await screen.findByText("Anbieter konnten nicht geladen werden")).toBeInTheDocument();
  expect(screen.queryByText("Noch kein Anbieter")).toBeNull();
  expect(screen.queryByRole("meter")).toBeNull();
  fail = false;
  fireEvent.focus(window);
  expect(await screen.findByText("Noch kein Anbieter")).toBeInTheDocument();
  expect(screen.queryByText("Anbieter konnten nicht geladen werden")).toBeNull();
});

it("shows unread quota status while provider measurements are available", async () => {
  let rejectQuota!: (error: Error) => void;
  const pending = new Promise<QuotaState[]>((_, reject) => { rejectQuota = reject; });
  const measured = provider("claude", "Claude Code", { usage: usage("5-Stunden-Fenster", 38) });
  const blocked = provider("codex", "Codex", { quotaState: "blocked" });
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd === "get_provider_overview") return [measured, blocked];
    if (cmd === "get_quota_state") return pending;
    throw new Error(`Unexpected command: ${cmd}`);
  });
  render(<KontingenteScreen />);
  const c = await card("Claude Code");
  expect(c.getByRole("meter")).toHaveAttribute("aria-valuenow", "38");
  expect(screen.getByRole("status")).toHaveTextContent("Sperrstatus wird gelesen");
  expect(c.queryByText("OK")).toBeNull();
  expect((await card("Codex")).getByText("Blockiert")).toBeInTheDocument();
  await act(async () => { rejectQuota(new Error("quota read failed")); });
  expect(screen.getByRole("status")).toHaveTextContent("Sperrstatus gerade nicht prüfbar");
  expect(screen.queryByText(/Sperrstatus wird gelesen/)).toBeNull();
  expect(screen.queryByText(/Letzter gelesener Sperrstatus/)).toBeNull();
  expect(c.getByRole("meter")).toHaveAttribute("aria-valuenow", "38");
  expect(c.queryByText("OK")).toBeNull();
  expect((await card("Codex")).getByText("Blockiert")).toBeInTheDocument();
  expect(new Set(vi.mocked(invoke).mock.calls.map(([cmd]) => cmd)))
    .toEqual(new Set(["get_provider_overview", "get_quota_state"]));
});

it("marks retained quota observations as stale after a failed poll", async () => {
  vi.useFakeTimers();
  let reads = 0;
  const q: QuotaState = { profileId: "claude", state: "blocked", blockedUntil: null, reason: "Wochenlimit", omniRouteOnline: true };
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd === "get_provider_overview") return [provider("claude", "Claude Code", { usage: usage("5-Stunden-Fenster", 38) })];
    if (cmd === "get_quota_state") {
      if (++reads === 2) throw new Error("quota poll failed");
      return [q];
    }
    throw new Error(`Unexpected command: ${cmd}`);
  });
  const view = render(<KontingenteScreen />);
  try {
    await act(async () => {});
    expect(screen.getByText("Blockiert")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("status")).toHaveTextContent("Sperrstatus gerade nicht prüfbar");
    expect(screen.getByRole("status")).toHaveTextContent("Letzter gelesener Sperrstatus; seitdem nicht bestätigt.");
    expect(screen.getByText("Blockiert")).toBeInTheDocument();
    expect(screen.getByText("Wochenlimit")).toBeInTheDocument();
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "38");
    fireEvent.click(screen.getByRole("button", { name: "Jetzt prüfen" }));
    await act(async () => {});
    expect(reads).toBe(2);
    expect(screen.getByRole("status")).toHaveTextContent("Letzter gelesener Sperrstatus");
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(reads).toBe(3);
    expect(screen.queryByText(/Sperrstatus gerade nicht prüfbar/)).toBeNull();
    expect(screen.queryByText(/Letzter gelesener Sperrstatus/)).toBeNull();
    expect(screen.getByText("Blockiert")).toBeInTheDocument();
    expect(new Set(vi.mocked(invoke).mock.calls.map(([cmd]) => cmd)))
      .toEqual(new Set(["get_provider_overview", "get_quota_state"]));
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});
