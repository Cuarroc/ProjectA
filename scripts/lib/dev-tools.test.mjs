// SETUP-08a (Review): shared plumbing — cleanEnv and makeRunner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanEnv, makeRunner } from "./dev-tools.mjs";

test("cleanEnv strips git redirects and keeps the helpers non-interactive (M5)", () => {
  const env = cleanEnv({
    GIT_DIR: "x",
    GIT_WORK_TREE: "y",
    GIT_INDEX_FILE: "z",
    GIT_OBJECT_DIRECTORY: "o",
    KEEP: "1",
    GIT_TERMINAL_PROMPT: "1",
  });
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.GIT_WORK_TREE, undefined);
  assert.equal(env.GIT_INDEX_FILE, undefined);
  assert.equal(env.GIT_OBJECT_DIRECTORY, undefined);
  assert.equal(env.KEEP, "1");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(env.GCM_INTERACTIVE, "never");
});

test("makeRunner reports a timeout as exit code 124 instead of hanging forever (M5)", () => {
  const run = makeRunner({ timeoutMs: 150 });
  const r = run(process.execPath, ["-e", "setTimeout(() => {}, 5000)"]);
  assert.equal(r.code, 124);
  assert.match(r.stderr, /Zeitlimit/);
});

test("makeRunner honors a per-call timeout over the default", () => {
  const run = makeRunner();
  const ok = run(process.execPath, ["-e", "console.log('x')"]);
  assert.equal(ok.code, 0);
  const slow = run(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], { timeoutMs: 150 });
  assert.equal(slow.code, 124);
  assert.match(slow.stderr, /Zeitlimit/);
});

test("makeRunner keeps 127 for a missing program", () => {
  const run = makeRunner();
  const r = run("definitely-missing-cmd-projecta", ["--foo"]);
  assert.equal(r.code, 127);
  assert.match(r.stderr, /nicht gefunden/);
});
