#!/usr/bin/env bash
# Exact Playwright title identity for Denkraum red-first trailers.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source <(sed -n \
  -e '/^regex_escape() {/,/^}/p' \
  -e '/^playwright_title_in_source() {/,/^}/p' \
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
write_cfg ''
cat > "$PROBE/tools/denkraum/evidence.spec.mjs" <<'EOF'
import { test } from '@playwright/test';
test('existing test (root)', async () => {});
test('existing test root', async () => {});
EOF
ln -s "$ROOT/node_modules" "$PROBE/node_modules"

fail=0
set +e
out_exact="$(run_spec 'tools/denkraum/evidence.spec.mjs::existing test (root)' "$PROBE" "$PROBE/target" 2>&1)"
code_exact=$?
set -e
plain_exact="$(printf '%s\n' "$out_exact" | sed -E $'s/\033\\[[0-9;]*m//g')"
if ! printf '%s\n' "$plain_exact" | grep -F '› existing test (root)' >/dev/null; then
  echo 'FAIL: trailer existing test (root) did not run that exact Playwright title' >&2
  fail=1
elif ! classify_run "$out_exact" "$code_exact" 'tools/denkraum/evidence.spec.mjs::existing test (root)'; then
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

# R741-O1(a): only a longer title ending with the requested name.
cat > "$PROBE/tools/denkraum/evidence.spec.mjs" <<'EOF'
import { test } from '@playwright/test';
test('existing test (root) extra existing test (root)', async () => {});
EOF
set +e
out_suffix="$(run_spec 'tools/denkraum/evidence.spec.mjs::existing test (root)' "$PROBE" "$PROBE/target" 2>&1)"
code_suffix=$?
classify_run "$out_suffix" "$code_suffix" 'tools/denkraum/evidence.spec.mjs::existing test (root)'
cls_suffix=$?
set -e
if [ "$cls_suffix" -eq 0 ]; then
  echo 'FAIL: suffix-extra title was accepted as green for existing test (root)' >&2
  fail=1
else
  echo 'ok   playwright-rejects-suffix-extra-title'
fi

# R741-O1(b): exact + prefixed sibling must stay green (not false base-red).
cat > "$PROBE/tools/denkraum/evidence.spec.mjs" <<'EOF'
import { test } from '@playwright/test';
test('existing test (root)', async () => {});
test('prefix existing test (root)', async () => {});
EOF
set +e
out_prefix="$(run_spec 'tools/denkraum/evidence.spec.mjs::existing test (root)' "$PROBE" "$PROBE/target" 2>&1)"
code_prefix=$?
classify_run "$out_prefix" "$code_prefix" 'tools/denkraum/evidence.spec.mjs::existing test (root)'
cls_prefix=$?
set -e
if [ "$cls_prefix" -ne 0 ]; then
  echo 'FAIL: exact title with prefix sibling was not green (got '"$cls_prefix"')' >&2
  fail=1
else
  echo 'ok   playwright-exact-ignores-prefix-sibling'
fi

# R741-O2: grepInvert discovery miss is INVALID, not acceptable base red.
write_cfg $'\n  grepInvert: /existing test/,'
cat > "$PROBE/tools/denkraum/evidence.spec.mjs" <<'EOF'
import { test } from '@playwright/test';
test('existing test (root)', async () => {});
EOF
set +e
out_inv="$(run_spec 'tools/denkraum/evidence.spec.mjs::existing test (root)' "$PROBE" "$PROBE/target" 2>&1)"
code_inv=$?
classify_run "$out_inv" "$code_inv" 'tools/denkraum/evidence.spec.mjs::existing test (root)'
cls_inv=$?
set -e
if [ "$cls_inv" -ne 2 ]; then
  echo 'FAIL: grepInvert No tests found must be INVALID (2), got '"$cls_inv" >&2
  fail=1
else
  echo 'ok   playwright-grepinvert-discovery-is-invalid'
fi

no_tests=$'Error: No tests found\n'
set +e
classify_run "$no_tests" 1 'tools/denkraum/evidence.spec.mjs::existing test (root)'
cls_no=$?
set -e
if [ "$cls_no" -ne 2 ]; then
  echo 'FAIL: No tests found without absence proof must be INVALID (2), got '"$cls_no" >&2
  fail=1
fi
wrong=$'  ✓  1 tools/denkraum/evidence.spec.mjs:3:1 › existing test root (1ms)\n\n  1 passed (100ms)\n'
if classify_run "$wrong" 0 'tools/denkraum/evidence.spec.mjs::existing test (root)'; then
  echo 'FAIL: a near-matching Playwright pass line counted as the named test' >&2
  fail=1
fi
[ "$fail" -eq 0 ] || exit 1
echo 'red-first playwright name filter classification: passed'
