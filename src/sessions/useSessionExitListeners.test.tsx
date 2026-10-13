import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ptyExit } from "../lib/eventNames";
import { useSessionExitListeners } from "./useSessionExitListeners";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(),
  listeners: [] as Array<{ event: string; handler: (event: { payload: unknown }) => void; stop: ReturnType<typeof vi.fn> }>,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

beforeEach(() => {
  mocks.listeners = []; mocks.invoke.mockReset(); mocks.listen.mockReset();
  mocks.listen.mockImplementation(async (event, handler) => {
    const stop = vi.fn(); mocks.listeners.push({ event, handler, stop }); return stop;
  });
});
afterEach(() => cleanup());
const active = (event: string) => mocks.listeners.filter((entry) => entry.event === event && entry.stop.mock.calls.length === 0);

it("tears down every subscription on unmount", async () => {
  let resolve!: (stop: () => void) => void;
  const lateStop = vi.fn();
  const onExit = vi.fn();
  const hook = renderHook(() => useSessionExitListeners(vi.fn(), onExit));
  await act(() => hook.result.current.subscribeExit("ready"));
  mocks.listen.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  let pending!: Promise<void>;
  act(() => { pending = hook.result.current.subscribeExit("pending"); });
  await act(() => hook.result.current.subscribeExit("pending"));
  expect(mocks.listen).toHaveBeenCalledTimes(2);
  hook.unmount();
  expect(mocks.listeners).toHaveLength(1);
  expect(mocks.listeners[0].stop).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(lateStop); await pending; });
  expect(lateStop).toHaveBeenCalledTimes(1);
  mocks.listeners[0].handler({ payload: { code: 1 } });
  expect(onExit).not.toHaveBeenCalled();
});

// R1262-G1/K1: a rejected registration must free the session for a retry.
it("rethrows when onPtyExit rejects and frees the session for a retry", async () => {
  const hook = renderHook(() => useSessionExitListeners(vi.fn(), vi.fn()));
  mocks.listen.mockRejectedValueOnce(new Error("listen failed"));
  await expect(
    act(async () => {
      await hook.result.current.subscribeExit("broken");
    }),
  ).rejects.toThrow("listen failed");
  await act(() => hook.result.current.subscribeExit("broken"));
  expect(active(ptyExit("broken"))).toHaveLength(1);
});

// R1262-G1/K1: an exit can arrive while the registration is still in flight —
// tauri has the handler before the unlisten promise resolves.
it("marks an exit that arrives while onPtyExit is still pending", async () => {
  const applyExit = vi.fn();
  const onExit = vi.fn();
  const hook = renderHook(() => useSessionExitListeners(applyExit, onExit));
  let resolve!: (stop: () => void) => void;
  const lateStop = vi.fn();
  mocks.listen.mockImplementationOnce((event, handler) => {
    mocks.listeners.push({ event, handler, stop: lateStop });
    return new Promise((done) => {
      resolve = done;
    });
  });
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.subscribeExit("slow");
  });
  act(() => {
    mocks.listeners[0].handler({ payload: { code: 7 } });
  });
  expect(applyExit).toHaveBeenCalledWith("slow", 7);
  expect(onExit).toHaveBeenCalledWith("slow", 7);
  await act(async () => {
    resolve(lateStop);
    await pending;
  });
  // The registration resolved after the exit: dispose it at once, keep nothing.
  expect(lateStop).toHaveBeenCalledTimes(1);
  expect(active(ptyExit("slow"))).toHaveLength(0);
});
