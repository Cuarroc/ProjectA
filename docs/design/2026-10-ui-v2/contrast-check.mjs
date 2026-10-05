#!/usr/bin/env node
// WCAG 2.x contrast gate for the four UI v2 directions.
// Reads every direction-*.html next to this file, takes the colour tokens from
// <style id="tokens"> (":root" = dark, ':root[data-theme="light"]' = light,
// light inherits what it does not override) and checks each pairing listed in
// <script type="application/json" id="contrast-pairs">.
// Text pairs need 4.5:1, control boundaries and focus rings 3:1 (WCAG 1.4.11).
// Usage: node contrast-check.mjs   -> prints one line per pair, exit 1 on any fail.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(here).filter((f) => /^direction-[a-z]\.html$/.test(f)).sort();

function lum(hex) {
  const h = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

function block(css, selector) {
  const i = css.indexOf(selector + " {");
  if (i < 0) return {};
  const body = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  const out = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

let fails = 0, checks = 0;
if (files.length === 0) { console.error("no direction-*.html found"); process.exit(1); }
for (const f of files) {
  const html = fs.readFileSync(path.join(here, f), "utf8");
  const css = (html.match(/<style id="tokens">([\s\S]*?)<\/style>/) || [])[1];
  const pairsJson = (html.match(/<script type="application\/json" id="contrast-pairs">([\s\S]*?)<\/script>/) || [])[1];
  if (!css || !pairsJson) { console.log(`FAIL ${f}: token block or pair list missing`); fails++; continue; }
  const dark = block(css, ":root");
  const modes = { dark, light: { ...dark, ...block(css, ':root[data-theme="light"]') } };
  const pairs = JSON.parse(pairsJson);
  for (const [mode, list] of Object.entries(pairs)) {
    const t = modes[mode];
    for (const [fg, bg, min, what] of list) {
      checks++;
      const a = t[fg], b = t[bg];
      if (!a || !b) { console.log(`FAIL ${f} [${mode}] ${what}: unknown token ${a ? bg : fg}`); fails++; continue; }
      const r = ratio(a, b);
      const ok = r >= min;
      if (!ok) fails++;
      console.log(`${ok ? "pass" : "FAIL"} ${f} [${mode}] ${what}: --${fg} ${a} on --${bg} ${b} = ${r.toFixed(2)}:1 (min ${min})`);
    }
  }
}
console.log(`\n${checks - fails}/${checks} pairs pass across ${files.length} directions.`);
process.exit(fails ? 1 : 0);
