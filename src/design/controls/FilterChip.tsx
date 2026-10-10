import type { ButtonHTMLAttributes } from "react";

export interface FilterChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  pressed: boolean;
  /** Shown after the label; 0 is a real count and stays visible. */
  count?: number;
  onPressedChange?: (pressed: boolean) => void;
}

export function FilterChip({ pressed, count, onPressedChange, onClick, className, children, ...rest }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={["g-fchip", className].filter(Boolean).join(" ")}
      onClick={(e) => { onClick?.(e); if (!e.defaultPrevented) onPressedChange?.(!pressed); }}
      {...rest}
    >
      {children}
      {count !== undefined && <>{" "}<b>{count}</b></>}
    </button>
  );
}
