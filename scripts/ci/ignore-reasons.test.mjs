import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Bare `#[ignore]` sites that may remain, as "path:line". Shrink-only: the
// four seam files (api.rs, main.rs, store.rs, store/, bin/pa.rs) have none
// today, so the list is empty. Never add an entry; give the test a reason.
const ALLOWED_BARE = new Set([]);

// `#[ignore]` and `#[ignore = ""]` say nothing about why or how to run.
const BARE = /#\[\s*ignore\s*(?:=\s*"\s*")?\s*\]/;

function rustSources() {
  const listed = spawnSync("git", ["ls-files", "-z", "--", "src-tauri"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(listed.status, 0, listed.stderr);
  return listed.stdout.split("\0").filter((path) => path.endsWith(".rs"));
}

test("every_ignored_rust_test_states_a_reason", () => {
  const bare = [];
  for (const path of rustSources()) {
    readFileSync(join(root, path), "utf8")
      .split("\n")
      .forEach((line, index) => {
        const site = `${path}:${index + 1}`;
        if (BARE.test(line) && !ALLOWED_BARE.has(site)) bare.push(site);
      });
  }
  assert.deepEqual(
    bare,
    [],
    'write #[ignore = "<why>; run with <how>"] instead of a bare #[ignore]',
  );
});

test("ignore_reason_pattern_matches_bare_forms_only", () => {
  assert.ok(BARE.test("    #[ignore]"));
  assert.ok(BARE.test('#[ignore = ""]'));
  assert.ok(!BARE.test('#[ignore = "needs a live server; run with cargo test -- --ignored"]'));
});
