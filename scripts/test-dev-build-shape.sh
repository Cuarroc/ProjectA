#!/usr/bin/env bash
# Self-test for scripts/ci/dev-build-shape.sh: the real files pass, each
# mutation of dev-build.yml or the overlay fails for its own reason.
set -uo pipefail

HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
SHAPE="$HERE/scripts/ci/dev-build-shape.sh"
WF="$HERE/.github/workflows/dev-build.yml"
OV="$HERE/src-tauri/tauri.dev-channel.conf.json"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/dev-build-shape.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
fails=0
[ -f "$SHAPE" ] || { echo "FEHLER: $SHAPE fehlt"; exit 1; }

# CHECK_PATH, when set, replaces PATH for the guard (forced tool failures).
check() { # name expected(pass|fail) dev-build.yml overlay.json [reason-regex]
  local got
  if PATH="${CHECK_PATH:-$PATH}" bash "$SHAPE" "$3" "$4" > "$tmp/out" 2>&1; then got=pass; else got=fail; fi
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

wf() { sed "$1" "$WF" > "$tmp/$2.yml"; echo "$tmp/$2.yml"; }
ov() { sed "$1" "$OV" > "$tmp/$2.json"; echo "$tmp/$2.json"; }

check real-files-pass pass "$WF" "$OV"

check workflow-reading-a-secret-fails fail \
  "$(wf 's/^    timeout-minutes: 90$/&\n    env:\n      K: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}/' secret)" "$OV" "mentions secrets"
check workflow-with-secrets-index-syntax-fails fail \
  "$(wf "s/^    timeout-minutes: 90\$/&\n    env:\n      K: \${{ secrets['TAURI_SIGNING_PRIVATE_KEY'] }}/" secidx)" "$OV" "mentions secrets"
check workflow-with-secrets-inherit-fails fail \
  "$(wf 's/^    timeout-minutes: 90$/&\n    secrets: inherit/' secinherit)" "$OV" "mentions secrets"
check workflow-with-job-level-uses-fails fail \
  "$(wf 's/^    timeout-minutes: 90$/&\n    uses: .\/.github\/workflows\/release.yml/' jobuses)" "$OV" "job-level uses"
check workflow-with-write-permission-fails fail \
  "$(wf 's/^      contents: read$/      contents: write/' write)" "$OV" "write permission"
check workflow-with-write-on-other-scope-fails fail \
  "$(wf 's/^      contents: read$/      contents: read\n      id-token: write/' writeid)" "$OV" "write permission"
check workflow-with-write-all-permissions-fails fail \
  "$(wf 's/^    permissions:$/    permissions: write-all/;/^      contents: read$/d' writeall)" "$OV" "write permission"
check workflow-with-write-key-outside-permissions-passes pass \
  "$(wf 's/^    timeout-minutes: 90$/&\n    env:\n      mode: write/' writeenv)" "$OV"
check workflow-with-toplevel-write-all-fails fail \
  "$(wf 's/^name: dev-build$/&\npermissions: write-all/' topwrite)" "$OV" "write permission"
check workflow-with-permissions-text-in-run-script-passes pass \
  "$(wf 's/^        run: echo "short=.*$/        run: |\n          echo hi\n          permissions:\n            contents: write/' runperm)" "$OV"
check workflow-with-environment-text-in-run-script-passes pass \
  "$(wf 's/^        run: echo "short=.*$/        run: |\n          echo hi\n          environment: release/' runenv)" "$OV"
check workflow-with-spaced-uses-key-fails fail \
  "$(wf 's/^    timeout-minutes: 90$/&\n    uses : .\/.github\/workflows\/release.yml/' spaceduses)" "$OV" "job-level uses"
check workflow-with-quoted-uses-key-fails fail \
  "$(wf 's/^    timeout-minutes: 90$/&\n    "uses": .\/.github\/workflows\/release.yml/' quoteduses)" "$OV" "job-level uses"
check workflow-with-flow-style-job-fails fail \
  "$(wf 's/^  dev-build:$/  dev-build: {uses: .\/.github\/workflows\/release.yml}/' flowjob)" "$OV" "flow style"
check workflow-reindented-to-four-spaces-passes pass \
  "$(wf 's/^\( *\)/\1\1/' indent4)" "$OV"
check workflow-reindented-with-job-level-uses-fails fail \
  "$(wf 's/^\( *\)/\1\1/;s/^        timeout-minutes: 90$/&\n        uses: .\/.github\/workflows\/release.yml/' indent4uses)" "$OV" "job-level uses"
check workflow-with-environment-fails fail \
  "$(wf 's/^    timeout-minutes: 90$/&\n    environment: release/' env)" "$OV" "has an environment"
check workflow-with-spaced-environment-key-fails fail \
  "$(wf 's/^    timeout-minutes: 90$/&\n    environment : release/' envspaced)" "$OV" "has an environment"
check workflow-with-quoted-job-environment-key-fails fail \
  "$(wf 's/^    timeout-minutes: 90$/&\n    "environment": release/' envquoted)" "$OV" "has an environment"
check workflow-with-push-trigger-fails fail \
  "$(wf 's/^  workflow_dispatch:$/&\n  push:\n    branches: [main]/' push)" "$OV" "trigger other than workflow_dispatch"
check workflow-with-schedule-trigger-fails fail \
  "$(wf 's/^  workflow_dispatch:$/&\n  schedule:\n    - cron: "0 3 * * *"/' sched)" "$OV" "trigger other than workflow_dispatch"
check workflow-without-dispatch-trigger-fails fail \
  "$(wf 's/^  workflow_dispatch:$/  pull_request:/' nodispatch)" "$OV" "trigger other than workflow_dispatch"

# Forced tool failures: the permissions extraction must fail closed, not pass.
mkdir "$tmp/failbin" "$tmp/silentbin"
printf '#!/bin/sh\nexit 1\n' > "$tmp/failbin/awk"
printf '#!/bin/sh\nexit 0\n' > "$tmp/silentbin/awk"
chmod +x "$tmp/failbin/awk" "$tmp/silentbin/awk"
CHECK_PATH="$tmp/failbin:$PATH" check permissions-extraction-failure-fails fail "$WF" "$OV" "permissions extraction failed"
CHECK_PATH="$tmp/silentbin:$PATH" check permissions-extraction-empty-output-fails fail "$WF" "$OV" "permissions extraction"
mkdir "$tmp/grepfailbin"
printf '#!/bin/sh\nexit 2\n' > "$tmp/grepfailbin/grep"
chmod +x "$tmp/grepfailbin/grep"
CHECK_PATH="$tmp/grepfailbin:$PATH" check grep-tool-failure-fails fail "$WF" "$OV" "permissions extraction failed"

check overlay-with-stable-identifier-fails fail \
  "$WF" "$(ov 's/"com\.projecta\.dev"/"com.projecta.app"/' stable)" "identifier must be"
check overlay-with-third-identifier-fails fail \
  "$WF" "$(ov 's/"com\.projecta\.dev"/"com.projecta.other"/' third)" "identifier must be"
check overlay-with-updater-artifacts-true-fails fail \
  "$WF" "$(ov 's/"createUpdaterArtifacts": false/"createUpdaterArtifacts": true/' artifacts)" "createUpdaterArtifacts"
check overlay-without-updater-artifacts-flag-fails fail \
  "$WF" "$(ov '/"createUpdaterArtifacts"/d' noflag)" "createUpdaterArtifacts"
check overlay-with-updater-endpoint-fails fail \
  "$WF" "$(ov 's/"endpoints": \[\]/"endpoints": ["https:\/\/example.invalid\/latest.json"]/' endpoint)" "updater is not inert"

[ "$fails" -eq 0 ] || { echo "test-dev-build-shape: $fails failure(s)"; exit 1; }
echo "test-dev-build-shape: all cases passed"
