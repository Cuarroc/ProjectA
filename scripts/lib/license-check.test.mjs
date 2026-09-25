// scripts/lib/license-check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_LICENSES, denyTomlPolicyProblems, evaluateLicenses } from "./license-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("lic-01: allowlist matches the user-approved license list", () => {
  assert.deepEqual([...ALLOWED_LICENSES].sort(), [
    "0BSD",
    "Apache-2.0",
    "Apache-2.0 WITH LLVM-exception",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "BSL-1.0",
    "CC0-1.0",
    "ISC",
    "MIT",
    "MPL-2.0",
    "OFL-1.1",
    "Unicode-3.0",
    "Unicode-DFS-2016",
    "Zlib",
  ]);
});

test("lic-01: clean report yields no violations", () => {
  const report = {
    "react@18.3.1": { licenses: "MIT" },
    "@tauri-apps/api@2.11.1": { licenses: "Apache-2.0 OR MIT" },
    "mixed@1.0.0": { licenses: "(BSD-3-Clause OR Apache-2.0)" },
  };
  assert.deepEqual(evaluateLicenses(report, "projecta"), []);
});

// SPDX choice semantics, matching cargo-deny: one allowed OR alternative is
// enough; an AND conjunct off the list is a violation. (Review lic-01,
// glm-5.2 F1 / kimi-k3 F6.)
test("lic-01: OR with one allowed alternative passes while AND requires all", () => {
  const report = {
    "choice@1.0.0": { licenses: "MIT OR GPL-3.0-only" },
    "conjunct@1.0.0": { licenses: "MIT AND GPL-3.0-only" },
  };
  assert.deepEqual(evaluateLicenses(report, "projecta"), [
    "conjunct@1.0.0: MIT AND GPL-3.0-only",
  ]);
});

// The mjs allowlist and src-tauri/deny.toml claim to mirror each other; pin
// that so editing one without the other fails loudly. (Review lic-01,
// kimi-k3 F3; section scoping: kimi-k3 delta F4.)
test("lic-01: deny.toml allow list mirrors ALLOWED_LICENSES", () => {
  const toml = readFileSync(new URL("../../src-tauri/deny.toml", import.meta.url), "utf8");
  const start = toml.indexOf("[licenses]\n");
  assert.ok(start !== -1, "deny.toml has a [licenses] section");
  const rest = toml.slice(start + "[licenses]\n".length);
  const nextSection = rest.search(/^\[/m);
  const sectionText = nextSection === -1 ? rest : rest.slice(0, nextSection);
  const block = sectionText.match(/^allow = \[\n([\s\S]*?)\]/m);
  assert.ok(block, "deny.toml has an [licenses] allow array");
  const fromToml = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(fromToml, ALLOWED_LICENSES);
});

// license-checker sometimes reports licenses as an array instead of a
// string. (Review lic-01, glm-5.2 F3; empty array + GPL element:
// glm-5.2 delta F2, kimi-k3 delta F5.)
test("lic-01: array-valued licenses are evaluated element-wise", () => {
  const report = { "arr@1.0.0": { licenses: ["MIT", "Apache-2.0"] } };
  assert.deepEqual(evaluateLicenses(report, "projecta"), []);
  const bad = {
    "arr-bad@1.0.0": { licenses: ["MIT", "GPL-3.0-only"] },
    "arr-empty@1.0.0": { licenses: [] },
  };
  assert.deepEqual(evaluateLicenses(bad, "projecta"), [
    "arr-bad@1.0.0: GPL-3.0-only",
    "arr-empty@1.0.0: UNKNOWN",
  ]);
});

// Parenthesized SPDX expressions must keep real precedence: flattening
// "(MIT OR Apache-2.0) AND GPL-3.0-only" would wrongly pass via "MIT".
// (Review lic-01 delta, kimi-k3 F1 / glm-5.2 F1.)
test("lic-01: parentheses preserve SPDX precedence", () => {
  const report = {
    "smuggle@1.0.0": { licenses: "(MIT OR Apache-2.0) AND GPL-3.0-only" },
    "grouped-ok@1.0.0": { licenses: "(MIT OR Apache-2.0) AND Zlib" },
    "with-exc@1.0.0": { licenses: "Apache-2.0 WITH LLVM-exception" },
    "grouped-with@1.0.0": { licenses: "(BSD-2-Clause OR Apache-2.0 WITH LLVM-exception) OR MIT" },
  };
  assert.deepEqual(evaluateLicenses(report, "projecta"), [
    "smuggle@1.0.0: (MIT OR Apache-2.0) AND GPL-3.0-only",
  ]);
});

// The `*` marker means license-checker inferred the license from a file.
// It never changes the verdict: "MIT*" is MIT, "GPL-3.0-only*" stays
// disallowed. (Review lic-01, kimi-k3 F8 / delta F5.)
test("lic-01: inferred-license marker never changes the verdict", () => {
  const report = {
    "inferred-ok@1.0.0": { licenses: "MIT*" },
    "inferred-bad@1.0.0": { licenses: "GPL-3.0-only*" },
  };
  assert.deepEqual(evaluateLicenses(report, "projecta"), [
    "inferred-bad@1.0.0: GPL-3.0-only*",
  ]);
});

// The drift pin guards the allow array, but cargo-deny honors more policy in
// the same file: [licenses].exceptions re-allows a named crate,
// [[licenses.clarify]] rewrites an expression, and a single-quoted allow
// entry silently drops out of the mirror comparison (the pin matches double
// quotes only). All three would let the Rust half pass what the npm half
// rejects, so the real deny.toml must stay free of them and the detector is
// pinned against fixtures. (Review pr10, grok F1.)
test("lic-01: deny.toml policy bypasses are rejected", () => {
  const base = '[licenses]\nallow = [\n  "MIT",\n]\n';
  assert.deepEqual(denyTomlPolicyProblems(base), []);
  assert.ok(
    denyTomlPolicyProblems(`${base}exceptions = [{ allow = ["GPL-3.0-only"], name = "x", version = "*" }]\n`).length > 0,
    "[licenses].exceptions must be flagged",
  );
  assert.ok(
    denyTomlPolicyProblems(`${base}[[licenses.clarify]]\nname = "x"\nexpression = "MIT"\nlicense-files = []\n`).length > 0,
    "[[licenses.clarify]] must be flagged",
  );
  assert.ok(
    denyTomlPolicyProblems("[licenses]\nallow = [\n  'MIT',\n]\n").length > 0,
    "single-quoted allow entries must be flagged",
  );
  const toml = readFileSync(new URL("../../src-tauri/deny.toml", import.meta.url), "utf8");
  assert.deepEqual(denyTomlPolicyProblems(toml), []);
});

test("lic-01: rejects a license outside the allowlist", () => {
  const report = {
    "ok@1.0.0": { licenses: "MIT" },
    "bad@2.0.0": { licenses: "GPL-3.0-only" },
    "unknown@3.0.0": { licenses: "UNKNOWN" },
  };
  const violations = evaluateLicenses(report, "projecta");
  assert.deepEqual(violations, [
    "bad@2.0.0: GPL-3.0-only",
    "unknown@3.0.0: UNKNOWN",
  ]);
});

test("lic-01: the project's own unlicensed root package is skipped", () => {
  const report = { "projecta@1.4.1": { licenses: "UNLICENSED" } };
  assert.deepEqual(evaluateLicenses(report, "projecta@1.4.1"), []);
});

// The skip is tied to the exact root "name@version", not the name prefix:
// a production dependency that happens to share the root name at any other
// version is third-party code and must be evaluated. (Review pr10, grok F5.)
test("lic-01: the root skip is tied to the exact root name@version", () => {
  const report = { "projecta@9.9.9": { licenses: "GPL-3.0-only" } };
  assert.deepEqual(evaluateLicenses(report, "projecta@1.4.1"), [
    "projecta@9.9.9: GPL-3.0-only",
  ]);
});

test("lic-01: cli exits 1 and names the offending package", () => {
  const dir = mkdtempSync(join(tmpdir(), "lic-check-"));
  const file = join(dir, "report.json");
  writeFileSync(file, JSON.stringify({ "bad@1.0.0": { licenses: "AGPL-3.0-only" } }));
  let code = 0;
  let out = "";
  try {
    out = execFileSync(process.execPath, [join(HERE, "license-check.mjs"), file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    code = err.status;
    out = `${err.stdout}${err.stderr}`;
  }
  assert.equal(code, 1);
  assert.match(out, /bad@1\.0\.0: AGPL-3\.0-only/);
});

// An empty or root-only scan must never be green: the checker can exit 0
// with `{}` when node_modules is incomplete, and "0 packages, all allowed"
// would be a green gate over nothing. (Review pr10, grok F3.)
test("lic-01: cli fails closed on an empty or root-only report", () => {
  const dir = mkdtempSync(join(tmpdir(), "lic-check-"));
  for (const [label, report] of [
    ["empty", {}],
    ["root-only", { "projecta@1.4.1": { licenses: "UNLICENSED" } }],
  ]) {
    const file = join(dir, `${label}.json`);
    writeFileSync(file, JSON.stringify(report));
    let code = 0;
    let out = "";
    try {
      out = execFileSync(process.execPath, [join(HERE, "license-check.mjs"), file], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      code = err.status;
      out = `${err.stdout}${err.stderr}`;
    }
    assert.equal(code, 1, `${label} report must fail closed`);
    assert.match(out, /no third-party packages/);
  }
});

// Malformed expressions must fail closed, not crash green or pass by
// accident. (Review lic-01 delta2, kimi-k3 F3.)
test("lic-01: malformed expressions are violations", () => {
  for (const [pkg, expression] of [
    ["trailing-op@1.0.0", "MIT OR"],
    ["leading-op@1.0.0", "OR MIT"],
    ["trailing-and@1.0.0", "MIT AND"],
    ["unbalanced-open@1.0.0", "(MIT"],
    ["unbalanced-close@1.0.0", "MIT)"],
    ["empty-group@1.0.0", "()"],
    ["empty-string@1.0.0", ""],
    ["double-star@1.0.0", "MIT**"],
  ]) {
    assert.deepEqual(evaluateLicenses({ [pkg]: { licenses: expression } }, "projecta"), [
      `${pkg}: ${expression}`,
    ]);
  }
});

// license-checker also puts the inference marker on a whole parenthesized
// expression: "(MIT OR Apache-2.0)*" must behave like "(MIT OR Apache-2.0)"
// — strip the marker, keep the verdict — not become a violation. A group
// that is disallowed stays disallowed with the marker. (Review pr10, grok F6.)
test("lic-01: inference marker on a parenthesized group is stripped", () => {
  const report = {
    "grouped-inferred@1.0.0": { licenses: "(MIT OR Apache-2.0)*" },
    "grouped-inferred-bad@1.0.0": { licenses: "(MIT AND GPL-3.0-only)*" },
  };
  assert.deepEqual(evaluateLicenses(report, "projecta"), [
    "grouped-inferred-bad@1.0.0: (MIT AND GPL-3.0-only)*",
  ]);
});
