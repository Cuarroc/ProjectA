import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { check } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { FEATURE_FLAGS, FEATURE_FLAG_STORAGE_PREFIX, isFeatureFlagEnabled } from "../../flags/featureFlags";
import { getVersion } from "@tauri-apps/api/app";
import { ROUTES } from "../../shell/routes";
import { EinstellungenScreen } from "./EinstellungenScreen";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
let emergencyStopped = false;

const css = readFileSync(resolve(__dirname, "einstellungen.css"), "utf8");
const TABS = ROUTES.find((r) => r.id === "einstellungen")!.tabs.map((t) => t.label);
const open = vi.fn();
beforeEach(() => {
  emergencyStopped = false;
  vi.mocked(invoke).mockReset().mockImplementation(async (command) => {
    switch (command) {
      case "get_emergency_stop": return emergencyStopped;
      case "get_log_path": return "logs/projecta.log";
      case "get_panic_notice": return { current: null, previous: null };
      case "get_reason_catalog": return [{ code: "quota_blocked", grade: "blocking", line: "Kontingent erreicht" }];
      default: throw new Error(`Unexpected IPC: ${command}`);
    }
  });
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
  it("shows the six sections", async () => {
    show();
    const heads = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(heads).toEqual(["Darstellung", "Vorschau-Funktionen", "Version & Updates", "Diagnose", "Not-Aus", "Weitere Einstellungen"]);
    expect(await screen.findByText("logs/projecta.log")).toBeInTheDocument();
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
    for (const name of ["Darstellung", "Vorschau-Funktionen", "Version & Updates", "Weitere Einstellungen"]) {
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

  it("renders the Not-Aus lift button as a Glass button", async () => {
    emergencyStopped = true;
    show();
    const lift = await screen.findByRole("button", { name: "Not-Aus aufheben" });
    expect(lift.className.split(/\s+/)).toContain("g-btn");
    expect(lift.className).not.toContain("button-ghost");
  });
});


describe("preview directory", () => {
  it("lists every preview flag exactly once with its registry description", async () => {
    show();
    const section = screen.getByRole("region", { name: "Vorschau-Funktionen" });
    const rows = within(section).getAllByRole("listitem");
    expect(rows).toHaveLength(FEATURE_FLAGS.length);
    expect(within(section).getAllByRole("checkbox").map((control) => control.id)).toEqual(
      FEATURE_FLAGS.map((flag) => `es-preview-${flag.id}`),
    );
    for (const label of ["Neue Oberfläche (Vorschau)", "Fernansicht", "Kundenprojekte"]) {
      expect(within(section).getAllByRole("checkbox", { name: label })).toHaveLength(1);
    }
    for (const [index, flag] of FEATURE_FLAGS.entries()) {
      const row = within(rows[index]);
      expect(row.getByText(flag.label, { exact: true })).toBeVisible();
      expect(flag.description.trim()).not.toBe("");
      expect(row.getByText(flag.description, { exact: true })).toBeVisible();
      expect(row.getByRole("checkbox", { name: flag.label })).toHaveAccessibleDescription(flag.description);
      expect(row.getByRole("checkbox")).not.toBeChecked();
      expect(row.getByText("Aus", { exact: true })).toBeVisible();
    }
    expect(await screen.findByText("logs/projecta.log")).toBeInTheDocument();
  });

  it("preview flags persist and reflect external changes without backend calls", async () => {
    const view = show();
    await screen.findByText("logs/projecta.log");
    vi.mocked(invoke).mockClear();
    for (const flag of FEATURE_FLAGS) {
      fireEvent.click(screen.getByRole("checkbox", { name: flag.label }));
      expect(isFeatureFlagEnabled(flag.id)).toBe(true);
    }
    expect(invoke).not.toHaveBeenCalled();
    view.unmount();
    show();
    await screen.findByText("logs/projecta.log");
    vi.mocked(invoke).mockClear();
    for (const flag of FEATURE_FLAGS) {
      const control = screen.getByRole("checkbox", { name: flag.label });
      const row = within(control.closest("li")!);
      expect(control).toBeChecked();
      expect(row.getByText("An", { exact: true })).toBeVisible();
      const key = `${FEATURE_FLAG_STORAGE_PREFIX}${flag.id}`;
      act(() => {
        localStorage.removeItem(key);
        window.dispatchEvent(new StorageEvent("storage", { key, newValue: null }));
      });
      expect(control).not.toBeChecked();
      expect(row.getByText("Aus", { exact: true })).toBeVisible();
      act(() => {
        localStorage.setItem(key, "1");
        window.dispatchEvent(new StorageEvent("storage", { key, newValue: "1" }));
      });
      expect(control).toBeChecked();
      fireEvent.click(control);
      expect(isFeatureFlagEnabled(flag.id)).toBe(false);
      expect(row.getByText("Aus", { exact: true })).toBeVisible();
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it("preview controls remain keyboard reachable and preserve classic access", async () => {
    show();
    const stop = screen.getByRole("button", { name: "Not-Aus auslösen" });
    await waitFor(() => expect(stop).toBeEnabled());
    const controls = screen.getAllByRole("checkbox");
    expect(controls).toHaveLength(FEATURE_FLAGS.length);
    const classic = screen.getByRole("button", { name: "Klassische Einstellungen öffnen" });
    // Native inputs/buttons supply keyboard activation; actual Tab/Space is exercised in the browser proof.
    for (const control of [...controls, stop, classic]) {
      expect(control.tagName).toBe(controls.includes(control) ? "INPUT" : "BUTTON");
      expect(control.tabIndex).toBe(0);
      expect(control).toBeEnabled();
      control.focus();
      expect(control).toHaveFocus();
    }
    expect(controls.at(-1)!.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stop.compareDocumentPosition(classic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(classic);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
