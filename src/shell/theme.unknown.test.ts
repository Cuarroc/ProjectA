import { beforeEach, describe, expect, it } from "vitest";

import { GLASS_THEME_KEY, loadGlassTheme, saveGlassTheme } from "./theme";

describe("unknown glass theme", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("does not store or paint an unknown glass theme", () => {
    saveGlassTheme("nope" as "light");

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(GLASS_THEME_KEY)).toBeNull();
    expect(loadGlassTheme()).toBe("system");

    saveGlassTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(GLASS_THEME_KEY)).toBe("dark");

    saveGlassTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(GLASS_THEME_KEY)).toBeNull();
  });
});
