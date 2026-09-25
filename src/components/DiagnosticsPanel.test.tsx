import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DiagnosticsPanel from "./DiagnosticsPanel";

vi.mock("../lib/ipc", () => ({
  describeError: (error: unknown) => String(error),
  getLogPath: () => Promise.resolve("C:\\\\AppData\\\\ProjectA\\\\logs\\\\projecta.log"),
  getPanicNotice: () =>
    Promise.resolve({ current: "PANIC: test boom", previous: null }),
  getReasonCatalog: () =>
    Promise.resolve([
      {
        code: "quota_blocked",
        grade: "blocking",
        line: "Kontingent oder Rate-Limit erreicht — warte auf das nächste Zeitfenster",
      },
      {
        code: "idle_at_prompt",
        grade: "attention",
        line: "Der Agent wartet am Prompt — gib ihm im Terminal den nächsten Schritt",
      },
    ]),
  exportDiagnosis: () => Promise.resolve("{}"),
  revealLogPath: () => Promise.resolve(),
}));

describe("DiagnosticsPanel", () => {
  it("shows a previous-run panic, the log path, and every catalogued reason-code", async () => {
    render(<DiagnosticsPanel />);

    await waitFor(
      () => {
        expect(
          screen.getByRole("heading", { name: /letzte Lauf ist abgestürzt/i }),
        ).toBeInTheDocument();
      },
      // Under full-suite parallel load the mocked read resolves later than
      // the default 1 s window (flaked once in the r25 gate run).
      { timeout: 5000 },
    );
    expect(screen.getByText("PANIC: test boom")).toBeInTheDocument();
    expect(screen.getByTestId("log-path").textContent).toMatch(/projecta\.log/);
    expect(screen.getByText("quota_blocked")).toBeInTheDocument();
    expect(screen.getByText("idle_at_prompt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pfad kopieren/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Im Explorer zeigen/i })).toBeEnabled();
  });
});
