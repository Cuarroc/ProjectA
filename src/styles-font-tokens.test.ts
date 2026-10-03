import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "styles.css"), "utf8").replace(/\r\n/g, "\n");

/** styles.css without the first `:root { ... }` block, where tokens live. */
function withoutRoot(source: string): string {
  const start = source.indexOf(":root {");
  expect(start, ":root block not found").toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n}\n", start);
  return source.slice(0, start) + source.slice(end + 3);
}

describe("UX-02: the monospace font is one token", () => {
  it("defines --font-mono on :root", () => {
    expect(css).toMatch(/:root \{[\s\S]*?--font-mono:\s*"Cascadia Mono"/);
  });

  it("hard-codes no Cascadia Mono outside :root", () => {
    const hits = withoutRoot(css)
      .split("\n")
      .filter((line) => line.includes("Cascadia Mono"));
    expect(hits).toEqual([]);
  });
});
