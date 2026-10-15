import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildRoadmap } from "./lib/roadmap-data.mjs";
import { makeRunner, withExitCodes, isMain, runCli } from "./lib/dev-tools.mjs";

export const main = withExitCodes(async (argv, io, deps = {}) => {
  const { values } = parseArgs({ args: argv, options: { stdout: { type: "boolean" } } });
  const run = deps.run || makeRunner({ timeoutMs: 60000 });
  const command = (cmd, args) => {
    const r = run(cmd, args);
    if (r.code !== 0) throw new Error(`${cmd} ${args[0]} failed (exit ${r.code})`);
    return r.stdout.trim();
  };
  const plan = (deps.read || readFileSync)("docs/PLAN.md", "utf8");
  const mainSha = command("git", ["rev-parse", "origin/main"]);
  const prs = JSON.parse(command("gh", ["pr", "list", "--state", "all", "--limit", "10000", "--json", "number,isDraft,state,mergedAt,labels,statusCheckRollup,body,headRefName,updatedAt"]));
  if (!Array.isArray(prs) || prs.length >= 10000) throw new Error("PR list incomplete");
  for (const pr of prs.filter(p => p.state === "OPEN" && !p.headRefName.startsWith("mergify/"))) {
    const facts = JSON.parse(command("gh", ["pr", "view", String(pr.number), "--json", "commits,mergeable"]));
    Object.assign(pr, facts);
    const r = run("gh", ["pr", "checks", String(pr.number), "--required", "--json", "name,state,bucket"]);
    if (![0, 1, 8].includes(r.code)) throw new Error(`Required checks unavailable (exit ${r.code})`);
    const checks = JSON.parse(r.stdout);
    if (!Array.isArray(checks)) throw new Error("Invalid required checks");
    pr.statusCheckRollup = checks.map(c => ({ ...c, isRequired: true }));
  }
  const releases = JSON.parse(command("gh", ["release", "list", "--limit", "1000", "--json", "tagName,publishedAt,isDraft,isPrerelease"]));
  const data = buildRoadmap({ plan, prs, releases, now: deps.now || new Date(), mainSha });
  const json = JSON.stringify(data, null, 2) + "\n";
  if (values.stdout) io.out(json);
  else {
    if (command("git", ["ls-files", "--", ".pa/roadmap-data.json"])) throw new Error("Output path is tracked");
    command("git", ["check-ignore", ".pa/roadmap-data.json"]);
    mkdirSync(".pa", { recursive: true });
    writeFileSync(".pa/roadmap-data.json", json);
    io.out(`roadmap:data ${JSON.stringify(data.head)}\n`);
  }
});
if (isMain(import.meta.url)) runCli(main);
