import { formatClock, formatDayMonth } from "../../lib/time";
import type { Provider, QuotaState } from "../../types";
import { initials } from "../leitstand/leitstand";
import { T } from "./texts";

export type WindowSlot = "five" | "week" | "month";
export const SLOTS: readonly WindowSlot[] = ["five", "week", "month"];

/**
 * The slot a core window label belongs to, or `null` for a label we do not
 * know (e.g. a daily window). The core sends one window per provider today, so
 * the others stay unmapped rather than guessed.
 */
export function windowSlot(label: string): WindowSlot | null {
  if (inWords(/5[- ]?(stunden|h)/).test(label)) return "five";
  if (inWords(/(7[- ]?tage|wochen?)/).test(label)) return "week";
  if (inWords(/monat(s|e)?/).test(label)) return "month";
  return null;
}

/** `\b` only knows ASCII letters ("Monatsübersicht" would pass), so bound by Unicode letters and digits. */
const inWords = (pattern: RegExp) => new RegExp(`(?<![\\p{L}\\p{N}_])${pattern.source}(?![\\p{L}\\p{N}_])`, "iu");

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

/**
 * One avatar text per provider, never shared inside the list: word initials
 * ("Claude Code" → "CC"), then growing name prefixes ("Op", "Ope", …) until one
 * is free. Single words never reduce to their first letter alone.
 */
export function providerInitials(providers: readonly Pick<Provider, "id" | "name">[]): Map<string, string> {
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const { id, name } of providers) {
    const letters = name.replace(/[^\p{L}\p{N}]/gu, "");
    const words = initials(name);
    const candidates = [words.length > 1 ? words : "", ...[2, 3, 4].map((n) => letters.slice(0, n)), id.toUpperCase()];
    const pick = candidates.map((c) => c && c[0]!.toUpperCase() + c.slice(1)).find((c) => c && !taken.has(c)) ?? freeVariant(id.toUpperCase(), taken);
    taken.add(pick);
    out.set(id, pick);
  }
  return out;
}

/** Last resort: the upper-case id with a counter, so it stays unique and in the same case style. */
function freeVariant(base: string, taken: ReadonlySet<string>): string {
  let n = 2;
  while (taken.has(`${base}${n}`)) n += 1;
  return `${base}${n}`;
}

/** 24-hour German clock time, with the day and month when it is not today. */
export function formatFreeAt(unixSeconds: number, now: Date = new Date()): string | null {
  const at = new Date(unixSeconds * 1000);
  if (Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) return null;
  const time = formatClock(at);
  if (at.toDateString() === now.toDateString()) return time;
  return `${formatDayMonth(at)} ${time}`;
}

/**
 * The one-line note under a provider's name. It is only set for a blocked
 * provider (the same condition as the lamp), reason plus "frei <time>".
 */
export function blockedNote(provider: Provider, quota: QuotaState | undefined): string | null {
  const quotaBlocked = quota?.state === "blocked";
  if (!quotaBlocked && provider.quotaState !== "blocked") return provider.detail;
  const reason = quotaBlocked ? (quota.reason ?? T.exhausted) : provider.detail;
  const free = formatFreeAt((quotaBlocked ? quota.blockedUntil : null) ?? provider.blockedUntil ?? Number.NaN);
  if (free === null) return reason;
  return reason ? T.reasonFree(reason, free) : T.freeCap(free);
}
