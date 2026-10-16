// PLAN-GATE: the plan check runs as a gate of scripts/ci/gates.sh. Drives the
// real gate runner (`gates.sh run plan-check`) on a copied fixture tree, so the
// lane wiring and the gate command are tested, not plan-model internals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const table = (rows) => `| ID | Ziel | Status | Dep |\n|---|---|---|---|\n${rows}\n`;

function fixture(plan) {
  const root = mkdtempSync(join(tmpdir(), "plan-gate-"));
  for (const f of ["scripts/ci/gates.sh", "scripts/plan-check.mjs", "scripts/lib/plan-model.mjs", "scripts/lib/dev-tools.mjs"]) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    cpSync(join(repo, f), join(root, f));
  }
  mkdirSync(join(root, "docs/plan/v2.0"), { recursive: true });
  writeFileSync(join(root, "docs/PLAN.md"), plan);
  writeFileSync(join(root, "docs/plan/v2.0/plan.md"), "");
  writeFileSync(join(root, "docs/decisions.md"), "");
  return root;
}
// No token and no network: an unusable gh must not change the verdict.
const gate = (root) => spawnSync("bash", [join(root, "scripts/ci/gates.sh"), "run", "plan-check"],
  { cwd: root, encoding: "utf8", env: { ...process.env, GH_TOKEN: "", GITHUB_TOKEN: "", GIT_CEILING_DIRECTORIES: dirname(root) } });

test("plan-check gate fails on a plan finding and passes on a clean plan", () => {
  const red = gate(fixture(table("| A-1 | A | Geplant | B-9 |")));
  assert.equal(red.status, 1, red.stdout + red.stderr);
  assert.match(red.stdout, /unknown-dependency A-1/);
  const green = gate(fixture(table("| A-1 | A | Erledigt | |")));
  assert.equal(green.status, 0, green.stdout + green.stderr);
  assert.match(green.stdout, /Plan-Prüfung: 0 Befunde/);
  assert.match(green.stdout, /NICHT GEPRÜFT: GitHub-PRs[^\n]*--offline[^\n]*Laufende Jobs/);
});

test("plan-check gate runs in the local and the linux CI lanes", () => {
  for (const lane of ["precommit", "prepush", "branchpush", "linux", "linux_1"]) {
    const r = spawnSync("bash", [join(repo, "scripts/ci/gates.sh"), "--list", lane], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.split("\n").includes("plan-check"), lane);
  }
});
