import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadUiDensity,
  loadUiThemeStyle,
  saveUiDensity,
  saveUiThemeStyle,
  UI_THEME_STYLES,
  type UiThemeStyle,
} from "./settings";

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

describe("UI theme style preference", () => {
  beforeEach(() => localStorage.clear());

  it("loadUiThemeStyle falls back to klassisch for unknown values", () => {
    expect(loadUiThemeStyle()).toBe("klassisch");
    localStorage.setItem("projecta.settings.themeStyle", "neon");
    expect(loadUiThemeStyle()).toBe("klassisch");
  });

  it("saveUiThemeStyle round-trips every style", () => {
    const styles = UI_THEME_STYLES.map((entry) => entry.id) as UiThemeStyle[];
    for (const style of styles) {
      saveUiThemeStyle(style);
      expect(loadUiThemeStyle()).toBe(style);
    }
  });
});
