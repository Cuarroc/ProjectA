import { useCallback, useRef, useState, type ReactNode } from "react";

import { ToastRegion, type ToastItem } from "./Toast";

export const MAX_VISIBLE_TOASTS = 3;

export type ToastInput = Omit<ToastItem, "id" | "tone" | "closing"> & { tone?: ToastItem["tone"] };

/** Toast queue: `push` returns an id, `dismiss(id)` lets that toast leave, at most 3 show, the rest wait. Render `region` once. */
export function useToast(ttl?: number): { push: (toast: ToastInput) => number; dismiss: (id: number) => void; region: ReactNode } {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const push = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    setItems((list) => [...list, { tone: "info", ...toast, id }]);
    return id;
  }, []);
  const remove = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const dismiss = useCallback((id: number) => setItems((list) => {
    const at = list.findIndex((t) => t.id === id);
    if (at < 0) return list;
    // A waiting toast has no view to play an exit, so it just leaves the queue.
    if (at >= MAX_VISIBLE_TOASTS) return list.filter((t) => t.id !== id);
    return list.map((t) => (t.id === id ? { ...t, closing: true } : t));
  }), []);
  return { push, dismiss, region: <ToastRegion toasts={items.slice(0, MAX_VISIBLE_TOASTS)} onDismiss={remove} ttl={ttl} /> };
}
