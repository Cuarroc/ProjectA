import { test } from "node:test";
import assert from "node:assert/strict";
import { activitySessions, diffVolume, estimateEffort, heatmap, significantSignals, workSessions } from "./hq-insights.mjs";

test("workSessions clusters commits into sittings and adds the lead-up", () => {
  const t0 = 1_700_000_000;
  const r = workSessions([t0, t0 + 600, t0 + 3600, t0 + 5 * 3600, t0 + 5 * 3600 + 60]);
  assert.equal(r.sessions.length, 2);
  assert.equal(r.sessions[0].commits, 3);
  assert.equal(r.sessions[0].hours, 1.5, "1 h span + 30 min lead");
  assert.equal(r.sessions[1].hours, 0.52);
  assert.equal(r.hours, 2);
  assert.equal(workSessions([]).hours, 0);
});

test("activitySessions reads journal headings", () => {
  const s = activitySessions("## 2026-09-08 18:23 — copilot-cli (a, b)\ntext\n## 2026-09-08 17:33 — dev-hq-teams (x)\n");
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], { day: "2026-09-08", time: "18:23", instance: "copilot-cli" });
});

test("diffVolume skips generated files", () => {
  const v = diffVolume("10\t2\tsrc/a.ts\n5000\t4000\tdocs/dev-hq/data.js\n3\t1\tpackage-lock.json\n7\t0\tscripts/x.mjs\n");
  assert.deepEqual(v, { insertions: 17, deletions: 2 });
});

test("estimateEffort prefers a larger ledger, else the spelled-out heuristic; time is the larger basis", () => {
  const git = workSessions([1_700_000_000, 1_700_003_600]);
  const heuristic = estimateEffort({ git, activity: activitySessions("## 2026-09-08 18:23 — a\n## 2026-09-08 19:23 — b\n"), volume: { insertions: 1000, deletions: 200 }, ledger: null });
  assert.equal(heuristic.tokens.value, 72000);
  assert.equal(heuristic.tokens.source, "heuristic");
  assert.match(heuristic.tokens.basis, /1,200 changed lines/);
  assert.equal(heuristic.time.hours, 1.5, "git 1.5 h beats 2 sessions × 45 min = 1.5 h (tie → same)");
  assert.match(heuristic.time.basis, /git sittings/);
  const ledger = estimateEffort({ git, activity: [], volume: { insertions: 10, deletions: 0 }, ledger: { tokensIn: 9_000_000, tokensOut: 2_000_000, costUsd: 4.21 } });
  assert.equal(ledger.tokens.value, 11_000_000);
  assert.equal(ledger.tokens.source, "ledger");
  assert.equal(ledger.costUsd, 4.21);
});

test("heatmap counts UTC weekday × hour, Monday first", () => {
  // 2026-09-07 is a Monday; 10:00 UTC
  const h = heatmap([Date.UTC(2026, 8, 7, 10) / 1000, Date.UTC(2026, 8, 7, 10, 30) / 1000, Date.UTC(2026, 8, 13, 23) / 1000]);
  assert.equal(h.grid[0][10], 2);
  assert.equal(h.grid[6][23], 1);
  assert.equal(h.max, 2);
});

test("significantSignals ranks act > watch > note and names the target", () => {
  const signals = significantSignals({
    board: [
      { worker: { id: "wk-1", task: "Fix the dispatcher" }, column: "working", attentionReason: "cargo check failed", contextUsage: { used: 170000, total: 200000 } },
      { worker: { id: "wk-2", task: "Review" }, column: "ready_to_merge", testStatus: "pass" },
    ],
    quota: [{ profileId: "opencode", state: "blocked", reason: "rate limit" }],
    budgets: [{ profileId: "claude", fiveHourPct: 85 }],
    lessons: [{ id: "L-1", symptom: "gdk missing", hits: 4, worked: 0, failed: 2 }],
    dirtyFiles: 2,
  });
  assert.equal(signals[0].level, "act");
  assert.match(signals[0].title, /needs a human/);
  assert.equal(signals[0].target, "worker:wk-1");
  assert.ok(signals.some((s) => s.level === "act" && /ready to merge/.test(s.title)));
  assert.ok(signals.some((s) => s.level === "watch" && /85% context|context/.test(s.title)));
  assert.ok(signals.some((s) => /quota-blocked/.test(s.title)));
  assert.ok(signals.some((s) => /5-hour budget/.test(s.title)));
  assert.ok(signals.some((s) => s.level === "note" && /disputed/.test(s.title)));
  assert.ok(signals.some((s) => /Most recurring/.test(s.title)));
  const levels = signals.map((s) => s.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => ({ act: 0, watch: 1, note: 2 })[a] - ({ act: 0, watch: 1, note: 2 })[b]));
  assert.equal(significantSignals({})[0].title, "Nothing needs you right now");
});
