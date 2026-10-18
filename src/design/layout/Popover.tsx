import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type FocusEvent, type ReactNode, type RefObject } from "react";

import { useExitTransition } from "../motion/useExitTransition";
import "./layout.css";

export interface PopoverTriggerProps {
  ref: RefObject<HTMLButtonElement>;
  "aria-expanded": boolean;
  "aria-controls"?: string;
}

export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Renders the trigger button; spread the props onto it and own its click. */
  trigger: (props: PopoverTriggerProps) => ReactNode;
  /** Which edge of the trigger the panel lines up with. */
  align?: "start" | "end";
  className?: string;
  panelClassName?: string;
  children?: ReactNode;
}

/** Keep in step with `top: calc(100% + 8px)` in layout.css. */
const GAP = 8;

/** Panel next to its trigger: an outside pointerdown, Esc or focus leaving closes it; Esc, and any close with focus inside, return focus to the trigger; it stays mounted (aria-hidden) while it animates out.
 *  shortcut: it flips above once, measured when it opens, so later growth is not re-measured; upgrade if a panel grows a lot after opening. */
export function Popover({ open, onOpenChange, trigger, align = "start", className, panelClassName, children }: PopoverProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const byPointer = useRef(false);
  const returnFocus = useRef(false);
  const [side, setSide] = useState<"top" | "bottom">("bottom");
  const { mounted, closing } = useExitTransition(open);

  useLayoutEffect(() => {
    if (!open || !root.current || !panel.current) return;
    const { top, bottom } = root.current.getBoundingClientRect();
    const need = panel.current.offsetHeight + GAP;
    setSide(bottom + need > window.innerHeight && top - need >= 0 ? "top" : "bottom");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (root.current?.contains(e.target as Node)) return;
      byPointer.current = true;
      onOpenChange(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, onOpenChange]);

  // A close with focus still inside hands it back to the trigger; a click elsewhere keeps the focus it just chose.
  // Read while rendering: with reduced motion the panel is gone by the time effects run, and focus with it.
  if (!open && root.current?.contains(document.activeElement)) returnFocus.current = true;
  useEffect(() => {
    if (open) byPointer.current = false;
    else if (returnFocus.current && !byPointer.current) button.current?.focus();
    returnFocus.current = false;
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !open) return;
    e.stopPropagation();
    button.current?.focus();
    onOpenChange(false);
  };
  const onBlur = (e: FocusEvent) => {
    if (open && e.relatedTarget && !root.current?.contains(e.relatedTarget as Node)) onOpenChange(false);
  };

  return (
    <div ref={root} className={className ? `g-pop ${className}` : "g-pop"} onKeyDown={onKeyDown} onBlur={onBlur}>
      {trigger({ ref: button, "aria-expanded": open, "aria-controls": mounted ? id : undefined })}
      {mounted ? (
        <div
          ref={panel} id={id} className={panelClassName ? `g-pop__panel ${panelClassName}` : "g-pop__panel"}
          data-side={side} data-align={align} data-state={closing ? "closing" : "open"} aria-hidden={closing || undefined}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
