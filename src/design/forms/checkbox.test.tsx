import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";

import { Checkbox, type CheckboxState } from "./Checkbox";

const css = readFileSync(resolve(__dirname, "forms.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function Harness({ start = false, onChange }: { start?: CheckboxState; onChange?: (next: boolean) => void }) {
  const [checked, setChecked] = useState<CheckboxState>(start);
  return <Checkbox label="Agree" checked={checked} onCheckedChange={(next) => { setChecked(next); onChange?.(next); }} />;
}

it("toggles with Space and supports mixed", () => {
  const onChange = vi.fn();
  render(<Harness start="mixed" onChange={onChange} />);
  const box = screen.getByRole("checkbox", { name: "Agree" }) as HTMLInputElement;
  expect(box.tagName).toBe("INPUT");
  expect(box).toBePartiallyChecked();
  expect(box).toHaveAttribute("aria-checked", "mixed");
  expect(box.indeterminate).toBe(true);
  box.focus();
  // jsdom does not turn Space into a click; a browser does for a native checkbox, so Space must stay unhandled.
  expect(fireEvent.keyDown(box, { key: " ", code: "Space" })).toBe(true);
  expect(fireEvent.keyUp(box, { key: " ", code: "Space" })).toBe(true);
  fireEvent.click(box);
  expect(onChange).toHaveBeenLastCalledWith(true);
  expect(box).toBeChecked();
  expect(box).not.toHaveAttribute("aria-checked", "mixed");
  expect(box.indeterminate).toBe(false);
  fireEvent.click(box);
  expect(onChange).toHaveBeenLastCalledWith(false);
  expect(box).not.toBeChecked();
});

it("toggles when its label text is clicked", () => {
  render(<Harness />);
  fireEvent.click(screen.getByText("Agree"));
  expect(screen.getByRole("checkbox")).toBeChecked();
});

it("does not toggle while disabled", () => {
  const onChange = vi.fn();
  render(<Checkbox label="Agree" checked={false} disabled onCheckedChange={onChange} />);
  const box = screen.getByRole("checkbox");
  expect(box).toBeDisabled();
  fireEvent.click(screen.getByText("Agree"));
  expect(onChange).not.toHaveBeenCalled();
});

it("draws its states from the native input and tokens only", () => {
  for (const selector of [":checked", ":indeterminate", ":focus-visible", ":disabled"]) expect(css, selector).toContain(selector);
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
});
