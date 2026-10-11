#!/usr/bin/env bash
# CI-SEC-01: no secret may be reachable by a job of a workflow that a pull
# request can trigger. Such a job runs PR code, so any secret reference there
# hands the secret to code from a fork or a branch.
#
# Rule: in every workflow file with a `pull_request` (or `pull_request_target`)
# trigger, these fail the gate, in a job or at workflow level (`env:` ...):
# `secrets.`, `secrets[`, `secrets: inherit`, and a job-level `uses:` (a
# reusable workflow call). Exception: the jobs in ALLOW, and only while the job
# has a one-line `if:` naming `refs/heads/main` - `main-red` never executes PR
# code.
# Also: test-insights.yml must wait for the workflow named in ci.yml.
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
      /^[[:space:]]*#/ { next }
      /^on:[[:space:]]*(#.*)?$/ { in_on = 1; next }
      /^on:.*pull_request/ { found = 1 }
      in_on && /^[^[:space:]]/ { in_on = 0 }
      in_on && /^[[:space:]]+pull_request(_target)?:/ { found = 1 }
      in_on && /^[[:space:]]+-[[:space:]]*pull_request(_target)?[[:space:]]*(#.*)?$/ { found = 1 }
      END { exit(found ? 0 : 1) }
    ' "$f"; then
    continue
  fi
  # A job key is a 2-space-indented key below `jobs:`; its block runs to the
  # next job key. Lines of other top-level blocks count as "(workflow-level)".
  # Hits are printed at the END as "job:line:text", once the job's `if:` is
  # known: an ALLOW job passes only with a main-only one-line job `if:`.
  while IFS=: read -r job lineno text; do
    echo "  $f:$lineno  job '$job'  $text"
    bad=$((bad + 1))
  done < <(awk -v allow="$ALLOW" '
      /^[[:space:]]*#/ { next }
      /^[^[:space:]]/ {
        sec = $0; sub(/:.*/, "", sec)
        job = (sec == "jobs") ? "" : "(workflow-level)"
      }
      sec == "jobs" && /^  [A-Za-z0-9_-]+:[[:space:]]*(#.*)?$/ { job = $1; sub(/:$/, "", job); next }
      job == "" { next }
      sec == "jobs" && /^    if:.*refs\/heads\/main/ { guard[job] = 1 }
      /secrets\./ || /secrets\[/ || /secrets:[[:space:]]*inherit/ || (sec == "jobs" && /^    uses:/) {
        t = $0; sub(/^[[:space:]]+/, "", t)
        n++; hj[n] = job; hl[n] = NR; ht[n] = t
      }
      END {
        for (i = 1; i <= n; i++) {
          if (index(allow, " " hj[i] " ") && guard[hj[i]]) continue
          if (index(allow, " " hj[i] " ")) ht[i] = "(allowlisted, but no one-line job if: with refs/heads/main) " ht[i]
          print hj[i] ":" hl[i] ":" ht[i]
        }
      }
    ' "$f")
done

# test-insights.yml runs on `workflow_run`; a renamed ci.yml would silently
# stop the upload, so the waited-for name must equal ci.yml's `name:`.
if [ -f "$dir/test-insights.yml" ]; then
  want="$(awk '/^name:/ { sub(/^name:[[:space:]]*/, ""); sub(/[[:space:]]*#.*/, ""); gsub(/["\047]/, ""); print; exit }' "$dir/ci.yml" 2>/dev/null)"
  got="$(sed -nE 's/^[[:space:]]*workflows:[[:space:]]*\[(.*)\][[:space:]]*(#.*)?$/\1/p' "$dir/test-insights.yml" | tr -d " \"'")"
  if [ -z "$want" ] || [ "$got" != "$want" ]; then
    echo "  $dir/test-insights.yml: workflow_run.workflows is '$got', ci.yml name is '$want'"
    bad=$((bad + 1))
  fi
fi

if [ "$found" -eq 0 ]; then
  echo "::error::No workflow file found in $dir - wrong path?"
  exit 2
fi
if [ "$bad" -gt 0 ]; then
  echo "::error::$bad secret reference(s) / reusable call(s) in PR-triggered workflows, or a test-insights.yml name mismatch. A PR job runs PR code: upload via a workflow_run workflow (see test-insights.yml) instead."
  exit 1
fi
echo "no secret reference in a PR-triggered workflow under $dir (allowlist:$ALLOW)"
