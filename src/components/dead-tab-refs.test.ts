import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The "Fragen-Tab" and "Usage-Tab" no longer exist (goals "attention" and
 * "insights" replaced them). UI copy must name the real views; this guard
 * fails if any non-test source file under src/ mentions a dead tab.
 */
const DEAD_REFS = ["Fragen-Tab", "Usage-Tab"];

const SRC_ROOT = join(__dirname, "..");

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "test" || entry === "__tests__") continue;
      yield* sourceFiles(full);
      continue;
    }
    if (entry.includes(".test.") || entry.includes(".spec.")) continue;
    yield full;
  }
}

describe("dead tab references", () => {
  it("no non-test file under src/ mentions a retired tab", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_ROOT)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        for (const ref of DEAD_REFS) {
          if (line.includes(ref)) {
            offenders.push(`${relative(SRC_ROOT, file)}:${index + 1} mentions '${ref}'`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
