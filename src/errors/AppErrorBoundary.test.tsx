import { render, cleanup, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { AppErrorBoundary } from "./AppErrorBoundary";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
it("reports the component stack of a render error", () => {
  const noise = vi.spyOn(console, "error").mockImplementation(() => {});
  const error = new Error("component stack crash");
  error.stack = "Error: component stack crash\n    at unrelated (helper.js:1:1)";
  function Bomb(): never { throw error; }
  try {
    render(<AppErrorBoundary><Bomb /></AppErrorBoundary>);
    expect(invoke).toHaveBeenLastCalledWith("log_frontend_error", expect.objectContaining({
      message: "component stack crash",
      stackFrame: expect.stringContaining("AppErrorBoundary"),
    }));
  } finally { cleanup(); noise.mockRestore(); }
});
it("logs a root render failure once and contains the crash", () => {
  const noise = vi.spyOn(console, "error").mockImplementation(() => {});
  const error = new Error("root crash");
  function Bomb(): never { throw error; }
  try {
    const view = render(<AppErrorBoundary><Bomb /></AppErrorBoundary>);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("log_frontend_error", expect.objectContaining({ message: "root crash" }));
    expect(view.getByRole("alert")).toHaveTextContent("Etwas ist schiefgelaufen.");
  } finally { cleanup(); noise.mockRestore(); }
});
it("shows a reload fallback after a render error", () => {
  const noise = vi.spyOn(console, "error").mockImplementation(() => {});
  const reload = vi.fn();
  vi.stubGlobal("location", { pathname: "/", reload });
  function Bomb(): never { throw new Error("fallback crash"); }
  try {
    const view = render(<AppErrorBoundary><Bomb /></AppErrorBoundary>);
    expect(view.getByRole("alert")).toHaveTextContent("Etwas ist schiefgelaufen.");
    fireEvent.click(view.getByRole("button", { name: "Neu laden" }));
    expect(reload).toHaveBeenCalledOnce();
  } finally { cleanup(); noise.mockRestore(); vi.unstubAllGlobals(); }
});
