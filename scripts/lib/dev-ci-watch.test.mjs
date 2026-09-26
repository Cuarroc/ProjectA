// SETUP-08a: ci-watch follows the required checks of a PR through a fake gh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { watchChecks, main } from "../dev/ci-watch.mjs";

// gh prints the checks as JSON and exits 8 while any is pending, 1 on failure.
function fakeGh(rounds) {
  let i = 0;
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    const checks = rounds[Math.min(i++, rounds.length - 1)];
    if (checks instanceof Error) return { code: 1, stdout: "", stderr: checks.message };
    const pending = checks.some((c) => c.bucket === "pending");
    const failed = checks.some((c) => c.bucket === "fail");
    return { code: pending ? 8 : failed ? 1 : 0, stdout: JSON.stringify(checks), stderr: "" };
  };
  return { run, calls };
}
const c = (name, bucket) => ({ name, bucket, state: bucket.toUpperCase(), link: `https://example.invalid/${name}` });
const clock = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
};

test("ci-watch polls until every required check is done and exits 0 when green", async () => {
  const gh = fakeGh([
    [c("gates (linux)", "pending"), c("red-first", "pending")],
    [c("gates (linux)", "pass"), c("red-first", "pending")],
    [c("gates (linux)", "pass"), c("red-first", "pass")],
  ]);
  const k = clock();
  const res = await watchChecks({ run: gh.run, pr: "42", intervalMs: 1000, timeoutMs: 60_000, ...k });
  assert.equal(res.code, 0);
  assert.equal(gh.calls.length, 3);
  assert.ok(gh.calls.every((a) => a.includes("--required") && a.includes("--json")));
});

test("ci-watch exits 1 when a required check fails", async () => {
  const gh = fakeGh([[c("gates (linux)", "fail"), c("red-first", "pass")]]);
  const res = await watchChecks({ run: gh.run, pr: "42", intervalMs: 1000, timeoutMs: 60_000, ...clock() });
  assert.equal(res.code, 1);
  assert.match(res.summary, /gates \(linux\)/);
});

test("ci-watch treats cancel as failure and skipping as done", async () => {
  const gh = fakeGh([[c("gates (windows)", "skipping"), c("red-first", "cancel")]]);
  const res = await watchChecks({ run: gh.run, pr: "42", intervalMs: 1000, timeoutMs: 60_000, ...clock() });
  assert.equal(res.code, 1);
  const green = fakeGh([[c("gates (windows)", "skipping"), c("red-first", "pass")]]);
  assert.equal((await watchChecks({ run: green.run, pr: "42", intervalMs: 1000, timeoutMs: 60_000, ...clock() })).code, 0);
});

test("ci-watch --fail-fast stops on the first failure while others still run", async () => {
  const gh = fakeGh([[c("gates (linux)", "fail"), c("gates (windows)", "pending")]]);
  const res = await watchChecks({ run: gh.run, pr: "42", intervalMs: 1000, timeoutMs: 60_000, failFast: true, ...clock() });
  assert.equal(res.code, 1);
  assert.equal(gh.calls.length, 1);
});

test("ci-watch exits 4 after the bounded run time", async () => {
  const gh = fakeGh([[c("gates (linux)", "pending")]]);
  const res = await watchChecks({ run: gh.run, pr: "42", intervalMs: 10_000, timeoutMs: 30_000, ...clock() });
  assert.equal(res.code, 4);
  assert.ok(gh.calls.length <= 5);
});

test("ci-watch exits 3 when the PR never gets required checks", async () => {
  const gh = fakeGh([[]]);
  const res = await watchChecks({ run: gh.run, pr: "42", intervalMs: 1000, timeoutMs: 600_000, graceMs: 2000, ...clock() });
  assert.equal(res.code, 3);
  assert.equal(gh.calls.length, 3);
});

test("ci-watch waits for GitHub to register checks: the empty grace is time-based, not poll-based (N4)", async () => {
  const gh = fakeGh([[]]);
  const res = await watchChecks({ run: gh.run, pr: "42", intervalMs: 5000, timeoutMs: 600_000, graceMs: 180_000, ...clock() });
  assert.equal(res.code, 3);
  assert.equal(gh.calls.length, 37); // 180 s Karenz / 5 s Intervall + 1, nicht 3 Polls
  assert.match(res.summary, /180 s/);
});

test("ci-watch exits 3 when gh prints broken JSON", async () => {
  const run = () => ({ code: 0, stdout: "[broken", stderr: "" });
  const res = await watchChecks({ run, pr: "42", intervalMs: 1000, timeoutMs: 60_000, ...clock() });
  assert.equal(res.code, 3);
  assert.match(res.summary, /JSON/);
});

test("ci-watch exits 3 when gh itself fails", async () => {
  const gh = fakeGh([new Error("could not find pull request")]);
  const res = await watchChecks({ run: gh.run, pr: "999", intervalMs: 1000, timeoutMs: 60_000, ...clock() });
  assert.equal(res.code, 3);
});

test("ci-watch CLI validates its arguments", async () => {
  const out = [];
  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
  assert.equal(await main([], io), 2);
  assert.equal(await main(["abc"], io), 2);
  assert.equal(await main(["--help"], io), 0);
  assert.match(out.join(""), /ci-watch/);
});
