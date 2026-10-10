import { useEffect, useRef } from "react";

export type ToastTone = "info" | "ok" | "bad";

export interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}

function ToastView({ toast, ttl, onDismiss }: { toast: ToastItem; ttl: number; onDismiss: (id: number) => void }) {
  // Keep the latest callback in a ref so a new identity does not restart the countdown.
  const dismiss = useRef(onDismiss);
  useEffect(() => { dismiss.current = onDismiss; });
  useEffect(() => {
    const timer = setTimeout(() => dismiss.current(toast.id), ttl);
    return () => clearTimeout(timer);
  }, [toast.id, ttl]);
  return (
    <div className={`g-toast g-toast--${toast.tone}`} role={toast.tone === "bad" ? "alert" : "status"}>
      <span>{toast.text}</span>
      <button type="button" className="g-toast__x" aria-label="Schließen" onClick={() => onDismiss(toast.id)}>×</button>
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
