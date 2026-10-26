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
  fireEvent.click(screen.getByRole("switch", { name: "Weitere Bereiche" }));
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
  fireEvent.click(await screen.findByRole("switch", { name: "Weitere Bereiche" }));
  await act(async () => { window.location.hash = "#/start"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  fireEvent.click(await screen.findByRole("button", { name: "Team ansehen" }));
  await waitFor(() => expect(window.location.hash).toBe("#/team"));
  expect(await screen.findByRole("link", { name: "Betrieb", current: "page" })).toBeVisible();
});

const NOTICE = "Dieser Bereich ist noch nicht verbunden und ausgeblendet.";
const FLAG_KEY = "projecta.settings.featureFlag.weitere_bereiche";
const mountAt = async (hash: string) => {
  window.location.hash = hash;
  render(<App />);
  await act(async () => { await vi.dynamicImportSettled(); });
};
const goTo = (hash: string) => act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent("hashchange")); });
const title = () => document.getElementById("g-shell-title")?.textContent;

it("keeps a hidden deep link and shows its honest settings recovery", async () => {
  await mountAt("#/gedaechtnis");
  expect(window.location.hash).toBe("#/gedaechtnis");
  expect(title()).toBe("Wissen");
  expect(screen.getByText(NOTICE)).toBeVisible();
  await goTo("#/steuerung/autonomie");
  expect(window.location.hash).toBe("#/steuerung/autonomie");
  expect(title()).toBe("Core · Steuerung · Core & Autonomie");
  expect(screen.getByText(NOTICE)).toBeVisible();
  expect(screen.queryByRole("link", { name: "Betrieb", current: "page" })).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Weitere Bereiche in den Einstellungen einschalten" }));
  fireEvent.click(await screen.findByRole("switch", { name: "Weitere Bereiche" }));
  expect(localStorage.getItem(FLAG_KEY)).toBe("1");
  await goTo("#/gedaechtnis");
  expect(window.location.hash).toBe("#/gedaechtnis");
  expect(title()).toBe("Wissen");
  expect(screen.queryByText(NOTICE)).toBeNull();
  expect(screen.getByText(/Noch nicht verbunden/)).toBeVisible();
  cleanup();
  await mountAt("#/gedaechtnis/");
  expect(screen.queryByText(NOTICE)).toBeNull();
  expect(title()).toBe("Wissen");
});

it("leaves visible and unknown and explicitly switched-off routes as they are", async () => {
  await mountAt("#/nirgends");
  expect(window.location.hash).toBe("#/nirgends");
  expect(screen.getByText("Diese Adresse gibt es nicht.")).toBeVisible();
  await goTo("#/start");
  expect(screen.getByRole("list", { name: "Schritte der Einrichtung" })).toBeVisible();
  localStorage.setItem(FLAG_KEY, "0");
  cleanup();
  await mountAt("#/team/personas?x=1");
  expect(window.location.hash).toBe("#/team/personas?x=1");
  expect(title()).toBe("Team · Personas");
  expect(screen.getByText(NOTICE)).toBeVisible();
});

it("keeps a hidden deep link after the legacy app has left another goal", async () => {
  await mountAt("#/einstellungen");
  await goTo("#/beweise/diff");
  expect(window.location.hash).toBe("#/beweise/diff");
  expect(title()).toBe("Beweise · Diff");
  expect(screen.getByText(NOTICE)).toBeVisible();
});
