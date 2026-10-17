import type { SVGProps } from "react";
import { GLYPHS, type IconName } from "./glyphs";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name" | "children" | "width" | "height"> {
  name: IconName;
  /** Accessible name. Without one the icon is hidden from assistive technology. */
  label?: string;
}

/** Lucide's 24-unit artboard drawn at 20 px. Colour is `currentColor`; name the control, not the glyph, unless it stands alone. */
export function Icon({ name, label, className, style, ...rest }: IconProps) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      className={className}
      style={{ display: "block", flexShrink: 0, ...style }}
      {...rest}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {GLYPHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
