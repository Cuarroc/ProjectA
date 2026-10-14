#!/usr/bin/env bash
# Self-test for scripts/ci/windows-verdict.sh and the Windows partition lanes
# (AP-4a). The verdict must be red for everything but "all partitions green";
# the two partition lanes must together run exactly the gates of `windows`,
# with the Rust suite as nextest partitions 1/2 and 2/2 - otherwise the split
# would silently drop tests (green by absence).
set -uo pipefail
HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$HERE" || exit 1
fails=0

ok() { echo "ok   $*"; }
bad() { echo "FEHLER $*"; fails=$((fails + 1)); }

# verdict name expected-exit part-result lane-run
verdict() {
  PART_RESULT="$3" LANE_RUN="$4" bash scripts/ci/windows-verdict.sh > /dev/null 2>&1
  local got=$?
  if [ "$got" -eq "$2" ]; then ok "$1 (exit $got)"; else bad "$1: exit $got, expected $2"; fi
}

verdict verdict-green-when-all-partitions-passed 0 success true
verdict verdict-green-when-the-lane-was-not-needed 0 success false
verdict verdict-red-when-a-partition-failed 1 failure true
verdict verdict-red-when-a-failed-run-claims-not-needed 1 failure false
verdict verdict-red-when-a-partition-was-cancelled 1 cancelled true
verdict verdict-red-when-the-partitions-were-skipped 1 skipped true
verdict verdict-red-when-the-result-is-missing 1 "" true
verdict verdict-red-when-the-plan-output-is-missing 1 success ""

ids_of() { bash scripts/ci/gates.sh --list "$1" | sed -E 's/^rust-suite-[12]$/rust-suite/' | sort; }
if [ -n "$(ids_of windows_1)" ] && [ "$(ids_of windows)" = "$( { ids_of windows_1; ids_of windows_2; } | sort -u)" ]; then
  ok partitions-cover-the-windows-lane
else
  bad "windows_1 + windows_2 do not run exactly the gates of windows"
fi

list="$(bash scripts/ci/gates.sh --list)"
if grep -E '^rust-suite-1 ' <<< "$list" | grep -qF -- '--partition count:1/2' &&
  grep -E '^rust-suite-2 ' <<< "$list" | grep -qF -- '--partition count:2/2'; then
  ok partitions-are-1-of-2-and-2-of-2
else
  bad "rust-suite-1/2 are not nextest partitions count:1/2 and count:2/2"
fi

if [ "$fails" -gt 0 ]; then
  echo "test-windows-verdict: $fails Fehler"
  exit 1
fi
echo "test-windows-verdict: alle Faelle gruen"
