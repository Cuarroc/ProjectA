import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { FEATURE_FLAG_STORAGE_PREFIX } from "../flags/featureFlags";
import { ptyExit, ptyOutput } from "../lib/eventNames";

const D1_FLAG_KEY = `${FEATURE_FLAG_STORAGE_PREFIX}d1_neue_oberflaeche`;

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(), writes: [] as string[],
  listeners: [] as Array<{ event: string; handler: (event: { payload: unknown }) => void; stop: ReturnType<typeof vi.fn> }>,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  cols = 80; rows = 24; options = {}; element = document.createElement("div");
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
  localStorage.clear(); window.location.hash = "";
  mocks.listeners = []; mocks.writes = []; mocks.invoke.mockReset(); mocks.listen.mockReset();
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const active = (event: string) => mocks.listeners.filter((entry) => entry.event === event && entry.stop.mock.calls.length === 0);
const go = (hash: string) => act(() => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent("hashchange")); });

const openShellTab = async () => {
  fireEvent.click(await screen.findByRole("tab", { name: "Agents" }));
  fireEvent.click(await screen.findByRole("button", { name: "Neue Sitzung" }));
  fireEvent.click(await screen.findByRole("button", { name: "Shellshell" }));
};

// The actual App and TerminalView exercise D1, the provider, tab ownership and
// output replay; only the native IPC and xterm browser boundaries are replaced.
describe.each([false, true])("session provider with D1=%s", (d1) => {
  it("replays open select and exit with one output subscription per session", async () => {
    localStorage.setItem(D1_FLAG_KEY, d1 ? "1" : "0");
    window.location.hash = "#/leitstand/klassisch";
    const view = render(<App />);
    await openShellTab();
    await waitFor(() => expect(active(ptyOutput("session-a"))).toHaveLength(1));
    expect(active(ptyExit("session-a"))).toHaveLength(1);
    expect(mocks.writes).toEqual(["history", "live"]);
    fireEvent.click(screen.getByRole("tab", { name: "Shell" }));
    if (d1) {
      go("#/einstellungen");
      await screen.findByRole("button", { name: "Klassische Einstellungen öffnen" });
      go("#/leitstand"); go("#/leitstand/klassisch");
      fireEvent.click(await screen.findByRole("tab", { name: "Agents" }));
    } else {
      fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
      fireEvent.click(screen.getByRole("tab", { name: "Agents" }));
    }
    await waitFor(() => expect(active(ptyOutput("session-a"))).toHaveLength(1));
    expect(mocks.writes).toEqual(["history", "live", "history", "live"]);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "get_scrollback")).toHaveLength(2);
    expect(view.container.querySelectorAll(".xterm")).toHaveLength(1);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "spawn_pty")).toHaveLength(1);
    expect(mocks.invoke.mock.calls.some(([command]) => command === "kill_pty")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Neue Sitzung" }));
    fireEvent.click(await screen.findByRole("button", { name: "Shellshell" }));
    await waitFor(() => expect(active(ptyOutput("session-b"))).toHaveLength(1));
    expect(active(ptyOutput("session-a"))).toHaveLength(0);
    fireEvent.click(screen.getAllByRole("tab", { name: "Shell" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Terminal teilen" }));
    await waitFor(() => expect(active(ptyOutput("session-b"))).toHaveLength(1));
    expect(active(ptyOutput("session-a"))).toHaveLength(1);
    expect(view.container.querySelectorAll(".xterm")).toHaveLength(2);
    act(() => active(ptyExit("session-a"))[0].handler({ payload: { code: 0 } }));
    expect(screen.getByRole("tab", { name: "Shellbeendet" })).toHaveAttribute("aria-selected", "true");
    expect(active(ptyExit("session-a"))).toHaveLength(0);
    view.unmount();
    expect(active(ptyOutput("session-a"))).toHaveLength(0);
    expect(active(ptyOutput("session-b"))).toHaveLength(0);
    expect(active(ptyExit("session-b"))).toHaveLength(0);
  });

  it("tears down every output subscription on unmount", async () => {
    localStorage.setItem(D1_FLAG_KEY, d1 ? "1" : "0");
    window.location.hash = "#/leitstand/klassisch";
    const view = render(<App />);
    await openShellTab();
    await waitFor(() => expect(active(ptyOutput("session-a"))).toHaveLength(1));
    expect(active(ptyExit("session-a"))).toHaveLength(1);
    view.unmount();
    expect(active(ptyOutput("session-a"))).toHaveLength(0);
    expect(active(ptyExit("session-a"))).toHaveLength(0);
    expect(mocks.invoke.mock.calls.some(([command]) => command === "kill_pty")).toBe(false);
  });
});
