import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
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

test("rejects diagnosis commands in main.rs", () => {
  const root = fixture({ "src-tauri/src/main.rs": "fn get_reason_catalog() { }\n" });
  const result = run(root, "check");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DIAGNOSIS_COMMANDS_MOVED.*src-tauri\/src\/main\.rs/);
});

test("contract: all 7 diagnosis commands are properly moved to diagnosis_cmds.rs and exported in main.rs", () => {
  const repoRoot = process.env.TEST_REPO_ROOT || dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const mainRs = readFileSync(join(repoRoot, "src-tauri/src/main.rs"), "utf8");
  let diagnosisRs = "";
  try {
    diagnosisRs = readFileSync(join(repoRoot, "src-tauri/src/diagnosis_cmds.rs"), "utf8");
  } catch (e) {
    // missing in older tree, handled below
  }

  const commands = [
    "get_log_path",
    "get_panic_notice",
    "get_reason_catalog",
    "export_diagnosis",
    "reveal_log_path",
    "get_stuck_after_minutes",
    "set_stuck_after_minutes"
  ];

  for (const cmd of commands) {
    assert.doesNotMatch(mainRs, new RegExp(`fn\\s+${cmd}\\s*\\(`), `Command ${cmd} should not be defined in main.rs`);
    assert.match(diagnosisRs, new RegExp(`#\\[tauri::command\\]\\s*(?:(?:#\\[[^\\]]*\\]|\\/\\/.*|\\/\\*.*?\\*\\/)\\s*)*(?:pub\\s+)?(?:async\\s+)?fn\\s+${cmd}\\s*\\(`), `Command ${cmd} should be exported in diagnosis_cmds.rs`);
  }

  const handlerMatch = mainRs.match(/generate_handler!\[(.*?)\]/s);
  assert.ok(handlerMatch, "generate_handler! not found in main.rs");
  const handlerList = handlerMatch[1];
  for (const cmd of commands) {
    assert.match(handlerList, new RegExp(`\\b${cmd}\\b`), `Command ${cmd} should be listed in generate_handler!`);
  }
});

test("rejects settings commands in main.rs", () => {
  const root = fixture({ "src-tauri/src/main.rs": "fn get_agent_env_isolation() { }\n" });
  const result = run(root, "check");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SETTINGS_COMMANDS_MOVED.*src-tauri\/src\/main\.rs/);
});

test("contract: all 11 settings commands are properly moved to settings_cmds.rs and exported in main.rs", () => {
  const repoRoot = process.env.TEST_REPO_ROOT || dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const mainRs = readFileSync(join(repoRoot, "src-tauri/src/main.rs"), "utf8");
  let settingsRs = "";
  try {
    settingsRs = readFileSync(join(repoRoot, "src-tauri/src/settings_cmds.rs"), "utf8");
  } catch (e) {
    // missing in older tree, handled below
  }

  const commands = [
    "get_agent_env_isolation",
    "set_agent_env_isolation",
    "get_continuous_activation",
    "enable_continuous_activation",
    "get_digest_enabled",
    "set_digest_enabled",
    "get_routing_status",
    "set_product_mode",
    "set_profile_enabled",
    "set_category_learning",
    "get_learning_settings",
  ];

  const commandDef = (cmd) =>
    new RegExp(
      `#\\[tauri::command\\]\\s*(?:(?:#\\[[^\\]]*\\]|\\/\\/.*|\\/\\*.*?\\*\\/)\\s*)*(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?fn\\s+${cmd}\\s*\\(`,
    );

  for (const cmd of commands) {
    // ApiBackend keeps same-named trait methods in main.rs; only the Tauri
    // command attribute must leave.
    assert.doesNotMatch(mainRs, commandDef(cmd), `Command ${cmd} should not be defined in main.rs`);
    assert.match(settingsRs, commandDef(cmd), `Command ${cmd} should be exported in settings_cmds.rs`);
  }

  const handlerMatch = mainRs.match(/generate_handler!\[(.*?)\]/s);
  assert.ok(handlerMatch, "generate_handler! not found in main.rs");
  const handlerList = handlerMatch[1];
  for (const cmd of commands) {
    assert.match(handlerList, new RegExp(`\\b${cmd}\\b`), `Command ${cmd} should be listed in generate_handler!`);
  }
});
