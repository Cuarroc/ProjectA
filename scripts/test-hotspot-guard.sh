#!/usr/bin/env bash
# Self-test for CI-CONFLICT-01: branches must not commit the generated HQ
# snapshot or .pa/ACTIVITY.md (scripts/ci/hotspot-guard.sh, scripts/sync.sh).
# Each case runs in a fresh temp repo; passing cases print `ok   <name>`.
set -uo pipefail

HERE="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/hotspot-guard.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
fails=0

pass() { echo "ok   $1"; }
fail() { echo "FEHLER $1"; fails=$((fails + 1)); }

# A repo that carries the scripts under test, one base commit on main.
repo() { # name
  local d="$tmp/$1"
  mkdir -p "$d/scripts/ci" "$d/scripts/lib" "$d/docs/dev-hq" "$d/.pa"
  cp "$HERE/scripts/sync.sh" "$d/scripts/"
  cp "$HERE/scripts/ci/hotspot-guard.sh" "$d/scripts/ci/" 2> /dev/null
  cp "$HERE/scripts/lib/hotspots.sh" "$d/scripts/lib/" 2> /dev/null
  (
    cd "$d" || exit 1
    git init -q -b main . && git config user.email t@t && git config user.name t
    printf 'a\n' > docs/dev-hq/data.js; printf '{}\n' > docs/dev-hq/data.json
    printf '# ACTIVITY\n' > .pa/ACTIVITY.md; printf 'x\n' > other.txt
    git add -A && git commit -qm base
  )
  echo "$d"
}

guard() { # dir -> exit code of the guard in dir (CI env stripped)
  (cd "$1" && env -u GITHUB_ACTIONS -u GITHUB_HEAD_REF -u GITHUB_REF_NAME -u HOTSPOT_BRANCH \
    HOTSPOT_BASE="$(git rev-parse main)" bash scripts/ci/hotspot-guard.sh > "$1/out" 2>&1)
}

# branch-with-change <name> <branch> <file>: commit a change to <file> on <branch>
branch_change() {
  local d
  d="$(repo "$1")"
  (cd "$d" && git checkout -q -b "$2" && printf 'changed\n' >> "$3" && git commit -qam change)
  echo "$d"
}

for f in docs/dev-hq/data.js docs/dev-hq/data.json .pa/ACTIVITY.md; do
  d="$(branch_change "rej-$(basename "$f")" claude/some-work "$f")"
  if guard "$d"; then fail "guard rejects package branch touching $f"; else
    grep -q "$f" "$d/out" && grep -q "git checkout" "$d/out" && pass "guard rejects package branch touching $f" ||
      fail "guard rejects package branch touching $f (message lacks file or fix)"
  fi
done

d="$(branch_change other claude/some-work other.txt)"
guard "$d" && pass "guard accepts branch touching other files only" || fail "guard accepts branch touching other files only"

d="$(repo mainc)"
(cd "$d" && printf 'n\n' >> .pa/ACTIVITY.md && git commit -qam note)
(cd "$d" && env -u GITHUB_ACTIONS -u GITHUB_HEAD_REF HOTSPOT_BASE="$(git rev-parse HEAD~1)" bash scripts/ci/hotspot-guard.sh > out 2>&1) &&
  pass "guard accepts main touching the hotspot files" || fail "guard accepts main touching the hotspot files"

d="$(branch_change snap claude/hq-snapshot-refresh docs/dev-hq/data.json)"
guard "$d" && pass "guard accepts a dedicated hq-snapshot branch" || fail "guard accepts a dedicated hq-snapshot branch"

d="$(branch_change queue mergify/merge-queue/0123456789 docs/dev-hq/data.json)"
guard "$d" && pass "guard accepts a Mergify merge queue branch" || fail "guard accepts a Mergify merge queue branch"

d="$(branch_change nobase claude/some-work docs/dev-hq/data.js)"
(cd "$d" && env -u HOTSPOT_BASE -u GITHUB_ACTIONS -u GITHUB_HEAD_REF bash scripts/ci/hotspot-guard.sh > out 2>&1) &&
  fail "guard fails closed without a base" || pass "guard fails closed without a base"

# workflow_dispatch checks out only the dispatched branch: no origin/main, so
# no merge-base (Actions run 37319932614). The guard then judges the head
# commit against HEAD~1 and says so; a hotspot in the head commit still fails.
dispatch() { # dir -> exit code of the guard as in a dispatch checkout
  (cd "$1" && env -u HOTSPOT_BASE -u GITHUB_HEAD_REF -u HOTSPOT_BRANCH GITHUB_ACTIONS=true \
    GITHUB_EVENT_NAME=workflow_dispatch GITHUB_REF_NAME=claude/some-work \
    bash scripts/ci/hotspot-guard.sh > "$1/out" 2>&1)
}

d="$(branch_change dispatch-ok claude/some-work other.txt)"
if dispatch "$d"; then
  grep -q "workflow_dispatch" "$d/out" && grep -q "HEAD~1" "$d/out" &&
    pass "dispatch without origin/main falls back to HEAD~1 and logs it" ||
    fail "dispatch without origin/main falls back to HEAD~1 and logs it (reason not logged)"
else
  fail "dispatch without origin/main falls back to HEAD~1 and logs it"
fi

d="$(branch_change dispatch-hit claude/some-work docs/dev-hq/data.js)"
if dispatch "$d"; then fail "dispatch fallback still rejects a hotspot in the head commit"; else
  grep -q "docs/dev-hq/data.js" "$d/out" && pass "dispatch fallback still rejects a hotspot in the head commit" ||
    fail "dispatch fallback still rejects a hotspot in the head commit (file not named)"
fi

d="$(repo dispatch-root)"
dispatch "$d" && fail "dispatch on a root commit fails closed (no HEAD~1)" || pass "dispatch on a root commit fails closed (no HEAD~1)"

# sync.sh note: on a branch the tracked journal stays untouched.
d="$(repo note-branch)"
(cd "$d" && git checkout -q -b claude/some-work)
out="$(cd "$d" && env -u HOTSPOT_BRANCH -u GITHUB_ACTIONS -u GITHUB_HEAD_REF bash scripts/sync.sh note test "summary" 2>&1)"
if [ -z "$(git -C "$d" diff --name-only -- .pa/ACTIVITY.md)" ] && grep -q summary "$d/.pa/ACTIVITY.local.md" 2> /dev/null &&
  printf '%s' "$out" | grep -q "ACTIVITY.local.md"; then
  pass "sync note on a package branch leaves the tracked ACTIVITY.md alone"
else
  fail "sync note on a package branch leaves the tracked ACTIVITY.md alone"
fi

d="$(repo note-main)"
(cd "$d" && env -u HOTSPOT_BRANCH -u GITHUB_ACTIONS -u GITHUB_HEAD_REF bash scripts/sync.sh note test "summary" > /dev/null 2>&1)
grep -q summary "$d/.pa/ACTIVITY.md" && pass "sync note on main appends to the tracked ACTIVITY.md" ||
  fail "sync note on main appends to the tracked ACTIVITY.md"

[ "$fails" -eq 0 ] || { echo "$fails Fehler"; exit 1; }
echo "alle Hotspot-Faelle ok"
