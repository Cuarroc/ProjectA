import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { focusableWithin, trapTarget } from "../../lib/useFocusTrap";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  "aria-label": string;
  children?: ReactNode;
}

/** Modal dialog on a scrim: focus moves in, Tab cycles inside, Esc or a scrim click closes, focus returns. */
export function Sheet({ open, onClose, "aria-label": label, children }: SheetProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    (focusableWithin(dialog as HTMLElement)[0] ?? dialog)?.focus();
    return () => before?.focus();
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab") return;
    const dialog = ref.current;
    if (!dialog) return;
    const items = focusableWithin(dialog);
    const target = trapTarget(items, document.activeElement, e.shiftKey);
    if (target) { e.preventDefault(); target.focus(); return; }
    if (items.length === 0) { e.preventDefault(); dialog.focus(); }
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
