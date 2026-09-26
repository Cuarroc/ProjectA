// scripts/lib/hq-pages.test.mjs — Map milestones / Proof / Next / Sources contracts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HQ_JS = readFileSync(join("docs", "dev-hq", "hq.js"), "utf8");
const DATA = JSON.parse(readFileSync(join("docs", "dev-hq", "data.json"), "utf8"));

test("Map renders the PLAN.md milestone tables; Now shows milestone progress", () => {
  assert.match(HQ_JS, /function renderMap\s*\(/);
  assert.match(HQ_JS, /page === "map"/);
  assert.match(HQ_JS, /milestones\.map\(milestoneTable\)/);
  assert.match(HQ_JS, /\$\{milestoneProgress\(data\)\}/);
  assert.doesNotMatch(HQ_JS, /drawDag|DAG_POS|mini-dag/, "the F0-F8 package DAG is gone");
  const pos = HQ_JS.indexOf("const MILESTONE_STATE");
  const dispatch = HQ_JS.lastIndexOf('page === "now"');
  assert.ok(pos >= 0 && dispatch > pos, "dispatch after MILESTONE_STATE to avoid TDZ");
});

test("Proof: matrix by packet, no pie, omit empty klass columns", () => {
  assert.match(HQ_JS, /function renderProof\s*\(/);
  assert.match(HQ_JS, /page === "proof"/);
  assert.match(HQ_JS, /id="finding-list"/);
  assert.doesNotMatch(HQ_JS, /<svg[^>]*class="[^"]*pie|pie-chart|donut/i);
  assert.ok(DATA.findings.length >= 1, "live snapshot should contain at least one finding");
  for (const f of DATA.findings) {
    if (f.klass === "FACT") assert.equal(f.source.startsWith(".pa/report_"), true);
    if (f.klass !== "UNPROVEN") assert.ok(f.source, `finding ${f.id} must cite a source`);
  }
  const klasses = new Set(DATA.findings.map((f) => f.klass));
  if (!klasses.has("UNPROVEN")) {
    assert.match(HQ_JS, /empty columns omitted|omitEmpty|counts\[k\] > 0|col\.count > 0/);
  }
});

test("live Now grip is STAND prose, not UNPROVEN", () => {
  assert.ok(DATA.nextGrip.length >= 1, "nextGrip must copy STAND §3 prose");
  // Bound to the source, not to one phrasing: the grip changes with every
  // STAND revision, the contract (verbatim STAND §3 prose) does not.
  const stand = readFileSync("STAND.md", "utf8").replace(/\s+/g, " ");
  const grip = DATA.nextGrip[0].text.replace(/\s+/g, " ").trim();
  assert.ok(grip.length > 20, "grip is a sentence, not a stub");
  assert.ok(stand.includes(grip), "nextGrip text must occur verbatim in STAND.md");
  assert.doesNotMatch(DATA.nextGrip[0].text, /^UNPROVEN$/);
  assert.equal(DATA.nextGrip[0].source, "STAND.md#Nächster Griff");
});

test("live specs: every executable spec is listed in STAND and cites its file", () => {
  assert.ok(DATA.specs.length >= 1, "at least one executable spec");
  const stand = readFileSync("STAND.md", "utf8");
  for (const s of DATA.specs) {
    assert.ok(stand.includes(s.file), `${s.file} must be listed under Aktive Specs`);
    assert.equal(s.source, "STAND.md#Aktive Specs");
  }
  assert.ok(DATA.sources.some((s) => s.path === "docs/PLAN.md"), "PLAN.md is a hashed source");
});

test("live serial lock: at most one startable holder per owner", () => {
  const byOwner = new Map();
  for (const s of DATA.specs) {
    if (!s.serialOwner) continue;
    byOwner.set(s.serialOwner, (byOwner.get(s.serialOwner) ?? 0) + (s.startable ? 1 : 0));
  }
  for (const [owner, n] of byOwner) assert.ok(n <= 1, `${owner}: ${n} startable holders`);
  assert.match(HQ_JS, /spec\.startable === false/);
});

test("Next: locked serial has waits/locked, never start", () => {
  assert.match(HQ_JS, /function renderNext\s*\(/);
  assert.match(HQ_JS, /page === "next"/);
  assert.match(HQ_JS, /startable === false|!n\.startable|!item\.startable/);
  assert.match(HQ_JS, /waits|locked/);
  const byOwner = new Map();
  for (const n of DATA.next) {
    if (!n.serialOwner) continue;
    const rows = byOwner.get(n.serialOwner) ?? [];
    rows.push(n);
    byOwner.set(n.serialOwner, rows);
  }
  for (const [owner, rows] of byOwner) {
    assert.ok(
      rows.filter((r) => r.startable).length <= 1,
      `at most one startable next[] row for ${owner}`,
    );
  }
  const from = HQ_JS.indexOf("function renderNext");
  const to = HQ_JS.indexOf("function renderSources", from);
  const nextFn = HQ_JS.slice(from, to === -1 ? undefined : to);
  const startWord = nextFn.match(/["']start["']/g) || [];
  assert.equal(startWord.length, 0, "Next must not show a start affordance");
});

test("Sources: table plus outbound STAND / Sanierungsplan / ui-variants", () => {
  assert.match(HQ_JS, /function renderSources\s*\(/);
  assert.match(HQ_JS, /page === "sources"/);
  assert.match(HQ_JS, /\.\.\/PLAN\.md/);
  assert.match(HQ_JS, /\.\.\/\.\.\/STAND\.md/);
  assert.match(HQ_JS, /\.\.\/ui-variants\/index\.html/);
});

test("live snapshot lists the PLAN.md milestones with consistent progress", () => {
  const ids = DATA.milestones.map((m) => m.id);
  assert.ok(ids.length > 0 && ids.every((id) => /^M\d+$/.test(id)), `milestone ids: ${ids}`);
  assert.equal(new Set(ids).size, ids.length, "milestone ids are unique");
  for (const m of DATA.milestones) {
    assert.ok(m.title && m.packages.length > 0, `${m.id} has a title and packages`);
    assert.equal(m.total, m.packages.length);
    assert.equal(m.done, m.packages.filter((p) => p.state === "done").length);
    for (const p of m.packages) assert.ok(["done", "open", "in_progress", "pr"].includes(p.state), `${p.id}: ${p.state}`);
  }
  assert.equal(DATA.packages, undefined, "the retired F0-F8 packages are not part of the snapshot");
});
