import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deleteProviderKey,
  describeError,
  getFreeTierSummary,
  getProviderOverview,
  hasProviderKey,
  setProviderKey,
} from "./ipc";
import { formatBlockedUntil } from "./quota";
import type {
  AgentProfile,
  FreeTierPool,
  FreeTierSummary,
  Provider,
  ProviderUsage,
} from "../types";

/** How often the provider dialog refreshes its overview while open. */
export const PROVIDER_POLL_MS = 30_000;

/** Usage data older than this is shown faded. */
const USAGE_STALE_SECONDS = 5 * 60;

export interface ProviderSnapshot {
  /** Every provider known to the core. */
  providers: Provider[];
  /** Whether the first fetch is still in progress. */
  loading: boolean;
  /** Last fetch failure, or `null`. */
  error: string | null;
  /**
   * The key vault's read error, or `null` when it read cleanly. Repeated on
   * every overview row by the core; derived once here. This is what lets the
   * dialog say "the key store is broken" instead of looking exactly like
   * "no keys stored".
   */
  vaultError: string | null;
  /** Refreshes the overview from the core. */
  refresh: () => void;
}

/**
 * The vault error carried by an overview, if any row reports one. The core
 * repeats the same value on every row, so the first non-empty one is the
 * answer; rows that say nothing different are not distinguished.
 */
export function overviewVaultError(providers: Provider[]): string | null {
  for (const provider of providers) {
    if (provider.vaultError !== null && provider.vaultError !== "") {
      return provider.vaultError;
    }
  }
  return null;
}

/**
 * A German explanation of a vault read error, keyed off the stable code the
 * core prefixes it with. An unknown error is passed through verbatim: the
 * core owns this vocabulary, and a new kind must not be relabeled into a
 * claim it never made.
 */
export function vaultErrorText(vaultError: string): string {
  if (vaultError.startsWith("vault_corrupt")) {
    return "Der Schlüsselspeicher ist beschädigt. Hinterlegte Keys erscheinen vorübergehend als nicht gespeichert; beim nächsten Speichern eines Keys wird die beschädigte Datei als .broken-Kopie gesichert und neu begonnen.";
  }
  if (vaultError.startsWith("vault_decrypt_failed")) {
    return "Der Schlüsselspeicher ist für ein anderes Windows-Konto oder einen anderen Rechner verschlüsselt. Er wird nicht überschrieben; zum Neubeginn die Datei provider-keys.json im App-Datenordner von Hand entfernen.";
  }
  if (vaultError.startsWith("vault_unreadable")) {
    return "Der Schlüsselspeicher kann nicht gelesen werden. Hinterlegte Keys erscheinen vorübergehend als nicht gespeichert.";
  }
  return vaultError;
}

/**
 * Reads `get_provider_overview` once on mount and, when `pollMs` is set, keeps it
 * fresh on an interval and whenever the window regains focus. Every timer and
 * listener is torn down on unmount, and a late reply after unmount is dropped.
 */
export function useProviderOverview(pollMs = 0): ProviderSnapshot {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await getProviderOverview();
      if (!aliveRef.current) return;
      setProviders(next);
      setError(null);
    } catch (err) {
      if (!aliveRef.current) return;
      setError(describeError(err));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();

    if (pollMs <= 0) {
      return () => {
        aliveRef.current = false;
      };
    }

    const timer = window.setInterval(() => void refresh(), pollMs);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      aliveRef.current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [pollMs, refresh]);

  return useMemo(
    () => ({
      providers,
      loading,
      error,
      vaultError: overviewVaultError(providers),
      refresh,
    }),
    [providers, loading, error, refresh],
  );
}

export interface ProviderKeyPresence {
  /** Whether a key is on file for this provider. */
  present: boolean;
  /** Whether the current check or mutation is in flight. */
  busy: boolean;
  /** Last mutation error, or `null`. */
  error: string | null;
  /** Stores a new key; empty strings are ignored. */
  save: (key: string) => void;
  /** Removes any stored key. */
  remove: () => void;
  /** Re-checks presence from the core. */
  refresh: () => void;
}

/**
 * Tracks key presence for one API-key provider and offers save/remove actions.
 * The key itself is never returned to the UI; only the boolean presence flag.
 */
export function useProviderKey(providerId: string): ProviderKeyPresence {
  const [present, setPresent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await hasProviderKey(providerId);
      if (!aliveRef.current) return;
      setPresent(next);
      setError(null);
    } catch (err) {
      if (!aliveRef.current) return;
      setError(describeError(err));
    }
  }, [providerId]);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    return () => {
      aliveRef.current = false;
    };
  }, [refresh]);

  const save = useCallback(
    async (key: string) => {
      const trimmed = key.trim();
      if (trimmed === "" || busy) return;
      setBusy(true);
      setError(null);
      try {
        await setProviderKey(providerId, trimmed);
        if (aliveRef.current) {
          setPresent(true);
          setError(null);
        }
      } catch (err) {
        if (aliveRef.current) setError(describeError(err));
      } finally {
        if (aliveRef.current) setBusy(false);
      }
    },
    [providerId, busy],
  );

  const remove = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteProviderKey(providerId);
      if (aliveRef.current) {
        setPresent(false);
        setError(null);
      }
    } catch (err) {
      if (aliveRef.current) setError(describeError(err));
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [providerId, busy]);

  return useMemo(
    () => ({ present, busy, error, save, remove, refresh }),
    [present, busy, error, save, remove, refresh],
  );
}

/** A short, German label for a provider kind. */
export function providerKindLabel(kind: Provider["kind"]): string {
  switch (kind) {
    case "subscription":
      return "Abo";
    case "api_key":
      return "API-Key";
    case "local":
      return "Lokal";
    default:
      return kind;
  }
}

/** A short, German label for a provider quota state. */
export function providerQuotaLabel(state: Provider["quotaState"]): string {
  switch (state) {
    case "ok":
      return "OK";
    case "blocked":
      return "Blockiert";
    case "unknown":
      return "Unbekannt";
    default:
      return state;
  }
}

/** A one-line detail line that includes the optional core detail and block time. */
export function providerDetailText(provider: Provider): string | null {
  const until = provider.quotaState === "blocked" ? formatBlockedUntil(provider.blockedUntil) : null;
  if (provider.detail && until) return `${provider.detail} — frei ${until}`;
  if (provider.detail) return provider.detail;
  if (until) return `Frei ${until}`;
  return null;
}

/** Whether the usage observation is older than the staleness threshold. */
export function isUsageStale(usage: ProviderUsage): boolean {
  return Date.now() / 1000 - usage.observedAt > USAGE_STALE_SECONDS;
}

/**
 * Formats a unix-seconds reset time as a German relative phrase.
 * Returns `null` when no reset is known; returns a "faellig" label for past
 * deadlines so stale data does not look like a future reset.
 */
export function formatProviderResetsAt(resetsAt: number | null): string | null {
  if (resetsAt === null) return null;
  const at = new Date(resetsAt * 1000);
  if (Number.isNaN(at.getTime())) return null;

  const diffMs = at.getTime() - Date.now();
  if (diffMs <= 0) return "Reset fällig";

  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return `Reset in ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Reset in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0 ? `Reset in ${hours} h ${remainingMinutes} min` : `Reset in ${hours} h`;
  }
  const days = Math.round(hours / 24);
  return `Reset in ${days} T.`;
}

/** A readable observation timestamp, e.g. "12:34" or "27.08. 12:34". */
export function formatProviderObservedAt(observedAt: number): string {
  const at = new Date(observedAt * 1000);
  if (Number.isNaN(at.getTime())) return "unbekannt";

  const now = new Date();
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();

  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  const day = at.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
  return `${day} ${time}`;
}

/**
 * Percentage thresholds reused from the board context bar: warn at 80 % and
 * switch to the danger colour at 95 %.
 */
export function providerUsageFillClass(percent: number | null): string {
  if (percent === null) return "";
  if (percent >= 95) return "provider-usage-fill-critical";
  if (percent >= 80) return "provider-usage-fill-high";
  return "";
}

// -- OmniRoute routing and free pools (phase 19 T5) ---------------------------

/**
 * The environment keys that make a profile a routed one. A profile that sets
 * either of them sends its agent at OmniRoute instead of at the vendor, which
 * is the fact the "via OmniRoute" badge reports — `ANTHROPIC_BASE_URL` is what
 * Claude Code reads, `OMNIROUTE_BASE_URL` is what ProjectA writes Codex's
 * generated config from.
 */
export const ROUTING_ENV_KEYS = ["ANTHROPIC_BASE_URL", "OMNIROUTE_BASE_URL"] as const;

/** Whether spawns of this profile go through OmniRoute. */
export function isRoutedProfile(profile: AgentProfile): boolean {
  return ROUTING_ENV_KEYS.some((key) => (profile.env?.[key] ?? "").trim() !== "");
}

/**
 * The routed profiles that belong to one provider row.
 *
 * Same rule the core uses to inherit capabilities (`profiles.rs`): a profile is
 * this provider's when it *is* the provider id or is a dash-suffixed variant of
 * it, so `claude-omni` counts for `claude` and `claudeomni` does not.
 */
export function routedProfilesForProvider(
  providerId: string,
  profiles: AgentProfile[],
): AgentProfile[] {
  return profiles.filter(
    (profile) =>
      isRoutedProfile(profile) &&
      (profile.id === providerId || profile.id.startsWith(`${providerId}-`)),
  );
}

/** How often the free-tier panel re-asks the core while it is on screen. */
export const FREE_TIER_POLL_MS = 60_000;

export interface FreeTierSnapshot {
  summary: FreeTierSummary | null;
  loading: boolean;
  /** An IPC failure — distinct from the core's own honest `reason`. */
  error: string | null;
  refresh: () => void;
}

/**
 * Reads `get_free_tier_summary` on mount and on an interval. A core that
 * reports `available: false` is not an error here: the reason it gives is the
 * thing to show, and it arrives in `summary`.
 */
export function useFreeTierSummary(pollMs = 0): FreeTierSnapshot {
  const [summary, setSummary] = useState<FreeTierSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await getFreeTierSummary();
      if (!aliveRef.current) return;
      setSummary(next);
      setError(null);
    } catch (err) {
      if (!aliveRef.current) return;
      setError(describeError(err));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    if (pollMs <= 0) {
      return () => {
        aliveRef.current = false;
      };
    }
    const timer = window.setInterval(() => void refresh(), pollMs);
    return () => {
      aliveRef.current = false;
      window.clearInterval(timer);
    };
  }, [pollMs, refresh]);

  return useMemo(() => ({ summary, loading, error, refresh }), [summary, loading, error, refresh]);
}

/**
 * One pool's remaining capacity as a line of text, using only what the core
 * actually reported. Returns `null` when it reported no numbers at all — that
 * is a pool we know exists and nothing more, and inventing a zero for it would
 * be the one thing this whole path is built to avoid.
 */
export function freeTierRemainingText(pool: FreeTierPool): string | null {
  const remaining = pool.remaining === null ? null : pool.remaining.toLocaleString();
  if (remaining !== null && pool.limit !== null) {
    return `${remaining} / ${pool.limit.toLocaleString()}`;
  }
  if (remaining !== null) return `${remaining} frei`;
  if (pool.remainingPercent !== null) return `${pool.remainingPercent} % frei`;
  return null;
}
