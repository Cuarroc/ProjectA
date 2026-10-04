#!/usr/bin/env bash
# hotspot-guard (CI-CONFLICT-01): a branch must not change the generated HQ
# snapshot or the shared journal. Rules and reasons: scripts/lib/hotspots.sh.
#
# Env: HOTSPOT_BRANCH (branch name override), HOTSPOT_BASE (base commit; the
# default is the merge-base with origin/main - no base is a failure, not a pass).
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
