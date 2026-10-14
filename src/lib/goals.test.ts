import { describe, expect, it } from "vitest";

import { t } from "../i18n/useT";
import { APP_GOALS, goalLabelKey, RETIRED_NAV_LABELS } from "./goals";

describe("F2 product goals", () => {
  it("names the six Rev-9 goals in German", () => {
    expect([...APP_GOALS]).toEqual([
      "work",
      "attention",
      "agents",
      "review",
      "insights",
      "settings",
    ]);
    expect(APP_GOALS.map((id) => t(goalLabelKey(id)))).toEqual([
      "Arbeit",
      "Achtung",
      "Agenten",
      "Prüfung",
      "Auswertung",
      "Einstellungen",
    ]);
  });

  it("does not keep retired surfaces as goals", () => {
    const labels = new Set(APP_GOALS.map((id) => t(goalLabelKey(id))));
    for (const retired of RETIRED_NAV_LABELS) {
      expect(labels.has(retired)).toBe(false);
    }
  });
});
