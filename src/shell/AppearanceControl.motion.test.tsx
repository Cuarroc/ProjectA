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

const group = () => screen.getByRole("radiogroup", { name: "Bewegung" });
const radio = (name: string) => within(group()).getByRole("radio", { name });

describe("motion mode control", () => {
  it("offers Ruhig Lebendig and Aus and applies a choice at once", () => {
    render(<AppearanceControl />);
    expect(screen.queryByText(HINT)).toBeNull();
    fireEvent.click(radio("Lebendig"));
    expect(root.dataset.motion).toBe("lively");
    expect(radio("Lebendig")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(radio("Aus"));
    expect([root.dataset.motion, localStorage.getItem(MOTION_MODE_KEY)]).toEqual(["off", "off"]);
    fireEvent.click(radio("Ruhig"));
    expect(root.dataset.motion).toBeUndefined();
  });
  it("says that the system wins when it asks for less motion and keeps the stored choice", () => {
    localStorage.setItem(MOTION_MODE_KEY, "lively");
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduced-motion"), addEventListener: () => {}, removeEventListener: () => {} }));
    render(<AppearanceControl />);
    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(radio("Lebendig")).toHaveAttribute("aria-checked", "true");
  });
  it("leaves the motion group out of the header bar which has no room for a third group", async () => {
    await act(async () => void render(<Shell />));
    expect(screen.getByRole("radiogroup", { name: "Stil" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Bewegung" })).toBeNull();
  });
  it("applies the stored mode when the shell mounts", async () => {
    localStorage.setItem(MOTION_MODE_KEY, "off");
    await act(async () => void render(<Shell />));
    expect(root.dataset.motion).toBe("off");
  });
});
