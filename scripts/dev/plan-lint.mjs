#!/usr/bin/env node
// FLOW-03 — plan-lint: read-only check of the package tables in
// docs/plan/v1.6.0/plan.md (section 3). Checks size class, tier, lane, a
// non-empty acceptance cell and that two packages of one seam never run at the
// same time: every pair must be ordered by "Hängt ab von" or by "→" in the ID
// cell ("→" means sequential). Exit 0 = clean, 1 = findings, 2 = usage.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { EXIT, UsageError, isMain, runCli, withExitCodes } from "../lib/dev-tools.mjs";

export const DEFAULT_PLAN = "docs/plan/v1.6.0/plan.md";
export const LANES = new Set(["wk", "ci", "doc", "api", "mn", "st", "pa", "pty", "fe", "hqL"]);
const NONE = /^[–—-]?$/;
const SIZE = /^(?:\d+×\s*)?[SM](?:,\s*(?:\d+×\s*)?[SM])*$/;
const TIER = /^[ABC](?:,\s*[ABC])*$/;
const ID_LIKE = /\b[A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)+\b/g;
const REQUIRED = ["ID", "Lane", "Naht", "Stufe", "Größe", "Hängt ab von", "Abnahme"];

const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

// Rows of every table whose header has all required columns.
export function parseTables(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("|")) continue;
    const head = cells(lines[i]);
    const col = Object.fromEntries(head.map((h, n) => [h.replace(/\s*\(.*\)$/, ""), n]));
    if (!REQUIRED.every((h) => h in col) || !/^\|[\s|:-]+$/.test(lines[i + 1] ?? "")) continue;
    for (i += 2; i < lines.length && lines[i].startsWith("|"); i++) {
      const c = cells(lines[i]);
      const row = { line: i + 1, width: c.length, expected: head.length };
      for (const h of REQUIRED) row[h] = c[col[h]] ?? "";
      rows.push(row);
    }
    i--;
  }
  return rows;
}

// A row such as "A → B → C" is one chain node; every part resolves to it.
export function lint(text) {
  const rows = parseTables(text);
  const findings = [];
  const bad = (r, msg) => findings.push(`Zeile ${r.line} (${r.ID || "?"}): ${msg}`);
  const node = new Map();
  rows.forEach((r, n) => {
    r.parts = r.ID.split("→").map((p) => p.trim()).filter(Boolean);
    for (const p of r.parts) {
      const prefix = r.parts[0].match(/^[A-Z0-9]+-/)?.[0] ?? "";
      for (const key of [p, prefix + p]) if (!node.has(key)) node.set(key, n);
    }
  });
  if (rows.length === 0) findings.push("keine Paket-Tabelle gefunden");
  for (const r of rows) {
    if (r.width !== r.expected) bad(r, `${r.width} Spalten statt ${r.expected}`);
    if (!r.parts.length) bad(r, "ID fehlt");
    if (!SIZE.test(r.Größe)) bad(r, `Größe „${r.Größe}“ ist nicht S oder M`);
    if (!TIER.test(r.Stufe)) bad(r, `Stufe „${r.Stufe}“ ist nicht A, B oder C`);
    if (!r.Lane || r.Lane.split(/,\s*|\s*→\s*/).some((l) => !LANES.has(l))) bad(r, `Lane „${r.Lane}“ unbekannt`);
    if (NONE.test(r.Abnahme)) bad(r, "Abnahme fehlt");
    r.deps = new Set();
    for (const d of r["Hängt ab von"].match(ID_LIKE) ?? []) {
      if (!node.has(d)) bad(r, `Abhängigkeit „${d}“ ist kein Paket dieses Plans`);
      else if (node.get(d) !== rows.indexOf(r)) r.deps.add(node.get(d));
    }
  }
  // transitive predecessors of every row; cycles end up in the finding below
  const before = rows.map(() => null);
  const preds = (n, seen = new Set()) => {
    if (before[n]) return before[n];
    const out = new Set();
    for (const d of rows[n].deps ?? []) {
      if (seen.has(d)) continue;
      out.add(d);
      for (const x of preds(d, new Set([...seen, n]))) out.add(x);
    }
    return (before[n] = out);
  };
  const bySeam = new Map();
  rows.forEach((r, n) => {
    if (!NONE.test(r.Naht)) bySeam.set(r.Naht, [...(bySeam.get(r.Naht) ?? []), n]);
  });
  for (const [seam, ns] of bySeam)
    for (const a of ns)
      for (const b of ns)
        if (a < b && !preds(a).has(b) && !preds(b).has(a))
          bad(rows[b], `Naht „${seam}“ gleichzeitig mit ${rows[a].ID} (Zeile ${rows[a].line}); eine Abhängigkeit oder „→“ fehlt`);
  return { rows: rows.length, findings };
}

const HELP = `plan-lint — prüft die Paket-Tabellen eines Plans, nur lesend

  npm run dev:plan-lint [-- <plan.md>]     Standard: ${DEFAULT_PLAN}

Prüft je Zeile: Größe S/M, Stufe A/B/C, bekannte Lane, Abnahme nicht leer; je Naht
nie zwei Pakete gleichzeitig („Hängt ab von“ oder „→“ ordnet sie).
Exit 0 sauber, 1 Befunde, 2 Aufruf falsch.
`;

export const main = withExitCodes(async (argv, io) => {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { help: { type: "boolean", short: "h" } } });
  if (values.help) return io.out(HELP), EXIT.OK;
  if (positionals.length > 1) throw new UsageError("höchstens eine Plan-Datei");
  const file = positionals[0] ?? DEFAULT_PLAN;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new UsageError(`${file} nicht lesbar: ${e.code}`);
  }
  const { rows, findings } = lint(text);
  for (const f of findings) io.out(`BEFUND ${f}\n`);
  io.out(findings.length ? `plan-lint: ${findings.length} Befund(e) in ${rows} Paketen\n` : `plan-lint: ${rows} Pakete sauber\n`);
  return findings.length ? EXIT.FAIL : EXIT.OK;
});

if (isMain(import.meta.url)) runCli(main);
