#!/usr/bin/env bash
# Fast regression test for red-first's build-free plan validation.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/red-first-plan.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

REPO="$TMP/repo"
mkdir -p "$REPO/scripts/ci" "$REPO/scripts/lib"
cp "$ROOT/scripts/ci/red-first.sh" "$REPO/scripts/ci/red-first.sh"
cp "$ROOT/scripts/lib/test-first.sh" "$REPO/scripts/lib/test-first.sh"

cd "$REPO"
git init -q -b main
git config user.email "probe@example.test"
git config user.name "red-first plan probe"
printf '# baseline\n' > README.md
printf '#!/usr/bin/env bash\nexit 0\n' > scripts/existing-test.sh
git add .
git commit -q -m "docs: baseline"
BASE="$(git rev-parse HEAD)"

expect_plan_failure() {
  local label="$1" expected="$2" head
  head="$(git rev-parse HEAD)"
  if BASE_SHA="$BASE" HEAD_SHA="$head" PR_BODY="" \
    bash scripts/ci/red-first.sh --plan >"$TMP/out" 2>&1; then
    sed 's/^/    /' "$TMP/out" >&2
    echo "FAIL: $label was accepted by --plan" >&2
    exit 1
  fi
  if ! grep -Fq "$expected" "$TMP/out"; then
    sed 's/^/    /' "$TMP/out" >&2
    echo "FAIL: $label did not explain the expected error: $expected" >&2
    exit 1
  fi
  echo "ok   $label"
  git reset -q --hard "$BASE"
}

expect_plan_success() {
  local label="$1" head
  head="$(git rev-parse HEAD)"
  if ! BASE_SHA="$BASE" HEAD_SHA="$head" PR_BODY="" \
    bash scripts/ci/red-first.sh --plan >"$TMP/out" 2>&1; then
    sed 's/^/    /' "$TMP/out" >&2
    echo "FAIL: $label was rejected by --plan" >&2
    exit 1
  fi
  echo "ok   $label"
  git reset -q --hard "$BASE"
}

printf '# path only\n' >> README.md
git add README.md
git commit -q -m "docs: path-only existing test" \
  -m "Test-First: scripts/existing-test.sh"
expect_plan_failure "path-only trailer on existing test file" \
  "use Test-First: <path>::<exact test name> for each NEW test"

printf '# regression path only\n' >> README.md
git add README.md
git commit -q -m "docs: path-only existing regression test" \
  -m "Regression-For: scripts/existing-test.sh"
expect_plan_failure "path-only Regression-For trailer on existing test file" \
  "use Test-First: <path>::<exact test name> for each NEW test"

printf '# named test\n' >> README.md
git add README.md
git commit -q -m "docs: named existing test" \
  -m "Test-First: scripts/existing-test.sh::exact test name"
expect_plan_success "named trailer on existing test file"

printf '#!/usr/bin/env bash\nexit 0\n' > scripts/new-test.sh
git add scripts/new-test.sh
git commit -q -m "test: add new test file" \
  -m "Test-First: scripts/new-test.sh"
expect_plan_success "path-only trailer on new test file"

printf '# malformed\n' >> README.md
git add README.md
git commit -q -m "docs: malformed evidence" -m "Test-First: one.sh,two.sh"
expect_plan_failure "malformed trailer in a docs-only commit" \
  "mehrere Belege als eigene Zeilen"

printf '# bare name\n' >> README.md
git add README.md
git commit -q -m "docs: bare Rust test name" -m "Test-First: foo_bar"
expect_plan_failure "bare Rust test name" "pfad::name"

printf '# stale path\n' >> README.md
git add README.md
git commit -q -m "docs: stale evidence path" \
  -m "Test-First: scripts/test-removed.sh::removed_behavior"
expect_plan_failure "missing Test-First path" "existiert am HEAD nicht"

echo "test-red-first-plan: passed"
