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
printf 'fn f() { if cfg!(windows) {} }\n' > "$tmp/tree/src-tauri/src/cfg_macro.rs"
printf 'fn f() { if cfg!(target_os = "windows") {} }\n' > "$tmp/tree/src-tauri/src/cfg_macro_os.rs"
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
decide cfg-macro-windows-needs-signal yes src-tauri/src/cfg_macro.rs
decide cfg-macro-target-os-windows-needs-signal yes src-tauri/src/cfg_macro_os.rs
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

# Failing inputs are errors (exit 2), never a silent decision=no.
mkdir -p "$tmp/repo"
git -C "$tmp/repo" init -q
out="$(cd "$tmp/repo" && bash "$SIGNAL" --dry-run nope 2>&1)"
rc=$?
if [ "$rc" -eq 2 ] && ! grep -q '^decision=' <<< "$out"; then pass failing-git-diff-is-error; else fail "failing-git-diff-is-error (rc=$rc)"; fi
out="$(bash "$SIGNAL" --dry-run --files-from "$tmp/missing-list" b 2>&1)"
rc=$?
if [ "$rc" -eq 2 ] && ! grep -q '^decision=' <<< "$out"; then pass unreadable-files-from-is-error; else fail "unreadable-files-from-is-error (rc=$rc)"; fi

# Polling: gh and git are shims. gh run view pops one conclusion per call from
# $tmp/seq (the last line repeats); an empty line is an unfinished run.
cat > "$tmp/bin/gh" <<'SHIM'
#!/bin/sh
d="$GH_SHIM_DIR"
case "$1 $2" in
  "workflow run") echo "Created workflow_dispatch event"; exit 0 ;;
  "run list")
    if [ -e "$d/list-fail" ]; then echo "HTTP 502 list" >&2; exit 1; fi
    echo 4242; exit 0 ;;
  "run view")
    if [ -e "$d/view-fail" ]; then echo "HTTP 401 view" >&2; exit 1; fi
    echo x >> "$d/views"
    first="$(head -n1 "$d/seq")"
    if [ "$(wc -l < "$d/seq")" -gt 1 ]; then sed -i 1d "$d/seq"; fi
    echo "$first"; exit 0 ;;
esac
exit 1
SHIM
printf '#!/bin/sh\n[ "$1" = ls-remote ] && exit 0\nexec %s "$@"\n' "$(command -v git)" > "$tmp/bin/git"
chmod +x "$tmp/bin/gh" "$tmp/bin/git"

# poll <seq-lines> [timeout]: run win-signal --force against the shims.
poll() {
  rm -f "$tmp/list-fail" "$tmp/view-fail" "$tmp/views"
  printf '%b' "$1" > "$tmp/seq"
  out="$(printf 'docs/a.md\n' | PATH="$tmp/bin:$PATH" GH_SHIM_DIR="$tmp" WIN_SIGNAL_SLEEP=0 \
    WIN_SIGNAL_TIMEOUT="${2:-30}" bash "$SIGNAL" --force --files-from - b 2> "$tmp/stderr")"
  rc=$?
}
poll '\n\nsuccess\n'
if [ "$rc" -eq 0 ] && grep -qx 'conclusion=success' <<< "$out" && [ "$(wc -l < "$tmp/views")" -eq 3 ]; then pass in-progress-then-success-exits-0; else fail "in-progress-then-success-exits-0 (rc=$rc)"; fi
poll '\nfailure\n'
if [ "$rc" -eq 1 ] && grep -qx 'conclusion=failure' <<< "$out"; then pass in-progress-then-failure-exits-1; else fail "in-progress-then-failure-exits-1 (rc=$rc)"; fi
poll '\n' 1
if [ "$rc" -eq 3 ] && grep -qx 'conclusion=timeout' <<< "$out"; then pass never-finishing-run-times-out-with-3; else fail "never-finishing-run-times-out-with-3 (rc=$rc)"; fi
poll 'success\n'
touch "$tmp/view-fail"
out="$(printf 'docs/a.md\n' | PATH="$tmp/bin:$PATH" GH_SHIM_DIR="$tmp" WIN_SIGNAL_SLEEP=0 WIN_SIGNAL_TIMEOUT=30 bash "$SIGNAL" --force --files-from - b 2> "$tmp/stderr")"
rc=$?
if [ "$rc" -eq 2 ] && grep -q 'HTTP 401 view' "$tmp/stderr"; then pass gh-view-error-fails-fast-with-2; else fail "gh-view-error-fails-fast-with-2 (rc=$rc)"; fi
rm -f "$tmp/view-fail"
touch "$tmp/list-fail"
out="$(printf 'docs/a.md\n' | PATH="$tmp/bin:$PATH" GH_SHIM_DIR="$tmp" WIN_SIGNAL_SLEEP=0 WIN_SIGNAL_TIMEOUT=30 bash "$SIGNAL" --force --files-from - b 2> "$tmp/stderr")"
rc=$?
if [ "$rc" -eq 2 ] && grep -q 'HTTP 502 list' "$tmp/stderr"; then pass gh-list-error-fails-fast-with-2; else fail "gh-list-error-fails-fast-with-2 (rc=$rc)"; fi
# The start confirmation goes to stderr, stdout stays machine-readable.
poll 'success\n'
if ! grep -q 'Created workflow_dispatch' <<< "$out" && grep -q 'Created workflow_dispatch' "$tmp/stderr"; then pass workflow-run-confirmation-goes-to-stderr; else fail "workflow-run-confirmation-goes-to-stderr"; fi

if [ "$fails" -ne 0 ]; then echo "test-win-signal: $fails case(s) failed"; exit 1; fi
echo "test-win-signal: all cases passed"
