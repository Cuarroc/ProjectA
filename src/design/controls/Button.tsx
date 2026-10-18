import type { ButtonHTMLAttributes, HTMLAttributes } from "react";

export type ButtonVariant = "secondary" | "primary" | "tint" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Busy: `aria-busy`, label kept (so the width stays), a second click is swallowed. */
  loading?: boolean;
}

export function Button({ variant = "secondary", size = "md", loading, className, type = "button", onClick, children, ...rest }: ButtonProps) {
  const cls = ["g-btn", variant !== "secondary" && `g-btn--${variant}`, size !== "md" && `g-btn--${size}`, loading && "g-btn--loading", className];
  // Not `disabled`: the button keeps focus while it works; preventDefault also stops a submit.
  const click: ButtonProps["onClick"] = (e) => (loading ? e.preventDefault() : onClick?.(e));
  return (
    <button type={type} className={cls.filter(Boolean).join(" ")} aria-busy={loading || undefined} onClick={click} {...rest}>
      <span className="g-btn__label">{children}</span>
      {loading && <span className="g-btn__busy" aria-hidden="true" />}
    </button>
  );
}

/** Equal-width cells, one height: every Button in the group takes the same size. */
export function ButtonGroup({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={["g-btn-group", className].filter(Boolean).join(" ")} {...rest} role="group" />;
}
