#!/usr/bin/env bash
# CI-SEC-01: no secret may be reachable by a job of a workflow that a pull
# request can trigger. Such a job runs PR code, so any `secrets.` reference
# there hands the secret to code from a fork or a branch.
#
# Rule: in every workflow file with a `pull_request` (or `pull_request_target`)
# trigger, a job that mentions `secrets.` fails the gate - except the jobs in
# ALLOW. `main-red` runs on main only (`github.ref == 'refs/heads/main'`), it
# never executes PR code.
#
# Comment lines are ignored: this very explanation names `secrets.`.
# Selftest: scripts/test-pr-secrets.sh
# Usage: scripts/ci/pr-secrets.sh [workflow-dir]   (default: .github/workflows)
set -uo pipefail
dir="${1:-.github/workflows}"
ALLOW=" main-red "

bad=0
found=0
for f in "$dir"/*.yml "$dir"/*.yaml; do
  [ -f "$f" ] || continue
  found=$((found + 1))
  # Only a PR-triggered workflow is in scope (top-level `on:` block).
  if ! awk '
      /^on:[[:space:]]*$/ { in_on = 1; next }
      /^on:.*pull_request/ { found = 1 }
      in_on && /^[^[:space:]#]/ { in_on = 0 }
      in_on && /^[[:space:]]+pull_request(_target)?:/ { found = 1 }
      in_on && /^[[:space:]]+-[[:space:]]*pull_request(_target)?[[:space:]]*$/ { found = 1 }
      END { exit(found ? 0 : 1) }
    ' "$f"; then
    continue
  fi
  # A job key is a 2-space-indented key below `jobs:`; its block runs to the
  # next job key. Print "job:line:text" for every uncommented `secrets.`.
  while IFS=: read -r job lineno text; do
    case "$ALLOW" in *" $job "*) continue ;; esac
    echo "  $f:$lineno  job '$job'  $text"
    bad=$((bad + 1))
  done < <(awk '
      /^jobs:[[:space:]]*$/ { in_jobs = 1; next }
      in_jobs && /^[^[:space:]#]/ { in_jobs = 0 }
      in_jobs && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { job = $1; sub(/:$/, "", job); next }
      in_jobs && job != "" && /^[[:space:]]*#/ { next }
      in_jobs && job != "" && /secrets\./ {
        t = $0; sub(/^[[:space:]]+/, "", t); print job ":" NR ":" t
      }
    ' "$f")
done

if [ "$found" -eq 0 ]; then
  echo "::error::No workflow file found in $dir - wrong path?"
  exit 2
fi
if [ "$bad" -gt 0 ]; then
  echo "::error::$bad 'secrets.' reference(s) in jobs of PR-triggered workflows. A PR job runs PR code: upload via a workflow_run workflow (see test-insights.yml) instead."
  exit 1
fi
echo "no 'secrets.' reference in a job of a PR-triggered workflow under $dir (allowlist:$ALLOW)"
