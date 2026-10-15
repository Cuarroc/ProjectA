/**
 * V2-FLAG-1 — feature-flag registry for Glass UI v2 preview surfaces.
 * D1 defaults on, the other flags off. Persists via the same
 * webview-local `projecta.settings.*` localStorage mechanism as `src/lib/settings.ts`
 * (no Rust/store table).
 */

import { de } from "../i18n/de";
import { readString, writeString } from "../lib/settings";

/** localStorage key prefix; mirrors `projecta.settings.*` from settings.ts. */
export const FEATURE_FLAG_STORAGE_PREFIX = "projecta.settings.featureFlag." as const;

export const FEATURE_FLAG_IDS = [
  "d1_neue_oberflaeche",
  "fernansicht",
  "kundenprojekte",
] as const;

export type FeatureFlagId = (typeof FEATURE_FLAG_IDS)[number];

const FEATURE_FLAG_COPY: Record<FeatureFlagId, { label: string; description: string }> = {
  d1_neue_oberflaeche: { label: de["flag.d1.label"], description: de["flag.d1.description"] },
  fernansicht: { label: de["flag.fernansicht.label"], description: de["flag.fernansicht.description"] },
  kundenprojekte: { label: de["flag.kundenprojekte.label"], description: de["flag.kundenprojekte.description"] },
};

export type FeatureFlag = {
  readonly id: FeatureFlagId;
  readonly label: string;
  readonly description: string;
  readonly defaultEnabled: boolean;
  /** When false, later packages must not mount the gated route. */
  allowsRoute(): boolean;
  /** When false, later packages must not call the gated backend. */
  allowsBackend(): boolean;
};

const listeners = new Set<() => void>();

function emitFeatureFlagChange(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to local flag changes (and cross-tab `storage` events). */
export function subscribeFeatureFlags(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key.startsWith(FEATURE_FLAG_STORAGE_PREFIX)) {
      emitFeatureFlagChange();
    }
  });
}

function storageKey(id: FeatureFlagId): string {
  return `${FEATURE_FLAG_STORAGE_PREFIX}${id}`;
}

/** Only D1 (the new UI) ships on; the user can still switch it off for good. */
const DEFAULT_ENABLED: Record<FeatureFlagId, boolean> = {
  d1_neue_oberflaeche: true,
  fernansicht: false,
  kundenprojekte: false,
};

/** An explicit "1"/"0" wins; a missing or unknown value falls back to the flag default. */
export function isFeatureFlagEnabled(id: FeatureFlagId): boolean {
  const stored = readString(storageKey(id));
  return stored === "1" ? true : stored === "0" ? false : DEFAULT_ENABLED[id];
}

/** Persist on/off; an explicit off is stored as "0" so it beats a default-on flag. */
export function setFeatureFlagEnabled(id: FeatureFlagId, enabled: boolean): void {
  writeString(storageKey(id), enabled ? "1" : "0");
  emitFeatureFlagChange();
}

function toFlag(id: FeatureFlagId): FeatureFlag {
  const copy = FEATURE_FLAG_COPY[id];
  return {
    id,
    label: copy.label,
    description: copy.description,
    defaultEnabled: DEFAULT_ENABLED[id],
    allowsRoute() {
      return isFeatureFlagEnabled(id);
    },
    allowsBackend() {
      return isFeatureFlagEnabled(id);
    },
  };
}

/** Canonical registry — the single `featureFlag` locus under `src/`. */
export const FEATURE_FLAGS: readonly FeatureFlag[] = FEATURE_FLAG_IDS.map(toFlag);

export function listFeatureFlags(): FeatureFlag[] {
  return [...FEATURE_FLAGS];
}
