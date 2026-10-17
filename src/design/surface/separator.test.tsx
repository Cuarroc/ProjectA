import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Separator } from "./Separator";

afterEach(cleanup);

describe("Separator", () => {
  it("is a semantic separator by default", () => {
    render(<Separator />);
    const sep = screen.getByRole("separator");
    expect(sep.tagName).toBe("HR");
    expect(sep.hasAttribute("aria-orientation")).toBe(false);
  });

  it("announces a vertical orientation", () => {
    render(<Separator orientation="vertical" />);
    expect(screen.getByRole("separator").getAttribute("aria-orientation")).toBe("vertical");
  });

  it("decorative separator is hidden from assistive tech", () => {
    const { container } = render(<Separator decorative />);
    expect(screen.queryByRole("separator")).toBeNull();
    const sep = container.firstElementChild!;
    expect(sep.getAttribute("aria-hidden")).toBe("true");
    expect(sep.getAttribute("role")).toBe("none");
  });
});
