#!/usr/bin/env node
// SETUP-08a — report-commit: take a report file into `.pa/report_<id>.md` and
// commit it alone, with a `No-Test:` trailer and a Co-Authored-By line.
//
//   npm run dev:report-commit -- --id w2-07 --from <datei> --co-author "Name <mail>"
//
// Before committing, docs/dev-hq/data.{js,json} are restored to HEAD when a
// merge is the only thing that changed them (the post-merge hook regenerates
// the HQ snapshot; a report commit must not carry that). "Only a merge" means:
// the snapshot files are modified but not staged, nothing else is modified,
// and the last HEAD movement was a merge (or --merge was used right here on a
// clean tree). Anything else is refused and nothing is changed.
import { copyFileSync, existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { EXIT, UsageError, RefusedError, makeRunner, gitIn, isMain, runCli, withExitCodes } from "../lib/dev-tools.mjs";
import { pushVerified } from "./push-verified.mjs";

export const HQ_DATA = ["docs/dev-hq/data.js", "docs/dev-hq/data.json"];
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const HELP = `report-commit — Bericht nach .pa/report_<id>.md uebernehmen und allein committen

Aufruf:
  npm run dev:report-commit -- --id <id> --from <datei> --co-author "Name <mail>" [Optionen]

Optionen:
  --id <id>            Paket-/Berichtskennung, z. B. w2-07 (nur A-Z a-z 0-9 . _ -)
  --from <datei>       Quelldatei des Berichts
  --co-author <zeile>  "Name <mail>" fuer Co-Authored-By (Standard: $PA_CO_AUTHOR)
  --worktree <pfad>    Arbeitsbaum (Standard: aktuelles Verzeichnis)
  --merge <ref>        vorher \`git merge --no-edit <ref>\` (Baum muss sauber sein)
  --subject <text>     Betreffzeile (Standard: "docs(pa): <id> Bericht")
  --push               danach push-verified auf den aktuellen Branch
  --dry-run            nur anzeigen, was passieren wuerde
  --help               diese Hilfe

Exit-Codes: 0 ok, 1 Fehler (git/Push), 2 Aufruffehler, 3 abgelehnt (nichts geaendert).
Der Commit laeuft durch die normalen Hooks; --no-verify gibt es hier nicht.
`;

function porcelain(git) {
  // -z keeps paths exact; entries are "XY path".
  return git
    .ok("status", "--porcelain=v1", "-z", "--untracked-files=normal")
    .split("\0")
    .filter(Boolean)
    .filter((e, i, all) => !(i > 0 && /^R|^C/.test(all[i - 1])))
    .map((e) => ({ x: e[0], y: e[1], path: e.slice(3) }));
}

function lastHeadMoveWasMerge(git) {
  const r = git("reflog", "-1", "--format=%gs", "HEAD");
  return r.code === 0 && /^merge\b/i.test(r.stdout.trim());
}

// Returns the HQ files to restore, or throws RefusedError.
export function hqResetPlan(git, { mergedHere = false } = {}) {
  const entries = porcelain(git);
  const hq = entries.filter((e) => HQ_DATA.includes(e.path));
  if (hq.length === 0) return [];
  const others = entries.filter((e) => !HQ_DATA.includes(e.path));
  if (hq.some((e) => e.x !== " " && e.x !== "?")) {
    throw new RefusedError("docs/dev-hq/data.* ist gestaged; das entscheidet der Autor, nicht dieses Werkzeug.");
  }
  if (others.length > 0) {
    throw new RefusedError(
      "docs/dev-hq/data.* ist geaendert, aber auch andere Dateien: " +
        others.map((e) => e.path).join(", ") +
        ". Ob die HQ-Daten nur vom Merge stammen, ist so nicht belegbar.",
    );
  }
  if (!mergedHere && !lastHeadMoveWasMerge(git)) {
    throw new RefusedError("docs/dev-hq/data.* ist geaendert, die letzte HEAD-Bewegung war aber kein Merge.");
  }
  return hq.map((e) => e.path);
}

export function reportCommit({ run, cwd, id, from, coAuthor, merge, subject, dryRun = false, log = () => {} }) {
  if (!id || !ID.test(id)) throw new UsageError(`--id fehlt oder ist unzulaessig: ${id ?? ""}`);
  if (!from) throw new UsageError("--from fehlt");
  if (!coAuthor || !/^[^<>\n]+ <[^<>\s]+>$/.test(coAuthor.trim())) {
    throw new UsageError('--co-author fehlt oder hat nicht die Form "Name <mail>" (oder PA_CO_AUTHOR setzen)');
  }
  const src = resolve(from);
  if (!existsSync(src)) throw new UsageError(`Berichtsdatei fehlt: ${from}`);
  // All report paths are repo-relative, so every git call runs at the
  // toplevel — a --worktree pointing at a subdirectory must still work (N5).
  const top = gitIn(run, cwd).ok("rev-parse", "--show-toplevel").trim();
  const git = gitIn(run, top);
  const target = `.pa/report_${id}.md`;
  const actions = [];

  if (git.ok("diff", "--cached", "--name-only").trim()) {
    throw new RefusedError("Im Index liegen schon Aenderungen; der Bericht-Commit soll nur den Bericht enthalten.");
  }
  let mergedHere = false;
  if (merge) {
    // M4: refuse BEFORE anything moves when the tree is not completely clean
    // (untracked files included) — "abgelehnt = nichts geaendert" must hold.
    if (porcelain(git).length > 0) {
      throw new RefusedError("--merge braucht einen komplett sauberen Arbeitsbaum (auch keine ungetrackten Dateien).");
    }
    actions.push(`git merge --no-edit ${merge}`);
    if (!dryRun) {
      const r = git("merge", "--no-edit", merge);
      if (r.code !== 0) throw new Error(`Merge von ${merge} fehlgeschlagen:\n${r.stdout}${r.stderr}`);
      mergedHere = true;
    }
  }
  const reset = dryRun && merge ? [] : hqResetPlan(git, { mergedHere });
  for (const p of reset) actions.push(`git checkout -- ${p}`);
  actions.push(`kopieren ${src} -> ${target}`, `git add ${target}`, "git commit -F <nachricht>");
  if (dryRun) {
    for (const a of actions) log(`  ${a}\n`);
    return { dryRun: true, actions, reset, commit: null, backupDir: null };
  }
  let backupDir = null;
  if (reset.length) {
    // N1: the discarded HQ snapshot may contain a deliberate hand edit made
    // right after the merge — keep a copy and name the path, never lose it
    // silently.
    backupDir = mkdtempSync(join(tmpdir(), "report-commit-hq-backup-"));
    for (const p of reset) copyFileSync(join(top, p), join(backupDir, basename(p)));
    log(`Backup der zurueckgesetzten HQ-Daten: ${backupDir}\n`);
    git.ok("checkout", "--", ...reset);
  }
  mkdirSync(join(top, ".pa"), { recursive: true });
  copyFileSync(src, join(top, target));
  git.ok("add", "--", target);
  const staged = git.ok("diff", "--cached", "--name-only").trim();
  if (!staged) throw new RefusedError(`${target} ist unveraendert, es gibt nichts zu committen.`);
  const msg = [
    subject || `docs(pa): ${id} Bericht`,
    "",
    "No-Test: reiner Bericht unter .pa/, kein Code",
    "",
    `Co-Authored-By: ${coAuthor.trim()}`,
    "",
  ].join("\n");
  const tmp = mkdtempSync(join(tmpdir(), "report-commit-"));
  try {
    const file = join(tmp, "msg.txt");
    writeFileSync(file, msg);
    const r = git("commit", "-q", "-F", file);
    if (r.code !== 0) throw new Error(`git commit fehlgeschlagen (Exit ${r.code}):\n${r.stdout}${r.stderr}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { dryRun: false, actions, reset, commit: git.ok("rev-parse", "HEAD").trim(), backupDir };
}

export const main = withExitCodes(async (argv, io, deps) => {
  const { values } = parseArgs({
    args: argv,
    options: {
      id: { type: "string" },
      from: { type: "string" },
      "co-author": { type: "string" },
      worktree: { type: "string" },
      merge: { type: "string" },
      subject: { type: "string" },
      push: { type: "boolean" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean" },
    },
    strict: true,
  });
  if (values.help) {
    io.out(HELP);
    return EXIT.OK;
  }
  const run = deps.run || makeRunner();
  const cwd = resolve(values.worktree || process.cwd());
  const dryRun = Boolean(values["dry-run"]);
  if (dryRun) io.out("Probelauf — es wird nichts geaendert:\n");
  const res = reportCommit({
    run,
    cwd,
    id: values.id,
    from: values.from,
    coAuthor: values["co-author"] ?? process.env.PA_CO_AUTHOR,
    merge: values.merge,
    subject: values.subject,
    dryRun,
    log: io.out,
  });
  if (dryRun) return EXIT.OK;
  if (res.reset.length) io.out(`zurueckgesetzt: ${res.reset.join(", ")}\n`);
  io.out(`committet: ${res.commit}\n`);
  if (values.push) {
    const p = await pushVerified({ run, cwd, log: io.out, sleep: deps.sleep });
    return p.ok ? EXIT.OK : EXIT.FAIL;
  }
  return EXIT.OK;
});

if (isMain(import.meta.url)) runCli(main);
