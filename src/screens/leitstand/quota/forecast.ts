import { T } from "./texts";

export type QuotaViewInput = {
  state: "ok" | "blocked" | "unknown" | null;
  fiveHourPct: number | null;
  sevenDayPct: number | null;
  fallbackName: string | null;
};

export type QuotaView = {
  percent: number | null;
  window: "5h" | "7d" | null;
  forecast: typeof T.tooLittleData;
  failoverName: string | null;
};

export function quotaView({ state, fiveHourPct, sevenDayPct, fallbackName }: QuotaViewInput): QuotaView {
  // A missing window stays null: coercing it to 0 would read as "plenty left".
  const tight =
    fiveHourPct !== null && (sevenDayPct === null || fiveHourPct >= sevenDayPct)
      ? { percent: fiveHourPct, window: "5h" as const }
      : sevenDayPct !== null
        ? { percent: sevenDayPct, window: "7d" as const }
        : { percent: null, window: null };
  return {
    ...tight,
    forecast: T.tooLittleData,
    failoverName: state === "blocked" && fallbackName ? fallbackName : null,
  };
}
