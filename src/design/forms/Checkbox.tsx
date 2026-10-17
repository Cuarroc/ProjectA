import type { ReactNode } from "react";

export type CheckboxState = boolean | "mixed";

export interface CheckboxProps {
  label: ReactNode;
  checked: CheckboxState;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
}

export function Checkbox(_props: CheckboxProps) {
  return null;
}
