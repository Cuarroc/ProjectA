// FLOW-05: M-RP counter from PR-body JSON; no network, no writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { countRp, parsePromptLog, main } from "../dev/mrp-count.mjs";
import { measure } from "../dev/bench-weekly.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/mrp-count.json", import.meta.url), "utf8"));
const win = { from: "2026-10-02", to: "2026-10-05" };

test("countRp recognizes all current Mergify package branches", () => {
  const providers = ["claude", "codex", "kimi", "opencode", "glm", "cursor"];
  const packages = ["w3-02d-x", "df12-x", "ki-30-x", "hq2-03-x", "dr-14-sort", "z2-status-ci"];
  const pr = (headRefName) => ({ headRefName, mergedAt: "2026-10-03T10:00:00Z" });
  for (const provider of providers) {
    for (const pkg of packages) {
      const branch = `${provider}/${pkg}`;
      assert.equal(countRp([pr(branch)], win).packagePrs, 1, branch);
      assert.equal(countRp([pr(branch.toUpperCase())], win).packagePrs, 1, branch);
    }
  }
  for (const branch of ["claude/plan-01-x", "codex/ci-03-x", "mergify/merge-queue/abc", "dependabot/dr-14-x", "unknown/z2-x", "cursor/z-status", "codex/z2x-status", "codex/w3x-status"]) {
    assert.equal(countRp([pr(branch)], win).packagePrs, 0, branch);
  }
});

test("parsePromptLog ignores the unfilled template placeholders", () => {
  assert.equal(parsePromptLog(null), null);
  assert.equal(parsePromptLog("## Report\n"), null);
  const tpl = "### Prompt-Log\n\n- **rounds:** 0-2 · **findings:** n high / n other\n";
  assert.deepEqual(parsePromptLog(tpl), { filled: false, rounds: null, high: null, other: null });
  const ok = "### Prompt-Log\n\n- **rounds:** 2 · **findings:** 1 high / 3 other\n\n### Evidence\n";
  assert.deepEqual(parsePromptLog(ok), { filled: true, rounds: 2, high: 1, other: 3 });
});

test("partial prompt log placeholders are not complete evidence", () => {
  const partial = "### Prompt-Log\n\n- **rounds:** 1 · **findings:** n high / n other\n";
  assert.deepEqual(parsePromptLog(partial), { filled: false, rounds: null, high: null, other: null });
  const missing = "### Prompt-Log\n\n- **rounds:** 1 · **critic:** self\n";
  assert.deepEqual(parsePromptLog(missing), { filled: false, rounds: null, high: null, other: null });
  const zero = "### Prompt-Log\n\n- **rounds:** 0 · **findings:** 0 high / 0 other\n";
  assert.deepEqual(parsePromptLog(zero), { filled: true, rounds: 0, high: 0, other: 0 });
  const partialPrs = [
    {
      headRefName: "claude/w16-z2-partial",
      mergedAt: "2026-10-03T10:00:00Z",
      body: "## Report\n\n### Prompt-Log\n\n- **rounds:** 1 · **findings:** n high / n other\n\n### Nacharbeit\n\n- x.rs:1 exit 1\n",
    },
  ];
  const m = countRp(partialPrs, win);
  assert.equal(m.packagePrs, 1);
  assert.equal(m.withPromptLog, 0);
  assert.deepEqual(m.fixRounds.withLog, { prs: 0, withNacharbeit: 0 });
  assert.deepEqual(m.fixRounds.withoutLog, { prs: 1, withNacharbeit: 1 });
  const rows = Object.fromEntries(measure({ prs: fixture.prs, runs: [] }, win).rows.map((r) => [r.id, r]));
  assert.deepEqual([rows.m_rp.num, rows.m_rp.den], [2, 5]);
  assert.equal(rows.rp_fixround.num, 2);
});

test("countRp counts only merged package PRs in the window", () => {
  const m = countRp(fixture.prs, win);
  assert.equal(m.packagePrs, 5);
  assert.equal(m.withPromptLog, 2);
  assert.equal(m.sharePct, 40);
  assert.deepEqual(m.rounds, { 0: 0, 1: 1, 2: 1 });
  assert.deepEqual(m.findings, { high: 1, other: 5 });
});

test("fix rounds are split by Prompt-Log presence", () => {
  const m = countRp(fixture.prs, win);
  assert.equal(m.fixRounds.total, 2);
  assert.deepEqual(m.fixRounds.withLog, { prs: 2, withNacharbeit: 1 });
  assert.deepEqual(m.fixRounds.withoutLog, { prs: 3, withNacharbeit: 1 });
});

test("an empty window gives a null share", () => {
  const m = countRp(fixture.prs, { from: "2020-01-01", to: "2020-01-02" });
  assert.equal(m.packagePrs, 0);
  assert.equal(m.sharePct, null);
});

test("the CLI prints JSON", async () => {
  let out = "";
  const code = await main(["--input", fileURLToPath(new URL("./fixtures/mrp-count.json", import.meta.url)), "--from", "2026-10-02", "--to", "2026-10-05"], { out: (s) => (out += s), err: () => {} });
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).sharePct, 40);
});

test("bench-weekly carries the M-RP rows", () => {
  const rows = Object.fromEntries(measure({ prs: fixture.prs, runs: [] }, win).rows.map((r) => [r.id, r]));
  assert.deepEqual([rows.m_rp.num, rows.m_rp.den], [2, 5]);
  assert.equal(rows.rp_fixround.num, 2);
});
