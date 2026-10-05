// BENCH-01: weekly measurement from gh/git JSON; no network, no writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { measure, packageId, renderMarkdown, main } from "../dev/bench-weekly.mjs";

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
  const code = await main(["--input", new URL("./fixtures/bench-weekly.json", import.meta.url).pathname, "--from", "2026-10-02", "--to", "2026-10-05", "--json"], { out: (s) => (out += s), err: () => {} });
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).rows.length, m.rows.length);
});
