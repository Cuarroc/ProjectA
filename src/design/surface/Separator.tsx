import type { HTMLAttributes } from "react";
import "./surface.css";

export interface SeparatorProps extends HTMLAttributes<HTMLHRElement> {
  orientation?: "horizontal" | "vertical";
  /** Pure decoration: hidden from assistive tech instead of announced. */
  decorative?: boolean;
}

export function Separator({ orientation = "horizontal", decorative }: SeparatorProps) {
  const className = ["g-sep", orientation === "vertical" && "g-sep--v"].filter(Boolean).join(" ");
  if (decorative) return <hr className={className} role="none" aria-hidden="true" />;
  return <hr className={className} aria-orientation={orientation === "vertical" ? "vertical" : undefined} />;
}
