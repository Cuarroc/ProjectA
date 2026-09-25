import type { Budget, Provider, QuotaState } from "../types";

/** User-declared subscription labels; these bindings are not proof of billing or login. */
export interface CapacityBinding {
  id: string;
  label: string;
  providerId: string;
  profileIds: string[];
  /** Collector-attested billing association; a user-entered tariff name is insufficient. */
  billingEvidence?: string | null;
}

export const SUBSCRIPTION_BINDINGS: readonly CapacityBinding[] = [
  { id: "claude-max", label: "Claude Max", providerId: "claude", profileIds: ["claude"] },
  { id: "codex-max", label: "Codex Max", providerId: "codex", profileIds: ["codex"] },
  { id: "kimi-max", label: "Kimi Max", providerId: "kimi", profileIds: ["kimi"] },
  { id: "opencode-go", label: "OpenCode Go", providerId: "opencode", profileIds: ["opencode-glm-53-flash"] },
  { id: "ollama-pro", label: "Ollama Pro", providerId: "ollama", profileIds: ["ollama-coder"] },
];

export type CapacityStatus = "available" | "blocked" | "stale" | "unknown";

export interface CapacityProfile {
  profileId: string;
  quota: QuotaState | null;
  /** Configured ceilings, not measured subscription consumption. */
  budget: Budget | null;
}

export interface CapacityRow {
  id: string;
  label: string;
  providerId: string;
  status: CapacityStatus;
  connected: boolean | null;
  usagePercent: number | null;
  source: string | null;
  observedAt: number | null;
  blockedUntil: number | null;
  reason: string | null;
  billingEvidence: string | null;
  profiles: CapacityProfile[];
}

export interface CapacityInput {
  bindings: readonly CapacityBinding[];
  providers: readonly Provider[];
  quotas: readonly QuotaState[];
  budgets: readonly Budget[];
  /** Unix seconds. */
  now: number;
  /** Maximum age of a provider usage observation, in seconds. */
  staleAfterSeconds: number;
}

/** Pure view projection. It never pools balances or infers an account's tariff. */
export function projectCapacity(input: CapacityInput): CapacityRow[] {
  const providers = new Map(input.providers.map((provider) => [provider.id, provider]));
  const quotas = new Map(input.quotas.map((quota) => [quota.profileId, quota]));
  const budgets = new Map(input.budgets.map((budget) => [budget.profileId, budget]));

  return input.bindings.map((binding) => {
    // A local daemon or API-key connection cannot establish subscription capacity.
    const candidate = providers.get(binding.providerId);
    const provider = candidate?.kind === "subscription" ? candidate : undefined;
    const profiles = binding.profileIds.map((profileId) => ({
      profileId,
      quota: quotas.get(profileId) ?? null,
      budget: budgets.get(profileId) ?? null,
    }));
    const usage = provider?.usage;
    const observedAt = typeof usage?.observedAt === "number" && Number.isFinite(usage.observedAt)
      ? usage.observedAt : null;
    const measuredWindow = (usage?.source === "hook" || usage?.source === "api") &&
      typeof usage.percent === "number" && Number.isFinite(usage.percent);
    const stale = measuredWindow && Boolean(binding.billingEvidence) && observedAt !== null &&
      (input.now < observedAt || input.now - observedAt > input.staleAfterSeconds);
    const allProfilesBlocked = profiles.length > 0 &&
      profiles.every(({ quota }) => quota?.state === "blocked");
    const blocked = provider !== undefined &&
      (provider.quotaState === "blocked" || allProfilesBlocked);
    const status: CapacityStatus = blocked ? "blocked"
      : stale ? "stale"
      : provider?.connected && provider.quotaState === "ok" && observedAt !== null &&
        measuredWindow && Boolean(binding.billingEvidence)
        ? "available" : "unknown";
    const firstBlock = profiles.find(({ quota }) => quota?.state === "blocked")?.quota;

    return {
      id: binding.id,
      label: binding.label,
      providerId: binding.providerId,
      status,
      connected: provider?.connected ?? null,
      usagePercent: typeof usage?.percent === "number" && Number.isFinite(usage.percent)
        ? usage.percent : null,
      source: usage?.source ?? null,
      observedAt,
      blockedUntil: provider?.blockedUntil ?? firstBlock?.blockedUntil ?? null,
      reason: provider?.quotaState === "blocked" ? provider.detail ?? firstBlock?.reason ?? null
        : provider !== undefined && allProfilesBlocked ? firstBlock?.reason ?? null : null,
      billingEvidence: binding.billingEvidence ?? null,
      profiles,
    };
  });
}
