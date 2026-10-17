import type { ButtonHTMLAttributes } from "react";
import "./surface.css";

export interface ListRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The caller's "this is the open one". For a listbox pass role="option" and aria-selected instead. */
  current?: boolean;
}

/** Selectable row: one native button, so one tab stop and Enter/Space activation.
    It never decides what is selected; the caller supplies it. */
export function ListRow({ current, className, ...rest }: ListRowProps) {
  return (
    <button
      type="button"
      className={["g-row", className].filter(Boolean).join(" ")}
      aria-current={current ? "true" : undefined}
      {...rest}
    />
  );
}
