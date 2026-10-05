#!/usr/bin/env bash
# Self-test for scripts/ci/win-signal.sh (WIN-01): the selection logic that
# decides from a branch's changed files whether an early Windows verdict is
# worth a manual `ci` run. Fixture file lists go in through --files-from, the
# content check (cfg(windows)) reads a fixture tree through WIN_SIGNAL_TREE.
# Passing cases print `ok   <name>`; each case checks both directions.
set -uo pipefail

HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
SIGNAL="${WIN_SIGNAL_SCRIPT:-$HERE/scripts/ci/win-signal.sh}"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/win-signal.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
fails=0

pass() { echo "ok   $1"; }
fail() { echo "FEHLER $1"; fails=$((fails + 1)); }

mkdir -p "$tmp/tree/src-tauri/src" "$tmp/tree/src"
printf '#[cfg(windows)]\nfn w() {}\n' > "$tmp/tree/src-tauri/src/win_only.rs"
printf '#[cfg(target_os = "windows")]\nfn w() {}\n' > "$tmp/tree/src-tauri/src/win_os.rs"
printf '#[cfg(unix)]\nfn u() {}\n' > "$tmp/tree/src-tauri/src/unix_only.rs"
printf 'fn plain() {}\n' > "$tmp/tree/src-tauri/src/plain.rs"
printf 'x\n' > "$tmp/tree/src/App.tsx"

# decide <name> <expect: yes|no> <file>...: run --dry-run on a file list.
decide() {
  local name="$1" want="$2" out
  shift 2
  out="$(printf '%s\n' "$@" | WIN_SIGNAL_TREE="$tmp/tree" bash "$SIGNAL" --dry-run --files-from - some/branch 2>&1)"
  local rc=$?
  if [ "$rc" -eq 0 ] && grep -qx "decision=$want" <<< "$out"; then pass "$name"; else
    fail "$name (rc=$rc, want decision=$want)"
    echo "$out" | sed 's/^/     /'
  fi
}

decide cfg-windows-code-needs-signal yes src-tauri/src/win_only.rs
decide cfg-target-os-windows-needs-signal yes src-tauri/src/win_os.rs
decide cfg-unix-only-code-needs-no-signal no src-tauri/src/unix_only.rs
decide plain-rust-needs-no-signal no src-tauri/src/plain.rs
decide seam-api-needs-signal yes src-tauri/src/api.rs
decide seam-main-needs-signal yes src-tauri/src/main.rs
decide seam-store-needs-signal yes src-tauri/src/store.rs
decide seam-store-dir-needs-signal yes src-tauri/src/store/queue_rows.rs
decide seam-pa-bin-needs-signal yes src-tauri/src/bin/pa.rs
decide pty-code-needs-signal yes src-tauri/src/pty/spawn.rs
decide pty-file-needs-signal yes src-tauri/src/pty.rs
decide process-capture-needs-signal yes src-tauri/src/process_capture/job.rs
decide powershell-script-needs-signal yes scripts/verify-windows-package.ps1
decide windows-named-script-needs-signal yes scripts/build-signed-windows.mjs
decide ci-workflow-needs-signal yes .github/workflows/ci.yml
decide docs-only-needs-no-signal no docs/setup/mergify.md STAND.md
decide frontend-only-needs-no-signal no src/App.tsx
decide one-hit-among-many-needs-signal yes docs/setup/mergify.md src/App.tsx src-tauri/src/pty.rs
decide empty-file-list-needs-no-signal no

# The decision names the trigger so the author can see why.
out="$(printf 'src-tauri/src/pty.rs\n' | WIN_SIGNAL_TREE="$tmp/tree" bash "$SIGNAL" --dry-run --files-from - b 2>&1)"
if grep -q 'src-tauri/src/pty.rs' <<< "$out" && grep -q '^reason=' <<< "$out"; then
  pass dry-run-names-trigger-and-reason
else fail "dry-run-names-trigger-and-reason"; fi

# --force turns a "no" into a run request (probe on a branch without Windows code).
out="$(printf 'docs/setup/mergify.md\n' | bash "$SIGNAL" --dry-run --force --files-from - b 2>&1)"
if grep -qx 'decision=yes' <<< "$out" && grep -qx 'reason=forced' <<< "$out"; then pass force-overrides-no-decision; else fail "force-overrides-no-decision"; fi

# --dry-run never starts a run: gh is a shim that fails the test when called.
mkdir -p "$tmp/bin"
printf '#!/bin/sh\necho called >> "%s/gh.log"\nexit 1\n' "$tmp" > "$tmp/bin/gh"
chmod +x "$tmp/bin/gh"
printf 'src-tauri/src/pty.rs\n' | PATH="$tmp/bin:$PATH" WIN_SIGNAL_TREE="$tmp/tree" bash "$SIGNAL" --dry-run --files-from - b > /dev/null 2>&1
if [ ! -e "$tmp/gh.log" ]; then pass dry-run-never-calls-gh; else fail "dry-run-never-calls-gh"; fi

# A missing branch argument is a usage error, not a silent "no".
if bash "$SIGNAL" --dry-run > /dev/null 2>&1; then fail "missing-branch-is-usage-error"; else pass missing-branch-is-usage-error; fi

if [ "$fails" -ne 0 ]; then echo "test-win-signal: $fails case(s) failed"; exit 1; fi
echo "test-win-signal: all cases passed"
