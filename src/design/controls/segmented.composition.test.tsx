import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Segmented } from "./Segmented";

const options = [
  { value: "a", label: "First" },
  { value: "b", label: "Second" },
] as const;

describe("Segmented", () => {
  it("does not move the selection while an IME composition is active", () => {
    const onChange = vi.fn();
    const Harness = () => {
      const [value, setValue] = useState<"a" | "b">("a");
      return (
        <Segmented
          aria-label="Choice"
          options={options}
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    };
    render(<Harness />);
    const radios = screen.getAllByRole("radio");

    for (const key of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"]) {
      const proceeded = fireEvent.keyDown(radios[0], { key, isComposing: true });
      expect(onChange, key).not.toHaveBeenCalled();
      expect(radios[0], key).toHaveAttribute("aria-checked", "true");
      expect(proceeded, key).toBe(true);
    }

    const proceeded = fireEvent.keyDown(radios[0], { key: "ArrowRight" });
    expect(proceeded).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("b");
    expect(radios[1]).toHaveAttribute("aria-checked", "true");
    expect(radios[0]).toHaveAttribute("aria-checked", "false");
  });
});
