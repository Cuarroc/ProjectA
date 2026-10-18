import { useRef, type ReactNode, type RefObject } from "react";

export interface PopoverTriggerProps {
  ref: RefObject<HTMLButtonElement>;
  "aria-expanded": boolean;
  "aria-controls"?: string;
}

export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: (props: PopoverTriggerProps) => ReactNode;
  align?: "start" | "end";
  className?: string;
  panelClassName?: string;
  children?: ReactNode;
}

export function Popover({ open, trigger, children }: PopoverProps) {
  const ref = useRef<HTMLButtonElement>(null);
  return <>{trigger({ ref, "aria-expanded": open })}{open ? <div>{children}</div> : null}</>;
}
