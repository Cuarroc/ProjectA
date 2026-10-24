import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (command: string) => {
  if (["list_projects", "list_agent_profiles", "list_workers", "list_questions", "get_provider_overview", "get_quota_state", "get_reason_catalog"].includes(command)) return [];
  if (command === "get_board_state") return { cards: [], coordinators: [] };
  if (command === "get_panic_notice") return { current: null, previous: null };
  return new Promise(() => {});
}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import App from "../../App";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("projecta.settings.featureFlag.d1_neue_oberflaeche", "1");
});
afterEach(cleanup);

async function mount(path: string) {
  window.history.replaceState(null, "", `#${path}`);
  render(<App />);
  await act(async () => { await vi.dynamicImportSettled(); });
}

it("opens the Glass MCP tab from its deep link", async () => {
  await mount("/einstellungen/mcp");
  expect(screen.getByRole("tab", { name: "MCP & Tresor", selected: true })).toBeVisible();
  expect(screen.getByRole("region", { name: "Tresor" })).toBeVisible();
  expect(await screen.findByText("Keine Anbieter bekannt")).toBeVisible();
  expect(screen.queryByRole("tab", { name: "Einstellungen" })).toBeNull();
});

it.each([
  ["opens classic settings from the project placeholder", "/einstellungen/projekt", "Projekt"],
  ["opens classic settings from the notifications placeholder", "/einstellungen/benachrichtigungen", "Benachrichtigungen"],
])("%s", async (_name, path, label) => {
  await mount(path);
  const panel = within(screen.getByRole("tabpanel", { name: label }));
  expect(panel.getByText("Dieser Bereich ist in der neuen Oberfläche noch nicht verbunden.")).toBeVisible();
  const classic = panel.getByRole("button", { name: "Klassische Einstellungen öffnen" });
  expect(classic).toBeVisible();
  fireEvent.click(classic);
  await waitFor(() => expect(window.location.hash).toBe("#/einstellungen/klassisch"));
  expect(await screen.findByRole("tab", { name: "Einstellungen", selected: true })).toBeVisible();
  expect(screen.queryByRole("tab", { name: "MCP & Tresor" })).toBeNull();
});

it("mounts all four registered settings tabs with query and trailing slash", async () => {
  for (const [path, name] of [
    ["/einstellungen", "Allgemein"],
    ["/einstellungen/mcp", "MCP & Tresor"],
    ["/einstellungen/benachrichtigungen", "Benachrichtigungen"],
    ["/einstellungen/projekt", "Projekt"],
  ]) {
    await mount(`${path}/?source=bookmark`);
    expect(screen.getByRole("tab", { name, selected: true })).toBeVisible();
    const panel = within(screen.getByRole("tabpanel", { name }));
    if (name === "Allgemein") expect(panel.getByRole("region", { name: "Darstellung" })).toBeVisible();
    else if (name === "MCP & Tresor") expect(panel.getByRole("region", { name: "Tresor" })).toBeVisible();
    else expect(panel.getByText("Dieser Bereich ist in der neuen Oberfläche noch nicht verbunden.")).toBeVisible();
    expect(window.location.hash).toBe(`#${path}/?source=bookmark`);
    cleanup();
  }
});

it("keeps tab clicks hash navigation history and Bell on the matching panel", async () => {
  await mount("/einstellungen");
  for (const [name, path] of [
    ["MCP & Tresor", "/einstellungen/mcp"],
    ["Projekt", "/einstellungen/projekt"],
    ["Allgemein", "/einstellungen"],
  ]) {
    fireEvent.click(screen.getByRole("tab", { name }));
    await waitFor(() => expect(window.location.hash).toBe(`#${path}`));
    expect(await screen.findByRole("tab", { name, selected: true })).toBeVisible();
  }
  await act(async () => { window.history.back(); });
  expect(await screen.findByRole("tab", { name: "Projekt", selected: true })).toBeVisible();
  expect(window.location.hash).toBe("#/einstellungen/projekt");
  await act(async () => { window.history.forward(); });
  expect(await screen.findByRole("tab", { name: "Allgemein", selected: true })).toBeVisible();
  expect(window.location.hash).toBe("#/einstellungen");
  await act(async () => { window.location.hash = "#/einstellungen/mcp/?source=hash"; });
  expect(await screen.findByRole("tab", { name: "MCP & Tresor", selected: true })).toBeVisible();
  const bell = screen.getByRole("link", { name: "Benachrichtigungen: noch nicht verbunden" });
  expect(bell).toHaveAttribute("href", "#/einstellungen/benachrichtigungen");
  fireEvent.click(bell);
  expect(await screen.findByRole("tab", { name: "Benachrichtigungen", selected: true })).toBeVisible();
  expect(window.location.hash).toBe("#/einstellungen/benachrichtigungen");
  expect(within(screen.getByRole("tabpanel", { name: "Benachrichtigungen" })).getByText("Dieser Bereich ist in der neuen Oberfläche noch nicht verbunden.")).toBeVisible();
});

it("preserves classic unknown siblings and D1 off boundaries", async () => {
  for (const path of ["/einstellungen/klassisch", "/einstellungen/unbekannt", "/einstellungen/mcp/unbekannt"]) {
    await mount(path);
    expect(screen.getByRole("tab", { name: "Einstellungen", selected: true })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "MCP & Tresor" })).toBeNull();
    expect(window.location.hash).toBe(`#${path}`);
    cleanup();
  }
  localStorage.setItem("projecta.settings.featureFlag.d1_neue_oberflaeche", "0");
  await mount("/einstellungen/mcp");
  expect(screen.queryByRole("navigation", { name: "Hauptnavigation" })).toBeNull();
  expect(screen.getByRole("tab", { name: "Einstellungen" })).toBeVisible();
  expect(screen.queryByRole("tab", { name: "MCP & Tresor" })).toBeNull();
});
