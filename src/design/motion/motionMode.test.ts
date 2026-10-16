import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOTION_MODE_KEY, MOTION_MODES, applyStoredMotionMode, loadMotionMode, saveMotionMode, useMotion } from "./motionMode";

const root = document.documentElement;
beforeEach(() => { localStorage.clear(); delete root.dataset.motion; });
afterEach(() => vi.unstubAllGlobals());

/** jsdom has no matchMedia: stand in for the OS reduced-motion setting; `set` flips it, `listeners` are the live subscriptions. */
function osReduced(matches: boolean) {
  const listeners = new Set<() => void>();
  let on = matches;
  vi.stubGlobal("matchMedia", () => ({
    get matches() { return on; },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }));
  return { listeners, set: (next: boolean) => act(() => { on = next; listeners.forEach((fn) => fn()); }) };
}
const stored = () => [root.dataset.motion, localStorage.getItem(MOTION_MODE_KEY)];

describe("motion mode preference", () => {
  it("defaults to calm and ignores unknown stored values", () => {
    expect(MOTION_MODES).toEqual(["calm", "lively", "off"]);
    localStorage.setItem(MOTION_MODE_KEY, "wild");
    expect(loadMotionMode()).toBe("calm");
    applyStoredMotionMode();
    expect(root.dataset.motion).toBeUndefined();
  });
  it("sets and removes data-motion and persists only non-default values", () => {
    saveMotionMode("lively");
    expect(stored()).toEqual(["lively", "lively"]);
    saveMotionMode("calm");
    expect(stored()).toEqual([undefined, null]);
    localStorage.setItem(MOTION_MODE_KEY, "off");
    applyStoredMotionMode();
    expect(root.dataset.motion).toBe("off");
  });
  it("hook follows saved changes and only lively is ambient", () => {
    osReduced(false);
    const { result } = renderHook(() => useMotion());
    expect(result.current).toEqual({ mode: "calm", system: false, reduced: false, ambient: false });
    act(() => saveMotionMode("lively"));
    expect(result.current).toEqual({ mode: "lively", system: false, reduced: false, ambient: true });
    act(() => saveMotionMode("off"));
    expect(result.current).toEqual({ mode: "off", system: false, reduced: true, ambient: false });
  });
  it("reduced always wins over lively", () => {
    localStorage.setItem(MOTION_MODE_KEY, "lively");
    const { set } = osReduced(true);
    const { result } = renderHook(() => useMotion());
    expect(result.current).toMatchObject({ system: true, reduced: true, ambient: false });
    set(false);
    expect(result.current.ambient).toBe(true);
    set(true);
    expect(result.current.ambient).toBe(false);
  });
  it("never matches without matchMedia and releases its listener on unmount", () => {
    expect(renderHook(() => useMotion()).result.current.reduced).toBe(false);
    const { listeners } = osReduced(false);
    const { unmount } = renderHook(() => useMotion());
    expect(listeners.size).toBeGreaterThan(0);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
