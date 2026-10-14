import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { de } from "../../i18n/de";
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
});
