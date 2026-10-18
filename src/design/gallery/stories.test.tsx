import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { parse } from "postcss";
import { afterEach, expect, it } from "vitest";
import { de } from "../../i18n/de";
import { Gallery } from "./Gallery";

afterEach(cleanup);

it("every interactive CSS selector has its forced-state twin in the same rule", () => {
  const states = { ":hover": "hover", ":active": "active", ":focus-visible": "focus", ":disabled": "disabled", '[aria-invalid="true"]': "error" };
  // Segmented previews target its selected tab stop; the real selector covers all options.
  const normalize = (selector: string) => selector.replaceAll('[tabindex="0"]', "").replace(/\s/g, "");
  const check = (selectors: string[]) => {
    for (const selector of selectors.filter((s) => !s.includes("data-force-state"))) {
      for (const [native, state] of Object.entries(states)) if (selector.includes(native)) {
        const twin = `[data-force-state="${state}"] ${selector.replace(native, "")}`;
        expect(selectors.map(normalize), selector).toContain(normalize(twin));
      }
    }
  };
  for (const family of ["controls", "inputs"]) {
    const css = parse(readFileSync(join(__dirname, `../${family}/${family}.css`), "utf8"));
    let checked = 0;
    css.walkRules((rule) => {
      check(rule.selectors);
      for (const twin of rule.selectors.filter((s) => s.includes("data-force-state"))) {
        expect(() => check(rule.selectors.filter((s) => s !== twin)), twin).toThrow();
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(0);
  }
});

it("default cells include registered toggle states and visual variants", () => {
  render(<Gallery />);
  fireEvent.click(screen.getByRole("button", { name: de["gallery.family.controls"] }));
  const cell = (name: string) => screen.getByRole("article", { name }).querySelector('[data-force-state="default"]')!;
  expect(within(cell("Switch") as HTMLElement).getAllByRole("switch").map((el) => el.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  expect(within(cell("FilterChip") as HTMLElement).getAllByRole("button").map((el) => el.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  for (const variant of ["primary", "tint", "ghost", "danger"]) expect(cell("Button").querySelector(`.g-btn--${variant}`)).toBeTruthy();
  expect(cell("Button").querySelector('.g-btn:not([class*="g-btn--"])')).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: de["gallery.family.inputs"] }));
  for (const state of ["off", "warn", "unknown"]) expect(cell("Lamp").querySelector(`.g-lamp--${state}`)).toBeTruthy();
});

it("each story sample is named by its component and state caption", () => {
  render(<Gallery />);
  for (const family of ["controls", "inputs"] as const) {
    fireEvent.click(screen.getByRole("button", { name: de[`gallery.family.${family}`] }));
    for (const story of screen.getAllByRole("article")) for (const cell of story.querySelectorAll("[data-force-state]")) {
      const caption = cell.querySelector(".g-gal-note")!;
      const name = `${story.querySelector("h3")!.textContent} ${caption.textContent}`;
      const samples = cell.querySelectorAll('.g-btn, .g-fchip, .g-sw, .g-inp, [role="group"], [role="radiogroup"], [role="img"], [role="meter"], kbd, .g-chip');
      expect(samples.length).toBeGreaterThan(0);
      for (const sample of samples) expect(sample).toHaveAccessibleName(name);
    }
  }
});

it("a forced hover state uses the hover style", () => {
  render(<Gallery />);
  fireEvent.click(screen.getByRole("button", { name: de["gallery.family.controls"] }));
  const story = screen.getByRole("article", { name: "Button" });
  const hover = story.querySelector('[data-force-state="hover"] .g-btn--primary');
  expect(hover).toBeTruthy();
  const css = readFileSync(join(__dirname, "../controls/controls.css"), "utf8");
  const rule = css.match(/([^{}]+)\{\s*background: var\(--g-accent-hover\);\s*\}/);
  expect(rule?.[1]).toContain(".g-btn--primary:hover");
  const forced = rule?.[1].split(",").find((selector) => selector.includes("data-force-state"));
  expect(forced).toBeTruthy();
  expect(hover?.matches(forced!.trim())).toBe(true);
});

it("stories show only supported states with disabled and invalid semantics", () => {
  render(<Gallery />);
  const expected = {
    controls: { Button: "default hover focus active disabled", ButtonGroup: "default", Chip: "default", FilterChip: "default hover focus active disabled", Segmented: "default hover focus active", Switch: "default focus disabled" },
    inputs: { Avatar: "default", Input: "default focus disabled error", Textarea: "default focus disabled error", Kbd: "default", Lamp: "default loading error", Meter: "default", Select: "default focus disabled error" },
  };
  for (const family of ["controls", "inputs"] as const) {
    fireEvent.click(screen.getByRole("button", { name: de[`gallery.family.${family}`] }));
    for (const [name, states] of Object.entries(expected[family])) {
      const story = screen.getByRole("article", { name });
      expect([...story.querySelectorAll("[data-force-state]")].map((cell) => cell.getAttribute("data-force-state"))).toEqual(states.split(" "));
      expect(story.textContent).toContain(de["gallery.notApplicable"]);
      const disabled = story.querySelector('[data-force-state="disabled"] button, [data-force-state="disabled"] .g-inp');
      if (states.includes("disabled")) expect(disabled).toHaveProperty("disabled", true);
      if (["Input", "Textarea", "Select"].includes(name)) {
        const invalid = story.querySelector('[data-force-state="error"] .g-inp');
        expect(invalid?.getAttribute("aria-invalid")).toBe("true");
        expect(document.getElementById(invalid!.getAttribute("aria-describedby")!)?.textContent).toBe(de["gallery.state.error"]);
      }
    }
  }
});
