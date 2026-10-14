import type { HTMLAttributes } from "react";

export interface ChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, "tabIndex"> {
  size?: "sm" | "md";
}

/** Static label. Not interactive; use FilterChip for a toggle. */
export function Chip({ size = "md", className, ...rest }: ChipProps) {
  // A static label never takes focus: drop any tabIndex a loose caller passes.
  const attrs: Record<string, unknown> = { ...rest };
  delete attrs.tabIndex;
  return <span className={["g-chip", size === "sm" && "g-chip--sm", className].filter(Boolean).join(" ")} {...attrs} />;
}
