import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { Lamp, type LampState } from "./Lamp";

const modifiers = (el: HTMLElement) => el.className.split(/\s+/).filter((name) => name.startsWith("g-lamp--"));

it("draws an unknown lamp state as the neutral unknown lamp", () => {
  render(
    <>
      <Lamp state={"nope" as "ok"} label="Status" />
      <Lamp state="warn" label="Warn" />
    </>,
  );
  expect(modifiers(screen.getByRole("img", { name: "Status" }))).toEqual(["g-lamp--unknown"]);
  expect(screen.getByRole("img", { name: "Warn" })).toHaveClass("g-lamp--warn");
  // Closed muted ring like .g-glyph--unknown: neither the solid ok disc nor the open busy ring.
  const css = readFileSync(resolve(__dirname, "inputs.css"), "utf8");
  expect(css).toMatch(/\.g-lamp--unknown \{\s*background: none;\s*border: 2px solid var\(--g-muted\);\s*\}/);
});

it("a missing state is not the ok lamp", () => {
  render(<Lamp state={undefined as unknown as LampState} label="Status" />);
  expect(modifiers(screen.getByRole("img", { name: "Status" }))).toEqual(["g-lamp--unknown"]);
});
