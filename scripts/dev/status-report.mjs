#!/usr/bin/env node
// M2 — status report: "what is done, what is running, what do I decide?" in at
// most 25 lines of German markdown. Read-only: it only lists PRs and runs
// through `gh`; it never merges, labels, comments or pushes anything.
//
//   npm run dev:status                          # to stdout
//   npm run dev:status -- --out .pa/STATUS.md   # to a file
//
// Exit code 0 = report written; 1 = gh could not be read completely (the
// report is still written and says what is missing) or the report file could
// not be written; 2 = bad arguments.
//
// Structure: collect() is the only function that touches the machine, through
// an injected `run`; classify() and formatReport() are pure. The test drives
// all of it with fake data (scripts/lib/dev-status-report.test.mjs), so it
// needs neither gh nor the network. Overview: scripts/dev/README.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_LINES = 25;
const MAX_LINE_LENGTH = 100;
// Items per section, chosen so the worst case still fits MAX_LINES:
// title + blank + 3 headings + 2 blank separators + 5 + 6 + 7 = 25.
const SECTION_LIMITS = { done: 5, running: 6, decide: 7 };

const FAILING = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]);
const FAILING_STATE = new Set(["FAILURE", "ERROR"]);
// Conclusions that prove a completed check is fine. Anything else (null,
// empty, an unknown value) is indeterminate: it counts as pending, never as
// green — an unproven state must not read as success.
const KNOWN_GOOD = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

// The only gh calls collect() may start: read-only listings with fixed
// arguments. Nothing here is built from user input.
const GH_CALLS = {
  openPrs: ["pr", "list", "--state", "open", "--limit", "100", "--json", "number,title,isDraft,headRefName,author,labels,mergeable,mergeStateStatus,statusCheckRollup"],
  mergedPrs: ["pr", "list", "--state", "merged", "--limit", "100", "--json", "number,title,mergedAt"],
  mainRuns: ["run", "list", "--branch", "main", "--limit", "10", "--json", "status,conclusion,name,headSha,createdAt,url"],
};

// "failing" beats "pending" beats "green". NEUTRAL and SKIPPED checks (for
// example the Mergify protection check) do not count against a PR.
export function checkState(rollup) {
  const checks = Array.isArray(rollup) ? rollup : [];
  if (checks.length === 0) return "none";
  let pending = false;
  for (const c of checks) {
    if (c.__typename === "StatusContext") {
      if (FAILING_STATE.has(c.state)) return "failing";
      if (c.state === "PENDING" || c.state === "EXPECTED") pending = true;
    } else if (c.status && c.status !== "COMPLETED") {
      pending = true;
    } else if (FAILING.has(c.conclusion)) {
      return "failing";
    } else if (!KNOWN_GOOD.has(c.conclusion)) {
      pending = true;
    }
  }
  return pending ? "pending" : "green";
}

// yyyy-mm-dd of `date` in `timeZone` (default: this machine's zone).
function dayKey(date, timeZone) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

const labelsOf = (p) => (p.labels || []).map((l) => l.name);
const isMergifyQueue = (p) => String(p.headRefName || "").startsWith("mergify/") || p.author?.login === "app/mergify";
const isDependabot = (p) => p.author?.login === "app/dependabot" || String(p.headRefName || "").startsWith("dependabot/");

function shorten(text, max) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (max <= 0) return "";
  return flat.length <= max ? flat : flat.slice(0, max - 1).trimEnd() + "…";
}

// Only `head` (number + title) is shortened; `reason` is why the PR is listed
// and must survive. Reasons are fixed short strings; the clamp guards a future
// longer one — a negative budget would make slice() cut from the end instead.
const item = (number, head, reason = "") => {
  const budget = Math.max(0, MAX_LINE_LENGTH - 2 - reason.length);
  return { number, text: shorten(head, budget) + reason };
};

// Splits the collected GitHub state into the three sections. Pure.
export function classify(data, { now = new Date(), timeZone } = {}) {
  const done = [];
  const running = [];
  const decide = [];

  const today = dayKey(now, timeZone);
  for (const p of data.mergedPrs || []) {
    if (p.mergedAt && dayKey(new Date(p.mergedAt), timeZone) === today) done.push(item(p.number, `#${p.number} ${p.title}`));
  }
  done.sort((a, b) => b.number - a.number);

  // A red main outranks every PR. Only a *finished* run counts: an in-flight
  // run on top of an older red one is not news, but the older red one still is.
  const finished = (data.mainRuns || [])
    .filter((r) => String(r.status).toLowerCase() === "completed")
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const latest = finished[0];
  const mainRed = Boolean(latest) && FAILING.has(String(latest.conclusion).toUpperCase());
  if (mainRed) {
    const sha = String(latest.headSha || "").slice(0, 7);
    decide.push({ number: null, text: `main ist rot (Lauf ${sha}${latest.url ? `, ${latest.url}` : ""})` });
  }

  const dependabot = [];
  const drafts = [];
  for (const p of data.openPrs || []) {
    if (isMergifyQueue(p)) continue;
    if (isDependabot(p)) {
      dependabot.push(p);
      continue;
    }
    const labels = labelsOf(p);
    const conflict = p.mergeable === "CONFLICTING" || p.mergeStateStatus === "DIRTY";
    const checks = checkState(p.statusCheckRollup);
    const head = `#${p.number} ${p.title}`;
    if (p.isDraft) {
      drafts.push(p);
      if (conflict) running.push(item(p.number, head, " (Entwurf, Konflikt mit main)"));
      continue;
    }
    if (conflict) decide.push(item(p.number, head, " — Konflikt mit main"));
    else if (labels.includes("do-not-merge")) decide.push(item(p.number, head, " — bewusst zurückgehalten (do-not-merge)"));
    else if (labels.includes("dequeued")) decide.push(item(p.number, head, " — aus der Queue geflogen"));
    else if (checks === "failing") decide.push(item(p.number, head, " — Checks rot"));
    else if (checks === "pending") running.push(item(p.number, head, " — Checks laufen"));
    else if (labels.includes("queued")) running.push(item(p.number, head, " — in der Merge-Queue"));
    else running.push(item(p.number, head, " — grün, wartet auf die Queue"));
  }
  // Drafts: one tally line, not one line each — dozens of drafts would bury the rest.
  const plainDrafts = drafts.filter((p) => !(p.mergeable === "CONFLICTING" || p.mergeStateStatus === "DIRTY"));
  if (plainDrafts.length > 0) {
    const nums = plainDrafts.map((p) => `#${p.number}`);
    const shown = nums.slice(0, 6).join(", ") + (nums.length > 6 ? ", …" : "");
    const noun = plainDrafts.length === 1 ? "Entwurf" : "Entwürfe";
    running.unshift({ number: plainDrafts[0].number, text: shorten(`${plainDrafts.length} ${noun} in Arbeit: ${shown}`, MAX_LINE_LENGTH - 2) });
  }
  if (dependabot.length > 0) {
    const nums = dependabot.map((p) => `#${p.number}`).join(", ");
    decide.push({ number: null, text: shorten(`${dependabot.length} Dependabot-PRs warten auf dich: ${nums}`, MAX_LINE_LENGTH - 2) });
  }
  for (const e of data.errors || []) decide.push({ number: null, text: shorten(`Nicht lesbar: ${e}`, MAX_LINE_LENGTH - 2) });

  return { done, running, decide, mainRed };
}

// Renders one section, cutting to `limit` lines and saying how much was cut.
function section(title, items, limit, empty) {
  const lines = [`## ${title}`];
  if (items.length === 0) {
    lines.push(`- ${empty}`);
    return lines;
  }
  if (items.length <= limit) {
    for (const i of items) lines.push(`- ${i.text}`);
    return lines;
  }
  for (const i of items.slice(0, limit - 1)) lines.push(`- ${i.text}`);
  lines.push(`- … und ${items.length - (limit - 1)} weitere`);
  return lines;
}

export function formatReport(model, { now = new Date(), timeZone } = {}) {
  const stamp = new Intl.DateTimeFormat("de-DE", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(now);
  const lines = [
    `# ProjectA Status — ${stamp}`,
    "",
    ...section("Fertig", model.done, SECTION_LIMITS.done, "Nichts fertig heute."),
    "",
    ...section("Läuft", model.running, SECTION_LIMITS.running, "Nichts läuft."),
    "",
    ...section("Du entscheidest", model.decide, SECTION_LIMITS.decide, "Nichts zu entscheiden."),
  ];
  return lines.join("\n") + "\n";
}

function defaultRun(cmd, args) {
  // gh is a real executable on every platform, so no shell is needed — and
  // without one nothing in `args` is ever interpreted.
  return spawnSync(cmd, args, { encoding: "utf8", timeout: 60000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
}

// The only place that touches the machine. A failing call does not stop the
// others: a half report with an honest error line beats no report.
export function collect({ run = defaultRun } = {}) {
  const result = { openPrs: [], mergedPrs: [], mainRuns: [], errors: [] };
  for (const [key, args] of Object.entries(GH_CALLS)) {
    const label = `gh ${args.slice(0, 2).join(" ")} (${key})`;
    const r = run("gh", args);
    if (r.error || r.status !== 0) {
      const why = r.error ? r.error.message : (String(r.stderr || "").trim().split(/\r?\n/)[0] || `exit ${r.status}`);
      result.errors.push(`${label}: ${why}`);
      continue;
    }
    try {
      const parsed = JSON.parse(r.stdout);
      if (!Array.isArray(parsed)) throw new Error("not a list");
      result[key] = parsed;
    } catch {
      result.errors.push(`${label}: Ausgabe nicht lesbar`);
    }
  }
  return result;
}

function parseArgs(argv) {
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") {
      out = argv[++i];
      if (!out || out.startsWith("--")) return { error: "--out braucht einen Dateinamen" };
    } else {
      return { error: `unbekanntes Argument: ${argv[i]}` };
    }
  }
  return { out };
}

export function main(
  argv = process.argv.slice(2),
  {
    probe = () => collect(),
    write = (s) => process.stdout.write(s),
    error = (s) => process.stderr.write(s),
    writeFile = (file, text) => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text, "utf8");
    },
    now = new Date(),
    timeZone,
  } = {},
) {
  const args = parseArgs(argv);
  if (args.error) {
    error(`status-report: ${args.error}\nusage: node scripts/dev/status-report.mjs [--out <datei>]\n`);
    return 2;
  }
  const data = probe();
  const text = formatReport(classify(data, { now, timeZone }), { now, timeZone });
  if (args.out) {
    const file = resolve(args.out);
    try {
      writeFile(file, text);
    } catch (e) {
      error(`status-report: could not write ${file}: ${e.message}\n`);
      return 1;
    }
  } else {
    write(text);
  }
  return data.errors && data.errors.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
