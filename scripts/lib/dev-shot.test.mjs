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

async function runShot(args) {
  let stdout = "";
  const code = await main(args, { out: (s) => (stdout += s), err: () => {} });
  return { code, stdout };
}

test("shot writes light and dark 1440x900 PNGs for a fixture route", async () => {
  const out = mkdtempSync(join(tmpdir(), "v2-f7-shot-"));
  try {
    const { code, stdout } = await runShot(["--route", "/fixture", "--fixture", FIXTURE, "--out", out]);
    assert.equal(code, 0, stdout);
    for (const name of ["fixture-light.png", "fixture-dark.png"]) {
      const p = join(out, name);
      assert.ok(existsSync(p), `${name} missing`);
      assert.deepEqual(pngSize(readFileSync(p)), VIEWPORT);
    }
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
    const { code, stdout } = await runShot([
      "--route", "/fixture", "--fixture", FIXTURE, "--out", out, "--check-tab",
    ]);
    assert.equal(code, 0, stdout);
    const report = JSON.parse(stdout);
    assert.ok(report.tab);
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
    `<!doctype html><html lang="de"><head><meta charset="utf-8"/><style>:focus-visible{outline:2px solid #1F57D6}button{height:36px;margin:4px}</style></head><body><button type="button">OK</button><button type="button">OK</button><button type="button">OK</button></body></html>`,
  );
  const out = mkdtempSync(join(tmpdir(), "v2-f7-dup-out-"));
  try {
    const { code, stdout } = await runShot(["--route", "/dup", "--fixture", fixture, "--out", out, "--check-tab"]);
    assert.equal(code, 0, stdout);
    const tab = JSON.parse(stdout).tab;
    assert.equal(tab.ok, true);
    assert.equal(tab.visited, 3);
    assert.equal(tab.expected, 3);
    assert.equal(tab.missingFocusRing, 0);
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
    `<!doctype html><html lang="de"><head><meta charset="utf-8"/><style>:focus-visible{outline:2px solid #1F57D6}</style></head><body><button type="button">Vor</button><label><input type="radio" name="wahl" value="a"/> A</label><label><input type="radio" name="wahl" value="b"/> B</label><label><input type="radio" name="wahl" value="c"/> C</label><button type="button">Nach</button></body></html>`,
  );
  const out = mkdtempSync(join(tmpdir(), "v2-f7-radio-out-"));
  try {
    const { code, stdout } = await runShot(["--route", "/radio", "--fixture", fixture, "--out", out, "--check-tab"]);
    assert.equal(code, 0, stdout);
    const tab = JSON.parse(stdout).tab;
    assert.equal(tab.ok, true);
    assert.equal(tab.expected, 3, `expected 2 buttons + 1 radio group, got ${tab.expected}`);
    assert.equal(tab.visited, 3);
    assert.equal(tab.missingFocusRing, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test("shot tab check fails when focus ring is removed", async () => {
  const out = mkdtempSync(join(tmpdir(), "v2-f7-noring-"));
  try {
    const { code, stdout } = await runShot([
      "--route", "/noring", "--fixture", FIXTURE_NO_RING, "--out", out, "--check-tab",
    ]);
    assert.equal(code, 1, `expected exit 1 for missing ring, got ${code}; stdout=${stdout}`);
    const tab = JSON.parse(stdout).tab;
    assert.ok(tab);
    assert.equal(tab.ok, false);
    assert.ok(tab.missingFocusRing > 0);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("shot --variant stores the glass style before load and names the PNGs", async () => {
  const fixture = join(ROOT, "../dev/fixtures/shot-variant.html");
  const out = mkdtempSync(join(tmpdir(), "v2-thvar2-shot-"));
  try {
    for (const [variant, applied] of [["klar", "klar"], ["glas", "glas"]]) {
      const { code, stdout } = await runShot(["--route", "/fixture", "--fixture", fixture, "--out", out, "--variant", variant]);
      assert.equal(code, 0, stdout);
      const report = JSON.parse(stdout);
      assert.equal(report.variant, variant);
      assert.equal(report.applied, applied);
      assert.ok(existsSync(join(out, `fixture-${variant}-dark.png`)));
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("shot --variant rejects an unknown style with exit 2", async () => {
  const { code } = await runShot(["--route", "/fixture", "--variant", "xyz"]);
  assert.equal(code, 2);
});
