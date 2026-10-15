import { describe, expect, it } from "vitest";

import { quotaView, type QuotaViewInput } from "./forecast";

const input = (over: Partial<QuotaViewInput> = {}): QuotaViewInput => ({
  state: "ok",
  fiveHourPct: null,
  sevenDayPct: null,
  fallbackName: null,
  ...over,
});

describe("quotaView", () => {
  it("does not treat a missing window as zero percent", () => {
    const view = quotaView(input());
    expect(view.percent).toBeNull();
    expect(view.percent).not.toBe(0);
    expect(view.window).toBeNull();
  });

  it("names the window of the only measured percent and the tighter one of two", () => {
    expect(quotaView(input({ sevenDayPct: 40 }))).toMatchObject({ percent: 40, window: "7d" });
    expect(quotaView(input({ fiveHourPct: 0 }))).toMatchObject({ percent: 0, window: "5h" });
    expect(quotaView(input({ fiveHourPct: 30, sevenDayPct: 80 }))).toMatchObject({ percent: 80, window: "7d" });
    expect(quotaView(input({ fiveHourPct: 90, sevenDayPct: 80 }))).toMatchObject({ percent: 90, window: "5h" });
  });

  it("always answers the forecast with the honest sentence", () => {
    expect(quotaView(input({ fiveHourPct: 95 })).forecast).toBe("zu wenig Daten");
    expect(quotaView(input()).forecast).toBe("zu wenig Daten");
  });

  it("names the profile fallback only while the quota is blocked", () => {
    expect(quotaView(input({ state: "blocked", fallbackName: "Lokal" })).failoverName).toBe("Lokal");
    expect(quotaView(input({ state: "ok", fallbackName: "Lokal" })).failoverName).toBeNull();
    expect(quotaView(input({ state: "unknown", fallbackName: "Lokal" })).failoverName).toBeNull();
    expect(quotaView(input({ state: null, fallbackName: "Lokal" })).failoverName).toBeNull();
    expect(quotaView(input({ state: "blocked", fallbackName: "" })).failoverName).toBeNull();
    expect(quotaView(input({ state: "blocked", fallbackName: null })).failoverName).toBeNull();
  });
});
