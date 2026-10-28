// scripts/lib/updater-zip-security.test.mjs
// SEC-01b: the updater's Windows zip edge must resolve to a zip release that
// carries the fix for RUSTSEC-2026-0367/0368/0369 (patched: >= 9.0.0).
// Reads only the committed manifest and lockfile; no cargo, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const TAURI = new URL("../../src-tauri/", import.meta.url);
const PATCHED_ZIP_MAJOR = 9; // advisory minimum 9.0.0
const UPDATER = "tauri-plugin-updater";

function lockPackages(text) {
  return text.split("[[package]]").slice(1).map((block) => ({
    name: /^name = "(.+)"$/m.exec(block)?.[1],
    version: /^version = "(.+)"$/m.exec(block)?.[1],
    deps: [...(/^dependencies = \[([\s\S]*?)^\]/m.exec(block)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]),
  }));
}

const major = (v) => Number(v.split(".")[0]);

test("updater resolves a patched Windows zip dependency without suppression", () => {
  const packages = lockPackages(readFileSync(new URL("Cargo.lock", TAURI), "utf8"));
  const updater = packages.filter((p) => p.name === UPDATER);
  assert.equal(updater.length, 1, "exactly one locked updater package");

  const refs = updater[0].deps.filter((d) => d === "zip" || d.startsWith("zip "));
  assert.ok(refs.length > 0, "updater still depends on zip (re-check this test if it was dropped)");
  for (const ref of refs) {
    const [, wantVersion] = ref.split(" ");
    const hits = packages.filter((p) => p.name === "zip" && (!wantVersion || p.version === wantVersion));
    assert.equal(hits.length, 1, `lock entry for updater dependency "${ref}"`);
    assert.ok(
      major(hits[0].version) >= PATCHED_ZIP_MAJOR,
      `updater ${updater[0].version} depends on zip ${hits[0].version}, advisory minimum is ${PATCHED_ZIP_MAJOR}.0.0`,
    );
  }

  // The manifest floor keeps `cargo update` from ever re-resolving below the patched updater.
  const manifest = readFileSync(new URL("Cargo.toml", TAURI), "utf8");
  assert.match(manifest, /^tauri-plugin-updater = "2\.14\.1"$/m, "manifest requires updater >= 2.14.1");
});
