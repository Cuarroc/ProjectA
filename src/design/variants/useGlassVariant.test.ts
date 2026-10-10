import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  GLASS_VARIANT_KEY, GLASS_VARIANTS, applyStoredGlassVariant, loadGlassVariant, saveGlassVariant, useGlassVariant,
} from "./useGlassVariant";

const root = document.documentElement;
beforeEach(() => { localStorage.clear(); delete root.dataset.glassVariant; });

describe("glass variant preference", () => {
  it("defaults to glas and treats an unknown stored value as glas", () => {
    expect(loadGlassVariant()).toBe("glas");
    localStorage.setItem(GLASS_VARIANT_KEY, "xyz");
    expect(loadGlassVariant()).toBe("glas");
    applyStoredGlassVariant();
    expect(root.dataset.glassVariant).toBeUndefined();
  });

  it("applies a stored klar before any render", () => {
    localStorage.setItem(GLASS_VARIANT_KEY, "klar");
    applyStoredGlassVariant();
    expect(root.dataset.glassVariant).toBe("klar");
  });

  it("sets the attribute for variants, removes it for glas and persists only non-default values", () => {
    saveGlassVariant("abend");
    expect(root.dataset.glassVariant).toBe("abend");
    expect(localStorage.getItem(GLASS_VARIANT_KEY)).toBe("abend");
    saveGlassVariant("glas");
    expect(root.dataset.glassVariant).toBeUndefined();
    expect(localStorage.getItem(GLASS_VARIANT_KEY)).toBeNull();
  });

  it("hook starts from the stored value and saves changes", () => {
    localStorage.setItem(GLASS_VARIANT_KEY, "nebel");
    const { result } = renderHook(() => useGlassVariant());
    expect(result.current[0]).toBe("nebel");
    act(() => result.current[1]("klar"));
    expect(result.current[0]).toBe("klar");
    expect(root.dataset.glassVariant).toBe("klar");
  });

  it("keeps shot.mjs in step with the storage key and the variant ids", () => {
    const shot = readFileSync(resolve(__dirname, "../../../scripts/dev/shot.mjs"), "utf8");
    expect(shot).toContain(GLASS_VARIANT_KEY);
    for (const id of GLASS_VARIANTS) expect(shot).toContain(`"${id}"`);
  });
});
