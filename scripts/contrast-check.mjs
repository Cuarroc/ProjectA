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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "styles.css"), "utf8");

const lightStart = css.indexOf("@media (prefers-color-scheme: light)");
if (lightStart < 0) {
  console.error("Kein Hellmodus-Block gefunden — wurde er umbenannt?");
  process.exit(2);
}
const darkVarsBlock = css.slice(0, lightStart);
const lightVarsBlock = css.slice(lightStart, css.indexOf("\n}", css.indexOf(":root", lightStart)));

function parseVars(block) {
  const v = {};
  for (const m of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) v[m[1]] = m[2].trim();
  return v;
}
const dark = parseVars(darkVarsBlock);
const light = { ...dark, ...parseVars(lightVarsBlock) };

function resolve(vars, value, depth = 0) {
  if (value === undefined) return undefined;
  if (depth > 8) throw new Error("var()-Zyklus bei " + value);
  const m = value.match(/^var\(--([\w-]+)\)$/);
  return m ? resolve(vars, vars[m[1]], depth + 1) : value;
}

function color(vars, name) {
  const raw = resolve(vars, vars[name]);
  if (!raw) throw new Error("Token fehlt: --" + name);
  let m = raw.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  throw new Error(`--${name}: "${raw}" nicht lesbar`);
}

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
  // Zustands-Ring der gedrückten Such-Schalter (.terminal-search-toggle):
  // WCAG 1.4.11 verlangt 3:1 für die Zustandsanzeige — der accent-tint
  // komponiert über der Karte nur auf ~1,2:1, der Ring trägt den Zustand.
  check(mode, "accent-text / Karte (Nicht-Text, Such-Schalter)", c("color-accent-text"), surfaces.Karte, 3);
  // Der Ring liegt an der Kante des Schalters: außen grenzt die Leiste (Karte),
  // innen der über der Karte komponierte accent-tint. Beide Nachbarn gaten.
  check(
    mode,
    "accent-text / Tint auf Karte (Nicht-Text, Such-Schalter)",
    c("color-accent-text"),
    over(c("color-accent-tint"), surfaces.Karte),
    3,
  );

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

console.log(rows.join("\n"));
if (fails.length) {
  console.log(`\nNICHT BESTANDEN — ${fails.length} Paarung(en):`);
  for (const f of fails) console.log("  " + f);
  process.exit(1);
}
console.log(`\nAlle ${rows.length} Paarungen bestanden (Text >= 4,5:1, Nicht-Text >= 3:1).`);
