import type { HTMLAttributes } from "react";

export type MeterTone = "neutral" | "accent" | "hot" | "lock" | "good";

export interface MeterProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children" | "role"> {
  /** 0 to 100. Out of range is clamped; null or NaN means no measurement, not 0. */
  value: number | null;
  tone?: MeterTone;
  "aria-label": string;
}

const COLORED_TONES = new Set<MeterTone>(["accent", "hot", "lock", "good"]);

export function Meter({ value, tone = "neutral", className, ...rest }: MeterProps) {
  const pct = value !== null && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
  const barTone = COLORED_TONES.has(tone) ? tone : undefined;
  // ARIA requires aria-valuenow on a meter: without a measurement it is a named empty track, not a meter at 0.
  const range = pct === null
    ? { role: "img", "aria-valuemin": undefined, "aria-valuemax": undefined, "aria-valuenow": undefined }
    : { role: "meter", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct };
  return (
    <span {...rest} {...range} className={["g-meter", className].filter(Boolean).join(" ")}>
      {pct !== null && <b className={barTone === undefined ? undefined : `g-meter--${barTone}`} style={{ transform: `scaleX(${pct / 100})` }} />}
    </span>
  );
}
