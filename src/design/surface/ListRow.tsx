import type { ButtonHTMLAttributes } from "react";

export interface ListRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  current?: boolean;
}

export function ListRow({ current: _current, ...rest }: ListRowProps) {
  return <div {...(rest as object)} />;
}
