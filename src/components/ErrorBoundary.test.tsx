import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ErrorBoundary from "./ErrorBoundary";

function Bomb(): never {
  throw new Error("Test-Boom");
}

describe("ErrorBoundary", () => {
  it("uses a focused design reload control and preserves crash details", () => {
    const noise = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reload = vi.fn();
    try {
      const view = render(<ErrorBoundary label="Die Testansicht"><Bomb /></ErrorBoundary>);
      const button = screen.getByRole("button", { name: "Neu laden" });
      expect(button).toHaveClass("g-btn", "g-btn--primary");
      expect(button).toHaveFocus();
      expect(screen.getByRole("heading", { name: "Die Testansicht ist abgestürzt." })).toBeVisible();
      expect(screen.getByRole("alert")).toHaveTextContent("Test-Boom");
      expect(view.container.querySelector('[class*="error-boundary"], .empty-action, .btn, .field')).toBeNull();
      vi.stubGlobal("window", Object.create(window, { location: { value: { reload } } }));
      fireEvent.click(button);
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      noise.mockRestore();
    }
  });

  it("fängt einen Render-Fehler und zeigt die Fehlerfläche statt eines weißen Fensters", () => {
    // React logs a caught error to the console as well — noise, not a failure.
    const noise = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <ErrorBoundary label="Die Testansicht">
        <Bomb />
      </ErrorBoundary>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Die Testansicht ist abgestürzt.");
    expect(alert).toHaveTextContent("Test-Boom");
    expect(screen.getByRole("button", { name: "Neu laden" })).toBeInTheDocument();

    noise.mockRestore();
  });

  it("zeigt ohne Label die App-weite Zeile", () => {
    const noise = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Die Oberfläche ist abgestürzt.");

    noise.mockRestore();
  });

  it("rendert die Kinder, solange nichts wirft", () => {
    render(
      <ErrorBoundary>
        <p>alles gut</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText("alles gut")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
