import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
let reportFrontendError: typeof import("./reportFrontendError").reportFrontendError;
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
let dispose: () => void;
const prevent = (event: Event) => event.preventDefault();
beforeEach(async () => {
  vi.resetModules();
  const reporter = await import("./reportFrontendError");
  reportFrontendError = reporter.reportFrontendError;
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.mocked(invoke).mockClear();
  window.history.replaceState(null, "", "/?private=value#leitstand");
  window.addEventListener("error", prevent);
  dispose = reporter.installFrontendErrorHandlers();
});
afterEach(() => { dispose(); window.removeEventListener("error", prevent); vi.useRealTimers(); });
it("keeps the js frame next to the component stack", () => {
  const error = new Error("render failed");
  error.stack = "Error: render failed\n    at render (app.js:10:2)\n    at ignored";
  for (const [componentStack, suffix] of [["\n    at Widget", " | \n    at Widget"],
    [undefined, ""], ["", ""], ["界".repeat(300), ` | ${"界".repeat(162)}`]]) {
    reportFrontendError(error, componentStack);
    const { stackFrame } = vi.mocked(invoke).mock.lastCall?.[1] as { stackFrame: string };
    expect(stackFrame).toBe(`at render (app.js:10:2)${suffix}`);
    expect(new TextEncoder().encode(stackFrame).length).toBeLessThanOrEqual(512);
    vi.advanceTimersByTime(10_000);
  }
});
it("writes one log line per uncaught error", () => {
  const error = new Error("boom");
  error.stack = "Error: boom\n    at render (app.js:10:2)\n    at ignored";
  window.dispatchEvent(new ErrorEvent("error", { error, cancelable: true }));
  const rejection = new Event("unhandledrejection");
  Object.defineProperty(rejection, "reason", { value: "rejected" });
  window.dispatchEvent(rejection);
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenNthCalledWith(1, "log_frontend_error", {
    message: "boom", stackFrame: "at render (app.js:10:2)", route: "/",
  });
  expect(invoke).toHaveBeenNthCalledWith(2, "log_frontend_error", {
    message: "rejected", stackFrame: "", route: "/",
  });
});
it("rate limits a repeated error signature", () => {
  reportFrontendError("repeat");
  const before = performance.now();
  vi.advanceTimersByTime(9_999);
  expect(performance.now() - before).toBe(9_999);
  reportFrontendError("repeat");
  expect(invoke).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  reportFrontendError("repeat");
  expect(invoke).toHaveBeenCalledTimes(2);
});
it("allows at most fifty lines in a rolling minute", () => {
  for (let i = 0; i < 51; i++) reportFrontendError(`error ${i}`);
  expect(invoke).toHaveBeenCalledTimes(50);
  vi.advanceTimersByTime(59_999);
  reportFrontendError("still blocked");
  expect(invoke).toHaveBeenCalledTimes(50);
  vi.advanceTimersByTime(1);
  reportFrontendError("allowed again");
  expect(invoke).toHaveBeenCalledTimes(51);
});
it("contains hostile values and transport failures without recursive reporting", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("offline"));
  expect(() => reportFrontendError({ toString() { throw new Error("hostile"); } })).not.toThrow();
  await Promise.resolve();
  expect(invoke).toHaveBeenCalledTimes(1);
  dispose();
  window.dispatchEvent(new ErrorEvent("error", { message: "removed" }));
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("keeps all twenty recent signatures within the final escaped context budget", async () => {
  const { reportFrontendFeedback } = await import("./reportFrontendError");
  for (const payload of [".".repeat(156), '"'.repeat(156), "\\".repeat(156), "界😀".repeat(40)]) {
    vi.advanceTimersByTime(60_000);
    for (let i = 0; i <= 20; i++) reportFrontendError(`E${String(i).padStart(2, "0")}_${payload}`);
    await reportFrontendFeedback("report", "expected");
    const { context } = vi.mocked(invoke).mock.lastCall?.[1] as { context: string };
    // The native log field doubles quotes/backslashes before its 2048-byte cap.
    const escaped = context.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    expect(new TextEncoder().encode(escaped).length).toBeLessThanOrEqual(2048);
    expect(context).toMatch(/^sha="[^"]+" at="1970-01-01T/);
    expect(context.endsWith('"')).toBe(true);
    expect(context).not.toContain("E00_");
    for (let i = 1; i <= 20; i++) expect(context).toContain(`E${String(i).padStart(2, "0")}_`);
    expect(context.split(" | ")).toHaveLength(20);
    expect(context.match(/…/g)).toHaveLength(20);
    expect(context).not.toContain("\uFFFD");
  }
});
it("does not load the dev-only buildInfo module", async () => {
  vi.doMock("../dev/buildInfo", () => { throw new Error("dev-only module in the production error path"); });
  vi.resetModules();
  const reporter = await import("./reportFrontendError");
  expect(() => reporter.reportFrontendError("boom")).not.toThrow();
});
