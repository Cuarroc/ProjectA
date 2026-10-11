import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exportDiagnosis, getLogPath, getPanicNotice, getReasonCatalog, revealLogPath } from "../../lib/ipc";
import { DiagnoseSection } from "./DiagnoseSection";

vi.mock("../../lib/ipc", () => ({
  describeError: String,
  getLogPath: vi.fn(),
  getPanicNotice: vi.fn(),
  getReasonCatalog: vi.fn(),
  exportDiagnosis: vi.fn(),
  revealLogPath: vi.fn(),
}));

const CATALOG = [
  { code: "quota_blocked", grade: "blocking", line: "Kontingent erreicht" },
  { code: "idle_at_prompt", grade: "attention", line: "Agent wartet am Prompt" },
] as const;

beforeEach(() => {
  vi.mocked(getLogPath).mockReset().mockResolvedValue("logs/projecta.log");
  vi.mocked(getPanicNotice).mockReset().mockResolvedValue({ current: null, previous: null });
  vi.mocked(getReasonCatalog).mockReset().mockResolvedValue([...CATALOG]);
  vi.mocked(exportDiagnosis).mockReset().mockResolvedValue("{}");
  vi.mocked(revealLogPath).mockReset().mockResolvedValue();
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe("DiagnoseSection data", () => {
  it("shows the log path and every reason code with grade and line", async () => {
    render(<DiagnoseSection />);
    expect(await screen.findByText("logs/projecta.log")).toBeInTheDocument();
    expect(screen.getByText("Warum? Reason-Codes (2)")).toBeInTheDocument();
    expect(screen.getByText("quota_blocked").parentElement).toHaveTextContent("Blockiert");
    expect(screen.getByText("Agent wartet am Prompt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pfad kopieren" })).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the crash notice of this or the previous run, and none when clean", async () => {
    vi.mocked(getPanicNotice).mockResolvedValue({ current: null, previous: "PANIC: boom" });
    render(<DiagnoseSection />);
    expect(await screen.findByText("PANIC: boom")).toBeInTheDocument();
    expect(screen.getByText("Der letzte Lauf ist abgestürzt")).toBeInTheDocument();
    cleanup();
    vi.mocked(getPanicNotice).mockResolvedValue({ current: null, previous: null });
    render(<DiagnoseSection />);
    await screen.findByText("logs/projecta.log");
    expect(screen.queryByText("Der letzte Lauf ist abgestürzt")).toBeNull();
  });

  it("says each unavailable read is unavailable and keeps the others", async () => {
    vi.mocked(getLogPath).mockRejectedValue(new Error("no tauri"));
    vi.mocked(getPanicNotice).mockRejectedValue(new Error("no tauri"));
    vi.mocked(getReasonCatalog).mockRejectedValue(new Error("no tauri"));
    render(<DiagnoseSection />);
    expect(await screen.findByText("Nur in der Desktop-App verfügbar.")).toBeInTheDocument();
    expect(screen.getByText("Absturzhinweis nicht lesbar.")).toBeInTheDocument();
    expect(screen.getByText("Reason-Codes nicht verfügbar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pfad kopieren" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ordner zeigen" })).toBeDisabled();
  });

  it("keeps the log path when only the reason catalog fails, and says an empty catalog is empty", async () => {
    vi.mocked(getReasonCatalog).mockResolvedValue([]);
    render(<DiagnoseSection />);
    expect(await screen.findByText("Keine Einträge.")).toBeInTheDocument();
    expect(screen.getByText("logs/projecta.log")).toBeInTheDocument();
  });

  it("drops late answers after unmount without touching state", async () => {
    const late = deferred<string>();
    vi.mocked(getLogPath).mockReturnValue(late.promise);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { unmount } = render(<DiagnoseSection />);
    unmount();
    await act(async () => { late.resolve("x"); await late.promise; });
    expect(err).not.toHaveBeenCalled();
  });
});

describe("DiagnoseSection actions", () => {
  it("exports the pack as a JSON download and is busy while running", async () => {
    const run = deferred<string>();
    vi.mocked(exportDiagnosis).mockReturnValue(run.promise);
    render(<DiagnoseSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Diagnosepaket exportieren" }));
    expect(screen.getByRole("button", { name: "Exportiere …" })).toBeDisabled();
    await act(async () => { run.resolve("{}"); await run.promise; });
    expect(await screen.findByText("Paket gespeichert.")).toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Diagnosepaket exportieren" })).toBeEnabled();
  });

  it("shows a failed export as an alert and lets the user retry", async () => {
    vi.mocked(exportDiagnosis).mockRejectedValueOnce(new Error("disk full"));
    render(<DiagnoseSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Diagnosepaket exportieren" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(screen.queryByText("Paket gespeichert.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Diagnosepaket exportieren" }));
    expect(await screen.findByText("Paket gespeichert.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("copies the path and says so, or says copying failed", async () => {
    const write = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    render(<DiagnoseSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Pfad kopieren" }));
    expect(await screen.findByRole("button", { name: "Kopiert" })).toBeInTheDocument();
    expect(write).toHaveBeenCalledWith("logs/projecta.log");
    fireEvent.click(screen.getByRole("button", { name: "Kopiert" }));
    expect(await screen.findByText("Kopieren nicht möglich.")).toBeInTheDocument();
  });

  it("reveals the log folder and shows a refusal as an alert", async () => {
    render(<DiagnoseSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Ordner zeigen" }));
    expect(revealLogPath).toHaveBeenCalledTimes(1);
    vi.mocked(revealLogPath).mockRejectedValueOnce(new Error("no file manager"));
    fireEvent.click(screen.getByRole("button", { name: "Ordner zeigen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no file manager");
  });
});
