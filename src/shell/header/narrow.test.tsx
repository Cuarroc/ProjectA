import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppearanceControl } from "../AppearanceControl";
import { COMPACT_QUERY } from "../texts";
import { Shell } from "../Shell";

vi.mock("../../lib/ipc", () => ({ getEmergencyStop: vi.fn().mockResolvedValue(false), setEmergencyStop: vi.fn(), getQuotaState: vi.fn().mockResolvedValue([]), getProviderOverview: vi.fn().mockResolvedValue([]), describeError: String }));

/** jsdom has no layout: stand in for the viewport by answering the compact query. */
function viewport(compact: boolean) {
  const listeners = new Set<() => void>();
  let matches = compact;
  window.matchMedia = ((query: string) => ({
    get matches() { return query === COMPACT_QUERY && matches; },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  })) as unknown as typeof window.matchMedia;
  return (next: boolean) => act(() => { matches = next; listeners.forEach((fn) => fn()); });
}
const mount = () => act(async () => void render(<Shell />));

beforeEach(() => { localStorage.clear(); window.location.hash = ""; });
afterEach(() => { cleanup(); delete (window as { matchMedia?: unknown }).matchMedia; });

describe("narrow header", () => {
  // The name is referenced by a pushed Test-First trailer and cannot change. Root decision: the breakpoint stays 1599 px
  // (the controls fit from 1253 px, but search label/shortcut and quota status would disappear; V2-FU-HEADER-SPACE).
  it("collapses only where the full controls were measured not to fit 1250 px and below", () => {
    expect(COMPACT_QUERY).toBe("(max-width: 1599px)");
  });

  it("shows all three segmented groups at full width and no menu button", () => {
    viewport(false);
    render(<AppearanceControl />);
    expect(screen.getAllByRole("radiogroup")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Darstellung" })).toBeNull();
  });

  it("collapses the style group into one Darstellung menu below the breakpoint", () => {
    viewport(true);
    render(<AppearanceControl />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    const menu = screen.getByRole("button", { name: "Darstellung" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Stil" })).getByRole("radio", { name: "Nebel" }));
    expect(document.documentElement.dataset.glassVariant).toBe("nebel");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(menu).toHaveFocus();
  });

  it("closes the menu on a press outside and follows the viewport when it is resized", () => {
    const resize = viewport(true);
    render(<AppearanceControl />);
    fireEvent.click(screen.getByRole("button", { name: "Darstellung" }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    resize(false);
    expect(screen.getAllByRole("radiogroup")).toHaveLength(3);
  });

  it("closes the Darstellung menu when focus leaves it", () => {
    viewport(true);
    render(<AppearanceControl />);
    fireEvent.click(screen.getByRole("button", { name: "Darstellung" }));
    const inside = within(screen.getByRole("radiogroup", { name: "Stil" })).getByRole("radio", { name: "Nebel" });
    fireEvent.focusOut(inside, { relatedTarget: document.body });
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("keeps the menu open while focus moves between its groups", () => {
    viewport(true);
    render(<AppearanceControl />);
    fireEvent.click(screen.getByRole("button", { name: "Darstellung" }));
    const theme = within(screen.getByRole("radiogroup", { name: "Farbschema" })).getAllByRole("radio")[0];
    const style = within(screen.getByRole("radiogroup", { name: "Stil" })).getByRole("radio", { name: "Nebel" });
    fireEvent.focusOut(theme, { relatedTarget: style });
    expect(screen.getAllByRole("radiogroup")).toHaveLength(3);
  });

  it("creates one MediaQueryList per mounted control and releases it on unmount", () => {
    const added = vi.fn<(type: string, fn: () => void) => void>();
    const removed = vi.fn<(type: string, fn: () => void) => void>();
    // Only the compact query is counted: the motion hook asks for its own reduced-motion list.
    const matchMedia = vi.fn((query: string) => ({
      matches: false,
      addEventListener: query === COMPACT_QUERY ? added : () => {},
      removeEventListener: query === COMPACT_QUERY ? removed : () => {},
    }));
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
    const { rerender, unmount } = render(<AppearanceControl />);
    rerender(<AppearanceControl />);
    rerender(<AppearanceControl />);
    expect(matchMedia.mock.calls.filter(([query]) => query === COMPACT_QUERY)).toHaveLength(1);
    expect(added).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
    unmount();
    expect(removed).toHaveBeenCalledTimes(added.mock.calls.length);
    expect(removed.mock.calls.every(([type]) => type === "change")).toBe(true);
  });

  it("keeps the Not-Aus button in the DOM and focusable with the note's full text as title", async () => {
    viewport(true);
    await mount();
    const stop = screen.getByRole("button", { name: "Not-Aus auslösen" });
    stop.focus();
    expect(stop).toHaveFocus();
    const note = within(screen.getByTestId("emergency-stop")).getByRole("status");
    expect(note.getAttribute("title")).toBe(note.textContent);
  });
});
