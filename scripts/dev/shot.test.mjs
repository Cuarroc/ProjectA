// V2-F7: shot.mjs writes 1440×900 light/dark PNGs and checks tab order on a fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { main, pngSize, VIEWPORT } from "./shot.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(ROOT, "fixtures", "shot.html");

test("shot writes light and dark 1440x900 PNGs for a fixture route", async () => {
  const out = mkdtempSync(join(tmpdir(), "v2-f7-shot-"));
  try {
    let stdout = "";
    const code = await main(
      ["--route", "/fixture", "--fixture", FIXTURE, "--out", out],
      { out: (s) => (stdout += s), err: () => {} },
    );
    assert.equal(code, 0, stdout);
    const light = join(out, "fixture-light.png");
    const dark = join(out, "fixture-dark.png");
    assert.ok(existsSync(light), "light png missing");
    assert.ok(existsSync(dark), "dark png missing");
    assert.deepEqual(pngSize(readFileSync(light)), VIEWPORT);
    assert.deepEqual(pngSize(readFileSync(dark)), VIEWPORT);
    const report = JSON.parse(stdout);
    assert.equal(report.route, "/fixture");
    assert.equal(report.files.length, 2);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("shot tab check reaches every focusable control with a visible focus ring", async () => {
  const out = mkdtempSync(join(tmpdir(), "v2-f7-tab-"));
  try {
    let stdout = "";
    const code = await main(
      ["--route", "/fixture", "--fixture", FIXTURE, "--out", out, "--check-tab"],
      { out: (s) => (stdout += s), err: () => {} },
    );
    assert.equal(code, 0, stdout);
    const report = JSON.parse(stdout);
    assert.ok(report.tab, "tab report missing");
    assert.equal(report.tab.ok, true);
    assert.ok(report.tab.visited >= 3, `expected ≥3 focusable, got ${report.tab.visited}`);
    assert.equal(report.tab.missingFocusRing, 0);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
