#!/usr/bin/env node
// SETUP-08b — hygiene: read-only check of the repo's bookkeeping, as Markdown.
//
//   1. open PRs without activity for more than 24 h
//   2. remote branches without any PR (merged ones are deletable)
//   3. specs under STAND.md "Aktive Specs" whose package already has a merged PR
//   4. MASTERPLAN rows "in Arbeit" without an open PR
//   5. untracked files in the main checkout
//
// Nothing is changed. The only write is `git fetch --prune origin`, which
// updates remote-tracking refs; --no-fetch skips it. Findings are hints for a
// human ("pruefen"), not verdicts: package IDs are matched against branch
// names and PR titles.
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { EXIT, RefusedError, makeRunner, gitIn, ghJson, isMain, runCli, withExitCodes } from "../lib/dev-tools.mjs";
import { listedInStand } from "../lib/active-specs.mjs";

const STALE_MS = 24 * 3_600_000;
const SECTION = /^#{2,4}\s*Aktive Specs\s*$/;
const MACHINE_BRANCH = /^(?:main|HEAD|origin)$|^(?:mergify|gh-readonly-queue)\//;
const OPEN_LIMIT = 200;
const ALL_LIMIT = 1000;

const HELP = `hygiene — Buchfuehrung des Repos pruefen (read-only), Ausgabe als Markdown

Aufruf:
  npm run dev:hygiene -- [--strict] [--json] [--no-fetch] [--root <pfad>]

Prueft:
  1. offene PRs aelter als 24 h ohne Aktivitaet
  2. Remote-Branches ohne PR (gemergt = loeschbar, sonst pruefen)
  3. aktive Specs (STAND.md) zu Paketen mit gemergtem PR
  4. MASTERPLAN-Pakete "in Arbeit" ohne offenen PR
  5. ungetrackte Dateien im Hauptcheckout
  + "Nicht geprueft": fehlende/unlesbare Eingaben (STAND.md, MASTERPLAN.md,
    ERLEDIGT.md) und gh-Listen am Limit; zaehlt als Befund fuer --strict

Optionen:
  --strict       Exit 1, sobald es einen Befund gibt
  --json         Befunde als JSON
  --no-fetch     vorher kein git fetch --prune origin
  --root <pfad>  Checkout, aus dem STAND.md/docs gelesen werden (Standard: aktueller)
  --help         diese Hilfe

Exit-Codes: 0 Bericht erstellt, 1 Befunde mit --strict, 2 Aufruffehler,
            3 gh/git-Fehler (auch: git fetch scheitert — dann --no-fetch).
`;

const lower = (s) => String(s).toLowerCase();
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());

// true when `id` names this PR: branch segment "<id>" or "<id>-..." after a
// slash, or the ID as a whole word in the title (W1-22 never matches W1-22b).
export function prMatchesId(pr, id) {
  const i = escRe(lower(id));
  if (new RegExp(`(^|/)${i}(-|$)`).test(lower(pr.headRefName))) return true;
  return new RegExp(`(^|[^a-z0-9-])${i}([^a-z0-9]|$)`).test(lower(pr.title));
}

// Column index of "Status" when lines[i] is the header of a MASTERPLAN status
// table (first column "ID", separator row below), else -1.
function statusColumn(lines, i) {
  if (!lines[i].startsWith("|") || !/^\|[-|: ]+\|\s*$/.test(lines[i + 1] || "")) return -1;
  const head = cells(lines[i]);
  return head[0] === "ID" ? head.indexOf("Status") : -1;
}

export function hasStatusTable(md) {
  const lines = String(md).split(/\r?\n/);
  return lines.some((_, i) => statusColumn(lines, i) !== -1);
}

export function inProgressPackages(md) {
  const lines = String(md).split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const statusIdx = statusColumn(lines, i);
    if (statusIdx === -1) continue;
    for (let j = i + 2; j < lines.length && lines[j].startsWith("|"); j++) {
      const c = cells(lines[j]);
      const status = c[statusIdx] || "";
      if (!/^in Arbeit/.test(status)) continue;
      out.push({ id: c[0], title: c[1] || "", status, prNumbers: [...status.matchAll(/PR #(\d+)/g)].map((m) => Number(m[1])) });
    }
  }
  return out;
}

export function activeSpecIds(stand) {
  const lines = String(stand).split(/\r?\n/);
  const start = lines.findIndex((l) => SECTION.test(l));
  const listed = listedInStand(stand).names;
  const byName = new Map();
  if (start !== -1) {
    for (const line of lines.slice(start + 1)) {
      if (/^#{1,4}\s/.test(line)) break;
      const m = /\.pa\/(task_[A-Za-z0-9_.-]+\.md)/.exec(line);
      if (!m || byName.has(m[1])) continue;
      let ids = [];
      if (line.startsWith("|")) {
        const pkg = /^([A-Z][A-Z0-9]*(?:-[A-Za-z0-9.]+)+)/.exec(cells(line)[1] || "");
        if (pkg) ids = [pkg[1]];
      }
      byName.set(m[1], ids);
    }
  }
  return listed.map((spec) => ({ spec, ids: byName.get(spec)?.length ? byName.get(spec) : [spec.replace(/^task_/, "").replace(/\.md$/, "")] }));
}

function erledigtRows(md) {
  return String(md)
    .split(/\r?\n/)
    .filter((l) => /^\|\s*\d\d\.\d\d\.\s*\|/.test(l))
    .map((l) => {
      const c = cells(l);
      return { ids: c[1].split(/\s*,\s*/), pr: Number((/\/pull\/(\d+)/.exec(c[3]) || [])[1]) || null };
    });
}

export function collectHygiene({ now, prsOpen, prsAll, remoteBranches, standText: standIn, masterplanText: masterplanIn, erledigtText: erledigtIn, untracked, limits = [] }) {
  const [standText, masterplanText, erledigtText] = [standIn ?? "", masterplanIn ?? "", erledigtIn ?? ""];
  const humanOpen = prsOpen.filter((p) => !MACHINE_BRANCH.test(p.headRefName));
  const stalePrs = humanOpen
    .filter((p) => now - Date.parse(p.updatedAt) > STALE_MS)
    .map((p) => ({ number: p.number, branch: p.headRefName, title: p.title, updatedAt: p.updatedAt, hours: Math.round((now - Date.parse(p.updatedAt)) / 3_600_000) }))
    .sort((a, b) => a.number - b.number);

  const heads = new Set(prsAll.map((p) => p.headRefName));
  const branchesWithoutPr = remoteBranches.filter((b) => !MACHINE_BRANCH.test(b.name) && !heads.has(b.name));

  const merged = prsAll.filter((p) => p.state === "MERGED");
  const done = erledigtRows(erledigtText);
  const specsOfMergedPrs = [];
  for (const { spec, ids } of activeSpecIds(standText)) {
    for (const id of ids) {
      const pr = merged.find((p) => prMatchesId(p, id));
      const row = done.find((r) => r.ids.some((x) => lower(x) === lower(id)));
      if (pr) specsOfMergedPrs.push({ spec, id, pr: pr.number, via: `PR #${pr.number} ${pr.headRefName}` });
      else if (row) specsOfMergedPrs.push({ spec, id, pr: row.pr, via: "docs/ERLEDIGT.md" });
    }
  }

  const openNumbers = new Set(humanOpen.map((p) => p.number));
  const inProgressWithoutPr = inProgressPackages(masterplanText).filter(
    (r) => !humanOpen.some((p) => prMatchesId(p, r.id)) && !r.prNumbers.some((n) => openNumbers.has(n)),
  );
  // A missing input or one that no longer parses makes checks 3/4 silently
  // empty; say so instead of reporting "clean" (counts as a finding for --strict).
  const notChecked = [...limits];
  if (standIn == null) notChecked.push("STAND.md fehlt — aktive Specs nicht geprüft");
  else if (!standText.split(/\r?\n/).some((l) => SECTION.test(l))) notChecked.push('STAND.md: Abschnitt "Aktive Specs" nicht gefunden — aktive Specs nicht geprüft');
  if (masterplanIn == null) notChecked.push('docs/MASTERPLAN.md fehlt — Pakete „in Arbeit“ nicht geprüft');
  else if (!hasStatusTable(masterplanText)) notChecked.push('docs/MASTERPLAN.md: keine Tabelle mit den Spalten ID und Status — Pakete „in Arbeit“ nicht geprüft');
  if (erledigtIn == null) notChecked.push("docs/ERLEDIGT.md fehlt — Specs zu erledigten Paketen nur über PRs geprüft");
  else if (!/^\|\s*Datum\s*\|\s*ID\s*\|/m.test(erledigtText)) notChecked.push('docs/ERLEDIGT.md: keine Tabelle „| Datum | ID |“ — Specs zu erledigten Paketen nur über PRs geprüft');
  return { stalePrs, branchesWithoutPr, specsOfMergedPrs, inProgressWithoutPr, untracked, notChecked };
}

export function countFindings(f) {
  return f.stalePrs.length + f.branchesWithoutPr.length + f.specsOfMergedPrs.length + f.inProgressWithoutPr.length + f.untracked.length + (f.notChecked?.length || 0);
}

export function formatHygiene(f, { now = Date.now() } = {}) {
  const out = [`# Hygiene — ${new Date(now).toISOString().slice(0, 16).replace("T", " ")} UTC`, "", `Befunde: ${countFindings(f)} (Hinweise zum Pruefen, keine Urteile)`, ""];
  const section = (title, items, render) => {
    out.push(`## ${title} (${items.length})`, "");
    if (!items.length) out.push("- keine");
    for (const x of items) out.push(`- ${render(x)}`);
    out.push("");
  };
  section("Offene PRs ohne Aktivität seit über 24 h", f.stalePrs, (p) => `#${p.number} \`${p.branch}\` — zuletzt ${p.updatedAt} (${p.hours} h): ${p.title}`);
  const mergedB = f.branchesWithoutPr.filter((b) => b.merged);
  const openB = f.branchesWithoutPr.filter((b) => !b.merged);
  section("Branches ohne PR", [...openB, ...mergedB], (b) => `\`${b.name}\` — ${b.merged ? "in main enthalten, löschbar" : "nicht in main, prüfen"}`);
  section("Aktive Specs zu gemergten PRs", f.specsOfMergedPrs, (s) => `\`.pa/${s.spec}\` (${s.id}) — ${s.via}; ggf. \`npm run dev:spec-close -- ${s.spec.replace(/^task_|\.md$/g, "")}\``);
  section("MASTERPLAN-Pakete „in Arbeit“ ohne offenen PR", f.inProgressWithoutPr, (r) => `${r.id} — ${r.status}`);
  section("Ungetrackte Dateien im Hauptcheckout", f.untracked, (p) => `\`${p}\``);
  section("Nicht geprüft", f.notChecked || [], (n) => n);
  return out.join("\n");
}

// null = file missing; collectHygiene reports it under "Nicht geprüft".
function readOrNull(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

export function gather({ run, cwd, now = Date.now() }) {
  const git = gitIn(run, cwd);
  const top = git("rev-parse", "--show-toplevel");
  if (top.code !== 0) throw new Error(`git rev-parse --show-toplevel (Exit ${top.code}): ${top.stderr.trim()} — --root prüfen`);
  const root = top.stdout.trim() || cwd;
  const wt = git.ok("worktree", "list", "--porcelain");
  const mainPath = (/^worktree (.+)$/m.exec(wt.replace(/\r/g, "")) || [])[1] || root;

  const refs = git.ok("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin");
  const remoteBranches = refs
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^origin\//, ""))
    .filter((n) => n && n !== "HEAD" && n !== "origin")
    .map((name) => ({ name, merged: git("merge-base", "--is-ancestor", `origin/${name}`, "origin/main").code === 0 }));

  const prsOpen = ghJson(run, ["pr", "list", "--state", "open", "--limit", String(OPEN_LIMIT), "--json", "number,title,headRefName,updatedAt,isDraft"], { cwd });
  const prsAll = ghJson(run, ["pr", "list", "--state", "all", "--limit", String(ALL_LIMIT), "--json", "number,title,headRefName,state"], { cwd });
  const limits = [];
  if (prsOpen.length >= OPEN_LIMIT) limits.push(`gh pr list --state open: ${prsOpen.length} Einträge (Limit ${OPEN_LIMIT}) — Liste ggf. unvollständig`);
  if (prsAll.length >= ALL_LIMIT) limits.push(`gh pr list --state all: ${prsAll.length} Einträge (Limit ${ALL_LIMIT}) — Liste ggf. unvollständig`);

  // quotePath=false: non-ASCII names stay readable instead of "d\303\244t.txt".
  const status = gitIn(run, mainPath).ok("-c", "core.quotePath=false", "status", "--porcelain", "--untracked-files=normal");
  const untracked = status
    .split(/\r?\n/)
    .filter((l) => l.startsWith("?? "))
    .map((l) => l.slice(3).replace(/^"(.*)"$/, "$1"));

  return {
    now,
    root,
    mainPath,
    prsOpen,
    prsAll,
    remoteBranches,
    untracked,
    limits,
    standText: readOrNull(join(root, "STAND.md")),
    masterplanText: readOrNull(join(root, "docs", "MASTERPLAN.md")),
    erledigtText: readOrNull(join(root, "docs", "ERLEDIGT.md")),
  };
}

export const main = withExitCodes(async (argv, io, deps) => {
  const { values } = parseArgs({
    args: argv,
    options: {
      strict: { type: "boolean" },
      json: { type: "boolean" },
      "no-fetch": { type: "boolean" },
      root: { type: "string" },
      help: { type: "boolean" },
    },
    strict: true,
  });
  if (values.help) {
    io.out(HELP);
    return EXIT.OK;
  }
  const run = deps.run || makeRunner();
  const cwd = resolve(values.root || process.cwd());
  const now = deps.now ? deps.now() : Date.now();
  if (!values["no-fetch"]) {
    const f = gitIn(run, cwd)("fetch", "-q", "--prune", "origin");
    if (f.code !== 0) {
      throw new RefusedError(`git fetch --prune origin scheiterte (${f.stderr.trim()}); ein Bericht auf veralteten Remote-Refs wäre irreführend. Mit --no-fetch nur den lokalen Stand auswerten.`);
    }
  }
  let data;
  try {
    data = gather({ run, cwd, now });
  } catch (e) {
    io.err(`Fehler beim Einsammeln: ${e.message}\n`);
    return EXIT.REFUSED;
  }
  const findings = collectHygiene(data);
  io.out(values.json ? JSON.stringify(findings, null, 2) + "\n" : formatHygiene(findings, { now }) + "\n");
  return values.strict && countFindings(findings) > 0 ? EXIT.FAIL : EXIT.OK;
});

if (isMain(import.meta.url)) runCli(main);
