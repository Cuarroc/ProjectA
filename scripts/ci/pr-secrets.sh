#!/usr/bin/env bash
# CI-SEC-01: no secret may be reachable by a job of a workflow that a pull
# request can trigger. Such a job runs PR code, so any secret reference there
# hands the secret to code from a fork or a branch.
#
# Rule (fail closed): in every workflow file with a `pull_request` (or
# `pull_request_target`) trigger, ANY occurrence of the word `secrets` inside a
# `${{ ... }}` expression fails the gate (`secrets.X`, `secrets['X']`,
# `${{ secrets }}`, `toJSON(secrets)`, also in a comment-looking line or an
# expression that spans lines), and so do `secrets: inherit` and a job-level
# `uses:` (a reusable workflow call, which is how a workflow_call file becomes
# reachable from a PR). Exception: the jobs in ALLOW, and only while the job's
# one-line `if:` compares `github.ref == 'refs/heads/main'` (or
# `github.ref_name == 'main'`) and has no `!=`, `||`, `!(` or `pull_request` -
# `main-red` never executes PR code. A `jobs:` block this awk parser cannot
# read (flow style, no job keys, no `jobs:`) is an error, never green. The
# parser takes the indentation from the file; it is not tied to 2 spaces.
# Also: test-insights.yml must wait for the workflow named in ci.yml.
#
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
      { sub(/[[:space:]]+#.*$/, "") }
      /^["\047]?on["\047]?:[[:space:]]*$/ { in_on = 1; next }
      /^["\047]?on["\047]?:.*pull_request/ { found = 1 }
      in_on && /^[^[:space:]]/ { in_on = 0 }
      in_on && /pull_request/ { found = 1 }
      END { exit(found ? 0 : 1) }
    ' "$f"; then
    continue
  fi
  # Hits are printed at the END as "job:line:text", once the job's `if:` is
  # known: an ALLOW job passes only with a plain main-only job `if:`.
  while IFS=: read -r job lineno text; do
    echo "  $f:$lineno  job '$job'  $text"
    bad=$((bad + 1))
  done < <(awk -v allow="$ALLOW" '
      function hit(j, t) { n++; hj[n] = j; hl[n] = NR; ht[n] = t }
      # 1 if the word `secrets` (any case) sits inside a ${{ }} expression;
      # `inx` carries an expression open across lines.
      function expr_hit(s,   h, p, q, seg) {
        while (length(s)) {
          if (!inx) { p = index(s, "${{"); if (!p) break; s = substr(s, p + 3); inx = 1 }
          q = index(s, "}}")
          if (q) { seg = substr(s, 1, q - 1); s = substr(s, q + 2); inx = 0 } else { seg = s; s = "" }
          if (tolower(seg) ~ /(^|[^a-z0-9_-])secrets([^a-z0-9_-]|$)/) h = 1
        }
        return h
      }
      function guard_ok(v) {
        sub(/^[[:space:]]*if:[[:space:]]*/, "", v); v = tolower(v)
        if (v ~ /!=|\|\||!\(|pull_request/) return 0
        return (v ~ /github\.ref[[:space:]]*==[[:space:]]*[\047"]refs\/heads\/main[\047"]/ ||
                v ~ /github\.ref_name[[:space:]]*==[[:space:]]*[\047"]main[\047"]/)
      }
      {
        e = expr_hit($0)
        if ($0 ~ /^[[:space:]]*$/) next
        t = $0; sub(/[[:space:]]+#.*$/, "", t)
        c = ($0 ~ /^[[:space:]]*#/)
        if (!c) {
          match(t, /^ */); ind = RLENGTH
          if (ind == 0) {
            sec = t; sub(/:.*/, "", sec); jind = -1; job = "(workflow-level)"
            if (sec == "jobs") { sawjobs = 1; job = "(jobs)"; if (t !~ /^jobs:[[:space:]]*$/) unparsable = 1 }
          } else if (sec == "jobs") {
            if (jind < 0) jind = ind
            if (ind == jind) {
              if (t ~ /^ *["\047]?[A-Za-z0-9_-]+["\047]?:[[:space:]]*$/) { job = t; gsub(/[ :"\047]/, "", job); njobs++; find = -1 }
              else unparsable = 1
            } else if (ind > jind) {
              if (find < 0) find = ind
              if (ind == find && t ~ /^ *if:/) iff[job] = t
              if (ind == find && t ~ /^ *uses:/) hit(job, t)
            }
          }
          if (t ~ /secrets:[[:space:]]*inherit/) hit(job, t)
        }
        if (e) { sub(/^[[:space:]]+/, "", t); hit(job, t) }
      }
      END {
        if (!sawjobs) hit("(parse)", "no top-level jobs: block")
        else if (unparsable || !njobs) hit("(parse)", "jobs: block cannot be parsed (flow style, sequence or no job key)")
        for (i = 1; i <= n; i++) {
          j = hj[i]
          if (index(allow, " " j " ")) {
            if (guard_ok(iff[j])) continue
            ht[i] = "(allowlisted, but job if: is not a plain main-only guard) " ht[i]
          }
          print j ":" hl[i] ":" ht[i]
        }
      }
    ' "$f")
done

# test-insights.yml runs on `workflow_run`; a renamed ci.yml would silently
# stop the upload, so the waited-for name must equal ci.yml's `name:`.
if [ -f "$dir/test-insights.yml" ]; then
  if [ ! -f "$dir/ci.yml" ]; then
    echo "  $dir/ci.yml not found: cannot check test-insights.yml workflow_run.workflows"
    bad=$((bad + 1))
  else
    want="$(awk '/^name:/ { sub(/^name:[[:space:]]*/, ""); sub(/[[:space:]]*#.*/, ""); gsub(/["\047]/, ""); print; exit }' "$dir/ci.yml")"
    # Flow list (one or many entries) or block list; one name per line.
    got="$(awk '
        /^[[:space:]]*#/ { next }
        { sub(/[[:space:]]+#.*$/, "") }
        blk { if (/^[[:space:]]*-/) { sub(/^[[:space:]]*-[[:space:]]*/, ""); print; next } if (/^[[:space:]]*$/) next; blk = 0 }
        /^[[:space:]]*workflows:/ {
          sub(/^[[:space:]]*workflows:[[:space:]]*/, "")
          if ($0 == "") { blk = 1; next }
          gsub(/^\[|\]$/, ""); n = split($0, a, ","); for (i = 1; i <= n; i++) print a[i]
        }' "$dir/test-insights.yml" | tr -d " \"'")"
    if [ -z "$want" ] || ! printf '%s\n' "$got" | grep -Fxq -- "$want"; then
      echo "  $dir/test-insights.yml: workflow_run.workflows is [$(printf '%s' "$got" | tr '\n' ' ')], ci.yml name is '$want'"
      bad=$((bad + 1))
    fi
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
