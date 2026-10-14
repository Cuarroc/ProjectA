import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import TerminalRoute from "./TerminalRoute";
import * as sessionProvider from "../../sessions/SessionProvider";
import { saveTerminalFont, saveTerminalFontSize } from "../../lib/settings";
import { CLASSIC_PATH } from "../leitstand/LeitstandRoute";
import { FEATURE_FLAG_STORAGE_PREFIX } from "../../flags/featureFlags";
import { ptyOutput } from "../../lib/eventNames";

const D1_FLAG_KEY = `${FEATURE_FLAG_STORAGE_PREFIX}d1_neue_oberflaeche`;

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(), writes: [] as string[], fonts: [] as Array<{ fontFamily: string; fontSize: number }>,
  listeners: [] as Array<{ event: string; handler: (event: { payload: unknown }) => void; stop: ReturnType<typeof vi.fn> }>,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  cols = 80; rows = 24; options = {}; element = document.createElement("div");
  constructor(options: { fontFamily: string; fontSize: number }) { mocks.fonts.push(options); }
  open(container: HTMLElement) { this.element.className = "xterm"; container.append(this.element); }
  write(chunk: string) { mocks.writes.push(chunk); }
  loadAddon() {} focus() {} refresh() {} attachCustomKeyEventHandler() {} dispose() {}
  onData() { return { dispose() {} }; }
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {
  onDidChangeResults() { return { dispose() {} }; } dispose() {}
} }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class { onContextLoss() {} dispose() {} } }));

beforeEach(() => {
  localStorage.clear(); localStorage.setItem(D1_FLAG_KEY, "1");
  window.location.hash = "#/leitstand/klassisch";
  mocks.listeners = []; mocks.writes = []; mocks.fonts = []; mocks.invoke.mockReset(); mocks.listen.mockReset();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  mocks.listen.mockImplementation(async (event, handler) => {
    const stop = vi.fn(); mocks.listeners.push({ event, handler, stop }); return stop;
  });
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "list_agent_profiles") return [{ id: "shell", name: "Shell", command: "shell", args: [], env: {}, enabled: true, fallback: null }];
    if (["list_projects", "list_workers", "list_questions", "get_reason_catalog"].includes(command)) return [];
    if (command === "get_board_state") return { cards: [], coordinators: [] };
    if (command === "get_panic_notice") return { current: null, previous: null };
    if (command === "spawn_pty") return { sessionId: mocks.invoke.mock.calls.filter(([name]) => name === "spawn_pty").length === 1 ? "session-a" : "session-b" };
    if (command === "get_scrollback") {
      [...mocks.listeners].reverse().find((entry) => entry.event === ptyOutput("session-a"))?.handler({ payload: "live" });
      return "history";
    }
    return null;
  });
});
afterEach(() => { vi.restoreAllMocks(); cleanup(); vi.unstubAllGlobals(); });
const active = (event: string) => mocks.listeners.filter((entry) => entry.event === event && entry.stop.mock.calls.length === 0);
const go = (hash: string) => act(() => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent("hashchange")); });

const openShellTab = async () => {
  fireEvent.click(await screen.findByRole("tab", { name: "Agenten" }));
  fireEvent.click(await screen.findByRole("button", { name: "Neue Sitzung" }));
  fireEvent.click(await screen.findByRole("button", { name: "Shellshell" }));
};

// Real App, SessionProvider, ShellMount and TerminalView; mock only IPC and xterm.
describe("terminal route", () => {
  // Keep the historical test name for the existing red-first trailer; tools may hide the viewer.
  it("keeps one visible viewer on werkzeuge and legacy sibling routes", async () => {
    const view = render(<App />);
    await openShellTab();
    await waitFor(() => expect(active(ptyOutput("session-a"))).toHaveLength(1));
    const output = active(ptyOutput("session-a"))[0];
    const viewer = view.container.querySelector(".xterm");
    for (const path of ["/leitstand/werkzeuge", "/leitstand/verlauf", CLASSIC_PATH]) {
      go(`#${path}`);
      const viewers = view.container.querySelectorAll(".xterm");
      expect(viewers).toHaveLength(1);
      expect(viewers[0]).toBe(viewer);
      expect(output.stop).not.toHaveBeenCalled();
      await waitFor(() => expect(active(ptyOutput("session-a"))).toHaveLength(1));
    }
    go("#/leitstand/terminal");
    await waitFor(() => expect(view.container.querySelectorAll(".xterm")).toHaveLength(1));
    expect(view.container.querySelector(".g-mount-legacy .xterm")).toBeNull();
    await waitFor(() => expect(active(ptyOutput("session-a"))).toHaveLength(1));
    expect(mocks.invoke.mock.calls.some(([name]) => name === "kill_pty")).toBe(false);
    expect(mocks.invoke.mock.calls.filter(([name]) => name === "spawn_pty")).toHaveLength(1);
  });

  it("shows existing session tabs when no session is selected", async () => {
    const noop = vi.fn();
    vi.spyOn(sessionProvider, "useSessions").mockReturnValue({
      sessions: [{ sessionId: "session-a", title: "Shell", profileId: "shell", profileName: "Shell",
        workerId: null, projectId: null, kind: "worker", exited: false, exitCode: null }],
      activeSessionId: null, splitOpen: false, splitSessionId: null, splitPrimary: true, restoreWorkerId: null,
      select: noop, openWorker: noop, openAdHoc: async () => {}, close: noop, drop: noop, toggleSplit: noop,
      showRestore: noop, subscribeExit: async () => {}, unsubscribeExit: noop, markExited: noop, onExit: () => noop,
    });
    const view = render(<TerminalRoute />);
    expect(screen.getByRole("tab", { name: "Shell" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Keine Terminal-Sitzung geöffnet.")).toBeNull();
    expect(view.container.querySelectorAll(".xterm")).toHaveLength(1);
    await waitFor(() => expect(active(ptyOutput("session-a"))).toHaveLength(1));
  });

  it("preserves configured terminal typography across classic and Glass routes", async () => {
    saveTerminalFont("jetbrains"); saveTerminalFontSize(17);
    render(<App />);
    await openShellTab();
    await waitFor(() => expect(mocks.fonts).toHaveLength(1));
    go("#/leitstand/terminal");
    await waitFor(() => expect(mocks.fonts).toHaveLength(2));
    expect(mocks.fonts.map(({ fontFamily }) => fontFamily)).toEqual([
      '"JetBrains Mono", "Cascadia Mono", Consolas, monospace', '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
    ]);
    expect(mocks.fonts[1].fontSize).toBe(17);
  });

  it("replays the same session after settings and leitstand without respawning", async () => {
    const view = render(<App />);
    await openShellTab();
    await waitFor(() => expect(mocks.writes).toEqual(["history", "live"]));
    go("#/leitstand/terminal");
    expect(await screen.findByRole("tablist", { name: "Terminal-Sitzungen" })).toBeVisible();
    await waitFor(() => expect(mocks.writes).toEqual(["history", "live", "history", "live"]));
    go("#/einstellungen");
    await screen.findByRole("button", { name: "Klassische Einstellungen öffnen" });
    expect(active(ptyOutput("session-a"))).toHaveLength(0);
    go("#/leitstand");
    expect(view.container.querySelectorAll(".xterm")).toHaveLength(0);
    go("#/leitstand/terminal");
    await waitFor(() => expect(mocks.writes).toEqual(["history", "live", "history", "live", "history", "live"]));
    expect(mocks.invoke.mock.calls.filter(([name]) => name === "get_scrollback")).toEqual([
      ["get_scrollback", { sessionId: "session-a" }],
      ["get_scrollback", { sessionId: "session-a" }],
      ["get_scrollback", { sessionId: "session-a" }],
    ]);
    expect(mocks.invoke.mock.calls.filter(([name]) => name === "spawn_pty")).toHaveLength(1);
    view.unmount();
    const outputs = mocks.listeners.filter(({ event }) => event === ptyOutput("session-a"));
    expect(outputs).toHaveLength(3);
    for (const output of outputs) expect(output.stop).toHaveBeenCalledTimes(1);
    expect(mocks.invoke.mock.calls.some(([name]) => name === "kill_pty")).toBe(false);
  });

  it("mounts only one xterm for a session across classic and Glass routes", async () => {
    const view = render(<App />);
    await openShellTab();
    await waitFor(() => expect(active(ptyOutput("session-a"))).toHaveLength(1));
    for (const path of ["/leitstand", "/leitstand/terminal", "/leitstand/klassisch", "/leitstand/terminal/"]) {
      go(`#${path}`);
      const visible = path !== "/leitstand";
      expect(view.container.querySelectorAll(".xterm")).toHaveLength(visible ? 1 : 0);
      await waitFor(() => expect(active(ptyOutput("session-a"))).toHaveLength(visible ? 1 : 0));
      if (path.includes("terminal")) {
        expect(view.container.querySelector(".g-mount-legacy .xterm")).toBeNull();
        expect(screen.getByRole("tablist", { name: "Terminal-Sitzungen" })).toBeVisible();
      }
    }
    view.unmount();
    for (const output of mocks.listeners.filter(({ event }) => event === ptyOutput("session-a"))) {
      expect(output.stop).toHaveBeenCalledTimes(1);
    }
  });

  it("selects Glass tabs while mounting only the focused session", async () => {
    const view = render(<App />);
    await openShellTab();
    await waitFor(() => expect(active(ptyOutput("session-a"))).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Neue Sitzung" }));
    fireEvent.click(await screen.findByRole("button", { name: "Shellshell" }));
    await waitFor(() => expect(active(ptyOutput("session-b"))).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Terminal teilen" }));
    expect(view.container.querySelectorAll(".xterm")).toHaveLength(2);
    go("#/leitstand/terminal");
    const tabs = within(await screen.findByRole("tablist", { name: "Terminal-Sitzungen" })).getAllByRole("tab");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(tabs[0]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(active(ptyOutput("session-a"))).toHaveLength(1));
    expect(active(ptyOutput("session-b"))).toHaveLength(0);
    expect(view.container.querySelectorAll(".xterm")).toHaveLength(1);
  });

  it("shows an honest empty state without starting a session", async () => {
    window.location.hash = "#/leitstand/terminal";
    const view = render(<App />);
    expect(await screen.findByText("Keine Terminal-Sitzung geöffnet.")).toBeVisible();
    expect(screen.queryByRole("tablist", { name: "Terminal-Sitzungen" })).toBeNull();
    expect(view.container.querySelectorAll(".xterm")).toHaveLength(0);
    expect(mocks.invoke.mock.calls.some(([name]) => name === "spawn_pty")).toBe(false);
  });
});
