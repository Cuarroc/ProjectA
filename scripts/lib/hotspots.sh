#!/usr/bin/env bash
# Shared rules for the merge-conflict hotspots (CI-CONFLICT-01). Functions
# only - nothing runs when sourced.
#
# GitHub and Mergify compute mergeability without our local merge driver, so
# every branch that commits one of these files re-conflicts with every other
# one the moment the first lands. Only main and a dedicated snapshot branch
# (`<vendor>/hq-snapshot...`, made by the coordinator) may commit them. Queue
# branches may carry such a commit while Mergify validates it before merging.

HS_FILES=(docs/dev-hq/data.js docs/dev-hq/data.json .pa/ACTIVITY.md)

# Branch name to judge: explicit override, then the CI refs, then git. Empty
# (detached HEAD, nothing known) is not a branch that may touch the files.
hs_branch() { # [root]
  if [ -n "${HOTSPOT_BRANCH:-}" ]; then
    printf '%s' "$HOTSPOT_BRANCH"
  elif [ -n "${GITHUB_HEAD_REF:-}" ]; then
    printf '%s' "$GITHUB_HEAD_REF"
  elif [ "${GITHUB_ACTIONS:-}" = "true" ] && [ -n "${GITHUB_REF_NAME:-}" ]; then
    printf '%s' "$GITHUB_REF_NAME"
  else
    git -C "${1:-.}" branch --show-current 2> /dev/null
  fi
}

hs_may_touch() { # branch
  case "$1" in
    main | master | gh-readonly-queue/* | mergify/merge-queue/* | hq-snapshot* | */hq-snapshot*) return 0 ;;
  esac
  return 1
}
