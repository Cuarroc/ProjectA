import type { StateForm } from "../../state/states";

// DS-H-03 stub: only makes figures.test.ts compile.
export const ROLES = ["plan", "build", "check", "ops"] as const;
export type Role = (typeof ROLES)[number];
export type Pose = StateForm | "unknown" | "ready";
export const ROLE_WORDS = {} as Record<Role, string>;
export const POSE_FRAMES = {} as Record<Pose, 1 | 2>;
export function poseFor(_form: string | null): Pose {
  throw new Error("DS-H-03 stub");
}
