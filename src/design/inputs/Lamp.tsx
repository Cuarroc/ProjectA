import type { HTMLAttributes } from "react";

export type LampState = "ok" | "off" | "warn" | "busy" | "bad";

export interface LampProps extends HTMLAttributes<HTMLSpanElement> {
  state?: LampState;
  /** Accessible name. Without it the lamp is decorative: its text must sit next to it. */
  label?: string;
}

/** A runtime value outside the five known states is the plain ok lamp: no ghost class. */
function shownState(state: string): LampState {
  return state === "off" || state === "warn" || state === "busy" || state === "bad" ? state : "ok";
}

/** Colour never carries the state alone: warn is a diamond, busy a ring, bad a triangle. */
export function Lamp({ state = "ok", label, className, ...rest }: LampProps) {
  const shown = shownState(state);
  // Spread after rest: the label alone decides the accessibility, a caller cannot override it.
  const a11y = label
    ? { role: "img", "aria-label": label, "aria-hidden": undefined }
    : { role: undefined, "aria-label": undefined, "aria-hidden": true };
  return <span className={["g-lamp", shown !== "ok" && `g-lamp--${shown}`, className].filter(Boolean).join(" ")} {...rest} {...a11y} />;
}
