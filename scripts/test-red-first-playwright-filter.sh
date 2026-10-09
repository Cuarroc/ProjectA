#!/usr/bin/env bash
# Exact Playwright title identity for Denkraum red-first trailers (A1–A3 in red-first.sh).
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
set +e
out_exact="$(run_spec "$SPEC" "$PROBE" "$PROBE/target" 2>&1)"
code_exact=$?
set -e
plain_exact="$(printf '%s\n' "$out_exact" | sed -E $'s/\033\\[[0-9;]*m//g')"
if ! printf '%s\n' "$plain_exact" | grep -F '› existing test (root)' >/dev/null; then
  echo 'FAIL: trailer existing test (root) did not run that exact Playwright title' >&2
  fail=1
elif ! classify_run "$out_exact" "$code_exact" "$SPEC"; then
  echo 'FAIL: exact punctuation title existing test (root) was not classified green' >&2
  fail=1
else
  echo 'ok   playwright-literal-punctuation-name'
fi

set +e
out_near="$(run_spec 'tools/denkraum/evidence.spec.mjs::existing test' "$PROBE" "$PROBE/target" 2>&1)"
code_near=$?
set -e
if classify_run "$out_near" "$code_near" 'tools/denkraum/evidence.spec.mjs::existing test'; then
  echo 'FAIL: a near-match / prefix title counted as the named Playwright test' >&2
  fail=1
else
  echo 'ok   playwright-rejects-near-match-name'
fi

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

no_tests=$'Error: No tests found\n'
set +e
classify_run "$no_tests" 1 "$SPEC"
cls_no=$?
set -e
if [ "$cls_no" -ne 2 ]; then
  echo 'FAIL: No tests found without absence proof must be INVALID (2), got '"$cls_no" >&2
  fail=1
fi
wrong=$'  ✓  1 tools/denkraum/evidence.spec.mjs:3:1 › existing test root (1ms)\n\n  1 passed (100ms)\n'
if classify_run "$wrong" 0 "$SPEC"; then
  echo 'FAIL: a near-matching Playwright pass line counted as the named test' >&2
  fail=1
fi
[ "$fail" -eq 0 ] || exit 1
echo 'red-first playwright name filter classification: passed'
