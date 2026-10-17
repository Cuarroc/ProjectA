import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveMotionMode } from "./motionMode";
import { EXIT_MS, useExitTransition } from "./useExitTransition";

beforeEach(() => { localStorage.clear(); delete document.documentElement.dataset.motion; vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

const setup = (open: boolean) => renderHook(({ o }) => useExitTransition(o), { initialProps: { o: open } });

describe("useExitTransition", () => {
  it("keeps the node mounted for the exit duration and unmounts at once under reduce", () => {
    const calm = setup(true);
    expect(calm.result.current).toEqual({ mounted: true, closing: false });
    calm.rerender({ o: false });
    expect(calm.result.current).toEqual({ mounted: true, closing: true });
    act(() => { vi.advanceTimersByTime(EXIT_MS - 1); });
    expect(calm.result.current.mounted).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(calm.result.current).toEqual({ mounted: false, closing: false });

    act(() => saveMotionMode("off"));
    const off = setup(true);
    off.rerender({ o: false });
    expect(off.result.current).toEqual({ mounted: false, closing: false });
  });

  it("cancels the exit when it opens again while closing", () => {
    const hook = setup(true);
    hook.rerender({ o: false });
    act(() => { vi.advanceTimersByTime(EXIT_MS / 2); });
    hook.rerender({ o: true });
    act(() => { vi.advanceTimersByTime(EXIT_MS * 2); });
    expect(hook.result.current).toEqual({ mounted: true, closing: false });
  });

  it("starts unmounted when it starts closed", () => {
    expect(setup(false).result.current).toEqual({ mounted: false, closing: false });
  });
});
