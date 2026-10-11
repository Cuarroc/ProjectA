import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assess, main } from "../review/accept-check.mjs";

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
test("size excludes lockfiles but rejects over 300 lines", () => {
  const data = pr(); data.additions = 1020;
  data.files.push({ path: "package-lock.json", additions: 1000, deletions: 0 });
  assert.equal(evaluate(data).exit, 0);
  data.additions += 276; data.files[0].additions += 276;
  assert.equal(evaluate(data).exit, 2);
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
  for (const path of ["src-tauri/src/api.rs", "src-tauri/src/main.rs", "src-tauri/src/store.rs", "src-tauri/src/bin/pa.rs", "scripts/pty.test.mjs", "migrations/001.sql", ".github/workflows/ci.yml"]) {
    const data = pr(); data.files[0].path = path;
    assert.equal(evaluate(data).exit, 2, path);
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
