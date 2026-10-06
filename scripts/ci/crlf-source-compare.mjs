#!/usr/bin/env node
// V16-08: CRLF-blind source comparisons in Rust tests.
//
// A test that reads source/doc text (include_str!, read_to_string) and then
// searches it for a literal containing "\n" passes on LF checkouts and fails
// on a Windows checkout with CRLF line endings (broke Windows on 05.10.). The
// gate flags such a function unless it normalises the text (mentions "\r").
// Allow-list: scripts/ci/crlf-source-compare.allow, one `path::fn<TAB>reason`.
//
// Scope (heuristic): only double-quoted "\n" literals are seen, and any "\r"
// in the fn counts as normalisation.
//
// Usage: crlf-source-compare.mjs check [root]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const READS = /\binclude_str!|\bread_to_string\s*\(/;
const NEEDLE = /\b(?:contains|find|rfind|starts_with|ends_with|matches|split|split_once|strip_prefix|strip_suffix)\s*\(\s*&?"(?:[^"\\\n]|\\.)*\\n(?:[^"\\\n]|\\.)*"/;
const FN = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:const\s+)?fn\s+(\w+)/;

export function scan(text, path) {
  const lines = text.split("\n");
  const hits = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    const body = current.lines.join("\n");
    if (NEEDLE.test(body) && !body.includes("\\r") && READS.test(body)) {
      hits.push({ path, fn: current.name, line: current.start });
    }
  };
  lines.forEach((line, i) => {
    const m = FN.exec(line);
    // A nested helper fn stays part of the test that owns it.
    // An item at column 0 (`mod tests {`, `#[cfg(test)]`) ends the open fn.
    if (!m && current && /^[A-Za-z#]/.test(line)) {
      flush();
      current = null;
    }
    if (m && (!current || /^\s*/.exec(line)[0].length <= current.indent)) {
      flush();
      current = { name: m[1], start: i + 1, indent: /^\s*/.exec(line)[0].length, lines: [] };
    }
    if (current) current.lines.push(line);
  });
  flush();
  return hits;
}

function rustFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "target", "dist"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) rustFiles(path, found);
    else if (entry.name.endsWith(".rs")) found.push(path);
  }
  return found;
}

export function check(root) {
  const allowPath = join(root, "scripts/ci/crlf-source-compare.allow");
  const allowed = new Set();
  if (existsSync(allowPath)) {
    for (const raw of readFileSync(allowPath, "utf8").split("\n")) {
      const line = raw.replace(/\r$/, "");
      if (line && !line.startsWith("#")) allowed.add(line.split("\t")[0]);
    }
  }
  const hits = [];
  for (const file of rustFiles(root)) {
    const rel = relative(root, file).split("\\").join("/");
    hits.push(...scan(readFileSync(file, "utf8"), rel));
  }
  return hits.filter((h) => !allowed.has(`${h.path}::${h.fn}`));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv[2] !== "check") {
    console.error("usage: crlf-source-compare.mjs check [root]");
    process.exit(2);
  }
  const hits = check(process.argv[3] ?? process.cwd());
  for (const h of hits) {
    console.error(`CRLF_BLIND_SOURCE_COMPARE ${h.path}:${h.line} fn ${h.fn}: source text is matched against a "\\n" literal without .replace("\\r\\n", "\\n")`);
  }
  if (hits.length) process.exit(1);
  console.log("no CRLF-blind source comparisons in Rust files");
}
