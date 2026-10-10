import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../../components/TerminalView", () => ({ default: () => null }));

import App from "../../App";

const FLAG_KEY = "projecta.settings.featureFlag.d1_neue_oberflaeche";
const go = (hash: string) => act(() => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent("hashchange")); });

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((command: string) => {
    if (["list_projects", "list_agent_profiles", "list_workers", "list_questions"].includes(command)) return Promise.resolve([]);
    if (command === "get_board_state") return Promise.resolve({ cards: [], coordinators: [] });
    if (command === "get_panic_notice") return Promise.resolve({ current: null, previous: null });
    if (command === "get_reason_catalog") return Promise.resolve([]);
    return new Promise(() => {});
  });
});
afterEach(cleanup);

describe("Glass shell mount behind D1", () => {
  it("renders the old app alone while the switch is off", async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".app")).not.toBeNull());
    expect(container.querySelector(".g-shell")).toBeNull();
    expect(container.querySelector(".g-mount")).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("houses the old Work view in the shell content slot when on", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    const { container } = render(<App />);
    expect(await screen.findByRole("navigation", { name: "Hauptnavigation" })).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector(".g-shell-content .g-mount-legacy > .app")).not.toBeNull());
    expect(screen.getByRole("link", { name: "Leitstand" })).toHaveAttribute("aria-current", "page");
  });

  it("follows the route into the old Settings and back from an old view change to the route", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    render(<App />);
    await screen.findByRole("navigation", { name: "Hauptnavigation" });
    await go("#/einstellungen");
    expect(await screen.findByRole("tab", { name: "Settings", selected: true })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("tab", { name: "Review" }));
    await waitFor(() => expect(window.location.hash).toBe("#/beweise"));
  });

  it("keeps the old app mounted behind a route without an old view", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".g-mount-legacy > .app")).not.toBeNull());
    await go("#/team");
    expect(container.querySelector(".g-mount-legacy")).toHaveAttribute("hidden");
    expect(container.querySelector(".g-mount-legacy > .app")).not.toBeNull();
  });

  it("is switched on and off from Settings General and persists", async () => {
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    const toggle = await screen.findByRole("checkbox", { name: "Neue Oberfläche (Vorschau)" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(localStorage.getItem(FLAG_KEY)).toBe("1");
    expect(await screen.findByRole("navigation", { name: "Hauptnavigation" })).toBeInTheDocument();
    await go("#/einstellungen");
    fireEvent.click(await screen.findByRole("checkbox", { name: "Neue Oberfläche (Vorschau)" }));
    expect(localStorage.getItem(FLAG_KEY)).toBeNull();
    await waitFor(() => expect(container.querySelector(".g-shell")).toBeNull());
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
