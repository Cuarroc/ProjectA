#!/usr/bin/env bash
# windows-verdict.sh - turn the Windows partition jobs into the required check
# `gates (windows)` (AP-4a, measured critical path: docs/PLAN.md AP-4).
#
# The Windows lane runs as a matrix job `windows-part` (two nextest
# partitions); the job `windows` (name `gates (windows)`, the name branch
# protection and .mergify.yml wait for) only evaluates its combined result.
# Fail-closed like red-first-verdict.sh: green only for "every partition
# succeeded" and a plan output that says whether the lane was needed. Failed,
# cancelled, skipped or missing values are red - a skipped partition must not
# turn the check green by absence.
#
# Environment (from needs.windows-part.* in ci.yml):
#   PART_RESULT  needs.windows-part.result (all matrix legs combined)
#   LANE_RUN     needs.windows-part.outputs.lane_run (plan: true|false)
#
# Self-test: scripts/test-windows-verdict.sh
set -uo pipefail

PART_RESULT="${PART_RESULT:-}"
LANE_RUN="${LANE_RUN:-}"
echo "windows verdict: partitions result='$PART_RESULT', lane_run='$LANE_RUN'"

fail() {
  echo "::error title=gates (windows)::$1"
  echo "Details: job 'windows-part' (one leg per nextest partition)."
  exit 1
}

[ "$PART_RESULT" = success ] || fail "the Windows partitions did not all succeed (result '$PART_RESULT') - Windows unproven"
case "$LANE_RUN" in
  true) echo "gates (windows): all partitions green." ;;
  false) echo "gates (windows): lane not needed for this run (plan step of windows-part)." ;;
  *) fail "the plan reported no valid lane_run ('$LANE_RUN') - Windows unproven" ;;
esac
