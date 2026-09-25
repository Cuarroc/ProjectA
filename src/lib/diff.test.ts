import { describe, expect, it } from "vitest";

import type { WorkerDiff } from "../types";
import { summarizeDiff } from "./diff";

describe("summarizeDiff", () => {
  it("aggregates file, addition, and deletion counts", () => {
    const diff: WorkerDiff = {
      baseBranch: "main",
      stat: "2 files changed, 10 insertions(+), 5 deletions(-)",
      code: null,
      files: [
        {
          path: "src/first.ts",
          oldPath: null,
          additions: 7,
          deletions: 1,
          binary: false,
          hunks: [],
        },
        {
          path: "src/second.ts",
          oldPath: null,
          additions: 3,
          deletions: 4,
          binary: false,
          hunks: [],
        },
      ],
    };

    expect(summarizeDiff(diff)).toEqual({
      baseBranch: "main",
      files: 2,
      additions: 10,
      deletions: 5,
    });
  });
});
