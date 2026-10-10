import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { check } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { ROUTES } from "../../shell/routes";
import { EinstellungenScreen } from "./EinstellungenScreen";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("../../lib/ipc", () => ({ getEmergencyStop: vi.fn().mockResolvedValue(false), setEmergencyStop: vi.fn(), describeError: String }));

const css = readFileSync(resolve(__dirname, "einstellungen.css"), "utf8");
const TABS = ROUTES.find((r) => r.id === "einstellungen")!.tabs.map((t) => t.label);
const open = vi.fn();
beforeEach(() => {
  vi.mocked(getVersion).mockReset().mockResolvedValue("9.8.7");
  vi.mocked(check).mockReset().mockResolvedValue(null);
  open.mockReset();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});
afterEach(cleanup);
const show = () => render(<EinstellungenScreen onOpenClassic={open} />);

describe("tab strip", () => {
  it("is a tablist of the route's tabs with Allgemein active and arrow-key navigation", () => {
    show();
    const list = screen.getByRole("tablist");
    expect(within(list).getAllByRole("tab").map((t) => t.textContent)).toEqual(TABS);
    expect(screen.getByRole("tab", { name: "Allgemein" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "MCP & Tresor" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Allgemein" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows the honest not-connected state and never a number on the other three tabs", () => {
    show();
    for (const label of TABS.slice(1)) {
      fireEvent.click(screen.getByRole("tab", { name: label }));
      const panel = screen.getByRole("tabpanel");
      expect(panel.querySelector(".g-hs--offline")).not.toBeNull();
      expect(panel.textContent).not.toMatch(/\d/);
    }
  });
});

describe("tab Allgemein", () => {
  it("shows the five sections", () => {
    show();
    const heads = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(heads).toEqual(["Darstellung", "Neue Oberfläche (Vorschau)", "Version & Updates", "Not-Aus", "Weitere Einstellungen"]);
  });

  it("switches the theme through the shell's theme module", () => {
    show();
    fireEvent.click(screen.getByRole("radio", { name: "Dunkel" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("offers the glass style switch under Hell/Dunkel/System and applies the choice", () => {
    show();
    const card = screen.getByRole("region", { name: "Darstellung" });
    const style = within(card).getByRole("radiogroup", { name: "Stil" });
    for (const name of ["Glas", "Klar", "Nebel", "Abend"]) expect(within(style).getByRole("radio", { name })).toBeInTheDocument();
    fireEvent.click(within(style).getByRole("radio", { name: "Nebel" }));
    expect(document.documentElement.dataset.glassVariant).toBe("nebel");
    delete document.documentElement.dataset.glassVariant;
  });

  it("hides the repeated classic field label in the Not-Aus section only", () => {
    show();
    const stop = screen.getByRole("region", { name: "Not-Aus" });
    expect(stop.className).toContain("es-sec--stop");
    for (const name of ["Darstellung", "Neue Oberfläche (Vorschau)", "Version & Updates", "Weitere Einstellungen"]) {
      expect(screen.getByRole("region", { name }).className).not.toContain("es-sec--stop");
    }
    expect(css).toMatch(/\.es-sec--stop \.field-label\s*\{\s*display:\s*none/);
    expect(css).not.toMatch(/\.es-sec \.field-label/);
  });

  it("shows the version from the app lib call", async () => {
    show();
    expect(await screen.findByText("ProjectA 9.8.7")).toBeInTheDocument();
  });

  it("says so when there is no desktop app to ask for the version", async () => {
    vi.mocked(getVersion).mockRejectedValue(new Error("no tauri"));
    show();
    expect(await screen.findByText("Nur in der Desktop-App verfügbar.")).toBeInTheDocument();
  });

  it("reports an up-to-date app and an available update from the updater check", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Nach Updates suchen" }));
    expect(await screen.findByText("ProjectA ist aktuell.")).toBeInTheDocument();
    vi.mocked(check).mockResolvedValue({ available: true, version: "10.0.0" } as never);
    fireEvent.click(screen.getByRole("button", { name: "Nach Updates suchen" }));
    expect(await screen.findByText(/Version 10\.0\.0 ist verfügbar/)).toBeInTheDocument();
  });

  it("shows a failed update check as an alert", async () => {
    vi.mocked(check).mockRejectedValue(new Error("offline"));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Nach Updates suchen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  });

  it("keeps Not-Aus visible and opens the classic settings from the last section", async () => {
    show();
    await waitFor(() => expect(screen.getByRole("button", { name: "Not-Aus auslösen" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Klassische Einstellungen öffnen" }));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
