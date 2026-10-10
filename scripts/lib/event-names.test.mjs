import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function candidateFiles(searchRoot, relativeDir = "") {
  return readdirSync(join(searchRoot, relativeDir), { withFileTypes: true }).flatMap((entry) => {
    const path = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return candidateFiles(searchRoot, path);
    return entry.isFile() ? [path] : [];
  });
}

/**
 * Search `searchRoot` for quoted event-name literals outside the shared modules.
 * Comment and doc-comment lines are ignored (R960-A3: "0 hits" is for code).
 */
function eventLiteralHits(searchRoot) {
  let files;
  if (searchRoot === root) {
    const result = spawnSync("git", ["ls-files", "-z"], { cwd: searchRoot, encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    files = result.stdout.split("\0").filter(Boolean);
  } else {
    files = candidateFiles(searchRoot);
  }
  const pattern = new RegExp(`["'\x60](?:${Object.values(expected).join("|")})`);
  return files.filter((path) =>
    (/\.(rs|ts|tsx)$/.test(path) || /^src\/.*\.(js|mjs)$/.test(path)) &&
    path !== rustModule && path !== tsModule,
  ).flatMap((path) => {
    const lines = readFileSync(join(searchRoot, path), "utf8").split(/\r?\n/);
    return lines.flatMap((source, index) =>
      pattern.test(source) && !/^\s*(\/\/|\/\*|\*)/.test(source)
        ? [`./${path}:${index + 1}:${source}`] : [],
    );
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

test("event literal scan needs no external search tool", () => {
  const fixture = mkdtempSync(join(tmpdir(), "event-names-no-search-"));
  const originalPath = process.env.PATH;
  try {
    writeFileSync(join(fixture, "Leak.tsx"), `const name = "${expected.WORKER_STATUS}";\n`);
    process.env.PATH = "";
    assert.equal(eventLiteralHits(fixture).length, 1);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    rmSync(fixture, { recursive: true, force: true });
  }
});
