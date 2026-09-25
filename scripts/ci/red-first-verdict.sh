#!/usr/bin/env bash
# red-first-verdict.sh - turn the red-first steps of `gates (linux)` into the
# required check `red-first` (CI-03, 25.09.2026, docs/decisions.md).
#
# Why: until CI-03 `red-first` was its own job with its own setup (apt, Node,
# Rust, rust-cache, nextest, npm ci, Playwright - measured 1:21 min of a
# 3:17 min job on 25.09.). The linux job pays that setup anyway, so red-first
# now runs as two steps in it (plan and proof, both continue-on-error so the
# gates verdict stays separate). The job `red-first` only `needs: linux` and
# calls this script; the check name - required by the branch protection and
# by .mergify.yml - stays unchanged.
#
# Fail-closed: green only for
#   - plan success and count=0 (no Test-First evidence to prove), or
#   - plan success, count>0 and proof success.
# Everything else is red, including missing, skipped and cancelled values: a
# check that is green because red-first never ran would be "green by absence"
# (AGENTS.md). The gates verdict (LINUX_RESULT) does not decide this check -
# it is only reported, so a red gates run does not hide a green red-first
# and vice versa.
#
# Environment (from needs.linux.* in ci.yml):
#   LINUX_RESULT  needs.linux.result
#   RF_PLAN       outcome of the step "red-first - plan"
#   RF_COUNT      count= from `red-first.sh --plan`
#   RF_RUN        outcome of the step "red-first - proof against merge base"
#
# Self-test: scripts/test-red-first-verdict.sh
set -uo pipefail

LINUX_RESULT="${LINUX_RESULT:-}"
RF_PLAN="${RF_PLAN:-}"
RF_COUNT="${RF_COUNT:-}"
RF_RUN="${RF_RUN:-}"

echo "red-first verdict: gates (linux) result='$LINUX_RESULT', plan='$RF_PLAN', count='$RF_COUNT', proof='$RF_RUN'"
where="Details: job 'gates (linux)', steps 'red-first - plan' and 'red-first - proof against merge base'."

fail() {
  echo "::error title=red-first::$1"
  echo "$where"
  exit 1
}

case "$RF_PLAN" in
  success) ;;
  failure) fail "the red-first plan failed (a source change without a Test-First/Regression-For/No-Test trailer?)" ;;
  *) fail "the red-first plan did not complete (outcome '$RF_PLAN', gates (linux) '$LINUX_RESULT') - red-first unproven" ;;
esac

case "$RF_COUNT" in
  '' | *[!0-9]*) fail "the red-first plan reported no valid count ('$RF_COUNT') - red-first unproven" ;;
esac

if [ "$RF_COUNT" -eq 0 ]; then
  echo "red-first: no Test-First evidence in this PR - nothing to prove (the plan checked the trailers)."
  exit 0
fi

case "$RF_RUN" in
  success)
    echo "red-first: $RF_COUNT piece(s) of evidence proven against the merge base."
    exit 0
    ;;
  failure) fail "red-first failed: a Test-First test is not red at the merge base or not green at the head" ;;
  *) fail "red-first did not run although the plan found $RF_COUNT piece(s) of evidence (outcome '$RF_RUN', gates (linux) '$LINUX_RESULT')" ;;
esac
