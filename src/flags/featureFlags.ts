/**
 * V2-FLAG-1 — feature-flag registry for Glass UI v2 preview surfaces.
 * Unused by the running app until V2-F9 wires D1. Persists via the same
 * webview-local `projecta.settings.*` localStorage mechanism as `src/lib/settings.ts`
 * (no Rust/store table).
 */

/** localStorage key prefix; mirrors `projecta.settings.*` from settings.ts. */
export const FEATURE_FLAG_STORAGE_PREFIX = "projecta.settings.featureFlag." as const;

export const FEATURE_FLAG_IDS = [
  "d1_neue_oberflaeche",
  "fernansicht",
  "kundenprojekte",
] as const;

export type FeatureFlagId = (typeof FEATURE_FLAG_IDS)[number];

/**
 * TODO(V2-F6): move these German strings into the i18n dictionary once V2-F6 merges.
 * Until then keep one sentence of plain German per switch for V2-S10a.
 */
const FEATURE_FLAG_COPY: Record<FeatureFlagId, { label: string; description: string }> = {
  d1_neue_oberflaeche: {
    label: "Neue Oberfläche (Vorschau)",
    description:
      "Schaltet die Glass-UI-v2-Schale ein. Standard aus, damit v1.6.0 aus main keine halbe neue Oberfläche trägt.",
  },
  fernansicht: {
    label: "Fernansicht",
    description: "Erlaubt die Fernansicht und ihre Kopplung; aus = Route fehlt, kein Backend-Aufruf.",
  },
  kundenprojekte: {
    label: "Kundenprojekte",
    description: "Zeigt Kundenprojekte mit Datenschutz-Schleuse; aus = Route fehlt, kein Backend-Aufruf.",
  },
};

export type FeatureFlag = {
  readonly id: FeatureFlagId;
  readonly label: string;
  readonly description: string;
  readonly defaultEnabled: false;
  /** When false, later packages must not mount the gated route. */
  allowsRoute(): boolean;
  /** When false, later packages must not call the gated backend. */
  allowsBackend(): boolean;
};

function readRaw(id: FeatureFlagId): string | null {
  try {
    return localStorage.getItem(`${FEATURE_FLAG_STORAGE_PREFIX}${id}`);
  } catch {
    return null;
  }
}

function writeRaw(id: FeatureFlagId, value: string | null): void {
  try {
    const key = `${FEATURE_FLAG_STORAGE_PREFIX}${id}`;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage disabled — keep the in-memory default (off).
  }
}

/** True only when the user explicitly turned the switch on. */
export function isFeatureFlagEnabled(id: FeatureFlagId): boolean {
  return readRaw(id) === "1";
}

/** Persist on/off; `false` removes the key so the default (off) wins. */
export function setFeatureFlagEnabled(id: FeatureFlagId, enabled: boolean): void {
  writeRaw(id, enabled ? "1" : null);
}

function toFlag(id: FeatureFlagId): FeatureFlag {
  const copy = FEATURE_FLAG_COPY[id];
  return {
    id,
    label: copy.label,
    description: copy.description,
    defaultEnabled: false,
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
  return FEATURE_FLAG_IDS.map(toFlag);
}
