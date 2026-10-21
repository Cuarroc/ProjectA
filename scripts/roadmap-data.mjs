import { mkdirSync, writeFileSync, lstatSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildRoadmap } from "./lib/roadmap-data.mjs";
import { renderRoadmap } from "./lib/roadmap-page.mjs";
import { main as planCheck } from "./plan-check.mjs";
import { makeRunner, withExitCodes, isMain, runCli } from "./lib/dev-tools.mjs";

// Round-trip so that 2026-13-45 is rejected, not just anything shaped like a date.
const isoDate = d => { const t = Date.parse(`${d}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(t) && new Date(t).toISOString().startsWith(d); };

export const main = withExitCodes(async (argv, io, deps = {}) => {
  const { values } = parseArgs({ args: argv, options: { stdout: { type: "boolean" }, page: { type: "boolean" } } });
  const run = deps.run || makeRunner({ timeoutMs: 60000 });
  const command = (cmd, args) => {
    const r = run(cmd, args);
    if (r.code !== 0) throw new Error(`${cmd} ${args.slice(0, 2).join(" ")} failed (exit ${r.code})`);
    return r.stdout.trim();
  };
  // PLAN and mainSha must name the same tree, so the PLAN comes from origin/main, not the working tree.
  const mainSha = command("git", ["rev-parse", "origin/main"]);
  const plan = command("git", ["show", `${mainSha}:docs/PLAN.md`]);
  // Historical FETCH_HEAD entries need a matching explicit source in the dated reflog event.
  let fetchedAt = null;
  try {
    const path = command("git", ["rev-parse", "--git-path", "FETCH_HEAD"]);
    const origin = command("git", ["remote", "get-url", "origin"]).replace(/\.git\/?$/, "");
    const mainSource = `branch 'main' of ${origin}`;
    // A short main refspec can also resolve to a tag; its latest evidence must not borrow a branch entry.
    const latestMain = readFileSync(path, "utf8").split("\n").map(line => {
      const [sha, , source] = line.split("\t");
      return { sha, source: source?.replace(/\.git\/?$/, "") };
    }).findLast(({ source }) => source === mainSource || source === `tag 'main' of ${origin}`);
    const matches = latestMain?.sha === mainSha && latestMain.source === mainSource;
    if (matches) {
      const [sha, selector, message] = command("git", ["reflog", "show", "-1", "--format=%H%x09%gD%x09%gs", "--date=unix", "refs/remotes/origin/main"]).split("\t");
      const seconds = selector?.match(/@\{(\d+)\}$/)?.[1];
      // Implicit/configured or multiple refspecs cannot prove which source updated this ref.
      const fromMain = /^fetch (?:-q |--quiet |--append )*origin \+?(?:refs\/heads\/)?main(?::refs\/remotes\/origin\/main)?: /.test(message || "");
      if (sha === mainSha && seconds && fromMain) fetchedAt = new Date(Number(seconds) * 1000).toISOString();
    }
  } catch (e) {
    if (e.code !== "ENOENT") io.err(`roadmap: fetch evidence unavailable (${e.code || e.message}); source freshness stays unknown\n`);
  }
  const fields = "number,isDraft,state,mergedAt,labels,body,headRefName,baseRefName,updatedAt";
  // Historical check rollups are large and cannot affect a merged package's state.
  const open = JSON.parse(command("gh", ["pr", "list", "--state", "all", "--search", "is:open", "--limit", "1000", "--json", `${fields},statusCheckRollup`]));
  const merged = JSON.parse(command("gh", ["pr", "list", "--state", "merged", "--limit", "10000", "--json", fields]));
  if (!Array.isArray(open) || open.length >= 1000 || !Array.isArray(merged) || merged.length >= 10000) throw new Error("PR list incomplete");
  const prs = [...open, ...merged];
  for (const pr of prs.filter(p => p.state === "OPEN" && !p.headRefName.startsWith("mergify/"))) {
    const facts = JSON.parse(command("gh", ["pr", "view", String(pr.number), "--json", "commits,mergeable"]));
    Object.assign(pr, facts);
    // Stacked PRs target another branch; `main` rules do not apply, and gh exits 1 with empty output for them.
    let checks = [];
    if (pr.baseRefName === "main") {
      const r = run("gh", ["pr", "checks", String(pr.number), "--required", "--json", "name,state,bucket"]);
      if (![0, 1, 8].includes(r.code)) throw new Error(`Required checks unavailable for #${pr.number} (exit ${r.code})`);
      try { checks = JSON.parse(r.stdout); } catch { checks = null; }
      if (!Array.isArray(checks)) throw new Error(`Invalid required checks for #${pr.number}`);
    }
    pr.statusCheckRollup = checks.map(c => ({ ...c, isRequired: true }));
  }
  const releases = JSON.parse(command("gh", ["release", "list", "--limit", "1000", "--json", "tagName,publishedAt,isDraft,isPrerelease"]));
  if (!Array.isArray(releases) || releases.length >= 1000) throw new Error("Release list incomplete");
  const now = deps.now || new Date();
  const data = buildRoadmap({ plan, prs, releases, now, mainSha, fetchedAt });
  let text = JSON.stringify(data, null, 2) + "\n", target = ".pa/roadmap-data.json";
  if (values.page) {
    target = ".pa/roadmap.html";
    const changes = command("git", ["log", mainSha, "--max-count=20", "--format=%cs%x09%s", "--", "docs/PLAN.md"]).split("\n").filter(l => l.includes("\t") && isoDate(l.split("\t")[0])).map(l => ({ date: l.split("\t")[0], subject: l.split("\t").slice(1).join("\t") }));
    // The plan check reads the same origin/main tree; if it cannot run, findings stay undefined and the page says so.
    let findings, notChecked, checked = "";
    const code = await (deps.planCheck || planCheck)(["--json"], { out: s => { checked += s; }, err: () => {} }, { run, now, read: p => command("git", ["show", `${mainSha}:${p}`]) });
    // Empty or malformed output must not abort the page; the renderer then marks the findings as not connected.
    if (code === 0 || code === 1) try { ({ findings, notChecked } = JSON.parse(checked)); } catch {}
    // One line, no payload: the page still renders, but the missing findings must not go unnoticed.
    if (!Array.isArray(findings)) { findings = undefined; io.err(`roadmap: plan check gave no usable findings (exit ${code}); page shows them as not connected\n`); }
    text = renderRoadmap(data, { releases, changes, findings, notChecked, now });
  }
  if (values.stdout) io.out(text);
  else {
    if (command("git", ["ls-files", "--", target])) throw new Error("Output path is tracked");
    command("git", ["check-ignore", target]);
    mkdirSync(".pa", { recursive: true });
    if ([".pa", target].some(p => lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink())) throw new Error("Output path is a symlink");
    writeFileSync(target, text);
    io.out(values.page ? `roadmap:page ${target} ${Buffer.byteLength(text)} bytes\n` : `roadmap:data ${JSON.stringify(data.head)}\n`);
  }
});
if (isMain(import.meta.url)) runCli(main);
