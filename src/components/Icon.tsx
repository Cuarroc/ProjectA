import type { SVGProps } from "react";

/** Contract set for V161-UI-I1 — hand-drawn stroke glyphs, viewBox 16. */
export const ICON_NAMES = [
  "rail",
  "split",
  "expand",
  "refresh",
  "gear",
  "close",
  "chevronLeft",
  "chevronRight",
  "chevronDown",
  "chevronUp",
  "plug",
  "external",
  "check",
  "more",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const PATHS: Record<IconName, string> = {
  rail: "M2.5 3.5h11M2.5 8h11M2.5 12.5h11M5.5 3.5v9",
  split: "M2.5 2.5h4.5v4.5H2.5zM9 9h4.5v4.5H9zM8 3.5h4.5v4.5M3.5 8v4.5h4.5",
  expand: "M9.5 2.5H13.5V6.5M6.5 13.5H2.5V9.5M13.5 2.5L9 7M2.5 13.5L7 9",
  refresh: "M13 8a5 5 0 1 1-1.2-3.3M13 2.5v3.5h-3.5",
  gear: "M8 10.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5zM8 2.5v1.5M8 12v1.5M3.4 4.6l1.1 1.1M11.5 10.3l1.1 1.1M2.5 8h1.5M12 8h1.5M3.4 11.4l1.1-1.1M11.5 5.7l1.1-1.1",
  close: "M4 4l8 8M12 4l-8 8",
  chevronLeft: "M10 3.5L5.5 8 10 12.5",
  chevronRight: "M6 3.5L10.5 8 6 12.5",
  chevronDown: "M3.5 6L8 10.5 12.5 6",
  chevronUp: "M3.5 10L8 5.5 12.5 10",
  plug: "M6 2.5v3M10 2.5v3M4.5 5.5h7v3.5a3.5 3.5 0 0 1-7 0zM8 12.5v1.5",
  external: "M7 3.5H3.5V12.5H12.5V9M9 3.5h3.5V7M12.5 3.5L7.5 8.5",
  check: "M3.5 8.5l3 3 6-7",
  more: "M4 8h.01M8 8h.01M12 8h.01",
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children" | "name"> {
  name: IconName;
  /** Pixel size; default 16 matches the viewBox. */
  size?: number;
}

/** Inline SVG icon. Decorative by default — name the control, not the glyph. */
export default function Icon({ name, size = 16, className, style, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", flexShrink: 0, ...style }}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
