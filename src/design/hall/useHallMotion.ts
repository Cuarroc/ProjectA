import type { Pose } from "./figures/poses";

// DS-H-06 stub: nothing moves yet (red-first); the real hook follows in the next commit.
export const MAX_MOVING = 12;
export const pickMoving = (poses: readonly Pose[]): boolean[] => poses.map(() => false);
export const useHallMotion = () => ({ motion: "still" as "calm" | "lively" | "still", paused: false });
