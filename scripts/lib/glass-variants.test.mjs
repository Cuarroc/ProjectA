// V2-TH-VAR-1: the glass variants (src/design/variants/variants.css) are
// fenced by the contrast gate. Each case copies the gate and the stylesheets it
// reads into a temp tree, mutates variants.css (or tokens.css) and asserts on
// the gate's verdict.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function runGate(mutateVariants, mutateTokens = (css) => css) {
  const dir = mkdtempSync(join(tmpdir(), "glass-variants-"));
  try {
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, "src", "design", "variants"), { recursive: true });
    mkdirSync(join(dir, "docs", "dev-hq"), { recursive: true });
    cpSync(join(root, "scripts", "contrast-check.mjs"), join(dir, "scripts", "contrast-check.mjs"));
    cpSync(join(root, "src", "styles.css"), join(dir, "src", "styles.css"));
    writeFileSync(join(dir, "src", "design", "tokens.css"), mutateTokens(readFileSync(join(root, "src", "design", "tokens.css"), "utf8")));
    cpSync(join(root, "docs", "dev-hq", "hq.css"), join(dir, "docs", "dev-hq", "hq.css"));
    cpSync(join(root, "docs", "dev-hq", "concepts"), join(dir, "docs", "dev-hq", "concepts"), { recursive: true });
    const css = readFileSync(join(root, "src", "design", "variants", "variants.css"), "utf8");
    writeFileSync(join(dir, "src", "design", "variants", "variants.css"), mutateVariants(css));
    const r = spawnSync(process.execPath, [join(dir, "scripts", "contrast-check.mjs")], { encoding: "utf8" });
    return { status: r.status, out: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Mutate one named occurrence of `from` (`nth`, 0 = the first, i.e. the light
// block; the dark media and data-theme forms follow) or every occurrence
// (`nth: "all"`). A mutation that no longer matches fails loudly instead of
// passing as "gate still green".
const swap = (from, to, nth = 0) => (css) => {
  const at = [];
  for (let i = css.indexOf(from); i >= 0; i = css.indexOf(from, i + 1)) at.push(i);
  assert.ok(at.length > (nth === "all" ? 0 : nth), `file has occurrence ${nth} of ${from}`);
  if (nth === "all") return css.split(from).join(to);
  return css.slice(0, at[nth]) + to + css.slice(at[nth] + from.length);
};

test("gate passes on the unmodified variants", () => {
  const r = runGate((css) => css);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /variant klar hell/);
  assert.match(r.out, /variant abend dunkel/);
});

test("gate rejects a variant whose content-bg alpha is .3", () => {
  const r = runGate(swap("--g-content-bg: rgba(255, 255, 255, 0.66)", "--g-content-bg: rgba(255, 255, 255, 0.3)"));
  assert.notEqual(r.status, 0);
  assert.match(r.out, /variant klar hell/);
});

test("gate rejects a variant that sets a token outside the allowlist", () => {
  const r = runGate(swap(':root[data-glass-variant="nebel"] {', ':root[data-glass-variant="nebel"] {\n  --g-ink: #000000;'));
  assert.notEqual(r.status, 0);
  assert.match(r.out, /--g-ink is outside the allowlist/);
});

test("gate rejects a blur radius other than 32px or 20px", () => {
  const r = runGate(swap("blur(20px) saturate(170%)", "blur(24px) saturate(170%)"));
  assert.notEqual(r.status, 0);
  assert.match(r.out, /--g-content-blur.*32px|--g-content-blur.*20px/);
});

test("gate rejects a translucent reduced-transparency floor", () => {
  const r = runGate(swap("--g-content-bg: #F9FAFC", "--g-content-bg: rgba(255, 255, 255, 0.9)"));
  assert.notEqual(r.status, 0);
  assert.match(r.out, /floor/);
});

test("gate rejects a dark variant that lost its data-theme selector", () => {
  const r = runGate(swap(':root[data-theme="dark"][data-glass-variant="abend"]', ':root[data-theme="night"][data-glass-variant="abend"]'));
  assert.notEqual(r.status, 0);
  assert.match(r.out, /abend/);
});

test("gate rejects a dark klar content-bg alpha of .3 in both dark forms", () => {
  const r = runGate(swap("rgba(27, 33, 45, 0.72)", "rgba(27, 33, 45, 0.3)", "all"));
  assert.notEqual(r.status, 0);
  assert.match(r.out, /variant klar dunkel/);
});

test("gate rejects a dark value that differs between the media query and data-theme form", () => {
  // Occurrence 0 is the media form, 1 the data-theme form (light has another value).
  for (const nth of [0, 1]) {
    const r = runGate(swap("rgba(27, 33, 45, 0.72)", "rgba(27, 33, 45, 0.7)", nth));
    assert.notEqual(r.status, 0, `occurrence ${nth}`);
    assert.match(r.out, /klar dunkel unterscheidet sich zwischen Media-Query und data-theme/);
  }
});

test("gate checks the pressed filter chip against a dark accent-soft of .16", () => {
  const r = runGate((css) => css, swap("rgba(110, 155, 255, 0.12)", "rgba(110, 155, 255, 0.16)", "all"));
  assert.notEqual(r.status, 0);
  assert.match(r.out, /dunkel\s+pressed filter chip accent .*FÄLLT DURCH/);
  assert.doesNotMatch(r.out, /ausstehend/);
});
