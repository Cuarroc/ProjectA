import { expect, it } from "vitest";

import { ageText } from "./leitstand";

it("never prints NaN when a timestamp is not finite", () => {
  const nonFinite = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const createdAt of nonFinite) {
    const text = ageText(createdAt, 0);
    expect(text).toBe("gerade eben");
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("Infinity");
  }
  for (const now of nonFinite) {
    const text = ageText(0, now);
    expect(text).toBe("gerade eben");
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("Infinity");
  }
  expect(ageText(0, 38 * 60)).toBe("seit 38 min");
});
