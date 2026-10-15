import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isFeatureFlagEnabled } from "../../flags/featureFlags";
import { Shell } from "../Shell";
import { visibleRoutes } from "../routes";
import { ACCEPTANCE_PATHS } from "./routes";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => command === "get_emergency_stop" ? true : []),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

beforeEach(() => { localStorage.clear(); });
afterEach(cleanup);

it("covers every scope registry path with D1 on by default", () => {
  expect(isFeatureFlagEnabled("d1_neue_oberflaeche")).toBe(true);
  expect(isFeatureFlagEnabled("weitere_bereiche")).toBe(false);
  expect(visibleRoutes().map((route) => route.id)).toEqual(["leitstand", "einstellungen", "start"]);
  for (const route of visibleRoutes()) {
    for (const path of [route.path, ...route.tabs.map((tab) => tab.path)]) {
      expect(ACCEPTANCE_PATHS).toContain(path);
    }
  }
});

async function checkStopBand(path: string) {
  window.location.hash = `#${path}`;
  await act(async () => { render(<Shell />); });
  const band = screen.getByText("Not-Aus ist aktiv: neue Aufgaben sind gesperrt.").closest('[role="status"]');
  expect(band).not.toBeNull();
  expect(within(band as HTMLElement).getByRole("button", { name: "Fortsetzen" })).toBeVisible();
  expect(screen.getByTestId("emergency-stop")).toBeVisible();
  expect(window.location.hash).toBe(`#${path}`);
}

it("renders the active StopBand and stop control at /leitstand", () => checkStopBand("/leitstand"));
it("renders the active StopBand and stop control at /leitstand/verlauf", () => checkStopBand("/leitstand/verlauf"));
it("renders the active StopBand and stop control at /leitstand/betrieb", () => checkStopBand("/leitstand/betrieb"));
it("renders the active StopBand and stop control at /leitstand/klassisch", () => checkStopBand("/leitstand/klassisch"));
it("renders the active StopBand and stop control at /leitstand/werkzeuge", () => checkStopBand("/leitstand/werkzeuge"));
it("renders the active StopBand and stop control at /leitstand/terminal", () => checkStopBand("/leitstand/terminal"));
it("renders the active StopBand and stop control at /einstellungen", () => checkStopBand("/einstellungen"));
it("renders the active StopBand and stop control at /einstellungen/mcp", () => checkStopBand("/einstellungen/mcp"));
it("renders the active StopBand and stop control at /einstellungen/benachrichtigungen", () => checkStopBand("/einstellungen/benachrichtigungen"));
it("renders the active StopBand and stop control at /einstellungen/projekt", () => checkStopBand("/einstellungen/projekt"));
it("renders the active StopBand and stop control at /einstellungen/klassisch", () => checkStopBand("/einstellungen/klassisch"));
it("renders the active StopBand and stop control at /start", () => checkStopBand("/start"));
