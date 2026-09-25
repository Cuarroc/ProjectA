#!/usr/bin/env bash
# Self-test: red-first when the evidence has already landed on main.
#
# Found on PR #149 (CI-03) on 25.09.2026: the CI-02 commit 5bab3db carries
# `Test-First: scripts/test-hook-root.sh::alle-gates-im-worktree`. The same
# fix and test then reached main on their own as hotfix #156, whose commit
# b147927 carries the identical trailer and was proven red->green by main's
# red-first. After merging main, the test is green at the merge base, and
# red-first failed the PR ("war an der Merge-Base GRUEN") - for evidence
# that main had already proven. Nobody can show it red again.
#
# The rule this pins, both directions (AGENTS.md, rule 2):
#   - green at the merge base AND a commit reachable from the merge base
#     carries the identical `Test-First:` line -> already proven on main,
#     logged, not a failure (the head must still be green);
#   - green at the merge base WITHOUT such a trailer on main -> still red:
#     an existing, passing test is not Test-First evidence;
#   - a trailer on main for a DIFFERENT spec does not count;
#   - red at the merge base keeps working as before.
set -uo pipefail

HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/red-first-landed.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
fails=0

repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/scripts/lib"
cp "$HERE/scripts/ci/red-first.sh" "$repo/scripts/ci/red-first.sh"
cp "$HERE/scripts/lib/test-first.sh" "$repo/scripts/lib/test-first.sh"
cd "$repo" || exit 1
git init -q -b main
git config user.email "probe@example.test"
git config user.name "red-first probe"
git config commit.gpgsign false
git config core.hooksPath /dev/null
git config core.autocrlf false
mkdir -p src scripts
printf 'export {};\n' > src/App.tsx
git add -A
git commit -q -m "basis"
root="$(git rev-parse HEAD)"

# A test that passes only once src/fix.txt exists, and the fix itself.
write_test() { # file
  # Relative to the test's own tree: red-first runs the base copy as
  # `bash <base-tree>/<path>` with the head checkout as cwd.
  printf '#!/usr/bin/env bash\n[ -f "$(dirname "$0")/../src/fix.txt" ] || { echo "not fixed"; exit 1; }\necho ok\n' > "$1"
}

# commit file-to-add message trailer-line
commit() {
  git add -A
  git commit -q -m "$1" -m "$2"
}

# The PR branch: test (red) then fix, with a Test-First trailer.
git checkout -q -B pr "$root"
write_test scripts/test-landed.sh
commit "test: landed (red)" "No-Test: test only"
printf 'fix\n' > src/fix.txt
printf 'export const x = 1;\n' > src/App.tsx
commit "fix: landed" "Test-First: scripts/test-landed.sh"

# main moves on: the same fix and test arrive as a hotfix of their own.
port_to_main() { # trailer-line
  git checkout -q -B main-ported "$root"
  write_test scripts/test-landed.sh
  commit "test: landed (red, hotfix)" "No-Test: test only"
  printf 'fix\n' > src/fix.txt
  printf 'export const x = 1;\n' > src/App.tsx
  commit "fix: landed (hotfix)" "$1"
  # The PR merges main, as the conflict resolution on #149 did.
  git checkout -q pr
  git branch -q -f pr-merged pr
  git checkout -q pr-merged
  git merge -q --no-edit -X ours main-ported -m "Merge main" > /dev/null 2>&1
}

run() { # name expected(pass|fail) [log-regex]
  local rc
  BASE_SHA="$(git rev-parse main-ported)" HEAD_SHA="$(git rev-parse HEAD)" PR_BODY="" \
    bash scripts/ci/red-first.sh > "$tmp/out" 2>&1
  rc=$?
  if { [ "$2" = pass ] && [ "$rc" -eq 0 ]; } || { [ "$2" = fail ] && [ "$rc" -ne 0 ]; }; then
    if [ -n "${3:-}" ] && ! grep -E -- "$3" "$tmp/out" > /dev/null; then
      echo "FEHLER $1: exit $rc as expected, but no log line /$3/"
      sed 's/^/    /' "$tmp/out"
      fails=$((fails + 1))
    else
      echo "ok   $1 (exit $rc)"
    fi
  else
    echo "FEHLER $1: exit $rc, expected $2"
    sed 's/^/    /' "$tmp/out"
    fails=$((fails + 1))
  fi
}

# 1. main carries the identical trailer -> already proven there, pass.
port_to_main "Test-First: scripts/test-landed.sh"
run already-proven-on-main pass "already proven on main"

# 2. main has the same test and fix but NO Test-First trailer -> still red.
git checkout -q main 2> /dev/null || git checkout -q -B main "$root"
port_to_main "No-Test: hotfix without evidence"
run green-at-base-without-trailer fail "GRUEN"

# 3. main carries a trailer for a DIFFERENT spec -> does not count.
port_to_main "Test-First: scripts/test-other.sh"
run trailer-for-other-spec fail "GRUEN"

# 4. Nothing ported: red at the base, green at the head -> pass as before.
git checkout -q -B main-ported "$root"
git checkout -q pr
run plain-red-to-green pass "an der Merge-Base rot/fehlend"

if [ "$fails" -gt 0 ]; then
  echo "test-red-first-landed: $fails Fehler"
  exit 1
fi
echo "test-red-first-landed: alle Faelle gruen"
