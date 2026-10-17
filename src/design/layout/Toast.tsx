import { useEffect, useRef, useState } from "react";
import { de } from "../../i18n/de";
import { useExitTransition } from "../motion/useExitTransition";

export type ToastTone = "info" | "ok" | "bad";

export interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}

function ToastView({ toast, ttl, onDismiss }: { toast: ToastItem; ttl: number; onDismiss: (id: number) => void }) {
  // Keep the latest callback in a ref so a new identity does not restart the countdown.
  const dismiss = useRef(onDismiss);
  // `open` only starts the exit; onDismiss fires once the exit is over, so the parent removes the toast after it animated out.
  const [open, setOpen] = useState(true);
  const { mounted, closing } = useExitTransition(open);
  useEffect(() => { dismiss.current = onDismiss; });
  useEffect(() => {
    const handle = setTimeout(() => setOpen(false), ttl);
    return () => clearTimeout(handle);
  }, [toast.id, ttl]);
  useEffect(() => { if (!mounted) dismiss.current(toast.id); }, [mounted, toast.id]);
  if (!mounted) return null;
  return (
    <div className={`g-toast g-toast--${toast.tone}`} data-state={closing ? "closing" : "open"} aria-hidden={closing || undefined} role={toast.tone === "bad" ? "alert" : "status"}>
      <span>{toast.text}</span>
      <button type="button" className="g-toast__x" aria-label={de["action.close"]} onClick={() => setOpen(false)}>×</button>
    </div>
  );
}

/** Live region for toasts; each one closes itself after `ttl` ms (default 6 s). */
export function ToastRegion({ toasts, onDismiss, ttl = 6000 }: { toasts: readonly ToastItem[]; onDismiss: (id: number) => void; ttl?: number }) {
  return (
    <div className="g-toasts" aria-live="polite">
      {toasts.map((t) => <ToastView key={t.id} toast={t} ttl={ttl} onDismiss={onDismiss} />)}
    </div>
  );
}
