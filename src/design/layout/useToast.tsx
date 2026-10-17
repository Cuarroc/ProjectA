import type { ReactNode } from "react";

import type { ToastTone } from "./Toast";

export interface ToastInput { text: string; tone?: ToastTone; action?: { label: string; onAction: () => void } }

// Stub for the red-first commit: compiles, does nothing.
export function useToast(_ttl?: number): { push: (t: ToastInput) => number; dismiss: (id: number) => void; region: ReactNode } {
  return { push: () => 0, dismiss: () => {}, region: null };
}
