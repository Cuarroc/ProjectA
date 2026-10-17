import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";

import { RadioGroup } from "./RadioGroup";

const options = [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma" }] as const;

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState<"a" | "b" | "c">("a");
  return <RadioGroup aria-label="Pick" options={options} value={v} onChange={(next) => { setV(next); onChange?.(next); }} />;
}

it("one tab stop; arrows move and select; Home and End jump", () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  expect(screen.getByRole("radiogroup", { name: "Pick" })).toBeInTheDocument();
  const radios = screen.getAllByRole("radio");
  expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  fireEvent.keyDown(radios[0], { key: "ArrowDown" });
  expect(radios[1]).toBeChecked();
  expect(radios[1]).toHaveFocus();
  expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  fireEvent.keyDown(radios[1], { key: "ArrowLeft" });
  fireEvent.keyDown(radios[0], { key: "ArrowUp" });
  expect(radios[2]).toBeChecked();
  fireEvent.keyDown(radios[2], { key: "Home" });
  expect(radios[0]).toBeChecked();
  fireEvent.keyDown(radios[0], { key: "End" });
  expect(radios[2]).toBeChecked();
  expect(onChange).toHaveBeenLastCalledWith("c");
});

it("ignores arrows during IME composition and selects on click", () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  const radios = screen.getAllByRole("radio");
  fireEvent.keyDown(radios[0], { key: "ArrowDown", isComposing: true });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Gamma"));
  expect(radios[2]).toBeChecked();
});
