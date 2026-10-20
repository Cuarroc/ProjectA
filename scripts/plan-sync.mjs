import { readFileSync, writeFileSync, renameSync, rmSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { syncPlan } from "./lib/plan-sync.mjs";
import { makeRunner, withExitCodes, UsageError, isMain, runCli } from "./lib/dev-tools.mjs";

export const main = withExitCodes(async (argv, io, deps = {}) => {
  const { values } = parseArgs({ args: argv, options: { write: { type: "boolean" }, help: { type: "boolean" } } });
  if (values.help) { io.out("plan:sync [--write]: preview status changes; --write atomically updates docs/PLAN.md\n"); return 0; }
  const run = deps.run || makeRunner({ timeoutMs: 30000 });
  let prs;
  try {
    const r = run("gh", ["pr", "list", "--state", "all", "--limit", "300", "--json", "number,state,title,headRefName,body,mergedAt"]);
    if (r.code !== 0) throw new Error();
    prs = JSON.parse(r.stdout);
    if (!Array.isArray(prs) || prs.some(p => !p || !Number.isInteger(p.number) || !["OPEN", "MERGED", "CLOSED"].includes(p.state))) throw new Error();
  } catch { throw new UsageError("GitHub query failed or returned invalid PR data; PLAN unchanged"); }
  const file = deps.file || "docs/PLAN.md", original = readFileSync(file, "utf8");
  const result = syncPlan(original, prs);
  if (values.write && result.changes.length) {
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, result.markdown, { flag: "wx", mode: statSync(file).mode });
      renameSync(temp, file);
    } finally { rmSync(temp, { force: true }); }
  }
  io.out(`${values.write ? "Written" : "Dry run"}: ${result.changes.length} changes, ${result.skipped.length} skipped\n`);
  for (const c of result.changes) io.out(`${c.id}: ${c.old} → ${c.new}\n`);
  for (const s of result.skipped) io.out(`${s.id}: skipped — ${s.reason}\n`);
  if (prs.length >= 300) io.out("NICHT GEPRÜFT: GitHub list capped at 300; older PRs may be missing\n");
  return 0;
});
if (isMain(import.meta.url)) runCli(main);
