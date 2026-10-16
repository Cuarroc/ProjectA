import { de } from "../../../i18n/de";
import { STATE_FORMS, STATE_UNKNOWN_FORM, type StateForm } from "../../state/states";

// DS-H-03: roles and poses of docs/design/hall/ASSETS.md §6; the rasters are in roles.px.ts.

export const ROLES = ["plan", "build", "check", "ops"] as const;
export type Role = (typeof ROLES)[number];

/** The role as text at the operable element; the figure itself is decorative. */
export const ROLE_WORDS: Record<Role, string> = {
  plan: de["hall.role.plan"], build: de["hall.role.build"], check: de["hall.role.check"], ops: de["hall.role.ops"],
};

export type Pose = StateForm | typeof STATE_UNKNOWN_FORM | "ready";

/** Frames per pose; frame 0 carries the meaning on its own. */
export const POSE_FRAMES: Record<Pose, 1 | 2> = { run: 2, need: 2, rev: 1, ok: 2, done: 1, bad: 2, unknown: 1, ready: 1 };

/** Pose for an observed run's form, `ready` when no run is observed; anything outside the six forms is `unknown`. */
export function poseFor(form: string | null): Pose {
  if (form === null) return "ready";
  return STATE_FORMS.find((f) => f === form) ?? STATE_UNKNOWN_FORM;
}
