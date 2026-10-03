#!/usr/bin/env bash
# CI-06: the prepush lane checks the trailers of the new commits against
# origin/main with red-first.sh --plan (same logic as the PR CI, no copy).
# Runs the real gate command from gates.sh inside a throwaway repo.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/red-first-local.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

for lane in prepush branchpush; do
  list="$(bash "$ROOT/scripts/ci/gates.sh" --list "$lane")"
  if ! printf '%s\n' "$list" | grep -qx 'red-first-plan'; then
    echo "FAIL: lane $lane has no red-first-plan gate" >&2
    exit 1
  fi
done

REPO="$TMP/repo"
mkdir -p "$REPO/scripts/ci" "$REPO/scripts/lib"
cp "$ROOT/scripts/ci/gates.sh" "$ROOT/scripts/ci/red-first.sh" "$REPO/scripts/ci/"
cp "$ROOT/scripts/lib/test-first.sh" "$REPO/scripts/lib/"
cd "$REPO"
git init -q -b main
git config user.email "probe@example.test"
git config user.name "red-first local probe"
printf '# baseline\n' > README.md
mkdir -p src-tauri/src
printf 'fn main() {}\n' > src-tauri/src/lib.rs
git add .
git commit -q -m "docs: baseline"
git update-ref refs/remotes/origin/main HEAD
git checkout -q -b feature
BASE="$(git rev-parse HEAD)"

run_gate() { bash scripts/ci/gates.sh run red-first-plan >"$TMP/out" 2>&1; }

expect_red() {
  local label="$1" expected="$2"
  if run_gate; then
    sed 's/^/    /' "$TMP/out" >&2
    echo "FAIL: $label passed the red-first-plan gate" >&2
    exit 1
  fi
  if ! grep -Fq "$expected" "$TMP/out"; then
    sed 's/^/    /' "$TMP/out" >&2
    echo "FAIL: $label: expected message not found: $expected" >&2
    exit 1
  fi
  git reset -q --hard "$BASE"
}

printf '// change\n' >> src-tauri/src/lib.rs
git commit -qam "fix: source without trailer"
expect_red "source change without trailer" "ohne Test-First:"

printf '# x\n' >> README.md
git commit -qam "docs: bad trailer" -m "Test-First: one.sh,two.sh"
expect_red "malformed trailer" "mehrere Belege als eigene Zeilen"

printf '// change\n' >> src-tauri/src/lib.rs
git commit -qam "fix: with trailer" -m "No-Test: probe"
if ! run_gate; then
  sed 's/^/    /' "$TMP/out" >&2
  echo "FAIL: a commit with a valid No-Test trailer was rejected" >&2
  exit 1
fi

echo "test-red-first-local: passed"
