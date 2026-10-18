import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { de } from "../../i18n/de";
import { Gallery } from "./Gallery";

afterEach(cleanup);

it("a forced hover state uses the hover style", () => {
  render(<Gallery />);
  fireEvent.click(screen.getByRole("button", { name: de["gallery.family.controls"] }));
  const story = screen.getByRole("article", { name: "Button" });
  const hover = story.querySelector('[data-force-state="hover"] .g-btn--primary');
  expect(hover).toBeTruthy();
  const css = readFileSync(new URL("../controls/controls.css", import.meta.url), "utf8");
  const rule = css.match(/([^{}]+)\{\s*background: var\(--g-accent-hover\);\s*\}/);
  expect(rule?.[1]).toContain(".g-btn--primary:hover");
  const forced = rule?.[1].split(",").find((selector) => selector.includes("data-force-state"));
  expect(forced).toBeTruthy();
  expect(hover?.matches(forced!.trim())).toBe(true);
});
