#!/usr/bin/env bash
# dev-build-shape.sh - what keeps the "ProjectA Dev" preview build harmless.
#   1. dev-build.yml: manual trigger only, read-only permissions, no
#      environment, no secret, no reusable-workflow call.
#   2. The overlay: exactly the identifier com.projecta.dev (never the stable
#      com.projecta.app), createUpdaterArtifacts present and false, updater
#      endpoints empty (the plugin then refuses to check:
#      Error::EmptyEndpoints), so the build cannot update into stable.
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

grep -qiE '\<secrets\>' <<< "$body" && err "workflow mentions secrets (secrets.X, secrets['X'], secrets: inherit)"
# A reusable-workflow call (job-level uses:, indent 4) would run foreign code
# with whatever it inherits; step-level uses: sit under `steps:` and stay allowed.
grep -qE '^ {4}uses:' <<< "$body" && err "workflow has a job-level uses (reusable workflow call)"
grep -qE '^[[:space:]]*environment:' <<< "$body" && err "workflow has an environment"
# Only the permissions: blocks (inline value or indented children) are read, so
# a plain key with the value `write` elsewhere does not trip the check.
perms="$(awk '
  /^[[:space:]]*permissions:/ {
    match($0, /^ */); ind = RLENGTH; inb = 1
    rest = $0; sub(/^[[:space:]]*permissions:[[:space:]]*/, "", rest)
    if (rest != "") print rest
    next }
  inb && /^[[:space:]]*$/ { next }
  inb { match($0, /^ */); if (RLENGTH <= ind) inb = 0; else print }' <<< "$body")"
grep -qE '\<write' <<< "$perms" && err "workflow has a write permission"
grep -qE '^[[:space:]]+permissions:' <<< "$body" || err "job declares no job-level permissions"

# Triggers: `on:` is either inline (`on: workflow_dispatch`) or a block whose
# keys (indent 2) must all be workflow_dispatch.
triggers="$(awk '
  /^on:[[:space:]]*$/ { on = 1; next }
  /^on:/ { sub(/^on:[[:space:]]*/, ""); print; next }
  on && /^[^ ]/ { exit }
  on && /^  [A-Za-z_-]+:/ { sub(/:.*/, ""); sub(/^  /, ""); print }' <<< "$body")"
[ -n "$triggers" ] && [ "$(sort -u <<< "$triggers")" = workflow_dispatch ] ||
  err "trigger other than workflow_dispatch (found: $(tr '\n' ' ' <<< "$triggers"))"

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
echo "dev-build-shape: manual trigger, read-only, no secrets; overlay has its own identifier and an inert updater"
