import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStartConfig } from "./config.mjs";

const repoRoot = resolve("synthetic-repository");
const name = (suffix) => `DECISION_DESK_${suffix}`;
const validEnv = () => ({
  [name("ROOT_RECEIPT_TOKEN")]: "a".repeat(32),
  [name("WEBHOOK_SECRET")]: "b".repeat(32),
  [name("ROOT_AGENT_ID")]: "synthetic-" + "agent",
  [name("STATE")]: resolve("synthetic-state", "ledger.json"),
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
    rootAgentId: env[name("ROOT_AGENT_ID")],
    statePath: env[name("STATE")], port: 4791,
    notifications: { enabled: true, reason: null },
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

test("disables notifications without an agent id and never falls back", () => {
  for (const missing of [undefined, "", "  "]) {
    const result = load({ ...validEnv(), [name("ROOT_AGENT_ID")]: missing });
    assert.equal(result.ok, true);
    assert.equal(result.config.rootAgentId, null);
    assert.deepEqual(result.config.notifications, {
      enabled: false, reason: "DECISION_DESK_ROOT_AGENT_ID: missing; notifications disabled",
    });
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
  for (const value of Object.values(env)) assert.equal(JSON.stringify(result.errors).includes(value), false);
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
    } else delete env[name("ROOT_AGENT_ID")];
    const child = spawnSync(process.execPath, [script, "--check"], { env, encoding: "utf8" });
    assert.equal(child.error, undefined);
    assert.equal(child.status, invalid ? 1 : 0);
    const output = child.stdout + child.stderr;
    for (const value of Object.values(env)) assert.equal(output.includes(value), false);
    if (!invalid) assert.match(output, /DECISION_DESK_ROOT_AGENT_ID: missing; notifications disabled/);
    if (invalid) for (const suffix of ["ROOT_RECEIPT_TOKEN", "WEBHOOK_SECRET", "STATE", "PORT"]) {
      assert.ok(output.includes(name(suffix)));
    }
  }
});
