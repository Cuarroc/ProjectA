#!/usr/bin/env bash
# Schicht a (Plan T-1): Warnung, kein Blocker.
# PostToolUse — Quelldateien seit HEAD ohne Test-Diff.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$ROOT"
# shellcheck source=scripts/lib/test-first.sh
. "$ROOT/scripts/lib/test-first.sh"

CHANGED="$(git diff --name-only HEAD; git ls-files --others --exclude-standard)"
[ -n "$CHANGED" ] || exit 0

source_hit=0
test_hit=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if tf_path_is_source "$f"; then
    source_hit=1
  fi
  case "$f" in
    *.test.ts|*.test.tsx|src/test/*|src/__tests__/*|scripts/test-*.sh)
      test_hit=1
      ;;
  esac
done <<EOF
$CHANGED
EOF

if [ "$source_hit" -eq 1 ] && [ "$test_hit" -eq 0 ]; then
  echo "red-first: seit dem letzten Commit gibt es Quell-Diff ohne Test-Diff." >&2
  echo "Naechster Commit braucht Test-First: <pfad[::testname]> oder Regression-For: oder No-Test:." >&2
fi
exit 0
