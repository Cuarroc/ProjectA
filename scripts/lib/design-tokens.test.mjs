// V2-F1: every package token is declared in src/design/tokens.css.
// The file is absent on the merge base, so this test is red there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tokensPath = join(root, "src", "design", "tokens.css");

// Names from the glass Leitstand token block, in the --g-* namespace.
// Theme pairs are set in both schemes. Shared tokens are set once.
const THEME = [
  "g-ground", "g-ink", "g-ink2", "g-muted", "g-faint",
  "g-line", "g-hair", "g-tint", "g-tint-hi", "g-hover",
  "g-accent", "g-accent-hover", "g-on-accent", "g-accent-soft", "g-accent-line",
  "g-sw-on", "g-sw-off",
  "g-run", "g-run-bg", "g-need", "g-need-bg", "g-on-need",
  "g-rev", "g-rev-bg", "g-ok", "g-ok-bg", "g-done", "g-done-bg",
  "g-bad", "g-bad-bg", "g-danger-line",
  "g-chrome-bg", "g-content-bg",
  "g-spec", "g-shadow", "g-shadow-pop",
  "g-amb1", "g-amb2", "g-amb3",
  "g-av1", "g-av2", "g-av3", "g-av4", "g-av5", "g-av6",
];
const SHARED = [
  "g-chrome-blur", "g-content-blur", "g-pad",
  "g-r-panel", "g-r-card", "g-r-ctl",
  "g-font-sans", "g-font-mono",
];

function declarations(block) {
  const clean = block.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = {};
  for (const match of clean.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    found[match[1]] = match[2].trim();
  }
  return found;
}

test("every required V2-F1 token is set in tokens.css", () => {
  const css = readFileSync(tokensPath, "utf8");
  const darkAt = css.indexOf("@media (prefers-color-scheme: dark)");
  assert.ok(darkAt > 0, "dark scheme block");
  const light = declarations(css.slice(0, darkAt));
  const dark = declarations(css.slice(darkAt));
  for (const name of [...THEME, ...SHARED]) {
    assert.ok(light[name], `light missing --${name}`);
  }
  for (const name of THEME) {
    assert.ok(dark[name], `dark missing --${name}`);
  }
  assert.equal(light["g-r-panel"], "20px");
  assert.equal(light["g-r-card"], "14px");
  assert.equal(light["g-r-ctl"], "10px");
  assert.match(light["g-font-sans"], /"Geist"/);
  assert.match(light["g-font-sans"], /"Inter"/);
  assert.match(light["g-font-mono"], /"Geist Mono"/);
  assert.match(light["g-font-mono"], /"Cascadia Mono"/);
  assert.doesNotMatch(css, /@font-face|fonts\.googleapis|url\s*\(/i);
});
