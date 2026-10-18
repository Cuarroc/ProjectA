import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import "./layout.css";
import { useFlip } from "./useFlip";

export interface TooltipTriggerProps {
  "aria-describedby"?: string;
}

export interface TooltipProps {
  content: string;
  /** Renders the trigger; spread the props onto it. */
  children: (props: TooltipTriggerProps) => ReactNode;
}

/** Hover waits this long; read from the duration token so the pace stays in motion.css.
 *  shortcut: the token must be in ms and is read per hover, so a missing token means no delay; upgrade if the token moves to seconds. */
function hoverDelay(): number {
  const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--g-dur-4"));
  return ms > 0 ? ms : 0;
}

/** Short text for a control: keyboard focus opens it at once, hover after the delay; Esc, blur and leaving close it. The bubble never animates, so motion settings do not matter. */
export function Tooltip({ content, children }: TooltipProps) {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const timer = useRef<number>();
  const [open, setOpen] = useState(false);
  const side = useFlip(open, root, bubble);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = (wait: number) => {
    window.clearTimeout(timer.current);
    if (wait > 0) timer.current = window.setTimeout(() => setOpen(true), wait);
    else setOpen(true);
  };
  const hide = () => { window.clearTimeout(timer.current); setOpen(false); };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !open) return;
    e.stopPropagation();
    hide();
  };

  return (
    <span
      ref={root} className="g-tip" onKeyDown={onKeyDown}
      onFocus={() => show(0)} onBlur={hide} onMouseEnter={() => show(hoverDelay())} onMouseLeave={hide}
    >
      {children({ "aria-describedby": open ? id : undefined })}
      {open ? <span ref={bubble} id={id} role="tooltip" className="g-tip__bubble" data-side={side}>{content}</span> : null}
    </span>
  );
}
