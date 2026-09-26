#!/usr/bin/env bash
# ci-shape.sh - the structure CI-03 relies on for cheap AND safe merges
# (25.09.2026, docs/decisions.md).
#
# Checks, each one a way the saving or the safety can silently break:
#   1. The jobs report exactly the three required check names
#      `gates (linux)`, `gates (windows)`, `red-first`, and .mergify.yml
#      requires exactly those in queue_conditions, merge_conditions and
#      auto_merge_conditions (a rename on one side leaves the queue waiting
#      for a check that never comes).
#   2. queue_conditions and auto_merge_conditions are identical (the comment
#      in .mergify.yml demanded it since CI-01 review; now it is checked).
#   3. The Windows job picks ubuntu-latest only for an ordinary PR
#      (runs-on names ubuntu-latest, windows-latest and the queue branch
#      prefix) and carries the guard that fails when the lane would run on a
#      non-Windows runner - otherwise a plan bug could turn `gates (windows)`
#      green with Linux results.
#   4. red-first runs inside the linux job (plan and proof) and the job
#      `red-first` only evaluates it: `needs: linux`, the verdict script, and
#      no setup-linux of its own.
#   5. CI-04: the job `main-red` exists, waits for BOTH gate jobs, fires
#      only on refs/heads/main (exact `==`, with always(), or a red gates
#      job would skip it), calls scripts/ci/main-red-guard.sh, reads the
#      lane outputs instead of hardcoded values and serializes its runs
#      (job-level concurrency) - and both gate jobs export the lane_run
#      output from a step `id: plan`, without which a light green push
#      (lanes skipped) would count as green proof and lift the queue
#      freeze.
#
# The YAML is read line-wise (awk), like the other workflow gates here: no
# YAML library is guaranteed on the runner, the Git-Bash or WSL. Limit
# (review PR #149, glm-5.2 F4): it understands block style only - jobs as
# two-space keys, steps as "      - name:", Mergify conditions as "- item"
# lists. Another style (inline lists `[a, b]`, flow maps) finds nothing and
# fails LOUD ("empty or missing", "step ... missing"), never silently green;
# restyling the YAML means adapting job(), step() and mg_list() here.
# Full-line comments are dropped before matching, so a comment that quotes a
# guard does not count as the guard (review PR #149, kimi-k3 F2).
#
# Usage: ci-shape.sh [ci.yml] [.mergify.yml]
# Self-test: scripts/test-ci-shape.sh
set -uo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
CI="${1:-$ROOT/.github/workflows/ci.yml}"
MG="${2:-$ROOT/.mergify.yml}"
errors=0

for f in "$CI" "$MG"; do
  [ -f "$f" ] || { echo "::error::ci-shape.sh: $f not found"; exit 2; }
done

err() {
  echo "::error::ci-shape: $*"
  errors=$((errors + 1))
}

# Lines of job <id> in ci.yml: from "  <id>:" to the next two-space key,
# without full-line comments.
job() {
  awk -v id="$1" '
    $0 ~ "^  " id ":[[:space:]]*$" { on = 1; next }
    on && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { on = 0 }
    on && /^[^[:space:]#]/ { on = 0 }
    on && /^[[:space:]]*#/ { next }
    on { print }
  ' "$CI"
}

# Lines of the step named <name> inside a job text (stdin): from
# "      - name: <name>" to the next "      - " item.
step() {
  awk -v name="$1" '
    $0 == "      - name: " name { on = 1; print; next }
    on && /^      - / { on = 0 }
    on { print }
  '
}

# List items of a Mergify key (queue_conditions, merge_conditions,
# auto_merge_conditions), whitespace-normalised, one per line.
mg_list() {
  awk -v key="$1" '
    $0 ~ "^[[:space:]]*" key ":[[:space:]]*$" { on = 1; match($0, /^[[:space:]]*/); ind = RLENGTH; next }
    on {
      if ($0 ~ /^[[:space:]]*#/ || $0 ~ /^[[:space:]]*$/) next
      match($0, /^[[:space:]]*/)
      if (RLENGTH <= ind && $0 !~ /^[[:space:]]*- /) { on = 0; next }
      if (RLENGTH < ind) { on = 0; next }
      line = $0; sub(/^[[:space:]]*-[[:space:]]*/, "", line); sub(/[[:space:]]+$/, "", line)
      print line
    }
  ' "$MG"
}

has() { grep -qF -- "$2" <<< "$1"; }

linux="$(job linux)"
windows="$(job windows)"
redfirst="$(job red-first)"

# 1. Check names.
has "$linux" "name: gates (linux)" || err "job linux does not report 'gates (linux)'"
has "$windows" "name: gates (windows)" || err "job windows does not report 'gates (windows)'"
has "$redfirst" "name: red-first" || err "job red-first does not report 'red-first'"
for key in queue_conditions merge_conditions auto_merge_conditions; do
  list="$(mg_list "$key")"
  [ -n "$list" ] || { err ".mergify.yml: $key is empty or missing"; continue; }
  for c in "gates (linux)" "gates (windows)" "red-first"; do
    grep -qxF "check-success = $c" <<< "$list" || err ".mergify.yml: $key lacks 'check-success = $c'"
  done
done

# 2. queue_conditions == auto_merge_conditions.
if [ "$(mg_list queue_conditions)" != "$(mg_list auto_merge_conditions)" ]; then
  err ".mergify.yml: queue_conditions and auto_merge_conditions differ"
  diff <(mg_list queue_conditions) <(mg_list auto_merge_conditions) | sed 's/^/  /'
fi

# 3. Windows runner choice and guard. A trailing comment on the runs-on line
# does not count.
runs_on="$(grep -E '^    runs-on:' <<< "$windows" | sed -E 's/[[:space:]]+#.*$//')"
for want in ubuntu-latest windows-latest "mergify/merge-queue/"; do
  has "$runs_on" "$want" || err "job windows: runs-on must choose by event (missing '$want'): $runs_on"
done
guard="$(step "Guard - the Windows lane only runs on Windows" <<< "$windows")"
if [ -z "$guard" ]; then
  err "job windows: guard step 'Guard - the Windows lane only runs on Windows' missing"
else
  guard_if="$(grep -E '^        if:' <<< "$guard")"
  has "$guard_if" "runner.os != 'Windows'" || err "job windows: guard 'if' lacks runner.os != 'Windows': $guard_if"
  has "$guard_if" "steps.plan.outputs.run != 'false'" || err "job windows: guard 'if' lacks steps.plan.outputs.run != 'false' (fail-closed on a missing plan): $guard_if"
  grep -qE '^[[:space:]]+exit 1[[:space:]]*$' <<< "$guard" || err "job windows: guard step does not 'exit 1' - a runner mismatch would stay green"
fi

# 4. red-first inside the linux job, evaluated by the red-first job.
has "$linux" "red-first.sh --plan" || err "job linux: step 'red-first - plan' missing"
grep -qE 'bash scripts/ci/red-first\.sh[[:space:]]*$' <<< "$linux" || err "job linux: step 'red-first - proof' missing"
grep -qE '^    needs:[[:space:]]*\[?[[:space:]]*linux[[:space:]]*\]?[[:space:]]*$' <<< "$redfirst" || err "job red-first: 'needs: linux' missing"
has "$redfirst" "red-first-verdict.sh" || err "job red-first: does not call scripts/ci/red-first-verdict.sh"
has "$redfirst" "setup-linux" && err "job red-first: has its own setup-linux again (setup is paid in gates (linux))"
# The proof never starts on an empty count (review PR #149, glm-5.2 F2).
proof_if="$(step "red-first - proof against merge base" <<< "$linux" | grep -E '^        if:')"
has "$proof_if" "steps.rf_plan.outputs.count != ''" || err "job linux: proof step 'if' lacks steps.rf_plan.outputs.count != '': $proof_if"

# 5. CI-04: the main-red guard job - a red main opens an issue and freezes
# the Mergify queue, a proven-green main lifts both.
mainred="$(job main-red)"
if [ -z "$mainred" ]; then
  err "job main-red missing (CI-04: red main must freeze the queue)"
else
  has "$mainred" "name: main-red-guard" || err "job main-red: does not report 'main-red-guard'"
  mainred_needs="$(grep -E '^    needs:' <<< "$mainred")"
  has "$mainred_needs" "linux" || err "job main-red: 'needs' lacks linux - the guard could run without the linux verdict"
  has "$mainred_needs" "windows" || err "job main-red: 'needs' lacks windows - the guard could run without the windows verdict"
  mainred_if="$(grep -E '^    if:' <<< "$mainred")"
  has "$mainred_if" "always()" || err "job main-red: 'if' lacks always() - a red gates job would skip the guard itself: $mainred_if"
  # Exact operator: a substring check would also let != through, and then
  # the guard would fire on every ref EXCEPT main (review predecessor PR, S-9/O-10).
  grep -qE "github\.ref == 'refs/heads/main'" <<< "$mainred_if" ||
    err "job main-red: 'if' must pin github.ref == 'refs/heads/main' exactly: $mainred_if"
  has "$mainred" "main-red-guard.sh" || err "job main-red: does not call scripts/ci/main-red-guard.sh"
  # The env wiring decides what the script believes about the lanes: a
  # hardcoded "true" would make a light push look like a full run, a
  # hardcoded failure would freeze a green main (review predecessor PR, S-9).
  has "$mainred" 'LINUX_RAN: ${{ needs.linux.outputs.lane_run }}' ||
    err "job main-red: LINUX_RAN must read needs.linux.outputs.lane_run"
  has "$mainred" 'WINDOWS_RAN: ${{ needs.windows.outputs.lane_run }}' ||
    err "job main-red: WINDOWS_RAN must read needs.windows.outputs.lane_run"
  # Serialized guards: main runs do not cancel each other, and a stale red
  # run must not interleave freeze/unfreeze with a newer green one (S-5/O-5).
  has "$mainred" "group: main-red-guard" ||
    err "job main-red: no job-level concurrency group - stale runs could interleave freeze/unfreeze"
fi
# Without the lane_run outputs a light green push (lanes skipped by
# lane-plan.sh) would count as green proof and lift the freeze. Anchored:
# the output line itself, not just the words somewhere in the job block
# (full-line comments are already stripped by job()). And without a step
# `id: plan` the output would silently be empty - the freeze could never
# lift (review predecessor PR, S-9/O-10).
lane_out_re='^      lane_run: \$\{\{ steps\.plan\.outputs\.run \}\}$'
grep -qE "$lane_out_re" <<< "$linux" || err "job linux: output 'lane_run' missing - main-red cannot tell a real lane from a skipped one"
grep -qE "$lane_out_re" <<< "$windows" || err "job windows: output 'lane_run' missing - main-red cannot tell a real lane from a skipped one"
has "$linux" "id: plan" || err "job linux: step id 'plan' missing - lane_run would be empty and the freeze could never lift"
has "$windows" "id: plan" || err "job windows: step id 'plan' missing - lane_run would be empty and the freeze could never lift"

if [ "$errors" -gt 0 ]; then
  echo "ci-shape: $errors problem(s)"
  exit 1
fi
echo "ci-shape: required checks consistent, Windows runner guarded, red-first shares the linux setup"
