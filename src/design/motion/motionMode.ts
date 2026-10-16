import { useCallback, useMemo, useSyncExternalStore } from "react";

import { readString, writeString } from "../../lib/settings";
import { REDUCED_QUERY } from "./texts";

// DS-X-03 (D2): the motion mode is only `data-motion` on <html>; absent = Ruhig. Same early-apply contract as
// `useGlassVariant.ts`. The OS reduced-motion setting always wins: in motion.css by specificity, here by `reduced`.
export type MotionMode = "calm" | "lively" | "off";
export const MOTION_MODES: readonly MotionMode[] = ["calm", "lively", "off"];
export const MOTION_MODE_KEY = "projecta.settings.motionMode";
const listeners = new Set<() => void>();

export const loadMotionMode = (): MotionMode => MOTION_MODES.find((m) => m === readString(MOTION_MODE_KEY)) ?? "calm";

/** Call before the first paint (the shell does it in a layout effect) so Ruhig never flashes. */
export function applyStoredMotionMode(): void {
  const mode = loadMotionMode();
  if (mode === "calm") delete document.documentElement.dataset.motion;
  else document.documentElement.dataset.motion = mode;
}

export function saveMotionMode(mode: MotionMode): void {
  writeString(MOTION_MODE_KEY, mode === "calm" ? null : mode);
  applyStoredMotionMode();
  listeners.forEach((notify) => notify());
}

/**
 * mode = stored choice, system = the OS asks for less, reduced = everything rests (system or Aus), ambient = loops may run (Lebendig only).
 * shortcut: the mode comes from localStorage, so without storage the hook stays Ruhig; upgrade if such a webview is ever supported.
 */
export function useMotion() {
  const list = useMemo(() => (typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_QUERY) : null), []);
  const subscribe = useCallback((notify: () => void) => {
    listeners.add(notify);
    list?.addEventListener("change", notify);
    return () => { listeners.delete(notify); list?.removeEventListener("change", notify); };
  }, [list]);
  const mode = useSyncExternalStore(subscribe, loadMotionMode);
  const system = useSyncExternalStore(subscribe, () => list?.matches ?? false);
  const reduced = system || mode === "off";
  return { mode, system, reduced, ambient: !reduced && mode === "lively" };
}
