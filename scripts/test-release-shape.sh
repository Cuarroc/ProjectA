#!/usr/bin/env bash
# Self-test for scripts/ci/release-shape.sh: real files pass, each mutation
# fails for its own reason. old-release-yml = the v1.5.0 shape (run 37338718635).
set -uo pipefail

HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
SHAPE="$HERE/scripts/ci/release-shape.sh"
WF="$HERE/.github/workflows/release.yml"
ACT="$HERE/.github/actions/setup-windows-release/action.yml"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/release-shape.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
fails=0
[ -f "$SHAPE" ] || { echo "FEHLER: $SHAPE fehlt"; exit 1; }

check() { # name expected(pass|fail) release.yml action.yml [reason-regex]
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

wf() { sed "$1" "$WF" > "$tmp/$2.yml"; echo "$tmp/$2.yml"; }
act() { sed "$1" "$ACT" > "$tmp/$2.action.yml"; echo "$tmp/$2.action.yml"; }

check real-files-pass pass "$WF" "$ACT"

# v1.5.0: the tag job's own setup, no composite (2nd use = windows-installer).
awk '/uses: \.\/\.github\/actions\/setup-windows-release/ && ++n == 2 {
  print "      - uses: taiki-e/install-action@83ac0ad63c0167e6f06796fab0fce28db1bf3db0 # v2.87.22"
  print "        with:"
  print "          tool: nextest"
  print "      - run: npx playwright install chromium"
  next } { print }' "$WF" > "$tmp/old.yml"
check old-release-yml-missing-lint-tools-fails fail "$tmp/old.yml" "$ACT" "gate shellcheck is in the release lane"

check composite-without-shellcheck-fails fail "$WF" "$(act 's/,shellcheck@0\.11\.0//' nosc)" "gate shellcheck "
check composite-without-actionlint-fails fail "$WF" "$(act 's/windows_amd64/x/' noal)" "gate actionlint "
check composite-without-cargo-deny-fails fail "$WF" "$(act 's/,cargo-deny@0\.20\.2//' nodeny)" "gate licenses "

check dry-run-with-environment-fails fail \
  "$(wf "/^    if: github.event_name == 'workflow_dispatch'\$/a\\    environment: release" dryenv)" "$ACT" \
  "job release-gates-dry-run has an environment"
awk '/run: bash scripts\/ci\/gates\.sh lane release/ && ++n == 1 {
  print; print "        env:"; print "          K: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}"; next } { print }' "$WF" > "$tmp/drysecret.yml"
check dry-run-reading-secret-fails fail "$tmp/drysecret.yml" "$ACT" "job release-gates-dry-run reads a secret"
check dry-run-without-dispatch-guard-fails fail \
  "$(wf "/^    if: github.event_name == 'workflow_dispatch'\$/d" drynoif)" "$ACT" "not limited to workflow_dispatch"
check installer-without-environment-fails fail "$(wf '/^    environment: release$/d' noenv)" "$ACT" "lost environment: release"
check installer-without-push-guard-fails fail "$(wf "/^    if: github.event_name == 'push'\$/d" nopush)" "$ACT" "not limited to push"

# gates.sh must not run `git merge-base origin/main` while loading its list:
# a tag checkout has no origin/main ("fatal: Not a valid object name").
list="$(bash "$HERE/scripts/ci/gates.sh" --list)"
if grep -F 'BASE_SHA="$(git merge-base origin/main HEAD)"' <<< "$list" > /dev/null; then
  echo "ok   gates-list-defers-merge-base"
else
  echo "FEHLER gates-list-defers-merge-base: red-first-plan expanded at load time"
  fails=$((fails + 1))
fi

[ "$fails" -eq 0 ] || { echo "test-release-shape: $fails failure(s)"; exit 1; }
echo "test-release-shape: all cases passed"
