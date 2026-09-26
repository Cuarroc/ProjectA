// SETUP-08a: prune-worktrees against a real repository with linked worktrees
// in tmp and a fake `gh` (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRunner } from "./dev-tools.mjs";
import { parseWorktreeList, planPrune, applyPrune, main } from "../dev/prune-worktrees.mjs";

const real = makeRunner();

function setup(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "dev-prune-")));
  t.after(() => {
    real("git", ["-C", join(base, "main"), "worktree", "prune"]);
    rmSync(base, { recursive: true, force: true });
  });
  const remote = join(base, "remote.git");
  const dir = join(base, "main");
  const git = (cwd, ...args) => {
    const r = real("git", ["-C", cwd, ...args]);
    assert.equal(r.code, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git(base, "init", "-q", "--bare", remote);
  git(base, "init", "-q", "-b", "main", dir);
  git(dir, "config", "user.name", "test");
  git(dir, "config", "user.email", "test@example.invalid");
  git(dir, "remote", "add", "origin", remote);
  writeFileSync(join(dir, ".git/info/exclude"), ".claude/\n");
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, "add", "a.txt");
  git(dir, "commit", "-qm", "a");
  git(dir, "push", "-q", "origin", "main");

  const wt = (rel, branch) => {
    const path = join(base, rel);
    git(dir, "worktree", "add", "-q", "-b", branch, path, "main");
    return path;
  };
  const commitIn = (path, name) => {
    writeFileSync(join(path, name), name + "\n");
    git(path, "add", name);
    git(path, "commit", "-qm", name);
  };
  const mergeToMain = (branch) => {
    git(dir, "merge", "-q", "--no-ff", "--no-edit", branch);
    git(dir, "push", "-q", "origin", "main");
  };

  const p = {};
  p.merged = wt("main/.claude/worktrees/merged", "claude/merged");
  commitIn(p.merged, "m.txt");
  git(p.merged, "push", "-q", "origin", "claude/merged");
  mergeToMain("claude/merged");

  p.dirty = wt("main/.claude/worktrees/dirty", "claude/dirty");
  commitIn(p.dirty, "d.txt");
  git(p.dirty, "push", "-q", "origin", "claude/dirty");
  mergeToMain("claude/dirty");
  writeFileSync(join(p.dirty, "d.txt"), "local edit\n");

  p.squashed = wt("main/.claude/worktrees/squashed", "claude/squashed");
  commitIn(p.squashed, "s.txt");
  git(p.squashed, "push", "-q", "origin", "claude/squashed");

  p.unpushed = wt("main/.claude/worktrees/unpushed", "claude/unpushed");
  commitIn(p.unpushed, "u.txt");

  p.open = wt("main/.claude/worktrees/open", "claude/open");
  commitIn(p.open, "o.txt");
  git(p.open, "push", "-q", "origin", "claude/open");

  p.codex = wt("elsewhere/codex-x", "codex/x");
  commitIn(p.codex, "c.txt");
  git(p.codex, "push", "-q", "origin", "codex/x");
  mergeToMain("codex/x");

  p.other = wt("elsewhere/app-worker", "pa/wk-1");

  git(dir, "fetch", "-q", "origin");
  const prs = [
    { number: 5, headRefName: "claude/squashed", state: "MERGED", updatedAt: "2026-09-24T10:00:00Z" },
    { number: 6, headRefName: "claude/unpushed", state: "CLOSED", updatedAt: "2026-09-24T10:00:00Z" },
    { number: 7, headRefName: "claude/open", state: "OPEN", updatedAt: "2026-09-24T10:00:00Z" },
  ];
  const run = (cmd, args, opts) => {
    if (cmd === "gh") return { code: 0, stdout: JSON.stringify(prs), stderr: "" };
    return real(cmd, args, opts);
  };
  return { base, dir, p, run };
}

const byPath = (plan, path) =>
  plan.entries.find((e) => e.path.toLowerCase().replace(/\\/g, "/") === path.toLowerCase().replace(/\\/g, "/"));

test("parseWorktreeList reads branch, detached and locked entries", () => {
  const list = parseWorktreeList(
    "worktree C:/r\nHEAD aaa\nbranch refs/heads/main\n\nworktree C:/r/.claude/worktrees/x\nHEAD bbb\ndetached\nlocked busy\n\n",
  );
  assert.equal(list.length, 2);
  assert.equal(list[0].branch, "main");
  assert.equal(list[1].detached, true);
  assert.equal(list[1].locked, true);
});

test("prune-worktrees plans merged and closed worktrees and protects dirty and unpushed ones", (t) => {
  const f = setup(t);
  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 0 });
  assert.equal(byPath(plan, f.p.merged).action, "remove");
  assert.equal(byPath(plan, f.p.squashed).action, "remove");
  assert.match(byPath(plan, f.p.squashed).reason, /MERGED/);
  assert.equal(byPath(plan, f.p.codex).action, "remove");
  assert.equal(byPath(plan, f.p.dirty).action, "keep");
  assert.match(byPath(plan, f.p.dirty).reason, /uncommitt/i);
  assert.equal(byPath(plan, f.p.unpushed).action, "keep");
  assert.match(byPath(plan, f.p.unpushed).reason, /ungepusht/i);
  assert.equal(byPath(plan, f.p.open), undefined);
  assert.equal(byPath(plan, f.p.other), undefined);
  assert.equal(byPath(plan, f.dir), undefined);
});

test("prune-worktrees keeps worktrees that were active recently", (t) => {
  const f = setup(t);
  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 3_600_000 });
  assert.equal(byPath(plan, f.p.merged).action, "keep");
  assert.match(byPath(plan, f.p.merged).reason, /aktiv/);
});

test("prune-worktrees is a dry run by default and --apply removes only the planned ones", async (t) => {
  const f = setup(t);
  const out = [];
  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
  assert.equal(await main(["--repo", f.dir, "--min-idle", "0s"], io, { run: f.run }), 0);
  assert.ok(existsSync(f.p.merged));
  assert.match(out.join(""), /Probelauf/);

  assert.equal(await main(["--repo", f.dir, "--min-idle", "0s", "--apply"], io, { run: f.run }), 0);
  assert.ok(!existsSync(f.p.merged));
  assert.ok(!existsSync(f.p.squashed));
  assert.ok(!existsSync(f.p.codex));
  assert.ok(existsSync(f.p.dirty));
  assert.ok(existsSync(f.p.unpushed));
  assert.ok(existsSync(f.p.open));
});

test("applyPrune never forces a removal", (t) => {
  const f = setup(t);
  const seen = [];
  const run = (cmd, args, opts) => {
    if (cmd === "git" && args.includes("remove")) seen.push(args);
    return f.run(cmd, args, opts);
  };
  const plan = planPrune({ run, cwd: f.dir, minIdleMs: 0 });
  applyPrune(plan, { run, cwd: f.dir });
  assert.ok(seen.length > 0);
  for (const args of seen) assert.ok(!args.includes("--force") && !args.includes("-f"));
});

test("prune-worktrees works without gh (merged-into-main only)", (t) => {
  const f = setup(t);
  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 0, useGh: false });
  assert.equal(byPath(plan, f.p.merged).action, "remove");
  assert.equal(byPath(plan, f.p.squashed), undefined);
});

test("prune-worktrees --help exits 0", async () => {
  const out = [];
  assert.equal(await main(["--help"], { out: (s) => out.push(s), err: (s) => out.push(s) }), 0);
  assert.match(out.join(""), /prune-worktrees/);
});

test("prune-worktrees keeps a finished worktree that holds ignored files beyond build artifacts (M2)", (t) => {
  const f = setup(t);
  writeFileSync(join(f.dir, ".git/info/exclude"), ".claude/\n.env\n");
  writeFileSync(join(f.p.merged, ".env"), "SECRET=1\n");
  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 0 });
  const e = byPath(plan, f.p.merged);
  assert.equal(e.action, "keep");
  assert.match(e.reason, /ignorierte ungesicherte Dateien/);
  assert.match(e.reason, /\.env/);
});

test("prune-worktrees removes a worktree whose only ignored files are build artifacts", (t) => {
  const f = setup(t);
  writeFileSync(join(f.dir, ".git/info/exclude"), ".claude/\nnode_modules/\nsrc-tauri/target\n");
  mkdirSync(join(f.p.merged, "node_modules/pkg"), { recursive: true });
  mkdirSync(join(f.p.merged, "src-tauri/target/debug"), { recursive: true });
  writeFileSync(join(f.p.merged, "node_modules/pkg/x"), "junk");
  writeFileSync(join(f.p.merged, "src-tauri/target/debug/.cargo-lock"), "lock");
  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 0 });
  assert.equal(byPath(plan, f.p.merged).action, "remove");
});

test("prune-worktrees removes worktrees with a stash: refs/stash is shared, not per-worktree (M1 widerlegt)", (t) => {
  const f = setup(t);
  writeFileSync(join(f.p.merged, "m.txt"), "local edit\n");
  assert.equal(f.run("git", ["-C", f.p.merged, "stash", "-q"]).code, 0);
  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 0 });
  assert.equal(byPath(plan, f.p.merged).action, "remove");
  applyPrune(plan, { run: f.run, cwd: f.dir });
  assert.ok(!existsSync(f.p.merged));
  const list = real("git", ["-C", f.dir, "stash", "list"]);
  assert.equal(list.code, 0);
  assert.match(list.stdout, /WIP on claude\/merged/);
});

test("prune-worktrees keeps a really locked worktree (git worktree lock)", (t) => {
  const f = setup(t);
  assert.equal(real("git", ["-C", f.dir, "worktree", "lock", "--reason", "agent laeuft", f.p.merged]).code, 0);
  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 0 });
  const e = byPath(plan, f.p.merged);
  assert.equal(e.action, "keep");
  assert.match(e.reason, /gesperrt/);
});

test("prune-worktrees removes a detached worktree parked at a merged commit", (t) => {
  const f = setup(t);
  const det = join(f.base, "main/.claude/worktrees/detached");
  assert.equal(real("git", ["-C", f.dir, "worktree", "add", "--detach", "-q", det, "main"]).code, 0);
  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 0 });
  assert.equal(byPath(plan, det).action, "remove");
});

test("prune-worktrees never removes the worktree it runs in", (t) => {
  const f = setup(t);
  const plan = planPrune({ run: f.run, cwd: f.p.merged, minIdleMs: 0 });
  const e = byPath(plan, f.p.merged);
  assert.equal(e.action, "keep");
  assert.match(e.reason, /aktuelle Verzeichnis/);
});

test("prune-worktrees reports a worktree whose directory is gone as prunable", (t) => {
  const f = setup(t);
  rmSync(f.p.merged, { recursive: true, force: true });
  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 0 });
  const e = byPath(plan, f.p.merged);
  assert.equal(e.action, "keep");
  assert.match(e.reason, /Verzeichnis fehlt/);
});

test("prune-worktrees keeps a freshly checked-out worktree that made no commit (Reflog-Aktivitaet, G1 widerlegt)", (t) => {
  const f = setup(t);
  const wt = join(f.base, "main/.claude/worktrees/fresh");
  assert.equal(real("git", ["-C", f.dir, "worktree", "add", "-q", "-b", "claude/fresh", wt, "main"]).code, 0);
  const plan = planPrune({ run: f.run, cwd: f.dir, minIdleMs: 3_600_000 });
  const e = byPath(plan, wt);
  assert.equal(e.action, "keep");
  assert.match(e.reason, /aktiv/);
});

test("makeNorm is injectable and normalizes case only on win32 (N6)", async () => {
  const mod = await import("../dev/prune-worktrees.mjs");
  assert.equal(typeof mod.makeNorm, "function");
  assert.equal(mod.makeNorm("win32")("C:\\Repo\\.Claude\\Worktrees\\X"), mod.makeNorm("win32")("c:/repo/.claude/worktrees/x"));
  assert.notEqual(mod.makeNorm("linux")("/Repo/X"), mod.makeNorm("linux")("/repo/x"));
});
