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

export function quotaView(input: QuotaViewInput): QuotaView {
  return {
    percent: input.fiveHourPct ?? input.sevenDayPct ?? 0,
    window: "5h",
    forecast: T.tooLittleData,
    failoverName: input.fallbackName,
  };
}
