# Delta-Review LIC-01 round 3 — SPDX precedence parser + shell hardening

Context: LIC-01 adds a license gate (cargo-deny + npm license-checker against
a fixed allowlist). Round 2 found that flattening parentheses let
"(MIT OR Apache-2.0) AND GPL-3.0-only" pass via the MIT alternative. These
three NEW commits fix that with a recursive-descent SPDX parser (AND binds
tighter than OR, parentheses group, "X WITH Y" re-joined as one token,
malformed input fails closed), fail-closed empty license arrays, a
[licenses]-scoped drift-test regex, and shell hardening (`|| true` probe,
post-install re-verify):

- `3e2bec0 test(lic-01): parenthesized SPDX precedence, empty arrays, inference marker pins`
- `55f89db fix(ci): real SPDX precedence parsing and fail-closed empty arrays`
- `d522d66 chore(ci): harden cargo-deny probe and re-verify after install`

The allowlist itself is unchanged. The gate intentionally stays red on
webpki-root-certs (CDLA-Permissive-2.0) — an orchestrator decision item, not
part of this delta.

Check especially: can any disallowed license still slip through the parser
(precedence, WITH re-join, `*` strip, short-circuit evaluation consuming all
tokens, fail-closed paths)? No secrets. Red-first ordering kept?

Output format: findings with ID (F1, F2, ...), severity, file:line,
reasoning, verdict (approve / approve with conditions / reject).

```diff
diff --git a/scripts/ci/license-check.sh b/scripts/ci/license-check.sh
index 4478148..ea5cb2e 100755
--- a/scripts/ci/license-check.sh
+++ b/scripts/ci/license-check.sh
@@ -9,13 +9,23 @@ fails=0
 
 # --- Rust: cargo-deny -------------------------------------------------------
 DENY_VERSION="0.20.2"
-installed="$(cargo deny --version 2>/dev/null | awk '{print $NF}')"
+# `cargo deny --version` prints "cargo-deny <version>"; the version is the
+# last field. The probe may fail (tool missing) without aborting the script —
+# this file intentionally runs without `set -e` (kimi-k3 delta F2).
+installed="$(cargo deny --version 2>/dev/null | awk '{print $NF}' || true)"
 if [ "$installed" != "$DENY_VERSION" ]; then
   echo "license-check: cargo-deny $DENY_VERSION noetig (gefunden: ${installed:-nichts}) — installiere (kann Minuten dauern)"
   cargo install cargo-deny --locked --version "$DENY_VERSION" || {
     echo "license-check: cargo-deny konnte nicht installiert werden"
     exit 1
   }
+  # Re-verify: a shadowing cargo-deny earlier in PATH must not silently win
+  # (kimi-k3 delta F3).
+  installed="$(cargo deny --version 2>/dev/null | awk '{print $NF}' || true)"
+  if [ "$installed" != "$DENY_VERSION" ]; then
+    echo "license-check: nach der Installation meldet cargo deny: ${installed:-nichts} — falsches Binary im PATH?"
+    exit 1
+  fi
 fi
 ( cd "$ROOT/src-tauri" && cargo deny check licenses ) || fails=1
 
diff --git a/scripts/lib/license-check.mjs b/scripts/lib/license-check.mjs
index 93b24f1..10fff49 100644
--- a/scripts/lib/license-check.mjs
+++ b/scripts/lib/license-check.mjs
@@ -35,24 +35,75 @@ function tokenAllowed(token) {
   return ALLOWED.has(token.toUpperCase());
 }
 
-// SPDX choice semantics, matching cargo-deny: an OR expression passes when
-// one alternative is fully on the list; an AND conjunct passes only when
-// every part is. Parentheses are flattened (npm metadata expressions are
-// simple in practice); a trailing `*` is license-checker's "inferred from
-// file" marker, not part of the license id — stripped, but logged.
+// SPDX choice semantics with real precedence (AND binds tighter than OR,
+// parentheses group) — the same rules cargo-deny applies. A recursive-descent
+// parser instead of flat string splitting, because flattening "(MIT OR
+// Apache-2.0) AND GPL-3.0-only" would let the GPL conjunct slip through the
+// MIT alternative (review lic-01 delta, kimi-k3 F1 / glm-5.2 F1). Malformed
+// input fails closed (violation). A trailing `*` is license-checker's
+// "inferred from file" marker, not part of the license id — stripped, but
+// logged (kimi-k3 F8).
+function tokenize(expression) {
+  const spaced = String(expression).replace(/([()])/g, " $1 ").trim();
+  if (!spaced) return [];
+  const words = spaced.split(/\s+/);
+  const tokens = [];
+  for (let i = 0; i < words.length; i += 1) {
+    // "Apache-2.0 WITH LLVM-exception" is one SPDX token; re-join the WITH.
+    if (/^WITH$/i.test(words[i]) && tokens.length > 0 && i + 1 < words.length) {
+      tokens[tokens.length - 1] += ` WITH ${words[i + 1]}`;
+      i += 1;
+    } else {
+      tokens.push(words[i]);
+    }
+  }
+  return tokens;
+}
+
 function licenseAllowed(expression, pkg) {
-  const cleaned = String(expression).replace(/[()]/g, " ");
-  if (/\*/.test(cleaned)) {
+  if (/\*/.test(expression)) {
     console.error(`license-check: ${pkg}: "${expression}" was inferred from a file (* marker), verify by hand`);
   }
-  const alternatives = cleaned.split(/\s+OR\s+/i);
-  return alternatives.some((alt) => {
-    const parts = alt
-      .split(/\s+AND\s+/i)
-      .map((p) => p.trim().replace(/\*$/, ""))
-      .filter(Boolean);
-    return parts.length > 0 && parts.every(tokenAllowed);
-  });
+  const tokens = tokenize(expression);
+  if (tokens.length === 0) return false;
+  let pos = 0;
+  const parsePrimary = () => {
+    const token = tokens[pos];
+    if (token === "(") {
+      pos += 1;
+      const value = parseOr();
+      if (tokens[pos] !== ")") throw new Error("unbalanced parentheses");
+      pos += 1;
+      return value;
+    }
+    if (token === undefined || token === ")" || /^(OR|AND)$/i.test(token)) {
+      throw new Error(`unexpected token: ${token}`);
+    }
+    pos += 1;
+    return tokenAllowed(token.replace(/\*$/, ""));
+  };
+  const parseAnd = () => {
+    let value = parsePrimary();
+    while (/^AND$/i.test(tokens[pos] ?? "")) {
+      pos += 1;
+      value = parsePrimary() && value;
+    }
+    return value;
+  };
+  const parseOr = () => {
+    let value = parseAnd();
+    while (/^OR$/i.test(tokens[pos] ?? "")) {
+      pos += 1;
+      value = parseAnd() || value;
+    }
+    return value;
+  };
+  try {
+    const value = parseOr();
+    return pos === tokens.length && value;
+  } catch {
+    return false;
+  }
 }
 
 // report: license-checker JSON object { "name@version": { licenses: "..." } }.
@@ -63,8 +114,11 @@ export function evaluateLicenses(report, rootName) {
   for (const [pkg, info] of Object.entries(report)) {
     if (rootName && pkg.startsWith(`${rootName}@`)) continue;
     // license-checker may report an array (multiple license files found):
-    // conservatively every entry must be on the list.
-    const expressions = Array.isArray(info.licenses) ? info.licenses : [info.licenses ?? "UNKNOWN"];
+    // conservatively every entry must be on the list. An empty array is
+    // treated like a missing license (fail-closed, glm-5.2 delta F2).
+    const expressions = Array.isArray(info.licenses)
+      ? (info.licenses.length > 0 ? info.licenses : ["UNKNOWN"])
+      : [info.licenses ?? "UNKNOWN"];
     for (const expression of expressions) {
       const text = String(expression);
       if (!licenseAllowed(text, pkg)) violations.push(`${pkg}: ${text}`);
diff --git a/scripts/lib/license-check.test.mjs b/scripts/lib/license-check.test.mjs
index 5ab613a..9a0c410 100644
--- a/scripts/lib/license-check.test.mjs
+++ b/scripts/lib/license-check.test.mjs
@@ -53,20 +53,62 @@ test("lic-01: OR with one allowed alternative passes while AND requires all", ()
 
 // The mjs allowlist and src-tauri/deny.toml claim to mirror each other; pin
 // that so editing one without the other fails loudly. (Review lic-01,
-// kimi-k3 F3.)
+// kimi-k3 F3; section scoping: kimi-k3 delta F4.)
 test("lic-01: deny.toml allow list mirrors ALLOWED_LICENSES", () => {
   const toml = readFileSync(new URL("../../src-tauri/deny.toml", import.meta.url), "utf8");
-  const block = toml.match(/^allow = \[\n([\s\S]*?)\]/m);
+  const start = toml.indexOf("[licenses]\n");
+  assert.ok(start !== -1, "deny.toml has a [licenses] section");
+  const rest = toml.slice(start + "[licenses]\n".length);
+  const nextSection = rest.search(/^\[/m);
+  const sectionText = nextSection === -1 ? rest : rest.slice(0, nextSection);
+  const block = sectionText.match(/^allow = \[\n([\s\S]*?)\]/m);
   assert.ok(block, "deny.toml has an [licenses] allow array");
   const fromToml = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
   assert.deepEqual(fromToml, ALLOWED_LICENSES);
 });
 
 // license-checker sometimes reports licenses as an array instead of a
-// string. (Review lic-01, glm-5.2 F3.)
+// string. (Review lic-01, glm-5.2 F3; empty array + GPL element:
+// glm-5.2 delta F2, kimi-k3 delta F5.)
 test("lic-01: array-valued licenses are evaluated element-wise", () => {
   const report = { "arr@1.0.0": { licenses: ["MIT", "Apache-2.0"] } };
   assert.deepEqual(evaluateLicenses(report, "projecta"), []);
+  const bad = {
+    "arr-bad@1.0.0": { licenses: ["MIT", "GPL-3.0-only"] },
+    "arr-empty@1.0.0": { licenses: [] },
+  };
+  assert.deepEqual(evaluateLicenses(bad, "projecta"), [
+    "arr-bad@1.0.0: GPL-3.0-only",
+    "arr-empty@1.0.0: UNKNOWN",
+  ]);
+});
+
+// Parenthesized SPDX expressions must keep real precedence: flattening
+// "(MIT OR Apache-2.0) AND GPL-3.0-only" would wrongly pass via "MIT".
+// (Review lic-01 delta, kimi-k3 F1 / glm-5.2 F1.)
+test("lic-01: parentheses preserve SPDX precedence", () => {
+  const report = {
+    "smuggle@1.0.0": { licenses: "(MIT OR Apache-2.0) AND GPL-3.0-only" },
+    "grouped-ok@1.0.0": { licenses: "(MIT OR Apache-2.0) AND Zlib" },
+    "with-exc@1.0.0": { licenses: "Apache-2.0 WITH LLVM-exception" },
+    "grouped-with@1.0.0": { licenses: "(BSD-2-Clause OR Apache-2.0 WITH LLVM-exception) OR MIT" },
+  };
+  assert.deepEqual(evaluateLicenses(report, "projecta"), [
+    "smuggle@1.0.0: (MIT OR Apache-2.0) AND GPL-3.0-only",
+  ]);
+});
+
+// The `*` marker means license-checker inferred the license from a file.
+// It never changes the verdict: "MIT*" is MIT, "GPL-3.0-only*" stays
+// disallowed. (Review lic-01, kimi-k3 F8 / delta F5.)
+test("lic-01: inferred-license marker never changes the verdict", () => {
+  const report = {
+    "inferred-ok@1.0.0": { licenses: "MIT*" },
+    "inferred-bad@1.0.0": { licenses: "GPL-3.0-only*" },
+  };
+  assert.deepEqual(evaluateLicenses(report, "projecta"), [
+    "inferred-bad@1.0.0: GPL-3.0-only*",
+  ]);
 });
 
 test("lic-01: rejects a license outside the allowlist", () => {
```
