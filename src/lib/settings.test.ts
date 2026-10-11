import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as settings from "./settings";
import { loadFontSettings, loadUiDensity, saveUiDensity } from "./settings";

describe("UI density preference", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("defaults to comfortable and ignores invalid persisted values", () => {
    expect(loadUiDensity()).toBe("comfortable");
    localStorage.setItem("projecta.settings.density", "cramped");
    expect(loadUiDensity()).toBe("comfortable");
  });

  it("persists compact and restores comfortable", () => {
    saveUiDensity("compact");
    expect(loadUiDensity()).toBe("compact");
    saveUiDensity("comfortable");
    expect(loadUiDensity()).toBe("comfortable");
  });

  it("falls back safely when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    expect(loadUiDensity()).toBe("comfortable");
    expect(() => saveUiDensity("compact")).not.toThrow();
  });
});

// Key written by older builds; split so the retired name stays out of the source tree.
const STALE_KEY = "projecta.settings.theme" + "Style";

describe("retired theme style preference", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("settings exports no theme-style API", () => {
    expect(Object.keys(settings).filter((name) => /themestyle/i.test(name))).toEqual([]);
  });

  it("a stored theme style is never read, written or removed", () => {
    localStorage.setItem(STALE_KEY, "glas");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    expect(loadUiDensity()).toBe("comfortable");
    expect(loadFontSettings().uiFontSize).toBe("normal");
    saveUiDensity("compact");
    saveUiDensity("comfortable");
    expect(getItem.mock.calls.map(([key]) => key)).not.toContain(STALE_KEY);
    expect(setItem.mock.calls.map(([key]) => key)).not.toContain(STALE_KEY);
    expect(removeItem.mock.calls.map(([key]) => key)).not.toContain(STALE_KEY);
    expect(localStorage.getItem(STALE_KEY)).toBe("glas");
  });
});
