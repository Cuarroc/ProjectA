import { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";

/**
 * Runs the *installed* `@xterm/addon-fit` (no mock) against a stand-in for
 * `@xterm/xterm@5.5`'s private surface. xterm 5.x draws a native scrollbar
 * and measures its real width into `_core.viewport.scrollBarWidth`
 * (e.g. 17px for classic Windows scrollbars, 15px fallback for overlay
 * ones). addon-fit 0.11 belongs to xterm 6, whose own scrollbar is a fixed
 * 14px, and ignores that measurement — the last column then lands under
 * the scrollbar.
 */
function proposeCols(scrollBarWidth: number, parentWidth: number): number | undefined {
  // No real layout needed: addon-fit reads the parent's size and the
  // element's padding via `getComputedStyle`, which jsdom answers from these
  // inline styles (it never calls `getBoundingClientRect`).
  const parent = document.createElement("div");
  parent.style.width = `${parentWidth}px`;
  parent.style.height = "240px";
  const element = document.createElement("div");
  element.style.padding = "0px";
  parent.appendChild(element);
  document.body.appendChild(parent);

  const fake = {
    element,
    options: { scrollback: 10_000 },
    rows: 24,
    cols: 80,
    _core: {
      viewport: { scrollBarWidth },
      _renderService: { dimensions: { css: { cell: { width: 7, height: 10 } } } },
    },
  };
  const addon = new FitAddon();
  addon.activate(fake as unknown as Terminal);
  try {
    return addon.proposeDimensions()?.cols;
  } finally {
    parent.remove();
  }
}

describe("addon-fit gegen xterm 5", () => {
  it("zieht die von xterm 5 gemessene Scrollbarbreite ab", () => {
    // 714px - 17px Scrollbar = 697px Platz = 99 volle Zellen à 7px.
    // Mit xterm 6s fixen 14px wären es 700px = 100 Spalten, die letzte
    // davon unter der Scrollbar.
    expect(proposeCols(17, 714)).toBe(99);
  });
});
