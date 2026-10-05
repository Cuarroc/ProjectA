#!/usr/bin/env bash
# Self-test for scripts/ci/shell-lint.sh: each check must be able to fail
# (AGENTS.md rule 2) and must pass on a clean fixture.
set -uo pipefail
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
LINT="$ROOT/scripts/ci/shell-lint.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail=0
expect() { # name want_rc cmd...
  local name="$1" want="$2" rc
  shift 2
  "$@" > "$tmp/out" 2>&1
  rc=$?
  if [ "$rc" -eq "$want" ]; then echo "ok   $name"; else echo "FAIL $name: exit $rc, want $want"; sed 's/^/     /' "$tmp/out"; fail=1; fi
}

printf '#!/usr/bin/env bash\necho "$1"\n' > "$tmp/clean.sh"
# SC2086-class finding (unquoted expansion is info; SC2164 cd without || is warning-level)
printf '#!/usr/bin/env bash\ncd /tmp\nrm -rf $1/*\n' > "$tmp/bad.sh"
printf '#!/usr/bin/env bash\r\necho hi\r\n' > "$tmp/crlf.sh"
printf 'on: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${{ github.nope.x }}\n        shell: nosuchshell\n' > "$tmp/bad.yml"
printf 'on: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n' > "$tmp/clean.yml"

expect crlf-clean 0 bash "$LINT" crlf "$tmp/clean.sh"
expect crlf-detects-cr 1 bash "$LINT" crlf "$tmp/crlf.sh"
expect crlf-unreadable-file-fails 1 bash "$LINT" crlf "$tmp/does-not-exist.sh"
expect unknown-check 2 bash "$LINT" nonsense
expect crlf-tracked-tree 0 bash "$LINT" crlf

if command -v shellcheck > /dev/null 2>&1; then
  expect shellcheck-clean 0 bash "$LINT" shellcheck "$tmp/clean.sh"
  expect shellcheck-detects-finding 1 bash "$LINT" shellcheck "$tmp/bad.sh"
  expect shellcheck-tracked-tree 0 bash "$LINT" shellcheck
else
  echo "SKIPPED shellcheck cases: shellcheck not installed"
fi
if command -v actionlint > /dev/null 2>&1; then
  expect actionlint-clean 0 bash "$LINT" actionlint "$tmp/clean.yml"
  expect actionlint-detects-finding 1 bash "$LINT" actionlint "$tmp/bad.yml"
  expect actionlint-tracked-workflows 0 bash "$LINT" actionlint
else
  echo "SKIPPED actionlint cases: actionlint not installed"
fi
# A missing tool is a skip locally, a failure in CI.
mkdir "$tmp/empty"
expect missing-tool-local-skip 0 env -i PATH="$tmp/empty" "$(command -v bash)" "$LINT" shellcheck "$tmp/clean.sh"
expect missing-tool-ci-fails 1 env -i PATH="$tmp/empty" GITHUB_ACTIONS=true "$(command -v bash)" "$LINT" shellcheck "$tmp/clean.sh"
exit "$fail"
