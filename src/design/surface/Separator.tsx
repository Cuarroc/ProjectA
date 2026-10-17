import type { HTMLAttributes } from "react";
import "./surface.css";

export interface SeparatorProps extends HTMLAttributes<HTMLHRElement> {
  orientation?: "horizontal" | "vertical";
  /** Pure decoration: hidden from assistive tech instead of announced. */
  decorative?: boolean;
}

export function Separator({ orientation = "horizontal", decorative, className, ...rest }: SeparatorProps) {
  const cls = ["g-sep", orientation === "vertical" && "g-sep--v", className].filter(Boolean).join(" ");
  if (decorative) return <hr {...rest} className={cls} role="none" aria-hidden="true" />;
  return <hr aria-orientation={orientation === "vertical" ? "vertical" : undefined} {...rest} className={cls} />;
}
