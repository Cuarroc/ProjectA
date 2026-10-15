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

  it("defaults D1 to on and every other flag to off", () => {
    for (const flag of FEATURE_FLAGS) {
      const expected = flag.id === "d1_neue_oberflaeche";
      expect(flag.defaultEnabled).toBe(expected);
      expect(isFeatureFlagEnabled(flag.id)).toBe(expected);
    }
    const d1 = FEATURE_FLAGS.find((f) => f.id === "d1_neue_oberflaeche");
    expect(d1?.label).toBe("Neue Oberfläche (Vorschau)");
    expect(d1?.allowsRoute()).toBe(true);
  });

  it("keeps an explicit D1 off as 0 also after a reload", async () => {
    const key = `${FEATURE_FLAG_STORAGE_PREFIX}d1_neue_oberflaeche`;
    setFeatureFlagEnabled("d1_neue_oberflaeche", false);
    expect(localStorage.getItem(key)).toBe("0");
    expect(isFeatureFlagEnabled("d1_neue_oberflaeche")).toBe(false);
    vi.resetModules();
    const reloaded = await import("./featureFlags");
    expect(reloaded.isFeatureFlagEnabled("d1_neue_oberflaeche")).toBe(false);
    reloaded.setFeatureFlagEnabled("d1_neue_oberflaeche", true);
    expect(localStorage.getItem(key)).toBe("1");
    expect(reloaded.isFeatureFlagEnabled("d1_neue_oberflaeche")).toBe(true);
  });

  it("persists a flag through projecta.settings.featureFlag keys", () => {
    setFeatureFlagEnabled("fernansicht", true);
    expect(localStorage.getItem(`${FEATURE_FLAG_STORAGE_PREFIX}fernansicht`)).toBe("1");
    expect(isFeatureFlagEnabled("fernansicht")).toBe(true);
    setFeatureFlagEnabled("fernansicht", false);
    expect(localStorage.getItem(`${FEATURE_FLAG_STORAGE_PREFIX}fernansicht`)).toBe("0");
    expect(isFeatureFlagEnabled("fernansicht")).toBe(false);
  });

  it("falls back to the default for unknown stored values and survives storage failures", () => {
    localStorage.setItem(`${FEATURE_FLAG_STORAGE_PREFIX}d1_neue_oberflaeche`, "yes");
    localStorage.setItem(`${FEATURE_FLAG_STORAGE_PREFIX}kundenprojekte`, "yes");
    expect(isFeatureFlagEnabled("d1_neue_oberflaeche")).toBe(true);
    expect(isFeatureFlagEnabled("kundenprojekte")).toBe(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(isFeatureFlagEnabled("fernansicht")).toBe(false);
    expect(() => setFeatureFlagEnabled("fernansicht", true)).not.toThrow();
  });

  // Title kept for red-first trailer on the original package commit; assertions
  // now state the alias contract (R1018-A2).
  it("lists every flag with German copy and gates routes only when on", () => {
    const listed = listFeatureFlags();
    expect(listed.map((f) => f.id).sort()).toEqual(
      (["d1_neue_oberflaeche", "fernansicht", "kundenprojekte"] as FeatureFlagId[]).sort(),
    );
    for (const flag of listed) {
      expect(flag.label.length).toBeGreaterThan(0);
      expect(flag.description.length).toBeGreaterThan(0);
      expect(flag.allowsRoute()).toBe(isFeatureFlagEnabled(flag.id));
      expect(flag.allowsBackend()).toBe(isFeatureFlagEnabled(flag.id));
    }
    setFeatureFlagEnabled("kundenprojekte", true);
    const kp = listFeatureFlags().find((f) => f.id === "kundenprojekte");
    expect(kp?.allowsRoute()).toBe(true);
    expect(kp?.allowsBackend()).toBe(true);
    expect(isFeatureFlagEnabled("kundenprojekte")).toBe(true);
  });

  it("allowsRoute and allowsBackend mirror isFeatureFlagEnabled", () => {
    expect(isFeatureFlagEnabled("fernansicht")).toBe(false);
    const off = listFeatureFlags().find((f) => f.id === "fernansicht");
    expect(off?.allowsRoute()).toBe(false);
    expect(off?.allowsBackend()).toBe(false);
    setFeatureFlagEnabled("fernansicht", true);
    const on = listFeatureFlags().find((f) => f.id === "fernansicht");
    expect(on?.allowsRoute()).toBe(true);
    expect(on?.allowsBackend()).toBe(true);
    expect(isFeatureFlagEnabled("fernansicht")).toBe(true);
  });

  it("keeps exactly one plain-German sentence per switch description", () => {
    for (const flag of listFeatureFlags()) {
      expect(flag.label.length).toBeGreaterThan(0);
      const terminals = [...flag.description.matchAll(/[.!?]/g)];
      expect(terminals).toHaveLength(1);
      expect(flag.description.endsWith(".") || flag.description.endsWith("!") || flag.description.endsWith("?")).toBe(
        true,
      );
    }
    expect(listFeatureFlags().find((f) => f.id === "d1_neue_oberflaeche")?.description).toBe(
      "Zeigt die neue Oberfläche als Vorschau; sie ist noch nicht fertig.",
    );
  });
});
