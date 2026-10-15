import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setFeatureFlagEnabled } from "../flags/featureFlags";
import { ROUTES, resolveRoute } from "./routes";
import { Shell } from "./Shell";

vi.mock("../lib/ipc", () => ({ getEmergencyStop: vi.fn().mockResolvedValue(false), setEmergencyStop: vi.fn(), getQuotaState: vi.fn().mockResolvedValue([]), getProviderOverview: vi.fn().mockResolvedValue([]), describeError: String }));

const SCOPE = ["Leitstand", "Einstellungen"];
/** The palette also offers Ersteinrichtung, which has no sidebar entry but stays reachable via /start. */
const PALETTE_AREAS = [...SCOPE, "Ersteinrichtung"];
const mount = () => act(async () => void render(<Shell />));
const go = (hash: string) => act(() => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent("hashchange")); });
const sidebar = () => within(screen.getByRole("navigation", { name: "Hauptnavigation" })).getAllByRole("link").map((a) => a.textContent);
const palette = () => {
  fireEvent.click(screen.getByRole("button", { name: /Seiten und Befehle suchen/ }));
  return screen.getAllByRole("option").map((o) => o.textContent ?? "");
};

beforeEach(() => { localStorage.clear(); window.location.hash = ""; setFeatureFlagEnabled("d1_neue_oberflaeche", true); });
afterEach(cleanup);

describe("shell scope (V2-SCOPE-1)", () => {
  it("with D1 on and the scope flag off the sidebar and palette omit non-shell areas and resolveRoute lands on /leitstand", async () => {
    await mount();
    expect(sidebar()).toEqual(SCOPE);
    const hits = palette();
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((label) => PALETTE_AREAS.some((area) => label.startsWith(area)))).toBe(true);
    expect(resolveRoute("/steuerung/autonomie")?.route.id).toBe("leitstand");
    expect(resolveRoute("/beweise")?.tab?.path).toBe("/leitstand");
    expect(resolveRoute("/start")?.route.id).toBe("start");
    expect(resolveRoute("/nirgends")).toBeNull();
  });

  it("with the scope flag off a hidden hash is replaced by /leitstand while /start stays", async () => {
    window.location.hash = "#/team/personas";
    await mount();
    expect(window.location.hash).toBe("#/leitstand");
    await go("#/start");
    expect(window.location.hash).toBe("#/start");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Ersteinrichtung");
  });

  it("with the scope flag on the sidebar and palette and resolveRoute show every area", async () => {
    setFeatureFlagEnabled("weitere_bereiche", true);
    window.location.hash = "#/steuerung/autonomie";
    await mount();
    expect(sidebar()).toHaveLength(ROUTES.filter((r) => r.icon !== null).length);
    expect(palette().some((label) => label.startsWith("Core · Steuerung"))).toBe(true);
    expect(resolveRoute("/steuerung/autonomie")?.tab?.label).toBe("Core & Autonomie");
    expect(window.location.hash).toBe("#/steuerung/autonomie");
  });
});
