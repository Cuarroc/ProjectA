#!/usr/bin/env bash
# win-signal (WIN-01): does this branch need an early Windows verdict, and if
# so, get one now instead of in the merge queue.
#
# On an ordinary PR `gates (windows)` is a stub (CI-03); the first real Windows
# verdict comes from the queue, where a failure throws the PR out again. This
# script decides from the files the branch changed against origin/main whether
# that risk is real and, if so, starts the `ci` workflow by hand on the branch
# (workflow_dispatch runs both lanes in full) and waits for the result.
#
# Usage: win-signal.sh [--dry-run] [--force] [--files-from <file|->] <branch>
#   --force        run even when the decision is no (probe)
#   --dry-run      print the decision only; never calls gh
#   --files-from   read the changed files from a file (or stdin) - for tests
# Env: WIN_SIGNAL_TREE  directory the content check reads files from (tests);
#      WIN_SIGNAL_TIMEOUT  seconds to wait for the run (default 2700).
#      WIN_SIGNAL_SLEEP  poll interval override in seconds (tests).
# Output: decision=yes|no, reason=..., trigger=<file>, then for a run
#   run=<id>, url=<url>, conclusion=<conclusion>.
# Exit: 0 no signal needed or run succeeded, 1 run finished but not successful,
#   2 usage or tool error (bad diff, unreadable file list, gh failed),
#   3 timed out waiting (no run appeared, or it did not finish in time).
set -uo pipefail

REPO="${WIN_SIGNAL_REPO:-Cuarroc/ProjectA}"
dry=0
force=0
files_from=""
branch=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1 ;;
    --force) force=1 ;;
    --files-from) files_from="${2:-}"; shift ;;
    -*) echo "win-signal: unknown option $1" >&2; exit 2 ;;
    *) branch="$1" ;;
  esac
  shift
done
if [ -z "$branch" ]; then
  echo "usage: win-signal.sh [--dry-run] [--force] [--files-from <file|->] <branch>" >&2
  exit 2
fi

# Refs for the diff and the content check (not used with --files-from).
head_ref="origin/$branch"
git rev-parse -q --verify "$head_ref" > /dev/null 2>&1 || head_ref="$branch"

changed_files() {
  if [ -n "$files_from" ]; then
    if [ "$files_from" = "-" ]; then cat; else cat "$files_from"; fi
  else
    git diff --name-only "origin/main...$head_ref"
  fi
}

# Read the list up front: a failing diff or unreadable list must stop the
# script, not look like "no changed files" (decision=no).
files="$(changed_files)" || {
  echo "win-signal: cannot determine the changed files (unknown ref, shallow clone, unreadable --files-from)" >&2
  exit 2
}

# The seams, PTY and process capture code, Windows scripts, the workflow.
path_trigger() { # path -> reason on stdout, status 0 on hit
  case "$1" in
    src-tauri/src/api.rs | src-tauri/src/main.rs | src-tauri/src/store.rs | \
      src-tauri/src/store/* | src-tauri/src/bin/pa.rs) echo "seam" ;;
    src-tauri/src/pty.rs | src-tauri/src/pty/* | src-tauri/src/process_capture/* | \
      src-tauri/src/process_capture.rs | src-tauri/src/capture_core.rs) echo "PTY/process capture code" ;;
    scripts/*.ps1 | scripts/*windows* | scripts/ci/native-tests.sh) echo "Windows-relevant script" ;;
    .github/workflows/*) echo "workflow" ;;
    *) return 1 ;;
  esac
}

has_cfg_windows() { # path
  local content
  case "$1" in src-tauri/*.rs) ;; *) return 1 ;; esac
  if [ -n "${WIN_SIGNAL_TREE:-}" ]; then
    content="$(cat "$WIN_SIGNAL_TREE/$1" 2> /dev/null)" || return 1
  else
    content="$(git show "$head_ref:$1" 2> /dev/null)" || return 1
  fi
  grep -Eq 'cfg!?\(([^)]*[^a-z_])?(windows|target_os *= *"windows")' <<< "$content"
}

decision=no
reason="no changed file touches a Windows risk area"
trigger=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if r="$(path_trigger "$f")"; then
    decision=yes; reason="$r"; trigger="$f"; break
  fi
  if has_cfg_windows "$f"; then
    decision=yes; reason="#[cfg(windows)] code"; trigger="$f"; break
  fi
done <<< "$files"

if [ "$force" -eq 1 ] && [ "$decision" = no ]; then decision=yes; reason=forced; fi
echo "decision=$decision"
echo "reason=$reason"
[ -z "$trigger" ] || echo "trigger=$trigger"
if [ "$decision" = no ] || [ "$dry" -eq 1 ]; then exit 0; fi

# --- start the run and wait for its verdict -------------------------------
git ls-remote --exit-code --heads origin "$branch" > /dev/null 2>&1 || {
  echo "win-signal: branch '$branch' is not on origin; push it first" >&2
  exit 2
}
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
gh workflow run ci.yml --repo "$REPO" --ref "$branch" >&2 || exit 2

deadline=$((SECONDS + ${WIN_SIGNAL_TIMEOUT:-2700}))
err="$(mktemp "${TMPDIR:-/tmp}/win-signal-gh.XXXXXX")"
trap 'rm -f "$err"' EXIT
# A gh failure is an error (exit 2, gh's stderr shown); only "no run yet" and
# "run not finished" keep the loops waiting.
gh_fail() { echo "win-signal: gh failed: $(cat "$err")" >&2; exit 2; }

run_id=""
while [ -z "$run_id" ] && [ "$SECONDS" -lt "$deadline" ]; do
  sleep "${WIN_SIGNAL_SLEEP:-10}"
  run_id="$(gh run list --repo "$REPO" --workflow ci.yml --branch "$branch" \
    --event workflow_dispatch --limit 5 --json databaseId,createdAt \
    --jq "[.[] | select(.createdAt >= \"$started\")] | sort_by(.createdAt) | last | .databaseId // empty" 2> "$err")" || gh_fail
done
[ -n "$run_id" ] || { echo "win-signal: no run appeared for '$branch'" >&2; exit 3; }
echo "run=$run_id"

conclusion=""
while [ "$SECONDS" -lt "$deadline" ]; do
  conclusion="$(gh run view "$run_id" --repo "$REPO" --json conclusion --jq .conclusion 2> "$err")" || gh_fail
  [ -z "$conclusion" ] || break
  sleep "${WIN_SIGNAL_SLEEP:-30}"
done
echo "url=https://github.com/$REPO/actions/runs/$run_id"
if [ -z "$conclusion" ]; then
  echo "conclusion=timeout"
  exit 3
fi
echo "conclusion=$conclusion"
[ "$conclusion" = success ]
