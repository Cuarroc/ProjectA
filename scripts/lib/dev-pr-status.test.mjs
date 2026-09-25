// SETUP-08b: pr-status turns `gh pr list` JSON into a compact table (fake gh).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REQUIRED, buildRows, checkState, formatTable, main } from "../dev/pr-status.mjs";

const repoRoot = resolve(import.meta.dirname, "../..");

const run = (name, conclusion, status = "COMPLETED", startedAt = "2026-09-24T10:00:00Z") => ({ __typename: "CheckRun", name, status, conclusion, startedAt });
const green = [run("gates (linux)", "SUCCESS"), run("gates (windows)", "SUCCESS"), run("red-first", "SUCCESS")];
const PRS = [
  { number: 120, title: "merge queue: checking #112 on main (a2b2041)", headRefName: "mergify/merge-queue/143c", isDraft: true, labels: [], mergeStateStatus: "BLOCKED", statusCheckRollup: [], updatedAt: "2026-09-24T19:00:00Z" },
  { number: 112, title: "feat: a", headRefName: "claude/a", isDraft: false, labels: [], mergeStateStatus: "CLEAN", statusCheckRollup: green, updatedAt: "2026-09-24T19:00:00Z" },
  { number: 119, title: "docs: b", headRefName: "claude/b", isDraft: false, labels: [{ name: "do-not-merge" }], mergeStateStatus: "CLEAN", statusCheckRollup: green, updatedAt: "2026-09-24T19:00:00Z" },
  { number: 121, title: "wip", headRefName: "claude/c", isDraft: true, labels: [], mergeStateStatus: "DRAFT", statusCheckRollup: [], updatedAt: "2026-09-24T19:00:00Z" },
  { number: 122, title: "rot", headRefName: "claude/d", isDraft: false, labels: [], mergeStateStatus: "BLOCKED", statusCheckRollup: [run("gates (linux)", "FAILURE"), run("gates (windows)", "", "IN_PROGRESS"), run("red-first", "SUCCESS")], updatedAt: "2026-09-24T19:00:00Z" },
  { number: 123, title: "konflikt", headRefName: "claude/e", isDraft: false, labels: [{ name: "conflict" }], mergeStateStatus: "DIRTY", statusCheckRollup: green, updatedAt: "2026-09-24T19:00:00Z" },
  { number: 124, title: "grün", headRefName: "claude/f", isDraft: false, labels: [], mergeStateStatus: "CLEAN", statusCheckRollup: green, updatedAt: "2026-09-24T19:00:00Z" },
];

test("checkState reads the newest run of a required check", () => {
  const rollup = [run("red-first", "FAILURE", "COMPLETED", "2026-09-24T09:00:00Z"), run("red-first", "SUCCESS", "COMPLETED", "2026-09-24T10:00:00Z")];
  assert.equal(checkState(rollup, "red-first"), "ok");
  assert.equal(checkState([run("red-first", "", "IN_PROGRESS")], "red-first"), "läuft");
  assert.equal(checkState([run("red-first", "SKIPPED")], "red-first"), "übersprungen");
  assert.equal(checkState([{ __typename: "StatusContext", context: "red-first", state: "FAILURE" }], "red-first"), "rot");
  assert.equal(checkState([], "red-first"), "—");
});

test("pr-status derives the queue state from Mergify labels draft and checks", () => {
  const rows = buildRows(PRS);
  const q = Object.fromEntries(rows.map((r) => [r.number, r.queue]));
  assert.equal(rows.some((r) => r.number === 120), false, "Mergify-Queue-PR selbst ist keine Zeile");
  assert.equal(q[112], "in Queue");
  assert.equal(q[119], "gesperrt (do-not-merge)");
  assert.equal(q[121], "Draft (keine CI)");
  assert.equal(q[122], "rot");
  assert.equal(q[123], "Konflikt");
  assert.equal(q[124], "bereit");
  const r122 = rows.find((r) => r.number === 122);
  assert.deepEqual(r122.checks, { linux: "rot", windows: "läuft", redFirst: "ok" });
});

test("pr-status prints a markdown table with one row per PR", () => {
  const table = formatTable(buildRows(PRS));
  const lines = table.trim().split("\n");
  assert.match(lines[0], /^\| # \| Branch \|/);
  assert.equal(lines.filter((l) => /^\| #\d+ /.test(l)).length, 6);
  assert.match(table, /\| #119 \| claude\/b \|.*do-not-merge/);
});

test("pr-status CLI calls gh pr list once and exits 0", async () => {
  const calls = [];
  const fake = (cmd, args) => {
    calls.push([cmd, ...args]);
    return { code: 0, stdout: JSON.stringify(PRS), stderr: "" };
  };
  const out = [];
  const code = await main([], { out: (s) => out.push(s), err: (s) => out.push(s) }, { run: fake });
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 5), ["gh", "pr", "list", "--state", "open"]);
  assert.match(out.join(""), /#124/);
});

test("pr-status CLI exits 3 when gh fails", async () => {
  const fake = () => ({ code: 4, stdout: "", stderr: "gh auth login" });
  const code = await main([], { out: () => {}, err: () => {} }, { run: fake });
  assert.equal(code, 3);
});

test("pr-status --help exits 0", async () => {
  const out = [];
  assert.equal(await main(["--help"], { out: (s) => out.push(s), err: (s) => out.push(s) }), 0);
  assert.match(out.join(""), /pr-status/);
});

// --- Review SETUP-08b (glm-5.2 #2, kimi-k3 #6) ---

test("REQUIRED lists exactly the checks Mergify requires and the jobs ci.yml defines (glm #2)", () => {
  const mergify = readFileSync(join(repoRoot, ".mergify.yml"), "utf8");
  const ci = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  const required = [...new Set([...mergify.matchAll(/check-success = (.+)$/gm)].map((m) => m[1].trim()))].sort();
  assert.deepEqual(REQUIRED.map(([, name]) => name).sort(), required);
  for (const [, name] of REQUIRED) assert.match(ci, new RegExp(`^\\s+name: ${name.replace(/[()]/g, "\\$&")}\\s*$`, "m"), `ci.yml job "${name}"`);
});

test("pr-status warns when gh returns as many PRs as the limit (kimi #6)", async () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ number: i + 1, title: "t", headRefName: `claude/x${i}`, isDraft: true, labels: [], mergeStateStatus: "DRAFT", statusCheckRollup: [], updatedAt: "2026-09-24T19:00:00Z" }));
  const fake = () => ({ code: 0, stdout: JSON.stringify(many), stderr: "" });
  const err = [];
  assert.equal(await main([], { out: () => {}, err: (s) => err.push(s) }, { run: fake }), 0);
  assert.match(err.join(""), /200/);
  assert.match(err.join(""), /unvollst/);
  const few = [];
  const fakeFew = () => ({ code: 0, stdout: JSON.stringify(PRS), stderr: "" });
  await main([], { out: () => {}, err: (s) => few.push(s) }, { run: fakeFew });
  assert.equal(few.join(""), "");
});
