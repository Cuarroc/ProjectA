import { fireEvent, render, screen } from "@testing-library/react";
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
});
