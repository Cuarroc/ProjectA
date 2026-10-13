import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSessionSubscriptions } from "./useSessionSubscriptions";

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

it("tears down every subscription on unmount", async () => {
  let resolve!: (stop: () => void) => void;
  const lateStop = vi.fn();
  const onExit = vi.fn();
  const hook = renderHook(() => useSessionSubscriptions(vi.fn(), onExit));
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
