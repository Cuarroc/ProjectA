import { describe, expect, it } from "vitest";

import { pathFromHash } from "./routes";

describe("pathFromHash", () => {
  it("maps a bare slash hash and a query hash to a route path", () => {
    expect(pathFromHash("#/")).toBe("/leitstand");
    expect(pathFromHash("")).toBe("/leitstand");
    expect(pathFromHash("#/team/personas?x=1")).toBe("/team/personas");
    expect(pathFromHash("#/leitstand/")).toBe("/leitstand");
    expect(pathFromHash("#/team")).toBe("/team");
  });
});
