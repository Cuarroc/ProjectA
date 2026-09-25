import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";

import { focusableWithin, trapTarget, useFocusTrap } from "./useFocusTrap";

function Dialog({ withAutoFocus = false }: { withAutoFocus?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(ref);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Probe">
      <button type="button">Erster</button>
      <input aria-label="Mitte" autoFocus={withAutoFocus} />
      <button type="button" disabled>
        Tot
      </button>
      <button type="button">Letzter</button>
    </div>
  );
}

function Host({ open, withAutoFocus = false }: { open: boolean; withAutoFocus?: boolean }) {
  return (
    <>
      <button type="button">Öffner</button>
      {open ? <Dialog withAutoFocus={withAutoFocus} /> : null}
    </>
  );
}

const flushFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

describe("trapTarget (pure part of the trap)", () => {
  const a = document.createElement("button");
  const b = document.createElement("button");
  const c = document.createElement("button");

  it("wraps Tab from the last control to the first and Shift+Tab from the first to the last", () => {
    expect(trapTarget([a, b, c], c, false)).toBe(a);
    expect(trapTarget([a, b, c], a, true)).toBe(c);
  });

  it("lets the browser handle Tab inside the list", () => {
    expect(trapTarget([a, b, c], b, false)).toBeNull();
    expect(trapTarget([a, b, c], b, true)).toBeNull();
  });

  it("pulls focus in when it is outside, and does nothing for an empty dialog", () => {
    expect(trapTarget([a, b, c], document.body, false)).toBe(a);
    expect(trapTarget([a, b, c], document.body, true)).toBe(c);
    expect(trapTarget([], a, false)).toBeNull();
  });
});

describe("useFocusTrap (APP-7 / APP-18)", () => {
  it("moves focus into the dialog when nothing inside claimed it", async () => {
    render(<Host open />);
    screen.getByRole("button", { name: "Öffner" }).focus();
    await flushFrame();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Erster" }));
  });

  it("leaves a dialog's own autofocus alone", async () => {
    render(<Host open withAutoFocus />);
    await flushFrame();
    expect(document.activeElement).toBe(screen.getByLabelText("Mitte"));
  });

  it("skips disabled controls and wraps at both edges", async () => {
    render(<Host open />);
    await flushFrame();
    const dialog = screen.getByRole("dialog");
    expect(focusableWithin(dialog).map((node) => node.textContent || node.getAttribute("aria-label"))).toEqual([
      "Erster",
      "Mitte",
      "Letzter",
    ]);
    screen.getByRole("button", { name: "Letzter" }).focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Erster" }));
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Letzter" }));
  });

  it("hands focus back to the opener when the dialog goes away", async () => {
    const { rerender } = render(<Host open={false} />);
    const opener = screen.getByRole("button", { name: "Öffner" });
    opener.focus();
    rerender(<Host open />);
    await flushFrame();
    expect(document.activeElement).not.toBe(opener);
    rerender(<Host open={false} />);
    expect(document.activeElement).toBe(opener);
  });
});
