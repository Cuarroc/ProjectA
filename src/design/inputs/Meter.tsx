import type { HTMLAttributes } from "react";

export type MeterTone = "neutral" | "accent" | "hot" | "lock" | "good";

export interface MeterProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children" | "role"> {
  /** 0 to 100. Out of range is clamped, NaN counts as 0. */
  value: number;
  tone?: MeterTone;
  "aria-label": string;
}

const COLORED_TONES = new Set<MeterTone>(["accent", "hot", "lock", "good"]);

export function Meter({ value, tone = "neutral", className, ...rest }: MeterProps) {
  const pct = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  const barTone = COLORED_TONES.has(tone) ? tone : undefined;
  return (
    <span {...rest} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className={["g-meter", className].filter(Boolean).join(" ")}>
      <b className={barTone === undefined ? undefined : `g-meter--${barTone}`} style={{ width: `${pct}%` }} />
    </span>
  );
}
