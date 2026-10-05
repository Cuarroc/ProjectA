import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as ipc from "./ipc";
import {
  formatProviderObservedAt,
  formatProviderResetsAt,
  freeTierRemainingText,
  isRoutedProfile,
  isUsageStale,
  overviewVaultError,
  providerDetailText,
  providerKindLabel,
  providerQuotaLabel,
  providerUsageFillClass,
  routedProfilesForProvider,
  useFreeTierSummary,
  useProviderKey,
  useProviderOverview,
  vaultErrorText,
} from "./providers";
import type { AgentProfile, FreeTierPool, FreeTierSummary, Provider, ProviderUsage } from "../types";

vi.mock("./ipc", () => ({
  describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  deleteProviderKey: vi.fn(),
  getFreeTierSummary: vi.fn(),
  getProviderOverview: vi.fn(),
  hasProviderKey: vi.fn(),
  setProviderKey: vi.fn(),
}));

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "openrouter",
    name: "OpenRouter",
    kind: "api_key",
    connected: false,
    detail: null,
    quotaState: "unknown",
    blockedUntil: null,
    omniRouteOnline: false,
    usage: null,
    vaultError: null,
    ...overrides,
  };
}

describe("overviewVaultError", () => {
  it("is null when no row carries a vault error", () => {
    expect(overviewVaultError([])).toBeNull();
    expect(overviewVaultError([provider(), provider({ id: "kimi" })])).toBeNull();
  });

  it("returns the error the core repeats on every row", () => {
    const error = "vault_corrupt: damaged";
    const rows = [provider({ vaultError: error }), provider({ id: "kimi", vaultError: error })];
    expect(overviewVaultError(rows)).toBe(error);
  });

  it("skips rows that carry nothing and finds the one that does", () => {
    const rows = [provider(), provider({ id: "kimi", vaultError: "vault_unreadable: denied" })];
    expect(overviewVaultError(rows)).toBe("vault_unreadable: denied");
  });
});

describe("vaultErrorText", () => {
  it("explains each known code in German without echoing the raw detail", () => {
    expect(vaultErrorText("vault_corrupt: line 1 column 2")).toContain("beschädigt");
    expect(vaultErrorText("vault_decrypt_failed: os error 13")).toContain("Windows-Konto");
    expect(vaultErrorText("vault_unreadable: permission denied")).toContain("nicht gelesen");
    // The raw English detail stays in the tooltip, not the banner text.
    expect(vaultErrorText("vault_corrupt: line 1 column 2")).not.toContain("column 2");
  });

  it("passes an unknown error through verbatim instead of relabeling it", () => {
    expect(vaultErrorText("vault_future_kind: something new")).toBe("vault_future_kind: something new");
  });
});

describe("labels", () => {
  it("translates kinds and quota states, passing unknown values through", () => {
    expect(providerKindLabel("subscription")).toBe("Abo");
    expect(providerKindLabel("api_key")).toBe("API-Key");
    expect(providerKindLabel("local")).toBe("Lokal");
    expect(providerKindLabel("future" as Provider["kind"])).toBe("future");
    expect(providerQuotaLabel("ok")).toBe("OK");
    expect(providerQuotaLabel("blocked")).toBe("Blockiert");
    expect(providerQuotaLabel("unknown")).toBe("Unbekannt");
    expect(providerQuotaLabel("odd" as Provider["quotaState"])).toBe("odd");
  });

  it("picks the usage bar class at the 80 and 95 percent thresholds", () => {
    expect(providerUsageFillClass(null)).toBe("");
    expect(providerUsageFillClass(79.9)).toBe("");
    expect(providerUsageFillClass(80)).toBe("provider-usage-fill-high");
    expect(providerUsageFillClass(94)).toBe("provider-usage-fill-high");
    expect(providerUsageFillClass(95)).toBe("provider-usage-fill-critical");
  });
});

describe("time-dependent formatting", () => {
  const NOW = new Date(2026, 9, 2, 12, 0, 0);
  const unix = (date: Date) => Math.floor(date.getTime() / 1000);
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formatProviderResetsAt covers unknown, past and each unit", () => {
    const at = (seconds: number) => unix(NOW) + seconds;
    expect(formatProviderResetsAt(null)).toBeNull();
    expect(formatProviderResetsAt(Number.NaN)).toBeNull();
    expect(formatProviderResetsAt(at(-1))).toBe("Reset fällig");
    expect(formatProviderResetsAt(at(20))).toBe("Reset in 20 s");
    expect(formatProviderResetsAt(at(15 * 60))).toBe("Reset in 15 min");
    expect(formatProviderResetsAt(at(2 * 3600))).toBe("Reset in 2 h");
    expect(formatProviderResetsAt(at(2 * 3600 + 30 * 60))).toBe("Reset in 2 h 30 min");
    expect(formatProviderResetsAt(at(3 * 86400))).toBe("Reset in 3 T.");
  });

  it("isUsageStale flips after five minutes", () => {
    const usage = (age: number): ProviderUsage => ({
      percent: null,
      used: null,
      limit: null,
      windowLabel: "w",
      source: "api",
      resetsAt: null,
      observedAt: unix(NOW) - age,
    });
    expect(isUsageStale(usage(299))).toBe(false);
    expect(isUsageStale(usage(301))).toBe(true);
  });

  it("formatProviderObservedAt shows the time today, date and time otherwise", () => {
    const earlier = new Date(2026, 9, 2, 8, 15, 0);
    const older = new Date(2026, 7, 27, 8, 15, 0);
    const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    expect(formatProviderObservedAt(unix(earlier))).toBe(time(earlier));
    const text = formatProviderObservedAt(unix(older));
    expect(text).toContain(time(older));
    expect(text).toContain(older.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" }));
    expect(formatProviderObservedAt(Number.NaN)).toBe("unbekannt");
  });

  it("providerDetailText combines detail and block time only while blocked and still in the future", () => {
    const future = unix(new Date(2026, 9, 2, 18, 30, 0));
    const past = unix(NOW) - 600;
    expect(providerDetailText(provider())).toBeNull();
    expect(providerDetailText(provider({ detail: "Pro" }))).toBe("Pro");
    expect(providerDetailText(provider({ quotaState: "ok", blockedUntil: future }))).toBeNull();
    expect(providerDetailText(provider({ quotaState: "blocked", blockedUntil: future }))).toMatch(/^Frei \S+/);
    expect(
      providerDetailText(provider({ quotaState: "blocked", detail: "Pro", blockedUntil: future })),
    ).toMatch(/^Pro — frei \S+/);
    expect(providerDetailText(provider({ quotaState: "blocked", detail: "Pro", blockedUntil: past }))).toBe("Pro");
    expect(providerDetailText(provider({ quotaState: "blocked", blockedUntil: past }))).toBeNull();
  });
});

describe("routing helpers", () => {
  const profile = (id: string, env: Record<string, string> = {}): AgentProfile =>
    ({ id, name: id, command: id, args: [], env }) as unknown as AgentProfile;

  it("treats a profile as routed only when a base URL is set and non-blank", () => {
    expect(isRoutedProfile(profile("a"))).toBe(false);
    expect(isRoutedProfile(profile("a", { ANTHROPIC_BASE_URL: "  " }))).toBe(false);
    expect(isRoutedProfile(profile("a", { ANTHROPIC_BASE_URL: "http://x" }))).toBe(true);
    expect(isRoutedProfile(profile("a", { OMNIROUTE_BASE_URL: "http://x" }))).toBe(true);
    expect(isRoutedProfile({ ...profile("a"), env: undefined } as unknown as AgentProfile)).toBe(false);
  });

  it("matches routed profiles by id or dash-suffixed variant, not by bare prefix", () => {
    const env = { OMNIROUTE_BASE_URL: "http://x" };
    const all = [
      profile("claude", env),
      profile("claude-omni", env),
      profile("claudeomni", env),
      profile("claude-plain"),
      profile("codex", env),
    ];
    expect(routedProfilesForProvider("claude", all).map((p) => p.id)).toEqual(["claude", "claude-omni"]);
  });

  it("freeTierRemainingText only states what the core reported", () => {
    const pool = (o: Partial<FreeTierPool>): FreeTierPool => ({
      provider: "groq",
      label: "Groq",
      remaining: null,
      limit: null,
      remainingPercent: null,
      resetsAt: null,
      tosStatus: null,
      whitelisted: false,
      ...o,
    });
    expect(freeTierRemainingText(pool({}))).toBeNull();
    expect(freeTierRemainingText(pool({ remaining: 5, limit: 10 }))).toBe(
      `${(5).toLocaleString()} / ${(10).toLocaleString()}`,
    );
    expect(freeTierRemainingText(pool({ remaining: 0 }))).toBe("0 frei");
    expect(freeTierRemainingText(pool({ remainingPercent: 40 }))).toBe("40 % frei");
    expect(freeTierRemainingText(pool({ limit: 10 }))).toBeNull();
  });
});

describe("hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("useProviderOverview exposes the vault error and surfaces failures", async () => {
    vi.mocked(ipc.getProviderOverview).mockResolvedValueOnce([provider({ vaultError: "vault_corrupt: x" })]);
    const ok = renderHook(() => useProviderOverview());
    await waitFor(() => expect(ok.result.current.loading).toBe(false));
    expect(ok.result.current.vaultError).toBe("vault_corrupt: x");

    vi.mocked(ipc.getProviderOverview).mockRejectedValueOnce(new Error("core gone"));
    const bad = renderHook(() => useProviderOverview());
    await waitFor(() => expect(bad.result.current.error).toBe("core gone"));
    expect(bad.result.current.vaultError).toBeNull();
  });

  it("useProviderOverview keeps the last good rows and reports a non-array payload", async () => {
    vi.mocked(ipc.getProviderOverview).mockResolvedValueOnce([provider({ connected: true })]);
    const view = renderHook(() => useProviderOverview());
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    vi.mocked(ipc.getProviderOverview).mockResolvedValueOnce({ unexpected: true } as unknown as Provider[]);
    await act(async () => {
      await view.result.current.refresh();
    });
    expect(view.result.current.providers).toHaveLength(1);
    expect(view.result.current.error).toBe("Unerwartete Antwort der Anbieter-Übersicht.");
  });

  it("useProviderKey saves a trimmed key, ignores blanks and reports errors", async () => {
    vi.mocked(ipc.hasProviderKey).mockResolvedValue(false);
    vi.mocked(ipc.setProviderKey).mockResolvedValue(undefined);
    const { result } = renderHook(() => useProviderKey("kimi"));
    await waitFor(() => expect(ipc.hasProviderKey).toHaveBeenCalled());

    await act(async () => result.current.save("   "));
    expect(ipc.setProviderKey).not.toHaveBeenCalled();

    await act(async () => result.current.save("  sk-1  "));
    expect(ipc.setProviderKey).toHaveBeenCalledWith("kimi", "sk-1");
    expect(result.current.present).toBe(true);
    expect(result.current.busy).toBe(false);

    vi.mocked(ipc.deleteProviderKey).mockRejectedValueOnce(new Error("locked"));
    await act(async () => result.current.remove());
    expect(result.current.error).toBe("locked");
    expect(result.current.present).toBe(true);

    vi.mocked(ipc.deleteProviderKey).mockResolvedValueOnce(undefined);
    await act(async () => result.current.remove());
    expect(result.current.present).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("useProviderKey reports a failed save without marking the key present", async () => {
    vi.mocked(ipc.hasProviderKey).mockResolvedValue(false);
    vi.mocked(ipc.setProviderKey).mockRejectedValue(new Error("vault locked"));
    const { result } = renderHook(() => useProviderKey("kimi"));
    await waitFor(() => expect(ipc.hasProviderKey).toHaveBeenCalled());
    await act(async () => result.current.save("k"));
    expect(result.current.error).toBe("vault locked");
    expect(result.current.present).toBe(false);
  });

  it("useProviderKey ignores a late presence response for the previous provider", async () => {
    let resolveOld: (value: boolean) => void = () => undefined;
    const oldProvider = new Promise<boolean>((resolve) => {
      resolveOld = resolve;
    });
    vi.mocked(ipc.hasProviderKey).mockImplementation((providerId) =>
      providerId === "old" ? oldProvider : Promise.resolve(false),
    );
    const { result, rerender } = renderHook(
      ({ providerId }) => useProviderKey(providerId),
      { initialProps: { providerId: "old" } },
    );
    rerender({ providerId: "new" });
    await waitFor(() => expect(ipc.hasProviderKey).toHaveBeenCalledWith("new"));
    await act(async () => resolveOld(true));
    expect(result.current.present).toBe(false);
  });

  it("useFreeTierSummary keeps an unavailable summary as data and a failure as an error", async () => {
    vi.mocked(ipc.getFreeTierSummary).mockResolvedValueOnce({
      available: false,
      reason: "router off",
      pools: [],
    } as unknown as FreeTierSummary);
    const ok = renderHook(() => useFreeTierSummary());
    await waitFor(() => expect(ok.result.current.loading).toBe(false));
    expect(ok.result.current.summary?.available).toBe(false);
    expect(ok.result.current.error).toBeNull();

    vi.mocked(ipc.getFreeTierSummary).mockRejectedValueOnce(new Error("ipc down"));
    const bad = renderHook(() => useFreeTierSummary());
    await waitFor(() => expect(bad.result.current.error).toBe("ipc down"));
    expect(bad.result.current.summary).toBeNull();
  });
});
