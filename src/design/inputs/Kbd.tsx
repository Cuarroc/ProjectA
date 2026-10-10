import type { HTMLAttributes } from "react";

/** A key hint such as Ctrl K. Static text, never focusable. */
export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <kbd className={["g-kbd", className].filter(Boolean).join(" ")} {...rest} />;
}
