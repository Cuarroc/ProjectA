/** Placeholder that still follows the host locale; replaced by the German formatters in the fix commit. */
export function formatClock(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function formatDayMonth(date: Date): string {
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
}
