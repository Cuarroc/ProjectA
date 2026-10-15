import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../../components/TerminalView", () => ({ default: () => null }));

import App from "../../App";
import { isStart } from "./routing";

const FLAG_KEY = "projecta.settings.featureFlag.d1_neue_oberflaeche";
/** These tests walk routes outside the default scope, so "weitere Bereiche" is on. */
const SCOPE_KEY = "projecta.settings.featureFlag.weitere_bereiche";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(SCOPE_KEY, "1");
  window.location.hash = "#/start";
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((command: string) => {
    if (["list_projects", "list_agent_profiles", "list_workers", "list_questions", "get_provider_overview"].includes(command)) return Promise.resolve([]);
    if (command === "get_board_state") return Promise.resolve({ cards: [], coordinators: [] });
    return new Promise(() => {});
  });
});
afterEach(cleanup);

it("owns exactly the route /start", () => {
  expect(isStart("/start")).toBe(true);
  expect(isStart("/start/")).toBe(true);
  expect(isStart("/startx")).toBe(false);
});

it("shows the Ersteinrichtung stepper at #/start when D1 is on and has no sidebar entry", async () => {
  localStorage.setItem(FLAG_KEY, "1");
  const { container } = render(<App />);
  // The shell's own placeholder title is hidden by mount.css while the route is fresh.
  expect(await screen.findByRole("list", { name: "Schritte der Einrichtung" }, { timeout: 5000 })).toBeInTheDocument();
  expect(container.querySelector(".g-shell-content .st-screen")).toHaveTextContent("Ersteinrichtung");
  expect(container.querySelector(".g-mount")).toHaveAttribute("data-fresh", "on");
  expect(screen.queryByRole("link", { name: "Ersteinrichtung" })).toBeNull();
  await act(async () => { window.location.hash = "#/team"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  await waitFor(() => expect(container.querySelector(".st-screen")).toBeNull());
});

it("leaves the old app alone at #/start while D1 is off", async () => {
  localStorage.setItem(FLAG_KEY, "0");
  const { container } = render(<App />);
  await waitFor(() => expect(container.querySelector(".app")).not.toBeNull());
  expect(container.querySelector(".g-mount")).toBeNull();
  expect(container.querySelector(".st-screen")).toBeNull();
});
