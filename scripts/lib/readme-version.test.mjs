// scripts/lib/readme-version.test.mjs
// README.md names the app version in its status section. scripts/release.cmd
// bumps the version files and rewrites that line in the same commit; this
// test keeps the two from drifting (the README said v1.4.1 while the app
// was already 1.5.0).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("README status names the app version of package.json and tauri.conf.json", () => {
  const pkg = JSON.parse(read("package.json")).version;
  const tauri = JSON.parse(read("src-tauri/tauri.conf.json")).version;
  assert.equal(pkg, tauri, "package.json and tauri.conf.json disagree");
  const named = [...read("README.md").matchAll(/^- \*\*App-Version:\*\* `v(\d+\.\d+\.\d+)`/gm)];
  assert.equal(named.length, 1, "README.md needs exactly one '- **App-Version:** `vX.Y.Z`' line");
  assert.equal(named[0][1], pkg, "README.md names another app version");
});

// F1 (review #513): the release rewrite must fail loudly when the line is gone,
// otherwise release.cmd would tag a release whose README names the old version.
test("readme-version-bump rewrites the App-Version line and fails when it is missing", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, readFileSync: rf } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const script = new URL("readme-version-bump.mjs", import.meta.url).pathname;
  const dir = mkdtempSync(join(tmpdir(), "readme-bump-"));
  const file = join(dir, "README.md");

  writeFileSync(file, "# T\r\n- **App-Version:** `v1.0.0` (Beta)\r\nÜmläut\r\n");
  const ok = spawnSync("node", [script, file, "2.3.4"]);
  assert.equal(ok.status, 0, ok.stderr.toString());
  assert.equal(rf(file, "utf8"), "# T\r\n- **App-Version:** `v2.3.4` (Beta)\r\nÜmläut\r\n");

  writeFileSync(file, "# T\nApp-Version: v1.0.0\n");
  const bad = spawnSync("node", [script, file, "2.3.4"]);
  assert.notEqual(bad.status, 0, "missing line must be a non-zero exit");
  assert.match(bad.stderr.toString(), /App-Version/);
});
