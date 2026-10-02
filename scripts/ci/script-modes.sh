#!/usr/bin/env bash
# Verify that every tracked shell script under scripts/ is executable.
set -uo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1

bad=0
while IFS=$' \t' read -r mode object stage path; do
  [ "$mode" = "100755" ] && continue
  printf 'ERROR: %s is indexed as %s, expected 100755\n' "$path" "$mode" >&2
  bad=1
done < <(git ls-files -s -- 'scripts/**/*.sh')

if [ "$bad" -ne 0 ]; then
  exit 1
fi

echo "all tracked scripts/**/*.sh files are indexed as 100755"
