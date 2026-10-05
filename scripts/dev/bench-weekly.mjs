#!/usr/bin/env node
// BENCH-01 — weekly benchmark: recomputes the metrics of
// docs/plan/v1.6.0/benchmark.md (section 6) from gh/git JSON. Read-only: it
// runs `gh pr list`, `gh run list`, `git diff --numstat` and `git log`, never
// writes a file and never commits. `--input <file>` takes {prs, runs} instead
// (same shape the live path builds), so tests need no network.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { EXIT, UsageError, makeRunner, ghJson, isMain, runCli, withExitCodes } from "../lib/dev-tools.mjs";

// All counting patterns live here (benchmark.md section 5 lost them once).
export const PATTERNS = {
  // provider/<letters+digits>-<number>...: w3-02d-x -> w3-02, ki-30-x -> ki-30, ci-03-x -> ci-03
  packageBranch: /^(?:claude|codex|kimi|opencode|glm)\/([a-z]+\d*-\d+)/i,
  fixTitle: /\b(fix|hotfix|revert|regression)\b/i,
  hotfix: /^(?:hotfix|revert)\b|^(?:[^/]+\/)?(?:hotfix|revert)[-/]/i,
  reviewFixCommit: /^(?:fix|address|apply|resolve)\b.*\b(?:review|reviewer|finding|findings|feedback)\b/i,
  round2: /\b(?:round|runde)\s*(?:2|two|zwei)\b|\b(?:2nd|second|zweite)\s+(?:round|runde)\b/i,
  tier: /\bTier\s*([ABC])\b/i,
  excluded: /^(?:mergify|dependabot)\//,
  skipLines: /(?:^|\/)(?:package-lock\.json|[^/]*\.lock)$|^docs\/dev-hq\/data\.|^src-tauri\/resources\/skills\/[^/]+\/data\//,
  docs: /\.md$|^docs\/|^\.pa\//,
};
export const REWORK_WINDOW_H = 72;
export const SIZE_LIMITS = { S: 150, M: 300 }; // above M: L
const HOUR = 3_600_000;
const DAY = 86_400_000;

export const packageId = (branch) => PATTERNS.packageBranch.exec(branch)?.[1].toLowerCase() ?? null;
const sizeClass = (n) => (n <= SIZE_LIMITS.S ? "S" : n <= SIZE_LIMITS.M ? "M" : "L");
const hoursBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / HOUR;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null;
}
function p90(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.ceil(0.9 * s.length) - 1] : null;
}
const ratio = (id, label, num, den) => ({ id, label, num, den, pct: den ? (100 * num) / den : null });
const lead = (id, label, hours) => ({ id, label, n: hours.length, median: median(hours), p90: p90(hours) });

// numstat renames: "old => new" or "dir/{old => new}/file"; the new path counts.
const newPath = (file) => file.replace(/\{([^{}]*?) => ([^{}]*)\}/, "$2").replace(/\/\//g, "/").replace(/^.* => /, "");

// Diff lines of one merge: total and code only (benchmark.md section 2).
// Binary files ("-\t-\tpath") count 0 lines.
export function countLines(numstat) {
  let lines = 0;
  let codeLines = 0;
  for (const row of numstat.split("\n")) {
    const [a, d, raw] = row.split("\t");
    const file = raw && newPath(raw);
    if (!file || PATTERNS.skipLines.test(file)) continue;
    const n = (Number(a) || 0) + (Number(d) || 0);
    lines += n;
    if (!PATTERNS.docs.test(file)) codeLines += n;
  }
  return { lines, codeLines };
}

// data: {prs: [{number,title,headRefName,state,createdAt,mergedAt,closedAt,body,lines,codeLines,commits[]}], runs: [...]}
export function measure(data, { from, to }) {
  const lo = Date.parse(from);
  const hi = Date.parse(to);
  const inWin = (t) => t && Date.parse(t) >= lo && Date.parse(t) < hi;
  const real = data.prs.filter((p) => !PATTERNS.excluded.test(p.headRefName));
  const merged = real.filter((p) => p.mergedAt && inWin(p.mergedAt));
  const closed = real.filter((p) => p.state === "CLOSED" && !p.mergedAt && inWin(p.closedAt));
  const days = new Set(merged.map((p) => p.mergedAt.slice(0, 10))).size;
  const per = (n) => (days ? n / days : null);
  const codePrs = merged.filter((p) => p.codeLines > 0);
  const known = codePrs.filter((p) => Array.isArray(p.commits)); // null = squash merge, commits unknown
  const pkgPrs = merged.filter((p) => packageId(p.headRefName));
  const isFix = (p) => {
    const id = packageId(p.headRefName);
    return PATTERNS.fixTitle.test(p.title) && real.some((q) => q !== p && q.mergedAt && packageId(q.headRefName) === id && hoursBetween(q.mergedAt, p.mergedAt) > 0 && hoursBetween(q.mergedAt, p.mergedAt) <= REWORK_WINDOW_H);
  };
  const leadH = (ps) => ps.map((p) => hoursBetween(p.createdAt, p.mergedAt));
  const ciRuns = data.runs.filter((r) => r.event === "pull_request" && inWin(r.createdAt));
  const queue = ciRuns.filter((r) => r.headBranch.startsWith("mergify/"));
  // a PR head is one commit: the latest run per headSha decides (re-runs do not count twice)
  const latest = new Map();
  for (const r of ciRuns.filter((r) => !PATTERNS.excluded.test(r.headBranch)).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) latest.set(r.headSha ?? `${r.headBranch}@${r.createdAt}`, r);
  const heads = [...latest.values()];
  const red = (rs) => rs.filter((r) => r.conclusion === "failure").length;
  const tierOf = (p) => PATTERNS.tier.exec(p.body || "")?.[1].toUpperCase() ?? "?";
  const lines = merged.reduce((s, p) => s + (p.lines || 0), 0);
  const codeSum = merged.reduce((s, p) => s + (p.codeLines || 0), 0);
  const rows = [
    { id: "thr_prs", label: "merged PRs per active day", num: merged.length, den: days, value: per(merged.length) },
    { id: "thr_lines", label: "code lines per active day", num: codeSum, den: days, value: per(codeSum) },
    { id: "thr_pkgs", label: "distinct packages per active day", num: new Set(pkgPrs.map((p) => packageId(p.headRefName))).size, den: days, value: per(new Set(pkgPrs.map((p) => packageId(p.headRefName))).size) },
    lead("lead", "PR created -> merge (h)", leadH(merged)),
    ratio("rule1", "PRs over 300 lines", merged.filter((p) => p.lines > SIZE_LIMITS.M).length, merged.length),
    ratio("review_fix", "code PRs with review-fix commit", known.filter((p) => p.commits.some((c) => PATTERNS.reviewFixCommit.test(c))).length, known.length),
    ratio("round2", "PR text names round 2", merged.filter((p) => PATTERNS.round2.test(p.body || "")).length, merged.length),
    ratio("red_heads", "red PR heads (ci, pull_request)", red(heads), heads.length),
    ratio("red_queue", "red queue runs (mergify/*)", red(queue), queue.length),
    ratio("rework_fix", `fix PRs, same package, <= ${REWORK_WINDOW_H} h`, pkgPrs.filter(isFix).length, pkgPrs.length),
    ratio("closed", "closed without merge", closed.length, closed.length + merged.length),
    { id: "hotfix", label: "hotfix/revert PRs", num: merged.filter((p) => PATTERNS.hotfix.test(p.title) || PATTERNS.hotfix.test(p.headRefName)).length },
  ];
  for (const t of [...new Set(merged.map(tierOf))].sort()) rows.push(lead(`lead.tier.${t}`, `lead time, tier ${t} (h)`, leadH(merged.filter((p) => tierOf(p) === t))));
  for (const s of ["S", "M", "L"]) {
    const ps = merged.filter((p) => sizeClass(p.lines || 0) === s);
    if (ps.length) rows.push(lead(`lead.size.${s}`, `lead time, size ${s} (h)`, leadH(ps)));
  }
  return { window: { from, to }, activeDays: days, totalLines: lines, rows };
}

const f1 = (n) => (n === null || n === undefined ? "-" : (Math.round(n * 10) / 10).toString());
export function renderMarkdown(m) {
  const cell = (r) => (r.median !== undefined ? `median ${f1(r.median)} / p90 ${f1(r.p90)} (n=${r.n})` : r.den === undefined ? String(r.num) : `${f1(r.pct ?? r.value)}${r.pct !== undefined && r.pct !== null ? " %" : ""} (${r.num}/${r.den})`);
  return [`Window ${m.window.from} .. ${m.window.to} (UTC, merge date), ${m.activeDays} active days`, "", "| ID | Metric | Value |", "|---|---|---|", ...m.rows.map((r) => `| ${r.id} | ${r.label} | ${cell(r)} |`), ""].join("\n");
}

const PR_FIELDS = "number,title,headRefName,createdAt,mergedAt,closedAt,state,body,mergeCommit";
const RUN_FIELDS = "event,headBranch,headSha,conclusion,createdAt";

// Live inputs: gh for PRs and runs (one query per day, gh caps at 1000 rows), git per merge commit.
export function collect({ from, to }, run, cwd) {
  const prs = ghJson(run, ["pr", "list", "--state", "all", "--limit", "1000", "--json", PR_FIELDS], { cwd });
  const lo = Date.parse(from);
  const hi = Date.parse(to);
  for (const p of prs) {
    const sha = p.mergeCommit?.oid;
    if (!sha || !p.mergedAt || Date.parse(p.mergedAt) < lo || Date.parse(p.mergedAt) >= hi || PATTERNS.excluded.test(p.headRefName)) continue;
    const git = (...args) => {
      const r = run("git", args, { cwd });
      if (r.code !== 0) throw new Error(`git ${args.join(" ")} (PR #${p.number}, Exit ${r.code}): ${(r.stderr || r.stdout || "").trim()}`);
      return r.stdout;
    };
    Object.assign(p, countLines(git("diff", "--numstat", `${sha}^1`, sha)));
    // squash/rebase merges have no second parent: the branch commits are unknown, not none
    const parents = git("rev-list", "--parents", "-n", "1", sha).trim().split(/\s+/).length - 1;
    p.commits = parents > 1 ? git("log", "--no-merges", "--format=%s", `${sha}^1..${sha}^2`).split("\n").filter(Boolean) : null;
  }
  const runs = [];
  for (let t = lo; t < hi; t += DAY) {
    const day = new Date(t).toISOString().slice(0, 10);
    runs.push(...ghJson(run, ["run", "list", "-w", "ci", "--limit", "1000", "--created", day, "--json", RUN_FIELDS], { cwd }));
  }
  return { prs, runs };
}

const HELP = `bench-weekly — wöchentliche Messung (benchmark.md Abschnitt 6), nur lesend

Aufruf:
  npm run dev:bench-weekly -- [--from <JJJJ-MM-TT>] [--to <JJJJ-MM-TT>] [--input <datei>] [--json]

  --from/--to  Fenster nach Merge-Datum (UTC, --to ausgeschlossen); Standard: die 7 Tage bis heute
  --input      JSON {prs, runs} statt gh/git (Tests, Nachrechnen offline)
  --json       maschinenlesbar statt Markdown-Tabelle

Exit-Codes: 0 gemessen, 1 gh/git-Fehler, 2 Aufruffehler.
`;

export const main = withExitCodes(async (argv, io, deps = {}) => {
  const { values } = parseArgs({ args: argv, options: { from: { type: "string" }, to: { type: "string" }, input: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean" } } });
  if (values.help) return io.out(HELP), EXIT.OK;
  const day = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(Date.parse(s)).toISOString().startsWith(s) ? s : (() => { throw new UsageError(`Datum nicht lesbar: ${s}`); })());
  const to = day(values.to ?? new Date().toISOString().slice(0, 10));
  const from = day(values.from ?? new Date(Date.parse(to) - 7 * DAY).toISOString().slice(0, 10));
  if (Date.parse(from) >= Date.parse(to)) throw new UsageError(`--from ${from} muss vor --to ${to} liegen`);
  const data = values.input ? JSON.parse(readFileSync(values.input, "utf8")) : collect({ from, to }, deps.run || makeRunner({ timeoutMs: 120_000 }), deps.cwd);
  const m = measure(data, { from, to });
  io.out(values.json ? JSON.stringify(m, null, 2) + "\n" : renderMarkdown(m));
  return EXIT.OK;
});

if (isMain(import.meta.url)) runCli(main);
