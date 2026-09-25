#!/usr/bin/env bash
# Self-test for scripts/ci/red-first-verdict.sh (CI-03).
#
# Since CI-03 red-first runs as steps inside `gates (linux)` (one setup
# instead of two); the `red-first` job only turns the outcome of those steps
# into the required check of the same name. This test pins that the verdict
# is fail-closed: only a clean plan with nothing to prove, or a clean plan
# plus a clean run, is green. Every missing, skipped or cancelled value is red
# - a check that is green because red-first never ran would be "green by
# absence" (AGENTS.md).
set -uo pipefail

HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
VERDICT="${RED_FIRST_VERDICT_SCRIPT:-$HERE/scripts/ci/red-first-verdict.sh}"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/rf-verdict.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
fails=0

[ -f "$VERDICT" ] || { echo "FEHLER: $VERDICT fehlt"; exit 1; }

# case name expected(pass|fail) linux_result plan_outcome count run_outcome
case_v() {
  local name="$1" want="$2" got
  if LINUX_RESULT="$3" RF_PLAN="$4" RF_COUNT="$5" RF_RUN="$6" bash "$VERDICT" > "$tmp/out" 2>&1; then
    got=pass
  else
    got=fail
  fi
  if [ "$got" = "$want" ]; then
    echo "ok   $name ($got)"
  else
    echo "FEHLER $name: $got, expected $want"
    sed 's/^/    /' "$tmp/out"
    fails=$((fails + 1))
  fi
}

# Green: nothing to prove, or proven.
case_v nothing-to-prove           pass success success 0 skipped
case_v proven                     pass success success 3 success
# The gates may fail while red-first passes - two separate checks.
case_v gates-red-red-first-green  pass failure success 2 success
case_v gates-red-nothing-to-prove pass failure success 0 skipped

# Red: the plan's trailer check failed, or the proof failed.
case_v plan-failed                fail success failure "" skipped
case_v run-failed                 fail success success 2 failure
# Red, fail-closed: red-first did not complete.
case_v setup-died-before-plan     fail failure "" "" ""
case_v run-skipped-with-evidence  fail success success 2 skipped
case_v run-cancelled              fail cancelled success 2 cancelled
case_v plan-skipped               fail success skipped "" skipped
case_v count-missing              fail success success "" skipped
case_v count-not-a-number         fail success success abc skipped
case_v all-empty                  fail "" "" "" ""

# The log names where the details are: the red-first steps of gates (linux).
LINUX_RESULT=success RF_PLAN=success RF_COUNT=2 RF_RUN=failure bash "$VERDICT" > "$tmp/out" 2>&1
if grep -F 'gates (linux)' "$tmp/out" > /dev/null; then
  echo "ok   failure-points-to-gates-linux"
else
  echo "FEHLER failure-points-to-gates-linux:"; sed 's/^/    /' "$tmp/out"; fails=$((fails + 1))
fi

if [ "$fails" -gt 0 ]; then
  echo "test-red-first-verdict: $fails Fehler"
  exit 1
fi
echo "test-red-first-verdict: alle Faelle gruen"
