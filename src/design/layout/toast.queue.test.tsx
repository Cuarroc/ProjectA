import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { saveMotionMode } from "../motion/motionMode";
import { EXIT_MS } from "../motion/useExitTransition";
import { ToastRegion } from "./Toast";
import { useToast } from "./useToast";

type Api = Omit<ReturnType<typeof useToast>, "region">;

function mountToasts(ttl = 60_000): Api {
  const api = {} as Api;
  const Harness = () => {
    const { region, ...rest } = useToast(ttl);
    Object.assign(api, rest);
    return region;
  };
  render(<Harness />);
  return api;
}

describe("useToast queue", () => {
  afterEach(() => { vi.useRealTimers(); saveMotionMode("calm"); });

  it("push returns an id and dismiss removes and action runs once", () => {
    vi.useFakeTimers();
    const api = mountToasts();
    const onAction = vi.fn();
    let id = 0;
    let second = 0;
    act(() => {
      id = api.push({ text: "Gespeichert", tone: "ok", action: { label: "Rückgängig", onAction } });
      second = api.push({ text: "Zweite" });
    });
    expect(typeof id).toBe("number");
    expect(second).not.toBe(id);
    const undo = screen.getByRole("button", { name: "Rückgängig" });
    fireEvent.click(undo);
    fireEvent.click(undo);
    expect(onAction).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(EXIT_MS); });
    expect(screen.queryByText("Gespeichert")).toBeNull();
    act(() => { api.dismiss(second); });
    expect(screen.getByText("Zweite").parentElement).toHaveAttribute("data-state", "closing");
    act(() => { vi.advanceTimersByTime(EXIT_MS); });
    expect(screen.queryByText("Zweite")).toBeNull();
  });

  it("dismisses once after a synchronous action error and keeps the error observable", () => {
    vi.useFakeTimers();
    const failure = new Error("Toast action failed");
    const onAction = vi.fn(() => { throw failure; });
    const onDismiss = vi.fn();
    const errors: unknown[] = [];
    const onWindowError = (event: ErrorEvent) => {
      errors.push(event.error);
      if (event.error === failure) event.preventDefault();
    };
    window.addEventListener("error", onWindowError);
    try {
      render(<ToastRegion toasts={[{ id: 7, text: "Gespeichert", tone: "ok", action: { label: "Rückgängig", onAction } }]} ttl={1000} onDismiss={onDismiss} />);
      const undo = screen.getByRole("button", { name: "Rückgängig" });
      fireEvent.click(undo);
      fireEvent.click(undo);
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(new Set(errors)).toEqual(new Set([failure]));
      expect(screen.getByText("Gespeichert").parentElement).toHaveAttribute("data-state", "closing");
      expect(onDismiss).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(EXIT_MS); });
      expect(screen.queryByText("Gespeichert")).toBeNull();
      expect(onDismiss.mock.calls).toEqual([[7]]);
      act(() => { vi.advanceTimersByTime(2000); });
      expect(onDismiss.mock.calls).toEqual([[7]]);
    } finally {
      window.removeEventListener("error", onWindowError);
    }
  });

  it("shows at most three toasts and the fourth waits until one leaves", () => {
    vi.useFakeTimers();
    const api = mountToasts();
    const ids: number[] = [];
    act(() => { for (const text of ["A", "B", "C", "D"]) ids.push(api.push({ text })); });
    expect(screen.getAllByRole("status")).toHaveLength(3);
    expect(screen.queryByText("D")).toBeNull();
    act(() => { api.dismiss(ids[0]); });
    act(() => { vi.advanceTimersByTime(EXIT_MS); });
    expect(screen.queryByText("A")).toBeNull();
    expect(screen.getByText("D")).toBeInTheDocument();
    act(() => { api.dismiss(ids[3]); api.dismiss(ids[1]); });
    act(() => { vi.advanceTimersByTime(EXIT_MS); });
    expect(screen.queryByText("D")).toBeNull();
    expect(screen.queryByText("B")).toBeNull();
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("a dismissed waiting toast never appears", () => {
    vi.useFakeTimers();
    const api = mountToasts();
    const ids: number[] = [];
    act(() => { for (const text of ["A", "B", "C", "D"]) ids.push(api.push({ text })); });
    act(() => { api.dismiss(ids[3]); });
    act(() => { api.dismiss(ids[0]); });
    act(() => { vi.advanceTimersByTime(EXIT_MS); });
    expect(screen.queryByText("A")).toBeNull();
    expect(screen.queryByText("D")).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("leaves without an exit animation when motion is off", () => {
    saveMotionMode("off");
    const api = mountToasts();
    let id = 0;
    act(() => { id = api.push({ text: "Weg" }); });
    expect(screen.getByText("Weg")).toBeInTheDocument();
    act(() => { api.dismiss(id); });
    expect(screen.queryByText("Weg")).toBeNull();
  });
});
