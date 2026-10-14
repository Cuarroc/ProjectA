#!/usr/bin/env node
// AP-2b — PR flow metrics for the WIP and draft-age rules.
//
//   npm run metrics:prs                       # live: one `gh pr list --state all`
//   npm run metrics:prs -- --input prs.json   # same JSON from a file (tests)
//   npm run metrics:prs -- --json             # JSON only
//
// Reports open PRs (draft/ready), drafts older than 48 h, and the median and
// p90 of hours from opening to merge over the newest N merged PRs. PRs Mergify
// opens itself (mergify/merge-queue/*) are bot traffic, not work in progress,
// and are ignored everywhere. Exit 1 when open > --limit or a draft is stale.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { EXIT, RefusedError, UsageError, ghJson, isMain, makeRunner, runCli, withExitCodes } from "./lib/dev-tools.mjs";

const FIELDS = "number,isDraft,createdAt,mergedAt,closedAt,headRefName,state";
const HOUR_MS = 3_600_000;
export const DRAFT_MAX_HOURS = 48;
export const MERGE_TARGET_HOURS = 24;

const HELP = `pr-metrics — PR-Fluss: offene PRs, alte Drafts, Median Eröffnung→Merge
Aufruf: npm run metrics:prs -- [--limit 15] [--merged 50] [--fetch 300] [--input datei.json] [--now ISO] [--json]
  --json  nur JSON (sonst Text + JSON)
Liest nur: gh pr list --state all --json ${FIELDS}
Exit-Codes: 0 ok, 1 Regel verletzt, 2 Aufruffehler, 3 gh-/Dateifehler.
`;

const isQueuePr = (p) => String(p.headRefName).startsWith("mergify/merge-queue/");
const hours = (fromIso, toMs) => (toMs - Date.parse(fromIso)) / HOUR_MS;
const round2 = (x) => (x === null ? null : Math.round(x * 100) / 100);

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Nearest rank: the ceil(p/100 * n)-th smallest value.
export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(1, Math.ceil((p / 100) * s.length)) - 1];
}

export function computeMetrics(prs, { now, limit, mergedWindow }) {
  const nowMs = Date.parse(now);
  const own = prs.filter((p) => !isQueuePr(p));
  const open = own.filter((p) => p.state === "OPEN");
  const drafts = open.filter((p) => p.isDraft);
  const staleDrafts = drafts
    .filter((p) => hours(p.createdAt, nowMs) > DRAFT_MAX_HOURS)
    .map((p) => p.number)
    .sort((a, b) => a - b);
  const window = own
    .filter((p) => p.state === "MERGED" && Number.isFinite(hours(p.createdAt, Date.parse(p.mergedAt))))
    .sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt))
    .slice(0, mergedWindow);
  const spans = window.map((p) => hours(p.createdAt, Date.parse(p.mergedAt)));
  const medianHours = round2(median(spans));
  const violations = [];
  if (open.length > limit) violations.push("open-over-limit");
  if (staleDrafts.length) violations.push("stale-drafts");
  return {
    now,
    limit,
    open: { total: open.length, draft: drafts.length, ready: open.length - drafts.length },
    staleDrafts,
    merged: { count: spans.length, medianHours, p90Hours: round2(percentile(spans, 90)) },
    medianUnderTarget: medianHours === null ? null : medianHours < MERGE_TARGET_HOURS,
    ok: violations.length === 0,
    violations,
  };
}

export function formatText(m) {
  const stale = m.staleDrafts.length ? m.staleDrafts.map((n) => `#${n}`).join(", ") : "keine";
  const merged = m.merged.count
    ? `${m.merged.medianHours} h (p90 ${m.merged.p90Hours} h, ${m.merged.count} PRs; Ziel < ${MERGE_TARGET_HOURS} h: ${m.medianUnderTarget ? "erreicht" : "verfehlt"})`
    : "keine gemergten PRs im Fenster";
  return [
    `Offene PRs: ${m.open.total} (${m.open.draft} Draft, ${m.open.ready} bereit), Limit ${m.limit}`,
    `Drafts älter als ${DRAFT_MAX_HOURS} h: ${stale}`,
    `Median Eröffnung→Merge: ${merged}`,
    m.ok ? "Ergebnis: ok" : `Ergebnis: Regel verletzt (${m.violations.join(", ")})`,
    "",
  ].join("\n");
}

const intOption = (text, name, min) => {
  const n = Number(text);
  if (!Number.isInteger(n) || n < min) throw new UsageError(`--${name} braucht eine ganze Zahl >= ${min}: ${text}`);
  return n;
};

export const main = withExitCodes(async (argv, io, deps = {}) => {
  const { values } = parseArgs({
    args: argv,
    options: {
      limit: { type: "string", default: "15" },
      merged: { type: "string", default: "50" },
      fetch: { type: "string", default: "300" },
      input: { type: "string" },
      now: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
    strict: true,
  });
  if (values.help) {
    io.out(HELP);
    return EXIT.OK;
  }
  const limit = intOption(values.limit, "limit", 0);
  const mergedWindow = intOption(values.merged, "merged", 1);
  const fetch = intOption(values.fetch, "fetch", 1);
  const now = values.now ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(now))) throw new UsageError(`--now ist kein Zeitpunkt: ${now}`);
  let prs;
  try {
    prs = values.input
      ? JSON.parse(readFileSync(values.input, "utf8"))
      : ghJson(deps.run || makeRunner(), ["pr", "list", "--state", "all", "--limit", String(fetch), "--json", FIELDS]);
  } catch (e) {
    throw new RefusedError(e.message);
  }
  if (!Array.isArray(prs)) throw new RefusedError("Eingabe ist keine JSON-Liste von PRs");
  if (!values.input && prs.length >= fetch) io.err(`Hinweis: gh lieferte ${prs.length} PRs (--fetch ${fetch}); ältere fehlen evtl.\n`);
  const metrics = computeMetrics(prs, { now, limit, mergedWindow });
  io.out(values.json ? JSON.stringify(metrics, null, 2) + "\n" : `${formatText(metrics)}\n${JSON.stringify(metrics, null, 2)}\n`);
  return metrics.ok ? EXIT.OK : EXIT.FAIL;
});

if (isMain(import.meta.url)) runCli(main);
