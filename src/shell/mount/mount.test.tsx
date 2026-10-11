import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
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
  it("orchestrator draft survives switching tabs", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    window.location.hash = "#/leitstand/werkzeuge";
    const fallback = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "list_projects") return Promise.resolve([{
        id: "project-sample", name: "Sample", repoPath: "fixture-repo", createdAt: 1,
        githubRemote: false, maxWorkers: null, testCommand: null,
      }]);
      if (command === "list_workers") return Promise.resolve([{
        id: "worker-sample", projectId: "project-sample", task: "Inspect sample",
        profileId: "sample", branch: "sample", worktreePath: "fixture-worktree",
        sessionId: "session-sample", status: "running", kind: "worker",
        spawnedBy: null, pausedReason: null, createdAt: 1,
      }]);
      return fallback(command);
    });
    const { container } = render(<App />);
    expect(await screen.findByRole("link", { name: "Werkzeuge" })).toHaveAttribute("aria-current", "page");
    const sidebar = await screen.findByRole("complementary", { name: "Projekte und Panels" });
    fireEvent.click(within(sidebar).getByRole("switch", { name: "Orchestrator" }));
    const draft = within(sidebar).getByRole("textbox", { name: "Prompt für den Orchestrator" });
    fireEvent.change(draft, { target: { value: "Keep this unfinished prompt" } });
    expect(within(sidebar).getByRole("heading", { name: "Workers" })).toBeInTheDocument();

    for (const tab of ["Haupt", "Klassisch"]) {
      fireEvent.click(screen.getByRole("link", { name: tab }));
      await waitFor(() => expect(sidebar).not.toBeVisible());
      expect(sidebar.closest("[hidden]")).not.toBeNull();
      expect(draft).toBeInTheDocument();
      fireEvent.click(await screen.findByRole("link", { name: "Werkzeuge" }));
      await waitFor(() => expect(sidebar).toBeVisible());
      expect(screen.getByRole("textbox", { name: "Prompt für den Orchestrator" })).toBe(draft);
      expect(draft).toHaveValue("Keep this unfinished prompt");
    }

    // Opening a worker must return to its terminal even if Agents was already selected.
    for (let visit = 0; visit < 2; visit++) {
      fireEvent.click(within(sidebar).getByRole("button", { name: /Inspect sample/ }));
      await waitFor(() => expect(window.location.hash).toBe("#/leitstand/klassisch"));
      expect(await screen.findByRole("tab", { name: "Inspect sample" })).toHaveAttribute("aria-selected", "true");
      const session = container.querySelector('[title$=" — session-sample"]');
      expect(session).not.toBeNull();
      await go("#/leitstand");
      expect(session).toBeInTheDocument();
      await go("#/leitstand/werkzeuge");
      expect(container.querySelector('[title$=" — session-sample"]')).toBe(session);
      expect(draft).toHaveValue("Keep this unfinished prompt");
    }
    expect(mocks.invoke.mock.calls.some(([command]) => command === "kill_pty")).toBe(false);
    expect(mocks.invoke.mock.calls.some(([command]) => command === "spawn_pty")).toBe(false);
  });

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
    await go("#/einstellungen/klassisch");
    expect(await screen.findByRole("tab", { name: "Settings", selected: true })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("tab", { name: "Review" }));
    await waitFor(() => expect(window.location.hash).toBe("#/beweise"));
  });

  it("shows the Glass Einstellungen at /einstellungen and keeps the old app hidden behind it", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    window.location.hash = "#/einstellungen";
    const { container } = render(<App />);
    expect(await screen.findByRole("button", { name: "Klassische Einstellungen öffnen" })).toBeInTheDocument();
    expect(container.querySelector(".g-shell-content .es")).not.toBeNull();
    expect(container.querySelector(".g-mount-legacy")).toHaveAttribute("hidden");
    expect(container.querySelector(".g-mount-legacy > .app")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Einstellungen" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("tab", { name: "MCP & Tresor" }));
    expect(await screen.findByText("Dieser Bereich ist in der neuen Oberfläche noch nicht verbunden.")).toBeInTheDocument();
  });

  it("opens the old Settings inside the shell from the classic button", async () => {
    localStorage.setItem(FLAG_KEY, "1");
    window.location.hash = "#/einstellungen";
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Klassische Einstellungen öffnen" }));
    await waitFor(() => expect(window.location.hash).toBe("#/einstellungen/klassisch"));
    expect(await screen.findByRole("tab", { name: "Settings", selected: true })).toBeInTheDocument();
    expect(container.querySelector(".es")).toBeNull();
    expect(container.querySelector(".g-mount-legacy")).not.toHaveAttribute("hidden");
    expect(container.querySelector(".g-shell-content .g-mount-legacy > .app")).not.toBeNull();
  });

  it("leaves /einstellungen to the old Settings alone while the switch is off", async () => {
    window.location.hash = "#/einstellungen";
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector(".app")).not.toBeNull());
    expect(await screen.findByRole("tab", { name: "Settings" })).toBeInTheDocument();
    expect(container.querySelector(".g-mount")).toBeNull();
    expect(container.querySelector(".es")).toBeNull();
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
