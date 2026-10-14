import type { ButtonHTMLAttributes } from "react";

export interface FilterChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  pressed: boolean;
  /** Shown after the label when finite. 0 stays visible; NaN and infinities are omitted. */
  count?: number;
  onPressedChange?: (pressed: boolean) => void;
}

export function FilterChip({ pressed, count, onPressedChange, onClick, className, children, ...rest }: FilterChipProps) {
  // After rest: pressed alone decides aria-pressed.
  return (
    <button
      type="button"
      className={["g-fchip", className].filter(Boolean).join(" ")}
      onClick={(e) => { onClick?.(e); if (!e.defaultPrevented) onPressedChange?.(!pressed); }}
      {...rest}
      aria-pressed={pressed}
    >
      {children}
      {typeof count === "number" && Number.isFinite(count) && <>{" "}<b>{count}</b></>}
    </button>
  );
}
