import { describe, expect, it } from "vitest";

import { APP_GOALS, GOAL_LABELS, RETIRED_NAV_LABELS } from "./goals";

describe("F2 product goals", () => {
  it("exposes exactly the six Rev-9 goals", () => {
    expect([...APP_GOALS]).toEqual([
      "work",
      "attention",
      "agents",
      "review",
      "insights",
      "settings",
    ]);
    expect(APP_GOALS.map((id) => GOAL_LABELS[id])).toEqual([
      "Work",
      "Attention",
      "Agents",
      "Review",
      "Insights",
      "Settings",
    ]);
  });

  it("does not keep retired surfaces as goals", () => {
    const labels = new Set(APP_GOALS.map((id) => GOAL_LABELS[id]));
    for (const retired of RETIRED_NAV_LABELS) {
      expect(labels.has(retired)).toBe(false);
    }
  });
});
