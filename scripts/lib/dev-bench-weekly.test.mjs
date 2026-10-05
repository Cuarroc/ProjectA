// BENCH-01: weekly measurement from gh/git JSON; no network, no writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { measure, packageId, renderMarkdown, main, countLines, collect } from "../dev/bench-weekly.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/bench-weekly.json", import.meta.url), "utf8"));
const rows = () => Object.fromEntries(measure(fixture, { from: "2026-10-02", to: "2026-10-05" }).rows.map((r) => [r.id, r]));

test("packageId reads the package from provider branches only", () => {
  assert.equal(packageId("claude/w3-02d-installer-adapter"), "w3-02");
  assert.equal(packageId("codex/ki-30-flake"), "ki-30");
  assert.equal(packageId("claude/ci-03-queue"), "ci-03");
  assert.equal(packageId("hotfix/ci-red"), null);
  assert.equal(packageId("mergify/merge-queue/abc"), null);
});

test("throughput counts merged PRs and code lines and packages per active day", () => {
  const m = measure(fixture, { from: "2026-10-02", to: "2026-10-05" });
  assert.equal(m.activeDays, 3);
  const r = rows();
  assert.equal(r.thr_prs.num, 4);
  assert.equal(r.thr_lines.num, 410);
  assert.equal(r.thr_pkgs.num, 2);
});

test("lead time gives median and p90 by tier and by size class", () => {
  const r = rows();
  assert.deepEqual([r.lead.median, r.lead.p90, r.lead.n], [1.25, 12, 4]);
  assert.deepEqual([r["lead.tier.A"].median, r["lead.tier.?"].median], [12, 0.5]);
  assert.deepEqual([r["lead.size.S"].median, r["lead.size.S"].p90, r["lead.size.L"].n], [0.5, 2, 1]);
});

test("rework and review ratios use their pinned patterns", () => {
  const r = rows();
  assert.deepEqual([r.rule1.num, r.rule1.den], [1, 4]);
  assert.deepEqual([r.review_fix.num, r.review_fix.den], [1, 4]);
  assert.deepEqual([r.round2.num, r.round2.den], [1, 4]);
  assert.deepEqual([r.rework_fix.num, r.rework_fix.den], [1, 3]);
  assert.deepEqual([r.closed.num, r.closed.den], [1, 5]);
  assert.equal(r.hotfix.num, 1);
});

test("red PR heads and red queue runs are split by branch", () => {
  const r = rows();
  assert.deepEqual([r.red_heads.num, r.red_heads.den], [1, 5]);
  assert.deepEqual([r.red_queue.num, r.red_queue.den], [1, 4]);
});

test("markdown and --json outputs come from --input without network", async () => {
  const m = measure(fixture, { from: "2026-10-02", to: "2026-10-05" });
  assert.match(renderMarkdown(m), /\| thr_prs \|/);
  let out = "";
  const code = await main(["--input", fileURLToPath(new URL("./fixtures/bench-weekly.json", import.meta.url)), "--from", "2026-10-02", "--to", "2026-10-05", "--json"], { out: (s) => (out += s), err: () => {} });
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).rows.length, m.rows.length);
});

test("countLines skips lockfiles and counts binary as 0 and follows renames to the new path", () => {
  const n = [
    "3\t1\tsrc/a.rs",
    "-\t-\tassets/logo.png",
    "10\t0\tdocs/{old => new}/x.md",
    "5\t5\tpackage-lock.json => sub/x.rs",
    "7\t0\told/package-lock.json => package-lock.json",
    "",
  ].join("\n");
  assert.deepEqual(countLines(n), { lines: 4 + 10 + 10, codeLines: 4 + 10 });
});

const mergedPr = { number: 7, title: "t", headRefName: "claude/w1-01-x", mergedAt: "2026-10-03T10:00:00Z", mergeCommit: { oid: "abc" } };
const fakeRun = (git) => (cmd, args) => {
  if (cmd === "gh") return { code: 0, stdout: args[0] === "pr" ? JSON.stringify([structuredClone(mergedPr)]) : "[]", stderr: "" };
  return git(args);
};

test("collect reads lines and branch commits per merge and skips PRs outside the window", () => {
  const run = fakeRun((a) => ({ code: 0, stdout: a[0] === "diff" ? "2\t1\tsrc/a.rs\n" : a[0] === "rev-list" ? "abc p1 p2\n" : "fix: review finding\nfeat: x\n", stderr: "" }));
  const { prs } = collect({ from: "2026-10-03", to: "2026-10-04" }, run);
  assert.deepEqual([prs[0].lines, prs[0].codeLines, prs[0].commits], [3, 3, ["fix: review finding", "feat: x"]]);
  const none = collect({ from: "2026-10-04", to: "2026-10-05" }, run);
  assert.equal(none.prs[0].lines, undefined);
});

test("collect fails loudly when git fails and marks squash merges as unknown", () => {
  const bad = fakeRun(() => ({ code: 128, stdout: "", stderr: "bad object" }));
  assert.throws(() => collect({ from: "2026-10-03", to: "2026-10-04" }, bad), /PR #7.*Exit 128.*bad object/);
  const squash = fakeRun((a) => ({ code: 0, stdout: a[0] === "diff" ? "1\t0\tsrc/a.rs\n" : "abc p1\n", stderr: "" }));
  assert.equal(collect({ from: "2026-10-03", to: "2026-10-04" }, squash).prs[0].commits, null);
});

test("main rejects impossible and reversed dates with exit 2 and git errors with exit 1", async () => {
  const io = { out: () => {}, err: () => {} };
  for (const args of [["--to", "2026-13-01"], ["--from", "2026-02-31", "--to", "2026-03-05"], ["--from", "2026-10-05", "--to", "2026-10-02"]]) {
    assert.equal(await main(args, io), 2, args.join(" "));
  }
  const bad = fakeRun(() => ({ code: 128, stdout: "", stderr: "x" }));
  assert.equal(await main(["--from", "2026-10-03", "--to", "2026-10-04"], io, { run: bad }), 1);
});
