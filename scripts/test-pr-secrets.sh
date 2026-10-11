#!/usr/bin/env bash
# Selftest for scripts/ci/pr-secrets.sh. The decisive cases: a copy of the
# ci.yml from before CI-SEC-01 (red), the real ci.yml (green), a secret in the
# allowlisted job (green) and one in a workflow without a PR trigger (green).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

check() { # name expected_exit dir
  local name="$1" want="$2" d="$3"
  bash scripts/ci/pr-secrets.sh "$d" > "$tmp/$name.log" 2>&1
  local got=$?
  if [ "$got" -ne "$want" ]; then
    echo "FAIL $name: exit $got, expected $want"; sed 's/^/    /' "$tmp/$name.log"; fails=$((fails + 1))
  else
    echo "ok   $name (exit $got)"
  fi
}

mk() { # name body -> dir with one workflow
  mkdir -p "$tmp/$1"; printf '%s\n' "$2" > "$tmp/$1/w.yml"; echo "$tmp/$1"
}

PR_ON=$'on:\n  pull_request:\n  push:'

# Fixture: today's ci.yml (before CI-SEC-01) hands the token to linux/windows.
mkdir -p "$tmp/old"
cat > "$tmp/old/ci.yml" <<'YML'
on:
  pull_request:
jobs:
  linux:
    env:
      MERGIFY_UPLOAD: ${{ secrets.MERGIFY_TOKEN != '' }}
    steps:
      - uses: mergifyio/gha-mergify-ci@0000000000000000000000000000000000000000 # v26
        with:
          token: ${{ secrets.MERGIFY_TOKEN }}
  main-red:
    steps:
      - env:
          MERGIFY_TOKEN: ${{ secrets.MERGIFY_TOKEN }}
YML
check "secret-in-pr-job-is-red"      1 "$tmp/old"
check "real-ci-yml-is-green"         0 .github/workflows
check "only-allowlisted-job-green"   0 "$(mk allow "$PR_ON
jobs:
  main-red:
    if: \${{ always() && github.ref == 'refs/heads/main' }}
    steps:
      - env:
          T: \${{ secrets.X }}")"
check "secret-in-other-job-is-red"   1 "$(mk other "$PR_ON
jobs:
  build:
    steps:
      - run: echo \${{ secrets.X }}")"
check "inline-on-is-red"             1 "$(mk inline "on: [push, pull_request]
jobs:
  build:
    steps:
      - run: echo \${{ secrets.X }}")"
check "pull-request-target-is-red"   1 "$(mk prt $'on:\n  pull_request_target:\njobs:\n  build:\n    steps:\n      - run: echo ${{ secrets.X }}')"
check "no-pr-trigger-is-green"       0 "$(mk nopr $'on:\n  schedule:\n    - cron: "0 4 * * 1"\njobs:\n  build:\n    steps:\n      - run: echo ${{ secrets.X }}')"
check "comment-is-green"             0 "$(mk comment "$PR_ON
jobs:
  build:
    steps:
      # never use secrets.X here
      - run: echo hi")"
# R1171-K1: other ways to hand a PR job a secret.
check "secrets-inherit-is-red"       1 "$(mk inherit "$PR_ON
jobs:
  build:
    secrets: inherit")"
check "secrets-index-is-red"         1 "$(mk index "$PR_ON
jobs:
  build:
    steps:
      - run: echo \${{ secrets['X'] }}")"
check "job-level-uses-is-red"        1 "$(mk reuse "$PR_ON
jobs:
  call:
    uses: ./.github/workflows/r.yml")"
check "step-level-uses-is-green"     0 "$(mk stepuses "$PR_ON
jobs:
  build:
    steps:
      - uses: actions/checkout@0000000000000000000000000000000000000000")"
# R1171-G1: a workflow-level env block reaches every job.
check "workflow-env-secret-is-red"   1 "$(mk wenv "$PR_ON
env:
  T: \${{ secrets.X }}
jobs:
  build:
    steps:
      - run: echo hi")"
# R1171-K5: a trailing comment on the on:/jobs: anchor must not hide the scan.
check "commented-on-anchor-is-red"   1 "$(mk conn $'on: # triggers\n  pull_request:\njobs:\n  build:\n    steps:\n      - run: echo ${{ secrets.X }}')"
check "commented-jobs-anchor-is-red" 1 "$(mk cjobs $'on:\n  pull_request:\njobs: # all jobs\n  build:\n    steps:\n      - run: echo ${{ secrets.X }}')"
# R1171-G3/K4: the allowlisted job must carry a one-line main-only `if:`.
check "main-red-without-main-if-is-red" 1 "$(mk noguard "$PR_ON
jobs:
  main-red:
    steps:
      - env:
          T: \${{ secrets.X }}")"
# R1171-K3: test-insights.yml must follow the real name of ci.yml.
mkdir -p "$tmp/wrname"
printf 'name: ci\non:\n  push:\njobs:\n  a:\n    steps: []\n' > "$tmp/wrname/ci.yml"
printf 'name: ti\non:\n  workflow_run:\n    workflows: [build]\n    types: [completed]\n' > "$tmp/wrname/test-insights.yml"
check "workflow-run-name-mismatch-is-red" 1 "$tmp/wrname"

mkdir -p "$tmp/leer"
check "empty-dir-is-exit-2"          2 "$tmp/leer"

[ "$fails" -eq 0 ] && echo "all cases green" || echo "$fails case(s) red"
[ "$fails" -eq 0 ]
