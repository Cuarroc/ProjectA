import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

import { useMotion, type MotionMode } from "../motion/motionMode";
import type { Pose } from "./figures/poses";

// DS-H-06 (ASSETS.md §7): which figures may move and when everything rests. CSS (motion.css) does the animating.
export const MAX_MOVING = 12;
/** Only an observed run moves. The once-per-change gestures (need, ok, bad) wait for an observed-change signal the probe does not have. */
const MOVING_POSES: readonly Pose[] = ["run"];

/** Per figure: may it move? Everything past the first MAX_MOVING stays on frame 0. */
export function pickMoving(poses: readonly Pose[]): boolean[] {
  let n = 0;
  return poses.map((p) => MOVING_POSES.includes(p) && n++ < MAX_MOVING);
}

const onVisibility = (notify: () => void) => {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
};

/** Is the element on screen? Without IntersectionObserver (old webview, jsdom) it counts as visible. */
function useOffScreen(ref: RefObject<Element | null>): boolean {
  const [off, setOff] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver !== "function") return;
    const watch = new IntersectionObserver((entries) => setOff(!entries[entries.length - 1].isIntersecting));
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref]);
  return off;
}

/**
 * `still` = Aus or OS reduced motion (frame 0); `paused` = the document is hidden or the scene is off screen.
 * `override` replaces the app's stored mode for this hall only (the gallery page switch); the OS setting still wins.
 */
export function useHallMotion(override?: MotionMode): { motion: "calm" | "lively" | "still"; paused: boolean; sceneRef: RefObject<HTMLDivElement> } {
  const { mode: stored, system } = useMotion();
  const mode = override ?? stored;
  const sceneRef = useRef<HTMLDivElement>(null);
  const hidden = useSyncExternalStore(onVisibility, () => document.hidden);
  const offScreen = useOffScreen(sceneRef);
  return { motion: system || mode === "off" ? "still" : mode === "lively" ? "lively" : "calm", paused: hidden || offScreen, sceneRef };
}
