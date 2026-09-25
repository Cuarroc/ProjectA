#!/usr/bin/env bash
# A Test-First trailer `path.mjs::name` runs `node --test` with an exact name
# pattern. When the name does not exist yet (the merge base of a real
# Test-First commit), node still reports the file itself as one passing test
# and exits 0. That run proved nothing, so red-first must count it as red; only
# a pass line for the named test is green. Output is produced live by the
# node that runs this script, not copied.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source <(sed -n '/^regex_escape() {/,/^}/p;/^node_name_run() {/,/^}/p;/^classify_run() {/,/^}/p' "$ROOT/scripts/ci/red-first.sh")
declare -F classify_run node_name_run regex_escape >/dev/null

PROBE="$(mktemp -d)"
trap 'rm -rf "$PROBE"' EXIT
cat > "$PROBE/probe.test.mjs" <<'MJSEOF'
import { test } from "node:test";
test("keeps the anchor (at bottom) and [scrolled] state", () => {});
test("another test", () => {});
MJSEOF

run() {
  local name="$1" out code
  set +e
  out="$(cd "$PROBE" && node_name_run "$name" probe.test.mjs 2>&1)"
  code=$?
  set -e
  classify_run "$out" "$code" "scripts/lib/probe.test.mjs::$name"
}

fail=0
if run 'a name that is new'; then
  echo 'FAIL: a node --test run that matched no test counted as green' >&2
  fail=1
fi
if ! run 'keeps the anchor (at bottom) and [scrolled] state'; then
  echo 'FAIL: the named test with regex characters did not count as green' >&2
  fail=1
fi
if run 'keeps the anchor'; then
  echo 'FAIL: a prefix of a test name counted as the named test' >&2
  fail=1
fi
whole_file='✔ probe.test.mjs (12ms)
ℹ tests 1
ℹ pass 1'
if ! classify_run "$whole_file" 0 'scripts/lib/probe.test.mjs'; then
  echo 'FAIL: a whole-file node --test run with passing tests was rejected' >&2
  fail=1
fi
[ "$fail" -eq 0 ] || exit 1
echo 'red-first node --test name filter classification: passed'
