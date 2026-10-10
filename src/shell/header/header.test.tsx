import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getEmergencyStop, setEmergencyStop } from "../../lib/ipc";
import { Shell } from "../Shell";
import { Bell, CommandPalette, QuotaBar, StopBand } from "./index";
import { matchCommands } from "./CommandPalette";

vi.mock("../../lib/ipc", () => ({ getEmergencyStop: vi.fn(), setEmergencyStop: vi.fn(), describeError: String }));

const stopped = vi.mocked(getEmergencyStop);
beforeEach(() => { window.location.hash = ""; stopped.mockReset().mockResolvedValue(false); vi.mocked(setEmergencyStop).mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);
const ctrlK = () => fireEvent.keyDown(window, { key: "k", ctrlKey: true });

describe("command palette", () => {
  it("opens on Ctrl K then filters the routes and navigates on Enter", () => {
    render(<CommandPalette />);
    expect(screen.queryByRole("dialog")).toBeNull();
    ctrlK();
    expect(screen.getByRole("dialog", { name: "Befehlspalette" })).toBeInTheDocument();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "beweise diff" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Beweise · Diff"]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(window.location.hash).toBe("#/beweise/diff");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves the selection with the arrow keys and closes on Escape", () => {
    render(<CommandPalette />);
    fireEvent.click(screen.getByRole("button", { name: /Seiten und Befehle suchen/ }));
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[1].id);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says plainly when nothing matches and offers every route and tab otherwise", () => {
    expect(matchCommands("").length).toBeGreaterThan(20);
    expect(matchCommands("xyzzy")).toEqual([]);
    render(<CommandPalette />);
    ctrlK();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "xyzzy" } });
    expect(screen.getByText("Nichts gefunden")).toBeInTheDocument();
  });
});

describe("quota bar and bell", () => {
  it("shows the quota as not connected without any number or meter", () => {
    render(<QuotaBar />);
    expect(screen.getByRole("link", { name: "Kontingente: noch nicht verbunden" })).toHaveAttribute("href", "#/steuerung");
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.getByText(/noch nicht verbunden/).textContent).not.toMatch(/\d/);
  });

  it("links the bell to the notification settings and shows no count", () => {
    render(<Bell />);
    const bell = screen.getByRole("link", { name: /Benachrichtigungen/ });
    expect(bell).toHaveAttribute("href", "#/einstellungen/benachrichtigungen");
    expect(bell.textContent).toBe("");
  });
});

describe("stop band", () => {
  const mount = () => act(async () => void render(<StopBand />));

  it("is absent while Not-Aus is free", async () => {
    await mount();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows while Not-Aus is active and lifts it with Fortsetzen", async () => {
    stopped.mockResolvedValue(true);
    await mount();
    expect(screen.getByRole("status").textContent).toContain("Not-Aus ist aktiv");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Fortsetzen" })));
    expect(setEmergencyStop).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("treats an unreadable state as active", async () => {
    stopped.mockRejectedValue(new Error("offline"));
    await mount();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("in the shell", () => {
  it("puts the tools into the header and Ctrl K works on a route", async () => {
    await act(async () => void render(<Shell />));
    const header = screen.getByRole("banner");
    expect(header).toContainElement(screen.getByRole("button", { name: /Seiten und Befehle suchen/ }));
    expect(header).toContainElement(screen.getByRole("link", { name: /Kontingente/ }));
    expect(header).toContainElement(screen.getByTestId("emergency-stop"));
    ctrlK();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
