#!/usr/bin/env bash
# dev-build-shape.sh - what keeps the "ProjectA Dev" preview build harmless.
#   1. dev-build.yml: main push + manual triggers, serialized builds, read-only permissions, no
#      environment, no secret, no reusable-workflow call.
#   2. The overlay: exactly the identifier com.projecta.dev (never the stable
#      com.projecta.app), createUpdaterArtifacts present and false, updater
#      endpoints empty (the plugin then refuses to check:
#      Error::EmptyEndpoints), so the build cannot update into stable.
#   3. The build step embeds PROJECTA_IDENTIFIER=com.projecta.dev so the
#      built binaries never fall back to the stable app's data directories.
# Usage: dev-build-shape.sh [dev-build.yml] [overlay.json]
# Self-test: scripts/test-dev-build-shape.sh
set -uo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
WF="${1:-$ROOT/.github/workflows/dev-build.yml}"
OV="${2:-$ROOT/src-tauri/tauri.dev-channel.conf.json}"
errors=0

for f in "$WF" "$OV"; do
  [ -f "$f" ] || { echo "::error::dev-build-shape.sh: $f not found"; exit 2; }
done

err() {
  echo "::error::dev-build-shape: $*"
  errors=$((errors + 1))
}

body="$(grep -v -E '^[[:space:]]*#' "$WF")"

# Trade-off: the bare word also matches a harmless `secrets` in a run script or
# a step name; that false positive is accepted (fail closed), a miss is not.
grep -qiE '\<secrets\>' <<< "$body" && err "workflow mentions secrets (secrets.X, secrets['X'], secrets: inherit)"

# One structural pass instead of indentation-bound greps. The awk keeps a stack
# of key columns (so any indentation works), skips block-scalar bodies (`run: |`
# text is not YAML structure) and prints one tag per fact:
#   JOBUSES    a job (not step) has a uses key, i.e. a reusable-workflow call
#   JOBOPAQUE  jobs/a job is flow style or uses a merge key; not checkable
#   JOBPERMS   a job declares permissions
#   JOBENV     a job declares an environment
#   PERMS ...  a key or value at or below a workflow/job-level permissions key
#   POLICY    a full path/value at or below on/concurrency (canonical block YAML)
#   END        sentinel: the awk ran to the end
shape="$(awk '
  /^(---|\.\.\.)([ \t]|$)/ { n = 0; blk = -1; next }
  /^[ \t]*$/ { next }
  {
    match($0, /^ */); ind = RLENGTH
    if (blk >= 0) { if (ind > blk) next; blk = -1 }
    col = ind; t = substr($0, ind + 1)
    while (match(t, /^-([ ]+|$)/)) { col += RLENGTH; t = substr(t, RLENGTH + 1) }
    if (t ~ /^[|>][-+0-9]*[ \t]*$/) { blk = ind; next }
    if (!match(t, /^("[^"]*"|'"'"'[^'"'"']*'"'"'|[A-Za-z0-9_.<-]+)[ \t]*:([ \t]|$)/)) next
    key = substr(t, 1, RLENGTH); val = substr(t, RLENGTH + 1)
    sub(/[ \t]*:[ \t]*$/, "", key); gsub(/^["'"'"']|["'"'"']$/, "", key)
    sub(/^[ \t]+/, "", val); sub(/(^|[ \t]+)#.*$/, "", val); sub(/[ \t]+$/, "", val)
    while (n > 0 && c[n] >= col) n--
    n++; c[n] = col; p[n] = key
    if (val ~ /^[|>][-+0-9]*$/) blk = col
    inj = (p[1] == "jobs")
    if (n == 1 && key == "jobs" && val != "") print "JOBOPAQUE"
    if (inj && n == 2 && val != "") print "JOBOPAQUE"
    if (inj && n == 3 && key == "<<") print "JOBOPAQUE"
    if (inj && n == 3 && key == "uses") print "JOBUSES"
    if (inj && n == 3 && key == "permissions") print "JOBPERMS"
    if (inj && n == 3 && key == "environment") print "JOBENV"
    if ((p[1] == "permissions") || (inj && n >= 3 && p[3] == "permissions")) print "PERMS " key ": " val
    if (p[1] == "on" || p[1] == "concurrency") {
      path = p[1]; for (i = 2; i <= n; i++) path = path "/" p[i]
      print "POLICY " path ":" val
    }
  }
  END { print "END" }' <<< "$body")" || err "permissions extraction failed (awk exit $?)"
grep -qx END <<< "$shape" || err "permissions extraction failed (no end marker)"

grep -qx JOBUSES <<< "$shape" && err "workflow has a job-level uses (reusable workflow call)"
grep -qx JOBOPAQUE <<< "$shape" && err "workflow declares jobs in flow style or with a merge key (not checkable)"
grep -qx JOBENV <<< "$shape" && err "workflow has an environment"
perms="$(grep '^PERMS ' <<< "$shape")"
grep -qE '\<write' <<< "$perms" && err "workflow has a write permission"
grep -qx JOBPERMS <<< "$shape" || err "job declares no job-level permissions"
if grep -qE 'permissions[[:space:]]*:' <<< "$body" && [ -z "$perms" ]; then
  err "permissions extraction found nothing although the workflow has a permissions: key"
fi

# Fail closed for extra/duplicate keys and opaque YAML (flow maps, aliases).
# Require the canonical inline branch list; indentation and key order may vary.
triggers="$(sed -n 's/^POLICY on/on/p' <<< "$shape" | LC_ALL=C sort)"
[ "$triggers" = $'on/push/branches:[main]\non/push:\non/workflow_dispatch:\non:' ] ||
  err "triggers must be exactly workflow_dispatch and push with branches: [main]"
concurrency="$(sed -n 's/^POLICY concurrency/concurrency/p' <<< "$shape" | LC_ALL=C sort)"
[ "$concurrency" = $'concurrency/cancel-in-progress:false\nconcurrency/group:dev-build\nconcurrency:' ] ||
  err "concurrency must be group: dev-build and cancel-in-progress: false"

# Without the embedded identifier the Dev build's pa.exe and hooks directory
# silently fall back to the stable app's data (docs/setup/dev-build.md rows
# 1-2). We deliberately require step-level env on the `tauri build` step
# (R1290-C4). GitHub Actions also exports job/workflow-level env, but this
# guard requires the identifier next to the build command for explicitness.
# The awk splits the workflow into step items (a new item starts at the first
# `- ` indent below `steps:`) and prints one verdict per step that builds:
# OK (carries the identifier) or MISSING.
build_steps="$(awk '
  BEGIN { in_steps = 0; item_ind = -1 }
  function flush() {
    if (in_build) print(has_ident ? "OK" : "MISSING")
    in_build = 0; has_ident = 0
  }
  /^[ \t]*$/ { next }
  {
    match($0, /^ */); ind = RLENGTH
    if (!in_steps) {
      if ($0 ~ /^[ \t]*steps:[ \t]*$/) { in_steps = 1; steps_ind = ind; item_ind = -1 }
      next
    }
    if (ind <= steps_ind) { flush(); in_steps = 0; next }
    if (item_ind < 0) {
      if ($0 ~ /^[ \t]*-[ \t]/) item_ind = ind; else next
    }
    if (ind == item_ind && $0 ~ /^[ \t]*-[ \t]/) flush()
    if ($0 ~ /tauri[ \t]+build/) in_build = 1
    if ($0 ~ /^[ \t]*PROJECTA_IDENTIFIER:[ \t]*com\.projecta\.dev[ \t]*$/) has_ident = 1
  }
  END { flush() }
' <<< "$body")"
grep -qx OK <<< "$build_steps" || grep -qx MISSING <<< "$build_steps" ||
  err "no step runs tauri build with PROJECTA_IDENTIFIER com.projecta.dev"
grep -qx MISSING <<< "$build_steps" &&
  err "the step running tauri build must set PROJECTA_IDENTIFIER to com.projecta.dev (same step, not just the same file)"

# The overlay is JSON: node is part of the toolchain (Node 24+, AGENTS.md).
verdict="$(node -e '
  const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const bad = [];
  if (o.identifier !== "com.projecta.dev") bad.push("overlay identifier must be exactly com.projecta.dev (found: " + o.identifier + ")");
  if (o.bundle?.createUpdaterArtifacts !== false) bad.push("overlay must set bundle.createUpdaterArtifacts to exactly false");
  const ep = o.plugins?.updater?.endpoints;
  if (!Array.isArray(ep) || ep.length !== 0) bad.push("updater is not inert (plugins.updater.endpoints must be [])");
  console.log(bad.join("\n"));' "$OV")" || { echo "::error::dev-build-shape: cannot read $OV"; exit 2; }
while IFS= read -r line; do
  [ -n "$line" ] && err "$line"
done <<< "$verdict"

if [ "$errors" -gt 0 ]; then
  echo "dev-build-shape: $errors error(s)"
  exit 1
fi
echo "dev-build-shape: main push + manual triggers, serialized builds, read-only, no secrets; overlay has its own identifier and an inert updater"
