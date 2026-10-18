import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { Meter } from "./Meter";

it("fills with scaleX", () => {
  const { rerender } = render(<Meter aria-label="Quota" value={40} />);
  const bar = screen.getByRole("meter", { name: "Quota" }).firstElementChild as HTMLElement;
  expect(bar).toHaveStyle({ transform: "scaleX(0.4)" });
  expect(bar.style.width).toBe("");
  rerender(<Meter aria-label="Quota" value={250} />);
  expect(bar).toHaveStyle({ transform: "scaleX(1)" });
  rerender(<Meter aria-label="Quota" value={-5} />);
  expect(bar).toHaveStyle({ transform: "scaleX(0)" });
});
