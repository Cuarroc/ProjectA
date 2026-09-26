// scripts/lib/license-check.mjs
// LIC-01: evaluates a license-checker-rseidelsohn JSON report against the
// allowlist the user approved for the public repository. Exit 1 and one line
// per violation when any package carries a license outside the list.
//
// Usage: node scripts/lib/license-check.mjs <report.json>
// The report comes from: npx --yes license-checker-rseidelsohn --production --json

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// The list is fixed by the LIC-01 assignment and mirrored in src-tauri/deny.toml.
// Anything else (GPL/AGPL/LGPL/SSPL/unknown) is a finding for the
// orchestrator, never a silent exception.
export const ALLOWED_LICENSES = [
  "MIT",
  "Apache-2.0",
  "Apache-2.0 WITH LLVM-exception",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MPL-2.0",
  "Zlib",
  "Unicode-3.0",
  "Unicode-DFS-2016",
  "CC0-1.0",
  "0BSD",
  "BSL-1.0",
  "OFL-1.1",
];

const ALLOWED = new Set(ALLOWED_LICENSES.map((l) => l.toUpperCase()));

function tokenAllowed(token) {
  return ALLOWED.has(token.toUpperCase());
}

// SPDX choice semantics with real precedence (AND binds tighter than OR,
// parentheses group) — the same rules cargo-deny applies. A recursive-descent
// parser instead of flat string splitting, because flattening "(MIT OR
// Apache-2.0) AND GPL-3.0-only" would let the GPL conjunct slip through the
// MIT alternative (review lic-01 delta, kimi-k3 F1 / glm-5.2 F1). Malformed
// input fails closed (violation). A trailing `*` is license-checker's
// "inferred from file" marker, not part of the license id — tokenized
// separately and skipped after a token or group, but logged (kimi-k3 F8;
// group case: review pr10, grok F6).
function tokenize(expression) {
  const spaced = String(expression).replace(/([()*])/g, " $1 ").trim();
  if (!spaced) return [];
  const words = spaced.split(/\s+/);
  const tokens = [];
  for (let i = 0; i < words.length; i += 1) {
    // "Apache-2.0 WITH LLVM-exception" is one SPDX token; re-join the WITH.
    if (/^WITH$/i.test(words[i]) && tokens.length > 0 && i + 1 < words.length) {
      tokens[tokens.length - 1] += ` WITH ${words[i + 1]}`;
      i += 1;
    } else {
      tokens.push(words[i]);
    }
  }
  return tokens;
}

function licenseAllowed(expression, pkg) {
  if (/\*/.test(expression)) {
    console.error(`license-check: ${pkg}: "${expression}" was inferred from a file (* marker), verify by hand`);
  }
  const tokens = tokenize(expression);
  if (tokens.length === 0) return false;
  let pos = 0;
  const parsePrimary = () => {
    const token = tokens[pos];
    if (token === "(") {
      pos += 1;
      const value = parseOr();
      if (tokens[pos] !== ")") throw new Error("unbalanced parentheses");
      pos += 1;
      if (tokens[pos] === "*") pos += 1;
      return value;
    }
    if (token === undefined || token === ")" || /^(OR|AND)$/i.test(token)) {
      throw new Error(`unexpected token: ${token}`);
    }
    pos += 1;
    if (tokens[pos] === "*") pos += 1;
    return tokenAllowed(token);
  };
  const parseAnd = () => {
    let value = parsePrimary();
    while (/^AND$/i.test(tokens[pos] ?? "")) {
      pos += 1;
      value = parsePrimary() && value;
    }
    return value;
  };
  const parseOr = () => {
    let value = parseAnd();
    while (/^OR$/i.test(tokens[pos] ?? "")) {
      pos += 1;
      value = parseAnd() || value;
    }
    return value;
  };
  try {
    const value = parseOr();
    return pos === tokens.length && value;
  } catch {
    return false;
  }
}

// report: license-checker JSON object { "name@version": { licenses: "..." } }.
// rootKey: the project's own exact "name@version"; its entry is skipped
// because the repo license decision is tracked separately (LIC-01 "Needs
// decision"). The skip is exact, not a name prefix: a production dependency
// that shares the root name at any other version is third-party code and
// must be evaluated (review pr10, grok F5).
export function evaluateLicenses(report, rootKey) {
  const violations = [];
  for (const [pkg, info] of Object.entries(report)) {
    if (rootKey && pkg === rootKey) continue;
    // license-checker may report an array (multiple license files found):
    // conservatively every entry must be on the list. An empty array is
    // treated like a missing license (fail-closed, glm-5.2 delta F2).
    const expressions = Array.isArray(info.licenses)
      ? (info.licenses.length > 0 ? info.licenses : ["UNKNOWN"])
      : [info.licenses ?? "UNKNOWN"];
    for (const expression of expressions) {
      const text = String(expression);
      if (!licenseAllowed(text, pkg)) violations.push(`${pkg}: ${text}`);
    }
  }
  return violations;
}

// The drift test pins the [licenses] allow array against ALLOWED_LICENSES,
// but cargo-deny honors more policy in the same file: [licenses].exceptions
// re-allows a named crate, [[licenses.clarify]] rewrites an expression, and
// a single-quoted allow entry silently drops out of the mirror comparison
// (the pin matches double quotes only). All three would let the Rust half
// pass what the npm half rejects — exceptions are orchestrator decisions,
// never worker additions (review pr10, grok F1). Returns one line per
// problem; an empty array means the file carries no bypass.
//
// One exception is orchestrator-approved (decision 2026-09-25):
// webpki-root-certs (Mozilla root certificate data, via
// rustls-platform-verifier <- reqwest <- tauri) may carry
// CDLA-Permissive-2.0, a permissive data license. The pin below accepts
// exactly that (name, allow) pair and flags any other
// [[licenses.exceptions]] entry, so the exception cannot be widened
// silently.
export function denyTomlPolicyProblems(toml) {
  const problems = [];
  const start = toml.indexOf("[licenses]\n");
  const rest = start === -1 ? "" : toml.slice(start + "[licenses]\n".length);
  const nextSection = rest.search(/^\[/m);
  const sectionText = nextSection === -1 ? rest : rest.slice(0, nextSection);
  if (/^exceptions\s*=/m.test(sectionText)) {
    problems.push("[licenses].exceptions re-allows crates outside the allowlist");
  }
  for (const section of toml.split(/^(?=\[)/m)) {
    if (!section.startsWith("[[licenses.exceptions]]")) continue;
    const name = section.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? "";
    const allowMatch = section.match(/^allow\s*=\s*\[([\s\S]*?)\]/m);
    const allow = allowMatch
      ? [...allowMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
      : [];
    if (name !== "webpki-root-certs" || allow.length !== 1 || allow[0] !== "CDLA-Permissive-2.0") {
      problems.push(
        `[[licenses.exceptions]] for "${name || "(unnamed)"}" is not the approved webpki-root-certs / CDLA-Permissive-2.0 exception`,
      );
    }
  }
  if (/^\[\[licenses\.clarify\]\]/m.test(toml)) {
    problems.push("[[licenses.clarify]] rewrites license expressions");
  }
  const block = sectionText.match(/^allow = \[\n([\s\S]*?)\]/m);
  if (block && /'/.test(block[1])) {
    problems.push("single-quoted allow entries drop out of the mirror pin");
  }
  return problems;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/lib/license-check.mjs <report.json>");
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(file, "utf8"));
  const rootPkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const rootKey = `${rootPkg.name}@${rootPkg.version}`;
  // Fail closed on an empty or root-only scan: the checker can exit 0 with
  // `{}` when node_modules is incomplete, and "0 packages, all allowed"
  // would be a green gate over nothing (review pr10, grok F3).
  const thirdParty = Object.keys(report).filter((key) => key !== rootKey);
  if (thirdParty.length === 0) {
    console.error("license-check: report contains no third-party packages — incomplete scan (empty node_modules?), failing closed");
    process.exit(1);
  }
  const violations = evaluateLicenses(report, rootKey);
  if (violations.length > 0) {
    console.error("license-check: licenses outside the allowlist:");
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log(`license-check: ${thirdParty.length} production packages, all on the allowlist`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
