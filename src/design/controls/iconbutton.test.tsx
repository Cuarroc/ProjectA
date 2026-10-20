import { render, screen } from "@testing-library/react";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("requires an accessible name", () => {
    render(<IconButton aria-label="Schließen"><svg aria-hidden="true" /></IconButton>);
    const b = screen.getByRole("button", { name: "Schließen" });
    expect(b).toHaveClass("g-btn", "g-btn--icon", "g-btn--ghost");
    expect(b).toHaveAttribute("type", "button");

    // The type forbids a missing name; at runtime a blank one fails loudly while developing.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expectTypeOf<{ children: ReactNode }>().not.toMatchTypeOf<ComponentProps<typeof IconButton>>();
    const Unnamed = IconButton as unknown as ComponentType<{ children: ReactNode }>;
    expect(() => render(<Unnamed><svg aria-hidden="true" /></Unnamed>)).toThrow(/aria-label/);
    expect(() => render(<IconButton aria-label="  "><svg aria-hidden="true" /></IconButton>)).toThrow(/aria-label/);
    quiet.mockRestore();
  });

  it("takes the Button variants and sizes", () => {
    render(<IconButton aria-label="Neu" variant="primary" size="lg"><svg aria-hidden="true" /></IconButton>);
    expect(screen.getByRole("button", { name: "Neu" })).toHaveClass("g-btn--primary", "g-btn--lg", "g-btn--icon");
  });
});
