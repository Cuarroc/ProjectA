import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FEATURE_FLAGS,
  FEATURE_FLAG_STORAGE_PREFIX,
  isFeatureFlagEnabled,
  listFeatureFlags,
  setFeatureFlagEnabled,
  type FeatureFlagId,
} from "./featureFlags";

describe("featureFlags registry", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("defaults every registered flag to off including D1", () => {
    expect(FEATURE_FLAGS.length).toBeGreaterThanOrEqual(1);
    for (const flag of FEATURE_FLAGS) {
      expect(flag.defaultEnabled).toBe(false);
      expect(isFeatureFlagEnabled(flag.id)).toBe(false);
    }
    const d1 = FEATURE_FLAGS.find((f) => f.id === "d1_neue_oberflaeche");
    expect(d1?.label).toBe("Neue Oberfläche (Vorschau)");
    expect(isFeatureFlagEnabled("d1_neue_oberflaeche")).toBe(false);
  });

  it("persists a flag through projecta.settings.featureFlag keys", () => {
    setFeatureFlagEnabled("d1_neue_oberflaeche", true);
    expect(localStorage.getItem(`${FEATURE_FLAG_STORAGE_PREFIX}d1_neue_oberflaeche`)).toBe("1");
    expect(isFeatureFlagEnabled("d1_neue_oberflaeche")).toBe(true);
    setFeatureFlagEnabled("d1_neue_oberflaeche", false);
    expect(localStorage.getItem(`${FEATURE_FLAG_STORAGE_PREFIX}d1_neue_oberflaeche`)).toBeNull();
    expect(isFeatureFlagEnabled("d1_neue_oberflaeche")).toBe(false);
  });

  it("ignores unknown stored values and survives storage failures", () => {
    localStorage.setItem(`${FEATURE_FLAG_STORAGE_PREFIX}d1_neue_oberflaeche`, "yes");
    expect(isFeatureFlagEnabled("d1_neue_oberflaeche")).toBe(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(isFeatureFlagEnabled("fernansicht")).toBe(false);
    expect(() => setFeatureFlagEnabled("fernansicht", true)).not.toThrow();
  });

  it("lists every flag with German copy and gates routes only when on", () => {
    const listed = listFeatureFlags();
    expect(listed.map((f) => f.id).sort()).toEqual(
      (["d1_neue_oberflaeche", "fernansicht", "kundenprojekte"] as FeatureFlagId[]).sort(),
    );
    for (const flag of listed) {
      expect(flag.label.length).toBeGreaterThan(0);
      expect(flag.description.length).toBeGreaterThan(0);
      expect(flag.allowsRoute()).toBe(false);
      expect(flag.allowsBackend()).toBe(false);
    }
    setFeatureFlagEnabled("kundenprojekte", true);
    const kp = listFeatureFlags().find((f) => f.id === "kundenprojekte");
    expect(kp?.allowsRoute()).toBe(true);
    expect(kp?.allowsBackend()).toBe(true);
  });
});
