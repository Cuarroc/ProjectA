import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ErrorBoundary from "./ErrorBoundary";

function Bomb(): never {
  throw new Error("Test-Boom");
}

describe("ErrorBoundary", () => {
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
