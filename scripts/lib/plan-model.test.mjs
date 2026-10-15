import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlan, normalizeStatus, dependencyGraph, checkPlan } from "./plan-model.mjs";
import { main } from "../plan-check.mjs";

const table = (rows) => `| ID | Ziel | Status | Dep |\n|---|---|---|---|\n${rows}`;
const parse = (md) => parsePlan(md, { file: "docs/PLAN.md" });
const kinds = (model, inputs = {}) => checkPlan(model, inputs).map((f) => f.kind);
test("parses COMP and VERBUND table shapes and decision inbox", () => {
  // COMP: docs/plan/v2.0/plan.md; VERBUND: docs/PLAN.md in pending PR #1557.
  const model = parse(`#### COMP
| ID | Ziel | Umfang | Voraussetzung | Stand |
|---|---|---|---|---|
| COMP-1-3 | Lampe im Fluss | ~100 | COMP-3-3, COMP-1-1 | gemergt #1500 |
#### VERBUND
| ID | Ziel | Abhängigkeit / Status |
|---|---|---|
| V-02 | Begrenzte lesende Denkraum-Projektion | Geplant nach V-01; Stufe A, kein Schreibpfad |
## Entscheidungs-Inbox
| # | Frage | Empfehlung | Status |
|---|---|---|---|
| V16-F4 | Review-Fahrer auf den Server? | ja | offen |`);
  assert.deepEqual(model.packages.map((p) => [p.id, p.status, p.deps, p.prs, p.line, p.section]), [["COMP-1-3", "done", ["COMP-3-3", "COMP-1-1"], [1500], 4, "COMP"], ["V-02", "planned", ["V-01"], [], 8, "VERBUND"]]);
  assert.deepEqual(model.decisions, [{ id: "V16-F4", status: "open", line: 12 }]);
  assert.deepEqual(parse("| # | Entscheidung | Stand |\n|---|---|---|\n| E1 | Schnitt | beantwortet |\n").decisions, [{ id: "E1", status: "answered", line: 3 }]);
});
test("normalizes status vocabulary without reading trailing historical claims", () => {
  for (const [raw, expected] of [["gemergt", "done"], ["Erledigt", "done"], ["PR #1 offen", "in_review"], ["In Prüfung", "in_review"], ["Draft", "in_review"], ["läuft", "in_progress"], ["in Arbeit", "in_progress"], ["dispatched", "in_progress"], ["Geplant", "planned"], ["wartet", "planned"], ["BLOCKIERT", "blocked"], ["Später", "parked"], ["geparkt", "parked"], ["entfällt", "dropped"], ["gestrichen", "dropped"], ["Dropped", "dropped"], ["unbekannt", "unknown"], ["Erledigt; früher Draft", "done"]]) assert.equal(normalizeStatus(raw), expected, raw);
});
test("preserves metadata and ignores fenced examples and historical duplicates", () => {
  const md = "| Paket | Goal | STATUS | Owner | Version | Richtung |\n|---|---|---|---|---|---|\n| A-1 | A \\| B | **Draft** #9 | team | 2.0 | Z1 |";
  const model = parse(`${md}\n## Historisch\n${md}\n\`\`\`md\n${md}\n\`\`\``);
  assert.equal(model.packages.length, 2);
  assert.deepEqual(model.problems, []);
  assert.deepEqual(model.packages[0], { id: "A-1", title: "A | B", status: "in_review", statusRaw: "**Draft** #9", owner: "team", version: "2.0", direction: "Z1", deps: [], prs: [9], file: "docs/PLAN.md", line: 3, section: "" });
  assert.deepEqual(parse(`${md}\n\n${md}`).problems.map((p) => p.kind), ["duplicate-id"]);
});
test("matches Rust identity and dependency fixture", () => {
  // development_plan.rs::projects_identity_source_and_relations_deterministically
  const model = parse("| ID | Paket / Agent / Scope | Nach | Konkretes Ergebnis und Abnahme | Eltern |\n|---|---|---|---|---|\n| A-1 | Parent | — | Prove it | |\n| A-2 | Child | A-1 | Test it | A-1 |");
  assert.deepEqual(model.packages.map((p) => [p.id, p.deps]), [["A-1", []], ["A-2", ["A-1"]]]);
});
test("reports unknown dependencies and only actual cycle members with levels", () => {
  const model = parse(table("| A-1 | A | planned | A-2 |\n| A-2 | B | planned | A-1 |\n| A-3 | C | planned | A-2, X-1 |\n| A-4 | D | planned | A-3 |"));
  assert.deepEqual(dependencyGraph(model.packages), { cycle: ["A-1", "A-2"], levels: [["A-3"], ["A-4"]] });
  assert.deepEqual(kinds(model).sort(), ["dependency-cycle", "dependency-cycle", "unknown-dependency"]);
});
test("dependency clauses exclude prose and keep known or explicit package IDs", () => {
  const model = parse(table("| DR-09 | A | done | |\n| DR-10 | B | done | DR-09/#638 gemergt; Verdrahtung in DR-11/#718 |\n| DR-11 | C | done | DR-10, FIT-Abnahme, UI-Verdrahtung, DR-05-Verknüpfung, DR-SEC-01g, CUSTOM-task |\n| CUSTOM-task | D | planned | |"));
  assert.deepEqual(model.packages.map((p) => p.deps), [[], ["DR-09"], ["DR-10", "DR-SEC-01g", "CUSTOM-task"], []]);
  assert.deepEqual(checkPlan(model).map((f) => [f.kind, f.detail]), [["unknown-dependency", "DR-SEC-01g"]]);
  assert.deepEqual(dependencyGraph(model.packages).cycle, []);
});
test("dependency validation rejects repeated numeric segments within 200 ms", (t) => {
  // The tokenizer keeps the final dot, so the unknown ID reaches validation intact.
  const input = table(`| ROW-1 | A | planned | A-${"00-".repeat(25)}. |`);
  const started = performance.now();
  const model = parse(input);
  const elapsed = performance.now() - started;
  t.diagnostic(`dependency validation: ${elapsed.toFixed(3)} ms`);
  assert.deepEqual(model.packages[0].deps, []);
  assert.ok(elapsed < 200, `dependency validation took ${elapsed.toFixed(3)} ms`);
  const accepted = ["PLAN-AUTO-1b", "KR-04a", "V2-S01d", "DN-11a", "AP-6", "A-00", "A-12b34"];
  // Letter-led segments with a lowercase suffix are accepted only as known IDs.
  assert.deepEqual(parse(table(`| ROW-1 | A | planned | ${accepted.join(", ")} |\n| V2-S01d | B | planned | |`)).packages[0].deps, accepted);
  for (const id of ["a-1", "A-", "A--1", "A-12bc", "A-12b34.", "V2-S01d"]) {
    assert.deepEqual(parse(table(`| ROW-1 | A | planned | ${id} |`)).packages[0].deps, [], id);
  }
});
test("status contradictions aggregate all referenced and named PRs", () => {
  const model = parse(table("| A-1 | A | in Arbeit #1, #2 | |"));
  const merged = { number: 1, state: "MERGED" }, open = { number: 2, state: "OPEN" };
  assert.deepEqual(kinds(model, { prs: [merged, open] }), []);
  assert.deepEqual(kinds(model, { prs: [merged] }), []); // Missing PR evidence is not closure.
  assert.ok(kinds(model, { prs: [merged, { ...open, state: "CLOSED" }] }).includes("status-contradicts-github"));
  assert.deepEqual(kinds(parse(table("| A-1 | A | in Arbeit #1 | |")), { prs: [merged, { ...open, body: "Plan-ID: A-1" }] }), []);
  assert.deepEqual(kinds(parse(table("| A-1 | A | Erledigt #1, #2 | |")), { prs: [merged, open] }), ["status-contradicts-github"]);
  assert.deepEqual(kinds(parse(table("| A-1 | A | Erledigt #1, #2 | |")), { prs: [merged, { ...open, state: "CLOSED" }] }), []);
});
test("mixed completed and pending subparts remain in progress", () => {
  for (const raw of ["10a ✓ #13, 10c offen", "✓ #13; offen", "offen; 10a erledigt", "10a done, 10c planned"]) assert.equal(normalizeStatus(raw), "in_progress", raw);
  assert.equal(normalizeStatus("Erledigt; früher Draft"), "done");
  // docs/PLAN.md, Statuswerte explicitly maps this phrase to In Prüfung.
  assert.equal(normalizeStatus("Angenommen, Mergify ausstehend"), "in_review");
});
test("finds unmapped PRs and GitHub status contradictions", () => {
  const model = parse(table("| A-1 | A | in Arbeit #1 | |\n| A-2 | B | Erledigt #2 | |\n| A-3 | C | Geplant #3 | |"));
  const prs = [{ number: 1, state: "MERGED" }, { number: 2, state: "OPEN", body: "Plan-ID: A-2", headRefName: "codex/mapped" }, { number: 3, state: "CLOSED" }, { number: 4, state: "OPEN", title: "A-11", headRefName: "codex/unmapped" }];
  assert.deepEqual(checkPlan(model, { prs }).map((f) => [f.kind, f.pr]), [["status-contradicts-github", 1], ["status-contradicts-github", 2], ["status-contradicts-github", 3], ["pr-without-plan-row", 4]]);
  assert.deepEqual(kinds(model, { prs: [{ state: "OPEN", title: "fix A-1", headRefName: "codex/a-1-fix" }] }), []);
  assert.deepEqual(kinds(model, { prs: [{ state: "OPEN", title: "fix", headRefName: "codex/prefix-a-1-fix" }] }), []);
  assert.deepEqual(kinds(parse(table("| A-4 | D | Geplant | A-1 #1 |\n| A-1 | A | Erledigt | |")), { prs: [{ number: 1, state: "MERGED" }] }), []);
});
test("finds running jobs without rows and respects completions and restarts", () => {
  const events = "JOB-START srv-a-1\nJOB-START fix-a-1-r1\nJOB-START review-a-1\nJOB-START srv-old-1\nFERTIG srv-old-1\nJOB-START srv-old-1";
  assert.deepEqual(checkPlan(parse(table("| A-1 | A | Geplant | |")), { events }).map((f) => [f.kind, f.id]), [["running-job-without-row", "old-1"]]);
});
test("finds recent unreferenced decisions and stale plans at thresholds", () => {
  const now = Date.parse("2026-10-15T12:00:00Z"), lastPlanCommit = "2026-10-14T23:00:00Z";
  const decisions = "## 2026-10-14 - New direction\n## 2026-09-01 - Old direction\n## 2026-10-16 - Future\n## 2026-10-14 — A-1 approved";
  const model = parse(table("| A-1 | A | Erledigt | |"));
  const prs = [1, 2, 3, 4, 5].map((number) => ({ number, state: "MERGED", mergedAt: "2026-10-15T01:00:00Z" }));
  assert.deepEqual(kinds(model, { decisions, now, lastPlanCommit, prs, planText: "A-1" }), ["decision-without-plan-row", "plan-stale"]);
  assert.deepEqual(kinds(model, { decisions, now, lastPlanCommit, prs: prs.slice(1), planText: "A-1 New direction" }), []);
});
test("CLI reports skipped checks and validates arguments without network", async () => {
  let output = ""; const io = { out: (s) => { output += s; }, err: () => {} };
  const deps = { read: () => "", run: () => ({ code: 0, stdout: "2026-10-15T12:00:00Z" }) };
  assert.equal(await main(["--offline", "--json"], io, deps), 0);
  assert.ok(JSON.parse(output).notChecked.some((s) => s.includes("GitHub")));
  assert.equal(await main(["--offline", "--strict"], io, deps), 1);
  assert.equal(await main(["--json", "--strict"], io, deps), 1);
  const online = { ...deps, run: (command) => ({ code: 0, stdout: command === "gh" ? "[]" : "2026-10-15T12:00:00Z" }) };
  assert.equal(await main(["--strict", "--events", "events.log"], io, online), 0);
  assert.equal(await main(["--invalid"], io), 2);
});
