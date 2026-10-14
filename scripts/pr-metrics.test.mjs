// AP-2b: PR flow metrics. Fixture values are worked out by hand (see comments).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeMetrics, formatText, main, median, percentile } from "./pr-metrics.mjs";

const NOW = "2026-10-14T12:00:00Z";
const pr = (number, state, createdAt, extra = {}) => ({
  number,
  state,
  isDraft: false,
  createdAt,
  mergedAt: null,
  closedAt: null,
  headRefName: `claude/p${number}`,
  ...extra,
});
const merged = (number, createdAt, mergedAt, extra = {}) =>
  pr(number, "MERGED", createdAt, { mergedAt, closedAt: mergedAt, ...extra });

// Open (now = 2026-10-14 12:00): #10 ready 12 h, #11 draft 24 h, #12 draft 49 h,
// #13 draft exactly 48 h, #15 ready 1 h, #14 merge-queue draft (ignored).
// Merged hours: #1 2 h, #2 10 h, #3 24 h, #4 48 h, #5 6 h; #6 queue branch and
// #7 closed without merge are ignored.
const PRS = [
  pr(10, "OPEN", "2026-10-14T00:00:00Z"),
  pr(11, "OPEN", "2026-10-13T12:00:00Z", { isDraft: true }),
  pr(12, "OPEN", "2026-10-12T11:00:00Z", { isDraft: true }),
  pr(13, "OPEN", "2026-10-12T12:00:00Z", { isDraft: true }),
  pr(14, "OPEN", "2026-10-10T00:00:00Z", { isDraft: true, headRefName: "mergify/merge-queue/abc" }),
  pr(15, "OPEN", "2026-10-14T11:00:00Z"),
  merged(1, "2026-10-01T00:00:00Z", "2026-10-01T02:00:00Z"),
  merged(2, "2026-10-02T00:00:00Z", "2026-10-02T10:00:00Z"),
  merged(3, "2026-10-03T00:00:00Z", "2026-10-04T00:00:00Z"),
  merged(4, "2026-10-05T00:00:00Z", "2026-10-07T00:00:00Z"),
  merged(5, "2026-10-06T00:00:00Z", "2026-10-06T06:00:00Z"),
  merged(6, "2026-10-08T00:00:00Z", "2026-10-08T01:00:00Z", { headRefName: "mergify/merge-queue/def" }),
  pr(7, "CLOSED", "2026-10-02T00:00:00Z", { closedAt: "2026-10-03T00:00:00Z" }),
];
const opts = (extra = {}) => ({ now: NOW, limit: 15, mergedWindow: 50, ...extra });

test("median averages the two middle values of an even count", () => {
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([]), null);
});

test("percentile uses the nearest-rank method", () => {
  const ten = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  assert.equal(percentile(ten, 90), 9); // ceil(0.9 * 10) = 9th smallest
  assert.equal(percentile([2, 6, 10, 24, 48], 90), 48); // ceil(4.5) = 5th
  assert.equal(percentile([], 90), null);
});

test("open PRs are split into draft and ready and merge-queue branches are ignored", () => {
  const m = computeMetrics(PRS, opts());
  assert.deepEqual(m.open, { total: 5, draft: 3, ready: 2 });
});

test("a draft is stale only when strictly older than 48 hours", () => {
  const m = computeMetrics(PRS, opts());
  assert.deepEqual(m.staleDrafts, [12]); // 49 h; #13 is exactly 48 h and stays out
});

test("merged stats skip merge-queue branches and PRs closed without merge", () => {
  const m = computeMetrics(PRS, opts());
  assert.equal(m.merged.count, 5);
  assert.equal(m.merged.medianHours, 10); // 2, 6, 10, 24, 48
  assert.equal(m.merged.p90Hours, 48);
});

test("the merged window keeps only the newest N merged PRs", () => {
  // newest four by mergedAt: #4 (48 h), #5 (6 h), #3 (24 h), #2 (10 h) -> 6, 10, 24, 48
  const m = computeMetrics(PRS, opts({ mergedWindow: 4 }));
  assert.equal(m.merged.count, 4);
  assert.equal(m.merged.medianHours, 17);
  assert.equal(m.merged.p90Hours, 48);
});

test("no merged PRs gives null merge stats", () => {
  const m = computeMetrics(PRS.filter((p) => p.state === "OPEN"), opts());
  assert.deepEqual(m.merged, { count: 0, medianHours: null, p90Hours: null });
});

test("ok is false when a stale draft exists even below the open limit", () => {
  const m = computeMetrics(PRS, opts());
  assert.equal(m.ok, false);
  assert.deepEqual(m.violations, ["stale-drafts"]);
});

test("ok is true at exactly the open limit and false one above", () => {
  const fresh = PRS.filter((p) => p.number !== 12);
  assert.equal(computeMetrics(fresh, opts({ limit: 4 })).ok, true); // 4 open: #10, #11, #13, #15
  const over = computeMetrics(fresh, opts({ limit: 3 }));
  assert.equal(over.ok, false);
  assert.deepEqual(over.violations, ["open-over-limit"]);
});

test("the report text is German and names counts and stale drafts and the merge median", () => {
  const text = formatText(computeMetrics(PRS, opts()), 15);
  assert.match(text, /Offene PRs: 5 \(3 Draft, 2 bereit\), Limit 15/);
  assert.match(text, /Drafts älter als 48 h: #12/);
  assert.match(text, /Median Eröffnung→Merge: 10 h \(p90 48 h, 5 PRs; Ziel < 24 h: erreicht\)/);
});

test("main reads --input and prints text plus JSON and exits 1 on a violation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pr-metrics-"));
  try {
    const file = join(dir, "prs.json");
    writeFileSync(file, JSON.stringify(PRS));
    let out = "";
    const io = { out: (s) => (out += s), err: () => {} };
    assert.equal(await main(["--input", file, "--now", NOW], io), 1);
    assert.match(out, /Offene PRs: 5/);
    assert.equal(JSON.parse(out.slice(out.indexOf("{"))).open.total, 5);
    out = "";
    assert.equal(await main(["--input", file, "--now", NOW, "--limit", "9", "--json"], io), 1);
    assert.equal(JSON.parse(out).staleDrafts[0], 12);
    writeFileSync(file, JSON.stringify(PRS.filter((p) => p.number !== 12)));
    assert.equal(await main(["--input", file, "--now", NOW, "--json"], io), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("main without --input asks gh for all PRs with the fields it needs", async () => {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    return { code: 0, stdout: "[]", stderr: "" };
  };
  const io = { out: () => {}, err: () => {} };
  assert.equal(await main(["--now", NOW], io, { run }), 0);
  assert.deepEqual(calls, [
    ["gh", "pr", "list", "--state", "all", "--limit", "300", "--json", "number,isDraft,createdAt,mergedAt,closedAt,headRefName,state"],
  ]);
});

test("main reports a failing gh call as refused (exit 3)", async () => {
  const run = () => ({ code: 1, stdout: "", stderr: "boom" });
  assert.equal(await main([], { out: () => {}, err: () => {} }, { run }), 3);
});
