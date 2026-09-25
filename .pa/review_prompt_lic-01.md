# Review LIC-01 — license audit for the public repository (ProjectA)

Task: make sure the public repo has no license problems. Candidate commits on
branch `claude/lic-01-license-audit` (base c60f267, the squashed public
release):

1. `chore: repair rustfmt drift and restore exec bits lost in the squash`
2. `test(lic-01): npm license evaluator against the approved allowlist`
3. `feat(ci): license gate for rust and npm dependencies plus third-party notices`

Approved license allowlist (user rule): MIT, Apache-2.0, Apache-2.0 WITH
LLVM-exception, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, Zlib, Unicode-3.0,
Unicode-DFS-2016, CC0-1.0, 0BSD, BSL-1.0, plus OFL-1.1 for fonts. Anything
else (GPL/AGPL/LGPL/SSPL/unknown) must be escalated, never silently excepted.

Evidence already produced: cargo-deny rejects only webpki-root-certs 1.0.9
(CDLA-Permissive-2.0) — deliberately left red as a "Needs decision" finding;
npm production tree (14 packages) is fully on the allowlist; fonts ship their
OFL license files; vendored skill packs ship LICENSE files except
claude-code-setup whose Apache LICENSE keeps the template copyright line.

Rules to check against: findings must be visible, not hidden; the new CI gate
must actually be able to fail; no secrets, no personal data in committed
files; shell scripts must be executable (100755); the test must be red on the
base and green on the head (red-first).

Full diff of the three commits against c60f267 follows.

Output format: findings with ID (F1, F2, ...), severity
(critical/high/medium/low), file:line, reasoning, and a verdict
(approve / approve with conditions / reject).

```diff
diff --git a/.githooks/commit-msg b/.githooks/commit-msg
old mode 100644
new mode 100755
diff --git a/.githooks/merge-hqdata b/.githooks/merge-hqdata
old mode 100644
new mode 100755
diff --git a/.githooks/post-merge b/.githooks/post-merge
old mode 100644
new mode 100755
diff --git a/.githooks/pre-commit b/.githooks/pre-commit
old mode 100644
new mode 100755
diff --git a/.githooks/pre-push b/.githooks/pre-push
old mode 100644
new mode 100755
diff --git a/scripts/ci/actions-pinned.sh b/scripts/ci/actions-pinned.sh
old mode 100644
new mode 100755
diff --git a/scripts/ci/ci-shape.sh b/scripts/ci/ci-shape.sh
old mode 100644
new mode 100755
diff --git a/scripts/ci/doctor.sh b/scripts/ci/doctor.sh
old mode 100644
new mode 100755
diff --git a/scripts/ci/gates.sh b/scripts/ci/gates.sh
old mode 100644
new mode 100755
index af906ea..f11872a
--- a/scripts/ci/gates.sh
+++ b/scripts/ci/gates.sh
@@ -102,6 +102,10 @@ GATES=(
   # Browser-Smoke des HQ. Kam am 12.09. auf main dazu.
   "hq-visual|linux,release|.|npm run test:hq:visual"
   "fe-build|linux,release|.|npm run build"
+  # LIC-01: Lizenzen aller Abhaengigkeiten (Rust + npm-Produktion) gegen die
+  # vom Nutzer freigegebene Positivliste. Nur linux: plattformunabhaengig,
+  # und cargo-deny braeuchte auf dem Windows-Job eine eigene Installation.
+  "licenses|linux,release|.|bash scripts/ci/license-check.sh"
   "e2e|linux,release|.|npm run test:e2e"
 
   # --- teuer: der Rust-Kern -----------------------------------------------
diff --git a/scripts/ci/lane-plan.sh b/scripts/ci/lane-plan.sh
old mode 100644
new mode 100755
diff --git a/scripts/ci/license-check.sh b/scripts/ci/license-check.sh
new file mode 100755
index 0000000..a8b6834
--- /dev/null
+++ b/scripts/ci/license-check.sh
@@ -0,0 +1,30 @@
+#!/usr/bin/env bash
+# LIC-01: license gate for the public repository (lane linux,release).
+# Both halves share one allowlist (scripts/lib/license-check.mjs and
+# src-tauri/deny.toml). A license outside the list fails the gate — the fix
+# is an orchestrator decision, not a local exception.
+set -uo pipefail
+ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
+fails=0
+
+# --- Rust: cargo-deny -------------------------------------------------------
+DENY_VERSION="0.20.2"
+if ! cargo deny --version >/dev/null 2>&1; then
+  echo "license-check: cargo-deny fehlt — installiere cargo-deny $DENY_VERSION (kann Minuten dauern)"
+  cargo install cargo-deny --locked --version "$DENY_VERSION" || {
+    echo "license-check: cargo-deny konnte nicht installiert werden"
+    exit 1
+  }
+fi
+( cd "$ROOT/src-tauri" && cargo deny check licenses ) || fails=1
+
+# --- npm production dependencies --------------------------------------------
+report="$(mktemp)"
+trap 'rm -f "$report"' EXIT
+( cd "$ROOT" && npx --yes license-checker-rseidelsohn --production --json ) > "$report" || {
+  echo "license-check: license-checker-rseidelsohn fehlgeschlagen"
+  exit 1
+}
+node "$ROOT/scripts/lib/license-check.mjs" "$report" || fails=1
+
+exit "$fails"
diff --git a/scripts/ci/native-tests.sh b/scripts/ci/native-tests.sh
old mode 100644
new mode 100755
diff --git a/scripts/ci/no-masked-output.sh b/scripts/ci/no-masked-output.sh
old mode 100644
new mode 100755
diff --git a/scripts/ci/prepush-lane.sh b/scripts/ci/prepush-lane.sh
old mode 100644
new mode 100755
diff --git a/scripts/ci/red-first-verdict.sh b/scripts/ci/red-first-verdict.sh
old mode 100644
new mode 100755
diff --git a/scripts/ci/red-first.sh b/scripts/ci/red-first.sh
old mode 100644
new mode 100755
diff --git a/scripts/ci/workflow-shell.sh b/scripts/ci/workflow-shell.sh
old mode 100644
new mode 100755
diff --git a/scripts/lib/license-check.mjs b/scripts/lib/license-check.mjs
new file mode 100644
index 0000000..444c0c8
--- /dev/null
+++ b/scripts/lib/license-check.mjs
@@ -0,0 +1,76 @@
+// scripts/lib/license-check.mjs
+// LIC-01: evaluates a license-checker-rseidelsohn JSON report against the
+// allowlist the user approved for the public repository. Exit 1 and one line
+// per violation when any package carries a license outside the list.
+//
+// Usage: node scripts/lib/license-check.mjs <report.json>
+// The report comes from: npx --yes license-checker-rseidelsohn --production --json
+
+import { readFileSync } from "node:fs";
+import { pathToFileURL } from "node:url";
+
+// The list is fixed by the LIC-01 assignment and mirrored in src-tauri/deny.toml.
+// Anything else (GPL/AGPL/LGPL/SSPL/unknown) is a finding for the
+// orchestrator, never a silent exception.
+export const ALLOWED_LICENSES = [
+  "MIT",
+  "Apache-2.0",
+  "Apache-2.0 WITH LLVM-exception",
+  "BSD-2-Clause",
+  "BSD-3-Clause",
+  "ISC",
+  "MPL-2.0",
+  "Zlib",
+  "Unicode-3.0",
+  "Unicode-DFS-2016",
+  "CC0-1.0",
+  "0BSD",
+  "BSL-1.0",
+  "OFL-1.1",
+];
+
+const ALLOWED = new Set(ALLOWED_LICENSES.map((l) => l.toUpperCase()));
+
+function licenseAllowed(expression) {
+  const parts = String(expression)
+    .replace(/[()]/g, " ")
+    .replace(/\*$/, "")
+    .split(/\s+(?:OR|AND)\s+/i)
+    .map((p) => p.trim().replace(/\*$/, ""))
+    .filter(Boolean);
+  return parts.length > 0 && parts.every((p) => ALLOWED.has(p.toUpperCase()));
+}
+
+// report: license-checker JSON object { "name@version": { licenses: "..." } }.
+// rootName: the project's own package name; its entry is skipped because the
+// repo license decision is tracked separately (LIC-01 "Needs decision").
+export function evaluateLicenses(report, rootName) {
+  const violations = [];
+  for (const [pkg, info] of Object.entries(report)) {
+    if (rootName && pkg.startsWith(`${rootName}@`)) continue;
+    const expression = String(info.licenses ?? "UNKNOWN");
+    if (!licenseAllowed(expression)) violations.push(`${pkg}: ${expression}`);
+  }
+  return violations;
+}
+
+function main() {
+  const file = process.argv[2];
+  if (!file) {
+    console.error("usage: node scripts/lib/license-check.mjs <report.json>");
+    process.exit(2);
+  }
+  const report = JSON.parse(readFileSync(file, "utf8"));
+  const rootName = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).name;
+  const violations = evaluateLicenses(report, rootName);
+  if (violations.length > 0) {
+    console.error("license-check: licenses outside the allowlist:");
+    for (const v of violations) console.error(`  ${v}`);
+    process.exit(1);
+  }
+  console.log(`license-check: ${Object.keys(report).length} production packages, all on the allowlist`);
+}
+
+if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
+  main();
+}
diff --git a/scripts/lib/license-check.test.mjs b/scripts/lib/license-check.test.mjs
new file mode 100644
index 0000000..f909bbc
--- /dev/null
+++ b/scripts/lib/license-check.test.mjs
@@ -0,0 +1,76 @@
+// scripts/lib/license-check.test.mjs
+import { test } from "node:test";
+import assert from "node:assert/strict";
+import { execFileSync } from "node:child_process";
+import { writeFileSync, mkdtempSync } from "node:fs";
+import { tmpdir } from "node:os";
+import { join, dirname } from "node:path";
+import { fileURLToPath } from "node:url";
+import { ALLOWED_LICENSES, evaluateLicenses } from "./license-check.mjs";
+
+const HERE = dirname(fileURLToPath(import.meta.url));
+
+test("lic-01: allowlist matches the user-approved license list", () => {
+  assert.deepEqual([...ALLOWED_LICENSES].sort(), [
+    "0BSD",
+    "Apache-2.0",
+    "Apache-2.0 WITH LLVM-exception",
+    "BSD-2-Clause",
+    "BSD-3-Clause",
+    "BSL-1.0",
+    "CC0-1.0",
+    "ISC",
+    "MIT",
+    "MPL-2.0",
+    "OFL-1.1",
+    "Unicode-3.0",
+    "Unicode-DFS-2016",
+    "Zlib",
+  ]);
+});
+
+test("lic-01: clean report yields no violations", () => {
+  const report = {
+    "react@18.3.1": { licenses: "MIT" },
+    "@tauri-apps/api@2.11.1": { licenses: "Apache-2.0 OR MIT" },
+    "mixed@1.0.0": { licenses: "(BSD-3-Clause OR Apache-2.0)" },
+  };
+  assert.deepEqual(evaluateLicenses(report, "projecta"), []);
+});
+
+test("lic-01: rejects a license outside the allowlist", () => {
+  const report = {
+    "ok@1.0.0": { licenses: "MIT" },
+    "bad@2.0.0": { licenses: "GPL-3.0-only" },
+    "unknown@3.0.0": { licenses: "UNKNOWN" },
+  };
+  const violations = evaluateLicenses(report, "projecta");
+  assert.deepEqual(violations, [
+    "bad@2.0.0: GPL-3.0-only",
+    "unknown@3.0.0: UNKNOWN",
+  ]);
+});
+
+test("lic-01: the project's own unlicensed root package is skipped", () => {
+  const report = { "projecta@1.4.1": { licenses: "UNLICENSED" } };
+  assert.deepEqual(evaluateLicenses(report, "projecta"), []);
+});
+
+test("lic-01: cli exits 1 and names the offending package", () => {
+  const dir = mkdtempSync(join(tmpdir(), "lic-check-"));
+  const file = join(dir, "report.json");
+  writeFileSync(file, JSON.stringify({ "bad@1.0.0": { licenses: "AGPL-3.0-only" } }));
+  let code = 0;
+  let out = "";
+  try {
+    out = execFileSync(process.execPath, [join(HERE, "license-check.mjs"), file], {
+      encoding: "utf8",
+      stdio: ["ignore", "pipe", "pipe"],
+    });
+  } catch (err) {
+    code = err.status;
+    out = `${err.stdout}${err.stderr}`;
+  }
+  assert.equal(code, 1);
+  assert.match(out, /bad@1\.0\.0: AGPL-3\.0-only/);
+});
diff --git a/scripts/test-actions-pinned.sh b/scripts/test-actions-pinned.sh
old mode 100644
new mode 100755
diff --git a/scripts/test-ci-shape.sh b/scripts/test-ci-shape.sh
old mode 100644
new mode 100755
diff --git a/scripts/test-gates.sh b/scripts/test-gates.sh
old mode 100644
new mode 100755
diff --git a/scripts/test-hook-root.sh b/scripts/test-hook-root.sh
old mode 100644
new mode 100755
diff --git a/scripts/test-hqdata-merge.sh b/scripts/test-hqdata-merge.sh
old mode 100644
new mode 100755
diff --git a/scripts/test-lane-plan.sh b/scripts/test-lane-plan.sh
old mode 100644
new mode 100755
diff --git a/scripts/test-no-masked-output.sh b/scripts/test-no-masked-output.sh
old mode 100644
new mode 100755
diff --git a/scripts/test-prepush-lane.sh b/scripts/test-prepush-lane.sh
old mode 100644
new mode 100755
diff --git a/scripts/test-red-first-dependabot.sh b/scripts/test-red-first-dependabot.sh
old mode 100644
new mode 100755
diff --git a/scripts/test-red-first-landed.sh b/scripts/test-red-first-landed.sh
old mode 100644
new mode 100755
diff --git a/scripts/test-red-first-mjs-filter.sh b/scripts/test-red-first-mjs-filter.sh
old mode 100644
new mode 100755
diff --git a/scripts/test-red-first-output.sh b/scripts/test-red-first-output.sh
old mode 100644
new mode 100755
diff --git a/scripts/test-red-first-verdict.sh b/scripts/test-red-first-verdict.sh
old mode 100644
new mode 100755
diff --git a/scripts/test-red-first-vitest-filter.sh b/scripts/test-red-first-vitest-filter.sh
old mode 100644
new mode 100755
diff --git a/scripts/test-red-first.sh b/scripts/test-red-first.sh
old mode 100644
new mode 100755
diff --git a/scripts/test-review-transport.sh b/scripts/test-review-transport.sh
old mode 100644
new mode 100755
diff --git a/scripts/test-workflow-shell.sh b/scripts/test-workflow-shell.sh
old mode 100644
new mode 100755
diff --git a/src-tauri/deny.toml b/src-tauri/deny.toml
new file mode 100644
index 0000000..35a639f
--- /dev/null
+++ b/src-tauri/deny.toml
@@ -0,0 +1,29 @@
+# LIC-01: license policy for the public repository.
+# Checked by `cargo deny check licenses` (gate `licenses`, scripts/ci/license-check.sh).
+# Anything not on this list is a finding for the orchestrator, not something a
+# worker may silently add an exception for.
+
+[licenses]
+confidence-threshold = 0.8
+allow = [
+  "MIT",
+  "Apache-2.0",
+  "Apache-2.0 WITH LLVM-exception",
+  "BSD-2-Clause",
+  "BSD-3-Clause",
+  "ISC",
+  "MPL-2.0",
+  "Zlib",
+  "Unicode-3.0",
+  "Unicode-DFS-2016",
+  "CC0-1.0",
+  "0BSD",
+  "BSL-1.0",
+  "OFL-1.1",
+]
+
+# The workspace crate `projecta` itself carries no license field yet — the
+# repo license is a LIC-01 "Needs decision" item. The gate's job here is the
+# third-party tree, so unpublished workspace crates are skipped.
+[licenses.private]
+ignore = true
diff --git a/src-tauri/src/skills.rs b/src-tauri/src/skills.rs
index 59024d0..72cf56e 100644
--- a/src-tauri/src/skills.rs
+++ b/src-tauri/src/skills.rs
@@ -418,7 +418,10 @@ mod tests {
             "ui-ux-pro-max missing from {ids:?}"
         );
         let pack = dev.join("ui-ux-pro-max");
-        assert!(pack.join("SKILL.md").is_file(), "SKILL.md missing from ui-ux-pro-max");
+        assert!(
+            pack.join("SKILL.md").is_file(),
+            "SKILL.md missing from ui-ux-pro-max"
+        );
         let skill = std::fs::read_to_string(pack.join("SKILL.md")).expect("read SKILL.md");
         let (name, description) = parse_front_matter(&skill);
         assert_eq!(name.as_deref(), Some("ui-ux-pro-max"));
```

docs/THIRD_PARTY_NOTICES.md is newly generated (23 KB, dependency lists);
its intro/structure, not every crate name, matters for the review:

```text
# Third-Party Notices

ProjectA bundles or depends on the third-party software listed below. Every
entry carries a license from the allowlist approved for this public
repository (`MIT, Apache-2.0 (WITH LLVM-exception), BSD-2/3-Clause, ISC,
MPL-2.0, Zlib, Unicode-3.0/Unicode-DFS-2016, CC0-1.0, 0BSD, BSL-1.0`, plus
`OFL-1.1` for fonts). The list is enforced in CI by the `licenses` gate
(`scripts/ci/license-check.sh`, policy in `src-tauri/deny.toml` and
`scripts/lib/license-check.mjs`).

Regenerate this file after dependency changes:

```sh
cd src-tauri && cargo deny list          # Rust section
npx --yes license-checker-rseidelsohn --production --json   # npm section
```

## Required notices (Attribution)

- **Inter font** (`public/fonts/Inter-*.otf`): SIL Open Font License 1.1.
  The license text ships next to the fonts as `public/fonts/INTER-LIZENZ.txt`.
  Copyright 2016-2023 The Inter Project Authors.
- **Recursive font** (`docs/dev-hq/fonts/recursive-latin-wght.woff2`): SIL
  Open Font License 1.1, license text next to it as `docs/dev-hq/fonts/OFL.txt`.
- **prompt-master** (`src-tauri/resources/prompt-master/`): MIT License,
  Copyright (c) 2026 Nidhin Joseph Nelson. License text: `LICENSE` in that
  directory.
- **taste-skill** (`src-tauri/resources/skills/taste-skill/`): MIT License,
  Copyright (c) 2026 Leonxlnx. License text: `LICENSE` in that directory.
- **unlazy** (`src-tauri/resources/skills/unlazy/`): MIT License,
  Copyright (c) 2026 Leonxlnx. License text: `LICENSE` in that directory.
- **claude-code-setup** (`src-tauri/resources/skills/claude-code-setup/`):
  Apache License 2.0. License text: `LICENSE` in that directory (the upstream
  copyright line is the unmodified Apache template; no NOTICE file ships
  upstream).
- **MPL-2.0 crates** (cssparser, cssparser-macros, dtoa-short, option-ext,
  selectors): used unmodified as compiled dependencies; their source is
  available on crates.io as required by MPL-2.0 §3.2.
- **Project-owned artwork**: `assets/banner.svg`, `src-tauri/icons/*` and the
  diagrams under `docs/dev-hq/concepts/` are original ProjectA artwork, not
  third-party material.

The placeholder skills under `src-tauri/resources/skills/` (karpathy-guidelines,
minimalist-skill, planning-with-files, ui-ux-pro-max, web-design-guidelines)
are intentionally *not* bundled third-party packs: each placeholder documents
why the pack is absent and ships no third-party content.

## npm production dependencies

| Package | License |
|---|---|
| @tauri-apps/api@2.11.1 | Apache-2.0 OR MIT |
| @tauri-apps/plugin-process@2.3.1 | MIT OR Apache-2.0 |
| @tauri-apps/plugin-updater@2.11.0 | MIT OR Apache-2.0 |
| @xterm/addon-canvas@0.7.0 | MIT |
| @xterm/addon-fit@0.10.0 | MIT |
| @xterm/addon-search@0.15.0 | MIT |
| @xterm/addon-webgl@0.18.0 | MIT |
| @xterm/xterm@5.5.0 | MIT |
| js-tokens@4.0.0 | MIT |
| loose-envify@1.4.0 | MIT |
| react-dom@18.3.1 | MIT |
| react@18.3.1 | MIT |
| scheduler@0.23.2 | MIT |

(The root package `projecta` itself is excluded; its own license is a LIC-01
decision item, see the PR.)

## Rust dependencies

Generated with `cargo deny list` (cargo-deny 0.20.2, see `src-tauri/deny.toml`).
Each line groups the crates that list the named license; crates under an
`OR` expression appear under every alternative, but only one needs to be on
the allowlist for the gate to pass. `LGPL-2.1-or-later` (r-efi), `MIT-0`
(dunce) and `Unlicense` (aho-corasick and others) below are such
alternatives of expressions that also offer an allowed license
(MIT/Apache-2.0/CC0-1.0) — ProjectA relies on the allowed alternative.
`CDLA-Permissive-2.0` (webpki-root-certs) is **not** on the allowlist and is
a LIC-01 "Needs decision" finding; the `licenses` gate fails until the
orchestrator decides.
```
