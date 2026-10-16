import { useCallback, useMemo, useSyncExternalStore } from "react";

import { readString, writeString } from "../../lib/settings";
import { REDUCED_QUERY } from "./texts";

// DS-X-03 (decision D2): the motion mode is only `data-motion` on <html>; absent = Ruhig. Same early-apply
// contract as the glass variant (`useGlassVariant.ts`). The OS reduced-motion setting always wins: in
// motion.css by specificity, here by `reduced`.

export type MotionMode = "calm" | "lively" | "off";

export const MOTION_MODES: readonly MotionMode[] = ["calm", "lively", "off"];

export const MOTION_MODE_KEY = "projecta.settings.motionMode";

const listeners = new Set<() => void>();

/** Unknown or missing stored values fall back to Ruhig. */
export function loadMotionMode(): MotionMode {
  const raw = readString(MOTION_MODE_KEY);
  return MOTION_MODES.find((m) => m === raw) ?? "calm";
}

function applyMotionMode(mode: MotionMode): void {
  if (mode === "calm") delete document.documentElement.dataset.motion;
  else document.documentElement.dataset.motion = mode;
}

export function saveMotionMode(mode: MotionMode): void {
  writeString(MOTION_MODE_KEY, mode === "calm" ? null : mode);
  applyMotionMode(mode);
  listeners.forEach((notify) => notify());
}

/** Call before the first paint (the shell does it in a layout effect) so Ruhig never flashes. */
export function applyStoredMotionMode(): void {
  applyMotionMode(loadMotionMode());
}

export interface Motion {
  /** The user's choice (stored). */
  mode: MotionMode;
  /** The OS asks for reduced motion. */
  system: boolean;
  /** Everything must rest: the OS asks for it or the mode is Aus. */
  reduced: boolean;
  /** Looping or decorative motion may run: only Lebendig, and never when `reduced`. */
  ambient: boolean;
}

/** Without `matchMedia` (old webviews, tests) the OS never asks. shortcut: the mode is read from localStorage, so with storage disabled the hook stays Ruhig; upgrade if such a webview is ever supported. */
export function useMotion(): Motion {
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
