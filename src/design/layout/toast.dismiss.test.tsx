import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { de } from "../../i18n/de";
import { saveMotionMode } from "../motion/motionMode";
import { EXIT_MS } from "../motion/useExitTransition";
import { ToastRegion } from "./Toast";

describe("Toast dismiss", () => {
  afterEach(() => vi.useRealTimers());

  it("dismisses a toast once when the close button is used before the timer", () => {
    vi.useFakeTimers();
    const dismissed: number[] = [];
    render(
      <ToastRegion
        toasts={[{ id: 7, text: "Gespeichert", tone: "ok" }]}
        ttl={1000}
        onDismiss={(id) => { dismissed.push(id); }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: de["action.close"] }));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(dismissed).toEqual([7]);
  });

  it("Toast stays mounted while closing and then dismisses once", () => {
    vi.useFakeTimers();
    const dismissed: number[] = [];
    render(<ToastRegion toasts={[{ id: 7, text: "Gespeichert", tone: "ok" }]} ttl={1000} onDismiss={(id) => { dismissed.push(id); }} />);
    fireEvent.click(screen.getByRole("button", { name: de["action.close"] }));
    const toast = screen.getByText("Gespeichert").parentElement as HTMLElement;
    expect(toast).toHaveAttribute("data-state", "closing");
    expect(toast).toHaveAttribute("aria-hidden", "true");
    expect(dismissed).toEqual([]);
    act(() => { vi.advanceTimersByTime(EXIT_MS); });
    expect(dismissed).toEqual([7]);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(dismissed).toEqual([7]);
  });

  it("Toast dismisses at once when motion is off", () => {
    saveMotionMode("off");
    const dismissed: number[] = [];
    render(<ToastRegion toasts={[{ id: 7, text: "Gespeichert", tone: "ok" }]} ttl={1000} onDismiss={(id) => { dismissed.push(id); }} />);
    fireEvent.click(screen.getByRole("button", { name: de["action.close"] }));
    expect(dismissed).toEqual([7]);
    saveMotionMode("calm");
  });
});
