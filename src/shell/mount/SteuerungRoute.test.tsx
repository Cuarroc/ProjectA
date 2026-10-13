import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import App from "../../App";
import type { UsageReport } from "../../types";

const FLAG_KEY = "projecta.settings.featureFlag.d1_neue_oberflaeche";
const provider = { id: "claude", name: "Claude Code", kind: "subscription", connected: true, detail: null, quotaState: "ok", blockedUntil: null, omniRouteOnline: true, usage: null, vaultError: null };
/** The shell placeholder stays in the DOM (hidden by CSS), so look inside the route only. */
const route = (container: HTMLElement) => within(container.querySelector<HTMLElement>(".g-sr")!);
const go = (hash: string) => act(() => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent("hashchange")); });
const usage: UsageReport = {
  online: true, authorized: true, reportedCostUsd: 55.5,
  today: { requests: 8, tokensIn: 9000, tokensOut: 700, costUsd: 98.76, priced: 8 },
  total: { requests: 40, tokensIn: 52000, tokensOut: 18000, costUsd: 98.76, priced: 40 },
  events: [
    { id: "a", ts: 1, profileId: null, provider: "anthropic", model: "demo-a", tokensIn: 1000, tokensOut: 200, costUsd: 12.34, rawJson: "{}" },
    { id: "b", ts: 2, profileId: null, provider: "openai", model: "demo-b", tokensIn: 500, tokensOut: 50, costUsd: 12.34, rawJson: "{}" },
  ],
};
const usageCalls = () => mocks.invoke.mock.calls.filter(([command]) => command === "get_omniroute_usage");

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((command: string) => {
    if (["list_projects", "list_agent_profiles", "list_workers", "list_questions", "get_quota_state"].includes(command)) return Promise.resolve([]);
    if (command === "get_provider_overview") return Promise.resolve([provider]);
    if (command === "get_board_state") return Promise.resolve({ cards: [], coordinators: [] });
    if (command === "get_panic_notice") return Promise.resolve({ current: null, previous: null });
    if (command === "get_reason_catalog") return Promise.resolve([]);
    if (command === "get_omniroute_usage") return Promise.resolve(usage);
    return new Promise(() => {});
  });
});
afterEach(cleanup);

describe("Steuerung route behind D1", () => {
  it("renders reported usage totals below Kontingente in the Glass route", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    const { container } = render(<App />);
    await screen.findByRole("navigation", { name: "Hauptnavigation" }, { timeout: 5000 });
    await go("#/steuerung");
    await waitFor(() => expect(container.querySelectorAll(".kb-panel")).toHaveLength(1));
    const ledger = container.querySelector<HTMLElement>(".kb-panel")!;
    expect(ledger.previousElementSibling).toHaveClass("kt-screen");
    const book = within(ledger);
    const period = await book.findByRole("region", { name: "Zeitraum" });
    expect(within(period).getByText("8 Anfragen · 9.000 Tokens rein · 700 Tokens raus")).toBeInTheDocument();
    expect(within(period).getByText("40 Anfragen · 52.000 Tokens rein · 18.000 Tokens raus")).toBeInTheDocument();
    const rows = within(book.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual([
      ["anthropic", "demo-a", "1", "1.000", "200"],
      ["openai", "demo-b", "1", "500", "50"],
      ["Summe", "", "2", "1.500", "250"],
    ]);
    expect(ledger.textContent).not.toMatch(/[$€]|USD|EUR|12,34|98,76|55,5/);
    expect(book.getByText("Zeugnisse noch nicht verbunden")).toBeInTheDocument();
    expect(route(container).getAllByRole("link")).toHaveLength(3);
    await go("#/steuerung/xyz");
    expect(container.querySelectorAll(".kb-panel")).toHaveLength(1);
    expect(window.location.hash).toBe("#/steuerung/xyz");
  });

  it("does not mount the usage ledger on non quota tabs or with D1 off", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    const mounted = render(<App />);
    await screen.findByRole("navigation", { name: "Hauptnavigation" }, { timeout: 5000 });
    await go("#/steuerung");
    await waitFor(() => expect(mounted.container.querySelectorAll(".kb-panel")).toHaveLength(1));
    const calls = usageCalls().length;
    for (const hash of ["#/steuerung/verbesserungen", "#/steuerung/autonomie"]) {
      await go(hash);
      expect(mounted.container.querySelector(".kb-panel")).toBeNull();
      expect(usageCalls()).toHaveLength(calls);
    }
    await go("#/steuerung");
    await waitFor(() => expect(mounted.container.querySelectorAll(".kb-panel")).toHaveLength(1));
    expect(usageCalls()).toHaveLength(calls + 1);
    mounted.unmount();
    localStorage.removeItem(FLAG_KEY);
    mocks.invoke.mockClear();
    const legacy = render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Insights" }));
    await screen.findByTestId("insights");
    expect(legacy.container.querySelector(".kb-panel")).toBeNull();
    expect(legacy.container.querySelector(".g-shell")).toBeNull();
    // The legacy Usage view still owns its existing read with a 12-row limit.
    expect(usageCalls().map(([, args]) => args)).toEqual([{ limit: 12 }]);
  });

  it("shows an unreadable usage ledger without replacing Kontingente", async () => {
    const fallback = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command: string) => command === "get_omniroute_usage"
      ? Promise.reject(new Error("unavailable")) : fallback(command));
    localStorage.setItem(FLAG_KEY, "1");
    const { container } = render(<App />);
    await screen.findByRole("navigation", { name: "Hauptnavigation" }, { timeout: 5000 });
    await go("#/steuerung");
    expect(await route(container).findByText("Kostenbuch nicht lesbar")).toBeInTheDocument();
    expect(route(container).getByRole("heading", { level: 1, name: "Kontingente" })).toBeInTheDocument();
    expect(await route(container).findByRole("article", { name: "Claude Code" })).toBeInTheDocument();
    const book = within(container.querySelector<HTMLElement>(".kb-panel")!);
    expect(book.queryByRole("table")).toBeNull();
    expect(book.queryByRole("region", { name: "Zeitraum" })).toBeNull();
    expect(book.getByText("Zeugnisse noch nicht verbunden")).toBeInTheDocument();
  });

  it("shows the Kontingente screen at /steuerung when the switch is on", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    const { container } = render(<App />);
    await screen.findByRole("navigation", { name: "Hauptnavigation" });
    await go("#/steuerung");
    expect(await screen.findByRole("heading", { level: 1, name: "Kontingente" })).toBeInTheDocument();
    expect(await screen.findByRole("article", { name: "Claude Code" })).toBeInTheDocument();
    expect(route(container).getByRole("link", { name: "Kontingente" })).toHaveAttribute("aria-current", "page");
    expect(container.querySelector(".g-mount-legacy")).toHaveAttribute("hidden");
    expect(container.querySelector(".g-mount")).toHaveAttribute("data-fresh", "on");
  });

  it("says plainly that Verbesserungen and Core & Autonomie are not connected", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    const { container } = render(<App />);
    await screen.findByRole("navigation", { name: "Hauptnavigation" });
    for (const [hash, tab] of [["#/steuerung/verbesserungen", "Verbesserungen"], ["#/steuerung/autonomie", "Core & Autonomie"]]) {
      await go(hash);
      await waitFor(() => expect(container.querySelector(".g-sr")).not.toBeNull());
      const panel = await route(container).findByRole("region", { name: tab });
      expect(within(panel).getByText(/Noch nicht verbunden/)).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Kontingente" })).toBeNull();
      expect(route(container).getByRole("link", { name: tab })).toHaveAttribute("aria-current", "page");
    }
  });

  it("falls back to the Kontingente tab for an unknown sub-path without rewriting the URL", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    const { container } = render(<App />);
    await screen.findByRole("navigation", { name: "Hauptnavigation" }, { timeout: 5000 });
    await go("#/steuerung/xyz");
    expect(await screen.findByRole("heading", { level: 1, name: "Kontingente" })).toBeInTheDocument();
    expect(route(container).getByRole("link", { name: "Kontingente" })).toHaveAttribute("aria-current", "page");
    expect(route(container).getAllByRole("link")).toHaveLength(3);
    expect(window.location.hash).toBe("#/steuerung/xyz");
  });

  it("leaves /steuerung to the old Insights view while the switch is off", async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".app")).not.toBeNull());
    await go("#/steuerung");
    expect(container.querySelector(".g-shell")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Kontingente" })).toBeNull();
  });
});
