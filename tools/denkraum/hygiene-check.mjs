#!/usr/bin/env node
// Public-repo hygiene for tools/denkraum/ (DR-01, Root disposition D2).
// Every tracked or added file must be free of machine paths, AgentsRoom agent
// ids, ledger state, e-mail addresses and non-loopback IPv4 addresses.
// Findings name file, line and rule only: the matched value is never printed,
// so the gate log cannot leak what it found.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCOPE = "tools/denkraum";

const LINE_RULES = [
  ["machine-path", /[A-Za-z]:[\\/]+Users[\\/]|\/home\/[^/\s]+\//i],
  ["agent-id", /agent-\d{13}-[a-z0-9]{6}/],
  ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
];

function nonLoopbackIpv4(line) {
  for (const m of line.matchAll(/(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])/g)) {
    if (m.slice(1).every((octet) => Number(octet) <= 255) && m[1] !== "127") return true;
  }
  return false;
}

// files: [{ path, text }] with repo-relative, forward-slash paths.
export function findViolations(files) {
  const found = [];
  for (const { path, text } of files) {
    if (/(^|\/)state(\.json$|\/)/.test(path)) found.push({ path, line: 0, rule: "state-file" });
    if (/(^|\/)\.env[^/]*$/.test(path)) found.push({ path, line: 0, rule: "env-file" });
    text.split(/\r?\n/).forEach((line, index) => {
      for (const [rule, pattern] of LINE_RULES) {
        if (pattern.test(line)) found.push({ path, line: index + 1, rule });
      }
      if (nonLoopbackIpv4(line)) found.push({ path, line: index + 1, rule: "ipv4" });
    });
  }
  return found;
}

// Tracked files are read from the index, because that is what a commit
// publishes; the working tree may differ from it or miss the file entirely.
export function scopeFiles(root) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
  const list = (...flags) => git("ls-files", "-z", ...flags, "--", SCOPE).split("\0").filter(Boolean);
  const staged = list("--cached").map((path) => ({ path, text: git("show", `:${path}`) }));
  const added = list("--others", "--exclude-standard").map((path) => ({ path, text: readFileSync(`${root}/${path}`, "utf8") }));
  return [...staged, ...added];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const files = scopeFiles(root);
  const found = findViolations(files);
  for (const { path, line, rule } of found) console.error(`${path}:${line}: ${rule}`);
  console.log(`denkraum hygiene: ${files.length} files, ${found.length} findings`);
  process.exit(found.length ? 1 : 0);
}
