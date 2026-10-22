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
# expression changed nothing, counting the failure. Not called in $( ):
# a subshell would swallow both the message and the failure count (review PR #149, kimi-k3 F1).
MUTATED=""
mutate() {
  MUTATED="$tmp/$1.${2##*.}"
  if ! sed -E "$3" "$2" > "$MUTATED"; then
    echo "FEHLER $1: mutation failed"
    fails=$((fails + 1))
    return 2
  fi
  if cmp -s "$2" "$MUTATED"; then
    echo "FEHLER $1: mutation changed nothing (stale test?)"
    fails=$((fails + 1))
    return 1
  fi
}

# Compare all bytes outside the intended job/step/direct job-name field.
outside_scope() {
  awk -v wanted="$1" -v selector="$2" '
    /^  [^ ]/ { job = $1; step = "" }
    /^      - / { step = $0 }
    job == wanted ":" && (selector == "" ||
      (selector == "job-name" && /^    name:/) ||
      step == "      - name: " selector) { next }
    { print }
  ' "$3"
}

# case_m name ci|mg sed-expression reason-regex [job [step|job-name]]
case_m() {
  local name="$1" which="$2" expr="$3" reason="$4" src
  if [ "$which" = ci ]; then src="$CI"; else src="$MG"; fi
  mutate "$name" "$src" "$expr" || return
  if [ -n "${5:-}" ] && ! cmp -s \
    <(outside_scope "$5" "${6:-}" "$src") <(outside_scope "$5" "${6:-}" "$MUTATED"); then
    echo "FEHLER $name: mutation changed outside its intended scope"
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
# A following job makes accidental end-of-file mutations observable.
cp "$CI" "$tmp/ci.yml"
CI="$tmp/ci.yml"
printf '\n  scope_9:\n    name: untouched sibling\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo untouched\n' >> "$CI"
check extra-sibling-job pass "$CI" "$MG"

# Block-sequence headers may carry a YAML comment or anchor.
for header in 'steps-header-comment:# protected steps' 'steps-header-anchor:&protected_steps'; do
  decoration="${header#*:}"
  mutate "${header%%:*}" "$CI" "s/^    steps:$/    steps: ${decoration//&/\\&}/" || continue
  if ! grep -qxF "    steps: $decoration" "$MUTATED"; then
    echo "FEHLER ${header%%:*}: incorrect header fixture"
    fails=$((fails + 1))
    continue
  fi
  check "${header%%:*}" pass "$MUTATED" "$MG"
done

# R1581-K5: moving whole step sequences preserves YAML and shell block nesting.
# Exercise both indentationless sequences and deeper-than-usual sequences.
for variant in '-2:equivalent-step-indentation--2' \
  '2:equivalent-step-indentation-2' '4:equivalent-step-indentation-4'; do
  shift="${variant%%:*}"
  reindented="$tmp/steps-$shift.yml"
  awk -v shift="$shift" '
    /^    [^ ]/ { in_steps = 0 }
    /^    steps:/ { in_steps = 1; print; next }
    in_steps && /^      / {
      if (shift < 0) print substr($0, 1 - shift)
      else printf "%*s%s\n", shift, "", $0
      next
    }
    { print }
  ' "$CI" > "$reindented"
  check "${variant#*:}" pass "$reindented" "$MG"
  # The event guards must remain mandatory at every accepted indentation.
  for rf_step in 'red-first - plan' 'red-first - proof against merge base'; do
    mutate "indented-event-$shift-$rf_step" "$reindented" \
      "/name: $rf_step\$/,/^[[:space:]]*run:/ s/github.event_name == 'pull_request'/true/" || continue
    check "indented-event-$shift-$rf_step" fail "$MUTATED" "$MG" "step '$rf_step' 'if' lacks github.event_name"
  done
done

# The harness itself: a no-op mutation must be reported, not pass silently.
before_noop=$fails
if mutate harness-noop "$CI" 's/NEVER_MATCHES_9f3c/x/' > "$tmp/noop.out"; then
  echo "FEHLER harness: a no-op mutation was not detected"
  fails=$((fails + 1))
elif [ "$fails" -ne "$((before_noop + 1))" ] || ! grep -qxF \
  'FEHLER harness-noop: mutation changed nothing (stale test?)' "$tmp/noop.out"; then
  echo "FEHLER harness: no-op must count one failure and retain its diagnostic"
  fails=$((fails + 1))
else
  fails=$before_noop # The expected failure was asserted; keep earlier failures.
  echo "ok   harness detects a no-op mutation"
fi

# ci.yml: the Windows job always on windows-latest again (PR runs pay the
# Windows rate) - not a safety bug, but the cost structure is gone.
case_m windows-runs-on-fixed ci '/^  windows-part:/,/^  [A-Za-z0-9_-]+:$/ s/^(    runs-on:).*/\1 windows-latest/' \
  "runs-on must choose by event" windows-part
# ... and the same with the three words only in a trailing comment
# (review PR #149, kimi-k3 F2).
case_m windows-runs-on-comment-only ci '/^  windows-part:/,/^  [A-Za-z0-9_-]+:$/ s/^(    runs-on:).*/\1 windows-latest # ubuntu-latest mergify\/merge-queue\//' \
  "runs-on must choose by event" windows-part
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
# AP-4a: `gates (windows)` aggregates the partition legs of `windows-part`.
# A matrix that lost a partition runs fewer tests and would stay green.
case_m windows-part-lost-partition ci 's/lane: \[windows_1, windows_2, windows_native\]/lane: [windows_1]/' \
  "matrix must be exactly"
# ... the aggregator would be skipped after a red leg (skipped = green for
# branch protection) ...
case_m windows-aggregator-without-always ci '/^  windows:/,/^  red-first:/ s/if: \$\{\{ always\(\) && \(/if: ${{ (/' \
  "windows.*always"
# ... or no longer waits for / reads the legs, or skips the verdict script.
case_m windows-aggregator-without-needs ci '/^  windows:/,/^  red-first:/ s/^    needs: windows-part$/    needs: []/' \
  "'needs: windows-part' missing"
case_m windows-aggregator-without-verdict ci 's#bash scripts/ci/windows-verdict\.sh#true#' \
  "does not call scripts/ci/windows-verdict.sh"
case_m windows-aggregator-result-not-wired ci 's/PART_RESULT: \$\{\{ needs\.windows-part\.result \}\}/PART_RESULT: success/' \
  "PART_RESULT must read"
case_m windows-part-without-lane-run ci '/^  windows-part:/,/^  windows:/ s/^      lane_run: .*$//' \
  "windows-part.*lane_run"
# ci.yml: red-first sets up its own toolchain again.
case_m red-first-own-setup ci '/^  red-first:/,$ s#^(      - uses: actions/checkout.*)#      - uses: ./.github/actions/setup-linux\n\1#' \
  "own setup-linux"
# ci.yml: red-first no longer waits for the linux job.
case_m red-first-without-needs ci '/^  red-first:/,$ s/^    needs: linux_1$/    needs: []/' \
  "'needs: linux_1' missing"
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
# .mergify.yml (CI-HARDEN-02): the review-ok label on only one entry list.
case_m review-ok-missing-in-auto-merge mg '/^  auto_merge_conditions:/,/^[a-z]/ { /label = review-ok/d }' \
  "queue_conditions and auto_merge_conditions differ"
case_m review-ok-missing-in-queue mg '/^    queue_conditions:/,/^    # \.\.\./ { /label = review-ok/d }' \
  "queue_conditions and auto_merge_conditions differ"
# ... and on neither list: equal lists must still fail.
case_m review-ok-missing-in-both mg '/label = review-ok/d' \
  "queue_conditions lacks 'label = review-ok'"
# .mergify.yml: a required check missing from merge_conditions.
case_m merge-condition-missing mg '/^    merge_conditions:/,/^[a-z]/ { /check-success = gates \(windows\)/d }' \
  "merge_conditions lacks 'check-success = gates \\(windows\\)'"
# ci.yml (CI-04): the main-red job no longer waits for both gate jobs.
case_m main-red-without-needs ci '/^  main-red:/,/^  [A-Za-z0-9_-]+:/ s/^    needs: \[linux, windows\]$/    needs: []/' \
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
case_m main-red-without-concurrency ci '/^  main-red:/,/^  [A-Za-z0-9_-]+:/ s/^      group: main-red-guard$//' \
  "main-red.*concurrency"
# V161-FU-3 / R934-A2: both red-first steps must pin RF_BASE_BRANCH and fetch
# refs/heads/$RF_BASE_BRANCH — removing either must turn ci-shape red.
case_m "ci-shape fails when a red-first step lacks RF_BASE_BRANCH" ci \
  '/RF_BASE_BRANCH:/d' \
  "RF_BASE_BRANCH"
case_m "ci-shape fails when the red-first base branch fetch is missing" ci \
  '/refs\/heads\/\$RF_BASE_BRANCH/d' \
  "base branch fetch"
# V161-FU-3 / R953-A2: per-step mutations (range-scoped), not both steps at once.
case_m "ci-shape fails when only the proof step lacks the base branch fetch" ci \
  '/^      - name: red-first - proof against merge base$/,/^  [a-z]/ { /refs\/heads\/\$RF_BASE_BRANCH/d }' \
  "proof against merge base.*base branch fetch"
case_m "ci-shape fails when the proof step 'if' drops the pull_request event check" ci \
  '/^      - name: red-first - proof against merge base$/,/^  [a-z]/ s/github.event_name == .pull_request. && //' \
  "proof against merge base' 'if' lacks github.event_name"
case_m "ci-shape fails when only the plan step lacks RF_BASE_BRANCH" ci \
  '/^      - name: red-first - plan$/,/^      - / { /RF_BASE_BRANCH:/d }' \
  "red-first - plan' lacks RF_BASE_BRANCH"
# V161-FU-3 / R953-A1: plan step must keep HEAD_SHA fetch fatal and BASE_SHA
# fetch non-fatal (|| ); a single combined fatal fetch must not stay green.
case_m "ci-shape fails when the BASE_SHA fetch in the plan step is fatal again" ci \
  '/^      - name: red-first - plan$/,/^      - / s#(git fetch --no-tags origin "\$BASE_SHA") \|\| echo.*#\1#' \
  "BASE_SHA fetch must be non-fatal"
case_m "ci-shape fails when the HEAD_SHA fetch in the plan step becomes non-fatal" ci \
  '/^      - name: red-first - plan$/,/^      - / s#git fetch --no-tags origin "\$HEAD_SHA"#git fetch --no-tags origin "\$HEAD_SHA" || true#' \
  "HEAD_SHA fetch must be fatal"

# R1581-K4: each red-first condition gets its own mutation in each step.
for rf_step in 'red-first - plan' 'red-first - proof against merge base'; do
  scope="/^      - name: $rf_step\$/,/^      - /"
  case_m "$rf_step-without-event" ci "$scope s/github.event_name == 'pull_request'/true/" \
    "step '$rf_step' 'if' lacks github.event_name"
  case_m "$rf_step-without-base-env" ci "$scope { /RF_BASE_BRANCH:/d; }" \
    "step '$rf_step' lacks RF_BASE_BRANCH"
  case_m "$rf_step-without-base-fetch" ci "$scope { /refs\\/heads\\/\\\$RF_BASE_BRANCH/d; }" \
    "step '$rf_step' missing red-first base branch fetch"
done

# Independent mutations for the remaining protected conditions, including
# siblings previously removed together or covered only by another diagnostic.
for variant in linux:linux-check-renamed red-first:red-first-check-renamed; do
  job_id="${variant%%:*}"
  case_m "${variant#*:}" ci "/^  $job_id:/,/^  [A-Za-z0-9_-]+:/ s/^    name: .*/    name: renamed/" \
    "job $job_id does not report" "$job_id" job-name
done
for key in queue_conditions merge_conditions auto_merge_conditions; do
  case_m "$key-missing" mg "s/^([[:space:]]*)$key:/\\1unused_conditions:/" "$key is empty or missing"
  for required in 'gates \(linux\)' 'gates \(windows\)' red-first; do
    case_m "$key-without-$required" mg "/^[[:space:]]*$key:/,/^[[:space:]]*[a-z_]+:/ { /check-success = $required/d; }" \
      "$key lacks 'check-success = $required'"
  done
done
for runner in ubuntu-latest windows-latest 'mergify/merge-queue/'; do
  case_m "runner-without-${runner//\//-}" ci "/^  windows-part:/,/^  [A-Za-z0-9_-]+:/ { /^    runs-on:/ s#$runner#removed#g; }" "runs-on must choose by event" windows-part
done
case_m plan-command-missing ci 's#bash scripts/ci/red-first.sh --plan#true#' "red-first - plan' missing"
case_m red-first-verdict-missing ci 's#bash scripts/ci/red-first-verdict.sh#true#' "does not call scripts/ci/red-first-verdict.sh"
for sha in HEAD_SHA BASE_SHA; do
  case_m "plan-without-$sha-fetch" ci "/^      - name: red-first - plan\$/,/^      - / { /git fetch.*\\\"\\\$$sha\\\"/d; }" "missing $sha fetch" linux_1 'red-first - plan'
done
case_m main-red-missing ci '/^  main-red:/,/^  [A-Za-z0-9_-]+:/ { /^  main-red:/d; /^  [A-Za-z0-9_-]+:/!d; }' "job main-red missing" main-red
case_m main-red-name-missing ci '/^  main-red:/,/^  [A-Za-z0-9_-]+:/ { /^    name:/d; }' "does not report 'main-red-guard'" main-red job-name
case_m main-red-command-missing ci 's#bash scripts/ci/main-red-guard.sh#true#' "does not call scripts/ci/main-red-guard.sh"
for leg in linux windows; do
  case_m "main-red-without-$leg" ci "/^  main-red:/,/^  [A-Za-z0-9_-]+:/ s/needs: \\[linux, windows\\]/needs: [$([ "$leg" = linux ] && echo windows || echo linux)]/" \
    "main-red: 'needs' lacks $leg"
  case_m "main-red-without-$leg-ran" ci "/^  main-red:/,/^  [A-Za-z0-9_-]+:/ s/needs.$leg.outputs.lane_run/true/" \
    "${leg^^}_RAN must read"
done
for job_id in linux_1 windows-part; do
  case_m "$job_id-output-missing" ci "/^  $job_id:/,/^  [A-Za-z0-9_-]+:/ { /^      lane_run:/d; }" "output 'lane_run' missing" "$job_id"
  case_m "$job_id-plan-id-missing" ci "/^  $job_id:/,/^  [A-Za-z0-9_-]+:/ { /^        id: plan/d; }" "step id 'plan' missing" "$job_id"
done
for leg in linux_1 linux_2; do
  case_m "linux-needs-without-$leg" ci "/^  linux:/,/^  windows-part:/ s/needs: \\[linux_1, linux_2\\]/needs: [$leg]/" "both legs required"
  case_m "linux-output-without-$leg" ci "/^  linux:/,/^  windows-part:/ s/needs.$leg.outputs.lane_run/true/" "lane_run must require both legs"
done
case_m linux-without-always ci '/^  linux:/,/^  windows-part:/ s/always\(\)/true/' 'job linux: always\(\) required'
for lane in windows_1 windows_2 windows_native; do
  case_m "matrix-without-$lane" ci "/lane: \\[/ s/$lane/removed/" "matrix must be exactly"
done
case_m windows-matrix-command-missing ci 's/gates.sh lane \$\{\{ matrix.lane \}\}/gates.sh lane windows_1/' "Gates step must run the matrix lane"

# Call errors are errors, not a silent pass.
check missing-file fail "$tmp/does-not-exist.yml" "$MG" "not found"

if [ "$fails" -gt 0 ]; then
  echo "test-ci-shape: $fails Fehler"
  exit 1
fi
echo "test-ci-shape: alle Faelle gruen"
