import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";

import { SwitchField } from "./SwitchField";

function Harness({ onChange }: { onChange?: (v: boolean) => void }) {
  const [on, setOn] = useState(false);
  return <SwitchField label="Remote view" checked={on} onCheckedChange={(next) => { setOn(next); onChange?.(next); }} />;
}

it("label and state word are one control", () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  const control = screen.getByRole("switch", { name: "Remote view" }) as HTMLInputElement;
  expect(control.tagName).toBe("INPUT");
  expect(control).not.toBeChecked();
  expect(screen.getByText("Aus")).toBeVisible();
  // The state word sits inside the label, so clicking it toggles the switch.
  fireEvent.click(screen.getByText("Aus"));
  expect(onChange).toHaveBeenLastCalledWith(true);
  expect(control).toBeChecked();
  expect(screen.getByText("An")).toBeVisible();
  fireEvent.click(screen.getByText("Remote view"));
  expect(control).not.toBeChecked();
});

it("keeps the accessible name free of the state word and passes native attributes", () => {
  render(<SwitchField label="Remote view" checked disabled aria-describedby="why" onCheckedChange={() => {}} />);
  const control = screen.getByRole("switch", { name: "Remote view" });
  expect(control).toBeDisabled();
  expect(control).toHaveAttribute("aria-describedby", "why");
});
