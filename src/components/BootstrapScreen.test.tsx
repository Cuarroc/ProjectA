import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BootstrapScreen from "./BootstrapScreen";

describe("BootstrapScreen", () => {
  it("uses design controls without classic classes across loading and retry", () => {
    const onRetry = vi.fn();
    const view = render(<BootstrapScreen error={false} onRetry={onRetry} />);
    expect(screen.getByRole("heading", { name: "ProjectA" })).toBeVisible();
    expect(view.container.querySelector('[class*="bootstrap-"], .btn, .field')).toBeNull();
    view.rerender(<BootstrapScreen error onRetry={onRetry} />);
    const retry = screen.getByRole("button", { name: "Erneut versuchen" });
    expect(retry).toHaveClass("g-btn", "g-btn--primary");
    expect(retry).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Arbeitsbereich konnte nicht geladen werden" })).toBeVisible();
    expect(view.container.querySelector('[class*="bootstrap-"], .btn, .field')).toBeNull();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("announces real loading without exposing a retry action", () => {
    render(<BootstrapScreen error={false} onRetry={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("Arbeitsbereich wird geladen");
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("button", { name: "Erneut versuchen" })).not.toBeInTheDocument();
  });

  it("offers a focused retry after an error", () => {
    const onRetry = vi.fn();
    render(<BootstrapScreen error onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Arbeitsbereich konnte nicht geladen werden");
    const retry = screen.getByRole("button", { name: "Erneut versuchen" });
    expect(retry).toHaveFocus();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
