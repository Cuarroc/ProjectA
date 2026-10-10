// scripts/lib/theme-contrast.test.mjs — the contrast gate reads every theme in
// src/design/themes and must reject a theme whose text fails on its materials.
// Each case copies the gate and the stylesheets it reads into a temp tree (the
// gate resolves them relative to itself), mutates the tree and runs the gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const glasCss = readFileSync(join(root, "src", "design", "themes", "glas.css"), "utf8");

function runGate(mutate = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "theme-contrast-"));
  try {
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, "docs"), { recursive: true });
    cpSync(join(root, "scripts", "contrast-check.mjs"), join(dir, "scripts", "contrast-check.mjs"));
    cpSync(join(root, "src"), join(dir, "src"), { recursive: true, filter: (p) => !p.includes("components") });
    cpSync(join(root, "docs", "dev-hq"), join(dir, "docs", "dev-hq"), { recursive: true });
    mutate(join(dir, "src", "design", "themes"));
    const r = spawnSync(process.execPath, [join(dir, "scripts", "contrast-check.mjs")], { encoding: "utf8" });
    return { status: r.status, out: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const editGlas = (fn) => (dir) => writeFileSync(join(dir, "glas.css"), fn(readFileSync(join(dir, "glas.css"), "utf8")));

test("gate checks Glas text in light and dark and solid mode over both backdrop stops", () => {
  const r = runGate();
  assert.equal(r.status, 0, r.out);
  for (const mode of ["glas hell  ", "glas hell +", "glas dunkel", "glas dunkel+"])
    for (const stop of ["Stop min", "Stop max"])
      for (const where of ["chrome", "Backdrop"]) assert.match(r.out, new RegExp(`${mode}\\s+text-tertiary / ${where} auf ${stop}`));
});

test("gate fails when a Glas material turns white behind white text in dark mode", () => {
  const r = runGate(editGlas((css) => css.replace("--surface-chrome: var(--g-chrome-bg);", "--surface-chrome: #ffffff;")));
  assert.notEqual(r.status, 0);
  assert.match(r.out, /glas dunkel\s*: text-primary \/ chrome auf Stop (min|max)/);
});

test("gate fails when a Glas surface role points at a token that does not exist", () => {
  const r = runGate(editGlas((css) => css.replace("--surface-card: var(--g-tint);", "--surface-card: var(--g-nope);")));
  assert.notEqual(r.status, 0);
  assert.match(r.out, /glas (hell|dunkel)/);
});

test("gate fails on a theme with surface roles but no pairs file", () => {
  const r = runGate((dir) => writeFileSync(join(dir, "fixture.css"), ".app { --surface-chrome: #ffffff; }\n"));
  assert.notEqual(r.status, 0);
  assert.match(r.out, /theme fixture: fixture\.pairs\.json fehlt/);
});

test("gate fails on a fixture theme whose materials are too faint for the text", () => {
  const r = runGate((dir) => {
    writeFileSync(join(dir, "fixture.css"), ".app { --surface-chrome: rgba(255, 255, 255, 0.1); }\n");
    const pairs = JSON.parse(readFileSync(join(dir, "glas.pairs.json"), "utf8"));
    writeFileSync(join(dir, "fixture.pairs.json"), JSON.stringify({ ...pairs, stacks: [["surface-chrome"]] }));
  });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /fixture dunkel\s*: .* \/ chrome auf Stop m(in|ax)/);
});

test("Glas overrides every surface role and material that Klassisch declares", () => {
  const styles = readFileSync(join(root, "src", "styles.css"), "utf8");
  const roles = [...styles.matchAll(/^ {2}(--(?:surface|material)-[\w-]+):/gm)].map((m) => m[1]);
  assert.ok(roles.length >= 9, `Klassisch roles found: ${roles.join(", ")}`);
  const base = glasCss.slice(0, glasCss.indexOf("@media"));
  for (const role of roles) assert.match(base, new RegExp(`^ {2}${role}:`, "m"), `${role} missing in glas.css`);
});

test("Glas leaves state colours and text and focus ring to Klassisch and keeps its backdrop static", () => {
  const plain = glasCss.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(plain, /--(state|color-text|color-focus)/);
  assert.doesNotMatch(plain, /animation|transition|@property|url\(/);
  assert.match(plain, /\.theme-backdrop\s*\{[^}]*radial-gradient/);
});

test("Glas turns materials solid under prefers-contrast: more and reduced transparency", () => {
  const solid = glasCss.slice(glasCss.indexOf("@media (prefers-contrast: more)"));
  assert.match(solid, /prefers-reduced-transparency: reduce/);
  assert.match(solid, /--material-chrome-filter: none;/);
  assert.match(solid, /--material-overlay-filter: none;/);
  assert.match(solid, /--surface-chrome: var\(--color-chrome-solid\);/);
});

test("tokens.css resolves the aliases of the same-theme values", () => {
  const css = readFileSync(join(root, "src", "design", "tokens.css"), "utf8");
  assert.match(css, /--g-sw-on: var\(--g-accent\);/);
  assert.match(css, /--g-done: var\(--g-muted\);/);
  assert.equal([...css.matchAll(/--g-spec: inset 0 1px 0 var\(--g-spec-line\);/g)].length, 2);
});
