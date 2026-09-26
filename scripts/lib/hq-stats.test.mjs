import { test } from "node:test";
import assert from "node:assert/strict";
import { authors, commitsPerDay, fleetStats, snapshotStats, testSurface } from "./hq-stats.mjs";

test("commitsPerDay fills every day of the window, oldest first", () => {
  const series = commitsPerDay("2026-09-08\n2026-09-08\n2026-09-06\n", 4, new Date("2026-09-08T12:00:00Z"));
  assert.deepEqual(series.map((d) => d.commits), [0, 1, 0, 2]);
  assert.equal(series[0].day, "2026-09-05");
  assert.equal(series.at(-1).day, "2026-09-08");
});

test("authors parses shortlog and sorts descending", () => {
  assert.deepEqual(authors("    12\tCuarroc\n     3\tClaude\n"), [{ author: "Cuarroc", commits: 12 }, { author: "Claude", commits: 3 }]);
});

test("testSurface counts test files and rust files", () => {
  const s = testSurface(["src/a.test.ts", "scripts/lib/x.test.mjs", "scripts/lib/v.browser.mjs", "src/app.tsx", "src-tauri/src/main.rs"], 884);
  assert.deepEqual(s, { frontendTestFiles: 3, rustFiles: 1, rustTests: 884 });
});

test("snapshotStats and fleetStats aggregate what the pages show", () => {
  const snap = snapshotStats({
    findings: [{ klass: "FACT" }, { klass: "FACT" }, { klass: "CLAIM" }],
    specs: [{ lane: "serial", startable: true }, { lane: "serial", startable: false }, { lane: "parallel" }],
    milestones: [{ packages: [{ state: "done" }, { state: "open" }] }, { packages: [{ state: "done" }] }],
  });
  assert.equal(snap.findings.FACT, 2);
  assert.deepEqual(snap.specs, { total: 3, serial: 2, parallel: 1, startable: 2, locked: 1 });
  assert.deepEqual(snap.packages, { total: 3, done: 2, open: 1 });
  const fleet = fleetStats([{ column: "working", contextUsage: { used: 50, total: 100 } }, { column: "working" }, { column: "done" }]);
  assert.deepEqual(fleet, { workers: 3, columns: { working: 2, done: 1 }, contextPercent: 50 });
});
