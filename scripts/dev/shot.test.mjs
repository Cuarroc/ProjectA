// Historical Test-First trailers (d2ab513/4fcd54e) require this path at HEAD.
// Canonical suite: scripts/lib/dev-shot.test.mjs (`npm run test:hq`).
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, pngSize, VIEWPORT } from "./shot.mjs";

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

// DS-H-07b: --theme, --motion, --reduced, --dpr, --wait, --video (offline, --fixture only).
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures/shot-motion.html");

async function runShot(args) {
  const out = mkdtempSync(join(tmpdir(), "ds-h-07b-"));
  let stdout = "";
  let stderr = "";
  const code = await main(["--route", "/fixture", "--fixture", FIXTURE, "--out", out, ...args], {
    out: (s) => (stdout += s),
    err: (s) => (stderr += s),
  });
  return { code, stdout, stderr, out, report: code === 0 ? JSON.parse(stdout) : null };
}

test("--dpr 1.5 writes a png at 1.5x size with a dpr suffix", async () => {
  const { code, out, report } = await runShot(["--dpr", "1.5"]);
  try {
    assert.equal(code, 0);
    assert.equal(report.dpr, 1.5);
    for (const scheme of ["light", "dark"]) {
      const size = pngSize(readFileSync(join(out, `fixture-dpr1.5-${scheme}.png`)));
      assert.deepEqual(size, { width: VIEWPORT.width * 1.5, height: VIEWPORT.height * 1.5 });
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("--motion lively stores the motion mode before load", async () => {
  const { code, out, report } = await runShot(["--motion", "lively"]);
  try {
    assert.equal(code, 0);
    assert.deepEqual(report.motionApplied, {
      light: { motion: "lively", reduced: false },
      dark: { motion: "lively", reduced: false },
    });
    assert.ok(existsSync(join(out, "fixture-lively-light.png")));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("--motion calm leaves the app without a stored motion mode", async () => {
  const { code, out, report } = await runShot(["--motion", "calm"]);
  try {
    assert.equal(code, 0);
    assert.equal(report.motionApplied.light.motion, "calm");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("--reduced emulates reduced motion", async () => {
  const { code, out, report } = await runShot(["--motion", "lively", "--reduced"]);
  try {
    assert.equal(code, 0);
    assert.deepEqual(report.motionApplied.light, { motion: "lively", reduced: true });
    assert.ok(existsSync(join(out, "fixture-lively-reduced-light.png")));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("--theme dark writes only the dark png", async () => {
  const { code, out, report } = await runShot(["--theme", "dark"]);
  try {
    assert.equal(code, 0);
    assert.deepEqual(report.files, [join(out, "fixture-dark.png")]);
    assert.ok(!existsSync(join(out, "fixture-light.png")));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("--wait delays the screenshot until a late frame is visible", async () => {
  const early = await runShot(["--theme", "light"]);
  const late = await runShot(["--theme", "light", "--wait", "1600"]);
  try {
    assert.equal(late.report.wait, 1600);
    assert.notDeepEqual(
      readFileSync(join(early.out, "fixture-light.png")),
      readFileSync(join(late.out, "fixture-light.png")),
    );
  } finally {
    rmSync(early.out, { recursive: true, force: true });
    rmSync(late.out, { recursive: true, force: true });
  }
});

test("--video writes a webm", async () => {
  const { code, out, report } = await runShot(["--theme", "light", "--video", "1"]);
  try {
    assert.equal(code, 0);
    const dest = join(out, "fixture-light.webm");
    assert.deepEqual(report.videos, [dest]);
    // EBML magic of a Matroska/WebM file.
    assert.deepEqual([...readFileSync(dest).subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("unknown values fail with a usage error", async () => {
  for (const args of [
    ["--motion", "wild"],
    ["--theme", "sepia"],
    ["--dpr", "0"],
    ["--dpr", "abc"],
    ["--dpr", "9"],
    ["--wait", "-1"],
    ["--wait", "x"],
    ["--video", "0"],
    ["--video", "x"],
  ]) {
    const { code, out } = await runShot(args);
    rmSync(out, { recursive: true, force: true });
    assert.equal(code, 2, args.join(" "));
  }
});
