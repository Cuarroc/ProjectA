import { act, cleanup, render, screen } from "@testing-library/react";
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
