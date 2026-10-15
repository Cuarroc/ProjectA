import { expect, it } from "vitest";

import { sizeChip } from "./sizeChip";

it("marks 301 changed lines as over the limit", () => {
  const chip = sizeChip([{ additions: 200, deletions: 101 }]);
  expect(chip).toMatchObject({ kind: "over", lines: 301 });
  expect(chip.text).toContain("301");
  expect(chip.text).toContain("über 300");
});

it("marks 300 changed lines as within the limit", () => {
  expect(sizeChip([{ additions: 300, deletions: 0 }])).toEqual({ kind: "within", lines: 300, text: "300 Zeilen" });
});

it("sums additions and deletions over every file", () => {
  expect(sizeChip([{ additions: 1, deletions: 2 }, { additions: 3, deletions: 4 }])).toMatchObject({ lines: 10 });
});

it("says there is no diff yet when the diff is missing", () => {
  expect(sizeChip(null)).toEqual({ kind: "none", text: "noch kein Diff" });
});
