import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Meter } from "./Meter";

describe("Meter unknown tone", () => {
  it("draws an unknown meter tone as the neutral bar", () => {
    const { rerender } = render(<Meter aria-label="Quota" value={40} tone={"nope" as "hot"} />);
    const meter = screen.getByRole("meter", { name: "Quota" });
    expect(meter).toHaveAttribute("aria-valuenow", "40");
    const bar = meter.firstElementChild as HTMLElement;
    expect(bar).toHaveStyle({ width: "40%" });
    expect(bar.className).not.toContain("g-meter--");
    rerender(<Meter aria-label="Quota" value={40} tone="hot" />);
    expect(screen.getByRole("meter", { name: "Quota" }).firstElementChild).toHaveClass("g-meter--hot");
  });
});
