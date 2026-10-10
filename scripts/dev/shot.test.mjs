// Historical Test-First trailers (d2ab513/4fcd54e) require this path at HEAD.
// Canonical suite: scripts/lib/dev-shot.test.mjs (`npm run test:hq`).
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "../lib/dev-shot.test.mjs");

function delegate(name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const r = spawnSync(process.execPath, ["--test", "--test-name-pattern", `^${esc}$`, LIB], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, (r.stdout || "") + (r.stderr || ""));
}

test("shot writes light and dark 1440x900 PNGs for a fixture route", () => {
  delegate("shot writes light and dark 1440x900 PNGs for a fixture route");
});

test("shot tab check reaches every focusable control with a visible focus ring", () => {
  delegate("shot tab check reaches every focusable control with a visible focus ring");
});
