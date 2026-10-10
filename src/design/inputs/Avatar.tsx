import type { HTMLAttributes } from "react";

export type AvatarTone = "owner" | "lead" | "sys" | 1 | 2 | 3 | 4 | 5 | 6;

export interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  initials: string;
  size?: "sm" | "md" | "lg";
  tone?: AvatarTone;
  /** Accessible name. Without it the avatar is decorative: put the name next to it. */
  label?: string;
}

export function Avatar({ initials, size = "md", tone, label, className, ...rest }: AvatarProps) {
  const toneCls = tone === undefined ? undefined : typeof tone === "number" ? `g-ava--c${tone}` : `g-ava--${tone}`;
  const cls = ["g-ava", size !== "md" && `g-ava--${size}`, toneCls, className];
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return <span className={cls.filter(Boolean).join(" ")} {...a11y} {...rest}>{initials}</span>;
}
