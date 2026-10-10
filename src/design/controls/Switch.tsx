import type { ButtonHTMLAttributes } from "react";

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role"> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

/** Needs an accessible name: pass aria-label or aria-labelledby. Space and Enter toggle (native button). */
export function Switch({ checked, onCheckedChange, onClick, className, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={["g-sw", className].filter(Boolean).join(" ")}
      onClick={(e) => { onClick?.(e); if (!e.defaultPrevented) onCheckedChange?.(!checked); }}
      {...rest}
    />
  );
}
