import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { check } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { FEATURE_FLAGS, FEATURE_FLAG_STORAGE_PREFIX, isFeatureFlagEnabled } from "../../flags/featureFlags";
import { getIdentifier, getVersion } from "@tauri-apps/api/app";
import { ROUTES } from "../../shell/routes";
import { EinstellungenScreen } from "./EinstellungenScreen";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(), getIdentifier: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
let emergencyStopped = false;
const provider = (id: string, kind: string, vaultError: string | null = null) => ({
  id, name: `Anbieter ${id}`, kind, connected: true, vaultError,
});
let overview: unknown;
let presence: Record<string, unknown>;
const calls = (command: string) => vi.mocked(invoke).mock.calls.filter(([c]) => c === command);
const vaultTab = () => fireEvent.click(screen.getByRole("tab", { name: "MCP & Tresor" }));

const css = readFileSync(resolve(__dirname, "einstellungen.css"), "utf8");
const TABS = ROUTES.find((r) => r.id === "einstellungen")!.tabs.map((t) => t.label);
const open = vi.fn();
beforeEach(() => {
  emergencyStopped = false;
  overview = [provider("abo", "subscription"), provider("lokal", "local"), provider("api", "api_key")];
  presence = { api: true };
  vi.mocked(invoke).mockReset().mockImplementation(async (command, args) => {
    switch (command) {
      case "get_provider_overview":
        if (overview instanceof Error) throw overview;
        return overview;
      case "has_provider_key": {
        const answer = presence[(args as { providerId: string }).providerId];
        if (answer instanceof Error) throw answer;
        return answer;
      }
      case "get_emergency_stop": return emergencyStopped;
      case "get_log_path": return "logs/projecta.log";
      case "get_panic_notice": return { current: null, previous: null };
      case "get_reason_catalog": return [{ code: "quota_blocked", grade: "blocking", line: "Kontingent erreicht" }];
      default: throw new Error(`Unexpected IPC: ${command}`);
    }
  });
  vi.mocked(getVersion).mockReset().mockResolvedValue("9.8.7");
  vi.mocked(getIdentifier).mockReset().mockResolvedValue("com.projecta.app");
  vi.mocked(check).mockReset().mockResolvedValue(null);
  open.mockReset();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});
afterEach(cleanup);
const show = () => render(<EinstellungenScreen onOpenClassic={open} />);

/** Key material must not survive as visible text or as any DOM attribute. */
function expectSecretAbsent(secret: string) {
  expect(document.body).not.toHaveTextContent(secret);
  for (const el of document.querySelectorAll("*")) {
    for (const name of el.getAttributeNames()) {
      expect(el.getAttribute(name), name).not.toContain(secret);
    }
  }
}

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

  it("shows the honest not-connected state and never a number on the two remaining placeholder tabs", () => {
    show();
    for (const label of TABS.slice(2)) {
      fireEvent.click(screen.getByRole("tab", { name: label }));
      const panel = screen.getByRole("tabpanel");
      expect(panel.querySelector(".g-hs--offline")).not.toBeNull();
      expect(panel.textContent).not.toMatch(/\d/);
    }
  });
});

describe("tab MCP & Tresor", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("shows the vault before the overview answers", () => {
    overview = new Promise(() => {});
    show();
    vaultTab();
    const panel = screen.getByRole("tabpanel");
    expect(screen.getByRole("region", { name: "Tresor" })).toBeVisible();
    expect(screen.getByText("Wird gelesen …")).toBeVisible();
    expect(panel).not.toHaveTextContent("Dieser Bereich ist in der neuen Oberfläche noch nicht verbunden.");
  });

  it("shows the internal package note only for the dev app identifier", async () => {
    overview = [];
    show();
    vaultTab();
    expect(await screen.findByText("Keine Anbieter bekannt")).toBeVisible();
    expect(screen.queryByText("V2-B19 (noch nicht gebaut)")).toBeNull();
    expect(getIdentifier).toHaveBeenCalled();
    cleanup();
    vi.mocked(getIdentifier).mockResolvedValue("com.projecta.dev");
    show();
    vaultTab();
    expect(await screen.findByText("V2-B19 (noch nicht gebaut)")).toBeVisible();
  });

  it("mounts the read only vault only after selecting the MCP tab", async () => {
    show();
    await screen.findByText("logs/projecta.log");
    expect(calls("get_provider_overview")).toHaveLength(0);
    expect(calls("has_provider_key")).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "Tresor" })).toBeNull();
    vi.mocked(invoke).mockClear();
    vaultTab();
    expect(await screen.findByText("Schlüssel hinterlegt")).toBeVisible();
    const table = within(screen.getByRole("region", { name: "Anbieter und Zugang" }));
    expect(table.getByRole("row", { name: /Anbieter abo/ })).toHaveTextContent("Anmeldung über die CLI, kein Schlüssel im Tresor");
    expect(table.getByRole("row", { name: /Anbieter lokal/ })).toHaveTextContent("kein Schlüssel nötig");
    expect(calls("get_provider_overview")).toHaveLength(1);
    expect(calls("has_provider_key").map(([, args]) => args)).toEqual([{ providerId: "api" }]);
    // Every other IPC is forbidden on this read-only surface, including future write commands.
    expect(vi.mocked(invoke).mock.calls.filter(([c]) => !["get_provider_overview", "has_provider_key"].includes(c))).toEqual([]);
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByText("MCP-Server noch nicht verbunden")).toBeVisible();
    expect(panel.queryAllByRole("button")).toHaveLength(0);
    expect(panel.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("shows vault read errors without exposing key material in settings", async () => {
    const privateDetail = "synthetic-private-response";
    overview = new Error(privateDetail);
    show();
    vaultTab();
    expect(await screen.findByText("Tresor nicht lesbar")).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
    expect(calls("has_provider_key")).toHaveLength(0);
    expectSecretAbsent(privateDetail);
    fireEvent.click(screen.getByRole("tab", { name: TABS[2] }));
    overview = [provider("api", "api_key", "vault_corrupt"), provider("invalid", "api_key"), provider("failed", "api_key")];
    presence = { api: false, invalid: privateDetail, failed: new Error(privateDetail) };
    vaultTab();
    expect(await screen.findByRole("alert")).toHaveTextContent("Der Schlüsselspeicher ist beschädigt");
    await waitFor(() => expect(screen.getAllByText("nicht prüfbar")).toHaveLength(3));
    expect(screen.queryByText("kein Schlüssel hinterlegt")).toBeNull();
    expect(screen.queryByText("Keine Anbieter bekannt")).toBeNull();
    expectSecretAbsent(privateDetail);
  });

  it("keeps a vault error detail out of DOM attributes", async () => {
    const privateDetail = "synthetic-private-response";
    overview = new Error(privateDetail);
    show();
    vaultTab();
    expect(await screen.findByText("Tresor nicht lesbar")).toBeVisible();
    expectSecretAbsent(privateDetail);
  });

  it("leaves and reopens the vault tab without retaining its previous rows", async () => {
    show();
    vaultTab();
    expect(await screen.findByText("Schlüssel hinterlegt")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: TABS[2] }));
    expect(screen.queryByRole("region", { name: "Tresor" })).toBeNull();
    const before = calls("get_provider_overview").length;
    vi.useFakeTimers();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(calls("get_provider_overview")).toHaveLength(before);
    vi.useRealTimers();
    overview = new Promise(() => {});
    vaultTab();
    expect(screen.getByText("Wird gelesen …")).toBeVisible();
    expect(screen.queryByText("Anbieter api")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: TABS[2] }));
    overview = [provider("neu", "local")];
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
    expect(await screen.findByText("Anbieter neu")).toBeVisible();
    expect(screen.queryByText("Anbieter api")).toBeNull();
    expect(calls("get_provider_overview")).toHaveLength(before + 2);
    expect(calls("has_provider_key").map(([, args]) => args)).toEqual([{ providerId: "api" }]);
  });

  it("drops an older vault read that resolves after a newer one", async () => {
    let finishOld: (rows: unknown) => void = () => {};
    let reads = 0;
    const base = vi.mocked(invoke).getMockImplementation();
    if (base === undefined) throw new Error("invoke mock missing");
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "get_provider_overview") {
        reads += 1;
        if (reads === 1) return await new Promise((resolve) => { finishOld = resolve; });
        return [provider("neu", "local")];
      }
      return base(command, args);
    });
    render(<StrictMode><EinstellungenScreen onOpenClassic={open} /></StrictMode>);
    vaultTab();
    expect(await screen.findByText("Anbieter neu")).toBeVisible();
    await act(async () => { finishOld([provider("veraltet", "api_key")]); });
    expect(screen.queryByText("Anbieter veraltet")).toBeNull();
    expect(screen.getByText("Anbieter neu")).toBeVisible();
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
