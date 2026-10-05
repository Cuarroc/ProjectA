import { test } from "node:test";
import assert from "node:assert/strict";
import { authors, commitsPerDay, fetchHeadAgeH, fleetStats, freshness, snapshotStats, testSurface } from "./hq-stats.mjs";

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

test("freshness is red from 50 commits behind and says git pull", () => {
  const f = freshness({ behind: 838, standAgeH: 1 });
  assert.equal(f.level, "rot");
  assert.match(f.text, /git pull/);
  assert.match(f.text, /838/);
});

test("freshness is green at 0 behind and yellow when behind or stale", () => {
  assert.equal(freshness({ behind: 0, standAgeH: 2 }).level, "grün");
  assert.equal(freshness({ behind: 1, standAgeH: 2 }).level, "gelb");
  assert.equal(freshness({ behind: 49, standAgeH: 2 }).level, "gelb");
  assert.equal(freshness({ behind: 0, standAgeH: 30 }).level, "gelb");
  assert.equal(freshness({ behind: 0, standAgeH: 24 }).level, "grün");
});

test("freshness reports unknown inputs as unknown and never as green", () => {
  assert.equal(freshness({ behind: null, standAgeH: null }).level, "unbekannt");
  const noFetch = freshness({ behind: 0, standAgeH: null });
  assert.equal(noFetch.level, "gelb");
  assert.match(noFetch.text, /nie geholt|unbekannt/);
});

test("fetchHeadAgeH never stats an empty path and only maps ENOENT to null", () => {
  const stat = () => { throw new Error("must not be called"); };
  assert.equal(fetchHeadAgeH("", { stat }), null);
  const enoent = () => { throw Object.assign(new Error("gone"), { code: "ENOENT" }); };
  assert.equal(fetchHeadAgeH("/x/FETCH_HEAD", { stat: enoent }), null);
  const eperm = () => { throw Object.assign(new Error("denied"), { code: "EPERM" }); };
  assert.throws(() => fetchHeadAgeH("/x/FETCH_HEAD", { stat: eperm }), /denied/);
  assert.equal(fetchHeadAgeH("/x/FETCH_HEAD", { stat: () => ({ mtimeMs: 0 }), now: 7200000 }), 2);
});

test("the freshness light is marked lang=de inside the English masthead", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("docs/dev-hq/hq.js", "utf8");
  assert.match(html, /<p id="live-freshness"[^>]*\blang="de"/);
});
