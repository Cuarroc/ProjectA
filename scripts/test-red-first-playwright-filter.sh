#!/usr/bin/env bash
# A Test-First trailer `tools/denkraum/*.spec.mjs::name` must select that
# exact Playwright title. Unescaped `-g` treats parentheses as regex groups, so
# `existing test (root)` can run `existing test root` instead and manufacture
# red-first evidence. This probe runs the live Denkraum Playwright arm.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source <(sed -n \
  -e '/^regex_escape() {/,/^}/p' \
  -e '/^node_name_run() {/,/^}/p' \
  -e '/^playwright_denkraum_name_run() {/,/^}/p' \
  -e '/^ensure_node_modules() {/,/^}/p' \
  -e '/^run_spec() {/,/^}/p' \
  -e '/^classify_run() {/,/^}/p' \
  "$ROOT/scripts/ci/red-first.sh")
declare -F run_spec classify_run >/dev/null
as_native_path() { printf '%s\n' "$1"; }
# Probe trees already link node_modules; never npm ci from the self-test.
ensure_node_modules() { :; }

PROBE="$(mktemp -d "${TMPDIR:-/tmp}/red-first-pw.XXXXXX")"
trap 'rm -rf "$PROBE"' EXIT
mkdir -p "$PROBE/tools/denkraum"
cat > "$PROBE/tools/denkraum/playwright.config.mjs" <<'EOF'
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.mjs',
  retries: 0,
  reporter: 'list',
  use: { browserName: 'chromium' },
});
EOF
cat > "$PROBE/tools/denkraum/evidence.spec.mjs" <<'EOF'
import { test } from '@playwright/test';
test('existing test (root)', async () => {});
test('existing test root', async () => {});
EOF
ln -s "$ROOT/node_modules" "$PROBE/node_modules"

run_named() {
  local name="$1" out code
  set +e
  out="$(run_spec "tools/denkraum/evidence.spec.mjs::$name" "$PROBE" "$PROBE/target" 2>&1)"
  code=$?
  set -e
  printf '%s\n' "$out"
  classify_run "$out" "$code" "tools/denkraum/evidence.spec.mjs::$name"
}

fail=0
set +e
out_exact="$(run_spec 'tools/denkraum/evidence.spec.mjs::existing test (root)' "$PROBE" "$PROBE/target" 2>&1)"
code_exact=$?
set -e
plain_exact="$(printf '%s\n' "$out_exact" | sed -E $'s/\033\\[[0-9;]*m//g')"
if ! printf '%s\n' "$plain_exact" | grep -F '› existing test (root)' >/dev/null; then
  echo 'FAIL: trailer existing test (root) did not run that exact Playwright title' >&2
  printf '%s\n' "$out_exact" | sed 's/^/    /' >&2
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
  printf '%s\n' "$out_near" | sed 's/^/    /' >&2
  fail=1
else
  echo 'ok   playwright-rejects-near-match-name'
fi

no_tests=$'Error: No tests found\n'
if classify_run "$no_tests" 1 'tools/denkraum/evidence.spec.mjs::existing test (root)'; then
  echo 'FAIL: No tests found was accepted as green for a named Playwright trailer' >&2
  fail=1
fi
wrong=$'  ✓  1 tools/denkraum/evidence.spec.mjs:3:1 › existing test root (1ms)\n\n  1 passed (100ms)\n'
if classify_run "$wrong" 0 'tools/denkraum/evidence.spec.mjs::existing test (root)'; then
  echo 'FAIL: a near-matching Playwright pass line counted as the named test' >&2
  fail=1
fi
[ "$fail" -eq 0 ] || exit 1
echo 'red-first playwright name filter classification: passed'
