// Clock times and dates in the app are German: 24-hour "17:05" and "dd.mm.",
// never the host locale (en-US would show "05:05 PM").
const CLOCK = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const DAY_MONTH = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });

/** German 24-hour clock time, e.g. "05:31" or "17:05". */
export function formatClock(date: Date): string {
  return CLOCK.format(date);
}

/** German day and month, e.g. "03.10.". */
export function formatDayMonth(date: Date): string {
  return DAY_MONTH.format(date);
}
