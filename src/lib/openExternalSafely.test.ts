import { beforeEach, describe, expect, it, vi } from "vitest";

import { openExternal } from "./ipc";
import { openExternalSafely } from "./openExternalSafely";

vi.mock("./ipc", () => ({
  openExternal: vi.fn(),
  describeError: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
}));

describe("openExternalSafely", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("meldet eine abgelehnte Adresse, statt sie folgenlos verpuffen zu lassen", async () => {
    vi.mocked(openExternal).mockRejectedValueOnce(new Error("Browser blockiert"));
    const reportError = vi.fn();

    await openExternalSafely("https://example.org", reportError);

    expect(reportError).toHaveBeenCalledTimes(1);
    const message = reportError.mock.calls[0][0] as string;
    expect(message).toContain("example.org");
    // Ursache und naechster Schritt, wie bei jedem Attention-Eintrag.
    expect(message).toContain("—");
    expect(message).toMatch(/von Hand/);
  });

  /**
   * `ipc.ts::openExternal` gibt fuer alles ausser `http(s)` still zurueck - kein
   * Wurf, kein Log, nichts. Die Vorarbeit hat nur `catch` verdrahtet und diese
   * Haelfte der Ablehnung deshalb weiter verschluckt. Genau das ist der Fall aus
   * dem Plan: "eine abgelehnte URL darf nicht folgenlos verpuffen".
   */
  it.each([
    ["javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["file:///C:/Windows/System32/cmd.exe"],
    ["mailto:jemand@example.org"],
    [""],
  ])("meldet die stille Schema-Ablehnung von %s", async (url) => {
    const reportError = vi.fn();

    await openExternalSafely(url, reportError);

    expect(openExternal).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0]).toMatch(/http\(s\)/);
  });

  it("öffnet eine gültige Adresse und meldet nichts", async () => {
    vi.mocked(openExternal).mockResolvedValueOnce(undefined);
    const reportError = vi.fn();

    await openExternalSafely("https://example.org/board", reportError);

    expect(openExternal).toHaveBeenCalledWith("https://example.org/board");
    expect(reportError).not.toHaveBeenCalled();
  });

  it("kürzt eine sehr lange Adresse, statt die Meldung zu sprengen", async () => {
    vi.mocked(openExternal).mockRejectedValueOnce(new Error("blockiert"));
    const reportError = vi.fn();
    const long = `https://example.org/${"x".repeat(300)}`;

    await openExternalSafely(long, reportError);

    const message = reportError.mock.calls[0][0] as string;
    expect(message.length).toBeLessThan(200);
    expect(message).toContain("…");
  });
});
