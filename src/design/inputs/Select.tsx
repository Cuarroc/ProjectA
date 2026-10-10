import type { SelectHTMLAttributes } from "react";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** 36px instead of 40px. */
  compact?: boolean;
}

/** The native select keeps keyboard, typeahead and the platform list; only the paint is ours. Needs an accessible name. */
export function Select({ compact, className, children, ...rest }: SelectProps) {
  return (
    <span className="g-selw">
      <select className={["g-inp", compact && "g-inp--sm", className].filter(Boolean).join(" ")} {...rest}>
        {children}
      </select>
      <svg className="g-selw__ic" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
        <path d="m5 8 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
