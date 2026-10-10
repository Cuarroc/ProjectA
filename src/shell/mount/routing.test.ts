import { describe, expect, it } from "vitest";

import { GOAL_ROUTE, goalForPath, hasLegacyPanel, hashForGoal, isNewLeitstand } from "./routing";

describe("goal and route mapping (ia.md section 4)", () => {
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
  });

  it("gives the new Leitstand exactly /leitstand and leaves the rest to the old view", () => {
    expect(isNewLeitstand("/leitstand")).toBe(true);
    expect(isNewLeitstand("/leitstand/")).toBe(true);
    expect(isNewLeitstand("/leitstand/klassisch")).toBe(false);
    expect(isNewLeitstand("/beweise")).toBe(false);
    expect(hasLegacyPanel("/leitstand/klassisch")).toBe(true);
  });
});
