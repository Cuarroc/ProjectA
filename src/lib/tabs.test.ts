import { describe, expect, it } from "vitest";

import { tabStop, tabTarget } from "./tabs";

describe("tabTarget (APP-5: arrow keys walk a tablist)", () => {
  it("moves right and wraps at the end", () => {
    expect(tabTarget("ArrowRight", 0, 3)).toBe(1);
    expect(tabTarget("ArrowRight", 2, 3)).toBe(0);
  });

  it("moves left and wraps at the start", () => {
    expect(tabTarget("ArrowLeft", 1, 3)).toBe(0);
    expect(tabTarget("ArrowLeft", 0, 3)).toBe(2);
  });

  it("Home and End jump to the edges", () => {
    expect(tabTarget("Home", 2, 3)).toBe(0);
    expect(tabTarget("End", 0, 3)).toBe(2);
  });

  it("treats a missing selection as 'before the first tab'", () => {
    expect(tabTarget("ArrowRight", -1, 3)).toBe(0);
    expect(tabTarget("ArrowLeft", -1, 3)).toBe(2);
  });

  it("ignores every other key and an empty tablist", () => {
    expect(tabTarget("Enter", 0, 3)).toBeNull();
    expect(tabTarget("a", 0, 3)).toBeNull();
    expect(tabTarget("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("tabStop (roving tabindex)", () => {
  it("makes exactly the selected tab the tab stop", () => {
    expect(tabStop(true, 1, true)).toBe(0);
    expect(tabStop(false, 0, true)).toBe(-1);
  });

  it("falls back to the first tab when nothing is selected", () => {
    expect(tabStop(false, 0, false)).toBe(0);
    expect(tabStop(false, 1, false)).toBe(-1);
  });
});
