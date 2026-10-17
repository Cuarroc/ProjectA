import "./surface.css";

export interface SeparatorProps {
  orientation?: "horizontal" | "vertical";
  /** Pure decoration: hidden from assistive tech instead of announced. */
  decorative?: boolean;
}

export function Separator({ orientation = "horizontal", decorative }: SeparatorProps) {
  const className = `g-sep g-sep--${orientation === "vertical" ? "v" : "h"}`;
  if (decorative) return <hr className={className} role="none" aria-hidden="true" />;
  return <hr className={className} aria-orientation={orientation === "vertical" ? "vertical" : undefined} />;
}
