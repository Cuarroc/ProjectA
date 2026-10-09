#!/usr/bin/env node
// FLOW-05 — M-RP counter (docs/plan/v1.6.0/plan.md sections 6, 7b): of the
// package PRs merged in a window, how many carry a filled "### Prompt-Log"
// section, with rounds, critique findings and fix rounds ("### Nacharbeit").
// Read-only: one `gh pr list`, never writes. `--input <file>` takes {prs}
// instead, so tests need no network. bench-weekly.mjs reuses countRp/rpRows.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { EXIT, UsageError, makeRunner, ghJson, isMain, runCli, withExitCodes } from "../lib/dev-tools.mjs";

// Package branches as Mergify defines them (AGENTS.md, "Package PRs carry their report").
export const PACKAGE_BRANCH = /^(?:claude|codex|kimi|opencode|glm|cursor)\/(?:w\d+-|df\d+|ki-\d+|hq2-|dr-|z\d+-)/i;

const section = (body, name) => new RegExp(`^###\\s+${name}\\s*$([\\s\\S]*?)(?=^#{1,3}\\s|(?![\\s\\S]))`, "m").exec(body || "")?.[1] ?? null;

// null = no Prompt-Log section; filled=false = template placeholders ("0-2", "n high")
// or a numeric rounds value without numeric findings (partial evidence).
export function parsePromptLog(body) {
  const text = section(body, "Prompt-Log");
  if (text === null) return null;
  const rounds = /\*\*rounds:\*\*\s*([0-2])(?![-\d])/i.exec(text);
  if (!rounds) return { filled: false, rounds: null, high: null, other: null };
  const f = /\*\*findings:\*\*\s*(\d+)\s*high\s*\/\s*(\d+)\s*other/i.exec(text);
  if (!f) return { filled: false, rounds: null, high: null, other: null };
  return { filled: true, rounds: Number(rounds[1]), high: Number(f[1]), other: Number(f[2]) };
}
const hasRework = (body) => (section(body, "Nacharbeit") ?? "").trim() !== "";

// prs: [{headRefName, mergedAt, body}]
export function countRp(prs, { from, to }) {
  const lo = Date.parse(from);
  const hi = Date.parse(to);
  const pkg = prs.filter((p) => p.mergedAt && Date.parse(p.mergedAt) >= lo && Date.parse(p.mergedAt) < hi && PACKAGE_BRANCH.test(p.headRefName));
  const rounds = { 0: 0, 1: 0, 2: 0 };
  const findings = { high: 0, other: 0 };
  const split = { withLog: { prs: 0, withNacharbeit: 0 }, withoutLog: { prs: 0, withNacharbeit: 0 } };
  let withPromptLog = 0;
  for (const p of pkg) {
    const log = parsePromptLog(p.body);
    const g = log?.filled ? split.withLog : split.withoutLog;
    g.prs++;
    if (hasRework(p.body)) g.withNacharbeit++;
    if (!log?.filled) continue;
    withPromptLog++;
    rounds[log.rounds]++;
    findings.high += log.high;
    findings.other += log.other;
  }
  return {
    window: { from, to },
    packagePrs: pkg.length,
    withPromptLog,
    sharePct: pkg.length ? (100 * withPromptLog) / pkg.length : null,
    rounds,
    findings,
    fixRounds: { total: split.withLog.withNacharbeit + split.withoutLog.withNacharbeit, ...split },
  };
}

// The same numbers as bench-weekly rows (ratio shape: id, label, num, den, pct).
export function rpRows(m) {
  const ratio = (id, label, num, den) => ({ id, label, num, den, pct: den ? (100 * num) / den : null });
  const { withLog, withoutLog } = m.fixRounds;
  return [
    ratio("m_rp", "package PRs with Prompt-Log (M-RP)", m.withPromptLog, m.packagePrs),
    { id: "rp_rounds", label: "Prompt-Log rounds 0/1/2", num: `${m.rounds[0]}/${m.rounds[1]}/${m.rounds[2]}` },
    { id: "rp_findings", label: "critique findings high/other", num: `${m.findings.high}/${m.findings.other}` },
    ratio("rp_fixround", "package PRs with Nacharbeit (fix round)", m.fixRounds.total, m.packagePrs),
    ratio("rp_fix_with_log", "fix round, PRs with Prompt-Log", withLog.withNacharbeit, withLog.prs),
    ratio("rp_fix_without_log", "fix round, PRs without Prompt-Log", withoutLog.withNacharbeit, withoutLog.prs),
  ];
}

const HELP = `mrp-count — M-RP-Zähler (plan.md Abschnitte 6, 7b), nur lesend

Aufruf:
  npm run dev:mrp-count -- [--from <JJJJ-MM-TT>] [--to <JJJJ-MM-TT>] [--input <datei>]

  --from/--to  Fenster nach Merge-Datum (UTC, --to ausgeschlossen); Standard: die 7 Tage bis heute
  --input      JSON {prs: [{headRefName, mergedAt, body}]} statt gh (Tests)

Ausgabe: JSON. Exit-Codes: 0 gezählt, 1 gh-Fehler, 2 Aufruffehler.
`;

export const main = withExitCodes(async (argv, io, deps = {}) => {
  const { values } = parseArgs({ args: argv, options: { from: { type: "string" }, to: { type: "string" }, input: { type: "string" }, help: { type: "boolean" } } });
  if (values.help) return io.out(HELP), EXIT.OK;
  const day = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(Date.parse(s)).toISOString().startsWith(s) ? s : (() => { throw new UsageError(`Datum nicht lesbar: ${s}`); })());
  const to = day(values.to ?? new Date().toISOString().slice(0, 10));
  const from = day(values.from ?? new Date(Date.parse(to) - 7 * 86_400_000).toISOString().slice(0, 10));
  if (Date.parse(from) >= Date.parse(to)) throw new UsageError(`--from ${from} muss vor --to ${to} liegen`);
  const prs = values.input
    ? JSON.parse(readFileSync(values.input, "utf8")).prs
    : ghJson(deps.run || makeRunner({ timeoutMs: 120_000 }), ["pr", "list", "--state", "merged", "--limit", "1000", "--json", "headRefName,mergedAt,body"], { cwd: deps.cwd });
  io.out(JSON.stringify(countRp(prs, { from, to }), null, 2) + "\n");
  return EXIT.OK;
});

if (isMain(import.meta.url)) runCli(main);
