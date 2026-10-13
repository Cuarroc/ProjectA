import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const scanner = join(dirname(fileURLToPath(import.meta.url)), "architecture-drift.mjs");

const seams = ["api.rs", "main.rs", "store.rs", "bin/pa.rs"].map(name => `src-tauri/src/${name}`);
const budgetPath = "scripts/ci/seam-budget.json";
const budget = (maxLines = 2) => ({ schemaVersion: 1, seams: seams.map(path => ({ path, maxLines })) });
const fixtureEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, env: fixtureEnv, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function budgetFixture(withBudget = true) {
  const root = fixture(Object.fromEntries(seams.map(path => [path, "// seam\n\n"])));
  if (withBudget) writeFileSync(join(root, budgetPath), JSON.stringify(budget()));
  git(root, "init", "-q");
  git(root, "config", "core.autocrlf", "false");
  git(root, "config", "core.hooksPath", join(root, "empty-hooks"));
  git(root, "config", "user.name", "Fixture");
  git(root, "config", "user.email", "noreply@example.com");
  git(root, "add", ".");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  return root;
}

function checkBudget(root, args = [], env = fixtureEnv) {
  return spawnSync(process.execPath, [scanner, "check", ...args], { cwd: root, env, encoding: "utf8" });
}

function expectBudget(root, status, diagnostic, args = [], env = fixtureEnv) {
  const result = checkBudget(root, args, env);
  assert.equal(result.status, status, result.stdout + result.stderr);
  if (diagnostic) assert.match(result.stderr, diagnostic);
}

test("shipped seam budgets accept the integrated repository and reject growth", () => {
  const repo = process.env.TEST_REPO_ROOT || dirname(dirname(dirname(scanner)));
  const root = budgetFixture();
  for (const path of [...seams, budgetPath, "scripts/ci/architecture-drift.allow"]) {
    writeFileSync(join(root, path), readFileSync(join(repo, path)));
  }
  git(root, "add", ".");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "integrated repository baseline");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  const config = readFileSync(join(repo, budgetPath), "utf8");
  expectBudget(root, 0);
  for (const { path, maxLines } of JSON.parse(config).seams) {
    const source = readFileSync(join(root, path));
    writeFileSync(join(root, path), "\n".repeat(maxLines + 1));
    expectBudget(root, 1, /seam budget.*exceeds/);
    writeFileSync(join(root, path), source);
  }
});

test("seam budget rejects growth and accepts unchanged or smaller seams", () => {
  const root = budgetFixture();
  expectBudget(root, 0);
  for (const path of seams) {
    writeFileSync(join(root, path), "// seam\n\n// growth\n");
    expectBudget(root, 1, /seam budget.*exceeds/);
    writeFileSync(join(root, path), "// smaller\n");
    expectBudget(root, 0);
  }
  writeFileSync(join(root, budgetPath), JSON.stringify(budget(1)));
  expectBudget(root, 0);
  // Both checks must run through the real CLI.
  writeFileSync(join(root, seams[0]), 'fn f() { sqlx::query("SELECT 1"); }\n');
  expectBudget(root, 1, /SQL_OUTSIDE_STORE/);
});

test("seam budget checks the integrated main baseline during a pending merge", () => {
  const root = budgetFixture(false);
  const original = git(root, "rev-parse", "HEAD");
  git(root, "checkout", "-qb", "candidate");
  writeFileSync(join(root, budgetPath), JSON.stringify(budget()));
  git(root, "add", ".");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "bootstrap budget");
  git(root, "checkout", "-qb", "main-update", original);
  for (const path of seams) writeFileSync(join(root, path), "// seam\n\n// landed on main\n");
  git(root, "add", ".");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "main grows before bootstrap");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(root, "checkout", "candidate");
  writeFileSync(join(root, budgetPath), JSON.stringify(budget(3)));
  expectBudget(root, 1, /seam budget.*raised/);
  git(root, "merge", "--no-commit", "--no-ff", "origin/main");
  expectBudget(root, 0);
  expectBudget(root, 1, /seam budget.*raised/, ["--base", original]);
  writeFileSync(join(root, budgetPath), JSON.stringify(budget(4)));
  expectBudget(root, 1, /seam budget.*raised/);
  writeFileSync(join(root, budgetPath), JSON.stringify(budget(3)));
  git(root, "add", ".");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "integrate measured main baseline");
  expectBudget(root, 0);
});

test("seam budget rejects raised or malformed ceilings", () => {
  const root = budgetFixture();
  const base = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, budgetPath), JSON.stringify(budget(3)));
  writeFileSync(join(root, seams[0]), "// seam\n\n// growth\n");
  git(root, "add", ".");
  git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "raise candidate budget");
  expectBudget(root, 1, /seam budget.*raised/);
  expectBudget(root, 1, /seam budget.*raised/, ["--base", base]);
  const malformed = [null, {}, { ...budget(), schemaVersion: 2 }, { ...budget(), seams: [] }];
  for (const value of [-1, 1.5, "2", null, 9007199254740992]) {
    malformed.push(budget(value));
  }
  malformed.push({ ...budget(), seams: budget().seams.slice(1) });
  malformed.push({ ...budget(), seams: [...budget().seams, { path: "extra.rs", maxLines: 2 }] });
  malformed.push({ ...budget(), seams: [budget().seams[0], ...budget().seams.slice(0, 3)] });
  for (const value of malformed) {
    writeFileSync(join(root, budgetPath), JSON.stringify(value));
    expectBudget(root, 1, /seam budget/);
  }
  writeFileSync(join(root, budgetPath), "{");
  expectBudget(root, 1, /seam budget/);
  const bootstrap = budgetFixture(false);
  writeFileSync(join(bootstrap, budgetPath), JSON.stringify(budget()));
  expectBudget(bootstrap, 0);
  writeFileSync(join(bootstrap, budgetPath), JSON.stringify(budget(3)));
  expectBudget(bootstrap, 1, /seam budget.*raised/);
  const invalidBase = budgetFixture();
  writeFileSync(join(invalidBase, budgetPath), "{}");
  git(invalidBase, "add", ".");
  git(invalidBase, "-c", "commit.gpgsign=false", "commit", "-qm", "malformed baseline");
  git(invalidBase, "update-ref", "refs/remotes/origin/main", "HEAD");
  writeFileSync(join(invalidBase, budgetPath), JSON.stringify(budget()));
  expectBudget(invalidBase, 1, /seam budget.*invalid schema/);
});

test("seam budget rejects missing files and counts CRLF consistently", () => {
  const root = budgetFixture();
  for (const source of ["", "\n", "// one\r\n// two\r\n", "// one\n// two", "// one\r\n// two"]) {
    writeFileSync(join(root, seams[0]), source);
    expectBudget(root, 0);
  }
  for (const source of ["// one\r\n// two\r\n// three", "// one\n// two\n// three\n"]) {
    writeFileSync(join(root, seams[0]), source);
    expectBudget(root, 1, /seam budget.*exceeds/);
  }
  writeFileSync(join(root, seams[0]), "// one\n");
  expectBudget(root, 1, /seam budget/, ["--base", "missing-ref"]);
  expectBudget(root, 1, /seam budget/, ["--base"]);
  expectBudget(root, 0, undefined, ["--base", "origin/main"]);
  const unrelated = git(root, "-c", "commit.gpgsign=false", "commit-tree", "HEAD^{tree}", "-m", "unrelated");
  expectBudget(root, 1, /seam budget/, ["--base", unrelated]);
  expectBudget(root, 1, /seam budget/, [], { ...fixtureEnv, PATH: join(root, "no-git") });
  for (const path of [...seams, budgetPath]) {
    renameSync(join(root, path), join(root, `${path}.saved`));
    expectBudget(root, 1, /seam budget/);
    renameSync(join(root, `${path}.saved`), join(root, path));
  }
  renameSync(join(root, seams[0]), join(root, `${seams[0]}.saved`));
  mkdirSync(join(root, seams[0]));
  expectBudget(root, 1, /seam budget/);
  const nonGit = fixture(Object.fromEntries(seams.map(path => [path, "// seam\n"])));
  writeFileSync(join(nonGit, budgetPath), JSON.stringify(budget()));
  expectBudget(nonGit, 1, /seam budget/);
  expectBudget(nonGit, 0, undefined, ["--patterns-only"]);
});

test("check reports a clean diagnostic when the allowlist is missing", () => {
  const root = budgetFixture();
  renameSync(join(root, "scripts/ci/architecture-drift.allow"), join(root, "scripts/ci/architecture-drift.allow.bak"));
  const result = checkBudget(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /architecture drift: missing allowlist/);
  assert.doesNotMatch(result.stderr, /at checkPatterns/);
});

test("patterns-only cannot skip a runnable seam budget or the gate command", () => {
  const root = budgetFixture();
  expectBudget(root, 1, /cannot skip the seam budget/, ["--patterns-only"]);
  expectBudget(root, 2, /usage:/, ["--patterns-only", "extra"]);
  writeFileSync(join(root, seams[0]), "// seam\n\n// growth\n");
  expectBudget(root, 1, /exceeds/, ["--patterns-only"]);
  const gates = readFileSync(join(dirname(scanner), "gates.sh"), "utf8");
  const line = gates.split("\n").find((entry) => entry.includes('"architecture-drift|'));
  assert.match(line, /architecture-drift\.mjs check"$/);
  assert.doesNotMatch(line, /--patterns-only/);
});

test("pattern checks go through the CLI", () => {
  const root = fixture({ "src-tauri/src/workers.rs": "fn load() { sqlx::query(\"SELECT 1\"); }\n" });
  const result = run(root, "check");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /seam budget: skipped \(--patterns-only; no origin\/main baseline\)/);
  assert.match(result.stderr, /SQL_OUTSIDE_STORE/);
});

test("default seam budget check does not query ancestor of origin/main", () => {
  if (process.platform === "win32") return;
  const root = budgetFixture();
  const bin = join(root, "git-bin");
  const realGit = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  mkdirSync(bin);
  writeFileSync(join(bin, "git"), `#!/bin/sh
if [ "$1" = merge-base ] && [ "$2" = --is-ancestor ] && [ "$4" = origin/main ]; then
  echo "vacuous origin/main ancestor check" >&2
  exit 1
fi
exec ${realGit} "$@"
`);
  chmodSync(join(bin, "git"), 0o755);
  const env = { ...fixtureEnv, PATH: `${bin}:${fixtureEnv.PATH}` };
  expectBudget(root, 0, undefined, [], env);
  expectBudget(root, 0, undefined, ["--base", "origin/main"], env);
});

test("seam budget accepts comment fields and still rejects raised ceilings", () => {
  const root = budgetFixture();
  const documented = budget();
  documented.comment = "ratchet headroom";
  documented.seams[0].note = "api";
  writeFileSync(join(root, budgetPath), JSON.stringify(documented));
  expectBudget(root, 0);
  documented.seams[0].maxLines = 3;
  writeFileSync(join(root, budgetPath), JSON.stringify(documented));
  expectBudget(root, 1, /seam budget.*raised/);
});

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
  const args = command === "check"
    ? [scanner, "check", "--patterns-only"]
    : [scanner, command, ...(command === "snapshot" ? ["--stdout"] : [])];
  return spawnSync(process.execPath, args, {
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

test("accepts settings-named methods inside ControlBackend for ApiBackend", () => {
  const root = fixture({ "src-tauri/src/main.rs": "impl ControlBackend for ApiBackend {\n    fn get_digest_enabled() {}\n}\n" });
  assert.equal(run(root, "check").status, 0);
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
