import type { ReactNode } from "react";

export interface RadioOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface RadioGroupProps<T extends string> {
  options: readonly RadioOption<T>[];
  value: T;
  onChange: (value: T) => void;
  "aria-label": string;
}

export function RadioGroup<T extends string>(_props: RadioGroupProps<T>) {
  return null;
}
