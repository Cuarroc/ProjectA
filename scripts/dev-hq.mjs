#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { listedInStand, readSpecStatuses, reconcile } from "./lib/active-specs.mjs";
import { parseNextGrip, parseSpecTable, buildNext, parseFindings, buildPackages, parseMilestones, applySpecStartable } from "./lib/hq-parse.mjs";
import { lessonBadges, lessonStats, readLessonsFile } from "./lib/hq-lessons.mjs";

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const root = arg("--root", process.cwd());
const out = arg("--out", join(root, "docs", "dev-hq"));
const standPath = join(root, "STAND.md");

if (!existsSync(standPath)) {
  console.error("STAND.md missing — refusing to write HQ data.");
  process.exit(1);
}
const standText = readFileSync(standPath, "utf8");
const listed = listedInStand(standText);
if (listed.error) {
  console.error(listed.error);
  process.exit(1);
}

const specDir = join(root, ".pa");
const files = existsSync(specDir)
  ? readdirSync(specDir)
      .filter((n) => /^task_.*\.md$/.test(n))
      .sort()
      .map((name) => ({ name, head: readFileSync(join(specDir, name), "utf8") }))
  : [];
const { status, errors } = readSpecStatuses(files);
if (errors.length) console.error(errors.join("\n"));
const rec = reconcile(status, listed.names);
const specs = applySpecStartable(parseSpecTable(standText, rec.executable));
const nextGrip = parseNextGrip(standText);
const reportFiles = existsSync(specDir)
  ? readdirSync(specDir)
      .filter((n) => /^report_f0.*\.md$/i.test(n))
      .sort()
      .map((n) => ({ path: `.pa/${n}`, text: readFileSync(join(specDir, n), "utf8") }))
  : [];
const reportF0 = reportFiles.map((f) => f.text).join("\n");
const warnings = [...rec.warnings];
const packages = buildPackages(standText, specs); // only gates buildNext; not part of the snapshot
const planPath = join(root, "docs", "PLAN.md");
const milestones = existsSync(planPath) ? parseMilestones(readFileSync(planPath, "utf8")) : [];
if (!milestones.length) warnings.push("docs/PLAN.md: no milestone tables (### M<n> — …) found");
const findings = parseFindings(standText, { reportF0, reportFiles, warnings });
const lessons = readLessonsFile(join(out, "lessons.json"));
const citedReports = [...new Set(findings.map((f) => f.source).filter((s) => s.startsWith(".pa/")))];
const data = {
  generatedAt: new Date().toISOString(),
  commit: git(root, ["rev-parse", "--short", "HEAD"]),
  dirty: Boolean(git(root, ["status", "--short"])),
  sources: hashSources(root, [
    "STAND.md",
    "docs/PLAN.md",
    ...specs.map((s) => s.file),
    ...citedReports,
  ]),
  warnings,
  nextGrip,
  specs,
  findings,
  milestones,
  next: buildNext(nextGrip, specs, packages),
  lessons: lessons.map((l) => ({ ...l, badges: lessonBadges(l) })),
  lessonStats: lessonStats(lessons),
};

mkdirSync(out, { recursive: true });
const json = JSON.stringify(data, null, 2);
writeFileSync(join(out, "data.json"), json + "\n");
writeFileSync(join(out, "data.js"), `window.HQ_DATA = ${json};\n`);
console.log(`HQ wrote ${specs.length} specs → ${out}`);

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout.trim() || null;
}
function hashSources(rootDir, paths) {
  return paths
    .filter((p) => existsSync(join(rootDir, p)))
    .map((path) => ({
      path,
      sha256: createHash("sha256").update(readFileSync(join(rootDir, path))).digest("hex"),
    }));
}
