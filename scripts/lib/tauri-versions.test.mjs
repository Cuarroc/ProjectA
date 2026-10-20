import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Tauri plugin Rust and npm packages have matching major.minor versions", () => {
  const cargoLock = readFileSync(new URL("../../src-tauri/Cargo.lock", import.meta.url), "utf8");
  const npmLock = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"));
  const crates = [...cargoLock.matchAll(/^name = "(tauri(?:-plugin-[^"]+)?)"\r?\nversion = "([^"]+)"/gm)];
  assert.ok(crates.length > 0, "Cargo.lock must contain Tauri packages");

  let pairs = 0;
  for (const [, crate, rustVersion] of crates) {
    // Core tauri/api compatibility is outside this plugin regression check.
    if (crate === "tauri") continue;
    const npmName = `@tauri-apps/${crate.slice("tauri-".length)}`;
    const npmVersion = npmLock.packages[`node_modules/${npmName}`]?.version;
    if (!npmVersion) continue;
    pairs += 1;
    assert.equal(
      npmVersion.split(".").slice(0, 2).join("."),
      rustVersion.split(".").slice(0, 2).join("."),
      `${crate} (${rustVersion}) and ${npmName} (${npmVersion}) must agree on major.minor`,
    );
  }
  assert.ok(pairs > 0, "At least one Rust/npm plugin pair must be checked");
});
