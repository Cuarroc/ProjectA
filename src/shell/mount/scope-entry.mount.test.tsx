import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (command: string) => {
  if (["list_projects", "list_agent_profiles", "list_workers", "list_questions", "get_provider_overview", "get_quota_state", "get_reason_catalog"].includes(command)) return [];
  if (command === "get_board_state") return { cards: [], coordinators: [] };
  if (command === "get_panic_notice") return { current: null, previous: null };
  return new Promise(() => {});
}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import App from "../../App";

beforeEach(() => { localStorage.clear(); });
afterEach(cleanup);

async function mountSettings() {
  window.location.hash = "#/einstellungen";
  render(<App />);
  await act(async () => { await vi.dynamicImportSettled(); });
}

it("hides the quota entry by default and restores its destination when enabled", async () => {
  await mountSettings();
  expect(screen.getByRole("navigation", { name: "Hauptnavigation" })).toBeVisible();
  expect(screen.queryByRole("link", { name: /Kontingente:/ })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Weitere Bereiche" }));
  const link = screen.getByRole("link", { name: /Kontingente:/ });
  expect(link).toHaveAttribute("href", "#/steuerung");
  fireEvent.click(link);
  await waitFor(() => expect(window.location.hash).toBe("#/steuerung"));
  expect(await screen.findByRole("link", { name: "Betrieb", current: "page" })).toBeVisible();
});

it("hides the setup team action by default and restores its destination when enabled", async () => {
  window.location.hash = "#/start";
  render(<App />);
  await act(async () => { await vi.dynamicImportSettled(); });
  expect(screen.getByRole("list", { name: "Schritte der Einrichtung" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Team ansehen" })).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Einstellungen" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Weitere Bereiche" }));
  await act(async () => { window.location.hash = "#/start"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  fireEvent.click(await screen.findByRole("button", { name: "Team ansehen" }));
  await waitFor(() => expect(window.location.hash).toBe("#/team"));
  expect(await screen.findByRole("link", { name: "Betrieb", current: "page" })).toBeVisible();
});
