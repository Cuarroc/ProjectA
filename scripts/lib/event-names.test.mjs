import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** Globs for code that must not hard-code wire event names. */
const CODE_GLOBS = [
  "-g", "*.rs",
  "-g", "*.ts",
  // Fix round keeps *.tsx / src js+mjs out until the red fixture test lands.
];

/**
 * Search `searchRoot` for quoted event-name literals outside the shared modules.
 * Comment and doc-comment lines are ignored (R960-A3: "0 hits" is for code).
 */
function eventLiteralHits(searchRoot, globs = CODE_GLOBS) {
  const patterns = Object.values(expected).flatMap((value) => [
    "-e", `["\\x27\\x60]${value}`,
  ]);
  const result = spawnSync("rg", [
    "-n", "--no-heading", "--color=never",
    ...globs,
    "-g", `!${rustModule}`, "-g", `!${tsModule}`,
    ...patterns, ".",
  ], { cwd: searchRoot, encoding: "utf8" });
  assert.ifError(result.error);
  assert.ok(result.status === 0 || result.status === 1, result.stderr);
  return result.stdout.split(/\r?\n/).filter(Boolean).filter((line) => {
    const source = line.match(/^.*?:\d+:(.*)$/)?.[1];
    assert.notEqual(source, undefined, `Unexpected rg output: ${line}`);
    return !/^\s*(\/\/|\/\*|\*)/.test(source);
  });
}

test("event names live only in the shared modules", () => {
  // PLAN D8c quote patterns also cover Rust's double-quoted literals (D8a/b).
  assert.deepEqual(
    eventLiteralHits(root),
    [],
    "Use the shared event constants/helpers in code",
  );
});

test("tsx event-name literals are rejected by the guard", () => {
  const fixture = mkdtempSync(join(tmpdir(), "event-names-tsx-"));
  try {
    writeFileSync(
      join(fixture, "Leak.tsx"),
      ` const name = "${expected.WORKER_STATUS}";\n`,
    );
    const hits = eventLiteralHits(fixture);
    assert.notDeepEqual(
      hits,
      [],
      "Guard must scan *.tsx (and fail when a code literal is planted)",
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
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
