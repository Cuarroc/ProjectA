// scripts/lib/active-specs.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { listedInStand, readSpecStatuses, reconcile } from "./active-specs.mjs";

const STAND = `
## 3. Next
### Aktive Specs
| Spec | Paket | Lane |
|---|---|---|
| \`.pa/task_a.md\` | F1 | parallel |
| \`.pa/task_b.md\` | F1 | **seriell (\`main.rs\`), geht zuerst** |
`;

test("listedInStand reads concrete task files only", () => {
  const { names, error } = listedInStand(STAND);
  assert.equal(error, null);
  assert.deepEqual(names, ["task_a.md", "task_b.md"]);
});

test("listedInStand errors when section is missing", () => {
  const { error } = listedInStand("# Nope\n");
  assert.match(error, /Aktive Specs/);
});

test("happy: four aktiv + listed → four executable", () => {
  const files = ["a", "b", "c", "d"].map((id) => ({
    name: `task_${id}.md`,
    head: "Status: aktiv\n",
  }));
  const stand = `### Aktive Specs\n${files.map((f) => `| \`.pa/${f.name}\` | P | parallel |`).join("\n")}\n`;
  const { status, errors } = readSpecStatuses(files);
  assert.equal(errors.length, 0);
  const r = reconcile(status, listedInStand(stand).names);
  assert.equal(r.executable.length, 4);
  assert.equal(r.warnings.length, 0);
});

test("edge: aktiv but not listed → omitted + warning", () => {
  const { status } = readSpecStatuses([{ name: "task_ghost.md", head: "Status: aktiv\n" }]);
  const r = reconcile(status, []);
  assert.deepEqual(r.executable, []);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /task_ghost/);
});

test("entwurf is a valid status but never executable", () => {
  // F4-Rest r24: a draft spec (in Arbeit am Text, noch kein Auftrag) must not
  // trip the gate and must not become executable.
  const files = [{ name: "task_draft.md", head: "Status: entwurf\n" }];
  const { status, errors } = readSpecStatuses(files);
  assert.equal(errors.length, 0);
  const r = reconcile(status, []);
  assert.deepEqual(r.executable, []);
  assert.equal(r.warnings.length, 0);
});

test("entwurf LISTED in STAND.md breaks the gate (a draft is no assignment)", () => {
  // r25 (Opus F5): the interesting case — a draft sitting in the active
  // table must produce a named error, not a silent pass.
  const files = [{ name: "task_draft.md", head: "Status: entwurf\n" }];
  const { status } = readSpecStatuses(files);
  const r = reconcile(status, ["task_draft.md"]);
  assert.deepEqual(r.executable, []);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /entwurf/);
});
