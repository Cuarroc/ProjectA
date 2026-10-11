import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("src module basenames do not differ only by case within a directory", () => {
  // Git preserves both spellings even on a case-insensitive filesystem.
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const files = execFileSync("git", ["ls-files", "-z", "--", "src/"], {
    cwd: root, encoding: "utf8",
  }).split("\0").filter(Boolean);
  // CSS imports include their extension, so Shell.tsx beside shell.css is safe.
  const extensions = /(?:\.d\.ts|\.(?:ts|tsx|js|jsx|mjs|cjs))$/;
  const modules = new Map();
  const collisions = [];
  for (const file of files) {
    const extension = file.match(extensions)?.[0];
    if (!extension) continue;
    const basename = path.posix.basename(file, extension);
    const key = `${path.posix.dirname(file)}/${basename.toLowerCase()}`;
    const previous = modules.get(key);
    // Matching spellings across extensions (including declarations) are valid.
    if (previous && previous.basename !== basename) {
      collisions.push(`${previous.file} <-> ${file}`);
    }
    modules.set(key, { basename, file });
  }
  assert.deepEqual(collisions, [], "Case-insensitive module collisions under src/");
});
