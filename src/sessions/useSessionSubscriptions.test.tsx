import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useSessionSubscriptions } from "./useSessionSubscriptions";

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
    if (command === "spawn_pty") return { sessionId: "session-a" };
    if (command === "get_scrollback") {
      [...mocks.listeners].reverse().find((entry) => entry.event === "pty:output:session-a")?.handler({ payload: "live" });
      return "history";
    }
    return null;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const active = (event: string) => mocks.listeners.filter((entry) => entry.event === event && entry.stop.mock.calls.length === 0);
const go = (hash: string) => act(() => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent("hashchange")); });

// The actual App and TerminalView exercise D1, tab ownership and output replay;
// only the native IPC and xterm browser boundaries are replaced.
describe.each([false, true])("session subscriptions with D1=%s", (d1) => {
  it("keeps exactly one output subscription per open session", async () => {
    localStorage.setItem("projecta.settings.featureFlag.d1_neue_oberflaeche", d1 ? "1" : "0");
    window.location.hash = "#/leitstand/klassisch";
    const view = render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Agents" }));
    fireEvent.click(await screen.findByRole("button", { name: "Neue Sitzung" }));
    fireEvent.click(await screen.findByRole("button", { name: /Shell/ }));
    await waitFor(() => expect(active("pty:output:session-a")).toHaveLength(1));
    expect(active("pty:exit:session-a")).toHaveLength(1);
    expect(mocks.writes).toEqual(["history", "live"]);
    fireEvent.click(screen.getByRole("tab", { name: "Shell" }));
    if (d1) {
      go("#/einstellungen"); go("#/leitstand"); go("#/leitstand/klassisch");
    } else {
      fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
      fireEvent.click(screen.getByRole("tab", { name: "Agents" }));
    }
    await waitFor(() => expect(active("pty:output:session-a")).toHaveLength(1));
    expect(view.container.querySelectorAll(".xterm")).toHaveLength(1);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "spawn_pty")).toHaveLength(1);
    expect(mocks.invoke.mock.calls.some(([command]) => command === "kill_pty")).toBe(false);
    act(() => active("pty:exit:session-a")[0].handler({ payload: { code: 0 } }));
    expect(screen.getByRole("tab", { name: "Shell beendet" })).toHaveAttribute("aria-selected", "true");
    expect(active("pty:exit:session-a")).toHaveLength(0);
    view.unmount();
    expect(active("pty:output:session-a")).toHaveLength(0);
  });
});

it("tears down every subscription on unmount", async () => {
  let resolve!: (stop: () => void) => void;
  const lateStop = vi.fn();
  const onExit = vi.fn();
  const hook = renderHook(() => useSessionSubscriptions(vi.fn(), onExit));
  await act(() => hook.result.current.subscribeExit("ready"));
  mocks.listen.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  let pending!: Promise<void>;
  act(() => { pending = hook.result.current.subscribeExit("pending"); });
  hook.unmount();
  expect(mocks.listeners).toHaveLength(1);
  expect(mocks.listeners[0].stop).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(lateStop); await pending; });
  expect(lateStop).toHaveBeenCalledTimes(1);
  mocks.listeners[0].handler({ payload: { code: 1 } });
  expect(onExit).not.toHaveBeenCalled();
});
