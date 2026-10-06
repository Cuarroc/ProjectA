// FLOW-05: M-RP counter from PR-body JSON; no network, no writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countRp, parsePromptLog, main } from "../dev/mrp-count.mjs";
import { measure } from "../dev/bench-weekly.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/mrp-count.json", import.meta.url), "utf8"));
const win = { from: "2026-10-02", to: "2026-10-05" };

test("parsePromptLog ignores the unfilled template placeholders", () => {
  assert.equal(parsePromptLog(null), null);
  assert.equal(parsePromptLog("## Report\n"), null);
  const tpl = "### Prompt-Log\n\n- **rounds:** 0-2 · **findings:** n high / n other\n";
  assert.deepEqual(parsePromptLog(tpl), { filled: false, rounds: null, high: null, other: null });
  const ok = "### Prompt-Log\n\n- **rounds:** 2 · **findings:** 1 high / 3 other\n\n### Evidence\n";
  assert.deepEqual(parsePromptLog(ok), { filled: true, rounds: 2, high: 1, other: 3 });
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
  const code = await main(["--input", new URL("./fixtures/mrp-count.json", import.meta.url).pathname, "--from", "2026-10-02", "--to", "2026-10-05"], { out: (s) => (out += s), err: () => {} });
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).sharePct, 40);
});

test("bench-weekly carries the M-RP rows", () => {
  const rows = Object.fromEntries(measure({ prs: fixture.prs, runs: [] }, win).rows.map((r) => [r.id, r]));
  assert.deepEqual([rows.m_rp.num, rows.m_rp.den], [2, 5]);
  assert.equal(rows.rp_fixround.num, 2);
});
