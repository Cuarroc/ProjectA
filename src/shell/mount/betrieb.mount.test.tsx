import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("../../components/TerminalView", () => ({ default: () => null }));

import App from "../../App";

const NOW = Math.floor(Date.now() / 1000);
const sidebar = () => within(screen.getByRole("navigation", { name: "Hauptnavigation" }));

beforeAll(async () => { await import("./ShellMount"); });
beforeEach(() => {
  localStorage.clear();
  // D1 on, the scope flag stays off: Betrieb has to be visible by default.
  localStorage.setItem("projecta.settings.featureFlag.d1_neue_oberflaeche", "1");
  localStorage.setItem("projecta.activeProjectId", "p1");
  window.location.hash = "#/betrieb";
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "list_projects") return Promise.resolve([{ id: "p1", name: "Demo", path: "demo", createdAt: NOW }]);
    if (["list_workers", "list_agent_profiles", "list_questions", "list_queue", "get_provider_overview", "get_reason_catalog"].includes(command)) return Promise.resolve([]);
    if (command === "get_board_state") return Promise.resolve({ cards: [], coordinators: [] });
    if (command === "get_resource_snapshot") return Promise.resolve({ observedAt: 1, cpuPermille: null, ramProcessBytes: null, ramTotalBytes: null, diskAppBytes: null, diskFreeBytes: null, tokensIn: 0, tokensOut: 0 });
    if (command === "get_panic_notice") return Promise.resolve({ current: null, previous: null });
    return new Promise(() => {});
  });
});
afterEach(cleanup);

it("opens the Betrieb panel at /betrieb with the Betrieb area current", async () => {
  const { container } = render(<App />);
  expect(await screen.findByRole("region", { name: "Warteschlange" }, { timeout: 5000 })).toBeInTheDocument();
  expect(sidebar().getAllByRole("link").map((a) => a.textContent)).toEqual(["Fabrik", "Betrieb", "Einstellungen"]);
  expect(sidebar().getByRole("link", { name: "Betrieb" })).toHaveAttribute("aria-current", "page");
  expect(container.querySelector(".g-shell-content .g-lr h1")).toHaveTextContent("Betrieb");
  expect(container.querySelector(".g-mount")).toHaveAttribute("data-fresh", "on");
  expect(container.querySelector(".g-mount-legacy")).toHaveAttribute("hidden");
});

it("replaces /leitstand/betrieb by /betrieb", async () => {
  window.location.hash = "#/leitstand/betrieb";
  render(<App />);
  expect(await screen.findByRole("region", { name: "Warteschlange" }, { timeout: 5000 })).toBeInTheDocument();
  await waitFor(() => expect(window.location.hash).toBe("#/betrieb"));
  expect(sidebar().getByRole("link", { name: "Betrieb" })).toHaveAttribute("aria-current", "page");
});

it("replaces the retired hash without adding a history entry", async () => {
  window.location.hash = "#/leitstand/betrieb";
  const before = window.history.length;
  render(<App />);
  await waitFor(() => expect(window.location.hash).toBe("#/betrieb"));
  expect(window.history.length).toBe(before);
});

it("a failed profile read shows a notice", async () => {
  const base = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command: string) => command === "list_agent_profiles" ? Promise.reject(new Error("no profiles")) : base(command));
  render(<App />);
  expect(await screen.findByText("Agenten konnten nicht geladen werden", {}, { timeout: 5000 })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Warteschlange" })).toBeInTheDocument();
});

it("shows an empty state at /betrieb while no project is chosen", async () => {
  localStorage.removeItem("projecta.activeProjectId");
  render(<App />);
  expect(await screen.findByText("Kein Projekt gewählt", {}, { timeout: 5000 })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Warteschlange" })).toBeNull();
});
