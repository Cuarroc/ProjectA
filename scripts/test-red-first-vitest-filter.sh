#!/usr/bin/env bash
# A Test-First trailer `path::name` runs `vitest run path -t name`. When the
# name does not exist yet (the merge base of a real Test-First commit), Vitest
# skips every test and still exits 0. That run proved nothing, so red-first
# must count it as red, exactly as it already does for a Rust name that
# matches no test. Output is copied from Vitest 4.1 in CI (ANSI included).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source <(sed -n '/^classify_run() {/,/^}/p' "$ROOT/scripts/ci/red-first.sh")
declare -F classify_run >/dev/null

esc=$'\033'
skipped_all=" ${esc}[2m Test Files ${esc}[22m ${esc}[1m${esc}[33m1 skipped${esc}[39m${esc}[22m${esc}[90m (1)${esc}[39m
${esc}[2m      Tests ${esc}[22m ${esc}[1m${esc}[33m3 skipped${esc}[39m${esc}[22m${esc}[90m (3)${esc}[39m"
one_passed=" ${esc}[2m Test Files ${esc}[22m ${esc}[1m${esc}[32m1 passed${esc}[39m${esc}[22m${esc}[90m (1)${esc}[39m
${esc}[2m      Tests ${esc}[22m ${esc}[1m${esc}[32m1 passed${esc}[39m${esc}[22m | ${esc}[33m4 skipped${esc}[39m${esc}[90m (5)${esc}[39m"
plain_skipped=' Test Files  1 skipped (1)
      Tests  3 skipped (3)'
whole_file=' Test Files  1 passed (1)
      Tests  7 passed (7)'

fail=0
if classify_run "$skipped_all" 0 'src/components/TabBar.test.tsx::a name that is new'; then
  echo 'FAIL: a Vitest run that skipped every test counted as green (ANSI output)' >&2
  fail=1
fi
if classify_run "$plain_skipped" 0 'src/lib/tabs.test.ts::a name that is new'; then
  echo 'FAIL: a Vitest run that skipped every test counted as green (plain output)' >&2
  fail=1
fi
if ! classify_run "$one_passed" 0 'src/components/TabBar.test.tsx::the tab is a button'; then
  echo 'FAIL: a filtered Vitest run with one passing test was rejected' >&2
  fail=1
fi
if ! classify_run "$whole_file" 0 'src/components/TabBar.test.tsx'; then
  echo 'FAIL: a whole-file Vitest run with passing tests was rejected' >&2
  fail=1
fi
[ "$fail" -eq 0 ] || exit 1
echo 'red-first vitest filter classification: passed'
