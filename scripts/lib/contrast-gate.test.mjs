// scripts/lib/contrast-gate.test.mjs — the contrast gate itself must reject
// what it claims to reject. Each case copies the gate and the stylesheets it
// reads into a temp tree (the gate resolves them relative to itself), mutates
// hq.css and asserts on the gate's verdict.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function runGate(mutateHq, mutateConcepts = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "contrast-gate-"));
  try {
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, "src", "design"), { recursive: true });
    mkdirSync(join(dir, "docs", "dev-hq"), { recursive: true });
    cpSync(join(root, "scripts", "contrast-check.mjs"), join(dir, "scripts", "contrast-check.mjs"));
    cpSync(join(root, "src", "styles.css"), join(dir, "src", "styles.css"));
    cpSync(join(root, "src", "design", "tokens.css"), join(dir, "src", "design", "tokens.css"));
    const hq = readFileSync(join(root, "docs", "dev-hq", "hq.css"), "utf8");
    writeFileSync(join(dir, "docs", "dev-hq", "hq.css"), mutateHq(hq));
    cpSync(join(root, "docs", "dev-hq", "concepts"), join(dir, "docs", "dev-hq", "concepts"), { recursive: true });
    mutateConcepts(join(dir, "docs", "dev-hq", "concepts"));
    const r = spawnSync(process.execPath, [join(dir, "scripts", "contrast-check.mjs")], { encoding: "utf8" });
    return { status: r.status, out: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Insert a declaration at the top of the :root block inside the given @media.
const inMedia = (media, decl) => (css) => {
  const at = css.indexOf(media);
  assert.ok(at >= 0, `${media} block present`);
  const root = css.indexOf(":root {", at);
  assert.ok(root >= 0, `:root inside ${media}`);
  const open = css.indexOf("{", root) + 1;
  return css.slice(0, open) + `\n    ${decl}` + css.slice(open);
};

test("gate passes on the unmodified stylesheets", () => {
  const r = runGate((css) => css);
  assert.equal(r.status, 0, r.out);
});

test("gate bans #0066CC as accent in the light scheme and not only in dark", () => {
  const r = runGate(inMedia("@media (prefers-color-scheme: light)", "--steel: #0066cc;"));
  assert.match(r.out, /#0066CC — als Akzent verboten/);
  assert.notEqual(r.status, 0);
});

test("gate bans #0066CC as accent under prefers-contrast: more", () => {
  const r = runGate(inMedia("@media (prefers-contrast: more)", "--link: #0066cc;"));
  assert.match(r.out, /#0066CC — als Akzent verboten/);
  assert.notEqual(r.status, 0);
});

// HQ2-03a: the Studio concept token file is covered like hq.css.
const editConcept = (file, fn) => (dir) => writeFileSync(join(dir, file), fn(readFileSync(join(dir, file), "utf8")));

test("gate rejects a colour literal outside studio-tokens.css", () => {
  const r = runGate((css) => css, editConcept("studio-roadmap.css", (css) => css + "\n.x{color:#123456}\n"));
  assert.match(r.out, /Farbliteral #123456 in studio-roadmap\.css/);
  assert.notEqual(r.status, 0);
});

test("gate rejects a Studio token pairing below 4.5:1 in dark mode", () => {
  const r = runGate((css) => css, editConcept("studio-tokens.css", (css) => css.replace(/--muted: light-dark\(#536774, #b2c3cd\)/, "--muted: light-dark(#536774, #3a4a55)")));
  assert.match(r.out, /studio dunkel: muted \/ bg/);
  assert.notEqual(r.status, 0);
});

test("gate rejects the primary hover text pairing below 4.5:1", () => {
  const r = runGate((css) => css, editConcept("studio-tokens.css", (css) => css.replace(/--teal: light-dark\([^,]+,/, "--teal: light-dark(#999999,")));
  assert.match(r.out, /studio hell\s*: primary hover \/ bg/);
  assert.notEqual(r.status, 0);
});

test("concept theme label follows operating-system scheme changes", () => {
  const html = readFileSync(join(root, "docs", "dev-hq", "concepts", "hq2-concept.html"), "utf8");
  assert.match(html, /themeMedia\?\.addEventListener\?\.\('change',themeLabel\)/);
});

test("reduced transparency uses an opaque Studio scrim", () => {
  const dir = join(root, "docs", "dev-hq", "concepts");
  const tokens = readFileSync(join(dir, "studio-tokens.css"), "utf8");
  const premium = readFileSync(join(dir, "studio-premium.css"), "utf8");
  const scrim = tokens.match(/--scrim-solid:\s*light-dark\(#[0-9a-f]{6}([0-9a-f]{2}),\s*#[0-9a-f]{6}([0-9a-f]{2})\)/i);
  assert.ok(scrim, "solid light and dark scrim tokens exist");
  assert.ok(scrim.slice(1).every((alpha) => Number.parseInt(alpha, 16) >= 0xe6));
  assert.match(premium, /prefers-reduced-transparency:reduce[\s\S]*dialog::backdrop\s*\{\s*background:\s*var\(--scrim-solid\)/);
});
