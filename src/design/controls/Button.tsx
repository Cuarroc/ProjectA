import type { ButtonHTMLAttributes, HTMLAttributes } from "react";

export type ButtonVariant = "secondary" | "primary" | "tint" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = "secondary", size = "md", className, type = "button", ...rest }: ButtonProps) {
  const cls = ["g-btn", variant !== "secondary" && `g-btn--${variant}`, size !== "md" && `g-btn--${size}`, className];
  return <button type={type} className={cls.filter(Boolean).join(" ")} {...rest} />;
}

/** Equal-width cells, one height: every Button in the group takes the same size. */
export function ButtonGroup({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div role="group" className={["g-btn-group", className].filter(Boolean).join(" ")} {...rest} />;
}
