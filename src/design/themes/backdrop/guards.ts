/** Pure guard logic for the theme backdrop runtime (no DOM, no timers). */
export type PauseReason = "hidden" | "blur" | "overlay" | "hold" | "typing";
export type Downgrade = "scale" | "fps" | "static";

/** Slow-frame ladder: render scale first, then fps, then a static frame. */
export const DOWNGRADE_STEPS: readonly Downgrade[] = ["scale", "fps", "static"];
export const TYPING_PAUSE_MS = 2000;

export function createPauseState(now: () => number) {
  const flags = { hidden: false, blur: false, overlay: false };
  let holds = 0;
  let lastKeyAt = -Infinity;
  return {
    set: (reason: keyof typeof flags, on: boolean) => void (flags[reason] = on),
    hold: () => void (holds += 1),
    release: () => void (holds = Math.max(0, holds - 1)),
    key: () => void (lastKeyAt = now()),
    reason(): PauseReason | null {
      const flag = (["hidden", "blur", "overlay"] as const).find((k) => flags[k]);
      if (flag) return flag;
      if (holds > 0) return "hold";
      return now() - lastKeyAt < TYPING_PAUSE_MS ? "typing" : null;
    },
  };
}

/** True once the mean frame cost of a whole window (2 s) ran over budget (2 ms). */
export function createBudget(budgetMs = 2, windowMs = 2000) {
  let start = -1;
  let total = 0;
  let count = 0;
  return (costMs: number, at: number): boolean => {
    if (start < 0) start = at;
    total += costMs;
    count += 1;
    if (at - start < windowMs) return false;
    const over = total / count > budgetMs;
    [start, total, count] = [-1, 0, 0];
    return over;
  };
}

export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}
