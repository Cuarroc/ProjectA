import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Tooltip } from "./Tooltip";

afterEach(() => { cleanup(); vi.useRealTimers(); document.documentElement.style.removeProperty("--g-dur-4"); });

const Harness = () => (
  <Tooltip content="Alle Agenten stoppen">
    {(p) => <button {...p}>Stopp</button>}
  </Tooltip>
);
const button = () => screen.getByRole("button", { name: "Stopp" });

describe("Tooltip", () => {
  it("opens on focus and closes on Escape", () => {
    const outer = vi.fn();
    render(<div onKeyDown={outer}><Harness /></div>);
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => button().focus());
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Alle Agenten stoppen");
    expect(button()).toHaveAttribute("aria-describedby", tip.id);
    fireEvent.keyDown(button(), { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button()).not.toHaveAttribute("aria-describedby");
    expect(outer).not.toHaveBeenCalled();
    fireEvent.keyDown(button(), { key: "Escape" });
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it("closes on blur", () => {
    render(<Harness />);
    act(() => button().focus());
    act(() => button().blur());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens on hover after the delay token and closes on leave", () => {
    vi.useFakeTimers();
    document.documentElement.style.setProperty("--g-dur-4", "480ms");
    render(<Harness />);
    fireEvent.mouseEnter(button());
    act(() => { vi.advanceTimersByTime(479); });
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.mouseLeave(button());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("leaving before the delay never opens it", () => {
    vi.useFakeTimers();
    document.documentElement.style.setProperty("--g-dur-4", "480ms");
    render(<Harness />);
    fireEvent.mouseEnter(button());
    fireEvent.mouseLeave(button());
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
