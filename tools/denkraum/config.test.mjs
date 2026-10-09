import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname, toNamespacedPath, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadStartConfig } from "./config.mjs";

const fixtureRoot = mkdtempSync(join(tmpdir(), "denkraum-config-"));
const repoRoot = join(fixtureRoot, "synthetic-repository");
mkdirSync(repoRoot);
const name = (suffix) => `DECISION_DESK_${suffix}`;
const validEnv = () => ({
  [name("ROOT_RECEIPT_TOKEN")]: "a".repeat(32),
  [name("WEBHOOK_SECRET")]: "b".repeat(32),
  [name("ROOT_AGENT_ID")]: "synthetic-" + "agent",
  [name("STATE")]: join(fixtureRoot, "synthetic-state", "ledger.json"),
});
const load = (env) => loadStartConfig(env, { repoRoot });
function refuses(suffix, values) {
  for (const value of values) {
    const result = load({ ...validEnv(), [name(suffix)]: value });
    assert.equal(result.ok, false);
    assert.equal(result.config, null);
    assert.deepEqual(result.errors.map((error) => error.name), [name(suffix)]);
    assert.equal(typeof result.errors[0].reason, "string");
  }
}

test("loads valid config with default and explicit ports", () => {
  const env = validEnv();
  const result = load(env);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.config, {
    rootReceiptToken: env[name("ROOT_RECEIPT_TOKEN")],
    webhookSecret: env[name("WEBHOOK_SECRET")],
    webhookUrl: undefined,
    rootAgentId: env[name("ROOT_AGENT_ID")],
    statePath: env[name("STATE")], port: 4791,
    notifications: { enabled: false, reason: "DECISION_DESK_WEBHOOK_URL not set" },
  });
  for (const port of ["1", "65535"]) {
    assert.equal(load({ ...env, [name("PORT")]: port }).config.port, Number(port));
  }
});

test("enforces root receipt token boundaries and alphabet", () => {
  refuses("ROOT_RECEIPT_TOKEN", [undefined, "", "a".repeat(31), "a".repeat(257),
    "a".repeat(32) + "!", "a".repeat(32) + "\n", "é".repeat(32)]);
  for (const token of ["Z_9-".repeat(8), "a".repeat(256)]) {
    assert.equal(load({ ...validEnv(), [name("ROOT_RECEIPT_TOKEN")]: token }).ok, true);
  }
});

test("rejects short or control-bearing webhook secrets", () => {
  refuses("WEBHOOK_SECRET", [undefined, "", "b".repeat(31),
    ...[0, 9, 10, 13, 31, 127, 128, 159].map((code) => "b".repeat(32) + String.fromCharCode(code))]);
  assert.equal(load({ ...validEnv(), [name("WEBHOOK_SECRET")]: "é! ".repeat(20) }).ok, true);
});

test("refuses identical root and webhook secrets", () => {
  refuses("WEBHOOK_SECRET", [validEnv()[name("ROOT_RECEIPT_TOKEN")]]);
});

test("missing root agent id is a start error", () => {
  for (const missing of [undefined, "", "  "]) {
    const result = load({ ...validEnv(), [name("ROOT_AGENT_ID")]: missing });
    assert.equal(result.ok, false);
    assert.equal(result.config, null);
    assert.deepEqual(result.errors.map((error) => error.name), [name("ROOT_AGENT_ID")]);
    assert.equal(result.errors[0].reason, "required");
  }
});

test("rejects root agent ids that the store cannot use", () => {
  refuses("ROOT_AGENT_ID", [" leading", "trailing ", "invalid/id", "a".repeat(81), "id\n"]);
});

test("STATE through a junction/symlink into the repository is rejected", (t) => {
  const fixture = mkdtempSync(join(tmpdir(), "denkraum-state-phys-"));
  const fakeRepo = join(fixture, "repo");
  const outside = join(fixture, "outside");
  mkdirSync(fakeRepo);
  mkdirSync(outside);
  try {
    symlinkSync(fakeRepo, join(outside, "into-repo"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error.code === "EPERM") return t.skip("symlinks need extra rights on this machine");
    throw error;
  }
  for (const suffix of [["ledger.json"], ["missing", "nested", "ledger.json"]]) {
    const stateThroughLink = join(outside, "into-repo", ...suffix);
    const result = loadStartConfig({ ...validEnv(), [name("STATE")]: stateThroughLink }, { repoRoot: fakeRepo });
    assert.equal(result.ok, false);
    assert.equal(result.config, null);
    assert.deepEqual(result.errors.map((error) => error.name), [name("STATE")]);
    assert.match(result.errors[0].reason, /outside the repository/);
    for (const value of [stateThroughLink, fakeRepo, fixture]) {
      assert.equal(result.errors[0].reason.includes(value), false);
    }
  }
});

test("requires an absolute state path", () => {
  refuses("STATE", [undefined, "", "relative-state", ".", join("..", "state")]);
});

test("refuses a state path inside the repository", () => {
  refuses("STATE", [repoRoot, join(repoRoot, "state.json"),
    join(repoRoot, "nested", "state.json"),
    join(repoRoot, "..", "synthetic-repository", "state.json")]);
  const sibling = join(`${repoRoot}-sibling`, "state.json");
  assert.equal(load({ ...validEnv(), [name("STATE")]: sibling }).ok, true);
  const outside = join(repoRoot, "..", "outside", "..", "state.json");
  assert.equal(load({ ...validEnv(), [name("STATE")]: outside }).config.statePath, resolve(outside));
});

test("refuses Windows namespace and UNC state paths", () => {
  // Backslash Windows paths are relative on POSIX; slash paths use native semantics.
  const namespaced = process.platform === "win32"
    ? toNamespacedPath(join(repoRoot, "state.json"))
    : win32.toNamespacedPath(win32.join("Z:" + win32.sep, "synthetic-repository", "state.json"));
  refuses("STATE", [namespaced, namespaced.replace("\\\\?\\", "\\\\.\\"),
    "\\\\synthetic-host\\synthetic-share\\state.json",
    "\\\\?\\UNC\\synthetic-host\\synthetic-share\\state.json"]);
  const slashPath = namespaced.replaceAll("\\", "/");
  if (process.platform === "win32") refuses("STATE", [slashPath, join(repoRoot.toUpperCase(), "state.json")]);
  else assert.equal(load({ ...validEnv(), [name("STATE")]: slashPath }).ok, true);
  assert.equal(load(validEnv()).ok, true);
});

test("rejects invalid ports without coercion", () => {
  refuses("PORT", ["", "0", "65536", "-1", "1.5", "1e3", "0x10", " 80", "80\n", "NaN"]);
});

test("returns only environment names and fixed reasons in errors", () => {
  const env = validEnv();
  env[name("ROOT_RECEIPT_TOKEN")] += "!";
  env[name("WEBHOOK_SECRET")] += "\n";
  env[name("STATE")] = join(repoRoot, "private-state");
  env[name("PORT")] = "invalid-" + "port";
  const result = load(env);
  assert.equal(result.errors.length, 4);
  for (const error of result.errors) assert.deepEqual(Object.keys(error), ["name", "reason"]);
  for (const { name: errorName, reason } of result.errors) {
    for (const value of Object.values(env)) {
      for (const fragment of [value, value.slice(0, 12)]) {
        assert.equal(errorName.includes(fragment) || reason.includes(fragment), false);
      }
    }
  }
});

test("check CLI never prints synthetic environment values", () => {
  const script = fileURLToPath(new URL("config.mjs", import.meta.url));
  const actualRoot = resolve(dirname(script), "..", "..");
  for (const invalid of [false, true]) {
    const env = validEnv();
    env[name("STATE")] = resolve(actualRoot, "..", "synthetic-cli-state");
    env[name("PORT")] = "65432";
    if (invalid) {
      env[name("ROOT_RECEIPT_TOKEN")] += "!";
      env[name("WEBHOOK_SECRET")] += "\n";
      env[name("STATE")] = join(actualRoot, "private-state");
      env[name("PORT")] = "invalid-" + "port";
    }
    const child = spawnSync(process.execPath, [script, "--check"], { env, encoding: "utf8" });
    assert.equal(child.error, undefined);
    assert.equal(child.status, invalid ? 1 : 0);
    const output = child.stdout + child.stderr;
    for (const value of Object.values(env)) assert.equal(output.includes(value), false);
    if (!invalid) assert.match(output, /notifications disabled: DECISION_DESK_WEBHOOK_URL not set/);
    if (invalid) for (const suffix of ["ROOT_RECEIPT_TOKEN", "WEBHOOK_SECRET", "STATE", "PORT"]) {
      assert.ok(output.includes(name(suffix)));
    }
  }
});

test("checks config through a real CLI directory alias without running on import", (t) => {
  const script = fileURLToPath(new URL("config.mjs", import.meta.url));
  const fixture = mkdtempSync(join(tmpdir(), "denkraum-cli-alias-"));
  const alias = join(fixture, "alias");
  try {
    symlinkSync(dirname(script), alias, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error.code === "EPERM") return t.skip("symlinks need extra rights on this machine");
    throw error;
  }
  const aliasedScript = join(alias, "config.mjs");
  const env = { ...validEnv(), [name("ROOT_RECEIPT_TOKEN")]: "invalid-token!",
    [name("STATE")]: join(fixture, "state.json") };
  for (const entry of [script, aliasedScript]) {
    const child = spawnSync(process.execPath, [entry, "--check"], { env, encoding: "utf8" });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 1);
    assert.equal(child.stdout, "");
    assert.equal(child.stderr,
      "DECISION_DESK_ROOT_RECEIPT_TOKEN: required; use 32–256 letters, digits, underscores or hyphens\n");
    for (const value of Object.values(env)) assert.equal(child.stderr.includes(value), false);
    const valid = spawnSync(process.execPath, [entry, "--check"],
      { env: { ...env, [name("ROOT_RECEIPT_TOKEN")]: "a".repeat(32) }, encoding: "utf8" });
    assert.equal(valid.error, undefined);
    assert.equal(valid.status, 0);
    assert.equal(valid.stderr, "");
    assert.equal(valid.stdout, ["ROOT_RECEIPT_TOKEN", "WEBHOOK_SECRET", "STATE", "PORT"]
      .map((suffix) => `${name(suffix)}: valid\n`).join("")
      + "notifications disabled: DECISION_DESK_WEBHOOK_URL not set\n");
    const usage = spawnSync(process.execPath, [entry], { env, encoding: "utf8" });
    assert.equal(usage.error, undefined);
    assert.equal(usage.status, 1);
    assert.equal(usage.stdout, "");
    assert.equal(usage.stderr, "Usage: node tools/denkraum/config.mjs --check\n");
  }
  for (const args of [[], [script], [join(fixture, "missing-entry.mjs")]]) {
    const imported = spawnSync(process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(aliasedScript).href)})`, ...args],
      { env, encoding: "utf8" });
    assert.equal(imported.error, undefined);
    assert.equal(imported.status, 0);
    assert.equal(imported.stdout + imported.stderr, "");
  }
});

test("physical STATE checks resolve repository aliases and fail closed on broken links", (t) => {
  const alias = join(fixtureRoot, "repo-alias");
  const broken = join(fixtureRoot, "broken");
  try {
    symlinkSync(repoRoot, alias, process.platform === "win32" ? "junction" : "dir");
    symlinkSync(join(fixtureRoot, "missing"), broken, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error.code === "EPERM") return t.skip("symlinks need extra rights on this machine");
    throw error;
  }
  for (const state of [join(alias, "state.json"), join(broken, "state.json")]) {
    refuses("STATE", [state]);
  }
  const result = loadStartConfig({ ...validEnv(), [name("STATE")]: join(repoRoot, "state.json") }, { repoRoot: alias });
  assert.equal(result.ok, false);
  assert.equal(result.config, null);
  assert.match(result.errors[0].reason, /outside the repository/);
});

test("STATE through Windows 8.3 repository aliases is rejected", (t) => {
  if (process.platform !== "win32") return t.skip("Windows-only 8.3 short-name resolution");
  const long = realpathSync.native(repoRoot);
  const child = spawnSync("cmd.exe", ["/d", "/c", 'for %I in ("%DENKRAUM_TEST_REPO%") do @echo %~sI'],
    { env: { ...process.env, DENKRAUM_TEST_REPO: long }, encoding: "utf8", windowsVerbatimArguments: true });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
  const short = child.stdout.trim();
  assert.ok(short);
  if (short.toLowerCase() === long.toLowerCase()) return t.skip("8.3 short names are disabled on the fixture volume");
  for (const [root, alias] of [[long, short], [short, long]]) {
    const result = loadStartConfig({ ...validEnv(), [name("STATE")]: join(alias, "missing", "ledger.json") }, { repoRoot: root });
    assert.equal(result.ok, false);
    assert.equal(result.config, null);
    assert.deepEqual(result.errors, [{ name: name("STATE"), reason: "must be outside the repository after physical path resolution" }]);
  }
});

test("check reports notifications disabled without a webhook URL", () => {
  const env = validEnv();
  assert.deepEqual(load(env).config.notifications, { enabled: false, reason: "DECISION_DESK_WEBHOOK_URL not set" });
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("config.mjs", import.meta.url)), "--check"], { env, encoding: "utf8" });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
  assert.doesNotMatch(child.stdout, /notifications enabled/);
  assert.match(child.stdout, /notifications disabled: DECISION_DESK_WEBHOOK_URL not set/);
});

test("returns the validated webhook URL in start config", () => {
  for (const url of [undefined, "", "https://agentsroom.dev/api/triggers/t_abcdef"]) {
    const result = load({ ...validEnv(), [name("WEBHOOK_URL")]: url });
    assert.equal(result.ok, true);
    assert.equal(result.config.webhookUrl, url);
  }
});

test("server startup uses the validated webhook URL without rereading the environment", () => {
  const script = fileURLToPath(new URL("server.mjs", import.meta.url));
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    import { syncBuiltinESMExports } from 'node:module';
    import { pathToFileURL } from 'node:url';
    let reads = 0; let scheduled = 0; const listeners = new Map();
    const env = ${JSON.stringify(validEnv())};
    Object.defineProperty(env, 'DECISION_DESK_WEBHOOK_URL', { get() {
      return ++reads === 1 ? 'https://agentsroom.dev/api/triggers/t_abcdef' : 'invalid-after-validation';
    } });
    process.env = env;
    // Exercise the real CLI wiring without opening a listener or sending a webhook.
    http.createServer = () => ({
      on(event, callback) { listeners.set(event, callback); return this; },
      listen() { listeners.get('listening')(); },
    });
    globalThis.setTimeout = () => { scheduled++; return { unref() {} }; };
    syncBuiltinESMExports();
    process.argv[1] = ${JSON.stringify(script)};
    await import(pathToFileURL(process.argv[1]).href);
    assert.equal(scheduled, 1, 'validated webhook must enable notification scheduling');
    assert.equal(reads, 1, 'startup must consume the validated URL snapshot');
  `], { encoding: "utf8", timeout: 10000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
});

test("physical STATE fixture skips when symlink creation is denied", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const preload = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    fs.symlinkSync = () => { throw Object.assign(new Error('synthetic denial'), { code: 'EPERM' }); };
    syncBuiltinESMExports();
  `;
  const child = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(preload)}`,
    "--test", "--test-reporter=tap",
    "--test-name-pattern=^physical STATE checks resolve repository aliases and fail closed on broken links$",
    fileURLToPath(import.meta.url)], { env, encoding: "utf8", timeout: 10000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /# SKIP symlinks need extra rights on this machine/);
});
