import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BootstrapScreen from "./BootstrapScreen";

describe("BootstrapScreen", () => {
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
