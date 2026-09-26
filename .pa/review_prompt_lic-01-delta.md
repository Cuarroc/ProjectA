# Delta-Review LIC-01 — fixes after the first review round

Context: two reviewers (kimi-k3, glm-5.2) reviewed the LIC-01 license-audit
branch (verdict: approve with conditions). These two NEW commits address
their findings on `scripts/lib/license-check.mjs` and
`scripts/ci/license-check.sh`:

- `7bc68ef test(lic-01): SPDX OR/AND semantics, deny.toml drift guard, array licenses`
- `860be7e fix(ci): SPDX OR/AND semantics, pinned checker tools, inference marker logged`

Intended behavior (from the review findings): OR expressions pass when one
alternative is on the allowlist (cargo-deny parity); AND requires every part;
array-valued `licenses` are evaluated element-wise; license-checker's `*`
inference marker is logged; both external tools are pinned
(cargo-deny 0.20.2, license-checker-rseidelsohn 5.0.1, reinstall on version
mismatch). The allowlist itself is unchanged and pinned by a drift test
against src-tauri/deny.toml.

Check: does the diff implement exactly this, fail-closed, with no new ways to
smuggle a disallowed license through, no secrets, and correct red-first
ordering (test commit before fix commit)?

Output format: findings with ID (F1, F2, ...), severity, file:line,
reasoning, verdict (approve / approve with conditions / reject).

```diff
diff --git a/scripts/ci/license-check.sh b/scripts/ci/license-check.sh
index a8b6834..4478148 100755
--- a/scripts/ci/license-check.sh
+++ b/scripts/ci/license-check.sh
@@ -9,8 +9,9 @@ fails=0
 
 # --- Rust: cargo-deny -------------------------------------------------------
 DENY_VERSION="0.20.2"
-if ! cargo deny --version >/dev/null 2>&1; then
-  echo "license-check: cargo-deny fehlt — installiere cargo-deny $DENY_VERSION (kann Minuten dauern)"
+installed="$(cargo deny --version 2>/dev/null | awk '{print $NF}')"
+if [ "$installed" != "$DENY_VERSION" ]; then
+  echo "license-check: cargo-deny $DENY_VERSION noetig (gefunden: ${installed:-nichts}) — installiere (kann Minuten dauern)"
   cargo install cargo-deny --locked --version "$DENY_VERSION" || {
     echo "license-check: cargo-deny konnte nicht installiert werden"
     exit 1
@@ -19,9 +20,12 @@ fi
 ( cd "$ROOT/src-tauri" && cargo deny check licenses ) || fails=1
 
 # --- npm production dependencies --------------------------------------------
+# Pinned tool version: a compliance gate must not depend on whatever the
+# registry serves as "latest" that day (review lic-01, kimi-k3 F2).
+CHECKER_VERSION="5.0.1"
 report="$(mktemp)"
 trap 'rm -f "$report"' EXIT
-( cd "$ROOT" && npx --yes license-checker-rseidelsohn --production --json ) > "$report" || {
+( cd "$ROOT" && npx --yes "license-checker-rseidelsohn@$CHECKER_VERSION" --production --json ) > "$report" || {
   echo "license-check: license-checker-rseidelsohn fehlgeschlagen"
   exit 1
 }
diff --git a/scripts/lib/license-check.mjs b/scripts/lib/license-check.mjs
index 444c0c8..93b24f1 100644
--- a/scripts/lib/license-check.mjs
+++ b/scripts/lib/license-check.mjs
@@ -31,14 +31,28 @@ export const ALLOWED_LICENSES = [
 
 const ALLOWED = new Set(ALLOWED_LICENSES.map((l) => l.toUpperCase()));
 
-function licenseAllowed(expression) {
-  const parts = String(expression)
-    .replace(/[()]/g, " ")
-    .replace(/\*$/, "")
-    .split(/\s+(?:OR|AND)\s+/i)
-    .map((p) => p.trim().replace(/\*$/, ""))
-    .filter(Boolean);
-  return parts.length > 0 && parts.every((p) => ALLOWED.has(p.toUpperCase()));
+function tokenAllowed(token) {
+  return ALLOWED.has(token.toUpperCase());
+}
+
+// SPDX choice semantics, matching cargo-deny: an OR expression passes when
+// one alternative is fully on the list; an AND conjunct passes only when
+// every part is. Parentheses are flattened (npm metadata expressions are
+// simple in practice); a trailing `*` is license-checker's "inferred from
+// file" marker, not part of the license id — stripped, but logged.
+function licenseAllowed(expression, pkg) {
+  const cleaned = String(expression).replace(/[()]/g, " ");
+  if (/\*/.test(cleaned)) {
+    console.error(`license-check: ${pkg}: "${expression}" was inferred from a file (* marker), verify by hand`);
+  }
+  const alternatives = cleaned.split(/\s+OR\s+/i);
+  return alternatives.some((alt) => {
+    const parts = alt
+      .split(/\s+AND\s+/i)
+      .map((p) => p.trim().replace(/\*$/, ""))
+      .filter(Boolean);
+    return parts.length > 0 && parts.every(tokenAllowed);
+  });
 }
 
 // report: license-checker JSON object { "name@version": { licenses: "..." } }.
@@ -48,8 +62,13 @@ export function evaluateLicenses(report, rootName) {
   const violations = [];
   for (const [pkg, info] of Object.entries(report)) {
     if (rootName && pkg.startsWith(`${rootName}@`)) continue;
-    const expression = String(info.licenses ?? "UNKNOWN");
-    if (!licenseAllowed(expression)) violations.push(`${pkg}: ${expression}`);
+    // license-checker may report an array (multiple license files found):
+    // conservatively every entry must be on the list.
+    const expressions = Array.isArray(info.licenses) ? info.licenses : [info.licenses ?? "UNKNOWN"];
+    for (const expression of expressions) {
+      const text = String(expression);
+      if (!licenseAllowed(text, pkg)) violations.push(`${pkg}: ${text}`);
+    }
   }
   return violations;
 }
diff --git a/scripts/lib/license-check.test.mjs b/scripts/lib/license-check.test.mjs
index f909bbc..5ab613a 100644
--- a/scripts/lib/license-check.test.mjs
+++ b/scripts/lib/license-check.test.mjs
@@ -2,7 +2,7 @@
 import { test } from "node:test";
 import assert from "node:assert/strict";
 import { execFileSync } from "node:child_process";
-import { writeFileSync, mkdtempSync } from "node:fs";
+import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
 import { tmpdir } from "node:os";
 import { join, dirname } from "node:path";
 import { fileURLToPath } from "node:url";
@@ -38,6 +38,37 @@ test("lic-01: clean report yields no violations", () => {
   assert.deepEqual(evaluateLicenses(report, "projecta"), []);
 });
 
+// SPDX choice semantics, matching cargo-deny: one allowed OR alternative is
+// enough; an AND conjunct off the list is a violation. (Review lic-01,
+// glm-5.2 F1 / kimi-k3 F6.)
+test("lic-01: OR with one allowed alternative passes while AND requires all", () => {
+  const report = {
+    "choice@1.0.0": { licenses: "MIT OR GPL-3.0-only" },
+    "conjunct@1.0.0": { licenses: "MIT AND GPL-3.0-only" },
+  };
+  assert.deepEqual(evaluateLicenses(report, "projecta"), [
+    "conjunct@1.0.0: MIT AND GPL-3.0-only",
+  ]);
+});
+
+// The mjs allowlist and src-tauri/deny.toml claim to mirror each other; pin
+// that so editing one without the other fails loudly. (Review lic-01,
+// kimi-k3 F3.)
+test("lic-01: deny.toml allow list mirrors ALLOWED_LICENSES", () => {
+  const toml = readFileSync(new URL("../../src-tauri/deny.toml", import.meta.url), "utf8");
+  const block = toml.match(/^allow = \[\n([\s\S]*?)\]/m);
+  assert.ok(block, "deny.toml has an [licenses] allow array");
+  const fromToml = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
+  assert.deepEqual(fromToml, ALLOWED_LICENSES);
+});
+
+// license-checker sometimes reports licenses as an array instead of a
+// string. (Review lic-01, glm-5.2 F3.)
+test("lic-01: array-valued licenses are evaluated element-wise", () => {
+  const report = { "arr@1.0.0": { licenses: ["MIT", "Apache-2.0"] } };
+  assert.deepEqual(evaluateLicenses(report, "projecta"), []);
+});
+
 test("lic-01: rejects a license outside the allowlist", () => {
   const report = {
     "ok@1.0.0": { licenses: "MIT" },
```
