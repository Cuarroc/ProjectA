import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MOTION_MODE_KEY, MOTION_MODES, applyStoredMotionMode, loadMotionMode, saveMotionMode, useMotion,
} from "./motionMode";

const root = document.documentElement;
beforeEach(() => { localStorage.clear(); delete root.dataset.motion; });
afterEach(() => vi.unstubAllGlobals());

/** jsdom has no matchMedia: stand in for the OS reduced-motion setting. */
function osReduced(matches: boolean) {
  const listeners = new Set<() => void>();
  let current = matches;
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() { return current && query === "(prefers-reduced-motion: reduce)"; },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }));
  return (next: boolean) => act(() => { current = next; listeners.forEach((fn) => fn()); });
}

describe("motion mode preference", () => {
  it("defaults to calm and ignores unknown stored values", () => {
    expect(MOTION_MODES).toEqual(["calm", "lively", "off"]);
    expect(loadMotionMode()).toBe("calm");
    localStorage.setItem(MOTION_MODE_KEY, "wild");
    expect(loadMotionMode()).toBe("calm");
    applyStoredMotionMode();
    expect(root.dataset.motion).toBeUndefined();
  });

  it("sets and removes data-motion and persists only non-default values", () => {
    for (const mode of ["lively", "off"] as const) {
      saveMotionMode(mode);
      expect(root.dataset.motion).toBe(mode);
      expect(localStorage.getItem(MOTION_MODE_KEY)).toBe(mode);
    }
    saveMotionMode("calm");
    expect(root.dataset.motion).toBeUndefined();
    expect(localStorage.getItem(MOTION_MODE_KEY)).toBeNull();
    localStorage.setItem(MOTION_MODE_KEY, "off");
    applyStoredMotionMode();
    expect(root.dataset.motion).toBe("off");
  });

  it("hook follows saved changes and only lively is ambient", () => {
    osReduced(false);
    const { result } = renderHook(() => useMotion());
    expect(result.current).toMatchObject({ mode: "calm", system: false, reduced: false, ambient: false });
    act(() => saveMotionMode("lively"));
    expect(result.current).toMatchObject({ mode: "lively", reduced: false, ambient: true });
    act(() => saveMotionMode("off"));
    expect(result.current).toMatchObject({ mode: "off", system: false, reduced: true, ambient: false });
  });

  it("reduced always wins over lively", () => {
    localStorage.setItem(MOTION_MODE_KEY, "lively");
    const set = osReduced(true);
    const { result } = renderHook(() => useMotion());
    expect(result.current).toMatchObject({ mode: "lively", system: true, reduced: true, ambient: false });
    set(false);
    expect(result.current).toMatchObject({ system: false, reduced: false, ambient: true });
    set(true);
    expect(result.current.ambient).toBe(false);
  });

  it("never matches without matchMedia and releases its listener on unmount", () => {
    const { result, unmount } = renderHook(() => useMotion());
    expect(result.current.reduced).toBe(false);
    unmount();
    const added = vi.fn();
    const removed = vi.fn();
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: added, removeEventListener: removed }));
    renderHook(() => useMotion()).unmount();
    expect(added).toHaveBeenCalled();
    expect(removed).toHaveBeenCalledTimes(added.mock.calls.length);
  });
});
