// V2-F7: shot.mjs writes 1440×900 light/dark PNGs and checks tab order on a fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { main, pngSize, VIEWPORT } from "../dev/shot.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(ROOT, "../dev/fixtures/shot.html");
const FIXTURE_NO_RING = join(ROOT, "../dev/fixtures/shot-no-ring.html");

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

test("shot tab check visits identical-label controls by identity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "v2-f7-dup-"));
  const fixture = join(dir, "dup.html");
  writeFileSync(
    fixture,
    `<!doctype html><html lang="de"><head><meta charset="utf-8"/><style>
      :focus-visible { outline: 2px solid #1F57D6; }
      button { height: 36px; margin: 4px; }
    </style></head><body>
      <button type="button">OK</button>
      <button type="button">OK</button>
      <button type="button">OK</button>
    </body></html>`,
  );
  const out = mkdtempSync(join(tmpdir(), "v2-f7-dup-out-"));
  try {
    let stdout = "";
    const code = await main(
      ["--route", "/dup", "--fixture", fixture, "--out", out, "--check-tab"],
      { out: (s) => (stdout += s), err: () => {} },
    );
    assert.equal(code, 0, stdout);
    const report = JSON.parse(stdout);
    assert.equal(report.tab.ok, true);
    assert.equal(report.tab.visited, 3);
    assert.equal(report.tab.expected, 3);
    assert.equal(report.tab.missingFocusRing, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test("shot tab check counts one stop per radio group", async () => {
  const dir = mkdtempSync(join(tmpdir(), "v2-f7-radio-"));
  const fixture = join(dir, "radio.html");
  writeFileSync(
    fixture,
    `<!doctype html><html lang="de"><head><meta charset="utf-8"/><style>
      :focus-visible { outline: 2px solid #1F57D6; }
    </style></head><body>
      <button type="button">Vor</button>
      <label><input type="radio" name="wahl" value="a"/> A</label>
      <label><input type="radio" name="wahl" value="b"/> B</label>
      <label><input type="radio" name="wahl" value="c"/> C</label>
      <button type="button">Nach</button>
    </body></html>`,
  );
  const out = mkdtempSync(join(tmpdir(), "v2-f7-radio-out-"));
  try {
    let stdout = "";
    const code = await main(
      ["--route", "/radio", "--fixture", fixture, "--out", out, "--check-tab"],
      { out: (s) => (stdout += s), err: () => {} },
    );
    assert.equal(code, 0, stdout);
    const report = JSON.parse(stdout);
    assert.equal(report.tab.ok, true);
    assert.equal(report.tab.expected, 3, `expected 2 buttons + 1 radio group, got ${report.tab.expected}`);
    assert.equal(report.tab.visited, 3);
    assert.equal(report.tab.missingFocusRing, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test("shot tab check fails when focus ring is removed", async () => {
  const out = mkdtempSync(join(tmpdir(), "v2-f7-noring-"));
  try {
    let stdout = "";
    const code = await main(
      ["--route", "/noring", "--fixture", FIXTURE_NO_RING, "--out", out, "--check-tab"],
      { out: (s) => (stdout += s), err: () => {} },
    );
    assert.equal(code, 1, `expected exit 1 for missing ring, got ${code}; stdout=${stdout}`);
    const report = JSON.parse(stdout);
    assert.ok(report.tab, "tab report missing on failure");
    assert.equal(report.tab.ok, false);
    assert.ok(report.tab.missingFocusRing > 0, "missingFocusRing should be > 0");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
