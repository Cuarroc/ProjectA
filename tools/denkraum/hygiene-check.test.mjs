import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { test } from "node:test";
import { findViolations, scopeFiles } from "./hygiene-check.mjs";

// Fixtures are assembled at runtime so this file never holds a forbidden
// literal itself (it is scanned by the very check it tests).
const join = (...parts) => parts.join("");
const AT = String.fromCharCode(64);
const rulesFor = (text, path = "tools/denkraum/x.mjs") => findViolations([{ path, text }]).map((f) => f.rule);

function installChecker(root) {
  const checker = joinPath(root, "tools/denkraum/hygiene-check.mjs");
  copyFileSync(new URL("hygiene-check.mjs", import.meta.url), checker);
  copyFileSync(new URL("entry.mjs", import.meta.url), joinPath(root, "tools/denkraum/entry.mjs"));
  return checker;
}

// Run the actual CLI, including its entry point and complete process output.
// A child-only buffer limit (preloaded, so the checker stays the real entry
// module) keeps the overflow fixture small on every base.
function runChecker(root, maxBuffer, env = {}) {
  const checker = installChecker(root);
  const preload = `
    import cp from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const original = cp.execFileSync;
    cp.execFileSync = (file, args, options) => original(file, args, { ...options, maxBuffer: ${JSON.stringify(maxBuffer)} });
    syncBuiltinESMExports();
  `;
  const flags = maxBuffer === undefined ? [] : ["--import", `data:text/javascript,${encodeURIComponent(preload)}`];
  const result = spawnSync(process.execPath, [...flags, checker], {
    encoding: "utf8", env: { ...process.env, ...env },
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

test("flags each forbidden class and passes its clean twin", () => {
  const cases = [
    ["machine-path", join("C:", "/Users/someone/x"), "C-Users without a drive"],
    ["machine-path", join("c:", "\\", "Users", "\\", "someone"), "path\\to\\Users"],
    ["machine-path", join("/ho", "me/someone/repo"), "/homepage/x"],
    ["agent-id", join("agent", "-", "1".repeat(13), "-", "abc123"), join("agent", "-", "1".repeat(12), "-", "abc123")],
    ["email", join("someone", AT, "example", ".", "org"), join("npm i ", AT, "playwright/test")],
    ["ipv4", ["10", "1", "2", "3"].join("."), ["127", "0", "0", "1"].join(".")],
  ];
  for (const [rule, bad, good] of cases) {
    assert.deepEqual(rulesFor(`x\n${bad}\n`), [rule], `${rule} must be flagged`);
    assert.deepEqual(rulesFor(`x\n${good}\n`), [], `${rule} clean twin must pass`);
  }
  assert.deepEqual(rulesFor(["1", "2", "3", "999"].join(".")), [], "octet over 255 is no address");
});

test("flags ledger state by path and reports file and line only", () => {
  assert.deepEqual(rulesFor("{}", join("tools/denkraum/", "state", ".json")), ["state-file"]);
  assert.deepEqual(rulesFor("{}", join("tools/denkraum/", "state", "/ledger.json")), ["state-file"]);
  assert.deepEqual(rulesFor("{}", "tools/denkraum/statement.json"), []);
  const secret = join("someone", AT, "example", ".", "org");
  const [finding] = findViolations([{ path: "tools/denkraum/a.md", text: `ok\r\n${secret}` }]);
  assert.deepEqual(finding, { path: "tools/denkraum/a.md", line: 2, rule: "email" });
  assert.ok(!JSON.stringify(finding).includes(secret), "matched value must not be reported");
});

test("flags env files by path whatever their content", () => {
  assert.deepEqual(rulesFor("TOKEN=opaque", join("tools/denkraum/", ".env")), ["env-file"]);
  assert.deepEqual(rulesFor("", join("tools/denkraum/sub/", ".env", ".local")), ["env-file"]);
  assert.deepEqual(rulesFor("", "tools/denkraum/env.md"), []);
});

test("scans staged content instead of the working tree", () => {
  const root = mkdtempSync(joinPath(tmpdir(), "denkraum-hygiene-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    git("init", "-q");
    mkdirSync(joinPath(root, "tools/denkraum"), { recursive: true });
    const put = (name, text) => writeFileSync(joinPath(root, "tools/denkraum", name), text);
    put("a.txt", ["10", "1", "2", "3"].join("."));
    put("b.txt", join("someone", AT, "example", ".", "org"));
    git("add", "tools");
    put("a.txt", "clean in the working tree only");
    unlinkSync(joinPath(root, "tools/denkraum/b.txt"));
    put("c.txt", join("agent", "-", "2".repeat(13), "-", "xyz789"));
    const rules = findViolations(scopeFiles(root)).map((f) => `${f.path}:${f.rule}`).sort();
    assert.deepEqual(rules, ["tools/denkraum/a.txt:ipv4", "tools/denkraum/b.txt:email", "tools/denkraum/c.txt:agent-id"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a git read failure exits 2 without printing file content", () => {
  const root = mkdtempSync(joinPath(tmpdir(), "denkraum-hygiene-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const secret = join("someone", AT, "example", ".", "org");
  try {
    git("init", "-q");
    mkdirSync(joinPath(root, "tools/denkraum"), { recursive: true });
    writeFileSync(joinPath(root, "tools/denkraum/big.txt"), `${secret}\n`.repeat(50));
    git("add", "tools");
    const result = runChecker(root, 64);
    assert.ok(!(result.stdout + result.stderr).includes(secret), "diagnostic must not carry file content");
    assert.equal(result.status, 2, "a buffer overflow must fail with its own exit code");
    assert.match(result.stderr, /cannot read tools\/denkraum \(ENOBUFS\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("git diagnostics never escape the CLI output boundary", () => {
  const root = mkdtempSync(joinPath(tmpdir(), "denkraum-hygiene-"));
  const secret = join("private", AT, "example", ".", "org");
  try {
    execFileSync("git", ["init", "-q"], { cwd: root, stdio: "pipe" });
    mkdirSync(joinPath(root, "tools/denkraum"), { recursive: true });
    const result = runChecker(root, undefined, {
      GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: secret, GIT_CONFIG_VALUE_0: "opaque",
    });
    assert.ok(!(result.stdout + result.stderr).includes(secret), "git diagnostics must not expose the config key");
    assert.equal(result.status, 2, "non-overflow git failures must also exit 2");
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim(), "denkraum hygiene: cannot read tools/denkraum (128)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the CLI preserves clean, findings and unreadable-repository exits", () => {
  const root = mkdtempSync(joinPath(tmpdir(), "denkraum-hygiene-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    mkdirSync(joinPath(root, "tools/denkraum"), { recursive: true });
    assert.equal(runChecker(root).status, 2);
    git("init", "-q");
    assert.equal(runChecker(root).status, 0);
    const secret = join("someone", AT, "example", ".", "org");
    writeFileSync(joinPath(root, "tools/denkraum/a.txt"), secret);
    git("add", "tools/denkraum/a.txt");
    const result = runChecker(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /tools\/denkraum\/a.txt:1: email/);
    assert.ok(!(result.stdout + result.stderr).includes(secret));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the check and its test are clean under their own rules", () => {
  const files = ["hygiene-check.mjs", "hygiene-check.test.mjs"].map((name) => ({
    path: `tools/denkraum/${name}`,
    text: readFileSync(new URL(name, import.meta.url), "utf8"),
  }));
  assert.deepEqual(findViolations(files), []);
});

test("SRV-2: hygiene-check.mjs started through an alias runs its check", () => {
  const root = mkdtempSync(joinPath(tmpdir(), "denkraum-hygiene-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root, stdio: "pipe" });
    mkdirSync(joinPath(root, "tools/denkraum"), { recursive: true });
    installChecker(root);
    const alias = joinPath(root, "alias");
    symlinkSync(joinPath(root, "tools/denkraum"), alias, process.platform === "win32" ? "junction" : "dir");
    const result = spawnSync(process.execPath, [joinPath(alias, "hygiene-check.mjs")], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^denkraum hygiene: \d+ files, 0 findings\n$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
