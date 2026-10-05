#!/usr/bin/env bash
# shell-lint.sh - lint the glue code (CI-HARDEN-03). Gates registered in gates.sh:
#   shell-lint.sh shellcheck [file...]   shellcheck -S warning over tracked *.sh + .githooks/*
#   shell-lint.sh actionlint [file...]   actionlint over .github/workflows/*.yml
#   shell-lint.sh crlf [file...]         no CR byte in tracked *.sh + .githooks/*
# Without file arguments the tracked files are used; the self-test passes fixtures.
#
# A missing tool is a logged skip locally and a failure in CI (GITHUB_ACTIONS=true):
# green by absence is exactly what AGENTS.md rule 9 forbids.
set -uo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1

# Known findings on main today. Not silent: every code is justified here and
# the real fixes are follow-ups (see the CI-HARDEN-03 PR text).
#   SC1007  `CDPATH= cd` is the idiom that resets CDPATH; shellcheck misreads it
#   SC1090  dynamic `source` (a `# shellcheck source=` hint exists where it works)
#   SC2034  unused variables: read-loop fields, sourced-library arrays, test tables
#   SC2221/SC2222  overlapping case patterns in scripts/lib/test-first.sh
#   SC2140  quoting in scripts/test-review-local.sh
#   SC2154  scripts/test-gates.sh references a variable assigned via eval
SHELLCHECK_EXCLUDE="SC1007,SC1090,SC2034,SC2140,SC2154,SC2221,SC2222"

check="${1:-}"
[ $# -gt 0 ] && shift

need_tool() { # tool
  command -v "$1" > /dev/null 2>&1 && return 0
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "::error::$1 is not installed on the runner (.github/actions/setup-linux)"
    exit 1
  fi
  echo "SKIPPED: $1 not installed - this run does not prove the check (CI does)"
  exit 0
}

shell_files() { # prints NUL-separated paths
  if [ $# -gt 0 ]; then printf '%s\0' "$@"; else git ls-files -z -- '*.sh' '.githooks/*'; fi
}

case "$check" in
  shellcheck)
    need_tool shellcheck
    files=()
    while IFS= read -r -d '' f; do files+=("$f"); done < <(shell_files "$@")
    [ "${#files[@]}" -gt 0 ] || { echo "::error::no shell files found"; exit 1; }
    shellcheck -S warning -e "$SHELLCHECK_EXCLUDE" "${files[@]}"
    rc=$?
    [ "$rc" -eq 0 ] && echo "shellcheck: ${#files[@]} file(s) clean (excluded: $SHELLCHECK_EXCLUDE)"
    exit "$rc"
    ;;
  actionlint)
    need_tool actionlint
    if [ $# -gt 0 ]; then actionlint "$@"; else actionlint .github/workflows/*.yml; fi
    rc=$?
    [ "$rc" -eq 0 ] && echo "actionlint: clean"
    exit "$rc"
    ;;
  crlf)
    bad=0
    n=0
    while IFS= read -r -d '' f; do
      n=$((n + 1))
      # tr, not grep: grep exit 2 (unreadable) must not pass as clean, and
      # MSYS grep strips the CR before matching.
      if [ ! -r "$f" ]; then
        echo "ERROR: $f is not readable" >&2
        bad=1
      elif [ -n "$(LC_ALL=C tr -cd '\r' < "$f" | head -c 1)" ]; then
        echo "ERROR: $f contains CR (CRLF line endings break the shebang and read -r)" >&2
        bad=1
      fi
    done < <(shell_files "$@")
    [ "$n" -gt 0 ] || { echo "::error::no shell files found"; exit 1; }
    [ "$bad" -eq 0 ] && echo "crlf: $n file(s) free of CR"
    exit "$bad"
    ;;
  *)
    echo "usage: shell-lint.sh shellcheck|actionlint|crlf [file...]" >&2
    exit 2
    ;;
esac
