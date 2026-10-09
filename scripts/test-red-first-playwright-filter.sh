#!/usr/bin/env bash
# Exact Playwright title identity for Denkraum red-first trailers (A1–A5 in red-first.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source <(sed -n \
  -e '/^regex_escape() {/,/^}/p' \
  -e '/^playwright_denkraum_list_unfiltered() {/,/^}/p' \
  -e '/^playwright_denkraum_resolve_identity() {/,/^}/p' \
  -e '/^node_name_run() {/,/^}/p' \
  -e '/^playwright_denkraum_name_run() {/,/^}/p' \
  -e '/^ensure_node_modules() {/,/^}/p' \
  -e '/^run_spec() {/,/^}/p' \
  -e '/^classify_run() {/,/^}/p' \
  "$ROOT/scripts/ci/red-first.sh")
declare -F run_spec classify_run >/dev/null
as_native_path() { printf '%s\n' "$1"; }
ensure_node_modules() { :; }
PROBE="$(mktemp -d "${TMPDIR:-/tmp}/red-first-pw.XXXXXX")"
trap 'rm -rf "$PROBE"' EXIT
mkdir -p "$PROBE/tools/denkraum"
write_cfg() {
  cat > "$PROBE/tools/denkraum/playwright.config.mjs" <<EOF
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: '**/*.spec.mjs', retries: 0, reporter: 'list',
  use: { browserName: 'chromium' },$1
});
EOF
}
write_spec() { cat > "$PROBE/tools/denkraum/evidence.spec.mjs"; }
ln -s "$ROOT/node_modules" "$PROBE/node_modules"
SPEC='tools/denkraum/evidence.spec.mjs::existing test (root)'
PROJ=$'\n  projects: [{ name: \'chromium\' }],'
fail=0
expect_cls() {
  local label="$1" want="$2" out code cls
  set +e
  out="$(run_spec "$SPEC" "$PROBE" "$PROBE/target" 2>&1)"; code=$?
  classify_run "$out" "$code" "$SPEC"; cls=$?
  set -e
  if [ "$cls" -ne "$want" ]; then echo "FAIL: $label want cls=$want got $cls" >&2; fail=1
  else echo "ok   $label"; fi
}

write_cfg ''
write_spec <<'EOF'
import { test } from '@playwright/test';
test('existing test (root)', async () => {});
test('existing test root', async () => {});
EOF
expect_cls playwright-literal-punctuation-name 0
set +e
out_near="$(run_spec 'tools/denkraum/evidence.spec.mjs::existing test' "$PROBE" "$PROBE/target" 2>&1)"
code_near=$?
set -e
if classify_run "$out_near" "$code_near" 'tools/denkraum/evidence.spec.mjs::existing test'; then
  echo 'FAIL: near-match title counted as named test' >&2; fail=1
else echo 'ok   playwright-rejects-near-match-name'; fi

write_spec <<'EOF'
import { test } from '@playwright/test';
test('existing test (root) extra existing test (root)', async () => {});
EOF
expect_cls playwright-rejects-suffix-extra-title 1
write_spec <<'EOF'
import { test } from '@playwright/test';
test('existing test (root)', async () => {});
test('prefix existing test (root)', async () => {});
EOF
expect_cls playwright-exact-ignores-prefix-sibling 0
write_cfg $'\n  grepInvert: /existing test/,'
write_spec <<'EOF'
import { test } from '@playwright/test';
test('existing test (root)', async () => {});
EOF
expect_cls playwright-grepinvert-discovery-is-invalid 2
write_cfg ''
write_spec <<'EOF'
import { test } from '@playwright/test';
test('existing test (root) (extra evidence.spec.mjs existing test (root)', async () => {});
EOF
expect_cls playwright-rejects-basename-embedded-title 1
write_spec <<'EOF'
import { test } from '@playwright/test';
test('existing test (root)', async () => {});
test('EXISTING TEST (ROOT)', async () => { throw new Error('fail'); });
EOF
expect_cls playwright-case-sibling-stays-green 0
write_cfg $'\n  grepInvert: /existing test/,'
write_spec <<'EOF'
import { test } from '@playwright/test';
test ('existing test (root)', async () => {});
EOF
expect_cls playwright-whitespace-decl-grepinvert-is-invalid 2

# A4: named project list prefix; O5: nested describe — both via › <leaf> suffix.
write_cfg "$PROJ"
write_spec <<'EOF'
import { test } from '@playwright/test';
test('existing test (root)', async () => {});
EOF
expect_cls playwright-project-chromium-pass-is-green 0
write_spec <<'EOF'
import { test } from '@playwright/test';
test('existing test (root)', async () => { throw new Error('x'); });
EOF
expect_cls playwright-project-chromium-fail-is-red 1
write_cfg ''
write_spec <<'EOF'
import { test } from '@playwright/test';
test.describe('group', () => { test('existing test (root)', async () => {}); });
EOF
expect_cls playwright-nested-describe-pass-is-green 0

# O4/A5: load/discovery failure → INVALID (2), never absence (1).
write_spec <<'EOF'
import { test } from '@playwright/test';
import './does-not-exist.mjs';
test('existing test (root)', async () => {});
EOF
expect_cls playwright-missing-import-is-invalid 2
write_spec <<'EOF'
import { test } from '@playwright/test';
throw new Error('boom');
test('existing test (root)', async () => {});
EOF
expect_cls playwright-toplevel-exception-is-invalid 2
write_spec <<'EOF'
import { test } from '@playwright/test';
test('existing test (root)', async () => {});
test('existing test (root)', async () => {});
EOF
expect_cls playwright-duplicate-title-is-invalid 2

no_tests=$'Error: No tests found\n'
set +e; classify_run "$no_tests" 1 "$SPEC"; cls_no=$?; set -e
if [ "$cls_no" -ne 2 ]; then echo "FAIL: No tests found → want 2 got $cls_no" >&2; fail=1; fi
wrong=$'  ✓  1 tools/denkraum/evidence.spec.mjs:3:1 › existing test root (1ms)\n\n  1 passed (100ms)\n'
if classify_run "$wrong" 0 "$SPEC"; then echo 'FAIL: near-match pass line counted' >&2; fail=1; fi
[ "$fail" -eq 0 ] || exit 1
echo 'red-first playwright name filter classification: passed'
