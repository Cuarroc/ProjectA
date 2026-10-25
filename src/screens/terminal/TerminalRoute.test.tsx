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

it("keeps the restart name while busy and isolates a late restart after a worker change", async () => {
  workerData(true);
  const base = mocks.invoke.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  mocks.invoke.mockImplementation((command: string, args: unknown) => {
    if (command === "respawn_worker") return new Promise((resolve) => { finish = resolve; });
    if (command === "get_session_restore") return Promise.resolve({ liveSession: false, workspace: "present",
      scrollback: "persisted terminal output", draft: "unsent reply", lastConfirmed: "app_crash" });
    return base(command, args);
  });
  window.location.hash = "#/leitstand/terminal?worker=one";
  render(<sessionProvider.SessionProvider><TerminalRoute /></sessionProvider.SessionProvider>);
  expect(await screen.findByLabelText("Gespeicherter Scrollback")).toHaveTextContent("persisted terminal output");
  expect(screen.getByLabelText("Gespeicherter Entwurf")).toHaveTextContent("unsent reply");
  expect(mocks.invoke.mock.calls.some(([name]) => ["respawn_worker", "spawn_pty"].includes(name))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Agent neu starten" }));
  const busy = screen.getByRole("button", { name: "Agent neu starten" });
  expect(busy).toBeDisabled();
  expect(busy).toHaveAttribute("aria-busy", "true");
  fireEvent.click(busy);
  expect(mocks.invoke.mock.calls.filter(([name]) => name === "respawn_worker")).toEqual([
    ["respawn_worker", { workerId: "one" }],
  ]);
  go("#/leitstand/terminal?worker=two");
  await screen.findByRole("tab", { name: "Task two" });
  await act(async () => { finish(workers[0]); });
  expect(screen.getByRole("tab", { name: "Task two" })).toHaveAttribute("aria-selected", "true");
  expect(screen.queryByRole("tab", { name: "Task one" })).toBeNull();
  expect(screen.getByRole("button", { name: "Agent neu starten" })).toBeEnabled();
  expect(mocks.invoke.mock.calls.some(([name]) => name === "spawn_pty")).toBe(false);
});

it("describes the disabled restart with the missing worktree warning and ignores stale restore data", async () => {
  workerData(true);
  const base = mocks.invoke.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  mocks.invoke.mockImplementation((command: string, args: unknown) => {
    if (command === "get_session_restore") return (args as { workerId: string }).workerId === "one"
      ? new Promise((resolve) => { finish = resolve; })
      : Promise.resolve({ liveSession: false, workspace: "missing", scrollback: "second saved output", draft: "second draft" });
    return base(command, args);
  });
  window.location.hash = "#/leitstand/terminal?worker=one";
  render(<sessionProvider.SessionProvider><TerminalRoute /></sessionProvider.SessionProvider>);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("get_session_restore", { workerId: "one" }));
  go("#/leitstand/terminal?worker=two");
  const warning = await screen.findByRole("alert");
  await act(async () => { finish({ liveSession: false, workspace: "present", scrollback: "stale output", draft: "stale draft" }); });
  const restart = screen.getByRole("button", { name: "Agent neu starten" });
  expect(restart).toBeDisabled();
  expect(restart).toHaveAccessibleDescription("Worktree fehlt — „Agent neu starten“ legt ihn nicht still neu an.");
  expect(restart).toHaveAttribute("aria-describedby", warning.id);
  expect(screen.getByLabelText("Gespeicherter Scrollback")).toHaveTextContent("second saved output");
  expect(screen.getByLabelText("Gespeicherter Entwurf")).toHaveTextContent("second draft");
  expect(screen.queryByText("stale output")).toBeNull();
  expect(screen.queryByText("stale draft")).toBeNull();
  fireEvent.click(restart);
  expect(mocks.invoke.mock.calls.some(([name]) => ["respawn_worker", "spawn_pty"].includes(name))).toBe(false);
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

it("closes only the visible worker tab without stopping workers", async () => {
  const { Terminal } = await import("@xterm/xterm");
  vi.spyOn(Terminal.prototype, "focus").mockImplementation(function (this: InstanceType<typeof Terminal>) {
    this.element!.tabIndex = -1;
    this.element!.focus();
  });
  workerData();
  window.location.hash = "#/leitstand/terminal?worker=one";
  render(<App />);
  await screen.findByRole("tab", { name: "Task one" });
  go("#/leitstand/terminal?worker=two");
  await screen.findByRole("tab", { name: "Task two" });
  const close = screen.getByRole("button", { name: "Tab schließen" });
  expect(close.closest('[role="tab"], [role="tablist"]')).toBeNull();
  close.focus();
  fireEvent.click(close);
  expect(screen.queryByRole("tab", { name: "Task two" })).toBeNull();
  expect(screen.getByRole("tab", { name: "Task one" })).toHaveFocus();
  expect(screen.getByRole("tab", { name: "Task one" })).toHaveAttribute("aria-selected", "true");
  expect(window.location.hash).toBe("#/leitstand/terminal");
  await waitFor(() => expect(active(ptyOutput("pty-one"))).toHaveLength(1));
  act(() => { active(ptyOutput("pty-one"))[0].handler({ payload: "remaining worker output" }); });
  expect(mocks.writes).toContain("remaining worker output");
  expect(screen.getByRole("tab", { name: "Task one" })).toHaveFocus();
  expect(mocks.invoke.mock.calls.filter(([name]) => ["kill_pty", "spawn_pty", "respawn_worker"].includes(name))).toEqual([]);
});

it("closes only the visible ad hoc session at the PTY boundary", async () => {
  render(<App />);
  await openShellTab();
  await waitFor(() => expect(active(ptyOutput("session-a"))).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Neue Sitzung" }));
  fireEvent.click(await screen.findByRole("button", { name: "Shellshell" }));
  go("#/leitstand/terminal");
  await waitFor(() => expect(screen.getAllByRole("tab", { name: "Shell" })).toHaveLength(2));
  const tabs = screen.getAllByRole("tab", { name: "Shell" });
  expect(tabs[1]).toHaveAttribute("aria-selected", "true");
  const retained = mocks.listeners.filter((entry) => entry.event.endsWith("session-a") && !entry.stop.mock.calls.length);
  expect(retained.length).toBeGreaterThan(0);
  mocks.invoke.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Tab schließen" }));
  expect(screen.getAllByRole("tab", { name: "Shell" })).toHaveLength(1);
  expect(screen.getByRole("tab", { name: "Shell" })).toHaveFocus();
  expect(mocks.invoke.mock.calls.filter(([name]) => ["kill_pty", "spawn_pty", "respawn_worker"].includes(name))).toEqual([
    ["kill_pty", { sessionId: "session-b" }],
  ]);
  for (const listener of retained) expect(listener.stop).not.toHaveBeenCalled();
  await waitFor(() => expect(active(ptyOutput("session-a"))).toHaveLength(1));
  act(() => { active(ptyOutput("session-a"))[0].handler({ payload: "remaining shell output" }); });
  expect(mocks.writes).toContain("remaining shell output");
});

it("focuses an honest empty state after closing the last worker tab", async () => {
  workerData();
  window.location.hash = "#/leitstand/terminal?worker=one";
  render(<App />);
  await screen.findByRole("tab", { name: "Task one" });
  fireEvent.click(screen.getByRole("button", { name: "Tab schließen" }));
  expect(screen.getByText("Keine Terminal-Sitzung geöffnet.")).toBeVisible();
  expect(within(screen.getByRole("region", { name: "Terminal" })).getByRole("button", { name: "Klassisch" })).toHaveFocus();
  expect(screen.queryByRole("button", { name: "Tab schließen" })).toBeNull();
  go("#/leitstand");
  go("#/leitstand/terminal");
  expect(await screen.findByText("Keine Terminal-Sitzung geöffnet.")).toBeVisible();
  expect(screen.queryByRole("tab", { name: "Task one" })).toBeNull();
  expect(mocks.invoke.mock.calls.filter(([name]) => ["kill_pty", "spawn_pty", "respawn_worker"].includes(name))).toEqual([]);
  fireEvent.click(within(screen.getByRole("region", { name: "Terminal" })).getByRole("button", { name: "Klassisch" }));
  await screen.findByRole("tab", { name: "Agenten" });
  expect(window.location.hash).toBe("#/leitstand/klassisch");
});

it("discards a pending worker lookup when the visible tab is closed", async () => {
  workerData();
  window.location.hash = "#/leitstand/terminal?worker=one";
  render(<App />);
  await screen.findByRole("tab", { name: "Task one" });
  const base = mocks.invoke.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  mocks.invoke.mockImplementation((command: string, args: unknown) => command === "list_workers"
    ? new Promise((resolve) => { finish = resolve; }) : base(command, args));
  go("#/leitstand/terminal?worker=two");
  fireEvent.click(screen.getByRole("button", { name: "Tab schließen" }));
  await act(async () => { finish(workers); });
  expect(window.location.hash).toBe("#/leitstand/terminal");
  expect(screen.getByText("Keine Terminal-Sitzung geöffnet.")).toBeVisible();
  expect(screen.queryByRole("tablist", { name: "Terminal-Sitzungen" })).toBeNull();
  expect(mocks.invoke.mock.calls.filter(([name]) => ["kill_pty", "spawn_pty", "respawn_worker"].includes(name))).toEqual([]);
});

it("hides close during restore and ignores a late restart after closing a live tab", async () => {
  workerData();
  window.location.hash = "#/leitstand/terminal?worker=one";
  render(<App />);
  await screen.findByRole("tab", { name: "Task one" });
  workerData(true);
  const base = mocks.invoke.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  mocks.invoke.mockImplementation((command: string, args: unknown) => command === "respawn_worker"
    ? new Promise((resolve) => { finish = resolve; }) : base(command, args));
  go("#/leitstand/terminal?worker=two");
  const restart = await screen.findByRole("button", { name: "Agent neu starten" });
  expect(screen.queryByRole("button", { name: "Tab schließen" })).toBeNull();
  expect(mocks.invoke.mock.calls.filter(([name]) => ["kill_pty", "spawn_pty", "respawn_worker"].includes(name))).toEqual([]);
  fireEvent.click(restart);
  expect(screen.queryByRole("button", { name: "Tab schließen" })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Task one" }));
  fireEvent.click(screen.getByRole("button", { name: "Tab schließen" }));
  await act(async () => { finish(workers[1]); });
  expect(screen.getByText("Keine Terminal-Sitzung geöffnet.")).toBeVisible();
  expect(screen.queryByRole("tablist", { name: "Terminal-Sitzungen" })).toBeNull();
  expect(mocks.invoke.mock.calls.filter(([name]) => ["kill_pty", "spawn_pty", "respawn_worker"].includes(name))).toEqual([
    ["respawn_worker", { workerId: "two" }],
  ]);
});

it("launches exactly one chosen enabled profile from the empty Glass route", async () => {
  window.location.hash = "#/leitstand/terminal";
  render(<App />);
  const launch = await screen.findByRole("button", { name: "Neue Sitzung" });
  const base = mocks.invoke.getMockImplementation()!;
  const finishes: Array<() => void> = [];
  mocks.invoke.mockImplementation((command: string, args: unknown) => {
    if (command === "list_agent_profiles") return Promise.resolve([
      { id: "chosen", name: "Chosen shell", enabled: true }, { id: "disabled", name: "Disabled shell", enabled: false },
    ]);
    if (command === "spawn_pty") return new Promise((resolve) => { finishes.push(() => resolve({ sessionId: "session-a" })); });
    return base(command, args);
  });
  const mutations = () => mocks.invoke.mock.calls.filter(([name]) => ["spawn_pty", "kill_pty", "respawn_worker"].includes(name));
  let failure: unknown;
  try {
    expect(mutations()).toEqual([]);
    fireEvent.click(launch);
    const choice = await screen.findByRole("button", { name: "Chosen shell" });
    expect(screen.queryByRole("button", { name: "Disabled shell" })).toBeNull();
    expect(mutations()).toEqual([]);
    choice.focus(); fireEvent.keyDown(choice, { key: "Escape" });
    expect(launch).toHaveFocus();
    fireEvent.click(launch);
    fireEvent.click(await screen.findByRole("button", { name: "Abbrechen" }));
    expect(mutations()).toEqual([]);
    fireEvent.click(launch);
    const selected = await screen.findByRole("button", { name: "Chosen shell" });
    fireEvent.click(selected); fireEvent.click(selected); fireEvent.click(launch);
    expect(screen.getByRole("button", { name: "Neue Sitzung" })).toHaveAttribute("aria-busy", "true");
    expect(mutations()).toEqual([["spawn_pty", { profileId: "chosen", cols: 80, rows: 24 }]]);
    await act(async () => { finishes[0](); });
    expect(await screen.findByRole("tab", { name: "Chosen shell" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(active(ptyOutput("session-a"))).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Tab schließen" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Neue Sitzung" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("alert")).toBeNull();
  } catch (error) { failure = error; throw error; } finally {
    await finishLaunchTest(failure, () => { for (const finish of finishes) finish(); });
  }
});

it.each(["resolve", "reject"] as const)("discards stale profile %s after a newer discovery starts", async (settlement) => {
  window.location.hash = "#/leitstand/terminal"; render(<App />);
  const launch = await screen.findByRole("button", { name: "Neue Sitzung" });
  const base = mocks.invoke.getMockImplementation()!;
  const requests: Array<{ resolve: (value: unknown) => void; reject: (cause: unknown) => void }> = [];
  mocks.invoke.mockImplementation((command: string, args: unknown) => command === "list_agent_profiles"
    ? new Promise((resolve, reject) => { requests.push({ resolve, reject }); }) : base(command, args));
  let failure: unknown;
  try {
    for (const state of ["loading", "list", "failure", "dismissed"]) {
      const index = requests.length;
      fireEvent.click(launch);
      expect(await screen.findByText("Profile werden geladen…")).toBeVisible();
      fireEvent.keyDown(launch, { key: "Escape" });
      expect(launch).toHaveFocus(); expect(launch).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(launch);
      expect(requests).toHaveLength(index + 2);
      const [old, current] = requests.slice(index);
      await act(async () => {
        if (state === "list") current.resolve([{ id: "fresh", name: "Fresh shell", enabled: true }]);
        if (state === "failure") current.reject(new Error("current profile failure"));
      });
      if (state === "dismissed") fireEvent.pointerDown(document.body);
      await act(async () => {
        if (settlement === "resolve") old.resolve([{ id: "stale", name: "Stale shell", enabled: true }]);
        else old.reject(new Error("stale profile failure"));
      });
      expect(screen.queryByRole("button", { name: "Stale shell" })).toBeNull();
      expect(launch).toHaveAttribute("aria-expanded", state === "dismissed" ? "false" : "true");
      if (state === "failure") {
        expect(screen.getByRole("alert")).toHaveTextContent("Profile konnten nicht geladen werden.");
        expect(screen.queryByText("Kein aktiviertes Profil verfügbar.")).toBeNull();
      } else {
        expect(screen.queryByRole("alert")).toBeNull();
        if (state === "list") expect(screen.getByRole("button", { name: "Fresh shell" })).toBeVisible();
        if (state === "loading") expect(screen.getByText("Profile werden geladen…")).toBeVisible();
      }
      await act(async () => { current.resolve([{ id: "off", name: "Disabled shell", enabled: false }]); });
      if (state === "loading") expect(screen.getByText("Kein aktiviertes Profil verfügbar.")).toBeVisible();
      expect(screen.queryByRole("button", { name: "Disabled shell" })).toBeNull();
      if (state !== "dismissed") fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
      expect(launch).toHaveAttribute("aria-expanded", "false");
    }
    fireEvent.click(launch); go("#/leitstand");
    await act(async () => { requests[requests.length - 1].resolve([{ id: "late", name: "Late shell", enabled: true }]); });
    go("#/leitstand/terminal");
    expect(await screen.findByRole("button", { name: "Neue Sitzung" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Late shell" })).toBeNull();
    expect(mocks.invoke.mock.calls.filter(([name]) => ["spawn_pty", "kill_pty", "respawn_worker"].includes(name))).toEqual([]);
  } catch (error) { failure = error; throw error; } finally {
    await finishLaunchTest(failure, () => {
      for (const request of requests) request.resolve([]);
      mocks.invoke.mockImplementation(base);
    });
  }
});

it("keeps a failed launch empty and retries only after another profile activation", async () => {
  window.location.hash = "#/leitstand/terminal"; render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Neue Sitzung" }));
  const profile = await screen.findByRole("button", { name: "Shell" });
  const base = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command: string, args: unknown) => command === "spawn_pty"
    ? Promise.reject(new Error("spawn rejected")) : base(command, args));
  let failure: unknown;
  try {
    fireEvent.click(profile);
    expect(await screen.findByRole("alert")).toHaveTextContent("Sitzungsanfrage fehlgeschlagen.");
    expect(screen.getByText("Keine Terminal-Sitzung geöffnet.")).toBeVisible();
    expect(screen.queryByRole("tablist", { name: "Terminal-Sitzungen" })).toBeNull();
    expect(mocks.invoke.mock.calls.filter(([name]) => name === "spawn_pty")).toHaveLength(1);
    mocks.invoke.mockImplementation(base);
    fireEvent.click(profile);
    expect(await screen.findByRole("tab", { name: "Shell" })).toBeVisible();
    expect(mocks.invoke.mock.calls.filter(([name]) => name === "spawn_pty")).toHaveLength(2);
  } catch (error) { failure = error; throw error; } finally {
    await finishLaunchTest(failure);
  }
});

it("preserves late provider insertion without navigating back to an unmounted launcher", async () => {
  window.location.hash = "#/leitstand/terminal"; render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Neue Sitzung" }));
  const profile = await screen.findByRole("button", { name: "Shell" });
  const base = mocks.invoke.getMockImplementation()!;
  const finishes: Array<() => void> = [];
  mocks.invoke.mockImplementation((command: string, args: unknown) => command === "spawn_pty"
    ? new Promise((resolve) => { finishes.push(() => resolve({ sessionId: "session-a" })); }) : base(command, args));
  let failure: unknown;
  try {
    fireEvent.click(profile); go("#/leitstand");
    mocks.listen.mockRejectedValueOnce(new Error("exit subscription failed"));
    await act(async () => { finishes[0](); });
    expect(window.location.hash).toBe("#/leitstand");
    go("#/leitstand/terminal");
    expect(await screen.findByRole("tab", { name: "Shell" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Sitzungsanfrage fehlgeschlagen. exit subscription failed");
    expect(mocks.invoke.mock.calls.filter(([name]) => ["spawn_pty", "kill_pty", "respawn_worker"].includes(name))).toEqual([
      ["spawn_pty", { profileId: "shell", cols: 80, rows: 24 }],
    ]);
  } catch (error) { failure = error; throw error; } finally {
    await finishLaunchTest(failure, () => { for (const finish of finishes) finish(); });
  }
});

it("offers launch in empty and eligible live views but not lookup error restore or exited views", async () => {
  window.location.hash = "#/leitstand/terminal"; render(<App />);
  expect(await screen.findByRole("button", { name: "Neue Sitzung" })).toBeVisible();
  const base = mocks.invoke.getMockImplementation()!;
  const finishes: Array<() => void> = [];
  mocks.invoke.mockImplementation((command: string, args: unknown) => command === "list_workers"
    ? new Promise((resolve) => { finishes.push(() => resolve([])); }) : base(command, args));
  let failure: unknown;
  try {
    go("#/leitstand/terminal?worker=missing");
    expect(screen.queryByRole("button", { name: "Neue Sitzung" })).toBeNull();
    await act(async () => { finishes[0](); });
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Neue Sitzung" })).toBeNull();
    mocks.invoke.mockImplementation(base); workerData(true);
    go("#/leitstand/terminal?worker=one");
    await screen.findByRole("button", { name: "Agent neu starten" });
    expect(screen.queryByRole("button", { name: "Neue Sitzung" })).toBeNull();
    mocks.invoke.mockImplementation(base); workerData();
    go("#/leitstand/terminal?worker=two");
    await screen.findByRole("tab", { name: "Task two" });
    expect(await screen.findByRole("button", { name: "Neue Sitzung" })).toBeVisible();
    await waitFor(() => expect(active("pty:exit:pty-two")).toHaveLength(1));
    act(() => { active("pty:exit:pty-two")[0].handler({ payload: { code: 0 } }); });
    expect(screen.queryByRole("button", { name: "Neue Sitzung" })).toBeNull();
    expect(mocks.invoke.mock.calls.filter(([name]) => ["spawn_pty", "kill_pty", "respawn_worker"].includes(name))).toEqual([]);
  } catch (error) { failure = error; throw error; } finally {
    await finishLaunchTest(failure, () => {
      for (const finish of finishes) finish();
      mocks.invoke.mockImplementation(base);
    });
  }
});

it("keeps an inserted session visible when its exit subscription rejects", async () => {
  window.location.hash = "#/leitstand/terminal"; render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Neue Sitzung" }));
  const profile = await screen.findByRole("button", { name: "Shell" });
  mocks.listen.mockRejectedValueOnce(new Error("exit subscription failed"));
  let failure: unknown;
  try {
    fireEvent.click(profile);
    expect(await screen.findByRole("tab", { name: "Shell" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(active(ptyOutput("session-a"))).toHaveLength(1));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Sitzungsanfrage fehlgeschlagen. exit subscription failed");
    expect(mocks.invoke.mock.calls.filter(([name]) => ["spawn_pty", "kill_pty", "respawn_worker"].includes(name))).toEqual([
      ["spawn_pty", { profileId: "shell", cols: 80, rows: 24 }],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Tab schließen" }));
    expect(screen.queryByRole("tab", { name: "Shell" })).toBeNull();
    expect(screen.getByText("Keine Terminal-Sitzung geöffnet.")).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent("Sitzungsanfrage fehlgeschlagen. exit subscription failed");
    fireEvent.click(screen.getByRole("button", { name: "Neue Sitzung" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(await screen.findByRole("button", { name: "Shell" })).toBeVisible();
    expect(mocks.invoke.mock.calls.filter(([name]) => ["spawn_pty", "kill_pty", "respawn_worker"].includes(name))).toEqual([
      ["spawn_pty", { profileId: "shell", cols: 80, rows: 24 }], ["kill_pty", { sessionId: "session-a" }],
    ]);
  } catch (error) { failure = error; throw error; } finally {
    await finishLaunchTest(failure);
  }
});

async function pendingLaunchAcrossRemount(settlement: "resolve" | "reject") {
  window.location.hash = "#/leitstand/terminal"; render(<App />);
  const base = mocks.invoke.getMockImplementation()!;
  const finishes: Array<() => void> = [];
  let rejectFirst!: (cause: unknown) => void;
  mocks.invoke.mockImplementation((command: string, args: unknown) => command === "spawn_pty"
    ? new Promise((resolve, reject) => {
      const sessionId = `remount-${finishes.length}`;
      if (!finishes.length) rejectFirst = reject;
      finishes.push(() => resolve({ sessionId }));
    }) : base(command, args));
  const spawns = () => mocks.invoke.mock.calls.filter(([name]) => name === "spawn_pty");
  let failure: unknown;
  try {
    const original = await screen.findByRole("button", { name: "Neue Sitzung" });
    fireEvent.click(original);
    fireEvent.click(await screen.findByRole("button", { name: "Shell" }));
    expect(spawns()).toEqual([["spawn_pty", { profileId: "shell", cols: 80, rows: 24 }]]);
    go("#/leitstand");
    expect(original).not.toBeInTheDocument();
    go("#/leitstand/terminal");
    const remounted = await screen.findByRole("button", { name: "Neue Sitzung" });
    expect(remounted).toHaveAttribute("aria-busy", "true");
    fireEvent.click(remounted);
    remounted.focus();
    // Native keyboard activation reaches a button as a click with detail zero.
    fireEvent.click(remounted, { detail: 0 });
    expect(remounted).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Shell" })).toBeNull();
    expect(spawns()).toHaveLength(1);
    await act(async () => {
      if (settlement === "resolve") finishes[0]();
      else rejectFirst(new Error("pending spawn rejected"));
    });
    if (settlement === "resolve") {
      expect(await screen.findByRole("tab", { name: "Shell" })).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Tab schließen" }));
    }
    expect(screen.getByText("Keine Terminal-Sitzung geöffnet.")).toBeVisible();
    const next = screen.getByRole("button", { name: "Neue Sitzung" });
    expect(next).not.toHaveAttribute("aria-busy", "true");
    fireEvent.click(next);
    const profile = await screen.findByRole("button", { name: "Shell" });
    expect(spawns()).toHaveLength(1);
    fireEvent.click(profile); fireEvent.click(profile);
    expect(spawns()).toEqual([
      ["spawn_pty", { profileId: "shell", cols: 80, rows: 24 }],
      ["spawn_pty", { profileId: "shell", cols: 80, rows: 24 }],
    ]);
    await act(async () => { finishes[1](); });
    expect(await screen.findByRole("tab", { name: "Shell" })).toBeVisible();
    expect(spawns()).toHaveLength(2);
  } catch (error) { failure = error; throw error; } finally {
    await finishLaunchTest(failure, () => { for (const finish of finishes) finish(); });
  }
}

it("blocks launch across remount until the original spawn resolves", async () => {
  await pendingLaunchAcrossRemount("resolve");
});
it("blocks launch across remount until the original spawn rejects", async () => {
  await pendingLaunchAcrossRemount("reject");
});

async function finishLaunchTest(failure: unknown, settle: () => void = () => {}) {
  try {
    await act(async () => { settle(); });
    await acknowledgeLaunchFailure();
  } catch (cleanupError) {
    if (failure !== undefined) throw new AggregateError([failure, cleanupError], "Launch assertion and cleanup failed");
    throw cleanupError;
  }
}

async function acknowledgeLaunchFailure() {
  // A fresh public App mount reaches the empty view even after provider insertion.
  cleanup(); window.location.hash = "#/leitstand/terminal"; render(<App />);
  const launch = await screen.findByRole("button", { name: "Neue Sitzung" });
  expect(launch).not.toHaveAttribute("aria-busy", "true");
  const mutations = mocks.invoke.mock.calls.filter(([name]) => ["spawn_pty", "kill_pty", "respawn_worker"].includes(name));
  fireEvent.click(launch);
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Abbrechen" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(launch).not.toHaveAttribute("aria-busy", "true");
  expect(mocks.invoke.mock.calls.filter(([name]) => ["spawn_pty", "kill_pty", "respawn_worker"].includes(name))).toEqual(mutations);
}

async function rejectedLaunchAcrossRemount(returnBeforeRejection: boolean) {
  window.location.hash = "#/leitstand/terminal"; render(<App />);
  const base = mocks.invoke.getMockImplementation()!;
  let rejectRequest: ((cause: unknown) => void) | undefined;
  mocks.invoke.mockImplementation((command: string, args: unknown) => command === "spawn_pty"
    ? new Promise((_resolve, reject) => { rejectRequest = reject; }) : base(command, args));
  let failure: unknown;
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Neue Sitzung" }));
    fireEvent.click(await screen.findByRole("button", { name: "Shell" }));
    go("#/leitstand");
    if (returnBeforeRejection) go("#/leitstand/terminal");
    await act(async () => { rejectRequest!(new Error("request rejected while away")); });
    expect(window.location.hash).toBe(returnBeforeRejection ? "#/leitstand/terminal" : "#/leitstand");
    go("#/leitstand/terminal");
    expect(await screen.findByRole("alert")).toHaveTextContent("Sitzungsanfrage fehlgeschlagen. request rejected while away");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByText("Keine Terminal-Sitzung geöffnet.")).toBeVisible();
    expect(mocks.invoke.mock.calls.filter(([name]) => ["spawn_pty", "kill_pty", "respawn_worker"].includes(name))).toEqual([
      ["spawn_pty", { profileId: "shell", cols: 80, rows: 24 }],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Neue Sitzung" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(await screen.findByRole("button", { name: "Shell" })).toBeEnabled();
  } catch (error) { failure = error; throw error; } finally {
    await finishLaunchTest(failure, () => { rejectRequest?.(new Error("settled during cleanup")); });
  }
}
it("shows the same rejected request after returning before settlement", async () => {
  await rejectedLaunchAcrossRemount(true);
});
it("shows the same rejected request after returning after settlement", async () => {
  await rejectedLaunchAcrossRemount(false);
});

it("acknowledges launch failures on reopen and clears them before a new attempt", async () => {
  window.location.hash = "#/leitstand/terminal"; render(<App />);
  const base = mocks.invoke.getMockImplementation()!;
  const finish: Array<() => void> = [];
  const fail: Array<() => void> = [];
  mocks.invoke.mockImplementation((command: string, args: unknown) => command === "spawn_pty"
    ? new Promise((resolve, reject) => {
      finish.push(() => resolve({ sessionId: "acknowledged-session" }));
      fail.push(() => reject(new Error("explicit request rejected")));
    }) : base(command, args));
  let failure: unknown;
  try {
    const trigger = await screen.findByRole("button", { name: "Neue Sitzung" });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "Shell" }));
    await act(async () => { fail[0](); });
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Sitzungsanfrage fehlgeschlagen. explicit request rejected");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toBeVisible();
    fireEvent.click(trigger);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Shell" }));
    await act(async () => { fail[1](); });
    expect(await screen.findByRole("alert")).toHaveTextContent("explicit request rejected");
    expect(document.getElementById(trigger.getAttribute("aria-controls")!)).toContainElement(screen.getByRole("alert"));
    fireEvent.click(screen.getByRole("button", { name: "Shell" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(trigger).toHaveAttribute("aria-busy", "true");
    fireEvent.click(screen.getByRole("button", { name: "Shell" }));
    expect(finish).toHaveLength(3);
    await act(async () => { finish[2](); });
    expect(await screen.findByRole("tab", { name: "Shell" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Tab schließen" }));
    go("#/leitstand"); go("#/leitstand/terminal");
    expect(await screen.findByRole("button", { name: "Neue Sitzung" })).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(finish).toHaveLength(3);
  } catch (error) { failure = error; throw error; } finally {
    await finishLaunchTest(failure, () => { for (const settle of finish) settle(); });
  }
});

it("appends an explicit live launch without replacing existing worker tabs", async () => {
  workerData(); window.location.hash = "#/leitstand/terminal?worker=one"; render(<App />);
  await screen.findByRole("tab", { name: "Task one" });
  go("#/leitstand/terminal?worker=two");
  await screen.findByRole("tab", { name: "Task two" });
  const base = mocks.invoke.getMockImplementation()!;
  const finishes: Array<() => void> = [];
  mocks.invoke.mockImplementation((command: string, args: unknown) => {
    if (command === "list_agent_profiles") return Promise.resolve([
      { id: "chosen", name: "Chosen shell", enabled: true }, { id: "off", name: "Disabled shell", enabled: false },
    ]);
    if (command === "spawn_pty") return new Promise((resolve) => { finishes.push(() => resolve({ sessionId: "live-new" })); });
    return base(command, args);
  });
  let failure: unknown;
  try {
    const launch = await screen.findByRole("button", { name: "Neue Sitzung" });
    const original = screen.getAllByRole("tab");
    expect(launch.closest('[role="tablist"], [role="tab"]')).toBeNull();
    fireEvent.click(launch);
    const choice = await screen.findByRole("button", { name: "Chosen shell" });
    expect(screen.queryByRole("button", { name: "Disabled shell" })).toBeNull();
    choice.focus(); fireEvent.keyDown(choice, { key: "Escape" });
    expect(launch).toHaveFocus();
    fireEvent.click(launch);
    const cancel = await screen.findByRole("button", { name: "Abbrechen" });
    cancel.focus(); fireEvent.click(cancel); expect(launch).toHaveFocus();
    fireEvent.click(launch);
    fireEvent.pointerDown(original[0]); original[0].focus();
    expect(original[0]).toHaveFocus(); expect(launch).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("tab", { name: "Task two" })).toHaveAttribute("aria-selected", "true");
    expect(mocks.invoke.mock.calls.filter(([name]) => ["spawn_pty", "kill_pty", "respawn_worker"].includes(name))).toEqual([]);
    fireEvent.click(launch);
    const profile = await screen.findByRole("button", { name: "Chosen shell" });
    fireEvent.click(profile); fireEvent.click(profile); fireEvent.click(launch);
    expect(screen.getAllByRole("tab")).toEqual(original);
    expect(launch).toHaveAttribute("aria-busy", "true");
    await act(async () => { finishes[0](); });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Task one", "Task two", "Chosen shell"]);
    expect(screen.getAllByRole("tab").slice(0, 2).map((tab) => tab.id)).toEqual(original.map((tab) => tab.id));
    expect(screen.getByRole("tab", { name: "Chosen shell" })).toHaveAttribute("aria-selected", "true");
    expect(window.location.hash).toBe("#/leitstand/terminal");
    expect(launch).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(active(ptyOutput("live-new"))).toHaveLength(1));
    expect(mocks.invoke.mock.calls.filter(([name]) => ["spawn_pty", "kill_pty", "respawn_worker"].includes(name))).toEqual([
      ["spawn_pty", { profileId: "chosen", cols: 80, rows: 24 }],
    ]);
  } catch (error) { failure = error; throw error; } finally {
    await finishLaunchTest(failure, () => { for (const finish of finishes) finish(); });
  }
});

it("fences live insertion before exit subscription", async () => {
  for (const settlement of ["resolve", "reject"] as const) {
    cleanup(); mocks.invoke.mockClear();
    workerData(); window.location.hash = "#/leitstand/terminal?worker=one"; render(<App />);
    await screen.findByRole("tab", { name: "Task one" });
    const base = mocks.invoke.getMockImplementation()!;
    const listen = mocks.listen.getMockImplementation()!;
    let insert: (() => void) | undefined, lookup: (() => void) | undefined;
    let subscribe: (() => void) | undefined, reject: (() => void) | undefined;
    mocks.invoke.mockImplementation((command: string, args: unknown) => {
      if (command === "spawn_pty") return new Promise((resolve) => { insert = () => resolve({ sessionId: "live-pending" }); });
      if (command === "list_workers") return new Promise((resolve) => { lookup = () => resolve(workers); });
      return base(command, args);
    });
    mocks.listen.mockImplementation((event, handler) => event === "pty:exit:live-pending"
      ? new Promise((resolve, fail) => { subscribe = () => resolve(vi.fn()); reject = () => fail(new Error("live subscription rejected")); })
      : listen(event, handler));
    let failure: unknown;
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Neue Sitzung" }));
      fireEvent.click(await screen.findByRole("button", { name: "Shell" }));
      go("#/leitstand/terminal?worker=two");
      expect(screen.queryByRole("button", { name: "Neue Sitzung" })).toBeNull();
      await act(async () => { insert!(); });
      expect(await screen.findByRole("tab", { name: "Shell" })).toHaveAttribute("aria-selected", "true");
      expect(window.location.hash).toBe("#/leitstand/terminal");
      await act(async () => { lookup!(); });
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Task one", "Shell"]);
      go("#/leitstand"); go("#/leitstand/terminal");
      const launch = await screen.findByRole("button", { name: "Neue Sitzung" });
      expect(launch).toHaveAttribute("aria-busy", "true");
      fireEvent.click(launch); fireEvent.click(launch, { detail: 0 });
      expect(launch).toHaveAttribute("aria-expanded", "false");
      await act(async () => { if (settlement === "resolve") subscribe!(); else reject!(); });
      expect(launch).not.toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("tab", { name: "Shell" })).toHaveAttribute("aria-selected", "true");
      if (settlement === "reject") {
        expect(screen.getAllByRole("alert")).toHaveLength(1);
        expect(screen.getByRole("alert")).toHaveTextContent("Sitzungsanfrage fehlgeschlagen. live subscription rejected");
      } else expect(screen.queryByRole("alert")).toBeNull();
      expect(mocks.invoke.mock.calls.filter(([name]) => ["spawn_pty", "kill_pty", "respawn_worker"].includes(name))).toEqual([
        ["spawn_pty", { profileId: "shell", cols: 80, rows: 24 }],
      ]);
    } catch (error) { failure = error; throw error; } finally {
      await finishLaunchTest(failure, () => { insert?.(); lookup?.(); subscribe?.(); mocks.invoke.mockImplementation(base); mocks.listen.mockImplementation(listen); });
    }
  }
});

it("retains live launch failure across dismissal restore and remount until acknowledgement", async () => {
  workerData(); window.location.hash = "#/leitstand/terminal?worker=one"; render(<App />);
  await screen.findByRole("tab", { name: "Task one" });
  const base = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command: string, args: unknown) => command === "spawn_pty"
    ? Promise.reject(new Error("live spawn rejected")) : base(command, args));
  let failure: unknown;
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Neue Sitzung" }));
    fireEvent.click(await screen.findByRole("button", { name: "Shell" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sitzungsanfrage fehlgeschlagen. live spawn rejected");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(window.location.hash).toBe("#/leitstand/terminal?worker=one");
    const launch = screen.getByRole("button", { name: "Neue Sitzung" });
    expect(document.getElementById(launch.getAttribute("aria-controls")!)).toContainElement(screen.getByRole("alert"));
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toBeVisible();
    workerData(true); go("#/leitstand/terminal?worker=two");
    await screen.findByRole("button", { name: "Agent neu starten" });
    expect(screen.queryByText(/Sitzungsanfrage fehlgeschlagen/)).toBeNull();
    go("#/leitstand"); go("#/leitstand/terminal");
    expect(await screen.findByRole("alert")).toHaveTextContent("Sitzungsanfrage fehlgeschlagen. live spawn rejected");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Task one" })).toHaveAttribute("aria-selected", "true");
    expect(mocks.invoke.mock.calls.filter(([name]) => ["spawn_pty", "kill_pty", "respawn_worker"].includes(name))).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Neue Sitzung" }));
    expect(screen.queryByRole("alert")).toBeNull();
    mocks.invoke.mockImplementation(base);
    fireEvent.click(await screen.findByRole("button", { name: "Shell" }));
    expect(await screen.findByRole("tab", { name: "Shell" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Task one", "Shell"]);
    expect(screen.queryByRole("alert")).toBeNull();
  } catch (error) { failure = error; throw error; } finally {
    await finishLaunchTest(failure, () => { mocks.invoke.mockImplementation(base); });
  }
});

it("keeps the same request pending across empty live and empty subscription views", async () => {
  window.location.hash = "#/leitstand/terminal"; render(<App />);
  const listen = mocks.listen.getMockImplementation()!;
  let settle: (() => void) | undefined;
  mocks.listen.mockImplementation((event, handler) => event === "pty:exit:session-a"
    ? new Promise((resolve) => { settle = () => resolve(vi.fn()); }) : listen(event, handler));
  let failure: unknown;
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Neue Sitzung" }));
    fireEvent.click(await screen.findByRole("button", { name: "Shell" }));
    expect(await screen.findByRole("tab", { name: "Shell" })).toHaveAttribute("aria-selected", "true");
    const live = screen.getByRole("button", { name: "Neue Sitzung" });
    expect(live).toHaveAttribute("aria-busy", "true");
    fireEvent.click(live);
    expect(live).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Tab schließen" }));
    expect(screen.getByText("Keine Terminal-Sitzung geöffnet.")).toBeVisible();
    go("#/leitstand"); go("#/leitstand/terminal");
    const empty = await screen.findByRole("button", { name: "Neue Sitzung" });
    fireEvent.click(empty); fireEvent.click(empty, { detail: 0 });
    expect(empty).toHaveAttribute("aria-busy", "true");
    expect(empty).toHaveAttribute("aria-expanded", "false");
    expect(mocks.invoke.mock.calls.filter(([name]) => ["spawn_pty", "kill_pty", "respawn_worker"].includes(name))).toEqual([
      ["spawn_pty", { profileId: "shell", cols: 80, rows: 24 }], ["kill_pty", { sessionId: "session-a" }],
    ]);
    await act(async () => { settle!(); });
    expect(empty).not.toHaveAttribute("aria-busy", "true");
    fireEvent.click(empty);
    expect(await screen.findByRole("button", { name: "Shell" })).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
  } catch (error) { failure = error; throw error; } finally {
    await finishLaunchTest(failure, () => { settle?.(); mocks.listen.mockImplementation(listen); });
  }
});
