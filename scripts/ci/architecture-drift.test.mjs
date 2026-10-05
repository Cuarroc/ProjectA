import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const scanner = join(dirname(fileURLToPath(import.meta.url)), "architecture-drift.mjs");

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "projecta-architecture-drift-"));
  for (const [path, contents] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  mkdirSync(join(root, "scripts/ci"), { recursive: true });
  writeFileSync(join(root, "scripts/ci/architecture-drift.allow"), "");
  return root;
}

function run(root, command) {
  return spawnSync(process.execPath, [scanner, command, ...(command === "snapshot" ? ["--stdout"] : [])], {
    cwd: root,
    encoding: "utf8",
  });
}

test("rejects a new sqlx query outside store", () => {
  const root = fixture({ "src-tauri/src/workers.rs": "fn load() { sqlx::query(\"SELECT 1\"); }\n" });
  const result = run(root, "check");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SQL_OUTSIDE_STORE.*src-tauri\/src\/workers\.rs/);
});

test("rejects a new process spawn outside proc.rs", () => {
  const root = fixture({ "src-tauri/src/workers.rs": "fn launch() { Command::new(\"git\"); }\n" });
  const result = run(root, "check");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RAW_PROCESS_SPAWN.*src-tauri\/src\/workers\.rs/);
});

test("accepts an allowlisted occurrence", () => {
  const root = fixture({ "src-tauri/src/main.rs": "fn warn() { eprintln!(\"old\"); }\n" });
  const snapshot = run(root, "snapshot");
  assert.equal(snapshot.status, 0, snapshot.stderr);
  writeFileSync(join(root, "scripts/ci/architecture-drift.allow"), snapshot.stdout);
  assert.equal(run(root, "check").status, 0);
});

test("ignores whitespace-only changes to an allowlisted line", () => {
  const path = "src-tauri/src/workers.rs";
  const root = fixture({ [path]: "fn launch() { Command::new(\"git\"); }\n" });
  const snapshot = run(root, "snapshot");
  assert.equal(snapshot.status, 0, snapshot.stderr);
  writeFileSync(join(root, "scripts/ci/architecture-drift.allow"), snapshot.stdout);
  writeFileSync(join(root, path), "fn launch() {   Command::new ( \"git\" ); }\n");
  assert.equal(run(root, "check").status, 0);
});

test("rejects a second identical occurrence in an allowlisted file", () => {
  const path = "src-tauri/src/workers.rs";
  const root = fixture({ [path]: "fn a() { Command::new(\"git\"); }\n" });
  const snapshot = run(root, "snapshot");
  writeFileSync(join(root, "scripts/ci/architecture-drift.allow"), snapshot.stdout);
  writeFileSync(join(root, path), "fn a() { Command::new(\"git\"); }\nfn a() { Command::new(\"git\"); }\n");
  const result = run(root, "check");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RAW_PROCESS_SPAWN/);
});

test("a quote char literal in a test mod does not hide later production spawns", () => {
  const root = fixture({
    "src-tauri/src/workers.rs":
      "#[cfg(test)]\nmod tests {\n    fn quote() -> char { '\"' }\n}\nfn launch() { Command::new(\"git\"); }\n",
  });
  const result = run(root, "check");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RAW_PROCESS_SPAWN.*src-tauri\/src\/workers\.rs/);
});

test("escaped char literals and lifetimes do not confuse test mod stripping", () => {
  const root = fixture({
    "src-tauri/src/workers.rs":
      "#[cfg(test)]\nmod tests {\n    fn f<'a>(s: &'a str) -> bool { s.starts_with('\\'') || s.contains('}') }\n    fn spawn() { Command::new(\"git\"); }\n}\nfn launch() { Command::new(\"git\"); }\n",
  });
  const result = run(root, "check");
  assert.equal(result.status, 1);
  assert.equal((result.stderr.match(/RAW_PROCESS_SPAWN/g) ?? []).length, 1);
});

test("a hex escape char literal does not confuse test mod stripping", () => {
  // Without the branch the first literal is left unmatched and its closing quote pairs with the next one (','), so '}' is counted as a brace.
  const root = fixture({
    "src-tauri/src/workers.rs":
      "#[cfg(test)]\nmod tests {\n    fn f() -> (char, char) { ('\\x7b','}') }\n    fn spawn() { Command::new(\"git\"); }\n}\nfn launch() { Command::new(\"git\"); }\n",
  });
  const result = run(root, "check");
  assert.equal(result.status, 1);
  assert.equal((result.stderr.match(/RAW_PROCESS_SPAWN/g) ?? []).length, 1);
});

test("a unicode escape char literal does not confuse test mod stripping", () => {
  // Without the branch the first literal is left unmatched and its closing quote pairs with the next one (','), so '}' is counted as a brace.
  const root = fixture({
    "src-tauri/src/workers.rs":
      "#[cfg(test)]\nmod tests {\n    fn f() -> (char, char) { ('\\u{7b}','}') }\n    fn spawn() { Command::new(\"git\"); }\n}\nfn launch() { Command::new(\"git\"); }\n",
  });
  const result = run(root, "check");
  assert.equal(result.status, 1);
  assert.equal((result.stderr.match(/RAW_PROCESS_SPAWN/g) ?? []).length, 1);
});
