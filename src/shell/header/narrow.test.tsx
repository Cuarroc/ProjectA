import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppearanceControl } from "../AppearanceControl";
import { COMPACT_QUERY } from "../texts";
import { Shell } from "../Shell";

vi.mock("../../lib/ipc", () => ({ getEmergencyStop: vi.fn().mockResolvedValue(false), setEmergencyStop: vi.fn(), describeError: String }));

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
  it("keeps the compact menu below 1600 px so search and quota status stay readable", () => {
    expect(COMPACT_QUERY).toBe("(max-width: 1599px)");
  });

  it("shows both segmented groups at full width and no menu button", () => {
    viewport(false);
    render(<AppearanceControl />);
    expect(screen.getAllByRole("radiogroup")).toHaveLength(2);
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
    expect(screen.getAllByRole("radiogroup")).toHaveLength(2);
  });

  it("creates one MediaQueryList per mounted control and releases it on unmount", () => {
    const added = vi.fn<(type: string, fn: () => void) => void>();
    const removed = vi.fn<(type: string, fn: () => void) => void>();
    const matchMedia = vi.fn(() => ({ matches: false, addEventListener: added, removeEventListener: removed }));
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
    const { rerender, unmount } = render(<AppearanceControl />);
    rerender(<AppearanceControl />);
    rerender(<AppearanceControl />);
    expect(matchMedia).toHaveBeenCalledTimes(1);
    expect(matchMedia).toHaveBeenCalledWith(COMPACT_QUERY);
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
