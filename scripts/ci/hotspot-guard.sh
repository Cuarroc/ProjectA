#!/usr/bin/env bash
# hotspot-guard (CI-CONFLICT-01): a branch must not change the generated HQ
# snapshot or the shared journal. Rules and reasons: scripts/lib/hotspots.sh.
#
# Env: HOTSPOT_BRANCH (branch name override), HOTSPOT_BASE (base commit; the
# default is the merge-base with origin/main - no base is a failure, not a pass;
# the one exception is workflow_dispatch, which fetches origin/main first and
# only then falls back to HEAD~1, logged).
set -uo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/lib/hotspots.sh
. "$ROOT/scripts/lib/hotspots.sh"
cd "$ROOT" || exit 1

branch="$(hs_branch "$ROOT")"
if [ -n "$branch" ] && hs_may_touch "$branch"; then
  echo "hotspot-guard: branch '$branch' may change the generated files - nothing to check"
  exit 0
fi

base="${HOTSPOT_BASE:-$(git merge-base origin/main HEAD 2> /dev/null)}"
# A dispatch checkout may hold only the dispatched branch. Fetch origin/main
# (deep enough for a merge-base) before settling for the weaker HEAD~1 check.
if [ -z "$base" ] && [ "${GITHUB_EVENT_NAME:-}" = "workflow_dispatch" ]; then
  depth=()
  [ "$(git rev-parse --is-shallow-repository 2> /dev/null)" = "true" ] && depth=(--depth=500)
  if git fetch -q --no-tags "${depth[@]}" origin +refs/heads/main:refs/remotes/origin/main 2> /dev/null; then
    base="$(git merge-base origin/main HEAD 2> /dev/null)"
    [ -n "$base" ] && echo "hotspot-guard: workflow_dispatch fetched origin/main - comparing against the merge-base ${base:0:12}"
  fi
fi
# workflow_dispatch fetches only the dispatched branch, so origin/main (and a
# merge-base) does not exist. Judge the head commit against its parent and say
# so; a root commit has no parent and still fails closed.
if [ -z "$base" ] && [ "${GITHUB_EVENT_NAME:-}" = "workflow_dispatch" ]; then
  base="$(git rev-parse --verify -q HEAD~1 2> /dev/null)"
  [ -n "$base" ] && echo "hotspot-guard: workflow_dispatch has no origin/main - checking the head commit against HEAD~1 only"
fi
if [ -z "$base" ]; then
  echo "hotspot-guard: no base commit (git fetch origin, or set HOTSPOT_BASE)" >&2
  exit 1
fi

hit="$(git diff --name-only "$base" HEAD -- "${HS_FILES[@]}")" || exit 1
if [ -z "$hit" ]; then
  echo "hotspot-guard: ok - no hotspot file changed on '${branch:-detached HEAD}'"
  exit 0
fi

echo "hotspot-guard: branch '${branch:-detached HEAD}' changes files that conflict across PRs:" >&2
printf '  %s\n' $hit >&2
echo "These are written on main only (AGENTS.md, Checks). Drop the change and keep the branch:" >&2
echo "  git checkout $base -- $(printf '%s ' $hit)" >&2
echo "  git commit -m 'chore: drop generated hotspot files'" >&2
echo "A journal note belongs in the PR text; the snapshot is refreshed by the coordinator on a hq-snapshot branch." >&2
exit 1
