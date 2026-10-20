import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { de } from "../../i18n/de";
import { GLYPHS } from "../icons/glyphs";
import { COMPONENT_REGISTRY } from "../registry";
import { Gallery } from "./Gallery";

// The real light tokens, so the ratios are the shipped ones (jsdom skips the dark @media block).
beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = readFileSync(join(__dirname, "..", "tokens.css"), "utf8");
  document.head.append(style);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const reduce = (matches: boolean) => vi.stubGlobal("matchMedia", () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }));

describe("design gallery (DS-X-15)", () => {
  it("every swatch shows its contrast ratio", () => {
    render(<Gallery />);
    const swatches = within(screen.getByRole("list", { name: de["gallery.colour"] })).getAllByRole("listitem");
    expect(swatches.length).toBeGreaterThanOrEqual(9);
    for (const swatch of swatches) expect(swatch.textContent).toMatch(/\d+,\d:1/);
  });

  it("renders all six viz swatches (R1702-F2)", () => {
    render(<Gallery />);
    const swatches = within(screen.getByRole("list", { name: de["gallery.colour"] })).getAllByRole("listitem");
    for (let n = 1; n <= 6; n++) expect(swatches.some((s) => s.textContent?.includes(`--g-viz-${n}`))).toBe(true);
  });

  it("names every registry family in the navigation and labels sample content", () => {
    render(<Gallery />);
    const nav = screen.getByRole("navigation", { name: de["gallery.nav"] });
    for (const entry of COMPONENT_REGISTRY) {
      expect(within(nav).getByRole("button", { name: de[`gallery.family.${entry.family}`] })).toBeTruthy();
    }
    fireEvent.click(within(nav).getByRole("button", { name: de["gallery.type"] }));
    expect(screen.getByText(de["gallery.sample"])).toBeTruthy();
  });

  it("the icons page lists every registered glyph", () => {
    render(<Gallery />);
    fireEvent.click(within(screen.getByRole("navigation", { name: de["gallery.nav"] })).getByRole("button", { name: de["gallery.family.icons"] }));
    const cells = document.querySelectorAll(".g-gal-icon");
    expect(cells.length).toBe(Object.keys(GLYPHS).length);
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell.querySelector("svg")).not.toBeNull();
  });

  it("reduced motion stops the motion demo", () => {
    reduce(true);
    render(<Gallery />);
    fireEvent.click(screen.getByRole("button", { name: de["gallery.motion"] }));
    const play = screen.getByRole("button", { name: de["gallery.play"] });
    fireEvent.click(play);
    expect((play as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector(".g-gal-dot")?.getAttribute("data-moved")).toBe("off");
    expect(screen.getByText(de["gallery.motionRests"])).toBeTruthy();
  });

  it("the motion demo moves when motion is allowed", () => {
    reduce(false);
    render(<Gallery />);
    fireEvent.click(screen.getByRole("button", { name: de["gallery.motion"] }));
    fireEvent.click(screen.getByRole("button", { name: de["gallery.play"] }));
    expect(document.querySelector(".g-gal-dot")?.getAttribute("data-moved")).toBe("on");
  });
});
