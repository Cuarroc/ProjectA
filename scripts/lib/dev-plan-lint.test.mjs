// FLOW-03: plan-lint finds broken package tables and passes the real plan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lint, main } from "../dev/plan-lint.mjs";

const FIXTURE = new URL("./fixtures/plan-lint-broken.md", import.meta.url).pathname;
const REAL_PLAN = new URL("../../docs/plan/v1.6.0/plan.md", import.meta.url).pathname;
const HEAD = "| ID | Ziel | Lane | Naht | Stufe | Größe | Hängt ab von | Anbieter | Abnahme |\n|---|---|---|---|---|---|---|---|---|\n";
const run = async (...argv) => {
  let out = "";
  const code = await main(argv, { out: (s) => (out += s), err: (s) => (out += s) });
  return { code, out };
};

test("lint reports size and tier and lane and acceptance and dependency and seam findings", () => {
  const { findings } = lint(readFileFixture());
  const has = (id, word) => findings.some((f) => f.includes(`(${id})`) && f.includes(word));
  assert.ok(has("SIZE-01", "Größe"), findings.join("\n"));
  assert.ok(has("TIER-01", "Stufe"));
  assert.ok(has("LANE-01", "Lane"));
  assert.ok(has("ACC-01", "Abnahme"));
  assert.ok(has("DEP-01", "NOPE-99"));
  assert.ok(has("SEAM-02", "api.rs"));
  assert.equal(findings.some((f) => f.includes("(OK-01)")), false);
  assert.equal(findings.length, 6);
});

test("lint accepts a seam chain by dependency by arrow and transitively", () => {
  const byDep = HEAD + "| A-1 | x | api | api.rs | A | S | – | x | ok |\n| A-2 | x | api | api.rs | A | S | A-1 | x | ok |\n| A-3 | x | api | api.rs | A | M | A-2 | x | ok |\n";
  assert.deepEqual(lint(byDep).findings, []);
  const byArrow = HEAD + "| B-1 → B-2 | x | st | store | A | 2× S | – | x | ok |\n| B-3 | x | st | store | A | S | B-2 | x | ok |\n";
  assert.deepEqual(lint(byArrow).findings, []);
  const transitive = HEAD + "| C-1 | x | pa | pa.rs | A | S | – | x | ok |\n| C-2 | x | ci | – | B | S | C-1 | x | ok |\n| C-3 | x | pa | pa.rs | A | S | C-2 | x | ok |\n";
  assert.deepEqual(lint(transitive).findings, []);
});

test("lint terminates on a dependency cycle", () => {
  const cyc = HEAD + "| D-1 | x | api | api.rs | A | S | D-2 | x | ok |\n| D-2 | x | api | api.rs | A | S | D-1 | x | ok |\n";
  const { findings } = lint(cyc);
  assert.equal(findings.length, 1, findings.join("\n"));
  assert.match(findings[0], /Zyklus.*D-1.*D-2/);
});

test("lint reports a dependency 3-cycle", () => {
  const cyc = HEAD + "| E-1 | x | ci | – | B | S | E-3 | x | ok |\n| E-2 | x | ci | – | B | S | E-1 | x | ok |\n| E-3 | x | ci | – | B | S | E-2 | x | ok |\n";
  const { findings } = lint(cyc);
  assert.equal(findings.length, 1, findings.join("\n"));
  assert.match(findings[0], /Zyklus/);
});

test("lint reports a self-dependency", () => {
  const self = HEAD + "| F-1 | x | ci | – | B | S | F-1 | x | ok |\n";
  const { findings } = lint(self);
  assert.equal(findings.length, 1, findings.join("\n"));
  assert.match(findings[0], /Zyklus.*F-1/);
});

test("lint reports duplicate package ids", () => {
  const dup = HEAD + "| G-1 | x | ci | – | B | S | – | x | ok |\n| G-1 | x | ci | – | B | S | – | x | ok |\n";
  const { findings } = lint(dup);
  assert.equal(findings.length, 1, findings.join("\n"));
  assert.match(findings[0], /doppelt/);
});

test("lint reports a text without any package table", () => {
  assert.deepEqual(lint("# nothing\n").findings, ["keine Paket-Tabelle gefunden"]);
});

test("main exits 1 on the broken fixture and prints each finding", async () => {
  const r = await run(FIXTURE);
  assert.equal(r.code, 1);
  assert.match(r.out, /BEFUND .*SEAM-02/);
});

test("main exits 0 on the real v1.6.0 plan", async () => {
  const r = await run(REAL_PLAN);
  assert.equal(r.out.includes("BEFUND"), false, r.out);
  assert.equal(r.code, 0);
});

test("main exits 2 for a missing file", async () => {
  assert.equal((await run("/nonexistent/plan.md")).code, 2);
});

import { readFileSync } from "node:fs";
function readFileFixture() {
  return readFileSync(FIXTURE, "utf8");
}
