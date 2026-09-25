#!/usr/bin/env bash
# LIC-01: license gate for the public repository (lane linux,release).
# Both halves share one allowlist (scripts/lib/license-check.mjs and
# src-tauri/deny.toml). A license outside the list fails the gate — the fix
# is an orchestrator decision, not a local exception.
set -uo pipefail
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
fails=0

# --- Rust: cargo-deny -------------------------------------------------------
DENY_VERSION="0.20.2"
installed="$(cargo deny --version 2>/dev/null | awk '{print $NF}')"
if [ "$installed" != "$DENY_VERSION" ]; then
  echo "license-check: cargo-deny $DENY_VERSION noetig (gefunden: ${installed:-nichts}) — installiere (kann Minuten dauern)"
  cargo install cargo-deny --locked --version "$DENY_VERSION" || {
    echo "license-check: cargo-deny konnte nicht installiert werden"
    exit 1
  }
fi
( cd "$ROOT/src-tauri" && cargo deny check licenses ) || fails=1

# --- npm production dependencies --------------------------------------------
# Pinned tool version: a compliance gate must not depend on whatever the
# registry serves as "latest" that day (review lic-01, kimi-k3 F2).
CHECKER_VERSION="5.0.1"
report="$(mktemp)"
trap 'rm -f "$report"' EXIT
( cd "$ROOT" && npx --yes "license-checker-rseidelsohn@$CHECKER_VERSION" --production --json ) > "$report" || {
  echo "license-check: license-checker-rseidelsohn fehlgeschlagen"
  exit 1
}
node "$ROOT/scripts/lib/license-check.mjs" "$report" || fails=1

exit "$fails"
