import { readFileSync } from "node:fs";
import { join } from "node:path";
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
