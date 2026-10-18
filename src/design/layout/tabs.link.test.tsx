import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TabLinks } from "./Tabs";

const tabs = [
  { id: "a", label: "Haupt", href: "#/a" },
  { id: "b", label: "Linie", href: "#/b" },
  { id: "c", label: "Klassisch", href: "#/c" },
] as const;

describe("TabLinks", () => {
  it("link tabs share the tab keyboard model", () => {
    render(<TabLinks aria-label="Ansichten" tabs={tabs} value="b" />);
    const [a, b, c] = screen.getAllByRole("link");
    expect(screen.getByRole("navigation", { name: "Ansichten" })).toHaveClass("g-tabs");
    // One tab stop (the current link), like Tabs; the current one says so.
    expect([a, b, c].map((l) => l.tabIndex)).toEqual([-1, 0, -1]);
    expect(b).toHaveAttribute("aria-current", "page");
    expect(a).not.toHaveAttribute("aria-current");
    expect(b).toHaveAttribute("href", "#/b");

    b.focus();
    fireEvent.keyDown(b, { key: "ArrowRight" });
    expect(c).toHaveFocus();
    fireEvent.keyDown(c, { key: "ArrowRight" });
    expect(a).toHaveFocus();
    fireEvent.keyDown(a, { key: "ArrowLeft" });
    expect(c).toHaveFocus();
    fireEvent.keyDown(c, { key: "Home" });
    expect(a).toHaveFocus();
    fireEvent.keyDown(a, { key: "End" });
    expect(c).toHaveFocus();
  });

  it("makes the first link the tab stop when the value matches none", () => {
    render(<TabLinks aria-label="Ansichten" tabs={tabs} value="x" />);
    expect(screen.getAllByRole("link").map((l) => l.tabIndex)).toEqual([0, -1, -1]);
    expect(document.querySelector("[aria-current]")).toBeNull();
  });

  it("moves the one tab stop with arrow focus and returns it on blur", () => {
    render(<><TabLinks aria-label="Ansichten" tabs={tabs} value="b" /><button>danach</button></>);
    const [a, b, c] = screen.getAllByRole("link");
    const stops = () => [a, b, c].map((l) => l.tabIndex);
    b.focus();
    fireEvent.keyDown(b, { key: "ArrowRight" });
    // Tab and Shift+Tab both leave the group: c is the only stop; aria-current stays on b.
    expect(stops()).toEqual([-1, -1, 0]);
    expect(b).toHaveAttribute("aria-current", "page");
    expect(c).not.toHaveAttribute("aria-current");
    act(() => screen.getByRole("button", { name: "danach" }).focus());
    expect(stops()).toEqual([-1, 0, -1]);
  });
});
