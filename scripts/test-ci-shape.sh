#!/usr/bin/env bash
# Self-test for scripts/ci/ci-shape.sh (CI-03).
#
# ci-shape.sh guards the structure CI-03 relies on for cheap AND safe merges:
# the Windows lane can never go green on a non-Windows runner, red-first is
# evaluated from the steps inside `gates (linux)` instead of paying a second
# setup, the three required check names agree between ci.yml and
# .mergify.yml, and the Mergify queue/auto-merge lists stay identical.
#
# The real files must pass; every mutation below must fail - the detector has
# to be able to fail (AGENTS.md, rule 2).
set -uo pipefail

HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
SHAPE="${CI_SHAPE_SCRIPT:-$HERE/scripts/ci/ci-shape.sh}"
CI="$HERE/.github/workflows/ci.yml"
MG="$HERE/.mergify.yml"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/ci-shape.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
fails=0

[ -f "$SHAPE" ] || { echo "FEHLER: $SHAPE fehlt"; exit 1; }

# check name expected(pass|fail) ci mergify [reason-regex]
# A "fail" case must also fail for its OWN reason (review PR #149, kimi-k3
# F1): a mutated file that ci-shape cannot even read fails too, and would
# otherwise count as a caught mutation.
check() {
  local got
  if bash "$SHAPE" "$3" "$4" > "$tmp/out" 2>&1; then got=pass; else got=fail; fi
  if [ "$got" != "$2" ]; then
    echo "FEHLER $1: $got, expected $2"
    sed 's/^/    /' "$tmp/out"
    fails=$((fails + 1))
  elif [ -n "${5:-}" ] && ! grep -E -- "$5" "$tmp/out" > /dev/null; then
    echo "FEHLER $1: failed, but not for /$5/"
    sed 's/^/    /' "$tmp/out"
    fails=$((fails + 1))
  else
    echo "ok   $1 ($got)"
  fi
}

# mutate name file sed-expression -> $MUTATED; returns non-zero when the
# expression changed nothing. Not called in $( ): a subshell would swallow
# both the message and the failure count (review PR #149, kimi-k3 F1).
MUTATED=""
mutate() {
  MUTATED="$tmp/$1.${2##*.}"
  sed -E "$3" "$2" > "$MUTATED" || return 2
  ! cmp -s "$2" "$MUTATED"
}

# case_m name ci|mg sed-expression reason-regex: mutate ci.yml or
# .mergify.yml, expect ci-shape to fail for the given reason. A mutation that
# no longer changes anything is a stale test and fails loudly.
case_m() {
  local name="$1" which="$2" expr="$3" reason="$4" src
  if [ "$which" = ci ]; then src="$CI"; else src="$MG"; fi
  if ! mutate "$name" "$src" "$expr"; then
    echo "FEHLER $name: mutation changed nothing (stale test?)"
    fails=$((fails + 1))
    return
  fi
  if [ "$which" = ci ]; then
    check "$name" fail "$MUTATED" "$MG" "$reason"
  else
    check "$name" fail "$CI" "$MUTATED" "$reason"
  fi
}

check real-files pass "$CI" "$MG"

# The harness itself: a no-op mutation must be reported, not pass silently.
if mutate harness-noop "$CI" 's/NEVER_MATCHES_9f3c/x/'; then
  echo "FEHLER harness: a no-op mutation was not detected"
  fails=$((fails + 1))
else
  echo "ok   harness detects a no-op mutation"
fi

# ci.yml: the Windows job always on windows-latest again (PR runs pay the
# Windows rate) - not a safety bug, but the cost structure is gone.
case_m windows-runs-on-fixed ci '/^  windows:/,/^  [a-z-]+:$/ s/^(    runs-on:).*/\1 windows-latest/' \
  "runs-on must choose by event"
# ... and the same with the three words only in a trailing comment
# (review PR #149, kimi-k3 F2).
case_m windows-runs-on-comment-only ci '/^  windows:/,/^  [a-z-]+:$/ s/^(    runs-on:).*/\1 windows-latest # ubuntu-latest mergify\/merge-queue\//' \
  "runs-on must choose by event"
# ci.yml: the guard that turns "Windows lane would run on Linux" red is gone.
case_m windows-guard-missing ci "s/runner\\.os != 'Windows'/runner.os != 'Linux'/" \
  "guard"
# ... or replaced by a comment that merely quotes it (kimi-k3 F2).
case_m windows-guard-comment-only ci "/^      - name: Guard - the Windows lane only runs on Windows\$/,/^          exit 1\$/ c\\      # runner.os != 'Windows' (comment only)" \
  "guard"
# ... or weakened: no `exit 1`, so a runner mismatch would stay green.
case_m windows-guard-without-exit ci '/^      - name: Guard - the Windows lane only runs on Windows$/,/^      - name:/ { /^          exit 1$/d }' \
  "guard.*exit 1"
# ... or weakened: without the plan conjunct it no longer fires on a
# missing plan output the way the rest of the job reads it.
case_m windows-guard-without-plan ci "s/if: steps\\.plan\\.outputs\\.run != 'false' && runner\\.os != 'Windows'/if: runner.os != 'Windows'/" \
  "guard.*run != 'false'"
# ci.yml: red-first sets up its own toolchain again.
case_m red-first-own-setup ci '/^  red-first:/,$ s#^(      - uses: actions/checkout.*)#      - uses: ./.github/actions/setup-linux\n\1#' \
  "own setup-linux"
# ci.yml: red-first no longer waits for the linux job.
case_m red-first-without-needs ci '/^  red-first:/,$ s/^    needs: linux$/    needs: []/' \
  "'needs: linux' missing"
# ci.yml: the linux job no longer runs red-first.
case_m linux-without-red-first ci 's#bash scripts/ci/red-first\.sh$#true#' \
  "red-first - proof' missing"
# ci.yml: the proof would start on an empty count (review PR #149, glm-5.2 F2).
case_m red-first-proof-on-empty-count ci "s/ && steps\\.rf_plan\\.outputs\\.count != ''//g" \
  "count != ''"
# ci.yml: a required check renamed on one side only.
case_m check-renamed-in-ci ci 's/^    name: gates \(windows\)$/    name: gates (win)/' \
  "does not report 'gates \\(windows\\)'"
# .mergify.yml: auto_merge_conditions drift from queue_conditions.
case_m auto-merge-drift mg '/^  auto_merge_conditions:/,/^[a-z]/ { /check-success = red-first/d }' \
  "queue_conditions and auto_merge_conditions differ"
# .mergify.yml: a required check missing from merge_conditions.
case_m merge-condition-missing mg '/^    merge_conditions:/,/^[a-z]/ { /check-success = gates \(windows\)/d }' \
  "merge_conditions lacks 'check-success = gates \\(windows\\)'"
# ci.yml (CI-04): the main-red job no longer waits for both gate jobs.
case_m main-red-without-needs ci '/^  main-red:/,$ s/^    needs: \[linux, windows\]$/    needs: []/' \
  "main-red.*needs"
# ... or fires without always(), so a red gates job would skip the guard.
case_m main-red-without-always ci 's/if: \$\{\{ always\(\) &&/if: ${{/' \
  "main-red.*always"
# ... or is no longer bound to main (would fire on any ref).
case_m main-red-if-without-main ci "s#github\\.ref == 'refs/heads/main'#github.ref == 'refs/heads/qa'#" \
  "main-red.*refs/heads/main"
# ... or the lane_run output is gone - a light green push could unfreeze.
case_m main-red-without-lane-run ci '/^  linux:/,/^  windows:/ s/^      lane_run: .*$//' \
  "linux.*lane_run"
# ... same for the windows job (review predecessor PR, sonnet S-9).
case_m main-red-without-lane-run-windows ci '/^  windows:/,/^  red-first:/ s/^      lane_run: .*$//' \
  "windows.*lane_run"
# ... or inverted: != instead of == would fire on EVERY ref but main
# (review predecessor PR, S-9/O-10: a substring check lets this through).
case_m main-red-if-inverted ci "s#github\\.ref == 'refs/heads/main'#github.ref != 'refs/heads/main'#" \
  "main-red.*refs/heads/main"
# ... or the guard no longer reads the lane outputs - a light push would
# look like a full one (review predecessor PR, S-9).
case_m main-red-without-ran-wiring ci 's#\$\{\{ needs\.linux\.outputs\.lane_run \}\}#"true"#' \
  "main-red.*needs.linux.outputs.lane_run"
# ... or the guards race: without a job-level concurrency group a stale red
# run can freeze again after a newer green run lifted it (S-5/O-5).
case_m main-red-without-concurrency ci '/^  main-red:/,$ s/^      group: main-red-guard$//' \
  "main-red.*concurrency"

# Call errors are errors, not a silent pass.
check missing-file fail "$tmp/does-not-exist.yml" "$MG" "not found"

if [ "$fails" -gt 0 ]; then
  echo "test-ci-shape: $fails Fehler"
  exit 1
fi
echo "test-ci-shape: alle Faelle gruen"
