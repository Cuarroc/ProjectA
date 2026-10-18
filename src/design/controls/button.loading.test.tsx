import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("keeps its accessible name once the control styles apply", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync(resolve(__dirname, "controls.css"), "utf8");
    document.head.append(style);
    try {
      render(<Button loading>Speichern</Button>);
      expect(screen.getByRole("button", { name: "Speichern" })).toBeInTheDocument();
    } finally {
      style.remove();
    }
  });

  it("wraps an icon-and-text label the same way idle and busy", () => {
    const label = <><svg data-testid="ic" /><span>Speichern</span></>;
    const { rerender } = render(<Button>{label}</Button>);
    const idle = screen.getByRole("button").querySelector(".g-btn__label")?.innerHTML;
    expect(idle).toContain("Speichern");
    rerender(<Button loading>{label}</Button>);
    expect(screen.getByRole("button").querySelector(".g-btn__label")?.innerHTML).toBe(idle);
  });
});
