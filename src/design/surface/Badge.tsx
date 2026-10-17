import type { HTMLAttributes } from "react";

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "tabIndex"> {
  count?: number;
  tone?: "neutral" | "accent";
}

export function Badge(_props: BadgeProps) {
  return <span />;
}
