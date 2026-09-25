import { describe, expect, it } from "vitest";
import type { Provider } from "../types";
import { projectCapacity, SUBSCRIPTION_BINDINGS } from "./hqCapacity";

const now = 1_800_000_000;

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "claude",
    name: "Claude",
    kind: "subscription",
    connected: true,
    detail: null,
    quotaState: "ok",
    blockedUntil: null,
    omniRouteOnline: false,
    usage: null,
    vaultError: null,
    ...overrides,
  };
}

function project(providers: Provider[] = [provider()], verified = false) {
  return projectCapacity({
    bindings: verified ? SUBSCRIPTION_BINDINGS.map((binding) =>
      ({ ...binding, billingEvidence: `attested:${binding.id}` })) : SUBSCRIPTION_BINDINGS,
    providers,
    quotas: [],
    budgets: [],
    now,
    staleAfterSeconds: 3_600,
  });
}

describe("provider-separated HQ capacity", () => {
  it("keeps five declared subscriptions separate and missing observations unknown", () => {
    const rows = project();
    expect(rows.map(({ label }) => label)).toEqual([
      "Claude Max", "Codex Max", "Kimi Max", "OpenCode Go", "Ollama Pro",
    ]);
    expect(rows.map(({ status }) => status)).toEqual(Array(5).fill("unknown"));
    expect(rows.every(({ usagePercent, source, observedAt }) =>
      usagePercent === null && source === null && observedAt === null)).toBe(true);
  });

  it("needs billing evidence and preserves the measured source and timestamp", () => {
    const row = project([provider({ usage: {
      percent: 42,
      used: "42 of 100",
      limit: "100",
      windowLabel: "5 hours",
      resetsAt: null,
      source: "hook",
      observedAt: now - 60,
    } })], true)[0];
    expect(row).toMatchObject({ status: "available", usagePercent: 42,
      source: "hook", observedAt: now - 60 });
  });

  it("keeps measured provider usage unknown when billing association is unproven", () => {
    const row = project([provider({ usage: {
      percent: 42, used: "42", limit: "100", windowLabel: "5 hours",
      resetsAt: null, source: "hook", observedAt: now,
    } })])[0];
    expect(row).toMatchObject({ status: "unknown", usagePercent: 42,
      source: "hook", billingEvidence: null });
  });

  it("marks old observations stale while preserving their provenance", () => {
    const row = project([provider({ usage: {
      percent: 90, used: null, limit: null, windowLabel: "week",
      resetsAt: null, source: "api", observedAt: now - 3_601,
    } })], true)[0];
    expect(row).toMatchObject({ status: "stale", usagePercent: 90,
      source: "api", observedAt: now - 3_601 });
  });

  it("does not turn heuristic usage into proven subscription availability", () => {
    const row = project([provider({ usage: {
      percent: 20, used: "20", limit: "100", windowLabel: "estimate",
      resetsAt: null, source: "heuristic", observedAt: now,
    } })])[0];
    expect(row).toMatchObject({ status: "unknown", usagePercent: 20,
      source: "heuristic", observedAt: now });
  });

  it("does not mistake a local Ollama daemon for Ollama Pro capacity", () => {
    const ollama = provider({ id: "ollama", kind: "local", usage: {
      percent: 0, used: null, limit: null, windowLabel: "local",
      resetsAt: null, source: "local", observedAt: now,
    } });
    expect(project([ollama])[4]).toMatchObject({
      label: "Ollama Pro", status: "unknown", connected: null,
      usagePercent: null, source: null, observedAt: null,
    });
  });

  it("does not inherit a local daemon's profile block as Ollama Pro quota", () => {
    const row = projectCapacity({ bindings: SUBSCRIPTION_BINDINGS.slice(4),
      providers: [provider({ id: "ollama", kind: "local" })],
      quotas: [{ profileId: "ollama-coder", state: "blocked", blockedUntil: null,
        reason: "local runner unavailable", omniRouteOnline: false }],
      budgets: [], now, staleAfterSeconds: 3_600 })[0];
    expect(row).toMatchObject({ status: "unknown", connected: null, billingEvidence: null });
  });

  it("keeps a disconnected subscription unknown absent a quota block", () => {
    expect(project([provider({ connected: false })])[0]).toMatchObject({
      status: "unknown", connected: false, reason: null,
    });
  });

  it("includes the shipped OpenCode Go profile without assuming its tariff", () => {
    expect(project([])[3].profiles.map(({ profileId }) => profileId))
      .toEqual(["opencode-glm-53-flash"]);
  });

  it("keeps an explicit quota block and profile budget separate", () => {
    const [row] = projectCapacity({
      bindings: SUBSCRIPTION_BINDINGS.slice(0, 1),
      providers: [provider({ quotaState: "blocked", blockedUntil: now + 600 })],
      quotas: [{ profileId: "claude", state: "blocked", blockedUntil: now + 600,
        reason: "limit reached", omniRouteOnline: false }],
      budgets: [{ profileId: "claude", fiveHourPct: 80, sevenDayPct: null }],
      now,
      staleAfterSeconds: 3_600,
    });
    expect(row.status).toBe("blocked");
    expect(row.blockedUntil).toBe(now + 600);
    expect(row.usagePercent).toBeNull();
    expect(row.profiles[0].budget).toEqual({ profileId: "claude", fiveHourPct: 80,
      sevenDayPct: null });
  });
});
