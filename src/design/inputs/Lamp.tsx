import type { HTMLAttributes } from "react";

export type LampState = "ok" | "off" | "warn" | "busy" | "bad";

export interface LampProps extends HTMLAttributes<HTMLSpanElement> {
  state?: LampState;
  /** Accessible name. Without it the lamp is decorative: its text must sit next to it. */
  label?: string;
}

/** Colour never carries the state alone: warn is a diamond, busy a ring, bad a triangle. */
export function Lamp({ state = "ok", label, className, ...rest }: LampProps) {
  // Spread after rest: the label alone decides the accessibility, a caller cannot override it.
  const a11y = label
    ? { role: "img", "aria-label": label, "aria-hidden": undefined }
    : { role: undefined, "aria-label": undefined, "aria-hidden": true };
  return <span className={["g-lamp", state !== "ok" && `g-lamp--${state}`, className].filter(Boolean).join(" ")} {...rest} {...a11y} />;
}
