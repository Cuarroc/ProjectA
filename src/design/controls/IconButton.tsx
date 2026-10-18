import type { ReactNode } from "react";

import { Button, type ButtonProps } from "./Button";

export interface IconButtonProps extends Omit<ButtonProps, "aria-label" | "children"> {
  /** The only text a screen reader gets, so it is required. */
  "aria-label": string;
  children: ReactNode;
}

export function IconButton({ variant = "ghost", className, ...rest }: IconButtonProps) {
  return <Button variant={variant} className={["g-btn--icon", className].filter(Boolean).join(" ")} {...rest} />;
}
