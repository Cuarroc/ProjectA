import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { describeError, getQuotaState } from "./ipc";
import type { QuotaState } from "../types";

/** How often the status bar re-asks the core. */
export const QUOTA_POLL_MS = 30_000;

export interface QuotaSnapshot {
  /** Per-profile availability, keyed by profile id. */
  byProfile: Map<string, QuotaState>;
  blockedCount: number;
  /**
   * True when at least one profile can still reach OmniRoute, false when a
   * completed read says none can — and `null` while that read is still out or
   * has failed: an unread router state must never surface as "offline".
   */
  omniRouteOnline: boolean | null;
  loading: boolean;
  /** Last fetch failure, or `null`. Quota is advisory, so callers may ignore it. */
  error: string | null;
}

/**
 * Reads `get_quota_state` once on mount and, when `pollMs` is set, keeps it
 * fresh on an interval and whenever the window regains focus. Every timer and
 * listener is torn down on unmount, and a late reply after unmount is dropped.
 */
export function useQuotaState(pollMs = 0): QuotaSnapshot {
  const [quotas, setQuotas] = useState<QuotaState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await getQuotaState();
      if (!aliveRef.current) return;
      setQuotas(next);
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

  return useMemo(() => {
    const byProfile = new Map(quotas.map((entry) => [entry.profileId, entry]));
    return {
      byProfile,
      blockedCount: quotas.filter((entry) => entry.state === "blocked").length,
      // The flag is per entry but describes one shared route: any reachable
      // profile means the route is up. Unknown stays unknown: before the first
      // answer and after a failed read there is no basis for either claim.
      omniRouteOnline: loading || error !== null ? null : quotas.some((entry) => entry.omniRouteOnline),
      loading,
      error,
    };
  }, [quotas, loading, error]);
}

/** Whether this profile must not be spawned right now. `unknown` stays usable. */
export function isBlocked(quota: QuotaState | undefined): boolean {
  return quota?.state === "blocked";
}

/**
 * A one-line explanation for a blocked profile: the core's reason plus, when
 * the block has an end, when it lifts.
 */
export function blockedLabel(quota: QuotaState): string {
  const reason = quota.reason ?? "Kontingent erschöpft";
  const until = formatBlockedUntil(quota.blockedUntil);
  return until === null ? reason : `${reason} — frei ${until}`;
}

/**
 * Formats a unix-seconds deadline as a relative human duration, e.g.
 * "in 42 min". Returns `null` for a missing or already-passed deadline.
 */
export function formatRelativeUntil(blockedUntil: number | null): string | null {
  if (blockedUntil === null) return null;
  const at = new Date(blockedUntil * 1000);
  if (Number.isNaN(at.getTime())) return null;

  const nowMs = Date.now();
  const diffMs = at.getTime() - nowMs;
  if (diffMs <= 0) return null;

  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return `in ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;
  const days = Math.round(hours / 24);
  return `in ${days} T.`;
}

/**
 * Formats a unix-seconds deadline as a local time, or as a date and time when
 * it is not today. Returns `null` for a missing or already-passed deadline.
 */
export function formatBlockedUntil(blockedUntil: number | null): string | null {
  if (blockedUntil === null) return null;
  const at = new Date(blockedUntil * 1000);
  if (Number.isNaN(at.getTime())) return null;

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
