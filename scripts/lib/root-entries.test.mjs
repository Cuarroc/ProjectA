// V161-ROOT-GUARD — tracked top-level names must match this allowlist.
// Generated from `git ls-files` top level (2026-10-10). A new legitimate
// root file needs exactly one new line in ALLOWED_ROOT_ENTRIES.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

/** @type {readonly string[]} */
const ALLOWED_ROOT_ENTRIES = Object.freeze([
  ".gitattributes",
  ".gitignore",
  ".gitleaks.toml",
  ".mergify.yml",
  "AGENTS.md",
  "CHANGELOG.md",
  "CLAUDE.md",
  "KNOWN_ISSUES.md",
  "LICENSE",
  "PRODUCT.md",
  "README.md",
  "SECURITY.md",
  "STAND.md",
  "eslint.config.js",
  "index.html",
  "package-lock.json",
  "package.json",
  "playwright.config.ts",
  "projecta.dev.json",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
]);

/** Tracked files whose path has no `/` (repository root only). */
function trackedTopLevelNames(cwd = root) {
  const out = execFileSync("git", ["-C", cwd, "ls-files"], { encoding: "utf8" });
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((p) => !p.includes("/"))
    .sort();
}

/** Names in `names` that are not on the allowlist (sorted). */
export function unexpectedRootEntries(names) {
  const allowed = new Set(ALLOWED_ROOT_ENTRIES);
  return [...names].filter((n) => !allowed.has(n)).sort();
}

test("root entries: tracked top-level names match the allowlist", () => {
  const tracked = trackedTopLevelNames();
  assert.deepEqual(
    unexpectedRootEntries(tracked),
    [],
    `unexpected root entries: ${unexpectedRootEntries(tracked).join(", ") || "(none)"}; if legitimate, add one allowlist line`,
  );
  assert.deepEqual(tracked, [...ALLOWED_ROOT_ENTRIES].sort());
});

test("root entries: a fixture with 100 and e is rejected", () => {
  const fixture = [...ALLOWED_ROOT_ENTRIES, "100", "e"];
  assert.deepEqual(unexpectedRootEntries(fixture), ["100", "e"]);
});
