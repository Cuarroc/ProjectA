/** CSS property names: read computed values so motion preferences remain authoritative. */
export const motionDuration = {
  instant: "--g-dur-instant",
  fast: "--g-dur-1",
  base: "--g-dur-2",
  slow: "--g-dur-3",
  hop: "--g-dur-4",
  travel: "--g-dur-5",
  exit: "--g-dur-exit",
  ambient: "--g-dur-ambient",
} as const;

export const motionEasing = {
  // Semantic movement curve for DS-02; the legacy --g-ease still uses ease-out.
  standard: "--g-ease-move",
  enter: "--g-ease-out",
  exit: "--g-ease-in",
  emphasis: "--g-ease-path",
} as const;

export type MotionDuration = keyof typeof motionDuration;
export type MotionEasing = keyof typeof motionEasing;
