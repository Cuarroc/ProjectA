#!/usr/bin/env bash
# Exact Playwright title identity for root E2E and Denkraum red-first trailers.
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

# One public-boundary regression matrix: real Playwright discovery and execution.
mkdir -p "$PROBE/e2e"
write_root_cfg() {
  cat > "$PROBE/playwright.config.ts" <<EOF
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './e2e', retries: 0, reporter: 'list',$1 });
EOF
}
write_root_spec() { cat > "$PROBE/e2e/evidence.spec.ts"; }
write_root_cfg ''
SPEC='e2e/evidence.spec.ts::requested root test'
write_root_spec <<'EOF'
import { test } from '@playwright/test';
test('unrelated passing test', async () => {});
test('requested root test extra', async () => {});
EOF
expect_cls root-absent-title 1
write_root_spec <<'EOF'
import { test } from '@playwright/test';
test('requested root test', async () => {});
test('prefix requested root test', async () => { throw new Error('unrelated'); });
EOF
expect_cls root-exact-title 0
write_root_spec <<'EOF'
import { test } from '@playwright/test';
test.describe('first', () => { test('requested root test', async () => {}); });
test.describe('second', () => { test('requested root test', async () => {}); });
EOF
expect_cls root-ambiguous-leaf 2
write_root_spec <<'EOF'
import { test } from '@playwright/test';
test('requested root test', async () => {});
test('requested root test', async () => {});
EOF
expect_cls root-duplicate-title 2
write_root_spec <<'EOF'
import { test } from '@playwright/test';
test.describe('nested [group]', () => { test('requested root test', async () => {}); });
EOF
expect_cls root-nested-title 0
write_root_spec <<'EOF'
import { test } from '@playwright/test';
test('requested root test', async () => { throw new Error('expected failure'); });
EOF
expect_cls root-failing-title 1
# Legacy unnamed runs must remain red for a real failing test.
SPEC='e2e/evidence.spec.ts'
expect_cls root-unnamed-failing 1
SPEC='e2e/evidence.spec.ts::requested root test'
write_root_spec <<'EOF'
import { test } from '@playwright/test';
test.skip('requested root test', async () => {});
EOF
expect_cls root-skipped-title 2
write_root_spec <<'EOF'
import { test } from '@playwright/test';
throw new Error('discovery failure');
test('requested root test', async () => {});
EOF
expect_cls root-discovery-error 2
write_root_spec <<'EOF'
import { test } from '@playwright/test';
test('requested root test', async () => {});
EOF
write_root_cfg 'grepInvert: /requested root test/,'
expect_cls root-excluded-title 2
write_root_cfg "projects: [{ name: 'one' }, { name: 'two' }],"
expect_cls root-ambiguous-projects 2
write_root_cfg "projects: [{ name: 'chromium' }],"
expect_cls root-single-project 0
SPEC='e2e/evidence.spec.ts'
expect_cls root-legacy-unnamed 0
SPEC='e2e/evidence.spec.ts::literal [x].* (root) $HOME; $(false) `false` "quoted" \\ end'
write_root_spec <<'EOF'
import { test } from '@playwright/test';
test('literal [x].* (root) $HOME; $(false) `false` "quoted" \\\\ end', async () => {});
test('literal x anything', async () => { throw new Error('unrelated'); });
EOF
expect_cls root-literal-shell-and-regex-title 0
SPEC='e2e/evidence.spec.ts::requested root test'
set +e
classify_run "$no_tests" 1 "$SPEC"; cls_no=$?
set -e
if [ "$cls_no" -ne 2 ]; then echo "FAIL: root zero-selected want 2 got $cls_no" >&2; fail=1; fi
# A title containing a pass count is not a reporter summary.
SPEC='e2e/evidence.spec.ts::1 passed'
write_root_spec <<'EOF'
import { test } from '@playwright/test';
test.skip('1 passed', async () => {});
EOF
expect_cls root-skipped-pass-title 2
SPEC='e2e/evidence.spec.ts'
expect_cls root-unnamed-skipped-pass-title 1
write_root_cfg 'grep: /never selected/,'
expect_cls root-unnamed-zero-selected 1
write_root_cfg ''
SPEC='e2e/evidence.spec.ts::No tests found'
write_root_spec <<'EOF'
import { test } from '@playwright/test';
test('No tests found', async () => {});
EOF
expect_cls root-no-tests-found-title 0
SPEC='e2e/evidence.spec.ts'
expect_cls root-unnamed-no-tests-found-title 0
SPEC='tools/denkraum/evidence.spec.mjs::1 passed'
write_spec <<'EOF'
import { test } from '@playwright/test';
test.skip('1 passed', async () => {});
EOF
expect_cls denkraum-skipped-pass-title 2

expect_output_cls() {
  local label="$1" want="$2" cls
  if classify_run "$3" "$4" "$5"; then cls=0; else cls=$?; fi
  if [ "$cls" -ne "$want" ]; then
    echo "FAIL: $label want cls=$want got $cls" >&2; fail=1
  else echo "ok   $label"; fi
}
SPEC='e2e/evidence.spec.ts::requested root test'
executed=$'  ✓  1 e2e/evidence.spec.ts:2:1 › requested root test (1ms)\n'
# Synthetic single-unit durations from Playwright msToString, without long waits.
for duration in 1.1m 1.1h 1.1d; do
  expect_output_cls "named-duration-$duration" 0 "${executed/(1ms)/($duration)}"$'\n'"  1 passed ($duration)" 0 "$SPEC"
done
expect_output_cls named-ansi-cr-summary 0 "$executed"$'\n  \033[32m1 passed\033[0m (100ms)\r\n' 0 "$SPEC"
expect_output_cls named-eleven-passed-is-invalid 2 "$executed"$'\n  11 passed (1.2s)\n' 0 "$SPEC"
expect_output_cls named-title-token-is-invalid 2 "$executed"$'  - 1 passed extra\n' 0 "$SPEC"
expect_output_cls named-failure-status-stays-red 1 "$executed"$'\n  1 passed (1ms)\n' 1 "$SPEC"
expect_output_cls unnamed-ansi-cr-summary 0 $'  \033[32m12 passed\033[0m (1.2s)\r\n' 0 'e2e/evidence.spec.ts'
expect_output_cls unnamed-list-token-is-red 1 '  - 1 passed extra' 0 'e2e/evidence.spec.ts'
[ "$fail" -ne 0 ] || echo 'ok   playwright-summary-line-contract'

# Control only the external executable boundary; the real matrix above remains.
RF_LIST_HELPER="$(declare -f playwright_denkraum_list_unfiltered)"
export RF_LIST_HELPER
if python3 - "$PROBE" <<'PYTEST'
import os
from pathlib import Path
import subprocess
import sys

probe = Path(sys.argv[1])
assert not list(probe.rglob('red-first-list.*')), 'real Playwright left owned configs'
bin_dir = probe / "bin"
bin_dir.mkdir()
npx = bin_dir / "npx"
npx.write_text("""#!/usr/bin/env python3
import os, signal, sys
mode = os.environ['RF_MODE']
if mode in ('INT', 'TERM'):
    os.kill(os.getppid(), getattr(signal, 'SIG' + mode))
sys.exit({'normal': 0, 'error': 23, 'INT': 130, 'TERM': 143}[mode])
""")
npx.chmod(0o755)
mktemp = bin_dir / 'mktemp'
mktemp.write_text("""#!/usr/bin/env python3
import os, signal, subprocess, sys
if os.environ['RF_MODE'].startswith('early-'):
    os.kill(os.getppid(), getattr(signal, 'SIG' + os.environ['RF_MODE'][6:]))
sys.exit(subprocess.call(['/usr/bin/mktemp', *sys.argv[1:]]))
""")
mktemp.chmod(0o755)
driver = r'''
eval "$RF_LIST_HELPER"
trap 'printf outer-exit > "$RF_EXIT_PROOF"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
before="$(trap -p EXIT INT TERM)"
if playwright_denkraum_list_unfiltered e2e/evidence.spec.ts "$RF_CONFIG"; then
  code=0
else
  code=$?
fi
[ "$before" = "$(trap -p EXIT INT TERM)" ] || exit 99
exit "$code"
'''
failed = False
for config in ('playwright.config.ts', 'tools/denkraum/playwright.config.mjs'):
    for mode, expected in [('normal', 0), ('error', 23), ('INT', 130), ('TERM', 143),
                           ('early-INT', 130), ('early-TERM', 143)]:
        proof = probe / ('outer-exit-' + Path(config).suffix + '-' + mode)
        env = dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ['PATH'],
                   RF_MODE=mode, RF_CONFIG=config, RF_EXIT_PROOF=str(proof))
        result = subprocess.run(['bash', '-c', driver], cwd=probe, env=env, timeout=15)
        leftovers = list((probe / config).parent.glob('red-first-list.*'))
        if result.returncode != expected or not proof.exists() or leftovers:
            print(f'FAIL: cleanup {config} {mode}: status={result.returncode}, '
                  f'outer EXIT={proof.exists()}, remaining={len(leftovers)}', file=sys.stderr)
            failed = True
sys.exit(1 if failed else 0)
PYTEST
then echo 'ok   playwright-owned-config-lifecycle'
else fail=1; fi
[ "$fail" -ne 0 ] || echo 'ok   playwright-evidence-boundary-residuals'
# The named shell assertion is green only when the entire matrix passed.
[ "$fail" -ne 0 ] || echo 'ok   root-e2e-exact-title-contract'
[ "$fail" -eq 0 ] || exit 1
echo 'red-first playwright name filter classification: passed'
