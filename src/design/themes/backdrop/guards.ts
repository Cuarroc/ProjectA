/** Pure pause logic for the theme backdrop runtime (no DOM, no timers). */
export type PauseReason = "hidden" | "blur" | "overlay" | "typing";

export const TYPING_PAUSE_MS = 2000;

export function createPauseState(now: () => number) {
  const flags = { hidden: false, blur: false, overlay: false };
  let lastKeyAt = -Infinity;
  return {
    set: (reason: keyof typeof flags, on: boolean) => void (flags[reason] = on),
    key: () => void (lastKeyAt = now()),
    reason(): PauseReason | null {
      const flag = (["hidden", "blur", "overlay"] as const).find((k) => flags[k]);
      if (flag) return flag;
      return now() - lastKeyAt < TYPING_PAUSE_MS ? "typing" : null;
    },
  };
}
