import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const gate = join(dirname(fileURLToPath(import.meta.url)), "doc-links.mjs");

function run(files) {
  const root = mkdtempSync(join(tmpdir(), "projecta-doc-links-"));
  for (const [path, contents] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return spawnSync(process.execPath, [gate, "check", root], { encoding: "utf8" });
}

test("a broken relative link in a fixture tree fails with file:line", () => {
  const result = run({
    "docs/a.md": "# A\n\nsee [gone](missing.md) and [up](../b.md)\n",
    "b.md": "# B\n",
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /docs\/a\.md:3 .*missing\.md/);
  assert.equal(result.stderr.trim().split("\n").length, 1, "only the broken link is reported");
});

test("anchors and external URLs are ignored", () => {
  const result = run({
    "a.md":
      "[web](https://example.com/x.md) [mail](mailto:a@b.c) [top](#intro) " +
      "[ok](b.md#part) [ok2](<b.md> \"title\")\n\n```\n[fenced](nope.md)\n```\n" +
      "inline `[code](nope.md)` stays quiet\n",
    "b.md": "# B\n",
    ".pa/old.md": "[dead](nowhere.md)\n",
    "docs/archive/old.md": "[dead](nowhere.md)\n",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a broken reference definition fails with file:line", () => {
  const result = run({
    "docs/a.md": "# A\n\nsee [ref][r] and [ok][o]\n\n[r]: missing.md\n[o]: ../b.md \"title\"\n",
    "b.md": "# B\n",
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /docs\/a\.md:5 .*missing\.md/);
  assert.equal(result.stderr.trim().split("\n").length, 1, "only the broken definition is reported");
});

test("a broken image link fails with file:line", () => {
  const result = run({
    "docs/a.md": "# A\n\n![shot](img/gone.png) and ![ok](img/here.png)\n",
    "docs/img/here.png": "png",
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /docs\/a\.md:3 .*img\/gone\.png/);
  assert.equal(result.stderr.trim().split("\n").length, 1, "only the broken image is reported");
});

const hasGit = spawnSync("git", ["--version"]).status === 0;

test("files come from git ls-files when the tree is a git repo", { skip: !hasGit && "git is unavailable" }, () => {
  const root = mkdtempSync(join(tmpdir(), "projecta-doc-links-git-"));
  const git = (...args) => {
    const r = spawnSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  };
  git("init", "-q");
  writeFileSync(join(root, "tracked.md"), "[gone](missing.md)\n");
  git("add", "tracked.md");
  git("commit", "-q", "-m", "fixture", "--no-gpg-sign");
  writeFileSync(join(root, "untracked.md"), "[gone](also-missing.md)\n");
  const result = spawnSync(process.execPath, [gate, "check", root], { encoding: "utf8" });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /tracked\.md:1 .*missing\.md/);
  assert.doesNotMatch(result.stderr, /untracked\.md/, "untracked files are not scanned in a git checkout");
});
