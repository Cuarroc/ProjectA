import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./Button";

describe("Button loading", () => {
  it("loading sets aria-busy and blocks a second click", () => {
    const onClick = vi.fn();
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    const { rerender } = render(
      <form onSubmit={onSubmit}><Button type="submit" onClick={onClick}>Speichern</Button></form>,
    );
    const idle = screen.getByRole("button", { name: "Speichern" });
    expect(idle).not.toHaveAttribute("aria-busy");
    fireEvent.click(idle);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<form onSubmit={onSubmit}><Button type="submit" loading onClick={onClick}>Speichern</Button></form>);
    const busy = screen.getByRole("button", { name: "Speichern" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    // Not `disabled`: focus stays on the button while it works.
    expect(busy).not.toBeDisabled();
    fireEvent.click(busy);
    fireEvent.click(busy);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("keeps the label in place so the width does not change", () => {
    const { container } = render(<Button loading>Speichern</Button>);
    expect(screen.getByText("Speichern")).toBeInTheDocument();
    expect(container.querySelector(".g-btn__busy")).toHaveAttribute("aria-hidden", "true");
  });
});
