import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Chip } from "./Chip";

describe("Chip tab order", () => {
  it("stays out of the tab order when the caller passes a tab index", () => {
    render(<Chip tabIndex={0}>tag</Chip>);
    const chip = screen.getByText("tag");
    expect(chip.tabIndex).toBe(-1);
    expect(chip.tagName).toBe("SPAN");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
