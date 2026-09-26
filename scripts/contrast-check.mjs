// Prüft die Farbpaarungen aus src/styles.css gegen WCAG 2.1 AA.
//
// Warum es das gibt: Die Oberfläche hat zwei Modi, und ein Token, das im
// Dunkeln gut aussieht, kann im Hellen durchfallen — genau das ist der Grund,
// warum die Farben überhaupt in eine Tokenschicht gezogen wurden. Der Lauf
// bricht ab, sobald eine Textpaarung unter 4,5:1 fällt.
//
//   node scripts/contrast-check.mjs
//
// Alpha-Werte werden zuerst gegen ihre tatsächliche Grundfläche komponiert;
// Zustands-Tints liegen auf Inhalt beziehungsweise auf der erhobenen Fläche.
//
// W1-10: the same gate now covers docs/dev-hq/hq.css (the Dev HQ stylesheet).
// HQ colors live in :root tokens and are derived almost entirely through
// color-mix(), so the evaluator below understands `transparent` and
// `color-mix(in srgb, …)` in addition to hex/rgb. HQ is checked in up to four
// modes: dark (default), light (prefers-color-scheme: light) and each of them
// with prefers-contrast: more overrides applied.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "src", "styles.css"), "utf8");
const hqCss = readFileSync(join(here, "..", "docs", "dev-hq", "hq.css"), "utf8");

const lightStart = css.indexOf("@media (prefers-color-scheme: light)");
if (lightStart < 0) {
  console.error("Kein Hellmodus-Block gefunden — wurde er umbenannt?");
  process.exit(2);
}
const darkVarsBlock = css.slice(0, lightStart);
const lightVarsBlock = css.slice(lightStart, css.indexOf("\n}", css.indexOf(":root", lightStart)));

function parseVars(block) {
  const v = {};
  // Strip comments first: prose like "--bright: text role" inside a comment
  // would otherwise parse as a token and swallow the real declaration.
  const clean = block.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) v[m[1]] = m[2].trim();
  return v;
}

// resolve() substitutes every var(--x) inside a value, recursively, so the
// result is a plain CSS color expression (hex, rgb(), transparent or
// color-mix()). A missing token or a var() cycle is a hard error.
function resolve(vars, value, depth = 0) {
  if (value === undefined) throw new Error("Token fehlt");
  if (depth > 10) throw new Error("var()-Zyklus bei " + value);
  const m = value.match(/var\(--([\w-]+)\)/);
  if (!m) return value.trim();
  const inner = resolve(vars, vars[m[1]], depth + 1);
  return resolve(vars, value.replace(m[0], inner), depth + 1);
}

// split "a, b" at the top level, ignoring commas inside parentheses
function splitTopLevel(input) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts.map((p) => p.trim());
}

function parseColorLiteral(raw) {
  if (raw === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  let m = raw.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = raw.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: ((n >> 8) & 15) * 17, g: ((n >> 4) & 15) * 17, b: (n & 15) * 17, a: 1 };
  }
  m = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  return undefined;
}

// CSS color-mix(in srgb, A [p%], B [p%]): channels are mixed premultiplied in
// gamma-encoded srgb space; if the percentages sum to less than 100 the result
// alpha is scaled down accordingly.
function mix2(a, wa, b, wb) {
  if (wa === undefined && wb === undefined) [wa, wb] = [50, 50];
  else if (wa === undefined) wa = 100 - wb;
  else if (wb === undefined) wb = 100 - wa;
  const sum = wa + wb;
  if (sum <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const alphaMul = Math.min(sum / 100, 1);
  const w1 = wa / sum;
  const w2 = wb / sum;
  const alpha = (a.a * w1 + b.a * w2) * alphaMul;
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const chan = (x, y) => ((a.a * w1 * x + b.a * w2 * y) * alphaMul) / alpha;
  return { r: chan(a.r, b.r), g: chan(a.g, b.g), b: chan(a.b, b.b), a: alpha };
}

function colorValue(vars, raw, depth = 0) {
  if (depth > 10) throw new Error("color-mix zu tief verschachtelt: " + raw);
  const lit = parseColorLiteral(raw);
  if (lit) return lit;
  const m = raw.match(/^color-mix\(\s*in srgb\s*,\s*(.*)\)$/s);
  if (!m) throw new Error(`"${raw}" nicht lesbar`);
  const parts = splitTopLevel(m[1]);
  if (parts.length !== 2) throw new Error(`color-mix braucht 2 Farben: "${raw}"`);
  const parsed = parts.map((p) => {
    const pm = p.match(/^(.*?)\s+([\d.]+)%$/s);
    return pm
      ? { c: colorValue(vars, pm[1].trim(), depth + 1), w: +pm[2] }
      : { c: colorValue(vars, p, depth + 1), w: undefined };
  });
  return mix2(parsed[0].c, parsed[0].w, parsed[1].c, parsed[1].w);
}

// color(vars, name) resolves the token --name to an rgba tuple; colorExpr(vars,
// cssText) does the same for an arbitrary expression used in the pairing lists.
function color(vars, name) {
  try {
    return colorValue(vars, resolve(vars, vars[name]));
  } catch (err) {
    throw new Error(`--${name}: ${err.message}`);
  }
}
const colorExpr = (vars, expr) => colorValue(vars, resolve(vars, expr));

const over = (fg, bg) => ({
  r: fg.a * fg.r + (1 - fg.a) * bg.r,
  g: fg.a * fg.g + (1 - fg.a) * bg.g,
  b: fg.a * fg.b + (1 - fg.a) * bg.b,
  a: 1,
});
const lum = ({ r, g, b }) => {
  const c = (v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const fails = [];
const rows = [];
function check(mode, label, fg, bg, min = 4.5) {
  const r = ratio(fg.a < 1 ? over(fg, bg) : fg, bg);
  const ok = r >= min;
  if (!ok) fails.push(`${mode}: ${label} = ${r.toFixed(2)}:1 (< ${min})`);
  rows.push(`${mode}  ${label.padEnd(44)} ${r.toFixed(2).padStart(6)}:1  ${ok ? "ok" : "FÄLLT DURCH"}`);
}

// ---------------------------------------------------------------------------
// App stylesheet (src/styles.css)
// ---------------------------------------------------------------------------

const dark = parseVars(darkVarsBlock);
const light = { ...dark, ...parseVars(lightVarsBlock) };

for (const [mode, vars] of [["hell  ", light], ["dunkel", dark]]) {
  const c = (n) => color(vars, n);
  const surfaces = {
    Fenster: c("color-window"),
    Inhalt: c("color-content"),
    Karte: c("color-elevated"),
    Chrome: c("color-chrome-solid"),
  };

  for (const role of ["primary", "secondary", "tertiary"])
    for (const [sn, s] of Object.entries(surfaces)) check(mode, `Text ${role} / ${sn}`, c(`color-text-${role}`), s);

  for (const step of ["accent", "accent-hover", "accent-pressed"])
    check(mode, `on-accent / ${step}`, c("color-on-accent"), c(`color-${step}`));
  check(mode, "accent-text / Inhalt", c("color-accent-text"), surfaces.Inhalt);
  // Die eigenen Chat-Zeilen (.convo-msg-user .convo-msg-body): die Textfarbe
  // erbt `--fg` von body (= text-primary), die Fläche ist der accent-tint —
  // komponiert über Inhalt wie die Zustands-Tints unten.
  check(
    mode,
    "text-primary / accent-tint auf Inhalt",
    c("color-text-primary"),
    over(c("color-accent-tint"), surfaces.Inhalt),
  );
  check(mode, "focus-ring / Fenster (Nicht-Text)", c("color-focus-ring"), surfaces.Fenster, 3);

  for (const st of ["working", "needs", "review", "merge", "done", "paused", "danger"]) {
    const fg = c(`state-${st}-fg`);
    const bg = c(`state-${st}-bg`);
    check(mode, `${st} / Inhalt`, fg, surfaces.Inhalt);
    check(mode, `${st} / Karte`, fg, surfaces.Karte);
    check(mode, `${st} / Tint auf Inhalt`, fg, over(bg, surfaces.Inhalt));
    check(mode, `${st} / Tint auf Karte`, fg, over(bg, surfaces.Karte));
  }

  for (const role of ["keyword", "string", "type", "func"])
    check(mode, `code-${role} / Inhalt`, c(`code-${role}`), surfaces.Inhalt);
}

// ---------------------------------------------------------------------------
// Dev HQ stylesheet (docs/dev-hq/hq.css)
// ---------------------------------------------------------------------------

// Extract the span of an @media block (from its index to the matching closing
// brace) so top-level tokens and media overrides can be parsed separately.
function mediaSpan(src, at) {
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return [at, i + 1];
  }
  throw new Error("@media-Block nicht geschlossen ab Index " + at);
}

function rootVarsIn(src) {
  const v = {};
  for (const m of src.matchAll(/:root\s*\{([^}]*)\}/g)) Object.assign(v, parseVars(m[1]));
  return v;
}

const hqLightAt = hqCss.indexOf("@media (prefers-color-scheme: light)");
const hqContrastAt = hqCss.indexOf("@media (prefers-contrast: more)");
let hqTopLevel = hqCss;
let hqLightVars = null;
let hqContrastVars = null;
for (const [at, set] of [
  [hqLightAt, (s) => (hqLightVars = rootVarsIn(s))],
  [hqContrastAt, (s) => (hqContrastVars = rootVarsIn(s))],
]) {
  if (at < 0) continue;
  const [from, to] = mediaSpan(hqCss, at);
  set(hqCss.slice(from, to));
  hqTopLevel = hqTopLevel.replace(hqCss.slice(from, to), "");
}
const hqDarkVars = rootVarsIn(hqTopLevel);

// Pairings cover how hq.css uses the tokens: body/heading/muted text on
// --ground, ink on the --paper well, accents in their text roles, solid and
// tinted chips/badges, status colors and SVG labels. Text needs 4.5:1, the
// focus outline, strong hairlines and chart fills 3:1 (non-text).
const hqPairings = [
  ["hq body text / Grund", "var(--fog)", "var(--ground)"],
  ["hq headings / Grund", "var(--bright)", "var(--ground)"],
  ["hq ink-2 (muted) / Grund", "var(--ink-2)", "var(--ground)"],
  ["hq ink-3 (faint) / Grund", "var(--ink-3)", "var(--ground)"],
  ["hq links / Grund", "var(--link)", "var(--ground)"],
  ["hq ochre-Text / Grund", "var(--ochre-text)", "var(--ground)"],
  ["hq ember-Text / Grund", "var(--ember-text)", "var(--ground)"],
  ["hq forest-Text / Grund", "var(--forest-text)", "var(--ground)"],
  ["hq well text / Papier", "var(--ink)", "var(--paper)"],
  ["hq well secondary 70% / Papier", "color-mix(in srgb, var(--ink) 70%, var(--paper))", "var(--paper)"],
  ["hq well label 70% ink+ochre / Papier", "color-mix(in srgb, var(--ink) 70%, var(--ochre))", "var(--paper)"],
  ["hq grip label 62% ink+ochre / Papier", "color-mix(in srgb, var(--ink) 62%, var(--ochre))", "var(--paper)"],
  ["hq signal act / Papier", "var(--ember-deep)", "var(--paper)"],
  ["hq signal act strong / Papier", "color-mix(in srgb, var(--ember-deep) 80%, var(--ink))", "var(--paper)"],
  ["hq signal watch / Papier", "color-mix(in srgb, var(--ochre) 80%, var(--ink))", "var(--paper)"],
  ["hq signal note 70% / Papier", "color-mix(in srgb, var(--ink) 70%, transparent)", "var(--paper)"],
  ["hq signal index 62% / Papier", "color-mix(in srgb, var(--ink) 62%, transparent)", "var(--paper)"],
  ["hq chip text / steel", "var(--chip-ink)", "var(--steel)"],
  ["hq chip text / ember-deep", "var(--chip-ink)", "var(--ember-deep)"],
  ["hq chip text / ochre-deep", "var(--chip-ink)", "var(--ochre-deep)"],
  ["hq chip text / forest", "var(--chip-ink)", "var(--forest)"],
  ["hq badge text / base tint", "var(--bright)", "color-mix(in srgb, var(--fog) 25%, var(--ground))"],
  ["hq badge text / new tint", "var(--bright)", "color-mix(in srgb, var(--fog) 30%, var(--ground))"],
  ["hq badge text / stale tint", "var(--bright)", "color-mix(in srgb, var(--ochre) 70%, var(--ground))"],
  ["hq badge done text / Grund", "color-mix(in srgb, var(--forest-text) 70%, var(--fog))", "var(--ground)"],
  ["hq status ok / Grund", "var(--ok-text)", "var(--ground)"],
  ["hq status error / Grund", "var(--err-text)", "var(--ground)"],
  ["hq status pending / Grund", "var(--ochre-text)", "var(--ground)"],
  ["hq svg label / dag", "var(--fog)", "color-mix(in srgb, var(--ground) 90%, var(--steel))"],
  ["hq focus outline / Grund (Nicht-Text)", "var(--bright)", "var(--ground)", 3],
  ["hq hairline strong / Grund (Nicht-Text)", "var(--hair-strong)", "var(--ground)", 3],
  ["hq chart fill / track (Nicht-Text)", "var(--link)", "color-mix(in srgb, var(--fog) 12%, var(--ground))", 3],
];

// Rule-bound pairings read the colour straight out of the rule that paints it
// (last matching rule wins), so the gate cannot drift from a stylesheet that
// swaps a token for a literal. `bg` may be translucent; it is composed over
// --ground, the page surface every HQ rule sits on.
const hqPlain = hqCss.replace(/\/\*[\s\S]*?\*\//g, "");
function hqRuleValue(selector, prop, fallback) {
  let found;
  for (const m of hqPlain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(",").some((sel) => sel.trim() === selector)) continue;
    const d = m[2].match(new RegExp(String.raw`(?:^|;|\s)${prop}\s*:\s*([^;]+)`));
    if (d) found = d[1].trim().replace(/\s*!important$/, "");
  }
  if (found === undefined && fallback !== undefined) return fallback;
  if (found === undefined) throw new Error(`hq.css: keine Regel "${selector}" mit ${prop}`);
  return found;
}
const borderColor = (value) => value.replace(/^\S+\s+\S+\s+/, "");
const hqRuleBound = [
  // The 10px note on the summary tiles sits on the steel-tinted tile.
  ["hq summary note / Kachel", () => hqRuleValue(".summary-item small", "color"), () => hqRuleValue(".summary-item", "background")],
  // Progress bars: the fills are the only carrier of the bucket.
  ...["FACT", "CLAIM", "locked"].map((k) => [
    `hq stat-bar ${k} / Spur (Nicht-Text)`,
    () => hqRuleValue(`.stat-bar-fill.${k}`, "background"),
    () => hqRuleValue(".stat-bar-track", "background"),
    3,
  ]),
  ["hq team-form field border / Grund (Nicht-Text)", () => borderColor(hqRuleValue(".team-form input", "border")), () => "var(--ground)", 3],
  // Focus ring on the paper surfaces: --bright equals --paper in dark mode, so
  // without its own rule the generic ring (--bright) is measured here.
  ...[".grip :focus-visible", ".desk-section.paper :focus-visible"].map((sel) => [
    `hq focus ring ${sel} / Papier (Nicht-Text)`,
    () => hqRuleValue(sel, "outline-color", "var(--bright)"),
    () => "var(--paper)",
    3,
  ]),
  // SVG lane: real label pairs (label on the lane, node label on its fill).
  ["hq lane-label / Lane", () => hqRuleValue(".lane-label", "fill"), () => hqRuleValue("#lane", "background")],
  ["hq lane-node-label / serial-Knoten", () => hqRuleValue(".lane-node-label", "fill"), () => hqRuleValue(".lane-node.serial rect", "fill")],
  ["hq lane-node-label / parallel-Knoten", () => hqRuleValue(".lane-node-label", "fill"), () => hqRuleValue(".lane-node.parallel rect", "fill")],
];

// A translucent text container blends every text colour toward the page and
// no pairing above sees it (the stale lesson card hit 3,8:1 this way). Fills
// and strokes on SVG shapes are not text; everything else must stay opaque.
for (const m of hqPlain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const o = m[2].match(/(?:^|;|\s)opacity\s*:\s*([\d.]+)/);
  if (!o || +o[1] <= 0 || +o[1] >= 1) continue;
  const sel = m[1].trim().replace(/\s+/g, " ");
  if (/(^|\s)(rect|circle|path|line)$|\.dag-edge/.test(sel)) continue;
  fails.push(`hq: opacity ${o[1]} auf "${sel}" mischt den Text zur Seite hin — Kontrast unmessbar`);
}

const hqModes = [["hq dunkel", hqDarkVars]];
if (hqLightVars) {
  const hqLight = { ...hqDarkVars, ...hqLightVars };
  hqModes.push(["hq hell ", hqLight]);
  if (hqContrastVars) {
    hqModes.push(["hq hell+", { ...hqLight, ...hqContrastVars }]);
  }
} else {
  fails.push("hq: kein @media (prefers-color-scheme: light)-Block gefunden");
}
if (hqContrastVars) {
  hqModes.push(["hq dunkel+", { ...hqDarkVars, ...hqContrastVars }]);
} else {
  fails.push("hq: kein @media (prefers-contrast: more)-Block gefunden");
}

// The HQ accent is the desaturated steel blue; the generic #0066CC is
// explicitly banned as an accent (W1-10). Checked per mode: a light or
// prefers-contrast block can redefine the accent tokens on its own.
const bannedAccent = "#0066cc";
const hexByte = (v) => Math.round(v).toString(16).padStart(2, "0");
for (const [mode, vars] of hqModes) {
  for (const token of ["steel", "link"]) {
    const c = color(vars, token);
    if (`#${hexByte(c.r)}${hexByte(c.g)}${hexByte(c.b)}` === bannedAccent) {
      fails.push(`${mode.trim()}: --${token} ist #0066CC — als Akzent verboten (W1-10)`);
    }
  }
}

for (const [mode, vars] of hqModes) {
  for (const [label, fgExpr, bgExpr, min] of hqPairings) {
    check(mode, label, colorExpr(vars, fgExpr), colorExpr(vars, bgExpr), min);
  }
  const ground = colorExpr(vars, "var(--ground)");
  for (const [label, fg, bg, min] of hqRuleBound) {
    const bgc = colorExpr(vars, bg());
    check(mode, label, colorExpr(vars, fg()), bgc.a < 1 ? over(bgc, ground) : bgc, min);
  }
}

console.log(rows.join("\n"));
if (fails.length) {
  console.log(`\nNICHT BESTANDEN — ${fails.length} Paarung(en):`);
  for (const f of fails) console.log("  " + f);
  process.exit(1);
}
console.log(`\nAlle ${rows.length} Paarungen bestanden (Text >= 4,5:1, Nicht-Text >= 3:1).`);
