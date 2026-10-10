import type { Provider } from "../../types";
import { T } from "./texts";

export type WindowSlot = "five" | "week" | "month";
export const SLOTS: readonly WindowSlot[] = ["five", "week", "month"];

/**
 * The slot a core window label belongs to, or `null` for a label we do not
 * know (e.g. a daily window). The core sends one window per provider today, so
 * the others stay unmapped rather than guessed.
 */
export function windowSlot(label: string): WindowSlot | null {
  if (/5[- ]?(stunden|h)/i.test(label)) return "five";
  if (/7[- ]?tage|woche/i.test(label)) return "week";
  if (/monat/i.test(label)) return "month";
  return null;
}

export interface WindowRow {
  key: string;
  label: string;
  /** 0..100, or `null` for a window that is not connected or has no percentage. */
  percent: number | null;
  resetsAt: number | null;
}

/** Always the three slots, plus the provider's own window when it matches none. */
export function windowRows(provider: Provider): WindowRow[] {
  const usage = provider.usage;
  const slot = usage ? windowSlot(usage.windowLabel) : null;
  const rows: WindowRow[] = SLOTS.map((s) => ({
    key: s,
    label: T[s],
    percent: usage && slot === s ? usage.percent : null,
    resetsAt: usage && slot === s ? usage.resetsAt : null,
  }));
  if (usage && slot === null) {
    rows.push({ key: "other", label: usage.windowLabel, percent: usage.percent, resetsAt: usage.resetsAt });
  }
  return rows;
}

/** Whether the row carries a measurement; `false` renders the honest placeholder. */
export const isMeasured = (row: WindowRow): row is WindowRow & { percent: number } => row.percent !== null;
