import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import TerminalRoute from "./TerminalRoute";
import * as sessionProvider from "../../sessions/SessionProvider";
import { saveTerminalFont, saveTerminalFontSize } from "../../lib/settings";
import { CLASSIC_PATH } from "../leitstand/LeitstandRoute";
import { FEATURE_FLAG_STORAGE_PREFIX } from "../../flags/featureFlags";
import { ptyOutput } from "../../lib/eventNames";
import { useEffect } from "react";

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

// Load the real lazy shell before query deadlines start in isolated test runs.
beforeAll(async () => { await import("../../shell/mount/ShellMount"); });
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

const workers = ["one", "two"].map((id) => ({ id, projectId: "p1", task: `Task ${id}`, profileId: "shell",
  branch: id, worktreePath: "wt", sessionId: `pty-${id}`, status: "running", createdAt: 1 }));
function workerData(restore = false) {
  const base = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (command: string, args: unknown) => {
    if (command === "list_projects") return [{ id: "p1", name: "Demo", path: "demo", createdAt: 1 }];
    const list = restore ? workers.map((w) => ({ ...w, sessionId: null, status: "exited" })) : workers;
    if (command === "list_workers") return list;
    if (command === "get_board_state") return { cards: list.map((worker) => ({ worker, column: "working" })), coordinators: [] };
    if (command === "get_session_restore") return { scrollback: "saved output", liveSession: false };
    return base(command, args);
  });
  localStorage.setItem("projecta.activeProjectId", "p1");
}

it("opens the selected card worker without changing other session tabs", async () => {
  workerData();
  const view = render(<App />);
  await openShellTab();
  for (const [step, index] of [0, 1, 0].entries()) {
    go("#/leitstand");
    const cards = within(await screen.findByRole("region", { name: "Agenten" })).getAllByRole("article");
    fireEvent.click(within(cards[index]).getByRole("button", { name: "Shell öffnen" }));
    const tabs = within(await screen.findByRole("tablist", { name: "Terminal-Sitzungen" }));
    await waitFor(() => expect(tabs.getByRole("tab", { name: `Task ${workers[index].id}` })).toHaveAttribute("aria-selected", "true"));
    expect(tabs.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(step === 0
      ? ["Shell", "Task one"] : ["Shell", "Task one", "Task two"]);
    expect(view.container.querySelectorAll(".xterm")).toHaveLength(1);
  }
  expect(mocks.invoke.mock.calls.filter(([name]) => name === "spawn_pty")).toHaveLength(1);
  expect(mocks.invoke.mock.calls.some(([name]) => name === "kill_pty")).toBe(false);
});

it("opens deep linked workers on initial load and hash changes", async () => {
  workerData();
  window.location.hash = "#/leitstand/terminal?worker=two";
  const view = render(<App />);
  expect(await screen.findByRole("tab", { name: "Task two" })).toHaveAttribute("aria-selected", "true");
  go("#/leitstand/terminal?worker=one");
  expect(await screen.findByRole("tab", { name: "Task one" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getByRole("tab", { name: "Task two" }));
  expect(screen.getByRole("tab", { name: "Task two" })).toHaveAttribute("aria-selected", "true");
  expect(view.container.querySelectorAll(".xterm")).toHaveLength(1);
  expect(mocks.invoke.mock.calls.some(([name]) => ["spawn_pty", "kill_pty"].includes(name))).toBe(false);
});

it("clears the worker link on manual selection so the same link can reopen", async () => {
  workerData();
  window.location.hash = "#/leitstand/terminal?worker=one";
  render(<App />);
  await screen.findByRole("tab", { name: "Task one" });
  go("#/leitstand/terminal?worker=two");
  await screen.findByRole("tab", { name: "Task two" });
  fireEvent.click(screen.getByRole("tab", { name: "Task one" }));
  expect(window.location.hash).toBe("#/leitstand/terminal");
  // Native hashchange only: assigning an unchanged hash must not fake navigation.
  act(() => { window.location.hash = "#/leitstand/terminal?worker=two"; });
  await waitFor(() => expect(screen.getByRole("tab", { name: "Task two" })).toHaveAttribute("aria-selected", "true"));
});

async function deepLinkedStatusLabel(profileId: string) {
  workerData();
  const base = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (command: string, args: unknown) => command === "list_workers"
    ? workers.map((worker) => ({ ...worker, profileId })) : base(command, args));
  window.location.hash = "#/leitstand/terminal?worker=one";
  const view = render(<App />);
  await screen.findByRole("tab", { name: "Task one" });
  go("#/leitstand/klassisch");
  return expect(view.container.querySelector('.statusbar [title="pty-one"]'));
}

// Titles carry no literal parentheses: red-first passes trailer names to `vitest -t` as a regex.
it("labels a deep linked worker session with its profile name profile shell", async () => (await deepLinkedStatusLabel("shell")).toHaveTextContent("Shell"));
// An unknown profile gets no label; its internal identifier is never shown.
it("labels a deep linked worker session with its profile name profile gone", async () => (await deepLinkedStatusLabel("gone")).not.toHaveTextContent("gone"));
it("does not label a worker profile with its internal identifier", async () => (await deepLinkedStatusLabel("gone")).toHaveTextContent(/^$/));

it.each([false, true])("keeps provider callbacks stable after opening a worker (restore: %s)", async (restore) => {
  workerData(restore);
  window.location.hash = "#/leitstand/terminal?worker=one";
  const observed: sessionProvider.SessionsValue[] = [];
  function ObservedRoute() {
    const value = sessionProvider.useSessions();
    useEffect(() => { observed.push(value); });
    return <TerminalRoute />;
  }
  const tree = () => <sessionProvider.SessionProvider><ObservedRoute /></sessionProvider.SessionProvider>;
  const view = render(tree());
  await screen.findByRole("tab", { name: "Task one" });
  await act(async () => { view.rerender(tree()); });
  expect(observed.length).toBeGreaterThan(1);
  for (const value of observed) {
    expect(value.openWorker).toBe(observed[0].openWorker);
    expect(value.showRestore).toBe(observed[0].showRestore);
  }
  expect(mocks.invoke.mock.calls.filter(([name]) => name === "list_workers")).toHaveLength(1);
});

it("keeps the current viewer mounted during a failed worker lookup", async () => {
  workerData();
  window.location.hash = "#/leitstand/terminal?worker=one";
  const view = render(<App />);
  await waitFor(() => expect(active(ptyOutput("pty-one"))).toHaveLength(1));
  const viewer = view.container.querySelector(".xterm");
  const base = mocks.invoke.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  mocks.invoke.mockImplementation((command: string, args: unknown) => command === "list_workers"
    ? new Promise((resolve) => { finish = resolve; }) : base(command, args));
  go("#/leitstand/terminal?worker=missing");
  expect(view.container.querySelector(".xterm")).toBe(viewer);
  await act(async () => { finish([]); });
  expect(await screen.findByRole("alert")).toHaveTextContent("Agent");
  expect(view.container.querySelector(".xterm")).toBe(viewer);
});

it("shows only the error state after an initial worker lookup fails", async () => {
  workerData();
  window.location.hash = "#/leitstand/terminal?worker=missing";
  render(<App />);
  await screen.findByRole("alert");
  expect(screen.queryByText("Keine Terminal-Sitzung geöffnet.")).toBeNull();
});

it.each([false, true])("reports worker lookup failure (IPC rejection: %s)", async (reject) => {
  workerData();
  const base = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command: string, args: unknown) => command === "list_workers" && reject
    ? Promise.reject(new Error("lookup failed")) : base(command, args));
  window.location.hash = "#/leitstand/terminal?worker=missing";
  render(<App />);
  const route = within(screen.getByRole("region", { name: "Terminal" }));
  expect(await route.findByRole("alert")).toHaveTextContent(reject ? "lookup failed" : "Agent");
  expect(mocks.invoke.mock.calls.some(([name]) => ["respawn_worker", "spawn_pty"].includes(name))).toBe(false);
});

it("reports a failed respawn and opens the session after an explicit retry", async () => {
  workerData(true);
  const base = mocks.invoke.getMockImplementation()!;
  const respawn = vi.fn().mockRejectedValueOnce(new Error("restart failed")).mockResolvedValueOnce(workers[0]);
  mocks.invoke.mockImplementation((command: string, args: unknown) => command === "respawn_worker" ? respawn() : base(command, args));
  window.location.hash = "#/leitstand/terminal?worker=one";
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Agent neu starten" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("restart failed");
  fireEvent.click(await screen.findByRole("button", { name: "Agent neu starten" }));
  await waitFor(() => expect(active(ptyOutput("pty-one"))).toHaveLength(1));
  expect(screen.queryByRole("region", { name: "Sitzungs-Wiederherstellung" })).toBeNull();
  expect(respawn).toHaveBeenCalledTimes(2);
});

it("recovers a late respawn through a fresh lookup without respawning again", async () => {
  workerData(true);
  const base = mocks.invoke.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  let restarted = false;
  mocks.invoke.mockImplementation((command: string, args: unknown) => {
    if (command === "respawn_worker") return new Promise((resolve) => { finish = resolve; });
    if (command === "list_workers" && restarted) return Promise.resolve(workers);
    return base(command, args);
  });
  render(<App />);
  await openShellTab();
  go("#/leitstand/terminal?worker=one");
  fireEvent.click(await screen.findByRole("button", { name: "Agent neu starten" }));
  fireEvent.click(screen.getByRole("tab", { name: "Shell" }));
  await act(async () => { restarted = true; finish(workers[0]); });
  expect(screen.getByRole("tab", { name: "Shell" })).toHaveAttribute("aria-selected", "true");
  go("#/leitstand");
  go("#/leitstand/terminal?worker=one");
  expect(await screen.findByRole("tab", { name: "Task one" })).toHaveAttribute("aria-selected", "true");
  expect(mocks.invoke.mock.calls.filter(([name]) => name === "respawn_worker")).toHaveLength(1);
});

it("ignores late worker results after leaving a pending deep link", async () => {
  workerData();
  window.location.hash = "#/leitstand/terminal?worker=two";
  const view = render(<App />);
  await screen.findByRole("tab", { name: "Task two" });
  const base = mocks.invoke.getMockImplementation()!;
  let resolve!: (value: unknown) => void;
  mocks.invoke.mockImplementation((command: string, args: unknown) => command === "list_workers"
    ? new Promise((done) => { resolve = done; }) : base(command, args));
  go("#/leitstand/terminal?worker=one");
  go("#/leitstand/terminal");
  await act(async () => { resolve(workers); });
  expect(view.container.querySelectorAll(".xterm")).toHaveLength(1);
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Task two"]);
});

it("opens restore for a card without a live session while retaining existing tabs", async () => {
  workerData(true);
  const view = render(<App />);
  await openShellTab();
  go("#/leitstand");
  fireEvent.click((await screen.findAllByRole("button", { name: "Shell öffnen" }))[1]);
  expect(await screen.findByRole("region", { name: "Sitzungs-Wiederherstellung" })).toBeVisible();
  expect(await screen.findByText("saved output")).toBeVisible();
  expect(mocks.invoke).toHaveBeenCalledWith("get_session_restore", { workerId: "two" });
  expect(view.container.querySelectorAll(".xterm")).toHaveLength(0);
  fireEvent.click(screen.getByRole("tab", { name: "Shell" }));
  expect(view.container.querySelectorAll(".xterm")).toHaveLength(1);
  expect(screen.queryByRole("region", { name: "Sitzungs-Wiederherstellung" })).toBeNull();
  expect(mocks.invoke.mock.calls.filter(([name]) => name === "spawn_pty")).toHaveLength(1);
  expect(mocks.invoke.mock.calls.some(([name]) => ["respawn_worker", "kill_pty"].includes(name))).toBe(false);
});

// Real App, SessionProvider, ShellMount and TerminalView; mock only IPC and xterm.
describe("terminal route", () => {
  // Keep the historical test name for the existing red-first trailer; tools may hide the viewer.
  it("keeps one visible viewer on werkzeuge and legacy sibling routes", async () => {
    const view = render(<App />);
    await openShellTab();
    await waitFor(() => expect(active(ptyOutput("session-a"))).toHaveLength(1));
    const output = active(ptyOutput("session-a"))[0];
    const viewer = view.container.querySelector(".xterm");
    for (const path of ["/leitstand/werkzeuge", CLASSIC_PATH]) {
      go(`#${path}`);
      const viewers = view.container.querySelectorAll(".xterm");
      expect(viewers).toHaveLength(1);
      expect(viewers[0]).toBe(viewer);
      expect(output.stop).not.toHaveBeenCalled();
      await waitFor(() => expect(active(ptyOutput("session-a"))).toHaveLength(1));
    }
    go("#/leitstand/verlauf");
    expect(await screen.findByRole("log", { name: "Nachrichten mit dem Orchestrator" })).toBeInTheDocument();
    expect(view.container.querySelectorAll(".xterm")).toHaveLength(0);
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
