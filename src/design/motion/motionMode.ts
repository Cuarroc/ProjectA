// RED STUB (DS-X-03): compiles, does nothing; replaced by the real module in the next commit.
export type MotionMode = "calm" | "lively" | "off";
export const MOTION_MODES: readonly MotionMode[] = [];
export const MOTION_MODE_KEY = "";
export const loadMotionMode = (): MotionMode => "calm";
export const applyStoredMotionMode = (): void => {};
export const saveMotionMode = (_mode: MotionMode): void => {};
export const useMotion = () => ({ mode: "calm" as MotionMode, system: false, reduced: false, ambient: false });
