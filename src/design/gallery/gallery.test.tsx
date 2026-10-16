import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { de } from "../../i18n/de";
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

  it("names every registry family in the navigation and labels sample content", () => {
    render(<Gallery />);
    const nav = screen.getByRole("navigation", { name: de["gallery.nav"] });
    for (const entry of COMPONENT_REGISTRY) {
      expect(within(nav).getByRole("button", { name: de[`gallery.family.${entry.family}`] })).toBeTruthy();
    }
    fireEvent.click(within(nav).getByRole("button", { name: de["gallery.type"] }));
    expect(screen.getByText(de["gallery.sample"])).toBeTruthy();
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
