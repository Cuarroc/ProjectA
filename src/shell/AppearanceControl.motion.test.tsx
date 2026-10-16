import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOTION_MODE_KEY } from "../design/motion/motionMode";
import { AppearanceControl } from "./AppearanceControl";
import { Shell } from "./Shell";

vi.mock("../lib/ipc", () => ({ getEmergencyStop: vi.fn().mockResolvedValue(false), setEmergencyStop: vi.fn(), getQuotaState: vi.fn().mockResolvedValue([]), getProviderOverview: vi.fn().mockResolvedValue([]), describeError: String }));

const root = document.documentElement;
const HINT = "Dein System verlangt weniger Bewegung";
beforeEach(() => { localStorage.clear(); delete root.dataset.motion; window.location.hash = ""; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** jsdom has no matchMedia: answer only the OS reduced-motion query. */
const osReduced = () => vi.stubGlobal("matchMedia", (query: string) => ({
  matches: query === "(prefers-reduced-motion: reduce)", addEventListener: () => {}, removeEventListener: () => {},
}));
const group = () => screen.getByRole("radiogroup", { name: "Bewegung" });

describe("motion mode control", () => {
  it("offers Ruhig Lebendig and Aus and applies a choice at once", () => {
    render(<AppearanceControl />);
    expect(within(group()).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Ruhig", "Lebendig", "Aus"]);
    expect(within(group()).getByRole("radio", { name: "Ruhig" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(group()).getByRole("radio", { name: "Lebendig" }));
    expect(root.dataset.motion).toBe("lively");
    expect(within(group()).getByRole("radio", { name: "Lebendig" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(group()).getByRole("radio", { name: "Aus" }));
    expect(root.dataset.motion).toBe("off");
    expect(localStorage.getItem(MOTION_MODE_KEY)).toBe("off");
    fireEvent.click(within(group()).getByRole("radio", { name: "Ruhig" }));
    expect(root.dataset.motion).toBeUndefined();
  });

  it("says that the system wins when it asks for less motion and keeps the stored choice", () => {
    localStorage.setItem(MOTION_MODE_KEY, "lively");
    osReduced();
    render(<AppearanceControl />);
    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(within(group()).getByRole("radio", { name: "Lebendig" })).toHaveAttribute("aria-checked", "true");
    cleanup();
    vi.unstubAllGlobals();
    render(<AppearanceControl />);
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it("applies the stored mode when the shell mounts", async () => {
    localStorage.setItem(MOTION_MODE_KEY, "off");
    await act(async () => void render(<Shell />));
    expect(root.dataset.motion).toBe("off");
  });
});
