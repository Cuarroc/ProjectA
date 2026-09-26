// SETUP-08a: report-commit against throwaway git repositories in tmp.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRunner, UsageError, RefusedError } from "./dev-tools.mjs";
import { reportCommit, main } from "../dev/report-commit.mjs";

const run = makeRunner();

function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), "dev-report-commit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => {
    const r = run("git", ["-C", dir, ...args]);
    assert.equal(r.code, 0, `git ${args.join(" ")}: ${r.stdout}${r.stderr}`);
    return r.stdout.trim();
  };
  git("init", "-q", "-b", "main");
  git("config", "user.name", "test");
  git("config", "user.email", "test@example.invalid");
  git("config", "core.autocrlf", "false");
  mkdirSync(join(dir, "docs/dev-hq"), { recursive: true });
  mkdirSync(join(dir, ".pa"));
  writeFileSync(join(dir, "docs/dev-hq/data.json"), '{"v":1}\n');
  writeFileSync(join(dir, "docs/dev-hq/data.js"), "window.HQ_DATA = {};\n");
  writeFileSync(join(dir, "STAND.md"), "stand\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const report = join(dir, "..", `${dir.split(/[\\/]/).pop()}-report.md`);
  writeFileSync(report, "# Report X-1\n\nInhalt\n");
  t.after(() => rmSync(report, { force: true }));
  return { dir, git, report };
}

// Simulates the real post-merge hook: after a merge the HQ snapshot is
// regenerated in the working tree, unstaged.
function installRegeneratingHook(dir, git) {
  mkdirSync(join(dir, ".hooks"));
  const hook = join(dir, ".hooks/post-merge");
  writeFileSync(hook, '#!/bin/sh\necho \'{"v":"regenerated"}\' > docs/dev-hq/data.json\n');
  chmodSync(hook, 0o755);
  git("config", "core.hooksPath", ".hooks");
  writeFileSync(join(dir, ".git/info/exclude"), ".hooks/\n");
}

function topicMerge(dir, git) {
  git("checkout", "-qb", "topic");
  writeFileSync(join(dir, "feature.txt"), "x\n");
  git("add", "feature.txt");
  git("commit", "-qm", "topic");
  git("checkout", "-q", "main");
}

test("report-commit copies the report and commits it with No-Test and Co-Authored-By", (t) => {
  const f = repo(t);
  const res = reportCommit({ run, cwd: f.dir, id: "x-1", from: f.report, coAuthor: "Tester <t@example.invalid>" });
  assert.equal(readFileSync(join(f.dir, ".pa/report_x-1.md"), "utf8"), "# Report X-1\n\nInhalt\n");
  const msg = f.git("log", "-1", "--format=%B");
  assert.match(msg, /^docs\(pa\): x-1 Bericht/);
  assert.match(msg, /^No-Test: /m);
  assert.match(msg, /^Co-Authored-By: Tester <t@example\.invalid>$/m);
  assert.equal(f.git("show", "--name-only", "--format=", "HEAD"), ".pa/report_x-1.md");
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(res.commit, f.git("rev-parse", "HEAD"));
});

test("report-commit resets HQ data that only a merge changed", (t) => {
  const f = repo(t);
  installRegeneratingHook(f.dir, f.git);
  topicMerge(f.dir, f.git);
  f.git("merge", "-q", "--no-ff", "--no-edit", "topic");
  assert.match(f.git("status", "--porcelain"), /docs\/dev-hq\/data\.json/);
  const res = reportCommit({ run, cwd: f.dir, id: "x-1", from: f.report, coAuthor: "Tester <t@example.invalid>" });
  assert.deepEqual(res.reset, ["docs/dev-hq/data.json"]);
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(f.git("show", "--name-only", "--format=", "HEAD"), ".pa/report_x-1.md");
});

test("report-commit --merge merges the ref first and then resets the regenerated HQ data", (t) => {
  const f = repo(t);
  installRegeneratingHook(f.dir, f.git);
  topicMerge(f.dir, f.git);
  reportCommit({ run, cwd: f.dir, id: "x-1", from: f.report, coAuthor: "Tester <t@example.invalid>", merge: "topic" });
  assert.ok(existsSync(join(f.dir, "feature.txt")));
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(readFileSync(join(f.dir, "docs/dev-hq/data.json"), "utf8"), '{"v":1}\n');
});

test("report-commit refuses when HQ data is dirty next to other local edits", (t) => {
  const f = repo(t);
  const head = f.git("rev-parse", "HEAD");
  writeFileSync(join(f.dir, "docs/dev-hq/data.json"), '{"v":"local"}\n');
  writeFileSync(join(f.dir, "STAND.md"), "lokal geaendert\n");
  assert.throws(
    () => reportCommit({ run, cwd: f.dir, id: "x-1", from: f.report, coAuthor: "Tester <t@example.invalid>" }),
    RefusedError,
  );
  assert.equal(f.git("rev-parse", "HEAD"), head);
  assert.equal(readFileSync(join(f.dir, "docs/dev-hq/data.json"), "utf8"), '{"v":"local"}\n');
});

test("report-commit refuses when something else is already staged", (t) => {
  const f = repo(t);
  writeFileSync(join(f.dir, "other.txt"), "x\n");
  f.git("add", "other.txt");
  assert.throws(
    () => reportCommit({ run, cwd: f.dir, id: "x-1", from: f.report, coAuthor: "Tester <t@example.invalid>" }),
    RefusedError,
  );
});

test("report-commit needs a co-author and a safe id", (t) => {
  const f = repo(t);
  assert.throws(() => reportCommit({ run, cwd: f.dir, id: "x-1", from: f.report, coAuthor: "" }), UsageError);
  assert.throws(
    () => reportCommit({ run, cwd: f.dir, id: "../evil", from: f.report, coAuthor: "Tester <t@example.invalid>" }),
    UsageError,
  );
});

test("report-commit --dry-run changes nothing", async (t) => {
  const f = repo(t);
  const head = f.git("rev-parse", "HEAD");
  const out = [];
  const code = await main(
    ["--worktree", f.dir, "--id", "x-1", "--from", f.report, "--co-author", "Tester <t@example.invalid>", "--dry-run"],
    { out: (s) => out.push(s), err: (s) => out.push(s) },
  );
  assert.equal(code, 0);
  assert.equal(f.git("rev-parse", "HEAD"), head);
  assert.ok(!existsSync(join(f.dir, ".pa/report_x-1.md")));
  assert.match(out.join(""), /Probelauf/);
});

test("report-commit --help exits 0", async () => {
  const out = [];
  const code = await main(["--help"], { out: (s) => out.push(s), err: (s) => out.push(s) });
  assert.equal(code, 0);
  assert.match(out.join(""), /report-commit/);
});

test("report-commit --merge refuses BEFORE merging when untracked files lie around (M4)", (t) => {
  const f = repo(t);
  installRegeneratingHook(f.dir, f.git);
  topicMerge(f.dir, f.git);
  const head = f.git("rev-parse", "HEAD");
  writeFileSync(join(f.dir, "untracked.txt"), "lokal\n");
  assert.throws(
    () => reportCommit({ run, cwd: f.dir, id: "x-1", from: f.report, coAuthor: "Tester <t@example.invalid>", merge: "topic" }),
    RefusedError,
  );
  assert.equal(f.git("rev-parse", "HEAD"), head);
  assert.ok(!existsSync(join(f.dir, "feature.txt")));
});

test("report-commit backs up HQ data before resetting it (N1)", (t) => {
  const f = repo(t);
  installRegeneratingHook(f.dir, f.git);
  topicMerge(f.dir, f.git);
  f.git("merge", "-q", "--no-ff", "--no-edit", "topic");
  const out = [];
  const res = reportCommit({
    run,
    cwd: f.dir,
    id: "x-1",
    from: f.report,
    coAuthor: "Tester <t@example.invalid>",
    log: (s) => out.push(s),
  });
  assert.deepEqual(res.reset, ["docs/dev-hq/data.json"]);
  assert.ok(res.backupDir, "Pfad des Backups fehlt");
  assert.equal(readFileSync(join(res.backupDir, "data.json"), "utf8"), '{"v":"regenerated"}\n');
  assert.match(out.join(""), /Backup/);
});

test("report-commit works when --worktree is a subdirectory of the repo (N5)", (t) => {
  const f = repo(t);
  const res = reportCommit({ run, cwd: join(f.dir, "docs"), id: "x-1", from: f.report, coAuthor: "Tester <t@example.invalid>" });
  assert.ok(res.commit);
  assert.equal(f.git("show", "--name-only", "--format=", "HEAD"), ".pa/report_x-1.md");
});

test("report-commit refuses when untracked files sit next to dirty HQ data", (t) => {
  const f = repo(t);
  const head = f.git("rev-parse", "HEAD");
  writeFileSync(join(f.dir, "docs/dev-hq/data.json"), '{"v":"local"}\n');
  writeFileSync(join(f.dir, "lokal.txt"), "lokal\n");
  assert.throws(
    () => reportCommit({ run, cwd: f.dir, id: "x-1", from: f.report, coAuthor: "Tester <t@example.invalid>" }),
    RefusedError,
  );
  assert.equal(f.git("rev-parse", "HEAD"), head);
});

test("report-commit refuses when HQ data itself is staged and leaves the index alone", (t) => {
  const f = repo(t);
  const head = f.git("rev-parse", "HEAD");
  writeFileSync(join(f.dir, "docs/dev-hq/data.json"), '{"v":"local"}\n');
  f.git("add", "docs/dev-hq/data.json");
  assert.throws(
    () => reportCommit({ run, cwd: f.dir, id: "x-1", from: f.report, coAuthor: "Tester <t@example.invalid>" }),
    RefusedError,
  );
  assert.equal(f.git("rev-parse", "HEAD"), head);
  assert.match(f.git("status", "--porcelain"), /^M  docs\/dev-hq\/data\.json/);
});
