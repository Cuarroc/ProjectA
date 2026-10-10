import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  "aria-label": string;
  children?: ReactNode;
}

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Modal dialog on a scrim: focus moves in, Tab cycles inside, Esc or a scrim click closes, focus returns. */
export function Sheet({ open, onClose, "aria-label": label, children }: SheetProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    (ref.current?.querySelector<HTMLElement>(FOCUSABLE) ?? ref.current)?.focus();
    return () => before?.focus();
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab") return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const [first, last, active] = [items[0], items[items.length - 1], document.activeElement];
    if (!first || active === ref.current || (e.shiftKey && active === first)) {
      e.preventDefault();
      (e.shiftKey ? last : first)?.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="g-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className="g-sheet" onKeyDown={onKeyDown}>
        {children}
      </section>
    </div>,
    document.body,
  );
}
