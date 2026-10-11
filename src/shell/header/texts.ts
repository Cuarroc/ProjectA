import { isUsageStale, type ProviderSnapshot } from "../../lib/providers";
import type { QuotaSnapshot } from "../../lib/quota";
import type { ProviderUsage } from "../../types";

const UNKNOWN = "Kontingente: unbekannt";
const fresh = (u: ProviderUsage) => Number.isFinite(u.observedAt)
  && u.observedAt <= Date.now() / 1000 && !isUsageStale(u);

/** Summarize observations, never combine independent usage windows or grant starts. */
export function quotaSummary(quota: QuotaSnapshot, overview: ProviderSnapshot) {
  const profiles = [...quota.byProfile.values()];
  const blocked = profiles.some((p) => p.state === "blocked");
  const providerBlock = overview.providers.find((p) => p.quotaState === "blocked");
  if (blocked || providerBlock) {
    const stale = (blocked && quota.error !== null) || (providerBlock && overview.error !== null);
    return { text: `Kontingente: Blockiert${stale ? " · letzter Stand, aktuell unbekannt" : ""}`, blocked: true, percent: null };
  }
  if (quota.loading || overview.loading) return { text: "Kontingente: noch nicht verbunden", percent: null };
  if (quota.error !== null || overview.error !== null || overview.vaultError !== null) {
    return { text: `${UNKNOWN} · Lesefehler`, percent: null };
  }
  const windows = overview.providers.flatMap((p) => {
    const u = p.usage;
    return u && fresh(u)
      && u.percent !== null && Number.isFinite(u.percent) && u.percent >= 0 && u.percent <= 100 && u.windowLabel.trim()
      ? [{ name: p.name, ...u, percent: u.percent }] : [];
  });
  const highest = windows.sort((a, b) => b.percent - a.percent)[0];
  if (highest) return { text: `Kontingente: ${highest.name} · ${highest.windowLabel} · ${highest.percent} % verbraucht`, percent: highest.percent };
  const hasUnreadableUsage = overview.providers.some((p) => p.usage !== null && (p.usage.percent !== null || !fresh(p.usage)));
  const known = profiles.some((p) => p.state === "ok") || overview.providers.some((p) => p.quotaState === "ok");
  const unknown = profiles.some((p) => p.state === "unknown") || overview.providers.some((p) => p.quotaState === "unknown");
  return { text: known && !hasUnreadableUsage ? `Kontingente: Verfügbar beobachtet${unknown ? " · teils unbekannt" : ""}` : UNKNOWN, percent: null };
}

export const DEV_TEXT = {
  badge: (sha: string) => `DEV · ${sha.slice(0, 7)}`,
  experiments: "Experimente",
  commit: "Build-Commit",
  time: "Build-Zeit",
};
