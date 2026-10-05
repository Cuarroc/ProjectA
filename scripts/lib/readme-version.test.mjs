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
