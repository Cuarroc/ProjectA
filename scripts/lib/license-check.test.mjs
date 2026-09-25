// scripts/lib/license-check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_LICENSES, evaluateLicenses } from "./license-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("lic-01: allowlist matches the user-approved license list", () => {
  assert.deepEqual([...ALLOWED_LICENSES].sort(), [
    "0BSD",
    "Apache-2.0",
    "Apache-2.0 WITH LLVM-exception",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "BSL-1.0",
    "CC0-1.0",
    "ISC",
    "MIT",
    "MPL-2.0",
    "OFL-1.1",
    "Unicode-3.0",
    "Unicode-DFS-2016",
    "Zlib",
  ]);
});

test("lic-01: clean report yields no violations", () => {
  const report = {
    "react@18.3.1": { licenses: "MIT" },
    "@tauri-apps/api@2.11.1": { licenses: "Apache-2.0 OR MIT" },
    "mixed@1.0.0": { licenses: "(BSD-3-Clause OR Apache-2.0)" },
  };
  assert.deepEqual(evaluateLicenses(report, "projecta"), []);
});

test("lic-01: rejects a license outside the allowlist", () => {
  const report = {
    "ok@1.0.0": { licenses: "MIT" },
    "bad@2.0.0": { licenses: "GPL-3.0-only" },
    "unknown@3.0.0": { licenses: "UNKNOWN" },
  };
  const violations = evaluateLicenses(report, "projecta");
  assert.deepEqual(violations, [
    "bad@2.0.0: GPL-3.0-only",
    "unknown@3.0.0: UNKNOWN",
  ]);
});

test("lic-01: the project's own unlicensed root package is skipped", () => {
  const report = { "projecta@1.4.1": { licenses: "UNLICENSED" } };
  assert.deepEqual(evaluateLicenses(report, "projecta"), []);
});

test("lic-01: cli exits 1 and names the offending package", () => {
  const dir = mkdtempSync(join(tmpdir(), "lic-check-"));
  const file = join(dir, "report.json");
  writeFileSync(file, JSON.stringify({ "bad@1.0.0": { licenses: "AGPL-3.0-only" } }));
  let code = 0;
  let out = "";
  try {
    out = execFileSync(process.execPath, [join(HERE, "license-check.mjs"), file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    code = err.status;
    out = `${err.stdout}${err.stderr}`;
  }
  assert.equal(code, 1);
  assert.match(out, /bad@1\.0\.0: AGPL-3\.0-only/);
});
