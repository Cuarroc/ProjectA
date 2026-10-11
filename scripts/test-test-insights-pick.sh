#!/usr/bin/env bash
# Selftest for scripts/ci/test-insights-pick.sh: nested layout, flat layout,
# a missing artifact dir (the job did not run) and an artifact without the file.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

# case name, then the files that must (+x) / must not (-x) be in reports/
run() { # name artifacts-dir expected...
  local name="$1" a="$2"; shift 2
  bash scripts/ci/test-insights-pick.sh "$a" "$tmp/$name.out" > "$tmp/$name.log" 2>&1
  local rc=$? bad=""
  [ "$rc" -eq 0 ] || bad=" exit $rc"
  for e in "$@"; do
    case "$e" in
      +*) [ -f "$tmp/$name.out/${e#+}" ] || bad="$bad missing ${e#+}" ;;
      -*) [ ! -e "$tmp/$name.out/${e#-}" ] || bad="$bad unexpected ${e#-}" ;;
    esac
  done
  if [ -n "$bad" ]; then echo "FAIL $name:$bad"; sed 's/^/    /' "$tmp/$name.log"; fails=$((fails + 1)); else echo "ok   $name"; fi
}

mkdir -p "$tmp/nested/junit-linux/deep/er" "$tmp/nested/junit-windows"
: > "$tmp/nested/junit-linux/deep/er/junit.xml"; : > "$tmp/nested/junit-linux/vitest.xml"
: > "$tmp/nested/junit-windows/junit.xml"
run "pick-nested-layout" "$tmp/nested" +linux-nextest.xml +linux-vitest.xml +windows-nextest.xml

mkdir -p "$tmp/nowin/junit-linux"; : > "$tmp/nowin/junit-linux/junit.xml"
run "pick-missing-artifact-dir" "$tmp/nowin" +linux-nextest.xml -linux-vitest.xml -windows-nextest.xml
grep -q "no artifact junit-windows" "$tmp/pick-missing-artifact-dir.log" && echo "ok   pick-missing-artifact-notice" || { echo "FAIL pick-missing-artifact-notice"; fails=$((fails + 1)); }

mkdir -p "$tmp/none"
run "pick-no-artifacts-at-all" "$tmp/none" -linux-nextest.xml -windows-nextest.xml

mkdir -p "$tmp/empty/junit-linux"
run "pick-artifact-without-file" "$tmp/empty" -linux-nextest.xml -linux-vitest.xml

[ "$fails" -eq 0 ] && echo "all cases green" || echo "$fails case(s) red"
[ "$fails" -eq 0 ]
