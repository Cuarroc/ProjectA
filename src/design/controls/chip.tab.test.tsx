import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Chip } from "./Chip";

describe("Chip tab order", () => {
  it("renders no tabindex attribute by default", () => {
    render(<Chip>tag</Chip>);
    const chip = screen.getByText("tag");
    expect(chip.tagName).toBe("SPAN");
    expect(chip.hasAttribute("tabindex")).toBe(false);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("stays out of the tab order when the caller passes a tab index", () => {
    // ChipProps omits tabIndex; spread an untyped bag to model a loose caller.
    const loose = { tabIndex: 0 } as object;
    render(<Chip {...loose}>tag</Chip>);
    const chip = screen.getByText("tag");
    expect(chip.hasAttribute("tabindex")).toBe(false);
  });
});
