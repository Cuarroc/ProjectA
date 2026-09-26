#!/usr/bin/env node
// SETUP-08b — erledigt-row: build the docs/ERLEDIGT.md line for a merged PR
// and insert it at the top of the table (newest first). Dry run by default.
//
//   npm run dev:erledigt-row -- 106 W2-07            # zeigt die Zeile
//   npm run dev:erledigt-row -- 106 W2-07 --apply    # fuegt sie oben ein
//
// Format (docs/ERLEDIGT.md): | Datum | ID | Titel | PR | Merge-SHA | Report |
// Datum = GitHub mergedAt in UTC as "DD.MM.", Merge-SHA = 7 characters,
// Report = the .pa/report_*.md files the PR touched (or "—").
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { EXIT, UsageError, RefusedError, makeRunner, gitIn, ghJson, isMain, runCli, withExitCodes } from "../lib/dev-tools.mjs";

const REPO_URL = "https://github.com/Cuarroc/ProjectA/pull/";
const ID = /^[A-Za-z0-9][A-Za-z0-9 .,/()–-]*$/;
const GH_FILES_LIMIT = 100; // `gh pr view --json files` returns at most 100 files

const HELP = `erledigt-row — ERLEDIGT-Zeile fuer einen gemergten PR erzeugen und oben einfuegen

Aufruf:
  npm run dev:erledigt-row -- <pr-nummer> <paket-id> [Optionen]

  <paket-id>  z. B. W2-07; "-" fuer Arbeit ohne Paket (wird "—")

Optionen:
  --title <text>   Titel statt des PR-Titels (ohne "feat(x):"-Praefix)
  --report <pfad>  Report-Spalte statt der vom PR beruehrten .pa/report_*.md
  --file <pfad>    Zieldatei (Standard: docs/ERLEDIGT.md im aktuellen Checkout)
  --apply          wirklich einfuegen (Standard: Probelauf, zeigt nur die Zeile)
  --help           diese Hilfe

Exit-Codes: 0 ok (auch: Zeile schon vorhanden), 2 Aufruffehler,
            3 PR nicht gemergt, gh-Fehler oder Tabelle nicht gefunden.
Daten kommen aus: gh pr view <nr> --json number,title,state,mergedAt,mergeCommit,files
`;

const esc = (s) => String(s).replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();

// "feat(api): W2-07: Text (W2-07)" -> "Text": the ID has its own column.
export function cleanTitle(title, id = "") {
  let t = String(title || "").replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, "").trim();
  if (id && id !== "—") {
    const i = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`^${i}:\\s*`, "i"), "").replace(new RegExp(`\\s*\\(${i}\\)$`, "i"), "").trim();
  }
  return t;
}

export function makeRow({ pr, id, title, report }) {
  const d = new Date(pr.mergedAt);
  const date = `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.`;
  const reports = report ? [report] : (pr.files || []).map((f) => f.path).filter((p) => /^\.pa\/report_[^/]+\.md$/.test(p));
  const sha = String(pr.mergeCommit?.oid || "").slice(0, 7);
  return `| ${date} | ${esc(id)} | ${esc(title || cleanTitle(pr.title, id))} | [#${pr.number}](${REPO_URL}${pr.number}) | ${sha} | ${reports.length ? esc(reports.join(", ")) : "—"} |`;
}

const PR_REF = /(?:pull\/|#)(\d+)(?!\d)/; // "[#150](…/pull/150)", "#150", older link forms
const normId = (s) => (String(s).trim() === "-" ? "—" : String(s).trim().toLowerCase());

// Inserts `row` directly below the separator of the first table whose header
// starts with "| Datum | ID |". Idempotent for the same PR number + ID: the
// PR is recognised by its number in any link form, the ID cell may list
// several IDs ("W1-05, W1-06").
export function insertRow(text, row, { prNumber, id }) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const header = lines.findIndex((l) => /^\|\s*Datum\s*\|\s*ID\s*\|/.test(l));
  if (header === -1 || !/^\|[-|: ]+\|\s*$/.test(lines[header + 1] || "")) {
    throw new RefusedError("Tabelle mit Kopf \"| Datum | ID | ...\" nicht gefunden.");
  }
  let end = header + 2;
  while (end < lines.length && lines[end].startsWith("|")) end++;
  const already = lines.slice(header + 2, end).some((l) => {
    const c = l.replace(/^\|/, "").split(/(?<!\\)\|/).map((x) => x.trim());
    const ref = PR_REF.exec(c[3] || "");
    if (!ref || Number(ref[1]) !== Number(prNumber)) return false;
    return (c[1] || "").split(/\s*,\s*/).some((x) => normId(x) === normId(id));
  });
  if (already) return { text, already: true };
  lines.splice(header + 2, 0, row);
  return { text: lines.join(eol), already: false };
}

export const main = withExitCodes(async (argv, io, deps) => {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      title: { type: "string" },
      report: { type: "string" },
      file: { type: "string" },
      apply: { type: "boolean" },
      help: { type: "boolean" },
    },
    allowPositionals: true,
    strict: true,
  });
  if (values.help) {
    io.out(HELP);
    return EXIT.OK;
  }
  const [prArg, idArg] = positionals;
  if (positionals.length !== 2 || !/^\d+$/.test(prArg || "")) throw new UsageError("erwartet: <pr-nummer> <paket-id>");
  const id = idArg === "-" ? "—" : idArg;
  if (id !== "—" && !ID.test(id)) throw new UsageError(`Paket-ID unzulaessig: ${idArg}`);
  if (values.title !== undefined && !values.title.trim()) throw new UsageError("--title darf nicht leer sein (ohne --title wird der PR-Titel genommen)");
  const run = deps.run || makeRunner();
  let pr;
  try {
    pr = ghJson(run, ["pr", "view", prArg, "--json", "number,title,state,mergedAt,mergeCommit,files"]);
  } catch (e) {
    throw new RefusedError(e.message);
  }
  if (pr.state !== "MERGED" || !pr.mergedAt || !pr.mergeCommit?.oid) {
    throw new RefusedError(`PR #${prArg} ist nicht gemergt (state ${pr.state}); ERLEDIGT fuehrt nur gemergte PRs.`);
  }
  if (!values.report && (pr.files || []).length >= GH_FILES_LIMIT) {
    io.err(`Hinweis: gh liefert hoechstens ${GH_FILES_LIMIT} Dateien; die Report-Spalte kann unvollstaendig sein (${GH_FILES_LIMIT} Dateien im PR). Mit --report angeben.\n`);
  }
  const row = makeRow({ pr, id, title: values.title, report: values.report });
  if (!values.apply) {
    io.out(`Probelauf — ${values.file ? resolve(values.file) : "docs/ERLEDIGT.md"} bleibt unveraendert. Mit --apply oben eingefuegt:\n${row}\n`);
    return EXIT.OK;
  }
  let file = values.file;
  if (!file) {
    const top = gitIn(run, process.cwd())("rev-parse", "--show-toplevel");
    if (top.code !== 0) throw new RefusedError(`git rev-parse --show-toplevel scheiterte (${top.stderr.trim()}); --file angeben.`);
    file = join(top.stdout.trim(), "docs", "ERLEDIGT.md");
  }
  file = resolve(file);
  if (!existsSync(file)) throw new RefusedError(`${file} fehlt`);
  const res = insertRow(readFileSync(file, "utf8"), row, { prNumber: pr.number, id });
  if (res.already) {
    io.out(`schon vorhanden (PR #${pr.number}, ${id}); nichts geaendert.\n`);
    return EXIT.OK;
  }
  writeFileSync(file, res.text);
  io.out(`eingefuegt in ${file}:\n${row}\n`);
  return EXIT.OK;
});

if (isMain(import.meta.url)) runCli(main);
