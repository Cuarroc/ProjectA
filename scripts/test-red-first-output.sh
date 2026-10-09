#!/usr/bin/env bash
# Exercise the actual classifier without executing the CI checkout/test driver.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source <(sed -n '/^classify_run() {/,/^}/p' "$ROOT/scripts/ci/red-first.sh")
declare -F classify_run >/dev/null

# Larger than a pipe buffer, with the decisive line first: a quiet grep exits
# before printf finishes and turns a success into SIGPIPE under pipefail.
printf -v padding '%1048576s' ''
green=$'test result: ok. 74 passed; 0 failed; 0 ignored\n'"$padding"
if ! classify_run "$green" 0 src-tauri/src/main.rs; then
  echo 'FAIL: long successful Rust output was rejected' >&2
  exit 1
fi
if classify_run "$green" 1 src-tauri/src/main.rs; then
  echo 'FAIL: nonzero test exit was accepted' >&2
  exit 1
fi
if classify_run 'test result: ok. 0 passed; 0 failed' 0 src-tauri/src/main.rs; then
  echo 'FAIL: Rust zero-test output was accepted' >&2
  exit 1
fi
if classify_run 'test result: ok. 0 passed; 0 failed' 0 tests::behavior_is_new; then
  echo 'FAIL: module-qualified Rust zero-test output was accepted' >&2
  exit 1
fi
if ! classify_run "$green" 0 tests::behavior_is_new; then
  echo 'FAIL: module-qualified Rust success was rejected' >&2
  exit 1
fi
if ! classify_run 'red-first: src-tauri/src/db_restore_safety_tests.rs plattformbedingt uebersprungen' 0 src-tauri/src/db_restore_safety_tests.rs; then
  echo 'FAIL: platform-gated Rust source was rejected when skipped' >&2
  exit 1
fi
for entry in 'src/example.test.ts|No test files found' 'scripts/example.test.mjs|ℹ tests 0'; do
  path="${entry%%|*}"
  missing="${entry#*|}"$'\n'"$padding"
  if classify_run "$missing" 0 "$path"; then
    echo "FAIL: long zero-test output was accepted for $path" >&2
    exit 1
  fi
done
shell_output=$'ok   linux/other-case (run=false)\nok   linux/named-case (run=false)'
if ! classify_run "$shell_output" 0 'scripts/example.sh::linux/named-case'; then
  echo 'FAIL: named shell assertion was rejected' >&2
  exit 1
fi
if classify_run "$shell_output" 0 'scripts/example.sh::linux/missing-case'; then
  echo 'FAIL: missing named shell assertion was accepted from a green suite' >&2
  exit 1
fi
if ! classify_run $'ok   literal[case].*\r' 0 'scripts/example.sh::literal[case].*'; then
  echo 'FAIL: literal shell assertion with CRLF was rejected' >&2
  exit 1
fi
for malformed in \
  'ok   linux/named-case (' \
  $'ok   linux/named-case (run=false)\rFAIL' \
  $'ok   linux/named-case (run=false\033[31m)'; do
  if classify_run "$malformed" 0 'scripts/example.sh::linux/named-case'; then
    echo "FAIL: malformed named shell assertion was accepted: $(printf %q "$malformed")" >&2
    exit 1
  fi
done
echo 'ok   shell-named-record-validation (strict records)'
if ! classify_run 'suite passed' 0 scripts/example.sh; then
  echo 'FAIL: unnamed shell suite success was rejected' >&2
  exit 1
fi
bash "$ROOT/scripts/test-red-first-vitest-filter.sh"
bash "$ROOT/scripts/test-red-first-mjs-filter.sh"
bash "$ROOT/scripts/test-red-first-playwright-filter.sh"
echo 'red-first output classification: passed'
