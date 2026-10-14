import type { HTMLAttributes } from "react";

export type AvatarTone = "owner" | "lead" | "sys" | 1 | 2 | 3 | 4 | 5 | 6;

export interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  initials: string;
  size?: "sm" | "md" | "lg";
  tone?: AvatarTone;
  /** Accessible name. Without it the avatar is decorative: put the name next to it. */
  label?: string;
}

/** Known tones keep their class. Anything else draws the plain avatar and invents no class. */
function toneClass(tone: AvatarTone | undefined): string | undefined {
  switch (tone) {
    case "owner":
    case "lead":
    case "sys":
      return `g-ava--${tone}`;
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
      return `g-ava--c${tone}`;
    default:
      return undefined;
  }
}

export function Avatar({ initials, size = "md", tone, label, className, ...rest }: AvatarProps) {
  const toneCls = toneClass(tone);
  const cls = ["g-ava", size !== "md" && `g-ava--${size}`, toneCls, className];
  // Spread after rest: the label alone decides the accessibility, a caller cannot override it.
  const a11y = label
    ? { role: "img", "aria-label": label, "aria-hidden": undefined }
    : { role: undefined, "aria-label": undefined, "aria-hidden": true };
  return <span className={cls.filter(Boolean).join(" ")} {...rest} {...a11y}>{initials}</span>;
}
