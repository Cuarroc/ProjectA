#!/usr/bin/env bash
# Selftest for CI-HARDEN-01: the precommit lane skips fmt/cargo-check for a
# staged diff without Rust inputs, hints at a cold target/, and says "npm ci"
# instead of TS2688 noise; the commit-msg hook rejects wrong trailers at
# commit time. Runs against copies in throwaway repos - no cargo, no network.
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fails=0
ok() { echo "ok   $*"; }
bad() { echo "FEHLER $*"; fails=$((fails + 1)); }

new_repo() { # dir
  mkdir -p "$1/scripts/ci" "$1/scripts/lib" "$1/.githooks" "$1/src-tauri/src"
  cp "$HERE/scripts/ci/lane-plan.sh" "$HERE/scripts/ci/red-first.sh" "$1/scripts/ci/"
  cp "$HERE/scripts/lib/test-first.sh" "$1/scripts/lib/"
  cp "$HERE/.githooks/commit-msg" "$1/.githooks/"
  git -C "$1" init -q -b main
  git -C "$1" config user.email probe@example.test
  git -C "$1" config user.name probe
  mkdir -p "$1/tests"
  printf 'fn existing_test() {}\n' > "$1/tests/old.rs"
}

# --- precommit lane: gates.sh copy with three synthetic gates ---------------
G="$TMP/g"
new_repo "$G"
python3 - "$HERE/scripts/ci/gates.sh" "$G/scripts/ci/gates.sh" << 'PY'
import re, sys
s = open(sys.argv[1]).read()
a, b = s.index("GATES=("), s.index("\n)\n", s.index("GATES=(")) + 3
gates = 'GATES=(\n  "fmt|precommit|.|echo FMT-RAN"\n  "cargo-check|precommit|.|cargo --version >/dev/null; echo CHECK-RAN"\n  "typecheck|precommit|.|echo TC-RAN"\n)\n'
open(sys.argv[2], "w").write(s[:a] + gates + s[b:])
PY
git -C "$G" add -A && git -C "$G" commit -q -m base
run_lane() { (cd "$G" && env -u CARGO_TARGET_DIR bash scripts/ci/gates.sh lane precommit 2>&1); }
mkdir -p "$G/node_modules"

printf 'x\n' > "$G/NOTES.md" && git -C "$G" add NOTES.md
out="$(run_lane)"
if grep -q 'Gate fmt: uebersprungen' <<< "$out" && grep -q 'Gate cargo-check: uebersprungen' <<< "$out" \
  && ! grep -q 'FMT-RAN\|CHECK-RAN' <<< "$out" && grep -q 'TC-RAN' <<< "$out"; then
  ok "docs-only staged diff skips fmt and cargo-check, logs why, still typechecks"
else bad "docs-only diff did not skip the cargo gates"; echo "$out" | sed 's/^/    /'; fi
git -C "$G" reset -q

printf 'fn main() {}\n' > "$G/src-tauri/src/main.rs" && git -C "$G" add -A
out="$(run_lane)"
if grep -q 'FMT-RAN' <<< "$out" && grep -q 'CHECK-RAN' <<< "$out" && ! grep -q uebersprungen <<< "$out"; then
  ok "staged .rs diff runs fmt and cargo-check"
else bad "a .rs diff skipped the cargo gates"; echo "$out" | sed 's/^/    /'; fi
if grep -q 'Build slots' <<< "$out"; then ok "cold worktree gets the Build-slots hint once"
else bad "no Build-slots hint without target/"; fi
n="$(grep -c 'Build slots' <<< "$out")"
[ "$n" -eq 1 ] && ok "hint printed once" || bad "hint printed $n times"
out="$(cd "$G" && CARGO_TARGET_DIR=/x bash scripts/ci/gates.sh lane precommit 2>&1)"
grep -q 'Build slots' <<< "$out" && bad "hint despite CARGO_TARGET_DIR" || ok "no hint when CARGO_TARGET_DIR is set"

git -C "$G" commit -q -m rust-base
mkdir -p "$G/docs" && git -C "$G" mv src-tauri/src/main.rs docs/main.md
out="$(run_lane)"
if grep -q 'FMT-RAN' <<< "$out" && grep -q 'CHECK-RAN' <<< "$out"; then ok "renamed Rust source still runs Rust gates"
else bad "renamed Rust source skipped the Rust gates"; fi

rmdir "$G/node_modules"
out="$(run_lane)"; rc=$?
if [ "$rc" -ne 0 ] && grep -q 'run npm ci' <<< "$out" && ! grep -q 'TC-RAN' <<< "$out"; then
  ok "missing node_modules fails typecheck with a one-line npm ci hint"
else bad "missing node_modules not reported (rc=$rc)"; fi

# --- commit-msg hook --------------------------------------------------------
C="$TMP/c"
new_repo "$C"
git -C "$C" add -A && git -C "$C" commit -q -m base
git -C "$C" update-ref refs/remotes/origin/main HEAD
printf 'fn real_test() {}\n' > "$C/tests/new.rs"
printf 'notes\n' > "$C/NOTES.md"
git -C "$C" add -A
msg() { printf '%s\n\n%s\n' "subject" "$1" > "$TMP/msg"; (cd "$C" && bash .githooks/commit-msg "$TMP/msg" > "$TMP/hook.out" 2>&1); }

msg "Test-First: tests/new.rs::missing_test" && bad "nonexistent test name accepted" || ok "Test-First naming a nonexistent test is rejected"
msg "Test-First: tests/old.rs" && bad "bare path of a file with tests at the base accepted" || ok "bare Test-First path for an existing file is rejected (#351)"
msg "Test-First: tests/gone.rs::real_test" && bad "missing path accepted" || ok "Test-First path that does not exist is rejected"
msg "Test-First: tests/new.rs::real_test" && ok "existing new test is accepted" || { bad "valid trailer rejected"; sed 's/^/    /' "$TMP/hook.out"; }
git -C "$C" reset -q && git -C "$C" add NOTES.md
msg "No-Test: documentation only" && ok "No-Test on a docs-only commit is accepted" || { bad "docs-only No-Test rejected"; sed 's/^/    /' "$TMP/hook.out"; }
git -C "$C" reset -q && git -C "$C" rm -q tests/old.rs
msg "Test-First: tests/old.rs::existing_test" && bad "deleted Test-First path accepted" || ok "deleted Test-First path is rejected"

[ "$fails" -eq 0 ] && echo "test-precommit-lane: OK" || { echo "test-precommit-lane: $fails Fehler"; exit 1; }
