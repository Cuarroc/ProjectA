import type { HTMLAttributes } from "react";

export type MeterTone = "neutral" | "accent" | "hot" | "lock" | "good";

export interface MeterProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children" | "role"> {
  /** 0 to 100. Out of range is clamped, NaN counts as 0. */
  value: number;
  tone?: MeterTone;
  "aria-label": string;
}

export function Meter({ value, tone = "neutral", className, ...rest }: MeterProps) {
  const pct = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <span {...rest} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className={["g-meter", className].filter(Boolean).join(" ")}>
      <b className={tone === "neutral" ? undefined : `g-meter--${tone}`} style={{ width: `${pct}%` }} />
    </span>
  );
}
