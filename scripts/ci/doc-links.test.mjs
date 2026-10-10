import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const gate = join(dirname(fileURLToPath(import.meta.url)), "doc-links.mjs");

function run(files) {
  const root = mkdtempSync(join(tmpdir(), "projecta-doc-links-"));
  for (const [path, contents] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return spawnSync(process.execPath, [gate, "check", root], { encoding: "utf8" });
}

test("a broken relative link in a fixture tree fails with file:line", () => {
  const result = run({
    "docs/a.md": "# A\n\nsee [gone](missing.md) and [up](../b.md)\n",
    "b.md": "# B\n",
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /docs\/a\.md:3 .*missing\.md/);
  assert.equal(result.stderr.trim().split("\n").length, 1, "only the broken link is reported");
});

test("anchors and external URLs are ignored", () => {
  const result = run({
    "a.md":
      "[web](https://example.com/x.md) [mail](mailto:a@b.c) [top](#intro) " +
      "[ok](b.md#part) [ok2](<b.md> \"title\")\n\n```\n[fenced](nope.md)\n```\n" +
      "inline `[code](nope.md)` stays quiet\n",
    "b.md": "# B\n",
    ".pa/old.md": "[dead](nowhere.md)\n",
    "docs/archive/old.md": "[dead](nowhere.md)\n",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
