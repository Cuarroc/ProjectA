import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { test } from "node:test";
import { findViolations, run, scopeFiles } from "./hygiene-check.mjs";

// Fixtures are assembled at runtime so this file never holds a forbidden
// literal itself (it is scanned by the very check it tests).
const join = (...parts) => parts.join("");
const AT = String.fromCharCode(64);
const rulesFor = (text, path = "tools/denkraum/x.mjs") => findViolations([{ path, text }]).map((f) => f.rule);

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
  const lines = [];
  try {
    git("init", "-q");
    mkdirSync(joinPath(root, "tools/denkraum"), { recursive: true });
    writeFileSync(joinPath(root, "tools/denkraum/big.txt"), `${secret}\n`.repeat(50));
    git("add", "tools");
    const log = { log: (...a) => lines.push(a.join(" ")), error: (...a) => lines.push(a.join(" ")) };
    assert.equal(run(root, log, 64), 2, "a buffer overflow must fail with its own exit code");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.ok(lines.length > 0 && lines.every((line) => !line.includes(secret)), "diagnostic must not carry file content");
});

test("the check and its test are clean under their own rules", () => {
  const files = ["hygiene-check.mjs", "hygiene-check.test.mjs"].map((name) => ({
    path: `tools/denkraum/${name}`,
    text: readFileSync(new URL(name, import.meta.url), "utf8"),
  }));
  assert.deepEqual(findViolations(files), []);
});
