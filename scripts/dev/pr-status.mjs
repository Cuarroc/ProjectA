#!/usr/bin/env node
// SETUP-08b — pr-status: compact table of the open PRs with draft, queue,
// label and required-check state. One `gh pr list` call, read-only.
//
//   npm run dev:pr-status            # Markdown-Tabelle
//   npm run dev:pr-status -- --json
//
// Queue column (AGENTS.md "Merging"): Mergify queues every non-draft PR whose
// three required checks are green, without conflict and without the
// do-not-merge label. The merge-queue PRs Mergify opens itself
// (mergify/merge-queue/*) name the PRs they are checking in their title;
// those PRs are "in Queue". Everything else is derived from the PR's own data.
import { parseArgs } from "node:util";
import { EXIT, RefusedError, makeRunner, ghJson, isMain, runCli, withExitCodes } from "../lib/dev-tools.mjs";

// Must match the checks .mergify.yml requires and the job names in
// .github/workflows/ci.yml; scripts/lib/dev-pr-status.test.mjs guards the drift.
export const REQUIRED = [
  ["linux", "gates (linux)"],
  ["windows", "gates (windows)"],
  ["redFirst", "red-first"],
];
const LIMIT = 200;
const FIELDS = "number,title,headRefName,isDraft,labels,updatedAt,mergeStateStatus,statusCheckRollup";

const HELP = `pr-status — offene PRs mit Draft-/Queue-/Label-Status und Required Checks

Aufruf:
  npm run dev:pr-status -- [--json]

Spalten: Draft, Queue (in Queue / bereit / wartet auf CI / rot / Konflikt /
gesperrt (do-not-merge) / Draft (keine CI)), Labels, gates (linux),
gates (windows), red-first (ok / rot / laeuft / uebersprungen / —).
Liest nur: gh pr list --state open --json ${FIELDS}

Exit-Codes: 0 ok, 2 Aufruffehler, 3 gh-Fehler.
`;

const time = (c) => Date.parse(c.completedAt || c.startedAt || 0) || 0;

export function checkState(rollup, name) {
  const runs = (rollup || []).filter((c) => (c.name || c.context) === name);
  if (!runs.length) return "—";
  const c = runs.sort((a, b) => time(b) - time(a))[0];
  if (c.__typename === "StatusContext" || (c.state && !c.status)) {
    return { SUCCESS: "ok", PENDING: "läuft", EXPECTED: "läuft" }[c.state] || "rot";
  }
  if (c.status !== "COMPLETED") return "läuft";
  if (c.conclusion === "SUCCESS") return "ok";
  if (c.conclusion === "SKIPPED" || c.conclusion === "NEUTRAL") return "übersprungen";
  return "rot";
}

function queuedNumbers(prs) {
  const nums = new Set();
  for (const p of prs) {
    if (!String(p.headRefName).startsWith("mergify/merge-queue/")) continue;
    for (const m of String(p.title).matchAll(/#(\d+)/g)) nums.add(Number(m[1]));
  }
  return nums;
}

export function buildRows(prs) {
  const queued = queuedNumbers(prs);
  return prs
    .filter((p) => !String(p.headRefName).startsWith("mergify/merge-queue/"))
    .map((p) => {
      const labels = (p.labels || []).map((l) => l.name);
      const checks = Object.fromEntries(REQUIRED.map(([key, name]) => [key, checkState(p.statusCheckRollup, name)]));
      const states = Object.values(checks);
      let queue;
      if (queued.has(p.number)) queue = "in Queue";
      else if (p.isDraft) queue = "Draft (keine CI)";
      else if (labels.includes("do-not-merge")) queue = "gesperrt (do-not-merge)";
      else if (labels.includes("conflict") || p.mergeStateStatus === "DIRTY") queue = "Konflikt";
      else if (states.includes("rot")) queue = "rot";
      else if (states.every((s) => s === "ok" || s === "übersprungen")) queue = "bereit";
      else queue = "wartet auf CI";
      return { number: p.number, branch: p.headRefName, title: p.title, draft: Boolean(p.isDraft), queue, labels, checks, updatedAt: p.updatedAt };
    })
    .sort((a, b) => a.number - b.number);
}

const cell = (s) => String(s).replace(/\|/g, "\\|");

export function formatTable(rows) {
  const out = [
    "| # | Branch | Draft | Queue | Labels | linux | windows | red-first | aktualisiert (UTC) |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of rows) {
    out.push(
      `| #${r.number} | ${cell(r.branch)} | ${r.draft ? "ja" : "nein"} | ${r.queue} | ${cell(r.labels.join(", ") || "—")} | ${r.checks.linux} | ${r.checks.windows} | ${r.checks.redFirst} | ${String(r.updatedAt || "").slice(0, 16).replace("T", " ")} |`,
    );
  }
  if (!rows.length) out.push("| — | keine offenen PRs | | | | | | | |");
  return out.join("\n") + "\n";
}

export const main = withExitCodes(async (argv, io, deps) => {
  const { values } = parseArgs({ args: argv, options: { json: { type: "boolean" }, help: { type: "boolean" } }, strict: true });
  if (values.help) {
    io.out(HELP);
    return EXIT.OK;
  }
  let prs;
  try {
    prs = ghJson(deps.run || makeRunner(), ["pr", "list", "--state", "open", "--limit", String(LIMIT), "--json", FIELDS]);
  } catch (e) {
    throw new RefusedError(e.message);
  }
  if (prs.length >= LIMIT) io.err(`Hinweis: gh lieferte ${prs.length} PRs (Limit ${LIMIT}); die Liste kann unvollstaendig sein.\n`);
  const rows = buildRows(prs);
  io.out(values.json ? JSON.stringify(rows, null, 2) + "\n" : formatTable(rows));
  return EXIT.OK;
});

if (isMain(import.meta.url)) runCli(main);
