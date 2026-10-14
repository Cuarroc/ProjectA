#!/usr/bin/env bash
# Collect the JUnit files of a finished ci run for the Test Insights upload
# (.github/workflows/test-insights.yml). The artifact layout depends on the
# upload roots, so each file is looked up by name inside its artifact dir.
# A missing artifact dir (that ci job did not run) is a notice, not an error.
# Selftest: scripts/test-test-insights-pick.sh
# Usage: scripts/ci/test-insights-pick.sh <artifacts-dir> <reports-dir>
set -uo pipefail
src="${1:?artifacts dir}"
out="${2:?reports dir}"
mkdir -p "$out" || exit 1

pick() { # artifact-dir file-name target
  local f
  if [ ! -d "$src/$1" ]; then
    echo "::notice::no artifact $1 in this ci run"
    return 0
  fi
  # -quit instead of `| head`: no SIGPIPE under pipefail, and find errors
  # stay visible.
  f="$(find "$src/$1" -type f -name "$2" -print -quit)" || return 1
  if [ -n "$f" ]; then cp "$f" "$out/$3"; fi
}

pick junit-linux junit.xml linux-nextest.xml || exit 1
pick junit-linux vitest.xml linux-vitest.xml || exit 1
# AP-4a: one artifact per Windows nextest partition (matrix lane).
pick junit-windows_1 junit.xml windows-1-nextest.xml || exit 1
pick junit-windows_2 junit.xml windows-2-nextest.xml || exit 1
ls "$out"
