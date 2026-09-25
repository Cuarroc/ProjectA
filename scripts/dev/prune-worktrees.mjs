#!/usr/bin/env node
// SETUP-08a — prune-worktrees: list agent worktrees that are finished, and
// remove them only on --apply.
//
// In scope: worktrees under <main checkout>/.claude/worktrees/ (Claude Code)
// and Codex worktrees (path contains /.codex/worktrees/ or branch codex/*),
// both found through `git worktree list --porcelain`. Everything else (the
// main checkout, app-worker worktrees, Copilot, ...) is never touched.
//
// Finished = the branch tip is contained in origin/main, or gh reports the
// branch's PR as MERGED or CLOSED. A finished worktree is still KEPT when it
// has uncommitted changes, commits that are on no remote branch, a lock, is
// the current directory, or was active within --min-idle (default 12h; a
// brand-new worktree is "contained in main" too).
import { resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { EXIT, makeRunner, gitIn, ghJson, isMain, runCli, withExitCodes, parseDuration } from "../lib/dev-tools.mjs";

const HELP = `prune-worktrees — fertige Agenten-Worktrees finden (Probelauf) und mit --apply entfernen

Aufruf:
  npm run dev:prune-worktrees -- [--apply] [Optionen]

Betrachtet: <Hauptcheckout>/.claude/worktrees/* und Codex-Worktrees (/.codex/worktrees/ oder Branch codex/*).
Fertig:     Branch-Spitze in origin/main enthalten, oder PR laut gh MERGED/CLOSED.
Nie entfernt: uncommittete Aenderungen, ungepushte Commits, gesperrte Worktrees,
            das aktuelle Verzeichnis, Aktivitaet juenger als --min-idle.

Optionen:
  --apply            wirklich entfernen (git worktree remove, ohne --force)
  --repo <pfad>      irgendein Checkout des Repos (Standard: aktuelles Verzeichnis)
  --base <ref>       Vergleichsbasis (Standard: origin/main)
  --min-idle <dauer> Mindestruhezeit (Standard: 12h)
  --no-gh            PR-Status nicht abfragen (nur "in main enthalten")
  --no-fetch         vorher kein git fetch
  --json             Plan als JSON
  --help             diese Hilfe

Exit-Codes: 0 ok, 1 mindestens ein Entfernen scheiterte, 2 Aufruffehler.
Branches werden nicht geloescht; die Ausgabe nennt sie.
`;

export function parseWorktreeList(text) {
  const out = [];
  for (const block of String(text).replace(/\r/g, "").split(/\n\n+/)) {
    const lines = block.split("\n").filter(Boolean);
    if (!lines.length || !lines[0].startsWith("worktree ")) continue;
    const e = { path: lines[0].slice(9), head: null, branch: null, detached: false, bare: false, locked: false, prunable: false };
    for (const l of lines.slice(1)) {
      if (l.startsWith("HEAD ")) e.head = l.slice(5);
      else if (l.startsWith("branch ")) e.branch = l.slice(7).replace(/^refs\/heads\//, "");
      else if (l === "detached") e.detached = true;
      else if (l === "bare") e.bare = true;
      else if (l === "locked" || l.startsWith("locked ")) e.locked = true;
      else if (l === "prunable" || l.startsWith("prunable ")) e.prunable = true;
    }
    out.push(e);
  }
  return out;
}

// Injectable for tests (N6): the Windows case-folding never runs in the
// Linux CI otherwise. The win32 branch folds backslashes first so the
// normalization does not depend on the host platform's resolve/sep.
export function makeNorm(platform = process.platform) {
  if (platform === "win32") {
    return (p) => resolve(p.replaceAll("\\", "/")).split(sep).join("/").toLowerCase();
  }
  return (p) => resolve(p).split(sep).join("/");
}

const norm = makeNorm();

function kindOf(entry, mainPath) {
  const p = norm(entry.path);
  if (p.startsWith(norm(mainPath) + "/.claude/worktrees/")) return "claude";
  if (p.includes("/.codex/worktrees/") || (entry.branch || "").startsWith("codex/")) return "codex";
  return null;
}

function lastActivityMs(git) {
  // Newest of: the last HEAD-reflog entry of this worktree (checkout, commit,
  // reset — its own time, not the commit's) and the HEAD commit time.
  const r = git("reflog", "-1", "--date=unix", "--format=%gd", "HEAD");
  const m = r.code === 0 ? /@\{(\d+)\}/.exec(r.stdout) : null;
  const reflog = m ? Number(m[1]) * 1000 : 0;
  const c = git("log", "-1", "--format=%ct", "HEAD");
  const commit = c.code === 0 ? Number(c.stdout.trim()) * 1000 : 0;
  return Math.max(reflog || 0, commit || 0);
}

// Ignored files that may be dropped silently with the worktree: only pure
// build artifacts are expendable; everything else (e.g. .env, local notes)
// is unsaved work and keeps the worktree alive (M2).
const IGNORE_ALLOW = new Set(["node_modules", "target", "dist"]);

function unsafeIgnoredFiles(wgit) {
  const r = wgit("status", "--porcelain", "-z", "--ignored=matching", "-uall");
  if (r.code !== 0) return [];
  return r.stdout
    .split("\0")
    .filter((e) => e.startsWith("!! "))
    .map((e) => e.slice(3))
    .filter((p) => !p.split("/").some((seg) => IGNORE_ALLOW.has(seg)));
}

export function planPrune({ run, cwd, base = "origin/main", minIdleMs = 12 * 3_600_000, useGh = true, now = Date.now() }) {
  const git = gitIn(run, cwd);
  const list = parseWorktreeList(git.ok("worktree", "list", "--porcelain"));
  const mainPath = list[0]?.path;
  const here = norm(git.ok("rev-parse", "--show-toplevel").trim());
  let prs = new Map();
  let ghError = null;
  if (useGh) {
    try {
      const all = ghJson(run, ["pr", "list", "--state", "all", "--limit", "1000", "--json", "number,headRefName,state,updatedAt"], { cwd });
      // newest PR per branch wins
      for (const pr of [...all].sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)))) prs.set(pr.headRefName, pr);
    } catch (e) {
      ghError = e.message;
    }
  }
  const entries = [];
  let ignored = 0;
  for (const wt of list.slice(1)) {
    const kind = kindOf(wt, mainPath);
    if (!kind || wt.bare) {
      ignored++;
      continue;
    }
    const e = { path: wt.path, branch: wt.branch, head: wt.head, kind, action: "keep", reason: "" };
    const inBase = wt.head ? git("merge-base", "--is-ancestor", wt.head, base).code === 0 : false;
    const pr = wt.branch ? prs.get(wt.branch) : undefined;
    if (inBase) e.finished = `in ${base} enthalten`;
    else if (pr && (pr.state === "MERGED" || pr.state === "CLOSED")) e.finished = `PR #${pr.number} ${pr.state}`;
    if (!e.finished) continue; // still in progress: not listed at all
    const wgit = gitIn(run, wt.path);
    if (wt.prunable) {
      e.reason = `${e.finished}; Verzeichnis fehlt (git worktree prune raeumt das auf)`;
    } else if (wt.locked) {
      e.reason = `${e.finished}; gesperrt (git worktree lock)`;
    } else if (norm(wt.path) === here) {
      e.reason = `${e.finished}; das ist das aktuelle Verzeichnis`;
    } else {
      const status = wgit("status", "--porcelain", "--untracked-files=normal");
      const unpushed = wgit("rev-list", "--count", "HEAD", "--not", "--remotes");
      const idle = now - lastActivityMs(wgit);
      if (status.code !== 0 || status.stdout.trim()) {
        e.reason = `${e.finished}; uncommittete Aenderungen`;
      } else if (unpushed.code !== 0 || Number(unpushed.stdout.trim()) > 0) {
        e.reason = `${e.finished}; ${unpushed.stdout.trim() || "?"} ungepushte Commits`;
      } else if (idle < minIdleMs) {
        e.reason = `${e.finished}; zuletzt aktiv vor ${Math.round(idle / 60_000)} min (< --min-idle)`;
      } else {
        const unsafe = unsafeIgnoredFiles(wgit);
        if (unsafe.length) {
          const shown = unsafe.slice(0, 5).join(", ");
          e.reason = `${e.finished}; ignorierte ungesicherte Dateien: ${shown}${unsafe.length > 5 ? `, … (${unsafe.length})` : ""}`;
        } else {
          e.action = "remove";
          e.reason = e.finished;
        }
      }
    }
    entries.push(e);
  }
  return { mainPath, base, entries, ignored, ghError };
}

export function applyPrune(plan, { run, cwd, log = () => {} }) {
  const git = gitIn(run, cwd);
  const failed = [];
  for (const e of plan.entries.filter((x) => x.action === "remove")) {
    const r = git("worktree", "remove", e.path);
    if (r.code === 0) {
      e.removed = true;
      log(`entfernt: ${e.path}\n`);
    } else {
      failed.push(e);
      log(`NICHT entfernt: ${e.path}: ${(r.stderr || r.stdout).trim()}\n`);
    }
  }
  return { failed };
}

function formatPlan(plan, apply) {
  const lines = [];
  lines.push(apply ? "Entfernen:" : "Probelauf — entfernt wird erst mit --apply:");
  const remove = plan.entries.filter((e) => e.action === "remove");
  const keep = plan.entries.filter((e) => e.action === "keep");
  for (const e of remove) lines.push(`  entfernen  ${e.path}  [${e.branch || "detached"}]  (${e.reason})`);
  if (!remove.length) lines.push("  (nichts)");
  if (keep.length) {
    lines.push("Fertig, aber behalten:");
    for (const e of keep) lines.push(`  behalten   ${e.path}  [${e.branch || "detached"}]  (${e.reason})`);
  }
  lines.push(`Nicht betrachtet (ausserhalb .claude/worktrees und Codex): ${plan.ignored}`);
  if (plan.ghError) lines.push(`Hinweis: gh nicht nutzbar, nur "in ${plan.base} enthalten" geprueft (${plan.ghError})`);
  const branches = remove.map((e) => e.branch).filter(Boolean);
  if (branches.length) lines.push(`Branches danach von Hand loeschen, falls gewuenscht: ${branches.join(" ")}`);
  return lines.join("\n") + "\n";
}

export const main = withExitCodes(async (argv, io, deps) => {
  const { values } = parseArgs({
    args: argv,
    options: {
      apply: { type: "boolean" },
      repo: { type: "string" },
      base: { type: "string" },
      "min-idle": { type: "string" },
      "no-gh": { type: "boolean" },
      "no-fetch": { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
    strict: true,
  });
  if (values.help) {
    io.out(HELP);
    return EXIT.OK;
  }
  const run = deps.run || makeRunner();
  const cwd = resolve(values.repo || process.cwd());
  if (!values["no-fetch"]) {
    const f = gitIn(run, cwd)("fetch", "-q", "origin");
    if (f.code !== 0) io.err(`Hinweis: git fetch fehlgeschlagen, vergleiche mit lokalem Stand (${f.stderr.trim()})\n`);
  }
  const plan = planPrune({
    run,
    cwd,
    base: values.base || "origin/main",
    minIdleMs: values["min-idle"] === undefined ? undefined : parseDuration(values["min-idle"]),
    useGh: !values["no-gh"],
  });
  if (values.json) io.out(JSON.stringify(plan, null, 2) + "\n");
  else io.out(formatPlan(plan, Boolean(values.apply)));
  if (!values.apply) return EXIT.OK;
  const { failed } = applyPrune(plan, { run, cwd, log: io.out });
  return failed.length ? EXIT.FAIL : EXIT.OK;
});

if (isMain(import.meta.url)) runCli(main);
