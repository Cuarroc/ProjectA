// SETUP-08a: push-verified against a bare remote in tmp; the push result is
// judged by ls-remote, never by the exit code of `git push`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRunner, UsageError } from "./dev-tools.mjs";
import { pushVerified, main } from "../dev/push-verified.mjs";

const real = makeRunner();

function setup(t) {
  const base = mkdtempSync(join(tmpdir(), "dev-push-verified-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const remote = join(base, "remote.git");
  const dir = join(base, "work");
  const sh = (cwd, ...args) => {
    const r = real("git", ["-C", cwd, ...args]);
    assert.equal(r.code, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  sh(base, "init", "-q", "--bare", remote);
  sh(base, "init", "-q", "-b", "main", dir);
  sh(dir, "config", "user.name", "test");
  sh(dir, "config", "user.email", "test@example.invalid");
  sh(dir, "remote", "add", "origin", remote);
  writeFileSync(join(dir, "a.txt"), "a\n");
  sh(dir, "add", "a.txt");
  sh(dir, "commit", "-qm", "a");
  sh(dir, "checkout", "-qb", "feature");
  return { dir, remote, git: (...a) => sh(dir, ...a) };
}

const noSleep = async () => {};

test("push-verified pushes and confirms the remote SHA", async (t) => {
  const f = setup(t);
  const res = await pushVerified({ run: real, cwd: f.dir, sleep: noSleep });
  assert.equal(res.ok, true);
  assert.equal(res.attempts, 1);
  assert.equal(res.remoteSha, f.git("rev-parse", "HEAD"));
});

test("push-verified trusts ls-remote over a failing push exit code", async (t) => {
  const f = setup(t);
  const run = (cmd, args, opts) => {
    const r = real(cmd, args, opts);
    return args.includes("push") ? { ...r, code: 1, stderr: "error: spurious" } : r;
  };
  const res = await pushVerified({ run, cwd: f.dir, sleep: noSleep });
  assert.equal(res.ok, true);
});

test("push-verified retries a bounded number of times when the remote does not move", async (t) => {
  const f = setup(t);
  let pushes = 0;
  const run = (cmd, args, opts) => {
    if (args.includes("push")) {
      pushes++;
      return { code: 0, stdout: "", stderr: "" };
    }
    return real(cmd, args, opts);
  };
  const res = await pushVerified({ run, cwd: f.dir, retries: 3, sleep: noSleep });
  assert.equal(res.ok, false);
  assert.equal(pushes, 3);
});

test("push-verified stops at once on a rejected push", async (t) => {
  const f = setup(t);
  let pushes = 0;
  const run = (cmd, args, opts) => {
    if (args.includes("push")) {
      pushes++;
      return { code: 1, stdout: "", stderr: " ! [rejected]        HEAD -> feature (non-fast-forward)\n" };
    }
    return real(cmd, args, opts);
  };
  const res = await pushVerified({ run, cwd: f.dir, retries: 3, sleep: noSleep });
  assert.equal(res.ok, false);
  assert.equal(pushes, 1);
  assert.match(res.reason, /rejected/);
});

test("push-verified never passes --no-verify or --force", async (t) => {
  const f = setup(t);
  const seen = [];
  const run = (cmd, args, opts) => {
    if (args.includes("push")) seen.push(args);
    return real(cmd, args, opts);
  };
  await pushVerified({ run, cwd: f.dir, sleep: noSleep });
  for (const args of seen) {
    assert.ok(!args.includes("--no-verify"));
    assert.ok(!args.some((a) => a.startsWith("--force") || a === "-f"));
  }
});

test("push-verified CLI exits 1 when the push is not on the remote", async (t) => {
  const f = setup(t);
  const run = (cmd, args, opts) => (args.includes("push") ? { code: 0, stdout: "", stderr: "" } : real(cmd, args, opts));
  const out = [];
  const code = await main(["--worktree", f.dir, "--retries", "1"], { out: (s) => out.push(s), err: (s) => out.push(s) }, { run, sleep: noSleep });
  assert.equal(code, 1);
});

test("push-verified --help exits 0", async () => {
  const out = [];
  const code = await main(["--help"], { out: (s) => out.push(s), err: (s) => out.push(s) });
  assert.equal(code, 0);
  assert.match(out.join(""), /push-verified/);
});

test("push-verified demands --branch on a detached HEAD instead of crashing (G2)", async (t) => {
  const f = setup(t);
  f.git("checkout", "-q", "--detach");
  assert.throws(() => pushVerified({ run: real, cwd: f.dir, sleep: noSleep }), UsageError);
});

test("push-verified rejects an invalid branch name before any push (check-ref-format)", async (t) => {
  const f = setup(t);
  const pushes = [];
  const run = (cmd, args, opts) => {
    if (cmd === "git" && args.includes("push")) pushes.push(args);
    return real(cmd, args, opts);
  };
  assert.throws(() => pushVerified({ run, cwd: f.dir, branch: "..evil", sleep: noSleep }), UsageError);
  assert.throws(() => pushVerified({ run, cwd: f.dir, branch: "feature.lock", sleep: noSleep }), UsageError);
  assert.equal(pushes.length, 0);
});

test("push-verified reports an ls-remote failure instead of proving anything", async (t) => {
  const f = setup(t);
  const run = (cmd, args, opts) => {
    if (args.includes("ls-remote")) return { code: 128, stdout: "", stderr: "fatal: could not read from remote repository" };
    return real(cmd, args, opts);
  };
  const res = await pushVerified({ run, cwd: f.dir, retries: 2, sleep: noSleep });
  assert.equal(res.ok, false);
  assert.match(res.reason, /ls-remote/);
});
