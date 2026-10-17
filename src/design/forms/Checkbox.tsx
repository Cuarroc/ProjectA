import { useLayoutEffect, useRef, type InputHTMLAttributes, type ReactNode } from "react";

export type CheckboxState = boolean | "mixed";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "checked" | "onChange" | "children"> {
  label: ReactNode;
  checked: CheckboxState;
  /** A mixed box becomes checked on the first toggle, like the native control. */
  onCheckedChange?: (checked: boolean) => void;
}

/** Native checkbox: Space, label click and disabled come from the browser; `mixed` is also aria-checked="mixed". */
export function Checkbox({ label, checked, onCheckedChange, className, ...rest }: CheckboxProps) {
  const input = useRef<HTMLInputElement>(null);
  // No deps: a native click clears `indeterminate`, so the prop is applied again after every render.
  useLayoutEffect(() => { if (input.current) input.current.indeterminate = checked === "mixed"; });
  return (
    <label className={["g-cb", className].filter(Boolean).join(" ")}>
      <input
        ref={input}
        type="checkbox"
        className="g-cb__in"
        {...rest}
        checked={checked === true}
        aria-checked={checked === "mixed" ? "mixed" : undefined}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
      />
      <span className="g-cb__box" aria-hidden="true" />
      <span className="g-cb__text">{label}</span>
    </label>
  );
}
