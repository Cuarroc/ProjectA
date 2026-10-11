import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("../../components/TerminalView", () => ({ default: () => null }));

import App from "../../App";

const FLAG_KEY = "projecta.settings.featureFlag.d1_neue_oberflaeche";
const provider = { id: "claude", name: "Claude Code", kind: "subscription", connected: true, detail: null, quotaState: "ok", blockedUntil: null, omniRouteOnline: true, usage: null, vaultError: null };
/** The shell placeholder stays in the DOM (hidden by CSS), so look inside the route only. */
const route = (container: HTMLElement) => within(container.querySelector<HTMLElement>(".g-sr")!);
const go = (hash: string) => act(() => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent("hashchange")); });

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
    return new Promise(() => {});
  });
});
afterEach(cleanup);

describe("Steuerung route behind D1", () => {
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

  it("leaves /steuerung to the old Insights view while the switch is off", async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".app")).not.toBeNull());
    await go("#/steuerung");
    expect(container.querySelector(".g-shell")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Kontingente" })).toBeNull();
  });
});
