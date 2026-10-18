import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "postcss";
import { describe, expect, it } from "vitest";

const dir = __dirname;

describe("one disabled style", () => {
  it("every design control dims through the one disabled token", () => {
    const tokens = readFileSync(resolve(dir, "tokens.css"), "utf8");
    expect(tokens).toMatch(/--g-disabled-opacity:\s*\.5;/);
    const found: string[] = [];
    for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
      if (!file.endsWith(".css")) continue;
      parse(readFileSync(resolve(dir, file), "utf8")).walkRules((rule) => {
        if (!/:disabled/.test(rule.selector)) return;
        rule.walkDecls("opacity", (decl) => { found.push(`${file}|${rule.selector}|${decl.value}`); });
      });
    }
    expect(found.length).toBeGreaterThanOrEqual(4);
    expect(found.filter((f) => !f.endsWith("|var(--g-disabled-opacity)"))).toEqual([]);
  });
});
