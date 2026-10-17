import type { InputHTMLAttributes, ReactNode } from "react";

export interface SwitchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role" | "checked" | "onChange" | "children"> {
  label: ReactNode;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export function SwitchField(_props: SwitchFieldProps) {
  return null;
}
