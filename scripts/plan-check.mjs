import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parsePlan, checkPlan } from "./lib/plan-model.mjs";
import { makeRunner, withExitCodes, UsageError, isMain, runCli } from "./lib/dev-tools.mjs";

export const main = withExitCodes(async (argv, io, deps = {}) => {
  const { values } = parseArgs({ args: argv, options: { offline: { type: "boolean" }, json: { type: "boolean" }, strict: { type: "boolean" }, events: { type: "string" }, decisions: { type: "string", default: "docs/decisions.md" } } });
  const run = deps.run || makeRunner({ timeoutMs: 30000 }), read = deps.read || ((path) => readFileSync(path, "utf8"));
  const files = ["docs/PLAN.md", "docs/plan/v2.0/plan.md"], notChecked = [];
  let texts, decisions, events;
  try { texts = files.map(read); decisions = read(values.decisions); events = values.events ? read(values.events) : ""; }
  catch { throw new UsageError("Eingabedatei fehlt oder ist nicht lesbar"); }
  const models = texts.map((text, i) => parsePlan(text, { file: files[i] }));
  let prs = [];
  if (values.offline) notChecked.push("GitHub-PRs und Planalter-Abgleich (--offline)");
  else {
    const r = run("gh", ["pr", "list", "--state", "all", "--limit", "300", "--json", "number,state,title,headRefName,body,mergedAt"]);
    try {
      if (r.code !== 0) throw new Error();
      prs = JSON.parse(r.stdout);
      if (!Array.isArray(prs) || prs.some((p) => !p || !Number.isInteger(p.number) || !["OPEN", "MERGED", "CLOSED"].includes(p.state))) throw new Error();
      if (prs.length >= 300) notChecked.push("GitHub-Liste am Limit 300; ältere PRs nicht vollständig geprüft");
    } catch { prs = []; notChecked.push("GitHub-Abfrage fehlgeschlagen; PRs und Planalter-Abgleich nicht geprüft"); }
  }
  if (!values.events) notChecked.push("Laufende Jobs (kein --events)");
  const git = run("git", ["log", "-1", "--format=%cI", "--", "docs/PLAN.md"]);
  const lastPlanCommit = git.code === 0 ? git.stdout.trim() : "";
  if (!Number.isFinite(Date.parse(lastPlanCommit))) notChecked.push("Letzter Plan-Commit nicht ermittelbar");
  const findings = checkPlan({ packages: models.flatMap((m) => m.packages) }, { prs, events, decisions, eventsFile: values.events, decisionsFile: values.decisions, planText: texts.join("\n"), lastPlanCommit, now: deps.now });
  const summary = [`Plan-Prüfung: ${findings.length} Befunde`, ...findings.slice(0, 14).map((f) => `${f.file}:${f.line} ${f.kind} ${f.id || ""}${f.pr ? ` #${f.pr}` : ""}: ${f.detail}`)];
  if (findings.length > 14) summary.push(`Weitere ${findings.length - 14} Befunde: --json verwenden`);
  summary.push(`NICHT GEPRÜFT: ${notChecked.join("; ") || "keine"}`);
  io.out((values.json ? JSON.stringify({ findings, notChecked }, null, 2) : summary.join("\n")) + "\n");
  return findings.length || (values.strict && notChecked.length) ? 1 : 0;
});
if (isMain(import.meta.url)) runCli(main);
