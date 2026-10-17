import { useSyncExternalStore } from "react";

import { useMotion } from "../motion/motionMode";
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

/** `still` = Aus or OS reduced motion (frame 0); `paused` = the document is hidden. */
export function useHallMotion(): { motion: "calm" | "lively" | "still"; paused: boolean } {
  const { mode, reduced } = useMotion();
  const paused = useSyncExternalStore(onVisibility, () => document.hidden);
  return { motion: reduced ? "still" : mode === "lively" ? "lively" : "calm", paused };
}
