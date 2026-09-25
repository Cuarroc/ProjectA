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

// SPDX choice semantics, matching cargo-deny: an OR expression passes when
// one alternative is fully on the list; an AND conjunct passes only when
// every part is. Parentheses are flattened (npm metadata expressions are
// simple in practice); a trailing `*` is license-checker's "inferred from
// file" marker, not part of the license id — stripped, but logged.
function licenseAllowed(expression, pkg) {
  const cleaned = String(expression).replace(/[()]/g, " ");
  if (/\*/.test(cleaned)) {
    console.error(`license-check: ${pkg}: "${expression}" was inferred from a file (* marker), verify by hand`);
  }
  const alternatives = cleaned.split(/\s+OR\s+/i);
  return alternatives.some((alt) => {
    const parts = alt
      .split(/\s+AND\s+/i)
      .map((p) => p.trim().replace(/\*$/, ""))
      .filter(Boolean);
    return parts.length > 0 && parts.every(tokenAllowed);
  });
}

// report: license-checker JSON object { "name@version": { licenses: "..." } }.
// rootName: the project's own package name; its entry is skipped because the
// repo license decision is tracked separately (LIC-01 "Needs decision").
export function evaluateLicenses(report, rootName) {
  const violations = [];
  for (const [pkg, info] of Object.entries(report)) {
    if (rootName && pkg.startsWith(`${rootName}@`)) continue;
    // license-checker may report an array (multiple license files found):
    // conservatively every entry must be on the list.
    const expressions = Array.isArray(info.licenses) ? info.licenses : [info.licenses ?? "UNKNOWN"];
    for (const expression of expressions) {
      const text = String(expression);
      if (!licenseAllowed(text, pkg)) violations.push(`${pkg}: ${text}`);
    }
  }
  return violations;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/lib/license-check.mjs <report.json>");
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(file, "utf8"));
  const rootName = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).name;
  const violations = evaluateLicenses(report, rootName);
  if (violations.length > 0) {
    console.error("license-check: licenses outside the allowlist:");
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log(`license-check: ${Object.keys(report).length} production packages, all on the allowlist`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
