import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const rustModule = "src-tauri/src/event_names.rs";
const tsModule = "src/lib/eventNames.ts";
const expected = {
  WORKER_STATUS: "worker:status",
  SUPERVISOR_NOTIFICATION: "supervisor:notification",
  PTY_OUTPUT_PREFIX: "pty:output:",
  PTY_EXIT_PREFIX: "pty:exit:",
};

test("event names live only in the shared modules", () => {
  // PLAN D8c quote patterns also cover Rust's double-quoted literals (D8a/b).
  const patterns = Object.values(expected).flatMap((value) => [
    "-e", `["\\x27\\x60]${value}`,
  ]);
  const result = spawnSync("rg", [
    "-n", "--no-heading", "--color=never",
    "-g", "*.rs", "-g", "*.ts",
    "-g", `!${rustModule}`, "-g", `!${tsModule}`,
    ...patterns, ".",
  ], { cwd: root, encoding: "utf8" });
  assert.ifError(result.error);
  assert.ok(result.status === 0 || result.status === 1, result.stderr);
  const hits = result.stdout.split(/\r?\n/).filter(Boolean).filter((line) => {
    const source = line.match(/^.*?:\d+:(.*)$/)?.[1];
    assert.notEqual(source, undefined, `Unexpected rg output: ${line}`);
    return !/^\s*(\/\/|\/\*|\*)/.test(source);
  });
  assert.deepEqual(hits, [], "Use the shared event constants/helpers in code");
});

test("event names match between Rust and TypeScript", () => {
  const values = (path, pattern) => Object.fromEntries(
    [...readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
      .matchAll(pattern)].map((match) => [match[1], match[2]]),
  );
  const rust = values(rustModule, /pub const (\w+): &str = "([^"]+)";/g);
  const ts = values(tsModule, /export const (\w+) = "([^"]+)";/g);
  assert.deepEqual(rust, expected, "Keep existing wire event names unchanged");
  assert.deepEqual(ts, rust);
});
