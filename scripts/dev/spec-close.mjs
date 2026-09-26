#!/usr/bin/env node
// SETUP-08b — spec-close: after a merge, set `.pa/task_<id>.md` to
// `Status: historisch` and remove its line under "Aktive Specs" in STAND.md
// (STAND.md rule: "beim Merge wird die Spec Status: historisch und die Zeile
// verschwindet"). Dry run by default. Afterwards `npm run hq` regenerates the
// HQ snapshot; --hq runs the generator directly.
//
//   npm run dev:spec-close -- w1-22            # zeigt die Aenderungen
//   npm run dev:spec-close -- w1-22 --apply    # schreibt sie
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { EXIT, UsageError, RefusedError, makeRunner, gitIn, isMain, runCli, withExitCodes } from "../lib/dev-tools.mjs";
import { listedInStand } from "../lib/active-specs.mjs";

const SECTION = /^#{2,4}\s*Aktive Specs\s*$/; // same rule as scripts/lib/active-specs.mjs
const HEAD_LINES = 8; // same rule as scripts/lib/active-specs.mjs

const HELP = `spec-close — Spec auf "Status: historisch" setzen und aus STAND.md "Aktive Specs" austragen

Aufruf:
  npm run dev:spec-close -- <id> [--apply] [--hq] [--root <pfad>]

  <id>  w1-22, task_w1-22.md oder .pa/task_w1-22.md

Optionen:
  --apply        wirklich schreiben (Standard: Probelauf)
  --hq           danach node scripts/dev-hq.mjs ausfuehren (= npm run hq)
  --root <pfad>  Repo-Wurzel (Standard: Wurzel des aktuellen Checkouts)
  --help         diese Hilfe

Exit-Codes: 0 ok (auch: schon historisch und nicht gelistet), 1 --hq scheiterte,
            2 Aufruffehler, 3 Spec fehlt oder Status-Zeile ungueltig.
`;

export function specName(arg) {
  const base = String(arg || "").replace(/^\.pa[\\/]/, "").replace(/^task_/, "").replace(/\.md$/, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(base)) throw new UsageError(`Spec-Kennung unzulaessig: ${arg}`);
  return `task_${base}.md`;
}

export function closeSpec(text) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const hits = lines.slice(0, HEAD_LINES).map((l, i) => [l, i]).filter(([l]) => /^Status:/.test(l));
  if (hits.length !== 1) throw new RefusedError(`genau eine Status-Zeile in den ersten ${HEAD_LINES} Zeilen erwartet, gefunden: ${hits.length}`);
  const [line, i] = hits[0];
  const value = /^Status:\s*(\S+)\s*$/.exec(line);
  if (!value) throw new RefusedError(`Status-Zeile nicht im Format "Status: <Wert>" (ein Wort, kein Zusatz): ${line.trim()}`);
  const previous = value[1];
  if (previous === "historisch") return { text, changed: false, previous };
  lines[i] = "Status: historisch";
  return { text: lines.join(eol), changed: true, previous };
}

export function removeFromStand(text, name) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => SECTION.test(l));
  if (start === -1) throw new RefusedError('STAND.md: Abschnitt "Aktive Specs" fehlt.');
  let end = start + 1;
  while (end < lines.length && !/^#{1,4}\s/.test(lines[end])) end++;
  const ref = new RegExp(`\\.pa/${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_.-])`);
  const removed = [];
  const kept = lines.filter((l, i) => {
    if (i > start && i < end && ref.test(l)) {
      removed.push(l);
      return false;
    }
    return true;
  });
  return { text: kept.join(eol), removed };
}

export const main = withExitCodes(async (argv, io, deps) => {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { apply: { type: "boolean" }, hq: { type: "boolean" }, root: { type: "string" }, help: { type: "boolean" } },
    allowPositionals: true,
    strict: true,
  });
  if (values.help) {
    io.out(HELP);
    return EXIT.OK;
  }
  if (positionals.length !== 1) throw new UsageError("genau eine Spec-Kennung erwartet");
  const name = specName(positionals[0]);
  const run = deps.run || makeRunner();
  let root = values.root;
  if (!root) {
    const top = gitIn(run, process.cwd())("rev-parse", "--show-toplevel");
    if (top.code !== 0) throw new RefusedError(`git rev-parse --show-toplevel scheiterte (${top.stderr.trim()}); --root angeben.`);
    root = top.stdout.trim();
  }
  root = resolve(root);
  const specPath = join(root, ".pa", name);
  const standPath = join(root, "STAND.md");
  if (!existsSync(specPath)) throw new RefusedError(`.pa/${name} fehlt`);
  if (!existsSync(standPath)) throw new RefusedError("STAND.md fehlt");
  const spec = closeSpec(readFileSync(specPath, "utf8"));
  const stand = removeFromStand(readFileSync(standPath, "utf8"), name);
  if (listedInStand(stand.text).names.includes(name)) {
    throw new RefusedError(`.pa/${name} steht nach dem Austragen noch unter "Aktive Specs" (unbekanntes Zeilenformat); nichts geschrieben.`);
  }
  const plan = [
    spec.changed ? `.pa/${name}: Status: ${spec.previous} -> historisch` : `.pa/${name}: schon historisch`,
    stand.removed.length ? `STAND.md: entferne ${stand.removed.length} Zeile(n):\n${stand.removed.map((l) => `    ${l}`).join("\n")}` : "STAND.md: keine Zeile unter \"Aktive Specs\"",
  ];
  if (!spec.changed && !stand.removed.length) {
    io.out(`nichts zu tun: ${plan.join("; ")}\n`);
    return EXIT.OK;
  }
  if (!values.apply) {
    io.out(`Probelauf — geschrieben wird erst mit --apply:\n  ${plan.join("\n  ")}\n`);
    return EXIT.OK;
  }
  if (spec.changed) writeFileSync(specPath, spec.text);
  if (stand.removed.length) writeFileSync(standPath, stand.text);
  io.out(`geschrieben:\n  ${plan.join("\n  ")}\n`);
  if (!values.hq) {
    io.out("Danach: npm run hq (HQ-Momentaufnahme neu erzeugen) und docs/dev-hq/data.* mitcommitten.\n");
    return EXIT.OK;
  }
  const r = run(process.execPath, ["scripts/dev-hq.mjs"], { cwd: root });
  if (r.code !== 0) {
    io.err(`npm run hq scheiterte (Exit ${r.code}):\n${r.stderr || r.stdout}\n`);
    return EXIT.FAIL;
  }
  io.out("HQ-Momentaufnahme neu erzeugt (docs/dev-hq/data.*).\n");
  return EXIT.OK;
});

if (isMain(import.meta.url)) runCli(main);
