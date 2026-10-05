#!/usr/bin/env bash
# release-shape.sh - the structure release.yml relies on (v1.5.0 run
# 37338718635 died at gate `shellcheck`: the Windows job never installed it).
#   1. Every release-lane gate that needs a tool (TOOLS) finds its install in
#      windows-installer or the composite it uses.
#   2. Both jobs use that composite and run `gates.sh lane release`.
#   3. windows-installer: push only, keeps `environment: release`.
#   4. Every other job: no environment, no secret; the dry run is
#      workflow_dispatch only. Line-wise like ci-shape.sh (block-style YAML).
# Usage: release-shape.sh [release.yml] [action.yml]
# Self-test: scripts/test-release-shape.sh
set -uo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
WF="${1:-$ROOT/.github/workflows/release.yml}"
ACT="${2:-$ROOT/.github/actions/setup-windows-release/action.yml}"
COMPOSITE="uses: ./.github/actions/setup-windows-release"
errors=0

for f in "$WF" "$ACT"; do
  [ -f "$f" ] || { echo "::error::release-shape.sh: $f not found"; exit 2; }
done

err() {
  echo "::error::release-shape: $*"
  errors=$((errors + 1))
}

# gate id | extended regex the composite must contain
TOOLS=(
  "shellcheck|tool:.*shellcheck@"
  "actionlint|actionlint_.*windows_amd64"
  "licenses|tool:.*cargo-deny@"
  "rust-suite|tool:.*nextest"
  "e2e|playwright install chromium"
  "hq-visual|playwright install chromium"
)

nocomment() { grep -v -E '^[[:space:]]*#' "$1"; }
# grep <<< "$x", never printf | grep -q: under pipefail the early exit SIGPIPEs printf.

job() { # id -> lines of the job, without full-line comments
  nocomment "$WF" | awk -v id="$1" '
    $0 ~ "^  " id ":[[:space:]]*$" { on = 1; next }
    on && /^  [A-Za-z0-9_-]+:/ { exit }
    on { print }'
}

lane="$(bash "$ROOT/scripts/ci/gates.sh" --list release)" || { echo "::error::gates.sh --list release failed"; exit 2; }
[ -n "$lane" ] || { echo "::error::release lane is empty"; exit 2; }

# What the tag job installs: its own steps, plus the composite if it uses it.
setup="$(job windows-installer)"
grep -qF -- "$COMPOSITE" <<< "$setup" && setup="$setup
$(nocomment "$ACT")"
for entry in "${TOOLS[@]}"; do
  gate="${entry%%|*}"
  pattern="${entry#*|}"
  grep -qx -- "$gate" <<< "$lane" || continue
  grep -qE -- "$pattern" <<< "$setup" ||
    err "gate $gate is in the release lane, but windows-installer installs nothing matching /$pattern/"
done

jobs="$(nocomment "$WF" | awk '/^jobs:/ { on = 1; next } on && /^[^ ]/ { exit } on && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { sub(/:.*/, ""); sub(/^  /, ""); print }')"
for want in windows-installer release-gates-dry-run; do
  grep -qx -- "$want" <<< "$jobs" || err "job $want missing"
done

for j in windows-installer release-gates-dry-run; do
  body="$(job "$j")"
  grep -qF -- "$COMPOSITE" <<< "$body" || err "job $j does not use the shared setup ($COMPOSITE)"
  grep -qE 'run: bash scripts/ci/gates\.sh lane release[[:space:]]*$' <<< "$body" || err "job $j does not run gates.sh lane release"
done

inst="$(job windows-installer)"
grep -qE "^    if: github\.event_name == 'push'[[:space:]]*$" <<< "$inst" || err "windows-installer is not limited to push"
grep -qE '^    environment: release[[:space:]]*$' <<< "$inst" || err "windows-installer lost environment: release"
grep -qE "^    if: github\.event_name == 'workflow_dispatch'[[:space:]]*$" <<< "$(job release-gates-dry-run)" ||
  err "release-gates-dry-run is not limited to workflow_dispatch"

while IFS= read -r j; do
  [ -n "$j" ] && [ "$j" != windows-installer ] || continue
  body="$(job "$j")"
  grep -qE '^    environment:' <<< "$body" && err "job $j has an environment (only windows-installer may)"
  grep -qE 'secrets\.' <<< "$body" && err "job $j reads a secret (only windows-installer may)"
done <<< "$jobs"

if [ "$errors" -gt 0 ]; then
  echo "release-shape: $errors error(s)"
  exit 1
fi
echo "release-shape: tools for the release lane installed, dry run cannot sign or publish"
