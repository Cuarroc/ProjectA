import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  blockedLabel,
  formatBlockedUntil,
  formatRelativeUntil,
  isBlocked,
  useQuotaState,
} from "./quota";
import * as ipc from "./ipc";
import type { QuotaState } from "../types";

vi.mock("./ipc", () => ({
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  getQuotaState: vi.fn(),
}));

describe("useQuotaState audit regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not report OmniRoute offline before the first response", () => {
    vi.mocked(ipc.getQuotaState).mockReturnValue(new Promise(() => undefined));

    const { result } = renderHook(() => useQuotaState());

    expect(result.current.loading).toBe(true);
    expect(result.current.omniRouteOnline).not.toBe(false);
  });

  it("does not turn a quota read failure into an offline report", async () => {
    vi.mocked(ipc.getQuotaState).mockRejectedValue(new Error("router state unavailable"));

    const { result } = renderHook(() => useQuotaState());
    await waitFor(() => expect(result.current.error).toBe("router state unavailable"));

    expect(result.current.omniRouteOnline).not.toBe(false);
  });
});

describe("quota formatting", () => {
  const NOW = new Date(2026, 9, 2, 12, 0, 0);
  const unix = (date: Date) => Math.floor(date.getTime() / 1000);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const quota = (overrides: Partial<QuotaState> = {}): QuotaState => ({
    profileId: "claude",
    state: "blocked",
    reason: null,
    blockedUntil: null,
    omniRouteOnline: false,
    ...overrides,
  });

  it("formatBlockedUntil returns null for a missing, invalid or already-passed deadline", () => {
    expect(formatBlockedUntil(null)).toBeNull();
    expect(formatBlockedUntil(Number.NaN)).toBeNull();
    expect(formatBlockedUntil(unix(NOW) - 3600)).toBeNull();
    expect(formatBlockedUntil(unix(NOW))).toBeNull();
  });

  it("formatBlockedUntil shows the time only for today and adds the date otherwise", () => {
    const today = new Date(2026, 9, 2, 18, 30, 0);
    const tomorrow = new Date(2026, 9, 3, 9, 5, 0);
    expect(formatBlockedUntil(unix(today))).toBe(
      today.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    );
    const later = formatBlockedUntil(unix(tomorrow));
    expect(later).toContain(
      tomorrow.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" }),
    );
    expect(later).toContain(
      tomorrow.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    );
  });

  it("formatRelativeUntil picks seconds, minutes, hours and days", () => {
    const at = (seconds: number) => unix(NOW) + seconds;
    expect(formatRelativeUntil(null)).toBeNull();
    expect(formatRelativeUntil(Number.NaN)).toBeNull();
    expect(formatRelativeUntil(at(-5))).toBeNull();
    expect(formatRelativeUntil(at(30))).toBe("in 30 s");
    expect(formatRelativeUntil(at(42 * 60))).toBe("in 42 min");
    expect(formatRelativeUntil(at(3 * 3600))).toBe("in 3 h");
    expect(formatRelativeUntil(at(2 * 86400))).toBe("in 2 T.");
  });

  it("isBlocked treats only a blocked state as blocked", () => {
    expect(isBlocked(undefined)).toBe(false);
    expect(isBlocked(quota({ state: "unknown" }))).toBe(false);
    expect(isBlocked(quota({ state: "ok" }))).toBe(false);
    expect(isBlocked(quota())).toBe(true);
  });

  it("blockedLabel falls back to a default reason and omits a lapsed deadline", () => {
    expect(blockedLabel(quota())).toBe("Kontingent erschöpft");
    expect(blockedLabel(quota({ reason: "429", blockedUntil: unix(NOW) - 60 }))).toBe("429");
    const future = unix(new Date(2026, 9, 2, 18, 30, 0));
    expect(blockedLabel(quota({ reason: "429", blockedUntil: future }))).toMatch(/^429 — frei \S+/);
  });
});

describe("useQuotaState polling and aggregation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const entry = (overrides: Partial<QuotaState>): QuotaState => ({
    profileId: "p",
    state: "ok",
    reason: null,
    blockedUntil: null,
    omniRouteOnline: false,
    ...overrides,
  });

  it("indexes profiles, counts blocked ones and reports the route online when any is reachable", async () => {
    vi.mocked(ipc.getQuotaState).mockResolvedValue([
      entry({ profileId: "a", state: "blocked" }),
      entry({ profileId: "b", omniRouteOnline: true }),
    ]);
    const { result } = renderHook(() => useQuotaState());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.blockedCount).toBe(1);
    expect(result.current.byProfile.get("b")?.omniRouteOnline).toBe(true);
    expect(result.current.omniRouteOnline).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("reports offline only after a completed read where no profile is reachable", async () => {
    vi.mocked(ipc.getQuotaState).mockResolvedValue([entry({ profileId: "a" })]);
    const { result } = renderHook(() => useQuotaState());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.omniRouteOnline).toBe(false);
  });

  it("polls on the interval and on window focus, and stops after unmount", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(ipc.getQuotaState).mockResolvedValue([]);
      const { unmount } = renderHook(() => useQuotaState(1000));
      await vi.advanceTimersByTimeAsync(0);
      expect(ipc.getQuotaState).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(ipc.getQuotaState).toHaveBeenCalledTimes(2);
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
      expect(ipc.getQuotaState).toHaveBeenCalledTimes(3);
      unmount();
      await vi.advanceTimersByTimeAsync(5000);
      window.dispatchEvent(new Event("focus"));
      expect(ipc.getQuotaState).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not poll when pollMs is zero", async () => {
    vi.mocked(ipc.getQuotaState).mockResolvedValue([]);
    const { result } = renderHook(() => useQuotaState());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(ipc.getQuotaState).toHaveBeenCalledTimes(1);
  });

  it("drops a late reply after unmount", async () => {
    let resolve!: (value: QuotaState[]) => void;
    vi.mocked(ipc.getQuotaState).mockReturnValue(new Promise((r) => (resolve = r)));
    const { result, unmount } = renderHook(() => useQuotaState());
    unmount();
    resolve([entry({ state: "blocked" })]);
    await Promise.resolve();
    expect(result.current.blockedCount).toBe(0);
    expect(result.current.loading).toBe(true);
  });
});
