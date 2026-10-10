import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ROUTES, pathFromHash, resolveRoute } from "./routes";
import { Shell } from "./Shell";
import { GLASS_VARIANT_KEY } from "../design/variants/useGlassVariant";
import { GLASS_THEME_KEY } from "./theme";

vi.mock("../lib/ipc", () => ({ getEmergencyStop: vi.fn().mockResolvedValue(false), setEmergencyStop: vi.fn(), describeError: String }));

const NINE = ["Leitstand", "Eingang & Plan", "Beweise", "Team", "Automatik", "Core", "Core · Steuerung", "Gedächtnis", "Einstellungen"];
const allPaths = ROUTES.flatMap((r) => [r.path, ...r.tabs.map((t) => t.path)]);
/** EmergencyStop resolves its first poll asynchronously: flush it inside act. */
const mount = () => act(async () => void render(<Shell />));
const go = (hash: string) => act(() => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent("hashchange")); });
const root = document.documentElement;

beforeEach(() => { localStorage.clear(); delete root.dataset.theme; delete root.dataset.glassVariant; window.location.hash = ""; });
afterEach(cleanup);

describe("sidebar and route registry", () => {
  it("lists exactly the nine ia.md entries without Ersteinrichtung", async () => {
    await mount();
    const links = within(screen.getByRole("navigation", { name: "Hauptnavigation" })).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(NINE);
    expect(links[1]).toHaveAttribute("href", "#/eingang/plan");
    expect(resolveRoute("/start")?.route.icon).toBeNull();
  });

  it("opens the Leitstand by default and follows the hash to the active entry", async () => {
    expect(pathFromHash("")).toBe("/leitstand");
    await mount();
    expect(screen.getByRole("link", { name: "Leitstand" })).toHaveAttribute("aria-current", "page");
    go("#/team");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Team · Organigramm");
    expect(screen.getByRole("link", { name: "Team" })).toHaveAttribute("aria-current", "page");
  });

  it("resolves tab paths to their entry and rejects unknown paths", () => {
    expect(resolveRoute("/steuerung/autonomie/")?.tab?.label).toBe("Core & Autonomie");
    expect(resolveRoute("/nirgends")).toBeNull();
  });

  it("shows Not-Aus and a glass placeholder on every route", async () => {
    for (const path of [...allPaths, "/nirgends"]) {
      window.location.hash = `#${path}`;
      await mount();
      expect(screen.getByTestId("emergency-stop"), path).toBeInTheDocument();
      expect(screen.getByRole("region"), path).toHaveClass("g-glass");
      expect(screen.getByText(/Noch nicht verbunden|gibt es nicht/), path).toBeInTheDocument();
      cleanup();
    }
  });
});

describe("light / dark / system toggle", () => {
  const pick = (name: string) => fireEvent.click(screen.getByRole("radio", { name }));

  it("sets and removes only data-theme and persists the choice", async () => {
    await mount();
    pick("Dunkel");
    expect(root.dataset.theme).toBe("dark");
    expect(localStorage.getItem(GLASS_THEME_KEY)).toBe("dark");
    pick("Hell");
    expect(root.dataset.theme).toBe("light");
    pick("System");
    expect(root.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(GLASS_THEME_KEY)).toBeNull();
  });

  it("applies the stored choice on mount and checks the matching radio", async () => {
    localStorage.setItem(GLASS_THEME_KEY, "dark");
    await mount();
    expect(root.dataset.theme).toBe("dark");
    expect(screen.getByRole("radio", { name: "Dunkel" })).toBeChecked();
  });
});

describe("glass style (Stil)", () => {
  const stil = () => screen.getByRole("radiogroup", { name: "Stil" });

  it("offers Glas, Klar, Nebel and Abend and starts on Glas", async () => {
    await mount();
    expect(within(stil()).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Glas", "Klar", "Nebel", "Abend"]);
    expect(screen.getByRole("radio", { name: "Glas" })).toBeChecked();
    expect(root.dataset.glassVariant).toBeUndefined();
  });

  it("sets data-glass-variant on mount for a stored klar and falls back to glas for junk", async () => {
    localStorage.setItem(GLASS_VARIANT_KEY, "klar");
    await mount();
    expect(root.dataset.glassVariant).toBe("klar");
    cleanup();
    localStorage.setItem(GLASS_VARIANT_KEY, "xyz");
    await mount();
    expect(root.dataset.glassVariant).toBeUndefined();
    expect(screen.getByRole("radio", { name: "Glas" })).toBeChecked();
  });

  it("switches with the arrow keys and persists without touching data-theme", async () => {
    await mount();
    const glas = screen.getByRole("radio", { name: "Glas" });
    glas.focus();
    fireEvent.keyDown(glas, { key: "ArrowRight" });
    expect(root.dataset.glassVariant).toBe("klar");
    expect(localStorage.getItem(GLASS_VARIANT_KEY)).toBe("klar");
    expect(screen.getByRole("radio", { name: "Klar" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("radio", { name: "Klar" }), { key: "End" });
    expect(root.dataset.glassVariant).toBe("abend");
    expect(root.dataset.theme).toBeUndefined();
  });
});
