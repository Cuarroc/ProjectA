import type { HTMLAttributes } from "react";

export type LampState = "ok" | "off" | "warn" | "busy" | "bad" | "unknown";

export interface LampProps extends HTMLAttributes<HTMLSpanElement> {
  /** Required: a lamp nobody set is unknown, never ok. */
  state: LampState;
  /** Accessible name. Without it the lamp is decorative: its text must sit next to it. */
  label?: string;
}

const KNOWN: readonly LampState[] = ["ok", "off", "warn", "busy", "bad"];

/** A runtime value outside the known states (also undefined) is the neutral unknown lamp, never ok. */
function shownState(state: LampState | undefined): LampState {
  return KNOWN.find((known) => known === state) ?? "unknown";
}

/** Colour never carries the state alone: warn is a diamond, busy an open ring, bad a triangle, unknown a closed ring. */
export function Lamp({ state, label, className, ...rest }: LampProps) {
  const shown = shownState(state);
  // Spread after rest: the label alone decides the accessibility, a caller cannot override it.
  const a11y = label
    ? { role: "img", "aria-label": label, "aria-hidden": undefined }
    : { role: undefined, "aria-label": undefined, "aria-hidden": true };
  return <span className={["g-lamp", shown !== "ok" && `g-lamp--${shown}`, className].filter(Boolean).join(" ")} {...rest} {...a11y} />;
}
