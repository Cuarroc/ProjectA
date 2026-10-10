// scripts/lib/gitignore-contract.test.mjs — V161-IGNORE: review prompts and
// agent-local configs must stay out of git (AGENTS.md: keep review prompts
// out of the repo; agent configs may hold secrets).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** @returns {boolean} true when git would ignore the path */
function isIgnored(relPath) {
  const r = spawnSync("git", ["check-ignore", "--no-index", "--", relPath], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  assert.fail(
    `git check-ignore --no-index -- ${relPath} failed (exit ${r.status}): ${r.stderr}`,
  );
}

test("gitignore: review prompts and agent-local configs are ignored", () => {
  const mustIgnore = [
    ".pa/review_prompt_new.md",
    ".mcp.json",
    ".cursor/mcp.json",
    ".grok/config.toml",
    ".agentsroom/handoff-x",
    ".agentsroom/sessions/x",
  ];
  for (const path of mustIgnore) {
    assert.equal(isIgnored(path), true, `expected ignored: ${path}`);
  }

  const mustNotIgnore = [".pa/review_transport.py", ".pa/report_x.md"];
  for (const path of mustNotIgnore) {
    assert.equal(isIgnored(path), false, `expected not ignored: ${path}`);
  }
});
