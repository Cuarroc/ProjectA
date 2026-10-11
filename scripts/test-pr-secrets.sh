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

# R1171b-K1: the word `secrets` anywhere inside an expression is a leak path.
check "tojson-secrets-is-red"        1 "$(mk tojson "$PR_ON
jobs:
  build:
    steps:
      - run: echo \${{ toJSON(secrets) }}")"
check "bare-secrets-is-red"          1 "$(mk bare "$PR_ON
jobs:
  build:
    env:
      ALL: \${{ secrets }}")"
check "multiline-expression-is-red"  1 "$(mk multi "$PR_ON
jobs:
  build:
    env:
      T: \${{
        secrets.X }}")"
# R1171b-K2: only a plain main-only guard unlocks the allowlisted job.
guard() { # name if-line
  mk "$1" "$PR_ON
jobs:
  main-red:
    $2
    steps:
      - env:
          T: \${{ secrets.X }}"
}
check "guard-ref-name-is-green"      0 "$(guard g1 "if: github.ref_name == 'main'")"
check "guard-or-is-red"              1 "$(guard g2 "if: \${{ github.ref == 'refs/heads/main' || always() }}")"
check "guard-neq-is-red"             1 "$(guard g3 "if: github.ref != 'refs/heads/main'")"
check "guard-negated-is-red"         1 "$(guard g4 "if: \${{ !(github.ref == 'refs/heads/main') }}")"
check "guard-pull-request-is-red"    1 "$(guard g5 "if: github.event_name == 'pull_request' && github.ref == 'refs/heads/main'")"
check "guard-only-mentions-main-is-red" 1 "$(guard g6 "if: contains(github.ref, 'refs/heads/main')")"
# R1171b-K3: inside `run: |` a comment-looking line is still interpolated.
check "comment-looking-expression-is-red" 1 "$(mk cexpr "$PR_ON
jobs:
  build:
    steps:
      - run: |
          # \${{ secrets.X }}
          echo hi")"
# R1171b-K4: a comment on the inline `on:` line is no trigger.
check "inline-on-comment-is-green"   0 "$(mk ioc $'on: [push] # pull_request later\njobs:\n  build:\n    steps:\n      - run: echo ${{ secrets.X }}')"
# R1171b-K6: any indentation; an unparsable jobs block is an error, never green.
check "four-space-indent-is-red"     1 "$(mk four $'on:\n    pull_request:\njobs:\n    build:\n        steps:\n            - run: echo ${{ secrets.X }}')"
check "four-space-allowlist-is-green" 0 "$(mk four2 $'on:\n    pull_request:\njobs:\n    main-red:\n        if: github.ref == \'refs/heads/main\'\n        env:\n            T: ${{ secrets.X }}')"
check "four-space-job-uses-is-red"   1 "$(mk four3 $'on:\n    pull_request:\njobs:\n    call:\n        uses: ./.github/workflows/r.yml')"
check "flow-jobs-is-error"           1 "$(mk flow $'on:\n  pull_request:\njobs: {build: {runs-on: x}}')"
check "no-jobs-is-error"             1 "$(mk nojobs $'on:\n  pull_request:\nenv:\n  A: b')"
# R1171b-K5/G3: the workflows: cross-check reads block and multi-entry lists.
ti() { # name ci-name workflows-lines
  mkdir -p "$tmp/$1"
  printf 'name: %s\non:\n  push:\njobs:\n  a:\n    steps: []\n' "$2" > "$tmp/$1/ci.yml"
  printf 'name: ti\non:\n  workflow_run:\n%s\n    types: [completed]\n' "$3" > "$tmp/$1/test-insights.yml"
  echo "$tmp/$1"
}
check "workflows-block-list-is-green" 0 "$(ti tb ci $'    workflows:\n      - ci')"
check "workflows-multi-entry-is-green" 0 "$(ti tm ci '    workflows: [build, "ci"]')"
check "workflows-block-mismatch-is-red" 1 "$(ti tx ci $'    workflows:\n      - build')"
mkdir -p "$tmp/noci"
printf 'name: ti\non:\n  workflow_run:\n    workflows: [ci]\n' > "$tmp/noci/test-insights.yml"
check "missing-ci-yml-is-red"        1 "$tmp/noci"
grep -q "ci.yml not found" "$tmp/missing-ci-yml-is-red.log" && echo "ok   missing-ci-yml-message" || { echo "FAIL missing-ci-yml-message"; fails=$((fails + 1)); }

mkdir -p "$tmp/leer"
check "empty-dir-is-exit-2"          2 "$tmp/leer"

[ "$fails" -eq 0 ] && echo "all cases green" || echo "$fails case(s) red"
[ "$fails" -eq 0 ]
