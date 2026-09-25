#!/usr/bin/env bash
# A named Rust Test-First spec whose test is #[cfg]-gated to the other OS is
# skipped by red-first on this platform instead of failing at the head, while a
# test that is merely absent (or absent from the source) stays red.
#
# Found on PR #12 (W2-07b): its Windows-only tests are not compiled on the
# Linux runner, so `cargo test -- --list` never shows them and every named
# Test-First spec of those tests failed at the head.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/test-first.sh"
declare -F tf_rust_test_gated_off_platform >/dev/null || {
  echo 'FAIL: tf_rust_test_gated_off_platform is not defined' >&2
  exit 1
}
source <(sed -n '/^classify_run() {/,/^}/p' "$ROOT/scripts/ci/red-first.sh")
source <(sed -n '/^run_spec() {/,/^}/p' "$ROOT/scripts/ci/red-first.sh")
as_native_path() { printf '%s\n' "$1"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
tree="$TMP/tree"
mkdir -p "$tree/src-tauri/src/api" "$TMP/bin"

# `cargo test -- --list` on this fake platform lists only the always-on test.
cat > "$TMP/bin/cargo" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = test ] && [[ " $* " == *" --list "* ]]; then
  echo 'tests::always_on: test'
  exit 0
fi
echo 'unexpected cargo call' >&2
exit 9
EOF
chmod +x "$TMP/bin/cargo"
export PATH="$TMP/bin:$PATH"

cat > "$tree/src-tauri/src/api.rs" <<'EOF'
#[cfg(windows)]
#[path = "api/win_only.rs"]
mod win_only;
#[cfg(not(windows))]
#[path = "api/not_win.rs"]
mod not_win;
#[cfg(unix)]
#[path = "api/unix_only.rs"]
mod unix_only;
#[path = "api/plain.rs"]
mod plain;
EOF
cat > "$tree/src-tauri/src/api/win_only.rs" <<'EOF'
#[test]
fn a_windows_only_test() {}
EOF
cat > "$tree/src-tauri/src/api/not_win.rs" <<'EOF'
#[test]
fn a_not_windows_test() {}
EOF
cat > "$tree/src-tauri/src/api/unix_only.rs" <<'EOF'
#[test]
fn a_unix_only_test() {}
EOF
cat > "$tree/src-tauri/src/api/plain.rs" <<'EOF'
#[test]
fn an_ungated_but_unlisted_test() {}
#[cfg(windows)]
#[test]
fn an_attribute_gated_windows_test() {}
EOF

fail() { echo "FAIL: $1" >&2; exit 1; }

gated() { TF_HOST_OS="$1" tf_rust_test_gated_off_platform "$tree" "$2" "$3"; }

gated unix src-tauri/src/api/win_only.rs a_windows_only_test \
  || fail 'a test in a #[cfg(windows)] module was not seen as gated off on a unix host'
gated unix src-tauri/src/api/plain.rs an_attribute_gated_windows_test \
  || fail 'a #[cfg(windows)]-attributed test was not seen as gated off on a unix host'
gated windows src-tauri/src/api/unix_only.rs a_unix_only_test \
  || fail 'a test in a #[cfg(unix)] module was not seen as gated off on a windows host'
gated windows src-tauri/src/api/win_only.rs a_windows_only_test \
  && fail 'a windows-gated test was skipped on a windows host'
gated unix src-tauri/src/api/not_win.rs a_not_windows_test \
  && fail 'a #[cfg(not(windows))] test was skipped on a unix host, where it is compiled'
gated unix src-tauri/src/api/plain.rs an_ungated_but_unlisted_test \
  && fail 'an ungated test that is merely unlisted was skipped'
gated unix src-tauri/src/api/win_only.rs a_test_that_does_not_exist \
  && fail 'a test that is not in the source was skipped'
gated unix src-tauri/src/api/missing.rs a_windows_only_test \
  && fail 'a missing source file was skipped'

# End to end through run_spec/classify_run, as the CI job runs it.
export TF_HOST_OS=unix
RF_TARGET=$TMP/target
set +e
out="$(run_spec 'src-tauri/src/api/win_only.rs::a_windows_only_test' "$tree" "$RF_TARGET" 2>&1)"
code=$?
set -e
[ "$code" -eq 0 ] || fail "run_spec exited $code for a gated-off test: $out"
classify_run "$out" "$code" 'src-tauri/src/api/win_only.rs::a_windows_only_test' \
  || fail "a gated-off test did not classify green at the head: $out"

set +e
out="$(run_spec 'src-tauri/src/api/win_only.rs::a_test_that_does_not_exist' "$tree" "$RF_TARGET" 2>&1)"
code=$?
set -e
if classify_run "$out" "$code" 'src-tauri/src/api/win_only.rs::a_test_that_does_not_exist'; then
  fail "a test missing from the source classified green: $out"
fi
set +e
out="$(run_spec 'src-tauri/src/api/plain.rs::an_ungated_but_unlisted_test' "$tree" "$RF_TARGET" 2>&1)"
code=$?
set -e
if classify_run "$out" "$code" 'src-tauri/src/api/plain.rs::an_ungated_but_unlisted_test'; then
  fail "an ungated, unlisted test classified green: $out"
fi

echo 'red-first platform-gated specs: passed'
