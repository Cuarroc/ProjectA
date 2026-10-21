import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assess, main, tierFor } from "../review/accept-check.mjs";

const directory = fileURLToPath(new URL("../review/fixtures/accept-check/", import.meta.url));
const fixture = (name) => readFileSync(`${directory}/${name}`, "utf8");
const name = "review_pr42-01234567_glm-5.2.md";
const pr = () => JSON.parse(fixture("pr.json"));
const review = () => ({ name, text: fixture(name) });
const evaluate = (data = pr(), reviews = [review()]) => assess(data, reviews, "42");

test("clean tier b pr with approve review at head exits 0", () => {
  const result = evaluate();
  assert.equal(result.exit, 0);
  assert.match(result.output, /### Review \(accept-check, bound to head `01234567`\)/);
  assert.match(result.output, /glm-5.2/);
  assert.match(result.output, /Tier: B/);
  assert.match(result.output, /25/);
});
test("one Root size budget label admits a 301 line tier b package", () => {
  const data = pr();
  data.additions = 301; data.deletions = 0;
  data.files = [{ path: "src/example.ts", additions: 301, deletions: 0 }];
  data.labels = [{ name: "size-budget-450" }];
  assert.equal(evaluate(data).exit, 0);
});
test("review bound to an older head escalates", () => {
  const result = evaluate(pr(), [{ ...review(), name: name.replace("01234567", "abcdefab") }]);
  assert.equal(result.exit, 2);
  assert.match(result.output, /Review veraltet/);
});
test("seam file needs two review families", () => {
  const data = pr(); data.files[0].path = "src-tauri/src/store/tasks.rs";
  assert.equal(evaluate(data).exit, 2);
  assert.equal(evaluate(data, [review(), { name: name.replace("glm-5.2", "glm-5.1"), text: review().text.replaceAll("glm-5.2", "glm-5.1") }]).exit, 2);
  assert.equal(evaluate(data, [review(), { name: name.replace("glm-5.2", "kimi-k3"), text: review().text.replaceAll("glm-5.2", "kimi-k3") }]).exit, 0);
});
for (const [title, before, after] of [
  ["correctness finding escalates", "none", "F1 medium src/example.ts:1: wrong result"],
  ["conditional verdict escalates", "Verdict: approve", "Verdict: approve with conditions"],
  ["request changes escalates", "Verdict: approve", "Verdict: request changes"],
  ["failed transport escalates", "Status: ok", "Status: failed"],
  ["missing correctness escalates", "### Correctness / spec", "### Other"],
  ["duplicate verdict escalates", "Verdict: approve", "Verdict: reject\nVerdict: approve"],
]) test(title, () => assert.equal(evaluate(pr(), [{ ...review(), text: review().text.replace(before, after) }]).exit, 2));
test("approval word takes priority over escalation", () => {
  const data = pr(); data.body += "\nRelease"; data.labels = [{ name: "conflict" }];
  assert.equal(evaluate(data).exit, 3);
});
test("mixed lockfiles count toward the raw package size", () => {
  const data = pr(); data.additions = 1020;
  data.files.push({ path: "package-lock.json", additions: 1000, deletions: 0 });
  assert.equal(evaluate(data).exit, 2);
  assert.match(evaluate(data).output, /1025 > 300/);
  data.additions += 276; data.files[0].additions += 276;
  assert.equal(evaluate(data).exit, 2);
});

test("size and fix labels obey literal ceilings and the actual risk tier", () => {
  const pair = [review(), { name: name.replace("glm-5.2", "kimi-k3"), text: review().text.replaceAll("glm-5.2", "kimi-k3") }];
  for (const [path, size, labels, exit] of [
    ["src/example.ts", 300, [], 0], ["src/example.ts", 301, [], 2],
    ["src/example.ts", 450, ["size-budget-450"], 0],
    ["docs/a.md", 600, ["size-budget-600"], 0], ["docs/a.md", 601, ["size-budget-600"], 2],
    ["src/example.ts", 600, ["size-budget-600", "size-fix-round"], 0],
    ["src/example.ts", 601, ["size-budget-600", "size-fix-round"], 2],
    ["src/example.ts", 550, ["size-budget-450", "size-fix-round"], 0],
    ["src/example.ts", 551, ["size-budget-450", "size-fix-round"], 2],
    ["src/example.ts", 400, ["size-fix-round"], 0],
    ["src-tauri/src/api.rs", 300, ["size-budget-600"], 0],
    ["src-tauri/src/api.rs", 301, ["size-budget-600"], 2],
    ["src-tauri/src/api.rs", 400, ["size-fix-round"], 0],
    ["src-tauri/src/api.rs", 401, ["size-budget-600", "size-fix-round"], 2],
  ]) {
    const data = pr(); data.additions = size; data.deletions = 0;
    data.files = [{ path, additions: size, deletions: 0 }]; data.labels = labels.map(name => ({ name }));
    data.body += "\nTIER: B\nOPERATOR: NACHBESSERN\nSIZE-BUDGET: 600 (Root msg-author-assertion)\n";
    assert.equal(evaluate(data, pair).exit, exit, JSON.stringify([path, size, labels]));
  }
});
test("ambiguous labels and author text cannot enlarge a budget or fix round", () => {
  for (const labels of [[], ["size-budget-700"], ["size-budget-600.0"], ["SIZE-BUDGET-600"],
    ["size-budget-600", "size-budget-450"], ["size-budget-600", "size-budget-bad"], ["size-budget-600", "size-budget-600"]]) {
    const data = pr(); data.additions = 450; data.deletions = 0;
    data.files = [{ path: "src/a.ts", additions: 450, deletions: 0 }]; data.labels = labels.map(name => ({ name }));
    data.body += "\nSIZE-BUDGET: 600 (Root msg-author-assertion)\nOPERATOR: NACHBESSERN\n";
    assert.equal(evaluate(data).exit, 2, JSON.stringify(labels));
  }
  for (const markers of [[], ["review-fix"], ["SIZE-FIX-ROUND"], ["size-fix-round", "size-fix-round"], ["size-fix-round", "size-fix-unknown"]]) {
    const data = pr(); data.additions = 550; data.deletions = 0;
    data.files = [{ path: "src/a.ts", additions: 550, deletions: 0 }];
    data.labels = ["size-budget-450", ...markers].map(name => ({ name }));
    data.body += "\nOPERATOR: NACHBESSERN\n";
    assert.equal(evaluate(data).exit, 2, JSON.stringify(markers));
  }
});
test("unverified lock move and generated claims never reduce raw accounting", () => {
  for (const path of ["package-lock.json", "Cargo.lock", "generated/output.json", "docs/moved.md"]) {
    const data = pr(); data.additions = 301; data.deletions = 0;
    data.files = [{ path, additions: 301, deletions: 0, status: "renamed", generated: true }];
    data.labels = [{ name: "dependabot" }]; data.body += "\nPure move; generated output excluded.\n";
    assert.equal(evaluate(data).exit, 2, path);
  }
  assert.match(evaluate().output, /raw diff: 25/);
});
test("tierFor stays available from the accept-check public export", () => {
  assert.equal(tierFor(["src-tauri/src/api.rs"]), "A");
  assert.equal(tierFor(["docs/a.md"]), "C");
  assert.equal(tierFor(["src/a.ts"]), "B");
});
test("normalised risk paths cannot widen assessed size", () => {
  const pair = [review(), { name: name.replace("glm-5.2", "kimi-k3"), text: review().text.replaceAll("glm-5.2", "kimi-k3") }];
  for (const path of ["./.github/workflows/ci.yml", "src-tauri//src/api.rs", "src-tauri/src/store/", "schema.sql"]) {
    const data = pr(); data.additions = 450; data.deletions = 0;
    data.files = [{ path, additions: 450, deletions: 0 }]; data.labels = [{ name: "size-budget-600" }];
    assert.equal(evaluate(data, pair).exit, 2, path);
  }
});
test("spelling variants conflict with every budget or fix signal", () => {
  for (const labels of [["size-budget-600", "size_fix-round"], ["size-budget-600", "size_budget-450"],
    ["size-budget-600", "prefix size budget-450"], ["size-budget-600", "sizebudget-600"],
    ["size-fix-round", "size_budget-600"], ["size-fix-round", "size-budget-700"],
    ["size-fix-round", "size-budget-600\n"]]) {
    const data = pr(); data.additions = 350; data.deletions = 0;
    data.files = [{ path: "src/a.ts", additions: 350, deletions: 0 }]; data.labels = labels.map(name => ({ name }));
    assert.equal(evaluate(data).exit, 2, JSON.stringify(labels));
    assert.match(evaluate(data).output, /ceiling: 300/);
  }
});
test("cli rejects duplicate raw labels keys before JSON can erase a conflict", async () => {
  const data = pr(); data.additions = 450; data.deletions = 0;
  data.files = [{ path: "src/a.ts", additions: 450, deletions: 0 }]; data.labels = [{ name: "size-budget-600" }];
  const raw = JSON.stringify(data);
  for (const key of ['"labels"', '"\\u006cabels"']) {
    const duplicate = `{${key}:[],${raw.slice(1)}`;
    let output = "";
    assert.equal(await main(["42", "--reviews", directory], { out: s => output += s },
      { run: () => ({ code: 0, stdout: duplicate }) }), 2, key);
    assert.match(output, /labels/);
  }
  data.body += '\n```json\n{"labels":[],"nested":{"labels":[]}}\n```\n';
  assert.equal(await main(["42", "--reviews", directory], { out() {} },
    { run: () => ({ code: 0, stdout: JSON.stringify(data) }) }), 0);
});
test("pure docs and tests require no reviews", () => {
  for (const path of ["docs/guide.md", "scripts/lib/example.test.mjs"]) {
    const data = pr(); data.files[0].path = path;
    assert.equal(evaluate(data, []).exit, 0);
  }
});
test("all unsafe metadata reasons are reported", () => {
  const data = pr(); data.isDraft = true; data.body = "Test-First: wrong";
  data.labels = [{ name: "conflict" }, { name: "do-not-merge" }];
  data.statusCheckRollup = ["FAILURE", "CANCELLED", "TIMED_OUT"].map(conclusion => ({ conclusion }));
  const result = evaluate(data, []);
  assert.equal(result.exit, 2);
  for (const reason of ["Draft", "Report", "NICHT ABGEDECKT", "Trailer", "conflict", "do-not-merge", "FAILURE", "CANCELLED", "TIMED_OUT"]) assert.ok(result.output.includes(reason), reason);
});
test("missing reviews and malformed evidence fail closed", () => {
  assert.equal(evaluate(pr(), []).exit, 2);
  for (const key of Object.keys(pr())) {
    const data = pr(); delete data[key];
    assert.equal(evaluate(data).exit, 2, key);
  }
});
test("cli reads github only through injected argument runner", async () => {
  let output = "";
  const run = (cmd, args) => {
    assert.equal(cmd, "gh");
    assert.deepEqual(args, ["pr", "view", "42", "--json", "headRefOid,isDraft,additions,deletions,files,body,statusCheckRollup,labels"]);
    return { code: 0, stdout: JSON.stringify(pr()) };
  };
  assert.equal(await main(["42", "--reviews", directory], { out: text => output += text }, { run }), 0);
  assert.match(output, /AUTO-OK/);
  assert.equal(await main(["42", "--reviews", directory], { out() {} }, { run: () => ({ code: 1 }) }), 2);
});
test("review formatting and family evidence stay conservative", () => {
  for (const verdict of ["approve", "## Verdict\n\napprove"]) {
    assert.equal(evaluate(pr(), [{ ...review(), text: review().text.replace("Verdict: approve", verdict) }]).exit, 0);
  }
  for (const text of ["```\n" + review().text + "```", review().text.replace("Reviewer: glm-5.2", "Reviewer: kimi-k3")]) {
    assert.equal(evaluate(pr(), [{ ...review(), text }]).exit, 2);
  }
});
test("all risk paths need two families even when named as tests", () => {
  for (const path of ["src-tauri/src/api.rs", "src-tauri/src/main.rs", "src-tauri/src/store.rs", "src-tauri/src/bin/pa.rs", "scripts/pty.test.mjs", "migrations/001.sql", ".github/workflows/ci.yml",
    "src/pty/reader.rs", "src/pty_bridge.rs", "src/pty-host.ts", "src/PTY.rs", "src/migrations/runner.rs", "src/migration.rs", "src/migration-plan.ts", "schema/change.sql"]) {
    const data = pr(); data.files[0].path = path;
    assert.equal(evaluate(data).exit, 2, path);
  }
});
test("benign paths containing pty or migration stay tier b", () => {
  for (const path of ["src/copy.ts", "src/empty.ts", "src/safety.rs", "src/empty/view.ts", "src/ptycho.ts", "src/immigration.ts", "src/transmigration/view.ts", "src/migrationStats.ts"]) {
    const data = pr(); data.files[0].path = path;
    const result = evaluate(data);
    assert.equal(result.exit, 0, path);
    assert.match(result.output, /Tier: B/, path);
  }
});
test("pending checks and inconsistent size evidence escalate", () => {
  const data = pr(); data.statusCheckRollup = [{ state: "PENDING" }];
  assert.equal(evaluate(data).exit, 2);
  data.statusCheckRollup = [{ state: "SUCCESS" }];
  assert.equal(evaluate(data).exit, 0);
  data.files[0].additions = 0;
  assert.equal(evaluate(data).exit, 2);
});
