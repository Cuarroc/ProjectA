import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncPlan } from "./plan-sync.mjs";
import { parsePlan, checkPlan } from "./plan-model.mjs";
import { main } from "../plan-sync.mjs";

const table = (rows) => `| ID | Ziel | Status |\n|---|---|---|\n${rows}\n`;
const merged = { number: 42, state: "MERGED", mergedAt: "2026-10-18T17:00:00Z" };

test("synchronized rows are done for existing PLAN consumers", () => {
  const result = syncPlan(table("| AUTO-1 | Sync | In Arbeit #42 |"), [merged]);
  const model = parsePlan(result.markdown);
  assert.equal(model.packages[0].status, "done");
  assert.deepEqual(checkPlan(model, { prs: [merged] }), []);
});

test("a merged PR flips an in-progress row to Erledigt with the merge date", () => {
  for (const old of ["In Arbeit #42", "In Prüfung #42", "Geplant #42"]) {
    const md = table(`| AUTO-1 | Sync | ${old} |`);
    const result = syncPlan(md, [merged]);
    assert.equal(result.markdown, table(`| AUTO-1 | Sync | Erledigt: #42 (merged 2026-10-18); ${old} |`));
    assert.deepEqual(result.changes.map(c => [c.id, c.old, c.new]), [["AUTO-1", old, `Erledigt: #42 (merged 2026-10-18); ${old}`]]);
    assert.equal(syncPlan(result.markdown, [merged]).changes.length, 0);
  }
  const md = table("| AUTO-1 | Sync | Geplant | ");
  assert.equal(syncPlan(md, [{ ...merged, body: "Plan-ID: AUTO-1" }]).changes.length, 1);
  const multi = table("| AUTO-1 | Sync | In Prüfung #42, #43 | ");
  const result = syncPlan(multi, [merged, { number: 43, state: "MERGED", mergedAt: "2026-10-19T01:00:00Z" }]);
  assert.match(result.markdown, /Erledigt: #42 \(merged 2026-10-18\), #43 \(merged 2026-10-19\); In Prüfung #42, #43/);
  assert.equal(result.changes.length, 1);
});

test("closed unmerged and open PRs are reported not rewritten", () => {
  const md = table("| AUTO-1 | Sync | Geplant #42 |\n| AUTO-2 | Other | Erledigt #43 |");
  const result = syncPlan(md, [{ number: 42, state: "CLOSED" }, { number: 43, state: "OPEN" }]);
  assert.equal(result.markdown, md);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.skipped.map(s => s.id), ["AUTO-1", "AUTO-2"]);
  for (const prs of [[merged], [merged, { number: 43, state: "OPEN" }], [merged, { number: 43, state: "CLOSED" }]]) {
    const multi = table("| AUTO-1 | Sync | In Arbeit #42, #43 |");
    assert.equal(syncPlan(multi, prs).markdown, multi);
  }
  const single = table("| AUTO-1 | Sync | In Arbeit #42 |");
  assert.equal(syncPlan(single, [merged, { number: 43, state: "OPEN", title: "AUTO-1 follow-up" }]).markdown, single);
  assert.equal(syncPlan(single, [{ ...merged, mergedAt: null }]).markdown, single);
  assert.equal(syncPlan(table("| AUTO-1 | Sync | Blockiert #42 |"), [merged]).changes.length, 0);
});

test("only the status cell changes other columns stay byte-identical", () => {
  const md = "Intro\r\n| ID | Ziel | Status | Owner |\r\n|---|---|---|---|\r\n| AUTO-1 | A \\| B  |  In Arbeit #42  | `team` |\r\n\r\n```md\r\n" + table("| AUTO-1 | Example | In Arbeit #42 |").replaceAll("\n", "\r\n") + "```\r\nTail";
  assert.equal(syncPlan(md, [merged]).markdown, md.replace("  In Arbeit #42  ", "  Erledigt: #42 (merged 2026-10-18); In Arbeit #42  "));
  const stand = "| ID | Ziel | Stand |\n|---|---|---|\n| AUTO-1 | Sync | In Arbeit #42 |";
  assert.equal(syncPlan(stand, [merged]).changes.length, 1);
  const escaped = table("| AUTO-1 | Sync | In Arbeit #42; A \\| B |");
  assert.equal(syncPlan(escaped, [merged]).markdown, table("| AUTO-1 | Sync | Erledigt: #42 (merged 2026-10-18); In Arbeit #42; A \\| B |"));
});

test("CLI defaults to dry run and writes atomically only after valid GitHub evidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "plan-sync-")), file = join(dir, "PLAN.md");
  const md = table("| AUTO-1 | Sync | In Arbeit #42 |");
  let output = "";
  const io = { out: s => { output += s; }, err: () => {} };
  const run = (cmd, args) => {
    assert.equal(cmd, "gh");
    assert.deepEqual(args, ["pr", "list", "--state", "all", "--limit", "300", "--json", "number,state,title,headRefName,body,mergedAt"]);
    return { code: 0, stdout: JSON.stringify([merged]) };
  };
  try {
    writeFileSync(file, md);
    assert.equal(await main([], io, { run, file }), 0);
    assert.match(output, /AUTO-1: In Arbeit #42 → Erledigt:/);
    assert.equal(readFileSync(file, "utf8"), md);
    for (const response of [{ code: 1, stdout: "" }, { code: 0, stdout: "not JSON" }, { code: 0, stdout: "[{}]" }]) {
      assert.equal(await main(["--write"], io, { run: () => response, file }), 2);
      assert.equal(readFileSync(file, "utf8"), md);
    }
    assert.equal(await main(["--write"], io, { run, file }), 0);
    assert.equal(readFileSync(file, "utf8"), table("| AUTO-1 | Sync | Erledigt: #42 (merged 2026-10-18); In Arbeit #42 |"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
