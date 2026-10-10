#!/usr/bin/env node
// V161-DOC-LINKS (PLAN R161-03): broken RELATIVE links in tracked Markdown.
//
// Every `[text](target)`, image `![alt](target)` and reference definition
// `[id]: target` in a tracked *.md whose target is a relative path must name an
// existing file or directory. The message carries file:line. Not checked:
// external URLs (any `scheme:`), `//host` links, pure `#anchor` links, the
// `#fragment`/`?query` part of a path, and anything inside fenced code blocks
// or inline code spans.
//
// Excluded trees (a stated reason each, change them only with a reason):
//   .pa/                  agent working papers and review logs, frozen history;
//                         they cite paths of branches that no longer exist
//   docs/archive/         archived docs, kept as written, never repaired
//   scripts/lib/fixtures/ deliberately broken input of the plan-lint tests
//
// Files come from `git ls-files` when the root is a git checkout (tracked
// files only), otherwise from a directory walk (fixture trees in the tests).
//
// Usage: doc-links.mjs check [root]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXCLUDED = [".pa/", "docs/archive/", "scripts/lib/fixtures/"];

// `](target` where target is `<...>` or a run without whitespace that may hold
// one level of balanced parentheses (`a(b).md`).
const INLINE = /\]\(\s*(<[^>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)/g;
const DEFINITION = /^ {0,3}\[[^\]\n]+\]:\s*(<[^>\n]*>|\S+)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export function links(text) {
  const found = [];
  let fence = null;
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\r$/, "");
    const open = FENCE.exec(line);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && line.trim() === open[1]) fence = null;
      return;
    }
    if (open) {
      fence = open[1];
      return;
    }
    const prose = line.replace(/(`+)[^`]*?\1/g, (span) => " ".repeat(span.length));
    const def = DEFINITION.exec(prose);
    if (def) found.push({ line: i + 1, target: def[1] });
    for (const m of prose.matchAll(INLINE)) found.push({ line: i + 1, target: m[1] });
  });
  return found;
}

// The path a link points at, or null when it is not a checkable relative path.
export function localTarget(raw) {
  let target = raw.startsWith("<") ? raw.slice(1, -1) : raw;
  target = target.split("#")[0].split("?")[0];
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) return null;
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function excluded(rel) {
  return EXCLUDED.some((prefix) => rel.startsWith(prefix));
}

function walk(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "target", "dist"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, found);
    else if (entry.name.endsWith(".md")) found.push(path);
  }
  return found;
}

function markdownFiles(root) {
  if (!existsSync(join(root, ".git"))) return walk(root);
  const out = execFileSync("git", ["-C", root, "-c", "core.quotepath=false", "ls-files", "-z", "--", "*.md"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean).map((rel) => join(root, rel));
}

export function check(root) {
  const broken = [];
  for (const file of markdownFiles(root)) {
    const rel = relative(root, file).split("\\").join("/");
    if (excluded(rel) || !existsSync(file)) continue;
    for (const { line, target } of links(readFileSync(file, "utf8"))) {
      const local = localTarget(target);
      if (local === null) continue;
      const base = local.startsWith("/") ? root : dirname(file);
      if (!existsSync(resolve(base, local.replace(/^\/+/, "")))) broken.push({ path: rel, line, target });
    }
  }
  return broken;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv[2] !== "check") {
    console.error("usage: doc-links.mjs check [root]");
    process.exit(2);
  }
  const broken = check(resolve(process.argv[3] ?? process.cwd()));
  for (const b of broken) console.error(`DOC_LINK_BROKEN ${b.path}:${b.line} -> ${b.target} does not exist`);
  if (broken.length) process.exit(1);
  console.log("no broken relative links in tracked Markdown");
}
