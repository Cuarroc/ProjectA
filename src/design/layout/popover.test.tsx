import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { saveMotionMode } from "../motion/motionMode";
import { EXIT_MS } from "../motion/useExitTransition";
import { Popover } from "./Popover";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); saveMotionMode("calm"); });

const Harness = ({ onChange = () => {}, align }: { onChange?: (open: boolean) => void; align?: "start" | "end" }) => {
  const [open, setOpen] = useState(false);
  const set = (next: boolean) => { onChange(next); setOpen(next); };
  return (
    <>
      <button>Outside</button>
      <Popover
        open={open} onOpenChange={set} align={align}
        trigger={(p) => <button {...p} onClick={() => set(!open)}>Menu</button>}
      >
        <button>Item</button>
      </Popover>
    </>
  );
};
const trigger = () => screen.getByRole("button", { name: "Menu" });
const openIt = () => { trigger().focus(); fireEvent.click(trigger()); };

describe("Popover", () => {
  it("Escape closes and returns focus to the trigger", () => {
    render(<Harness />);
    openIt();
    const item = screen.getByRole("button", { name: "Item" });
    item.focus();
    fireEvent.keyDown(item, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Item" })).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("outside pointerdown closes once", () => {
    const seen: boolean[] = [];
    render(<Harness onChange={(o) => seen.push(o)} />);
    openIt();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Item" }));
    expect(seen).toEqual([true]);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(seen).toEqual([true, false]);
  });

  it("wires aria-expanded and aria-controls from the trigger to the panel", () => {
    render(<Harness />);
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    openIt();
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("button", { name: "Item" }).parentElement!;
    expect(trigger()).toHaveAttribute("aria-controls", panel.id);
  });

  it("leaves Tab to the next control and closes without taking focus back", () => {
    render(<Harness />);
    openIt();
    const item = screen.getByRole("button", { name: "Item" });
    item.focus();
    screen.getByRole("button", { name: "Outside" }).focus();
    expect(screen.queryByRole("button", { name: "Item" })).toBeNull();
    expect(screen.getByRole("button", { name: "Outside" })).toHaveFocus();
  });

  it("flips above when there is no room below and room above", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 700, bottom: 740, left: 0, right: 10, width: 10, height: 40, x: 0, y: 700, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(200);
    vi.stubGlobal("innerHeight", 768);
    render(<Harness align="end" />);
    openIt();
    const panel = screen.getByRole("button", { name: "Item" }).parentElement!;
    expect(panel).toHaveAttribute("data-side", "top");
    expect(panel).toHaveAttribute("data-align", "end");
    vi.unstubAllGlobals();
  });

  it("stays mounted for the exit time and unmounts at once when motion is off", () => {
    vi.useFakeTimers();
    render(<Harness />);
    openIt();
    fireEvent.keyDown(screen.getByRole("button", { name: "Item" }), { key: "Escape" });
    const panel = screen.getByRole("button", { name: "Item", hidden: true }).parentElement!;
    expect(panel).toHaveAttribute("data-state", "closing");
    expect(panel).toHaveAttribute("aria-hidden", "true");
    act(() => { vi.advanceTimersByTime(EXIT_MS); });
    expect(screen.queryByRole("button", { name: "Item", hidden: true })).toBeNull();
    saveMotionMode("off");
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(screen.queryByRole("button", { name: "Item", hidden: true })).toBeNull();
  });
});
