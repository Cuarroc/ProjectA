import { describe, expect, it } from "vitest";

import { GOAL_ROUTE, goalForPath, hasLegacyPanel, hashForGoal, shouldMountLegacyTerminal, isTerminal, isNewEinstellungen, isNewLeitstand, isNewSteuerung } from "./routing";

describe("goal and route mapping (ia.md section 4)", () => {
  it("recognizes only the terminal route with an optional trailing slash", () => {
    for (const path of ["/leitstand/terminal", "/leitstand/terminal/"]) expect(isTerminal(path)).toBe(true);
    for (const path of ["/leitstand", "/leitstand/terminal/foo", "/leitstand/werkzeuge"]) expect(isTerminal(path)).toBe(false);
  });

  it("mounts legacy terminals only on legacy panel routes or with D1 off", () => {
    for (const path of [undefined, "/leitstand/klassisch", "/leitstand/werkzeuge", "/leitstand/werkzeuge/", "/leitstand/verlauf", "/beweise/diff", "/einstellungen/klassisch"]) {
      expect(shouldMountLegacyTerminal(path)).toBe(true);
    }
    for (const path of ["/leitstand/terminal", "/leitstand/terminal/", "/leitstand", "/leitstand/betrieb", "/steuerung", "/einstellungen", "/start", "/team"]) {
      expect(shouldMountLegacyTerminal(path)).toBe(false);
    }
  });

  it("keeps the legacy goal when entering the terminal route", () => {
    for (const path of ["/leitstand/terminal", "/leitstand/terminal/"]) {
      expect(goalForPath(path, "review")).toBe("review");
      expect(goalForPath(path, "settings")).toBe("settings");
      expect(isNewLeitstand(path)).toBe(false);
      expect(hashForGoal("agents", path)).toBeNull();
    }
  });

  it("resolves the werkzeuge tab under leitstand", () => {
    for (const path of ["/leitstand/werkzeuge", "/leitstand/werkzeuge/"]) {
      expect(hasLegacyPanel(path)).toBe(true);
      expect(isNewLeitstand(path)).toBe(false);
      // Opening tools must not replace the view that owns the existing session.
      expect(goalForPath(path, "review")).toBe("review");
      expect(goalForPath(path, "agents")).toBe("agents");
      expect(goalForPath(path, "settings")).toBe("settings");
    }
  });

  it("keeps Work Attention and Agents under the Leitstand", () => {
    expect(goalForPath("/leitstand", "attention")).toBe("attention");
    expect(goalForPath("/leitstand/verlauf", "agents")).toBe("agents");
    expect(goalForPath("/leitstand", "settings")).toBe("work");
  });

  it("opens Review Insights and Settings under their own routes", () => {
    expect(goalForPath("/beweise/diff", "work")).toBe("review");
    expect(goalForPath("/steuerung", "work")).toBe("insights");
    expect(goalForPath("/einstellungen/mcp", "work")).toBe("settings");
    expect(GOAL_ROUTE.settings).toBe("/einstellungen");
  });

  it("leaves the goal alone on routes without an old view", () => {
    expect(hasLegacyPanel("/team/personas")).toBe(false);
    expect(hasLegacyPanel("/einstellungen/projekt")).toBe(true);
    expect(goalForPath("/team", "review")).toBe("review");
  });

  it("only rewrites the hash when the old UI left the route", () => {
    expect(hashForGoal("work", "/leitstand/verlauf")).toBeNull();
    expect(hashForGoal("review", "/leitstand")).toBe("#/beweise");
    expect(hashForGoal("attention", "/leitstand/verlauf")).toBeNull();
    expect(hashForGoal("agents", "/leitstand")).toBeNull();
  });

  it("writes the route of the goal the old UI switched to", () => {
    expect(hashForGoal("insights", "/leitstand/verlauf")).toBe("#/steuerung");
    expect(hashForGoal("settings", "/leitstand")).toBe("#/einstellungen");
    expect(hashForGoal("work", "/beweise/diff")).toBe("#/leitstand");
  });

  it("gives the new Leitstand exactly /leitstand and leaves the rest to the old view", () => {
    expect(isNewLeitstand("/leitstand")).toBe(true);
    expect(isNewLeitstand("/leitstand/")).toBe(true);
    expect(isNewLeitstand("/leitstand/betrieb")).toBe(true);
    expect(isNewLeitstand("/leitstand/klassisch")).toBe(false);
    expect(isNewLeitstand("/beweise")).toBe(false);
    expect(hasLegacyPanel("/leitstand/klassisch")).toBe(true);
  });

  it("gives the new Steuerung every path under /steuerung and nothing else", () => {
    expect(isNewSteuerung("/steuerung")).toBe(true);
    expect(isNewSteuerung("/steuerung/")).toBe(true);
    expect(isNewSteuerung("/steuerung/autonomie")).toBe(true);
    expect(isNewSteuerung("/steuerungx")).toBe(false);
    expect(isNewSteuerung("/leitstand")).toBe(false);
  });
});

describe("new Einstellungen route (V2-S10a)", () => {
  it("owns exactly /einstellungen and leaves the classic and tab paths to the old view", () => {
    expect(isNewEinstellungen("/einstellungen")).toBe(true);
    expect(isNewEinstellungen("/einstellungen/")).toBe(true);
    expect(isNewEinstellungen("/einstellungen/klassisch")).toBe(false);
    expect(isNewEinstellungen("/einstellungen/mcp")).toBe(false);
    expect(hasLegacyPanel("/einstellungen/klassisch")).toBe(true);
  });
});
