// SETUP-B: every `dev:*` helper under scripts/dev/ is reachable through
// package.json and answers --help as a real process with exit 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;
// The SETUP-B tools; other scripts/dev entries (e.g. agent-setup-check) have
// their own tests and help format.
const TOOLS = ["report-commit", "push-verified", "prune-worktrees", "build-slot", "ci-watch", "pr-status", "erledigt-row", "spec-close", "hygiene", "start-check"];

test("package.json wires the scripts/dev helpers", () => {
  for (const t of TOOLS) assert.equal(scripts[`dev:${t}`], `node scripts/dev/${t}.mjs`, `dev:${t} fehlt in package.json`);
});

for (const t of TOOLS) {
  test(`dev:${t} --help runs as a process and exits 0`, () => {
    const file = `scripts/dev/${t}.mjs`;
    assert.ok(existsSync(join(root, file)), `${file} fehlt`);
    const r = spawnSync(process.execPath, [file, "--help"], { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Exit-Codes/);
  });
}
