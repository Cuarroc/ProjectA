import type { InputHTMLAttributes, ReactNode } from "react";

import { de } from "../../i18n/de";

export interface SwitchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role" | "checked" | "onChange" | "children"> {
  label: ReactNode;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

/** Native checkbox with role="switch" in one label: the label text and the state word both toggle it; the word is aria-hidden because the role already says on or off. */
export function SwitchField({ label, checked, onCheckedChange, className, ...rest }: SwitchFieldProps) {
  return (
    <label className={["g-swf", className].filter(Boolean).join(" ")}>
      <input
        type="checkbox"
        role="switch"
        className="g-swf__in"
        {...rest}
        checked={checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
      />
      <span className="g-swf__track" aria-hidden="true" />
      <span className="g-swf__text">{label}</span>
      <span className="g-swf__state" aria-hidden="true">{de[checked ? "forms.switch.on" : "forms.switch.off"]}</span>
    </label>
  );
}
