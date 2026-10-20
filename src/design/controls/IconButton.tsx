import type { ReactNode } from "react";

import { t } from "../../i18n/useT";
import { Button, type ButtonProps } from "./Button";

export interface IconButtonProps extends Omit<ButtonProps, "aria-label" | "children"> {
  /** The only text a screen reader gets, so it is required. */
  "aria-label": string;
  children: ReactNode;
}

/** Square Button with only an icon; the label is required by type and, while developing, by a throw. */
export function IconButton({ variant = "ghost", className, ...rest }: IconButtonProps) {
  if (import.meta.env.DEV && !rest["aria-label"]?.trim()) throw new Error(t("design.iconButton.noLabel"));
  return <Button variant={variant} className={["g-btn--icon", className].filter(Boolean).join(" ")} {...rest} />;
}
