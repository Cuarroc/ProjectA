import type { HTMLAttributes } from "react";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  size?: "sm" | "md";
}

/** Static label. Not interactive; use FilterChip for a toggle. */
export function Chip({ size = "md", className, ...rest }: ChipProps) {
  return <span className={["g-chip", size === "sm" && "g-chip--sm", className].filter(Boolean).join(" ")} {...rest} />;
}
