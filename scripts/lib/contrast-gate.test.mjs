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

function runGate(mutateHq) {
  const dir = mkdtempSync(join(tmpdir(), "contrast-gate-"));
  try {
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "docs", "dev-hq"), { recursive: true });
    cpSync(join(root, "scripts", "contrast-check.mjs"), join(dir, "scripts", "contrast-check.mjs"));
    cpSync(join(root, "src", "styles.css"), join(dir, "src", "styles.css"));
    const hq = readFileSync(join(root, "docs", "dev-hq", "hq.css"), "utf8");
    writeFileSync(join(dir, "docs", "dev-hq", "hq.css"), mutateHq(hq));
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
