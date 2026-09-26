// scripts/lib/hq-pages.test.mjs — Map DAG / Proof / Next / Sources contracts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HQ_JS = readFileSync(join("docs", "dev-hq", "hq.js"), "utf8");
const DATA = JSON.parse(readFileSync(join("docs", "dev-hq", "data.json"), "utf8"));

test("drawDag: fixed Rev 9 coordinates and caption", () => {
  assert.match(HQ_JS, /function drawDag\s*\(/);
  assert.match(HQ_JS, /F0:\s*\[\s*40\s*,\s*80\s*\]/);
  assert.match(HQ_JS, /F1:\s*\[\s*180\s*,\s*80\s*\]/);
  assert.match(HQ_JS, /F4:\s*\[\s*320\s*,\s*80\s*\]/);
  assert.match(HQ_JS, /F5:\s*\[\s*460\s*,\s*80\s*\]/);
  assert.match(HQ_JS, /F8:\s*\[\s*600\s*,\s*140\s*\]/);
  assert.match(HQ_JS, /F2:\s*\[\s*180\s*,\s*200\s*\]/);
  assert.match(HQ_JS, /F6-UI"?:\s*\[\s*320\s*,\s*200\s*\]/);
  assert.match(HQ_JS, /F3:\s*\[\s*320\s*,\s*140\s*\]/);
  assert.match(HQ_JS, /F6-Attribution"?:\s*\[\s*460\s*,\s*200\s*\]/);
  assert.match(HQ_JS, /F7:\s*\[\s*40\s*,\s*200\s*\]/);
  assert.match(HQ_JS, /Package DAG · Source: docs\/PLAN\.md/);
});

test("drawDag: lines before circles; F3 title cites dependsOn", () => {
  const fn = HQ_JS.slice(HQ_JS.indexOf("function drawDag"));
  const lineAt = fn.indexOf('createElementNS(NS, "line")');
  const circleAt = fn.indexOf('createElementNS(NS, "circle")');
  assert.ok(lineAt >= 0 && circleAt > lineAt, "draw lines before circles");
  assert.match(fn, /dependsOn/);
  assert.match(fn, /id · lane · source|\$\{p\.id\} · \$\{p\.lane\} · \$\{p\.source\}/);
});

test("renderMap mounts #dag; Now fills #mini-dag", () => {
  assert.match(HQ_JS, /function renderMap\s*\(/);
  assert.match(HQ_JS, /id="dag"/);
  assert.match(HQ_JS, /page === "map"/);
  assert.match(HQ_JS, /drawDag\([^,]+,\s*data\.packages/);
  assert.match(HQ_JS, /getElementById\("mini-dag"\)/);
  const pos = HQ_JS.indexOf("const DAG_POS");
  const dispatch = HQ_JS.lastIndexOf('page === "now"');
  assert.ok(pos >= 0 && dispatch > pos, "dispatch after DAG_POS to avoid TDZ");
});

test("live packages encode F3 → F1 and F2 (Rev 9)", () => {
  const f3 = DATA.packages.find((p) => p.id === "F3");
  assert.deepEqual(f3.dependsOn, ["F1", "F2"]);
  const f8 = DATA.packages.find((p) => p.id === "F8");
  assert.ok(f8.dependsOn.includes("F5"));
  assert.ok(f8.dependsOn.includes("F6-UI"));
  assert.ok(f8.dependsOn.includes("F3"));
  assert.ok(f8.dependsOn.includes("F6-Attribution"));
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

test("live packages: active only with an executable spec, F0 done per STAND", () => {
  // Bound to the contract, not to one STAND revision: a package is "active"
  // only while an executable spec names it; F0 is "done" once STAND says so.
  for (const p of DATA.packages) {
    if (p.current === "active") {
      assert.ok(DATA.specs.some((s) => s.packet.startsWith(p.id.replace(/-.*$/, ""))), `${p.id} active without spec`);
    }
  }
  const stand = readFileSync("STAND.md", "utf8");
  if (/F0 ist abgeschlossen/i.test(stand)) {
    assert.equal(DATA.packages.find((p) => p.id === "F0").current, "done");
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
  assert.deepEqual(ids, ["M1", "M2", "M3", "M4"]);
  for (const m of DATA.milestones) {
    assert.ok(m.title && m.packages.length > 0, `${m.id} has a title and packages`);
    assert.equal(m.total, m.packages.length);
    assert.equal(m.done, m.packages.filter((p) => p.state === "done").length);
    for (const p of m.packages) assert.ok(["done", "open", "in_progress", "pr"].includes(p.state), `${p.id}: ${p.state}`);
  }
  assert.equal(DATA.packages, undefined, "the retired F0-F8 packages are not part of the snapshot");
});
